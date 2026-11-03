<?php
declare(strict_types=1);

namespace Sensum\Cms;

/**
 * Google PageSpeed Insights scores (performance, SEO, accessibility, best
 * practices) for the public site, used in the monthly report as a simple
 * "how Google sees the site" figure. Optional and fail-soft: fetched by the
 * scheduled check at most once a day, only when APP_URL is a public https
 * address. PAGESPEED_API_KEY (free Google Cloud key) makes it reliable;
 * without one, Google may refuse anonymous requests.
 */
final class PageSpeed
{
    private const URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
    private const CATEGORIES = ['performance' => 'performance', 'seo' => 'seo', 'accessibility' => 'accessibility', 'best-practices' => 'bestPractices'];
    /** Waits after the 1st, 2nd, 3rd and later consecutive failures (seconds). */
    private const BACKOFF = [3600, 3 * 3600, 6 * 3600, 86400];
    private const STATE = 'pagespeed_state';

    public function __construct(private App $app)
    {
    }

    public function enabled(): bool
    {
        if (!$this->app->config->bool('PAGESPEED_ENABLED', true)) {
            return false;
        }
        if ($this->app->config->string('PAGESPEED_API_URL') !== '' && !$this->app->config->isProduction()) {
            return true; // automated tests use a local stand-in
        }
        $host = (string) parse_url($this->app->config->appUrl(), PHP_URL_HOST);
        return str_starts_with($this->app->config->appUrl(), 'https://') && !in_array($host, ['localhost', '127.0.0.1', '::1'], true);
    }

    /** Last stored scores: ['fetchedAt'=>int, 'mobile'=>[...], 'desktop'=>[...]] or [] */
    public function latest(): array
    {
        return $this->app->settings()->getJson('pagespeed');
    }

    /**
     * Fetches again when the stored scores are older than $maxAge seconds.
     * After a failure it waits before trying again (1 h, 3 h, 6 h, then a day;
     * a day straight away when Google answers 429, the shared quota for calls
     * without a key), so the 15-minute check does not hit Google every run.
     * Returns a short status line.
     */
    public function refreshIfStale(int $maxAge = 86400, ?int $now = null): string
    {
        $now ??= time();
        if (!$this->enabled()) {
            return 'skipped (needs a public https APP_URL)';
        }
        $last = $this->latest();
        if ($last && $now - (int) ($last['fetchedAt'] ?? 0) < $maxAge) {
            return 'up to date';
        }
        $state = $this->app->settings()->getJson(self::STATE);
        $retryAt = (int) ($state['retryAt'] ?? 0);
        if ($retryAt > $now) {
            return 'waiting after ' . (int) ($state['failures'] ?? 0) . ' failed attempt(s); next try ' . date('Y-m-d H:i', $retryAt)
                . ($this->hasKey() ? '' : ' (no PAGESPEED_API_KEY)');
        }
        $result = ['fetchedAt' => $now];
        foreach (['mobile', 'desktop'] as $strategy) {
            [$scores, $status] = $this->fetch($strategy);
            if ($scores === null) {
                $this->recordFailure($state, $status, $strategy, $now);
                return 'failed (' . $strategy . ', HTTP ' . $status . ')' . ($this->hasKey() ? '' : ' — add PAGESPEED_API_KEY');
            }
            $result[$strategy] = $scores;
        }
        $this->app->settings()->setJson('pagespeed', $result);
        $this->app->settings()->setJson(self::STATE, []);
        $this->app->maintenanceLog()->add('pagespeed');
        return "mobile {$result['mobile']['performance']} · desktop {$result['desktop']['performance']} (performance)";
    }

    /** Whether a Google API key is configured (requests without one share a quota that is usually used up). */
    public function hasKey(): bool
    {
        return trim($this->app->config->string('PAGESPEED_API_KEY')) !== '';
    }

    /** Next wait in seconds after $failures consecutive failures; 429 always waits a day. */
    public static function backoff(int $failures, int $status): int
    {
        if ($status === 429) {
            return 86400;
        }
        return self::BACKOFF[max(0, min($failures, count(self::BACKOFF)) - 1)];
    }

    /** Stores the failure and the next try; logs at most one warning per day. */
    private function recordFailure(array $state, int $status, string $strategy, int $now): void
    {
        $failures = (int) ($state['failures'] ?? 0) + 1;
        $day = date('Y-m-d', $now);
        if (($state['loggedDay'] ?? '') !== $day) {
            // The key never goes into the log (it is only in the query string sent to Google).
            $this->app->logger()->warning('pagespeed_failed', [
                'message' => 'PageSpeed Insights: HTTP ' . $status . ($this->hasKey() ? '' : ' (no API key)'),
                'strategy' => $strategy,
                'failures' => $failures,
            ]);
            $state['loggedDay'] = $day;
        }
        $state['failures'] = $failures;
        $state['lastStatus'] = $status;
        $state['lastAttemptAt'] = $now;
        $state['retryAt'] = $now + self::backoff($failures, $status);
        $this->app->settings()->setJson(self::STATE, $state);
    }

    /** @return array{0: array{performance:int,seo:int,accessibility:int,bestPractices:int}|null, 1: int} scores (null on failure) and HTTP status */
    private function fetch(string $strategy): array
    {
        $base = $this->app->config->string('PAGESPEED_API_URL');
        $base = ($base !== '' && !$this->app->config->isProduction()) ? $base : self::URL;
        $query = 'url=' . rawurlencode($this->app->config->appUrl() . '/') . '&strategy=' . $strategy;
        foreach (array_keys(self::CATEGORIES) as $c) {
            $query .= '&category=' . strtoupper(str_replace('-', '_', $c));
        }
        $key = $this->app->config->string('PAGESPEED_API_KEY');
        if ($key !== '') {
            $query .= '&key=' . rawurlencode($key);
        }
        $ctx = stream_context_create([
            'http' => ['method' => 'GET', 'timeout' => 90, 'ignore_errors' => true, 'follow_location' => 0, 'header' => "Accept: application/json\r\nUser-Agent: SensumContentManager/1.0"],
            'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
        ]);
        if (function_exists('curl_init')) {
            $ch = curl_init($base . '?' . $query);
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 90, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_HTTPHEADER => ['Accept: application/json', 'User-Agent: SensumContentManager/1.0']]);
            $body = curl_exec($ch);
            $status = $body === false ? 0 : (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        } else {
            $body = @file_get_contents($base . '?' . $query, false, $ctx);
            $status = $body === false ? 0 : 200;
        }
        $data = is_string($body) ? json_decode($body, true) : null;
        $cats = is_array($data) ? ($data['lighthouseResult']['categories'] ?? null) : null;
        if ($status !== 200 || !is_array($cats)) {
            return [null, $status];
        }
        $out = [];
        foreach (self::CATEGORIES as $id => $name) {
            $out[$name] = (int) round(100 * (float) ($cats[$id]['score'] ?? 0));
        }
        /** @var array{performance:int,seo:int,accessibility:int,bestPractices:int} $out */
        return [$out, $status];
    }
}
