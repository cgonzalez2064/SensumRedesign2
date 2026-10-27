<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\Emails;
use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Http\Response;
use Sensum\Cms\Passwords;
use Sensum\Cms\Users;

final class AuthController extends Controller
{
    private function sessionPayload(array $user, ?string $csrf): array
    {
        $auth = $this->app->auth();
        $public = $auth->publicUser($user);
        // First sign-in: the panel asks for the language and the appearance once (never while viewing as someone).
        $public['welcome'] = array_key_exists('onboarded_at', $user) && $user['onboarded_at'] === null && !$auth->viewingAs($user);
        $viewAs = null;
        if ($auth->viewingAs($user)) {
            $public['twoFactorRequired'] = false; // their two-step setup is not the owner's to do
            $public['mustChangePassword'] = false; // nor their new password
            $viewAs = ['by' => (string) $user['impersonator_name'], 'until' => (int) $user['view_as_until'], 'status' => (string) $user['status'],
                'accessType' => \Sensum\Cms\Users::accessTypeOf($public['permissions'])];
        }
        return [
            'authenticated' => true,
            'user' => $public,
            'viewAs' => $viewAs,
            'csrf' => $csrf,
            'app' => [
                'version' => $this->app->version(),
                'siteUrl' => $this->app->config->appUrl(),
                'idleMinutes' => $this->app->config->int('SESSION_IDLE_MINUTES', 60, 5, 24 * 60),
                // Automatic ES ⇄ EN translation available in the editors (texts, form options, photo descriptions).
                'translation' => $this->app->translator()->isEnabled(),
            ],
        ];
    }

    public function session(): never
    {
        $s = $this->app->auth()->current($this->req);
        if ($s) {
            Response::ok($this->sessionPayload($s, $s['csrf_token']));
        }
        $users = new Users($this->app);
        Response::ok([
            'authenticated' => false,
            'setupRequired' => $users->count() === 0,
        ]);
    }

    public function login(): never
    {
        $email = $this->str('email');
        $password = $this->str('password');
        if ($email === '' || $password === '') {
            throw ApiError::validation(array_filter(['email' => $email === '' ? 'required' : null, 'password' => $password === '' ? 'required' : null]));
        }
        if (mb_strlen($email) > 200 || mb_strlen($password) > 1024) {
            throw new ApiError(401, 'invalid_credentials');
        }
        $result = $this->app->auth()->login($this->req, $email, $password);
        if (isset($result['challenge'])) {
            // Password correct; the authenticator code comes next (no session yet).
            Response::ok(['authenticated' => false, 'twoFactor' => true, 'challenge' => $result['challenge'], 'rememberAllowed' => $result['remember']]);
        }
        Response::ok($this->sessionPayload($result['user'], $result['csrf']));
    }

    /** Second step of the sign-in: the 6-digit code or a recovery code. */
    public function loginSecondStep(): never
    {
        $code = $this->str('code');
        if ($code === '') {
            throw ApiError::validation(['code' => 'required']);
        }
        $result = $this->app->auth()->loginSecondStep($this->req, $this->str('challenge'), mb_substr($code, 0, 40), $this->req->raw('remember') === true);
        Response::ok($this->sessionPayload($result['user'], $result['csrf']));
    }

    public function logout(): never
    {
        $s = $this->app->auth()->current($this->req);
        if ($s) {
            $this->app->auth()->assertCsrf($this->req, $s);
            $this->app->activity((int) $s['uid'], 'logout', '', [], $this->req->ip());
        }
        $this->app->auth()->logout($this->req);
        Response::ok();
    }

    /** Always answers the same way, whether or not the account exists. */
    public function forgot(): never
    {
        $email = Users::normalizeEmail($this->str('email'));
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw ApiError::validation(['email' => $email === '' ? 'required' : 'invalid_email']);
        }
        $rl = $this->app->rateLimiter();
        $allowed = $rl->hit('forgot_ip', $this->req->ip(), 10, 3600) && $rl->hit('forgot_email', $email, 3, 3600);

        Response::okAndContinue();

        if ($allowed) {
            $user = $this->app->db()->one("SELECT * FROM users WHERE email = ? AND status = 'active'", [$email]);
            if ($user) {
                $ttl = $this->app->config->int('RESET_TTL_MINUTES', 60, 10, 1440) * 60;
                $token = $this->app->auth()->issueToken((int) $user['id'], 'reset', $ttl);
                $sent = $this->app->mailer()->send((new Emails($this->app))->passwordReset($user, $token));
                $this->app->activity((int) $user['id'], 'password_reset_requested', '', ['emailSent' => $sent], $this->req->ip());
            } else {
                $this->app->activity(null, 'password_reset_unknown_email', '', ['email' => $this->app->pseudonym($email)], $this->req->ip());
            }
        } else {
            $this->app->activity(null, 'password_reset_throttled', '', ['email' => $this->app->pseudonym($email)], $this->req->ip());
        }
        exit;
    }

    private function throttleTokenUse(): void
    {
        if (!$this->app->rateLimiter()->hit('token_use', $this->req->ip(), 30, 900)) {
            throw new ApiError(429, 'too_many_attempts');
        }
    }

    public function resetVerify(): never
    {
        $this->throttleTokenUse();
        Response::ok(['valid' => (bool) $this->app->auth()->findToken($this->str('token'), 'reset')]);
    }

    public function reset(): never
    {
        $this->throttleTokenUse();
        $auth = $this->app->auth();
        $row = $auth->findToken($this->str('token'), 'reset');
        if (!$row || $row['status'] !== 'active') {
            throw new ApiError(410, 'link_invalid');
        }
        $password = $this->str('password');
        $this->assertNewPassword($password, $this->str('passwordConfirm'), (string) $row['email'], (string) $row['name']);
        if (!$auth->consumeToken((int) $row['token_id'])) {
            throw new ApiError(410, 'link_invalid');
        }
        $users = new Users($this->app);
        $users->setPassword((int) $row['id'], $password);
        $auth->revokeSessions((int) $row['id']);
        $this->app->activity((int) $row['id'], 'password_reset_completed', '', [], $this->req->ip());
        Response::okAndContinue();
        $this->app->mailer()->send((new Emails($this->app))->passwordChanged($row));
        exit;
    }

    public function invitationVerify(): never
    {
        $this->throttleTokenUse();
        $row = $this->app->auth()->findToken($this->str('token'), 'invite');
        if (!$row || $row['status'] !== 'invited') {
            Response::ok(['valid' => false]);
        }
        Response::ok(['valid' => true, 'name' => $row['name'], 'email' => $row['email'], 'lang' => $row['lang']]);
    }

    public function invitationAccept(): never
    {
        $this->throttleTokenUse();
        $auth = $this->app->auth();
        $row = $auth->findToken($this->str('token'), 'invite');
        if (!$row || $row['status'] !== 'invited') {
            throw new ApiError(410, 'link_invalid');
        }
        $users = new Users($this->app);
        [$name] = $users->validateIdentity($this->str('name'), (string) $row['email']);
        $password = $this->str('password');
        $this->assertNewPassword($password, $this->str('passwordConfirm'), (string) $row['email'], $name);
        if (!$auth->consumeToken((int) $row['token_id'])) {
            throw new ApiError(410, 'link_invalid');
        }
        $now = time();
        $this->app->db()->run(
            "UPDATE users SET name = ?, status = 'active', password_hash = ?, password_changed_at = ?, updated_at = ?, last_login_at = ? WHERE id = ? AND status = 'invited'",
            [$name, Passwords::hash($password), $now, $now, $now, $row['id']]
        );
        $this->app->activity((int) $row['id'], 'invitation_accepted', '', [], $this->req->ip());
        $auth->startSession($this->req, (int) $row['id']);
        Response::okAndContinue(['activated' => true]);
        // Welcome e-mail: their access in plain words, first steps, how to get help (once).
        $user = (new Users($this->app))->find((int) $row['id']);
        $inviter = $user && $user['invited_by'] !== null ? (new Users($this->app))->find((int) $user['invited_by']) : null;
        if ($user) {
            $sent = $this->app->mailer()->send((new Emails($this->app))->welcome($user, $inviter ? (string) $inviter['name'] : ''));
            $this->app->activity((int) $user['id'], 'welcome_email', '', ['sent' => $sent]);
            // Whoever invited them hears that the account is active.
            $this->app->automations()->invitationAccepted($user);
        }
        exit;
    }

    /**
     * One-time creation of the first administrator from the browser, for
     * hosting without command-line access. Requires SETUP_TOKEN from the
     * server's .env and is permanently disabled once any user exists.
     */
    public function setup(): never
    {
        if (!$this->app->rateLimiter()->hit('setup_ip', $this->req->ip(), 10, 3600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $users = new Users($this->app);
        $configured = $this->app->config->string('SETUP_TOKEN');
        if ($users->count() > 0) {
            throw new ApiError(410, 'setup_closed');
        }
        if (strlen($configured) < 24 || !hash_equals($configured, $this->str('setupToken'))) {
            $this->app->activity(null, 'setup_denied', '', [], $this->req->ip());
            throw ApiError::validation(['setupToken' => 'invalid_setup_token']);
        }
        $password = $this->str('password');
        if (!hash_equals($password, $this->str('passwordConfirm'))) {
            throw ApiError::validation(['passwordConfirm' => 'password_mismatch']);
        }
        $id = $this->app->db()->transaction(function () use ($users, $password) {
            if ($users->count() > 0) {
                throw new ApiError(410, 'setup_closed');
            }
            return $users->createActive($this->str('name'), $this->str('email'), $password, 'admin', $this->lang());
        });
        $this->app->activity($id, 'setup_completed', '', [], $this->req->ip());
        $this->app->auth()->startSession($this->req, $id);
        Response::ok(['created' => true]);
    }

    private function assertNewPassword(string $password, string $confirm, string $email, string $name): void
    {
        if ($err = Passwords::policyError($password, $email, $name)) {
            throw ApiError::validation(['password' => $err]);
        }
        if (!hash_equals($password, $confirm)) {
            throw ApiError::validation(['passwordConfirm' => 'password_mismatch']);
        }
        if ($err = Passwords::breachedError($this->app, $password)) {
            throw ApiError::validation(['password' => $err]);
        }
    }
}
