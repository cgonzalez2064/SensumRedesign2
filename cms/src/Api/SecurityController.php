<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Http\Response;

/**
 * Seguridad (owner only): the encrypted off-server backup and the two-factor
 * sign-in policy. Changes need the owner's password again and are logged.
 */
final class SecurityController extends Controller
{
    public function index(): never
    {
        Response::ok([
            'backup' => $this->app->offsiteBackup()->settings(),
            'twoFactor' => $this->app->twoFactor()->overview(),
            'accounts' => $this->app->automations()->accountPolicy() + [
                'rememberedDevices' => (int) $this->app->db()->value('SELECT COUNT(*) FROM trusted_devices WHERE expires_at > ?', [time()]),
            ],
        ]);
    }

    /** Account rules: turn off unused accounts, remember browsers for two-step sign-in, refuse leaked passwords. */
    public function saveAccounts(): never
    {
        $this->confirmPassword('security_accounts');
        $before = $this->app->automations()->accountPolicy();
        $after = $this->app->automations()->saveAccountPolicy($this->req->json());
        if ($before['rememberDevice'] && !$after['rememberDevice']) {
            // Turned off: every remembered browser asks for the code again.
            $this->app->db()->run('DELETE FROM trusted_devices');
        }
        $this->app->activity($this->uid(), 'security_policy_changed', '', ['accounts' => $after], $this->req->ip());
        Response::ok(['accounts' => $after + ['rememberedDevices' => (int) $this->app->db()->value('SELECT COUNT(*) FROM trusted_devices WHERE expires_at > ?', [time()])]]);
    }

    public function saveBackup(): never
    {
        $this->confirmPassword('backup_settings');
        $in = $this->req->json();
        $settings = $this->app->offsiteBackup()->save($in);
        $this->app->activity($this->uid(), 'backup_settings_changed', '', ['enabled' => $settings['enabled'], 'frequency' => $settings['frequency'], 'passwordChanged' => ($in['password'] ?? '') !== ''], $this->req->ip());
        Response::ok(['backup' => $settings]);
    }

    public function sendBackup(): never
    {
        if (!$this->app->rateLimiter()->hit('backup_send', (string) $this->uid(), 3, 3600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $r = $this->app->offsiteBackup()->send(true);
        if (!$r['sent']) {
            throw new ApiError(502, 'email_failed');
        }
        Response::ok($r + ['backup' => $this->app->offsiteBackup()->settings()]);
    }

    /** Streams a full encrypted backup (password confirmed). */
    public function downloadBackup(): never
    {
        $this->confirmPassword('backup_download');
        if (!$this->app->rateLimiter()->hit('backup_download', (string) $this->uid(), 5, 3600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $b = $this->app->offsiteBackup()->build(true);
        $this->app->activity($this->uid(), 'backup_downloaded', '', ['bytes' => $b['bytes']], $this->req->ip());
        header('Content-Type: application/zip');
        header('Content-Length: ' . $b['bytes']);
        header('Content-Disposition: attachment; filename="respaldo-sensum-' . date('Y-m-d') . '.zip"');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        readfile($b['path']);
        @unlink($b['path']);
        exit;
    }

    public function savePolicy(): never
    {
        $this->confirmPassword('security_policy');
        $policy = $this->app->twoFactor()->setPolicy($this->str('twoFactor'));
        $this->app->activity($this->uid(), 'security_policy_changed', '', ['twoFactor' => $policy], $this->req->ip());
        Response::ok(['twoFactor' => $this->app->twoFactor()->overview()]);
    }
}
