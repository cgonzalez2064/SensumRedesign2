#!/usr/bin/env php
<?php
/**
 * Exports the photos (and the portfolio PDF) of a Content Manager installation into a
 * folder that tools/import-photos.php loads into another one (e.g. local → production)
 * exactly as they are: no re-encoding, same descriptions (ES/EN) and order.
 *
 *   php tools/export-photos.php <empty-or-new-dir> [--cms=cms]
 *
 *   <dir>/manifest.json       slots, order, sizes, descriptions and SHA-256 of every file
 *   <dir>/uploads/            the published files (every responsive width)
 *   <dir>/importar-fotos.php  the importer, ready to run on the server
 *
 * Nothing else leaves: no users, settings, messages, keys or logs.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit(1);
}

$out = null;
$cms = dirname(__DIR__) . '/cms';
foreach (array_slice($argv, 1) as $a) {
    if (str_starts_with($a, '--cms=')) {
        $cms = substr($a, 6);
    } elseif ($out === null) {
        $out = rtrim($a, '/');
    }
}
if ($out === null || $out === '') {
    fwrite(STDERR, "Usage: php tools/export-photos.php <empty-or-new-dir> [--cms=<cms dir>]\n");
    exit(1);
}
if (is_dir($out) && (new FilesystemIterator($out))->valid()) {
    fwrite(STDERR, "The folder {$out} must be empty or new.\n");
    exit(1);
}

$app = require rtrim($cms, '/') . '/bootstrap.php';
$media = $app->media();
$src = $media->uploadDir();
$rows = $app->db()->all('SELECT * FROM media WHERE deleted_at IS NULL ORDER BY slot, position, id');

if (!is_dir($out . '/uploads') && !mkdir($out . '/uploads', 0755, true)) {
    fwrite(STDERR, "Cannot create {$out}/uploads.\n");
    exit(1);
}
$items = [];
$positions = [];
$files = 0;
$bytes = 0;
foreach ($rows as $r) {
    $variants = array_map('intval', json_decode((string) $r['variants'], true) ?: []);
    $names = $r['kind'] === 'pdf'
        ? [$r['file_base'] . '.pdf']
        : array_map(fn ($w) => $r['file_base'] . '-w' . $w . '.' . $r['ext'], $variants);
    $hashes = [];
    foreach ($names as $n) {
        if (!is_file("{$src}/{$n}")) {
            fwrite(STDERR, "Missing file {$n} (slot {$r['slot']}); nothing exported.\n");
            exit(1);
        }
        copy("{$src}/{$n}", "{$out}/uploads/{$n}");
        $hashes[$n] = hash_file('sha256', "{$src}/{$n}");
        $files++;
        $bytes += (int) filesize("{$src}/{$n}");
    }
    $positions[$r['slot']] = ($positions[$r['slot']] ?? -1) + 1;
    $items[] = [
        'slot' => $r['slot'],
        'position' => $positions[$r['slot']],
        'kind' => $r['kind'],
        'file_base' => $r['file_base'],
        'ext' => $r['ext'],
        'width' => $r['width'] !== null ? (int) $r['width'] : null,
        'height' => $r['height'] !== null ? (int) $r['height'] : null,
        'bytes' => (int) $r['bytes'],
        'variants' => $variants,
        'alt_es' => (string) $r['alt_es'],
        'alt_en' => (string) $r['alt_en'],
        'original_name' => (string) $r['original_name'],
        'files' => $hashes,
    ];
}
file_put_contents($out . '/manifest.json', json_encode(['format' => 1, 'createdAt' => time(), 'items' => $items], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
copy(__DIR__ . '/import-photos.php', $out . '/importar-fotos.php');
echo 'Exported ' . count($items) . " item(s) in " . count($positions) . " slot(s), {$files} file(s), " . round($bytes / 1048576, 1) . " MB → {$out}\n";
