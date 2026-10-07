<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\Health;
use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Http\Response;

/** Health, dashboard summary, error telemetry and manual republish. */
final class SystemController extends Controller
{
    /** Public health check: status per area only — no versions, paths or settings. */
    public function health(): never
    {
        $checks = Health::checks($this->app, false);
        $status = Health::summary($checks);
        if ($status !== 'ok') {
            // Critical: logged and e-mailed to IT (throttled). An uptime monitor polling
            // this endpoint therefore also triggers alerts.
            $this->app->monitor()->reportHealth($checks);
        }
        Response::json($status === 'ok' ? 200 : 503, [
            'ok' => $status === 'ok',
            'status' => $status,
            'time' => gmdate('c'),
            'checks' => array_map(fn ($c) => $c['ok'] ? 'ok' : 'fail', $checks),
        ]);
    }

    /**
     * Receives JavaScript errors from the admin panel (and, only when
     * PUBLIC_ERROR_REPORTING=true, from the public site). Small, throttled,
     * and recorded in the error log — never with cookies, form values or user data.
     */
    public function clientError(): never
    {
        $source = $this->str('source');
        if (!in_array($source, ['admin', 'public'], true)) {
            throw new ApiError(400, 'malformed_request');
        }
        if ($source === 'public' && !$this->app->config->bool('PUBLIC_ERROR_REPORTING')) {
            Response::json(202, ['ok' => true]);
        }
        $rl = $this->app->rateLimiter();
        if ($rl->hit('client_error_ip', $this->req->ip(), 30, 3600) && $rl->hit('client_error_all', 'global', 500, 86400)) {
            $page = (string) parse_url($this->str('page'), PHP_URL_PATH);
            $this->app->errors()->record('error', $source, 'client_error', ['message' => $this->str('message'), 'location' => $this->str('location'), 'request' => $page]);
        }
        Response::json(202, ['ok' => true]);
    }

    public function dashboard(): never
    {
        $db = $this->app->db();
        $settings = $this->app->settings();
        $isAdmin = $this->session['role'] === 'admin';
        $isOwner = $this->app->auth()->isOwner($this->session);
        $publishedAt = (int) $settings->get('last_published_at', '0');
        $publishedBy = (int) $settings->get('last_published_by', '0');

        // Is the live site in sync with saved content? (e.g. after a deployment)
        $inSync = $this->app->monitor()->siteInSync();

        // Fields whose published value differs from the approved default.
        $schema = $this->app->schema();
        $customized = 0;
        foreach ($this->app->content()->values() as $key => $langs) {
            foreach ($langs as $lang => $value) {
                if ($value !== $schema->default($key, $lang)) {
                    $customized++;
                    break;
                }
            }
        }
        $photos = (int) $db->value("SELECT COUNT(*) FROM media WHERE deleted_at IS NULL AND kind = 'image'");
        $failedReports = $isAdmin
            ? (int) $db->value("SELECT COUNT(*) FROM support_reports WHERE email_status <> 'sent'")
            : (int) $db->value("SELECT COUNT(*) FROM support_reports WHERE email_status <> 'sent' AND user_id = ?", [$this->uid()]);

        $checks = Health::checks($this->app, false);
        $health = Health::summary($checks);
        $out = [
            'site' => [
                'url' => $this->app->config->appUrl(),
                'publishedAt' => $publishedAt ?: null,
                'publishedBy' => $publishedBy ? $db->value('SELECT name FROM users WHERE id = ?', [$publishedBy]) : null,
                'inSync' => $inSync,
                'drift' => $settings->getJson('last_drift') ?: null,
            ],
            'stats' => ['customizedFields' => $customized, 'photos' => $photos],
            'reports' => ['pending' => $failedReports],
            'health' => ['status' => $health],
            'telemetry' => [
                'publicErrors' => $this->app->config->bool('PUBLIC_ERROR_REPORTING'),
                'analytics' => (bool) preg_match('/^[a-f0-9]{32}$/i', $this->app->config->string('CF_WEB_ANALYTICS_TOKEN')),
            ],
        ];

        if ($health !== 'ok') {
            $this->app->monitor()->reportHealth($checks);
        }
        // Technical diagnostics and errors: owner account only (see Monitoring).
        if ($isOwner) {
            $out['health']['checks'] = Health::checks($this->app, true);
            $out['errors'] = array_map(fn ($r) => [
                'source' => $r['source'], 'severity' => $r['severity'], 'event' => $r['event'], 'message' => $r['message'],
                'location' => $r['location'], 'page' => $r['request'], 'count' => (int) $r['n'], 'lastSeen' => (int) $r['last'],
            ], $db->all(
                'SELECT source, severity, event, message, location, request, COUNT(*) AS n, MAX(created_at) AS last FROM error_log
                  WHERE created_at > ? GROUP BY fingerprint ORDER BY last DESC LIMIT 8',
                [time() - 14 * 86400]
            ));
        }
        if ($isAdmin) {
            $out['activity'] = array_map(fn ($r) => [
                'action' => $r['action'], 'target' => $r['target'], 'user' => $r['name'], 'at' => (int) $r['created_at'],
            ], $db->all(
                "SELECT a.action, a.target, a.created_at, u.name FROM activity_log a LEFT JOIN users u ON u.id = a.user_id
                  WHERE a.action IN ('content_updated','media_uploaded','media_removed','media_alt_updated','media_reordered','user_invited','invitation_accepted','user_updated','user_deleted','password_changed','password_reset_completed','report_submitted','report_email_failed','publish_manual','login_throttled')
                  ORDER BY a.id DESC LIMIT 12"
            ));
        }
        Response::ok($out);
    }

    public function republish(): never
    {
        $result = $this->app->publisher()->publish($this->uid(), 'manual');
        $this->app->activity($this->uid(), 'publish_manual', '', ['changed' => $result['changed']], $this->req->ip());
        Response::ok(['publishedAt' => $result['published_at'], 'changed' => $result['changed']]);
    }
}
