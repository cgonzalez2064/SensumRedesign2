<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Http\Response;
use Sensum\Cms\SiteReport;

/** The monthly site report for clients — owner account only. */
final class SiteReportController extends Controller
{
    private function report(): SiteReport
    {
        return $this->app->siteReport();
    }

    public function index(): never
    {
        $r = $this->report();
        // Visiting the page also covers the reminder when no cron job is set up.
        $r->maybeRemind();
        $settings = $r->settings();
        $psi = $this->app->pageSpeed();
        Response::ok([
            'settings' => $settings,
            'ownerEmail' => $r->ownerEmail(),
            'maxRecipients' => SiteReport::MAX_RECIPIENTS,
            'noteMax' => SiteReport::NOTE_MAX,
            'status' => $r->status(),
            'periods' => $r->periodOptions($settings['lang']),
            'history' => $r->history(),
            'pagespeed' => ['enabled' => $psi->enabled(), 'fetchedAt' => ((int) ($psi->latest()['fetchedAt'] ?? 0)) ?: null],
        ]);
    }

    public function preview(): never
    {
        $r = $this->report();
        $lang = $this->req->query('lang');
        Response::ok(['report' => $r->build($r->validPeriod($this->req->query('period')), in_array($lang, ['es', 'en'], true) ? $lang : $r->settings()['lang'])]);
    }

    public function settings(): never
    {
        $saved = $this->report()->saveSettings($this->req->raw('recipients'), $this->str('lang'));
        $this->app->activity($this->uid(), 'site_report_settings', '', ['recipients' => count($saved['recipients'])], $this->req->ip());
        Response::ok(['settings' => $saved]);
    }

    public function send(): never
    {
        if (!$this->app->rateLimiter()->hit('site_report', (string) $this->uid(), 10, 3600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $r = $this->report();
        $period = $r->validPeriod($this->str('period'));
        $test = $this->str('test') === '1';
        $result = $r->send($period, $this->uid(), $this->str('note'), $test);
        if (!$test) {
            $this->app->activity($this->uid(), $result['sent'] ? 'site_report_sent' : 'site_report_failed', $period, ['recipients' => count($result['to']) + count($result['cc'])], $this->req->ip());
        }
        if (!$result['sent']) {
            throw new ApiError(502, 'email_failed');
        }
        Response::ok($result);
    }
}
