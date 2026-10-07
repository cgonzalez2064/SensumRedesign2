<?php
/**
 * LOCAL DEVELOPMENT ONLY — router for PHP's built-in web server.
 *
 *   php -S 127.0.0.1:8080 cms/dev/router.php        (run from the project root)
 *
 * Emulates what Apache + the .htaccess files do in production, so local
 * testing exercises the same rules: security headers (read from the real
 * .htaccess files, so they cannot drift), deny rules for private folders
 * and files, the upload-folder allow-list, /api routing and the 404 page.
 * This file is never deployed (the cms/ folder is not web-accessible).
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli-server') {
    http_response_code(404);
    exit;
}

$root = dirname(__DIR__, 2);
$path = '/' . ltrim(rawurldecode((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH)), '/');

/** "Header always set Name "value"" lines from an .htaccess file. */
$headersFrom = static function (string $file): array {
    $out = [];
    foreach (is_file($file) ? file($file) : [] as $line) {
        if (preg_match('/^\s*Header always set ([A-Za-z-]+) "(.*)"\s*$/', $line, $m) && strcasecmp($m[1], 'Strict-Transport-Security') !== 0) {
            // Local http: don't upgrade requests to https.
            $out[$m[1]] = trim(str_replace('upgrade-insecure-requests', '', $m[2]), '; ');
        }
    }
    return $out;
};
$headers = $headersFrom($root . '/.htaccess');
if (str_starts_with($path, '/admin')) {
    $headers = array_merge($headers, $headersFrom($root . '/admin/.htaccess'));
}
foreach ($headers as $name => $value) {
    header("{$name}: {$value}");
}

$deny = static function (): never {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Forbidden';
    exit;
};
$notFound = static function () use ($root): never {
    http_response_code(404);
    header('Content-Type: text/html; charset=utf-8');
    readfile($root . '/404.html');
    exit;
};

// Same deny rules as the root .htaccess (+ cms/.htaccess, api/.htaccess, uploads/.htaccess).
if (preg_match('#^/(cms|tests|tools|docs|dist|node_modules|_to_delete)(/|$)#', $path)
    || preg_match('#/\.#', $path)
    || preg_match('/\.(py|sh|log|md|bak|sql|ini|env|swp|orig|tpl)$/i', $path)
    || preg_match('#/(composer\.(json|lock)|package(-lock)?\.json|sensum-mail-config[^/]*\.php)$#', $path)) {
    $deny();
}
if (str_starts_with($path, '/assets/uploads/') && !preg_match('#^/assets/uploads/([a-z0-9-]+-w[0-9]+\.(webp|jpg)|[a-z0-9-]+\.pdf)$#', $path)) {
    $deny();
}

// API front controller.
if ($path === '/api' || str_starts_with($path, '/api/')) {
    $_SERVER['SCRIPT_NAME'] = '/api/index.php';
    $_SERVER['SCRIPT_FILENAME'] = $root . '/api/index.php';
    require $root . '/api/index.php';
    exit;
}

// The only other PHP script on the site.
if ($path === '/assets/contact-handler.php') {
    chdir($root . '/assets');
    require $root . '/assets/contact-handler.php';
    exit;
}

// Local publishing goes to an overlay folder (PUBLIC_DIR in cms/.env, e.g.
// storage/dev-public) so testing the admin never rewrites the committed
// index.html. Files published there take precedence over the repository copy.
require_once $root . '/cms/src/Config.php';
$publicDir = (new Sensum\Cms\Config($root . '/cms'))->get('PUBLIC_DIR');
$overlay = ($publicDir !== null && !str_starts_with($publicDir, '/')) ? $root . '/cms/' . $publicDir : $publicDir;
$candidate = $path === '/' ? '/index.html' : $path;
if ($overlay && is_file($overlay . $candidate) && realpath($overlay . $candidate) && str_starts_with((string) realpath($overlay . $candidate), (string) realpath($overlay) . '/')) {
    $file = $overlay . $candidate;
    $root = (string) realpath($overlay);
} else {
    $file = $root . $path;
}
if (is_dir($file)) {
    $file = rtrim($file, '/') . '/index.html';
    if (!str_ends_with($path, '/') && is_file($file)) {
        header('Location: ' . $path . '/', true, 301);
        exit;
    }
}
$real = realpath($file);
if ($real === false || !str_starts_with($real, $root . '/') || !is_file($real) || str_ends_with($real, '.php')) {
    $notFound();
}

$types = [
    'html' => 'text/html; charset=utf-8', 'css' => 'text/css; charset=utf-8', 'js' => 'text/javascript; charset=utf-8',
    'json' => 'application/json', 'webmanifest' => 'application/manifest+json', 'xml' => 'application/xml', 'txt' => 'text/plain; charset=utf-8',
    'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'webp' => 'image/webp', 'svg' => 'image/svg+xml',
    'ico' => 'image/x-icon', 'pdf' => 'application/pdf', 'woff2' => 'font/woff2',
];
$ext = strtolower(pathinfo($real, PATHINFO_EXTENSION));
header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
if (str_starts_with($path, '/assets/uploads/')) {
    header('X-Content-Type-Options: nosniff');
    if ($ext === 'pdf') {
        header('Content-Disposition: attachment');
        header('Content-Security-Policy: sandbox');
    }
}
header('Cache-Control: no-cache');
header('Content-Length: ' . filesize($real));
readfile($real);
