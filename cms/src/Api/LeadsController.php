<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Http\Response;
use Sensum\Cms\Leads;
use Sensum\Cms\SiteReport;

/**
 * "Prospectos" (contact-form messages) and "Estadísticas" (cookie-free
 * visits): accounts with the "leads" access and the owner. Settings
 * (retention, statistics on/off) are owner-only. /api/collect is the
 * public endpoint the site's pages send their visit beacons to.
 */
final class LeadsController extends Controller
{
    public function index(): never
    {
        $this->requirePermission('leads');
        $out = $this->app->leads()->list($this->req->query('status') ?: 'active', $this->req->query('q'), $this->req->query('service'), $this->req->query('assigned'), $this->uid());
        $out['canConfigure'] = $this->isOwner();
        $out['retention'] = $this->app->leads()->retentionMonths();
        // Who can follow leads up (assignment) and the automations' settings.
        $out['people'] = array_map(fn ($u) => ['id' => (int) $u['id'], 'name' => (string) $u['name']], $this->app->automations()->leadPeople(false));
        $out['automation'] = $this->app->automations()->leadSettings();
        $out['formServices'] = array_values(array_map(fn ($it) => (string) $it['es'], $this->app->contactServices()->items()));
        $out['confirmation'] = $this->app->automations()->confirmationSettings();
        $out['me'] = $this->uid();
        Response::ok($out);
    }

    public function badge(): never
    {
        $this->requirePermission('leads');
        Response::ok(['count' => $this->app->leads()->badge()]);
    }

    public function show(int $id): never
    {
        $this->requirePermission('leads');
        Response::ok($this->app->leads()->detail($id) + [
            'people' => array_map(fn ($u) => ['id' => (int) $u['id'], 'name' => (string) $u['name']], $this->app->automations()->leadPeople(false)),
        ]);
    }

    public function update(int $id): never
    {
        $this->requirePermission('leads');
        $in = $this->req->json();
        $before = $this->app->db()->value('SELECT assigned_to FROM leads WHERE id = ?', [$id]);
        $out = $this->app->leads()->update((array) $this->session, $id, array_intersect_key($in, array_flip(['status', 'amount', 'assignedTo'])));
        $to = $out['lead']['assignedTo'];
        Response::okAndContinue($out);
        // Someone else now follows it up: they hear about it (not when you take it yourself).
        if ($to !== null && $to !== ($before !== null ? (int) $before : null) && $to !== $this->uid() && ($person = $this->app->automations()->leadPerson($to))) {
            $lead = $this->app->db()->one('SELECT * FROM leads WHERE id = ?', [$id]);
            $this->app->automations()->notifyAssignee($lead, $person, 'leadHandedOver', ['by' => (string) $this->session['name']]);
        }
        exit;
    }

    /** Prospectos → confirmation e-mailed to whoever writes (off until Sensum approves its text). */
    public function confirmation(): never
    {
        $this->requirePermission('leads');
        $saved = $this->app->automations()->saveConfirmationSettings($this->req->json());
        $this->app->activity($this->uid(), 'contact_confirmation_changed', 'contact_form', ['enabled' => $saved['enabled']], $this->req->ip());
        Response::ok(['confirmation' => $saved]);
    }

    /** Prospectos → Automatización: who gets each service, the follow-up reminder and the weekly summary. */
    public function automation(): never
    {
        $this->requirePermission('leads');
        $saved = $this->app->automations()->saveLeadSettings($this->req->json());
        $this->app->activity($this->uid(), 'lead_automation_changed', '', ['rules' => count($saved['rules']), 'followupHours' => $saved['followupHours'], 'weeklySummary' => $saved['weeklySummary']], $this->req->ip());
        Response::ok(['automation' => $saved]);
    }

    public function note(int $id): never
    {
        $this->requirePermission('leads');
        Response::ok($this->app->leads()->addNote((array) $this->session, $id, $this->str('body')));
    }

    public function delete(int $id): never
    {
        $this->requirePermission('leads');
        $this->app->leads()->delete((array) $this->session, $id);
        Response::ok();
    }

    /** CSV of the current filter (UTF-8 with BOM, formula-safe). */
    public function export(): never
    {
        $this->requirePermission('leads');
        if (!$this->app->rateLimiter()->hit('leads_export', (string) $this->uid(), 30, 3600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $csv = $this->app->leads()->csv($this->str('status') ?: 'all', $this->str('q'), $this->str('service'), $this->lang());
        $this->app->activity($this->uid(), 'leads_exported', '', ['status' => $this->str('status') ?: 'all'], $this->req->ip());
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Length: ' . strlen($csv));
        header('Content-Disposition: attachment; filename="prospectos-sensum-' . date('Y-m-d') . '.csv"');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        echo $csv;
        exit;
    }

    /** Owner: how long leads are kept. */
    public function settings(): never
    {
        if (!$this->isOwner()) {
            throw new ApiError(403, 'forbidden');
        }
        $in = $this->req->json();
        $months = $this->app->leads()->setRetention($in['retention'] ?? null);
        $this->app->activity($this->uid(), 'leads_settings_changed', '', ['retention' => $months], $this->req->ip());
        $this->app->publisher()->publish($this->uid(), 'leads_settings'); // the privacy notice states the period
        Response::ok(['retention' => $months]);
    }

    // ------------------------------------------------------------------ statistics

    /**
     * Visits for a month (YYYY-MM) or the last 30 days, with the previous
     * period to compare. "stats" access: visits only; "leads" access: plus
     * the contact-form figures.
     */
    public function stats(): never
    {
        $auth = $this->app->auth();
        $session = (array) $this->session;
        if (!$auth->can($session, 'stats') && !$auth->can($session, 'leads')) {
            throw new ApiError(403, 'forbidden');
        }
        $withLeads = $auth->can($session, 'leads');
        $period = $this->req->query('period');
        if (preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $period)) {
            [$start, $end] = SiteReport::bounds($period);
            [$pStart, $pEnd] = SiteReport::bounds(date('Y-m', strtotime($period . '-01 -1 month') ?: $start));
        } else {
            $period = '30d';
            $end = (int) strtotime('tomorrow');
            $start = $end - 30 * 86400;
            [$pStart, $pEnd] = [$start - 30 * 86400, $start];
        }
        $a = $this->app->analytics();
        $l = $this->app->leads();
        $months = [];
        for ($i = 0; $i < 12; $i++) {
            $months[] = date('Y-m', strtotime(date('Y-m-01') . " -$i month") ?: time());
        }
        Response::ok([
            'period' => $period,
            'from' => $start,
            'to' => $end,
            'enabled' => $a->enabled(),
            'canConfigure' => $this->isOwner(),
            'visits' => $a->summary($start, $end),
            'previous' => $a->summary($pStart, $pEnd),
            'leads' => $withLeads ? $l->stats($start, $end) : null,
            'previousLeads' => $withLeads ? $l->stats($pStart, $pEnd) : null,
            'months' => $months,
        ]);
    }

    /** Owner: statistics on/off. The pages are published again so the script is added or removed. */
    public function statsSettings(): never
    {
        if (!$this->isOwner()) {
            throw new ApiError(403, 'forbidden');
        }
        $in = $this->req->json();
        if (!is_bool($in['enabled'] ?? null)) {
            throw ApiError::validation(['enabled' => 'invalid']);
        }
        $this->app->analytics()->setEnabled($in['enabled']);
        $this->app->activity($this->uid(), 'stats_settings_changed', '', ['enabled' => $in['enabled']], $this->req->ip());
        $this->app->publisher()->publish($this->uid(), 'stats_settings');
        Response::ok(['enabled' => $in['enabled']]);
    }

    /** Public beacon from the site's pages. Always 204: the page learns nothing. */
    public function collect(): never
    {
        $optOut = $this->req->header('DNT') === '1' || $this->req->header('Sec-GPC') === '1' || $this->req->header('Sec-Purpose') !== '' || $this->req->header('Purpose') === 'prefetch';
        try {
            $this->app->analytics()->collect($this->req->json(), $this->req->ip(), $this->req->userAgent(), $optOut);
        } catch (ApiError) {
            // malformed body: ignored like any other rejected beacon
        }
        http_response_code(204);
        header('Cache-Control: no-store');
        exit;
    }
}
