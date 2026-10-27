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
     * Seguridad → "Rechazar contraseñas filtradas": whether the password appears in
     * known data breaches (Have I Been Pwned, k-anonymity: only the first five
     * characters of its SHA-1 leave the server). Unreachable service: allowed.
     */
    public static function breachedError(App $app, string $password): ?string
    {
        if (!$app->automations()->accountPolicy()['breachedCheck']) {
            return null;
        }
        $base = $app->config->string('PWNED_PASSWORDS_URL', 'https://api.pwnedpasswords.com/range/');
        if ($base === '' || $base === 'off') {
            return null;
        }
        $sha = strtoupper(sha1($password));
        $ctx = stream_context_create(['http' => ['timeout' => 3, 'ignore_errors' => true, 'header' => "Add-Padding: true\r\nUser-Agent: Sensum-Content-Manager\r\n"]]);
        $body = @file_get_contents($base . substr($sha, 0, 5), false, $ctx);
        if (!is_string($body) || $body === '') {
            $app->logger()->warning('breached_check_unavailable', ['message' => 'Leaked-password check not reachable; password allowed']);
            return null;
        }
        $suffix = substr($sha, 5);
        foreach (preg_split('/\r?\n/', $body) ?: [] as $line) {
            [$hash, $count] = array_pad(explode(':', trim($line)), 2, '0');
            if (strtoupper($hash) === $suffix && (int) $count > 0) {
                return 'password_breached';
            }
        }
        return null;
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

    /**
     * Common Spanish words, 3–8 letters, no accents or ñ: they read and type the
     * same on any keyboard and are easy to dictate.
     */
    private const WORDS = [
        'agua', 'aire', 'alba', 'arena', 'arroyo', 'astro', 'aura', 'bosque', 'brisa', 'cabo', 'calma', 'campo',
        'cauce', 'cerro', 'cielo', 'cima', 'claro', 'colina', 'costa', 'cumbre', 'delta', 'duna', 'faro', 'flor',
        'fuente', 'hielo', 'isla', 'lago', 'laguna', 'llano', 'lluvia', 'luna', 'marea', 'monte', 'nieve', 'nube',
        'oasis', 'orilla', 'pampa', 'piedra', 'playa', 'prado', 'rayo', 'roca', 'selva', 'sierra', 'tierra',
        'trueno', 'valle', 'viento', 'acacia', 'arce', 'avena', 'cacao', 'cactus', 'caoba', 'cedro', 'ceiba', 'coco',
        'girasol', 'helecho', 'hiedra', 'hoja', 'laurel', 'lirio', 'loto', 'menta', 'musgo', 'nogal', 'olivo',
        'palma', 'pino', 'roble', 'rosa', 'salvia', 'sauce', 'semilla', 'tallo', 'tomillo', 'trigo', 'vainilla',
        'violeta', 'banano', 'cereza', 'ciruela', 'durazno', 'fresa', 'granada', 'guayaba', 'higo', 'kiwi', 'lima',
        'mango', 'manzana', 'mora', 'naranja', 'papaya', 'pera', 'toronja', 'zapote', 'abeja', 'alce', 'alpaca',
        'ardilla', 'ballena', 'caballo', 'canario', 'castor', 'cebra', 'ciervo', 'conejo', 'coyote', 'foca',
        'gacela', 'garza', 'gato', 'gaviota', 'grillo', 'hormiga', 'iguana', 'jaguar', 'jirafa', 'koala', 'lince',
        'lobo', 'loro', 'mapache', 'mirlo', 'morsa', 'nutria', 'oveja', 'panda', 'pato', 'perico', 'puma', 'quetzal',
        'rana', 'tapir', 'tigre', 'tortuga', 'venado', 'zorro', 'ancla', 'antena', 'arco', 'banco', 'barco', 'bote',
        'cable', 'caja', 'campana', 'canoa', 'carta', 'casa', 'castillo', 'cinta', 'clave', 'cofre', 'cometa',
        'copa', 'corona', 'cuerda', 'dado', 'disco', 'escudo', 'flecha', 'globo', 'guante', 'hamaca', 'jarra',
        'libro', 'linterna', 'llave', 'mapa', 'marco', 'mesa', 'molino', 'moneda', 'mochila', 'motor', 'nave',
        'papel', 'pincel', 'plato', 'pluma', 'puente', 'puerta', 'radio', 'reloj', 'remo', 'rueda', 'silla',
        'tambor', 'taza', 'tejado', 'telar', 'tinta', 'torre', 'trompo', 'vaso', 'vela', 'ventana', 'yate', 'azul',
        'blanco', 'bravo', 'brillo', 'dorado', 'firme', 'fresco', 'gris', 'jade', 'leal', 'lento', 'libre', 'limpio',
        'lindo', 'listo', 'noble', 'nuevo', 'plata', 'pleno', 'rojo', 'sabio', 'sereno', 'suave', 'tenaz', 'tibio',
        'verde', 'vivo', 'cobre', 'coral', 'marfil', 'perla', 'topacio', 'zafiro', 'arroz', 'canela', 'galleta',
        'miel', 'nuez', 'queso', 'sopa', 'tamal', 'tortilla', 'aldea', 'barrio', 'camino', 'ciudad', 'granja',
        'mercado', 'museo', 'parque', 'plaza', 'puerto', 'ruta', 'senda', 'templo', 'villa', 'ritmo', 'nota',
        'verso', 'poema', 'cuento', 'idea', 'meta', 'rumbo', 'viaje', 'norte', 'oeste', 'este', 'cobalto', 'cristal',
        'estrella', 'fogata', 'lucero', 'mirador', 'nido', 'pasto', 'pradera', 'rio', 'sol', 'mar', 'ola', 'uva',
        'pan', 'sur', 'pez', 'oso', 'cuarzo', 'granito', 'basalto', 'arcilla', 'ladrillo', 'madera',
    ];

    /**
     * A password that is easy to read aloud and type, e.g. "Lago-Pino-Ruta-472":
     * three words and a three-digit number (about 34 bits with 295 words).
     * Meant as a temporary password that the person replaces at first sign-in,
     * so sign-in throttling and that short life keep it safe enough.
     */
    public static function readable(): string
    {
        $parts = [];
        $n = count(self::WORDS);
        foreach ([0, 1, 2] as $i) {
            $parts[] = ucfirst(self::WORDS[random_int(0, $n - 1)]);
        }
        $parts[] = (string) random_int(100, 999);
        return implode('-', $parts);
    }

    /** A dummy hash so failed lookups take as long as real verifications. */
    public static function dummyHash(): string
    {
        static $h = null;
        return $h ??= password_hash('timing-equalizer-' . bin2hex(random_bytes(4)), self::algorithm());
    }
}
