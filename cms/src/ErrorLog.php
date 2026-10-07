<?php
declare(strict_types=1);

namespace Sensum\Cms;

/**
 * The error log: one row per error, kept ERROR_LOG_DAYS (default 180) and
 * shown only to the owner account. Server-side errors arrive through the
 * Logger (every error/warning it writes), browser errors through telemetry.
 * Critical errors are handed to Alerts, which e-mails IT.
 *
 * Messages are sanitized (no control characters, long tokens or e-mail
 * addresses) and never include request bodies, cookies or credentials.
 */
final class ErrorLog
{
    public const SEVERITIES = ['critical', 'error', 'warning'];
    public const SOURCES = ['server', 'admin', 'public', 'system'];

    /** Logged event => [severity, source]. Events not listed keep the log level. */
    private const EVENTS = [
        'unhandled_exception' => ['critical', 'server'],
        'php_fatal' => ['critical', 'server'],
        'health_degraded' => ['critical', 'system'],
        'backup_failed' => ['error', 'system'],
        'publish_drift_detected' => ['warning', 'system'],
        'disk_space_low' => ['warning', 'system'],
    ];

    /** Security events (failed sign-ins…) belong to the activity log, not here. */
    private const IGNORED = ['login_failed'];

    public function __construct(private App $app)
    {
    }

    /** Receives every error/warning written by the Logger (context already redacted). */
    public function fromLog(string $level, string $event, array $ctx): void
    {
        if (in_array($event, self::IGNORED, true)) {
            return;
        }
        [$severity, $source] = self::EVENTS[$event] ?? [$level === 'critical' ? 'critical' : ($level === 'warning' ? 'warning' : 'error'), 'server'];
        $message = (string) ($ctx['message'] ?? $ctx['reason'] ?? $ctx['kind'] ?? '');
        if (isset($ctx['type']) && is_string($ctx['type'])) {
            $message = $ctx['type'] . ($message !== '' ? ': ' . $message : '');
        }
        $request = isset($ctx['method'], $ctx['path']) ? $ctx['method'] . ' ' . $ctx['path'] : (string) ($ctx['request'] ?? '');
        $details = array_diff_key($ctx, array_flip(['message', 'type', 'at', 'method', 'path', 'request', 'ref', 'uid']));
        $this->record($severity, $source, $event, [
            'message' => $message,
            'location' => (string) ($ctx['at'] ?? ''),
            'request' => $request,
            'ref' => isset($ctx['ref']) ? (string) $ctx['ref'] : null,
            'userId' => isset($ctx['uid']) ? (int) $ctx['uid'] : null,
            'details' => $details,
        ]);
    }

    /**
     * @param array{message?:string,location?:string,request?:string,ref?:?string,userId?:?int,details?:array} $data
     */
    public function record(string $severity, string $source, string $event, array $data): ?int
    {
        $entry = [
            'created_at' => time(),
            'severity' => in_array($severity, self::SEVERITIES, true) ? $severity : 'error',
            'source' => in_array($source, self::SOURCES, true) ? $source : 'server',
            'event' => preg_replace('/[^a-z0-9_]/', '', strtolower($event)) ?: 'error',
            'message' => self::clean((string) ($data['message'] ?? ''), 500),
            'location' => self::clean((string) ($data['location'] ?? ''), 200),
            'request' => self::clean((string) ($data['request'] ?? ''), 200),
            'ref' => isset($data['ref']) ? self::clean((string) $data['ref'], 12) : null,
            'user_id' => $data['userId'] ?? null,
            'details' => self::encodeDetails($data['details'] ?? []),
        ];
        $entry['fingerprint'] = hash('sha256', $entry['source'] . '|' . $entry['event'] . '|' . $entry['message'] . '|' . $entry['location']);

        $id = null;
        try {
            $id = $this->app->db()->insert(
                'INSERT INTO error_log (created_at, severity, source, event, message, location, request, ref, user_id, fingerprint, details)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$entry['created_at'], $entry['severity'], $entry['source'], $entry['event'], $entry['message'], $entry['location'],
                 $entry['request'], $entry['ref'], $entry['user_id'], $entry['fingerprint'], $entry['details']]
            );
            if (random_int(1, 50) === 1) {
                $this->prune();
            }
        } catch (\Throwable) {
            // The database may be the problem; the file log still has the entry,
            // and a critical alert is sent anyway.
        }
        if ($entry['severity'] === 'critical') {
            $this->app->alerts()->queue($id, $entry);
        }
        return $id;
    }

    /** Deletes entries older than ERROR_LOG_DAYS (default 180); returns how many. */
    public function prune(): int
    {
        $days = $this->app->config->int('ERROR_LOG_DAYS', 180, 7, 3650);
        return $this->app->db()->run('DELETE FROM error_log WHERE created_at < ?', [time() - $days * 86400])->rowCount();
    }

    public function setAlert(?int $id, string $status): void
    {
        if ($id === null) {
            return;
        }
        try {
            $this->app->db()->run('UPDATE error_log SET alert = ? WHERE id = ?', [$status, $id]);
        } catch (\Throwable) {
            // see record()
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

    private static function encodeDetails(array $details): string
    {
        $clean = [];
        foreach (array_slice($details, 0, 12, true) as $k => $v) {
            $k = self::clean((string) $k, 40);
            $clean[$k] = is_scalar($v) || $v === null ? (is_string($v) ? self::clean($v, 300) : $v) : self::clean((string) json_encode($v, JSON_UNESCAPED_UNICODE), 300);
        }
        return (string) json_encode((object) $clean, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    }
}
