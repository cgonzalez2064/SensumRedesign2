<?php
declare(strict_types=1);

namespace Sensum\Cms;

/**
 * Groups errors by fingerprint so the dashboard can show "recent errors"
 * without storing every occurrence. Messages are truncated and never
 * include request bodies, cookies or credentials.
 */
final class ErrorTracker
{
    public static function record(App $app, string $source, string $message, string $location = '', string $page = ''): void
    {
        try {
            $message = self::clean($message, 300);
            $location = self::clean($location, 200);
            $page = self::clean($page, 200);
            $fp = hash('sha256', $source . '|' . $message . '|' . $location);
            $now = time();
            $db = $app->db();
            $db->transaction(function () use ($db, $fp, $source, $message, $location, $page, $now) {
                $row = $db->one('SELECT id FROM error_events WHERE fingerprint = ?', [$fp]);
                if ($row) {
                    $db->run('UPDATE error_events SET count = count + 1, last_seen = ?, page = ? WHERE id = ?', [$now, $page, $row['id']]);
                } else {
                    $db->run(
                        'INSERT INTO error_events (fingerprint, source, message, location, page, count, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
                        [$fp, $source, $message, $location, $page, $now, $now]
                    );
                }
                // Keep the table small: drop groups not seen for 30 days.
                if (random_int(1, 20) === 1) {
                    $db->run('DELETE FROM error_events WHERE last_seen < ?', [$now - 30 * 86400]);
                }
            });
        } catch (\Throwable) {
            // Telemetry must never break the request that is reporting it.
        }
    }

    public static function clean(string $s, int $max): string
    {
        $s = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $s) ?? '';
        // Strip anything that looks like a token or e-mail before storing.
        $s = preg_replace('/[A-Za-z0-9_\-]{32,}/', '[…]', $s) ?? '';
        $s = preg_replace('/[^\s@]+@[^\s@]+\.[^\s@]+/', '[email]', $s) ?? '';
        return mb_substr(trim($s), 0, $max);
    }
}
