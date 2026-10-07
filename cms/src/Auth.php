<?php
declare(strict_types=1);

namespace Sensum\Cms;

use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Http\Request;
use Sensum\Cms\Http\Response;

/**
 * Authentication, server-side sessions, CSRF and origin checks.
 *
 * Session cookie: random 256-bit value, HttpOnly, SameSite=Strict, Secure in
 * production (`__Host-` prefix). The database only stores its SHA-256 hash.
 * Sessions expire after an idle period and at an absolute lifetime, and can
 * be revoked individually or all at once (logout, password change/reset).
 */
final class Auth
{
    private const LOGIN_EMAIL_LIMIT = 5;    // failed attempts per e-mail…
    private const LOGIN_EMAIL_WINDOW = 900; // …per 15 minutes
    private const LOGIN_IP_LIMIT = 20;      // failed attempts per IP…
    private const LOGIN_IP_WINDOW = 900;    // …per 15 minutes

    private ?array $session = null;
    private bool $resolved = false;

    public function __construct(private App $app)
    {
    }

    public function cookieName(): string
    {
        return $this->secureCookies() ? '__Host-sensum_admin' : 'sensum_admin';
    }

    private function secureCookies(): bool
    {
        return $this->app->config->isProduction();
    }

    private function idleSeconds(): int
    {
        return $this->app->config->int('SESSION_IDLE_MINUTES', 60, 5, 24 * 60) * 60;
    }

    private function absoluteSeconds(): int
    {
        return $this->app->config->int('SESSION_ABSOLUTE_HOURS', 12, 1, 24 * 7) * 3600;
    }

    // ------------------------------------------------------------------
    // Request guards
    // ------------------------------------------------------------------

    /**
     * Rejects state-changing requests that do not come from our own origin.
     * Browsers always send `Origin` on POST/PUT/DELETE fetches; a missing
     * header is treated as hostile.
     */
    public function assertSameOrigin(Request $req): void
    {
        if (!$req->isStateChanging()) {
            return;
        }
        $origin = $req->header('Origin');
        if ($origin === '' || $origin === 'null') {
            $origin = Config::originOf($req->header('Referer'));
        }
        if ($origin === '' || !in_array(strtolower($origin), $this->app->config->allowedOrigins(), true)) {
            throw new ApiError(403, 'forbidden_origin');
        }
    }

    public function assertCsrf(Request $req, array $session): void
    {
        if (!$req->isStateChanging()) {
            return;
        }
        $sent = $req->header('X-CSRF-Token');
        if ($sent === '' || !hash_equals($session['csrf_token'], $sent)) {
            throw new ApiError(403, 'csrf_failed');
        }
    }

    /** Returns the current session (with user) or null. */
    public function current(Request $req): ?array
    {
        if ($this->resolved) {
            return $this->session;
        }
        $this->resolved = true;
        $raw = $req->cookie($this->cookieName());
        if ($raw === '' || !preg_match('/^[A-Za-z0-9_-]{43}$/', $raw)) {
            return null;
        }
        $db = $this->app->db();
        $row = $db->one(
            'SELECT s.*, u.id AS uid, u.email, u.name, u.role, u.status, u.lang, u.theme, u.last_login_at
               FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?',
            [hash('sha256', $raw)]
        );
        $now = time();
        if (!$row) {
            return null;
        }
        if ($row['status'] !== 'active' || (int) $row['expires_at'] <= $now || ((int) $row['last_seen_at'] + $this->idleSeconds()) <= $now) {
            $db->run('DELETE FROM sessions WHERE id_hash = ?', [$row['id_hash']]);
            return null;
        }
        // Sliding idle expiry, written at most once a minute.
        if ($now - (int) $row['last_seen_at'] >= 60) {
            $db->run('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?', [$now, $row['id_hash']]);
        }
        return $this->session = $row;
    }

    /** Guard for protected endpoints: authenticated + origin + CSRF (+ role). */
    public function require(Request $req, ?string $role = null): array
    {
        $this->assertSameOrigin($req);
        $s = $this->current($req);
        if (!$s) {
            throw new ApiError(401, 'unauthenticated');
        }
        $this->assertCsrf($req, $s);
        if ($role === 'admin' && $s['role'] !== 'admin') {
            throw new ApiError(403, 'forbidden');
        }
        return $s;
    }

    // ------------------------------------------------------------------
    // Login / logout
    // ------------------------------------------------------------------

    /** @return array{user:array, csrf:string} */
    public function login(Request $req, string $email, string $password): array
    {
        $email = mb_strtolower(trim($email), 'UTF-8');
        $rl = $this->app->rateLimiter();
        $ip = $req->ip();

        if ($rl->tooMany('login_ip', $ip, self::LOGIN_IP_LIMIT, self::LOGIN_IP_WINDOW)
            || $rl->tooMany('login_email', $email, self::LOGIN_EMAIL_LIMIT, self::LOGIN_EMAIL_WINDOW)) {
            $this->app->activity(null, 'login_throttled', '', ['email' => $this->app->pseudonym($email)], $ip);
            throw new ApiError(429, 'too_many_attempts');
        }

        $user = $this->app->db()->one('SELECT * FROM users WHERE email = ?', [$email]);
        $hash = ($user && $user['password_hash']) ? (string) $user['password_hash'] : Passwords::dummyHash();
        $valid = Passwords::verify($password, $hash) && $user && $user['status'] === 'active';

        if (!$valid) {
            $rl->hit('login_ip', $ip, PHP_INT_MAX, self::LOGIN_IP_WINDOW);
            $rl->hit('login_email', $email, PHP_INT_MAX, self::LOGIN_EMAIL_WINDOW);
            $this->app->activity($user ? (int) $user['id'] : null, 'login_failed', '', ['email' => $this->app->pseudonym($email)], $ip);
            $this->app->logger()->warning('login_failed', ['ip' => $this->app->pseudonym($ip)]);
            // Same response whether the account exists, is disabled or the password is wrong.
            throw new ApiError(401, 'invalid_credentials');
        }

        $rl->clear('login_email', $email);
        if (Passwords::needsRehash((string) $user['password_hash'])) {
            $this->app->db()->run('UPDATE users SET password_hash = ? WHERE id = ?', [Passwords::hash($password), $user['id']]);
        }
        $this->app->db()->run('UPDATE users SET last_login_at = ? WHERE id = ?', [time(), $user['id']]);
        $session = $this->startSession($req, (int) $user['id']);
        $this->app->activity((int) $user['id'], 'login', '', [], $ip);
        return ['user' => $user, 'csrf' => $session['csrf']];
    }

    /**
     * Creates a brand-new session (never reuses a client-supplied id).
     * @return array{id_hash:string, csrf:string}
     */
    public function startSession(Request $req, int $userId): array
    {
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $csrf = bin2hex(random_bytes(32));
        $idHash = hash('sha256', $token);
        $now = time();
        $expires = $now + $this->absoluteSeconds();
        $db = $this->app->db();
        $db->run(
            'INSERT INTO sessions (id_hash, user_id, csrf_token, created_at, last_seen_at, expires_at, user_agent, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$idHash, $userId, $csrf, $now, $now, $expires, $req->userAgent(), $this->app->pseudonym($req->ip())]
        );
        // Opportunistic cleanup of expired sessions.
        if (random_int(1, 20) === 1) {
            $db->run('DELETE FROM sessions WHERE expires_at < ? OR last_seen_at < ?', [$now, $now - $this->idleSeconds()]);
        }
        Response::setCookie($this->cookieName(), $token, $expires, $this->secureCookies());
        $this->resolved = false;
        $this->session = null;
        return ['id_hash' => $idHash, 'csrf' => $csrf];
    }

    public function logout(Request $req): void
    {
        $raw = $req->cookie($this->cookieName());
        if ($raw !== '') {
            $this->app->db()->run('DELETE FROM sessions WHERE id_hash = ?', [hash('sha256', $raw)]);
        }
        Response::setCookie($this->cookieName(), '', time() - 3600, $this->secureCookies());
        $this->session = null;
        $this->resolved = true;
    }

    /** Ends every session of a user except (optionally) the given one. */
    public function revokeSessions(int $userId, ?string $keepIdHash = null): int
    {
        if ($keepIdHash !== null) {
            return $this->app->db()->run('DELETE FROM sessions WHERE user_id = ? AND id_hash <> ?', [$userId, $keepIdHash])->rowCount();
        }
        return $this->app->db()->run('DELETE FROM sessions WHERE user_id = ?', [$userId])->rowCount();
    }

    // ------------------------------------------------------------------
    // Invitation / reset tokens (single use, expiring, hashed at rest)
    // ------------------------------------------------------------------

    public function issueToken(int $userId, string $purpose, int $ttlSeconds): string
    {
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $now = time();
        $db = $this->app->db();
        $db->transaction(function () use ($db, $userId, $purpose, $token, $now, $ttlSeconds) {
            // A new token invalidates any previous one for the same purpose.
            $db->run('UPDATE user_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL', [$now, $userId, $purpose]);
            $db->run(
                'INSERT INTO user_tokens (user_id, purpose, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
                [$userId, $purpose, hash('sha256', $token), $now, $now + $ttlSeconds]
            );
            $db->run('DELETE FROM user_tokens WHERE expires_at < ?', [$now - 30 * 86400]);
        });
        return $token;
    }

    /** Looks up a valid (unused, unexpired) token; returns the token row + user or null. */
    public function findToken(string $token, string $purpose): ?array
    {
        if (!preg_match('/^[A-Za-z0-9_-]{43}$/', $token)) {
            return null;
        }
        $row = $this->app->db()->one(
            'SELECT t.id AS token_id, t.expires_at, t.used_at, u.* FROM user_tokens t JOIN users u ON u.id = t.user_id
              WHERE t.token_hash = ? AND t.purpose = ?',
            [hash('sha256', $token), $purpose]
        );
        if (!$row || $row['used_at'] !== null || (int) $row['expires_at'] <= time()) {
            return null;
        }
        return $row;
    }

    /** Marks a token used; returns false if it was consumed concurrently. */
    public function consumeToken(int $tokenId): bool
    {
        return $this->app->db()->run('UPDATE user_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL', [time(), $tokenId])->rowCount() === 1;
    }

    public static function publicUser(array $u): array
    {
        return [
            'id' => (int) ($u['uid'] ?? $u['id']),
            'name' => (string) $u['name'],
            'email' => (string) $u['email'],
            'role' => (string) $u['role'],
            'lang' => (string) $u['lang'],
            'theme' => (string) $u['theme'],
        ];
    }
}
