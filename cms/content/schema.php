<?php
/**
 * Editable content — the single definition of WHAT the client can change.
 *
 * Keys of bilingual fields are the same keys the public site's i18n system
 * already uses (data-i18n="…" in index.html / I18N in assets/main.js), so a
 * published value flows into both the server-rendered Spanish page and the
 * ES/EN language toggle.
 *
 * Limits were sized from the approved copy and verified against the layout
 * at 320–1440 px (see docs/FRONTEND_INTEGRATION.md, "Content stress test").
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

$t = static fn (string $key, int $max, array $extra = []) => ['key' => $key, 'type' => 'text', 'max' => $max] + $extra;
$p = static fn (string $key, int $max, array $extra = []) => ['key' => $key, 'type' => 'textarea', 'max' => $max] + $extra;

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
    $projects[] = $t("proj{$i}.tag", 20);
    $projects[] = $t("proj{$i}.title", 30);
    $projects[] = $p("proj{$i}.desc", 80);
}
$faq = [];
foreach (range(1, 6) as $i) {
    $faq[] = $t("faq.q{$i}", 90);
    $faq[] = $p("faq.a{$i}", 400);
}

return [
    'sections' => [
        ['id' => 'hero', 'anchor' => '#inicio', 'fields' => [
            $t('hero.eyebrow', 60),
            ['key' => 'hero.title', 'type' => 'emphasis', 'max' => 100],
            $p('hero.desc', 220),
            $t('hero.cta1', 32),
            $t('hero.cta2', 32),
            $t('hero.badge1', 28),
            $t('hero.badge2', 28),
            $t('hero.badge3', 28),
            $t('pillar.plan_label', 22),
            $t('pillar.precision_label', 22),
            $t('pillar.comm_label', 22),
            $t('pillar.support_label', 22),
        ]],
        ['id' => 'about', 'anchor' => '#nosotros', 'fields' => [
            $t('about.eyebrow', 30),
            $t('about.title', 30),
            $p('about.desc', 500),
            $t('about.art_caption', 90),
            $t('about.mission_title', 20),
            $p('about.mission_desc', 240),
            $t('about.vision_title', 20),
            $p('about.vision_desc', 240),
        ]],
        ['id' => 'services', 'anchor' => '#servicios', 'fields' => array_merge([
            $t('services.eyebrow', 30),
            $t('services.title', 30),
            $p('services.desc', 180),
            $t('services.cta', 28),
        ], $services)],
        ['id' => 'process', 'anchor' => '#servicios', 'fields' => array_merge([
            $t('process.eyebrow', 30),
            $t('process.title', 30),
        ], $process)],
        ['id' => 'projects', 'anchor' => '#proyectos', 'fields' => array_merge([
            $t('projects.eyebrow', 30),
            $t('projects.title', 30),
            $p('projects.desc', 160),
        ], $projects, [
            $t('projects.cta', 48),
        ])],
        ['id' => 'cta', 'anchor' => '#contacto', 'fields' => [
            $t('ctabanner.title', 36),
            $p('ctabanner.desc', 120),
            $t('ctabanner.cta', 28),
        ]],
        ['id' => 'contact', 'anchor' => '#contacto', 'fields' => [
            $t('contact.eyebrow', 30),
            $t('contact.title', 30),
            $p('contact.desc', 220),
            $t('contact.hours_value', 90),
            $t('form.title', 30),
            $p('whatsapp.message', 200),
        ]],
        ['id' => 'faq', 'anchor' => '#faq', 'fields' => array_merge([
            $t('faq.eyebrow', 30),
            $t('faq.title', 36),
        ], $faq)],
        ['id' => 'footer', 'anchor' => '#contacto', 'fields' => [
            $t('footer.about_desc', 90),
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
