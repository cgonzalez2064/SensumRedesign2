<?php
declare(strict_types=1);

namespace Sensum\Cms;

/**
 * Publishes managed content into the approved static pages.
 *
 * index.html, 404.html and privacy-notice.html are rendered from
 * cms/templates/*.tpl with the current content. With unchanged content the
 * output is byte-identical to the approved pages, so the public site keeps
 * running as plain static files — no PHP or database on the visitor's path.
 *
 * Safety: output is validated before anything is written; the current live
 * files are backed up (last 30 publishes kept); each file is replaced with an
 * atomic rename, so a visitor never sees a half-written page.
 */
final class Publisher
{
    /** Bump when assets/main.css or assets/main.js change (cache busting). */
    public const ASSET_VERSION = '3';
    public const PAGES = ['index.html', '404.html', 'privacy-notice.html'];
    private const BACKUPS_KEPT = 30;

    /** Default text of keys that are not editable but derive from editable ones. */
    private const DERIVED_DEFAULTS = [
        'projects.cta_aria' => ['es' => 'Descargar nuestro portafolio de proyectos en PDF', 'en' => 'Download our project portfolio (PDF)'],
    ];
    private const DEFAULT_PORTFOLIO = 'assets/portfolio/sensum-portafolio-proyectos.pdf';

    public function __construct(private App $app)
    {
    }

    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------

    /** @return array<string,string> page file name => HTML */
    public function render(): array
    {
        [$vars, $flags] = $this->buildViewModel();
        $out = [];
        foreach (self::PAGES as $page) {
            $tpl = (string) file_get_contents($this->app->root("templates/{$page}.tpl"));
            $out[$page] = Template::render($tpl, $vars, $flags);
        }
        $this->assertValid($out);
        return $out;
    }

    public static function e(string $s): string
    {
        return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
    }

    /** Attribute-safe URL that keeps already-valid "&" separators readable. */
    public static function attrUrl(string $url): string
    {
        $url = preg_replace('/&(?=#?[A-Za-z0-9]+;)/', '&amp;', $url) ?? '';
        return str_replace(['"', '<', '>', "'"], ['&quot;', '&lt;', '&gt;', '&#39;'], $url);
    }

    /** "Construcción con *precisión*" → "Construcción con <em>precisión</em>" (text escaped first). */
    public static function emphasis(string $text): string
    {
        return preg_replace('/\*([^*]+)\*/u', '<em>$1</em>', self::e($text)) ?? self::e($text);
    }

    private static function ld(mixed $v): string
    {
        return (string) json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG);
    }

    /** Local Guatemalan numbers get the +502 prefix for tel: links. */
    public static function telHref(string $phone): string
    {
        $digits = preg_replace('/\D/', '', $phone) ?? '';
        if (str_starts_with(trim($phone), '+') || strlen($digits) > 8) {
            return '+' . $digits;
        }
        return '+502' . $digits;
    }

    /** "2256-7954" → "2256&#8209;7954" (non-breaking hyphen, as in the approved markup). */
    public static function phoneDisplay(string $phone): string
    {
        return str_replace('-', '&#8209;', self::e($phone));
    }

    /** "2256-7954" → "+502-2256-7954" (structured-data format used by the approved page). */
    public static function phoneLd(string $phone): string
    {
        $href = self::telHref($phone);
        $local = preg_replace('/^\+?502\s*/', '', trim($phone)) ?? $phone;
        if (str_starts_with($href, '+502') && preg_match('/^\d{4}-?\d{4}$/', preg_replace('/\s/', '', $local) ?? '')) {
            $d = substr($href, 4);
            return '+502-' . substr($d, 0, 4) . '-' . substr($d, 4);
        }
        return $href;
    }

    /** @return array{0:array<string,string>,1:array<string,bool>} */
    public function buildViewModel(): array
    {
        $schema = $this->app->schema();
        $values = $this->app->content()->values();
        $val = fn (string $k, string $l = 'es') => (string) ($values[$k][$l] ?? $values[$k]['*'] ?? '');
        $vars = ['asset_version' => self::ASSET_VERSION];
        $flags = [];

        // Bilingual text.
        foreach ($schema->fields() as $key => $f) {
            if ($f['bilingual']) {
                $vars["t:{$key}"] = self::e($val($key));
            }
        }
        $vars['em:hero.title'] = self::emphasis($val('hero.title'));

        // Business details.
        $office = $val('contact.phone_office');
        $mobile = $val('contact.phone_mobile');
        $email = $val('contact.email');
        $wa = $val('contact.whatsapp');
        $building = $val('contact.address_building');
        $street = $val('contact.address_street');
        $officeNo = $val('contact.address_office');
        $city = $val('contact.address_city');
        $join = fn (array $parts) => implode(', ', array_values(array_filter($parts, fn ($p) => $p !== '')));
        $officeShort = preg_replace('/^Oficina\s+/u', 'Of. ', $officeNo) ?? $officeNo;

        $tel = fn (string $p) => '<a href="tel:' . self::telHref($p) . '">' . self::phoneDisplay($p) . '</a>';
        $vars['phones_contact_html'] = $tel($office) . ($mobile !== '' ? ' &nbsp;/&nbsp; ' . $tel($mobile) : '');
        $vars['phones_footer_html'] = '<a href="tel:' . self::telHref($office) . '">' . self::phoneDisplay($office)
            . ($mobile !== '' ? '&nbsp;/&nbsp;' . self::phoneDisplay($mobile) : '') . '</a>';
        $vars['phones_privacy_html'] = $tel($office) . ($mobile !== '' ? " /\n      " . $tel($mobile) : '');
        $vars['phone_office_link'] = $tel($office);
        $vars['email_link'] = '<a href="mailto:' . self::e($email) . '">' . self::e($email) . '</a>';
        $vars['whatsapp'] = self::e($wa);
        $vars['whatsapp_text_url'] = rawurlencode($val('whatsapp.message'));
        $vars['address_full'] = self::e($join([$building, $street, $officeNo, $city]));
        $vars['address_short'] = self::e($join([$building, $street, $officeShort]));
        $vars['address_map'] = self::e($join([$street, $officeNo, $city]));
        $vars['map_title'] = self::e($val('contact.map_title'));
        $vars['maps_url'] = self::attrUrl($val('contact.maps_url'));
        $vars['instagram_url'] = self::attrUrl($val('contact.instagram_url'));
        $vars['instagram_handle'] = self::e($val('contact.instagram_handle'));
        $fallback = $this->formFallback($office, $email, $wa);
        $vars['form_fallback_html'] = $fallback['es'];

        // Structured data (JSON-LD) mirrors the visible content.
        $vars['ld:telephones'] = '[' . implode(', ', array_map(fn ($p) => self::ld(self::phoneLd($p)), array_values(array_filter([$office, $mobile])))) . ']';
        $vars['ld:email'] = self::ld($email);
        $vars['ld:street_address'] = self::ld($join([$building, $street, $officeNo]));
        $vars['ld:city'] = self::ld($city);
        $vars['ld:instagram_url'] = self::ld($val('contact.instagram_url'));
        foreach (range(1, 6) as $i) {
            $vars["ld:service{$i}.title"] = self::ld($val("service{$i}.title"));
            $vars["ld:service{$i}.desc"] = self::ld($val("service{$i}.desc"));
            $vars["ld:faq.q{$i}"] = self::ld($val("faq.q{$i}"));
            $vars["ld:faq.a{$i}"] = self::ld($val("faq.a{$i}"));
        }
        // The structured opening hours are only correct for the approved hours
        // text; if the client edits the hours, drop them rather than publish
        // data that contradicts the page.
        $flags['ld_hours'] = $val('contact.hours_value') === $schema->default('contact.hours_value', 'es');

        // Photos and documents.
        $media = $this->app->media();
        $overrides = ['es' => [], 'en' => []];
        $images = [];
        foreach (range(1, 6) as $i) {
            $pid = "proj{$i}";
            $card = $media->items("{$pid}.card")[0] ?? null;
            $gallery = $media->items("{$pid}.gallery");
            $flags["has_card_photo:{$pid}"] = (bool) $card;
            $vars["card_photo:{$pid}"] = '';
            if ($card) {
                $altKey = "media.{$pid}.card.alt";
                [$altEs, $altEn] = $this->alts($card, $val("{$pid}.title", 'es'), $val("{$pid}.title", 'en'));
                $overrides['es'][$altKey] = $altEs;
                $overrides['en'][$altKey] = $altEn;
                $vars["card_photo:{$pid}"] = $this->imgTag($card, 'case-photo', $altEs, $altKey, $media->slot("{$pid}.card")['sizes']);
            }
            // The modal carousel shows the gallery; with no gallery it falls
            // back to the card photo, and with neither it keeps the approved
            // illustration placeholders.
            $carousel = $gallery ?: ($card ? [$card] : []);
            $paths = [];
            foreach ($carousel as $row) {
                $path = $media->path($row, 1600);
                $paths[] = $path;
                $fallbackEs = '';
                $fallbackEn = '';
                if ($row === $card) {
                    [$fallbackEs, $fallbackEn] = $this->alts($card, $val("{$pid}.title", 'es'), $val("{$pid}.title", 'en'));
                }
                $images[$path] = array_filter([
                    'alt' => array_filter(['es' => $row['alt_es'] ?: $fallbackEs, 'en' => ($row['alt_en'] ?: $row['alt_es']) ?: $fallbackEn]),
                    'srcset' => $media->srcset($row),
                ]);
            }
            $vars["gallery:{$pid}"] = self::e(implode(', ', $paths));
        }

        $about = $media->items('about.photo')[0] ?? null;
        $flags['has_about_photo'] = (bool) $about;
        $vars['about_art_class'] = $about ? ' has-photo' : '';
        $vars['about_photo'] = '';
        if ($about) {
            [$altEs, $altEn] = $this->alts($about, $val('about.title', 'es'), $val('about.title', 'en'));
            $overrides['es']['media.about.alt'] = $altEs;
            $overrides['en']['media.about.alt'] = $altEn;
            $vars['about_photo'] = $this->imgTag($about, 'about-photo', $altEs, 'media.about.alt', $media->slot('about.photo')['sizes']);
        }

        $pdf = $media->items('portfolio.pdf')[0] ?? null;
        $vars['portfolio_href'] = $pdf ? self::e($media->path($pdf)) : self::DEFAULT_PORTFOLIO;

        // Text overrides for the public ES/EN toggle (assets/main.js).
        foreach ($schema->fields() as $key => $f) {
            if (!$f['bilingual']) {
                continue;
            }
            foreach (['es', 'en'] as $lang) {
                $v = $val($key, $lang);
                if ($v === $schema->default($key, $lang)) {
                    continue;
                }
                // Highlighted titles become HTML (text already escaped); plain
                // values stay plain text and are applied with textContent.
                $overrides[$lang][$key] = ($f['type'] === 'emphasis' && str_contains($v, '*')) ? self::emphasis($v) : $v;
            }
        }
        foreach (['es', 'en'] as $lang) {
            $cta = $val('projects.cta', $lang);
            $aria = $cta === $schema->default('projects.cta', $lang) ? self::DERIVED_DEFAULTS['projects.cta_aria'][$lang] : $cta . ' (PDF)';
            if ($lang === 'es') {
                $vars['projects_cta_aria'] = self::e($aria);
            }
            if ($aria !== self::DERIVED_DEFAULTS['projects.cta_aria'][$lang]) {
                $overrides[$lang]['projects.cta_aria'] = $aria;
            }
        }
        $defaultFallback = $this->formFallback(
            $schema->default('contact.phone_office', '*'),
            $schema->default('contact.email', '*'),
            $schema->default('contact.whatsapp', '*')
        );
        foreach (['es', 'en'] as $lang) {
            if ($fallback[$lang] !== $defaultFallback[$lang]) {
                $overrides[$lang]['form.fallback'] = $fallback[$lang];
            }
        }

        $data = array_filter([
            'i18n' => array_filter($overrides),
            'whatsapp' => $wa !== $schema->default('contact.whatsapp', '*') ? $wa : null,
            'images' => $images ?: null,
        ]);
        $vars['site_content_script'] = $data
            ? '<script type="application/json" id="siteContent">' . json_encode(['v' => 1] + $data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP) . "</script>\n"
            : '';

        $vars['extra_scripts'] = $this->extraScripts();
        return [$vars, $flags];
    }

    /** [es, en] alt text with sensible fallbacks. */
    private function alts(array $row, string $fallbackEs, string $fallbackEn): array
    {
        $es = $row['alt_es'] !== '' ? (string) $row['alt_es'] : $fallbackEs;
        $en = $row['alt_en'] !== '' ? (string) $row['alt_en'] : ($row['alt_es'] !== '' ? (string) $row['alt_es'] : $fallbackEn);
        return [$es, $en];
    }

    private function imgTag(array $row, string $class, string $alt, string $altKey, string $sizes): string
    {
        $media = $this->app->media();
        return '<img class="' . $class . '" src="' . self::e($media->path($row, 1600)) . '" srcset="' . self::e($media->srcset($row)) . '"'
            . ' sizes="' . self::e($sizes) . '" width="' . (int) $row['width'] . '" height="' . (int) $row['height'] . '"'
            . ' alt="' . self::e($alt) . '" data-i18n-attr="alt:' . $altKey . '" loading="lazy" decoding="async">';
    }

    /** The contact form's "prefer not to use the form?" sentence, ES and EN. */
    private function formFallback(string $phone, string $email, string $wa): array
    {
        $tel = 'tel:' . self::telHref($phone);
        $mail = 'mailto:' . self::e($email);
        $waUrl = 'https://wa.me/' . self::e($wa);
        return [
            'es' => '¿Prefieres no usar el formulario? Escríbenos por <a href="' . $tel . '">teléfono</a>, <a href="' . $mail . '">correo</a> o <a href="' . $waUrl . '" target="_blank" rel="noopener noreferrer">WhatsApp</a>.',
            'en' => 'Prefer not to use the form? Write to us by <a href="' . $tel . '">phone</a>, <a href="' . $mail . '">email</a>, or <a href="' . $waUrl . '" target="_blank" rel="noopener noreferrer">WhatsApp</a>.',
        ];
    }

    /** Optional telemetry, switched on only through the server's .env file. */
    private function extraScripts(): string
    {
        $out = [];
        if ($this->app->config->bool('PUBLIC_ERROR_REPORTING')) {
            $out[] = '<script src="assets/error-reporter.js?v=' . self::ASSET_VERSION . '" defer></script>';
        }
        $token = strtolower($this->app->config->string('CF_WEB_ANALYTICS_TOKEN'));
        if (preg_match('/^[a-f0-9]{32}$/', $token)) {
            $out[] = '<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon=\'{"token": "' . $token . '"}\'></script>';
        }
        return implode("\n", $out);
    }

    /** Refuses to publish anything that is not a complete, well-formed page. */
    private function assertValid(array $pages): void
    {
        foreach ($pages as $name => $html) {
            if (strlen($html) < 1000 || !str_contains($html, '</html>') || str_contains($html, '{{')) {
                throw new \RuntimeException("publish_invalid_output:{$name}");
            }
            if (preg_match_all('#<script type="application/(?:ld\+)?json"[^>]*>(.*?)</script>#s', $html, $m)) {
                foreach ($m[1] as $json) {
                    json_decode($json, true, 64, JSON_THROW_ON_ERROR);
                }
            }
        }
        if (!str_contains($pages['index.html'], 'id="contactForm"') || !str_contains($pages['index.html'], 'assets/main.js?v=')) {
            throw new \RuntimeException('publish_invalid_output:index.html');
        }
    }

    // ------------------------------------------------------------------
    // Writing
    // ------------------------------------------------------------------

    /**
     * Renders and atomically replaces the public pages.
     * @return array{published_at:int, changed:list<string>, drift:list<string>}
     */
    public function publish(?int $userId, string $reason = 'content'): array
    {
        $pages = $this->render();
        if (!is_dir($this->app->publicPath())) {
            @mkdir($this->app->publicPath(), 0755, true); // local overlay folder only
        }
        $lockFile = fopen($this->app->storage('publish.lock'), 'c');
        if (!$lockFile || !flock($lockFile, LOCK_EX)) {
            throw new \RuntimeException('publish_lock_failed');
        }
        try {
            $settings = $this->app->settings();
            $known = $settings->getJson('published_hashes');
            $drift = [];
            $changed = [];
            $backupDir = $this->app->storageDir('backups/published/' . date('Ymd-His') . '-' . bin2hex(random_bytes(2)));
            $hashes = [];
            foreach ($pages as $name => $html) {
                $target = $this->app->publicPath($name);
                $current = is_file($target) ? (string) file_get_contents($target) : null;
                $hashes[$name] = hash('sha256', $html);
                if ($current !== null) {
                    // Someone edited/replaced the live file outside the Content
                    // Manager (e.g. a deployment). It is backed up below either way.
                    if (isset($known[$name]) && $known[$name] !== hash('sha256', $current)) {
                        $drift[] = $name;
                    }
                    copy($target, "{$backupDir}/{$name}");
                }
                if ($current === $html) {
                    continue;
                }
                $tmp = $this->app->publicPath('.' . $name . '.tmp-' . bin2hex(random_bytes(4)));
                if (file_put_contents($tmp, $html, LOCK_EX) !== strlen($html) || !@rename($tmp, $target)) {
                    @unlink($tmp);
                    throw new \RuntimeException('publish_write_failed');
                }
                @chmod($target, 0644);
                $changed[] = $name;
            }
            if (!$changed && !$drift) {
                // Nothing new: don't keep an identical backup.
                array_map('unlink', glob("{$backupDir}/*") ?: []);
                @rmdir($backupDir);
            }
            $this->pruneBackups();
            $now = time();
            $settings->setJson('published_hashes', $hashes);
            $settings->set('last_published_at', (string) $now);
            $settings->set('last_published_by', (string) ($userId ?? 0));
            if ($drift) {
                $settings->setJson('last_drift', ['at' => $now, 'files' => $drift]);
                $this->app->logger()->warning('publish_drift_detected', ['files' => $drift]);
            }
            $this->app->media()->collectGarbage();
            $this->app->activity($userId, 'publish', $reason, ['changed' => $changed, 'drift' => $drift]);
            return ['published_at' => $now, 'changed' => $changed, 'drift' => $drift];
        } finally {
            flock($lockFile, LOCK_UN);
            fclose($lockFile);
        }
    }

    private function pruneBackups(): void
    {
        $dirs = glob($this->app->storage('backups/published') . '/*', GLOB_ONLYDIR) ?: [];
        rsort($dirs, SORT_STRING);
        foreach (array_slice($dirs, self::BACKUPS_KEPT) as $dir) {
            array_map('unlink', glob("{$dir}/*") ?: []);
            @rmdir($dir);
        }
    }

    /** @return list<array{id:string, files:list<string>}> newest first */
    public function backups(): array
    {
        $dirs = glob($this->app->storage('backups/published') . '/*', GLOB_ONLYDIR) ?: [];
        rsort($dirs, SORT_STRING);
        return array_map(fn ($d) => ['id' => basename($d), 'files' => array_map('basename', glob("{$d}/*") ?: [])], $dirs);
    }
}
