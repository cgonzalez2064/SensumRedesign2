<?php
declare(strict_types=1);

namespace Sensum\Cms;

use Sensum\Cms\Content\ContentRepository;
use Sensum\Cms\Content\Schema;
use Sensum\Cms\Media\MediaService;

/**
 * Application container. Services are created lazily so a request only
 * pays for what it uses (the health check never touches the mailer, etc.).
 */
final class App
{
    public const VERSION = '1.0.0';

    private static ?self $instance = null;
    private ?Db $db = null;
    private ?Logger $logger = null;
    private ?Mailer $mailer = null;
    private ?RateLimiter $rateLimiter = null;
    private ?Auth $auth = null;
    private ?Schema $schema = null;
    private ?ContentRepository $content = null;
    private ?MediaService $media = null;
    private ?Publisher $publisher = null;
    private ?Settings $settings = null;
    private ?string $key = null;

    public readonly Config $config;

    private function __construct(private string $root)
    {
        $this->config = new Config($root);
        date_default_timezone_set($this->config->string('APP_TIMEZONE', 'America/Guatemala'));
    }

    public static function boot(string $root): self
    {
        return self::$instance ??= new self($root);
    }

    public static function instance(): self
    {
        if (!self::$instance) {
            throw new \LogicException('App not booted');
        }
        return self::$instance;
    }

    public function root(string $sub = ''): string
    {
        return $this->root . ($sub !== '' ? '/' . ltrim($sub, '/') : '');
    }

    public function storage(string $sub = ''): string
    {
        $base = $this->root('storage');
        if (!is_dir($base)) {
            @mkdir($base, 0700, true);
        }
        return $base . ($sub !== '' ? '/' . ltrim($sub, '/') : '');
    }

    /** Ensures a private storage sub-directory exists and returns its path. */
    public function storageDir(string $sub): string
    {
        $dir = $this->storage($sub);
        if (!is_dir($dir)) {
            @mkdir($dir, 0700, true);
        }
        return $dir;
    }

    /** The public web root (public_html) that receives the generated pages. */
    public function publicPath(string $sub = ''): string
    {
        $base = $this->config->get('PUBLIC_DIR');
        if ($base !== null && !str_starts_with($base, '/')) {
            // Relative paths are relative to the cms folder (local development overlay).
            $base = $this->root . '/' . $base;
        }
        if ($base === null) {
            $parent = dirname($this->root);
            $base = is_file($parent . '/index.html') || is_dir($parent . '/assets') ? $parent : $parent . '/public_html';
        }
        $base = rtrim($base, '/');
        return $base . ($sub !== '' ? '/' . ltrim($sub, '/') : '');
    }

    public function version(): string
    {
        $build = is_file($this->root('BUILD')) ? trim((string) file_get_contents($this->root('BUILD'))) : '';
        return self::VERSION . ($build !== '' ? '+' . preg_replace('/[^A-Za-z0-9.\-]/', '', $build) : '');
    }

    public function db(): Db
    {
        if (!$this->db) {
            $this->db = new Db($this->storage('database.sqlite'));
            $migrations = $this->root('migrations');
            if ($this->db->pendingMigrations($migrations) > 0) {
                $lock = fopen($this->storage('migrate.lock'), 'c');
                if ($lock && flock($lock, LOCK_EX)) {
                    $ran = $this->db->migrate($migrations);
                    flock($lock, LOCK_UN);
                    if ($ran) {
                        $this->logger()->info('migrations_applied', ['versions' => $ran]);
                    }
                }
                if ($lock) {
                    fclose($lock);
                }
            }
        }
        return $this->db;
    }

    /**
     * Server-side secret used to pseudonymize IPs/e-mails in rate-limit keys
     * and logs. Taken from APP_KEY, otherwise generated once and stored in
     * the private storage folder (0600).
     */
    public function key(): string
    {
        if ($this->key !== null) {
            return $this->key;
        }
        $fromEnv = $this->config->get('APP_KEY');
        if ($fromEnv !== null && strlen($fromEnv) >= 32) {
            return $this->key = $fromEnv;
        }
        $file = $this->storage('app.key');
        if (!is_file($file)) {
            $tmp = $file . '.' . bin2hex(random_bytes(4));
            file_put_contents($tmp, bin2hex(random_bytes(32)));
            @chmod($tmp, 0600);
            if (!@rename($tmp, $file)) {
                @unlink($tmp);
            }
        }
        return $this->key = trim((string) file_get_contents($file));
    }

    /** Keyed, non-reversible pseudonym (for IPs, e-mails in throttling/logs). */
    public function pseudonym(string $value): string
    {
        return substr(hash_hmac('sha256', strtolower($value), $this->key()), 0, 32);
    }

    public function logger(): Logger
    {
        return $this->logger ??= new Logger($this->storageDir('logs'));
    }

    public function mailer(): Mailer
    {
        return $this->mailer ??= new Mailer($this->config, $this->logger(), $this->storageDir('mail'));
    }

    public function rateLimiter(): RateLimiter
    {
        return $this->rateLimiter ??= new RateLimiter($this->db(), $this);
    }

    public function auth(): Auth
    {
        return $this->auth ??= new Auth($this);
    }

    public function schema(): Schema
    {
        return $this->schema ??= new Schema($this->root('content'));
    }

    public function content(): ContentRepository
    {
        return $this->content ??= new ContentRepository($this->db(), $this->schema());
    }

    public function media(): MediaService
    {
        return $this->media ??= new MediaService($this);
    }

    public function publisher(): Publisher
    {
        return $this->publisher ??= new Publisher($this);
    }

    public function settings(): Settings
    {
        return $this->settings ??= new Settings($this->db());
    }

    public function activity(?int $userId, string $action, string $target = '', array $details = [], ?string $ip = null): void
    {
        try {
            $this->db()->run(
                'INSERT INTO activity_log (user_id, action, target, details, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                [$userId, $action, $target, json_encode($details, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE), $ip ? $this->pseudonym($ip) : null, time()]
            );
        } catch (\Throwable $e) {
            $this->logger()->error('activity_log_failed', ['action' => $action]);
        }
    }
}
