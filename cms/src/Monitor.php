<?php
declare(strict_types=1);

namespace Sensum\Cms;

/**
 * Monitoring for the owner: system status, activity and error counts, the
 * error log, and the scheduled check (`bin/console monitor`, run by cron)
 * that finds problems even when nobody is using the site.
 */
final class Monitor
{
    public function __construct(private App $app)
    {
    }

    /**
     * Records a critical "health_degraded" entry (and so an alert) when a
     * required check fails. At most one entry per 15 minutes for the same
     * failure, so an uptime monitor polling /api/health cannot flood the log.
     */
    public function reportHealth(array $checks): void
    {
        $failed = array_keys(array_filter($checks, fn ($c) => !$c['ok'] && empty($c['optional'])));
        if (!$failed) {
            return;
        }
        $message = 'Failed checks: ' . implode(', ', $failed);
        if (!$this->recentlyLogged('health_degraded', $message, 900)) {
            $this->app->logger()->critical('health_degraded', ['message' => $message]);
        }
    }

    /** Whether the live pages match what the Content Manager would publish now. */
    public function siteInSync(): bool
    {
        try {
            foreach ($this->app->publisher()->render() as $name => $html) {
                $file = $this->app->publicPath($name);
                if (!is_file($file) || hash_file('sha256', $file) !== hash('sha256', $html)) {
                    return false;
                }
            }
            return true;
        } catch (\Throwable $e) {
            $this->app->logger()->error('dashboard_render_failed', ['type' => get_class($e)]);
            return false;
        }
    }

    public function summary(): array
    {
        $db = $this->app->db();
        $now = time();
        $counts = [];
        foreach (['24h' => 86400, '7d' => 7 * 86400, '30d' => 30 * 86400] as $label => $span) {
            $since = $now - $span;
            $sev = array_column($db->all('SELECT severity, COUNT(*) AS n FROM error_log WHERE created_at > ? GROUP BY severity', [$since]), 'n', 'severity');
            $act = array_column($db->all(
                "SELECT action, COUNT(*) AS n FROM activity_log WHERE created_at > ? AND action IN ('login','login_failed','login_throttled','content_updated','media_uploaded','report_submitted','report_email_failed') GROUP BY action",
                [$since]
            ), 'n', 'action');
            $counts[$label] = [
                'critical' => (int) ($sev['critical'] ?? 0),
                'error' => (int) ($sev['error'] ?? 0),
                'warning' => (int) ($sev['warning'] ?? 0),
                'alertsSent' => (int) $db->value("SELECT COUNT(*) FROM error_log WHERE alert = 'sent' AND created_at > ?", [$since]),
                'emailsFailed' => (int) $db->value("SELECT COUNT(*) FROM error_log WHERE event = 'mail_failed' AND created_at > ?", [$since]),
                'logins' => (int) ($act['login'] ?? 0),
                'loginsFailed' => (int) ($act['login_failed'] ?? 0) + (int) ($act['login_throttled'] ?? 0),
                'contentChanges' => (int) ($act['content_updated'] ?? 0),
                'uploads' => (int) ($act['media_uploaded'] ?? 0),
                'reports' => (int) ($act['report_submitted'] ?? 0),
                'reportsFailed' => (int) ($act['report_email_failed'] ?? 0),
            ];
        }

        $alerts = $this->app->alerts();
        $storage = $this->app->storage();
        $backups = glob($this->app->storage('backups/db') . '/database-*.sqlite') ?: [];
        $lastBackup = $backups ? max(array_map('filemtime', $backups)) : null;
        [$uploadFiles, $uploadBytes] = self::folderSize($this->app->publicPath('assets/uploads'));
        $disk = @disk_free_space($storage);

        $checks = Health::checks($this->app, true);
        return [
            'health' => ['status' => Health::summary($checks), 'checks' => $checks],
            'system' => [
                'version' => $this->app->version(),
                'php' => PHP_VERSION,
                'production' => $this->app->config->isProduction(),
                'siteUrl' => $this->app->config->appUrl(),
                'inSync' => $this->siteInSync(),
                'lastPublishedAt' => ((int) $this->app->settings()->get('last_published_at', '0')) ?: null,
                'databaseBytes' => (int) @filesize($this->app->storage('database.sqlite')),
                'diskFreeBytes' => $disk === false ? null : (int) $disk,
                'uploadsFiles' => $uploadFiles,
                'uploadsBytes' => $uploadBytes,
                'lastBackupAt' => $lastBackup ?: null,
                'lastCheckAt' => ((int) $this->app->settings()->get('monitor_last_run', '0')) ?: null,
            ],
            'alerts' => [
                'enabled' => $alerts->enabled(),
                'recipient' => $alerts->recipient(),
                'cooldownMinutes' => $alerts->cooldownMinutes(),
                'dailyMax' => $alerts->dailyMax(),
                'lastSentAt' => ((int) $db->value("SELECT MAX(created_at) FROM error_log WHERE alert = 'sent'")) ?: null,
            ],
            'counts' => $counts,
            'top' => array_map(fn ($r) => [
                'event' => $r['event'], 'severity' => $r['severity'], 'source' => $r['source'], 'message' => $r['message'],
                'location' => $r['location'], 'count' => (int) $r['n'], 'lastSeen' => (int) $r['last'],
            ], $db->all(
                'SELECT event, severity, source, message, location, COUNT(*) AS n, MAX(created_at) AS last FROM error_log
                  WHERE created_at > ? GROUP BY fingerprint ORDER BY n DESC, last DESC LIMIT 5',
                [$now - 7 * 86400]
            )),
        ];
    }

    /**
     * @param array{severity?:string,source?:string,days?:int,q?:string,page?:int} $f
     * @return array{items:list<array>,total:int,page:int,pages:int}
     */
    public function errors(array $f): array
    {
        $where = ['1 = 1'];
        $params = [];
        if (in_array($f['severity'] ?? '', ErrorLog::SEVERITIES, true)) {
            $where[] = 'e.severity = ?';
            $params[] = $f['severity'];
        }
        if (in_array($f['source'] ?? '', ErrorLog::SOURCES, true)) {
            $where[] = 'e.source = ?';
            $params[] = $f['source'];
        }
        if (($f['days'] ?? 0) > 0) {
            $where[] = 'e.created_at > ?';
            $params[] = time() - (int) $f['days'] * 86400;
        }
        $q = trim((string) ($f['q'] ?? ''));
        if ($q !== '') {
            $where[] = "(e.message LIKE ? ESCAPE '\\' OR e.event LIKE ? ESCAPE '\\' OR e.location LIKE ? ESCAPE '\\' OR e.request LIKE ? ESCAPE '\\' OR e.ref = ?)";
            $like = '%' . addcslashes($q, '%_\\') . '%';
            array_push($params, $like, $like, $like, $like, strtoupper($q));
        }
        $sqlWhere = implode(' AND ', $where);
        $total = (int) $this->app->db()->value("SELECT COUNT(*) FROM error_log e WHERE {$sqlWhere}", $params);
        $per = 25;
        $pages = max(1, (int) ceil($total / $per));
        $page = min(max(1, (int) ($f['page'] ?? 1)), $pages);
        $rows = $this->app->db()->all(
            "SELECT e.*, u.name AS user_name FROM error_log e LEFT JOIN users u ON u.id = e.user_id
              WHERE {$sqlWhere} ORDER BY e.created_at DESC, e.id DESC LIMIT {$per} OFFSET " . (($page - 1) * $per),
            $params
        );
        return [
            'items' => array_map(fn ($r) => [
                'id' => (int) $r['id'], 'at' => (int) $r['created_at'], 'severity' => $r['severity'], 'source' => $r['source'],
                'event' => $r['event'], 'message' => $r['message'], 'location' => $r['location'], 'request' => $r['request'],
                'ref' => $r['ref'], 'user' => $r['user_name'], 'alert' => $r['alert'],
                'details' => json_decode((string) $r['details'], true) ?: new \stdClass(),
            ], $rows),
            'total' => $total,
            'page' => $page,
            'pages' => $pages,
        ];
    }

    /**
     * The scheduled check (cron, e.g. every 15 minutes). Returns lines describing what it did.
     * @return list<string>
     */
    public function run(): array
    {
        $out = [];
        $checks = Health::checks($this->app, true);
        $this->reportHealth($checks);
        $failed = array_keys(array_filter($checks, fn ($c) => !$c['ok'] && empty($c['optional'])));
        $out[] = $failed ? 'Health: DEGRADED (' . implode(', ', $failed) . ')' : 'Health: ok';

        $minFree = $this->app->config->int('DISK_WARN_MB', 500, 10, 1_000_000) * 1024 * 1024;
        $free = @disk_free_space($this->app->storage());
        if ($free !== false && $free < $minFree && !$this->recentlyLogged('disk_space_low', '', 86400)) {
            $this->app->logger()->warning('disk_space_low', ['message' => 'Free disk space: ' . round($free / 1048576) . ' MB']);
        }
        $out[] = 'Disk free: ' . ($free === false ? 'unknown' : round($free / 1048576) . ' MB');

        $inSync = $this->siteInSync();
        if (!$inSync && !$this->recentlyLogged('publish_drift_detected', 'Live pages differ from the saved content', 86400)) {
            $this->app->logger()->warning('publish_drift_detected', ['message' => 'Live pages differ from the saved content']);
        }
        $out[] = 'Published pages: ' . ($inSync ? 'in sync' : 'DIFFERENT from saved content');

        $reports = new Reports($this->app);
        $delivered = 0;
        foreach ($this->app->db()->all("SELECT id FROM support_reports WHERE email_status <> 'sent' AND created_at > ?", [time() - 7 * 86400]) as $r) {
            $delivered += $reports->deliver((int) $r['id']) ? 1 : 0;
        }
        $out[] = "Pending support reports delivered: {$delivered}";
        $out[] = 'Failed alerts re-sent: ' . $this->app->alerts()->retryFailed();
        $out[] = 'Old error-log entries removed: ' . $this->app->errors()->prune();
        $this->app->settings()->set('monitor_last_run', (string) time());
        return $out;
    }

    private function recentlyLogged(string $event, string $message, int $seconds): bool
    {
        try {
            return (bool) $this->app->db()->value(
                'SELECT 1 FROM error_log WHERE event = ? AND (? = \'\' OR message = ?) AND created_at > ? LIMIT 1',
                [$event, $message, ErrorLog::clean($message, 500), time() - $seconds]
            );
        } catch (\Throwable) {
            return false;
        }
    }

    /** @return array{0:int,1:int} files, bytes */
    private static function folderSize(string $dir): array
    {
        $files = 0;
        $bytes = 0;
        foreach (glob(rtrim($dir, '/') . '/*') ?: [] as $f) {
            if (is_file($f) && !str_starts_with(basename($f), '.')) {
                $files++;
                $bytes += (int) filesize($f);
            }
        }
        return [$files, $bytes];
    }
}
