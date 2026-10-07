<?php
declare(strict_types=1);

namespace Sensum\Cms;

/**
 * E-mails critical errors to IT (ALERT_EMAIL, default it@gruposensum.com).
 *
 * Throttled so a recurring failure cannot flood the inbox: the same error
 * (fingerprint) at most once per ALERT_COOLDOWN_MINUTES (default 60), and at
 * most ALERT_DAILY_MAX (default 20) alerts per day. Suppressed repeats are
 * counted and reported in the next alert. The throttle state is a small
 * file in private storage, so alerts still work when the database is down.
 *
 * Alerts are sent after the response has been delivered (end of request),
 * so a failing page is not made slower. If e-mail is unavailable the error
 * is marked "failed" and `bin/console monitor` sends a summary later.
 */
final class Alerts
{
    /** @var list<array{0:?int,1:array,2:int}> */
    private array $pending = [];
    private bool $flushRegistered = false;

    public function __construct(private App $app)
    {
    }

    public function enabled(): bool
    {
        return $this->app->config->bool('ALERTS_ENABLED', true) && filter_var($this->recipient(), FILTER_VALIDATE_EMAIL) !== false;
    }

    public function recipient(): string
    {
        return $this->app->config->string('ALERT_EMAIL', $this->app->config->supportEmail());
    }

    public function cooldownMinutes(): int
    {
        return $this->app->config->int('ALERT_COOLDOWN_MINUTES', 60, 0, 1440);
    }

    public function dailyMax(): int
    {
        return $this->app->config->int('ALERT_DAILY_MAX', 20, 1, 500);
    }

    /** Called by ErrorLog for each critical entry. */
    public function queue(?int $logId, array $entry): void
    {
        if (!$this->enabled()) {
            $this->app->errors()->setAlert($logId, 'off');
            return;
        }
        $repeats = $this->reserve($entry['fingerprint']);
        if ($repeats === null) {
            $this->app->errors()->setAlert($logId, 'suppressed');
            return;
        }
        $this->pending[] = [$logId, $entry, $repeats];
        if (!$this->flushRegistered) {
            $this->flushRegistered = true;
            register_shutdown_function([$this, 'flush']);
        }
    }

    /** Sends queued alerts. Runs at shutdown, after the response was handed to the visitor. */
    public function flush(): void
    {
        if (!$this->pending) {
            return;
        }
        if (PHP_SAPI !== 'cli') {
            ignore_user_abort(true);
            if (function_exists('fastcgi_finish_request')) {
                fastcgi_finish_request();
            } elseif (function_exists('litespeed_finish_request')) {
                litespeed_finish_request();
            }
        }
        [$lang, ] = $this->ownerLang();
        foreach ($this->pending as [$id, $entry, $repeats]) {
            $mail = (new Emails($this->app))->criticalAlert($this->recipient(), $lang, $entry, $this->userLabel($entry['user_id'] ?? null), $repeats);
            $ok = $this->app->mailer()->send($mail);
            $this->app->errors()->setAlert($id, $ok ? 'sent' : 'failed');
        }
        $this->pending = [];
    }

    /** Sends a test alert right away; returns whether the mail server accepted it. */
    public function sendTest(string $requestedBy): bool
    {
        [$lang, ] = $this->ownerLang();
        return $this->app->mailer()->send((new Emails($this->app))->alertTest($this->recipient(), $lang, $requestedBy));
    }

    /** Re-sends, as one summary, critical alerts of the last 48 h that failed to send. Returns how many. */
    public function retryFailed(): int
    {
        if (!$this->enabled()) {
            return 0;
        }
        $rows = $this->app->db()->all(
            "SELECT * FROM error_log WHERE severity = 'critical' AND alert = 'failed' AND created_at > ? ORDER BY id LIMIT 25",
            [time() - 48 * 3600]
        );
        if (!$rows) {
            return 0;
        }
        [$lang, ] = $this->ownerLang();
        if (!$this->app->mailer()->send((new Emails($this->app))->alertDigest($this->recipient(), $lang, $rows))) {
            return 0;
        }
        $ids = array_map(fn ($r) => (int) $r['id'], $rows);
        $this->app->db()->run('UPDATE error_log SET alert = \'sent\' WHERE id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')', $ids);
        return count($rows);
    }

    /**
     * Claims the right to send an alert for this fingerprint now. Returns the
     * number of repeats suppressed since the previous alert, or null when this
     * one must be suppressed (cooldown or daily cap).
     */
    private function reserve(string $fingerprint): ?int
    {
        $file = $this->app->storage('alert-state.json');
        $fh = @fopen($file, 'c+');
        if (!$fh) {
            return 0; // no state available: send rather than stay silent
        }
        try {
            flock($fh, LOCK_EX);
            $state = json_decode((string) stream_get_contents($fh), true);
            $state = is_array($state) ? $state : [];
            $today = date('Y-m-d');
            if (($state['day'] ?? '') !== $today) {
                $state['day'] = $today;
                $state['sent'] = 0;
            }
            $fp = $state['fp'][$fingerprint] ?? ['last' => 0, 'suppressed' => 0];
            $now = time();
            if ($now - (int) $fp['last'] < $this->cooldownMinutes() * 60 || (int) ($state['sent'] ?? 0) >= $this->dailyMax()) {
                $fp['suppressed'] = (int) $fp['suppressed'] + 1;
                $result = null;
            } else {
                $result = (int) $fp['suppressed'];
                $fp = ['last' => $now, 'suppressed' => 0];
                $state['sent'] = (int) ($state['sent'] ?? 0) + 1;
            }
            $state['fp'][$fingerprint] = $fp;
            // Forget fingerprints idle for a week.
            $state['fp'] = array_filter($state['fp'], fn ($v) => $now - (int) $v['last'] < 7 * 86400 || (int) $v['suppressed'] > 0);
            ftruncate($fh, 0);
            rewind($fh);
            fwrite($fh, (string) json_encode($state));
            fflush($fh);
            flock($fh, LOCK_UN);
            return $result;
        } finally {
            fclose($fh);
            @chmod($file, 0600);
        }
    }

    /** @return array{0:string,1:?array} the owner's e-mail language (default Spanish) */
    private function ownerLang(): array
    {
        try {
            $owner = $this->app->db()->one('SELECT * FROM users WHERE lower(email) = ?', [strtolower($this->app->config->ownerEmail())]);
            return [($owner['lang'] ?? 'es') === 'en' ? 'en' : 'es', $owner];
        } catch (\Throwable) {
            return ['es', null];
        }
    }

    private function userLabel(?int $userId): string
    {
        if ($userId === null) {
            return '';
        }
        try {
            $u = $this->app->db()->one('SELECT name, role FROM users WHERE id = ?', [$userId]);
            return $u ? "{$u['name']} ({$u['role']})" : "#{$userId}";
        } catch (\Throwable) {
            return "#{$userId}";
        }
    }
}
