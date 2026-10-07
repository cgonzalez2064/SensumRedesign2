<?php
declare(strict_types=1);

namespace Sensum\Cms;

/**
 * Health checks. The public /api/health endpoint only reports ok/failed per
 * area; detailed information (versions, configuration) is available to
 * administrators on the dashboard and on the command line.
 */
final class Health
{
    /** @return array<string,array{ok:bool,detail?:string,optional?:bool}> */
    public static function checks(App $app, bool $detailed): array
    {
        $c = [];
        $c['php'] = ['ok' => PHP_VERSION_ID >= 80100, 'detail' => $detailed ? PHP_VERSION : ''];
        $missing = array_values(array_filter(['pdo_sqlite', 'gd', 'fileinfo', 'mbstring', 'json'], fn ($e) => !extension_loaded($e)));
        $c['extensions'] = ['ok' => !$missing, 'detail' => $missing ? 'missing: ' . implode(', ', $missing) : ''];

        try {
            $app->db()->value('SELECT 1');
            $pending = $app->db()->pendingMigrations($app->root('migrations'));
            $c['database'] = ['ok' => $pending === 0, 'detail' => $pending ? "{$pending} pending migration(s)" : ''];
        } catch (\Throwable) {
            $c['database'] = ['ok' => false, 'detail' => $detailed ? 'cannot open storage/database.sqlite' : ''];
        }

        $storage = $app->storage();
        $c['storage'] = ['ok' => is_dir($storage) && is_writable($storage)];
        $public = $app->publicPath();
        $c['publishing'] = ['ok' => is_writable($public) && (!is_file($public . '/index.html') || is_writable($public . '/index.html'))];
        $uploads = $app->publicPath('assets/uploads');
        $c['uploads'] = ['ok' => is_dir($uploads) ? is_writable($uploads) : is_writable($app->publicPath('assets'))];

        if ($detailed) {
            $c['mail'] = ['ok' => $app->mailer()->isConfigured(), 'optional' => true, 'detail' => 'driver: ' . $app->mailer()->driver()];
            $c['webp'] = ['ok' => function_exists('imagewebp'), 'optional' => true, 'detail' => function_exists('imagewebp') ? '' : 'photos will be saved as JPEG'];
            $c['exif'] = ['ok' => function_exists('exif_read_data'), 'optional' => true, 'detail' => function_exists('exif_read_data') ? '' : 'phone-photo rotation cannot be corrected automatically'];
            $inside = str_starts_with(realpath($app->root()) ?: $app->root(), (realpath($public) ?: $public) . '/');
            $c['private_folder'] = ['ok' => !$inside, 'optional' => true, 'detail' => $inside ? 'cms folder is inside the web root (protected by .htaccess; moving it outside is recommended)' : ''];
            $c['https'] = ['ok' => str_starts_with($app->config->appUrl(), 'https://'), 'optional' => !$app->config->isProduction(), 'detail' => $app->config->appUrl()];
            $c['upload_limit'] = ['ok' => $app->media()->maxUploadBytes() >= 8 * 1024 * 1024, 'optional' => true,
                'detail' => round($app->media()->maxUploadBytes() / 1048576, 1) . ' MB'];
        }
        return $c;
    }

    public static function summary(array $checks): string
    {
        foreach ($checks as $c) {
            if (!$c['ok'] && empty($c['optional'])) {
                return 'degraded';
            }
        }
        return 'ok';
    }
}
