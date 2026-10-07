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
    private const REDACT = '/pass|token|secret|cookie|session|authorization|smtp_password|csrf|api_?key/i';

    /** @var (callable(string,string,array):void)|null receives every critical/error/warning entry */
    private $sink = null;
    private bool $inSink = false;

    public function __construct(private string $dir)
    {
    }

    /** @param callable(string,string,array):void $sink */
    public function setSink(callable $sink): void
    {
        $this->sink = $sink;
    }

    public function critical(string $event, array $context = []): void
    {
        $this->write('critical', $event, $context);
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
        // Errors also go to the error log (owner's Monitoring page); never recursively.
        if ($this->sink !== null && $level !== 'info' && !$this->inSink) {
            $this->inSink = true;
            try {
                ($this->sink)($level, $event, self::redact($context));
            } catch (\Throwable) {
                // The file log above already has the entry.
            } finally {
                $this->inSink = false;
            }
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
