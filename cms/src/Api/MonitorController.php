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
        Response::ok($this->app->monitor()->summary());
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
