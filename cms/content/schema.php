<?php
/**
 * Editable content — the single definition of WHAT the client can change.
 *
 * Keys of bilingual fields are the same keys the public site's i18n system
 * already uses (data-i18n="…" in index.html / I18N in assets/main.js), so a
 * published value flows into both the server-rendered Spanish page and the
 * ES/EN language toggle.
 *
 * Each text has a recommended length (`rec`, sized from the approved copy: what
 * fits the design best) and a maximum (`max`) for when Sensum needs more: the
 * editor accepts up to the maximum and warns past the recommendation. Labels
 * (eyebrows, buttons, badges) allow 1.3× the recommendation, titles 1.5× and
 * paragraphs 2×. The layout was verified at 320–1440 px with every field at its
 * maximum (tests/e2e/public.spec.js, "content stress test"). The Google title and
 * description keep one limit (Google cuts longer ones).
 *
 * Field types:
 *   text      one line                      textarea  paragraph (line breaks become spaces)
 *   emphasis  one line; *word* = highlight  phone     local phone number
 *   whatsapp  international number          email     e-mail address
 *   url       https link to an allowed host handle    @username
 *
 * Labels, help text and "where it appears" live in the admin's translation
 * files (admin/js/i18n/*.js), keyed by section id and field key.
 */

// $rec: recommended length; the maximum is a multiple of it, rounded up to 5.
$lim = static fn (int $rec, float $k): array => ['rec' => $rec, 'max' => (int) (ceil($rec * $k / 5) * 5)];
$l = static fn (string $key, int $rec) => ['key' => $key, 'type' => 'text'] + $lim($rec, 1.3);     // label
$t = static fn (string $key, int $rec) => ['key' => $key, 'type' => 'text'] + $lim($rec, 1.5);     // title, one line
$p = static fn (string $key, int $rec) => ['key' => $key, 'type' => 'textarea'] + $lim($rec, 2.0); // paragraph

$services = [];
foreach (range(1, 6) as $i) {
    $services[] = $t("service{$i}.title", 50);
    $services[] = $p("service{$i}.desc", 220);
}
$process = [];
foreach (range(1, 4) as $i) {
    $process[] = $t("process{$i}.title", 32);
    $process[] = $p("process{$i}.desc", 130);
}
$projects = [];
foreach (range(1, 6) as $i) {
    $projects[] = $l("proj{$i}.tag", 20);
    $projects[] = $t("proj{$i}.title", 30);
    $projects[] = $p("proj{$i}.desc", 60);
}
$faq = [];
foreach (range(1, 6) as $i) {
    $faq[] = $t("faq.q{$i}", 90);
    $faq[] = $p("faq.a{$i}", 400);
}

return [
    'sections' => [
        ['id' => 'hero', 'anchor' => '#inicio', 'fields' => [
            $l('hero.eyebrow', 48),
            ['key' => 'hero.title', 'type' => 'emphasis'] + $lim(90, 1.5),
            $p('hero.desc', 180),
            $l('hero.cta1', 30),
            $l('hero.cta2', 30),
            $l('hero.badge1', 28),
            $l('hero.badge2', 28),
            $l('hero.badge3', 28),
            $l('pillar.plan_label', 22),
            $l('pillar.precision_label', 22),
            $l('pillar.comm_label', 22),
            $l('pillar.support_label', 22),
        ]],
        ['id' => 'about', 'anchor' => '#nosotros', 'fields' => [
            $l('about.eyebrow', 30),
            $t('about.title', 30),
            $p('about.desc', 500),
            $t('about.art_caption', 90),
            $t('about.mission_title', 20),
            $p('about.mission_desc', 240),
            $t('about.vision_title', 20),
            $p('about.vision_desc', 240),
        ]],
        ['id' => 'services', 'anchor' => '#servicios', 'fields' => array_merge([
            $l('services.eyebrow', 30),
            $t('services.title', 30),
            $p('services.desc', 180),
            $l('services.cta', 28),
        ], $services)],
        ['id' => 'process', 'anchor' => '#servicios', 'fields' => array_merge([
            $l('process.eyebrow', 30),
            $t('process.title', 30),
        ], $process)],
        ['id' => 'projects', 'anchor' => '#proyectos', 'fields' => array_merge([
            $l('projects.eyebrow', 30),
            $t('projects.title', 30),
            $p('projects.desc', 160),
        ], $projects, [
            $l('projects.cta', 48),
        ])],
        ['id' => 'cta', 'anchor' => '#contacto', 'fields' => [
            $t('ctabanner.title', 36),
            $p('ctabanner.desc', 120),
            $l('ctabanner.cta', 28),
        ]],
        ['id' => 'contact', 'anchor' => '#contacto', 'fields' => [
            $l('contact.eyebrow', 30),
            $t('contact.title', 30),
            $p('contact.desc', 220),
            $t('contact.hours_value', 90),
            $t('form.title', 30),
            $p('whatsapp.message', 200),
        ]],
        ['id' => 'faq', 'anchor' => '#faq', 'fields' => array_merge([
            $l('faq.eyebrow', 30),
            $t('faq.title', 36),
        ], $faq)],
        ['id' => 'footer', 'anchor' => '#contacto', 'fields' => [
            ['key' => 'footer.about_desc', 'type' => 'text'] + $lim(90, 2.0),
        ]],
        // What search engines show for the site (title and description in the
        // results, and in link previews). Not visible on the page itself. These
        // keep a single limit: Google cuts longer texts, so more would not help.
        ['id' => 'seo', 'anchor' => '', 'fields' => [
            ['key' => 'meta.title', 'type' => 'text', 'max' => 70],
            ['key' => 'meta.description', 'type' => 'textarea', 'max' => 160],
        ]],
        // Language-independent business details.
        ['id' => 'details', 'anchor' => '#contacto', 'fields' => [
            ['key' => 'contact.phone_office', 'type' => 'phone', 'bilingual' => false, 'default' => '2256-7954'],
            ['key' => 'contact.phone_mobile', 'type' => 'phone', 'bilingual' => false, 'required' => false, 'default' => '3481-9804'],
            ['key' => 'contact.whatsapp', 'type' => 'whatsapp', 'bilingual' => false, 'default' => '50234819804'],
            ['key' => 'contact.email', 'type' => 'email', 'bilingual' => false, 'max' => 120, 'default' => 'contacto@sensumconstrucciones.com'],
            ['key' => 'contact.address_building', 'type' => 'text', 'bilingual' => false, 'required' => false, 'max' => 50, 'default' => 'Edificio Ascend'],
            ['key' => 'contact.address_street', 'type' => 'text', 'bilingual' => false, 'max' => 60, 'default' => '13 Calle 5-31 Zona 9'],
            ['key' => 'contact.address_office', 'type' => 'text', 'bilingual' => false, 'required' => false, 'max' => 30, 'default' => 'Oficina 641'],
            ['key' => 'contact.address_city', 'type' => 'text', 'bilingual' => false, 'max' => 40, 'default' => 'Guatemala'],
            ['key' => 'contact.map_title', 'type' => 'text', 'bilingual' => false, 'max' => 50, 'default' => 'Edificio Ascend, Zona 9'],
            ['key' => 'contact.maps_url', 'type' => 'url', 'bilingual' => false, 'max' => 500,
                'hosts' => ['google.com', 'www.google.com', 'maps.google.com', 'goo.gl', 'maps.app.goo.gl', 'g.co'],
                'default' => 'https://www.google.com/maps/search/?api=1&query=13+Calle+5-31+Zona+9+Ciudad+de+Guatemala'],
            ['key' => 'contact.instagram_url', 'type' => 'url', 'bilingual' => false, 'max' => 200,
                'hosts' => ['instagram.com', 'www.instagram.com'],
                'default' => 'https://www.instagram.com/sensumconstruccionesgt/'],
            ['key' => 'contact.instagram_handle', 'type' => 'handle', 'bilingual' => false, 'max' => 31, 'default' => '@sensumconstruccionesgt'],
        ]],
    ],
];
