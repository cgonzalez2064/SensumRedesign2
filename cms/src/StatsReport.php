<?php
declare(strict_types=1);

namespace Sensum\Cms;

use Sensum\Cms\Http\ApiError;

/**
 * Estadísticas for a chosen period: the figures the screen shows, the
 * spreadsheet (CSV) and the report sent by e-mail («Enviar por correo»).
 * Only totals: visits are counted without personal data (Analytics) and the
 * contact-form part is counts and amounts, never names or messages.
 */
final class StatsReport
{
    /** Parts of the report a person can leave out (the summary is always there). */
    public const SECTIONS = ['daily', 'sources', 'clicks', 'devices', 'leads'];
    public const MAX_RECIPIENTS = 5;
    public const PRESETS = ['7d', '30d', '90d', 'month'];
    private const MAX_DAYS = 366;

    public function __construct(private App $app)
    {
    }

    /**
     * The period asked for — 7d / 30d / 90d (ending today), month (this month
     * so far), YYYY-MM, or custom (from–to, YYYY-MM-DD, a year at most) — and
     * the previous period of the same length to compare. Ends are exclusive.
     * @return array{period:string,from:int,to:int,prevFrom:int,prevTo:int}
     */
    public static function range(string $period, string $from = '', string $to = '', ?int $now = null): array
    {
        $now ??= time();
        $tomorrow = (int) strtotime('tomorrow', $now);
        if (preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $period)) {
            [$start, $end] = SiteReport::bounds($period);
            [$pStart, $pEnd] = SiteReport::bounds(date('Y-m', strtotime($period . '-01 -1 month') ?: $start));
            return ['period' => $period, 'from' => $start, 'to' => $end, 'prevFrom' => $pStart, 'prevTo' => $pEnd];
        }
        if ($period === 'custom') {
            $valid = fn (string $d) => preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) && ($t = strtotime($d . ' 00:00:00')) !== false && date('Y-m-d', $t) === $d;
            $errors = array_filter(['from' => $valid($from) ? null : 'invalid', 'to' => $valid($to) ? null : 'invalid']);
            if ($errors) {
                throw ApiError::validation($errors);
            }
            $start = (int) strtotime($from . ' 00:00:00');
            $end = min((int) strtotime($to . ' 00:00:00 +1 day'), $tomorrow);
            if ($end <= $start) {
                throw ApiError::validation(['to' => 'date_before_start']);
            }
            if ($end - $start > self::MAX_DAYS * 86400) {
                throw ApiError::validation(['to' => 'range_too_long']);
            }
            return ['period' => 'custom', 'from' => $start, 'to' => $end, 'prevFrom' => $start - ($end - $start), 'prevTo' => $start];
        }
        $period = in_array($period, self::PRESETS, true) ? $period : '30d';
        $start = match ($period) {
            '7d' => $tomorrow - 7 * 86400,
            '90d' => $tomorrow - 90 * 86400,
            'month' => (int) strtotime(date('Y-m-01 00:00:00', $now)),
            default => $tomorrow - 30 * 86400,
        };
        return ['period' => $period, 'from' => $start, 'to' => $tomorrow, 'prevFrom' => $start - ($tomorrow - $start), 'prevTo' => $start];
    }

    /** Visits (and, with "leads" access, the contact-form figures) for the period and the one before. */
    public function data(array $range, bool $withLeads, string $service = ''): array
    {
        $a = $this->app->analytics();
        $l = $this->app->leads();
        return [
            'range' => $range,
            'service' => $withLeads ? $service : '',
            'visits' => $a->summary($range['from'], $range['to']),
            'previous' => $a->summary($range['prevFrom'], $range['prevTo']),
            'leads' => $withLeads ? $l->stats($range['from'], $range['to'], $service) : null,
            'previousLeads' => $withLeads ? $l->stats($range['prevFrom'], $range['prevTo'], $service) : null,
        ];
    }

    // ------------------------------------------------------------------ spreadsheet

    /** Every part of the report, one block after another (UTF-8 with BOM, formula-safe like Prospectos). */
    public function csv(array $d, string $lang): string
    {
        $s = $this->strings($lang);
        $v = $d['visits'];
        $out = fopen('php://temp', 'w+');
        fwrite($out, "\xEF\xBB\xBF");
        $put = function (array $row) use ($out) {
            fputcsv($out, array_map([Leads::class, 'cell'], array_map('strval', $row)), ',', '"', '');
        };
        $put([$s['st.title'], $this->periodLabel($d['range'], $lang)]);
        $put([$s['st.compared'], $this->dayLabel($d['range']['prevFrom'], $lang) . ' – ' . $this->dayLabel($d['range']['prevTo'] - 1, $lang)]);
        if ($d['service'] !== '') {
            $put([$s['st.service'], $d['service']]);
        }
        $put([]);
        $put([$s['st.summary'], $s['st.thisPeriod'], $s['st.previousPeriod']]);
        foreach ($this->kpis($d) as [$label, $now, $before]) {
            $put([$s[$label], $now, $before]);
        }
        $put([]);
        $put([$s['st.daily'], $s['st.visitors'], $s['st.views']]);
        foreach ($v['days'] as $day) {
            $put([$day['day'], $day['visitors'], $day['views']]);
        }
        foreach (['sources' => 'st.source.', 'clicks' => 'st.click.', 'devices' => 'st.device.'] as $key => $prefix) {
            $put([]);
            $put([$s['st.' . $key], $s[$key === 'clicks' ? 'st.clicksN' : 'st.visitors']]);
            foreach ($v[$key] as $k => $n) {
                $put([$s[$prefix . $k] ?? $k, $n]);
            }
        }
        if ($d['leads'] !== null) {
            $l = $d['leads'];
            $put([]);
            $put([$s['st.leads'], $s['st.thisPeriod']]);
            foreach (['received', 'contacted', 'quoted', 'won', 'lost'] as $k) {
                $put([$s['st.funnel.' . $k], $l[$k]]);
            }
            $put([$s['st.wonAmountLabel'], $l['wonAmount']]);
            $put([$s['st.responseLabel'], $l['avgResponseHours'] ?? '']);
            if ($l['byService']) {
                $put([]);
                $put([$s['st.byService'], $s['st.funnel.received']]);
                foreach ($l['byService'] as $k => $n) {
                    $put([$k, $n]);
                }
            }
        }
        rewind($out);
        $csv = (string) stream_get_contents($out);
        fclose($out);
        return $csv;
    }

    public function fileName(array $range): string
    {
        return 'estadisticas-sensum-' . date('Y-m-d', $range['from']) . '-a-' . date('Y-m-d', $range['to'] - 1) . '.csv';
    }

    // ------------------------------------------------------------------ e-mail

    /**
     * The report as a branded e-mail: summary with the change against the
     * previous period, then the chosen parts as simple tables.
     * @return array{subject:string,text:string,html:string,embedded:list<array{path:string,cid:string,name:string,mime:string}>}
     */
    public function email(array $d, array $sections, string $lang, string $sender, string $message): array
    {
        $s = $this->strings($lang);
        $e = fn (string $x) => Emails::esc($x);
        $period = $this->periodLabel($d['range'], $lang);
        $compared = $this->dayLabel($d['range']['prevFrom'], $lang) . ' – ' . $this->dayLabel($d['range']['prevTo'] - 1, $lang);
        $intro = Emails::fill($s['st.mail.intro'], ['name' => $sender]);
        $font = 'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;';
        $h2 = fn (string $t) => '<h2 style="margin:26px 0 8px;' . $font . 'font-size:16px;color:#1c1c1c">' . $e($t) . '</h2>';
        $table = function (array $head, array $rows) use ($e, $font): string {
            $th = '';
            foreach ($head as $i => $c) {
                $th .= '<th align="' . ($i ? 'right' : 'left') . '" style="padding:6px 8px;border-bottom:2px solid #efeff2;' . $font . 'font-size:12px;color:#7a7a82;font-weight:700">' . $e((string) $c) . '</th>';
            }
            $tr = '';
            foreach ($rows as $row) {
                $tr .= '<tr>';
                foreach ($row as $i => $c) {
                    $tr .= '<td align="' . ($i ? 'right' : 'left') . '" style="padding:6px 8px;border-bottom:1px solid #f2f2f4;' . $font . 'font-size:14px;color:#2b2b31">' . $e((string) $c) . '</td>';
                }
                $tr .= '</tr>';
            }
            return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' . '<tr>' . $th . '</tr>' . $tr . '</table>';
        };
        $text = $intro . "\n" . $s['st.title'] . ': ' . $period . "\n" . $s['st.compared'] . ': ' . $compared . "\n";
        $body = '<p style="margin:0 0 6px">' . $e($intro) . '</p>'
            . '<p style="margin:0;font-size:20px;font-weight:800;color:#1c1c1c">' . $e($period) . '</p>'
            . '<p style="margin:2px 0 0;font-size:13px;color:#7a7a82">' . $e($s['st.compared'] . ': ' . $compared) . ($d['service'] !== '' ? ' · ' . $e($s['st.service'] . ': ' . $d['service']) : '') . '</p>';
        if ($message !== '') {
            $body .= '<div style="margin:18px 0 0;padding:12px 14px;border-left:3px solid #f6740a;background:#fff7ef;border-radius:6px;white-space:pre-wrap;font-size:14px;color:#2b2b31">' . $e($message) . '</div>';
            $text .= "\n" . $message . "\n";
        }

        // Summary: four figures with the change against the previous period.
        $cells = '';
        $text .= "\n" . $s['st.summary'] . "\n";
        foreach ($this->kpis($d) as $i => [$label, $now, $before]) {
            $change = $this->change($now, $before, $lang, $s);
            $color = $change === null ? '#7a7a82' : ($now >= $before ? '#1a7f37' : '#b42318');
            $cells .= ($i % 2 === 0 ? '<tr>' : '')
                . '<td width="50%" valign="top" style="padding:12px;border:1px solid #efeff2;border-radius:10px;' . $font . '">'
                . '<div style="font-size:12px;color:#7a7a82;font-weight:700">' . $e($s[$label]) . '</div>'
                . '<div style="font-size:26px;font-weight:800;color:#1c1c1c;line-height:1.2">' . $e($this->num($now, $lang)) . '</div>'
                . '<div style="font-size:12px;color:' . $color . '">' . $e($change ?? $s['st.noCompare']) . '</div></td>'
                . ($i % 2 === 1 ? '</tr>' : '<td width="8" style="width:8px"></td>');
            $text .= '- ' . $s[$label] . ': ' . $this->num($now, $lang) . ($change !== null ? ' (' . $change . ')' : '') . "\n";
        }
        if (substr($cells, -5) !== '</tr>') {
            $cells .= '<td></td></tr>';
        }
        $body .= $h2($s['st.summary']) . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 8px">' . $cells . '</table>';

        $v = $d['visits'];
        $total = fn (array $rows) => max(1, array_sum($rows));
        $pct = fn (int $n, int $t) => ($lang === 'en' ? round(100 * $n / $t) . '%' : round(100 * $n / $t) . ' %');
        if (in_array('daily', $sections, true)) {
            [$title, $head, $rows] = $this->dailyRows($v['days'], $lang, $s);
            $body .= $h2($title) . ($rows ? $table([$s[$head], $s['st.visitors'], $s['st.views']], $rows) : '<p style="color:#7a7a82;font-size:14px">' . $e($s['st.noData']) . '</p>');
            $text .= "\n" . $title . "\n" . ($rows ? implode("\n", array_map(fn ($r) => "- {$r[0]}: {$r[1]} / {$r[2]}", $rows)) : $s['st.noData']) . "\n";
        }
        foreach (['sources' => 'st.source.', 'clicks' => 'st.click.', 'devices' => 'st.device.'] as $key => $prefix) {
            if (!in_array($key, $sections, true)) {
                continue;
            }
            $rows = [];
            $all = $total($v[$key]);
            foreach ($v[$key] as $k => $n) {
                if ($n > 0) {
                    $rows[] = [$s[$prefix . $k] ?? (string) $k, $this->num($n, $lang), $pct($n, $all)];
                }
            }
            $body .= $h2($s['st.' . $key]) . ($rows ? $table(['', $key === 'clicks' ? $s['st.clicksN'] : $s['st.visitors'], '%'], $rows) : '<p style="color:#7a7a82;font-size:14px">' . $e($s['st.noData']) . '</p>');
            $text .= "\n" . $s['st.' . $key] . "\n" . ($rows ? implode("\n", array_map(fn ($r) => "- {$r[0]}: {$r[1]} ({$r[2]})", $rows)) : $s['st.noData']) . "\n";
        }
        if ($d['leads'] !== null && in_array('leads', $sections, true)) {
            $l = $d['leads'];
            $rows = [];
            foreach (['received' => $l['received'], 'contacted' => $l['contacted'] + $l['quoted'] + $l['won'], 'quoted' => $l['quoted'] + $l['won'], 'won' => $l['won']] as $k => $n) {
                $rows[] = [$s['st.funnel.' . $k], $this->num($n, $lang), $pct($n, max(1, $l['received']))];
            }
            $body .= $h2($s['st.leads']) . $table(['', $s['st.leadsN'], '%'], $rows);
            $text .= "\n" . $s['st.leads'] . "\n" . implode("\n", array_map(fn ($r) => "- {$r[0]}: {$r[1]}", $rows)) . "\n";
            $notes = [];
            if ($l['wonAmount'] > 0) {
                $notes[] = Emails::fill($s['st.wonAmount'], ['amount' => 'Q ' . $this->num($l['wonAmount'], $lang)]);
            }
            if ($l['avgResponseHours'] !== null) {
                $notes[] = Emails::fill($s['st.responseTime'], ['h' => (string) $l['avgResponseHours']]);
            }
            foreach ($notes as $n) {
                $body .= '<p style="margin:8px 0 0;font-size:14px;color:#2b2b31">' . $e($n) . '</p>';
                $text .= $n . "\n";
            }
        }
        $body .= '<p style="margin:22px 0 0;font-size:13px;color:#7a7a82">' . $e($s['st.mail.attached']) . '</p>';
        $text .= "\n" . $s['st.mail.attached'] . "\n\n" . $s['st.mail.privacy'] . "\n";
        $branded = (new Emails($this->app))->branded($lang, $s['st.title'], $intro . ' ' . $period, $body, $e($s['st.mail.privacy']));
        return ['subject' => Emails::fill($s['st.mail.subject'], ['period' => $period]), 'text' => $text] + $branded;
    }

    // ------------------------------------------------------------------ helpers

    /** @return list<array{0:string,1:int,2:int}> [label key, this period, previous period] */
    private function kpis(array $d): array
    {
        $v = $d['visits'];
        $p = $d['previous'];
        $rows = [
            ['st.visitors', $v['visitors'], $p['visitors']],
            ['st.views', $v['views'], $p['views']],
            ['st.contactClicks', $v['contacts'], $p['contacts']],
        ];
        if ($d['leads'] !== null) {
            $rows[] = ['st.formMessages', $d['leads']['received'], $d['previousLeads']['received']];
        }
        return $rows;
    }

    private function change(int $now, int $before, string $lang, array $s): ?string
    {
        if ($before <= 0) {
            return null;
        }
        $diff = (int) round(100 * ($now - $before) / $before);
        if ($diff === 0) {
            return $s['st.same'];
        }
        return Emails::fill($s['st.vsPrevious'], ['change' => ($diff > 0 ? '+' : '−') . abs($diff) . ($lang === 'en' ? '%' : ' %')]);
    }

    /**
     * Up to a month: the days with visits (the spreadsheet has every day);
     * longer: one row per week.
     * @return array{0:string,1:string,2:list<list<string>>} [title, first column's label key, rows]
     */
    private function dailyRows(array $days, string $lang, array $s): array
    {
        if (count($days) <= 31) {
            $busy = array_values(array_filter($days, fn ($d) => $d['visitors'] > 0 || $d['views'] > 0));
            return [$s['st.daily'], 'st.day', array_map(fn ($d) => [$this->dayLabel((int) strtotime($d['day'] . ' 12:00'), $lang), $this->num($d['visitors'], $lang), $this->num($d['views'], $lang)], $busy)];
        }
        $rows = [];
        foreach (array_chunk($days, 7) as $week) {
            $rows[] = [Emails::fill($s['st.weekOf'], ['day' => $this->dayLabel((int) strtotime($week[0]['day'] . ' 12:00'), $lang)]),
                $this->num(array_sum(array_column($week, 'visitors')), $lang), $this->num(array_sum(array_column($week, 'views')), $lang)];
        }
        return [$s['st.weekly'], 'st.week', $rows];
    }

    public function periodLabel(array $range, string $lang): string
    {
        return $this->dayLabel($range['from'], $lang) . ' – ' . $this->dayLabel($range['to'] - 1, $lang);
    }

    private function dayLabel(int $t, string $lang): string
    {
        $months = $lang === 'en'
            ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
            : ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
        $m = $months[(int) date('n', $t) - 1];
        return $lang === 'en' ? $m . ' ' . date('j, Y', $t) : date('j', $t) . ' ' . $m . ' ' . date('Y', $t);
    }

    private function num(int|float $n, string $lang): string
    {
        return number_format((float) $n, 0, '.', ',');
    }

    private function strings(string $lang): array
    {
        return require $this->app->root('lang/' . ($lang === 'en' ? 'en' : 'es') . '.php');
    }
}
