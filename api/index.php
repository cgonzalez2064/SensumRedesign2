<?php
/**
 * Sensum Content Manager — public API entry point (/api/*).
 * All application code lives in the private cms folder, which in production
 * sits OUTSIDE public_html. It is located in this order:
 *   1. SENSUM_CMS_DIR environment variable (e.g. SetEnv in .htaccess)
 *   2. ../../sensum-cms   (i.e. /home/<user>/sensum-cms next to public_html)
 *   3. ../cms             (local development checkout)
 */
declare(strict_types=1);

ini_set('display_errors', '0');
header_remove('X-Powered-By');

$cmsDir = (static function (): string {
    foreach ([(string) getenv('SENSUM_CMS_DIR'), dirname(__DIR__, 2) . '/sensum-cms', dirname(__DIR__) . '/cms'] as $dir) {
        if ($dir !== '' && is_file($dir . '/bootstrap.php')) {
            return $dir;
        }
    }
    return '';
})();

$unavailable = static function (): never {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo '{"ok":false,"error":"service_unavailable"}';
    exit;
};

if ($cmsDir === '') {
    error_log('[sensum-cms] application folder not found');
    $unavailable();
}
try {
    $app = require $cmsDir . '/bootstrap.php';
} catch (Throwable $e) {
    error_log('[sensum-cms] bootstrap failed: ' . get_class($e));
    $unavailable();
}

(new Sensum\Cms\Api\Kernel($app))->handle(Sensum\Cms\Http\Request::fromGlobals());
