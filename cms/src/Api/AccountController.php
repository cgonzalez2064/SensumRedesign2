<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\Emails;
use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Http\Response;
use Sensum\Cms\Passwords;
use Sensum\Cms\Users;

/** "Mi cuenta": profile preferences and "Cuenta / Seguridad". */
final class AccountController extends Controller
{
    public function profile(): never
    {
        $users = new Users($this->app);
        [$name] = $users->validateIdentity($this->str('name'), (string) $this->session['email']);
        $lang = $this->lang();
        $theme = in_array($this->str('theme'), ['light', 'dark', 'system'], true) ? $this->str('theme') : 'system';
        $this->app->db()->run('UPDATE users SET name = ?, lang = ?, theme = ?, updated_at = ? WHERE id = ?', [$name, $lang, $theme, time(), $this->uid()]);
        Response::ok(['user' => $this->app->auth()->publicUser($users->find($this->uid()))]);
    }

    /** First sign-in: the language and appearance chosen on the welcome screen (once; later in Mi cuenta). */
    public function welcome(): never
    {
        $lang = $this->lang();
        $theme = in_array($this->str('theme'), ['light', 'dark', 'system'], true) ? $this->str('theme') : 'system';
        $now = time();
        $this->app->db()->run('UPDATE users SET lang = ?, theme = ?, onboarded_at = COALESCE(onboarded_at, ?), updated_at = ? WHERE id = ?', [$lang, $theme, $now, $now, $this->uid()]);
        $this->app->activity($this->uid(), 'welcome_completed', '', ['lang' => $lang, 'theme' => $theme], $this->req->ip());
        Response::ok(['user' => $this->app->auth()->publicUser((new Users($this->app))->find($this->uid()))]);
    }

    /**
     * Changes the password. Requires the current password; afterwards every
     * other session is signed out and this one gets a fresh session id.
     */
    public function password(): never
    {
        // Throttle guesses of the current password (5 wrong per 15 minutes);
        // policy mistakes on the new password are not counted.
        $rl = $this->app->rateLimiter();
        if ($rl->tooMany('password_change', (string) $this->uid(), 5, 900)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $user = (new Users($this->app))->find($this->uid());
        $current = $this->str('currentPassword');
        $new = $this->str('password');
        if ($current === '' || !Passwords::verify($current, (string) $user['password_hash'])) {
            $rl->hit('password_change', (string) $this->uid(), PHP_INT_MAX, 900);
            $this->app->activity($this->uid(), 'password_change_failed', '', [], $this->req->ip());
            throw ApiError::validation(['currentPassword' => 'current_password_wrong']);
        }
        if ($err = Passwords::policyError($new, (string) $user['email'], (string) $user['name'])) {
            throw ApiError::validation(['password' => $err]);
        }
        if (hash_equals($current, $new)) {
            throw ApiError::validation(['password' => 'password_same_as_current']);
        }
        if ($err = Passwords::breachedError($this->app, $new)) {
            throw ApiError::validation(['password' => $err]);
        }
        if (!hash_equals($new, $this->str('passwordConfirm'))) {
            throw ApiError::validation(['passwordConfirm' => 'password_mismatch']);
        }
        (new Users($this->app))->setPassword($this->uid(), $new);
        $auth = $this->app->auth();
        $ended = $auth->revokeSessions($this->uid());
        $session = $auth->startSession($this->req, $this->uid());
        $this->app->activity($this->uid(), 'password_changed', '', ['otherSessionsEnded' => max(0, $ended - 1)], $this->req->ip());
        Response::okAndContinue(['csrf' => $session['csrf'], 'otherSessionsEnded' => max(0, $ended - 1)]);
        $this->app->mailer()->send((new Emails($this->app))->passwordChanged($user));
        exit;
    }

    public function revokeOthers(): never
    {
        $n = $this->app->auth()->revokeSessions($this->uid(), (string) $this->session['id_hash']);
        $this->app->activity($this->uid(), 'sessions_revoked', '', ['count' => $n], $this->req->ip());
        Response::ok(['ended' => $n]);
    }

    // ------------------------------------------------------------------ two-step sign-in

    public function twoFactor(): never
    {
        Response::ok($this->app->twoFactor()->status($this->uid()) + ['rememberAllowed' => $this->app->automations()->accountPolicy()['rememberDevice']]);
    }

    /** Forgets every browser remembered for the second step (they ask for the code again). */
    public function forgetDevices(): never
    {
        $n = $this->app->db()->run('DELETE FROM trusted_devices WHERE user_id = ?', [$this->uid()])->rowCount();
        $this->app->activity($this->uid(), 'trusted_devices_forgotten', '', ['count' => $n], $this->req->ip());
        Response::ok(['forgotten' => $n]);
    }

    /**
     * «Quitar dispositivos registrados» for oneself (a new phone): the app and the
     * remembered browsers go and every session ends, this one too. The next
     * sign-in confirms a code sent by e-mail and registers the new device.
     */
    public function removeDevices(): never
    {
        if ($this->app->auth()->viewingAs($this->session)) {
            throw new ApiError(403, 'forbidden');
        }
        $this->confirmPassword('two_factor_devices');
        $user = (new Users($this->app))->find($this->uid());
        $this->app->twoFactor()->removeDevices($this->uid());
        $this->app->activity($this->uid(), 'two_factor_reset', (string) $this->uid(), ['self' => true], $this->req->ip());
        $this->app->auth()->revokeSessions($this->uid());
        Response::okAndContinue(['signedOut' => true]);
        $this->app->watchdog()->twoFactorNotice($user, 'reset');
        exit;
    }

    // ------------------------------------------------------------------ «Pedir acceso»

    /** The person's pending request, if any. */
    public function accessRequest(): never
    {
        (new Users($this->app))->closeCoveredRequests();
        $r = $this->app->db()->one("SELECT * FROM access_requests WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1", [$this->uid()]);
        Response::ok(['request' => $r ? ['permissions' => Users::permissionsOf(['permissions' => $r['permissions']]), 'message' => (string) $r['message'], 'createdAt' => (int) $r['created_at']] : null]);
    }

    /**
     * Asks whoever manages users for permissions this account doesn't have.
     * A new request replaces a pending one; at most 3 a day.
     */
    public function requestAccess(): never
    {
        if ($this->app->auth()->viewingAs($this->session) || $this->app->auth()->isOwner($this->session)) {
            throw new ApiError(403, 'forbidden');
        }
        $permissions = Users::normalizePermissions($this->req->raw('permissions'));
        if (array_intersect($permissions, Users::permissionsOf($this->session))) {
            throw ApiError::validation(['permissions' => 'already_have']);
        }
        if (array_intersect($permissions, Users::NOT_REQUESTABLE)) {
            throw ApiError::validation(['permissions' => 'not_requestable']);
        }
        $message = mb_substr(trim(preg_replace('/[\x00-\x09\x0B-\x1F\x7F]+/u', ' ', $this->str('message')) ?? ''), 0, 500);
        if (!$this->app->rateLimiter()->hit('access_request', (string) $this->uid(), 3, 86400)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $db = $this->app->db();
        $db->run("UPDATE access_requests SET status = 'cancelled', resolved_at = ? WHERE user_id = ? AND status = 'pending'", [time(), $this->uid()]);
        $db->insert('INSERT INTO access_requests (user_id, permissions, message, created_at) VALUES (?, ?, ?, ?)', [$this->uid(), implode(',', $permissions), $message, time()]);
        $this->app->activity($this->uid(), 'access_requested', (string) $this->uid(), ['permissions' => $permissions], $this->req->ip());
        Response::okAndContinue(['request' => ['permissions' => $permissions, 'message' => $message, 'createdAt' => time()]]);
        $user = (new Users($this->app))->find($this->uid());
        if ($user) {
            $this->app->automations()->accessRequested($user, $permissions, $message);
        }
        exit;
    }

    /** Starts set-up (password confirmed): QR code and key for the authenticator app. */
    public function twoFactorSetup(): never
    {
        $this->confirmPassword('two_factor_setup');
        if ($this->app->twoFactor()->status($this->uid())['enabled']) {
            throw new ApiError(409, 'two_factor_already_enabled');
        }
        Response::ok($this->app->twoFactor()->beginSetup($this->uid()));
    }

    /** Confirms set-up with the first code; returns the recovery codes (shown once). */
    public function twoFactorEnable(): never
    {
        if (!$this->app->rateLimiter()->hit('two_factor_enable', (string) $this->uid(), 10, 900)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $codes = $this->app->twoFactor()->confirmSetup($this->uid(), $this->str('code'));
        $this->app->activity($this->uid(), 'two_factor_enabled', '', [], $this->req->ip());
        $user = (new Users($this->app))->find($this->uid());
        Response::okAndContinue(['recoveryCodes' => $codes, 'status' => $this->app->twoFactor()->status($this->uid())]);
        $this->app->watchdog()->twoFactorNotice($user, 'enabled');
        exit;
    }

    /** New recovery codes (password + a current code). */
    public function twoFactorRecovery(): never
    {
        $this->confirmPassword('two_factor_recovery');
        $this->requireCode();
        $codes = $this->app->twoFactor()->newRecoveryCodes($this->uid());
        $this->app->activity($this->uid(), 'two_factor_recovery_codes', '', [], $this->req->ip());
        Response::ok(['recoveryCodes' => $codes, 'status' => $this->app->twoFactor()->status($this->uid())]);
    }

    /** Turns it off (password + a current code), unless the policy requires it. */
    public function twoFactorDisable(): never
    {
        $this->confirmPassword('two_factor_disable');
        if ($this->app->twoFactor()->status($this->uid())['required']) {
            throw new ApiError(409, 'two_factor_required_by_policy');
        }
        $this->requireCode();
        $this->app->twoFactor()->disable($this->uid());
        $this->app->activity($this->uid(), 'two_factor_disabled', '', [], $this->req->ip());
        $user = (new Users($this->app))->find($this->uid());
        Response::okAndContinue(['status' => $this->app->twoFactor()->status($this->uid())]);
        $this->app->watchdog()->twoFactorNotice($user, 'disabled');
        exit;
    }

    private function requireCode(): void
    {
        $rl = $this->app->rateLimiter();
        if ($rl->tooMany('two_factor_code', (string) $this->uid(), 5, 900)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        if ($this->app->twoFactor()->verify($this->uid(), mb_substr($this->str('code'), 0, 40)) === null) {
            $rl->hit('two_factor_code', (string) $this->uid(), PHP_INT_MAX, 900);
            throw ApiError::validation(['code' => 'two_factor_invalid']);
        }
    }
}
