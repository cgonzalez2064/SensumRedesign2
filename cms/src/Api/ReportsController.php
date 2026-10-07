<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\Http\Response;
use Sensum\Cms\Reports;

/** "Reportar un problema" endpoints (signed-in users only). */
final class ReportsController extends Controller
{
    public function index(): never
    {
        Response::ok(['reports' => (new Reports($this->app))->list($this->session), 'supportEmail' => $this->app->config->supportEmail()]);
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
