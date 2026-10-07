<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\Content\Validator;
use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Http\Response;
use Sensum\Cms\TranslationError;

/**
 * Text, business details, photos and documents. Every successful change is
 * published to the public pages in the same request; if publishing fails the
 * database change is rolled back, so the editor and the site never disagree.
 */
final class ContentController extends Controller
{
    private const LANGS = ['es' => true, 'en' => true];

    public function index(): never
    {
        $schema = $this->app->schema();
        $repo = $this->app->content();
        $values = $repo->values();
        $sections = [];
        foreach ($schema->sections() as $section) {
            $fields = [];
            foreach ($schema->sectionFields($section['id']) as $key => $f) {
                $defaults = [];
                foreach ($repo->langs($f) as $l) {
                    $defaults[$l] = $schema->default($key, $l);
                }
                $fields[] = [
                    'key' => $key,
                    'type' => $f['type'],
                    'max' => (int) $f['max'],
                    'required' => (bool) $f['required'],
                    'bilingual' => (bool) $f['bilingual'],
                    'hosts' => $f['hosts'] ?? null,
                    'value' => $values[$key],
                    'default' => $defaults,
                ];
            }
            $last = $repo->sectionUpdatedBy($section['id']);
            $sections[] = [
                'id' => $section['id'],
                'anchor' => $section['anchor'],
                'version' => $repo->sectionVersion($section['id']),
                'updatedAt' => $last ? (int) $last['updated_at'] : null,
                'updatedBy' => $last['name'] ?? null,
                'fields' => $fields,
            ];
        }
        Response::ok([
            'sections' => $sections,
            'siteUrl' => $this->app->config->appUrl(),
            'translation' => ['enabled' => $this->app->translator()->isEnabled()],
        ]);
    }

    /**
     * Machine-translates editor text between Spanish and English. Nothing is
     * saved: the admin shows the result in the other language's box for review.
     */
    public function translate(): never
    {
        $translator = $this->app->translator();
        if (!$translator->isEnabled()) {
            throw new ApiError(503, 'translation_unavailable');
        }
        $from = $this->str('from');
        $to = $this->str('to');
        $items = $this->req->raw('items');
        if (!isset(self::LANGS[$from], self::LANGS[$to]) || $from === $to
            || !is_array($items) || !$items || count($items) > 50 || !array_is_list($items)) {
            throw new ApiError(400, 'malformed_request');
        }

        $schema = $this->app->schema();
        $batch = [];
        $chars = 0;
        foreach ($items as $item) {
            $key = is_array($item) ? ($item['key'] ?? null) : null;
            $raw = is_array($item) ? ($item['text'] ?? null) : null;
            $field = is_string($key) ? $schema->field($key) : null;
            if (!$field || !$field['bilingual'] || !is_string($raw)) {
                throw new ApiError(400, 'malformed_request');
            }
            if (strlen($raw) > 4000) {
                throw new ApiError(413, 'payload_too_large');
            }
            $text = Validator::normalizeText($raw);
            if (preg_match('/[<>]/', $text)) {
                throw ApiError::validation([$key . '.' . $from => 'no_html']);
            }
            $batch[] = ['key' => $key, 'text' => $text, 'emphasis' => $field['type'] === 'emphasis'];
            $chars += mb_strlen($text);
        }

        // Protect the translation quota from a runaway or compromised account.
        $limiter = $this->app->rateLimiter();
        if (!$limiter->hit('translate', (string) $this->uid(), 300, 3600)
            || !$limiter->consume('translate_chars', 'all', $chars, $this->app->config->int('TRANSLATE_DAILY_CHAR_LIMIT', 60000, 1000), 86400)) {
            throw new ApiError(429, 'translation_busy');
        }

        try {
            $out = $translator->translate($batch, $from, $to);
        } catch (TranslationError $e) {
            throw new ApiError(503, $e->getMessage());
        }
        $translations = [];
        foreach ($batch as $i => $item) {
            $translations[] = ['key' => $item['key'], 'text' => $out[$i]];
        }
        Response::ok(['translations' => $translations]);
    }

    public function update(string $sectionId): never
    {
        $schema = $this->app->schema();
        if (!in_array($sectionId, $schema->sectionIds(), true)) {
            throw new ApiError(404, 'not_found');
        }
        $repo = $this->app->content();
        $fields = $schema->sectionFields($sectionId);
        $input = $this->req->raw('values');
        if (!is_array($input) || !$input) {
            throw new ApiError(400, 'malformed_request');
        }

        $clean = [];
        $errors = [];
        foreach ($input as $key => $langs) {
            if (!isset($fields[$key]) || !is_array($langs)) {
                throw new ApiError(400, 'malformed_request');
            }
            foreach ($langs as $lang => $raw) {
                if (!in_array($lang, $repo->langs($fields[$key]), true) || !is_string($raw)) {
                    throw new ApiError(400, 'malformed_request');
                }
                if (strlen($raw) > 20000) {
                    throw new ApiError(413, 'payload_too_large');
                }
                [$value, $err] = Validator::validate($fields[$key], $raw);
                if ($err) {
                    $errors[$key . ($lang === '*' ? '' : ".{$lang}")] = $err;
                } else {
                    $clean[$key][$lang] = $value;
                }
            }
        }
        if ($errors) {
            throw ApiError::validation($errors);
        }

        $version = (int) $this->str('version');
        $db = $this->app->db();
        $result = $db->transaction(function () use ($repo, $sectionId, $version, $clean) {
            // Optimistic concurrency: someone else saved this section meanwhile.
            $current = $repo->sectionVersion($sectionId);
            if ($current !== $version) {
                $last = $repo->sectionUpdatedBy($sectionId);
                throw new ApiError(409, 'conflict', [], ['updatedBy' => $last['name'] ?? null, 'updatedAt' => $current]);
            }
            $before = [];
            foreach ($clean as $key => $langs) {
                foreach (array_keys($langs) as $lang) {
                    $before["{$key}.{$lang}"] = $repo->value($key, $lang === '*' ? 'es' : $lang);
                }
            }
            $changed = $repo->save($clean, $this->uid());
            if (!$changed) {
                return ['changed' => [], 'published' => null];
            }
            $published = $this->app->publisher()->publish($this->uid(), "content:{$sectionId}");
            $audit = [];
            foreach ($clean as $key => $langs) {
                foreach ($langs as $lang => $value) {
                    if ($before["{$key}.{$lang}"] !== $value) {
                        $audit[$key . ($lang === '*' ? '' : ".{$lang}")] = [mb_substr($before["{$key}.{$lang}"], 0, 300), mb_substr($value, 0, 300)];
                    }
                }
            }
            $this->app->activity($this->uid(), 'content_updated', $sectionId, ['changes' => $audit], $this->req->ip());
            return ['changed' => $changed, 'published' => $published['published_at']];
        });

        Response::ok([
            'changed' => $result['changed'],
            'publishedAt' => $result['published'],
            'version' => $repo->sectionVersion($sectionId),
        ]);
    }

    // ------------------------------------------------------------------
    // Photos & documents
    // ------------------------------------------------------------------

    public function media(): never
    {
        $media = $this->app->media();
        $slots = [];
        foreach ($media->slots() as $id => $slot) {
            $slots[] = [
                'id' => $id,
                'group' => $slot['group'],
                'project' => $slot['project'] ?? null,
                'kind' => $slot['kind'],
                'multiple' => (bool) $slot['multiple'],
                'max' => $slot['max'] ?? 1,
                'ratio' => $slot['ratio'] ?? null,
                'min' => $slot['min'] ?? null,
                'recommended' => $slot['recommended'] ?? null,
                'frames' => $slot['frames'] ?? [],
                'altRequired' => (bool) ($slot['altRequired'] ?? false),
                'items' => array_map([$media, 'present'], $media->items($id)),
            ];
        }
        Response::ok([
            'slots' => $slots,
            'maxImageBytes' => $media->maxUploadBytes('image'),
            'maxPdfBytes' => $media->maxUploadBytes('pdf'),
            'outputFormat' => \Sensum\Cms\Media\ImageProcessor::outputExt(),
        ]);
    }

    private function publishOrRollback(callable $change, string $action, string $target): mixed
    {
        return $this->app->db()->transaction(function () use ($change, $action, $target) {
            $result = $change();
            $this->app->publisher()->publish($this->uid(), $action);
            $this->app->activity($this->uid(), $action, $target, [], $this->req->ip());
            return $result;
        });
    }

    public function upload(string $slot): never
    {
        if (!$this->app->rateLimiter()->hit('upload', (string) $this->uid(), 60, 3600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $media = $this->app->media();
        $row = $this->publishOrRollback(
            fn () => $media->upload($slot, $this->req->file('file'), $this->str('anchor'), $this->str('altEs'), $this->str('altEn'), $this->uid()),
            'media_uploaded',
            $slot
        );
        Response::ok(['item' => $media->present($row)]);
    }

    public function updateItem(int $id): never
    {
        $media = $this->app->media();
        $row = $this->publishOrRollback(fn () => $media->updateAlt($id, $this->str('altEs'), $this->str('altEn')), 'media_alt_updated', (string) $id);
        Response::ok(['item' => $media->present($row)]);
    }

    public function deleteItem(int $id): never
    {
        $media = $this->app->media();
        $this->publishOrRollback(fn () => $media->remove($id), 'media_removed', (string) $id);
        Response::ok();
    }

    public function reorder(string $slot): never
    {
        $ids = $this->req->raw('ids');
        if (!is_array($ids) || count($ids) > 50 || array_filter($ids, fn ($v) => !is_int($v))) {
            throw new ApiError(400, 'malformed_request');
        }
        $media = $this->app->media();
        $this->publishOrRollback(fn () => $media->reorder($slot, $ids), 'media_reordered', $slot);
        Response::ok(['items' => array_map([$media, 'present'], $media->items($slot))]);
    }
}
