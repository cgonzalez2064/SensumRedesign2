<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\Http\ApiError;
use Sensum\Cms\StatsReport;
use Sensum\Cms\Users;
use Sensum\Cms\Http\Response;
use Sensum\Cms\Leads;

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
        $out['formServices'] = array_map(fn ($it) => $it['es'], $this->app->contactServices()->items());
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
     * Visits for a period (7d / 30d / 90d, this month, a month YYYY-MM or a
     * custom from–to), with the previous period to compare. "stats" access:
     * visits only; "leads" access: plus the contact-form figures, optionally
     * for one service.
     */
    public function stats(): never
    {
        $withLeads = $this->statsAccess();
        $report = new StatsReport($this->app);
        $range = StatsReport::range($this->req->query('period'), $this->req->query('from'), $this->req->query('to'));
        $service = $withLeads ? mb_substr($this->req->query('service'), 0, 80) : '';
        $d = $report->data($range, $withLeads, $service);
        $months = [];
        for ($i = 0; $i < 12; $i++) {
            $months[] = date('Y-m', strtotime(date('Y-m-01') . " -$i month") ?: time());
        }
        Response::ok([
            'period' => $range['period'],
            'from' => $range['from'],
            'to' => $range['to'],
            'prevFrom' => $range['prevFrom'],
            'prevTo' => $range['prevTo'],
            'service' => $d['service'],
            'enabled' => $this->app->analytics()->enabled(),
            'canConfigure' => $this->isOwner(),
            'visits' => $d['visits'],
            'previous' => $d['previous'],
            'leads' => $d['leads'],
            'previousLeads' => $d['previousLeads'],
            // Services that have messages (for the filter in «Del mensaje al proyecto»).
            'services' => $withLeads ? array_map('strval', array_column($this->app->db()->all("SELECT DISTINCT service FROM leads WHERE service <> '' ORDER BY service LIMIT 40"), 'service')) : [],
            'months' => $months,
        ]);
    }

    /** «Exportar → Hoja de cálculo»: every part of the report for the chosen period. */
    public function statsExport(): never
    {
        $withLeads = $this->statsAccess();
        if (!$this->app->rateLimiter()->hit('stats_export', (string) $this->uid(), 30, 3600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $report = new StatsReport($this->app);
        $range = StatsReport::range($this->str('period'), $this->str('from'), $this->str('to'));
        $d = $report->data($range, $withLeads, $withLeads ? mb_substr($this->str('service'), 0, 80) : '');
        $csv = $report->csv($d, $this->lang());
        $this->app->activity($this->uid(), 'stats_exported', '', ['period' => $range['period']], $this->req->ip());
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Length: ' . strlen($csv));
        header('Content-Disposition: attachment; filename="' . $report->fileName($range) . '"');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        echo $csv;
        exit;
    }

    /**
     * «Enviar por correo»: the report for the chosen period to up to five
     * addresses (one message each), with the spreadsheet attached. Totals
     * only — no names, e-mails or messages of the people who wrote.
     */
    public function statsShare(): never
    {
        $withLeads = $this->statsAccess();
        $in = $this->req->json();
        $errors = [];
        $raw = is_array($in['recipients'] ?? null) ? $in['recipients'] : preg_split('/[\s,;]+/', (string) ($in['recipients'] ?? ''), -1, PREG_SPLIT_NO_EMPTY);
        $to = [];
        foreach ((array) $raw as $addr) {
            $addr = Users::normalizeEmail((string) $addr);
            if ($addr === '') {
                continue;
            }
            if (strlen($addr) > 120 || !filter_var($addr, FILTER_VALIDATE_EMAIL) || preg_match('/[^\x21-\x7E]/', $addr)) {
                $errors['recipients'] = 'invalid_email';
                break;
            }
            $to[$addr] = true;
        }
        $me = (string) ($this->session['email'] ?? '');
        if (!empty($in['copyMe']) && $me !== '') {
            $to[$me] = true;
        }
        if (!$to && !$errors) {
            $errors['recipients'] = 'required';
        }
        if (count($to) > StatsReport::MAX_RECIPIENTS + 1 || count(array_diff_key($to, [$me => true])) > StatsReport::MAX_RECIPIENTS) {
            $errors['recipients'] = 'too_many_recipients';
        }
        $message = trim(str_replace("\r\n", "\n", (string) ($in['message'] ?? '')));
        if (mb_strlen($message) > 500) {
            $errors['message'] = 'too_long';
        }
        $sections = array_values(array_intersect(StatsReport::SECTIONS, is_array($in['sections'] ?? null) ? $in['sections'] : StatsReport::SECTIONS));
        if ($errors) {
            throw ApiError::validation($errors);
        }
        $rl = $this->app->rateLimiter();
        if (!$rl->hit('stats_share', (string) $this->uid(), 10, 3600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $report = new StatsReport($this->app);
        $range = StatsReport::range((string) ($in['period'] ?? ''), (string) ($in['from'] ?? ''), (string) ($in['to'] ?? ''));
        $d = $report->data($range, $withLeads, $withLeads ? mb_substr((string) ($in['service'] ?? ''), 0, 80) : '');
        $lang = ($in['lang'] ?? '') === 'en' ? 'en' : 'es';
        $mail = $report->email($d, $sections, $lang, (string) ($this->session['name'] ?? ''), $message);
        $file = $this->app->storageDir('tmp') . '/' . bin2hex(random_bytes(8)) . '.csv';
        file_put_contents($file, $report->csv($d, $lang));
        $sent = 0;
        try {
            foreach (array_keys($to) as $addr) {
                $ok = $this->app->mailer()->send($mail + ['to' => $addr, 'attachments' => [['path' => $file, 'name' => $report->fileName($range), 'mime' => 'text/csv']]]);
                $sent += $ok ? 1 : 0;
            }
        } finally {
            @unlink($file);
        }
        $this->app->activity($this->uid(), 'stats_shared', '', ['period' => $range['period'], 'recipients' => count($to), 'sent' => $sent], $this->req->ip());
        if ($sent === 0) {
            throw new ApiError(502, 'email_failed');
        }
        Response::ok(['sent' => $sent, 'failed' => count($to) - $sent]);
    }

    /** Estadísticas: "stats" or "leads" access. Returns whether the contact-form figures are included. */
    private function statsAccess(): bool
    {
        $auth = $this->app->auth();
        $session = (array) $this->session;
        if (!$auth->can($session, 'stats') && !$auth->can($session, 'leads')) {
            throw new ApiError(403, 'forbidden');
        }
        return $auth->can($session, 'leads');
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
