<?php
declare(strict_types=1);

namespace Sensum\Cms\Api;

use Sensum\Cms\Http\ApiError;
use Sensum\Cms\Http\Response;

/**
 * "Actividad": who changed what, with filters (person, kind, dates) and paging.
 * Each account sees the kinds its access covers — content and photos with
 * "Publicación y actividad", people with "Gestión de usuarios", leads with
 * "Prospectos" — and the owner sees everything, sign-ins and settings included.
 * IP addresses are never shown (only a pseudonym is stored).
 */
final class ActivityController extends Controller
{
    /** Kinds of activity, by the action names the panel records. */
    public const GROUPS = [
        'content' => ['content_updated', 'publish_manual', 'publish', 'contact_form_updated', 'contact_services_updated', 'contact_confirmation_changed'],
        'media' => ['media_uploaded', 'media_removed', 'media_alt_updated', 'media_reordered'],
        'users' => ['user_invited', 'user_invite_resent', 'invite_reminder_sent', 'invitation_accepted', 'user_updated', 'user_deleted', 'user_profile_updated',
            'user_password_set', 'user_password_link_sent', 'two_factor_requirement', 'two_factor_reset', 'user_sessions_revoked',
            'access_requested', 'access_granted', 'access_declined', 'access_expired', 'account_auto_disabled', 'user_created_cli'],
        'leads' => ['lead_updated', 'lead_deleted', 'leads_exported', 'leads_settings_changed', 'lead_automation_changed', 'stats_exported', 'stats_shared'],
        'security' => ['login', 'logout', 'login_failed', 'login_throttled', 'login_2fa_failed', 'login_code_sent', 'login_code_failed', 'login_temp_password_expired', 'password_changed', 'password_change_failed',
            'password_reset_requested', 'password_reset_completed', 'password_reset_throttled', 'password_reset_unknown_email', 'sessions_revoked',
            'two_factor_enabled', 'two_factor_disabled', 'two_factor_recovery_codes', 'trusted_devices_forgotten', 'security_policy_changed',
            'view_as_started', 'view_as_switched', 'view_as_ended', 'setup_completed', 'setup_denied'],
        'settings' => ['email_settings_changed', 'email_test', 'translation_settings_changed', 'alert_rules_changed', 'alert_test', 'backup_settings_changed',
            'backup_downloaded', 'integrity_accepted', 'site_report_settings', 'stats_settings_changed', 'ticket_settings_changed'],
        'support' => ['report_submitted', 'report_email_failed', 'ticket_status', 'ticket_edited', 'ticket_rated'],
    ];
    /** Actions about one person (their id is the target). */
    public const ABOUT_PERSON = ['user_invited', 'user_invite_resent', 'invite_reminder_sent', 'user_updated', 'user_deleted', 'user_profile_updated', 'user_password_set',
        'user_password_link_sent', 'two_factor_requirement', 'two_factor_reset', 'user_sessions_revoked', 'access_requested', 'access_granted', 'access_declined',
        'access_expired', 'account_auto_disabled'];
    private const PAGE = 50;
    private const EXPORT_MAX = 5000;

    /** The kinds this account may see. @return list<string> */
    private function groups(): array
    {
        if ($this->isOwner()) {
            return [...array_keys(self::GROUPS), 'other'];
        }
        $auth = $this->app->auth();
        if (!$auth->can($this->session, 'site') && !$auth->can($this->session, 'users')) {
            return [];
        }
        return array_values(array_filter([
            $auth->can($this->session, 'site') ? 'content' : null,
            $auth->can($this->session, 'site') ? 'media' : null,
            $auth->can($this->session, 'users') ? 'users' : null,
            $auth->can($this->session, 'leads') ? 'leads' : null,
        ]));
    }

    public function index(): never
    {
        $groups = $this->groups();
        if (!$groups) {
            throw new ApiError(403, 'forbidden');
        }
        $group = $this->req->query('group');
        if ($group !== '' && !in_array($group, $groups, true)) {
            throw ApiError::validation(['group' => 'invalid']);
        }
        $where = [];
        $params = [];
        // Kinds: one, or all the account may see ("other" = anything not listed, owner only).
        $shown = $group !== '' ? [$group] : $groups;
        $or = [];
        foreach ($shown as $g) {
            if ($g === 'other') {
                $known = array_merge(...array_values(self::GROUPS));
                $or[] = 'a.action NOT IN (' . implode(',', array_fill(0, count($known), '?')) . ')';
                array_push($params, ...$known);
            } else {
                $or[] = 'a.action IN (' . implode(',', array_fill(0, count(self::GROUPS[$g]), '?')) . ')';
                array_push($params, ...self::GROUPS[$g]);
            }
        }
        $where[] = '(' . implode(' OR ', $or) . ')';
        // One person: what they did and what was done to their account.
        $person = $this->req->query('person');
        if ($person !== '') {
            if (!preg_match('/^[1-9]\d{0,9}$/', $person)) {
                throw ApiError::validation(['person' => 'invalid']);
            }
            $where[] = '(a.user_id = ? OR (a.action IN (' . implode(',', array_fill(0, count(self::ABOUT_PERSON), '?')) . ') AND a.target = ?))';
            array_push($params, (int) $person, ...self::ABOUT_PERSON);
            $params[] = $person;
        }
        foreach (['from' => '>=', 'to' => '<='] as $k => $op) {
            $v = $this->req->query($k);
            if ($v === '') {
                continue;
            }
            $d = preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? \DateTimeImmutable::createFromFormat('!Y-m-d', $v) : false;
            if (!$d || $d->format('Y-m-d') !== $v) {
                throw ApiError::validation([$k => 'invalid']);
            }
            $where[] = "a.created_at {$op} ?";
            $params[] = $k === 'from' ? $d->getTimestamp() : $d->setTime(23, 59, 59)->getTimestamp();
        }
        $before = $this->req->query('before');
        if ($before !== '' && preg_match('/^[1-9]\d{0,12}$/', $before)) {
            $where[] = 'a.id < ?';
            $params[] = (int) $before;
        }
        $export = $this->req->query('export') === '1';
        $limit = $export ? self::EXPORT_MAX : self::PAGE;
        $about = "'" . implode("','", self::ABOUT_PERSON) . "'";
        $rows = $this->app->db()->all(
            "SELECT a.id, a.action, a.target, a.created_at, u.name AS actor, p.name AS target_name
               FROM activity_log a
               LEFT JOIN users u ON u.id = a.user_id
               LEFT JOIN users p ON a.action IN ({$about}) AND p.id = CAST(a.target AS INTEGER)
              WHERE " . implode(' AND ', $where) . ' ORDER BY a.id DESC LIMIT ' . ($limit + 1),
            $params
        );
        $more = count($rows) > $limit;
        $rows = array_slice($rows, 0, $limit);
        $groupOf = [];
        foreach (self::GROUPS as $g => $actions) {
            foreach ($actions as $a) {
                $groupOf[$a] = $g;
            }
        }
        if ($export) {
            $this->app->activity($this->uid(), 'activity_exported', '', ['rows' => count($rows)], $this->req->ip());
        }
        Response::ok([
            'items' => array_map(fn ($r) => [
                'id' => (int) $r['id'], 'action' => (string) $r['action'], 'group' => $groupOf[$r['action']] ?? 'other',
                'actor' => $r['actor'], 'target' => (string) $r['target'], 'targetName' => $r['target_name'], 'at' => (int) $r['created_at'],
            ], $rows),
            'more' => $more,
            'groups' => $groups,
            // The people to filter by (everyone who appears in the log, by name).
            'people' => $before === '' && !$export ? array_map(fn ($u) => ['id' => (int) $u['id'], 'name' => (string) $u['name']],
                $this->app->db()->all('SELECT id, name FROM users ORDER BY name COLLATE NOCASE')) : null,
        ]);
    }
}
