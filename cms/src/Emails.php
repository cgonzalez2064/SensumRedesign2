<?php
declare(strict_types=1);

namespace Sensum\Cms;

/**
 * Builds the transactional e-mails (plain text + simple HTML). Every value
 * placed in HTML is escaped; links are generated server-side from APP_URL,
 * never from request data.
 */
final class Emails
{
    public function __construct(private App $app)
    {
    }

    private function strings(string $lang): array
    {
        return require $this->app->root('lang/' . ($lang === 'en' ? 'en' : 'es') . '.php');
    }

    private static function fill(string $s, array $vars): string
    {
        return strtr($s, array_combine(array_map(fn ($k) => '{' . $k . '}', array_keys($vars)), array_values($vars)));
    }

    public function adminUrl(string $route): string
    {
        return $this->app->config->appUrl() . '/admin/#/' . ltrim($route, '/');
    }

    /** @return array{to:string,subject:string,text:string,html:string} */
    private function action(string $to, string $lang, string $prefix, array $vars, string $link, ?string $ignoreKey = null): array
    {
        $s = $this->strings($lang);
        $vars += ['support' => $this->app->mailSettings()->supportEmail()];
        $greeting = self::fill($s['greeting'], $vars);
        $intro = self::fill($s["{$prefix}.intro"], $vars);
        $action = self::fill($s["{$prefix}.action"], $vars);
        $ignore = $s[$ignoreKey ?? 'ignore'];
        $text = "{$greeting}\n\n{$intro}\n\n{$action}\n\n{$link}\n\n{$ignore}\n\n— {$s['brand']} · {$s['product']}\n{$s['footer']}\n";
        $body = '<p>' . self::esc($greeting) . '</p><p>' . self::esc($intro) . '</p><p>' . self::esc($action) . '</p>'
            . self::button(self::esc($s["{$prefix}.button"]), $link)
            . '<p style="font-size:13px;color:#666">' . self::esc($s['button_fallback']) . '<br><span style="word-break:break-all">' . self::esc($link) . '</span></p>'
            . '<p style="font-size:13px;color:#666">' . self::esc($ignore) . '</p>';
        return ['to' => $to, 'subject' => $s["{$prefix}.subject"], 'text' => $text, 'html' => $this->layout($body, $s, $lang)];
    }

    public function invitation(array $user, string $inviterName, string $token): array
    {
        $hours = (string) $this->app->config->int('INVITE_TTL_HOURS', 72, 1, 336);
        return $this->action($user['email'], $user['lang'], 'invite', ['name' => $user['name'], 'inviter' => $inviterName, 'hours' => $hours], $this->adminUrl('invitacion/' . $token));
    }

    /**
     * Sent once, when a new person activates their account (invitation
     * accepted): their access in plain words, first steps, how to get help and
     * how to keep the account safe. In their language.
     *
     * @return array{to:string,subject:string,text:string,html:string,embedded:list<array{path:string,cid:string,name:string,mime:string}>}
     */
    public function welcome(array $user, string $inviterName): array
    {
        $lang = ($user['lang'] ?? 'es') === 'en' ? 'en' : 'es';
        $s = $this->strings($lang);
        $e = fn (string $v) => self::esc($v);
        $first = explode(' ', trim((string) $user['name']))[0] ?: (string) $user['name'];
        $vars = ['name' => $first, 'email' => (string) $user['email'], 'support' => $this->app->mailSettings()->supportEmail()];
        $f = fn (string $key) => self::fill($s[$key], $vars);
        $perms = array_values(array_intersect(Users::PERMISSIONS, Users::permissionsOf($user)));
        $type = Users::accessTypeOf($perms);
        $label = fn (string $t) => '<div style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#7a7a82;font-family:Arial,Helvetica,sans-serif">' . $e($t) . '</div>';

        $permRows = '';
        $permText = '';
        foreach ($perms as $p) {
            $permRows .= '<tr><td valign="top" width="26" style="padding:6px 0"><div style="width:18px;height:18px;border-radius:50%;background:#f6740a;color:#1c1c1c;font:700 12px/18px Arial,Helvetica,sans-serif;text-align:center">&#10003;</div></td>'
                . '<td style="padding:5px 0 6px 6px;font-size:14px;line-height:1.45;color:#2b2b31"><strong style="color:#1c1c1c">' . $e($s['acc.perm.' . $p]) . '</strong><br><span style="color:#5c5c66">' . $e($s['acc.permHelp.' . $p]) . '</span></td></tr>';
            $permText .= '- ' . $s['acc.perm.' . $p] . ': ' . $s['acc.permHelp.' . $p] . "\n";
        }
        $steps = '';
        $stepText = '';
        foreach (['welcome.step1', 'welcome.step2', 'welcome.step3'] as $i => $key) {
            $steps .= '<tr><td valign="top" width="30" style="padding:5px 0"><div style="width:22px;height:22px;border-radius:50%;background:#1c1c1c;color:#ffffff;font:700 12px/22px Arial,Helvetica,sans-serif;text-align:center">' . ($i + 1) . '</div></td>'
                . '<td style="padding:6px 0 6px 6px;font-size:14px;line-height:1.5;color:#2b2b31">' . $e($s[$key]) . '</td></tr>';
            $stepText .= ($i + 1) . '. ' . $s[$key] . "\n";
        }
        $safety = array_map($f, ['welcome.safe1', 'welcome.safe2', 'welcome.safe3']);
        $link = $this->app->config->appUrl() . '/admin/';

        $body = '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#e8f6ec;color:#166534;border-radius:999px;padding:5px 12px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif">' . $e($s['welcome.badge']) . '</td></tr></table>'
            . '<h1 style="margin:14px 0 8px;font-size:24px;line-height:1.3;color:#1c1c1c">' . $e($f('welcome.title')) . '</h1>'
            . '<p style="margin:0 0 18px;color:#2b2b31">' . $e($f('welcome.intro')) . '</p>'
            . '<div style="margin:0 0 18px;padding:16px 18px;background:#fff8f1;border:1px solid #ffe2c7;border-radius:14px">'
            . $label($s['welcome.access'])
            . '<div style="margin:0 0 6px;font-size:17px;font-weight:800;color:#1c1c1c">' . $e($s['acc.type.' . $type]) . '</div>'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' . $permRows . '</table></div>'
            . $label($s['welcome.steps'])
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px">' . $steps . '</table>'
            . self::cta($s['welcome.button'], $link)
            . '<div style="margin:18px 0 0;padding:14px 16px;background:#f7f7f9;border-radius:12px;font-size:14px;line-height:1.5;color:#3c3c43">'
            . '<strong style="color:#1c1c1c">' . $e($s['welcome.helpTitle']) . '</strong><br>' . $e($f('welcome.help')) . '</div>'
            . '<div style="margin:16px 0 4px;font-size:13px;line-height:1.5;color:#5c5c66"><strong style="color:#3c3c43">' . $e($s['welcome.safeTitle']) . '</strong>'
            . '<ul style="margin:6px 0 0;padding-left:18px">' . implode('', array_map(fn ($l) => '<li style="margin:0 0 4px">' . $e($l) . '</li>', $safety)) . '</ul></div>';
        $footer = $inviterName !== '' ? self::fill($s['welcome.footer'], ['inviter' => $inviterName]) : $s['welcome.footerNoInviter'];
        $layout = $this->branded($lang, $s['welcome.tag'], $s['welcome.preheader'], $body, $e($footer));

        $text = $f('welcome.title') . "\n\n" . $f('welcome.intro') . "\n\n" . $s['welcome.access'] . ': ' . $s['acc.type.' . $type] . "\n" . $permText
            . "\n" . $s['welcome.steps'] . ":\n" . $stepText . "\n" . $s['welcome.button'] . ': ' . $link . "\n\n"
            . $s['welcome.helpTitle'] . ' ' . $f('welcome.help') . "\n\n" . $s['welcome.safeTitle'] . ":\n- " . implode("\n- ", $safety) . "\n\n— " . $footer . "\n";
        return ['to' => (string) $user['email'], 'subject' => $s['welcome.subject'], 'text' => $text, 'html' => $layout['html'], 'embedded' => $layout['embedded']];
    }

    public function passwordReset(array $user, string $token): array
    {
        $minutes = (string) $this->app->config->int('RESET_TTL_MINUTES', 60, 10, 1440);
        return $this->action($user['email'], $user['lang'], 'reset', ['name' => $user['name'], 'minutes' => $minutes], $this->adminUrl('restablecer/' . $token), 'reset.ignore');
    }

    public function passwordChanged(array $user): array
    {
        $s = $this->strings($user['lang']);
        $vars = ['name' => $user['name'], 'date' => date('d/m/Y H:i'), 'support' => $this->app->mailSettings()->supportEmail()];
        $lines = [self::fill($s['greeting'], $vars), self::fill($s['changed.intro'], $vars), $s['changed.sessions'], self::fill($s['changed.notyou'], $vars)];
        $text = implode("\n\n", $lines) . "\n\n— {$s['brand']} · {$s['product']}\n{$s['footer']}\n";
        $html = implode('', array_map(fn ($l) => '<p>' . self::esc($l) . '</p>', $lines));
        return ['to' => $user['email'], 'subject' => $s['changed.subject'], 'text' => $text, 'html' => $this->layout($html, $s, $user['lang'])];
    }

    /**
     * Critical-error alert for IT. Only the sanitized error-log fields are
     * included — never request bodies, cookies, tokens or configuration.
     *
     * @param array{event:string,message:string,location:string,request:string,ref:?string,created_at:int} $entry
     */
    public function criticalAlert(string $to, string $lang, array $entry, string $userLabel, int $repeats): array
    {
        $s = $this->strings($lang);
        $what = $s['alert.event.' . $entry['event']] ?? $s['alert.event.other'];
        $rows = array_filter([
            $s['alert.what'] => $what,
            $s['alert.message'] => $entry['message'],
            $s['alert.location'] => $entry['location'],
            $s['alert.request'] => $entry['request'],
            $s['alert.ref'] => (string) $entry['ref'],
            $s['alert.user'] => $userLabel !== '' ? $userLabel : $s['alert.nouser'],
            $s['alert.time'] => date('Y-m-d H:i:s T', $entry['created_at']),
            $s['alert.site'] => $this->app->config->appUrl() . ' · ' . $this->app->version(),
            $s['alert.repeats'] => $repeats > 0 ? (string) $repeats : '',
        ], fn ($v) => $v !== '');
        $link = $this->adminUrl('monitoreo');
        $throttle = self::fill($s['alert.throttle'], [
            'minutes' => (string) $this->app->config->int('ALERT_COOLDOWN_MINUTES', 60, 0, 1440),
            'max' => (string) $this->app->config->int('ALERT_DAILY_MAX', 20, 1, 500),
        ]);
        $text = $s['alert.intro'] . "\n\n";
        foreach ($rows as $k => $v) {
            $text .= "{$k}: {$v}\n";
        }
        $text .= "\n{$s['alert.action']}\n{$link}\n\n{$throttle}\n\n— {$s['brand']} · {$s['product']}\n{$s['footer']}\n";
        $table = '';
        foreach ($rows as $k => $v) {
            $table .= '<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top;white-space:nowrap">' . self::esc($k)
                . '</td><td style="padding:4px 0;word-break:break-word">' . self::esc($v) . '</td></tr>';
        }
        $body = '<p>' . self::esc($s['alert.intro']) . '</p><table style="border-collapse:collapse;font-size:14px">' . $table . '</table>'
            . '<p>' . self::esc($s['alert.action']) . '</p>' . self::button(self::esc($s['alert.button']), $link)
            . '<p style="font-size:13px;color:#666">' . self::esc($throttle) . '</p>';
        return ['to' => $to, 'subject' => self::fill($s['alert.subject'], ['what' => $what]), 'text' => $text, 'html' => $this->layout($body, $s, $lang)];
    }

    /** One message listing critical alerts that failed to send earlier. @param list<array> $entries */
    public function alertDigest(string $to, string $lang, array $entries): array
    {
        $s = $this->strings($lang);
        $lines = array_map(fn ($e) => date('Y-m-d H:i', (int) $e['created_at']) . ' — ' . ($s['alert.event.' . $e['event']] ?? $s['alert.event.other'])
            . ($e['message'] !== '' ? ': ' . $e['message'] : '') . ($e['ref'] ? " ({$e['ref']})" : ''), $entries);
        $link = $this->adminUrl('monitoreo');
        $text = $s['digest.intro'] . "\n\n" . implode("\n", $lines) . "\n\n{$s['alert.action']}\n{$link}\n\n— {$s['brand']} · {$s['product']}\n";
        $body = '<p>' . self::esc($s['digest.intro']) . '</p><ul>' . implode('', array_map(fn ($l) => '<li>' . self::esc($l) . '</li>', $lines)) . '</ul>'
            . '<p>' . self::esc($s['alert.action']) . '</p>' . self::button(self::esc($s['alert.button']), $link);
        return ['to' => $to, 'subject' => self::fill($s['digest.subject'], ['n' => (string) count($entries)]), 'text' => $text, 'html' => $this->layout($body, $s, $lang)];
    }

    public function alertTest(string $to, string $lang, string $requestedBy): array
    {
        $s = $this->strings($lang);
        $lines = [$s['test.intro'], self::fill($s['test.ok'], ['to' => $to]), self::fill($s['test.by'], ['name' => $requestedBy]), date('Y-m-d H:i:s T')];
        $html = implode('', array_map(fn ($l) => '<p>' . self::esc($l) . '</p>', $lines));
        return ['to' => $to, 'subject' => $s['test.subject'], 'text' => implode("\n\n", $lines) . "\n", 'html' => $this->layout($html, $s, $lang)];
    }

    /**
     * Branded layout for the richer messages (support reports, the monthly
     * site report): dark header with the logo embedded in the message (no
     * remote images to block), orange brand line, white card, light footer.
     * Table-based with inline styles so it renders in Gmail, Outlook and
     * phone mail apps.
     *
     * @return array{html:string, embedded:list<array{path:string,cid:string,name:string,mime:string}>}
     */
    public function branded(string $lang, string $tag, string $preheader, string $body, string $footer): array
    {
        $logo = $this->app->root('resources/email-logo.png');
        $embedded = is_file($logo) ? [['path' => $logo, 'cid' => 'sensum-logo', 'name' => 'sensum.png', 'mime' => 'image/png']] : [];
        $logoCell = $embedded
            ? '<td width="52" valign="middle" style="padding:0 12px 0 0"><img src="cid:sensum-logo" width="44" height="44" alt="" style="display:block;border:0;border-radius:10px"></td>'
            : '';
        $html = '<!DOCTYPE html><html lang="' . ($lang === 'en' ? 'en' : 'es') . '"><head><meta charset="UTF-8">'
            . '<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><title></title></head>'
            . '<body style="margin:0;padding:0;background:#eeeef1;-webkit-text-size-adjust:100%">'
            // Hidden preview text shown by mail apps next to the subject.
            . '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#eeeef1">' . self::esc($preheader) . '</div>'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eeeef1"><tr><td align="center" style="padding:28px 12px">'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 6px 24px rgba(20,20,30,.08)">'
            . '<tr><td style="background:#1c1c1c;padding:18px 24px">'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' . $logoCell
            . '<td valign="middle" style="font-family:Arial,Helvetica,sans-serif;color:#ffffff">'
            . '<div style="font-size:18px;font-weight:800;letter-spacing:.14em;line-height:1">SENSUM</div>'
            . '<div style="font-size:9px;font-weight:700;letter-spacing:.42em;color:#ffaa0b;margin-top:5px">CONSTRUCCIONES</div></td>'
            . '<td align="right" valign="middle" style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#bdbdc2">' . self::esc($tag) . '</td>'
            . '</tr></table></td></tr>'
            . '<tr><td height="4" style="height:4px;line-height:4px;font-size:0;background:#f6740a;background-image:linear-gradient(90deg,#f6740a,#ffaa0b)">&nbsp;</td></tr>'
            . '<tr><td style="padding:28px 28px 8px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2328;font-size:15px;line-height:1.6">' . $body . '</td></tr>'
            . '<tr><td style="padding:18px 28px 24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.55;color:#7a7a82;border-top:1px solid #efeff2">' . $footer . '</td></tr>'
            . '</table>'
            . '<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#9a9aa2;padding:14px 8px">sensumconstrucciones.com</div>'
            . '</td></tr></table></body></html>';
        return ['html' => $html, 'embedded' => $embedded];
    }

    /** A rounded call-to-action button for the branded layout. */
    public static function cta(string $label, string $url): string
    {
        return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 10px"><tr><td style="border-radius:10px;background:#f6740a">'
            . '<a href="' . self::esc($url) . '" style="display:inline-block;padding:13px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#1c1c1c;text-decoration:none;border-radius:10px">'
            . self::esc($label) . '</a></td></tr></table>';
    }

    public static function esc(string $s): string
    {
        return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
    }

    private static function button(string $label, string $url): string
    {
        return '<p style="margin:24px 0"><a href="' . self::esc($url) . '" style="display:inline-block;background:#f6740a;color:#1c1c1c;'
            . 'font-weight:700;text-decoration:none;padding:12px 22px;border-radius:8px">' . $label . '</a></p>';
    }

    public function layout(string $body, array $s, string $lang): string
    {
        return '<!DOCTYPE html><html lang="' . ($lang === 'en' ? 'en' : 'es') . '"><head><meta charset="UTF-8">'
            . '<meta name="viewport" content="width=device-width, initial-scale=1"></head>'
            . '<body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1c1c">'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px"><tr><td align="center">'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">'
            . '<tr><td style="background:#1c1c1c;padding:18px 24px;color:#ffffff;font-weight:700;letter-spacing:.02em">'
            . self::esc($s['brand']) . ' <span style="color:#ffaa0b;font-weight:600">· ' . self::esc($s['product']) . '</span></td></tr>'
            . '<tr><td style="padding:24px;font-size:15px;line-height:1.55">' . $body . '</td></tr>'
            . '<tr><td style="padding:16px 24px;background:#fafafa;font-size:12px;color:#777">' . self::esc($s['footer']) . '</td></tr>'
            . '</table></td></tr></table></body></html>';
    }
}
