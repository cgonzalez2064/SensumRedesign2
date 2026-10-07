<?php
declare(strict_types=1);

namespace Sensum\Cms\Media;

use Sensum\Cms\App;
use Sensum\Cms\Content\Validator;
use Sensum\Cms\Http\ApiError;

/**
 * Photo and document slots: upload, alt text, ordering, removal.
 *
 * Published files live in public_html/assets/uploads/ with names the server
 * generates (slot + random suffix + width), so uploads can never choose a
 * path, overwrite each other or collide. Removed files are kept for 30 days
 * (so backups of earlier published pages still render) and then deleted.
 */
final class MediaService
{
    private const ALT_MAX = 150;
    private const GC_AFTER = 30 * 86400;

    private array $slots;

    public function __construct(private App $app)
    {
        $this->slots = require $app->root('content/media.php');
    }

    public function slots(): array
    {
        return $this->slots;
    }

    public function slot(string $id): array
    {
        if (!isset($this->slots[$id])) {
            throw new ApiError(404, 'not_found');
        }
        return $this->slots[$id];
    }

    public function uploadDir(): string
    {
        $dir = $this->app->publicPath('assets/uploads');
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        return $dir;
    }

    /** Max upload size in bytes: the smaller of our setting and PHP's own limits. */
    public function maxUploadBytes(string $kind = 'image'): int
    {
        $ours = $kind === 'pdf'
            ? 20 * 1024 * 1024
            : $this->app->config->int('UPLOAD_MAX_MB', 10, 1, 50) * 1024 * 1024;
        $php = min(
            array_filter([ImageProcessor::bytes((string) ini_get('upload_max_filesize')), ImageProcessor::bytes((string) ini_get('post_max_size'))], fn ($v) => $v > 0) ?: [PHP_INT_MAX]
        );
        return (int) min($ours, $php);
    }

    /** @return list<array> active items of a slot, in display order */
    public function items(string $slot): array
    {
        return $this->app->db()->all(
            'SELECT * FROM media WHERE slot = ? AND deleted_at IS NULL ORDER BY position, id',
            [$slot]
        );
    }

    /** Public path (relative to the site root) of an item, at a given width. */
    public function path(array $row, ?int $width = null): string
    {
        if ($row['kind'] === 'pdf') {
            return 'assets/uploads/' . $row['file_base'] . '.pdf';
        }
        $variants = json_decode((string) $row['variants'], true) ?: [];
        $w = $width && in_array($width, $variants, true) ? $width : (int) max($variants ?: [0]);
        return 'assets/uploads/' . $row['file_base'] . '-w' . $w . '.' . $row['ext'];
    }

    public function srcset(array $row): string
    {
        $variants = json_decode((string) $row['variants'], true) ?: [];
        sort($variants);
        return implode(', ', array_map(fn ($w) => $this->path($row, (int) $w) . ' ' . $w . 'w', $variants));
    }

    /** API representation of an item. */
    public function present(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'kind' => $row['kind'],
            'url' => $this->path($row),
            'thumb' => $row['kind'] === 'image' ? $this->path($row, (int) min(json_decode((string) $row['variants'], true) ?: [0])) : null,
            'width' => $row['width'] !== null ? (int) $row['width'] : null,
            'height' => $row['height'] !== null ? (int) $row['height'] : null,
            'bytes' => (int) $row['bytes'],
            'altEs' => (string) $row['alt_es'],
            'altEn' => (string) $row['alt_en'],
            'originalName' => (string) $row['original_name'],
            'createdAt' => (int) $row['created_at'],
        ];
    }

    /** @return array{0:string,1:string} validated [alt_es, alt_en] */
    public function validateAlt(array $slot, string $es, string $en): array
    {
        $field = ['type' => 'text', 'max' => self::ALT_MAX, 'required' => false];
        [$es, $errEs] = Validator::validate($field, $es);
        [$en, $errEn] = Validator::validate($field, $en);
        $errors = [];
        if ($errEs) {
            $errors['altEs'] = $errEs;
        } elseif ($es === '' && !empty($slot['altRequired'])) {
            $errors['altEs'] = 'required';
        }
        if ($errEn) {
            $errors['altEn'] = $errEn;
        }
        if ($errors) {
            throw ApiError::validation($errors);
        }
        return [$es, $en];
    }

    public function upload(string $slotId, ?array $file, string $anchor, string $altEs, string $altEn, int $userId): array
    {
        $slot = $this->slot($slotId);
        $kind = $slot['kind'];
        [$altEs, $altEn] = $kind === 'image' ? $this->validateAlt($slot, $altEs, $altEn) : ['', ''];
        if (!empty($slot['multiple']) && count($this->items($slotId)) >= (int) $slot['max']) {
            throw ApiError::validation(['file' => 'gallery_full']);
        }
        ImageProcessor::assertUploadOk($file, $this->maxUploadBytes($kind));
        $tmp = (string) $file['tmp_name'];
        $original = ImageProcessor::displayName((string) ($file['name'] ?? ''));
        $base = str_replace('.', '-', $slotId) . '-' . bin2hex(random_bytes(6));
        $dir = $this->uploadDir();

        if ($kind === 'pdf') {
            $meta = $this->storePdf($tmp, $original, $dir, $base);
        } else {
            $anchor = in_array($anchor, ['start', 'center', 'end'], true) ? $anchor : 'center';
            $loaded = ImageProcessor::load($tmp, $original, $slot['min']);
            try {
                $rect = ImageProcessor::cropRect($loaded['w'], $loaded['h'], $slot['ratio'], $anchor);
                $ext = ImageProcessor::outputExt();
                $widths = ImageProcessor::writeVariants($loaded['img'], $rect, $slot['variants'], $dir, $base, $ext);
            } finally {
                imagedestroy($loaded['img']);
            }
            $largest = max($widths);
            $bytes = (int) @filesize("{$dir}/{$base}-w{$largest}.{$ext}");
            $meta = ['ext' => $ext, 'width' => $largest, 'height' => (int) round($rect[3] * $largest / $rect[2]), 'bytes' => $bytes, 'variants' => $widths];
        }

        $db = $this->app->db();
        $id = $db->transaction(function () use ($db, $slotId, $slot, $kind, $base, $meta, $altEs, $altEn, $original, $userId) {
            $now = time();
            if (empty($slot['multiple'])) {
                $db->run('UPDATE media SET deleted_at = ? WHERE slot = ? AND deleted_at IS NULL', [$now, $slotId]);
                $position = 0;
            } else {
                $position = (int) $db->value('SELECT COALESCE(MAX(position), -1) + 1 FROM media WHERE slot = ? AND deleted_at IS NULL', [$slotId]);
            }
            return $db->insert(
                'INSERT INTO media (slot, position, kind, file_base, ext, width, height, bytes, variants, alt_es, alt_en, original_name, created_at, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$slotId, $position, $kind, $base, $meta['ext'], $meta['width'] ?? null, $meta['height'] ?? null, $meta['bytes'],
                    json_encode($meta['variants'] ?? []), $altEs, $altEn, $original, $now, $userId]
            );
        });
        return $db->one('SELECT * FROM media WHERE id = ?', [$id]);
    }

    private function storePdf(string $tmp, string $original, string $dir, string $base): array
    {
        if (strtolower(pathinfo($original, PATHINFO_EXTENSION)) !== 'pdf') {
            throw ApiError::validation(['file' => 'file_type_not_allowed']);
        }
        $mime = (string) (new \finfo(FILEINFO_MIME_TYPE))->file($tmp);
        $size = (int) filesize($tmp);
        $fh = fopen($tmp, 'rb');
        $head = $fh ? (string) fread($fh, 5) : '';
        if ($fh && $size > 2048) {
            fseek($fh, -2048, SEEK_END);
        }
        $tail = $fh ? (string) fread($fh, 2048) : '';
        if ($fh) {
            fclose($fh);
        }
        if ($mime !== 'application/pdf' || $head !== '%PDF-' || !str_contains($tail, '%%EOF')) {
            throw ApiError::validation(['file' => $mime === 'application/pdf' ? 'pdf_corrupt' : 'file_type_mismatch']);
        }
        $final = "{$dir}/{$base}.pdf";
        if (!move_uploaded_file($tmp, $final)) {
            throw new \RuntimeException('pdf_write_failed');
        }
        @chmod($final, 0644);
        return ['ext' => 'pdf', 'bytes' => $size, 'variants' => []];
    }

    public function find(int $id): array
    {
        $row = $this->app->db()->one('SELECT * FROM media WHERE id = ? AND deleted_at IS NULL', [$id]);
        if (!$row) {
            throw new ApiError(404, 'not_found');
        }
        return $row;
    }

    public function updateAlt(int $id, string $altEs, string $altEn): array
    {
        $row = $this->find($id);
        [$altEs, $altEn] = $this->validateAlt($this->slot($row['slot']), $altEs, $altEn);
        $this->app->db()->run('UPDATE media SET alt_es = ?, alt_en = ? WHERE id = ?', [$altEs, $altEn, $id]);
        return $this->find($id);
    }

    public function remove(int $id): array
    {
        $row = $this->find($id);
        $this->app->db()->run('UPDATE media SET deleted_at = ? WHERE id = ?', [time(), $id]);
        return $row;
    }

    /** @param list<int> $ids complete new order for the slot */
    public function reorder(string $slotId, array $ids): void
    {
        $this->slot($slotId);
        $current = array_map('intval', array_column($this->items($slotId), 'id'));
        $ids = array_map('intval', $ids);
        $sortedA = $current;
        $sortedB = $ids;
        sort($sortedA);
        sort($sortedB);
        if ($sortedA !== $sortedB) {
            throw ApiError::validation(['order' => 'order_mismatch']);
        }
        $db = $this->app->db();
        $db->transaction(function () use ($db, $ids, $slotId) {
            foreach ($ids as $pos => $id) {
                $db->run('UPDATE media SET position = ? WHERE id = ? AND slot = ?', [$pos, $id, $slotId]);
            }
        });
    }

    /** Deletes files of items removed more than 30 days ago. */
    public function collectGarbage(): int
    {
        $db = $this->app->db();
        $rows = $db->all('SELECT * FROM media WHERE deleted_at IS NOT NULL AND deleted_at < ?', [time() - self::GC_AFTER]);
        $dir = $this->uploadDir();
        foreach ($rows as $row) {
            $files = $row['kind'] === 'pdf'
                ? ["{$dir}/{$row['file_base']}.pdf"]
                : array_map(fn ($w) => "{$dir}/{$row['file_base']}-w{$w}.{$row['ext']}", json_decode((string) $row['variants'], true) ?: []);
            foreach ($files as $f) {
                // file_base is server-generated ([a-z0-9-]), never user input.
                if (preg_match('/^[a-z0-9-]+$/', (string) $row['file_base']) && is_file($f)) {
                    @unlink($f);
                }
            }
            $db->run('DELETE FROM media WHERE id = ?', [$row['id']]);
        }
        return count($rows);
    }
}
