<?php
declare(strict_types=1);

namespace Sensum\Cms;

use Sensum\Cms\Http\ApiError;

/**
 * Encrypted copies of the site kept OFF the server: if the hosting account is
 * lost or compromised, the content, users, tickets and messages can be restored.
 *
 * A ZIP protected with AES-256 (opens with 7-Zip on Windows and Keka or The
 * Unarchiver on Mac, using the backup password) containing a consistent copy
 * of the database, the published photos and documents when they fit, and
 * restore instructions. It is e-mailed on a schedule (daily, weekly or
 * monthly) to an address the owner chooses, and the owner can download one
 * at any time. The password is set by the owner in the panel and stored
 * encrypted; it is never sent by e-mail.
 */
final class OffsiteBackup
{
    private const KEY = 'offsite_backup';
    public const FREQUENCIES = ['daily' => 86400, 'weekly' => 7 * 86400, 'monthly' => 30 * 86400];
    private const MAX_EMAIL_BYTES = 20 * 1048576;

    public function __construct(private App $app)
    {
    }

    public static function supported(): bool
    {
        return class_exists(\ZipArchive::class) && defined('ZipArchive::EM_AES_256') && \ZipArchive::isEncryptionMethodSupported(\ZipArchive::EM_AES_256);
    }

    public function settings(): array
    {
        $s = $this->app->settings()->getJson(self::KEY);
        return [
            'enabled' => (bool) ($s['enabled'] ?? false),
            'frequency' => isset(self::FREQUENCIES[$s['frequency'] ?? '']) ? $s['frequency'] : 'weekly',
            'email' => (string) ($s['email'] ?? ''),
            'includePhotos' => (bool) ($s['includePhotos'] ?? true),
            'passwordSet' => !empty($s['passwordEnc']),
            'lastSentAt' => isset($s['lastSentAt']) ? (int) $s['lastSentAt'] : null,
            'lastStatus' => $s['lastStatus'] ?? null,
            'lastBytes' => isset($s['lastBytes']) ? (int) $s['lastBytes'] : null,
            'lastPhotos' => $s['lastPhotos'] ?? null,
            'lastAttemptAt' => isset($s['lastAttemptAt']) ? (int) $s['lastAttemptAt'] : null,
            'supported' => self::supported(),
        ];
    }

    /** Validates and stores the owner's choices. An empty password keeps the saved one. */
    public function save(array $in): array
    {
        $old = $this->app->settings()->getJson(self::KEY);
        $errors = [];
        $enabled = ($in['enabled'] ?? false) === true;
        $frequency = (string) ($in['frequency'] ?? 'weekly');
        if (!isset(self::FREQUENCIES[$frequency])) {
            $errors['frequency'] = 'invalid';
        }
        $email = strtolower(trim((string) ($in['email'] ?? '')));
        if ($email !== '' && (strlen($email) > 120 || !filter_var($email, FILTER_VALIDATE_EMAIL) || preg_match('/[^\x21-\x7E]/', $email))) {
            $errors['email'] = 'invalid_email';
        }
        if ($enabled && $email === '') {
            $errors['email'] = 'required';
        }
        $password = (string) ($in['password'] ?? '');
        if ($password !== '' && (mb_strlen($password) < 12 || mb_strlen($password) > 128 || preg_match('/[\x00-\x1F\x7F]/', $password))) {
            $errors['password'] = 'password_too_short';
        }
        if ($enabled && $password === '' && empty($old['passwordEnc'])) {
            $errors['password'] = 'required';
        }
        if ($enabled && !self::supported()) {
            throw new ApiError(409, 'backup_unsupported');
        }
        if ($errors) {
            throw ApiError::validation($errors);
        }
        $new = array_merge($old, [
            'enabled' => $enabled,
            'frequency' => $frequency,
            'email' => $email,
            'includePhotos' => ($in['includePhotos'] ?? true) === true,
        ]);
        if ($password !== '') {
            $new['passwordEnc'] = $this->app->secrets()->encrypt($password, 'offsite-backup');
        }
        $this->app->settings()->setJson(self::KEY, $new);
        return $this->settings();
    }

    private function password(): ?string
    {
        $enc = $this->app->settings()->getJson(self::KEY)['passwordEnc'] ?? '';
        return is_string($enc) && $enc !== '' ? $this->app->secrets()->decrypt($enc, 'offsite-backup') : null;
    }

    /**
     * Builds the encrypted ZIP in private storage.
     * @return array{path:string,bytes:int,photos:string} photos: included | omitted | none
     */
    public function build(bool $includePhotos, ?int $maxBytes = null): array
    {
        if (!self::supported()) {
            throw new ApiError(409, 'backup_unsupported');
        }
        $password = $this->password();
        if ($password === null || $password === '') {
            throw new ApiError(409, 'backup_password_missing');
        }
        $dir = $this->app->storageDir('tmp');
        foreach (glob($dir . '/offsite-*') ?: [] as $old) {
            if (filemtime($old) < time() - 3600) {
                @unlink($old);
            }
        }
        $stamp = date('Ymd-His');
        $db = $dir . '/offsite-' . $stamp . '-' . bin2hex(random_bytes(4)) . '.sqlite';
        $this->app->db()->run('VACUUM INTO ?', [$db]);
        $photos = 'none';
        $uploads = [];
        $uploadsDir = $this->app->publicPath('assets/uploads');
        $uploadBytes = 0;
        foreach (glob($uploadsDir . '/*') ?: [] as $f) {
            if (is_file($f) && preg_match('/^[a-z0-9-]+(-w\d+)?\.(webp|jpg|pdf)$/', basename($f))) {
                $uploads[] = $f;
                $uploadBytes += (int) filesize($f);
            }
        }
        if ($includePhotos && $uploads) {
            $photos = $maxBytes !== null && $uploadBytes + (int) filesize($db) > $maxBytes ? 'omitted' : 'included';
        }
        $zipPath = $dir . '/offsite-' . $stamp . '-' . bin2hex(random_bytes(4)) . '.zip';
        $zip = new \ZipArchive();
        if ($zip->open($zipPath, \ZipArchive::CREATE | \ZipArchive::EXCL) !== true) {
            @unlink($db);
            throw new \RuntimeException('backup_zip_failed');
        }
        $zip->setPassword($password);
        $add = function (string $path, string $name) use ($zip): void {
            $zip->addFile($path, $name);
            $zip->setEncryptionName($name, \ZipArchive::EM_AES_256);
        };
        $add($db, 'sensum-cms/storage/database.sqlite');
        if ($photos === 'included') {
            foreach ($uploads as $f) {
                $add($f, 'public_html/assets/uploads/' . basename($f));
            }
        }
        $readme = $this->readme($photos, $stamp);
        $zip->addFromString('LEEME-RESTAURAR.txt', $readme);
        $zip->setEncryptionName('LEEME-RESTAURAR.txt', \ZipArchive::EM_AES_256);
        $zip->setArchiveComment('Sensum Construcciones - respaldo cifrado (AES-256) ' . date('Y-m-d H:i') . '. Abrir con 7-Zip, Keka o The Unarchiver.');
        $ok = $zip->close();
        @unlink($db);
        if (!$ok || !is_file($zipPath)) {
            throw new \RuntimeException('backup_zip_failed');
        }
        @chmod($zipPath, 0600);
        return ['path' => $zipPath, 'bytes' => (int) filesize($zipPath), 'photos' => $photos];
    }

    private function readme(string $photos, string $stamp): string
    {
        return "RESPALDO DEL SITIO SENSUM CONSTRUCCIONES — {$stamp}\r\n\r\n"
            . "Contenido:\r\n"
            . "  sensum-cms/storage/database.sqlite   textos, usuarios, reportes, mensajes de clientes, configuración\r\n"
            . ($photos === 'included' ? "  public_html/assets/uploads/           fotos y PDF publicados\r\n" : '')
            . ($photos === 'omitted' ? "  (las fotos no se incluyeron porque el correo sería demasiado grande; descarga un respaldo completo desde el panel)\r\n" : '')
            . "\r\nPara restaurar (cPanel → File Manager):\r\n"
            . "  1. Sube el contenido del sitio (paquete de la guía de despliegue) si el servidor es nuevo.\r\n"
            . "  2. Reemplaza ~/sensum-cms/storage/database.sqlite por el de este respaldo (permiso 600).\r\n"
            . "  3. Copia las fotos a ~/public_html/assets/uploads/ (si vienen en el respaldo).\r\n"
            . "  4. Entra al panel y pulsa «Volver a publicar el sitio».\r\n"
            . "  La clave de la aplicación (APP_KEY en .env o sensum-cms/storage/app.key) protege las\r\n"
            . "  contraseñas guardadas en el panel (correo, captcha): si no la tienes, vuelve a escribirlas.\r\n";
    }

    /** E-mails a backup now (scheduled or "Send now"). */
    public function send(bool $manual = false): array
    {
        $cfg = $this->settings();
        if ($cfg['email'] === '') {
            throw ApiError::validation(['email' => 'required']);
        }
        $now = time();
        $state = $this->app->settings()->getJson(self::KEY);
        $state['lastAttemptAt'] = $now;
        try {
            $b = $this->build($cfg['includePhotos'], self::MAX_EMAIL_BYTES);
            if ($b['bytes'] > self::MAX_EMAIL_BYTES) {
                @unlink($b['path']);
                $b = $this->build(false, self::MAX_EMAIL_BYTES);
                $b['photos'] = $cfg['includePhotos'] ? 'omitted' : $b['photos'];
            }
        } catch (ApiError $e) {
            throw $e;
        } catch (\Throwable $e) {
            $state['lastStatus'] = 'failed';
            $this->app->settings()->setJson(self::KEY, $state);
            $this->app->logger()->error('offsite_backup_failed', ['message' => 'The encrypted backup could not be created', 'type' => get_class($e)]);
            return ['sent' => false, 'bytes' => 0, 'photos' => 'none'];
        }
        $lang = $this->app->db()->value('SELECT lang FROM users WHERE lower(email) = ?', [$this->app->config->ownerEmail()]) === 'en' ? 'en' : 'es';
        $s = require $this->app->root('lang/' . $lang . '.php');
        $date = date('Y-m-d');
        $size = round($b['bytes'] / 1048576, 1) . ' MB';
        $vars = ['{date}' => $date, '{size}' => $size, '{frequency}' => $s['ob.freq.' . $cfg['frequency']]];
        $e = fn (string $v) => Emails::esc($v);
        $items = [$s['ob.item.db'], $b['photos'] === 'included' ? $s['ob.item.photos'] : ($b['photos'] === 'omitted' ? $s['ob.item.photosOmitted'] : null), $s['ob.item.readme']];
        $li = '';
        $text = strtr($s['ob.intro'], $vars) . "\n\n";
        foreach (array_filter($items) as $it) {
            $li .= '<tr><td valign="top" width="20" style="padding:4px 0;color:#f6740a">&#9679;</td><td style="padding:4px 0;font-size:14px;color:#2b2b31">' . $e($it) . '</td></tr>';
            $text .= '- ' . $it . "\n";
        }
        $body = '<h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;color:#1c1c1c">' . $e(strtr($s['ob.title'], $vars)) . '</h1>'
            . '<p style="margin:0 0 14px;color:#2b2b31">' . $e(strtr($s['ob.intro'], $vars)) . '</p>'
            . '<table role="presentation" cellpadding="0" cellspacing="0">' . $li . '</table>'
            . '<div style="margin:16px 0 0;padding:14px 16px;background:#fff8f1;border-left:4px solid #f6740a;border-radius:0 12px 12px 0;font-size:14px;color:#2b2b31">'
            . $e($s['ob.howto']) . '</div>';
        $text .= "\n" . $s['ob.howto'] . "\n";
        $layout = (new Emails($this->app))->branded($lang, $s['ob.tag'], strtr($s['ob.title'], $vars), $body, $e($s['ob.footer']));
        $ok = $this->app->mailer()->send([
            'to' => $cfg['email'],
            'subject' => strtr($s['ob.subject'], $vars),
            'text' => $text,
            'html' => $layout['html'],
            'embedded' => $layout['embedded'],
            'attachments' => [['path' => $b['path'], 'name' => 'respaldo-sensum-' . $date . '.zip', 'mime' => 'application/zip']],
        ]);
        @unlink($b['path']);
        $state['lastStatus'] = $ok ? 'sent' : 'failed';
        if ($ok) {
            $state['lastSentAt'] = $now;
            $state['lastBytes'] = $b['bytes'];
            $state['lastPhotos'] = $b['photos'];
            $this->app->maintenanceLog()->add('offsite', 1, $now);
        } else {
            $this->app->logger()->error('offsite_backup_failed', ['message' => 'The encrypted backup could not be e-mailed', 'bytes' => $b['bytes']]);
        }
        $this->app->settings()->setJson(self::KEY, $state);
        $this->app->activity(null, $ok ? 'offsite_backup_sent' : 'offsite_backup_failed', $manual ? 'manual' : 'scheduled', ['bytes' => $b['bytes'], 'photos' => $b['photos']]);
        return ['sent' => $ok, 'bytes' => $b['bytes'], 'photos' => $b['photos']];
    }

    /** Called by the scheduled check: sends when the chosen period has passed. */
    public function runIfDue(?int $now = null): string
    {
        $now ??= time();
        $cfg = $this->settings();
        if (!$cfg['enabled']) {
            return 'off';
        }
        $period = self::FREQUENCIES[$cfg['frequency']];
        $last = $cfg['lastSentAt'] ?? 0;
        // A failed attempt is retried after 6 hours, not on every check.
        if ($now - $last < $period - 600 || ($cfg['lastStatus'] === 'failed' && $now - (int) $cfg['lastAttemptAt'] < 6 * 3600)) {
            return 'not due';
        }
        try {
            $r = $this->send();
        } catch (\Throwable $e) {
            return 'failed (' . get_class($e) . ')';
        }
        return $r['sent'] ? 'sent (' . round($r['bytes'] / 1024) . ' KB, photos ' . $r['photos'] . ')' : 'failed';
    }

    /** True when enabled and the last copy failed or is older than twice the period. */
    public function overdue(?int $now = null): bool
    {
        $now ??= time();
        $cfg = $this->settings();
        if (!$cfg['enabled']) {
            return false;
        }
        $period = self::FREQUENCIES[$cfg['frequency']];
        return $cfg['lastStatus'] === 'failed' || ($cfg['lastSentAt'] !== null && $now - $cfg['lastSentAt'] > 2 * $period)
            || ($cfg['lastSentAt'] === null && $cfg['lastAttemptAt'] !== null && $now - $cfg['lastAttemptAt'] > 86400);
    }
}
