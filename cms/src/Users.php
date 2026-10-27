<?php
declare(strict_types=1);

namespace Sensum\Cms;

use Sensum\Cms\Content\Validator;
use Sensum\Cms\Http\ApiError;

/**
 * User accounts. There is no public registration: the owner account is
 * created from the command line (or the one-time setup screen protected by
 * SETUP_TOKEN), and everyone else is invited by the owner.
 *
 * What an account may change is its set of permissions ("tipo de acceso").
 * The owner (OWNER_EMAIL) always has every permission plus user management,
 * Monitoring and the monthly site report.
 */
final class Users
{
    public const ROLES = ['admin', 'editor'];
    /**
     * What an account may use (the owner always has everything, plus users,
     * settings and the full Monitoring):
     *   texts      Textos del sitio            contact   Datos de contacto y formulario
     *   photos     Fotos                       documents Portafolio en PDF
     *   site       Publicación y actividad (republish, recent activity)
     *   leads      Prospectos (contact-form messages; includes the statistics)
     *   stats      Estadísticas de visitas
     *   monitor    Salud del sitio (uptime, speed, incidents — no technical details)
     *   support    Gestión de solicitudes de soporte (everyone's tickets)
     *   users      Gestión de usuarios (invite, edit, passwords, two-step sign-in
     *              of accounts that don't manage users; see UsersController)
     */
    public const PERMISSIONS = ['texts', 'contact', 'photos', 'documents', 'site', 'leads', 'stats', 'monitor', 'report', 'support', 'users'];
    /**
     * Ready-made access types offered when inviting, one per real job
     * (anything else shows as "Personalizado").
     */
    public const ACCESS_TYPES = [
        'admin' => ['texts', 'contact', 'photos', 'documents', 'site', 'leads', 'stats', 'monitor', 'report', 'users'],
        'content' => ['texts', 'contact', 'photos', 'documents'],
        'texts' => ['texts'],
        'media' => ['photos', 'documents'],
        'contact' => ['contact'],
        'sales' => ['leads', 'stats'],
        'management' => ['stats', 'monitor'],
        'support' => ['support', 'monitor', 'report', 'site'],
    ];

    public function __construct(private App $app)
    {
    }

    public static function normalizeEmail(string $email): string
    {
        return mb_strtolower(trim($email), 'UTF-8');
    }

    /** @return array{0:string,1:string} [name, email] validated */
    public function validateIdentity(string $name, string $email): array
    {
        $errors = [];
        [$name, $err] = Validator::validate(['type' => 'text', 'max' => 80], $name);
        if ($err) {
            $errors['name'] = $err;
        }
        $email = self::normalizeEmail($email);
        if ($email === '' ) {
            $errors['email'] = 'required';
        } elseif (strlen($email) > 120 || !filter_var($email, FILTER_VALIDATE_EMAIL) || preg_match('/[^\x21-\x7E]/', $email)) {
            $errors['email'] = 'invalid_email';
        }
        if ($errors) {
            throw ApiError::validation($errors);
        }
        return [$name, $email];
    }

    /** The owner's address makes an account the owner (Auth::isOwner): nobody else may get it. */
    private function assertNotOwnerEmail(string $email): void
    {
        if ($email === $this->app->config->ownerEmail()) {
            throw ApiError::validation(['email' => 'owner_email_reserved']);
        }
    }

    public function find(int $id): ?array
    {
        return $this->app->db()->one('SELECT * FROM users WHERE id = ?', [$id]);
    }

    /**
     * Re-checked inside the setup transaction to close a race, so the
     * result may differ between calls.
     *
     * @phpstan-impure
     */
    public function count(): int
    {
        return (int) $this->app->db()->value('SELECT COUNT(*) FROM users');
    }

    /**
     * Validates a permission list (array of names) into the stored form.
     * @return list<string>
     */
    public static function normalizePermissions(mixed $raw): array
    {
        if (!is_array($raw) || !array_is_list($raw) || array_filter($raw, fn ($p) => !is_string($p) || !in_array($p, self::PERMISSIONS, true))) {
            throw ApiError::validation(['permissions' => 'invalid']);
        }
        $list = array_values(array_intersect(self::PERMISSIONS, $raw)); // canonical order, no duplicates
        if (!$list) {
            throw ApiError::validation(['permissions' => 'required']);
        }
        return $list;
    }

    /** @return list<string> */
    /** Key of the ready-made access type with exactly these permissions, or 'custom'. */
    public static function accessTypeOf(array $permissions): string
    {
        foreach (self::ACCESS_TYPES as $key => $perms) {
            if (count($perms) === count($permissions) && !array_diff($perms, $permissions)) {
                return $key;
            }
        }
        return 'custom';
    }

    public static function permissionsOf(array $u): array
    {
        return array_values(array_intersect(self::PERMISSIONS, explode(',', (string) ($u['permissions'] ?? ''))));
    }

    /** Creates an active account with a password (first admin / CLI). */
    public function createActive(string $name, string $email, string $password, string $role = 'admin', string $lang = 'es'): int
    {
        [$name, $email] = $this->validateIdentity($name, $email);
        if ($err = Passwords::policyError($password, $email, $name)) {
            throw ApiError::validation(['password' => $err]);
        }
        if ($this->app->db()->value('SELECT 1 FROM users WHERE email = ?', [$email])) {
            throw ApiError::validation(['email' => 'email_taken']);
        }
        $now = time();
        return $this->app->db()->insert(
            "INSERT INTO users (email, name, role, status, password_hash, lang, theme, created_at, updated_at, password_changed_at, permissions)
             VALUES (?, ?, ?, 'active', ?, ?, 'system', ?, ?, ?, ?)",
            [$email, $name, in_array($role, self::ROLES, true) ? $role : 'editor', Passwords::hash($password), $lang === 'en' ? 'en' : 'es', $now, $now, $now, implode(',', self::ACCESS_TYPES['admin'])]
        );
    }

    /**
     * Creates an invited account (no password yet) and returns its id.
     * @param list<string> $permissions already validated
     */
    public function createInvited(string $name, string $email, array $permissions, string $lang, int $invitedBy): int
    {
        [$name, $email] = $this->validateIdentity($name, $email);
        $this->assertNotOwnerEmail($email);
        $existing = $this->app->db()->one('SELECT id, status FROM users WHERE email = ?', [$email]);
        if ($existing) {
            throw ApiError::validation(['email' => $existing['status'] === 'invited' ? 'email_already_invited' : 'email_taken']);
        }
        $now = time();
        return $this->app->db()->insert(
            "INSERT INTO users (email, name, role, status, lang, theme, created_at, updated_at, invited_by, permissions)
             VALUES (?, ?, 'editor', 'invited', ?, 'system', ?, ?, ?, ?)",
            [$email, $name, $lang === 'en' ? 'en' : 'es', $now, $now, $invitedBy, implode(',', $permissions)]
        );
    }

    /** The person's own new password (Mi cuenta, reset link, invitation): no change pending any more. */
    public function setPassword(int $userId, string $password): void
    {
        $now = time();
        $this->app->db()->run(
            'UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ?, must_change_password = 0, temp_password_expires_at = NULL WHERE id = ?',
            [Passwords::hash($password), $now, $now, $userId]
        );
        // A remembered browser no longer skips the second step after a password change.
        $this->app->db()->run('DELETE FROM trusted_devices WHERE user_id = ?', [$userId]);
    }

    /**
     * A password given by someone who manages users. An invited account becomes
     * active (its invitation link stops working); with $mustChange the panel asks
     * the person for a password of their own before anything else, and the given
     * one stops working after Automations::TEMP_PASSWORD_HOURS if it is not replaced.
     */
    public function setPasswordFor(array $user, string $password, bool $mustChange): void
    {
        $now = time();
        $this->app->db()->transaction(function () use ($user, $password, $mustChange, $now) {
            $this->app->db()->run(
                "UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ?, must_change_password = ?, temp_password_expires_at = ?,
                        status = CASE status WHEN 'invited' THEN 'active' ELSE status END WHERE id = ?",
                [Passwords::hash($password), $now, $now, $mustChange ? 1 : 0, $mustChange ? $now + Automations::TEMP_PASSWORD_HOURS * 3600 : null, (int) $user['id']]
            );
            $this->app->db()->run("UPDATE user_tokens SET used_at = ? WHERE user_id = ? AND purpose IN ('invite', 'reset') AND used_at IS NULL", [$now, (int) $user['id']]);
            $this->app->db()->run('DELETE FROM trusted_devices WHERE user_id = ?', [(int) $user['id']]);
        });
    }

    /**
     * "Acceso hasta" from the panel: a date (YYYY-MM-DD) whose end, in the site's
     * time zone, is when the account turns off; '' or null for no end date.
     */
    public static function parseAccessUntil(mixed $raw, ?int $now = null): ?int
    {
        if ($raw === null || $raw === '') {
            return null;
        }
        $now ??= time();
        if (!is_string($raw) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $raw) || !($d = \DateTimeImmutable::createFromFormat('!Y-m-d', $raw)) || $d->format('Y-m-d') !== $raw) {
            throw ApiError::validation(['accessUntil' => 'invalid']);
        }
        $end = $d->setTime(23, 59, 59)->getTimestamp();
        if ($end <= $now) {
            throw ApiError::validation(['accessUntil' => 'date_past']);
        }
        if ($end > $now + 2 * 366 * 86400) {
            throw ApiError::validation(['accessUntil' => 'date_too_far']);
        }
        return $end;
    }

    /**
     * New name and/or sign-in e-mail for someone else's account.
     * @return array{name:string,email:string,emailChanged:bool}
     */
    public function changeIdentity(array $user, string $name, string $email): array
    {
        [$name, $email] = $this->validateIdentity($name, $email);
        $emailChanged = $email !== (string) $user['email'];
        if ($emailChanged) {
            $this->assertNotOwnerEmail($email);
            if ($this->app->db()->value('SELECT 1 FROM users WHERE email = ? AND id <> ?', [$email, (int) $user['id']])) {
                throw ApiError::validation(['email' => 'email_taken']);
            }
        }
        $now = time();
        $this->app->db()->transaction(function () use ($user, $name, $email, $emailChanged, $now) {
            $this->app->db()->run('UPDATE users SET name = ?, email = ?, updated_at = ? WHERE id = ?', [$name, $email, $now, (int) $user['id']]);
            if ($emailChanged) {
                // Links e-mailed to the old address stop working.
                $this->app->db()->run("UPDATE user_tokens SET used_at = ? WHERE user_id = ? AND purpose IN ('invite', 'reset') AND used_at IS NULL", [$now, (int) $user['id']]);
            }
        });
        return ['name' => $name, 'email' => $email, 'emailChanged' => $emailChanged];
    }

    public static function present(array $u): array
    {
        return [
            'id' => (int) $u['id'],
            'name' => (string) $u['name'],
            'email' => (string) $u['email'],
            'role' => (string) $u['role'],
            'permissions' => self::permissionsOf($u),
            'status' => (string) $u['status'],
            'lang' => (string) $u['lang'],
            'createdAt' => (int) $u['created_at'],
            'lastLoginAt' => $u['last_login_at'] !== null ? (int) $u['last_login_at'] : null,
            'mustChangePassword' => !empty($u['must_change_password']),
            'twoFactorEnabled' => !empty($u['totp_enabled_at']),
            'twoFactorEnabledAt' => !empty($u['totp_enabled_at']) ? (int) $u['totp_enabled_at'] : null,
            'twoFactorForced' => !empty($u['two_factor_required']),
            'accessUntil' => isset($u['access_until']) ? (int) $u['access_until'] : null,
            // A password given by a manager that was not replaced in time no longer works.
            'tempPasswordExpired' => !empty($u['must_change_password']) && isset($u['temp_password_expires_at']) && (int) $u['temp_password_expires_at'] <= time(),
            'tempPasswordExpiresAt' => !empty($u['must_change_password']) && isset($u['temp_password_expires_at']) ? (int) $u['temp_password_expires_at'] : null,
        ];
    }
}
