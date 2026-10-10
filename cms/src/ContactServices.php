<?php
declare(strict_types=1);

namespace Sensum\Cms;

use Sensum\Cms\Http\ApiError;

/**
 * The options of the contact form's "Servicio de interés" list, editable in
 * the panel (Sitio web → Formulario de contacto): add, rename (Spanish and
 * English), reorder and remove.
 *
 * Each option keeps a stable id, which is what the public form submits; the
 * e-mail shows the option's current Spanish name. Renaming an option therefore
 * never breaks a page a visitor already has open, and assets/contact-handler.php
 * also accepts the Spanish name (pages published before ids existed).
 *
 * Until the list is saved for the first time, the approved options below are
 * used. They mirror the select in templates/index.html.tpl and the
 * "form.opt_*" texts in assets/main.js.
 */
final class ContactServices
{
    private const KEY = 'contact_services';
    public const MAX_ITEMS = 20;
    public const MAX_LABEL = 60;

    /** id => [Spanish, English] */
    public const DEFAULTS = [
        'remodel' => ['Remodelaciones', 'Remodeling'],
        'design' => ['Diseño arquitectónico', 'Architectural design'],
        'waterproof' => ['Impermeabilización y tratamientos técnicos', 'Waterproofing & technical treatments'],
        'civil' => ['Obra civil', 'Civil works'],
        'installations' => ['Instalaciones generales', 'General installations'],
        'maintenance' => ['Mantenimiento preventivo', 'Preventive maintenance'],
        'other' => ['Otro', 'Other'],
    ];

    public function __construct(private App $app)
    {
    }

    /** @return list<array{id:string,es:string,en:string}> */
    public static function defaults(): array
    {
        $out = [];
        foreach (self::DEFAULTS as $id => [$es, $en]) {
            $out[] = ['id' => $id, 'es' => $es, 'en' => $en];
        }
        return $out;
    }

    private function stored(): array
    {
        return $this->app->settings()->getJson(self::KEY);
    }

    /** @return list<array{id:string,es:string,en:string}> */
    public function items(): array
    {
        $items = $this->stored()['items'] ?? null;
        if (!is_array($items) || !$items) {
            return self::defaults();
        }
        $out = [];
        foreach ($items as $it) {
            if (is_array($it) && is_string($it['id'] ?? null) && is_string($it['es'] ?? null)) {
                $out[] = ['id' => $it['id'], 'es' => $it['es'], 'en' => is_string($it['en'] ?? null) ? $it['en'] : ''];
            }
        }
        return $out ?: self::defaults();
    }

    /** Version for optimistic concurrency (0 = never saved). */
    public function version(): int
    {
        return (int) ($this->stored()['updatedAt'] ?? 0);
    }

    public function isDefault(): bool
    {
        return $this->items() === self::defaults();
    }

    /** Spanish name of the option a visitor chose (by id, or by its Spanish name); null if it is not offered. */
    public function labelFor(string $value): ?string
    {
        $value = trim($value);
        if ($value === '') {
            return null;
        }
        foreach ($this->items() as $it) {
            if ($value === $it['id'] || mb_strtolower($value) === mb_strtolower($it['es'])) {
                return $it['es'];
            }
        }
        return null;
    }

    /**
     * Validates and stores the list (in the caller's transaction). Existing ids
     * are kept; new options get a fresh id. Returns the clean list.
     * @return list<array{id:string,es:string,en:string}>
     */
    public function save(array $items, ?int $userId): array
    {
        if (!array_is_list($items) || !$items || count($items) > self::MAX_ITEMS) {
            throw ApiError::validation(['items' => $items ? 'too_many' : 'required']);
        }
        $known = array_flip(array_column($this->items(), 'id')) + array_flip(array_keys(self::DEFAULTS));
        $errors = [];
        $clean = [];
        $seenIds = [];
        $seenNames = [];
        foreach ($items as $i => $it) {
            if (!is_array($it)) {
                throw new ApiError(400, 'malformed_request');
            }
            $es = self::label($it['es'] ?? '');
            $en = self::label($it['en'] ?? '');
            if ($es === null || $es === '') {
                $errors["items.{$i}.es"] = $es === '' ? 'required' : 'invalid';
            } elseif (mb_strlen($es) < 2) {
                $errors["items.{$i}.es"] = 'too_short';
            } elseif (mb_strlen($es) > self::MAX_LABEL) {
                $errors["items.{$i}.es"] = 'too_long';
            } elseif (isset($seenNames[mb_strtolower($es)])) {
                $errors["items.{$i}.es"] = 'duplicate';
            }
            if ($en === null) {
                $errors["items.{$i}.en"] = 'invalid';
            } elseif (mb_strlen($en) > self::MAX_LABEL) {
                $errors["items.{$i}.en"] = 'too_long';
            }
            $id = is_string($it['id'] ?? null) ? $it['id'] : '';
            if (!isset($known[$id]) || isset($seenIds[$id]) || !preg_match('/^[a-z0-9-]{2,24}$/', $id)) {
                $id = 's-' . bin2hex(random_bytes(4)); // new option
            }
            $seenIds[$id] = true;
            if (is_string($es) && $es !== '') {
                $seenNames[mb_strtolower($es)] = true;
            }
            $clean[] = ['id' => $id, 'es' => (string) $es, 'en' => (string) $en];
        }
        if ($errors) {
            throw ApiError::validation($errors);
        }
        $this->app->settings()->setJson(self::KEY, ['items' => $clean, 'updatedAt' => max(time(), $this->version() + 1), 'updatedBy' => $userId]);
        return $clean;
    }

    /** Plain one-line text: null when it contains markup or control characters. */
    private static function label(mixed $v): ?string
    {
        if (!is_string($v)) {
            return $v === null ? '' : null;
        }
        $v = trim((string) preg_replace('/\s+/u', ' ', $v));
        if (preg_match('/[\x00-\x1F\x7F<>]/u', $v) || !mb_check_encoding($v, 'UTF-8')) {
            return null;
        }
        return $v;
    }
}
