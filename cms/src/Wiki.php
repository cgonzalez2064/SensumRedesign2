<?php
declare(strict_types=1);

namespace Sensum\Cms;

use Sensum\Cms\Http\ApiError;

/**
 * Wiki of the panel (#/wiki): processes, guides and answers, with real
 * screenshots in every language, theme and device. Only for signed-in
 * accounts: the articles and images live in cms/wiki (outside the public web
 * folder) and are served through the API.
 *
 *   wiki/wiki.json                       categories and «Novedades» (new features)
 *   wiki/articles/<slug>.<es|en>.md      one article per language, front matter + Markdown
 *   wiki/img/<name>.<lang>.<theme>.<device>.webp   screenshots (tests/wiki/shots.mjs)
 *
 * An article is for everyone unless its front matter names permissions
 * (`perms: leads, stats` — any of them) or `owner: true` (only the owner sees
 * it). Articles about a section the account can't open are still readable,
 * marked as not included in its role. A «Novedad» reaches, once, the accounts
 * that can use it and existed when it shipped (`canAsk`: only those with a
 * section they could still ask for, like the «Más secciones» menu item).
 */
final class Wiki
{
    public const LANGS = ['es', 'en'];
    public const THEMES = ['light', 'dark'];
    public const DEVICES = ['desktop', 'mobile'];

    private ?array $meta = null;

    public function __construct(private App $app)
    {
    }

    private function dir(string $sub = ''): string
    {
        return $this->app->root('wiki' . ($sub !== '' ? '/' . $sub : ''));
    }

    /** @return array{categories:list<array>, news:list<array>} */
    public function meta(): array
    {
        if ($this->meta === null) {
            $raw = @file_get_contents($this->dir('wiki.json'));
            $data = is_string($raw) ? json_decode($raw, true) : null;
            $this->meta = is_array($data) ? $data + ['categories' => [], 'news' => []] : ['categories' => [], 'news' => []];
        }
        return $this->meta;
    }

    /**
     * Front matter (`key: value` lines between `---`) and the Markdown body.
     * @return array{0:array<string,string>,1:string}
     */
    public static function parse(string $raw): array
    {
        $raw = str_replace("\r\n", "\n", $raw);
        if (!preg_match('/^---\n(.*?)\n---\n(.*)$/s', $raw, $m)) {
            return [[], $raw];
        }
        $front = [];
        foreach (explode("\n", $m[1]) as $line) {
            if (preg_match('/^([a-z]+):\s*(.*)$/', $line, $kv)) {
                $front[$kv[1]] = trim($kv[2]);
            }
        }
        return [$front, ltrim($m[2], "\n")];
    }

    /** @return list<string> */
    private static function list(string $v): array
    {
        return array_values(array_filter(array_map('trim', explode(',', $v)), fn ($x) => $x !== ''));
    }

    /** Whether this account can use what the article (or news item) is about. */
    private function allows(array $session, array $perms): bool
    {
        if (!$perms || $this->app->auth()->isOwner($session)) {
            return true;
        }
        foreach ($perms as $p) {
            if ($this->app->auth()->can($session, $p)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Whether «Más secciones» has something for this account: a section outside
     * its role that it may ask for (never the owner, who has everything).
     */
    private function canAsk(array $session): bool
    {
        if ($this->app->auth()->isOwner($session)) {
            return false;
        }
        foreach (array_diff(Users::PERMISSIONS, Users::NOT_REQUESTABLE) as $p) {
            if (!$this->app->auth()->can($session, $p)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Every article this account may read, in its language, with whether its
     * role includes what the article is about.
     * @return list<array<string,mixed>>
     */
    public function articles(array $session, string $lang): array
    {
        $lang = in_array($lang, self::LANGS, true) ? $lang : 'es';
        $owner = $this->app->auth()->isOwner($session);
        $out = [];
        foreach (glob($this->dir('articles') . '/*.' . $lang . '.md') ?: [] as $file) {
            $slug = basename($file, '.' . $lang . '.md');
            if (!preg_match('/^[a-z0-9-]+$/', $slug)) {
                continue;
            }
            [$f, $body] = self::parse((string) file_get_contents($file));
            if (($f['owner'] ?? '') === 'true' && !$owner) {
                continue;
            }
            $perms = self::list($f['perms'] ?? '');
            $out[] = [
                'slug' => $slug,
                'title' => $f['title'] ?? $slug,
                'summary' => $f['summary'] ?? '',
                'category' => $f['category'] ?? 'empezar',
                'order' => (int) ($f['order'] ?? 100),
                'icon' => $f['icon'] ?? 'question-circle',
                'perms' => $perms,
                'ownerOnly' => ($f['owner'] ?? '') === 'true',
                'allowed' => $this->allows($session, $perms),
                'updated' => $f['updated'] ?? '',
                'body' => $body,
            ];
        }
        usort($out, fn ($a, $b) => [$a['category'], $a['order'], $a['title']] <=> [$b['category'], $b['order'], $b['title']]);
        return $out;
    }

    /**
     * «Novedades» for this account: those about something it can use, shipped
     * after the account was created (new people get the welcome instead), each
     * with whether it was seen.
     * @return list<array<string,mixed>>
     */
    public function news(array $session, string $lang): array
    {
        // WIKI_NEWS=off: no «Novedades» (the browser tests, whose accounts are always new).
        if ($this->app->config->string('WIKI_NEWS', 'on') === 'off') {
            return [];
        }
        $lang = in_array($lang, self::LANGS, true) ? $lang : 'es';
        $uid = (int) ($session['uid'] ?? 0);
        $created = (int) $this->app->db()->value('SELECT created_at FROM users WHERE id = ?', [$uid]);
        $seen = array_flip(array_column($this->app->db()->all('SELECT news_id FROM wiki_news_seen WHERE user_id = ?', [$uid]), 'news_id'));
        $out = [];
        foreach ($this->meta()['news'] as $n) {
            $date = strtotime((string) ($n['date'] ?? '') . ' 23:59:59');
            if (!is_array($n[$lang] ?? null) || $date === false || $date < $created) {
                continue;
            }
            if (!empty($n['canAsk']) && !$this->canAsk($session)) {
                continue;
            }
            if (!$this->allows($session, (array) ($n['perms'] ?? []))) {
                continue;
            }
            $out[] = [
                'id' => (string) $n['id'],
                'date' => (string) $n['date'],
                'article' => (string) ($n['article'] ?? ''),
                'shot' => (string) ($n['shot'] ?? ''),
                'title' => (string) ($n[$lang]['title'] ?? ''),
                'summary' => (string) ($n[$lang]['summary'] ?? ''),
                'points' => array_values(array_map('strval', (array) ($n[$lang]['points'] ?? []))),
                'seen' => isset($seen[(string) $n['id']]),
            ];
        }
        usort($out, fn ($a, $b) => strcmp($b['date'], $a['date']));
        return $out;
    }

    /** @param list<mixed> $ids */
    public function markSeen(int $userId, array $ids): int
    {
        $known = array_column($this->meta()['news'], 'id');
        $n = 0;
        foreach ($ids as $id) {
            if (!is_string($id) || !in_array($id, $known, true)) {
                throw ApiError::validation(['ids' => 'invalid']);
            }
            $n += $this->app->db()->run('INSERT OR IGNORE INTO wiki_news_seen (user_id, news_id, seen_at) VALUES (?, ?, ?)', [$userId, $id, time()])->rowCount();
        }
        return $n;
    }

    /**
     * A screenshot, falling back to the other theme, then to Spanish, then to
     * the other device, so a missing variant never shows a broken image.
     */
    public function imagePath(string $name, string $lang, string $theme, string $device): ?string
    {
        if (!preg_match('/^[a-z0-9-]{1,60}$/', $name) || !in_array($lang, self::LANGS, true) || !in_array($theme, self::THEMES, true) || !in_array($device, self::DEVICES, true)) {
            return null;
        }
        $other = fn (array $all, string $v) => $all[0] === $v ? $all[1] : $all[0];
        foreach ([$device, $other(self::DEVICES, $device)] as $d) {
            foreach ([$lang, 'es'] as $l) {
                foreach ([$theme, $other(self::THEMES, $theme)] as $t) {
                    $file = $this->dir("img/$name.$l.$t.$d.webp");
                    if (is_file($file)) {
                        return $file;
                    }
                }
            }
        }
        return null;
    }
}
