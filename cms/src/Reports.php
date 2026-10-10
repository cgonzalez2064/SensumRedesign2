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
    /** Badge colours per report type in the e-mail: [background, text]. */
    private const TYPE_COLORS = [
        'problem' => ['#fdecec', '#b42318'], 'improvement' => ['#e8f6ee', '#1a7f45'], 'content' => ['#e8effd', '#1d4ed8'],
        'design' => ['#f3ecfd', '#6d28d9'], 'other' => ['#f0f0f3', '#4b4b55'],
    ];
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
            'INSERT INTO support_reports (user_id, reporter_name, reporter_email, type, title, description, area, page, context, screenshot, fingerprint, created_at, updated_at, status, owner_unread)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'new\', 1)',
            [$userId, $session['name'], $session['email'], $type, $title, $description, $area, $page,
                json_encode($context, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $file, $fingerprint, time(), time()]
        );
        $this->app->activity($userId, 'report_submitted', (string) $id, ['type' => $type]);
        $delivered = $this->deliver($id);
        return ['report' => (new Tickets($this->app))->present($this->find($id), false), 'delivered' => $delivered];
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
            $this->app->logger()->error('report_email_failed', ['message' => 'Support report e-mail could not be delivered', 'at' => 'Reports::deliver', 'report' => $id]);
            $this->app->activity($r['user_id'] !== null ? (int) $r['user_id'] : null, 'report_email_failed', (string) $id);
        }
        return $ok;
    }

    /** Retry by the report's author or the owner. */
    public function retry(array $session, int $id): array
    {
        $r = $this->find($id);
        if ((int) $r['user_id'] !== (int) $session['uid'] && !$this->app->auth()->isOwner($session)) {
            throw new ApiError(404, 'not_found'); // don't reveal other users' reports
        }
        if (!$this->app->rateLimiter()->hit('report_retry', (string) $session['uid'], 10, 600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $delivered = $this->deliver($id);
        return ['report' => (new Tickets($this->app))->present($this->find($id), $this->app->auth()->isOwner($session)), 'delivered' => $delivered];
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

        // Screenshot: attached as sent, plus a JPEG preview shown inside the message.
        $attachments = [];
        $embedded = [];
        $preview = null;
        if ($r['screenshot'] && preg_match('/^report-\d{8}-[a-f0-9]{12}-w\d+\.(webp|jpg)$/', (string) $r['screenshot'], $m)) {
            $path = $this->app->storage('reports/' . $r['screenshot']);
            if (is_file($path)) {
                $attachments[] = ['path' => $path, 'name' => 'captura-reporte-' . $r['id'] . '.' . $m[1], 'mime' => $m[1] === 'webp' ? 'image/webp' : 'image/jpeg'];
                $preview = $this->emailPreview($path, (int) $r['id']);
                if ($preview) {
                    $embedded[] = ['path' => $preview['path'], 'cid' => 'report-shot', 'name' => 'vista-previa.jpg', 'mime' => 'image/jpeg'];
                }
            }
        }

        $e = fn (string $v) => Emails::esc($v);
        [$badgeBg, $badgeFg] = self::TYPE_COLORS[$r['type']] ?? self::TYPE_COLORS['other'];
        $firstName = explode(' ', trim($r['reporter_name']))[0] ?: $r['reporter_name'];
        $reply = 'mailto:' . rawurlencode($r['reporter_email']) . '?subject=' . rawurlencode('Re: ' . Mailer::oneLine($r['title'], 120));
        $meta = $e($r['reporter_name']) . ' &nbsp;·&nbsp; ' . $e(self::friendlyDate((int) $r['created_at'])) . ' &nbsp;·&nbsp; ' . $e(self::AREA_LABELS[$r['area']] ?? $r['area']);
        // Phone screenshots are tall: show them narrower so they don't take over the message.
        $shotWidth = $preview && $preview['h'] > $preview['w'] ? 260 : 560;

        $detail = fn (string $label, string $valueHtml) => '<td valign="top" width="50%" style="padding:10px 12px;background:#f7f7f9;border-radius:10px">'
            . '<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#7a7a82">' . $e($label) . '</div>'
            . '<div style="font-size:14px;color:#1f2328;margin-top:2px;word-break:break-word">' . $valueHtml . '</div></td>';
        $techRows = implode('', array_map(
            fn ($k, $v) => '<tr><td valign="top" style="padding:4px 14px 4px 0;color:#7a7a82;white-space:nowrap">' . $e((string) $k) . '</td>'
                . '<td style="padding:4px 0;color:#3c3c43;word-break:break-word">' . $e((string) $v) . '</td></tr>',
            array_keys($tech), $tech
        ));

        $body = '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:' . $badgeBg . ';color:' . $badgeFg . ';border-radius:999px;padding:5px 12px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif">'
            . $e($typeLabel) . '</td></tr></table>'
            . '<h1 style="margin:14px 0 6px;font-size:22px;line-height:1.3;color:#1c1c1c">' . $e($r['title']) . '</h1>'
            . '<div style="font-size:13px;color:#7a7a82">' . $meta . '</div>'
            . '<div style="margin:22px 0 0;padding:16px 18px;background:#fff8f1;border-left:4px solid #f6740a;border-radius:0 12px 12px 0;white-space:pre-wrap;font-size:15px;color:#1f2328">' . $e($r['description']) . '</div>'
            . ($preview
                ? '<div style="margin:22px 0 0"><div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#7a7a82;margin-bottom:8px">Captura de pantalla</div>'
                    . '<img src="cid:report-shot" alt="Captura de pantalla enviada con el reporte" width="' . $shotWidth . '" style="display:block;width:100%;max-width:' . $shotWidth . 'px;height:auto;border:1px solid #e7e7ea;border-radius:12px">'
                    . '<div style="font-size:12px;color:#7a7a82;margin-top:6px">La imagen original va adjunta a este correo.</div></div>'
                : '')
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:18px -6px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif"><tr>'
            . $detail('Página', $r['page'] !== '' ? $e($r['page']) : '—') . $detail('Número de reporte', '#' . (int) $r['id']) . '</tr><tr>'
            . $detail('Reportado por', $e($r['reporter_name'])) . $detail('Correo', '<a href="mailto:' . $e($r['reporter_email']) . '" style="color:#c25500;text-decoration:none">' . $e($r['reporter_email']) . '</a>')
            . '</tr></table>'
            . Emails::cta('Responder a ' . $firstName, $reply)
            . '<div style="font-size:13px;margin:0 0 4px"><a href="' . $e((new Emails($this->app))->adminUrl('reportes/' . (int) $r['id'])) . '" style="color:#c25500;text-decoration:none">Abrir el ticket #' . (int) $r['id'] . ' en el panel (estado, respuestas, notas) →</a></div>'
            . '<div style="margin:22px 0 6px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#7a7a82">Información técnica (automática)</div>'
            . '<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:12px;line-height:1.5">' . $techRows . '</table>';
        $footer = 'Enviado automáticamente por el Administrador de contenido de sensumconstrucciones.com. '
            . 'Responde a este correo para escribirle directamente a ' . $e($r['reporter_name']) . '. No incluye contraseñas ni datos de sesión.';
        $layout = (new Emails($this->app))->branded('es', 'Reporte de soporte #' . (int) $r['id'], $typeLabel . ': ' . $r['title'] . ' — ' . $r['reporter_name'], $body, $footer);
        return [
            'to' => $this->app->mailSettings()->supportEmail(),
            'subject' => '[Sensum Website] ' . $typeLabel . ': ' . Mailer::oneLine($r['title'], 120),
            'text' => $text,
            'html' => $layout['html'],
            'replyTo' => [$r['reporter_email'], $r['reporter_name']],
            'attachments' => $attachments,
            'embedded' => array_merge($layout['embedded'], $embedded),
        ];
    }

    /** "9 oct 2026, 16:05" — readable date for the e-mail header. */
    private static function friendlyDate(int $ts): string
    {
        $months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
        return date('j', $ts) . ' ' . $months[(int) date('n', $ts) - 1] . ' ' . date('Y, H:i', $ts);
    }

    /**
     * Small JPEG copy of the screenshot for showing inside the e-mail (WebP is not shown by every mail app).
     * @return array{path:string,w:int,h:int}|null
     */
    private function emailPreview(string $path, int $id): ?array
    {
        try {
            $data = @file_get_contents($path);
            $img = $data !== false ? @imagecreatefromstring($data) : false;
            if (!$img) {
                return null;
            }
            $w = imagesx($img);
            $h = imagesy($img);
            $scale = min(1, 1120 / max(1, $w));
            $out = imagecreatetruecolor(max(1, (int) round($w * $scale)), max(1, (int) round($h * $scale)));
            imagecopyresampled($out, $img, 0, 0, 0, 0, imagesx($out), imagesy($out), $w, $h);
            $file = $this->app->storageDir('reports/previews') . '/report-' . $id . '.jpg';
            imagejpeg($out, $file, 82);
            @chmod($file, 0600);
            return ['path' => $file, 'w' => imagesx($out), 'h' => imagesy($out)];
        } catch (\Throwable) {
            return null;
        }
    }
}
