<?php
declare(strict_types=1);

namespace Sensum\Cms;

use Sensum\Cms\Http\ApiError;

/**
 * The monthly site report: a short, plain-language summary of the site's
 * health and visibility for people who are not technical (clients,
 * management). The owner previews it, chooses who receives it, and sends
 * it; the owner is always in copy. If the previous month's report has not
 * been sent by the end of day 5, the owner gets a reminder.
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
            $allowed[] = date('Y-m', strtotime("first day of -{$i} month") ?: time());
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
            $p = date('Y-m', strtotime("first day of -{$i} month") ?: time());
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
        ];
    }

    /**
     * The report as plain-language content, used both by the e-mail and by
     * the panel's preview, in the report's language.
     */
    public function build(string $period, string $lang): array
    {
        $s = $this->strings($lang);
        $f = $this->figures($period);
        $month = $this->periodLabel($period, $lang);
        $good = $f['incidents'] === 0 && ($f['availability'] === null || $f['availability'] >= 99);
        // "99 %" for whole numbers, "99,8 %" otherwise.
        $pct = $f['availability'] !== null ? self::number($f['availability'], $lang, fmod($f['availability'], 1.0) === 0.0 ? 0 : 1) : null;
        $changes = $f['textChanges'] + $f['photos'] + $f['portfolio'];

        $incidents = $f['incidents'] === 0 ? $s['sr.summary.noIncidents'] : self::plural($s['sr.summary.incidents'], $f['incidents']);
        $summary = $pct !== null
            ? self::fill($s['sr.summary.withAvailability'], ['month' => $month, 'pct' => $pct, 'incidents' => $incidents])
            : self::fill($s['sr.summary.noAvailability'], ['month' => $month, 'incidents' => $incidents]);
        // "Se actualizaron 3 textos y se publicaron 2 fotos nuevas." — only what actually happened.
        $parts = array_values(array_filter([
            $f['textChanges'] > 0 ? self::plural($s['sr.summary.texts'], $f['textChanges']) : null,
            $f['photos'] > 0 ? self::plural($s['sr.summary.photos'], $f['photos']) : null,
            $f['portfolio'] > 0 ? $s['sr.summary.portfolio'] : null,
        ]));
        if ($parts) {
            $last = array_pop($parts);
            $sentence = ($parts ? implode(', ', $parts) . ' ' . $s['sr.and'] . ' ' : '') . $last;
            $summary .= ' ' . mb_strtoupper(mb_substr($sentence, 0, 1)) . mb_substr($sentence, 1) . '.';
        } else {
            $summary .= ' ' . $s['sr.summary.noChanges'];
        }
        if ($f['tickets']['resolved'] > 0) {
            $summary .= ' ' . self::plural($s['sr.summary.resolved'], $f['tickets']['resolved']);
        }

        $kpis = [];
        if ($pct !== null) {
            $kpis[] = ['label' => $s['sr.kpi.availability'], 'value' => $pct . ($lang === 'en' ? '%' : ' %'), 'note' => self::fill($s['sr.kpi.availabilityNote'], ['n' => self::number($f['checks'], $lang)])];
        }
        if ($f['pagespeed']) {
            $kpis[] = ['label' => $s['sr.kpi.google'], 'value' => $f['pagespeed']['mobile']['performance'] . '/100', 'note' => $this->grade((int) $f['pagespeed']['mobile']['performance'], $lang)];
        }
        $kpis[] = ['label' => $s['sr.kpi.updates'], 'value' => (string) $changes, 'note' => $s['sr.kpi.updatesNote']];
        if ($f['contact']['sent'] > 0) {
            $kpis[] = ['label' => $s['sr.kpi.leads'], 'value' => self::number($f['contact']['sent'], $lang), 'note' => $s['sr.kpi.leadsNote']];
        }
        $kpis[] = ['label' => $s['sr.kpi.security'], 'value' => $f['https'] ? $s['sr.kpi.secure'] : $s['sr.kpi.review'], 'note' => $f['blocked'] > 0
            ? self::plural($s['sr.kpi.blocked'], $f['blocked']) : $s['sr.kpi.noThreats']];

        $sections = [];
        if ($f['pagespeed']) {
            $p = $f['pagespeed'];
            $line = fn (string $key, int $score) => self::fill($s[$key], ['score' => $score, 'grade' => mb_strtolower($this->grade($score, $lang))]);
            $sections[] = ['title' => $s['sr.sec.visibility'], 'intro' => $s['sr.sec.visibilityIntro'], 'items' => [
                $line('sr.psi.mobile', (int) $p['mobile']['performance']),
                $line('sr.psi.desktop', (int) $p['desktop']['performance']),
                $line('sr.psi.seo', (int) $p['mobile']['seo']),
                $line('sr.psi.accessibility', (int) $p['mobile']['accessibility']),
            ]];
        }
        $content = [];
        if ($f['textChanges'] > 0) {
            $content[] = self::plural($s['sr.content.texts'], $f['textChanges']);
        }
        if ($f['photos'] > 0) {
            $content[] = self::plural($s['sr.content.photos'], $f['photos']);
        }
        if ($f['portfolio'] > 0) {
            $content[] = $s['sr.content.portfolio'];
        }
        if (!$content) {
            $content[] = $s['sr.content.none'];
        }
        if ($f['lastPublished']) {
            $content[] = self::fill($s['sr.content.lastPublished'], ['date' => $this->date($f['lastPublished'], $lang)]);
        }
        $sections[] = ['title' => $s['sr.sec.content'], 'intro' => null, 'items' => $content];

        $security = [];
        if ($f['https']) {
            $security[] = $f['certificateUntil'] && $f['certificateUntil'] > time()
                ? self::fill($s['sr.security.httpsUntil'], ['date' => $this->date($f['certificateUntil'], $lang)])
                : $s['sr.security.https'];
        }
        $security[] = $f['blocked'] > 0 ? self::plural($s['sr.security.blocked'], $f['blocked']) : $s['sr.security.noThreats'];
        if ($f['lastBackup']) {
            $security[] = self::fill($s['sr.security.backup'], ['date' => $this->date($f['lastBackup'], $lang)]);
        }
        $sections[] = ['title' => $s['sr.sec.security'], 'intro' => null, 'items' => $security];

        $support = [$f['incidents'] === 0 ? $s['sr.support.noIncidents'] : self::plural($s['sr.support.incidents'], $f['incidents'])];
        $tk = $f['tickets'];
        if ($tk['received'] > 0 || $tk['resolved'] > 0) {
            $support[] = $tk['received'] > 0
                ? self::plural($s['sr.support.received'], $tk['received'], ['resolved' => self::plural($s['sr.support.resolvedPart'], $tk['resolved'])])
                : self::plural($s['sr.support.resolvedOnly'], $tk['resolved']);
            if ($tk['avgHours'] !== null) {
                $support[] = self::fill($s['sr.support.avg'], ['time' => $this->duration($tk['avgHours'], $lang)]);
            }
            foreach ($tk['resolvedTitles'] as $title) {
                $support[] = self::fill($s['sr.support.done'], ['title' => $title]);
            }
            if ($tk['open'] > 0) {
                $support[] = self::plural($s['sr.support.open'], $tk['open']);
            }
        } elseif ($f['supportRequests'] > 0) {
            $support[] = self::plural($s['sr.support.requests'], $f['supportRequests']);
        }
        $sections[] = ['title' => $s['sr.sec.support'], 'intro' => null, 'items' => $support];

        // The maintenance that happened on its own this month (only what is known).
        $m = $f['maintenance'];
        $auto = array_values(array_filter([
            $f['checks'] > 0 ? self::plural($s['sr.auto.checks'], $f['checks'], ['count' => self::number($f['checks'], $lang)]) : null,
            $m['integrity'] > 0 ? self::plural($s['sr.auto.integrity'], $m['integrity'], ['count' => self::number($m['integrity'], $lang)]) : null,
            $m['backups'] > 0 ? self::plural($s['sr.auto.backups'], $m['backups']) : null,
            $m['certificate'] > 0 ? self::plural($s['sr.auto.certificate'], $m['certificate']) : null,
            $m['pagespeed'] > 0 ? self::plural($s['sr.auto.pagespeed'], $m['pagespeed']) : null,
            $f['contact']['blocked'] > 0 ? self::plural($s['sr.auto.spam'], $f['contact']['blocked']) : null,
            $m['alerts'] > 0 ? self::plural($s['sr.auto.alerts'], $m['alerts']) : null,
        ]));
        if ($auto) {
            $sections[] = ['title' => $s['sr.sec.auto'], 'intro' => $s['sr.sec.autoIntro'], 'items' => $auto];
        }

        return [
            'period' => $period,
            'periodLabel' => $month,
            'lang' => $lang,
            'status' => $good ? 'good' : 'attention',
            'statusLabel' => $s['sr.status.' . ($good ? 'good' : 'attention')],
            'headline' => $s['sr.headline.' . ($good ? 'good' : 'attention')],
            'summary' => $summary,
            'kpis' => $kpis,
            'sections' => $sections,
            'siteUrl' => $this->app->config->appUrl(),
            'subject' => self::fill($s['sr.subject'], ['month' => $month]),
            'figures' => $f,
        ];
    }

    // ------------------------------------------------------------------ e-mail

    public function email(array $r, array $to, array $cc, string $note, bool $test): array
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
                . '<div style="font-size:13px;color:#5f6368;margin-top:2px">' . $e($k['note']) . '</div></div></td>';
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
            . Emails::cta($s['sr.cta'], $r['siteUrl'] . '/');
        $footer = $e(self::fill($s['sr.footer'], ['email' => $this->ownerEmail()]));
        $layout = (new Emails($this->app))->branded($r['lang'], $s['sr.tag'], $r['summary'], $body, $footer);

        $text = ($test ? $s['sr.testBanner'] . "\n\n" : '') . self::fill($s['sr.eyebrow'], ['month' => $r['periodLabel']]) . "\n" . $r['headline'] . ' — ' . $r['statusLabel'] . "\n\n" . $r['summary'] . "\n";
        if ($note !== '') {
            $text .= "\n{$s['sr.noteTitle']}:\n{$note}\n";
        }
        $text .= "\n";
        foreach ($r['kpis'] as $k) {
            $text .= "{$k['label']}: {$k['value']} ({$k['note']})\n";
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
        $sent = $this->app->mailer()->send($this->email($report, $to, $cc, $note, $test));
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
