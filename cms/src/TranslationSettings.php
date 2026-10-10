<?php
declare(strict_types=1);

namespace Sensum\Cms;

use Sensum\Cms\Http\ApiError;

/**
 * Automatic translation settings, set by the owner in the panel
 * (Administración → Traducción): the DeepL API key (stored encrypted, never
 * sent back to the browser) and an on/off switch. A key in the panel wins over
 * DEEPL_API_KEY in .env, which stays as the fallback for existing installs.
 */
final class TranslationSettings
{
    private const KEY = 'translation';
    private const PURPOSE = 'deepl-key';

    public function __construct(private App $app)
    {
    }

    private function stored(): array
    {
        return $this->app->settings()->getJson(self::KEY);
    }

    /** The key saved in the panel ('' when none). */
    public function panelKey(): string
    {
        $enc = $this->stored()['key'] ?? '';
        return is_string($enc) && $enc !== '' ? (string) $this->app->secrets()->decrypt($enc, self::PURPOSE) : '';
    }

    public function enabled(): bool
    {
        return ($this->stored()['enabled'] ?? true) !== false;
    }

    /** panel | env | none */
    public function source(): string
    {
        if ($this->panelKey() !== '') {
            return 'panel';
        }
        return trim($this->app->config->string('DEEPL_API_KEY')) !== '' ? 'env' : 'none';
    }

    /** What the owner sees: never the key itself, only its last characters. */
    public function overview(): array
    {
        $tr = $this->app->translator();
        $key = $tr->currentKey();
        return [
            'enabled' => $this->enabled(),
            'active' => $tr->isEnabled(),
            'source' => $this->source(),
            'plan' => $key !== '' ? $tr->plan() : null,
            'keyHint' => $key !== '' ? '••••' . substr($key, -6) : null,
            'dailyCharLimit' => $this->app->config->int('TRANSLATE_DAILY_CHAR_LIMIT', 60000, 1000),
            'updatedAt' => isset($this->stored()['updatedAt']) ? (int) $this->stored()['updatedAt'] : null,
        ];
    }

    /**
     * @param string|null $key null keeps the stored key, '' removes it
     */
    public function save(bool $enabled, ?string $key): void
    {
        $data = $this->stored();
        if ($key !== null) {
            $key = trim($key);
            if ($key === '') {
                unset($data['key']);
            } elseif (!preg_match('/^[A-Za-z0-9-]{20,64}(:fx)?$/', $key)) {
                throw ApiError::validation(['key' => 'invalid']);
            } else {
                $data['key'] = $this->app->secrets()->encrypt($key, self::PURPOSE);
            }
        }
        $data['enabled'] = $enabled;
        $data['updatedAt'] = time();
        $this->app->settings()->setJson(self::KEY, $data);
    }
}
