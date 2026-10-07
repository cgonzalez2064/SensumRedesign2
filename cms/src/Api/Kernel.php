<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\App;
use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Http\Request;
use Sensum\Cms\Http\Response;

/**
 * Routes /api/* requests. Every route declares its own guard:
 *   public  — no session (still origin-checked when it changes state)
 *   user    — signed-in user + same origin + CSRF token
 *   admin   — as "user", and the user must be an administrator
 *   owner   — as "admin", and the account is OWNER_EMAIL (Monitoring)
 * Unexpected failures are logged privately and answered with a generic
 * "server_error" plus a short reference number — never with internals.
 */
final class Kernel
{
    private const ROUTES = [
        ['GET', '/api/health', SystemController::class, 'health', 'public'],
        ['POST', '/api/telemetry/error', SystemController::class, 'clientError', 'public'],

        ['GET', '/api/auth/session', AuthController::class, 'session', 'public'],
        ['POST', '/api/auth/login', AuthController::class, 'login', 'public'],
        ['POST', '/api/auth/logout', AuthController::class, 'logout', 'public'],
        ['POST', '/api/auth/forgot', AuthController::class, 'forgot', 'public'],
        ['POST', '/api/auth/reset/verify', AuthController::class, 'resetVerify', 'public'],
        ['POST', '/api/auth/reset', AuthController::class, 'reset', 'public'],
        ['POST', '/api/auth/invitation/verify', AuthController::class, 'invitationVerify', 'public'],
        ['POST', '/api/auth/invitation/accept', AuthController::class, 'invitationAccept', 'public'],
        ['POST', '/api/setup', AuthController::class, 'setup', 'public'],

        ['GET', '/api/dashboard', SystemController::class, 'dashboard', 'user'],
        ['GET', '/api/monitor/summary', MonitorController::class, 'summary', 'owner'],
        ['GET', '/api/monitor/errors', MonitorController::class, 'errors', 'owner'],
        ['POST', '/api/monitor/test-alert', MonitorController::class, 'testAlert', 'owner'],
        ['POST', '/api/site/republish', SystemController::class, 'republish', 'admin'],

        ['GET', '/api/content', ContentController::class, 'index', 'user'],
        ['POST', '/api/content/translate', ContentController::class, 'translate', 'user'],
        ['PUT', '/api/content/{section}', ContentController::class, 'update', 'user'],
        ['GET', '/api/media', ContentController::class, 'media', 'user'],
        ['POST', '/api/media/{slot}/upload', ContentController::class, 'upload', 'user'],
        ['PUT', '/api/media/{slot}/order', ContentController::class, 'reorder', 'user'],
        ['PUT', '/api/media/item/{id}', ContentController::class, 'updateItem', 'user'],
        ['DELETE', '/api/media/item/{id}', ContentController::class, 'deleteItem', 'user'],

        ['PUT', '/api/account/profile', AccountController::class, 'profile', 'user'],
        ['POST', '/api/account/password', AccountController::class, 'password', 'user'],
        ['POST', '/api/account/sessions/revoke-others', AccountController::class, 'revokeOthers', 'user'],

        ['GET', '/api/reports', ReportsController::class, 'index', 'user'],
        ['POST', '/api/reports', ReportsController::class, 'create', 'user'],
        ['POST', '/api/reports/{id}/retry', ReportsController::class, 'retry', 'user'],

        ['GET', '/api/users', UsersController::class, 'index', 'admin'],
        ['POST', '/api/users', UsersController::class, 'invite', 'admin'],
        ['POST', '/api/users/{id}/resend', UsersController::class, 'resend', 'admin'],
        ['PUT', '/api/users/{id}', UsersController::class, 'update', 'admin'],
        ['DELETE', '/api/users/{id}', UsersController::class, 'delete', 'admin'],
    ];

    private ?int $uid = null;

    public function __construct(private App $app)
    {
    }

    public function handle(Request $req): never
    {
        // PHP fatal errors (e.g. memory exhausted) bypass the catch below.
        register_shutdown_function(fn () => $this->recordFatal(error_get_last(), $req));
        try {
            $this->guardSize($req);
            [$route, $params] = $this->match($req);
            [, , $class, $method, $guard] = $route;
            $session = null;
            if ($guard === 'public') {
                $this->app->auth()->assertSameOrigin($req);
            } else {
                $session = $this->app->auth()->require($req, $guard === 'user' ? null : $guard);
                $this->uid = (int) $session['uid'];
            }
            $controller = new $class($this->app, $req, $session);
            $controller->$method(...$params);
            Response::ok();
        } catch (ApiError $e) {
            Response::error($e);
        } catch (\Throwable $e) {
            $ref = strtoupper(bin2hex(random_bytes(3)));
            // Logged as critical: recorded in the error log and e-mailed to IT (throttled).
            $this->app->logger()->critical('unhandled_exception', [
                'ref' => $ref,
                'type' => get_class($e),
                'message' => $e->getMessage(),
                'at' => basename($e->getFile()) . ':' . $e->getLine(),
                'path' => $req->path,
                'method' => $req->method,
                'uid' => $this->uid,
            ]);
            Response::json(500, ['ok' => false, 'error' => 'server_error', 'ref' => $ref]);
        }
    }

    /** Logs a PHP fatal error as critical (error log + alert to IT). */
    public function recordFatal(?array $err, Request $req): void
    {
        if (!$err || !in_array($err['type'] ?? 0, [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
            return;
        }
        $this->app->logger()->critical('php_fatal', [
            'message' => mb_substr((string) $err['message'], 0, 300),
            'at' => basename((string) $err['file']) . ':' . $err['line'],
            'path' => $req->path,
            'method' => $req->method,
            'uid' => $this->uid,
        ]);
    }

    private function guardSize(Request $req): void
    {
        $len = $req->contentLength();
        if ($req->isMultipart()) {
            $limit = 25 * 1024 * 1024;
            $post = \Sensum\Cms\Media\ImageProcessor::bytes((string) ini_get('post_max_size'));
            if ($len > $limit || ($post > 0 && $len > $post)) {
                throw ApiError::validation(['file' => 'file_too_large']);
            }
        } elseif ($len > 262144) {
            throw new ApiError(413, 'payload_too_large');
        }
    }

    /** @return array{0:array,1:list<string|int>} */
    private function match(Request $req): array
    {
        $pathMatched = false;
        foreach (self::ROUTES as $route) {
            $pattern = '#^' . preg_replace(
                ['#\{id\}#', '#\{section\}#', '#\{slot\}#'],
                ['([1-9][0-9]{0,9})', '([a-z]{2,20})', '([a-z0-9]{2,12}\.[a-z]{3,10})'],
                $route[1]
            ) . '$#';
            if (!preg_match($pattern, $req->path, $m)) {
                continue;
            }
            $pathMatched = true;
            if ($route[0] !== $req->method) {
                continue;
            }
            array_shift($m);
            return [$route, array_map(fn ($v) => ctype_digit($v) ? (int) $v : $v, $m)];
        }
        throw new ApiError($pathMatched ? 405 : 404, $pathMatched ? 'method_not_allowed' : 'not_found');
    }
}
