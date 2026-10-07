<?php
declare(strict_types=1);

namespace Sensum\Cms\Http;

final class Request
{
    private ?array $json = null;

    public function __construct(
        public readonly string $method,
        public readonly string $path,
        private array $server,
        private array $post,
        private array $files,
        private array $cookies,
        private string $rawBody,
    ) {
    }

    public static function fromGlobals(): self
    {
        $uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
        $path = (string) (parse_url($uri, PHP_URL_PATH) ?? '/');
        $path = '/' . trim(rawurldecode($path), '/');
        $contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
        $isMultipart = stripos((string) ($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart/form-data') !== false;
        // Never read an unbounded body into memory; multipart is handled by PHP itself.
        $raw = (!$isMultipart && $contentLength > 0 && $contentLength <= 262144)
            ? (string) file_get_contents('php://input', false, null, 0, 262144)
            : '';
        return new self(
            strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
            $path,
            $_SERVER,
            $_POST,
            $_FILES,
            $_COOKIE,
            $raw,
        );
    }

    public function header(string $name): string
    {
        $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
        if ($name === 'Content-Type') {
            return (string) ($this->server['CONTENT_TYPE'] ?? '');
        }
        return (string) ($this->server[$key] ?? '');
    }

    public function cookie(string $name): string
    {
        $v = $this->cookies[$name] ?? '';
        return is_string($v) ? $v : '';
    }

    /** JSON body (object). Throws a friendly error for anything else. */
    public function json(): array
    {
        if ($this->json !== null) {
            return $this->json;
        }
        if ($this->rawBody === '') {
            return $this->json = [];
        }
        if (stripos($this->header('Content-Type'), 'application/json') === false) {
            throw new ApiError(415, 'unsupported_content_type');
        }
        try {
            $data = json_decode($this->rawBody, true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new ApiError(400, 'malformed_request');
        }
        if (!is_array($data) || array_is_list($data) && $data !== []) {
            throw new ApiError(400, 'malformed_request');
        }
        return $this->json = $data;
    }

    /** A scalar string input from JSON body or multipart form. */
    public function input(string $name): string
    {
        $src = $this->isMultipart() ? $this->post : $this->json();
        $v = $src[$name] ?? '';
        if (is_bool($v)) {
            return $v ? '1' : '0';
        }
        if (is_int($v) || is_float($v)) {
            return (string) $v;
        }
        return is_string($v) ? $v : '';
    }

    /** Raw (possibly structured) JSON value. */
    public function raw(string $name): mixed
    {
        return ($this->isMultipart() ? $this->post : $this->json())[$name] ?? null;
    }

    public function file(string $name): ?array
    {
        $f = $this->files[$name] ?? null;
        if (!is_array($f) || !isset($f['error']) || is_array($f['error'])) {
            return null; // arrays of files are never accepted
        }
        return $f;
    }

    public function isMultipart(): bool
    {
        return stripos($this->header('Content-Type'), 'multipart/form-data') !== false;
    }

    public function contentLength(): int
    {
        return (int) ($this->server['CONTENT_LENGTH'] ?? 0);
    }

    public function ip(): string
    {
        // Shared hosting: REMOTE_ADDR is the client (no trusted proxy in front).
        return (string) ($this->server['REMOTE_ADDR'] ?? '0.0.0.0');
    }

    public function userAgent(): string
    {
        return mb_substr((string) ($this->server['HTTP_USER_AGENT'] ?? ''), 0, 255);
    }

    public function isStateChanging(): bool
    {
        return !in_array($this->method, ['GET', 'HEAD', 'OPTIONS'], true);
    }
}
