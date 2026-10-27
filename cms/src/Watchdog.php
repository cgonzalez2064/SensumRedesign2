<?php
declare(strict_types=1);

namespace Sensum\Cms;

/**
 * Automatic alerts — the things a web master and a security engineer want
 * to hear about without opening the panel. Each rule has a sensible period
 * and de-duplication so the inbox never floods; the owner can turn rules
 * on or off in Monitoreo → Alertas automáticas.
 *
 *   critical_errors  immediately (Alerts: server errors, fatal errors, failing health checks)
 *   integrity        each scheduled check — site files changed, executable files added,
 *                    unexpected files among the photos, published pages edited outside the panel
 *   login_attack     each scheduled check — many failed sign-ins in the last hour (max. every 6 h)
 *   new_device       at sign-in — to the person: sign-in from a browser/device not seen before
 *   certificate      daily — HTTPS certificate expires in 21, 7 and 1 day(s)
 *   backup           daily — newest database backup older than 48 h
 *   scheduler        when detected (health check / panel) — the scheduled check stopped (> 2 h)
 *   disk_space       daily — free disk space under DISK_WARN_MB
 *   error_spike      each scheduled check — unusual number of errors in an hour (max. every 6 h)
 *   weekly_digest    Mondays from 08:00 — technical summary of the week
 *   monthly_review   1st of the month from 08:00 — security and maintenance checklist
 *   report_reminder  after day 5 — the client report has not been sent (SiteReport)
 *   translation_quota every 6 h — the DeepL key has used TRANSLATE_ALERT_PERCENT (90 %) or all of
 *                    its characters: once per key and level, so there is time to change the key
 *   (always on)      e-mail settings changed — to the owner
 */
final class Watchdog
{
    public const RULES = ['critical_errors', 'integrity', 'login_attack', 'new_device', 'certificate', 'domain_expiry', 'email_dns', 'backup', 'offsite_backup', 'scheduler',
        'disk_space', 'error_spike', 'weekly_digest', 'monthly_review', 'report_reminder', 'translation_quota'];

    /** PHP security-support end dates (php.net/supported-versions). Update when new versions ship. */
    private const PHP_SUPPORT_UNTIL = ['8.1' => '2025-12-31', '8.2' => '2026-12-31', '8.3' => '2027-12-31', '8.4' => '2028-12-31', '8.5' => '2029-12-31'];
    private const RISKY_EXT = ['php', 'php3', 'php4', 'php5', 'php7', 'php8', 'phtml', 'phar', 'pht', 'phps', 'cgi', 'pl', 'py', 'sh', 'shtml', 'htaccess', 'ini'];
    private const GENERATED = ['index.html', '404.html', 'privacy-notice.html'];

    private ?array $state = null;
    /** @var list<array> e-mails to send after the response */
    private array $deferred = [];

    public function __construct(private App $app)
    {
    }

    // ------------------------------------------------------------------ settings

    /** @return array<string,bool> */
    public function rules(): array
    {
        $saved = $this->app->settings()->getJson('alert_rules');
        $out = [];
        foreach (self::RULES as $r) {
            $out[$r] = !array_key_exists($r, $saved) || (bool) $saved[$r];
        }
        return $out;
    }

    public function enabled(string $rule): bool
    {
        try {
            return $this->rules()[$rule] ?? true;
        } catch (\Throwable) {
            return true; // database unavailable: better to alert
        }
    }

    /** @param array<string,mixed> $rules */
    public function saveRules(array $rules): array
    {
        $current = $this->rules();
        foreach ($rules as $k => $v) {
            if (in_array($k, self::RULES, true) && is_bool($v)) {
                $current[$k] = $v;
            }
        }
        $this->app->settings()->setJson('alert_rules', $current);
        return $current;
    }

    /** @return array<string,int|null> last time each rule sent something */
    public function lastSent(): array
    {
        $sent = $this->state()['sent'] ?? [];
        $out = [];
        foreach (self::RULES as $r) {
            $out[$r] = isset($sent[$r]) ? (int) $sent[$r] : null;
        }
        $out['critical_errors'] = ((int) $this->app->db()->value("SELECT MAX(created_at) FROM error_log WHERE alert = 'sent'")) ?: null;
        $out['report_reminder'] = null;
        foreach ($this->app->db()->all("SELECT value FROM settings WHERE key LIKE 'report_reminder_%'") as $r) {
            $out['report_reminder'] = max((int) $out['report_reminder'], (int) $r['value']) ?: null;
        }
        return $out;
    }

    private function state(): array
    {
        return $this->state ??= $this->app->settings()->getJson('watchdog_state');
    }

    private function saveState(): void
    {
        $this->app->settings()->setJson('watchdog_state', (array) $this->state);
    }

    /** True if $rule may send now (not sent within $every seconds); records the send when $mark. */
    private function due(string $rule, int $every, int $now): bool
    {
        $last = (int) ($this->state()['sent'][$rule] ?? 0);
        return $now - $last >= $every;
    }

    private function mark(string $rule, int $now): void
    {
        $this->state();
        $this->state['sent'][$rule] = $now;
        $this->saveState();
    }

    // ------------------------------------------------------------------ scheduled check

    /** Runs the periodic rules. Called by `bin/console monitor`. @return list<string> */
    public function run(?int $now = null): array
    {
        $now ??= time();
        $out = [];
        foreach ([
            'integrity' => fn () => $this->checkIntegrity($now),
            'login_attack' => fn () => $this->checkLoginAttack($now),
            'certificate' => fn () => $this->checkCertificate($now),
            'domain_expiry' => fn () => $this->checkDomainExpiry($now),
            'offsite_backup' => fn () => $this->checkOffsite($now),
            'email_dns' => fn () => $this->checkEmailDns($now),
            'backup' => fn () => $this->checkBackup($now),
            'disk_space' => fn () => $this->checkDisk($now),
            'error_spike' => fn () => $this->checkErrorSpike($now),
            'weekly_digest' => fn () => $this->weeklyDigest($now),
            'monthly_review' => fn () => $this->monthlyReview($now),
            'translation_quota' => fn () => $this->checkTranslationQuota($now),
        ] as $rule => $check) {
            if (!$this->enabled($rule)) {
                $out[] = "{$rule}: off";
                continue;
            }
            try {
                $out[] = "{$rule}: " . $check();
            } catch (\Throwable $e) {
                $this->app->logger()->error('watchdog_failed', ['rule' => $rule, 'type' => get_class($e), 'message' => $e->getMessage()]);
                $out[] = "{$rule}: error";
            }
        }
        return $out;
    }

    /**
     * Automatic translation (DeepL): how much of the key's characters is used.
     * Asks DeepL at most every 6 hours; alerts once per key and level (the
     * configured percentage, then 100 %), so the key can be changed in time.
     * A new key, or usage going back down (a monthly plan renewing), starts over.
     */
    public function checkTranslationQuota(int $now, bool $force = false): string
    {
        $tr = $this->app->translator();
        if (!$tr->isEnabled()) {
            return 'no key';
        }
        $this->state();
        if (!$force && $now - (int) ($this->state['translation']['checkedAt'] ?? 0) < 6 * 3600) {
            return 'checked recently';
        }
        $this->state['translation']['checkedAt'] = $now;
        $this->saveState();
        try {
            $u = $tr->usage();
        } catch (\Throwable $e) {
            return 'unreachable';
        }
        if ($u['limit'] <= 0) {
            return 'no limit reported';
        }
        $alertAt = $this->app->config->int('TRANSLATE_ALERT_PERCENT', 90, 50, 99);
        $pct = (int) floor($u['used'] * 100 / $u['limit']);
        $key = substr(hash('sha256', $tr->currentKey()), 0, 12); // which key, never the key itself
        $level = $pct >= 100 ? 100 : ($pct >= $alertAt ? $alertAt : 0);
        $notified = (array) ($this->state['translation']['notified'][$key] ?? []);
        if ($level === 0) {
            if ($notified) { // the plan renewed or the usage was reset
                unset($this->state['translation']['notified'][$key]);
                $this->saveState();
            }
            return "{$pct}% used";
        }
        if (in_array($level, $notified, true)) {
            return "{$pct}% used, already notified";
        }
        $this->state['translation']['notified'][$key] = array_values(array_unique([...$notified, $level]));
        $this->saveState();
        $s = $this->strings();
        $full = $level === 100;
        $n = fn (int $v) => number_format($v, 0, '.', ',');
        $this->sendToOwner('translation_quota', [
            'subject' => self::fill($s[$full ? 'wd.tr.fullSubject' : 'wd.tr.subject'], ['pct' => $pct]),
            'title' => self::fill($s[$full ? 'wd.tr.fullTitle' : 'wd.tr.title'], ['used' => $n($u['used']), 'limit' => $n($u['limit'])]),
            'intro' => $s[$full ? 'wd.tr.fullIntro' : 'wd.tr.intro'],
            'facts' => [$s['wd.tr.used'] => $n($u['used']) . ' (' . $pct . ' %)', $s['wd.tr.limit'] => $n($u['limit']), $s['wd.tr.left'] => $n(max(0, $u['limit'] - $u['used'])),
                $s['wd.tr.plan'] => $tr->plan()],
            'action' => $s['wd.tr.action'], 'cta' => [$s['wd.cta.translation'], 'traduccion'], 'severity' => $full ? 'bad' : 'warn',
        ], $now);
        return "{$pct}% used, notified";
    }

    /** Files of the public site compared with the last release (or the last accepted state). */
    public function integrityFindings(): array
    {
        $root = rtrim($this->app->publicPath(), '/');
        $manifest = $this->manifest();
        $findings = [];
        $seen = 0;
        $uploads = $root . '/assets/uploads';
        if (is_dir($root)) {
            $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS));
            foreach ($it as $file) {
                if (!$file->isFile() || ++$seen > 20000) {
                    continue;
                }
                $path = substr($file->getPathname(), strlen($root) + 1);
                $name = $file->getFilename();
                $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
                $ext = $name === '.htaccess' ? 'htaccess' : ($name === '.user.ini' ? 'ini' : $ext);
                if (str_starts_with($file->getPathname(), $uploads . '/')) {
                    if ($name !== '.htaccess' && !preg_match('/^[a-z0-9-]+-w[0-9]+\.(webp|jpg)$|^[a-z0-9-]+\.pdf$/', $name)) {
                        $findings[] = ['type' => 'upload', 'path' => $path];
                    } elseif ($name === '.htaccess' && $manifest && isset($manifest[$path]) && self::fileHash($file->getPathname()) !== $manifest[$path]) {
                        $findings[] = ['type' => 'modified', 'path' => $path];
                    }
                    continue;
                }
                if (in_array($path, self::GENERATED, true)) {
                    continue; // checked below against the saved content
                }
                if (str_starts_with($path, 'assets/.rl-data/') && ($ext === 'json' || ($name === '.htaccess' && trim((string) file_get_contents($file->getPathname())) === 'Require all denied'))) {
                    continue; // the contact form's rate-limit data (created at run time)
                }
                if ($manifest !== null && isset($manifest[$path])) {
                    if (self::fileHash($file->getPathname()) !== $manifest[$path]) {
                        $findings[] = ['type' => 'modified', 'path' => $path];
                    }
                } elseif (in_array($ext, self::RISKY_EXT, true) && ($manifest !== null || $ext !== 'htaccess')) {
                    $findings[] = ['type' => 'new', 'path' => $path];
                }
            }
        }
        if ($manifest !== null) {
            foreach (array_keys($manifest) as $path) {
                if (!str_starts_with($path, 'assets/uploads/') && !is_file($root . '/' . $path)) {
                    $findings[] = ['type' => 'missing', 'path' => $path];
                }
            }
        }
        if (!$this->app->monitor()->siteInSync()) {
            $findings[] = ['type' => 'drift', 'path' => implode(', ', self::GENERATED)];
        }
        usort($findings, fn ($a, $b) => [$a['type'], $a['path']] <=> [$b['type'], $b['path']]);
        return $findings;
    }

    private function checkIntegrity(int $now): string
    {
        $this->app->maintenanceLog()->add('integrity', 1, $now);
        if ($this->manifest() === null) {
            // No release manifest (site uploaded without tools/build-release.sh): the
            // first check records the files as they are and later checks compare to it.
            return 'baseline recorded (' . $this->acceptIntegrity() . ' files)';
        }
        $findings = $this->integrityFindings();
        if (!$findings) {
            $this->state();
            unset($this->state['fp']['integrity']);
            $this->saveState();
            return 'ok';
        }
        $fp = hash('sha256', (string) json_encode($findings));
        $changed = ($this->state()['fp']['integrity'] ?? '') !== $fp;
        // New findings: alert now. Same findings: remind once a day.
        if (!$changed && !$this->due('integrity', 86400, $now)) {
            return count($findings) . ' finding(s), already notified';
        }
        $this->state();
        $this->state['fp']['integrity'] = $fp;
        $s = $this->strings();
        $items = array_map(fn ($f) => self::fill($s['wd.integrity.' . $f['type']], ['path' => $f['path']]), array_slice($findings, 0, 25));
        if (count($findings) > 25) {
            $items[] = self::fill($s['wd.more'], ['n' => count($findings) - 25]);
        }
        $this->sendToOwner('integrity', [
            'subject' => $s['wd.integrity.subject'], 'title' => $s['wd.integrity.title'], 'intro' => $s['wd.integrity.intro'],
            'items' => $items, 'action' => $s['wd.integrity.action'], 'cta' => [$s['wd.cta.monitor'], 'monitoreo'], 'severity' => 'bad',
        ], $now);
        return count($findings) . ' finding(s), notified';
    }

    private function checkLoginAttack(int $now): string
    {
        $since = $now - 3600;
        $failed = (int) $this->app->db()->value("SELECT COUNT(*) FROM activity_log WHERE action = 'login_failed' AND created_at > ?", [$since]);
        $blocked = (int) $this->app->db()->value("SELECT COUNT(*) FROM activity_log WHERE action = 'login_throttled' AND created_at > ?", [$since]);
        $ips = (int) $this->app->db()->value("SELECT COUNT(DISTINCT ip_hash) FROM activity_log WHERE action IN ('login_failed','login_throttled') AND created_at > ?", [$since]);
        $threshold = $this->app->config->int('ALERT_LOGIN_FAILURES', 10, 3, 1000);
        if ($failed + $blocked < $threshold) {
            return "{$failed} failed / {$blocked} blocked in the last hour";
        }
        if (!$this->due('login_attack', 6 * 3600, $now)) {
            return 'attack in progress, already notified';
        }
        $s = $this->strings();
        $this->sendToOwner('login_attack', [
            'subject' => $s['wd.login.subject'], 'title' => self::fill($s['wd.login.title'], ['n' => $failed + $blocked]), 'intro' => $s['wd.login.intro'],
            'facts' => [$s['wd.login.failed'] => (string) $failed, $s['wd.login.blocked'] => (string) $blocked, $s['wd.login.ips'] => (string) $ips],
            'action' => $s['wd.login.action'], 'cta' => [$s['wd.cta.monitor'], 'monitoreo'], 'severity' => 'bad',
        ], $now);
        return 'notified';
    }

    private function checkCertificate(int $now): string
    {
        $tls = $this->app->settings()->getJson('tls_expiry');
        $validTo = isset($tls['validTo']) ? (int) $tls['validTo'] : 0;
        if ($validTo <= 0) {
            return 'not checked';
        }
        $days = (int) floor(($validTo - $now) / 86400);
        $threshold = null;
        foreach ([1, 7, 21] as $t) {
            if ($days <= $t) {
                $threshold = $t;
                break;
            }
        }
        if ($threshold === null) {
            return "valid for {$days} days";
        }
        $key = $validTo . ':' . $threshold;
        if (in_array($key, (array) ($this->state()['cert'] ?? []), true)) {
            return "expires in {$days} day(s), already notified";
        }
        $this->state();
        $this->state['cert'][] = $key;
        $s = $this->strings();
        $this->sendToOwner('certificate', [
            'subject' => self::fill($s['wd.cert.subject'], ['days' => max(0, $days)]), 'title' => self::fill($s['wd.cert.title'], ['date' => date('Y-m-d', $validTo)]),
            'intro' => $s['wd.cert.intro'], 'action' => $s['wd.cert.action'], 'cta' => [$s['wd.cta.monitor'], 'monitoreo'], 'severity' => $days <= 7 ? 'bad' : 'warn',
        ], $now);
        return "expires in {$days} day(s), notified";
    }

    private function checkDomainExpiry(int $now): string
    {
        $h = $this->app->domainHealth()->latest();
        $validTo = (int) ($h['expiry']['validTo'] ?? 0);
        if ($validTo <= 0) {
            return 'not checked';
        }
        $days = (int) floor(($validTo - $now) / 86400);
        $threshold = null;
        foreach ([1, 7, 14, 30, 60] as $t) {
            if ($days <= $t) {
                $threshold = $t;
                break;
            }
        }
        if ($threshold === null) {
            return "valid for {$days} days";
        }
        $key = 'domain:' . $validTo . ':' . $threshold;
        if (in_array($key, (array) ($this->state()['cert'] ?? []), true)) {
            return "expires in {$days} day(s), already notified";
        }
        $this->state();
        $this->state['cert'][] = $key;
        $s = $this->strings();
        $this->sendToOwner('domain_expiry', [
            'subject' => self::fill($s['wd.domain.subject'], ['days' => max(0, $days), 'domain' => (string) $h['domain']]),
            'title' => self::fill($s['wd.domain.title'], ['date' => date('Y-m-d', $validTo), 'domain' => (string) $h['domain']]),
            'intro' => $s['wd.domain.intro'], 'action' => $s['wd.domain.action'], 'cta' => [$s['wd.cta.monitor'], 'monitoreo'], 'severity' => $days <= 14 ? 'bad' : 'warn',
        ], $now);
        return "expires in {$days} day(s), notified";
    }

    /** SPF/DKIM/DMARC/MX problems: alert when they appear or change, remind weekly. */
    private function checkEmailDns(int $now): string
    {
        $h = $this->app->domainHealth()->latest();
        if (!isset($h['checkedAt'])) {
            return 'not checked';
        }
        $issues = [];
        foreach (['spf', 'dkim', 'dmarc', 'mx'] as $k) {
            if (empty($h[$k]['ok'])) {
                $issues[$k] = (string) ($h[$k]['issue'] ?? 'missing');
            }
        }
        if (!$issues) {
            $this->state();
            unset($this->state['fp']['email_dns']);
            $this->saveState();
            return 'ok';
        }
        $fp = hash('sha256', (string) json_encode($issues));
        $changed = ($this->state()['fp']['email_dns'] ?? '') !== $fp;
        if (!$changed && !$this->due('email_dns', 7 * 86400, $now)) {
            return implode(', ', array_keys($issues)) . ', already notified';
        }
        $this->state();
        $this->state['fp']['email_dns'] = $fp;
        $s = $this->strings();
        $items = [];
        foreach ($issues as $k => $issue) {
            $items[] = $s['wd.dns.' . $k . '.' . $issue] ?? $s['wd.dns.' . $k . '.missing'];
        }
        $this->sendToOwner('email_dns', [
            'subject' => self::fill($s['wd.dns.subject'], ['domain' => (string) $h['domain']]), 'title' => $s['wd.dns.title'], 'intro' => $s['wd.dns.intro'],
            'items' => $items, 'action' => $s['wd.dns.action'], 'cta' => [$s['wd.cta.monitor'], 'monitoreo'], 'severity' => isset($issues['mx']) || isset($issues['spf']) ? 'bad' : 'warn',
        ], $now);
        return implode(', ', array_keys($issues)) . ', notified';
    }

    private function checkOffsite(int $now): string
    {
        $ob = $this->app->offsiteBackup();
        if (!$ob->overdue($now)) {
            return $ob->settings()['enabled'] ? 'ok' : 'off';
        }
        if (!$this->due('offsite_backup', 86400, $now)) {
            return 'overdue, already notified';
        }
        $cfg = $ob->settings();
        $s = $this->strings();
        $this->sendToOwner('offsite_backup', [
            'subject' => $s['wd.offsite.subject'],
            'title' => $cfg['lastSentAt'] ? self::fill($s['wd.offsite.title'], ['date' => date('Y-m-d', $cfg['lastSentAt'])]) : $s['wd.offsite.titleNever'],
            'intro' => $s['wd.offsite.intro'], 'action' => $s['wd.offsite.action'], 'cta' => [$s['wd.cta.security'], 'seguridad'], 'severity' => 'warn',
        ], $now);
        return 'overdue, notified';
    }

    private function checkBackup(int $now): string
    {
        $files = glob($this->app->storage('backups/db') . '/database-*.sqlite') ?: [];
        if (!$files) {
            return 'no backups yet (see monthly review)';
        }
        $newest = max(array_map('filemtime', $files));
        $hours = (int) floor(($now - $newest) / 3600);
        if ($hours < 48) {
            return "latest {$hours} h ago";
        }
        if (!$this->due('backup', 86400, $now)) {
            return "latest {$hours} h ago, already notified";
        }
        $s = $this->strings();
        $this->sendToOwner('backup', [
            'subject' => $s['wd.backup.subject'], 'title' => self::fill($s['wd.backup.title'], ['hours' => $hours]), 'intro' => $s['wd.backup.intro'],
            'action' => $s['wd.backup.action'], 'cta' => [$s['wd.cta.monitor'], 'monitoreo'], 'severity' => 'warn',
        ], $now);
        return "latest {$hours} h ago, notified";
    }

    private function checkDisk(int $now): string
    {
        $free = @disk_free_space($this->app->storage());
        $min = $this->app->config->int('DISK_WARN_MB', 500, 10, 1_000_000) * 1048576;
        if ($free === false || $free >= $min) {
            return $free === false ? 'unknown' : round($free / 1048576) . ' MB free';
        }
        if (!$this->due('disk_space', 86400, $now)) {
            return 'low, already notified';
        }
        $s = $this->strings();
        $this->sendToOwner('disk_space', [
            'subject' => $s['wd.disk.subject'], 'title' => self::fill($s['wd.disk.title'], ['mb' => (int) round($free / 1048576)]), 'intro' => $s['wd.disk.intro'],
            'action' => $s['wd.disk.action'], 'cta' => [$s['wd.cta.monitor'], 'monitoreo'], 'severity' => 'warn',
        ], $now);
        return 'low, notified';
    }

    private function checkErrorSpike(int $now): string
    {
        $threshold = $this->app->config->int('ALERT_ERROR_SPIKE', 25, 5, 10000);
        $n = (int) $this->app->db()->value("SELECT COUNT(*) FROM error_log WHERE severity <> 'critical' AND event <> 'login_failed' AND created_at > ?", [$now - 3600]);
        if ($n < $threshold) {
            return "{$n} error(s) in the last hour";
        }
        if (!$this->due('error_spike', 6 * 3600, $now)) {
            return 'spike, already notified';
        }
        $s = $this->strings();
        $top = $this->app->db()->all("SELECT event, message, COUNT(*) AS n FROM error_log WHERE severity <> 'critical' AND event <> 'login_failed' AND created_at > ? GROUP BY fingerprint ORDER BY n DESC LIMIT 5", [$now - 3600]);
        $this->sendToOwner('error_spike', [
            'subject' => $s['wd.spike.subject'], 'title' => self::fill($s['wd.spike.title'], ['n' => $n]), 'intro' => $s['wd.spike.intro'],
            'items' => array_map(fn ($r) => "{$r['n']} × {$r['event']}" . ($r['message'] !== '' ? ' — ' . mb_substr((string) $r['message'], 0, 120) : ''), $top),
            'action' => $s['wd.spike.action'], 'cta' => [$s['wd.cta.monitor'], 'monitoreo'], 'severity' => 'warn',
        ], $now);
        return "spike ({$n}), notified";
    }

    /** The site must have been in use for a week before digests start (no noise while setting up). */
    private function inUseForAWeek(int $now): bool
    {
        $first = $this->app->db()->value('SELECT MIN(created_at) FROM users');
        return $first !== null && (int) $first < $now - 7 * 86400;
    }

    public function weeklyDigest(int $now): string
    {
        $week = date('o-\WW', $now);
        if (($this->state()['week'] ?? '') === $week || ((int) date('N', $now) === 1 && (int) date('G', $now) < 8) || !$this->inUseForAWeek($now)) {
            return 'not due';
        }
        $db = $this->app->db();
        $since = $now - 7 * 86400;
        $runs = $db->one('SELECT COUNT(*) AS n, SUM(ok) AS ok FROM monitor_runs WHERE created_at > ?', [$since]);
        $sev = array_column($db->all('SELECT severity, COUNT(*) AS n FROM error_log WHERE created_at > ? GROUP BY severity', [$since]), 'n', 'severity');
        $act = array_column($db->all("SELECT action, COUNT(*) AS n FROM activity_log WHERE created_at > ? GROUP BY action", [$since]), 'n', 'action');
        $backups = glob($this->app->storage('backups/db') . '/database-*.sqlite') ?: [];
        $tls = $this->app->settings()->getJson('tls_expiry');
        $s = $this->strings();
        $lang = $this->ownerLang();
        $pct = (int) ($runs['n'] ?? 0) > 0 ? number_format(100 * (int) $runs['ok'] / (int) $runs['n'], 1, $lang === 'en' ? '.' : ',', '') . ' %' : $s['wd.none'];
        $report = $this->app->siteReport()->status($now);
        $facts = [
            $s['wd.week.availability'] => $pct . ((int) ($runs['n'] ?? 0) > 0 ? ' (' . (int) $runs['n'] . ' ' . $s['wd.week.checks'] . ')' : ''),
            $s['wd.week.critical'] => (string) (int) ($sev['critical'] ?? 0),
            $s['wd.week.errors'] => (string) ((int) ($sev['error'] ?? 0) + (int) ($sev['warning'] ?? 0)),
            $s['wd.week.logins'] => (int) ($act['login'] ?? 0) . ' / ' . ((int) ($act['login_failed'] ?? 0) + (int) ($act['login_throttled'] ?? 0)),
            $s['wd.week.content'] => (int) ($act['content_updated'] ?? 0) . ' / ' . (int) ($act['media_uploaded'] ?? 0),
            $s['wd.week.reports'] => (string) (int) ($act['report_submitted'] ?? 0),
            $s['wd.week.contact'] => self::fill($s['wd.week.contactValue'], $this->app->contactForm()->stats($since))
                . (($unread = $this->leadsUnread()) > 0 ? ' · ' . self::plural($s['wd.week.leads'], $unread) : ''),
            $s['wd.week.backup'] => $backups ? date('Y-m-d H:i', max(array_map('filemtime', $backups))) : $s['wd.week.noBackup'],
            $s['wd.week.cert'] => isset($tls['validTo']) && $tls['validTo'] ? self::fill($s['wd.week.certDays'], ['days' => (int) floor(((int) $tls['validTo'] - $now) / 86400)]) : $s['wd.none'],
            $s['wd.week.domain'] => ($dh = $this->app->domainHealth()->latest()) && !empty($dh['expiry']['validTo'])
                ? self::fill($s['wd.week.certDays'], ['days' => (int) floor(((int) $dh['expiry']['validTo'] - $now) / 86400)]) . ' · ' . ($dh['problems'] && array_diff($dh['problems'], ['expiry']) ? $s['wd.week.dnsIssues'] : $s['wd.week.dnsOk'])
                : $s['wd.none'],
            $s['wd.week.report'] => $report['sentAt'] ? $s['wd.week.reportSent'] : $s['wd.week.reportPending'],
        ];
        if ($this->app->analytics()->enabled()) {
            $v = $this->app->analytics()->summary($since, $now + 1);
            $facts = array_slice($facts, 0, 7, true) + [$s['wd.week.visitsTitle'] => self::plural($s['wd.week.visits'], $v['visitors'], ['count' => $v['visitors']])
                . ($v['contacts'] > 0 ? ' · ' . self::plural($s['wd.week.clicks'], $v['contacts']) : '')] + array_slice($facts, 7, null, true);
        }
        $top = $db->all('SELECT event, message, COUNT(*) AS n FROM error_log WHERE created_at > ? GROUP BY fingerprint ORDER BY n DESC LIMIT 3', [$since]);
        $this->state();
        $this->state['week'] = $week;
        $this->sendToOwner('weekly_digest', [
            'subject' => self::fill($s['wd.week.subject'], ['range' => date('d/m', $since) . '–' . date('d/m', $now)]), 'title' => $s['wd.week.title'],
            'intro' => $s['wd.week.intro'], 'facts' => $facts,
            'itemsTitle' => $top ? $s['wd.week.topErrors'] : null,
            'items' => array_map(fn ($r) => "{$r['n']} × {$r['event']}" . ($r['message'] !== '' ? ' — ' . mb_substr((string) $r['message'], 0, 100) : ''), $top),
            'cta' => [$s['wd.cta.monitor'], 'monitoreo'], 'severity' => 'info', 'tag' => $s['wd.tag.digest'],
        ], $now);
        return 'sent';
    }

    private function leadsUnread(): int
    {
        try {
            return $this->app->leads()->badge();
        } catch (\Throwable) {
            return 0;
        }
    }

    public function monthlyReview(int $now): string
    {
        $month = date('Y-m', $now);
        if (($this->state()['month'] ?? '') === $month || ((int) date('j', $now) === 1 && (int) date('G', $now) < 8) || !$this->inUseForAWeek($now)) {
            return 'not due';
        }
        $db = $this->app->db();
        $s = $this->strings();
        $owner = $this->app->config->ownerEmail();
        $items = [];
        $inactive = $db->all("SELECT name, last_login_at FROM users WHERE status = 'active' AND lower(email) <> ? AND COALESCE(last_login_at, created_at) < ?", [$owner, $now - 90 * 86400]);
        $items[] = $inactive ? self::fill($s['wd.review.inactive'], ['names' => implode(', ', array_column($inactive, 'name'))]) : $s['wd.review.noInactive'];
        $invited = (int) $db->value("SELECT COUNT(*) FROM users WHERE status = 'invited'");
        if ($invited > 0) {
            $items[] = self::fill($s['wd.review.invited'], ['n' => $invited]);
        }
        $site = array_column($db->all("SELECT name FROM users WHERE status = 'active' AND lower(email) <> ? AND (',' || permissions || ',') LIKE '%,site,%'", [$owner]), 'name');
        if ($site) {
            $items[] = self::fill($s['wd.review.siteAccess'], ['names' => implode(', ', $site)]);
        }
        $pwd = $db->value("SELECT password_changed_at FROM users WHERE lower(email) = ?", [$owner]);
        if ($pwd !== null && (int) $pwd < $now - 365 * 86400) {
            $items[] = self::fill($s['wd.review.ownerPassword'], ['days' => (int) floor(($now - (int) $pwd) / 86400)]);
        }
        $ver = PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION;
        if (isset(self::PHP_SUPPORT_UNTIL[$ver])) {
            $until = (int) strtotime(self::PHP_SUPPORT_UNTIL[$ver]);
            $items[] = self::fill($s[$until < $now ? 'wd.review.phpEnded' : ($until < $now + 120 * 86400 ? 'wd.review.phpEnding' : 'wd.review.phpOk')], ['version' => $ver, 'date' => self::PHP_SUPPORT_UNTIL[$ver]]);
        }
        $lastContent = $db->value("SELECT MAX(created_at) FROM activity_log WHERE action IN ('content_updated','media_uploaded')");
        if ($lastContent === null || (int) $lastContent < $now - 90 * 86400) {
            $items[] = $s['wd.review.staleContent'];
        }
        $backups = glob($this->app->storage('backups/db') . '/database-*.sqlite') ?: [];
        if (!$backups) {
            $items[] = $s['wd.review.noBackups'];
        }
        $psi = $this->app->pageSpeed()->latest();
        if (isset($psi['mobile']['performance']) && (int) $psi['mobile']['performance'] < 50) {
            $items[] = self::fill($s['wd.review.slow'], ['score' => (int) $psi['mobile']['performance']]);
        }
        $items[] = $s['wd.review.routine'];
        $this->state();
        $this->state['month'] = $month;
        $this->sendToOwner('monthly_review', [
            'subject' => self::fill($s['wd.review.subject'], ['month' => $this->app->siteReport()->periodLabel($month, $this->ownerLang())]),
            'title' => $s['wd.review.title'], 'intro' => $s['wd.review.intro'], 'items' => $items,
            'cta' => [$s['wd.cta.users'], 'usuarios'], 'severity' => 'info', 'tag' => $s['wd.tag.review'],
        ], $now);
        return 'sent';
    }

    // ------------------------------------------------------------------ outside the scheduled check

    /**
     * The scheduled check stopped (cron not running). Detected from /api/health
     * (polled by the uptime monitor) and from the owner's panel. Once a day.
     */
    public function checkScheduler(?int $now = null): void
    {
        $now ??= time();
        try {
            $last = (int) $this->app->settings()->get('monitor_last_run', '0');
            if ($last === 0 || $now - $last < 2 * 3600 || !$this->enabled('scheduler') || !$this->due('scheduler', 86400, $now)) {
                return;
            }
            $s = $this->strings();
            $this->sendToOwner('scheduler', [
                'subject' => $s['wd.cron.subject'], 'title' => self::fill($s['wd.cron.title'], ['when' => date('Y-m-d H:i', $last)]),
                'intro' => $s['wd.cron.intro'], 'action' => $s['wd.cron.action'], 'cta' => [$s['wd.cta.monitor'], 'monitoreo'], 'severity' => 'warn',
            ], $now, true);
        } catch (\Throwable) {
            // never break the request that noticed it
        }
    }

    /** After a successful sign-in: e-mail the person if this browser/device is new for them. */
    public function onLogin(array $user, string $userAgent, string $ip, ?int $now = null): void
    {
        $now ??= time();
        try {
            $label = self::deviceLabel($userAgent);
            $hash = hash('sha256', strtolower($label));
            $db = $this->app->db();
            $known = (int) $db->value('SELECT COUNT(*) FROM known_devices WHERE user_id = ?', [$user['id']]);
            $exists = $db->value('SELECT id FROM known_devices WHERE user_id = ? AND device_hash = ?', [$user['id'], $hash]);
            if ($exists) {
                $db->run('UPDATE known_devices SET last_seen = ? WHERE id = ?', [$now, $exists]);
                return;
            }
            $db->run('INSERT INTO known_devices (user_id, device_hash, label, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)', [$user['id'], $hash, $label, $now, $now]);
            if ($known === 0 || !$this->enabled('new_device')) {
                return; // the first device of an account is not "new"
            }
            $lang = ($user['lang'] ?? 'es') === 'en' ? 'en' : 'es';
            $s = $this->strings($lang);
            $this->send((string) $user['email'], $lang, 'new_device', [
                'subject' => $s['wd.device.subject'], 'title' => $s['wd.device.title'],
                'intro' => self::fill($s['wd.device.intro'], ['name' => explode(' ', (string) $user['name'])[0]]),
                'facts' => [$s['wd.device.device'] => $label, $s['wd.device.when'] => date('Y-m-d H:i T', $now), $s['wd.device.ip'] => $ip],
                'action' => $s['wd.device.action'], 'cta' => [$s['wd.cta.account'], 'cuenta'], 'severity' => 'info', 'tag' => $s['wd.tag.security'],
            ], true);
        } catch (\Throwable $e) {
            $this->app->logger()->error('watchdog_failed', ['rule' => 'new_device', 'type' => get_class($e)]);
        }
    }

    /** Security notice: the owner's e-mail settings changed (always on). */
    public function settingsChanged(string $by, array $areas): void
    {
        $s = $this->strings();
        $labels = array_map(fn ($a) => $s['wd.settings.area.' . $a] ?? $a, $areas);
        $this->send($this->app->config->ownerEmail(), $this->ownerLang(), 'settings_changed', [
            'subject' => $s['wd.settings.subject'], 'title' => $s['wd.settings.title'],
            'intro' => self::fill($s['wd.settings.intro'], ['name' => $by]),
            'facts' => [$s['wd.settings.what'] => $labels ? implode(', ', $labels) : $s['wd.none'], $s['wd.device.when'] => date('Y-m-d H:i T')],
            'action' => $s['wd.settings.action'], 'cta' => [$s['wd.cta.email'], 'correo'], 'severity' => 'warn', 'tag' => $s['wd.tag.security'],
        ]);
    }

    /** Security notice to the person: two-step sign-in enabled, disabled, reset by IT, or a recovery code used. */
    public function twoFactorNotice(array $user, string $kind): void
    {
        try {
            $lang = ($user['lang'] ?? 'es') === 'en' ? 'en' : 'es';
            $s = $this->strings($lang);
            $this->send((string) $user['email'], $lang, 'two_factor', [
                'subject' => $s['wd.2fa.' . $kind . '.subject'], 'title' => $s['wd.2fa.' . $kind . '.title'],
                'intro' => self::fill($s['wd.2fa.' . $kind . '.intro'], ['name' => explode(' ', (string) $user['name'])[0]]),
                'facts' => [$s['wd.device.when'] => date('Y-m-d H:i T')],
                'action' => $s['wd.2fa.action'], 'cta' => [$s['wd.cta.account'], 'cuenta'], 'severity' => $kind === 'enabled' ? 'info' : 'warn', 'tag' => $s['wd.tag.security'],
            ], true);
        } catch (\Throwable $e) {
            $this->app->logger()->error('watchdog_failed', ['rule' => 'two_factor', 'type' => get_class($e)]);
        }
    }

    /**
     * Tells a person about a change someone else made to their account
     * (Usuarios): new sign-in e-mail (to the old and the new address) or a
     * password given to them. Never includes the password.
     * @param array{by:string,email?:string} $vars
     */
    public function accountNotice(array $user, string $kind, array $vars): void
    {
        try {
            $lang = ($user['lang'] ?? 'es') === 'en' ? 'en' : 'es';
            $s = $this->strings($lang);
            $fill = $vars + ['name' => explode(' ', (string) $user['name'])[0], 'support' => $this->app->mailSettings()->supportEmail()];
            $this->send((string) $user['email'], $lang, 'account', [
                'subject' => $s['wd.acct.' . $kind . '.subject'], 'title' => $s['wd.acct.' . $kind . '.title'],
                'intro' => self::fill($s['wd.acct.' . $kind . '.intro'], $fill),
                'facts' => [$s['wd.acct.by'] => $vars['by'], $s['wd.device.when'] => date('Y-m-d H:i T')],
                'action' => self::fill($s['wd.acct.action'], $fill),
                // The old address can no longer sign in: no button there.
                'cta' => $kind === 'email_changed_old' ? null : [$s['wd.cta.panel'], ''],
                'severity' => 'warn', 'tag' => $s['wd.tag.security'],
            ], true);
        } catch (\Throwable $e) {
            $this->app->logger()->error('watchdog_failed', ['rule' => 'account', 'type' => get_class($e)]);
        }
    }

    /** "Chrome en Windows" from a User-Agent (browser family + operating system only). */
    public static function deviceLabel(string $ua): string
    {
        $browser = match (true) {
            str_contains($ua, 'Edg/') => 'Edge',
            str_contains($ua, 'OPR/') || str_contains($ua, 'Opera') => 'Opera',
            str_contains($ua, 'Firefox/') || str_contains($ua, 'FxiOS') => 'Firefox',
            str_contains($ua, 'CriOS') || (str_contains($ua, 'Chrome/') && !str_contains($ua, 'Chromium')) => 'Chrome',
            str_contains($ua, 'Safari/') => 'Safari',
            default => 'Navegador',
        };
        $os = match (true) {
            (bool) preg_match('/iPhone|iPad|iPod/', $ua) => 'iOS',
            str_contains($ua, 'Android') => 'Android',
            str_contains($ua, 'Windows') => 'Windows',
            str_contains($ua, 'Mac OS X') || str_contains($ua, 'Macintosh') => 'macOS',
            str_contains($ua, 'Linux') => 'Linux',
            default => '?',
        };
        return $browser . ' · ' . $os;
    }

    // ------------------------------------------------------------------ integrity manifest

    /** Hashes of the public files (release manifest or the last accepted state, whichever is newer). @return array<string,string>|null */
    private function manifest(): ?array
    {
        $best = null;
        foreach ([$this->app->root('release-manifest.json'), $this->app->storage('integrity-manifest.json')] as $file) {
            $m = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
            if (is_array($m) && isset($m['files']) && is_array($m['files']) && (!$best || (int) ($m['createdAt'] ?? 0) >= (int) ($best['createdAt'] ?? 0))) {
                $best = $m;
            }
        }
        return $best ? $best['files'] : null;
    }

    /**
     * SHA-256 of a public file. In .htaccess files the blocks cPanel writes by
     * itself (MultiPHP handler / INI directives) are ignored, so changing the
     * PHP version in cPanel is not reported as tampering.
     */
    public static function fileHash(string $file): string
    {
        if (basename($file) !== '.htaccess') {
            return (string) hash_file('sha256', $file);
        }
        $s = (string) preg_replace('/^# (php -- )?BEGIN cPanel-generated.*?^# (php -- )?END cPanel-generated[^\n]*\n?/ms', '', (string) file_get_contents($file));
        return hash('sha256', rtrim(str_replace("\r\n", "\n", $s)) . "\n");
    }

    /** Records the current public files as the expected state (`bin/console integrity:accept` or the panel). */
    public function acceptIntegrity(): int
    {
        $root = rtrim($this->app->publicPath(), '/');
        $files = [];
        if (is_dir($root)) {
            $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS));
            foreach ($it as $file) {
                $path = substr($file->getPathname(), strlen($root) + 1);
                if ($file->isFile() && !in_array($path, self::GENERATED, true) && !str_starts_with($path, 'assets/.rl-data/')
                    && (!str_starts_with($path, 'assets/uploads/') || $file->getFilename() === '.htaccess')) {
                    $files[$path] = self::fileHash($file->getPathname());
                }
            }
        }
        ksort($files);
        $target = $this->app->storage('integrity-manifest.json');
        file_put_contents($target, (string) json_encode(['createdAt' => time(), 'files' => $files], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        @chmod($target, 0600);
        $this->state();
        unset($this->state['fp']['integrity']);
        $this->saveState();
        return count($files);
    }

    // ------------------------------------------------------------------ sending

    private function ownerLang(): string
    {
        try {
            $l = $this->app->db()->value('SELECT lang FROM users WHERE lower(email) = ?', [$this->app->config->ownerEmail()]);
            return $l === 'en' ? 'en' : 'es';
        } catch (\Throwable) {
            return 'es';
        }
    }

    private function strings(?string $lang = null): array
    {
        return require $this->app->root('lang/' . (($lang ?? $this->ownerLang()) === 'en' ? 'en' : 'es') . '.php');
    }

    /** "visita|visitas": singular or plural by $n, then fills {n} and $vars. */
    public static function plural(string $s, int $n, array $vars = []): string
    {
        $forms = explode('|', $s);
        return self::fill($forms[$n === 1 || count($forms) === 1 ? 0 : 1], ['n' => $n] + $vars);
    }

    public static function fill(string $s, array $vars): string
    {
        return strtr($s, array_combine(array_map(fn ($k) => '{' . $k . '}', array_keys($vars)), array_map('strval', array_values($vars))));
    }

    /**
     * A notice from the automations (Automations): same branded layout as the
     * alerts, with a footer that says why the person gets it. Sent after the
     * response unless $deferred is false (or from the command line).
     */
    public function notify(string $to, string $lang, string $rule, array $msg, bool $deferred = true): void
    {
        $this->send($to, $lang === 'en' ? 'en' : 'es', 'auto_' . $rule, $msg, $deferred);
    }

    /** The language files' strings for $lang (the automations build their notices with them). */
    public function texts(string $lang): array
    {
        return $this->strings($lang === 'en' ? 'en' : 'es');
    }

    private function sendToOwner(string $rule, array $msg, int $now, bool $deferred = false): void
    {
        $this->mark($rule, $now);
        $this->send($this->app->mailSettings()->alertEmail(), $this->ownerLang(), $rule, $msg, $deferred);
    }

    /** Builds the branded alert e-mail; sends now or after the response ($deferred). */
    private function send(string $to, string $lang, string $rule, array $msg, bool $deferred = false): void
    {
        $s = $this->strings($lang);
        $e = fn (string $v) => Emails::esc($v);
        $colors = ['bad' => ['#fdecec', '#b42318'], 'warn' => ['#fff4e0', '#a15c00'], 'info' => ['#e8effd', '#1d4ed8']];
        [$bg, $fg] = $colors[$msg['severity'] ?? 'info'];
        $body = '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:' . $bg . ';color:' . $fg . ';border-radius:999px;padding:5px 12px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif">'
            . $e($s['wd.badge.' . ($msg['severity'] ?? 'info')]) . '</td></tr></table>'
            . '<h1 style="margin:14px 0 8px;font-size:22px;line-height:1.3;color:#1c1c1c">' . $e($msg['title']) . '</h1>'
            . '<p style="margin:0 0 14px;color:#2b2b31">' . $e($msg['intro']) . '</p>';
        $text = $msg['title'] . "\n\n" . $msg['intro'] . "\n\n";
        if (!empty($msg['facts'])) {
            $rows = '';
            foreach ($msg['facts'] as $k => $v) {
                $rows .= '<tr><td valign="top" style="padding:7px 14px 7px 0;color:#7a7a82;white-space:nowrap;font-size:14px">' . $e((string) $k) . '</td>'
                    . '<td style="padding:7px 0;font-size:14px;font-weight:600;color:#1f2328;word-break:break-word">' . $e((string) $v) . '</td></tr>';
                $text .= "{$k}: {$v}\n";
            }
            $body .= '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 8px;background:#f7f7f9;border-radius:12px;padding:6px 16px;width:100%"><tr><td><table role="presentation" cellpadding="0" cellspacing="0">' . $rows . '</table></td></tr></table>';
            $text .= "\n";
        }
        if (!empty($msg['items'])) {
            if (!empty($msg['itemsTitle'])) {
                $body .= '<h2 style="margin:18px 0 4px;font-size:15px;color:#1c1c1c">' . $e($msg['itemsTitle']) . '</h2>';
                $text .= $msg['itemsTitle'] . "\n";
            }
            $li = '';
            foreach ($msg['items'] as $it) {
                $li .= '<tr><td valign="top" width="20" style="padding:5px 0;color:#f6740a">&#9679;</td><td style="padding:5px 0;font-size:14px;color:#2b2b31;word-break:break-word">' . $e($it) . '</td></tr>';
                $text .= "- {$it}\n";
            }
            $body .= '<table role="presentation" cellpadding="0" cellspacing="0">' . $li . '</table>';
            $text .= "\n";
        }
        if (!empty($msg['action'])) {
            $body .= '<div style="margin:16px 0 0;padding:14px 16px;background:#fff8f1;border-left:4px solid #f6740a;border-radius:0 12px 12px 0;font-size:14px;color:#2b2b31">'
                . '<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#a15c00;margin-bottom:4px">' . $e($s['wd.whatToDo']) . '</div>' . $e($msg['action']) . '</div>';
            $text .= $s['wd.whatToDo'] . ': ' . $msg['action'] . "\n\n";
        }
        if (!empty($msg['cta'])) {
            $link = (new Emails($this->app))->adminUrl($msg['cta'][1]);
            $body .= Emails::cta($msg['cta'][0], $link);
            $text .= $link . "\n";
        }
        $footer = $e(match (true) {
            in_array($rule, ['new_device', 'settings_changed', 'two_factor', 'account'], true) => $s['wd.footer.security'],
            str_starts_with($rule, 'auto_') => $s['au.footer'],
            default => $s['wd.footer.rule'],
        });
        $layout = (new Emails($this->app))->branded($lang, $msg['tag'] ?? $s['wd.tag.alert'], $msg['intro'], $body, $footer);
        $mail = ['to' => $to, 'subject' => $msg['subject'], 'text' => $text, 'html' => $layout['html'], 'embedded' => $layout['embedded']];
        if (!$deferred || PHP_SAPI === 'cli') {
            $this->deliver($mail, $rule);
            return;
        }
        if (!$this->deferred) {
            register_shutdown_function(function () {
                if (function_exists('fastcgi_finish_request')) {
                    fastcgi_finish_request();
                } elseif (function_exists('litespeed_finish_request')) {
                    litespeed_finish_request();
                }
                foreach ($this->deferred as [$m, $r]) {
                    $this->deliver($m, $r);
                }
            });
        }
        $this->deferred[] = [$mail, $rule];
    }

    private function deliver(array $mail, string $rule): void
    {
        $ok = $this->app->mailer()->send($mail);
        $this->app->logger()->info($ok ? 'watchdog_sent' : 'watchdog_not_sent', ['rule' => $rule]);
        if ($ok && !in_array($rule, ['weekly_digest', 'monthly_review', 'new_device', 'settings_changed'], true) && !str_starts_with($rule, 'auto_')) {
            $this->app->maintenanceLog()->add('alerts');
        }
    }
}
