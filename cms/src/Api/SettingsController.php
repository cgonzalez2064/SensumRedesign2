<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Emails;
use Sensum\Cms\Http\Response;

/**
 * E-mail settings (owner account only): the panel's sending account, where
 * reports and alerts go, and the public contact form. Saving needs the
 * owner's password again, is logged, and the owner is notified by e-mail.
 */
final class SettingsController extends Controller
{
    public function email(): never
    {
        Response::ok($this->app->mailSettings()->forPanel());
    }

    public function saveEmail(): never
    {
        $this->confirmPassword('email_settings');
        $before = $this->app->mailSettings()->forPanel();
        $input = $this->req->json();
        $this->app->mailSettings()->save($input);
        $after = $this->app->mailSettings()->forPanel();
        $changed = $this->changedAreas($before, $after, ($input['smtp']['password'] ?? '') !== '', ($input['contact']['turnstileSecret'] ?? '') !== '');
        if ($changed) {
            $this->app->activity($this->uid(), 'email_settings_changed', '', ['changed' => $changed], $this->req->ip());
        }
        // The Turnstile site key is part of the public page: publish it now.
        $republished = null;
        if ($before['turnstile']['siteKey'] !== $after['turnstile']['siteKey'] || $before['turnstile']['active'] !== $after['turnstile']['active']) {
            try {
                $this->app->publisher()->publish($this->uid(), 'settings');
                $republished = true;
            } catch (\Throwable $e) {
                $this->app->logger()->error('publish_failed', ['reason' => 'turnstile_settings', 'type' => get_class($e)]);
                $republished = false;
            }
        }
        Response::okAndContinue(['settings' => $after, 'changed' => $changed, 'republished' => $republished]);
        // Security notice to the owner (sent after answering, with the new settings).
        if ($changed) {
            $this->app->watchdog()->settingsChanged((string) $this->session['name'], $changed);
        }
        exit;
    }

    public function testEmail(): never
    {
        if (!$this->app->rateLimiter()->hit('email_test', (string) $this->uid(), 6, 3600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $target = $this->str('target');
        if ($target === 'contact') {
            $c = $this->app->mailSettings()->contact();
            $form = $this->app->contactForm();
            $mail = $form->message([
                'name' => 'Prueba del formulario', 'phone' => '2256-7954', 'email' => $this->app->config->ownerEmail(),
                'service' => 'Otro', 'message' => "Este es un mensaje de prueba enviado desde el panel (Administración → Correo).\nSi lo recibiste, el formulario de contacto del sitio está bien configurado.",
            ], $c);
            $mail['subject'] = '[Prueba] ' . $mail['subject'];
            $sent = $form->send($mail, $c);
            $to = $c['to'];
        } else {
            // The panel's account: one message to the owner and to where reports and alerts go.
            $ms = $this->app->mailSettings();
            $to = array_values(array_unique([$this->app->config->ownerEmail(), $ms->supportEmail(), $ms->alertEmail()]));
            $smtp = $ms->smtp();
            $e = fn (string $v) => Emails::esc($v);
            $rows = [
                'Remitente' => $smtp['fromName'] . ' <' . $smtp['fromAddress'] . '>',
                'Responder a' => $smtp['replyTo'] !== '' ? $smtp['replyTo'] : $ms->supportEmail(),
                'Reportes de problemas' => $ms->supportEmail(),
                'Alertas automáticas' => $ms->alertEmail(),
            ];
            $table = '';
            foreach ($rows as $k => $v) {
                $table .= '<tr><td style="padding:6px 14px 6px 0;color:#7a7a82;font-size:14px;white-space:nowrap">' . $e($k) . '</td><td style="padding:6px 0;font-size:14px;font-weight:600;color:#1f2328;word-break:break-word">' . $e($v) . '</td></tr>';
            }
            $body = '<h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;color:#1c1c1c">La cuenta de envío del panel funciona</h1>'
                . '<p style="margin:0 0 14px;color:#2b2b31">Recibiste este correo porque ' . $e((string) $this->session['name']) . ' pulsó «Enviar prueba» en Administración → Correo. Así se verán los avisos, reportes y alertas.</p>'
                . '<table role="presentation" cellpadding="0" cellspacing="0" style="background:#f7f7f9;border-radius:12px;padding:6px 16px;width:100%"><tr><td><table role="presentation" cellpadding="0" cellspacing="0">' . $table . '</table></td></tr></table>';
            $layout = (new Emails($this->app))->branded('es', 'Prueba de correo', 'La cuenta de envío del panel funciona', $body, 'Correo de prueba del Administrador de contenido de sensumconstrucciones.com.');
            $text = "La cuenta de envío del panel funciona.\n\n";
            foreach ($rows as $k => $v) {
                $text .= "{$k}: {$v}\n";
            }
            $sent = $this->app->mailer()->send([
                'to' => $to,
                'subject' => '[Sensum Website] Prueba de la cuenta de envío del panel',
                'text' => $text . "\n" . date('Y-m-d H:i') . "\n",
                'html' => $layout['html'],
                'embedded' => $layout['embedded'],
            ]);
        }
        $this->app->activity($this->uid(), 'email_test', $target === 'contact' ? 'contact' : 'panel', ['sent' => $sent], $this->req->ip());
        if (!$sent) {
            throw new ApiError(502, 'email_failed');
        }
        Response::ok(['sent' => true, 'to' => $to]);
    }

    /** @return list<string> */
    private function changedAreas(array $a, array $b, bool $passwordChanged, bool $turnstileSecretChanged): array
    {
        $out = [];
        if ($a['smtp'] != $b['smtp'] || $passwordChanged) {
            $out[] = 'smtp';
        }
        foreach (['supportEmail', 'alertEmail', 'contact'] as $k) {
            if ($a[$k] != $b[$k]) {
                $out[] = $k;
            }
        }
        if ($a['turnstile'] != $b['turnstile'] || $turnstileSecretChanged) {
            $out[] = 'turnstile';
        }
        return $out;
    }
}
