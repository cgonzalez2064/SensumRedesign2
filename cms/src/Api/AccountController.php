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
}
