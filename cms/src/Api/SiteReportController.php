<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Http\Response;
use Sensum\Cms\SiteReport;

/**
 * The monthly site report. The owner prepares and sends the client version;
 * accounts with the "report" access see both versions (client and technical
 * detail) without sending anything.
 */
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

    /** Both versions of a month: what clients receive and the technical detail for the team. */
    public function preview(): never
    {
        $this->requirePermission('report');
        $r = $this->report();
        $lang = $this->req->query('lang');
        $lang = in_array($lang, ['es', 'en'], true) ? $lang : $r->settings()['lang'];
        $period = $r->validPeriod($this->req->query('period'));
        Response::ok(['period' => $period, 'periods' => $r->periodOptions($lang), 'report' => $r->build($period, $lang), 'technical' => $r->technical($period, $lang)]);
    }

    /** The report as a PDF download (same content as the e-mail; the optional note included). */
    public function pdf(): never
    {
        if (!$this->app->rateLimiter()->hit('site_report_pdf', (string) $this->uid(), 30, 3600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $r = $this->report();
        $period = $r->validPeriod($this->str('period'));
        $lang = in_array($this->str('lang'), ['es', 'en'], true) ? $this->str('lang') : $r->settings()['lang'];
        $note = mb_substr(trim(str_replace("\r", '', $this->str('note'))), 0, SiteReport::NOTE_MAX);
        $pdf = $r->pdf($r->build($period, $lang), (string) preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x{202A}-\x{202E}\x{2066}-\x{2069}]/u', '', $note));
        header('Content-Type: application/pdf');
        header('Content-Length: ' . strlen($pdf));
        header('Content-Disposition: attachment; filename="' . $r->pdfName($period, $lang) . '"');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        echo $pdf;
        exit;
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
