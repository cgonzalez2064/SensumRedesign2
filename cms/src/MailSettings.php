<?php
declare(strict_types=1);

namespace Sensum\Cms;

use Sensum\Cms\Http\ApiError;

/**
 * E-mail configuration the owner manages in the panel (Administración →
 * Correo), so going live needs no file editing beyond the basics:
 *
 *   - the account that sends the panel's e-mail (SMTP) and its Reply-To,
 *   - where problem reports and automatic alerts go,
 *   - the public contact form: who receives leads, which address sends
 *     them, and whether it uses that SMTP account or the hosting's mail().
 *
 * Effective value = panel value if set, otherwise the .env value, otherwise
 * the default. EMAIL_SETTINGS_LOCKED=true in .env makes the panel read-only
 * (the .env values always win). The SMTP password is encrypted at rest with
 * a key derived from the application key and is never sent to the browser.
 */
final class MailSettings
{
    private const KEY = 'email_settings';
    private ?array $stored = null;

    public function __construct(private App $app)
    {
    }

    public function locked(): bool
    {
        return $this->app->config->bool('EMAIL_SETTINGS_LOCKED');
    }

    private function stored(): array
    {
        if ($this->stored === null) {
            try {
                $this->stored = $this->locked() ? [] : $this->app->settings()->getJson(self::KEY);
            } catch (\Throwable) {
                $this->stored = []; // the database may be the problem: fall back to .env
            }
        }
        return $this->stored;
    }

    /** panel value → .env value → default */
    private function pick(string $path, string $env, string $default = ''): string
    {
        $v = $this->stored();
        foreach (explode('.', $path) as $k) {
            $v = is_array($v) ? ($v[$k] ?? null) : null;
        }
        if (is_scalar($v) && (string) $v !== '') {
            return (string) $v;
        }
        return $env !== '' ? $this->app->config->string($env, $default) : $default;
    }

    /** @return array{host:string,port:int,encryption:string,username:string,password:string,fromAddress:string,fromName:string,replyTo:string} */
    public function smtp(): array
    {
        $enc = $this->stored()['smtp']['passwordEnc'] ?? '';
        $password = is_string($enc) && $enc !== '' ? ($this->decrypt($enc) ?? '') : $this->app->config->string('SMTP_PASSWORD');
        return [
            'host' => $this->pick('smtp.host', 'SMTP_HOST'),
            'port' => (int) $this->pick('smtp.port', 'SMTP_PORT', '587'),
            'encryption' => strtolower($this->pick('smtp.encryption', 'SMTP_ENCRYPTION', 'tls')),
            'username' => $this->pick('smtp.username', 'SMTP_USERNAME'),
            'password' => $password,
            'fromAddress' => $this->pick('smtp.fromAddress', 'SMTP_FROM_ADDRESS', 'no-reply@sensumconstrucciones.com'),
            'fromName' => $this->pick('smtp.fromName', 'SMTP_FROM_NAME', 'Sensum Construcciones'),
            'replyTo' => $this->pick('smtp.replyTo', 'SMTP_REPLY_TO'),
        ];
    }

    public function supportEmail(): string
    {
        return $this->pick('supportEmail', 'SUPPORT_EMAIL', 'it@gruposensum.com');
    }

    public function alertEmail(): string
    {
        return $this->pick('alertEmail', 'ALERT_EMAIL', $this->supportEmail());
    }

    /**
     * The public contact form. `configured` is false until the owner saves it
     * (or CONTACT_TO is set in .env): the form then keeps its built-in values.
     * @return array{configured:bool,to:list<string>,fromAddress:string,fromName:string,method:string}
     */
    public function contact(): array
    {
        $c = $this->stored()['contact'] ?? [];
        $to = array_values(array_filter((array) ($c['to'] ?? []), 'is_string'));
        if (!$to && $this->app->config->string('CONTACT_TO') !== '') {
            $to = array_map('trim', explode(',', $this->app->config->string('CONTACT_TO')));
        }
        return [
            'configured' => (bool) $to,
            'to' => $to ?: ['contacto@sensumconstrucciones.com'],
            'fromAddress' => $this->pick('contact.fromAddress', 'CONTACT_FROM_ADDRESS', 'no-reply@sensumconstrucciones.com'),
            'fromName' => $this->pick('contact.fromName', 'CONTACT_FROM_NAME', 'Sensum Construcciones'),
            'method' => $this->pick('contact.method', 'CONTACT_METHOD', 'smtp') === 'mail' ? 'mail' : 'smtp',
        ];
    }

    /**
     * Optional Cloudflare Turnstile on the contact form (on top of the
     * built-in captcha): panel values, otherwise TURNSTILE_SITE_KEY /
     * TURNSTILE_SECRET_KEY in .env. Active only when both are set.
     * @return array{siteKey:string,secret:string}
     */
    public function turnstile(): array
    {
        $enc = $this->stored()['contact']['turnstileSecretEnc'] ?? '';
        $secret = is_string($enc) && $enc !== '' ? ($this->decrypt($enc) ?? '') : $this->app->config->string('TURNSTILE_SECRET_KEY');
        $site = $this->pick('contact.turnstileSiteKey', 'TURNSTILE_SITE_KEY');
        $panelSite = $this->stored()['contact']['turnstileSiteKey'] ?? null;
        if (is_string($panelSite) && $panelSite === '' && isset($this->stored()['contact']['to'])) {
            // Saved empty in the panel = turned off there (even if .env has keys).
            return ['siteKey' => '', 'secret' => ''];
        }
        return ['siteKey' => $site, 'secret' => $site === '' ? '' : $secret];
    }

    /** What the owner's settings page shows: effective values (no password), where each comes from. */
    public function forPanel(): array
    {
        $smtp = $this->smtp();
        unset($smtp['password']);
        $stored = $this->stored();
        $source = function (string $path, string $env) use ($stored): string {
            $v = $stored;
            foreach (explode('.', $path) as $k) {
                $v = is_array($v) ? ($v[$k] ?? null) : null;
            }
            if (is_scalar($v) && (string) $v !== '') {
                return 'panel';
            }
            return $this->app->config->string($env) !== '' ? 'env' : 'default';
        };
        return [
            'locked' => $this->locked(),
            'smtp' => $smtp + ['passwordSet' => $this->smtp()['password'] !== ''],
            'supportEmail' => $this->supportEmail(),
            'alertEmail' => $this->alertEmail(),
            'contact' => $this->contact(),
            'turnstile' => ['siteKey' => $this->turnstile()['siteKey'], 'secretSet' => $this->turnstile()['secret'] !== '',
                'active' => $this->turnstile()['siteKey'] !== '' && $this->turnstile()['secret'] !== ''],
            'sources' => [
                'smtp' => $source('smtp.host', 'SMTP_HOST'),
                'supportEmail' => $source('supportEmail', 'SUPPORT_EMAIL'),
                'alertEmail' => $source('alertEmail', 'ALERT_EMAIL'),
                'contact' => ($stored['contact']['to'] ?? null) ? 'panel' : ($this->app->config->string('CONTACT_TO') !== '' ? 'env' : 'default'),
            ],
            'mailDriver' => $this->app->mailer()->driver(),
        ];
    }

    /** Validates and stores the owner's settings. An empty password keeps the saved one. */
    public function save(array $in): void
    {
        if ($this->locked()) {
            throw new ApiError(409, 'settings_locked');
        }
        $errors = [];
        $email = function (mixed $v, string $field) use (&$errors): string {
            $v = is_string($v) ? strtolower(trim($v)) : '';
            if ($v === '' || strlen($v) > 120 || !filter_var($v, FILTER_VALIDATE_EMAIL) || preg_match('/[^\x21-\x7E]/', $v)) {
                $errors[$field] = 'invalid_email';
            }
            return $v;
        };
        $line = function (mixed $v, string $field, int $max, bool $required = true) use (&$errors): string {
            $v = is_string($v) ? trim($v) : '';
            if (preg_match('/[\x00-\x1F\x7F<>]/', $v) || mb_strlen($v) > $max || ($required && $v === '')) {
                $errors[$field] = $v === '' ? 'required' : 'invalid';
            }
            return $v;
        };
        $s = is_array($in['smtp'] ?? null) ? $in['smtp'] : [];
        $host = is_string($s['host'] ?? null) ? strtolower(trim($s['host'])) : '';
        if (!preg_match('/^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/', $host)) {
            $errors['smtp.host'] = $host === '' ? 'required' : 'invalid';
        }
        $port = filter_var($s['port'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 65535]]);
        if ($port === false) {
            $errors['smtp.port'] = 'invalid';
        }
        $enc = is_string($s['encryption'] ?? null) ? $s['encryption'] : '';
        if (!in_array($enc, ['ssl', 'tls', 'none'], true)) {
            $errors['smtp.encryption'] = 'invalid';
        }
        $username = $line($s['username'] ?? '', 'smtp.username', 254, false);
        $password = is_string($s['password'] ?? null) ? $s['password'] : '';
        if (strlen($password) > 256 || preg_match('/[\r\n\x00]/', $password)) {
            $errors['smtp.password'] = 'invalid';
        }
        $from = $email($s['fromAddress'] ?? '', 'smtp.fromAddress');
        $fromName = $line($s['fromName'] ?? '', 'smtp.fromName', 80);
        $replyTo = trim((string) ($s['replyTo'] ?? ''));
        $replyTo = $replyTo === '' ? '' : $email($replyTo, 'smtp.replyTo');
        $support = $email($in['supportEmail'] ?? '', 'supportEmail');
        $alert = $email($in['alertEmail'] ?? '', 'alertEmail');

        $c = is_array($in['contact'] ?? null) ? $in['contact'] : [];
        $to = [];
        $rawTo = $c['to'] ?? [];
        if (!is_array($rawTo) || !array_is_list($rawTo) || !$rawTo || count($rawTo) > 3) {
            $errors['contact.to'] = 'invalid';
        } else {
            foreach ($rawTo as $addr) {
                $to[] = $email($addr, 'contact.to');
            }
        }
        $cFrom = $email($c['fromAddress'] ?? '', 'contact.fromAddress');
        $cName = $line($c['fromName'] ?? '', 'contact.fromName', 80);
        $method = ($c['method'] ?? '') === 'mail' ? 'mail' : 'smtp';
        // Cloudflare Turnstile (optional). Empty site key = off; empty secret = keep the saved one.
        $tsSite = is_string($c['turnstileSiteKey'] ?? null) ? trim($c['turnstileSiteKey']) : '';
        $tsSecret = is_string($c['turnstileSecret'] ?? null) ? trim($c['turnstileSecret']) : '';
        if ($tsSite !== '' && !preg_match('/^[0-9A-Za-z_-]{10,100}$/', $tsSite)) {
            $errors['contact.turnstileSiteKey'] = 'invalid';
        }
        if ($tsSecret !== '' && !preg_match('/^[0-9A-Za-z_.-]{10,200}$/', $tsSecret)) {
            $errors['contact.turnstileSecret'] = 'invalid';
        }
        $oldTs = $this->app->settings()->getJson(self::KEY)['contact']['turnstileSecretEnc'] ?? '';
        if ($tsSite !== '' && $tsSecret === '' && (!is_string($oldTs) || $oldTs === '') && $this->app->config->string('TURNSTILE_SECRET_KEY') === '') {
            $errors['contact.turnstileSecret'] = 'required';
        }
        if ($errors) {
            throw ApiError::validation($errors);
        }

        $old = $this->app->settings()->getJson(self::KEY);
        $passwordEnc = $password !== '' ? $this->encrypt($password) : (string) ($old['smtp']['passwordEnc'] ?? '');
        $tsSecretEnc = $tsSite === '' ? '' : ($tsSecret !== '' ? $this->encrypt($tsSecret) : (string) ($old['contact']['turnstileSecretEnc'] ?? ''));
        $this->app->settings()->setJson(self::KEY, [
            'smtp' => ['host' => $host, 'port' => (int) $port, 'encryption' => $enc, 'username' => $username, 'passwordEnc' => $passwordEnc,
                'fromAddress' => $from, 'fromName' => $fromName, 'replyTo' => $replyTo],
            'supportEmail' => $support,
            'alertEmail' => $alert,
            'contact' => ['to' => array_values(array_unique($to)), 'fromAddress' => $cFrom, 'fromName' => $cName, 'method' => $method,
                'turnstileSiteKey' => $tsSite, 'turnstileSecretEnc' => $tsSecretEnc],
            'updatedAt' => time(),
        ]);
        $this->stored = null;
    }

    // ------------------------------------------------------------------ secret at rest

    private function encrypt(string $plain): string
    {
        return $this->app->secrets()->encrypt($plain, 'mail-settings');
    }

    private function decrypt(string $stored): ?string
    {
        return $this->app->secrets()->decrypt($stored, 'mail-settings');
    }
}
