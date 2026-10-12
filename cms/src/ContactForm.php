<?php
declare(strict_types=1);

namespace Sensum\Cms;

/**
 * Delivery of the public contact form (assets/contact-handler.php) using the
 * owner's settings from the panel: recipients, sender, and either the
 * panel's SMTP account (recommended: authenticated, better deliverability)
 * or the hosting's mail().
 *
 * The handler validates and sanitizes the lead first; this class only
 * formats and sends it. Until the owner saves contact settings, deliver()
 * returns null and the handler keeps its built-in behaviour.
 */
final class ContactForm
{
    public function __construct(private App $app)
    {
    }

    /**
     * @param array{name:string,phone:string,email:string,service:string,message:string} $lead already validated
     * @param int|null $leadId the message as stored in "Prospectos" (linked from the e-mail)
     * @return bool|null null = not configured in the panel (use the handler's defaults)
     */
    public function deliver(array $lead, ?int $leadId = null): ?bool
    {
        $c = $this->app->mailSettings()->contact();
        if (!$c['configured']) {
            return null;
        }
        $ok = $this->send($this->message($lead, $c, $leadId), $c);
        if (!$ok) {
            $this->app->logger()->error('contact_form_failed', ['message' => 'Contact form e-mail could not be sent' . ($leadId ? ' (the message is saved in Prospectos #' . $leadId . ')' : ''), 'method' => $c['method']]);
        }
        return $ok;
    }

    /** @param array{to:list<string>,fromAddress:string,fromName:string,method:string} $c */
    public function message(array $lead, array $c, ?int $leadId = null): array
    {
        $e = fn (string $v) => Emails::esc($v);
        $subject = 'Nuevo contacto desde Sensum Construcciones: ' . Mailer::oneLine($lead['name'], 80);
        $text = "Nuevo mensaje desde el formulario de contacto de Sensum Construcciones\n\n"
            . "Nombre: {$lead['name']}\nTeléfono: {$lead['phone']}\nCorreo: {$lead['email']}\nServicio de interés: {$lead['service']}\n\nMensaje:\n{$lead['message']}\n";
        $first = explode(' ', trim($lead['name']))[0] ?: $lead['name'];
        $reply = 'mailto:' . rawurlencode($lead['email']) . '?subject=' . rawurlencode('Re: su consulta a Sensum Construcciones');
        $detail = fn (string $label, string $html) => '<td valign="top" width="50%" style="padding:10px 12px;background:#f7f7f9;border-radius:10px">'
            . '<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#7a7a82">' . $e($label) . '</div>'
            . '<div style="font-size:14px;color:#1f2328;margin-top:2px;word-break:break-word">' . $html . '</div></td>';
        $tel = preg_replace('/[^0-9+]/', '', $lead['phone']) ?? '';
        $body = '<div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#f6740a">Nuevo contacto desde el sitio web</div>'
            . '<h1 style="margin:8px 0 4px;font-size:22px;line-height:1.3;color:#1c1c1c">' . $e($lead['name']) . '</h1>'
            . '<div style="font-size:14px;color:#7a7a82">Interesado en: <strong style="color:#1f2328">' . $e($lead['service']) . '</strong></div>'
            . '<div style="margin:20px 0 0;padding:16px 18px;background:#fff8f1;border-left:4px solid #f6740a;border-radius:0 12px 12px 0;white-space:pre-wrap;font-size:15px;color:#1f2328">' . $e($lead['message']) . '</div>'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:18px -6px 0"><tr>'
            . $detail('Correo', '<a href="mailto:' . $e($lead['email']) . '" style="color:#c25500;text-decoration:none">' . $e($lead['email']) . '</a>')
            . $detail('Teléfono', $tel !== '' ? '<a href="tel:' . $e($tel) . '" style="color:#c25500;text-decoration:none">' . $e($lead['phone']) . '</a>' : '—')
            . '</tr></table>'
            . Emails::cta('Responder a ' . $first, $reply)
            . ($leadId ? '<p style="margin:16px 0 0;font-size:13px;color:#7a7a82">También quedó guardado en el panel, donde puedes anotar el seguimiento: '
                . '<a href="' . $e($this->app->config->adminUrl() . '/#/prospectos/' . $leadId) . '" style="color:#c25500">Prospecto #' . $leadId . '</a></p>' : '');
        $layout = (new Emails($this->app))->branded('es', 'Formulario de contacto', $lead['service'] . ' — ' . mb_substr($lead['message'], 0, 90), $body,
            'Mensaje enviado desde el formulario de contacto de sensumconstrucciones.com. Responde a este correo para escribirle directamente a ' . $e($lead['name']) . '.');
        return [
            'to' => $c['to'],
            'from' => [$c['fromAddress'], $c['fromName']],
            'subject' => $subject,
            'text' => $text,
            'html' => $layout['html'],
            'replyTo' => [$lead['email'], $lead['name']],
            'embedded' => $layout['embedded'],
        ];
    }

    /**
     * Cloudflare Turnstile check for the contact form.
     * @return bool|null null = not configured, or Cloudflare unreachable (the
     *                   built-in captcha has already passed); false = rejected
     */
    public function verifyTurnstile(string $token, string $ip): ?bool
    {
        $ts = $this->app->mailSettings()->turnstile();
        if ($ts['siteKey'] === '' || $ts['secret'] === '') {
            return null;
        }
        if ($token === '' || strlen($token) > 2048) {
            return false;
        }
        $url = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
        $override = $this->app->config->string('TURNSTILE_VERIFY_URL');
        if ($override !== '' && !$this->app->config->isProduction()) {
            $url = $override; // automated tests only
        }
        $body = http_build_query(['secret' => $ts['secret'], 'response' => $token, 'remoteip' => $ip, 'idempotency_key' => bin2hex(random_bytes(16))]);
        $response = false;
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_CONNECTTIMEOUT => 4,
                CURLOPT_TIMEOUT => 8, CURLOPT_FOLLOWLOCATION => false, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
                CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded', 'Accept: application/json']]);
            $response = curl_exec($ch);
        } else {
            $response = @file_get_contents($url, false, stream_context_create(['http' => ['method' => 'POST', 'timeout' => 8, 'content' => $body,
                'header' => "Content-Type: application/x-www-form-urlencoded\r\nAccept: application/json"]]));
        }
        $data = is_string($response) ? json_decode($response, true) : null;
        if (!is_array($data) || !array_key_exists('success', $data)) {
            $this->app->logger()->warning('turnstile_unreachable', ['message' => 'Cloudflare Turnstile could not be reached; the built-in captcha was used']);
            return null;
        }
        if ($data['success'] !== true) {
            $codes = array_values(array_filter((array) ($data['error-codes'] ?? []), 'is_string'));
            if (array_intersect($codes, ['missing-input-secret', 'invalid-input-secret'])) {
                // Our configuration is wrong, not the visitor: tell the owner, keep the form working.
                $this->app->logger()->error('turnstile_misconfigured', ['message' => 'Cloudflare Turnstile rejected the secret key (check Administración → Correo)']);
                return null;
            }
            return false;
        }
        $host = is_string($data['hostname'] ?? null) ? strtolower($data['hostname']) : '';
        $allowed = array_map(fn ($o) => strtolower((string) parse_url($o, PHP_URL_HOST)), $this->app->config->allowedOrigins());
        if ($host !== '' && !in_array($host, $allowed, true) && !in_array($host, ['sensumconstrucciones.com', 'www.sensumconstrucciones.com'], true)) {
            return false; // a token solved on another site
        }
        return true;
    }

    /**
     * Daily counts of contact-form messages sent and spam blocked (captcha,
     * honeypot, too fast), for the weekly summary. One small settings row,
     * last 60 days only, so a spam wave cannot grow the database.
     */
    public function count(string $what): void
    {
        if (!in_array($what, ['sent', 'blocked'], true)) {
            return;
        }
        try {
            $this->app->db()->transaction(function () use ($what) {
                $stats = $this->app->settings()->getJson('contact_stats');
                $day = date('Y-m-d');
                $stats[$day][$what] = (int) ($stats[$day][$what] ?? 0) + 1;
                $cut = date('Y-m-d', time() - 60 * 86400);
                $stats = array_filter($stats, fn ($k) => is_string($k) && $k >= $cut, ARRAY_FILTER_USE_KEY);
                $this->app->settings()->setJson('contact_stats', $stats);
            });
        } catch (\Throwable) {
            // statistics only
        }
    }

    /** @return array{sent:int,blocked:int} totals since $since (Unix time) */
    public function stats(int $since): array
    {
        $from = date('Y-m-d', $since);
        $out = ['sent' => 0, 'blocked' => 0];
        foreach ($this->app->settings()->getJson('contact_stats') as $day => $c) {
            if (is_string($day) && $day >= $from && is_array($c)) {
                $out['sent'] += (int) ($c['sent'] ?? 0);
                $out['blocked'] += (int) ($c['blocked'] ?? 0);
            }
        }
        return $out;
    }

    /** Sends with the panel's SMTP account or the hosting's mail(), as configured. */
    public function send(array $mail, array $c): bool
    {
        return $c['method'] === 'smtp' ? $this->app->mailer()->send($mail) : $this->viaHostingMail($mail, $c);
    }

    /** The hosting's mail() (no SMTP login). Plain text, the visitor in Reply-To. */
    private function viaHostingMail(array $mail, array $c): bool
    {
        $from = Mailer::oneLine($c['fromAddress'], 120);
        if (!filter_var($from, FILTER_VALIDATE_EMAIL)) {
            return false;
        }
        $headers = 'From: =?UTF-8?B?' . base64_encode(Mailer::oneLine($c['fromName'], 80)) . "?= <{$from}>\r\n"
            . 'Reply-To: =?UTF-8?B?' . base64_encode(Mailer::oneLine($mail['replyTo'][1], 80)) . '?= <' . Mailer::oneLine($mail['replyTo'][0], 180) . ">\r\n"
            . "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n";
        $subject = '=?UTF-8?B?' . base64_encode(Mailer::oneLine($mail['subject'], 150)) . '?=';
        // Envelope sender only for plain addresses (mail() passes it to sendmail).
        $params = preg_match('/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/', $from) ? '-f' . $from : '';
        return @mail(implode(', ', $c['to']), $subject, $mail['text'], $headers, $params);
    }
}
