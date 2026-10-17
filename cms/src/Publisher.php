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
    public const ASSET_VERSION = '7';
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

        // Contact form: the questions (Sitio web → Formulario de contacto). Texts for
        // the ES/EN toggle travel as "form.*" overrides when they differ from the
        // built-in dictionary of assets/main.js.
        [$vars['form_fields_html'], $serviceOverrides] = $this->formFields();
        // Optional Cloudflare Turnstile on the contact form (owner → Correo).
        $turnstile = $this->app->mailSettings()->turnstile();
        $flags['turnstile'] = $turnstile['siteKey'] !== '' && $turnstile['secret'] !== '';
        $vars['turnstile_site_key'] = self::e($turnstile['siteKey']);

        // Structured data (JSON-LD) mirrors the visible content.
        $vars['ld:telephones'] = '[' . implode(', ', array_map(fn ($p) => self::ld(self::phoneLd($p)), array_values(array_filter([$office, $mobile])))) . ']';
        $vars['ld:meta.description'] = self::ld($val('meta.description'));
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
        $overrides = $serviceOverrides; // starts with the contact-form options (above)
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
        $vars += $this->privacyTexts();
        return [$vars, $flags];
    }

    /**
     * The contact form's questions as the page shows them, plus the ES/EN
     * texts the language toggle needs. With the approved questions the markup
     * is exactly the hand-written original (core fields keep their ids, names
     * and messages); extra questions follow the same structure.
     * @return array{0:string,1:array{es:array<string,string>,en:array<string,string>}}
     */
    private function formFields(): array
    {
        $over = ['es' => [], 'en' => []];
        $text = function (string $key, array $pair, ?array $builtIn = null) use (&$over): void {
            $en = $pair['en'] !== '' ? $pair['en'] : $pair['es'];
            if ($builtIn === null || $builtIn[0] !== $pair['es']) {
                $over['es'][$key] = $pair['es'];
            }
            if ($builtIn === null || $builtIn[1] !== $en) {
                $over['en'][$key] = $en;
            }
        };
        $errIcon = '<svg class="err-icon" aria-hidden="true" viewBox="0 0 16 16" fill="currentColor"><path d="M7.938 2.016A.13.13 0 0 1 8.002 2a.13.13 0 0 1 .063.016.15.15 0 0 1 .054.057l6.857 11.667c.036.06.035.124.002.183a.2.2 0 0 1-.054.06.1.1 0 0 1-.066.017H1.146a.1.1 0 0 1-.066-.017.2.2 0 0 1-.054-.06.18.18 0 0 1 .002-.183L7.884 2.073a.15.15 0 0 1 .054-.057m1.044-.45a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767z"/><path d="M7.002 12a1 1 0 1 1 2 0 1 1 0 0 1-2 0M7.1 5.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0z"/></svg>';
        // Error message per question: the core fields keep theirs.
        $errKey = fn (array $f) => match (true) {
            $f['core'] !== null => 'form.' . $f['core'] . '_err',
            $f['type'] === 'email' => 'form.email_err',
            $f['type'] === 'tel' => 'form.phone_err',
            $f['type'] === 'number' => 'form.err_number',
            $f['type'] === 'date' => 'form.err_date',
            in_array($f['type'], ContactFormFields::WITH_OPTIONS, true) => 'form.err_choose',
            default => 'form.err_required',
        };
        $errText = [
            'form.name_err' => 'Ingresa tu nombre completo.', 'form.phone_err' => 'Ingresa un número de teléfono válido.',
            'form.email_err' => 'Ingresa un correo electrónico válido.', 'form.service_err' => 'Selecciona el servicio que te interesa.',
            'form.message_err' => 'Cuéntanos un poco más sobre tu proyecto (mínimo 10 caracteres).', 'form.err_number' => 'Ingresa un número válido.',
            'form.err_date' => 'Elige una fecha válida.', 'form.err_choose' => 'Elige una opción.', 'form.err_required' => 'Completa este campo.',
        ];
        $render = function (array $f, string $ind, bool $helpSlot) use ($text, $errIcon, $errKey, $errText): string {
            $id = $f['id'];
            $core = $f['core'];
            $e = fn (string $v) => self::e($v);
            $labelKey = $core !== null ? "form.{$core}_label" : "form.{$id}_label";
            $text($labelKey, $f['label'], $core !== null ? ContactFormFields::CORE_LABELS[$core] : null);
            $hasHelp = $f['help']['es'] !== '';
            if ($hasHelp) {
                $text("form.{$id}_help", $f['help']);
            }
            $describedBy = ($hasHelp ? "{$id}-help " : '') . "{$id}-error";
            $req = $f['required'] ? ' required' : '';
            // Optional questions say so; required ones look exactly like the original.
            $labelInner = $f['required']
                ? null
                : '<span data-i18n="' . $e($labelKey) . '">' . $e($f['label']['es']) . '</span> <span class="field-opt" data-i18n="form.optional">(opcional)</span>';
            $label = $labelInner === null
                ? '<label for="' . $e($id) . '" data-i18n="' . $e($labelKey) . '">' . $e($f['label']['es']) . '</label>'
                : '<label for="' . $e($id) . '">' . $labelInner . '</label>';
            $help = $hasHelp ? '<small class="field-help" id="' . $e($id) . '-help" data-i18n="' . $e("form.{$id}_help") . '">' . $e($f['help']['es']) . '</small>'
                : ($helpSlot ? '<small class="field-help" aria-hidden="true"></small>' : '');
            $ek = $errKey($f);
            $err = '<small class="err" id="' . $e($id) . '-error">' . $errIcon . '<span data-i18n="' . $ek . '">' . $e($errText[$ek]) . '</span></small>';
            $aria = ' aria-describedby="' . $e($describedBy) . '" aria-invalid="false"';
            $lines = [];
            $control = match ($f['type']) {
                'text' => $core === 'name'
                    ? '<input type="text" id="name" name="name" autocomplete="name"' . $req . ' minlength="2" maxlength="' . (int) $f['max'] . '"' . $aria . '>'
                    : '<input type="text" id="' . $e($id) . '" name="' . $e($id) . '" autocomplete="off"' . $req . ' maxlength="' . (int) $f['max'] . '"' . $aria . '>',
                'tel' => '<input type="tel" id="' . $e($id) . '" name="' . $e($id) . '" autocomplete="' . ($core === 'phone' ? 'tel' : 'off') . '"' . $req . ' pattern="[\d\s\(\)+\-]{8,}" maxlength="30"' . $aria . '>',
                'email' => '<input type="email" id="' . $e($id) . '" name="' . $e($id) . '" autocomplete="' . ($core === 'email' ? 'email' : 'off') . '"' . $req . ' maxlength="180"' . $aria . '>',
                'number' => '<input type="number" id="' . $e($id) . '" name="' . $e($id) . '" inputmode="decimal" step="any"' . ($f['min'] !== null ? ' min="' . $e((string) $f['min']) . '"' : '') . ($f['max'] !== null ? ' max="' . $e((string) $f['max']) . '"' : '') . $req . $aria . '>',
                'date' => '<input type="date" id="' . $e($id) . '" name="' . $e($id) . '"' . ($f['future'] ? ' data-future' : '') . $req . $aria . '>',
                'textarea' => $core === 'message'
                    ? '<textarea id="message" name="message"' . $req . ' minlength="10" maxlength="' . (int) $f['max'] . '"' . $aria . '></textarea>'
                    : '<textarea id="' . $e($id) . '" name="' . $e($id) . '"' . $req . ' maxlength="' . (int) $f['max'] . '"' . $aria . '></textarea>',
                default => null,
            };
            if ($f['type'] === 'select') {
                $placeholderKey = $core === 'service' ? 'form.opt_placeholder' : 'form.choose';
                $opts = ['<option value="" selected disabled data-i18n="' . $placeholderKey . '">' . ($core === 'service' ? 'Selecciona un servicio' : 'Selecciona una opción') . '</option>'];
                foreach ($f['options'] as $o) {
                    $key = $core === 'service' ? 'form.opt_' . $o['id'] : "form.{$id}_{$o['id']}";
                    $text($key, $o, $core === 'service' ? (ContactServices::DEFAULTS[$o['id']] ?? null) : null);
                    $opts[] = '<option value="' . $e($o['id']) . '" data-i18n="' . $e($key) . '">' . $e($o['es']) . '</option>';
                }
                $control = '<select id="' . $e($id) . '" name="' . $e($id) . '" autocomplete="off"' . $req . $aria . ">\n{$ind}    " . implode("\n{$ind}    ", $opts) . "\n{$ind}  </select>";
            }
            if ($f['type'] === 'radio' || $f['type'] === 'checkbox') {
                $choices = [];
                foreach ($f['options'] as $o) {
                    $key = "form.{$id}_{$o['id']}";
                    $text($key, $o);
                    $choices[] = '<label class="choice"><input type="' . $f['type'] . '" name="' . $e($id) . ($f['type'] === 'checkbox' ? '[]' : '') . '" value="' . $e($o['id']) . '"'
                        . ($f['type'] === 'radio' ? $req : '') . ' aria-invalid="false"><span data-i18n="' . $e($key) . '">' . $e($o['es']) . '</span></label>';
                }
                $legend = '<legend' . ($labelInner === null ? ' data-i18n="' . $e($labelKey) . '">' . $e($f['label']['es']) : '>' . $labelInner) . '</legend>';
                $lines[] = '<div class="field' . ($f['type'] === 'checkbox' && $f['required'] ? '" data-required="true' : '') . '">';
                $lines[] = '  <fieldset aria-describedby="' . $e($describedBy) . '">';
                $lines[] = '    ' . $legend;
                if ($hasHelp) {
                    $lines[] = '    ' . $help;
                }
                $lines[] = '    <div class="choices">';
                foreach ($choices as $c) {
                    $lines[] = '      ' . $c;
                }
                $lines[] = '    </div>';
                $lines[] = '  </fieldset>';
                $lines[] = '  ' . $err;
                $lines[] = '</div>';
            } else {
                $lines = array_values(array_filter(['<div class="field">', '  ' . $label, $help !== '' ? '  ' . $help : null, '  ' . $control, '  ' . $err, '</div>']));
            }
            return implode("\n", array_map(fn ($l, $i) => ($i === 0 ? '' : $ind) . $l, $lines, array_keys($lines)));
        };

        // Half-width questions pair up in a row (two columns on wider screens).
        $fields = $this->app->contactFormFields()->fields();
        $blocks = [];
        for ($i = 0; $i < count($fields); $i++) {
            $f = $fields[$i];
            $next = $fields[$i + 1] ?? null;
            if ($f['width'] === 'half' && $next && $next['width'] === 'half') {
                $slot = $f['help']['es'] !== '' || $next['help']['es'] !== '';
                $blocks[] = "<div class=\"form-row\">\n              " . $render($f, '              ', $slot) . "\n              " . $render($next, '              ', $slot) . "\n            </div>";
                $i++;
            } else {
                $blocks[] = $render($f, '            ', false);
            }
        }
        return [implode("\n            ", $blocks), $over];
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

    /** Privacy-notice paragraphs that follow the owner's settings (statistics, how long messages are kept). */
    private function privacyTexts(): array
    {
        $stats = $this->app->analytics()->enabled()
            ? 'para saber cuántas personas visitan el sitio, el propio sitio
      cuenta las visitas de forma anónima y guarda solo totales por día:
      páginas vistas, desde qué tipo de sitio llegaste (por ejemplo,
      Google o Facebook), tipo de dispositivo, idioma y clics en WhatsApp,
      teléfono o correo. No guardamos tu dirección IP ni ningún
      identificador que permita reconocerte de un día a otro. Si tu
      navegador tiene activada la opción «No rastrear» (Do Not Track) o
      Global Privacy Control, tu visita no se cuenta.'
            : 'este sitio no utiliza cookies de análisis ni herramientas de
      rastreo. Si en el futuro se incorpora alguna herramienta de
      medición, esta sección se actualizará antes de activarla.';
        $months = $this->app->leads()->retentionMonths();
        return [
            'privacy_stats' => $stats,
            'privacy_retention' => 'Conservamos la información de tu mensaje el tiempo necesario para
      atender tu solicitud y dar seguimiento a tu proyecto, y como máximo
      ' . $months . ' meses; después se elimina automáticamente. Puedes pedirnos que
      la eliminemos antes por los medios de contacto indicados abajo.',
        ];
    }

    /** Visit statistics (owner's setting in the panel) and optional telemetry (.env). */
    private function extraScripts(): string
    {
        $out = [];
        if ($this->app->analytics()->enabled()) {
            $out[] = '<script src="assets/stats.js?v=' . self::ASSET_VERSION . '" defer></script>';
        }
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

}
