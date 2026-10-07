<?php
declare(strict_types=1);

namespace Sensum\Cms;

use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Media\ImageProcessor;

/**
 * "Reportar un problema" — quick issue reports e-mailed to the support team
 * (SUPPORT_EMAIL, it@gruposensum.com by default).
 *
 * Every report is stored first (minimal audit trail), then e-mailed. If the
 * e-mail fails, the report stays as "failed" and can be retried by its
 * author, an administrator, or `php cms/bin/console reports:retry`.
 * Report text is untrusted plain text: it is escaped in the HTML e-mail and
 * shown with textContent in the admin, never interpreted as HTML.
 */
final class Reports
{
    public const TYPES = ['problem', 'improvement', 'content', 'design', 'other'];
    public const AREAS = ['website', 'admin', 'both'];
    private const TYPE_LABELS = ['problem' => 'Problema', 'improvement' => 'Mejora', 'content' => 'Contenido', 'design' => 'Diseño / visual', 'other' => 'Otro'];
    private const AREA_LABELS = ['website' => 'Sitio web', 'admin' => 'Panel de administración', 'both' => 'Ambos'];
    /** Technical context keys the browser may send (anything else is dropped). */
    private const CONTEXT_KEYS = ['lang', 'theme', 'route', 'browser', 'os', 'device', 'viewport', 'screen', 'dpr', 'timezone', 'online', 'locale'];
    private const CONTEXT_LABELS = [
        'lang' => 'Idioma del panel', 'theme' => 'Tema', 'route' => 'Pantalla del panel', 'browser' => 'Navegador', 'os' => 'Sistema operativo',
        'device' => 'Tipo de dispositivo', 'viewport' => 'Tamaño de ventana', 'screen' => 'Tamaño de pantalla', 'dpr' => 'Densidad de pantalla',
        'timezone' => 'Zona horaria', 'online' => 'Conexión', 'locale' => 'Idioma del navegador', 'appVersion' => 'Versión de la aplicación',
    ];
    private const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;
    private const MAX_ATTEMPTS = 10;

    public function __construct(private App $app)
    {
    }

    /** Single-line text: control characters removed, whitespace collapsed. */
    private static function line(string $s, int $max): string
    {
        $s = mb_check_encoding($s, 'UTF-8') ? $s : '';
        $s = preg_replace('/[\x00-\x1F\x7F\x{202A}-\x{202E}\x{2066}-\x{2069}]+/u', ' ', $s) ?? '';
        return mb_substr(trim(preg_replace('/\s+/u', ' ', $s) ?? ''), 0, $max);
    }

    /** Multi-line text: keeps line breaks, removes other control characters. */
    private static function multiline(string $s): string
    {
        $s = mb_check_encoding($s, 'UTF-8') ? $s : '';
        $s = str_replace(["\r\n", "\r"], "\n", $s);
        $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x{202A}-\x{202E}\x{2066}-\x{2069}]/u', '', $s) ?? '';
        $s = preg_replace("/\n{3,}/", "\n\n", $s) ?? '';
        return trim($s);
    }

    /**
     * Validates, stores and e-mails a report.
     * @return array{report:array, delivered:bool}
     */
    public function create(array $session, array $in, ?array $screenshot): array
    {
        $userId = (int) $session['uid'];
        $type = (string) ($in['type'] ?? '');
        $area = (string) ($in['area'] ?? '');
        $title = self::line((string) ($in['title'] ?? ''), 500);
        $description = self::multiline((string) ($in['description'] ?? ''));
        $page = self::line((string) ($in['page'] ?? ''), 1000);

        $errors = [];
        if (!in_array($type, self::TYPES, true)) {
            $errors['type'] = 'required';
        }
        if (!in_array($area, self::AREAS, true)) {
            $errors['area'] = 'required';
        }
        if ($title === '') {
            $errors['title'] = 'required';
        } elseif (mb_strlen($title) < 3) {
            $errors['title'] = 'too_short';
        } elseif (mb_strlen($title) > 120) {
            $errors['title'] = 'too_long';
        }
        if ($description === '') {
            $errors['description'] = 'required';
        } elseif (mb_strlen($description) < 10) {
            $errors['description'] = 'too_short';
        } elseif (mb_strlen($description) > 4000) {
            $errors['description'] = 'too_long';
        }
        if (mb_strlen($page) > 300) {
            $errors['page'] = 'too_long';
        }
        if ($errors) {
            throw ApiError::validation($errors);
        }

        $fingerprint = hash('sha256', $type . '|' . mb_strtolower($title) . '|' . mb_strtolower($description));
        $dupe = $this->app->db()->one(
            'SELECT id, email_status FROM support_reports WHERE user_id = ? AND fingerprint = ? AND created_at > ?',
            [$userId, $fingerprint, time() - 900]
        );
        if ($dupe) {
            throw new ApiError(409, 'duplicate_report', [], ['report' => ['id' => (int) $dupe['id'], 'emailStatus' => $dupe['email_status']]]);
        }

        // Abuse limits: a misbehaving or compromised account cannot flood the
        // support inbox. Checked after validation and the duplicate check, so
        // fixing a mistake never uses up someone's quota.
        $rl = $this->app->rateLimiter();
        if ($rl->tooMany('report_burst', (string) $userId, 5, 600) || $rl->tooMany('report_day', (string) $userId, 20, 86400)) {
            throw new ApiError(429, 'too_many_reports');
        }

        $context = $this->sanitizeContext($in['context'] ?? null);
        $file = null;
        if ($screenshot && ($screenshot['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
            $file = $this->storeScreenshot($screenshot);
        }
        $rl->hit('report_burst', (string) $userId, PHP_INT_MAX, 600);
        $rl->hit('report_day', (string) $userId, PHP_INT_MAX, 86400);

        $db = $this->app->db();
        $id = $db->insert(
            'INSERT INTO support_reports (user_id, reporter_name, reporter_email, type, title, description, area, page, context, screenshot, fingerprint, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$userId, $session['name'], $session['email'], $type, $title, $description, $area, $page,
                json_encode($context, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $file, $fingerprint, time()]
        );
        $this->app->activity($userId, 'report_submitted', (string) $id, ['type' => $type]);
        $delivered = $this->deliver($id);
        return ['report' => $this->present($this->find($id)), 'delivered' => $delivered];
    }

    private function sanitizeContext(mixed $raw): array
    {
        if (is_string($raw)) {
            $raw = json_decode($raw, true, 4);
        }
        $out = [];
        if (is_array($raw)) {
            foreach (self::CONTEXT_KEYS as $k) {
                if (isset($raw[$k]) && (is_string($raw[$k]) || is_int($raw[$k]) || is_float($raw[$k]) || is_bool($raw[$k]))) {
                    $v = is_bool($raw[$k]) ? ($raw[$k] ? 'sí' : 'no') : (string) $raw[$k];
                    $v = self::line($v, 120);
                    if ($v !== '') {
                        $out[$k] = $v;
                    }
                }
            }
        }
        $out['appVersion'] = $this->app->version();
        return $out;
    }

    private function storeScreenshot(array $file): string
    {
        ImageProcessor::assertUploadOk($file, self::SCREENSHOT_MAX_BYTES);
        $loaded = ImageProcessor::load((string) $file['tmp_name'], ImageProcessor::displayName((string) ($file['name'] ?? '')), [16, 16]);
        $dir = $this->app->storageDir('reports');
        $base = 'report-' . date('Ymd') . '-' . bin2hex(random_bytes(6));
        try {
            $ext = ImageProcessor::outputExt();
            $widths = ImageProcessor::writeVariants($loaded['img'], [0, 0, $loaded['w'], $loaded['h']], [1920], $dir, $base, $ext);
        } finally {
            imagedestroy($loaded['img']);
        }
        return "{$base}-w{$widths[0]}.{$ext}";
    }

    public function find(int $id): array
    {
        $row = $this->app->db()->one('SELECT * FROM support_reports WHERE id = ?', [$id]);
        if (!$row) {
            throw new ApiError(404, 'not_found');
        }
        return $row;
    }

    /** Sends (or re-sends) the support e-mail and records the outcome. */
    public function deliver(int $id): bool
    {
        $r = $this->find($id);
        if ($r['email_status'] === 'sent') {
            return true;
        }
        if ((int) $r['email_attempts'] >= self::MAX_ATTEMPTS) {
            return false;
        }
        $message = $this->buildEmail($r);
        $ok = $this->app->mailer()->send($message);
        $now = time();
        $this->app->db()->run(
            'UPDATE support_reports SET email_status = ?, email_attempts = email_attempts + 1, last_attempt_at = ?, sent_at = ? WHERE id = ?',
            [$ok ? 'sent' : 'failed', $now, $ok ? $now : null, $id]
        );
        if (!$ok) {
            $this->app->logger()->error('report_email_failed', ['report' => $id]);
            $this->app->activity($r['user_id'] !== null ? (int) $r['user_id'] : null, 'report_email_failed', (string) $id);
            ErrorTracker::record($this->app, 'server', 'Support report e-mail could not be delivered', 'Reports::deliver');
        }
        return $ok;
    }

    /** Retry by the report's author or an administrator. */
    public function retry(array $session, int $id): array
    {
        $r = $this->find($id);
        if ((int) $r['user_id'] !== (int) $session['uid'] && $session['role'] !== 'admin') {
            throw new ApiError(404, 'not_found'); // don't reveal other users' reports
        }
        if (!$this->app->rateLimiter()->hit('report_retry', (string) $session['uid'], 10, 600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $delivered = $this->deliver($id);
        return ['report' => $this->present($this->find($id)), 'delivered' => $delivered];
    }

    /** Recent reports: own for editors, all for administrators. */
    public function list(array $session): array
    {
        $rows = $session['role'] === 'admin'
            ? $this->app->db()->all('SELECT * FROM support_reports ORDER BY id DESC LIMIT 50')
            : $this->app->db()->all('SELECT * FROM support_reports WHERE user_id = ? ORDER BY id DESC LIMIT 50', [$session['uid']]);
        return array_map(fn ($r) => $this->present($r), $rows);
    }

    public function present(array $r): array
    {
        return [
            'id' => (int) $r['id'],
            'type' => $r['type'],
            'title' => $r['title'],
            'description' => $r['description'],
            'area' => $r['area'],
            'page' => $r['page'],
            'reporterName' => $r['reporter_name'],
            'hasScreenshot' => $r['screenshot'] !== null,
            'emailStatus' => $r['email_status'],
            'attempts' => (int) $r['email_attempts'],
            'createdAt' => (int) $r['created_at'],
            'sentAt' => $r['sent_at'] !== null ? (int) $r['sent_at'] : null,
        ];
    }

    /** @return array{to:string,subject:string,text:string,html:string,replyTo:array,attachments:array} */
    public function buildEmail(array $r): array
    {
        $typeLabel = self::TYPE_LABELS[$r['type']] ?? 'Otro';
        $context = json_decode((string) $r['context'], true) ?: [];
        $when = date('d/m/Y H:i', (int) $r['created_at']) . ' (' . date_default_timezone_get() . ')';
        $rows = [
            'Tipo' => $typeLabel,
            'Título' => $r['title'],
            'Dónde se notó' => self::AREA_LABELS[$r['area']] ?? $r['area'],
            'Página' => $r['page'] !== '' ? $r['page'] : '—',
            'Reportado por' => $r['reporter_name'] . ' <' . $r['reporter_email'] . '>',
            'Fecha y hora' => $when,
            'Número de reporte' => '#' . $r['id'],
        ];
        // Friendly values for the support engineer (raw codes otherwise).
        $readable = [
            'device' => ['mobile' => 'Celular', 'tablet' => 'Tableta', 'desktop' => 'Computadora'],
            'theme' => ['light' => 'Claro', 'dark' => 'Oscuro', 'system' => 'Sistema'],
            'lang' => ['es' => 'Español', 'en' => 'Inglés'],
            'online' => ['online' => 'En línea', 'offline' => 'Sin conexión'],
        ];
        $tech = [];
        foreach ($context as $k => $v) {
            $tech[self::CONTEXT_LABELS[$k] ?? $k] = $readable[$k][(string) $v] ?? (string) $v;
        }

        $text = "Nuevo reporte desde el Administrador de contenido de Sensum Construcciones\n\n";
        foreach ($rows as $k => $v) {
            $text .= "{$k}: {$v}\n";
        }
        $text .= "\nDescripción:\n{$r['description']}\n\nInformación técnica (recopilada automáticamente):\n";
        foreach ($tech as $k => $v) {
            $text .= "- {$k}: {$v}\n";
        }
        if ($r['screenshot']) {
            $text .= "\nSe adjunta una captura de pantalla.\n";
        }

        $tr = fn (array $pairs) => implode('', array_map(
            fn ($k, $v) => '<tr><th align="left" valign="top" style="padding:6px 12px 6px 0;color:#555;font-weight:600;white-space:nowrap">' . Emails::esc((string) $k)
                . '</th><td style="padding:6px 0;word-break:break-word">' . Emails::esc((string) $v) . '</td></tr>',
            array_keys($pairs), $pairs
        ));
        $html = '<p style="margin-top:0"><strong>Nuevo reporte desde el Administrador de contenido</strong></p>'
            . '<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px">' . $tr($rows) . '</table>'
            . '<h3 style="font-size:15px;margin:20px 0 6px">Descripción</h3>'
            . '<div style="white-space:pre-wrap;background:#f6f6f6;border-radius:8px;padding:12px;font-size:14px">' . Emails::esc($r['description']) . '</div>'
            . '<h3 style="font-size:15px;margin:20px 0 6px">Información técnica (automática)</h3>'
            . '<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:13px;color:#333">' . $tr($tech) . '</table>'
            . ($r['screenshot'] ? '<p style="font-size:13px;color:#555">Se adjunta una captura de pantalla.</p>' : '');

        $attachments = [];
        if ($r['screenshot'] && preg_match('/^report-\d{8}-[a-f0-9]{12}-w\d+\.(webp|jpg)$/', (string) $r['screenshot'], $m)) {
            $path = $this->app->storage('reports/' . $r['screenshot']);
            if (is_file($path)) {
                $attachments[] = ['path' => $path, 'name' => 'captura-reporte-' . $r['id'] . '.' . $m[1], 'mime' => $m[1] === 'webp' ? 'image/webp' : 'image/jpeg'];
            }
        }
        $s = ['brand' => 'Sensum Website', 'product' => 'Reporte de soporte', 'footer' => 'Enviado automáticamente por el Administrador de contenido de sensumconstrucciones.com. Responde a este correo para escribirle directamente a quien reportó.'];
        return [
            'to' => $this->app->config->supportEmail(),
            'subject' => '[Sensum Website] ' . $typeLabel . ': ' . Mailer::oneLine($r['title'], 120),
            'text' => $text,
            'html' => (new Emails($this->app))->layout($html, $s, 'es'),
            'replyTo' => [$r['reporter_email'], $r['reporter_name']],
            'attachments' => $attachments,
        ];
    }
}
