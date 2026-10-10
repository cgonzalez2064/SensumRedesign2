<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\Auth;
use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Http\Response;
use Sensum\Cms\Users;

/**
 * "Ver como" (owner only): see the panel exactly as another account sees it,
 * to check what each access type can open. Starting needs the owner's
 * password; switching between accounts and returning don't. It is read-only
 * (the Kernel refuses every change), ends by itself after 30 minutes, and
 * each start, switch and end is logged.
 */
final class ViewAsController extends Controller
{
    private function requireOwner(): void
    {
        if (!$this->app->auth()->canViewAs((array) $this->session)) {
            throw new ApiError(403, 'forbidden');
        }
    }

    /** Who can be viewed, and the current one. */
    public function index(): never
    {
        $this->requireOwner();
        $s = (array) $this->session;
        $viewing = $this->app->auth()->viewingAs($s);
        Response::ok([
            'active' => $viewing,
            'userId' => $viewing ? (int) $s['uid'] : null,
            'until' => $viewing ? (int) $s['view_as_until'] : null,
            'minutes' => Auth::VIEW_AS_MINUTES,
            'users' => $this->app->auth()->viewAsCandidates(),
            'accessTypes' => Users::ACCESS_TYPES,
        ]);
    }

    public function start(): never
    {
        $this->requireOwner();
        $this->confirmPassword('view_as');
        if (!$this->app->rateLimiter()->hit('view_as', (string) $this->uid(), 60, 3600)) {
            throw new ApiError(429, 'too_many_attempts');
        }
        $in = $this->req->json();
        $r = $this->app->auth()->setViewAs((array) $this->session, is_int($in['userId'] ?? null) ? $in['userId'] : 0);
        $this->app->activity($this->uid(), 'view_as_started', (string) $r['userId'], [], $this->req->ip());
        Response::ok($r);
    }

    public function switch(): never
    {
        $this->requireOwner();
        $s = (array) $this->session;
        if (!$this->app->auth()->viewingAs($s)) {
            throw new ApiError(409, 'view_as_inactive'); // start (with the password) first
        }
        $in = $this->req->json();
        $r = $this->app->auth()->setViewAs($s, is_int($in['userId'] ?? null) ? $in['userId'] : 0);
        $this->app->activity($this->app->auth()->realUserId($s), 'view_as_switched', (string) $r['userId'], ['from' => (int) $s['uid']], $this->req->ip());
        Response::ok($r);
    }

    public function stop(): never
    {
        $s = (array) $this->session;
        if ($this->app->auth()->viewingAs($s)) {
            $this->app->auth()->stopViewAs($s);
            $this->app->activity($this->app->auth()->realUserId($s), 'view_as_ended', (string) $s['uid'], ['reason' => 'manual'], $this->req->ip());
        }
        Response::ok(['active' => false]);
    }
}
