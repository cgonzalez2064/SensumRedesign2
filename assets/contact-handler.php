<?php
/**
 * Sensum Construcciones — contact form handler
 * ------------------------------------------------------------
 * Receives the POST from #contactForm (assets/main.js, and — as a
 * progressive-enhancement fallback when JavaScript is unavailable —
 * a plain native form submission) and emails it to the business inbox.
 * Designed to run as-is on Namecheap shared hosting (cPanel).
 *
 * SECURITY NOTES FOR WHOEVER DEPLOYS THIS:
 *  - Update TO_EMAIL below to the real inbox that should receive leads.
 *  - Update ALLOWED_ORIGINS below if the production domain changes.
 *  - This script re-validates everything server-side. Never trust the
 *    client-side JS validation alone — it's a UX convenience only.
 *  - CSRF: this is a public, unauthenticated lead form with no login
 *    session to bind a real server-issued CSRF token to, so instead of
 *    shipping a client-side "CSRF token" that would just be a hardcoded
 *    secret sitting in publicly-readable JS (security theater, not real
 *    protection), this endpoint relies on: a same-origin Origin/Referer
 *    allowlist (below), per-client rate limiting, a honeypot field, and
 *    a minimum-completion-time check. If a login/session system is ever
 *    added to this site, switch to real server-issued, per-session CSRF
 *    tokens at that point.
 *  - Mail delivery: uses PHP's built-in mail(), which works out of the
 *    box on Namecheap shared hosting. For better deliverability, see
 *    the "SMTP upgrade hook" section below and DEPLOY.md — SPF/DKIM/
 *    DMARC records must exist for the sending domain either way.
 */

// ------------------------------------------------------------
// Config — the only values a deployer should normally touch.
// ------------------------------------------------------------
const TO_EMAIL   = 'contacto@sensumconstrucciones.com';
const SITE_NAME  = 'Sensum Construcciones';
// Hardcoded sender hostname — NEVER derive this from $_SERVER['HTTP_HOST'],
// which is attacker-controlled input on shared hosting with catch-all vhosts.
const SENDER_DOMAIN = 'sensumconstrucciones.com';
const FROM_EMAIL = 'no-reply@' . SENDER_DOMAIN;
// Same-origin allowlist for the Origin/Referer check.
const ALLOWED_ORIGINS = [
    'https://sensumconstrucciones.com',
    'https://www.sensumconstrucciones.com',
];
// Exact allowlist for the "service" field — must match the <select>
// options in index.html.
const ALLOWED_SERVICES = [
    'Remodelaciones',
    'Diseño arquitectónico',
    'Impermeabilización y tratamientos técnicos',
    'Obra civil',
    'Instalaciones generales',
    'Mantenimiento preventivo',
    'Otro',
];
const ALLOWED_FIELDS = ['name', 'phone', 'email', 'service', 'message', 'website', 'loaded_at'];
const MAX_REQUEST_BYTES = 51200; // 50 KB — generous for a text-only form, well under abuse territory
const MIN_COMPLETION_MS = 3000;  // real users take at least a few seconds to fill this out
const RATE_LIMIT_WINDOW_S = 600; // 10 minutes
const RATE_LIMIT_MAX = 5;        // max submissions per client hash per window

// ------------------------------------------------------------
// Never leak server internals into the response — errors are logged
// (see the logging calls below), not displayed. This is set here
// defensively in case the shared-hosting php.ini has display_errors
// on; production PHP config should also disable it globally.
// ------------------------------------------------------------
ini_set('display_errors', '0');
error_reporting(E_ALL); // still log everything; just never display it
header_remove('X-Powered-By');

// ------------------------------------------------------------
// Response headers — set before any output, on every path.
// ------------------------------------------------------------
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

/**
 * A plain browser form submission (no JS) sends Accept: text/html.
 * assets/main.js's fetch() call sends Accept: application/json. Serve
 * a small branded HTML page in the first case instead of raw JSON.
 */
function wantsJson() {
    $accept = $_SERVER['HTTP_ACCEPT'] ?? '';
    return stripos($accept, 'application/json') !== false || empty($accept);
}

function respond($httpStatus, $ok, $payload = []) {
    http_response_code($httpStatus);
    if (wantsJson()) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(array_merge(['ok' => $ok], $payload));
        exit;
    }
    header('Content-Type: text/html; charset=utf-8');
    $heading = $ok
        ? 'Gracias — Thank you'
        : 'No se pudo enviar — Could not send';
    $message = $ok
        ? 'Tu mensaje fue enviado. Te contactaremos pronto.<br>Your message was sent. We will contact you soon.'
        : 'Hubo un problema con tu envío. Intenta de nuevo o escríbenos por WhatsApp/teléfono.<br>There was a problem with your submission. Please try again or reach us by WhatsApp/phone.';
    // No inline <style> here on purpose — this response is covered by the
    // same strict Content-Security-Policy as the rest of the site
    // (script-src/style-src with no 'unsafe-inline'), so styling comes
    // from the shared, same-origin stylesheet instead.
    echo '<!DOCTYPE html><html lang="es-GT"><head><meta charset="UTF-8">'
        . '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
        . '<meta name="robots" content="noindex">'
        . '<title>' . htmlspecialchars($heading, ENT_QUOTES, 'UTF-8') . ' | Sensum Construcciones</title>'
        . '<link rel="stylesheet" href="main.css"></head><body>'
        . '<main class="section-pad"><div class="container contact-fallback-page">'
        . '<h1>' . htmlspecialchars($heading, ENT_QUOTES, 'UTF-8') . '</h1><p>' . $message . '</p>'
        . '<p><a class="btn btn-dark" href="../index.html#contacto">&larr; Volver al sitio / Back to the site</a></p>'
        . '</div></main>'
        . '</body></html>';
    exit;
}

// ------------------------------------------------------------
// Method + content-type checks
// ------------------------------------------------------------
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, false, ['error' => 'method_not_allowed']);
}

$contentType = $_SERVER['CONTENT_TYPE'] ?? '';
if (stripos($contentType, 'multipart/form-data') === false
    && stripos($contentType, 'application/x-www-form-urlencoded') === false) {
    respond(415, false, ['error' => 'unsupported_content_type']);
}

// ------------------------------------------------------------
// Request size limit (defense in depth alongside php.ini's
// post_max_size, which a shared-hosting deployer may not control).
// ------------------------------------------------------------
$contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
if ($contentLength > MAX_REQUEST_BYTES) {
    respond(413, false, ['error' => 'payload_too_large']);
}

// ------------------------------------------------------------
// Origin / Referer allowlist (same-origin policy for this public,
// unauthenticated form — see the CSRF note above).
// ------------------------------------------------------------
function originAllowed() {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '') {
        return in_array(rtrim($origin, '/'), ALLOWED_ORIGINS, true);
    }
    $referer = $_SERVER['HTTP_REFERER'] ?? '';
    if ($referer !== '') {
        foreach (ALLOWED_ORIGINS as $allowed) {
            if (stripos($referer, $allowed . '/') === 0 || $referer === $allowed) {
                return true;
            }
        }
        return false;
    }
    // Neither header present — most real browser submissions send at
    // least one of these for a same-origin POST. Reject rather than
    // silently trust an unverifiable request.
    return false;
}
if (!originAllowed()) {
    respond(403, false, ['error' => 'origin_not_allowed']);
}

// ------------------------------------------------------------
// Reject unexpected fields and non-scalar values up front.
// ------------------------------------------------------------
foreach ($_POST as $key => $value) {
    if (!in_array($key, ALLOWED_FIELDS, true)) {
        respond(400, false, ['error' => 'unexpected_field']);
    }
    if (!is_scalar($value)) {
        respond(400, false, ['error' => 'invalid_field_type']);
    }
}

// ------------------------------------------------------------
// Rate limiting — minimal, pseudonymous, file-based (no database
// needed; safe for shared hosting). Keyed by a salted hash of the
// client IP, never the raw IP, and pruned on every run so storage
// never grows unbounded.
// ------------------------------------------------------------
function rateLimitDir() {
    // Prefer a directory outside the web root (one level above
    // public_html) when it exists and is writable.
    $outside = dirname(__DIR__, 2) . '/sensum-rl-data';
    if (is_dir($outside) && is_writable($outside)) {
        return $outside;
    }
    // Fallback: inside the web root, but access-denied via .htaccess.
    $fallback = __DIR__ . '/.rl-data';
    if (!is_dir($fallback)) {
        @mkdir($fallback, 0700, true);
    }
    $denyFile = $fallback . '/.htaccess';
    if (is_dir($fallback) && !file_exists($denyFile)) {
        @file_put_contents($denyFile, "Require all denied\n");
    }
    return is_dir($fallback) ? $fallback : sys_get_temp_dir();
}

function clientHash() {
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    // Not a cryptographic secret — just avoids storing raw IPs at rest.
    return hash('sha256', 'sensum-rl|' . $ip);
}

/** Returns true if this client is currently rate-limited. */
function isRateLimited() {
    $dir = rateLimitDir();
    $file = $dir . '/' . clientHash() . '.json';
    $now = time();

    // Cheap opportunistic cleanup of stale files (no cron required).
    if (mt_rand(1, 50) === 1) {
        foreach (glob($dir . '/*.json') ?: [] as $old) {
            if ($now - (@filemtime($old) ?: 0) > 86400) {
                @unlink($old);
            }
        }
    }

    $timestamps = [];
    if (is_file($file)) {
        $raw = @file_get_contents($file);
        $decoded = $raw ? json_decode($raw, true) : null;
        if (is_array($decoded)) {
            $timestamps = $decoded;
        }
    }
    $timestamps = array_values(array_filter($timestamps, function ($ts) use ($now) {
        return is_int($ts) && ($now - $ts) < RATE_LIMIT_WINDOW_S;
    }));

    if (count($timestamps) >= RATE_LIMIT_MAX) {
        return true;
    }

    $timestamps[] = $now;
    @file_put_contents($file, json_encode($timestamps));
    return false;
}

if (isRateLimited()) {
    respond(429, false, ['error' => 'rate_limited']);
}

// ------------------------------------------------------------
// Field extraction, normalization, length limits, validation
// ------------------------------------------------------------
function field($name) {
    if (!isset($_POST[$name])) {
        return '';
    }
    $value = (string) $_POST[$name];
    // Strip control characters (except tab/newline, which are then
    // themselves normalized to spaces below) — defends against header
    // injection and other control-character abuse.
    $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value) ?? '';
    // Normalize all whitespace (including newlines/tabs) to single spaces,
    // then trim. The one exception is the message body, handled separately
    // below so paragraph breaks survive.
    $value = trim(preg_replace('/\s+/u', ' ', $value) ?? '');
    return $value;
}

function fieldMultiline($name) {
    if (!isset($_POST[$name])) {
        return '';
    }
    $value = (string) $_POST[$name];
    $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value) ?? '';
    // Collapse runs of whitespace within a line, but keep line breaks;
    // normalize all line-break styles to \n first.
    $value = str_replace(["\r\n", "\r"], "\n", $value);
    $lines = array_map(function ($line) {
        return trim(preg_replace('/[ \t]+/u', ' ', $line) ?? '');
    }, explode("\n", $value));
    return trim(implode("\n", $lines));
}

function cleanHeaderValue($value) {
    // Defense in depth against header injection, even though nothing
    // above should let \r or \n survive into these values.
    return preg_replace('/[\r\n]+/', ' ', $value);
}

function utf8Len($s) {
    return mb_strlen($s, 'UTF-8');
}

// Honeypot: real users never see or fill this field. If it has a value,
// silently pretend success so bots don't learn the check exists.
$honeypot = field('website');
if ($honeypot !== '' && utf8Len($honeypot) <= 200) {
    respond(200, true);
}

// Minimum-completion-time signal, paired with the honeypot above. A
// missing/invalid value is treated the same as "submitted too fast" —
// both are silently accepted as a fake success so real bots aren't
// tipped off to which check caught them, and no legitimate no-JS
// visitor is ever blocked by it (loaded_at is best-effort only).
$loadedAtRaw = $_POST['loaded_at'] ?? '';
if ($loadedAtRaw !== '' && ctype_digit((string) $loadedAtRaw)) {
    $elapsedMs = (microtime(true) * 1000) - (float) $loadedAtRaw;
    if ($elapsedMs < MIN_COMPLETION_MS) {
        respond(200, true);
    }
}

$name    = field('name');
$phone   = field('phone');
$email   = field('email');
$service = field('service');
$message = fieldMultiline('message');

$errors = [];

if (utf8Len($name) < 2 || utf8Len($name) > 120) {
    $errors[] = 'name';
}

if (!preg_match('/^[0-9+\-\s()]{8,30}$/u', $phone)) {
    $errors[] = 'phone';
}

if (utf8Len($email) > 180 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    $errors[] = 'email';
}

if (!in_array($service, ALLOWED_SERVICES, true)) {
    $errors[] = 'service';
}

if (utf8Len($message) < 10 || utf8Len($message) > 4000) {
    $errors[] = 'message';
}

if (!empty($errors)) {
    respond(422, false, ['error' => 'validation', 'fields' => $errors]);
}

$name  = cleanHeaderValue($name);
$email = cleanHeaderValue($email);

$subject = '=?UTF-8?B?' . base64_encode('Nuevo contacto desde ' . SITE_NAME . ': ' . $name) . '?=';

$body = "Nuevo mensaje desde el formulario de contacto de " . SITE_NAME . "\n\n"
    . "Nombre: $name\n"
    . "Teléfono: $phone\n"
    . "Correo: $email\n"
    . "Servicio de interés: $service\n\n"
    . "Mensaje:\n$message\n";

// Reply-To is the only place the visitor's email appears in the sent
// message — the From/Sender domain is always the hardcoded, verified
// SENDER_DOMAIN, never anything derived from request input.
$headers = "From: " . SITE_NAME . " <" . FROM_EMAIL . ">\r\n"
    . "Reply-To: =?UTF-8?B?" . base64_encode($name) . "?= <$email>\r\n"
    . "MIME-Version: 1.0\r\n"
    . "Content-Type: text/plain; charset=UTF-8\r\n";

// ------------------------------------------------------------
// SMTP upgrade hook (optional). If a config file exists OUTSIDE the
// web root defining SMTP credentials, and a mail-sending function has
// been wired up there, use it; otherwise fall back to PHP's mail().
// This repo never contains real credentials — see DEPLOY.md for how
// to set this file up on the live server, and for the SPF/DKIM/DMARC
// records the sending domain needs either way.
// ------------------------------------------------------------
$sent = false;
$smtpConfigPath = dirname(__DIR__, 2) . '/sensum-mail-config.php';
if (is_file($smtpConfigPath)) {
    $smtpSend = null;
    include $smtpConfigPath; // expected to define a callable in $smtpSend
    if (is_callable($smtpSend)) {
        try {
            $sent = (bool) $smtpSend(TO_EMAIL, $subject, $body, FROM_EMAIL, SITE_NAME, $email, $name);
        } catch (\Throwable $e) {
            error_log('[sensum-contact] smtp_send_threw');
            $sent = false;
        }
    }
}
if (!$sent) {
    $sent = @mail(TO_EMAIL, $subject, $body, $headers);
}

if ($sent) {
    respond(200, true);
}

// Operational failure — log only that sending failed, never the
// message content or the visitor's personal data.
error_log('[sensum-contact] mail_send_failed');
respond(500, false, ['error' => 'send_failed']);
