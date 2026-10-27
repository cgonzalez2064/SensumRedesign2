<?php
declare(strict_types=1);

namespace Sensum\Cms;

use Sensum\Cms\Http\ApiError;

/**
 * "Prospectos": every message sent with the site's contact form, kept in the
 * panel so none is lost in an inbox — with a status (nuevo → contactado →
 * cotizado → ganado / perdido), the quoted amount, notes and their history,
 * a CSV export and the monthly figures for the report.
 *
 * Visible to the owner and to accounts with the "leads" access. The form
 * handler stores the message before e-mailing it, so a failed e-mail no
 * longer loses the lead. Old leads are deleted after the retention period
 * the owner chooses (personal data is not kept forever).
 */
final class Leads
{
    public const STATUSES = ['new', 'contacted', 'quoted', 'won', 'lost'];
    public const FILTERS = ['active', 'new', 'contacted', 'quoted', 'won', 'lost', 'all'];
    public const RETENTION = [6, 12, 24, 36];
    private const DEFAULT_RETENTION = 24;
    private const DAILY_MAX = 200;      // a spam wave that got past the captcha cannot fill the database
    private const NOTE_MAX = 2000;
    private const AMOUNT_MAX = 999_999_999;

    public function __construct(private App $app)
    {
    }

    // ------------------------------------------------------------------ capture (contact form)

    /**
     * Stores a validated contact-form message. Returns its id, or null when
     * today's safety limit was reached.
     * @param array{name:string,phone:string,email:string,service:string,message:string} $lead
     */
    /** @param list<array{id:string,label:string,value:string}> $answers the extra questions' answers */
    public function capture(array $lead, string $lang = 'es', ?int $now = null, array $answers = []): ?int
    {
        $now ??= time();
        $db = $this->app->db();
        if ((int) $db->value('SELECT COUNT(*) FROM leads WHERE created_at >= ?', [$now - 86400]) >= self::DAILY_MAX) {
            $this->app->logger()->warning('lead_daily_limit', ['message' => 'Contact-form messages over the daily limit were not stored']);
            return null;
        }
        return $db->insert(
            'INSERT INTO leads (name, email, phone, service, message, lang, answers, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [self::line($lead['name'], 120), self::line($lead['email'], 180), self::line($lead['phone'], 30), self::line($lead['service'], 120),
                mb_substr(self::multiline($lead['message']), 0, 4000), $lang === 'en' ? 'en' : 'es', self::answersJson($answers), $now, $now]
        );
    }

    public function markNotified(int $id, bool $sent): void
    {
        $this->app->db()->run('UPDATE leads SET notified = ? WHERE id = ?', [$sent ? 1 : 0, $id]);
    }

    // ------------------------------------------------------------------ reading

    /** @return array{leads:list<array>,counts:array<string,int>,filter:string,services:list<string>} */
    public function list(string $filter = 'active', string $q = '', string $service = '', string $assigned = '', int $viewer = 0): array
    {
        $db = $this->app->db();
        $filter = in_array($filter, self::FILTERS, true) ? $filter : 'active';
        [$where, $params] = $this->where($filter, $q, $service);
        // Who follows it up: "me" (the viewer) or nobody yet.
        if ($assigned === 'me') {
            $where[] = 'assigned_to = ?';
            $params[] = $viewer;
        } elseif ($assigned === 'none') {
            $where[] = 'assigned_to IS NULL';
        }
        $rows = $db->all('SELECT * FROM leads' . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
            . ' ORDER BY unread DESC, created_at DESC, id DESC LIMIT 300', $params);
        $counts = array_fill_keys(self::STATUSES, 0);
        foreach ($db->all('SELECT status, COUNT(*) AS n FROM leads GROUP BY status') as $c) {
            $counts[$c['status']] = (int) $c['n'];
        }
        $counts['active'] = $counts['new'] + $counts['contacted'] + $counts['quoted'];
        $counts['all'] = array_sum(array_intersect_key($counts, array_flip(self::STATUSES)));
        $counts['unread'] = $this->badge();
        $counts['mine'] = (int) $db->value("SELECT COUNT(*) FROM leads WHERE assigned_to = ? AND status IN ('new', 'contacted', 'quoted')", [$viewer]);
        return [
            'leads' => array_map([$this, 'present'], $rows),
            'counts' => $counts,
            'filter' => $filter,
            'services' => array_map('strval', array_column($db->all("SELECT DISTINCT service FROM leads WHERE service <> '' ORDER BY service"), 'service')),
        ];
    }

    /** Leads not opened yet (menu badge). */
    public function badge(): int
    {
        return (int) $this->app->db()->value('SELECT COUNT(*) FROM leads WHERE unread = 1');
    }

    /** One lead with its notes and history; marks it as read. */
    public function detail(int $id): array
    {
        $lead = $this->find($id);
        if ((int) $lead['unread'] === 1 && !$this->app->viewOnly()) {
            $this->app->db()->run('UPDATE leads SET unread = 0 WHERE id = ?', [$id]);
            $lead['unread'] = 0;
        }
        return ['lead' => $this->present($lead), 'notes' => $this->notes($id)];
    }

    public function present(array $l): array
    {
        return [
            'id' => (int) $l['id'],
            'name' => (string) $l['name'],
            'email' => (string) $l['email'],
            'phone' => (string) $l['phone'],
            'service' => (string) $l['service'],
            'message' => (string) $l['message'],
            'answers' => self::answers($l['answers'] ?? '[]'),
            'lang' => (string) $l['lang'],
            'status' => (string) $l['status'],
            'amount' => $l['amount'] !== null ? (int) $l['amount'] : null,
            'notified' => (int) $l['notified'] === 1,
            'unread' => (int) $l['unread'] === 1,
            'createdAt' => (int) $l['created_at'],
            'updatedAt' => (int) $l['updated_at'],
            'contactedAt' => $l['contacted_at'] !== null ? (int) $l['contacted_at'] : null,
            'assignedTo' => isset($l['assigned_to']) ? (int) $l['assigned_to'] : null,
        ];
    }

    // ------------------------------------------------------------------ changes

    /**
     * Status, amount and/or who follows it up. Each change is written to the lead's history.
     * @param array{status?:mixed,amount?:mixed,assignedTo?:mixed} $in
     */
    public function update(array $session, int $id, array $in): array
    {
        $lead = $this->find($id);
        $changes = [];
        $assignee = null;
        if (array_key_exists('assignedTo', $in)) {
            $to = $in['assignedTo'];
            if ($to !== null && (!is_int($to) || !($assignee = $this->app->automations()->leadPerson($to)))) {
                throw ApiError::validation(['assignedTo' => 'invalid']);
            }
            $old = $lead['assigned_to'] !== null ? (int) $lead['assigned_to'] : null;
            if ($to !== $old) {
                $changes['assignedTo'] = [$old, $to];
            }
        }
        if (array_key_exists('status', $in)) {
            if (!is_string($in['status']) || !in_array($in['status'], self::STATUSES, true)) {
                throw ApiError::validation(['status' => 'invalid']);
            }
            if ($in['status'] !== $lead['status']) {
                $changes['status'] = [$lead['status'], $in['status']];
            }
        }
        if (array_key_exists('amount', $in)) {
            $amount = $in['amount'];
            if ($amount === '' || $amount === null) {
                $amount = null;
            } elseif (is_int($amount) || (is_string($amount) && preg_match('/^\d{1,9}$/', $amount))) {
                $amount = (int) $amount;
            } elseif (is_float($amount) && $amount >= 0 && $amount <= self::AMOUNT_MAX) {
                $amount = (int) round($amount);
            } else {
                throw ApiError::validation(['amount' => 'invalid']);
            }
            if ($amount !== null && ($amount < 0 || $amount > self::AMOUNT_MAX)) {
                throw ApiError::validation(['amount' => 'invalid']);
            }
            $old = $lead['amount'] !== null ? (int) $lead['amount'] : null;
            if ($amount !== $old) {
                $changes['amount'] = [$old, $amount];
            }
        }
        if (!$changes) {
            return $this->detail($id);
        }
        $now = time();
        $this->app->db()->transaction(function () use ($id, $lead, $changes, $session, $now, $assignee) {
            $sets = ['updated_at = ?'];
            $params = [$now];
            if (isset($changes['status'])) {
                $to = $changes['status'][1];
                $sets[] = 'status = ?';
                $params[] = $to;
                if ($lead['contacted_at'] === null && $to !== 'new') {
                    $sets[] = 'contacted_at = ?';
                    $params[] = $now;
                }
                $sets[] = 'closed_at = ?';
                $params[] = in_array($to, ['won', 'lost'], true) ? $now : null;
                $this->event($id, $session, ['action' => 'status', 'from' => $changes['status'][0], 'to' => $to]);
            }
            if (isset($changes['amount'])) {
                $sets[] = 'amount = ?';
                $params[] = $changes['amount'][1];
                $this->event($id, $session, ['action' => 'amount', 'from' => $changes['amount'][0], 'to' => $changes['amount'][1]]);
            }
            if (array_key_exists('assignedTo', $changes)) {
                $sets[] = 'assigned_to = ?';
                $params[] = $changes['assignedTo'][1];
                $this->event($id, $session, ['action' => 'assigned', 'to' => $assignee ? (string) $assignee['name'] : '']);
            }
            $params[] = $id;
            $this->app->db()->run('UPDATE leads SET ' . implode(', ', $sets) . ' WHERE id = ?', $params);
        });
        $this->app->activity((int) $session['uid'], 'lead_updated', (string) $id, array_map(fn ($c) => ['from' => $c[0], 'to' => $c[1]], $changes));
        return $this->detail($id);
    }

    public function addNote(array $session, int $id, string $body): array
    {
        $this->find($id);
        $body = mb_substr(self::multiline($body), 0, self::NOTE_MAX);
        if ($body === '') {
            throw ApiError::validation(['body' => 'required']);
        }
        $now = time();
        $this->app->db()->transaction(function () use ($id, $session, $body, $now) {
            $this->insertNote($id, $session, 'note', $body, []);
            $this->app->db()->run('UPDATE leads SET updated_at = ? WHERE id = ?', [$now, $id]);
        });
        return $this->detail($id);
    }

    /** Deletes a lead and its notes (e.g. when the person asks for their data to be removed). */
    public function delete(array $session, int $id): void
    {
        $lead = $this->find($id);
        $this->app->db()->run('DELETE FROM leads WHERE id = ?', [$id]);
        $this->app->activity((int) $session['uid'], 'lead_deleted', (string) $id, ['email' => $this->app->pseudonym((string) $lead['email'])]);
    }

    // ------------------------------------------------------------------ settings & retention

    public function retentionMonths(): int
    {
        $m = (int) $this->app->settings()->get('leads_retention_months', (string) self::DEFAULT_RETENTION);
        return in_array($m, self::RETENTION, true) ? $m : self::DEFAULT_RETENTION;
    }

    public function setRetention(mixed $months): int
    {
        if (!is_int($months) || !in_array($months, self::RETENTION, true)) {
            throw ApiError::validation(['retention' => 'invalid']);
        }
        $this->app->settings()->set('leads_retention_months', (string) $months);
        return $months;
    }

    /** Deletes leads older than the retention period (scheduled check). Returns how many. */
    public function purge(?int $now = null): int
    {
        $now ??= time();
        $cut = strtotime('-' . $this->retentionMonths() . ' months', $now) ?: $now;
        return $this->app->db()->run('DELETE FROM leads WHERE created_at < ?', [$cut])->rowCount();
    }

    // ------------------------------------------------------------------ export

    /**
     * CSV for Excel / Google Sheets (UTF-8 with BOM). Cells that a
     * spreadsheet would run as a formula (=, +, -, @, tab, CR) are prefixed
     * with an apostrophe so a visitor's message can never become one.
     */
    public function csv(string $filter, string $q, string $service, string $lang): string
    {
        $s = require $this->app->root('lang/' . ($lang === 'en' ? 'en' : 'es') . '.php');
        [$where, $params] = $this->where(in_array($filter, self::FILTERS, true) ? $filter : 'all', $q, $service);
        $rows = $this->app->db()->all('SELECT * FROM leads' . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY created_at DESC, id DESC', $params);
        $out = fopen('php://temp', 'w+');
        fwrite($out, "\xEF\xBB\xBF");
        fputcsv($out, array_map(fn ($k) => $s['leads.csv.' . $k], ['id', 'date', 'name', 'email', 'phone', 'service', 'status', 'amount', 'message', 'answers']), ',', '"', '');
        foreach ($rows as $r) {
            fputcsv($out, array_map([self::class, 'cell'], [
                (string) $r['id'],
                date('Y-m-d H:i', (int) $r['created_at']),
                $r['name'], $r['email'], $r['phone'], $r['service'],
                $s['leads.status.' . $r['status']] ?? $r['status'],
                $r['amount'] !== null ? (string) (int) $r['amount'] : '',
                $r['message'],
                implode(' | ', array_map(fn ($a) => $a['label'] . ': ' . $a['value'], self::answers($r['answers'] ?? '[]'))),
            ]), ',', '"', '');
        }
        rewind($out);
        $csv = (string) stream_get_contents($out);
        fclose($out);
        return $csv;
    }

    /** @param list<array{id:string,label:string,value:string}> $answers */
    private static function answersJson(array $answers): string
    {
        $clean = [];
        foreach (array_slice($answers, 0, ContactFormFields::MAX_FIELDS) as $a) {
            $clean[] = ['id' => mb_substr((string) $a['id'], 0, 24), 'label' => self::line((string) $a['label'], ContactFormFields::MAX_LABEL), 'value' => mb_substr(self::multiline((string) $a['value']), 0, 4000)];
        }
        return (string) json_encode($clean, JSON_UNESCAPED_UNICODE);
    }

    /** @return list<array{id:string,label:string,value:string}> */
    public static function answers(mixed $json): array
    {
        $list = json_decode(is_string($json) ? $json : '[]', true);
        $out = [];
        foreach (is_array($list) ? $list : [] as $a) {
            if (is_array($a) && is_string($a['label'] ?? null) && is_string($a['value'] ?? null)) {
                $out[] = ['id' => (string) ($a['id'] ?? ''), 'label' => $a['label'], 'value' => $a['value']];
            }
        }
        return $out;
    }

    public static function cell(mixed $v): string
    {
        $v = str_replace(["\r\n", "\r"], "\n", (string) $v);
        return preg_match('/^[=+\-@\t\r]/', $v) ? "'" . $v : $v;
    }

    // ------------------------------------------------------------------ figures

    /**
     * Figures for a period (monthly report, weekly summary, Estadísticas), for
     * every service or only one (its label as stored).
     * @return array{received:int,byService:array<string,int>,contacted:int,quoted:int,won:int,lost:int,wonAmount:int,quotedAmount:int,avgResponseHours:?float}
     */
    public function stats(int $start, int $end, string $service = ''): array
    {
        $db = $this->app->db();
        // Same period, optionally one service: every query below adds the same condition.
        $w = 'created_at >= ? AND created_at < ?' . ($service !== '' ? ' AND service = ?' : '');
        $p = $service !== '' ? [$start, $end, $service] : [$start, $end];
        $out = ['received' => 0, 'byService' => [], 'contacted' => 0, 'quoted' => 0, 'won' => 0, 'lost' => 0, 'wonAmount' => 0, 'quotedAmount' => 0, 'avgResponseHours' => null];
        try {
            $out['received'] = (int) $db->value("SELECT COUNT(*) FROM leads WHERE $w", $p);
            foreach ($db->all("SELECT service, COUNT(*) AS n FROM leads WHERE $w GROUP BY service ORDER BY n DESC, service", $p) as $r) {
                $out['byService'][(string) $r['service']] = (int) $r['n'];
            }
            foreach ($db->all("SELECT status, COUNT(*) AS n, SUM(COALESCE(amount, 0)) AS amount FROM leads WHERE $w GROUP BY status", $p) as $r) {
                if (in_array($r['status'], ['contacted', 'quoted', 'won', 'lost'], true)) {
                    $out[$r['status']] = (int) $r['n'];
                }
                if ($r['status'] === 'won') {
                    $out['wonAmount'] = (int) $r['amount'];
                }
                if ($r['status'] === 'quoted') {
                    $out['quotedAmount'] = (int) $r['amount'];
                }
            }
            $avg = $db->value("SELECT AVG(contacted_at - created_at) FROM leads WHERE $w AND contacted_at IS NOT NULL", $p);
            $out['avgResponseHours'] = $avg !== null ? round((float) $avg / 3600, 1) : null;
        } catch (\Throwable) {
            // older database without the leads table
        }
        return $out;
    }

    // ------------------------------------------------------------------ helpers

    private function find(int $id): array
    {
        $lead = $this->app->db()->one('SELECT * FROM leads WHERE id = ?', [$id]);
        if (!$lead) {
            throw new ApiError(404, 'not_found');
        }
        return $lead;
    }

    /** @return list<array> */
    private function notes(int $id): array
    {
        return array_map(fn ($n) => [
            'id' => (int) $n['id'],
            'kind' => (string) $n['kind'],
            'author' => (string) $n['author'],
            'body' => (string) $n['body'],
            'details' => json_decode((string) $n['details'], true) ?: [],
            'createdAt' => (int) $n['created_at'],
        ], $this->app->db()->all('SELECT * FROM lead_notes WHERE lead_id = ? ORDER BY id', [$id]));
    }

    private function event(int $id, array $session, array $details): void
    {
        $this->insertNote($id, $session, 'event', '', $details);
    }

    /** A change made by the panel itself (automatic assignment): no author. */
    public function systemEvent(int $id, array $details): void
    {
        $this->app->db()->insert(
            'INSERT INTO lead_notes (lead_id, user_id, author, kind, body, details, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?)',
            [$id, '', 'event', '', json_encode($details, JSON_UNESCAPED_UNICODE), time()]
        );
    }

    private function insertNote(int $id, array $session, string $kind, string $body, array $details): void
    {
        $this->app->db()->insert(
            'INSERT INTO lead_notes (lead_id, user_id, author, kind, body, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$id, (int) $session['uid'], (string) ($session['name'] ?? ''), $kind, $body, json_encode($details ?: new \stdClass(), JSON_UNESCAPED_UNICODE), time()]
        );
    }

    /** @return array{0:list<string>,1:list<mixed>} */
    private function where(string $filter, string $q, string $service): array
    {
        $where = [];
        $params = [];
        if ($filter === 'active') {
            $where[] = "status IN ('new', 'contacted', 'quoted')";
        } elseif ($filter !== 'all') {
            $where[] = 'status = ?';
            $params[] = $filter;
        }
        $service = mb_substr(trim($service), 0, 120);
        if ($service !== '') {
            $where[] = 'service = ?';
            $params[] = $service;
        }
        $q = mb_substr(trim($q), 0, 100);
        if ($q !== '') {
            if (preg_match('/^#?(\d{1,9})$/', $q, $m)) {
                $where[] = 'id = ?';
                $params[] = (int) $m[1];
            } else {
                $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $q) . '%';
                $where[] = "(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR message LIKE ? ESCAPE '\\')";
                array_push($params, $like, $like, $like, $like);
            }
        }
        return [$where, $params];
    }

    private static function line(string $s, int $max): string
    {
        $s = mb_check_encoding($s, 'UTF-8') ? $s : '';
        $s = preg_replace('/[\x00-\x1F\x7F\x{202A}-\x{202E}\x{2066}-\x{2069}]+/u', ' ', $s) ?? '';
        return mb_substr(trim(preg_replace('/\s+/u', ' ', $s) ?? ''), 0, $max);
    }

    private static function multiline(string $s): string
    {
        $s = mb_check_encoding($s, 'UTF-8') ? $s : '';
        $s = str_replace(["\r\n", "\r"], "\n", $s);
        $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x{202A}-\x{202E}\x{2066}-\x{2069}]/u', '', $s) ?? '';
        $s = preg_replace("/\n{3,}/", "\n\n", $s) ?? '';
        return trim($s);
    }
}
