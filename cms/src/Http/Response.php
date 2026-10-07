<?php
declare(strict_types=1);

namespace Sensum\Cms\Http;

final class Response
{
    /** @var array<string> */
    private static array $cookies = [];

    public static function json(int $status, array $payload): never
    {
        if (!headers_sent()) {
            http_response_code($status);
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: no-store');
            header('X-Content-Type-Options: nosniff');
            header('Referrer-Policy: no-referrer');
            header_remove('X-Powered-By');
        }
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_INVALID_UTF8_SUBSTITUTE);
        exit;
    }

    public static function ok(array $payload = []): never
    {
        self::json(200, ['ok' => true] + $payload);
    }

    public static function error(ApiError $e): never
    {
        $body = ['ok' => false, 'error' => $e->errorCode];
        if ($e->fields) {
            $body['fields'] = $e->fields;
        }
        self::json($e->status, $body + $e->extra);
    }

    /**
     * Sends a 200 response immediately and lets the script continue (used to
     * send e-mail after answering, so response time does not reveal whether
     * an account exists). Falls back to a normal flush where unsupported.
     */
    public static function okAndContinue(array $payload = []): void
    {
        ignore_user_abort(true);
        $body = (string) json_encode(['ok' => true] + $payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG);
        if (!headers_sent()) {
            http_response_code(200);
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: no-store');
            header('X-Content-Type-Options: nosniff');
            header('Content-Length: ' . strlen($body));
            header('Connection: close');
        }
        echo $body;
        if (function_exists('fastcgi_finish_request')) {
            fastcgi_finish_request();
        } elseif (function_exists('litespeed_finish_request')) {
            litespeed_finish_request();
        } else {
            while (ob_get_level() > 0) {
                ob_end_flush();
            }
            flush();
        }
    }

    public static function setCookie(string $name, string $value, int $expires, bool $secure): void
    {
        setcookie($name, $value, [
            'expires' => $expires,
            'path' => '/',
            'secure' => $secure,
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
    }
}
