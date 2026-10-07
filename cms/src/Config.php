<?php
declare(strict_types=1);

namespace Sensum\Cms;

/**
 * Configuration from environment variables and a `.env` file.
 *
 * Precedence: real environment variable > `.env` value > default.
 * The `.env` file lives in the private CMS folder (never in public_html)
 * and is never committed; `.env.example` documents every key.
 */
final class Config
{
    /** @var array<string,string> */
    private array $file = [];

    public function __construct(private string $cmsRoot)
    {
        $path = $cmsRoot . '/.env';
        if (is_file($path) && is_readable($path)) {
            $this->file = self::parseEnvFile((string) file_get_contents($path));
        }
    }

    /** Minimal, non-interpolating KEY=VALUE parser. */
    public static function parseEnvFile(string $contents): array
    {
        $out = [];
        foreach (preg_split('/\R/', $contents) ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#') {
                continue;
            }
            if (str_starts_with($line, 'export ')) {
                $line = substr($line, 7);
            }
            $eq = strpos($line, '=');
            if ($eq === false) {
                continue;
            }
            $key = trim(substr($line, 0, $eq));
            if (!preg_match('/^[A-Z][A-Z0-9_]*$/', $key)) {
                continue;
            }
            $value = trim(substr($line, $eq + 1));
            $quote = $value[0] ?? '';
            if (($quote === '"' || $quote === "'") && strlen($value) >= 2 && substr($value, -1) === $quote) {
                $value = substr($value, 1, -1);
                if ($quote === '"') {
                    $value = str_replace(['\\n', '\\"', '\\\\'], ["\n", '"', '\\'], $value);
                }
            } else {
                // Strip an inline comment (" # ...") from unquoted values.
                $hash = strpos($value, ' #');
                if ($hash !== false) {
                    $value = rtrim(substr($value, 0, $hash));
                }
            }
            $out[$key] = $value;
        }
        return $out;
    }

    public function get(string $key, ?string $default = null): ?string
    {
        $env = getenv($key);
        if ($env !== false && $env !== '') {
            return $env;
        }
        if (isset($this->file[$key]) && $this->file[$key] !== '') {
            return $this->file[$key];
        }
        return $default;
    }

    public function string(string $key, string $default = ''): string
    {
        return (string) $this->get($key, $default);
    }

    public function int(string $key, int $default, int $min = PHP_INT_MIN, int $max = PHP_INT_MAX): int
    {
        $v = $this->get($key);
        if ($v === null || !preg_match('/^-?\d+$/', $v)) {
            return $default;
        }
        return max($min, min($max, (int) $v));
    }

    public function bool(string $key, bool $default = false): bool
    {
        $v = $this->get($key);
        if ($v === null) {
            return $default;
        }
        return in_array(strtolower($v), ['1', 'true', 'yes', 'on'], true);
    }

    public function isProduction(): bool
    {
        return $this->string('APP_ENV', 'production') !== 'development';
    }

    /** Public base URL without trailing slash, e.g. https://sensumconstrucciones.com */
    public function appUrl(): string
    {
        return rtrim($this->string('APP_URL', 'https://sensumconstrucciones.com'), '/');
    }

    /** Origins allowed to make state-changing API requests. */
    public function allowedOrigins(): array
    {
        $origins = [self::originOf($this->appUrl())];
        foreach (explode(',', $this->string('EXTRA_ALLOWED_ORIGINS')) as $o) {
            $o = trim($o);
            if ($o !== '') {
                $origins[] = self::originOf($o);
            }
        }
        if (str_starts_with($origins[0], 'https://') && !str_starts_with(parse_url($origins[0], PHP_URL_HOST) ?: '', 'www.')) {
            $origins[] = 'https://www.' . substr($origins[0], 8);
        }
        return array_values(array_unique(array_filter($origins)));
    }

    public static function originOf(string $url): string
    {
        $p = parse_url($url);
        if (!$p || empty($p['scheme']) || empty($p['host'])) {
            return '';
        }
        return strtolower($p['scheme'] . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : ''));
    }

    public function supportEmail(): string
    {
        return $this->string('SUPPORT_EMAIL', 'it@gruposensum.com');
    }

    /** The owner account: the only one that sees Monitoring and the error log. */
    public function ownerEmail(): string
    {
        return strtolower(trim($this->string('OWNER_EMAIL', 'it@gruposensum.com')));
    }

}
