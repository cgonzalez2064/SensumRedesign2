<?php
declare(strict_types=1);

namespace Sensum\Cms;

use Sensum\Cms\Http\ApiError;

/**
 * The questions of the public contact form (Sitio web → Formulario de
 * contacto): which fields visitors see, in what order, which are required,
 * their texts in Spanish and English and, for lists, their options.
 *
 * Five "core" fields map to the columns of Prospectos (name, phone, email,
 * service, message). Any other question is a custom field: its answer is
 * kept with the message (leads.answers) and listed in the e-mail. The
 * options of "Servicio de interés" stay in ContactServices (their ids are
 * what the page submits), so both editors always agree.
 *
 * Rules that keep every message answerable: the name is always asked and
 * required; e-mail and phone can be removed one at a time, but at least one
 * stays and is required.
 *
 * Every text is plain (no markup); the publisher escapes it into the page.
 */
final class ContactFormFields
{
    private const KEY = 'contact_form';
    public const MAX_FIELDS = 15;
    public const MAX_OPTIONS = 20;
    public const MAX_LABEL = 80;
    public const MAX_HELP = 160;
    public const MAX_OPTION = ContactServices::MAX_LABEL;
    public const TYPES = ['text', 'textarea', 'email', 'tel', 'number', 'date', 'select', 'radio', 'checkbox'];
    public const WITH_OPTIONS = ['select', 'radio', 'checkbox'];
    /** core id => fixed type */
    public const CORE = ['name' => 'text', 'phone' => 'tel', 'email' => 'email', 'service' => 'select', 'message' => 'textarea'];
    /** core id => [es, en] as the approved page shows them (assets/main.js "form.<id>_label"). */
    public const CORE_LABELS = [
        'name' => ['Nombre completo', 'Full name'],
        'phone' => ['Teléfono', 'Phone'],
        'email' => ['Correo electrónico', 'Email address'],
        'service' => ['Servicio de interés', 'Service of interest'],
        'message' => ['Cuéntanos sobre tu proyecto', 'Tell us about your project'],
    ];
    /** Longest answer per text type, and the core fields' own limits. */
    public const TEXT_MAX = ['text' => 200, 'textarea' => 4000, 'name' => 120, 'message' => 4000];
    private const CORE_WIDTH = ['name' => 'half', 'phone' => 'half', 'email' => 'full', 'service' => 'full', 'message' => 'full'];

    public function __construct(private App $app)
    {
    }

    // ------------------------------------------------------------------ reading

    /** The approved form; "Servicio de interés" carries the given options. */
    public static function defaults(?array $serviceOptions = null): array
    {
        $out = [];
        foreach (self::CORE as $id => $type) {
            $out[] = self::normalized([
                'id' => $id, 'core' => $id, 'type' => $type,
                'label' => ['es' => self::CORE_LABELS[$id][0], 'en' => self::CORE_LABELS[$id][1]],
                'required' => true, 'width' => self::CORE_WIDTH[$id],
                'options' => $id === 'service' ? ($serviceOptions ?? ContactServices::defaults()) : null,
            ]);
        }
        return $out;
    }

    /** @return list<array> the current questions, in order */
    public function fields(): array
    {
        $services = $this->app->contactServices()->items();
        $stored = $this->stored()['fields'] ?? null;
        if (!is_array($stored) || !$stored) {
            return self::defaults($services);
        }
        $out = [];
        foreach ($stored as $f) {
            if (!is_array($f) || !is_string($f['id'] ?? null) || !in_array($f['type'] ?? null, self::TYPES, true)) {
                continue;
            }
            if (($f['core'] ?? null) === 'service') {
                $f['options'] = $services;
            }
            $out[] = self::normalized($f);
        }
        return $out ?: self::defaults($services);
    }

    /** Version for optimistic concurrency: changes whenever the questions or the service options change. */
    public function version(): int
    {
        return max((int) ($this->stored()['updatedAt'] ?? 0), $this->app->contactServices()->version());
    }

    public function isDefault(): bool
    {
        return $this->fields() === self::defaults();
    }

    public function field(string $id): ?array
    {
        foreach ($this->fields() as $f) {
            if ($f['id'] === $id) {
                return $f;
            }
        }
        return null;
    }

    /** The names the public form may submit (checkbox questions send a list). */
    public function postNames(): array
    {
        return array_column($this->fields(), 'type', 'id');
    }

    // ------------------------------------------------------------------ saving

    /**
     * Validates and stores the questions (in the caller's transaction).
     * Errors are keyed "fields.<index>.<what>" (or "fields" for the whole form).
     * @return list<array> the clean questions
     */
    public function save(mixed $in, ?int $userId): array
    {
        if (!is_array($in) || !array_is_list($in) || !$in) {
            throw ApiError::validation(['fields' => 'required']);
        }
        if (count($in) > self::MAX_FIELDS) {
            throw ApiError::validation(['fields' => 'too_many']);
        }
        $known = [];
        foreach ($this->fields() as $f) {
            $known[$f['id']] = array_column($f['options'] ?? [], 'id');
        }
        $errors = [];
        $clean = [];
        $pos = [];
        $serviceItems = null;
        foreach ($in as $i => $f) {
            if (!is_array($f)) {
                throw new ApiError(400, 'malformed_request');
            }
            $p = "fields.{$i}.";
            $id = is_string($f['id'] ?? null) ? $f['id'] : '';
            $core = isset(self::CORE[$id]) ? $id : null;
            if ($core === null && (!isset($known[$id]) || !preg_match('/^q_[a-f0-9]{6}$/', $id) || isset($pos[$id]))) {
                $id = self::newId('q_', 3); // a new question gets its id here
            }
            if ($core !== null && isset($pos[$id])) {
                $errors[$p . 'id'] = 'duplicate';
                continue;
            }
            $type = $core !== null ? self::CORE[$core] : (in_array($f['type'] ?? null, self::TYPES, true) ? (string) $f['type'] : null);
            if ($type === null) {
                $errors[$p . 'type'] = 'invalid';
                continue;
            }
            $out = [
                'id' => $id, 'core' => $core, 'type' => $type,
                'label' => $this->pair($f['label'] ?? null, self::MAX_LABEL, $p . 'label', $errors, true),
                'help' => $this->pair($f['help'] ?? null, self::MAX_HELP, $p . 'help', $errors, false),
                'required' => ($f['required'] ?? false) === true,
                'width' => ($f['width'] ?? '') === 'half' ? 'half' : 'full',
            ];
            if (in_array($type, self::WITH_OPTIONS, true)) {
                if ($core === 'service') {
                    $serviceItems = [$i, $f['options'] ?? null];
                    $out['options'] = [];
                } else {
                    $out['options'] = $this->options($f['options'] ?? null, $type, $known[$id] ?? [], $p . 'options', $errors);
                }
            }
            if ($type === 'text' || $type === 'textarea') {
                $limit = self::TEXT_MAX[$core ?? $type];
                $max = filter_var($f['max'] ?? null, FILTER_VALIDATE_INT);
                $out['max'] = $max === false ? $limit : max(1, min($limit, $max));
            } elseif ($type === 'number') {
                $min = self::number($f['min'] ?? null);
                $max = self::number($f['max'] ?? null);
                if ($min === false) {
                    $errors[$p . 'min'] = 'invalid';
                }
                if ($max === false) {
                    $errors[$p . 'max'] = 'invalid';
                }
                if (is_float($min) && is_float($max) && $min > $max) {
                    $errors[$p . 'max'] = 'invalid';
                }
                $out['min'] = is_float($min) ? $min : null;
                $out['max'] = is_float($max) ? $max : null;
            } elseif ($type === 'date') {
                $out['future'] = ($f['future'] ?? false) === true;
            }
            $pos[$id] = $i;
            $clean[] = $out;
        }

        // Every message must stay answerable.
        $at = array_flip(array_column($clean, 'id'));
        if (!isset($at['name'])) {
            $errors['fields'] = 'name_required';
        } else {
            $clean[$at['name']]['required'] = true;
        }
        $email = $at['email'] ?? null;
        $phone = $at['phone'] ?? null;
        if ($email === null && $phone === null) {
            $errors['fields'] = 'contact_required';
        } elseif ($email === null || $phone === null) {
            $clean[$email ?? $phone]['required'] = true;
        } elseif (!$clean[$email]['required'] && !$clean[$phone]['required']) {
            $errors['fields.' . $pos['email'] . '.required'] = 'contact_required';
        }
        if ($errors) {
            throw ApiError::validation($errors);
        }

        // "Servicio de interés" keeps its options (and their ids) in ContactServices.
        if ($serviceItems !== null) {
            [$i, $items] = $serviceItems;
            try {
                $this->app->contactServices()->save(is_array($items) ? $items : [], $userId);
            } catch (ApiError $e) {
                $mapped = [];
                foreach ($e->fields as $k => $code) {
                    $mapped[preg_replace('/^items(\.(\d+))?(\..*)?$/', "fields.{$i}.options$1", (string) $k) ?? $k] = $code;
                }
                throw ApiError::validation($mapped);
            }
        }
        $stored = array_map(function (array $f) {
            if ($f['core'] === 'service') {
                unset($f['options']);
            }
            return $f;
        }, $clean);
        $this->app->settings()->setJson(self::KEY, ['fields' => $stored, 'updatedAt' => max(time(), $this->version() + 1), 'updatedBy' => $userId]);
        return $this->fields();
    }

    // ------------------------------------------------------------------ a visitor's message

    /**
     * Reads and checks a submission against the current questions.
     * @param array<string,mixed> $post
     * @return array{lead:array{name:string,phone:string,email:string,service:string,message:string},answers:list<array{id:string,label:string,value:string}>,errors:list<string>}
     */
    public function readSubmission(array $post): array
    {
        $lead = ['name' => '', 'phone' => '', 'email' => '', 'service' => '', 'message' => ''];
        $answers = [];
        $errors = [];
        $tz = new \DateTimeZone($this->app->config->string('APP_TIMEZONE', 'America/Guatemala') ?: 'America/Guatemala');
        foreach ($this->fields() as $f) {
            $id = $f['id'];
            $raw = $post[$id] ?? null;
            $value = '';
            $ok = true;
            if ($f['type'] === 'checkbox') {
                $chosen = is_array($raw) ? $raw : ($raw === null || $raw === '' ? [] : [$raw]);
                $labels = [];
                foreach ($chosen as $v) {
                    $label = is_scalar($v) ? self::optionLabel($f, (string) $v) : null;
                    if ($label === null) {
                        $ok = false;
                    } elseif (!in_array($label, $labels, true)) {
                        $labels[] = $label;
                    }
                }
                $value = implode(', ', $labels);
            } elseif (is_array($raw)) {
                $ok = false;
            } elseif ($f['type'] === 'select' || $f['type'] === 'radio') {
                $v = self::line((string) ($raw ?? ''));
                if ($v !== '') {
                    $label = $f['core'] === 'service' ? $this->app->contactServices()->labelFor($v) : self::optionLabel($f, $v);
                    $ok = $label !== null;
                    $value = (string) $label;
                }
            } elseif ($f['type'] === 'textarea') {
                $value = self::multiline((string) ($raw ?? ''));
                $len = mb_strlen($value);
                $ok = $len <= (int) $f['max'] && ($f['core'] !== 'message' || $len === 0 || $len >= 10);
            } else {
                $value = self::line((string) ($raw ?? ''));
                $len = mb_strlen($value);
                if ($value !== '') {
                    $ok = match ($f['type']) {
                        'email' => $len <= 180 && filter_var($value, FILTER_VALIDATE_EMAIL) !== false,
                        'tel' => (bool) preg_match('/^[0-9+\-\s()]{8,30}$/u', $value),
                        'number' => is_numeric($value) && $len <= 30 && ($f['min'] === null || (float) $value >= $f['min']) && ($f['max'] === null || (float) $value <= $f['max']),
                        'date' => self::dateOk($value, $f['future'] ?? false, $tz),
                        default => $len <= (int) $f['max'] && ($f['core'] !== 'name' || $len >= 2),
                    };
                }
            }
            if ($ok && $value === '' && $f['required']) {
                $ok = false;
            }
            if (!$ok) {
                $errors[] = $id;
                continue;
            }
            if ($f['core'] !== null) {
                $lead[$f['core']] = $value;
            } elseif ($value !== '') {
                $answers[] = ['id' => $id, 'label' => $f['label']['es'], 'value' => $value];
            }
        }
        return ['lead' => $lead, 'answers' => $answers, 'errors' => $errors];
    }

    // ------------------------------------------------------------------ helpers

    private function stored(): array
    {
        return $this->app->settings()->getJson(self::KEY);
    }

    /** Every key in a fixed order, so equal questions compare equal. */
    private static function normalized(array $f): array
    {
        $type = (string) $f['type'];
        $core = isset(self::CORE[$f['core'] ?? '']) ? (string) $f['core'] : null;
        $pair = fn ($v) => ['es' => (string) ($v['es'] ?? ''), 'en' => (string) ($v['en'] ?? '')];
        $out = [
            'id' => (string) $f['id'], 'core' => $core, 'type' => $type,
            'label' => $pair($f['label'] ?? []), 'help' => $pair($f['help'] ?? []),
            'required' => (bool) ($f['required'] ?? false), 'width' => ($f['width'] ?? '') === 'half' ? 'half' : 'full',
        ];
        if (in_array($type, self::WITH_OPTIONS, true)) {
            $out['options'] = array_values(array_map(fn ($o) => ['id' => (string) $o['id'], 'es' => (string) $o['es'], 'en' => (string) ($o['en'] ?? '')], (array) ($f['options'] ?? [])));
        }
        if ($type === 'text' || $type === 'textarea') {
            $out['max'] = (int) ($f['max'] ?? self::TEXT_MAX[$core ?? $type]);
        } elseif ($type === 'number') {
            $out['min'] = isset($f['min']) ? (float) $f['min'] : null;
            $out['max'] = isset($f['max']) ? (float) $f['max'] : null;
        } elseif ($type === 'date') {
            $out['future'] = (bool) ($f['future'] ?? false);
        }
        return $out;
    }

    /** @return array{es:string,en:string} */
    private function pair(mixed $v, int $max, string $path, array &$errors, bool $required): array
    {
        $v = is_array($v) ? $v : [];
        $es = self::plain($v['es'] ?? '');
        $en = self::plain($v['en'] ?? '');
        if ($es === null) {
            $errors[$path . '.es'] = 'no_html';
        } elseif ($required && $es === '') {
            $errors[$path . '.es'] = 'required';
        } elseif ($required && mb_strlen($es) < 2) {
            $errors[$path . '.es'] = 'too_short';
        } elseif (mb_strlen($es) > $max) {
            $errors[$path . '.es'] = 'too_long';
        }
        if ($en === null) {
            $errors[$path . '.en'] = 'no_html';
        } elseif (mb_strlen($en) > $max) {
            $errors[$path . '.en'] = 'too_long';
        }
        return ['es' => (string) $es, 'en' => (string) $en];
    }

    /** @return list<array{id:string,es:string,en:string}> */
    private function options(mixed $opts, string $type, array $known, string $path, array &$errors): array
    {
        if (!is_array($opts) || !array_is_list($opts) || !$opts) {
            $errors[$path] = 'required';
            return [];
        }
        if (count($opts) < ($type === 'checkbox' ? 1 : 2)) {
            $errors[$path] = 'too_few';
        } elseif (count($opts) > self::MAX_OPTIONS) {
            $errors[$path] = 'too_many';
        }
        $out = [];
        $seenIds = [];
        $seenNames = [];
        foreach ($opts as $j => $o) {
            if (!is_array($o)) {
                throw new ApiError(400, 'malformed_request');
            }
            $es = self::plain($o['es'] ?? '');
            $en = self::plain($o['en'] ?? '');
            $k = "{$path}.{$j}";
            if ($es === null || $en === null) {
                $errors[$k] = 'no_html';
            } elseif ($es === '') {
                $errors[$k] = 'required';
            } elseif (mb_strlen($es) > self::MAX_OPTION || mb_strlen($en) > self::MAX_OPTION) {
                $errors[$k] = 'too_long';
            } elseif (isset($seenNames[mb_strtolower($es)])) {
                $errors[$k] = 'duplicate';
            }
            $id = is_string($o['id'] ?? null) ? $o['id'] : '';
            if (!in_array($id, $known, true) || !preg_match('/^o_[a-f0-9]{4}$/', $id) || isset($seenIds[$id])) {
                $id = self::newId('o_', 2);
                while (isset($seenIds[$id]) || in_array($id, $known, true)) {
                    $id = self::newId('o_', 2);
                }
            }
            $seenIds[$id] = true;
            if (is_string($es) && $es !== '') {
                $seenNames[mb_strtolower($es)] = true;
            }
            $out[] = ['id' => $id, 'es' => (string) $es, 'en' => (string) $en];
        }
        return $out;
    }

    /** Spanish text of an option chosen by id; null when it is not offered. */
    private static function optionLabel(array $f, string $id): ?string
    {
        foreach ($f['options'] ?? [] as $o) {
            if ($o['id'] === $id) {
                return $o['es'];
            }
        }
        return null;
    }

    private static function dateOk(string $v, bool $future, \DateTimeZone $tz): bool
    {
        if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $m) || !checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            return false;
        }
        return !$future || $v >= (new \DateTimeImmutable('now', $tz))->format('Y-m-d');
    }

    /** float, null (empty) or false (not a number) */
    private static function number(mixed $v): float|null|false
    {
        if ($v === null || $v === '') {
            return null;
        }
        return is_int($v) || is_float($v) || (is_string($v) && is_numeric($v)) ? (float) $v : false;
    }

    /** Plain one-line text: null when it contains markup or control characters. */
    private static function plain(mixed $v): ?string
    {
        if (!is_string($v)) {
            return $v === null ? '' : null;
        }
        $v = trim((string) preg_replace('/\s+/u', ' ', $v));
        if (!mb_check_encoding($v, 'UTF-8') || preg_match('/[\x00-\x1F\x7F<>]/u', $v)) {
            return null;
        }
        return $v;
    }

    /** One line, control characters removed (as the handler always did). */
    public static function line(string $v): string
    {
        $v = (string) preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $v);
        return trim((string) preg_replace('/\s+/u', ' ', $v));
    }

    /** Several lines: paragraph breaks kept, spaces within a line collapsed. */
    public static function multiline(string $v): string
    {
        $v = (string) preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $v);
        $lines = array_map(fn ($l) => trim((string) preg_replace('/[ \t]+/u', ' ', $l)), explode("\n", str_replace(["\r\n", "\r"], "\n", $v)));
        return trim(implode("\n", $lines));
    }

    private static function newId(string $prefix, int $bytes): string
    {
        return $prefix . bin2hex(random_bytes($bytes));
    }
}
