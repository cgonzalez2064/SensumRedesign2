<?php
declare(strict_types=1);

namespace Sensum\Cms;

/**
 * Fixed-window throttling stored in SQLite. Keys are pseudonymized with
 * the application secret, so raw IPs/e-mails are never stored at rest.
 */
final class RateLimiter
{
    public function __construct(private Db $db, private App $app)
    {
    }

    /** Records one hit; returns false if the limit is now exceeded. */
    public function hit(string $bucket, string $key, int $limit, int $windowSeconds): bool
    {
        return $this->count($bucket, $key, $windowSeconds, 1) <= $limit;
    }

    /** True if the limit is already reached (does not record a hit). */
    public function tooMany(string $bucket, string $key, int $limit, int $windowSeconds): bool
    {
        return $this->count($bucket, $key, $windowSeconds, 0) >= $limit;
    }

    public function clear(string $bucket, string $key): void
    {
        $this->db->run('DELETE FROM rate_limits WHERE bucket = ? AND key_hash = ?', [$bucket, $this->app->pseudonym($key)]);
    }

    private function count(string $bucket, string $key, int $window, int $add): int
    {
        $hash = $this->app->pseudonym($key);
        $now = time();
        return $this->db->transaction(function () use ($bucket, $hash, $now, $window, $add) {
            $row = $this->db->one('SELECT window_start, hits FROM rate_limits WHERE bucket = ? AND key_hash = ?', [$bucket, $hash]);
            if (!$row || ($now - (int) $row['window_start']) >= $window) {
                if ($add === 0) {
                    return 0;
                }
                $this->db->run('DELETE FROM rate_limits WHERE bucket = ? AND key_hash = ?', [$bucket, $hash]);
                $this->db->run('INSERT INTO rate_limits (bucket, key_hash, window_start, hits) VALUES (?, ?, ?, ?)', [$bucket, $hash, $now, $add]);
                if (random_int(1, 50) === 1) {
                    $this->db->run('DELETE FROM rate_limits WHERE window_start < ?', [$now - 86400 * 2]);
                }
                return $add;
            }
            $hits = (int) $row['hits'] + $add;
            if ($add > 0) {
                $this->db->run('UPDATE rate_limits SET hits = ? WHERE bucket = ? AND key_hash = ?', [$hits, $bucket, $hash]);
            }
            return $hits;
        });
    }
}
