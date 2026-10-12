<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\ContactFormFields;
use Sensum\Cms\ContactServices;
use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Http\Response;

/**
 * The public contact form (Sitio web → Formulario de contacto): its
 * questions, and the "Servicio de interés" options on their own (the older
 * endpoint, kept for compatibility). Same access as the business details
 * ("contact"); who receives the messages is the owner's. Saving publishes
 * the site in the same request; if publishing fails the change is rolled back.
 */
final class FormController extends Controller
{
    /** The questions, the original form, limits and who receives the messages. */
    public function form(): never
    {
        $this->requirePermission('contact');
        Response::ok($this->formPayload() + [
            'defaults' => ContactFormFields::defaults(),
            'limits' => ['maxFields' => ContactFormFields::MAX_FIELDS, 'maxOptions' => ContactFormFields::MAX_OPTIONS,
                'maxLabel' => ContactFormFields::MAX_LABEL, 'maxHelp' => ContactFormFields::MAX_HELP, 'maxOption' => ContactFormFields::MAX_OPTION],
            'recipients' => ['to' => $this->app->mailSettings()->contact()['to'], 'canEdit' => $this->isOwner() && !$this->app->mailSettings()->locked(), 'max' => 3],
        ]);
    }

    public function saveForm(): never
    {
        $this->requirePermission('contact');
        $fields = $this->req->raw('fields');
        if (!is_array($fields)) {
            throw new ApiError(400, 'malformed_request');
        }
        $version = (int) $this->str('version');
        $form = $this->app->contactFormFields();
        $result = $this->app->db()->transaction(function () use ($form, $fields, $version) {
            if ($form->version() !== $version) {
                throw new ApiError(409, 'conflict');
            }
            $before = $form->fields();
            $after = $form->save($fields, $this->uid());
            if ($after === $before) {
                return ['changed' => false, 'published' => null];
            }
            $published = $this->app->publisher()->publish($this->uid(), 'contact_form');
            $this->app->activity($this->uid(), 'contact_form_updated', 'contact_form', [
                'before' => array_map(fn ($f) => $f['label']['es'] . ($f['required'] ? ' *' : ''), $before),
                'after' => array_map(fn ($f) => $f['label']['es'] . ($f['required'] ? ' *' : ''), $after),
            ], $this->req->ip());
            return ['changed' => true, 'published' => $published['published_at']];
        });
        Response::ok(['changed' => $result['changed'], 'publishedAt' => $result['published']] + $this->formPayload());
    }

    /** Who receives the form's messages: owner only, with their password; the owner gets a security notice. */
    public function saveRecipients(): never
    {
        $this->confirmPassword('contact_recipients');
        $settings = $this->app->mailSettings();
        $before = $settings->contact()['to'];
        $after = $settings->saveContactRecipients($this->req->raw('to'));
        if ($after === $before) {
            Response::ok(['to' => $after, 'changed' => false]);
        }
        $this->app->activity($this->uid(), 'email_settings_changed', '', ['changed' => ['contact'], 'recipients' => count($after)], $this->req->ip());
        Response::okAndContinue(['to' => $after, 'changed' => true]);
        $this->app->watchdog()->settingsChanged((string) $this->session['name'], ['contact']);
        exit;
    }

    /** @return array{fields:list<array>,version:int,isDefault:bool} */
    private function formPayload(): array
    {
        $form = $this->app->contactFormFields();
        return ['fields' => $form->fields(), 'version' => $form->version(), 'isDefault' => $form->isDefault()];
    }

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
