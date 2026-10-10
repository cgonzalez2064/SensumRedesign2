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
     */
    public const PERMISSIONS = ['texts', 'contact', 'photos', 'documents', 'site', 'leads', 'stats', 'monitor', 'report', 'support'];
    /**
     * Ready-made access types offered when inviting, one per real job
     * (anything else shows as "Personalizado").
     */
    public const ACCESS_TYPES = [
        'admin' => ['texts', 'contact', 'photos', 'documents', 'site', 'leads', 'stats', 'monitor', 'report'],
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
            'permissions' => self::permissionsOf($u),
            'status' => (string) $u['status'],
            'lang' => (string) $u['lang'],
            'createdAt' => (int) $u['created_at'],
            'lastLoginAt' => $u['last_login_at'] !== null ? (int) $u['last_login_at'] : null,
        ];
    }
}
