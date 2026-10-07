<?php
declare(strict_types=1);

namespace Sensum\Cms;

/**
 * Append-only JSON-lines log in the private storage folder
 * (storage/logs/app-YYYY-MM.log). Callers pass event names and small,
 * non-sensitive context only — never passwords, tokens, cookies or SMTP data.
 * As a last line of defense, keys that look secret are redacted.
 */
final class Logger
{
    private const REDACT = '/pass|token|secret|cookie|session|authorization|smtp_password|csrf/i';

    public function __construct(private string $dir)
    {
    }

    public function info(string $event, array $context = []): void
    {
        $this->write('info', $event, $context);
    }

    public function warning(string $event, array $context = []): void
    {
        $this->write('warning', $event, $context);
    }

    public function error(string $event, array $context = []): void
    {
        $this->write('error', $event, $context);
    }

    private function write(string $level, string $event, array $context): void
    {
        $line = json_encode([
            'ts' => date('c'),
            'level' => $level,
            'event' => $event,
            'ctx' => self::redact($context),
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
        $file = $this->dir . '/app-' . date('Y-m') . '.log';
        $isNew = !is_file($file);
        @file_put_contents($file, $line . "\n", FILE_APPEND | LOCK_EX);
        if ($isNew) {
            @chmod($file, 0600);
        }
    }

    private static function redact(array $context): array
    {
        foreach ($context as $k => $v) {
            if (is_string($k) && preg_match(self::REDACT, $k)) {
                $context[$k] = '[redacted]';
            } elseif (is_array($v)) {
                $context[$k] = self::redact($v);
            } elseif (is_string($v) && mb_strlen($v) > 500) {
                $context[$k] = mb_substr($v, 0, 500) . '…';
            }
        }
        return $context;
    }
}
