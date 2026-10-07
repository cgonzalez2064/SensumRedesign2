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
        $vars += ['support' => $this->app->config->supportEmail()];
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

    public function passwordReset(array $user, string $token): array
    {
        $minutes = (string) $this->app->config->int('RESET_TTL_MINUTES', 60, 10, 1440);
        return $this->action($user['email'], $user['lang'], 'reset', ['name' => $user['name'], 'minutes' => $minutes], $this->adminUrl('restablecer/' . $token), 'reset.ignore');
    }

    public function passwordChanged(array $user): array
    {
        $s = $this->strings($user['lang']);
        $vars = ['name' => $user['name'], 'date' => date('d/m/Y H:i'), 'support' => $this->app->config->supportEmail()];
        $lines = [self::fill($s['greeting'], $vars), self::fill($s['changed.intro'], $vars), $s['changed.sessions'], self::fill($s['changed.notyou'], $vars)];
        $text = implode("\n\n", $lines) . "\n\n— {$s['brand']} · {$s['product']}\n{$s['footer']}\n";
        $html = implode('', array_map(fn ($l) => '<p>' . self::esc($l) . '</p>', $lines));
        return ['to' => $user['email'], 'subject' => $s['changed.subject'], 'text' => $text, 'html' => $this->layout($html, $s, $user['lang'])];
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
