<?php
declare(strict_types=1);

namespace Sensum\Cms;

use Sensum\Cms\Content\Validator;

/**
 * Machine translation of website text between Spanish and English through
 * the DeepL API. Optional: without DEEPL_API_KEY the admin simply doesn't
 * offer automatic translation.
 *
 * Only the text being edited is sent (never names, e-mails or settings), to a
 * fixed DeepL host chosen by the key type (":fx" keys = DeepL API Free).
 * The key is sent in a header and never logged; failures are logged as a
 * category and reported to the admin as a short error code.
 *
 * Markup the site relies on survives the round trip: *highlighted* words are
 * sent as <em>…</em>, and the company name is excluded from translation.
 */
final class Translator
{
    private const FREE_URL = 'https://api-free.deepl.com';
    private const PRO_URL = 'https://api.deepl.com';
    private const SOURCE = ['es' => 'ES', 'en' => 'EN'];
    private const TARGET = ['es' => 'ES-419', 'en' => 'EN-US'];
    private const CONTEXT = 'Website of Sensum Construcciones, a construction and remodeling company in Guatemala City.';

    public function __construct(private Config $config, private Logger $logger)
    {
    }

    public function isEnabled(): bool
    {
        return $this->key() !== '';
    }

    /** "DeepL API Free" / "DeepL API Pro" — for diagnostics. */
    public function plan(): string
    {
        return str_ends_with($this->key(), ':fx') ? 'DeepL API Free' : 'DeepL API Pro';
    }

    private function key(): string
    {
        return trim($this->config->string('DEEPL_API_KEY'));
    }

    private function baseUrl(): string
    {
        // Test-only override, honored only in development (automated tests run a local stand-in).
        $override = $this->config->string('DEEPL_API_URL');
        if ($override !== '' && !$this->config->isProduction()) {
            return rtrim($override, '/');
        }
        return str_ends_with($this->key(), ':fx') ? self::FREE_URL : self::PRO_URL;
    }

    /**
     * @param list<array{text:string,emphasis:bool}> $items
     * @return list<string> translations in the same order
     * @throws TranslationError
     */
    public function translate(array $items, string $from, string $to): array
    {
        if (!$this->isEnabled()) {
            throw new TranslationError('translation_unavailable');
        }
        $out = [];
        $send = [];
        foreach ($items as $i => $item) {
            if ($item['text'] === '') {
                $out[$i] = '';
            } else {
                $send[$i] = self::encode($item['text'], $item['emphasis']);
            }
        }
        if ($send) {
            $body = [
                'text' => array_values($send),
                'source_lang' => self::SOURCE[$from],
                'target_lang' => self::TARGET[$to],
                'tag_handling' => 'xml',
                'ignore_tags' => ['keep'],
                'preserve_formatting' => true,
                'context' => self::CONTEXT,
            ];
            if ($to === 'es') {
                $body['formality'] = 'prefer_less'; // the site addresses visitors as "tú"
            }
            $translated = $this->call('/v2/translate', $body);
            $list = $translated['translations'] ?? null;
            if (!is_array($list) || count($list) !== count($send)) {
                $this->logger->error('translation_failed', ['reason' => 'unexpected_response']);
                throw new TranslationError('translation_failed');
            }
            foreach (array_keys($send) as $n => $i) {
                $text = $list[$n]['text'] ?? null;
                if (!is_string($text)) {
                    $this->logger->error('translation_failed', ['reason' => 'unexpected_response']);
                    throw new TranslationError('translation_failed');
                }
                $out[$i] = self::decode($text, $items[$i]['emphasis']);
            }
        }
        ksort($out);
        return array_values($out);
    }

    /**
     * Characters used/allowed in the current DeepL billing period.
     * @return array{used:int,limit:int}
     * @throws TranslationError
     */
    public function usage(): array
    {
        $r = $this->call('/v2/usage', null);
        return ['used' => (int) ($r['character_count'] ?? 0), 'limit' => (int) ($r['character_limit'] ?? 0)];
    }

    /** Plain text → DeepL XML: escape, *word* → <em>word</em>, protect the company name. */
    public static function encode(string $text, bool $emphasis): string
    {
        $x = htmlspecialchars($text, ENT_NOQUOTES | ENT_XML1, 'UTF-8');
        if ($emphasis) {
            $x = preg_replace('/\*([^*]+)\*/u', '<em>$1</em>', $x) ?? $x;
        }
        return preg_replace('/\bSensum(?:\s+Construcciones)?\b/u', '<keep>$0</keep>', $x) ?? $x;
    }

    /** DeepL XML → plain text the validator accepts (no tags, entities decoded). */
    public static function decode(string $x, bool $emphasis): string
    {
        $x = preg_replace('#</?keep>#', '', $x) ?? $x;
        if ($emphasis) {
            // Keep spaces outside the markers: "with<em> precision</em>" → "with *precision*".
            $x = preg_replace_callback('#<em>(\s*)(.*?)(\s*)</em>#su', fn ($m) => trim($m[2]) === '' ? $m[1] . $m[3] : $m[1] . '*' . $m[2] . '*' . $m[3], $x) ?? $x;
        }
        $x = strip_tags($x);
        $x = html_entity_decode($x, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $x = str_replace(['<', '>'], '', $x);
        return Validator::normalizeText($x);
    }

    /** @throws TranslationError */
    private function call(string $path, ?array $body): array
    {
        $url = $this->baseUrl() . $path;
        $headers = [
            'Authorization: DeepL-Auth-Key ' . $this->key(),
            'Accept: application/json',
            'User-Agent: SensumContentManager/1.0',
        ];
        $payload = null;
        if ($body !== null) {
            $headers[] = 'Content-Type: application/json';
            $payload = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }
        [$status, $response] = function_exists('curl_init')
            ? $this->viaCurl($url, $headers, $payload)
            : $this->viaStream($url, $headers, $payload);

        if ($status === 200) {
            $data = json_decode((string) $response, true);
            if (is_array($data)) {
                return $data;
            }
            $this->logger->error('translation_failed', ['reason' => 'invalid_json']);
            throw new TranslationError('translation_failed');
        }
        // Map DeepL's status codes to what the editor can act on. No response body is logged.
        [$code, $reason] = match (true) {
            $status === 456 => ['translation_quota', 'quota_exceeded'],
            $status === 429 => ['translation_busy', 'rate_limited'],
            $status === 401, $status === 403 => ['translation_failed', 'auth_failed'],
            $status === 0 => ['translation_failed', 'network'],
            default => ['translation_failed', 'http_' . $status],
        };
        $this->logger->error('translation_failed', ['reason' => $reason]);
        throw new TranslationError($code);
    }

    /** @return array{0:int,1:string|false} */
    private function viaCurl(string $url, array $headers, ?string $payload): array
    {
        $ch = curl_init($url);
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ];
        if ($payload !== null) {
            $opts[CURLOPT_POST] = true;
            $opts[CURLOPT_POSTFIELDS] = $payload;
        }
        curl_setopt_array($ch, $opts);
        $response = curl_exec($ch);
        $status = $response === false ? 0 : (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        return [$status, is_string($response) ? $response : false];
    }

    /** Fallback when the curl extension is missing (needs allow_url_fopen). @return array{0:int,1:string|false} */
    private function viaStream(string $url, array $headers, ?string $payload): array
    {
        $ctx = stream_context_create([
            'http' => [
                'method' => $payload === null ? 'GET' : 'POST',
                'header' => implode("\r\n", $headers),
                'content' => $payload ?? '',
                'timeout' => 15,
                'ignore_errors' => true,
                'follow_location' => 0,
            ],
            'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
        ]);
        $response = @file_get_contents($url, false, $ctx);
        $status = 0;
        $lines = function_exists('http_get_last_response_headers') ? (http_get_last_response_headers() ?? []) : $http_response_header;
        foreach ($lines as $line) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
                $status = (int) $m[1];
            }
        }
        return [$response === false ? 0 : $status, $response];
    }
}
