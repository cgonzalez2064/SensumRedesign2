<?php
/**
 * Editable photo / document slots, sized from the approved layout
 * (docs/CURRENT_SITE_BASELINE.md §8 — measured containers).
 *
 *   ratio       exact aspect ratio the photo is cropped to (null = keep the
 *               photo's own shape; the page crops it with object-fit: cover)
 *   min         hard minimum size in px (smaller uploads are refused)
 *   recommended size the client was asked for (smaller uploads get a warning)
 *   variants    widths generated for responsive srcset (never upscaled)
 *   frames      container shapes [w, h] the admin previews (desktop, tablet, mobile)
 */

$slots = [
    'about.photo' => [
        'group' => 'about', 'kind' => 'image', 'multiple' => false, 'altRequired' => true,
        'ratio' => null, 'min' => [1000, 1000], 'recommended' => [1600, 1600], 'variants' => [800, 1600],
        'frames' => [[530, 420], [707, 420], [359, 420]],
        'sizes' => '(max-width: 900px) 92vw, 530px',
    ],
];

foreach (range(1, 6) as $i) {
    $slots["proj{$i}.card"] = [
        'group' => 'projects', 'project' => "proj{$i}", 'kind' => 'image', 'multiple' => false, 'altRequired' => true,
        'ratio' => [4, 3], 'min' => [1000, 750], 'recommended' => [1600, 1200], 'variants' => [800, 1600],
        'frames' => [[376, 282], [359, 269]],
        'sizes' => '(max-width: 620px) 92vw, (max-width: 980px) 46vw, 376px',
    ];
    $slots["proj{$i}.gallery"] = [
        'group' => 'projects', 'project' => "proj{$i}", 'kind' => 'image', 'multiple' => true, 'max' => 10, 'altRequired' => false,
        'ratio' => [4, 3], 'min' => [1000, 750], 'recommended' => [1600, 1200], 'variants' => [800, 1600],
        'frames' => [[640, 480]],
        'sizes' => '(max-width: 560px) 100vw, 640px',
    ];
}

$slots['portfolio.pdf'] = [
    'group' => 'documents', 'kind' => 'pdf', 'multiple' => false, 'maxMb' => 20,
];

return $slots;
