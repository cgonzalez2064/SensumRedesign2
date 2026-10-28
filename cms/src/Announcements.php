<?php
declare(strict_types=1);

namespace Sensum\Cms;

use Sensum\Cms\Http\ApiError;

/**
 * «Avisos al equipo» (owner only, #/avisos): e-mails the team about the panel's
 * «Novedades» (cms/wiki/wiki.json, Wiki.php). Each active account gets one
 * e-mail, in its language, with only the items it can use — the same rule as
 * the dialog in the panel — and never the same item twice (`news_emailed`,
 * unless the owner asks to send it again). Every send is logged
 * (`announcements`, migration 021_announcements).
 */
final class Announcements
{
    public const MESSAGE_MAX = 600;
    private const IDS_MAX = 20;

    public function __construct(private App $app)
    {
    }

    /** Active accounts that can receive it: everyone but the owner. */
    private function accounts(): array
    {
        $rows = $this->app->db()->all("SELECT * FROM users WHERE status = 'active' ORDER BY name COLLATE NOCASE, id");
        return array_values(array_filter($rows, fn ($u) => !$this->app->auth()->isOwner($u)));
    }

    /** @return array<string,array> the «Novedades» someone else can receive, by id (owner-only ones left out) */
    private function catalog(): array
    {
        $out = [];
        foreach ((new Wiki($this->app))->meta()['news'] as $n) {
            if (is_string($n['id'] ?? null) && empty($n['owner'])) {
                $out[$n['id']] = $n;
            }
        }
        return $out;
    }

    /** @return array<string,array<int,true>> news id → user ids, from one of the two tables */
    private function marks(string $table): array
    {
        $out = [];
        foreach ($this->app->db()->all("SELECT user_id, news_id FROM {$table}") as $r) {
            $out[(string) $r['news_id']][(int) $r['user_id']] = true;
        }
        return $out;
    }

    /**
     * The «Novedades» with, for each, how many people can use it, how many saw
     * it in the panel and how many got it by e-mail; and the last sends.
     */
    public function overview(string $lang): array
    {
        $wiki = new Wiki($this->app);
        $accounts = $this->accounts();
        $seen = $this->marks('wiki_news_seen');
        $mailed = $this->marks('news_emailed');
        $items = [];
        foreach ($this->catalog() as $id => $n) {
            $for = array_map('intval', array_column(array_filter($accounts, fn ($u) => $wiki->forAccount($n, $u, (int) $u['created_at'])), 'id'));
            $items[] = [
                'id' => $id,
                'date' => (string) ($n['date'] ?? ''),
                'title' => (string) ($n[$lang]['title'] ?? $n['es']['title'] ?? $id),
                'summary' => (string) ($n[$lang]['summary'] ?? ''),
                'article' => (string) ($n['article'] ?? ''),
                'perms' => array_values((array) ($n['perms'] ?? [])),
                'canAsk' => !empty($n['canAsk']),
                'eligible' => count($for),
                'seen' => count(array_filter($for, fn ($u) => isset($seen[$id][$u]))),
                'emailed' => count(array_filter($for, fn ($u) => isset($mailed[$id][$u]))),
            ];
        }
        usort($items, fn ($a, $b) => strcmp($b['date'], $a['date']));
        $history = array_map(fn ($r) => [
            'id' => (int) $r['id'],
            'at' => (int) $r['created_at'],
            'by' => (string) ($r['by_name'] ?? ''),
            'news' => array_values(array_filter((array) json_decode((string) $r['news_ids'], true), 'is_string')),
            'message' => (string) $r['message'],
            'recipients' => (int) $r['recipients'],
            'failed' => (int) $r['failed'],
        ], $this->app->db()->all('SELECT a.*, u.name AS by_name FROM announcements a LEFT JOIN users u ON u.id = a.sent_by ORDER BY a.id DESC LIMIT 20'));
        return ['news' => $items, 'history' => $history, 'mailReady' => $this->app->mailer()->isConfigured()];
    }

    /** @return list<string> known, receivable «Novedades» ids (1–20) */
    public function validIds(mixed $ids): array
    {
        $catalog = $this->catalog();
        if (!is_array($ids) || !$ids || count($ids) > self::IDS_MAX) {
            throw ApiError::validation(['ids' => 'invalid']);
        }
        $out = [];
        foreach ($ids as $id) {
            if (!is_string($id) || !isset($catalog[$id])) {
                throw ApiError::validation(['ids' => 'invalid']);
            }
            $out[$id] = true;
        }
        return array_keys($out);
    }

    /** The owner's optional words: plain text, at most 600 characters, no control characters. */
    public static function cleanMessage(mixed $m): string
    {
        if ($m !== null && !is_string($m)) {
            throw ApiError::validation(['message' => 'invalid']);
        }
        $m = trim(preg_replace('/[^\P{C}\n]/u', '', str_replace("\r\n", "\n", (string) $m)) ?? '');
        $m = preg_replace("/\n{3,}/", "\n\n", $m) ?? $m;
        if (mb_strlen($m) > self::MESSAGE_MAX) {
            throw ApiError::validation(['message' => 'too_long']);
        }
        return $m;
    }

    /**
     * Who gets an e-mail and with which items: each active account (not the
     * owner) with the chosen items it can use — without those already e-mailed
     * to it unless `$again`, and only the ones not seen in the panel if `$unseenOnly`.
     *
     * @param list<string> $ids
     * @return list<array{user:array,items:list<string>}>
     */
    public function recipients(array $ids, bool $again, bool $unseenOnly): array
    {
        $wiki = new Wiki($this->app);
        $catalog = $this->catalog();
        $seen = $this->marks('wiki_news_seen');
        $mailed = $this->marks('news_emailed');
        $out = [];
        foreach ($this->accounts() as $u) {
            $uid = (int) $u['id'];
            $items = array_values(array_filter($ids, fn ($id) => $wiki->forAccount($catalog[$id], $u, (int) $u['created_at'])
                && ($again || !isset($mailed[$id][$uid]))
                && (!$unseenOnly || !isset($seen[$id][$uid]))));
            if ($items) {
                $out[] = ['user' => $u, 'items' => $items];
            }
        }
        return $out;
    }

    /** The items of one e-mail, in the recipient's language, each with its wiki link. */
    private function mailItems(array $ids, string $lang): array
    {
        $catalog = $this->catalog();
        $emails = new Emails($this->app);
        return array_map(fn ($id) => [
            'title' => (string) ($catalog[$id][$lang]['title'] ?? $catalog[$id]['es']['title'] ?? $id),
            'summary' => (string) ($catalog[$id][$lang]['summary'] ?? ''),
            'points' => array_values(array_map('strval', (array) ($catalog[$id][$lang]['points'] ?? []))),
            'link' => $emails->adminUrl(($catalog[$id]['article'] ?? '') !== '' ? 'wiki/' . $catalog[$id]['article'] : 'wiki'),
        ], $ids);
    }

    /** A test to the owner's own address, with every chosen item, in the owner's language. */
    public function test(array $ids, string $message, array $owner, ?string $ip): bool
    {
        $uid = (int) ($owner['uid'] ?? $owner['id'] ?? 0);
        if (!$this->app->rateLimiter()->hit('announce_test', (string) $uid, 10, 3600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $lang = ($owner['lang'] ?? 'es') === 'en' ? 'en' : 'es';
        $user = ['name' => (string) $owner['name'], 'email' => (string) $owner['email'], 'lang' => $lang];
        $ok = $this->app->mailer()->send((new Emails($this->app))->announcement($user, $this->mailItems($ids, $lang), $message, (string) $owner['name'], true));
        $this->app->activity($uid, 'team_announcement_test', '', ['news' => $ids, 'sent' => $ok], $ip);
        return $ok;
    }

    /**
     * Sends it: one e-mail per person. What reached each one is recorded, so a
     * second send skips it (unless `$again`).
     *
     * @return array{sent:int,failed:int,failedNames:list<string>}
     */
    public function send(array $ids, string $message, bool $again, bool $unseenOnly, array $owner, ?string $ip): array
    {
        $uid = (int) ($owner['uid'] ?? $owner['id'] ?? 0);
        $list = $this->recipients($ids, $again, $unseenOnly);
        if (!$list) {
            throw ApiError::validation(['ids' => 'nobody']);
        }
        if (!$this->app->rateLimiter()->hit('announce_send', (string) $uid, 6, 3600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $db = $this->app->db();
        $now = time();
        $db->run('INSERT INTO announcements (created_at, sent_by, news_ids, message) VALUES (?, ?, ?, ?)', [$now, $uid ?: null, json_encode($ids), $message]);
        $announcementId = (int) $db->value('SELECT last_insert_rowid()');
        $emails = new Emails($this->app);
        $sent = 0;
        $failedNames = [];
        foreach ($list as $r) {
            $lang = ($r['user']['lang'] ?? 'es') === 'en' ? 'en' : 'es';
            if ($this->app->mailer()->send($emails->announcement($r['user'], $this->mailItems($r['items'], $lang), $message, (string) $owner['name']))) {
                $sent++;
                foreach ($r['items'] as $id) {
                    $db->run('INSERT OR REPLACE INTO news_emailed (user_id, news_id, announcement_id, sent_at) VALUES (?, ?, ?, ?)', [(int) $r['user']['id'], $id, $announcementId, time()]);
                }
            } else {
                $failedNames[] = (string) $r['user']['name'];
            }
        }
        $db->run('UPDATE announcements SET recipients = ?, failed = ? WHERE id = ?', [$sent, count($failedNames), $announcementId]);
        $this->app->activity($uid, 'team_announced', (string) $announcementId, ['news' => $ids, 'sent' => $sent, 'failed' => count($failedNames)], $ip);
        return ['sent' => $sent, 'failed' => count($failedNames), 'failedNames' => $failedNames];
    }
}
