<?php
declare(strict_types=1);

namespace Sensum\Cms;

use BaconQrCode\Renderer\Image\SvgImageBackEnd;
use BaconQrCode\Renderer\ImageRenderer;
use BaconQrCode\Renderer\RendererStyle\RendererStyle;
use BaconQrCode\Writer;
use Sensum\Cms\Http\ApiError;

/**
 * Two-step sign-in with an authenticator app (TOTP, RFC 6238: Google or
 * Microsoft Authenticator, 1Password, Authy…), plus ten one-time recovery
 * codes. The secret is stored encrypted; a code cannot be used twice.
 *
 * Policy (owner, Seguridad): "owner" (default) requires it for the owner
 * account, "all" for everyone, "none" leaves it optional. Whoever manages users
 * can also require it for one person (users.two_factor_required). An account
 * that must use it but has not set it up yet can only reach the set-up screen.
 */
final class TwoFactor
{
    public const POLICIES = ['none', 'owner', 'all'];
    private const DIGITS = 6;
    private const PERIOD = 30;
    private const RECOVERY_CODES = 10;
    private const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    public function __construct(private App $app)
    {
    }

    // ------------------------------------------------------------------ policy

    public function policy(): string
    {
        $p = $this->app->settings()->getJson('security_policy')['twoFactor'] ?? null;
        $p = is_string($p) ? $p : $this->app->config->string('TWO_FACTOR_POLICY', 'owner');
        return in_array($p, self::POLICIES, true) ? $p : 'owner';
    }

    public function setPolicy(string $policy): string
    {
        if (!in_array($policy, self::POLICIES, true)) {
            throw ApiError::validation(['twoFactor' => 'invalid']);
        }
        $s = $this->app->settings()->getJson('security_policy');
        $s['twoFactor'] = $policy;
        $this->app->settings()->setJson('security_policy', $s);
        return $policy;
    }

    public function required(array $user): bool
    {
        return $this->requiredByPolicy($user) || !empty($user['two_factor_required']);
    }

    /** Required by the site-wide policy alone (not by a per-person requirement). */
    public function requiredByPolicy(array $user): bool
    {
        $p = $this->policy();
        return $p === 'all' || ($p === 'owner' && $this->app->auth()->isOwner($user));
    }

    public function enabled(array $user): bool
    {
        return !empty($user['totp_enabled_at']);
    }

    /** Signed in, covered by the policy, not set up yet: only the set-up screen is allowed. */
    public function mustEnroll(array $session): bool
    {
        return $this->required($session) && !$this->enabled($session);
    }

    public function overview(): array
    {
        $users = [];
        foreach ($this->app->db()->all("SELECT id, name, email, status, totp_enabled_at, two_factor_required FROM users WHERE status <> 'invited' ORDER BY name") as $u) {
            $users[] = [
                'id' => (int) $u['id'], 'name' => $u['name'], 'email' => $u['email'], 'status' => $u['status'],
                'owner' => $this->app->auth()->isOwner($u), 'enabled' => $this->enabled($u),
                'enabledAt' => $u['totp_enabled_at'] !== null ? (int) $u['totp_enabled_at'] : null, 'required' => $this->required($u),
            ];
        }
        return ['policy' => $this->policy(), 'users' => $users];
    }

    public function status(int $userId): array
    {
        $u = $this->user($userId);
        return [
            'enabled' => $this->enabled($u),
            'enabledAt' => $u['totp_enabled_at'] !== null ? (int) $u['totp_enabled_at'] : null,
            'required' => $this->required($u),
            'recoveryRemaining' => (int) $this->app->db()->value('SELECT COUNT(*) FROM recovery_codes WHERE user_id = ? AND used_at IS NULL', [$userId]),
        ];
    }

    private function user(int $userId): array
    {
        $u = $this->app->db()->one('SELECT * FROM users WHERE id = ?', [$userId]);
        if (!$u) {
            throw new ApiError(404, 'not_found');
        }
        return $u;
    }

    // ------------------------------------------------------------------ set-up

    /** Starts set-up: a new secret (not active until a code confirms it). */
    public function beginSetup(int $userId): array
    {
        $u = $this->user($userId);
        $secret = self::base32(random_bytes(20));
        $this->app->db()->run('UPDATE users SET totp_pending_enc = ? WHERE id = ?', [$this->app->secrets()->encrypt($secret, 'totp'), $userId]);
        $issuer = 'Sensum Construcciones';
        $uri = 'otpauth://totp/' . rawurlencode($issuer . ':' . $u['email']) . '?secret=' . $secret . '&issuer=' . rawurlencode($issuer)
            . '&algorithm=SHA1&digits=' . self::DIGITS . '&period=' . self::PERIOD;
        $svg = (new Writer(new ImageRenderer(new RendererStyle(232, 2), new SvgImageBackEnd())))->writeString($uri);
        return ['secret' => trim(chunk_split($secret, 4, ' ')), 'uri' => $uri, 'qr' => 'data:image/svg+xml;base64,' . base64_encode($svg)];
    }

    /** Confirms set-up with the first code from the app. Returns the recovery codes (shown once). */
    public function confirmSetup(int $userId, string $code): array
    {
        $u = $this->user($userId);
        $pending = is_string($u['totp_pending_enc']) && $u['totp_pending_enc'] !== '' ? $this->app->secrets()->decrypt($u['totp_pending_enc'], 'totp') : null;
        if ($pending === null) {
            throw new ApiError(409, 'two_factor_setup_expired');
        }
        $step = $this->matchStep($pending, $code, 0);
        if ($step === null) {
            throw ApiError::validation(['code' => 'two_factor_invalid']);
        }
        $this->app->db()->run('UPDATE users SET totp_secret_enc = totp_pending_enc, totp_pending_enc = NULL, totp_enabled_at = ?, totp_last_step = ? WHERE id = ?', [time(), $step, $userId]);
        return $this->newRecoveryCodes($userId);
    }

    /** @return list<string> */
    public function newRecoveryCodes(int $userId): array
    {
        $db = $this->app->db();
        $codes = [];
        $db->transaction(function () use ($db, $userId, &$codes) {
            $db->run('DELETE FROM recovery_codes WHERE user_id = ?', [$userId]);
            for ($i = 0; $i < self::RECOVERY_CODES; $i++) {
                $raw = '';
                for ($j = 0; $j < 10; $j++) {
                    $raw .= self::ALPHABET[random_int(0, 31)];
                }
                $code = substr($raw, 0, 5) . '-' . substr($raw, 5);
                $codes[] = $code;
                $db->run('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)', [$userId, $this->hashRecovery($code)]);
            }
        });
        return $codes;
    }

    public function disable(int $userId): void
    {
        $this->app->db()->transaction(function () use ($userId) {
            $this->app->db()->run('UPDATE users SET totp_secret_enc = NULL, totp_pending_enc = NULL, totp_enabled_at = NULL, totp_last_step = 0 WHERE id = ?', [$userId]);
            $this->app->db()->run('DELETE FROM recovery_codes WHERE user_id = ?', [$userId]);
        });
    }

    // ------------------------------------------------------------------ verification

    /**
     * Checks a 6-digit code (or a recovery code) for an account with two-step
     * sign-in. Codes are accepted once (no replay).
     * @return 'totp'|'recovery'|null
     */
    public function verify(int $userId, string $input): ?string
    {
        $u = $this->user($userId);
        $secret = is_string($u['totp_secret_enc']) && $u['totp_secret_enc'] !== '' ? $this->app->secrets()->decrypt($u['totp_secret_enc'], 'totp') : null;
        if ($secret === null) {
            return null;
        }
        $digits = preg_replace('/\s+/', '', $input) ?? '';
        if (preg_match('/^\d{6}$/', $digits)) {
            $step = $this->matchStep($secret, $digits, (int) $u['totp_last_step']);
            if ($step === null) {
                return null;
            }
            // Only one sign-in per time step, even if two requests race.
            $updated = $this->app->db()->run('UPDATE users SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?', [$step, $userId, $step]);
            return $updated->rowCount() === 1 ? 'totp' : null;
        }
        $normalized = strtoupper((string) preg_replace('/[^A-Za-z2-7]/', '', $input));
        if (strlen($normalized) !== 10) {
            return null;
        }
        $hash = $this->hashRecovery(substr($normalized, 0, 5) . '-' . substr($normalized, 5));
        $row = $this->app->db()->one('SELECT id FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL', [$userId, $hash]);
        if (!$row) {
            return null;
        }
        $used = $this->app->db()->run('UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL', [time(), $row['id']]);
        return $used->rowCount() === 1 ? 'recovery' : null;
    }

    /** The matching time step (±1 for clock drift) newer than $lastStep, or null. */
    private function matchStep(string $secret, string $code, int $lastStep): ?int
    {
        $code = preg_replace('/\s+/', '', $code) ?? '';
        if (!preg_match('/^\d{6}$/', $code)) {
            return null;
        }
        $key = self::base32Decode($secret);
        $now = intdiv(time(), self::PERIOD);
        foreach ([0, -1, 1] as $d) {
            $step = $now + $d;
            if ($step > $lastStep && hash_equals(self::hotp($key, $step), $code)) {
                return $step;
            }
        }
        return null;
    }

    public static function hotp(string $key, int $counter): string
    {
        $hash = hash_hmac('sha1', pack('N2', $counter >> 32, $counter & 0xFFFFFFFF), $key, true);
        $offset = ord($hash[19]) & 0x0F;
        $value = ((ord($hash[$offset]) & 0x7F) << 24) | (ord($hash[$offset + 1]) << 16) | (ord($hash[$offset + 2]) << 8) | ord($hash[$offset + 3]);
        return str_pad((string) ($value % 10 ** self::DIGITS), self::DIGITS, '0', STR_PAD_LEFT);
    }

    private function hashRecovery(string $code): string
    {
        return hash_hmac('sha256', strtoupper($code), $this->app->key() . '|recovery');
    }

    public static function base32(string $bytes): string
    {
        $bits = '';
        foreach (str_split($bytes) as $c) {
            $bits .= str_pad(decbin(ord($c)), 8, '0', STR_PAD_LEFT);
        }
        $out = '';
        foreach (str_split($bits, 5) as $chunk) {
            $out .= self::ALPHABET[bindec(str_pad($chunk, 5, '0'))];
        }
        return $out;
    }

    public static function base32Decode(string $s): string
    {
        $s = strtoupper((string) preg_replace('/[^A-Za-z2-7]/', '', $s));
        $bits = '';
        foreach (str_split($s) as $c) {
            $bits .= str_pad(decbin((int) strpos(self::ALPHABET, $c)), 5, '0', STR_PAD_LEFT);
        }
        $out = '';
        foreach (str_split($bits, 8) as $byte) {
            if (strlen($byte) === 8) {
                $out .= chr((int) bindec($byte));
            }
        }
        return $out;
    }

    // ------------------------------------------------------------------ sign-in challenges

    /** After a correct password: a short-lived challenge for the second step. */
    public function createChallenge(int $userId): string
    {
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $now = time();
        $this->app->db()->run('DELETE FROM login_challenges WHERE expires_at < ? OR user_id = ?', [$now, $userId]);
        $this->app->db()->run('INSERT INTO login_challenges (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [hash('sha256', $token), $userId, $now, $now + 300]);
        return $token;
    }

    /**
     * Second step of the sign-in. Returns the user id when the code is right.
     * Five wrong codes (or five minutes) end the challenge: the password is asked again.
     * @return array{userId:int,method:string}
     */
    public function completeChallenge(string $token, string $code): array
    {
        if (!preg_match('/^[A-Za-z0-9_-]{43}$/', $token)) {
            throw new ApiError(401, 'two_factor_expired');
        }
        $db = $this->app->db();
        $hash = hash('sha256', $token);
        $row = $db->one('SELECT * FROM login_challenges WHERE id_hash = ?', [$hash]);
        if (!$row || (int) $row['expires_at'] < time() || (int) $row['attempts'] >= 5) {
            if ($row) {
                $db->run('DELETE FROM login_challenges WHERE id_hash = ?', [$hash]);
            }
            throw new ApiError(401, 'two_factor_expired');
        }
        $db->run('UPDATE login_challenges SET attempts = attempts + 1 WHERE id_hash = ?', [$hash]);
        $method = $this->verify((int) $row['user_id'], $code);
        if ($method === null) {
            $this->app->activity((int) $row['user_id'], 'login_2fa_failed', '', []);
            throw new ApiError(422, 'validation', ['code' => 'two_factor_invalid'], ['attemptsLeft' => max(0, 4 - (int) $row['attempts'])]);
        }
        $db->run('DELETE FROM login_challenges WHERE id_hash = ?', [$hash]);
        return ['userId' => (int) $row['user_id'], 'method' => $method];
    }
}
