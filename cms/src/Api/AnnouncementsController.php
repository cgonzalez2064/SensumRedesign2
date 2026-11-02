<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\Announcements;
use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Http\Response;

/** «Avisos al equipo» (owner only): the panel's «Novedades» by e-mail. See Announcements.php. */
final class AnnouncementsController extends Controller
{
    private function ownLang(): string
    {
        return (string) ($this->session['lang'] ?? 'es') === 'en' ? 'en' : 'es';
    }

    /** The «Novedades» with who can use, saw and got each one, and the last sends. */
    public function index(): never
    {
        Response::ok((new Announcements($this->app))->overview($this->ownLang()));
    }

    /** Who would get it with these choices (nothing is sent). */
    public function recipients(): never
    {
        $j = $this->req->json();
        $a = new Announcements($this->app);
        $list = $a->recipients($a->validIds($j['ids'] ?? null), !empty($j['again']), !empty($j['unseenOnly']));
        Response::ok(['recipients' => array_map(fn ($r) => [
            'id' => (int) $r['user']['id'],
            'name' => (string) $r['user']['name'],
            'email' => (string) $r['user']['email'],
            'lang' => (string) $r['user']['lang'] === 'en' ? 'en' : 'es',
            'items' => $r['items'],
        ], $list)]);
    }

    /** A test to the owner's own address. */
    public function test(): never
    {
        $j = $this->req->json();
        $a = new Announcements($this->app);
        $sent = $a->test($a->validIds($j['ids'] ?? null), Announcements::cleanMessage($j['message'] ?? ''), (array) $this->session, $this->req->ip());
        Response::ok(['sent' => $sent, 'to' => (string) $this->session['email']]);
    }

    /** «No avisar»: puts these items aside (no reminder, not pre-selected), or undoes it. */
    public function dismiss(): never
    {
        $j = $this->req->json();
        $a = new Announcements($this->app);
        $a->dismiss($a->validIds($j['ids'] ?? null), ($j['dismiss'] ?? true) !== false, $this->uid(), $this->req->ip());
        Response::ok($a->overview($this->ownLang()));
    }

    /** Whether the owner gets an e-mail when an update brings «Novedades». */
    public function settings(): never
    {
        $notify = $this->req->raw('notify');
        if (!is_bool($notify)) {
            throw ApiError::validation(['notify' => 'invalid']);
        }
        (new Announcements($this->app))->setNotify($notify, $this->uid(), $this->req->ip());
        Response::ok(['notify' => $notify]);
    }

    public function send(): never
    {
        $j = $this->req->json();
        $a = new Announcements($this->app);
        Response::ok($a->send($a->validIds($j['ids'] ?? null), Announcements::cleanMessage($j['message'] ?? ''), !empty($j['again']), !empty($j['unseenOnly']), (array) $this->session, $this->req->ip()));
    }
}
