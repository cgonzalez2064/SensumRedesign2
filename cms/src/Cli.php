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
            'integrity:accept' => $this->integrityAccept(),
            'demo-users' => $this->demoUsers($args),
            default => $this->help(),
        };
    }

    private function out(string $s): void
    {
        fwrite(STDOUT, $s . PHP_EOL);
    }

    private function help(): int
    {
        $this->out('Usage: php cms/bin/console <check|migrate|create-admin|publish|render <dir>|mail:test <email>|translate:test|monitor|alert:test|reports:retry|backup|integrity:accept|demo-users [--reports]>');
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
            ? 'This is the owner account: it manages users and sees Monitoring and the monthly site report.'
            : "Note: this is NOT the owner account ({$owner}, OWNER_EMAIL). Only the owner can manage users, see Monitoring and send the site report.");
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

    /** Demo accounts, one per access profile (development only). id => [name, permissions, status] */
    private const DEMO_USERS = [
        'demo.completo' => ['Demo Acceso Completo', ['texts', 'contact', 'photos', 'documents', 'site'], 'active', 'Acceso completo al contenido'],
        'demo.editor' => ['Demo Editor de Contenido', ['texts', 'contact', 'photos', 'documents'], 'active', 'Editor de contenido'],
        'demo.textos' => ['Demo Solo Textos', ['texts'], 'active', 'Solo textos'],
        'demo.fotos' => ['Demo Solo Fotos', ['photos', 'documents'], 'active', 'Solo fotos y portafolio'],
        'demo.contacto' => ['Demo Solo Contacto', ['contact'], 'active', 'Solo datos de contacto y formulario'],
        'demo.personalizado' => ['Demo Personalizado', ['texts', 'photos'], 'active', 'Personalizado: textos + fotos'],
        'demo.desactivado' => ['Demo Cuenta Desactivada', ['texts'], 'disabled', 'Desactivada (no puede entrar)'],
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
                    [$name, 'editor', $status, implode(',', $perms), Passwords::hash($password), $now, $now, $id]);
                $db->run('DELETE FROM sessions WHERE user_id = ?', [$id]);
            } else {
                $id = $db->insert(
                    "INSERT INTO users (email, name, role, status, password_hash, lang, theme, created_at, updated_at, password_changed_at, permissions)
                     VALUES (?, ?, 'editor', ?, ?, 'es', 'system', ?, ?, ?, ?)",
                    [$email, $name, $status, Passwords::hash($password), $now, $now, $now, implode(',', $perms)]
                );
            }
            $rows[] = [$label, $email, $password, $status];
        }
        $file = $this->app->storage('LOCAL-TEST-USERS.txt');
        $text = "DEMO ACCOUNTS — Sensum Content Manager (local development only)\n"
            . 'Created: ' . date('Y-m-d H:i') . ' with `php cms/bin/console demo-users`' . "\n"
            . 'Panel: ' . $this->app->config->appUrl() . "/admin/\n\n"
            . "Owner (IT): see LOCAL-TEST-ADMIN.txt (" . $this->app->config->ownerEmail() . ")\n\n";
        foreach ($rows as [$label, $email, $password]) {
            $text .= str_pad($label, 38) . str_pad($email, 36) . $password . "\n";
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
            ['demo.textos', 'problem', 'admin', 'No puedo guardar las Preguntas frecuentes', "Cuando cambio la respuesta 3 y presiono «Guardar cambios», aparece un mensaje de error.\nLo intenté dos veces.", '/admin/#/textos/faq', 'new', 'high', 2 * 3600, []],
            ['demo.fotos', 'design', 'website', 'La foto del proyecto 2 se ve recortada en el celular', 'En el celular la foto de la tarjeta corta la parte de arriba de la casa.', '/#proyectos', 'waiting', 'normal', 26 * 3600, [
                ['support', 'message', '¿Puedes decirnos qué modelo de celular usas y enviar una captura de cómo se ve?'],
            ]],
            ['demo.editor', 'improvement', 'website', 'Agregar una sección de testimonios', 'Sería bueno mostrar comentarios de clientes satisfechos en la página principal.', '/', 'in_progress', 'low', 3 * 86400, [
                ['support', 'message', 'Buena idea. Lo estamos evaluando con diseño y te contamos la próxima semana.'],
                ['support', 'note', 'Estimar 4 horas: nueva sección + campos en el panel.'],
            ]],
            ['demo.contacto', 'content', 'website', 'Cambiar el número de WhatsApp', 'El número de WhatsApp del sitio cambió, el nuevo es +502 5555 0000.', '/admin/#/contacto', 'resolved', 'normal', 6 * 86400, [
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
