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

    protected function str(string $name): string
    {
        return $this->req->input($name);
    }

    protected function lang(string $name = 'lang'): string
    {
        return $this->str($name) === 'en' ? 'en' : 'es';
    }
}
