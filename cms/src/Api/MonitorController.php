<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Http\Response;

/** Monitoring and the error log — owner account only (OWNER_EMAIL). */
final class MonitorController extends Controller
{
    public function summary(): never
    {
        $this->app->watchdog()->checkScheduler();
        $wd = $this->app->watchdog();
        Response::ok($this->app->monitor()->summary() + ['rules' => ['enabled' => $wd->rules(), 'lastSent' => $wd->lastSent()]]);
    }

    /** Turns automatic alerts on or off (Monitoreo → Alertas automáticas). */
    public function saveRules(): never
    {
        $in = $this->req->json();
        $rules = is_array($in['rules'] ?? null) ? $in['rules'] : [];
        foreach ($rules as $k => $v) {
            if (!in_array($k, \Sensum\Cms\Watchdog::RULES, true) || !is_bool($v)) {
                throw ApiError::validation(['rules' => 'invalid']);
            }
        }
        $wd = $this->app->watchdog();
        $before = $wd->rules();
        $after = $wd->saveRules($rules);
        $changed = array_keys(array_diff_assoc(array_map('intval', $after), array_map('intval', $before)));
        if ($changed) {
            $this->app->activity($this->uid(), 'alert_rules_changed', '', ['off' => array_keys(array_filter($after, fn ($v) => !$v))], $this->req->ip());
        }
        Response::ok(['enabled' => $after, 'lastSent' => $wd->lastSent()]);
    }

    public function errors(): never
    {
        Response::ok($this->app->monitor()->errors([
            'severity' => $this->req->query('severity'),
            'source' => $this->req->query('source'),
            'days' => (int) $this->req->query('days'),
            'q' => $this->req->query('q'),
            'page' => (int) $this->req->query('page'),
        ]));
    }

    /** Current findings of the file-integrity check (same as the scheduled check). */
    public function integrity(): never
    {
        Response::ok(['findings' => $this->app->watchdog()->integrityFindings()]);
    }

    /** The owner confirms the current public files are expected (password required). */
    public function acceptIntegrity(): never
    {
        $this->confirmPassword('integrity');
        $wd = $this->app->watchdog();
        $findings = $wd->integrityFindings();
        $files = $wd->acceptIntegrity();
        $this->app->activity($this->uid(), 'integrity_accepted', '', ['findings' => array_slice($findings, 0, 50), 'files' => $files], $this->req->ip());
        Response::ok(['files' => $files, 'findings' => $wd->integrityFindings()]);
    }

    /** Sends a test alert to ALERT_EMAIL so the owner can confirm alerts arrive. */
    public function testAlert(): never
    {
        $alerts = $this->app->alerts();
        if (!$alerts->enabled()) {
            throw new ApiError(409, 'alerts_disabled');
        }
        if (!$this->app->rateLimiter()->hit('alert_test', (string) $this->uid(), 3, 3600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $sent = $alerts->sendTest((string) $this->session['name']);
        $this->app->activity($this->uid(), 'alert_test', '', ['sent' => $sent], $this->req->ip());
        Response::ok(['sent' => $sent, 'recipient' => $alerts->recipient()]);
    }
}
