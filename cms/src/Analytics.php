<?php
declare(strict_types=1);

namespace Sensum\Cms;

/**
 * Cookie-free visit statistics for the public site, kept on this server.
 *
 * The pages send one small beacon per page view (and one per click on
 * WhatsApp, phone, e-mail, map, social links or the PDF portfolio) to
 * /api/collect. Only daily totals are stored: views per page, visitors,
 * where visitors came from (a fixed list of sources), device type,
 * language and clicks. Nothing identifies a person:
 *   - no cookies or local storage, no IP address stored;
 *   - a visitor is counted once per day through a hash of a random salt of
 *     the day + IP + browser; the salt and the hashes are deleted when the
 *     day ends, so nobody can be followed from one day to the next;
 *   - browsers asking not to be tracked (Do Not Track / Global Privacy
 *     Control) send nothing and are ignored here as well;
 *   - known bots, crawlers, previews and headless browsers are ignored.
 */
final class Analytics
{
    public const PAGES = ['home', 'privacy', 'notfound'];
    public const SOURCES = ['direct', 'google', 'bing', 'facebook', 'instagram', 'whatsapp', 'linkedin', 'youtube', 'tiktok', 'twitter', 'email', 'other'];
    public const CLICKS = ['whatsapp', 'phone', 'email', 'map', 'social', 'portfolio'];
    public const DEVICES = ['mobile', 'tablet', 'desktop'];
    private const KEEP_DAYS = 800;      // about 26 months: this month vs. the same month last year
    private const IP_LIMIT = 120;       // events per address per hour
    private const DAILY_LIMIT = 50000;  // events per day in total (protects the database)
    private const BOT = '/bot|crawl|spider|slurp|scrape|fetch|preview|headless|phantom|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl|wget|python|java\/|go-http|okhttp|axios|node-fetch|httpclient|facebookexternalhit|whatsapp\/|telegram|discord|skype|embedly|validator/i';
    private const SOURCE_HOSTS = [
        'google' => '/(^|\.)google\.[a-z.]+$/', 'bing' => '/(^|\.)bing\.com$/', 'facebook' => '/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/',
        'instagram' => '/(^|\.)instagram\.com$/', 'whatsapp' => '/(^|\.)(whatsapp\.com|wa\.me)$/', 'linkedin' => '/(^|\.)(linkedin\.com|lnkd\.in)$/',
        'youtube' => '/(^|\.)(youtube\.com|youtu\.be)$/', 'tiktok' => '/(^|\.)tiktok\.com$/', 'twitter' => '/(^|\.)(twitter\.com|x\.com|t\.co)$/',
        'email' => '/(^|\.)(mail\.google\.com|outlook\.(live|office)\.com|mail\.yahoo\.com)$/',
    ];

    public function __construct(private App $app)
    {
    }

    public function enabled(): bool
    {
        return $this->app->settings()->get('analytics_enabled', '1') === '1';
    }

    public function setEnabled(bool $on): void
    {
        $this->app->settings()->set('analytics_enabled', $on ? '1' : '0');
    }

    // ------------------------------------------------------------------ collecting

    /**
     * Records one event from the public site. Returns false when it was
     * ignored (bot, opted out, malformed, over a limit) — the caller answers
     * the same way in every case.
     */
    public function collect(array $in, string $ip, string $ua, bool $optOut, ?int $now = null): bool
    {
        $now ??= time();
        if (!$this->enabled() || $optOut || $ua === '' || strlen($ua) > 512 || preg_match(self::BOT, $ua)) {
            return false;
        }
        $type = is_string($in['type'] ?? null) ? $in['type'] : '';
        $page = is_string($in['page'] ?? null) && in_array($in['page'], self::PAGES, true) ? $in['page'] : null;
        if ($page === null || !in_array($type, ['view', 'click'], true)) {
            return false;
        }
        $rl = $this->app->rateLimiter();
        if (!$rl->hit('analytics_ip', $ip, self::IP_LIMIT, 3600) || !$rl->hit('analytics_all', 'global', self::DAILY_LIMIT, 86400)) {
            return false;
        }
        $day = date('Y-m-d', $now);
        $db = $this->app->db();
        if ($type === 'click') {
            $what = is_string($in['what'] ?? null) && in_array($in['what'], self::CLICKS, true) ? $in['what'] : null;
            if ($what === null) {
                return false;
            }
            $this->add($day, 'click', $what);
            return true;
        }
        $db->transaction(function () use ($in, $ip, $ua, $day, $page, $db) {
            $this->add($day, 'view', $page);
            if ($db->run('INSERT OR IGNORE INTO analytics_seen (day, hash) VALUES (?, ?)', [$day, $this->visitorHash($day, $ip, $ua)])->rowCount() === 1) {
                $this->add($day, 'visitor', '');
                // Source, device and language once per visitor and day.
                $this->add($day, 'source', $this->source(is_string($in['ref'] ?? null) ? $in['ref'] : '', is_string($in['utm'] ?? null) ? $in['utm'] : ''));
                $w = is_int($in['w'] ?? null) ? $in['w'] : 0;
                $this->add($day, 'device', $w > 0 && $w < 768 ? 'mobile' : ($w > 0 && $w < 1100 ? 'tablet' : 'desktop'));
                $this->add($day, 'lang', ($in['lang'] ?? '') === 'en' ? 'en' : 'es');
            }
        });
        return true;
    }

    /** Fixed list of sources from the referring address (or utm_source); never the full address. */
    public function source(string $ref, string $utm = ''): string
    {
        $utm = strtolower(trim($utm));
        if ($utm !== '') {
            foreach (['facebook' => ['fb', 'facebook'], 'instagram' => ['ig', 'instagram'], 'google' => ['google', 'gads', 'adwords'], 'whatsapp' => ['whatsapp', 'wa'],
                'linkedin' => ['linkedin'], 'youtube' => ['youtube'], 'tiktok' => ['tiktok'], 'twitter' => ['twitter', 'x'], 'email' => ['email', 'newsletter', 'mail']] as $k => $names) {
                if (in_array($utm, $names, true)) {
                    return $k;
                }
            }
        }
        $host = strtolower((string) parse_url($ref, PHP_URL_HOST));
        if ($host === '') {
            return 'direct';
        }
        $own = strtolower((string) parse_url($this->app->config->appUrl(), PHP_URL_HOST));
        if ($host === $own || $host === 'www.' . $own || 'www.' . $host === $own) {
            return 'direct';
        }
        foreach (self::SOURCE_HOSTS as $k => $re) {
            if (preg_match($re, $host)) {
                return $k;
            }
        }
        return 'other';
    }

    private function add(string $day, string $metric, string $dim): void
    {
        $this->app->db()->run('INSERT INTO analytics_daily (day, metric, dim, count) VALUES (?, ?, ?, 1) ON CONFLICT (day, metric, dim) DO UPDATE SET count = count + 1', [$day, $metric, $dim]);
    }

    /** Hash with today's random salt; a new day gets a new salt and yesterday's markers are deleted. */
    private function visitorHash(string $day, string $ip, string $ua): string
    {
        $salt = $this->app->settings()->getJson('analytics_salt');
        if (($salt['day'] ?? '') !== $day || !is_string($salt['salt'] ?? null)) {
            $salt = ['day' => $day, 'salt' => bin2hex(random_bytes(32))];
            $this->app->settings()->setJson('analytics_salt', $salt);
            $this->app->db()->run('DELETE FROM analytics_seen WHERE day <> ?', [$day]);
        }
        return substr(hash('sha256', $salt['salt'] . '|' . $ip . '|' . $ua), 0, 32);
    }

    /** Scheduled check: removes visitor markers of past days and totals older than ~26 months. */
    public function purge(?int $now = null): void
    {
        $now ??= time();
        $this->app->db()->run('DELETE FROM analytics_seen WHERE day < ?', [date('Y-m-d', $now)]);
        $this->app->db()->run('DELETE FROM analytics_daily WHERE day < ?', [date('Y-m-d', $now - self::KEEP_DAYS * 86400)]);
    }

    // ------------------------------------------------------------------ reading

    /**
     * Totals between two dates (Unix times, end exclusive).
     * @return array{views:int,visitors:int,pages:array<string,int>,sources:array<string,int>,devices:array<string,int>,langs:array<string,int>,clicks:array<string,int>,contacts:int,days:list<array{day:string,views:int,visitors:int}>}
     */
    public function summary(int $start, int $end): array
    {
        $from = date('Y-m-d', $start);
        $to = date('Y-m-d', $end - 1);
        $out = ['views' => 0, 'visitors' => 0, 'pages' => [], 'sources' => [], 'devices' => [], 'langs' => [], 'clicks' => array_fill_keys(self::CLICKS, 0), 'contacts' => 0, 'days' => []];
        $days = [];
        try {
            foreach ($this->app->db()->all('SELECT day, metric, dim, count FROM analytics_daily WHERE day >= ? AND day <= ?', [$from, $to]) as $r) {
                $n = (int) $r['count'];
                $dim = (string) $r['dim'];
                switch ($r['metric']) {
                    case 'view':
                        $out['views'] += $n;
                        $out['pages'][$dim] = ($out['pages'][$dim] ?? 0) + $n;
                        $days[$r['day']]['views'] = ($days[$r['day']]['views'] ?? 0) + $n;
                        break;
                    case 'visitor':
                        $out['visitors'] += $n;
                        $days[$r['day']]['visitors'] = ($days[$r['day']]['visitors'] ?? 0) + $n;
                        break;
                    case 'source':
                        $out['sources'][$dim] = ($out['sources'][$dim] ?? 0) + $n;
                        break;
                    case 'device':
                        $out['devices'][$dim] = ($out['devices'][$dim] ?? 0) + $n;
                        break;
                    case 'lang':
                        $out['langs'][$dim] = ($out['langs'][$dim] ?? 0) + $n;
                        break;
                    case 'click':
                        $out['clicks'][$dim] = ($out['clicks'][$dim] ?? 0) + $n;
                        break;
                }
            }
        } catch (\Throwable) {
            // older database without statistics
        }
        arsort($out['sources']);
        arsort($out['pages']);
        // One entry per day of the range, zero when there were no visits.
        for ($t = strtotime($from . ' 12:00'); $t !== false && date('Y-m-d', $t) <= $to; $t += 86400) {
            $d = date('Y-m-d', $t);
            $out['days'][] = ['day' => $d, 'views' => (int) ($days[$d]['views'] ?? 0), 'visitors' => (int) ($days[$d]['visitors'] ?? 0)];
        }
        $out['contacts'] = $out['clicks']['whatsapp'] + $out['clicks']['phone'] + $out['clicks']['email'];
        return $out;
    }
}
