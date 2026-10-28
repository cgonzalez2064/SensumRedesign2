<?php
declare(strict_types=1);

namespace Sensum\Cms;

/**
 * The two cron jobs the Content Manager needs — the scheduled check every 15
 * minutes and the daily database backup — as they should be on this server,
 * whether the account's crontab has them, and installing or repairing them
 * (`bin/console cron` / `cron:install`) without touching anyone else's lines.
 *
 * Each line carries the marker "# sensum-cms" (a shell comment, so cron runs the
 * command unchanged and cPanel → Cron Jobs keeps it when other jobs are edited).
 * Lines written by hand from the deployment guide (with this installation's path,
 * "~/…" or the guide's /home/USUARIO/… placeholder) are recognised and replaced.
 * Only errors are written to storage/logs/cron.log; normal output is discarded.
 */
final class Scheduler
{
    public const MARK = '# sensum-cms';
    private const LOG_MAX = 1048576;

    public function __construct(private App $app)
    {
    }

    /** @return array<string,array{label:string,line:string}> */
    public function jobs(?string $php = null): array
    {
        $php ??= $this->php();
        $cmd = fn (string $task) => self::arg($php) . ' ' . self::arg($this->console()) . " {$task} > /dev/null 2>> " . self::arg($this->logFile()) . ' ' . self::MARK;
        return [
            'monitor' => ['label' => 'Scheduled check, every 15 minutes', 'line' => '*/15 * * * * ' . $cmd('monitor')],
            'backup' => ['label' => 'Database backup, daily at 03:17', 'line' => '17 3 * * * ' . $cmd('backup')],
        ];
    }

    /**
     * The PHP for cron: the `php` first on the PATH when it is this same version
     * (it follows cPanel's PHP selector), otherwise the binary running now.
     * Cron's own PATH is shorter, so the line always has the full path.
     */
    public function php(): string
    {
        foreach (explode(PATH_SEPARATOR, (string) getenv('PATH')) as $dir) {
            $bin = rtrim($dir, '/') . '/php';
            if (!str_starts_with($dir, '/') || !is_file($bin) || !is_executable($bin)) {
                continue;
            }
            $version = trim((string) $this->exec([$bin, '-r', 'echo PHP_MAJOR_VERSION, ".", PHP_MINOR_VERSION;'])[1]);
            return $version === PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION ? $bin : PHP_BINARY;
        }
        return PHP_BINARY;
    }

    public function console(): string
    {
        return realpath($this->app->root('bin/console')) ?: $this->app->root('bin/console');
    }

    public function logFile(): string
    {
        return $this->app->storageDir('logs') . '/cron.log';
    }

    /** Whether this server lets PHP read and write the crontab. */
    public function available(): bool
    {
        $off = array_map('trim', explode(',', (string) ini_get('disable_functions')));
        return function_exists('proc_open') && !in_array('proc_open', $off, true);
    }

    /**
     * The account's crontab, or null when it cannot be read.
     * @return array{0:?string,1:string} [text, error]
     */
    public function read(): array
    {
        if (!$this->available()) {
            return [null, 'proc_open is disabled on this server'];
        }
        [$code, $out, $err] = $this->exec([$this->crontabBin(), '-l']);
        if ($code === 0) {
            return [$out, ''];
        }
        // "no crontab for user": nothing scheduled yet.
        return stripos($err, 'no crontab') !== false ? ['', ''] : [null, trim($err) ?: "crontab -l exited with {$code}"];
    }

    /**
     * What the crontab has for each job and what the scheduled check last did.
     * @return array{crontab:bool,error:string,jobs:array<string,array{label:string,line:string,installed:bool}>,replace:list<string>,others:list<string>,lastRun:int,lastBackup:int,log:list<string>}
     */
    public function status(): array
    {
        [$text, $error] = $this->read();
        $lines = $text === null ? [] : self::lines($text);
        $jobs = [];
        foreach ($this->jobs() as $key => $job) {
            $jobs[$key] = $job + ['installed' => in_array($job['line'], $lines, true)];
        }
        $wanted = array_column($jobs, 'line');
        $backups = glob($this->app->storage('backups/db') . '/database-*.sqlite') ?: [];
        rsort($backups, SORT_STRING);
        return [
            'crontab' => $text !== null,
            'error' => $error,
            'jobs' => $jobs,
            'replace' => array_values(array_filter($lines, fn ($l) => $this->isOurs($l) && !in_array($l, $wanted, true))),
            'others' => array_values(array_filter($lines, fn ($l) => !$this->isOurs($l) && self::runsConsole($l))),
            'lastRun' => (int) $this->app->settings()->get('monitor_last_run', '0'),
            'lastBackup' => $backups ? (int) filemtime($backups[0]) : 0,
            'log' => $this->logTail(5),
        ];
    }

    /**
     * Adds the two jobs (replacing older lines for this installation) and keeps
     * every other line as it was. A copy of the previous crontab is saved first.
     * @return array{changed:bool,added:list<string>,removed:list<string>,backup:?string,crontab:string}
     */
    public function install(?string $php = null, bool $dryRun = false): array
    {
        [$text, $error] = $this->read();
        if ($text === null) {
            throw new \RuntimeException('Cannot read the crontab: ' . $error);
        }
        $lines = self::lines($text);
        $wanted = array_column($this->jobs($php), 'line');
        $keep = [];
        $removed = [];
        foreach ($lines as $l) {
            if ($this->isOurs($l) && !in_array($l, $wanted, true)) {
                $removed[] = $l;
            } elseif (!in_array($l, $keep, true) || !in_array($l, $wanted, true)) {
                $keep[] = $l; // a wanted line listed twice is kept once
            }
        }
        $added = array_values(array_diff($wanted, $keep));
        $new = implode("\n", array_merge($keep, $added)) . "\n";
        $result = ['changed' => $added !== [] || $removed !== [] || count($keep) !== count($lines), 'added' => $added, 'removed' => $removed, 'backup' => null, 'crontab' => $new];
        if (!$result['changed'] || $dryRun) {
            return $result;
        }
        if (trim($text) !== '') {
            $result['backup'] = $this->app->storageDir('backups') . '/crontab-' . date('Ymd-His') . '.txt';
            file_put_contents($result['backup'], $text);
            @chmod($result['backup'], 0600);
        }
        $tmp = $this->app->storageDir('tmp') . '/crontab-' . bin2hex(random_bytes(4)) . '.txt';
        file_put_contents($tmp, $new);
        try {
            [$code, , $err] = $this->exec([$this->crontabBin(), $tmp]);
        } finally {
            @unlink($tmp);
        }
        if ($code !== 0) {
            throw new \RuntimeException('crontab refused the new jobs: ' . (trim($err) ?: "exit {$code}"));
        }
        [$check] = $this->read();
        $now = $check === null ? [] : self::lines($check);
        if ($check === null || array_diff($wanted, $now) !== [] || array_intersect($removed, $now) !== []) {
            throw new \RuntimeException('The crontab does not show the new jobs after saving' . ($result['backup'] ? '; the previous one is in ' . $result['backup'] : ''));
        }
        $this->app->logger()->info('cron_installed', ['added' => count($added), 'removed' => count($removed)]);
        return $result;
    }

    /** Keeps storage/logs/cron.log small (called by the scheduled check). */
    public function trimLog(): void
    {
        $file = $this->logFile();
        if (is_file($file) && filesize($file) > self::LOG_MAX) {
            $tail = (string) file_get_contents($file, false, null, -(self::LOG_MAX >> 2));
            file_put_contents($file, substr($tail, (int) strpos($tail, "\n") + 1), LOCK_EX);
        }
    }

    /** @return list<string> the newest lines that cron wrote to storage/logs/cron.log */
    public function logTail(int $n): array
    {
        $file = $this->logFile();
        if (!is_file($file) || filesize($file) === 0) {
            return [];
        }
        $lines = preg_split('/\R/', trim((string) file_get_contents($file, false, null, -min((int) filesize($file), 8192)))) ?: [];
        return array_slice($lines, -$n);
    }

    /** A job line for this installation's scheduled check or backup (ours or written by hand from the guide). */
    private function isOurs(string $line): bool
    {
        if (str_starts_with(ltrim($line), '#')) {
            return false;
        }
        if (str_contains($line, self::MARK)) {
            return true;
        }
        if (!self::runsConsole($line)) {
            return false;
        }
        $spellings = [];
        $home = rtrim((string) getenv('HOME'), '/');
        foreach (array_unique([$this->console(), $this->app->root('bin/console')]) as $console) {
            $spellings[] = $console;
            foreach (array_unique([$home, (string) realpath($home)]) as $h) {
                if ($h !== '' && str_starts_with($console, $h . '/')) {
                    $rel = substr($console, strlen($h) + 1);
                    array_push($spellings, '~/' . $rel, '$HOME/' . $rel, '${HOME}/' . $rel, '/home/USUARIO/' . $rel, '/home/USERNAME/' . $rel);
                }
            }
        }
        foreach ($spellings as $s) {
            if (str_contains($line, $s) || str_contains($line, "'{$s}'") || str_contains($line, "\"{$s}\"")) {
                return true;
            }
        }
        return false;
    }

    private static function runsConsole(string $line): bool
    {
        return !str_starts_with(ltrim($line), '#') && (bool) preg_match('~bin/console[\'"]?\s+(monitor|backup)\b~', $line);
    }

    /** @return list<string> every line, blank ones included (only trailing blank lines are dropped) */
    private static function lines(string $text): array
    {
        $text = rtrim($text);
        return $text === '' ? [] : (preg_split('/\R/', $text) ?: []);
    }

    private static function arg(string $s): string
    {
        if (str_contains($s, '%')) {
            throw new \RuntimeException("A path for cron cannot contain \"%\": {$s}");
        }
        return preg_match('~^[A-Za-z0-9_./+-]+$~', $s) ? $s : escapeshellarg($s);
    }

    private function crontabBin(): string
    {
        // Tests point this at a stand-in so they never touch the real crontab.
        return $this->app->config->get('CRONTAB_BIN') ?? 'crontab';
    }

    /**
     * @param list<string> $cmd
     * @return array{0:int,1:string,2:string} exit code, output, errors
     */
    private function exec(array $cmd): array
    {
        $proc = @proc_open($cmd, [0 => ['file', '/dev/null', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (!is_resource($proc)) {
            return [127, '', 'could not run ' . $cmd[0]];
        }
        $out = (string) stream_get_contents($pipes[1]);
        $err = (string) stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        return [proc_close($proc), $out, $err];
    }
}
