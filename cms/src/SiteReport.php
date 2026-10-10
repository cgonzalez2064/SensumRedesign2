<?php
declare(strict_types=1);

namespace Sensum\Cms;

use Sensum\Cms\Http\ApiError;

/**
 * The monthly site report, in two versions built from the same figures:
 *  - build(): for clients (e-mail and PDF) — the value of the month in plain,
 *    positive language: results, the work done, monitoring and protection;
 *  - technical(): for the owner and the team — backups, certificates, errors,
 *    interruptions, service levels and technical to-dos. Never sent.
 * The owner previews it, chooses who receives it, and sends it; the owner is
 * always in copy. Accounts with the "report" access view both versions. If
 * the previous month's report has not been sent by the end of day 5, the
 * owner gets a reminder.
 *
 * Figures come from what the Content Manager already records: the scheduled
 * check (availability), the error log (incidents), the activity log
 * (content changes, blocked sign-ins), backups, the HTTPS certificate and —
 * when available — Google PageSpeed scores. Sections without data are left
 * out rather than shown empty.
 */
final class SiteReport
{
    public const MAX_RECIPIENTS = 20;
    public const NOTE_MAX = 600;

    public function __construct(private App $app)
    {
    }

    // ------------------------------------------------------------------ settings

    /** @return array{recipients:list<string>, lang:string} */
    public function settings(): array
    {
        $s = $this->app->settings()->getJson('report_settings');
        return [
            'recipients' => array_values(array_filter((array) ($s['recipients'] ?? []), 'is_string')),
            'lang' => ($s['lang'] ?? 'es') === 'en' ? 'en' : 'es',
        ];
    }

    /** @return array{recipients:list<string>, lang:string} */
    public function saveSettings(mixed $recipients, string $lang): array
    {
        if (!is_array($recipients) || !array_is_list($recipients)) {
            throw ApiError::validation(['recipients' => 'invalid']);
        }
        $clean = [];
        foreach ($recipients as $r) {
            $email = is_string($r) ? Users::normalizeEmail($r) : '';
            if ($email === '' || strlen($email) > 120 || !filter_var($email, FILTER_VALIDATE_EMAIL) || preg_match('/[^\x21-\x7E]/', $email)) {
                throw ApiError::validation(['recipients' => 'invalid_email']);
            }
            if ($email !== $this->ownerEmail()) { // the owner is always in copy anyway
                $clean[$email] = true;
            }
        }
        if (count($clean) > self::MAX_RECIPIENTS) {
            throw ApiError::validation(['recipients' => 'too_many']);
        }
        $settings = ['recipients' => array_keys($clean), 'lang' => $lang === 'en' ? 'en' : 'es'];
        $this->app->settings()->setJson('report_settings', $settings);
        return $settings;
    }

    public function ownerEmail(): string
    {
        return $this->app->config->ownerEmail();
    }

    // ------------------------------------------------------------------ periods

    /** 'YYYY-MM' of the month before $now (the month a report normally covers). */
    public static function previousPeriod(?int $now = null): string
    {
        return date('Y-m', strtotime('first day of last month', $now ?? time()) ?: time());
    }

    /** @return array{0:int,1:int} [start, end) timestamps of the month, in the site's time zone */
    public static function bounds(string $period): array
    {
        $start = strtotime($period . '-01 00:00:00') ?: 0;
        return [$start, strtotime('+1 month', $start) ?: $start];
    }

    /** Accepts the current month and the 12 before it. */
    public function validPeriod(string $period): string
    {
        if ($period === '') {
            return self::previousPeriod();
        }
        $allowed = [];
        for ($i = 0; $i <= 12; $i++) {
            $allowed[] = date('Y-m', (int) strtotime("first day of -{$i} month"));
        }
        if (!in_array($period, $allowed, true)) {
            throw ApiError::validation(['period' => 'invalid']);
        }
        return $period;
    }

    /** @return list<array{value:string,label:string}> */
    public function periodOptions(string $lang): array
    {
        $out = [];
        for ($i = 0; $i <= 12; $i++) {
            $p = date('Y-m', (int) strtotime("first day of -{$i} month"));
            $out[] = ['value' => $p, 'label' => $this->periodLabel($p, $lang)];
        }
        return $out;
    }

    // ------------------------------------------------------------------ content

    private function strings(string $lang): array
    {
        return require $this->app->root('lang/' . ($lang === 'en' ? 'en' : 'es') . '.php');
    }

    /** "texto|textos": picks singular or plural by $n, then fills {n}. */
    private static function plural(string $s, int $n, array $vars = []): string
    {
        $forms = explode('|', $s);
        return self::fill($forms[$n === 1 || count($forms) === 1 ? 0 : 1], ['n' => $n] + $vars);
    }

    private static function fill(string $s, array $vars): string
    {
        return strtr($s, array_combine(array_map(fn ($k) => '{' . $k . '}', array_keys($vars)), array_map('strval', array_values($vars))));
    }

    public function periodLabel(string $period, string $lang): string
    {
        $s = $this->strings($lang);
        [$y, $m] = array_map('intval', explode('-', $period));
        return self::fill($s['sr.period'], ['month' => $s['sr.months'][$m - 1], 'year' => $y]);
    }

    private function date(int $ts, string $lang): string
    {
        $s = $this->strings($lang);
        return self::fill($s['sr.date'], ['day' => date('j', $ts), 'month' => $s['sr.months'][(int) date('n', $ts) - 1], 'year' => date('Y', $ts)]);
    }

    private static function number(float $n, string $lang, int $decimals = 0): string
    {
        return number_format($n, $decimals, $lang === 'en' ? '.' : ',', $lang === 'en' ? ',' : '.');
    }

    /** "6 horas", "2 días" — readable resolution time. */
    private function duration(int $hours, string $lang): string
    {
        $s = $this->strings($lang);
        if ($hours < 1) {
            return $s['sr.time.lessHour'];
        }
        return $hours < 48 ? self::plural($s['sr.time.hours'], $hours) : self::plural($s['sr.time.days'], (int) round($hours / 24));
    }

    private function grade(int $score, string $lang): string
    {
        $s = $this->strings($lang);
        return $s['sr.grade.' . ($score >= 90 ? 'excellent' : ($score >= 75 ? 'verygood' : ($score >= 50 ? 'fair' : 'poor')))];
    }

    /** Raw figures for the month. */
    public function figures(string $period): array
    {
        [$start, $end] = self::bounds($period);
        $db = $this->app->db();
        $runs = $db->one('SELECT COUNT(*) AS n, SUM(ok) AS ok FROM monitor_runs WHERE created_at >= ? AND created_at < ?', [$start, $end]);
        $count = fn (string $sql, array $p = []) => (int) $db->value($sql, array_merge([$start, $end], $p));
        $textChanges = 0;
        foreach ($db->all("SELECT details FROM activity_log WHERE created_at >= ? AND created_at < ? AND action = 'content_updated'", [$start, $end]) as $row) {
            $textChanges += count((array) (json_decode((string) $row['details'], true)['changes'] ?? []));
        }
        $backups = glob($this->app->storage('backups/db') . '/database-*.sqlite') ?: [];
        $psi = $this->app->pageSpeed()->latest();
        // Support tickets of the month (received, resolved, still open at the end).
        $tickets = ['received' => 0, 'resolved' => 0, 'open' => 0, 'avgHours' => null, 'resolvedTitles' => []];
        try {
            $tickets['received'] = $count('SELECT COUNT(*) FROM support_reports WHERE created_at >= ? AND created_at < ?');
            $resolved = $db->all("SELECT title, created_at, resolved_at FROM support_reports WHERE resolved_at >= ? AND resolved_at < ? AND status IN ('resolved', 'closed') ORDER BY resolved_at", [$start, $end]);
            $tickets['resolved'] = count($resolved);
            if ($resolved) {
                $tickets['avgHours'] = (int) round(array_sum(array_map(fn ($r) => max(0, (int) $r['resolved_at'] - (int) $r['created_at']), $resolved)) / count($resolved) / 3600);
                $tickets['resolvedTitles'] = array_slice(array_column($resolved, 'title'), 0, 5);
            }
            $tickets['open'] = (int) $db->value("SELECT COUNT(*) FROM support_reports WHERE created_at < ? AND (status IN ('new', 'in_progress', 'waiting') OR (resolved_at IS NOT NULL AND resolved_at >= ?))", [$end, $end]);
        } catch (\Throwable) {
            // tickets not available (older database)
        }
        // Contact form messages and blocked spam (daily counts, last 60 days).
        $contact = ['sent' => 0, 'blocked' => 0];
        foreach ($this->app->settings()->getJson('contact_stats') as $day => $c) {
            $ts = is_string($day) ? strtotime($day . ' 12:00') : false;
            if ($ts !== false && $ts >= $start && $ts < $end && is_array($c)) {
                $contact['sent'] += (int) ($c['sent'] ?? 0);
                $contact['blocked'] += (int) ($c['blocked'] ?? 0);
            }
        }
        $maintenance = $this->app->maintenanceLog()->month($period);
        $maintenance['alerts'] += $count("SELECT COUNT(*) FROM error_log WHERE created_at >= ? AND created_at < ? AND alert = 'sent'");
        $tls = $this->app->settings()->getJson('tls_expiry');
        $visits = $this->app->analytics()->summary($start, $end);
        unset($visits['days']);
        $incidents = $this->app->monitor()->incidentsBetween($start, min($end, time()));
        $responseMs = $db->value('SELECT AVG(response_ms) FROM monitor_runs WHERE created_at >= ? AND created_at < ? AND response_ms IS NOT NULL', [$start, $end]);
        return [
            'checks' => (int) ($runs['n'] ?? 0),
            'availability' => (int) ($runs['n'] ?? 0) > 0 ? round(100 * (int) $runs['ok'] / (int) $runs['n'], 1) : null,
            'incidents' => $count("SELECT COUNT(*) FROM error_log WHERE created_at >= ? AND created_at < ? AND severity = 'critical'"),
            'textChanges' => $textChanges,
            'photos' => $count("SELECT COUNT(*) FROM activity_log WHERE created_at >= ? AND created_at < ? AND action = 'media_uploaded' AND target <> 'portfolio.pdf'"),
            'portfolio' => $count("SELECT COUNT(*) FROM activity_log WHERE created_at >= ? AND created_at < ? AND action = 'media_uploaded' AND target = 'portfolio.pdf'"),
            'blocked' => $count("SELECT COUNT(*) FROM activity_log WHERE created_at >= ? AND created_at < ? AND action = 'login_throttled'"),
            'supportRequests' => $count("SELECT COUNT(*) FROM activity_log WHERE created_at >= ? AND created_at < ? AND action = 'report_submitted'"),
            'https' => str_starts_with($this->app->config->appUrl(), 'https://'),
            'certificateUntil' => isset($tls['validTo']) ? (int) $tls['validTo'] : null,
            'lastBackup' => $backups ? max(array_map('filemtime', $backups)) : null,
            'lastPublished' => ((int) $this->app->settings()->get('last_published_at', '0')) ?: null,
            // Scores older than ~6 weeks are not shown as this month's.
            'pagespeed' => isset($psi['fetchedAt'], $psi['mobile'], $psi['desktop']) && time() - (int) $psi['fetchedAt'] < 45 * 86400 ? $psi : null,
            'tickets' => $tickets,
            'contact' => $contact,
            'maintenance' => $maintenance,
            'leads' => $this->app->leads()->stats($start, $end),
            'leadsWaiting' => (int) $db->value("SELECT COUNT(*) FROM leads WHERE status = 'new' AND created_at < ?", [$end]),
            'downtime' => ['incidents' => count($incidents), 'minutes' => array_sum(array_column($incidents, 'minutes'))],
            'responseMs' => $responseMs !== null ? (int) round((float) $responseMs) : null,
            'visits' => $visits,
            'service' => (new Tickets($this->app))->serviceLevels($start, $end),
        ];
    }

    /**
     * Change against the previous month for a KPI: direction, a short text
     * ("+15 % vs. agosto") and whether it is good news (null = neutral).
     * Null when there is nothing to compare with.
     */
    private function trend(float|int|null $now, float|int|null $before, string $lang, string $prevMonth, ?bool $higherIsBetter = true, bool $points = false): ?array
    {
        if ($now === null || $before === null || (!$points && $before == 0)) {
            return null;
        }
        $s = $this->strings($lang);
        if ($points) {
            $diff = round((float) $now - (float) $before, 1);
            $change = self::number(abs($diff), $lang, fmod(abs($diff), 1.0) === 0.0 ? 0 : 1) . ' ' . $s['sr.trend.points'];
        } else {
            $diff = (float) round(100 * ((float) $now - (float) $before) / (float) $before);
            $change = self::number(abs($diff), $lang) . ($lang === 'en' ? '%' : ' %');
        }
        if ($diff == 0) {
            return ['dir' => 'flat', 'text' => self::fill($s['sr.trend.same'], ['month' => $prevMonth]), 'good' => null];
        }
        return [
            'dir' => $diff > 0 ? 'up' : 'down',
            'text' => self::fill($s['sr.trend.vs'], ['change' => ($diff > 0 ? '+' : '-') . $change, 'month' => $prevMonth]),
            'good' => $higherIsBetter === null ? null : ($diff > 0) === $higherIsBetter,
        ];
    }

    /** "A, B y C" in the report's language. */
    private static function listJoin(array $items, string $and): string
    {
        $items = array_values($items);
        if (count($items) < 2) {
            return (string) ($items[0] ?? '');
        }
        $last = array_pop($items);
        return implode(', ', $items) . ' ' . $and . ' ' . $last;
    }

    /** @var array<string, array<string, mixed>> figures per month (a preview builds both versions) */
    private array $figuresCache = [];

    private function monthFigures(string $period): array
    {
        return $this->figuresCache[$period] ??= $this->figures($period);
    }

    private static function monthBefore(string $period): string
    {
        return date('Y-m', strtotime($period . '-01 -1 month') ?: time());
    }

    /** "100 %", "99,9 %", "99,95 %": as many decimals as the figure needs (max 2). */
    private static function pct(float $v, string $lang): string
    {
        return self::number($v, $lang, fmod($v, 1.0) === 0.0 ? 0 : (fmod($v * 10, 1.0) === 0.0 ? 1 : 2)) . ($lang === 'en' ? '%' : ' %');
    }

    /** "Visitas: 931 y 12 mensajes" — the visits/leads sentence both versions share. */
    private function visitsSentence(array $s, int $visitors, int $leads, string $lang): string
    {
        $visits = self::plural($s['sr.summary.visitsPart'], $visitors, ['count' => self::number($visitors, $lang)]);
        if ($visitors > 0) {
            return $leads > 0
                ? self::fill($s['sr.summary.visitsLeads'], ['visits' => $visits, 'leads' => self::plural($s['sr.summary.leadsPart'], $leads)])
                : self::fill($s['sr.summary.visitsOnly'], ['visits' => $visits]);
        }
        return $leads > 0 ? self::plural($s['sr.summary.leadsOnly'], $leads) : '';
    }

    /**
     * The report for clients (e-mail, PDF, preview): plain language and the
     * value of the month — the site's results, the work done and the
     * monitoring and protection behind it. Comparisons with the month before
     * appear only when they are good news. No technical details (backups,
     * certificates, DNS, errors): those are in technical(), for the team.
     */
    public function build(string $period, string $lang): array
    {
        $s = $this->strings($lang);
        $f = $this->monthFigures($period);
        $month = $this->periodLabel($period, $lang);
        $prevPeriod = self::monthBefore($period);
        $p = $this->monthFigures($prevPeriod);
        $prevMonth = $s['sr.months'][(int) substr($prevPeriod, 5, 2) - 1];
        $up = function ($now, $before, bool $points = false) use ($lang, $prevMonth): ?array {
            $t = $this->trend($now, $before, $lang, $prevMonth, true, $points);
            return $t && $t['good'] === true ? $t : null;
        };
        $leadsNow = $f['leads']['received'] ?: $f['contact']['sent'];
        $leadsBefore = $p['leads']['received'] ?: $p['contact']['sent'];
        $visitors = (int) $f['visits']['visitors'];
        $pctSign = $lang === 'en' ? '%' : ' %';
        $pct = $f['availability'] !== null ? self::pct((float) $f['availability'], $lang) : null;
        $changes = $f['textChanges'] + $f['photos'] + $f['portfolio'];
        $prevChanges = $p['textChanges'] + $p['photos'] + $p['portfolio'];
        $threats = $f['blocked'] + $f['contact']['blocked'];
        $tk = $f['tickets'];
        $sv = $f['service'];
        $m = $f['maintenance'];
        $score = $f['pagespeed'] ? (int) $f['pagespeed']['mobile']['performance'] : null;

        // ---- Summary: the results, then the work and the care behind them.
        $summary = $pct !== null ? self::fill($s['sr.c.summary.uptime'], ['month' => $month, 'pct' => $pct]) : self::fill($s['sr.c.summary.online'], ['month' => $month]);
        $visitsLine = $this->visitsSentence($s, $visitors, $leadsNow, $lang);
        $summary .= $visitsLine !== '' ? ' ' . $visitsLine : '';
        $parts = array_values(array_filter([
            $f['textChanges'] > 0 ? self::plural($s['sr.summary.texts'], $f['textChanges']) : null,
            $f['photos'] > 0 ? self::plural($s['sr.summary.photos'], $f['photos']) : null,
            $f['portfolio'] > 0 ? $s['sr.summary.portfolio'] : null,
        ]));
        if ($parts) {
            $sentence = self::listJoin($parts, $s['sr.and']);
            $summary .= ' ' . mb_strtoupper(mb_substr($sentence, 0, 1)) . mb_substr($sentence, 1) . '.';
        }
        if ($tk['resolved'] > 0) {
            $summary .= ' ' . self::plural($s['sr.c.summary.support'], $tk['resolved']);
        }
        if ($f['checks'] > 0) {
            $summary .= ' ' . self::plural($s['sr.c.summary.monitoring'], $f['checks'], ['count' => self::number($f['checks'], $lang)]);
        }
        if ($threats > 0) {
            $summary .= ' ' . self::plural($s['sr.c.summary.protection'], $threats);
        }

        // ---- Key figures: what the site achieved and the work behind it.
        $kpis = [];
        if ($pct !== null) {
            $kpis[] = ['label' => $s['sr.kpi.availability'], 'value' => $pct, 'note' => $s['sr.c.kpi.availabilityNote'], 'trend' => $up($f['availability'], $p['availability'], true)];
        }
        if ($visitors > 0) {
            $kpis[] = ['label' => $s['sr.kpi.visits'], 'value' => self::number($visitors, $lang), 'note' => self::plural($s['sr.kpi.visitsNote'], (int) $f['visits']['views'], ['count' => self::number((int) $f['visits']['views'], $lang)]),
                'trend' => $p['visits']['visitors'] > 0 ? $up($visitors, (int) $p['visits']['visitors']) : null];
        }
        if ($leadsNow > 0) {
            $clicks = (int) $f['visits']['contacts'];
            $kpis[] = ['label' => $s['sr.kpi.leads'], 'value' => self::number($leadsNow, $lang), 'note' => $clicks > 0 ? self::plural($s['sr.kpi.leadsClicks'], $clicks) : $s['sr.kpi.leadsNote'], 'trend' => $up($leadsNow, $leadsBefore)];
        }
        if ($f['checks'] > 0) {
            $kpis[] = ['label' => $s['sr.c.kpi.checks'], 'value' => self::number($f['checks'], $lang), 'note' => $s['sr.c.kpi.checksNote'], 'trend' => null];
        }
        if ($changes > 0) {
            $kpis[] = ['label' => $s['sr.kpi.updates'], 'value' => (string) $changes, 'note' => $s['sr.kpi.updatesNote'], 'trend' => $up($changes, $prevChanges)];
        }
        if ($threats > 0) {
            $kpis[] = ['label' => $s['sr.c.kpi.protection'], 'value' => self::number($threats, $lang), 'note' => $s['sr.c.kpi.protectionNote'], 'trend' => null];
        }
        if ($tk['resolved'] > 0) {
            $kpis[] = ['label' => $s['sr.c.kpi.support'], 'value' => (string) $tk['resolved'], 'note' => $s['sr.c.kpi.supportNote'], 'trend' => null];
        }
        if ($score !== null && $score >= 90) {
            $kpis[] = ['label' => $s['sr.kpi.google'], 'value' => $score . '/100', 'note' => $this->grade($score, $lang), 'trend' => null];
        }
        $kpis = array_slice($kpis, 0, 6);

        $sections = [];
        // ---- Highlights: the best news of the month.
        $highlights = [];
        $vt = $p['visits']['visitors'] > 0 ? $up($visitors, (int) $p['visits']['visitors']) : null;
        if ($vt) {
            $highlights[] = self::fill($s['sr.hl.visitsUp'], ['change' => ltrim(explode(' vs.', $vt['text'])[0], '+'), 'month' => $prevMonth]);
        }
        if ($f['leads']['won'] > 0) {
            $highlights[] = self::plural($s['sr.hl.won'], $f['leads']['won'], ['amount' => $f['leads']['wonAmount'] > 0 ? ' ' . self::fill($s['sr.hl.wonAmount'], ['amount' => 'Q ' . self::number($f['leads']['wonAmount'], $lang)]) : '']);
        } elseif ($leadsNow > 0) {
            $highlights[] = self::plural($s['sr.hl.leads'], $leadsNow);
        }
        if ($pct !== null && $f['availability'] >= 99.9) {
            $highlights[] = self::fill($s['sr.hl.uptime'], ['pct' => $pct]);
        }
        if ($threats > 0) {
            $highlights[] = self::plural($s['sr.hl.protected'], $threats);
        }
        if ($score !== null && $score >= 90) {
            $highlights[] = self::fill($s['sr.hl.speed'], ['score' => $score]);
        }
        if ($tk['resolved'] > 0) {
            $highlights[] = $sv['ratings'] > 0 && $sv['ratingAvg'] >= 4
                ? self::plural($s['sr.hl.supportRated'], $tk['resolved'], ['avg' => self::number((float) $sv['ratingAvg'], $lang, 1)])
                : self::plural($s['sr.hl.support'], $tk['resolved']);
        }
        if ($changes > 0) {
            $highlights[] = self::plural($s['sr.hl.content'], $changes);
        }
        if (count($highlights) < 3 && $f['checks'] > 0) {
            $highlights[] = self::plural($s['sr.hl.monitored'], $f['checks'], ['count' => self::number($f['checks'], $lang)]);
        }
        if ($highlights) {
            $sections[] = ['title' => $s['sr.sec.highlights'], 'intro' => null, 'items' => array_slice($highlights, 0, 3)];
        }

        // ---- Visits and potential clients
        $reach = [];
        if ($visitors > 0) {
            $reach[] = self::fill($s['sr.visits.total'], ['visits' => self::plural($s['sr.summary.visitsPart'], $visitors, ['count' => self::number($visitors, $lang)]),
                'views' => self::number((int) $f['visits']['views'], $lang)]) . ($vt ? ' (' . $vt['text'] . ')' : '') . '.';
            $total = array_sum($f['visits']['sources']);
            $top = array_slice($f['visits']['sources'], 0, 3, true);
            if ($total > 0 && $top) {
                $reach[] = self::fill($s['sr.visits.sources'], ['list' => self::listJoin(array_map(fn ($k, $n) => ($s['sr.source.' . $k] ?? $k) . ' (' . self::number(round(100 * $n / $total), $lang) . $pctSign . ')', array_keys($top), $top), $s['sr.and'])]);
            }
            $devices = array_sum($f['visits']['devices']);
            if ($devices > 0) {
                $reach[] = self::fill($s['sr.visits.mobile'], ['pct' => self::number(round(100 * ($f['visits']['devices']['mobile'] ?? 0) / $devices), $lang)]);
            }
        }
        $ck = $f['visits']['clicks'];
        $contactClicks = array_filter(['whatsapp' => $ck['whatsapp'], 'phone' => $ck['phone'], 'email' => $ck['email']]);
        if ($contactClicks) {
            $reach[] = self::fill($s['sr.visits.clicks'], ['list' => self::listJoin(array_map(fn ($k, $n) => self::plural($s['sr.click.' . $k], $n), array_keys($contactClicks), $contactClicks), $s['sr.and'])]);
        }
        $interest = array_filter(['map' => $ck['map'], 'portfolio' => $ck['portfolio'], 'social' => $ck['social']]);
        if ($interest) {
            $reach[] = self::fill($s['sr.visits.interest'], ['list' => self::listJoin(array_map(fn ($k, $n) => self::plural($s['sr.click.' . $k], $n), array_keys($interest), $interest), $s['sr.and'])]);
        }
        $ld = $f['leads'];
        if ($leadsNow > 0) {
            $t = $up($leadsNow, $leadsBefore);
            $reach[] = self::plural($s['sr.leads.received'], $leadsNow) . ($t ? ' (' . $t['text'] . ')' : '') . '.';
            $services = array_slice(array_filter($ld['byService'], fn ($k) => $k !== '', ARRAY_FILTER_USE_KEY), 0, 3, true);
            if ($services) {
                $reach[] = self::fill($s['sr.leads.services'], ['list' => self::listJoin(array_map(fn ($k, $n) => $k . ' (' . $n . ')', array_keys($services), $services), $s['sr.and'])]);
            }
            $follow = array_filter(['contacted' => $ld['contacted'], 'quoted' => $ld['quoted'], 'won' => $ld['won']]);
            if ($follow) {
                $reach[] = self::fill($s['sr.leads.followUp'], ['list' => self::listJoin(array_map(fn ($k, $n) => self::plural($s['sr.leads.' . $k], $n), array_keys($follow), $follow), $s['sr.and'])]);
            }
            if ($ld['wonAmount'] > 0) {
                $reach[] = self::fill($s['sr.leads.wonAmount'], ['amount' => 'Q ' . self::number($ld['wonAmount'], $lang)]);
            }
            if ($ld['avgResponseHours'] !== null && $ld['avgResponseHours'] <= 48) {
                $reach[] = self::fill($s['sr.leads.response'], ['time' => $this->duration((int) round($ld['avgResponseHours']), $lang)]);
            }
        }
        if ($reach) {
            $sections[] = ['title' => $s['sr.sec.reach'], 'intro' => $visitors > 0 ? $s['sr.sec.reachIntro'] : null, 'items' => $reach];
        }

        // ---- The work done this month (content and support)
        $work = [];
        if ($f['textChanges'] > 0) {
            $work[] = self::plural($s['sr.content.texts'], $f['textChanges']);
        }
        if ($f['photos'] > 0) {
            $work[] = self::plural($s['sr.content.photos'], $f['photos']);
        }
        if ($f['portfolio'] > 0) {
            $work[] = $s['sr.content.portfolio'];
        }
        if ($tk['received'] > 0) {
            $work[] = $tk['resolved'] > 0
                ? self::plural($s['sr.c.work.support'], $tk['received'], ['resolved' => self::plural($s['sr.support.resolvedPart'], $tk['resolved'])])
                : self::plural($s['sr.c.work.supportOpen'], $tk['received']);
        } elseif ($tk['resolved'] > 0) {
            $work[] = self::plural($s['sr.support.resolvedOnly'], $tk['resolved']);
        }
        if ($sv['avgFirstResponseHours'] !== null && $sv['avgFirstResponseHours'] <= max(24, (int) $sv['targetHours'])) {
            $work[] = self::fill($s['sr.c.work.firstResponse'], ['time' => $this->duration((int) round($sv['avgFirstResponseHours']), $lang)]);
        }
        if ($sv['ratings'] > 0 && $sv['ratingAvg'] >= 4) {
            $work[] = self::fill($s['sr.c.work.rating'], ['avg' => self::number((float) $sv['ratingAvg'], $lang, 1)]);
        }
        foreach ($tk['resolvedTitles'] as $title) {
            $work[] = self::fill($s['sr.support.done'], ['title' => $title]);
        }
        if (!$work) {
            $work[] = $s['sr.c.work.none'];
        }
        $sections[] = ['title' => $s['sr.c.sec.work'], 'intro' => $s['sr.c.sec.workIntro'], 'items' => $work];

        // ---- Monitoring and protection: the automatic work, in plain words
        $care = array_values(array_filter([
            $f['checks'] > 0 ? self::plural($s['sr.c.care.checks'], $f['checks'], ['count' => self::number($f['checks'], $lang)]) : null,
            $f['checks'] > 0 ? $s['sr.c.care.alerts'] : null,
            $m['integrity'] > 0 ? self::plural($s['sr.c.care.integrity'], $m['integrity'], ['count' => self::number($m['integrity'], $lang)]) : null,
            $f['https'] && $m['certificate'] > 0 ? $s['sr.c.care.secure'] : null,
            $f['blocked'] > 0 ? self::plural($s['sr.c.care.blocked'], $f['blocked']) : null,
            $f['contact']['blocked'] > 0 ? self::plural($s['sr.c.care.spam'], $f['contact']['blocked']) : null,
            $score !== null && $score >= 75 ? self::fill($s['sr.c.care.google'], ['score' => $score, 'grade' => mb_strtolower($this->grade($score, $lang))]) : null,
            $f['responseMs'] !== null && $f['responseMs'] < 2000 ? self::fill($s['sr.c.care.speed'], ['time' => $this->seconds($f['responseMs'], $lang)]) : null,
        ]));
        if ($care) {
            $sections[] = ['title' => $s['sr.c.sec.care'], 'intro' => $s['sr.c.sec.careIntro'], 'items' => $care];
        }

        // ---- Next steps the client can take (technical items go to the team's detail)
        $next = [];
        if ($f['leadsWaiting'] > 0) {
            $next[] = self::plural($s['sr.c.next.leads'], $f['leadsWaiting']);
        }
        if ($changes === 0 && $prevChanges === 0) {
            $next[] = $s['sr.next.content'];
        }
        if ($next) {
            $sections[] = ['title' => $s['sr.c.sec.next'], 'intro' => $s['sr.c.sec.nextIntro'], 'items' => $next];
        }

        $headline = $leadsNow > 0
            ? self::plural($s['sr.c.headline.leads'], $leadsNow, ['month' => $month])
            : ($pct !== null && $f['availability'] >= 99.9 && $f['downtime']['incidents'] === 0
                ? self::fill($s['sr.headline.perfect'], ['month' => $month])
                : ($visitors > 0 ? self::plural($s['sr.c.headline.visits'], $visitors, ['count' => self::number($visitors, $lang), 'month' => $month]) : self::fill($s['sr.c.headline.work'], ['month' => $month])));
        return [
            'audience' => 'client',
            'period' => $period,
            'periodLabel' => $month,
            'lang' => $lang,
            'status' => 'good',
            'statusLabel' => $s[$f['checks'] > 0 ? 'sr.c.pill.monitored' : 'sr.c.pill.online'],
            'headline' => $headline,
            'summary' => $summary,
            'kpis' => $kpis,
            'sections' => $sections,
            'siteUrl' => $this->app->config->appUrl(),
            'subject' => self::fill($s['sr.subject'], ['month' => $month]),
            'previousPeriod' => $prevPeriod,
            'figures' => $f,
        ];
    }

    /**
     * The technical detail of the month, for the owner and the team (never
     * sent to clients): interruptions, errors, security and backups,
     * certificates and domain, Google scores, service levels, the automatic
     * maintenance and what needs attention. Comparisons in both directions.
     */
    public function technical(string $period, string $lang): array
    {
        $s = $this->strings($lang);
        $f = $this->monthFigures($period);
        $month = $this->periodLabel($period, $lang);
        $prevPeriod = self::monthBefore($period);
        $p = $this->monthFigures($prevPeriod);
        $prevMonth = $s['sr.months'][(int) substr($prevPeriod, 5, 2) - 1];
        $trend = fn ($now, $before, ?bool $higherIsBetter = true, bool $points = false) => $this->trend($now, $before, $lang, $prevMonth, $higherIsBetter, $points);
        $pct = $f['availability'] !== null ? self::pct((float) $f['availability'], $lang) : null;
        $down = $f['downtime'];
        $m = $f['maintenance'];
        $tk = $f['tickets'];
        [$start, $end] = self::bounds($period);

        // Security: exactly what needs attention. (A local or test address is not expected to have HTTPS.)
        $publicSite = !preg_match('#^https?://(localhost|127\.[0-9.]+|\[::1\]|[^/:]+\.(test|localhost|local|example))([:/]|$)#i', $this->app->config->appUrl());
        $noHttps = !$f['https'] && $publicSite;
        $staleBackup = $f['lastBackup'] && $f['lastBackup'] < time() - 7 * 86400;
        $securityIssues = array_values(array_filter([
            $noHttps ? $s['sr.kpi.secNoHttps'] : null,
            !$f['lastBackup'] ? $s['sr.kpi.secNoBackup'] : ($staleBackup ? $s['sr.kpi.secOldBackup'] : null),
            $f['https'] && $f['certificateUntil'] && $f['certificateUntil'] < time() + 7 * 86400 ? $s['sr.kpi.secCertSoon'] : null,
        ]));
        $good = $f['incidents'] === 0 && ($f['availability'] === null || $f['availability'] >= 99) && !$securityIssues;
        $errors = ['critical' => 0, 'error' => 0, 'warning' => 0];
        foreach ($this->app->db()->all('SELECT severity, COUNT(*) AS n FROM error_log WHERE created_at >= ? AND created_at < ? GROUP BY severity', [$start, $end]) as $row) {
            $errors[(string) $row['severity']] = (int) $row['n'];
        }

        $summary = $pct !== null
            ? self::fill($s['sr.summary.uptime'], ['month' => $month, 'pct' => $pct, 'interruptions' => $down['incidents'] > 0
                ? self::plural($s['sr.summary.interruptions'], $down['incidents'], ['time' => $this->minutes($down['minutes'], $lang)])
                : $s['sr.summary.noInterruptions']])
            : self::fill($s['sr.summary.noUptime'], ['month' => $month]);
        if ($f['incidents'] > 0) {
            $summary .= ' ' . self::plural($s['sr.summary.incidents'], $f['incidents']);
        }
        if ($securityIssues) {
            $summary .= ' ' . self::fill($s['sr.t.summary.attention'], ['list' => self::listJoin($securityIssues, $s['sr.and'])]);
        }

        // ---- Key figures
        $kpis = [];
        if ($pct !== null) {
            $kpis[] = ['label' => $s['sr.kpi.availability'], 'value' => $pct,
                'note' => $down['incidents'] > 0 ? self::plural($s['sr.kpi.availabilityDown'], $down['incidents'], ['time' => $this->minutes($down['minutes'], $lang)]) : $s['sr.kpi.availabilityNote'],
                'trend' => $trend($f['availability'], $p['availability'], true, true)];
        }
        $kpis[] = ['label' => $s['sr.t.kpi.downtime'], 'value' => (string) $down['incidents'],
            'note' => $down['incidents'] > 0 ? self::fill($s['sr.t.kpi.downtimeNote'], ['time' => $this->minutes($down['minutes'], $lang)]) : $s['sr.t.kpi.downtimeNone'],
            'trend' => $trend($down['incidents'], $p['downtime']['incidents'], false)];
        if ($f['responseMs'] !== null) {
            $kpis[] = ['label' => $s['sr.kpi.speed'], 'value' => $this->seconds($f['responseMs'], $lang), 'note' => $s['sr.kpi.speedNote'],
                'trend' => $p['responseMs'] !== null ? $trend($f['responseMs'], $p['responseMs'], false) : null];
        }
        $kpis[] = ['label' => $s['sr.t.kpi.errors'], 'value' => (string) $errors['critical'],
            'note' => self::plural($s['sr.t.errorN'], $errors['error']) . ' · ' . self::plural($s['sr.t.warningN'], $errors['warning']), 'trend' => $trend($f['incidents'], $p['incidents'], false)];
        $kpis[] = ['label' => $s['sr.t.kpi.backup'], 'value' => $f['lastBackup'] ? date('d/m/Y', (int) $f['lastBackup']) : '—',
            'note' => $f['lastBackup'] ? self::plural($s['sr.auto.backups'], $m['backups']) : $s['sr.security.noBackup'], 'trend' => null];
        $kpis[] = ['label' => $s['sr.kpi.security'], 'value' => $securityIssues ? $s['sr.kpi.attention'] : $s['sr.kpi.secure'],
            'note' => $securityIssues ? implode(' · ', $securityIssues) : ($f['blocked'] > 0 ? self::plural($s['sr.kpi.blocked' . ($f['https'] ? '' : 'Local')], $f['blocked']) : $s['sr.kpi.noThreats' . ($f['https'] ? '' : 'Local')]), 'trend' => null];

        $sections = [];
        // ---- Uptime, interruptions, speed and errors
        $uptime = [];
        if ($pct !== null) {
            $uptime[] = $down['incidents'] > 0
                ? self::plural($s['sr.uptime.withDown'], $down['incidents'], ['pct' => $pct, 'time' => $this->minutes($down['minutes'], $lang)])
                : self::fill($s['sr.uptime.full'], ['pct' => $pct]);
            $uptime[] = self::fill($s['sr.uptime.checks'], ['count' => self::number($f['checks'], $lang)]);
        }
        foreach (array_slice($this->app->monitor()->incidentsBetween($start, min($end, time()), true), 0, 10) as $i) {
            $uptime[] = self::plural($s['sr.t.incident'], (int) $i['checks'], ['date' => $this->date((int) $i['start'], $lang) . ', ' . date('H:i', (int) $i['start']),
                'time' => $this->minutes((int) $i['minutes'], $lang), 'failed' => $i['failed'] ? implode(', ', $i['failed']) : '—']);
        }
        if ($f['responseMs'] !== null) {
            $uptime[] = self::fill($s['sr.uptime.speed'], ['time' => $this->seconds($f['responseMs'], $lang), 'grade' => $f['responseMs'] < 800 ? $s['sr.uptime.fast'] : ($f['responseMs'] < 2000 ? $s['sr.uptime.ok'] : $s['sr.uptime.slow'])]);
        }
        $uptime[] = self::fill($s['sr.t.errors'], ['critical' => self::plural($s['sr.t.criticalN'], $errors['critical']),
            'errors' => self::plural($s['sr.t.errorN'], $errors['error']), 'warnings' => self::plural($s['sr.t.warningN'], $errors['warning'])]);
        $sections[] = ['title' => $s['sr.sec.uptime'], 'intro' => $s['sr.sec.uptimeIntro'], 'items' => $uptime];

        // ---- Security and backups
        $security = [];
        if ($f['https']) {
            $security[] = $f['certificateUntil'] && $f['certificateUntil'] > time() ? self::fill($s['sr.security.httpsUntil'], ['date' => $this->date($f['certificateUntil'], $lang)]) : $s['sr.security.https'];
        } elseif ($noHttps) {
            $security[] = $s['sr.security.noHttps'];
        }
        $dh = $this->app->domainHealth()->latest();
        if (!empty($dh['spf']['ok']) && !empty($dh['dkim']['ok']) && !empty($dh['dmarc']['ok'])) {
            $security[] = $s['sr.security.emailAuth'];
        }
        if (!empty($dh['expiry']['validTo']) && (int) $dh['expiry']['validTo'] > time()) {
            $security[] = self::fill($s['sr.security.domainUntil'], ['domain' => (string) $dh['domain'], 'date' => $this->date((int) $dh['expiry']['validTo'], $lang)]);
        }
        $security[] = $f['blocked'] > 0 ? self::plural($s['sr.security.blocked'], $f['blocked']) : $s['sr.security.noThreats'];
        if ($f['contact']['blocked'] > 0) {
            $security[] = self::plural($s['sr.security.spam'], $f['contact']['blocked']);
        }
        $security[] = $f['lastBackup'] ? self::fill($s['sr.security.backup'], ['date' => $this->date($f['lastBackup'], $lang)]) : $s['sr.security.noBackup'];
        $sections[] = ['title' => $s['sr.sec.security'], 'intro' => null, 'items' => $security];

        if ($f['pagespeed']) {
            $ps = $f['pagespeed'];
            $line = fn (string $key, int $score) => self::fill($s[$key], ['score' => $score, 'grade' => mb_strtolower($this->grade($score, $lang))]);
            $sections[] = ['title' => $s['sr.sec.visibility'], 'intro' => $s['sr.sec.visibilityIntro'], 'items' => [
                $line('sr.psi.mobile', (int) $ps['mobile']['performance']),
                $line('sr.psi.desktop', (int) $ps['desktop']['performance']),
                $line('sr.psi.seo', (int) $ps['mobile']['seo']),
                $line('sr.psi.accessibility', (int) $ps['mobile']['accessibility']),
            ]];
        }

        // ---- Technical support (all of it, including what is still open)
        $support = [$f['incidents'] === 0 ? $s['sr.support.noIncidents'] : self::plural($s['sr.support.incidents'], $f['incidents'])];
        if ($tk['received'] > 0 || $tk['resolved'] > 0) {
            $support[] = $tk['received'] > 0
                ? self::plural($s['sr.support.received'], $tk['received'], ['resolved' => self::plural($s['sr.support.resolvedPart'], $tk['resolved'])])
                : self::plural($s['sr.support.resolvedOnly'], $tk['resolved']);
            $sv = $f['service'];
            if ($sv['avgFirstResponseHours'] !== null) {
                $support[] = self::fill($s['sr.support.firstResponse'], ['time' => $this->duration((int) round($sv['avgFirstResponseHours']), $lang),
                    'pct' => (string) $sv['withinTarget'], 'target' => $this->duration($sv['targetHours'], $lang)]);
            }
            if ($tk['avgHours'] !== null) {
                $support[] = self::fill($s['sr.support.avg'], ['time' => $this->duration($tk['avgHours'], $lang)]);
            }
            if ($sv['ratings'] > 0) {
                $support[] = self::plural($s['sr.support.rating'], $sv['ratings'], ['avg' => self::number((float) $sv['ratingAvg'], $lang, 1)]);
            }
            if ($tk['open'] > 0) {
                $support[] = self::plural($s['sr.support.open'], $tk['open']);
            }
        } elseif ($f['supportRequests'] > 0) {
            $support[] = self::plural($s['sr.support.requests'], $f['supportRequests']);
        }
        $sections[] = ['title' => $s['sr.sec.support'], 'intro' => null, 'items' => $support];

        // ---- Automatic maintenance (everything the system did)
        $auto = array_values(array_filter([
            $f['checks'] > 0 ? self::plural($s['sr.auto.checks'], $f['checks'], ['count' => self::number($f['checks'], $lang)]) : null,
            $m['integrity'] > 0 ? self::plural($s['sr.auto.integrity'], $m['integrity'], ['count' => self::number($m['integrity'], $lang)]) : null,
            $m['backups'] > 0 ? self::plural($s['sr.auto.backups'], $m['backups']) : null,
            $m['offsite'] > 0 ? self::plural($s['sr.auto.offsite'], $m['offsite']) : null,
            $m['certificate'] > 0 ? self::plural($s['sr.auto.certificate'], $m['certificate']) : null,
            $m['pagespeed'] > 0 ? self::plural($s['sr.auto.pagespeed'], $m['pagespeed']) : null,
            $m['dns'] > 0 ? self::plural($s['sr.auto.dns'], $m['dns']) : null,
            $f['contact']['blocked'] > 0 ? self::plural($s['sr.auto.spam'], $f['contact']['blocked']) : null,
            $f['service']['autoClosed'] > 0 ? self::plural($s['sr.auto.autoClosed'], $f['service']['autoClosed']) : null,
            $m['alerts'] > 0 ? self::plural($s['sr.auto.alerts'], $m['alerts']) : null,
        ]));
        if ($auto) {
            $sections[] = ['title' => $s['sr.sec.auto'], 'intro' => $s['sr.sec.autoIntro'], 'items' => $auto];
        }

        // ---- Technical to-dos
        $next = [];
        if ($noHttps) {
            $next[] = $s['sr.next.https'];
        }
        if (!$f['lastBackup'] || $staleBackup) {
            $next[] = $s['sr.next.backup'];
        }
        if (!empty($dh['expiry']['validTo']) && (int) $dh['expiry']['validTo'] - time() < 60 * 86400 && (int) $dh['expiry']['validTo'] > time()) {
            $next[] = self::fill($s['sr.next.domain'], ['date' => $this->date((int) $dh['expiry']['validTo'], $lang)]);
        }
        if ($f['pagespeed'] && (int) $f['pagespeed']['mobile']['performance'] < 75) {
            $next[] = $s['sr.next.speed'];
        }
        if ($tk['open'] > 0) {
            $next[] = self::plural($s['sr.next.tickets'], $tk['open']);
        }
        if ($next) {
            $sections[] = ['title' => $s['sr.t.sec.pending'], 'intro' => null, 'items' => $next];
        }

        $state = $good ? 'good' : 'attention';
        return [
            'audience' => 'technical',
            'period' => $period,
            'periodLabel' => $month,
            'lang' => $lang,
            'status' => $state,
            'statusLabel' => $s['sr.status.' . $state],
            'headline' => self::fill($s['sr.t.headline.' . $state], ['month' => $month]),
            'summary' => $summary,
            'kpis' => $kpis,
            'sections' => $sections,
        ];
    }

    /** "35 min", "2 h 10 min", "1 día" — downtime. */
    private function minutes(int $minutes, string $lang): string
    {
        $s = $this->strings($lang);
        if ($minutes < 60) {
            return self::fill($s['sr.time.min'], ['n' => max(1, $minutes)]);
        }
        if ($minutes < 2880) {
            $h = intdiv($minutes, 60);
            $m = $minutes % 60;
            return self::plural($s['sr.time.hours'], $h) . ($m ? ' ' . self::fill($s['sr.time.min'], ['n' => $m]) : '');
        }
        return self::plural($s['sr.time.days'], (int) round($minutes / 1440));
    }

    /** "0,4 s" — page load time. */
    private function seconds(int $ms, string $lang): string
    {
        return $ms < 100 ? '< ' . self::number(0.1, $lang, 1) . ' s' : self::number($ms / 1000, $lang, $ms < 10000 ? 1 : 0) . ' s';
    }

    // ------------------------------------------------------------------ e-mail

    /** Green when the change is good news, red when it is not, grey when neutral. */
    private static function trendColor(array $t): string
    {
        return $t['good'] === null ? '#5f6368' : ($t['good'] ? '#1a7f45' : '#b42318');
    }

    public function email(array $r, array $to, array $cc, string $note, bool $test, bool $withPdf = false): array
    {
        $s = $this->strings($r['lang']);
        $e = fn (string $v) => Emails::esc($v);
        [$pillBg, $pillFg] = $r['status'] === 'good' ? ['#e8f6ee', '#1a7f45'] : ['#fff4e0', '#a15c00'];

        $kpiCells = '';
        foreach ($r['kpis'] as $i => $k) {
            $kpiCells .= ($i % 2 === 0 && $i > 0 ? '</tr><tr>' : '')
                . '<td valign="top" width="50%" style="padding:6px"><div style="background:#f7f7f9;border-radius:14px;padding:16px">'
                . '<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#7a7a82">' . $e($k['label']) . '</div>'
                . '<div style="font-size:26px;font-weight:800;color:#1c1c1c;margin-top:4px;line-height:1.15">' . $e($k['value']) . '</div>'
                . '<div style="font-size:13px;color:#5f6368;margin-top:2px">' . $e($k['note']) . '</div>'
                . (!empty($k['trend']) ? '<div style="font-size:12px;font-weight:700;margin-top:6px;color:' . self::trendColor($k['trend']) . '">'
                    . ['up' => '&#9650;', 'down' => '&#9660;', 'flat' => '='][$k['trend']['dir']] . ' ' . $e($k['trend']['text']) . '</div>' : '')
                . '</div></td>';
        }
        $sectionsHtml = '';
        foreach ($r['sections'] as $sec) {
            $items = '';
            foreach ($sec['items'] as $it) {
                $items .= '<tr><td valign="top" width="22" style="padding:5px 0;color:#f6740a;font-size:16px;line-height:1.4">&#9679;</td>'
                    . '<td style="padding:5px 0;font-size:15px;color:#2b2b31">' . $e($it) . '</td></tr>';
            }
            $sectionsHtml .= '<h2 style="margin:26px 0 6px;font-size:16px;color:#1c1c1c">' . $e($sec['title']) . '</h2>'
                . ($sec['intro'] ? '<div style="font-size:13px;color:#7a7a82;margin-bottom:4px">' . $e($sec['intro']) . '</div>' : '')
                . '<table role="presentation" cellpadding="0" cellspacing="0">' . $items . '</table>';
        }
        $body = ($test ? '<div style="background:#e8effd;color:#1d4ed8;border-radius:10px;padding:10px 14px;font-size:13px;margin-bottom:18px">' . $e($s['sr.testBanner']) . '</div>' : '')
            . '<div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#f6740a">' . $e(self::fill($s['sr.eyebrow'], ['month' => $r['periodLabel']])) . '</div>'
            . '<h1 style="margin:8px 0 12px;font-size:24px;line-height:1.25;color:#1c1c1c">' . $e($r['headline']) . '</h1>'
            . '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:' . $pillBg . ';color:' . $pillFg . ';border-radius:999px;padding:5px 12px;font-size:12px;font-weight:700;font-family:Arial,Helvetica,sans-serif">'
            . ($r['status'] === 'good' ? '&#10003; ' : '') . $e($r['statusLabel']) . '</td></tr></table>'
            . '<p style="margin:16px 0 0;font-size:16px;line-height:1.6;color:#2b2b31">' . $e($r['summary']) . '</p>'
            . ($note !== '' ? '<div style="margin:18px 0 0;padding:14px 16px;background:#fff8f1;border-left:4px solid #f6740a;border-radius:0 12px 12px 0;white-space:pre-wrap;font-size:15px;color:#2b2b31">'
                . '<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#a15c00;margin-bottom:4px">' . $e($s['sr.noteTitle']) . '</div>' . $e($note) . '</div>' : '')
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px -6px 0"><tr>' . $kpiCells . '</tr></table>'
            . $sectionsHtml
            . ($withPdf ? '<p style="margin:22px 0 0;font-size:13px;color:#7a7a82">&#128206; ' . $e($s['sr.pdf.attached']) . '</p>' : '')
            . Emails::cta($s['sr.cta'], $r['siteUrl'] . '/');
        $footer = $e(self::fill($s['sr.footer'], ['email' => $this->ownerEmail()]));
        $layout = (new Emails($this->app))->branded($r['lang'], $s['sr.tag'], $r['summary'], $body, $footer);

        $text = ($test ? $s['sr.testBanner'] . "\n\n" : '') . self::fill($s['sr.eyebrow'], ['month' => $r['periodLabel']]) . "\n" . $r['headline'] . ' — ' . $r['statusLabel'] . "\n\n" . $r['summary'] . "\n";
        if ($note !== '') {
            $text .= "\n{$s['sr.noteTitle']}:\n{$note}\n";
        }
        $text .= "\n";
        foreach ($r['kpis'] as $k) {
            $text .= "{$k['label']}: {$k['value']} ({$k['note']}" . (!empty($k['trend']) ? '; ' . $k['trend']['text'] : '') . ")\n";
        }
        foreach ($r['sections'] as $sec) {
            $text .= "\n{$sec['title']}\n" . implode('', array_map(fn ($i) => "- {$i}\n", $sec['items']));
        }
        $text .= "\n{$r['siteUrl']}/\n\n" . self::fill($s['sr.footer'], ['email' => $this->ownerEmail()]) . "\n";

        return [
            'to' => $to,
            'cc' => $cc,
            'subject' => ($test ? $s['sr.testSubject'] . ' ' : '') . $r['subject'],
            'text' => $text,
            'html' => $layout['html'],
            'replyTo' => [$this->ownerEmail(), $s['sr.replyName']],
            'embedded' => $layout['embedded'],
        ];
    }

    // ------------------------------------------------------------------ PDF

    /** The report as a printable PDF (Letter), same content as the e-mail. */
    public function pdf(array $r, string $note = ''): string
    {
        $s = $this->strings($r['lang']);
        $doc = new Pdf($s['sr.pdf.title'] . ' — ' . $r['periodLabel']);
        $m = 48.0;                          // margins
        $w = Pdf::WIDTH - 2 * $m;            // content width
        $bottom = Pdf::HEIGHT - 64;          // last usable baseline before the footer
        $y = 0.0;
        $newPage = function (bool $first = false) use ($doc, $m, $s, $r, &$y) {
            $doc->addPage();
            if ($first) {
                $doc->rect(0, 0, Pdf::WIDTH, 104, '#1c1c1c');
                $logo = $doc->image($this->app->root('resources/email-logo.png'), $m, 30, 44, '#1c1c1c');
                $x = $logo > 0 ? $m + 58 : $m;
                $doc->text($x, 52, 'Sensum Construcciones', 18, '#ffffff', true);
                $doc->text($x, 72, $s['sr.pdf.title'] . ' · ' . $r['periodLabel'], 11, '#d0d0d6');
                $y = 140;
            } else {
                $doc->text($m, 44, 'Sensum Construcciones · ' . $s['sr.pdf.title'] . ' · ' . $r['periodLabel'], 9, '#7a7a82', true);
                $doc->line($m, 54, Pdf::WIDTH - $m, 54);
                $y = 84;
            }
        };
        $need = function (float $h) use (&$y, $bottom, $newPage) {
            if ($y + $h > $bottom) {
                $newPage();
            }
        };
        $newPage(true);

        // Title, status and summary.
        $doc->text($m, $y, mb_strtoupper(self::fill($s['sr.eyebrow'], ['month' => $r['periodLabel']])), 9, '#c25500', true);
        $y = $doc->paragraph($m, $y + 26, $w, $r['headline'], 20, '#1c1c1c', true, 1.25) + 4;
        [$pillBg, $pillFg] = $r['status'] === 'good' ? ['#e8f6ee', '#1a7f45'] : ['#fff4e0', '#a15c00'];
        $pillW = $doc->width($r['statusLabel'], 9, true) + 22;
        $doc->rect($m, $y - 12, $pillW, 20, $pillBg, null, 10);
        $doc->text($m + 11, $y + 2, $r['statusLabel'], 9, $pillFg, true);
        $y = $doc->paragraph($m, $y + 32, $w, $r['summary'], 11.5, '#2b2b31', false, 1.5) + 4;
        if ($note !== '') {
            $lines = $doc->wrap($note, $w - 30, 10.5);
            $h = 34 + count($lines) * 15;
            $need($h);
            $doc->rect($m, $y, $w, $h, '#fff8f1', null, 8);
            $doc->rect($m, $y, 4, $h, '#f6740a');
            $doc->text($m + 16, $y + 18, mb_strtoupper($s['sr.noteTitle']), 8, '#a15c00', true);
            $ly = $y + 34;
            foreach ($lines as $line) {
                $doc->text($m + 16, $ly, $line, 10.5, '#2b2b31');
                $ly += 15;
            }
            $y += $h + 10;
        }

        // KPI cards, three per row.
        $gap = 12.0;
        $cw = ($w - 2 * $gap) / 3;
        $ch = 96.0;
        $y += 8;
        foreach (array_chunk($r['kpis'], 3) as $row) {
            $need($ch + $gap);
            foreach ($row as $i => $k) {
                $x = $m + $i * ($cw + $gap);
                $doc->rect($x, $y, $cw, $ch, '#f7f7f9', '#e8e8ec', 10);
                $doc->text($x + 12, $y + 20, mb_strtoupper($k['label']), 7.5, '#7a7a82', true);
                $doc->text($x + 12, $y + 46, $k['value'], 21, '#1c1c1c', true);
                $noteLines = array_slice($doc->wrap($k['note'], $cw - 24, 8.5), 0, 2);
                $ny = $y + 62;
                foreach ($noteLines as $line) {
                    $doc->text($x + 12, $ny, $line, 8.5, '#5f6368');
                    $ny += 11;
                }
                if (!empty($k['trend'])) {
                    $color = self::trendColor($k['trend']);
                    $ty = $y + $ch - 10;
                    if ($k['trend']['dir'] === 'flat') {
                        $doc->text($x + 12, $ty, '=', 9, $color, true);
                    } else {
                        $doc->triangle($x + 16, $ty - 3, 7, $k['trend']['dir'] === 'up', $color);
                    }
                    $doc->text($x + 24, $ty, $k['trend']['text'], 8.5, $color, true);
                }
            }
            $y += $ch + $gap;
        }

        // Sections with bullet points.
        foreach ($r['sections'] as $sec) {
            $need(64);
            $y += 24;
            $doc->text($m, $y, $sec['title'], 13, '#1c1c1c', true);
            $y += 8;
            if ($sec['intro']) {
                $y = $doc->paragraph($m, $y + 12, $w, $sec['intro'], 9, '#7a7a82', false, 1.4) - 4;
            }
            $y += 8;
            foreach ($sec['items'] as $item) {
                $lines = $doc->wrap($item, $w - 16, 10.5);
                $need(count($lines) * 15 + 4);
                $doc->circle($m + 3, $y + 8, 2.4, '#f6740a');
                foreach ($lines as $line) {
                    $y += 15;
                    $doc->text($m + 14, $y - 3, $line, 10.5, '#2b2b31');
                }
                $y += 4;
            }
        }
        $need(40);
        $y += 22;
        $doc->text($m, $y, self::fill($s['sr.pdf.generated'], ['date' => $this->date(time(), $r['lang'])]), 8.5, '#7a7a82');

        // Footer on every page: site address (link) and "page n of N".
        $total = $doc->pageCount();
        $site = (string) preg_replace('#^https?://#', '', $r['siteUrl']);
        for ($n = 1; $n <= $total; $n++) {
            $doc->onPage($n, function (Pdf $d) use ($n, $total, $m, $s, $site, $r) {
                $fy = Pdf::HEIGHT - 36;
                $d->line($m, $fy - 14, Pdf::WIDTH - $m, $fy - 14);
                $d->text($m, $fy, $site, 8.5, '#c25500', true);
                $d->link($m, $fy - 10, $d->width($site, 8.5, true), 14, $r['siteUrl'] . '/');
                $d->text(Pdf::WIDTH - $m, $fy, self::fill($s['sr.pdf.page'], ['n' => $n, 'total' => $total]), 8.5, '#7a7a82', false, 'right');
            });
        }
        return $doc->output();
    }

    public function pdfName(string $period, string $lang): string
    {
        return self::fill($this->strings($lang)['sr.pdf.file'], ['period' => $period]);
    }

    /**
     * Sends the report. A test goes only to the owner and is not recorded.
     * @return array{sent:bool, to:list<string>, cc:list<string>}
     */
    public function send(string $period, int $userId, string $note, bool $test): array
    {
        $settings = $this->settings();
        $owner = $this->ownerEmail();
        $note = mb_substr(trim(str_replace("\r", '', $note)), 0, self::NOTE_MAX);
        $note = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x{202A}-\x{202E}\x{2066}-\x{2069}]/u', '', $note) ?? '';
        $report = $this->build($period, $settings['lang']);
        if ($test || !$settings['recipients']) {
            [$to, $cc] = [[$owner], []];
        } else {
            [$to, $cc] = [$settings['recipients'], [$owner]];
        }
        // The PDF version goes along as an attachment (printing, sharing with the team).
        $pdfPath = null;
        try {
            $pdfPath = $this->app->storageDir('tmp') . '/report-' . bin2hex(random_bytes(6)) . '.pdf';
            file_put_contents($pdfPath, $this->pdf($report, $note));
        } catch (\Throwable $e) {
            $this->app->logger()->warning('report_pdf_failed', ['type' => get_class($e)]);
            $pdfPath = null;
        }
        $mail = $this->email($report, $to, $cc, $note, $test, $pdfPath !== null);
        if ($pdfPath !== null) {
            $mail['attachments'] = [['path' => $pdfPath, 'name' => $this->pdfName($period, $report['lang']), 'mime' => 'application/pdf']];
        }
        $sent = $this->app->mailer()->send($mail);
        if ($pdfPath !== null) {
            @unlink($pdfPath);
        }
        if (!$test) {
            $this->app->db()->insert(
                'INSERT INTO site_reports (period, sent_at, sent_by, recipients, lang, status, summary) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [$period, time(), $userId, json_encode(array_merge($to, $cc)), $settings['lang'], $sent ? 'sent' : 'failed', json_encode($report['figures'])]
            );
        }
        return ['sent' => $sent, 'to' => $to, 'cc' => $cc];
    }

    /** @return list<array> the last 24 reports sent (or attempted) */
    public function history(): array
    {
        return array_map(fn ($r) => [
            'period' => $r['period'], 'periodLabel' => $this->periodLabel((string) $r['period'], (string) $r['lang']),
            'sentAt' => (int) $r['sent_at'], 'sentBy' => $r['name'], 'recipients' => json_decode((string) $r['recipients'], true) ?: [],
            'status' => $r['status'],
        ], $this->app->db()->all(
            'SELECT r.*, u.name FROM site_reports r LEFT JOIN users u ON u.id = r.sent_by ORDER BY r.id DESC LIMIT 24'
        ));
    }

    /** Whether the previous month's report went out, and the reminder state. */
    public function status(?int $now = null): array
    {
        $now ??= time();
        $period = self::previousPeriod($now);
        $sentAt = $this->app->db()->value("SELECT MAX(sent_at) FROM site_reports WHERE period = ? AND status = 'sent'", [$period]);
        return [
            'period' => $period,
            'sentAt' => $sentAt !== null ? (int) $sentAt : null,
            'dueDay' => 5,
            'overdue' => $sentAt === null && (int) date('j', $now) > 5,
            'reminderSentAt' => ((int) $this->app->settings()->get('report_reminder_' . $period, '0')) ?: null,
        ];
    }

    /**
     * After the 5th, e-mails the owner once if last month's report has not
     * been sent. Skipped for months before the site started being used.
     */
    public function maybeRemind(?int $now = null): bool
    {
        $now ??= time();
        $st = $this->status($now);
        if (!$st['overdue'] || $st['reminderSentAt'] || !$this->app->watchdog()->enabled('report_reminder')) {
            return false;
        }
        [, $end] = self::bounds($st['period']);
        $first = $this->app->db()->value('SELECT MIN(created_at) FROM users');
        if ($first === null || (int) $first >= $end) {
            return false;
        }
        $owner = $this->app->db()->one('SELECT name, lang FROM users WHERE lower(email) = ?', [$this->ownerEmail()]);
        $lang = ($owner['lang'] ?? 'es') === 'en' ? 'en' : 'es';
        $s = $this->strings($lang);
        $month = $this->periodLabel($st['period'], $lang);
        $recipients = count($this->settings()['recipients']);
        $emails = new Emails($this->app);
        $link = $emails->adminUrl('informe');
        $lines = [
            self::fill($s['sr.remind.intro'], ['month' => $month]),
            $recipients > 0 ? self::plural($s['sr.remind.recipients'], $recipients) : $s['sr.remind.noRecipients'],
        ];
        $body = '<div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#f6740a">' . Emails::esc($s['sr.remind.eyebrow']) . '</div>'
            . '<h1 style="margin:8px 0 12px;font-size:22px;line-height:1.3;color:#1c1c1c">' . Emails::esc(self::fill($s['sr.remind.title'], ['month' => $month])) . '</h1>'
            . implode('', array_map(fn ($l) => '<p style="margin:0 0 10px">' . Emails::esc($l) . '</p>', $lines))
            . Emails::cta($s['sr.remind.button'], $link);
        $layout = $emails->branded($lang, $s['sr.remind.eyebrow'], $lines[0], $body, Emails::esc($s['sr.remind.footer']));
        $ok = $this->app->mailer()->send([
            'to' => $this->ownerEmail(),
            'subject' => self::fill($s['sr.remind.subject'], ['month' => $month]),
            'text' => implode("\n\n", $lines) . "\n\n" . $link . "\n",
            'html' => $layout['html'],
            'embedded' => $layout['embedded'],
        ]);
        if ($ok) {
            $this->app->settings()->set('report_reminder_' . $st['period'], (string) time());
        }
        return $ok;
    }

    /** Expiry date of the site's HTTPS certificate (checked by the scheduled check, once a day). */
    public function refreshCertificate(): ?int
    {
        $url = $this->app->config->appUrl();
        $host = (string) parse_url($url, PHP_URL_HOST);
        if (!str_starts_with($url, 'https://') || in_array($host, ['localhost', '127.0.0.1', '::1'], true)) {
            return null;
        }
        $last = $this->app->settings()->getJson('tls_expiry');
        if ($last && time() - (int) ($last['checkedAt'] ?? 0) < 86400) {
            return isset($last['validTo']) ? (int) $last['validTo'] : null;
        }
        $ctx = stream_context_create(['ssl' => ['capture_peer_cert' => true, 'verify_peer' => true, 'verify_peer_name' => true, 'SNI_enabled' => true, 'peer_name' => $host]]);
        $conn = @stream_socket_client("ssl://{$host}:443", $errno, $errstr, 8, STREAM_CLIENT_CONNECT, $ctx);
        $validTo = null;
        if ($conn) {
            $cert = stream_context_get_params($conn)['options']['ssl']['peer_certificate'] ?? null;
            $info = $cert ? openssl_x509_parse($cert) : false;
            $validTo = is_array($info) && isset($info['validTo_time_t']) ? (int) $info['validTo_time_t'] : null;
            fclose($conn);
        }
        $this->app->settings()->setJson('tls_expiry', ['checkedAt' => time(), 'validTo' => $validTo]);
        $this->app->maintenanceLog()->add('certificate');
        if ($validTo !== null && $validTo - time() < 21 * 86400) {
            $this->app->logger()->warning('certificate_expiring', ['message' => 'HTTPS certificate expires on ' . date('Y-m-d', $validTo)]);
        }
        return $validTo;
    }
}
