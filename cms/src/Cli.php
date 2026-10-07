<?php
declare(strict_types=1);

namespace Sensum\Cms;

use Sensum\Cms\Http\ApiError;

/** Command-line tasks for setup, maintenance and support. */
final class Cli
{
    private bool $tty;

    public function __construct(private App $app)
    {
        // Checked once, before any input is read (a later check on a piped
        // STDIN makes PHP warn about its read buffer).
        $this->tty = @stream_isatty(STDIN);
    }

    public function run(string $cmd, array $args): int
    {
        return match ($cmd) {
            'check' => $this->check(),
            'migrate' => $this->migrate(),
            'create-admin' => $this->createAdmin($args),
            'publish' => $this->publish(),
            'render' => $this->render($args[0] ?? ''),
            'mail:test' => $this->mailTest($args[0] ?? ''),
            'translate:test' => $this->translateTest(),
            'monitor' => $this->monitor(),
            'alert:test' => $this->alertTest(),
            'reports:retry' => $this->retryReports(),
            'backup' => $this->backup(),
            default => $this->help(),
        };
    }

    private function out(string $s): void
    {
        fwrite(STDOUT, $s . PHP_EOL);
    }

    private function help(): int
    {
        $this->out('Usage: php cms/bin/console <check|migrate|create-admin|publish|render <dir>|mail:test <email>|translate:test|monitor|alert:test|reports:retry|backup>');
        return 0;
    }

    private function check(): int
    {
        $ok = true;
        foreach (Health::checks($this->app, true) as $name => $c) {
            $this->out(sprintf('[%s] %-22s %s', $c['ok'] ? ' OK ' : (empty($c['optional']) ? 'FAIL' : 'WARN'), $name, $c['detail'] ?? ''));
            $ok = $ok && ($c['ok'] || !empty($c['optional']));
        }
        return $ok ? 0 : 1;
    }

    private function migrate(): int
    {
        // Opening the database applies pending migrations automatically.
        $db = $this->app->db();
        $ran = array_merge($this->app->migratedOnOpen(), $db->migrate($this->app->root('migrations')));
        $this->out($ran ? 'Applied: ' . implode(', ', $ran) : 'Database is up to date.');
        return 0;
    }

    private function prompt(string $label, bool $hidden = false): string
    {
        fwrite(STDOUT, $label);
        $tty = $this->tty;
        if ($hidden && $tty) {
            @shell_exec('stty -echo');
        }
        $line = fgets(STDIN);
        if ($hidden && $tty) {
            @shell_exec('stty echo');
            fwrite(STDOUT, PHP_EOL);
        }
        return trim((string) $line);
    }

    /**
     * Creates an administrator. Values may be passed as --name=… --email=…;
     * the password is always read from the terminal (or stdin), never argv.
     */
    private function createAdmin(array $args): int
    {
        $opts = [];
        foreach ($args as $a) {
            if (preg_match('/^--(name|email|lang)=(.*)$/s', $a, $m)) {
                $opts[$m[1]] = $m[2];
            }
        }
        $name = $opts['name'] ?? $this->prompt('Nombre / Name: ');
        $email = $opts['email'] ?? $this->prompt('Correo / Email: ');
        $password = $this->prompt('Contraseña / Password (min. ' . Passwords::MIN_LENGTH . '): ', true);
        $confirm = $this->prompt('Confirmar / Confirm: ', true);
        if (!hash_equals($password, $confirm)) {
            fwrite(STDERR, "Passwords do not match.\n");
            return 1;
        }
        try {
            $id = (new Users($this->app))->createActive($name, $email, $password, 'admin', ($opts['lang'] ?? 'es'));
        } catch (ApiError $e) {
            fwrite(STDERR, 'Not created: ' . json_encode($e->fields ?: $e->errorCode) . PHP_EOL);
            return 1;
        }
        $this->app->activity($id, 'user_created_cli', (string) $id);
        $this->out("Administrator created (id {$id}).");
        return 0;
    }

    private function publish(): int
    {
        $r = $this->app->publisher()->publish(null, 'cli');
        $this->out('Published. Changed: ' . ($r['changed'] ? implode(', ', $r['changed']) : 'nothing') . ($r['drift'] ? ' | replaced external edits in: ' . implode(', ', $r['drift']) : ''));
        return 0;
    }

    private function render(string $dir): int
    {
        if ($dir === '') {
            fwrite(STDERR, "Usage: render <dir>\n");
            return 1;
        }
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        foreach ($this->app->publisher()->render() as $name => $html) {
            file_put_contents(rtrim($dir, '/') . '/' . $name, $html);
        }
        $this->out("Rendered to {$dir}");
        return 0;
    }

    private function mailTest(string $to): int
    {
        if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
            fwrite(STDERR, "Usage: mail:test <email>\n");
            return 1;
        }
        $ok = $this->app->mailer()->send([
            'to' => $to,
            'subject' => '[Sensum Website] Prueba de correo / Test e-mail',
            'text' => "Este es un correo de prueba del Administrador de contenido.\nThis is a test e-mail from the Content Manager.\n\n" . date('c'),
        ]);
        $this->out($ok ? 'Sent (driver: ' . $this->app->mailer()->driver() . ').' : 'FAILED — see storage/logs for the error category.');
        return $ok ? 0 : 1;
    }

    /**
     * Scheduled check — run it from cron (e.g. every 15 minutes): health checks
     * (critical failures are e-mailed), disk space, published pages vs saved
     * content, pending support reports, alerts that failed to send, log cleanup.
     */
    private function monitor(): int
    {
        foreach ($this->app->monitor()->run() as $line) {
            $this->out($line);
        }
        return 0;
    }

    private function alertTest(): int
    {
        $alerts = $this->app->alerts();
        if (!$alerts->enabled()) {
            fwrite(STDERR, "Alerts are off: check ALERTS_ENABLED and ALERT_EMAIL in .env.\n");
            return 1;
        }
        $ok = $alerts->sendTest('bin/console alert:test');
        $this->out($ok ? 'Test alert sent to ' . $alerts->recipient() . '.' : 'FAILED — see storage/logs for the error category.');
        return $ok ? 0 : 1;
    }

    /** Checks the DeepL key: one short translation each way plus this period's usage. */
    private function translateTest(): int
    {
        $tr = $this->app->translator();
        if (!$tr->isEnabled()) {
            fwrite(STDERR, "Automatic translation is off: set DEEPL_API_KEY in .env.\n");
            return 1;
        }
        try {
            [$en] = $tr->translate([['text' => 'Construimos con *precisión*', 'emphasis' => true]], 'es', 'en');
            [$es] = $tr->translate([['text' => 'Your project, on time', 'emphasis' => false]], 'en', 'es');
            $usage = $tr->usage();
        } catch (TranslationError $e) {
            fwrite(STDERR, 'FAILED: ' . $e->getMessage() . " — see storage/logs for the reason.\n");
            return 1;
        }
        $this->out($tr->plan() . ' is working.');
        $this->out("  ES → EN: Construimos con *precisión*  →  {$en}");
        $this->out("  EN → ES: Your project, on time  →  {$es}");
        $this->out(sprintf('  Used this period: %s of %s characters', number_format($usage['used']), $usage['limit'] ? number_format($usage['limit']) : 'unlimited'));
        return 0;
    }

    /**
     * Consistent copy of the database (SQLite VACUUM INTO — safe while the
     * site is in use) into storage/backups/db/. Keeps the newest 14 copies.
     */
    private function backup(): int
    {
        $dir = $this->app->storageDir('backups/db');
        $file = $dir . '/database-' . date('Ymd-His') . '.sqlite';
        $this->app->db()->run('VACUUM INTO ?', [$file]);
        @chmod($file, 0600);
        $all = glob($dir . '/database-*.sqlite') ?: [];
        rsort($all, SORT_STRING);
        foreach (array_slice($all, 14) as $old) {
            @unlink($old);
        }
        $this->out('Backup written: ' . $file . ' (' . round((int) filesize($file) / 1024) . ' KB)');
        return 0;
    }

    private function retryReports(): int
    {
        $reports = new Reports($this->app);
        $n = 0;
        foreach ($this->app->db()->all("SELECT id FROM support_reports WHERE email_status <> 'sent' ORDER BY id") as $r) {
            $n += $reports->deliver((int) $r['id']) ? 1 : 0;
        }
        $this->out("Delivered {$n} pending report(s).");
        return 0;
    }
}
