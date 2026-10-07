<?php
declare(strict_types=1);

namespace Sensum\Cms;

/**
 * Password hashing and policy, built only on PHP's native password_* API
 * (Argon2id when the server's PHP supports it, bcrypt otherwise).
 *
 * Policy follows NIST SP 800-63B: a minimum length, no composition rules,
 * and a block-list of very common passwords.
 */
final class Passwords
{
    public const MIN_LENGTH = 10;
    public const MAX_LENGTH = 128;

    private const COMMON = [
        '1234567890', '12345678910', '0123456789', '1111111111', '0000000000', 'qwertyuiop', 'asdfghjkl1',
        'password12', 'password123', 'password1234', 'passw0rd123', 'contraseña', 'contrasena', 'contraseña1',
        'contrasena1', 'contraseña123', 'contrasena123', 'iloveyou12', 'qwerty1234', 'qwerty12345', '1q2w3e4r5t',
        '1qaz2wsx3edc', 'abcdefghij', 'abc1234567', 'admin12345', 'administrador', 'administrator', 'welcome123',
        'bienvenido', 'bienvenido1', 'guatemala1', 'guatemala123', 'sensum1234', 'sensum12345', 'sensumconstrucciones',
        'construccion', 'construcciones', 'letmein123', 'football12', 'superman12', 'princesa12', 'trustno1234',
        'zaq12wsxcde', 'changeme123', 'cambiame123', 'temporal123', 'password!1', 'p@ssw0rd123', 'holahola12',
    ];

    public static function algorithm(): string
    {
        return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
    }

    public static function hash(string $password): string
    {
        return password_hash($password, self::algorithm());
    }

    public static function verify(string $password, string $hash): bool
    {
        return password_verify($password, $hash);
    }

    public static function needsRehash(string $hash): bool
    {
        return password_needs_rehash($hash, self::algorithm());
    }

    /**
     * Returns an error code, or null when the password is acceptable.
     * Codes are translated by the admin UI.
     */
    public static function policyError(string $password, string $email = '', string $name = ''): ?string
    {
        $len = mb_strlen($password, 'UTF-8');
        if ($len < self::MIN_LENGTH) {
            return 'password_too_short';
        }
        if ($len > self::MAX_LENGTH) {
            return 'password_too_long';
        }
        // bcrypt only uses the first 72 bytes; refuse rather than truncate silently.
        if (!defined('PASSWORD_ARGON2ID') && strlen($password) > 72) {
            return 'password_too_long';
        }
        $lower = mb_strtolower($password, 'UTF-8');
        if (in_array($lower, self::COMMON, true) || preg_match('/^(.)\1+$/u', $password)) {
            return 'password_too_common';
        }
        $local = mb_strtolower((string) strstr($email, '@', true), 'UTF-8');
        if ($email !== '' && ($lower === mb_strtolower($email, 'UTF-8') || ($local !== '' && mb_strlen($local) >= 4 && $lower === $local))) {
            return 'password_matches_email';
        }
        return null;
    }

    /** A dummy hash so failed lookups take as long as real verifications. */
    public static function dummyHash(): string
    {
        static $h = null;
        return $h ??= password_hash('timing-equalizer-' . bin2hex(random_bytes(4)), self::algorithm());
    }
}
