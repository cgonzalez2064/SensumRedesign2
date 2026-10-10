<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Http\Response;
use Sensum\Cms\Reports;
use Sensum\Cms\Tickets;

/**
 * "Reportar un problema" and the support tickets (signed-in users). Everyone
 * sees and answers their own tickets; the owner account (IT) sees all of them
 * and manages status, priority, edits, replies and internal notes.
 */
final class ReportsController extends Controller
{
    private function tickets(): Tickets
    {
        return new Tickets($this->app);
    }

    public function index(): never
    {
        $list = $this->tickets()->list((array) $this->session, $this->req->query('status') ?: 'open', $this->req->query('q'));
        Response::ok($list + ['supportEmail' => $this->app->mailSettings()->supportEmail(), 'canManage' => $this->isOwner(), 'slaHours' => $this->isOwner() ? $this->tickets()->slaHours() : null]);
    }

    public function badge(): never
    {
        Response::ok(['count' => $this->tickets()->badge((array) $this->session)]);
    }

    public function show(int $id): never
    {
        Response::ok($this->tickets()->detail((array) $this->session, $id));
    }

    public function update(int $id): never
    {
        $in = $this->req->json();
        Response::ok($this->tickets()->edit((array) $this->session, $id, array_intersect_key($in, array_flip(['title', 'description', 'type', 'area', 'priority']))));
    }

    public function status(int $id): never
    {
        $in = $this->req->json();
        Response::ok($this->tickets()->setStatus((array) $this->session, $id, $this->str('status'), $this->str('message'), ($in['notify'] ?? true) === true));
    }

    public function message(int $id): never
    {
        $in = $this->req->json();
        Response::ok($this->tickets()->addMessage((array) $this->session, $id, $this->str('body'), ($in['internal'] ?? false) === true, ($in['notify'] ?? true) === true));
    }

    /** The reporter rates the help on a resolved ticket (1–5, optional comment). */
    public function rate(int $id): never
    {
        $in = $this->req->json();
        Response::ok($this->tickets()->rate((array) $this->session, $id, $in['rating'] ?? null, $this->str('comment')));
    }

    /** Owner: response-time target used in the figures and the monthly report. */
    public function settings(): never
    {
        if (!$this->isOwner()) {
            throw new ApiError(403, 'forbidden');
        }
        $in = $this->req->json();
        $hours = $this->tickets()->setSlaHours($in['slaHours'] ?? null);
        $this->app->activity($this->uid(), 'ticket_settings_changed', '', ['slaHours' => $hours], $this->req->ip());
        Response::ok(['slaHours' => $hours]);
    }

    /** The screenshot sent with a ticket (its author or the owner). */
    public function screenshot(int $id): never
    {
        $file = $this->tickets()->screenshot((array) $this->session, $id);
        header('Content-Type: ' . $file['mime']);
        header('Content-Length: ' . filesize($file['path']));
        header('Cache-Control: private, no-store');
        header('X-Content-Type-Options: nosniff');
        header('Content-Disposition: inline; filename="captura-reporte-' . $id . '.' . ($file['mime'] === 'image/webp' ? 'webp' : 'jpg') . '"');
        header("Content-Security-Policy: default-src 'none'; img-src 'self'; sandbox");
        readfile($file['path']);
        exit;
    }

    public function create(): never
    {
        $in = [
            'type' => $this->str('type'),
            'title' => $this->str('title'),
            'description' => $this->str('description'),
            'area' => $this->str('area'),
            'page' => $this->str('page'),
            'context' => $this->req->raw('context'),
        ];
        $result = (new Reports($this->app))->create($this->session, $in, $this->req->file('screenshot'));
        // 201 = stored and e-mailed; 202 = stored but the e-mail is pending (retry available).
        Response::json($result['delivered'] ? 201 : 202, ['ok' => true] + $result);
    }

    public function retry(int $id): never
    {
        $result = (new Reports($this->app))->retry($this->session, $id);
        Response::json($result['delivered'] ? 200 : 202, ['ok' => true] + $result);
    }
}
