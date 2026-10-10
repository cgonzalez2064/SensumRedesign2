<?php
declare(strict_types=1);

namespace Sensum\Cms;

/**
 * Daily check of the site's domain and e-mail setup — the things that break
 * silently: SPF, DKIM and DMARC (without them the site's e-mail lands in spam
 * or can be spoofed), MX (where the domain's mail is received) and the
 * domain's expiry date (RDAP, the registries' public replacement for WHOIS).
 *
 * Results are stored in settings ("domain_health"); the Watchdog e-mails the
 * owner when something is missing or the domain is about to expire.
 * DNS_STUB_FILE and RDAP_URL replace the real lookups in automated tests and
 * are ignored in production.
 */
final class DomainHealth
{
    private const KEY = 'domain_health';

    public function __construct(private App $app)
    {
    }

    /** The registrable domain from APP_URL ("www." removed); null for local addresses. */
    public function domain(): ?string
    {
        $host = strtolower((string) parse_url($this->app->config->appUrl(), PHP_URL_HOST));
        $host = (string) preg_replace('/^www\./', '', $host);
        if ($host === '' || filter_var($host, FILTER_VALIDATE_IP) || !str_contains($host, '.') || preg_match('/\.(test|localhost|local|invalid|example)$/', $host)) {
            return $this->app->config->isProduction() ? null : ($this->app->config->string('DNS_STUB_FILE') !== '' ? 'sensumconstrucciones.com' : null);
        }
        return $host;
    }

    public function latest(): array
    {
        return $this->app->settings()->getJson(self::KEY);
    }

    /** Runs the check when the last one is older than a day. Returns a line for the scheduled-check output. */
    public function refreshIfStale(?int $now = null): string
    {
        $now ??= time();
        $last = $this->latest();
        if (isset($last['checkedAt']) && $now - (int) $last['checkedAt'] < 86400 - 600) {
            return 'checked ' . date('Y-m-d H:i', (int) $last['checkedAt']);
        }
        $r = $this->check($now);
        return $r ? ($r['problems'] ? 'problems: ' . implode(', ', $r['problems']) : 'ok') : 'skipped (no public domain in APP_URL)';
    }

    /** @return array<string,mixed>|null */
    public function check(?int $now = null): ?array
    {
        $domain = $this->domain();
        if ($domain === null) {
            return null;
        }
        $now ??= time();
        $txt = fn (string $name) => $this->records($name, 'TXT');

        $spfRecords = array_values(array_filter($txt($domain), fn ($r) => stripos($r, 'v=spf1') === 0));
        $spf = ['ok' => count($spfRecords) === 1 && !preg_match('/[+?]all\b/i', $spfRecords[0]), 'record' => $spfRecords[0] ?? null,
            'issue' => !$spfRecords ? 'missing' : (count($spfRecords) > 1 ? 'multiple' : (preg_match('/[+?]all\b/i', $spfRecords[0]) ? 'permissive' : null))];

        $selector = $this->app->config->string('DKIM_SELECTOR', 'default');
        $dkimRecords = array_values(array_filter($txt($selector . '._domainkey.' . $domain), fn ($r) => stripos($r, 'p=') !== false));
        $dkim = ['ok' => (bool) $dkimRecords, 'selector' => $selector, 'issue' => $dkimRecords ? null : 'missing'];

        $dmarcRecords = array_values(array_filter($txt('_dmarc.' . $domain), fn ($r) => stripos($r, 'v=DMARC1') === 0));
        $policy = $dmarcRecords && preg_match('/\bp=(none|quarantine|reject)\b/i', $dmarcRecords[0], $m) ? strtolower($m[1]) : null;
        $dmarc = ['ok' => $policy === 'quarantine' || $policy === 'reject', 'policy' => $policy, 'record' => $dmarcRecords[0] ?? null,
            'issue' => !$dmarcRecords ? 'missing' : ($policy === 'none' ? 'monitoring_only' : ($policy === null ? 'invalid' : null))];

        $mxRecords = $this->records($domain, 'MX');
        $mx = ['ok' => (bool) $mxRecords, 'records' => array_slice($mxRecords, 0, 5), 'issue' => $mxRecords ? null : 'missing'];

        $expiry = $this->expiry($domain);

        $problems = [];
        foreach (['spf' => $spf, 'dkim' => $dkim, 'dmarc' => $dmarc, 'mx' => $mx] as $k => $v) {
            if (!$v['ok']) {
                $problems[] = $k;
            }
        }
        if ($expiry['validTo'] !== null && $expiry['validTo'] - $now < 30 * 86400) {
            $problems[] = 'expiry';
        }
        $result = ['checkedAt' => $now, 'domain' => $domain, 'spf' => $spf, 'dkim' => $dkim, 'dmarc' => $dmarc, 'mx' => $mx, 'expiry' => $expiry, 'problems' => $problems];
        $this->app->settings()->setJson(self::KEY, $result);
        $this->app->maintenanceLog()->add('dns', 1, $now);
        return $result;
    }

    /** @return list<string> TXT strings or MX hosts */
    private function records(string $name, string $type): array
    {
        $stub = $this->app->config->string('DNS_STUB_FILE');
        if ($stub !== '' && !$this->app->config->isProduction()) {
            $all = is_file($stub) ? json_decode((string) file_get_contents($stub), true) : [];
            return array_values(array_map('strval', (array) ($all[strtolower($name)][$type] ?? [])));
        }
        $rows = @dns_get_record($name, $type === 'MX' ? DNS_MX : DNS_TXT);
        if (!is_array($rows)) {
            return [];
        }
        $out = [];
        foreach ($rows as $r) {
            if ($type === 'MX' && isset($r['target'])) {
                $out[] = (string) $r['target'];
            } elseif ($type === 'TXT') {
                $out[] = isset($r['entries']) && is_array($r['entries']) ? implode('', $r['entries']) : (string) ($r['txt'] ?? '');
            }
        }
        return $out;
    }

    /** @return array{validTo:int|null,registrar:string|null} */
    private function expiry(string $domain): array
    {
        $base = 'https://rdap.org/domain/';
        $override = $this->app->config->string('RDAP_URL');
        if ($override !== '' && !$this->app->config->isProduction()) {
            $base = rtrim($override, '/') . '/';
        }
        $body = $this->fetch($base . rawurlencode($domain));
        $data = $body !== null ? json_decode($body, true) : null;
        $validTo = null;
        $registrar = null;
        if (is_array($data)) {
            foreach ((array) ($data['events'] ?? []) as $e) {
                if (is_array($e) && ($e['eventAction'] ?? '') === 'expiration' && is_string($e['eventDate'] ?? null)) {
                    $validTo = strtotime($e['eventDate']) ?: null;
                }
            }
            foreach ((array) ($data['entities'] ?? []) as $ent) {
                if (is_array($ent) && in_array('registrar', (array) ($ent['roles'] ?? []), true)) {
                    $registrar = is_string($ent['vcardArray'][1][1][3] ?? null) ? mb_substr($ent['vcardArray'][1][1][3], 0, 80) : null;
                }
            }
        }
        return ['validTo' => $validTo, 'registrar' => $registrar];
    }

    private function fetch(string $url): ?string
    {
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3,
                CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | CURLPROTO_HTTP, CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
                CURLOPT_CONNECTTIMEOUT => 6, CURLOPT_TIMEOUT => 12, CURLOPT_HTTPHEADER => ['Accept: application/rdap+json, application/json'],
                CURLOPT_USERAGENT => 'SensumContentManager/1.0']);
            $body = curl_exec($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            return is_string($body) && $status === 200 ? mb_substr($body, 0, 500000) : null;
        }
        $ctx = stream_context_create(['http' => ['timeout' => 12, 'follow_location' => 1, 'max_redirects' => 3, 'header' => 'Accept: application/rdap+json']]);
        $body = @file_get_contents($url, false, $ctx);
        return is_string($body) ? $body : null;
    }
}
