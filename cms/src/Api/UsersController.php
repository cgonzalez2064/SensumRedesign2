<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\Automations;
use Sensum\Cms\Emails;
use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Http\Response;
use Sensum\Cms\Passwords;
use Sensum\Cms\Users;
use Sensum\Cms\Watchdog;

/**
 * User management: the owner account (OWNER_EMAIL) and accounts with the
 * "users" permission (Gestión de usuarios). Accounts are created by
 * invitation (the person chooses their own password from a single-use,
 * expiring link); whoever manages users can also fix the details of an
 * account, send a link to choose a new password, give a password (typed or
 * generated, normally to be replaced at first sign-in) and require or reset
 * two-step sign-in. Passwords are never e-mailed or logged.
 *
 * Who may change whom (checked here, the panel only mirrors it):
 *  - nobody changes their own account here (that is "Mi cuenta") or the owner's;
 *  - the owner may change everyone else and give any permission;
 *  - anyone else who manages users may only change accounts whose access is
 *    within their own and that don't manage users themselves, and may only
 *    give permissions they have — never "users", which only the owner gives.
 */
final class UsersController extends Controller
{
    /** How long a link to choose a new password lasts when someone who manages users sends it. */
    private const ADMIN_RESET_HOURS = 24;

    private function users(): Users
    {
        return new Users($this->app);
    }

    private function target(int $id): array
    {
        $u = $this->users()->find($id);
        if (!$u) {
            throw new ApiError(404, 'not_found');
        }
        return $u;
    }

    private function actorIsOwner(): bool
    {
        return $this->app->auth()->isOwner($this->session);
    }

    /** @throws ApiError 403 unless the account may manage users */
    private function assertManager(): void
    {
        $this->app->auth()->assertCan($this->session, 'users');
    }

    /** Permissions this account may give: all for the owner; otherwise its own, without "users". @return list<string> */
    private function assignable(): array
    {
        if ($this->actorIsOwner()) {
            return Users::PERMISSIONS;
        }
        return array_values(array_diff(Users::permissionsOf($this->session), ['users']));
    }

    /** Why this account may not change $user (null = it may). */
    private function refusal(array $user): ?string
    {
        if ((int) $user['id'] === $this->uid()) {
            return 'cannot_change_self';
        }
        if ($this->app->auth()->isOwner($user)) {
            return 'owner_protected';
        }
        if (!$this->actorIsOwner() && array_diff(Users::permissionsOf($user), $this->assignable())) {
            return 'manager_protected';
        }
        return null;
    }

    /** The account to change, after checking this account may change it. */
    private function manageable(int $id): array
    {
        $this->assertManager();
        $user = $this->target($id);
        if ($why = $this->refusal($user)) {
            throw ApiError::validation(['user' => $why]);
        }
        return $user;
    }

    /** @param list<string> $permissions */
    private function assertAssignable(array $permissions): void
    {
        if (array_diff($permissions, $this->assignable())) {
            throw ApiError::validation(['permissions' => 'not_assignable']);
        }
    }

    /** A modest cap on changes to other accounts (per account that makes them). */
    private function throttle(): void
    {
        if (!$this->app->rateLimiter()->hit('user_admin', (string) $this->uid(), 60, 3600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
    }

    public function index(): never
    {
        $this->assertManager();
        $rows = $this->app->db()->all(
            "SELECT u.*, (SELECT MAX(t.expires_at) FROM user_tokens t WHERE t.user_id = u.id AND t.purpose = 'invite' AND t.used_at IS NULL) AS invite_expires_at
               FROM users u ORDER BY CASE u.status WHEN 'active' THEN 0 WHEN 'invited' THEN 1 ELSE 2 END, u.name COLLATE NOCASE"
        );
        $twoFactor = $this->app->twoFactor();
        $byId = array_column($rows, null, 'id');
        $requests = [];
        foreach ($this->app->db()->all("SELECT * FROM access_requests WHERE status = 'pending' ORDER BY created_at") as $r) {
            $person = $byId[$r['user_id']] ?? null;
            if (!$person || $person['status'] !== 'active') {
                continue;
            }
            $perms = Users::permissionsOf(['permissions' => $r['permissions']]);
            $requests[] = [
                'id' => (int) $r['id'], 'userId' => (int) $r['user_id'], 'name' => (string) $person['name'], 'email' => (string) $person['email'],
                'permissions' => $perms, 'message' => (string) $r['message'], 'createdAt' => (int) $r['created_at'],
                // Granting needs the right to change that person and to give each permission.
                'canGrant' => $this->refusal($person) === null && !array_diff($perms, $this->assignable()),
            ];
        }
        Response::ok([
            'requests' => $requests,
            'users' => array_map(fn ($u) => Users::present($u) + [
                'inviteExpiresAt' => $u['invite_expires_at'] !== null ? (int) $u['invite_expires_at'] : null,
                'isSelf' => (int) $u['id'] === $this->uid(),
                'isOwner' => $this->app->auth()->isOwner($u),
                'canManage' => $this->refusal($u) === null,
                'twoFactorByPolicy' => $twoFactor->requiredByPolicy($u),
            ], $rows),
            'permissions' => Users::PERMISSIONS,
            'assignable' => $this->assignable(),
            'accessTypes' => Users::ACCESS_TYPES,
            'viewerIsOwner' => $this->actorIsOwner(),
        ]);
    }

    /** Issues an invitation and e-mails it. If e-mail is unavailable the link is returned once, so it can be shared another way. */
    private function sendInvitation(array $user): array
    {
        $ttl = $this->app->config->int('INVITE_TTL_HOURS', 72, 1, 336) * 3600;
        $token = $this->app->auth()->issueToken((int) $user['id'], 'invite', $ttl);
        $emails = new Emails($this->app);
        $sent = $this->app->mailer()->send($emails->invitation($user, (string) $this->session['name'], $token));
        return ['emailSent' => $sent, 'inviteLink' => $sent ? null : $emails->adminUrl('invitacion/' . $token)];
    }

    public function invite(): never
    {
        $this->assertManager();
        if (!$this->app->rateLimiter()->hit('invite', (string) $this->uid(), 20, 3600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $permissions = Users::normalizePermissions($this->req->raw('permissions'));
        $this->assertAssignable($permissions);
        $until = Users::parseAccessUntil($this->req->raw('accessUntil'));
        $id = $this->users()->createInvited($this->str('name'), $this->str('email'), $permissions, $this->lang(), $this->uid());
        if ($until !== null) {
            $this->app->db()->run('UPDATE users SET access_until = ? WHERE id = ?', [$until, $id]);
        }
        $user = $this->target($id);
        $result = $this->sendInvitation($user);
        $this->app->activity($this->uid(), 'user_invited', (string) $id, array_filter(['permissions' => $permissions, 'emailSent' => $result['emailSent'], 'accessUntil' => $until], fn ($v) => $v !== null), $this->req->ip());
        Response::ok(['user' => Users::present($user)] + $result);
    }

    public function resend(int $id): never
    {
        $user = $this->manageable($id);
        if (!$this->app->rateLimiter()->hit('invite', (string) $this->uid(), 20, 3600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        if ($user['status'] !== 'invited') {
            throw ApiError::validation(['status' => 'not_invited']);
        }
        $result = $this->sendInvitation($user);
        $this->app->activity($this->uid(), 'user_invite_resent', (string) $id, ['emailSent' => $result['emailSent']], $this->req->ip());
        Response::ok($result);
    }

    /** Status (active / disabled) and access type. */
    public function update(int $id): never
    {
        $user = $this->manageable($id);
        $this->throttle();
        $status = $this->str('status');
        if ($status === '') {
            $status = $user['status'];
        } elseif (!in_array($status, ['active', 'disabled'], true) || ($user['status'] === 'invited' && $status === 'active')) {
            // Invited people become active only by accepting their invitation (or being given a password).
            throw ApiError::validation(['status' => 'invalid']);
        }
        $raw = $this->req->raw('permissions');
        $permissions = $raw === null ? Users::permissionsOf($user) : Users::normalizePermissions($raw);
        if ($raw !== null) {
            $this->assertAssignable($permissions);
        }
        // "Acceso hasta": a new date, none ('' / null), or unchanged when absent. Reactivating
        // an account whose date has passed removes the date unless a new one comes with it.
        $until = $user['access_until'] !== null ? (int) $user['access_until'] : null;
        if (array_key_exists('accessUntil', $this->req->json())) {
            $until = Users::parseAccessUntil($this->req->raw('accessUntil'));
        } elseif ($status === 'active' && $user['status'] === 'disabled' && $until !== null && $until <= time()) {
            $until = null;
        }
        $this->app->db()->transaction(function () use ($status, $permissions, $id, $until, $user) {
            $this->app->db()->run(
                'UPDATE users SET status = ?, permissions = ?, access_until = ?, access_warned_at = CASE WHEN ? THEN NULL ELSE access_warned_at END, inactive_warned_at = CASE WHEN ? THEN NULL ELSE inactive_warned_at END, updated_at = ? WHERE id = ?',
                [$status, implode(',', $permissions), $until, $until !== ($user['access_until'] !== null ? (int) $user['access_until'] : null) ? 1 : 0, $status === 'active' && $user['status'] === 'disabled' ? 1 : 0, time(), $id]
            );
            if ($status === 'disabled') {
                $this->app->auth()->revokeSessions($id);
            }
        });
        $this->app->activity($this->uid(), 'user_updated', (string) $id, array_filter([
            'permissions' => [Users::permissionsOf($user), $permissions], 'status' => [$user['status'], $status],
            'accessUntil' => $until !== ($user['access_until'] !== null ? (int) $user['access_until'] : null) ? [$user['access_until'] !== null ? (int) $user['access_until'] : null, $until] : null,
        ], fn ($v) => $v !== null), $this->req->ip());
        Response::ok(['user' => Users::present($this->target($id))]);
    }

    /**
     * Name and sign-in e-mail. A new e-mail needs this account's password; the
     * person's sessions end, both addresses are told, and links sent to the old
     * address stop working (an invited person gets the invitation again).
     */
    public function profile(int $id): never
    {
        $user = $this->manageable($id);
        $this->throttle();
        $newEmail = Users::normalizeEmail($this->str('email'));
        if ($newEmail !== '' && $newEmail !== (string) $user['email']) {
            $this->confirmPassword('user_email_change');
        }
        $r = $this->users()->changeIdentity($user, $this->str('name'), $this->str('email'));
        $updated = $this->target($id);
        $invite = null;
        if ($r['emailChanged']) {
            $this->app->auth()->revokeSessions($id);
            if ($updated['status'] === 'invited') {
                $invite = $this->sendInvitation($updated);
            }
        }
        $this->app->activity($this->uid(), 'user_profile_updated', (string) $id, array_filter([
            'name' => $r['name'] !== (string) $user['name'] ? [(string) $user['name'], $r['name']] : null,
            'email' => $r['emailChanged'] ? [$this->app->pseudonym((string) $user['email']), $this->app->pseudonym($r['email'])] : null,
        ]), $this->req->ip());
        Response::okAndContinue(['user' => Users::present($updated)] + ($invite ?? []));
        if ($r['emailChanged'] && $updated['status'] === 'active') {
            $by = (string) $this->session['name'];
            $this->app->watchdog()->accountNotice($user, 'email_changed_old', ['email' => $r['email'], 'by' => $by]);
            $this->app->watchdog()->accountNotice($updated, 'email_changed_new', ['email' => $r['email'], 'by' => $by]);
        }
        exit;
    }

    /** A suggested password that is easy to read and type (nothing is saved). */
    public function passwordSuggestion(): never
    {
        $this->assertManager();
        Response::ok(['password' => Passwords::readable()]);
    }

    /**
     * Gives the account a password (typed or generated), normally to be replaced
     * at the next sign-in. Needs this account's password. An invited account
     * becomes active. The person's sessions end and they are told by e-mail
     * (the password itself is never sent).
     */
    public function setPassword(int $id): never
    {
        $user = $this->manageable($id);
        if ($user['status'] === 'disabled') {
            throw ApiError::validation(['user' => 'user_disabled']);
        }
        $this->throttle();
        $this->confirmPassword('user_password_set');
        $password = $this->str('password');
        if ($err = Passwords::policyError($password, (string) $user['email'], (string) $user['name']) ?? Passwords::breachedError($this->app, $password)) {
            throw ApiError::validation(['password' => $err]);
        }
        $mustChange = $this->req->raw('mustChange') !== false;
        $this->users()->setPasswordFor($user, $password, $mustChange);
        $this->app->auth()->revokeSessions($id);
        $this->app->activity($this->uid(), 'user_password_set', (string) $id, ['mustChange' => $mustChange, 'wasInvited' => $user['status'] === 'invited'], $this->req->ip());
        $updated = $this->target($id);
        Response::okAndContinue(['user' => Users::present($updated), 'message' => $this->shareMessage($updated, $password, $mustChange)]);
        $this->app->watchdog()->accountNotice($user, $mustChange ? 'password_set_temporary' : 'password_set', ['by' => (string) $this->session['name']]);
        exit;
    }

    /**
     * A message to send the person by WhatsApp or similar: where to sign in, with
     * which e-mail and password, in their language. Only returned to the browser.
     */
    private function shareMessage(array $user, string $password, bool $temporary): string
    {
        $t = $this->app->watchdog()->texts((string) $user['lang']);
        return Watchdog::fill($t[$temporary ? 'au.share.temporary' : 'au.share.permanent'], [
            'name' => explode(' ', trim((string) $user['name']))[0] ?: (string) $user['name'],
            'url' => $this->app->config->adminUrl() . '/', 'email' => (string) $user['email'], 'password' => $password,
            'hours' => Automations::TEMP_PASSWORD_HOURS,
        ]);
    }

    /** Ends every session of the person (lost phone or laptop); remembered browsers ask for the code again. */
    public function revokeSessions(int $id): never
    {
        $user = $this->manageable($id);
        $this->throttle();
        $ended = $this->app->auth()->revokeSessions($id);
        $this->app->activity($this->uid(), 'user_sessions_revoked', (string) $id, ['ended' => $ended], $this->req->ip());
        Response::okAndContinue(['ended' => $ended]);
        if ($user['status'] === 'active') {
            $this->app->watchdog()->accountNotice($user, 'sessions_revoked', ['by' => (string) $this->session['name']]);
        }
        exit;
    }

    /** «Pedir acceso»: grants the request (adds the permissions) or declines it; the person is told. */
    public function answerRequest(int $id): never
    {
        $this->assertManager();
        $r = $this->app->db()->one("SELECT * FROM access_requests WHERE id = ? AND status = 'pending'", [$id]);
        if (!$r) {
            throw new ApiError(404, 'not_found');
        }
        $user = $this->manageable((int) $r['user_id']);
        $grant = $this->req->raw('grant');
        if (!is_bool($grant)) {
            throw ApiError::validation(['grant' => 'invalid']);
        }
        $this->throttle();
        $asked = Users::permissionsOf(['permissions' => $r['permissions']]);
        $now = time();
        if ($grant) {
            $this->assertAssignable($asked);
            $permissions = array_values(array_intersect(Users::PERMISSIONS, array_unique(array_merge(Users::permissionsOf($user), $asked))));
            $this->app->db()->run('UPDATE users SET permissions = ?, updated_at = ? WHERE id = ?', [implode(',', $permissions), $now, $user['id']]);
        }
        $this->app->db()->run('UPDATE access_requests SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?', [$grant ? 'granted' : 'declined', $now, $this->uid(), $id]);
        $this->app->activity($this->uid(), $grant ? 'access_granted' : 'access_declined', (string) $user['id'], ['permissions' => $asked], $this->req->ip());
        Response::okAndContinue(['user' => Users::present($this->target((int) $user['id']))]);
        $this->app->automations()->accessAnswered($user, $asked, $grant, (string) $this->session['name']);
        exit;
    }

    /** E-mails the person a link to choose a new password themselves (valid ADMIN_RESET_HOURS). */
    public function passwordLink(int $id): never
    {
        $user = $this->manageable($id);
        if ($user['status'] !== 'active') {
            // Invited people get their invitation again; disabled accounts can't sign in.
            throw ApiError::validation(['user' => $user['status'] === 'invited' ? 'use_invitation' : 'user_disabled']);
        }
        $this->throttle();
        if (!$this->app->rateLimiter()->hit('admin_reset_link', (string) $id, 5, 3600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $token = $this->app->auth()->issueToken($id, 'reset', self::ADMIN_RESET_HOURS * 3600);
        $sent = $this->app->mailer()->send((new Emails($this->app))->passwordResetByAdmin($user, (string) $this->session['name'], $token, self::ADMIN_RESET_HOURS));
        $this->app->activity($this->uid(), 'user_password_link_sent', (string) $id, ['emailSent' => $sent], $this->req->ip());
        if (!$sent) {
            // The link is not shown here: giving a password ("Establecer contraseña") is the fallback.
            throw new ApiError(502, 'email_failed');
        }
        Response::ok(['hours' => self::ADMIN_RESET_HOURS]);
    }

    /** Requires (or stops requiring) two-step sign-in for this person; the site-wide policy still applies. */
    public function twoFactorRequirement(int $id): never
    {
        $user = $this->manageable($id);
        $this->throttle();
        $raw = $this->req->raw('required');
        if (!is_bool($raw)) {
            throw ApiError::validation(['required' => 'invalid']);
        }
        $this->app->db()->run('UPDATE users SET two_factor_required = ?, updated_at = ? WHERE id = ?', [$raw ? 1 : 0, time(), $id]);
        $this->app->activity($this->uid(), 'two_factor_requirement', (string) $id, ['required' => [!empty($user['two_factor_required']), $raw]], $this->req->ip());
        $updated = $this->target($id);
        Response::ok(['user' => Users::present($updated) + ['twoFactorByPolicy' => $this->app->twoFactor()->requiredByPolicy($updated)]]);
    }

    public function delete(int $id): never
    {
        $user = $this->manageable($id);
        $this->throttle();
        $this->app->db()->run('DELETE FROM users WHERE id = ?', [$id]);
        $this->app->activity($this->uid(), 'user_deleted', (string) $id, ['email' => $this->app->pseudonym((string) $user['email']), 'status' => $user['status']], $this->req->ip());
        Response::ok();
    }

    /** Turns off someone's two-step sign-in (lost phone). They set it up again at next sign-in if required. */
    public function resetTwoFactor(int $id): never
    {
        // Your own second step is turned off in "Mi cuenta", which also asks for a code.
        if ($id === $this->uid()) {
            throw ApiError::validation(['user' => 'two_factor_self']);
        }
        $user = $this->manageable($id);
        $this->confirmPassword('two_factor_reset');
        $this->app->twoFactor()->disable($id);
        $this->app->auth()->revokeSessions($id);
        $this->app->activity($this->uid(), 'two_factor_reset', (string) $id, [], $this->req->ip());
        Response::okAndContinue([
            'user' => Users::present($this->target($id)),
            // The owner's Seguridad screen redraws its list from this.
            'twoFactor' => $this->actorIsOwner() ? $this->app->twoFactor()->overview() : null,
        ]);
        $this->app->watchdog()->twoFactorNotice($user, 'reset');
        exit;
    }
}
