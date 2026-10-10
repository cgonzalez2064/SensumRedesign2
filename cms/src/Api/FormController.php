<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\ContactServices;
use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Http\Response;

/**
 * The public contact form's "Servicio de interés" options (Sitio web →
 * Formulario de contacto). Same access as the business details ("contact").
 * Saving publishes the site in the same request; if publishing fails the
 * change is rolled back.
 */
final class FormController extends Controller
{
    public function services(): never
    {
        $this->requirePermission('contact');
        $svc = $this->app->contactServices();
        Response::ok([
            'items' => $svc->items(),
            'defaults' => ContactServices::defaults(),
            'version' => $svc->version(),
            'isDefault' => $svc->isDefault(),
            'maxItems' => ContactServices::MAX_ITEMS,
            'maxLabel' => ContactServices::MAX_LABEL,
        ]);
    }

    public function saveServices(): never
    {
        $this->requirePermission('contact');
        $items = $this->req->raw('items');
        if (!is_array($items)) {
            throw new ApiError(400, 'malformed_request');
        }
        $version = (int) $this->str('version');
        $svc = $this->app->contactServices();
        $result = $this->app->db()->transaction(function () use ($svc, $items, $version) {
            if ($svc->version() !== $version) {
                throw new ApiError(409, 'conflict');
            }
            $before = $svc->items();
            $after = $svc->save($items, $this->uid());
            if ($after === $before) {
                return ['changed' => false, 'published' => null];
            }
            $published = $this->app->publisher()->publish($this->uid(), 'contact_services');
            $this->app->activity($this->uid(), 'contact_services_updated', 'contact_form', [
                'before' => array_column($before, 'es'),
                'after' => array_column($after, 'es'),
            ], $this->req->ip());
            return ['changed' => true, 'published' => $published['published_at']];
        });
        Response::ok([
            'changed' => $result['changed'],
            'publishedAt' => $result['published'],
            'items' => $svc->items(),
            'version' => $svc->version(),
            'isDefault' => $svc->isDefault(),
        ]);
    }
}
