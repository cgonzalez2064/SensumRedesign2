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

    /** Fetches again when the stored scores are older than $maxAge seconds. Returns a short status line. */
    public function refreshIfStale(int $maxAge = 86400): string
    {
        if (!$this->enabled()) {
            return 'skipped (needs a public https APP_URL)';
        }
        $last = $this->latest();
        if ($last && time() - (int) ($last['fetchedAt'] ?? 0) < $maxAge) {
            return 'up to date';
        }
        $result = ['fetchedAt' => time()];
        foreach (['mobile', 'desktop'] as $strategy) {
            $scores = $this->fetch($strategy);
            if ($scores === null) {
                return 'failed (' . $strategy . ') — see the error log';
            }
            $result[$strategy] = $scores;
        }
        $this->app->settings()->setJson('pagespeed', $result);
        $this->app->maintenanceLog()->add('pagespeed');
        return "mobile {$result['mobile']['performance']} · desktop {$result['desktop']['performance']} (performance)";
    }

    /** @return array{performance:int,seo:int,accessibility:int,bestPractices:int}|null */
    private function fetch(string $strategy): ?array
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
            // The key never goes into the log (it is only in the query string sent to Google).
            $this->app->logger()->warning('pagespeed_failed', ['message' => 'PageSpeed Insights: HTTP ' . $status, 'strategy' => $strategy]);
            return null;
        }
        $out = [];
        foreach (self::CATEGORIES as $id => $name) {
            $out[$name] = (int) round(100 * (float) ($cats[$id]['score'] ?? 0));
        }
        /** @var array{performance:int,seo:int,accessibility:int,bestPractices:int} $out */
        return $out;
    }
}
