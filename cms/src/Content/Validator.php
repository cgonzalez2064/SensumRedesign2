<?php
declare(strict_types=1);

namespace Sensum\Cms\Content;

/**
 * Server-side normalization + validation of every editable value.
 * Returns [normalizedValue, errorCode|null]. Error codes are translated by
 * the admin UI. All input is treated as untrusted plain text.
 */
final class Validator
{
    public static function normalizeText(string $v, bool $multiline = false): string
    {
        if (!mb_check_encoding($v, 'UTF-8')) {
            return '';
        }
        if (class_exists(\Normalizer::class)) {
            $v = \Normalizer::normalize($v, \Normalizer::FORM_C) ?: $v;
        }
        // Control characters (incl. bidi overrides / zero-width tricks) out.
        $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}\x{FEFF}]/u', '', $v) ?? '';
        // HTML collapses whitespace anyway; store what will actually render.
        $v = preg_replace('/\s+/u', ' ', $v) ?? '';
        return trim($v);
    }

    /** @return array{0:string,1:?string} */
    public static function validate(array $field, string $raw): array
    {
        $type = $field['type'];
        $required = $field['required'] ?? true;
        $max = (int) ($field['max'] ?? 200);
        $v = self::normalizeText($raw, $type === 'textarea');

        if ($v === '') {
            return ['', $required ? 'required' : null];
        }

        switch ($type) {
            case 'text':
            case 'textarea':
            case 'emphasis':
                // The public i18n toggle treats any value containing "<" as HTML.
                // Refusing angle brackets makes stored/DOM XSS impossible by construction.
                if (preg_match('/[<>]/', $v)) {
                    return [$v, 'no_html'];
                }
                if (mb_strlen($type === 'emphasis' ? str_replace('*', '', $v) : $v) > $max) {
                    return [$v, 'too_long'];
                }
                if ($type === 'emphasis') {
                    if (substr_count($v, '*') % 2 !== 0) {
                        return [$v, 'emphasis_unbalanced'];
                    }
                    if (preg_match('/\*\s*\*/', $v)) {
                        return [$v, 'emphasis_empty'];
                    }
                }
                return [$v, null];

            case 'phone':
                if (!preg_match('/^[0-9+()\- ]{8,20}$/', $v)) {
                    return [$v, 'invalid_phone'];
                }
                $digits = preg_replace('/\D/', '', $v) ?? '';
                if (strlen($digits) < 8 || strlen($digits) > 15) {
                    return [$v, 'invalid_phone'];
                }
                return [preg_replace('/\s*-\s*/', '-', $v) ?? $v, null];

            case 'whatsapp':
                $digits = preg_replace('/[\s+()\-]/', '', $v) ?? '';
                if (!preg_match('/^\d{8,15}$/', $digits)) {
                    return [$v, 'invalid_whatsapp'];
                }
                if (strlen($digits) === 8) {
                    $digits = '502' . $digits; // a local Guatemalan number
                }
                return [$digits, null];

            case 'email':
                $v = mb_strtolower($v);
                if (mb_strlen($v) > $max || !filter_var($v, FILTER_VALIDATE_EMAIL) || preg_match('/[^\x21-\x7E]/', $v)) {
                    return [$v, 'invalid_email'];
                }
                return [$v, null];

            case 'url':
                if (mb_strlen($v) > $max || preg_match('/\s/', $v)) {
                    return [$v, 'invalid_url'];
                }
                $p = parse_url($v);
                if (!$p || ($p['scheme'] ?? '') !== 'https' || empty($p['host']) || isset($p['user']) || isset($p['pass']) || isset($p['port'])) {
                    return [$v, 'invalid_url'];
                }
                if (!in_array(strtolower($p['host']), $field['hosts'] ?? [], true)) {
                    return [$v, 'url_host_not_allowed'];
                }
                if (preg_match('/[<>"\'`\\\\]/', $v)) {
                    return [$v, 'invalid_url'];
                }
                return [$v, null];

            case 'handle':
                $h = ltrim($v, '@');
                if (!preg_match('/^[A-Za-z0-9._]{1,30}$/', $h)) {
                    return [$v, 'invalid_handle'];
                }
                return ['@' . $h, null];
        }
        return [$v, 'invalid'];
    }
}
