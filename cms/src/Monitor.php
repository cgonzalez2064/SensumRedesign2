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
            'domain' => $this->app->domainHealth()->latest() ?: null,
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
        [$ms, $status] = $this->measureHome();
        $out[] = 'Home page: ' . ($ms !== null ? "HTTP {$status} in {$ms} ms" : 'not reachable from the server (not counted)');
        // Each run counts toward the monthly report's availability figure.
        $this->app->db()->run('INSERT INTO monitor_runs (created_at, ok, failed, response_ms, http_status) VALUES (?, ?, ?, ?, ?)', [time(), $failed ? 0 : 1, implode(',', $failed), $ms, $status]);
        if (random_int(1, 20) === 1) {
            $this->app->db()->run('DELETE FROM monitor_runs WHERE created_at < ?', [time() - 400 * 86400]);
        }

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
        $report = $this->app->siteReport();
        $until = $report->refreshCertificate();
        $out[] = 'HTTPS certificate: ' . ($until ? 'valid until ' . date('Y-m-d', $until) : 'not checked (needs a public https APP_URL)');
        $out[] = 'Google PageSpeed: ' . $this->app->pageSpeed()->refreshIfStale();
        try {
            $out[] = 'Off-site backup: ' . $this->app->offsiteBackup()->runIfDue();
        } catch (\Throwable $e) {
            $out[] = 'Off-site backup: failed';
        }
        try {
            $out[] = 'Domain and e-mail DNS: ' . $this->app->domainHealth()->refreshIfStale();
        } catch (\Throwable $e) {
            $this->app->logger()->warning('domain_check_failed', ['type' => get_class($e)]);
            $out[] = 'Domain and e-mail DNS: failed';
        }
        try {
            $out[] = 'Resolved tickets closed after ' . Tickets::AUTO_CLOSE_DAYS . ' days: ' . (new Tickets($this->app))->autoClose();
            $out[] = 'Leads past the retention period removed: ' . $this->app->leads()->purge();
            $this->app->analytics()->purge();
        } catch (\Throwable $e) {
            $this->app->logger()->warning('housekeeping_failed', ['type' => get_class($e)]);
            $out[] = 'Tickets / leads housekeeping: failed';
        }
        $out[] = 'Monthly report reminder: ' . ($report->maybeRemind() ? 'sent to the owner' : 'not needed');
        $this->app->settings()->set('monitor_last_run', (string) time());
        foreach ($this->app->watchdog()->run() as $line) {
            $out[] = 'Alert ' . $line;
        }
        return $out;
    }

    /**
     * Time to load the public home page (APP_URL), as the chart's response
     * time. Informational: some hostings cannot reach their own domain from
     * cron, so a failure here never counts as downtime.
     * @return array{0:int|null,1:int|null} [milliseconds, HTTP status]
     */
    private function measureHome(): array
    {
        $url = $this->app->config->appUrl() . '/';
        if (!function_exists('curl_init') || !preg_match('#^https?://#', $url)) {
            return [null, null];
        }
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 10,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | CURLPROTO_HTTP, CURLOPT_USERAGENT => 'SensumContentManager/1.0 (scheduled check)', CURLOPT_HTTPHEADER => ['Cache-Control: no-cache']]);
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $time = (float) curl_getinfo($ch, CURLINFO_TOTAL_TIME);
        return $body === false || $status === 0 ? [null, null] : [max(1, (int) round($time * 1000)), $status];
    }

    /**
     * Daily figures for the Monitoring charts, oldest first, in the site's time
     * zone: scheduled checks and availability, average response time, errors by
     * severity and (owner only) sign-ins.
     * @return array{days:list<array<string,mixed>>,from:string,to:string}
     */
    public function series(int $days, bool $security, ?int $now = null): array
    {
        $now ??= time();
        $start = (int) strtotime('today', $now) - ($days - 1) * 86400;
        $offset = (int) date('Z', $now); // fixed for Guatemala (no daylight saving)
        $db = $this->app->db();
        $out = [];
        for ($i = 0; $i < $days; $i++) {
            $d = date('Y-m-d', $start + $i * 86400 + 43200);
            $out[$d] = ['day' => $d, 'checks' => 0, 'ok' => 0, 'availability' => null, 'responseMs' => null, 'critical' => 0, 'error' => 0, 'warning' => 0] + ($security ? ['logins' => 0, 'loginsFailed' => 0] : []);
        }
        $dayOf = fn (string $col) => "date(({$col} + {$offset}), 'unixepoch')";
        foreach ($db->all('SELECT ' . $dayOf('created_at') . ' AS d, COUNT(*) AS n, SUM(ok) AS ok, AVG(response_ms) AS ms FROM monitor_runs WHERE created_at >= ? GROUP BY d', [$start]) as $r) {
            if (isset($out[$r['d']])) {
                $out[$r['d']]['checks'] = (int) $r['n'];
                $out[$r['d']]['ok'] = (int) $r['ok'];
                $out[$r['d']]['availability'] = (int) $r['n'] > 0 ? round(100 * (int) $r['ok'] / (int) $r['n'], 1) : null;
                $out[$r['d']]['responseMs'] = $r['ms'] !== null ? (int) round((float) $r['ms']) : null;
            }
        }
        foreach ($db->all('SELECT ' . $dayOf('created_at') . " AS d, severity, COUNT(*) AS n FROM error_log WHERE created_at >= ? GROUP BY d, severity", [$start]) as $r) {
            if (isset($out[$r['d']]) && in_array($r['severity'], ['critical', 'error', 'warning'], true)) {
                $out[$r['d']][$r['severity']] = (int) $r['n'];
            }
        }
        if ($security) {
            foreach ($db->all('SELECT ' . $dayOf('created_at') . " AS d, action, COUNT(*) AS n FROM activity_log WHERE created_at >= ? AND action IN ('login', 'login_failed', 'login_throttled') GROUP BY d, action", [$start]) as $r) {
                if (isset($out[$r['d']])) {
                    $out[$r['d']][$r['action'] === 'login' ? 'logins' : 'loginsFailed'] += (int) $r['n'];
                }
            }
        }
        return ['days' => array_values($out), 'from' => date('Y-m-d', $start), 'to' => date('Y-m-d', $now)];
    }

    /**
     * The summary version of Monitoring for the "monitor" access: is the site
     * working, availability, speed, error counts and key dates. No error
     * messages, settings or server details.
     */
    public function overview(?int $now = null): array
    {
        $now ??= time();
        $db = $this->app->db();
        $checks = Health::checks($this->app, false);
        $failing = array_keys(array_filter($checks, fn ($c) => !$c['ok'] && empty($c['optional'])));
        $runs30 = $db->one('SELECT COUNT(*) AS n, SUM(ok) AS ok FROM monitor_runs WHERE created_at > ?', [$now - 30 * 86400]);
        $sev = array_column($db->all('SELECT severity, COUNT(*) AS n FROM error_log WHERE created_at > ? GROUP BY severity', [$now - 7 * 86400]), 'n', 'severity');
        $backups = glob($this->app->storage('backups/db') . '/database-*.sqlite') ?: [];
        $tls = $this->app->settings()->getJson('tls_expiry');
        $dh = $this->app->domainHealth()->latest();
        $ob = $this->app->offsiteBackup()->settings();
        $psi = $this->app->pageSpeed()->latest();
        return [
            'status' => $failing ? 'degraded' : ((int) $db->value("SELECT COUNT(*) FROM error_log WHERE severity = 'critical' AND created_at > ?", [$now - 86400]) > 0 ? 'attention' : 'ok'),
            'failingChecks' => count($failing),
            'availability30' => (int) ($runs30['n'] ?? 0) > 0 ? round(100 * (int) $runs30['ok'] / (int) $runs30['n'], 2) : null,
            'checks30' => (int) ($runs30['n'] ?? 0),
            'responseMs7' => ($ms = $db->value('SELECT AVG(response_ms) FROM monitor_runs WHERE created_at > ? AND response_ms IS NOT NULL', [$now - 7 * 86400])) !== null ? (int) round((float) $ms) : null,
            'lastCheckAt' => ((int) $this->app->settings()->get('monitor_last_run', '0')) ?: null,
            'errors7' => ['critical' => (int) ($sev['critical'] ?? 0), 'error' => (int) ($sev['error'] ?? 0), 'warning' => (int) ($sev['warning'] ?? 0)],
            'inSync' => $this->siteInSync(),
            'lastPublishedAt' => ((int) $this->app->settings()->get('last_published_at', '0')) ?: null,
            'certificateUntil' => isset($tls['validTo']) ? (int) $tls['validTo'] : null,
            'domainUntil' => isset($dh['expiry']['validTo']) ? (int) $dh['expiry']['validTo'] : null,
            'emailDomainOk' => isset($dh['checkedAt']) ? !array_diff((array) ($dh['problems'] ?? []), ['expiry']) : null,
            'lastBackupAt' => $backups ? max(array_map('filemtime', $backups)) : null,
            'offsiteBackupAt' => !empty($ob['enabled']) && !empty($ob['lastSentAt']) && ($ob['lastStatus'] ?? '') !== 'failed' ? (int) $ob['lastSentAt'] : null,
            'pagespeedMobile' => isset($psi['mobile']['performance'], $psi['fetchedAt']) && $now - (int) $psi['fetchedAt'] < 45 * 86400 ? (int) $psi['mobile']['performance'] : null,
        ];
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
