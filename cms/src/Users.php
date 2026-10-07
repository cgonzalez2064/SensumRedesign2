<?php
declare(strict_types=1);

namespace Sensum\Cms;

use Sensum\Cms\Content\Validator;
use Sensum\Cms\Http\ApiError;

/**
 * User accounts. There is no public registration: the first administrator
 * is created from the command line (or the one-time setup screen protected
 * by SETUP_TOKEN), and everyone else is invited by an administrator.
 */
final class Users
{
    public const ROLES = ['admin', 'editor'];

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

    public function find(int $id): ?array
    {
        return $this->app->db()->one('SELECT * FROM users WHERE id = ?', [$id]);
    }

    public function count(): int
    {
        return (int) $this->app->db()->value('SELECT COUNT(*) FROM users');
    }

    public function activeAdmins(): int
    {
        return (int) $this->app->db()->value("SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active'");
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
            "INSERT INTO users (email, name, role, status, password_hash, lang, theme, created_at, updated_at, password_changed_at)
             VALUES (?, ?, ?, 'active', ?, ?, 'system', ?, ?, ?)",
            [$email, $name, in_array($role, self::ROLES, true) ? $role : 'editor', Passwords::hash($password), $lang === 'en' ? 'en' : 'es', $now, $now, $now]
        );
    }

    /** Creates an invited account (no password yet) and returns its id. */
    public function createInvited(string $name, string $email, string $role, string $lang, int $invitedBy): int
    {
        [$name, $email] = $this->validateIdentity($name, $email);
        if (!in_array($role, self::ROLES, true)) {
            throw ApiError::validation(['role' => 'invalid']);
        }
        $existing = $this->app->db()->one('SELECT id, status FROM users WHERE email = ?', [$email]);
        if ($existing) {
            throw ApiError::validation(['email' => $existing['status'] === 'invited' ? 'email_already_invited' : 'email_taken']);
        }
        $now = time();
        return $this->app->db()->insert(
            "INSERT INTO users (email, name, role, status, lang, theme, created_at, updated_at, invited_by)
             VALUES (?, ?, ?, 'invited', ?, 'system', ?, ?, ?)",
            [$email, $name, $role, $lang === 'en' ? 'en' : 'es', $now, $now, $invitedBy]
        );
    }

    public function setPassword(int $userId, string $password): void
    {
        $now = time();
        $this->app->db()->run(
            'UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?',
            [Passwords::hash($password), $now, $now, $userId]
        );
    }

    public static function present(array $u): array
    {
        return [
            'id' => (int) $u['id'],
            'name' => (string) $u['name'],
            'email' => (string) $u['email'],
            'role' => (string) $u['role'],
            'status' => (string) $u['status'],
            'lang' => (string) $u['lang'],
            'createdAt' => (int) $u['created_at'],
            'lastLoginAt' => $u['last_login_at'] !== null ? (int) $u['last_login_at'] : null,
        ];
    }
}
