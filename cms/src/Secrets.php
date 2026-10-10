<?php
declare(strict_types=1);

namespace Sensum\Cms;

/**
 * Secrets stored in the database (SMTP password, Turnstile secret, backup
 * password, two-factor keys): encrypted with libsodium secretbox (AES-256-GCM
 * fallback) under a key derived from the application key and a purpose, so
 * each kind of secret has its own key. Values never leave the server in clear.
 */
final class Secrets
{
    public function __construct(private App $app)
    {
    }

    private function key(string $purpose): string
    {
        return hash('sha256', 'sensum-' . $purpose . '|' . $this->app->key(), true);
    }

    public function encrypt(string $plain, string $purpose): string
    {
        $key = $this->key($purpose);
        if (function_exists('sodium_crypto_secretbox')) {
            $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
            return 's1:' . base64_encode($nonce . sodium_crypto_secretbox($plain, $nonce, $key));
        }
        $iv = random_bytes(12);
        $tag = '';
        $cipher = (string) openssl_encrypt($plain, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
        return 'o1:' . base64_encode($iv . $tag . $cipher);
    }

    public function decrypt(string $stored, string $purpose): ?string
    {
        $raw = base64_decode(substr($stored, 3), true);
        if ($raw === false) {
            return null;
        }
        $key = $this->key($purpose);
        if (str_starts_with($stored, 's1:') && function_exists('sodium_crypto_secretbox_open')) {
            $plain = sodium_crypto_secretbox_open(substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), $key);
            return $plain === false ? null : $plain;
        }
        if (str_starts_with($stored, 'o1:')) {
            $plain = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', $key, OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
            return $plain === false ? null : $plain;
        }
        return null;
    }
}
