#!/usr/bin/env php
<?php
/**
 * Imports the photos exported by tools/export-photos.php (manifest.json + uploads/ next
 * to this file) into the Content Manager installed on this server, then publishes the site.
 *
 *   php importar-fotos.php [--dry-run] [--cms=/home/<user>/sensum-cms]
 *
 * - Only fills slots that are EMPTY here: photos already uploaded in the panel are never
 *   replaced (to redo a slot, delete its photos in the panel and run it again).
 * - Copies the files as they are (no re-encoding) after checking each one's SHA-256.
 * - Everything is validated before anything is written; the database rows are added in
 *   one transaction, and copied files are removed again if that fails.
 * Messages are in Spanish: whoever deploys runs it from the cPanel Terminal.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

function fail(string $message): never
{
    fwrite(STDERR, "ERROR: {$message}\nNo se cambió nada.\n");
    exit(1);
}

$dry = false;
$cms = rtrim((string) getenv('HOME'), '/') . '/sensum-cms';
foreach (array_slice($argv, 1) as $a) {
    if ($a === '--dry-run') {
        $dry = true;
    } elseif (str_starts_with($a, '--cms=')) {
        $cms = rtrim(substr($a, 6), '/');
    } else {
        fail("opción desconocida «{$a}». Uso: php importar-fotos.php [--dry-run] [--cms=/ruta/a/sensum-cms]");
    }
}

$here = __DIR__;
$manifest = json_decode((string) @file_get_contents($here . '/manifest.json'), true);
if (!is_array($manifest) || ($manifest['format'] ?? null) !== 1 || !is_array($manifest['items'] ?? null)) {
    fail('no encuentro un manifest.json válido junto a este archivo.');
}
if (!is_file($cms . '/bootstrap.php')) {
    fail("no encuentro el Administrador de contenido en {$cms} (indícalo con --cms=/ruta/a/sensum-cms).");
}
$app = require $cms . '/bootstrap.php';
$media = $app->media();
$slots = $media->slots();
$db = $app->db();
$dir = $media->uploadDir();

// ---- 1. Validate everything before writing anything ----
$bySlot = [];
foreach ($manifest['items'] as $i => $it) {
    if (!is_array($it) || !is_string($it['slot'] ?? null)) {
        fail("el elemento {$i} del manifiesto no es válido.");
    }
    $bySlot[$it['slot']][] = $it;
}
$plan = [];
$skipped = [];
foreach ($bySlot as $slotId => $list) {
    if (!isset($slots[$slotId])) {
        fail("el espacio «{$slotId}» no existe en esta versión del sitio.");
    }
    $slot = $slots[$slotId];
    $existing = count($media->items($slotId));
    if ($existing > 0) {
        $skipped[$slotId] = $existing;
        continue;
    }
    if (empty($slot['multiple']) && count($list) > 1) {
        fail("«{$slotId}» admite una sola foto y el paquete trae " . count($list) . '.');
    }
    if (!empty($slot['multiple']) && count($list) > (int) $slot['max']) {
        fail("«{$slotId}» admite hasta {$slot['max']} fotos y el paquete trae " . count($list) . '.');
    }
    usort($list, fn ($a, $b) => (int) ($a['position'] ?? 0) <=> (int) ($b['position'] ?? 0));
    foreach ($list as $it) {
        $base = (string) ($it['file_base'] ?? '');
        $kind = (string) ($it['kind'] ?? '');
        $ext = (string) ($it['ext'] ?? '');
        $variants = $it['variants'] ?? null;
        if ($kind !== $slot['kind']) {
            fail("«{$base}» no es del tipo que usa «{$slotId}».");
        }
        if (!preg_match('/^[a-z0-9-]+$/', $base) || !str_starts_with($base, str_replace('.', '-', $slotId) . '-')) {
            fail("nombre de archivo inválido en «{$slotId}»: «{$base}».");
        }
        if ($kind === 'image') {
            if (!in_array($ext, ['webp', 'jpg'], true) || !is_array($variants) || !$variants
                || array_filter($variants, fn ($w) => !is_int($w) || $w < 100 || $w > 10000)) {
                fail("datos de imagen inválidos para «{$base}».");
            }
            $expected = array_map(fn ($w) => "{$base}-w{$w}.{$ext}", $variants);
        } else {
            if ($ext !== 'pdf') {
                fail("datos de PDF inválidos para «{$base}».");
            }
            $expected = ["{$base}.pdf"];
        }
        foreach (['alt_es', 'alt_en', 'original_name'] as $k) {
            if (!is_string($it[$k] ?? '') || mb_strlen((string) ($it[$k] ?? '')) > 150) {
                fail("el texto «{$k}» de «{$base}» no es válido.");
            }
        }
        $hashes = is_array($it['files'] ?? null) ? $it['files'] : [];
        if (array_keys($hashes) !== $expected) {
            fail("la lista de archivos de «{$base}» no coincide con sus tamaños.");
        }
        foreach ($hashes as $name => $sha) {
            $from = "{$here}/uploads/{$name}";
            if (!is_file($from) || !hash_equals((string) $sha, (string) hash_file('sha256', $from))) {
                fail("el archivo «{$name}» falta o está dañado en el paquete (vuelve a subir el zip).");
            }
            $to = "{$dir}/{$name}";
            if (is_file($to) && !hash_equals((string) $sha, (string) hash_file('sha256', $to))) {
                fail("ya existe otro archivo llamado «{$name}» en el sitio.");
            }
        }
        if ($kind === 'image') {
            $largest = max($variants);
            $info = @getimagesize("{$here}/uploads/{$base}-w{$largest}.{$ext}");
            if (!$info || $info[0] !== $largest || !in_array($info[2], [IMAGETYPE_WEBP, IMAGETYPE_JPEG], true)) {
                fail("«{$base}-w{$largest}.{$ext}» no es una imagen válida.");
            }
        } elseif (strncmp((string) file_get_contents("{$here}/uploads/{$base}.pdf", false, null, 0, 5), '%PDF-', 5) !== 0) {
            fail("«{$base}.pdf» no es un PDF válido.");
        }
    }
    $plan[$slotId] = $list;
}

// ---- 2. Report what will happen ----
$count = array_sum(array_map('count', $plan));
echo "Fotos en el paquete: " . count($manifest['items']) . ' en ' . count($bySlot) . " espacios.\n";
foreach ($plan as $slotId => $list) {
    printf("  + %-16s %d\n", $slotId, count($list));
}
foreach ($skipped as $slotId => $n) {
    printf("  = %-16s ya tiene %d en el sitio: se deja como está\n", $slotId, $n);
}
if ($dry) {
    echo "Simulación (--dry-run): se importarían {$count}. No se cambió nada.\n";
    exit(0);
}
if ($count === 0) {
    echo "No hay nada que importar: esos espacios ya tienen fotos en el sitio.\n";
    exit(0);
}

// ---- 3. Copy the files, then add the rows in one transaction ----
$copied = [];
$undo = function () use (&$copied): void {
    foreach ($copied as $f) {
        @unlink($f);
    }
};
foreach ($plan as $list) {
    foreach ($list as $it) {
        foreach (array_keys($it['files']) as $name) {
            $to = "{$dir}/{$name}";
            if (is_file($to)) {
                continue; // same content (checked above): an earlier, interrupted run
            }
            if (!@copy("{$here}/uploads/{$name}", $to)) {
                $undo();
                fail("no se pudo copiar «{$name}» a {$dir}.");
            }
            @chmod($to, 0644);
            $copied[] = $to;
        }
    }
}
$ownerId = $db->value('SELECT id FROM users WHERE lower(email) = ?', [$app->config->ownerEmail()]);
$ownerId = $ownerId !== null ? (int) $ownerId : null;
try {
    $db->transaction(function () use ($db, $plan, $ownerId): void {
        $now = time();
        foreach ($plan as $slotId => $list) {
            foreach (array_values($list) as $position => $it) {
                $db->insert(
                    'INSERT INTO media (slot, position, kind, file_base, ext, width, height, bytes, variants, alt_es, alt_en, original_name, created_at, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [$slotId, $position, $it['kind'], $it['file_base'], $it['ext'], $it['width'] ?? null, $it['height'] ?? null, (int) ($it['bytes'] ?? 0),
                        json_encode($it['variants'] ?? []), (string) ($it['alt_es'] ?? ''), (string) ($it['alt_en'] ?? ''), (string) ($it['original_name'] ?? ''), $now, $ownerId]
                );
            }
        }
    });
} catch (Throwable $e) {
    $undo();
    fail('no se pudieron guardar las fotos en la base de datos (' . get_class($e) . ').');
}
$app->activity($ownerId, 'media_imported_cli', (string) $count);

// ---- 4. Publish ----
try {
    $app->publisher()->publish($ownerId, 'cli');
    echo "Listo: {$count} fotos importadas y el sitio publicado.\n";
} catch (Throwable $e) {
    echo "Listo: {$count} fotos importadas, pero no se pudo publicar el sitio: entra al panel → Inicio → «Volver a publicar el sitio».\n";
}
