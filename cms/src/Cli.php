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
            'cron' => $this->cronStatus(),
            'cron:install' => $this->cronInstall($args),
            'automations' => $this->automations($args[0] ?? ''),
            'alert:test' => $this->alertTest(),
            'reports:retry' => $this->retryReports(),
            'backup' => $this->backup(),
            'integrity:accept' => $this->integrityAccept(),
            'demo-users' => $this->demoUsers($args),
            '2fa:reset' => $this->twoFactorReset($args[0] ?? '', in_array('--off', $args, true)),
            'roles' => $this->rolesReport(),
            'roles:rollback' => $this->rolesRollback(),
            default => $this->help(),
        };
    }

    private function out(string $s): void
    {
        fwrite(STDOUT, $s . PHP_EOL);
    }

    private function help(): int
    {
        $this->out('Usage: php cms/bin/console <check|migrate|create-admin|publish|render <dir>|mail:test <email>|translate:test|monitor|cron|cron:install [--dry-run] [--php=<path>]|automations|alert:test|reports:retry|backup|integrity:accept|demo-users [--reports]|2fa:reset <email> [--off]|roles|roles:rollback>');
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
        $this->out("Account created (id {$id}).");
        $owner = $this->app->config->ownerEmail();
        $this->out(strtolower(trim($email)) === $owner
            ? 'This is the owner account: it manages every user and sees Monitoring and the monthly site report.'
            : "Note: this is NOT the owner account ({$owner}, OWNER_EMAIL). It can manage users with the same or less access; only the owner sees Monitoring and sends the site report.");
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
        // One run at a time: a slow run (or a second cron line) never overlaps the next.
        $lock = fopen($this->app->storage('monitor.lock'), 'c');
        if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
            $this->out('The scheduled check is already running; this run was skipped.');
            return 0;
        }
        try {
            foreach ($this->app->monitor()->run() as $line) {
                $this->out($line);
            }
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
        return 0;
    }

    /**
     * Scheduled tasks: whether the account's crontab has the scheduled check and
     * the daily backup, when they last ran, and errors cron wrote. Exit code 1
     * when something needs attention (`cron:install` fixes the crontab).
     */
    private function cronStatus(): int
    {
        $sch = new Scheduler($this->app);
        $st = $sch->status();
        $fix = 'php ' . $sch->console() . ' cron:install';
        $this->out('Scheduled tasks (cron) for ' . dirname($sch->console(), 2));
        $this->out('  PHP for cron: ' . $sch->php() . ' (PHP ' . PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION . ')');
        $ok = true;
        if (!$st['crontab']) {
            $ok = false;
            $this->out('  [WARN] The crontab cannot be read here (' . $st['error'] . '). Add these lines in cPanel → Cron Jobs:');
            foreach ($st['jobs'] as $job) {
                $this->out('         ' . $job['line']);
            }
        } else {
            foreach ($st['jobs'] as $job) {
                $ok = $ok && $job['installed'];
                $this->out(sprintf('  [%s] %s', $job['installed'] ? ' OK ' : 'MISS', $job['label']));
            }
            foreach ($st['replace'] as $l) {
                $ok = false;
                $this->out('  [OLD ] ' . $l);
            }
            foreach ($st['others'] as $l) {
                $this->out('  [NOTE] Another line runs the Content Manager (another installation?): ' . $l);
            }
        }
        $age = time() - $st['lastRun'];
        $running = $st['lastRun'] > 0 && $age < 2 * 3600;
        $ok = $ok && $running;
        $this->out('  Last scheduled check: ' . ($st['lastRun'] ? date('Y-m-d H:i', $st['lastRun']) . ' (' . self::ago($age) . ')' : 'never') . ($running ? '' : ' — NOT RUNNING'));
        $this->out('  Newest database backup: ' . ($st['lastBackup'] ? date('Y-m-d H:i', $st['lastBackup']) . ' (' . self::ago(time() - $st['lastBackup']) . ')' : 'none'));
        if ($st['log']) {
            $this->out('  Last errors written by cron (' . $sch->logFile() . '):');
            foreach ($st['log'] as $l) {
                $this->out('    ' . $l);
            }
        }
        $missing = in_array(false, array_column($st['jobs'], 'installed'), true) || $st['replace'];
        if (!$st['crontab']) {
            $this->out('After adding them, the first check runs within 15 minutes.');
        } elseif ($missing) {
            $this->out("To install or repair: {$fix}");
        } elseif (!$running) {
            $this->out('The jobs are installed. If the check still has not run 15 minutes after installing them, run it once by hand to see the error: php ' . $sch->console() . ' monitor');
        }
        return $ok ? 0 : 1;
    }

    /**
     * Adds (or repairs) the scheduled check every 15 minutes and the daily backup
     * in the account's crontab — the same jobs cPanel → Cron Jobs shows. Other
     * lines are kept; the previous crontab is saved in storage/backups first.
     */
    private function cronInstall(array $args): int
    {
        $php = null;
        foreach ($args as $a) {
            if (str_starts_with($a, '--php=')) {
                $php = substr($a, 6);
                if (!is_file($php) || !is_executable($php)) {
                    $this->out("Not an executable file: {$php}");
                    return 1;
                }
            }
        }
        $dry = in_array('--dry-run', $args, true);
        $sch = new Scheduler($this->app);
        try {
            $r = $sch->install($php, $dry);
        } catch (\RuntimeException $e) {
            $this->out($e->getMessage());
            $this->out('Add these lines by hand in cPanel → Cron Jobs (Advanced / custom schedule):');
            foreach ($sch->jobs($php) as $job) {
                $this->out('  ' . $job['line']);
            }
            return 1;
        }
        if (!$r['changed']) {
            $this->out('The scheduled tasks are already installed; nothing changed.');
            return 0;
        }
        if ($r['backup']) {
            $this->out('Saved a copy of the previous crontab: ' . $r['backup']);
        }
        foreach ($r['removed'] as $l) {
            $this->out(($dry ? 'Would remove: ' : 'Removed: ') . $l);
        }
        foreach ($r['added'] as $l) {
            $this->out(($dry ? 'Would add:    ' : 'Added:   ') . $l);
        }
        if ($dry) {
            $this->out('Dry run: nothing was changed.');
            return 0;
        }
        $this->out('Done. The scheduled check runs every 15 minutes; check it with: php ' . $sch->console() . ' cron');
        return 0;
    }

    private static function ago(int $s): string
    {
        return match (true) {
            $s < 120 => 'just now',
            $s < 7200 => intdiv($s, 60) . ' minutes ago',
            $s < 172800 => intdiv($s, 3600) . ' hours ago',
            default => intdiv($s, 86400) . ' days ago',
        };
    }

    /**
     * Runs only the automations (reminders, temporary access, inactivity, lead
     * follow-up and summary); `monitor` already runs them. An optional Unix time
     * runs them as of that moment (to check the Monday summary, for example).
     */
    private function automations(string $at): int
    {
        foreach ($this->app->automations()->run(preg_match('/^\d{9,11}$/', $at) ? (int) $at : null) as $line) {
            $this->out($line);
        }
        return 0;
    }

    /**
     * After changing public files on purpose (e.g. uploading a new version by
     * hand), records them as the expected state so the integrity alert stops.
     */
    private function integrityAccept(): int
    {
        $wd = $this->app->watchdog();
        foreach ($wd->integrityFindings() as $f) {
            $this->out("  {$f['type']}: {$f['path']}");
        }
        $this->out('Accepted the current public files as expected (' . $wd->acceptIntegrity() . ' files).');
        return 0;
    }

    /**
     * Removes an account's registered devices from the server (e.g. the owner
     * lost the phone and the recovery codes): the next sign-in confirms a code
     * sent to its e-mail and registers the new device. `--off` only turns
     * two-step sign-in off (for when e-mail is not working); the person sets it
     * up again at the next sign-in when the policy requires it.
     */
    private function twoFactorReset(string $email, bool $off = false): int
    {
        $user = $this->app->db()->one('SELECT * FROM users WHERE lower(email) = ?', [strtolower(trim($email))]);
        if (!$user) {
            fwrite(STDERR, "No account with that e-mail.\n");
            return 1;
        }
        if ($off) {
            $this->app->twoFactor()->disable((int) $user['id']);
            $this->app->db()->run('UPDATE users SET two_factor_reenroll_at = NULL WHERE id = ?', [$user['id']]);
        } else {
            $this->app->twoFactor()->removeDevices((int) $user['id']);
        }
        $this->app->auth()->revokeSessions((int) $user['id']);
        $this->app->activity(null, 'two_factor_reset', (string) $user['id'], ['by' => 'console'] + ($off ? ['off' => true] : []));
        if (!$off) {
            $this->app->watchdog()->twoFactorNotice($user, 'reset');
        }
        $this->out($off
            ? 'Two-step sign-in turned off for ' . $user['email'] . '; their sessions were ended.'
            : 'Registered devices removed for ' . $user['email'] . '; their sessions were ended. Next sign-in: password, a code sent to that e-mail, then the new device.');
        return 0;
    }

    /** What migration 017_roles changed: each account moved onto a role (before → after). */
    private function rolesReport(): int
    {
        $rows = $this->rolesMigrated();
        if ($rows === null) {
            return 1;
        }
        if (!$rows) {
            $this->out('017_roles changed no account: every account already had a complete role.');
            return 0;
        }
        foreach ($rows as $r) {
            $now = (string) $r['permissions'];
            $this->out(sprintf('%s  [%s]  %s  →  %s%s', $r['email'], $r['role'], $r['before'], $r['after'],
                $now === $r['after'] ? '' : '  (changed since: ' . ($now === '' ? 'account deleted' : $now) . ')'));
        }
        $this->out(count($rows) . ' account(s). Undo with: php bin/console roles:rollback');
        return 0;
    }

    /**
     * Gives the accounts moved by 017_roles their previous access back — only those
     * nobody changed since (a correction made by hand is kept). The program itself
     * goes back with the previous package (guide, step 23).
     */
    private function rolesRollback(): int
    {
        $rows = $this->rolesMigrated();
        if ($rows === null) {
            return 1;
        }
        $done = 0;
        foreach ($rows as $r) {
            if ((string) $r['permissions'] !== $r['after']) {
                $this->out('Kept (changed since the upgrade): ' . $r['email']);
                continue;
            }
            $this->app->db()->run('UPDATE users SET permissions = ?, updated_at = ? WHERE id = ? AND permissions = ?', [$r['before'], time(), $r['user_id'], $r['after']]);
            $this->app->activity(null, 'user_updated', (string) $r['user_id'], ['by' => 'console', 'rollback' => '017_roles']);
            $done++;
        }
        $this->out("Previous access restored for $done account(s).");
        return 0;
    }

    /** @return list<array<string,mixed>>|null */
    private function rolesMigrated(): ?array
    {
        try {
            return $this->app->db()->all('SELECT m.*, u.permissions FROM roles_migration_017 m LEFT JOIN users u ON u.id = m.user_id ORDER BY m.email');
        } catch (\Throwable) {
            fwrite(STDERR, "Migration 017_roles has not run here yet (php bin/console migrate).\n");
            return null;
        }
    }

    /** Demo accounts, one per role plus an extra section and a disabled one (development only). id => [name, permissions, status, label] */
    private const DEMO_USERS = [
        'demo.completo' => ['Demo Administrador', ['texts', 'contact', 'photos', 'documents', 'site', 'leads', 'stats', 'monitor', 'report', 'users'], 'active', 'Administrador (incluye gestión de usuarios)'],
        'demo.editor' => ['Demo Editor del Sitio Web', ['texts', 'contact', 'photos', 'documents'], 'active', 'Editor del sitio web'],
        'demo.ventas' => ['Demo Ventas y Prospectos', ['leads', 'stats'], 'active', 'Ventas y prospectos'],
        'demo.consulta' => ['Demo Consulta', ['stats', 'monitor', 'report'], 'active', 'Consulta (solo lectura)'],
        'demo.adicional' => ['Demo Editor con Prospectos', ['texts', 'contact', 'photos', 'documents', 'leads'], 'active', 'Editor del sitio web + Prospectos (sección adicional)'],
        'demo.soporte' => ['Demo Soporte Técnico', ['stats', 'monitor', 'report', 'support'], 'active', 'Consulta + Gestión de solicitudes de soporte (sección adicional)'],
        'demo.desactivado' => ['Demo Cuenta Desactivada', ['texts', 'contact', 'photos', 'documents'], 'disabled', 'Desactivada (no puede entrar)'],
    ];

    /**
     * Creates (or resets) demo accounts for trying every access profile, with
     * fresh random passwords written to storage/LOCAL-TEST-USERS.txt (0600,
     * git-ignored, denied from the web). `--reports` also adds sample support
     * tickets in different states. Refuses to run in production.
     */
    private function demoUsers(array $args): int
    {
        if ($this->app->config->isProduction()) {
            fwrite(STDERR, "Refused: demo accounts are for local development only (APP_ENV=development).\n");
            return 1;
        }
        $db = $this->app->db();
        $now = time();
        $rows = [];
        foreach (self::DEMO_USERS as $local => [$name, $perms, $status, $label]) {
            $email = $local . '@example.test';
            $password = 'Demo-' . bin2hex(random_bytes(4)) . '-' . bin2hex(random_bytes(2));
            $id = $db->value('SELECT id FROM users WHERE email = ?', [$email]);
            if ($id) {
                $db->run('UPDATE users SET name = ?, role = ?, status = ?, permissions = ?, password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?',
                    [$name, 'editor', $status, implode(',', array_intersect(Users::PERMISSIONS, $perms)), Passwords::hash($password), $now, $now, $id]);
                $db->run('DELETE FROM sessions WHERE user_id = ?', [$id]);
            } else {
                $id = $db->insert(
                    "INSERT INTO users (email, name, role, status, password_hash, lang, theme, created_at, updated_at, password_changed_at, permissions)
                     VALUES (?, ?, 'editor', ?, ?, 'es', 'system', ?, ?, ?, ?)",
                    [$email, $name, $status, Passwords::hash($password), $now, $now, $now, implode(',', array_intersect(Users::PERMISSIONS, $perms))]
                );
            }
            $rows[] = [$label, $email, $password, $status];
        }
        $file = $this->app->storage('LOCAL-TEST-USERS.txt');
        $text = "DEMO ACCOUNTS — Sensum Content Manager (local development only)\n"
            . 'Created: ' . date('Y-m-d H:i') . ' with `php cms/bin/console demo-users`' . "\n"
            . 'Panel: ' . $this->app->config->adminUrl() . "/\n\n"
            . "Owner (IT): see LOCAL-TEST-ADMIN.txt (" . $this->app->config->ownerEmail() . ")\n\n";
        foreach ($rows as [$label, $email, $password]) {
            $text .= str_pad($label, 62) . str_pad($email, 36) . $password . "\n";
        }
        $text .= "\nRun the command again to reset every password. Delete these accounts before going live\n"
            . "(they only exist in this local database: cms/storage/database.sqlite).\n";
        file_put_contents($file, $text);
        @chmod($file, 0600);
        $this->out('Demo accounts ready (' . count($rows) . '). E-mails and passwords: ' . $file);

        if (in_array('--reports', $args, true)) {
            $this->out('Sample tickets: ' . $this->demoReports());
        }
        return 0;
    }

    /** A few support tickets in different states, from the demo accounts (no e-mails are sent). */
    private function demoReports(): int
    {
        $db = $this->app->db();
        if ($db->value("SELECT COUNT(*) FROM support_reports WHERE fingerprint LIKE 'demo-%'")) {
            return 0;
        }
        $uid = fn (string $local) => (int) $db->value('SELECT id FROM users WHERE email = ?', [$local . '@example.test']);
        $owner = $db->one('SELECT id, name FROM users WHERE lower(email) = ?', [$this->app->config->ownerEmail()]);
        $ownerId = $owner ? (int) $owner['id'] : null;
        $ownerName = $owner['name'] ?? 'Soporte IT';
        $now = time();
        $samples = [
            ['demo.adicional', 'problem', 'admin', 'No puedo guardar las Preguntas frecuentes', "Cuando cambio la respuesta 3 y presiono «Guardar cambios», aparece un mensaje de error.\nLo intenté dos veces.", '/admin/#/textos/faq', 'new', 'high', 2 * 3600, []],
            ['demo.ventas', 'design', 'website', 'La foto del proyecto 2 se ve recortada en el celular', 'En el celular la foto de la tarjeta corta la parte de arriba de la casa.', '/#proyectos', 'waiting', 'normal', 26 * 3600, [
                ['support', 'message', '¿Puedes decirnos qué modelo de celular usas y enviar una captura de cómo se ve?'],
            ]],
            ['demo.editor', 'improvement', 'website', 'Agregar una sección de testimonios', 'Sería bueno mostrar comentarios de clientes satisfechos en la página principal.', '/', 'in_progress', 'low', 3 * 86400, [
                ['support', 'message', 'Buena idea. Lo estamos evaluando con diseño y te contamos la próxima semana.'],
                ['support', 'note', 'Estimar 4 horas: nueva sección + campos en el panel.'],
            ]],
            ['demo.consulta', 'content', 'website', 'Cambiar el número de WhatsApp', 'El número de WhatsApp del sitio cambió, el nuevo es +502 5555 0000.', '/admin/#/contacto', 'resolved', 'normal', 6 * 86400, [
                ['support', 'message', 'Listo, ya puedes cambiarlo tú mismo en «Datos de contacto». Te dejamos el número actualizado.'],
            ]],
        ];
        $n = 0;
        foreach ($samples as [$local, $type, $area, $title, $desc, $page, $status, $prio, $age, $thread]) {
            $user = $db->one('SELECT id, name, email FROM users WHERE id = ?', [$uid($local)]);
            if (!$user) {
                continue;
            }
            $created = $now - $age;
            $id = $db->insert(
                "INSERT INTO support_reports (user_id, reporter_name, reporter_email, type, title, description, area, page, context, fingerprint, email_status, email_attempts, sent_at, created_at, updated_at, status, priority, owner_unread, reporter_unread, resolved_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', 1, ?, ?, ?, ?, ?, ?, ?, ?)",
                [$user['id'], $user['name'], $user['email'], $type, $title, $desc, $area, $page,
                    json_encode(['browser' => 'Chrome 129', 'os' => 'Windows', 'device' => 'desktop', 'lang' => 'es']), 'demo-' . bin2hex(random_bytes(6)),
                    $created, $created, $created + 3600, $status, $prio, $status === 'new' ? 1 : 0, $thread ? 1 : 0, $status === 'resolved' ? $created + 3600 : null]
            );
            $from = 'new';
            foreach ($thread as $i => [$role, $kind, $body]) {
                $at = $created + 1800 + $i * 60;
                if ($i === 0) { // samples with a conversation are never "new"
                    $db->run("INSERT INTO report_messages (report_id, user_id, author_name, author_role, kind, body, details, created_at) VALUES (?, ?, ?, 'support', 'event', '', ?, ?)",
                        [$id, $ownerId, $ownerName, json_encode(['action' => 'status', 'from' => $from, 'to' => $status]), $at - 30]);
                }
                $db->run('INSERT INTO report_messages (report_id, user_id, author_name, author_role, kind, body, details, email_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [$id, $ownerId, $ownerName, $role, $kind, $body, '{}', $kind === 'message' ? 'sent' : null, $at]);
            }
            $n++;
        }
        return $n;
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
            fwrite(STDERR, "Automatic translation is off: add the DeepL key in the panel (Administración → Traducción) or DEEPL_API_KEY in .env, and keep it switched on.\n");
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
        $this->app->maintenanceLog()->add('backups');
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
