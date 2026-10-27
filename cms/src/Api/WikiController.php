<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Http\Response;
use Sensum\Cms\Wiki;

/** Wiki (#/wiki): every signed-in account, whatever its role. See Wiki.php. */
final class WikiController extends Controller
{
    private function wikiLang(): string
    {
        $l = $this->req->query('lang');
        return in_array($l, Wiki::LANGS, true) ? $l : ((string) ($this->session['lang'] ?? 'es') === 'en' ? 'en' : 'es');
    }

    /** Categories, the articles this account may read (with their text) and its «Novedades». */
    public function index(): never
    {
        $wiki = new Wiki($this->app);
        $lang = $this->wikiLang();
        $categories = array_map(fn ($c) => [
            'id' => (string) $c['id'],
            'icon' => (string) ($c['icon'] ?? 'question-circle'),
            'title' => (string) ($c[$lang]['title'] ?? $c['id']),
            'lead' => (string) ($c[$lang]['lead'] ?? ''),
        ], $wiki->meta()['categories']);
        Response::ok([
            'lang' => $lang,
            'categories' => $categories,
            'articles' => $wiki->articles((array) $this->session, $lang),
            'news' => $wiki->news((array) $this->session, $lang),
        ]);
    }

    /** Only the «Novedades» not seen yet (the panel shows them once, after signing in). */
    public function news(): never
    {
        $items = array_values(array_filter((new Wiki($this->app))->news((array) $this->session, $this->wikiLang()), fn ($n) => !$n['seen']));
        Response::ok(['news' => $items]);
    }

    public function seen(): never
    {
        $ids = $this->req->json()['ids'] ?? null;
        if (!is_array($ids) || !$ids || count($ids) > 50) {
            throw ApiError::validation(['ids' => 'invalid']);
        }
        Response::ok(['marked' => (new Wiki($this->app))->markSeen($this->uid(), $ids)]);
    }

    /** A screenshot in the account's language, theme and device (private cache: signed-in only). */
    public function image(): never
    {
        $file = (new Wiki($this->app))->imagePath($this->req->query('name'), $this->req->query('lang'), $this->req->query('theme'), $this->req->query('device'));
        if ($file === null) {
            throw new ApiError(404, 'not_found');
        }
        $etag = '"' . substr(sha1($file . '|' . filemtime($file) . '|' . filesize($file)), 0, 20) . '"';
        header('Cache-Control: private, max-age=604800');
        header('ETag: ' . $etag);
        header('X-Content-Type-Options: nosniff');
        if (trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) === $etag) {
            http_response_code(304);
            exit;
        }
        header('Content-Type: image/webp');
        header('Content-Length: ' . filesize($file));
        readfile($file);
        exit;
    }
}
