<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\App;
use Sensum\Cms\Http\Request;

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

    protected function str(string $name): string
    {
        return $this->req->input($name);
    }

    protected function lang(string $name = 'lang'): string
    {
        return $this->str($name) === 'en' ? 'en' : 'es';
    }
}
