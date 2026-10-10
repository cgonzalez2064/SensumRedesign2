<?php
declare(strict_types=1);

namespace Sensum\Cms;

use Sensum\Cms\Http\ApiError;

/**
 * Support tickets — the reports sent with "Reportar un problema", managed by
 * the owner account (IT): status, priority, edits, a conversation with the
 * person who reported it and internal notes. The reporter sees their own
 * tickets, the public part of the conversation, and can reply (which reopens
 * a ticket waiting for information or marked as resolved).
 *
 * E-mail notices: to the reporter when IT asks for information, replies,
 * resolves, closes or starts work (if IT ticks "notify"); to the support
 * address when the reporter replies. Nobody can see another person's
 * tickets (404), and internal notes never leave the owner's view.
 */
final class Tickets
{
    public const STATUSES = ['new', 'in_progress', 'waiting', 'resolved', 'closed'];
    public const OPEN = ['new', 'in_progress', 'waiting'];
    public const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
    public const FILTERS = ['open', 'new', 'in_progress', 'waiting', 'resolved', 'closed', 'all'];
    /** Response-time targets the owner can choose (hours). */
    public const SLA_HOURS = [4, 8, 24, 48, 72];
    /** Resolved tickets without an answer from the reporter close on their own after this many days. */
    public const AUTO_CLOSE_DAYS = 7;
    private const MAX_MESSAGE = 4000;

    public function __construct(private App $app)
    {
    }

    private function reports(): Reports
    {
        return new Reports($this->app);
    }

    /**
     * Who manages tickets (all of them, status, notes, figures): the owner (IT)
     * and accounts with the "support" access.
     */
    public function manages(array $session): bool
    {
        return $this->app->auth()->can($session, 'support');
    }

    private function requireManager(array $session): void
    {
        if (!$this->manages($session)) {
            throw new ApiError(403, 'forbidden');
        }
    }

    /** The ticket if this person may see it (owner: any; others: their own), otherwise 404. */
    public function visible(array $session, int $id): array
    {
        $r = $this->reports()->find($id);
        if (!$this->manages($session) && (int) $r['user_id'] !== (int) $session['uid']) {
            throw new ApiError(404, 'not_found'); // never reveal other people's tickets
        }
        return $r;
    }

    // ------------------------------------------------------------------ reading

    /** Owner: all tickets with a filter and search; others: their own. */
    public function list(array $session, string $filter = 'open', string $q = ''): array
    {
        $db = $this->app->db();
        if (!$this->manages($session)) {
            $rows = $db->all('SELECT * FROM support_reports WHERE user_id = ? ORDER BY COALESCE(updated_at, created_at) DESC, id DESC LIMIT 100', [$session['uid']]);
            return [
                'reports' => array_map(fn ($r) => $this->present($r, false), $rows),
                'counts' => ['unread' => (int) $db->value('SELECT COUNT(*) FROM support_reports WHERE user_id = ? AND reporter_unread = 1', [$session['uid']])],
            ];
        }
        $filter = in_array($filter, self::FILTERS, true) ? $filter : 'open';
        $where = [];
        $params = [];
        if ($filter === 'open') {
            $where[] = "status IN ('new', 'in_progress', 'waiting')";
        } elseif ($filter !== 'all') {
            $where[] = 'status = ?';
            $params[] = $filter;
        }
        $q = mb_substr(trim($q), 0, 100);
        if ($q !== '') {
            if (preg_match('/^#?(\d{1,9})$/', $q, $m)) {
                $where[] = 'id = ?';
                $params[] = (int) $m[1];
            } else {
                $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $q) . '%';
                $where[] = "(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR reporter_name LIKE ? ESCAPE '\\' OR reporter_email LIKE ? ESCAPE '\\')";
                array_push($params, $like, $like, $like, $like);
            }
        }
        $sql = 'SELECT * FROM support_reports' . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
            . " ORDER BY owner_unread DESC, CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, COALESCE(updated_at, created_at) DESC, id DESC LIMIT 200";
        $counts = array_fill_keys(self::STATUSES, 0);
        foreach ($db->all('SELECT status, COUNT(*) AS n FROM support_reports GROUP BY status') as $c) {
            $counts[$c['status']] = (int) $c['n'];
        }
        $counts['open'] = $counts['new'] + $counts['in_progress'] + $counts['waiting'];
        $counts['all'] = array_sum(array_intersect_key($counts, array_flip(self::STATUSES)));
        $counts['unread'] = (int) $db->value('SELECT COUNT(*) FROM support_reports WHERE owner_unread = 1');
        $since = time() - 30 * 86400;
        return ['reports' => array_map(fn ($r) => $this->present($r, true), $db->all($sql, $params)), 'counts' => $counts, 'filter' => $filter,
            'service' => $this->serviceLevels($since, time() + 1)];
    }

    /** Number shown next to "Solicitudes de soporte" in the menu. */
    public function badge(array $session): int
    {
        return $this->manages($session)
            ? (int) $this->app->db()->value("SELECT COUNT(*) FROM support_reports WHERE owner_unread = 1 OR status = 'new'")
            : (int) $this->app->db()->value('SELECT COUNT(*) FROM support_reports WHERE user_id = ? AND reporter_unread = 1', [$session['uid']]);
    }

    /** One ticket with its conversation; marks it as read for whoever opens it. */
    public function detail(array $session, int $id): array
    {
        $r = $this->visible($session, $id);
        $owner = $this->manages($session);
        $mine = (int) $r['user_id'] === (int) $session['uid'];
        // "Ver como" changes nothing for the person, not even what they have read.
        $markRead = !$this->app->viewOnly();
        if ($markRead && $owner && (int) $r['owner_unread'] === 1) {
            $this->app->db()->run('UPDATE support_reports SET owner_unread = 0 WHERE id = ?', [$id]);
            $r['owner_unread'] = 0;
        }
        if ($markRead && $mine && (int) $r['reporter_unread'] === 1) {
            $this->app->db()->run('UPDATE support_reports SET reporter_unread = 0 WHERE id = ?', [$id]);
            $r['reporter_unread'] = 0;
        }
        $messages = [];
        foreach ($this->app->db()->all('SELECT * FROM report_messages WHERE report_id = ? ORDER BY id', [$id]) as $m) {
            $details = json_decode((string) $m['details'], true) ?: [];
            // The reporter sees messages and status changes, never notes or edits.
            if (!$owner && ($m['kind'] === 'note' || ($m['kind'] === 'event' && ($details['action'] ?? '') !== 'status'))) {
                continue;
            }
            $messages[] = [
                'id' => (int) $m['id'],
                'kind' => $m['kind'],
                'role' => $m['author_role'],
                'author' => $m['author_name'],
                'body' => $m['body'],
                'details' => $details,
                'emailStatus' => $owner ? $m['email_status'] : null,
                'createdAt' => (int) $m['created_at'],
            ];
        }
        $out = $this->present($r, $owner);
        if ($owner) {
            $out['reporterEmail'] = $r['reporter_email'];
            $out['context'] = json_decode((string) $r['context'], true) ?: [];
            $out['emailAttempts'] = (int) $r['email_attempts'];
        }
        return ['report' => $out, 'messages' => $messages, 'canManage' => $owner, 'canReply' => $r['status'] !== 'closed' && ($owner || $mine),
            'canRate' => $mine && !$owner && in_array($r['status'], ['resolved', 'closed'], true) && $r['rating'] === null,
            'slaHours' => $owner ? $this->slaHours() : null];
    }

    public function present(array $r, bool $forOwner): array
    {
        return $this->reports()->present($r) + [
            'status' => $r['status'] ?? 'new',
            'priority' => $r['priority'] ?? 'normal',
            'updatedAt' => (int) ($r['updated_at'] ?? $r['created_at']),
            'resolvedAt' => isset($r['resolved_at']) ? (int) $r['resolved_at'] : null,
            'unread' => (bool) ($forOwner ? ($r['owner_unread'] ?? 0) : ($r['reporter_unread'] ?? 0)),
            'firstResponseAt' => isset($r['first_response_at']) ? (int) $r['first_response_at'] : null,
            'rating' => isset($r['rating']) ? (int) $r['rating'] : null,
            'ratingComment' => isset($r['rating']) ? (string) ($r['rating_comment'] ?? '') : null,
            'closedAuto' => (bool) ($r['closed_auto'] ?? 0),
        ];
    }

    // ------------------------------------------------------------------ figures for the charts

    /**
     * Ticket figures for managers over the last $days days: per-day created
     * and resolved, current status mix, type/priority/area of the period's
     * tickets, and the service levels.
     */
    public function analytics(array $session, int $days, ?int $now = null): array
    {
        $this->requireManager($session);
        $now ??= time();
        $start = (int) strtotime('today', $now) - ($days - 1) * 86400;
        $offset = (int) date('Z', $now);
        $db = $this->app->db();
        $series = [];
        for ($i = 0; $i < $days; $i++) {
            $d = date('Y-m-d', $start + $i * 86400 + 43200);
            $series[$d] = ['day' => $d, 'created' => 0, 'resolved' => 0];
        }
        $day = fn (string $col) => "date(({$col} + {$offset}), 'unixepoch')";
        foreach ($db->all('SELECT ' . $day('created_at') . ' AS d, COUNT(*) AS n FROM support_reports WHERE created_at >= ? GROUP BY d', [$start]) as $r) {
            if (isset($series[$r['d']])) {
                $series[$r['d']]['created'] = (int) $r['n'];
            }
        }
        foreach ($db->all('SELECT ' . $day('resolved_at') . " AS d, COUNT(*) AS n FROM support_reports WHERE resolved_at >= ? AND status IN ('resolved', 'closed') GROUP BY d", [$start]) as $r) {
            if (isset($series[$r['d']])) {
                $series[$r['d']]['resolved'] = (int) $r['n'];
            }
        }
        $group = function (string $col) use ($db, $start): array {
            $out = [];
            foreach ($db->all("SELECT {$col} AS k, COUNT(*) AS n FROM support_reports WHERE created_at >= ? GROUP BY {$col}", [$start]) as $r) {
                $out[(string) $r['k']] = (int) $r['n'];
            }
            return $out;
        };
        $status = array_fill_keys(self::STATUSES, 0);
        foreach ($db->all('SELECT status, COUNT(*) AS n FROM support_reports GROUP BY status') as $r) {
            $status[$r['status']] = (int) $r['n'];
        }
        $resolved = $db->one("SELECT COUNT(*) AS n, AVG(resolved_at - created_at) AS secs FROM support_reports WHERE resolved_at >= ? AND status IN ('resolved', 'closed')", [$start]);
        return [
            'days' => array_values($series),
            'created' => (int) $db->value('SELECT COUNT(*) FROM support_reports WHERE created_at >= ?', [$start]),
            'resolved' => (int) ($resolved['n'] ?? 0),
            'avgResolutionHours' => $resolved['secs'] !== null ? round((float) $resolved['secs'] / 3600, 1) : null,
            'status' => $status,
            'open' => $status['new'] + $status['in_progress'] + $status['waiting'],
            'byType' => $group('type'),
            'byPriority' => $group('priority'),
            'byArea' => $group('area'),
            'service' => $this->serviceLevels($start, $now + 1),
        ];
    }

    // ------------------------------------------------------------------ service levels

    /** The person who reported it rates the help (1–5) once the ticket is resolved or closed. */
    public function rate(array $session, int $id, mixed $rating, string $comment): array
    {
        $r = $this->visible($session, $id);
        if ((int) $r['user_id'] !== (int) $session['uid']) {
            throw new ApiError(403, 'forbidden'); // only the reporter rates (not IT)
        }
        if (!in_array($r['status'], ['resolved', 'closed'], true)) {
            throw new ApiError(409, 'ticket_not_resolved');
        }
        if ($r['rating'] !== null) {
            throw new ApiError(409, 'already_rated');
        }
        if (!is_int($rating) || $rating < 1 || $rating > 5) {
            throw ApiError::validation(['rating' => 'invalid']);
        }
        $comment = self::multiline($comment);
        if (mb_strlen($comment) > 500) {
            throw ApiError::validation(['comment' => 'too_long']);
        }
        $this->app->db()->run('UPDATE support_reports SET rating = ?, rating_comment = ?, rated_at = ?, owner_unread = CASE WHEN ? <= 2 THEN 1 ELSE owner_unread END WHERE id = ?',
            [$rating, $comment, time(), $rating, $id]);
        $this->app->activity((int) $session['uid'], 'ticket_rated', (string) $id, ['rating' => $rating], null);
        return $this->detail($session, $id);
    }

    public function slaHours(): int
    {
        $h = (int) $this->app->settings()->get('ticket_sla_hours', '24');
        return in_array($h, self::SLA_HOURS, true) ? $h : 24;
    }

    public function setSlaHours(mixed $hours): int
    {
        if (!is_int($hours) || !in_array($hours, self::SLA_HOURS, true)) {
            throw ApiError::validation(['slaHours' => 'invalid']);
        }
        $this->app->settings()->set('ticket_sla_hours', (string) $hours);
        return $hours;
    }

    /**
     * Scheduled check: resolved tickets the reporter did not answer for
     * AUTO_CLOSE_DAYS days are closed. Returns how many.
     */
    public function autoClose(?int $now = null): int
    {
        $now ??= time();
        $db = $this->app->db();
        $rows = $db->all("SELECT id FROM support_reports WHERE status = 'resolved' AND resolved_at IS NOT NULL AND resolved_at <= ?", [$now - self::AUTO_CLOSE_DAYS * 86400]);
        foreach ($rows as $row) {
            $db->transaction(function () use ($db, $row, $now) {
                $db->run("UPDATE support_reports SET status = 'closed', closed_auto = 1, updated_at = ? WHERE id = ? AND status = 'resolved'", [$now, $row['id']]);
                $db->insert('INSERT INTO report_messages (report_id, user_id, author_name, author_role, kind, body, details, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)',
                    [$row['id'], 'Sistema', 'support', 'event', '', json_encode(['action' => 'status', 'from' => 'resolved', 'to' => 'closed', 'auto' => true]), $now]);
            });
        }
        return count($rows);
    }

    /**
     * Service figures for a period: first-response time against the target,
     * satisfaction, tickets closed on their own.
     * @return array{answered:int,avgFirstResponseHours:?float,withinTarget:?int,targetHours:int,ratings:int,ratingAvg:?float,autoClosed:int}
     */
    public function serviceLevels(int $start, int $end): array
    {
        $db = $this->app->db();
        $target = $this->slaHours();
        $out = ['answered' => 0, 'avgFirstResponseHours' => null, 'withinTarget' => null, 'targetHours' => $target, 'ratings' => 0, 'ratingAvg' => null, 'autoClosed' => 0];
        try {
            $rows = $db->all('SELECT first_response_at - created_at AS secs FROM support_reports WHERE created_at >= ? AND created_at < ? AND first_response_at IS NOT NULL', [$start, $end]);
            if ($rows) {
                $secs = array_map(fn ($r) => max(0, (int) $r['secs']), $rows);
                $out['answered'] = count($secs);
                $out['avgFirstResponseHours'] = round(array_sum($secs) / count($secs) / 3600, 1);
                $out['withinTarget'] = (int) round(100 * count(array_filter($secs, fn ($s) => $s <= $target * 3600)) / count($secs));
            }
            $rating = $db->one('SELECT COUNT(*) AS n, AVG(rating) AS avg FROM support_reports WHERE rated_at >= ? AND rated_at < ?', [$start, $end]);
            $out['ratings'] = (int) ($rating['n'] ?? 0);
            $out['ratingAvg'] = $out['ratings'] > 0 ? round((float) $rating['avg'], 1) : null;
            $out['autoClosed'] = (int) $db->value('SELECT COUNT(*) FROM support_reports WHERE closed_auto = 1 AND updated_at >= ? AND updated_at < ?', [$start, $end]);
        } catch (\Throwable) {
            // older database
        }
        return $out;
    }

    /** Path of the screenshot sent with the ticket (owner or the reporter). */
    public function screenshot(array $session, int $id): array
    {
        $r = $this->visible($session, $id);
        $name = (string) ($r['screenshot'] ?? '');
        if (!preg_match('/^report-\d{8}-[a-f0-9]{12}-w\d+\.(webp|jpg)$/', $name, $m)) {
            throw new ApiError(404, 'not_found');
        }
        $path = $this->app->storage('reports/' . $name);
        if (!is_file($path)) {
            throw new ApiError(404, 'not_found');
        }
        return ['path' => $path, 'mime' => $m[1] === 'webp' ? 'image/webp' : 'image/jpeg'];
    }

    // ------------------------------------------------------------------ changes (owner)

    /** Edits the ticket's title, description, type, area or priority (owner). */
    public function edit(array $session, int $id, array $in): array
    {
        $this->requireManager($session);
        $r = $this->visible($session, $id);
        $errors = [];
        $changes = [];
        $set = function (string $field, string $column, string $value) use ($r, &$changes) {
            if ($value !== (string) $r[$column]) {
                $changes[$field] = [mb_substr((string) $r[$column], 0, 200), mb_substr($value, 0, 200), $column, $value];
            }
        };
        if (array_key_exists('title', $in)) {
            $title = self::line((string) $in['title'], 500);
            if (mb_strlen($title) < 3 || mb_strlen($title) > 120) {
                $errors['title'] = $title === '' ? 'required' : (mb_strlen($title) < 3 ? 'too_short' : 'too_long');
            } else {
                $set('title', 'title', $title);
            }
        }
        if (array_key_exists('description', $in)) {
            $description = self::multiline((string) $in['description']);
            if (mb_strlen($description) < 10 || mb_strlen($description) > self::MAX_MESSAGE) {
                $errors['description'] = $description === '' ? 'required' : (mb_strlen($description) < 10 ? 'too_short' : 'too_long');
            } else {
                $set('description', 'description', $description);
            }
        }
        foreach (['type' => Reports::TYPES, 'area' => Reports::AREAS, 'priority' => self::PRIORITIES] as $field => $allowed) {
            if (array_key_exists($field, $in)) {
                if (!in_array($in[$field], $allowed, true)) {
                    $errors[$field] = 'invalid';
                } else {
                    $set($field, $field, (string) $in[$field]);
                }
            }
        }
        if ($errors) {
            throw ApiError::validation($errors);
        }
        if ($changes) {
            $this->app->db()->transaction(function () use ($id, $changes, $session) {
                $sql = [];
                $params = [];
                foreach ($changes as [, , $column, $value]) {
                    $sql[] = "{$column} = ?";
                    $params[] = $value;
                }
                $params[] = time();
                $params[] = $id;
                $this->app->db()->run('UPDATE support_reports SET ' . implode(', ', $sql) . ', updated_at = ? WHERE id = ?', $params);
                $this->event($id, $session, ['action' => 'edit', 'fields' => array_map(fn ($c) => [$c[0], $c[1]], $changes)]);
            });
            $this->app->activity((int) $session['uid'], 'ticket_edited', (string) $id, ['fields' => array_keys($changes)], null);
        }
        return $this->detail($session, $id);
    }

    /**
     * Changes the status (owner), optionally with a message to the reporter
     * and an e-mail notice. Asking for information needs a message.
     */
    public function setStatus(array $session, int $id, string $status, string $message, bool $notify): array
    {
        $this->requireManager($session);
        $r = $this->visible($session, $id);
        if (!in_array($status, self::STATUSES, true)) {
            throw ApiError::validation(['status' => 'invalid']);
        }
        $message = self::multiline($message);
        if (mb_strlen($message) > self::MAX_MESSAGE) {
            throw ApiError::validation(['message' => 'too_long']);
        }
        if ($status === 'waiting' && $message === '') {
            throw ApiError::validation(['message' => 'required']); // say what information is needed
        }
        if ($status === $r['status'] && $message === '') {
            return $this->detail($session, $id);
        }
        $now = time();
        $messageId = null;
        $eventId = null;
        $this->app->db()->transaction(function () use ($r, $id, $status, $message, $session, $now, &$messageId, &$eventId) {
            $this->app->db()->run(
                'UPDATE support_reports SET status = ?, updated_at = ?, resolved_at = ?, reporter_unread = 1, first_response_at = COALESCE(first_response_at, ?) WHERE id = ?',
                [$status, $now, $status === 'resolved' ? $now : ($status === 'closed' ? $r['resolved_at'] : null), $now, $id]
            );
            if ($status !== $r['status']) {
                $eventId = $this->event($id, $session, ['action' => 'status', 'from' => $r['status'], 'to' => $status]);
            }
            if ($message !== '') {
                $messageId = $this->insertMessage($id, $session, 'support', 'message', $message);
            }
        });
        $this->app->activity((int) $session['uid'], 'ticket_status', (string) $id, ['from' => $r['status'], 'to' => $status], null);
        if ($notify) {
            $kind = $status === $r['status'] ? 'reply' : $status;
            $sent = $this->notifyReporter($this->reports()->find($id), $kind, $message);
            $this->markEmail($messageId ?? $eventId, $sent);
        }
        return $this->detail($session, $id);
    }

    /**
     * A message on the ticket. Owner: public reply (optionally e-mailed) or
     * internal note. Reporter: reply (IT is e-mailed; a ticket waiting for
     * information or resolved goes back to "in progress").
     */
    public function addMessage(array $session, int $id, string $body, bool $internal, bool $notify): array
    {
        $r = $this->visible($session, $id);
        $owner = $this->manages($session);
        $body = self::multiline($body);
        if ($body === '') {
            throw ApiError::validation(['body' => 'required']);
        }
        if (mb_strlen($body) > self::MAX_MESSAGE) {
            throw ApiError::validation(['body' => 'too_long']);
        }
        if ($internal && !$owner) {
            throw new ApiError(403, 'forbidden');
        }
        if ($r['status'] === 'closed' && !$owner) {
            throw new ApiError(409, 'ticket_closed');
        }
        $rl = $this->app->rateLimiter();
        $limit = $owner ? 120 : 20;
        if (!$rl->hit('ticket_message', (string) $session['uid'], $limit, 3600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $role = $owner ? 'support' : 'reporter';
        $now = time();
        $newStatus = $r['status'];
        if ($role === 'reporter' && in_array($r['status'], ['waiting', 'resolved'], true)) {
            $newStatus = 'in_progress'; // information received / not solved after all
        } elseif ($role === 'support' && !$internal && $r['status'] === 'new') {
            $newStatus = 'in_progress'; // first answer from IT
        }
        $messageId = null;
        $this->app->db()->transaction(function () use ($r, $id, $session, $role, $internal, $body, $now, $newStatus, &$messageId) {
            if ($newStatus !== $r['status']) {
                $this->event($id, $session, ['action' => 'status', 'from' => $r['status'], 'to' => $newStatus], $role);
            }
            $messageId = $this->insertMessage($id, $session, $role, $internal ? 'note' : 'message', $body);
            $answered = $role === 'support' && !$internal;
            $this->app->db()->run(
                'UPDATE support_reports SET status = ?, updated_at = ?, resolved_at = ?, owner_unread = ?, reporter_unread = ?, first_response_at = CASE WHEN ? THEN COALESCE(first_response_at, ?) ELSE first_response_at END WHERE id = ?',
                [$newStatus, $now, in_array($newStatus, ['resolved', 'closed'], true) ? $r['resolved_at'] : null,
                    $role === 'reporter' ? 1 : (int) $r['owner_unread'], $answered ? 1 : (int) $r['reporter_unread'], $answered ? 1 : 0, $now, $id]
            );
        });
        $this->app->activity((int) $session['uid'], $internal ? 'ticket_note' : 'ticket_reply', (string) $id, [], null);
        $fresh = $this->reports()->find($id);
        if ($role === 'reporter') {
            $this->markEmail($messageId, $this->notifySupport($fresh, $body, (string) $session['name'], $r['status'] !== $newStatus ? $r['status'] : null));
        } elseif (!$internal && $notify) {
            $this->markEmail($messageId, $this->notifyReporter($fresh, 'reply', $body));
        }
        return $this->detail($session, $id);
    }

    // ------------------------------------------------------------------ storage helpers

    private function insertMessage(int $id, array $session, string $role, string $kind, string $body, array $details = []): int
    {
        return $this->app->db()->insert(
            'INSERT INTO report_messages (report_id, user_id, author_name, author_role, kind, body, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, (int) $session['uid'], (string) $session['name'], $role, $kind, $body, json_encode($details ?: new \stdClass(), JSON_UNESCAPED_UNICODE), time()]
        );
    }

    private function event(int $id, array $session, array $details, string $role = 'support'): int
    {
        return $this->insertMessage($id, $session, $role, 'event', '', $details);
    }

    private function markEmail(?int $messageId, bool $sent): void
    {
        if ($messageId) {
            $this->app->db()->run('UPDATE report_messages SET email_status = ? WHERE id = ?', [$sent ? 'sent' : 'failed', $messageId]);
        }
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

    // ------------------------------------------------------------------ e-mail

    private function strings(string $lang): array
    {
        return require $this->app->root('lang/' . ($lang === 'en' ? 'en' : 'es') . '.php');
    }

    private static function fill(string $s, array $vars): string
    {
        return strtr($s, array_combine(array_map(fn ($k) => '{' . $k . '}', array_keys($vars)), array_map('strval', array_values($vars))));
    }

    /** Notice to the person who reported it. $kind: waiting | resolved | closed | in_progress | new | reply */
    private function notifyReporter(array $r, string $kind, string $message): bool
    {
        $user = $r['user_id'] !== null ? $this->app->db()->one('SELECT email, name, lang, status FROM users WHERE id = ?', [$r['user_id']]) : null;
        $to = $user && $user['status'] === 'active' ? (string) $user['email'] : (string) $r['reporter_email'];
        $lang = ($user['lang'] ?? 'es') === 'en' ? 'en' : 'es';
        $s = $this->strings($lang);
        $kind = in_array($kind, ['waiting', 'resolved', 'closed', 'in_progress', 'reply'], true) ? $kind : 'reply';
        $vars = ['id' => (int) $r['id'], 'title' => Mailer::oneLine((string) $r['title'], 120), 'name' => explode(' ', trim((string) ($user['name'] ?? $r['reporter_name'])))[0]];
        $e = fn (string $v) => Emails::esc($v);
        $colors = ['waiting' => ['#fff4e0', '#a15c00'], 'resolved' => ['#e8f6ec', '#166534'], 'closed' => ['#f2f2f1', '#57534e'], 'in_progress' => ['#e8effd', '#1d4ed8'], 'reply' => ['#e8effd', '#1d4ed8']];
        [$bg, $fg] = $colors[$kind];
        $link = (new Emails($this->app))->adminUrl('reportes/' . (int) $r['id']);
        $body = '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:' . $bg . ';color:' . $fg . ';border-radius:999px;padding:5px 12px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif">'
            . $e($s['tk.badge.' . $kind]) . '</td></tr></table>'
            . '<h1 style="margin:14px 0 8px;font-size:22px;line-height:1.3;color:#1c1c1c">' . $e(self::fill($s['tk.title.' . $kind], $vars)) . '</h1>'
            . '<p style="margin:0 0 14px;color:#2b2b31">' . $e(self::fill($s['tk.intro.' . $kind], $vars)) . '</p>'
            . '<div style="margin:0 0 6px;padding:10px 14px;background:#f7f7f9;border-radius:10px;font-size:14px;color:#3c3c43"><span style="color:#7a7a82">' . $e(self::fill($s['tk.ticket'], $vars)) . '</span> ' . $e((string) $r['title']) . '</div>';
        $text = self::fill($s['tk.title.' . $kind], $vars) . "\n\n" . self::fill($s['tk.intro.' . $kind], $vars) . "\n\n" . self::fill($s['tk.ticket'], $vars) . ' ' . $r['title'] . "\n\n";
        if ($message !== '') {
            $body .= '<div style="margin:16px 0 0;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#7a7a82">' . $e($s['tk.fromSupport']) . '</div>'
                . '<div style="margin:6px 0 0;padding:16px 18px;background:#fff8f1;border-left:4px solid #f6740a;border-radius:0 12px 12px 0;white-space:pre-wrap;font-size:15px;color:#1f2328">' . $e($message) . '</div>';
            $text .= $s['tk.fromSupport'] . ":\n" . $message . "\n\n";
        }
        $cta = $kind === 'waiting' || $kind === 'reply' ? $s['tk.cta.reply'] : $s['tk.cta.view'];
        $body .= Emails::cta($cta, $link);
        $text .= $cta . ': ' . $link . "\n";
        $layout = (new Emails($this->app))->branded($lang, self::fill($s['tk.tag'], $vars), self::fill($s['tk.title.' . $kind], $vars), $body, $e($s['tk.footer.reporter']));
        $ok = $this->app->mailer()->send([
            'to' => $to,
            'subject' => self::fill($s['tk.subject.' . $kind], $vars),
            'text' => $text,
            'html' => $layout['html'],
            'embedded' => $layout['embedded'],
            'replyTo' => [$this->app->mailSettings()->supportEmail(), 'Soporte Sensum'],
        ]);
        if (!$ok) {
            $this->app->logger()->error('ticket_email_failed', ['message' => 'Ticket notice to the reporter could not be sent', 'report' => (int) $r['id']]);
        }
        return $ok;
    }

    /** Notice to IT (support address) when the reporter replies. */
    private function notifySupport(array $r, string $message, string $byName, ?string $reopenedFrom): bool
    {
        $ownerLang = $this->app->db()->value('SELECT lang FROM users WHERE lower(email) = ?', [$this->app->config->ownerEmail()]) === 'en' ? 'en' : 'es';
        $s = $this->strings($ownerLang);
        $vars = ['id' => (int) $r['id'], 'title' => Mailer::oneLine((string) $r['title'], 120), 'name' => Mailer::oneLine($byName, 80)];
        $e = fn (string $v) => Emails::esc($v);
        $link = (new Emails($this->app))->adminUrl('reportes/' . (int) $r['id']);
        $intro = self::fill($s[$reopenedFrom === 'resolved' ? 'tk.support.reopened' : ($reopenedFrom === 'waiting' ? 'tk.support.info' : 'tk.support.intro')], $vars);
        $body = '<h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;color:#1c1c1c">' . $e(self::fill($s['tk.support.title'], $vars)) . '</h1>'
            . '<p style="margin:0 0 14px;color:#2b2b31">' . $e($intro) . '</p>'
            . '<div style="margin:0 0 6px;padding:10px 14px;background:#f7f7f9;border-radius:10px;font-size:14px;color:#3c3c43"><span style="color:#7a7a82">' . $e(self::fill($s['tk.ticket'], $vars)) . '</span> ' . $e((string) $r['title']) . '</div>'
            . '<div style="margin:16px 0 0;padding:16px 18px;background:#fff8f1;border-left:4px solid #f6740a;border-radius:0 12px 12px 0;white-space:pre-wrap;font-size:15px;color:#1f2328">' . $e($message) . '</div>'
            . Emails::cta($s['tk.cta.open'], $link);
        $text = self::fill($s['tk.support.title'], $vars) . "\n\n" . $intro . "\n\n" . $message . "\n\n" . $link . "\n";
        $layout = (new Emails($this->app))->branded($ownerLang, self::fill($s['tk.tag'], $vars), $intro, $body, $e($s['tk.footer.support']));
        $ok = $this->app->mailer()->send([
            'to' => $this->app->mailSettings()->supportEmail(),
            'subject' => self::fill($s['tk.support.subject'], $vars),
            'text' => $text,
            'html' => $layout['html'],
            'embedded' => $layout['embedded'],
            'replyTo' => [(string) $r['reporter_email'], (string) $r['reporter_name']],
        ]);
        if (!$ok) {
            $this->app->logger()->error('ticket_email_failed', ['message' => 'Ticket reply notice to support could not be sent', 'report' => (int) $r['id']]);
        }
        return $ok;
    }
}
