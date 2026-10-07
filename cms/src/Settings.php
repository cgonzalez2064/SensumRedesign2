<?php
declare(strict_types=1);

namespace Sensum\Cms;

/** Small key/value store for operational state (last publish, file hashes…). */
final class Settings
{
    public function __construct(private Db $db)
    {
    }

    public function get(string $key, ?string $default = null): ?string
    {
        $v = $this->db->value('SELECT value FROM settings WHERE key = ?', [$key]);
        return $v === null ? $default : (string) $v;
    }

    public function getJson(string $key, array $default = []): array
    {
        $v = $this->get($key);
        $d = $v !== null ? json_decode($v, true) : null;
        return is_array($d) ? $d : $default;
    }

    public function set(string $key, string $value): void
    {
        $now = time();
        $this->db->transaction(function () use ($key, $value, $now) {
            $exists = $this->db->value('SELECT 1 FROM settings WHERE key = ?', [$key]);
            if ($exists) {
                $this->db->run('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?', [$value, $now, $key]);
            } else {
                $this->db->run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', [$key, $value, $now]);
            }
        });
    }

    public function setJson(string $key, array $value): void
    {
        $this->set($key, (string) json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }
}
