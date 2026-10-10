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
        Response::ok($this->app->twoFactor()->status($this->uid()));
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
