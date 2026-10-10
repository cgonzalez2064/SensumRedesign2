<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Http\Response;
use Sensum\Cms\TranslationError;

/**
 * Automatic translation settings (owner): the DeepL key — stored encrypted,
 * never returned — an on/off switch and a connection test with the month's
 * usage. Saving needs the owner's password again and is logged.
 */
final class TranslationController extends Controller
{
    public function index(): never
    {
        Response::ok(['translation' => $this->app->translationSettings()->overview()]);
    }

    public function save(): never
    {
        $this->confirmPassword('translation_settings');
        $in = $this->req->json();
        if (!is_bool($in['enabled'] ?? null)) {
            throw ApiError::validation(['enabled' => 'invalid']);
        }
        $key = null;
        if (($in['removeKey'] ?? false) === true) {
            $key = '';
        } elseif (is_string($in['key'] ?? null) && trim($in['key']) !== '') {
            $key = $in['key'];
        }
        $this->app->translationSettings()->save($in['enabled'], $key);
        $this->app->activity($this->uid(), 'translation_settings_changed', '', ['enabled' => $in['enabled'], 'key' => $key === null ? 'kept' : ($key === '' ? 'removed' : 'changed')], $this->req->ip());
        Response::ok(['translation' => $this->app->translationSettings()->overview()]);
    }

    /** Checks the key with DeepL and returns this period's usage. */
    public function test(): never
    {
        if (!$this->app->rateLimiter()->hit('translation_test', (string) $this->uid(), 20, 3600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $tr = $this->app->translator();
        if (!$tr->isEnabled()) {
            throw new ApiError(503, 'translation_unavailable');
        }
        try {
            $usage = $tr->usage();
            $sample = $tr->translate([['text' => 'Construimos tu proyecto con planificación y precisión.', 'emphasis' => false]], 'es', 'en')[0];
        } catch (TranslationError $e) {
            throw new ApiError(503, $e->getMessage());
        }
        Response::ok(['plan' => $tr->plan(), 'used' => $usage['used'], 'limit' => $usage['limit'], 'sample' => $sample]);
    }
}
