<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\Emails;
use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Http\Response;
use Sensum\Cms\Users;

/**
 * User management (administrators only). Accounts are created by
 * invitation: the invited person receives a single-use, expiring link and
 * chooses their own password. Passwords are never e-mailed.
 */
final class UsersController extends Controller
{
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

    public function index(): never
    {
        $rows = $this->app->db()->all(
            "SELECT u.*, (SELECT MAX(t.expires_at) FROM user_tokens t WHERE t.user_id = u.id AND t.purpose = 'invite' AND t.used_at IS NULL) AS invite_expires_at
               FROM users u ORDER BY CASE u.status WHEN 'active' THEN 0 WHEN 'invited' THEN 1 ELSE 2 END, u.name COLLATE NOCASE"
        );
        Response::ok(['users' => array_map(fn ($u) => Users::present($u) + [
            'inviteExpiresAt' => $u['invite_expires_at'] !== null ? (int) $u['invite_expires_at'] : null,
            'isSelf' => (int) $u['id'] === $this->uid(),
            'isOwner' => $this->app->auth()->isOwner($u),
        ], $rows)]);
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
        if (!$this->app->rateLimiter()->hit('invite', (string) $this->uid(), 20, 3600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $id = $this->users()->createInvited($this->str('name'), $this->str('email'), $this->str('role'), $this->lang(), $this->uid());
        $user = $this->target($id);
        $result = $this->sendInvitation($user);
        $this->app->activity($this->uid(), 'user_invited', (string) $id, ['role' => $user['role'], 'emailSent' => $result['emailSent']], $this->req->ip());
        Response::ok(['user' => Users::present($user)] + $result);
    }

    public function resend(int $id): never
    {
        if (!$this->app->rateLimiter()->hit('invite', (string) $this->uid(), 20, 3600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $user = $this->target($id);
        if ($user['status'] !== 'invited') {
            throw ApiError::validation(['status' => 'not_invited']);
        }
        $result = $this->sendInvitation($user);
        $this->app->activity($this->uid(), 'user_invite_resent', (string) $id, ['emailSent' => $result['emailSent']], $this->req->ip());
        Response::ok($result);
    }

    /** The owner account (Monitoring, alerts) cannot be demoted, disabled or deleted by other administrators. */
    private function assertNotOwner(array $user): void
    {
        if ($this->app->auth()->isOwner($user)) {
            throw ApiError::validation(['user' => 'owner_protected']);
        }
    }

    public function update(int $id): never
    {
        $user = $this->target($id);
        if ($id === $this->uid()) {
            throw ApiError::validation(['user' => 'cannot_change_self']);
        }
        $this->assertNotOwner($user);
        $role = $this->str('role');
        $status = $this->str('status');
        $role = in_array($role, Users::ROLES, true) ? $role : $user['role'];
        if ($status === '') {
            $status = $user['status'];
        } elseif (!in_array($status, ['active', 'disabled'], true) || ($user['status'] === 'invited' && $status === 'active')) {
            // Invited people become active only by accepting their invitation.
            throw ApiError::validation(['status' => 'invalid']);
        }
        $this->app->db()->transaction(function () use ($role, $status, $id) {
            $this->app->db()->run('UPDATE users SET role = ?, status = ?, updated_at = ? WHERE id = ?', [$role, $status, time(), $id]);
            if ($this->users()->activeAdmins() < 1) {
                throw ApiError::validation(['user' => 'last_admin']);
            }
            if ($status === 'disabled') {
                $this->app->auth()->revokeSessions($id);
            }
        });
        $this->app->activity($this->uid(), 'user_updated', (string) $id, ['role' => [$user['role'], $role], 'status' => [$user['status'], $status]], $this->req->ip());
        Response::ok(['user' => Users::present($this->target($id))]);
    }

    public function delete(int $id): never
    {
        $user = $this->target($id);
        if ($id === $this->uid()) {
            throw ApiError::validation(['user' => 'cannot_change_self']);
        }
        $this->assertNotOwner($user);
        $this->app->db()->transaction(function () use ($id) {
            $this->app->db()->run('DELETE FROM users WHERE id = ?', [$id]);
            if ($this->users()->activeAdmins() < 1) {
                throw ApiError::validation(['user' => 'last_admin']);
            }
        });
        $this->app->activity($this->uid(), 'user_deleted', (string) $id, ['email' => $this->app->pseudonym((string) $user['email']), 'status' => $user['status']], $this->req->ip());
        Response::ok();
    }
}
