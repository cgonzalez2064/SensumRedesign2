<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\App;
use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Http\Request;
use Sensum\Cms\Passwords;
use Sensum\Cms\Users;

abstract class Controller
{
    public function __construct(protected App $app, protected Request $req, protected ?array $session)
    {
    }

    protected function uid(): int
    {
        return (int) ($this->session['uid'] ?? 0);
    }

    /** @throws \Sensum\Cms\Http\ApiError 403 unless the account may change this kind of information */
    protected function requirePermission(string $permission): void
    {
        $this->app->auth()->assertCan((array) $this->session, $permission);
    }

    protected function isOwner(): bool
    {
        return $this->session !== null && $this->app->auth()->isOwner($this->session);
    }

    /**
     * Sensitive owner actions: the person types their password again
     * (`currentPassword`). Throttled together with password changes.
     */
    protected function confirmPassword(string $target): void
    {
        $rl = $this->app->rateLimiter();
        if ($rl->tooMany('password_change', (string) $this->uid(), 5, 900)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $user = (new Users($this->app))->find($this->uid());
        $current = $this->str('currentPassword');
        if ($current === '' || !$user || !Passwords::verify($current, (string) $user['password_hash'])) {
            $rl->hit('password_change', (string) $this->uid(), PHP_INT_MAX, 900);
            $this->app->activity($this->uid(), 'password_change_failed', $target, [], $this->req->ip());
            throw ApiError::validation(['currentPassword' => 'current_password_wrong']);
        }
    }

    protected function str(string $name): string
    {
        return $this->req->input($name);
    }

    protected function lang(string $name = 'lang'): string
    {
        return $this->str($name) === 'en' ? 'en' : 'es';
    }
}
