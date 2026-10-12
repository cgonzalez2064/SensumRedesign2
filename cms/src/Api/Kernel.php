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
 *   owner   — as "user", and the account is OWNER_EMAIL (users, Monitoring, site report)
 * Finer rules (which information an account may change) are checked in the
 * controllers with Auth::assertCan().
 * Unexpected failures are logged privately and answered with a generic
 * "server_error" plus a short reference number — never with internals.
 */
final class Kernel
{
    private const ROUTES = [
        ['GET', '/api/health', SystemController::class, 'health', 'public'],
        ['POST', '/api/telemetry/error', SystemController::class, 'clientError', 'public'],
        ['POST', '/api/collect', LeadsController::class, 'collect', 'public'],

        ['GET', '/api/auth/session', AuthController::class, 'session', 'public'],
        ['POST', '/api/auth/login', AuthController::class, 'login', 'public'],
        ['POST', '/api/auth/login/2fa', AuthController::class, 'loginSecondStep', 'public'],
        ['POST', '/api/auth/logout', AuthController::class, 'logout', 'public'],
        ['POST', '/api/auth/forgot', AuthController::class, 'forgot', 'public'],
        ['POST', '/api/auth/reset/verify', AuthController::class, 'resetVerify', 'public'],
        ['POST', '/api/auth/reset', AuthController::class, 'reset', 'public'],
        ['POST', '/api/auth/invitation/verify', AuthController::class, 'invitationVerify', 'public'],
        ['POST', '/api/auth/invitation/accept', AuthController::class, 'invitationAccept', 'public'],
        ['POST', '/api/setup', AuthController::class, 'setup', 'public'],

        ['GET', '/api/dashboard', SystemController::class, 'dashboard', 'user'],
        ['GET', '/api/view-as', ViewAsController::class, 'index', 'user'],
        ['POST', '/api/view-as', ViewAsController::class, 'start', 'user'],
        ['POST', '/api/view-as/switch', ViewAsController::class, 'switch', 'user'],
        ['POST', '/api/view-as/stop', ViewAsController::class, 'stop', 'user'],
        ['GET', '/api/monitor/summary', MonitorController::class, 'summary', 'owner'],
        ['GET', '/api/monitor/overview', MonitorController::class, 'overview', 'user'],
        ['GET', '/api/monitor/series', MonitorController::class, 'series', 'user'],
        ['GET', '/api/monitor/errors', MonitorController::class, 'errors', 'owner'],
        ['POST', '/api/monitor/test-alert', MonitorController::class, 'testAlert', 'owner'],
        ['PUT', '/api/monitor/alerts', MonitorController::class, 'saveRules', 'owner'],
        ['GET', '/api/monitor/integrity', MonitorController::class, 'integrity', 'owner'],
        ['POST', '/api/monitor/domain-check', MonitorController::class, 'domainCheck', 'owner'],
        ['POST', '/api/monitor/integrity/accept', MonitorController::class, 'acceptIntegrity', 'owner'],
        ['GET', '/api/settings/email', SettingsController::class, 'email', 'owner'],
        ['PUT', '/api/settings/email', SettingsController::class, 'saveEmail', 'owner'],
        ['POST', '/api/settings/email/test', SettingsController::class, 'testEmail', 'owner'],
        ['GET', '/api/settings/translation', TranslationController::class, 'index', 'owner'],
        ['PUT', '/api/settings/translation', TranslationController::class, 'save', 'owner'],
        ['POST', '/api/settings/translation/test', TranslationController::class, 'test', 'owner'],
        ['GET', '/api/site-report', SiteReportController::class, 'index', 'owner'],
        ['GET', '/api/site-report/preview', SiteReportController::class, 'preview', 'user'],
        ['PUT', '/api/site-report/settings', SiteReportController::class, 'settings', 'owner'],
        ['POST', '/api/site-report/send', SiteReportController::class, 'send', 'owner'],
        ['POST', '/api/site-report/pdf', SiteReportController::class, 'pdf', 'owner'],
        ['POST', '/api/site/republish', SystemController::class, 'republish', 'user'],

        ['GET', '/api/content', ContentController::class, 'index', 'user'],
        ['GET', '/api/contact-form', FormController::class, 'form', 'user'],
        ['PUT', '/api/contact-form', FormController::class, 'saveForm', 'user'],
        ['PUT', '/api/contact-form/recipients', FormController::class, 'saveRecipients', 'owner'],
        ['GET', '/api/contact-form/services', FormController::class, 'services', 'user'],
        ['PUT', '/api/contact-form/services', FormController::class, 'saveServices', 'user'],
        ['POST', '/api/content/translate', ContentController::class, 'translate', 'user'],
        ['PUT', '/api/content/{section}', ContentController::class, 'update', 'user'],
        ['GET', '/api/media', ContentController::class, 'media', 'user'],
        ['POST', '/api/media/{slot}/upload', ContentController::class, 'upload', 'user'],
        ['PUT', '/api/media/{slot}/order', ContentController::class, 'reorder', 'user'],
        ['PUT', '/api/media/item/{id}', ContentController::class, 'updateItem', 'user'],
        ['DELETE', '/api/media/item/{id}', ContentController::class, 'deleteItem', 'user'],

        ['PUT', '/api/account/profile', AccountController::class, 'profile', 'user'],
        ['PUT', '/api/account/welcome', AccountController::class, 'welcome', 'user'],
        ['POST', '/api/account/password', AccountController::class, 'password', 'user'],
        ['POST', '/api/account/sessions/revoke-others', AccountController::class, 'revokeOthers', 'user'],
        ['GET', '/api/account/2fa', AccountController::class, 'twoFactor', 'user'],
        ['POST', '/api/account/2fa/setup', AccountController::class, 'twoFactorSetup', 'user'],
        ['POST', '/api/account/2fa/enable', AccountController::class, 'twoFactorEnable', 'user'],
        ['POST', '/api/account/2fa/recovery-codes', AccountController::class, 'twoFactorRecovery', 'user'],
        ['POST', '/api/account/2fa/disable', AccountController::class, 'twoFactorDisable', 'user'],
        ['GET', '/api/security', SecurityController::class, 'index', 'owner'],
        ['PUT', '/api/security/backup', SecurityController::class, 'saveBackup', 'owner'],
        ['POST', '/api/security/backup/send', SecurityController::class, 'sendBackup', 'owner'],
        ['POST', '/api/security/backup/download', SecurityController::class, 'downloadBackup', 'owner'],
        ['PUT', '/api/security/policy', SecurityController::class, 'savePolicy', 'owner'],
        ['POST', '/api/users/{id}/2fa-reset', UsersController::class, 'resetTwoFactor', 'owner'],

        ['GET', '/api/reports', ReportsController::class, 'index', 'user'],
        ['POST', '/api/reports', ReportsController::class, 'create', 'user'],
        ['POST', '/api/reports/{id}/retry', ReportsController::class, 'retry', 'user'],
        ['GET', '/api/reports/badge', ReportsController::class, 'badge', 'user'],
        ['GET', '/api/leads', LeadsController::class, 'index', 'user'],
        ['GET', '/api/leads/badge', LeadsController::class, 'badge', 'user'],
        ['POST', '/api/leads/export', LeadsController::class, 'export', 'user'],
        ['PUT', '/api/leads/settings', LeadsController::class, 'settings', 'owner'],
        ['GET', '/api/leads/{id}', LeadsController::class, 'show', 'user'],
        ['PUT', '/api/leads/{id}', LeadsController::class, 'update', 'user'],
        ['POST', '/api/leads/{id}/notes', LeadsController::class, 'note', 'user'],
        ['DELETE', '/api/leads/{id}', LeadsController::class, 'delete', 'user'],
        ['GET', '/api/stats', LeadsController::class, 'stats', 'user'],
        ['PUT', '/api/stats/settings', LeadsController::class, 'statsSettings', 'owner'],
        ['PUT', '/api/reports/settings', ReportsController::class, 'settings', 'user'],
        ['GET', '/api/reports/analytics', ReportsController::class, 'analytics', 'user'],
        ['GET', '/api/reports/{id}', ReportsController::class, 'show', 'user'],
        ['POST', '/api/reports/{id}/rating', ReportsController::class, 'rate', 'user'],
        ['PUT', '/api/reports/{id}', ReportsController::class, 'update', 'user'],
        ['POST', '/api/reports/{id}/status', ReportsController::class, 'status', 'user'],
        ['POST', '/api/reports/{id}/messages', ReportsController::class, 'message', 'user'],
        ['GET', '/api/reports/{id}/screenshot', ReportsController::class, 'screenshot', 'user'],

        ['GET', '/api/users', UsersController::class, 'index', 'owner'],
        ['POST', '/api/users', UsersController::class, 'invite', 'owner'],
        ['POST', '/api/users/{id}/resend', UsersController::class, 'resend', 'owner'],
        ['PUT', '/api/users/{id}', UsersController::class, 'update', 'owner'],
        ['DELETE', '/api/users/{id}', UsersController::class, 'delete', 'owner'],
    ];

    /** Requests other than GET allowed while "viendo como": switching/leaving, and read-only downloads. */
    private const VIEW_AS_WRITES = ['/api/view-as/switch', '/api/view-as/stop', '/api/leads/export'];

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
                // Lets the panel notice when "Ver como" started, changed or ended elsewhere.
                header('X-View-As: ' . ($this->app->auth()->viewingAs($session) ? (int) $session['uid'] : 0));
                if ($this->app->auth()->viewingAs($session)) {
                    // "Ver como": the panel answers as that account, read-only.
                    $this->app->setViewOnly(true);
                    if ($req->method !== 'GET' && !in_array($req->path, self::VIEW_AS_WRITES, true)) {
                        throw new ApiError(403, 'view_only');
                    }
                } elseif (!str_starts_with($req->path, '/api/account/2fa') && $this->app->twoFactor()->mustEnroll($session)) {
                    // Covered by the two-step policy but not set up yet: only the set-up endpoints.
                    throw new ApiError(403, 'two_factor_setup_required');
                }
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
