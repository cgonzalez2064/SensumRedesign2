<?php
declare(strict_types=1);

namespace Sensum\Cms;

use PDO;
use PDOStatement;

/**
 * Thin PDO wrapper around the SQLite database.
 *
 * Every query goes through prepared statements with bound parameters;
 * nothing in this application concatenates request data into SQL.
 */
final class Db
{
    private PDO $pdo;
    /** Nesting depth: BEGIN IMMEDIATE is not tracked by PDO::inTransaction(). */
    private int $depth = 0;

    public function __construct(private string $path)
    {
        $dir = dirname($path);
        if (!is_dir($dir)) {
            @mkdir($dir, 0700, true);
        }
        $isNew = !is_file($path);
        $this->pdo = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_TIMEOUT => 5,
        ]);
        $this->pdo->exec('PRAGMA foreign_keys = ON');
        $this->pdo->exec('PRAGMA busy_timeout = 5000');
        if ($isNew) {
            @chmod($path, 0600);
        }
    }

    public function run(string $sql, array $params = []): PDOStatement
    {
        $stmt = $this->pdo->prepare($sql);
        foreach ($params as $k => $v) {
            $name = is_int($k) ? $k + 1 : (str_starts_with($k, ':') ? $k : ':' . $k);
            $type = is_int($v) ? PDO::PARAM_INT : (is_null($v) ? PDO::PARAM_NULL : (is_bool($v) ? PDO::PARAM_INT : PDO::PARAM_STR));
            $stmt->bindValue($name, is_bool($v) ? (int) $v : $v, $type);
        }
        $stmt->execute();
        return $stmt;
    }

    public function one(string $sql, array $params = []): ?array
    {
        $row = $this->run($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    public function all(string $sql, array $params = []): array
    {
        return $this->run($sql, $params)->fetchAll();
    }

    public function value(string $sql, array $params = []): mixed
    {
        $v = $this->run($sql, $params)->fetchColumn();
        return $v === false ? null : $v;
    }

    public function insert(string $sql, array $params = []): int
    {
        $this->run($sql, $params);
        return (int) $this->pdo->lastInsertId();
    }

    /**
     * @template T
     * @param callable():T $fn
     * @return T
     */
    public function transaction(callable $fn): mixed
    {
        if ($this->depth > 0) {
            $this->depth++;
            try {
                return $fn();
            } finally {
                $this->depth--;
            }
        }
        // IMMEDIATE takes the write lock up front, so two concurrent writers
        // queue (busy_timeout) instead of failing half-way through.
        $this->pdo->exec('BEGIN IMMEDIATE');
        $this->depth = 1;
        try {
            $result = $fn();
            $this->pdo->exec('COMMIT');
            return $result;
        } catch (\Throwable $e) {
            $this->pdo->exec('ROLLBACK');
            throw $e;
        } finally {
            $this->depth = 0;
        }
    }

    /** Applies pending migrations from cms/migrations (NNN_name.sql), in order. */
    public function migrate(string $dir): array
    {
        $this->pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
        $applied = array_flip($this->run('SELECT version FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN));
        $files = glob(rtrim($dir, '/') . '/*.sql') ?: [];
        sort($files, SORT_STRING);
        $ran = [];
        foreach ($files as $file) {
            $version = basename($file, '.sql');
            if (isset($applied[$version])) {
                continue;
            }
            $sql = (string) file_get_contents($file);
            $this->transaction(function () use ($sql, $version) {
                $this->pdo->exec($sql);
                $this->run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [$version, time()]);
            });
            $ran[] = $version;
        }
        return $ran;
    }

    public function pendingMigrations(string $dir): int
    {
        try {
            $applied = $this->run('SELECT version FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN);
        } catch (\PDOException) {
            $applied = [];
        }
        $files = array_map(fn ($f) => basename($f, '.sql'), glob(rtrim($dir, '/') . '/*.sql') ?: []);
        return count(array_diff($files, $applied));
    }
}
