<?php
declare(strict_types=1);

namespace Sensum\Cms;

/**
 * Automations that save the team routine work. They run with the scheduled
 * check (`bin/console monitor`) or right after the event that starts them, and
 * every notice goes out once (each one is marked as sent in the database).
 *
 * People and access (Usuarios, Seguridad):
 *   invitations      24 h before an invitation expires the person gets a reminder
 *                    with a fresh link (once); if it still expires, whoever invited
 *                    them is told. Whoever invited is also told when it is accepted.
 *   temporary access 3 days before the end date the person and whoever manages them
 *                    are told; at the end the account is turned off (Auth also
 *                    refuses it at once, even without the scheduled check).
 *   inactivity       (Seguridad, off by default) accounts unused for N days: a
 *                    warning 7 days before, then the account is turned off.
 *   access requests  «Pedir acceso» reaches whoever manages users; the answer
 *                    reaches the person.
 *
 * Prospectos (Prospectos → Automatización):
 *   assignment       each new lead goes to the person chosen for its service (or a
 *                    default person), who gets it by e-mail.
 *   follow-up        a lead still "new" after N hours: a reminder to that person.
 *   weekly summary   Mondays from 08:00, to everyone who follows leads (only when
 *                    there is something to report).
 *   confirmation     (Formulario de contacto, off by default) the visitor gets a
 *                    confirmation with the text Sensum approves.
 */
final class Automations
{
    public const INACTIVE_DAYS = [0, 90, 120, 180];
    public const FOLLOWUP_HOURS = [0, 24, 48, 72];
    /** How long a password given by someone who manages users works if it is not replaced. */
    public const TEMP_PASSWORD_HOURS = 72;
    private const INACTIVE_WARNING_DAYS = 7;
    private const ACCESS_WARNING_DAYS = 3;
    private const CONFIRMATION_MAX = 2000;

    public function __construct(private App $app)
    {
    }

    // ------------------------------------------------------------------ settings

    /** Owner's account rules (Seguridad). @return array{inactiveDays:int,rememberDevice:bool,breachedCheck:bool} */
    public function accountPolicy(): array
    {
        $s = $this->app->settings()->getJson('security_policy');
        $days = (int) ($s['inactiveDays'] ?? 0);
        return [
            'inactiveDays' => in_array($days, self::INACTIVE_DAYS, true) ? $days : 0,
            'rememberDevice' => (bool) ($s['rememberDevice'] ?? false),
            'breachedCheck' => (bool) ($s['breachedCheck'] ?? true),
        ];
    }

    /** @param array<string,mixed> $in */
    public function saveAccountPolicy(array $in): array
    {
        $s = $this->app->settings()->getJson('security_policy');
        if (array_key_exists('inactiveDays', $in)) {
            if (!in_array($in['inactiveDays'], self::INACTIVE_DAYS, true)) {
                throw Http\ApiError::validation(['inactiveDays' => 'invalid']);
            }
            $s['inactiveDays'] = $in['inactiveDays'];
        }
        foreach (['rememberDevice', 'breachedCheck'] as $k) {
            if (array_key_exists($k, $in)) {
                if (!is_bool($in[$k])) {
                    throw Http\ApiError::validation([$k => 'invalid']);
                }
                $s[$k] = $in[$k];
            }
        }
        $this->app->settings()->setJson('security_policy', $s);
        return $this->accountPolicy();
    }

    /** Prospectos → Automatización. @return array{rules:list<array{service:string,userId:int}>,fallbackUserId:?int,followupHours:int,weeklySummary:bool} */
    public function leadSettings(): array
    {
        $s = $this->app->settings()->getJson('lead_automation');
        $hours = (int) ($s['followupHours'] ?? 48);
        $rules = [];
        foreach ((array) ($s['rules'] ?? []) as $r) {
            if (is_array($r) && is_string($r['service'] ?? null) && is_int($r['userId'] ?? null)) {
                $rules[] = ['service' => $r['service'], 'userId' => $r['userId']];
            }
        }
        return [
            'rules' => $rules,
            'fallbackUserId' => is_int($s['fallbackUserId'] ?? null) ? $s['fallbackUserId'] : null,
            'followupHours' => in_array($hours, self::FOLLOWUP_HOURS, true) ? $hours : 48,
            'weeklySummary' => (bool) ($s['weeklySummary'] ?? true),
        ];
    }

    /** @param array<string,mixed> $in */
    public function saveLeadSettings(array $in): array
    {
        $people = array_column($this->leadPeople(false), 'id');
        $errors = [];
        $rules = [];
        $seen = [];
        if (!is_array($in['rules'] ?? null) || !array_is_list($in['rules']) || count($in['rules']) > 30) {
            $errors['rules'] = 'invalid';
        } else {
            foreach ($in['rules'] as $r) {
                $service = is_array($r) && is_string($r['service'] ?? null) ? trim($r['service']) : '';
                $userId = is_array($r) ? ($r['userId'] ?? null) : null;
                if ($service === '' || mb_strlen($service) > 120 || !is_int($userId) || !in_array($userId, $people, true) || isset($seen[$service])) {
                    $errors['rules'] = 'invalid';
                    break;
                }
                $seen[$service] = true;
                $rules[] = ['service' => $service, 'userId' => $userId];
            }
        }
        $fallback = $in['fallbackUserId'] ?? null;
        if ($fallback !== null && (!is_int($fallback) || !in_array($fallback, $people, true))) {
            $errors['fallbackUserId'] = 'invalid';
        }
        if (!in_array($in['followupHours'] ?? null, self::FOLLOWUP_HOURS, true)) {
            $errors['followupHours'] = 'invalid';
        }
        if (!is_bool($in['weeklySummary'] ?? null)) {
            $errors['weeklySummary'] = 'invalid';
        }
        if ($errors) {
            throw Http\ApiError::validation($errors);
        }
        $this->app->settings()->setJson('lead_automation', [
            'rules' => $rules, 'fallbackUserId' => $fallback, 'followupHours' => $in['followupHours'], 'weeklySummary' => $in['weeklySummary'],
        ]);
        return $this->leadSettings();
    }

    /** Formulario de contacto → confirmation to the visitor. @return array{enabled:bool,es:array{subject:string,body:string},en:array{subject:string,body:string}} */
    public function confirmationSettings(): array
    {
        $s = $this->app->settings()->getJson('contact_confirmation');
        $out = ['enabled' => (bool) ($s['enabled'] ?? false)];
        foreach (['es', 'en'] as $lang) {
            $t = $this->app->watchdog()->texts($lang);
            $out[$lang] = [
                'subject' => is_string($s[$lang]['subject'] ?? null) && $s[$lang]['subject'] !== '' ? $s[$lang]['subject'] : $t['au.confirm.subject'],
                'body' => is_string($s[$lang]['body'] ?? null) && $s[$lang]['body'] !== '' ? $s[$lang]['body'] : $t['au.confirm.body'],
            ];
        }
        return $out;
    }

    /** @param array<string,mixed> $in */
    public function saveConfirmationSettings(array $in): array
    {
        $errors = [];
        if (!is_bool($in['enabled'] ?? null)) {
            $errors['enabled'] = 'invalid';
        }
        $out = ['enabled' => (bool) ($in['enabled'] ?? false)];
        foreach (['es', 'en'] as $lang) {
            $subject = is_string($in[$lang]['subject'] ?? null) ? trim(str_replace(["\r", "\n"], ' ', $in[$lang]['subject'])) : '';
            $body = is_string($in[$lang]['body'] ?? null) ? trim(str_replace("\r\n", "\n", $in[$lang]['body'])) : '';
            if ($subject === '' || mb_strlen($subject) > 150) {
                $errors["{$lang}.subject"] = $subject === '' ? 'required' : 'too_long';
            }
            if ($body === '' || mb_strlen($body) > self::CONFIRMATION_MAX) {
                $errors["{$lang}.body"] = $body === '' ? 'required' : 'too_long';
            }
            $out[$lang] = ['subject' => $subject, 'body' => $body];
        }
        if ($errors) {
            throw Http\ApiError::validation($errors);
        }
        $this->app->settings()->setJson('contact_confirmation', $out);
        return $this->confirmationSettings();
    }

    // ------------------------------------------------------------------ scheduled check

    /** @return list<string> */
    public function run(?int $now = null): array
    {
        $now ??= time();
        $out = [];
        foreach ([
            'Invitations' => fn () => $this->invitations($now),
            'Temporary access' => fn () => $this->temporaryAccess($now),
            'Inactive accounts' => fn () => $this->inactivity($now),
            'Lead follow-up' => fn () => $this->leadFollowup($now),
            'Weekly lead summary' => fn () => $this->leadWeekly($now),
        ] as $name => $job) {
            try {
                $out[] = "{$name}: " . $job();
            } catch (\Throwable $e) {
                $this->app->logger()->error('automation_failed', ['job' => $name, 'type' => get_class($e), 'message' => $e->getMessage()]);
                $out[] = "{$name}: error";
            }
        }
        return $out;
    }

    /** Reminders 24 h before an invitation expires (with a fresh link), and the notice to whoever invited when it expires. */
    public function invitations(int $now): string
    {
        $db = $this->app->db();
        $reminded = 0;
        $expired = 0;
        $rows = $db->all(
            "SELECT u.*, (SELECT MAX(t.expires_at) FROM user_tokens t WHERE t.user_id = u.id AND t.purpose = 'invite' AND t.used_at IS NULL) AS invite_expires_at,
                    (SELECT MAX(t.created_at) FROM user_tokens t WHERE t.user_id = u.id AND t.purpose = 'invite' AND t.used_at IS NULL) AS invite_created_at
               FROM users u WHERE u.status = 'invited'"
        );
        foreach ($rows as $u) {
            $expires = (int) $u['invite_expires_at'];
            // A reminder only makes sense for invitations that lasted at least two days.
            if ($u['invite_reminded_at'] === null && $expires > $now && $expires - $now <= 86400 && $expires - (int) $u['invite_created_at'] >= 2 * 86400) {
                $inviter = $u['invited_by'] !== null ? (new Users($this->app))->find((int) $u['invited_by']) : null;
                $ttl = $this->app->config->int('INVITE_TTL_HOURS', 72, 1, 336);
                $token = $this->app->auth()->issueToken((int) $u['id'], 'invite', $ttl * 3600);
                $sent = $this->app->mailer()->send((new Emails($this->app))->invitationReminder($u, $inviter ? (string) $inviter['name'] : '', $token));
                $db->run('UPDATE users SET invite_reminded_at = ? WHERE id = ?', [$now, $u['id']]);
                $this->app->activity(null, 'invite_reminder_sent', (string) $u['id'], ['sent' => $sent]);
                $reminded++;
                continue;
            }
            if ($u['invite_expiry_notified_at'] === null && $expires <= $now && $u['invited_by'] !== null) {
                foreach ($this->managersOf($u) as $m) {
                    $this->notice($m, 'inviteExpired', ['person' => $u['name'], 'email' => $u['email']], 'people', [null, 'usuarios?revisar=invitaciones']);
                }
                $db->run('UPDATE users SET invite_expiry_notified_at = ? WHERE id = ?', [$now, $u['id']]);
                $expired++;
            }
        }
        return "{$reminded} reminder(s), {$expired} expiry notice(s)";
    }

    /** After an invitation is accepted: whoever invited is told. */
    public function invitationAccepted(array $user): void
    {
        try {
            if ($user['invited_by'] === null) {
                return;
            }
            $inviter = (new Users($this->app))->find((int) $user['invited_by']);
            if ($inviter && $inviter['status'] === 'active' && (int) $inviter['id'] !== (int) $user['id']) {
                $lang = self::lang($inviter);
                $this->notice($inviter, 'inviteAccepted', ['person' => $user['name'], 'email' => $user['email'],
                    'access' => $this->accessText($user, $lang)], 'people', [null, 'usuarios']);
            }
        } catch (\Throwable $e) {
            $this->app->logger()->error('automation_failed', ['job' => 'invitation_accepted', 'type' => get_class($e)]);
        }
    }

    /** Temporary access: a warning 3 days before the end date, then the account is turned off. */
    public function temporaryAccess(int $now): string
    {
        $db = $this->app->db();
        $warned = 0;
        foreach ($db->all("SELECT * FROM users WHERE status = 'active' AND access_until IS NOT NULL AND access_warned_at IS NULL AND access_until > ? AND access_until <= ?", [$now, $now + self::ACCESS_WARNING_DAYS * 86400]) as $u) {
            $vars = ['person' => $u['name'], 'email' => $u['email']];
            $managers = $this->managersOf($u);
            $this->notice($u, 'accessEnding.person', ['date' => self::date((int) $u['access_until'], self::lang($u)), 'manager' => $managers ? $managers[0]['name'] : ''], 'people', [null, '']);
            foreach ($managers as $m) {
                $this->notice($m, 'accessEnding', $vars + ['date' => self::date((int) $u['access_until'], self::lang($m))], 'people', [null, 'usuarios?revisar=temporales']);
            }
            $db->run('UPDATE users SET access_warned_at = ? WHERE id = ?', [$now, $u['id']]);
            $warned++;
        }
        $ended = 0;
        foreach ($db->all("SELECT * FROM users WHERE status = 'active' AND access_until IS NOT NULL AND access_until <= ?", [$now]) as $u) {
            $this->endTemporaryAccess($u, $now);
            $ended++;
        }
        return "{$warned} warning(s), {$ended} ended";
    }

    /** Turns off an account whose temporary access ended (also called by Auth at the next request). */
    public function endTemporaryAccess(array $u, ?int $now = null): void
    {
        $now ??= time();
        $changed = $this->app->db()->run("UPDATE users SET status = 'disabled', updated_at = ? WHERE id = ? AND status = 'active'", [$now, $u['id']])->rowCount();
        if (!$changed) {
            return;
        }
        $this->app->auth()->revokeSessions((int) $u['id']);
        $this->app->activity(null, 'access_expired', (string) $u['id'], ['until' => (int) $u['access_until']]);
        foreach ($this->managersOf($u) as $m) {
            $this->notice($m, 'accessEnded', ['person' => $u['name'], 'email' => $u['email'], 'date' => self::date((int) $u['access_until'], self::lang($m))], 'people', [null, 'usuarios?revisar=desactivadas']);
        }
    }

    /** Seguridad → accounts unused for N days: a warning, then the account is turned off. */
    public function inactivity(int $now): string
    {
        $days = $this->accountPolicy()['inactiveDays'];
        if ($days === 0) {
            return 'off';
        }
        $db = $this->app->db();
        $owner = $this->app->config->ownerEmail();
        $warned = 0;
        $disabled = 0;
        $last = 'COALESCE(last_login_at, created_at)';
        foreach ($db->all("SELECT * FROM users WHERE status = 'active' AND lower(email) <> ? AND inactive_warned_at IS NULL AND {$last} < ?", [$owner, $now - ($days - self::INACTIVE_WARNING_DAYS) * 86400]) as $u) {
            $lang = self::lang($u);
            $this->notice($u, 'inactiveWarning', ['days' => (int) floor(($now - (int) ($u['last_login_at'] ?? $u['created_at'])) / 86400),
                'date' => self::date($now + self::INACTIVE_WARNING_DAYS * 86400, $lang)], 'people', [null, '']);
            $db->run('UPDATE users SET inactive_warned_at = ? WHERE id = ?', [$now, $u['id']]);
            $warned++;
        }
        // Turned off only after the warning had its full week.
        foreach ($db->all("SELECT * FROM users WHERE status = 'active' AND lower(email) <> ? AND inactive_warned_at IS NOT NULL AND inactive_warned_at <= ? AND {$last} < ?", [$owner, $now - self::INACTIVE_WARNING_DAYS * 86400 + 3600, $now - $days * 86400]) as $u) {
            $db->run("UPDATE users SET status = 'disabled', updated_at = ? WHERE id = ?", [$now, $u['id']]);
            $this->app->auth()->revokeSessions((int) $u['id']);
            $this->app->activity(null, 'account_auto_disabled', (string) $u['id'], ['days' => $days]);
            foreach ($this->managersOf($u) as $m) {
                $this->notice($m, 'inactiveDisabled', ['person' => $u['name'], 'email' => $u['email'], 'days' => $days], 'people', [null, 'usuarios?revisar=desactivadas']);
            }
            $disabled++;
        }
        return "{$warned} warned, {$disabled} turned off";
    }

    // ------------------------------------------------------------------ access requests

    /** «Pedir acceso»: whoever manages users is told. */
    public function accessRequested(array $user, array $permissions, string $message): void
    {
        foreach ($this->managers() as $m) {
            if ((int) $m['id'] === (int) $user['id']) {
                continue;
            }
            $lang = self::lang($m);
            $this->notice($m, 'accessRequest', ['person' => $user['name'], 'email' => $user['email'], 'perms' => $this->permText($permissions, $lang)],
                'people', [null, 'usuarios?revisar=solicitudes'], $message !== '' ? [$this->app->watchdog()->texts($lang)['au.accessRequest.message'] => $message] : []);
        }
    }

    /** The answer to a request reaches the person. */
    public function accessAnswered(array $user, array $permissions, bool $granted, string $by): void
    {
        $this->notice($user, $granted ? 'accessGranted' : 'accessDeclined', ['perms' => $this->permText($permissions, self::lang($user)), 'by' => $by], 'people', [null, '']);
    }

    // ------------------------------------------------------------------ Prospectos

    /**
     * A new lead from the contact form: assigned by its service (or to the
     * default person), the assignee gets it by e-mail and, when Sensum turned
     * it on, the visitor gets a confirmation. E-mails go out after the response.
     */
    public function afterLead(int $leadId): void
    {
        try {
            $lead = $this->app->db()->one('SELECT * FROM leads WHERE id = ?', [$leadId]);
            if (!$lead) {
                return;
            }
            $assignee = $this->assign($lead);
            if ($assignee) {
                $this->notifyAssignee($lead, $assignee, 'leadAssigned');
            }
            $this->defer(fn () => $this->confirmToVisitor($lead));
        } catch (\Throwable $e) {
            $this->app->logger()->error('automation_failed', ['job' => 'after_lead', 'type' => get_class($e)]);
        }
    }

    /** Picks the person for a lead by its service; records it in the lead's history. */
    public function assign(array $lead): ?array
    {
        $s = $this->leadSettings();
        $userId = $s['fallbackUserId'];
        // Rules name the service in Spanish; a message from the English page carries its English name.
        $service = mb_strtolower(trim((string) $lead['service']));
        foreach ($this->app->contactServices()->items() as $it) {
            if ($service !== '' && in_array($service, [mb_strtolower($it['es']), mb_strtolower($it['en'])], true)) {
                $service = mb_strtolower((string) $it['es']);
                break;
            }
        }
        foreach ($s['rules'] as $r) {
            if (mb_strtolower($r['service']) === $service) {
                $userId = $r['userId'];
                break;
            }
        }
        $person = $userId !== null ? $this->leadPerson($userId) : null;
        if (!$person) {
            return null;
        }
        $this->app->db()->run('UPDATE leads SET assigned_to = ? WHERE id = ?', [$person['id'], $lead['id']]);
        $this->app->leads()->systemEvent((int) $lead['id'], ['action' => 'assigned', 'to' => (string) $person['name'], 'auto' => true]);
        return $person;
    }

    /** A lead "new" for longer than the chosen hours: one reminder to whoever follows it up. */
    public function leadFollowup(int $now): string
    {
        $hours = $this->leadSettings()['followupHours'];
        if ($hours === 0) {
            return 'off';
        }
        $n = 0;
        $rows = $this->app->db()->all("SELECT * FROM leads WHERE status = 'new' AND followup_sent_at IS NULL AND created_at <= ? AND created_at > ?", [$now - $hours * 3600, $now - 30 * 86400]);
        foreach ($rows as $lead) {
            $people = $lead['assigned_to'] !== null && ($p = $this->leadPerson((int) $lead['assigned_to'])) ? [$p] : $this->leadPeople(true);
            foreach ($people as $p) {
                $this->notifyAssignee($lead, $p, 'leadFollowup', ['hours' => $hours]);
            }
            $this->app->db()->run('UPDATE leads SET followup_sent_at = ? WHERE id = ?', [$now, $lead['id']]);
            $n++;
        }
        return "{$n} reminder(s)";
    }

    /** Mondays from 08:00: the week in Prospectos, to everyone who follows leads (when there is something to say). */
    public function leadWeekly(int $now): string
    {
        $week = date('o-\WW', $now);
        if (!$this->leadSettings()['weeklySummary']) {
            return 'off';
        }
        if ((int) date('N', $now) !== 1 || (int) date('G', $now) < 8 || $this->app->settings()->get('lead_weekly_week', '') === $week) {
            return 'not due';
        }
        $this->app->settings()->set('lead_weekly_week', $week);
        $db = $this->app->db();
        $since = $now - 7 * 86400;
        $newWeek = (int) $db->value('SELECT COUNT(*) FROM leads WHERE created_at > ?', [$since]);
        $waiting = $db->all("SELECT * FROM leads WHERE status = 'new' ORDER BY created_at LIMIT 10");
        $waitingCount = (int) $db->value("SELECT COUNT(*) FROM leads WHERE status = 'new'");
        $quoted = (int) $db->value("SELECT COUNT(*) FROM leads WHERE status = 'quoted'");
        $won = (int) $db->value("SELECT COUNT(*) FROM leads WHERE status = 'won' AND closed_at > ?", [$since]);
        if ($newWeek === 0 && $waitingCount === 0 && $quoted === 0) {
            return 'nothing to report';
        }
        $sent = 0;
        foreach ($this->leadPeople(true) as $p) {
            $lang = self::lang($p);
            $t = $this->app->watchdog()->texts($lang);
            $this->notice($p, 'leadWeekly', ['range' => date('d/m', $since) . '–' . date('d/m', $now)], 'leads', [null, 'prospectos'], [
                $t['au.leadWeekly.new'] => (string) $newWeek,
                $t['au.leadWeekly.waiting'] => (string) $waitingCount,
                $t['au.leadWeekly.quoted'] => (string) $quoted,
                $t['au.leadWeekly.won'] => (string) $won,
            ], $waiting ? $t['au.leadWeekly.itemsTitle'] : null, array_map(fn ($l) => $l['name'] . ($l['service'] !== '' ? ' · ' . $l['service'] : '') . ' · '
                . Watchdog::plural($t['au.daysAgo'], max(0, (int) floor(($now - (int) $l['created_at']) / 86400))), $waiting), false);
            $sent++;
        }
        return "sent to {$sent}";
    }

    /** Sends the visitor the confirmation Sensum approved (once per lead, at most one per address every 10 minutes). */
    public function confirmToVisitor(array $lead): bool
    {
        $c = $this->confirmationSettings();
        $email = (string) $lead['email'];
        if (!$c['enabled'] || (int) $lead['confirmation_sent'] === 1 || !filter_var($email, FILTER_VALIDATE_EMAIL)
            || !$this->app->rateLimiter()->hit('contact_confirmation', strtolower($email), 1, 600)) {
            return false;
        }
        $lang = $lead['lang'] === 'en' ? 'en' : 'es';
        $t = $this->app->watchdog()->texts($lang);
        $content = $this->app->content();
        $vars = [
            'nombre' => explode(' ', trim((string) $lead['name']))[0] ?: (string) $lead['name'],
            'servicio' => (string) $lead['service'],
            'telefono' => $content->value('contact.phone_office'),
            'whatsapp' => self::whatsappLabel($content->value('contact.whatsapp')),
            'correo' => $content->value('contact.email'),
        ];
        $fill = fn (string $s) => strtr($s, array_combine(array_map(fn ($k) => '{' . $k . '}', array_keys($vars)), array_values($vars)));
        $subject = Mailer::oneLine($fill($c[$lang]['subject']), 150);
        $text = $fill($c[$lang]['body']);
        $html = '';
        foreach (preg_split('/\n{2,}/', $text) ?: [] as $para) {
            $html .= '<p style="margin:0 0 14px;color:#2b2b31;font-size:15px;line-height:1.6">' . nl2br(Emails::esc($para)) . '</p>';
        }
        $layout = (new Emails($this->app))->branded($lang, $t['au.confirm.tag'], mb_substr(str_replace("\n", ' ', $text), 0, 120), $html, $t['au.confirm.footer']);
        $mail = ['to' => $email, 'subject' => $subject, 'text' => $text . "\n", 'html' => $layout['html'], 'embedded' => $layout['embedded']];
        $ok = $this->app->mailer()->send($mail + ['replyTo' => [$content->value('contact.email'), 'Sensum Construcciones']]);
        $this->app->db()->run('UPDATE leads SET confirmation_sent = ? WHERE id = ?', [$ok ? 1 : 0, $lead['id']]);
        return $ok;
    }

    /** Runs $fn after the response has gone to the browser (right away from the command line). */
    private function defer(callable $fn): void
    {
        if (PHP_SAPI === 'cli') {
            $fn();
            return;
        }
        register_shutdown_function(function () use ($fn) {
            if (function_exists('fastcgi_finish_request')) {
                fastcgi_finish_request();
            } elseif (function_exists('litespeed_finish_request')) {
                litespeed_finish_request();
            }
            try {
                $fn();
            } catch (\Throwable $e) {
                $this->app->logger()->error('automation_failed', ['job' => 'deferred', 'type' => get_class($e)]);
            }
        });
    }

    /** "+502 3481 9804" from "50234819804". */
    public static function whatsappLabel(string $number): string
    {
        $d = preg_replace('/\D/', '', $number) ?? '';
        return strlen($d) === 11 && str_starts_with($d, '502') ? '+502 ' . substr($d, 3, 4) . ' ' . substr($d, 7) : ($d !== '' ? '+' . $d : '');
    }

    /** Tells the person who follows a lead up (assigned automatically or by hand, or the follow-up reminder). */
    public function notifyAssignee(array $lead, array $person, string $kind, array $extra = []): void
    {
        if ($kind === 'leadAssigned' && (string) $lead['service'] === '') {
            $kind = 'leadAssignedAny';
        }
        $lang = self::lang($person);
        $t = $this->app->watchdog()->texts($lang);
        $facts = array_filter([
            $t['au.lead.service'] => (string) $lead['service'],
            $t['au.lead.phone'] => (string) $lead['phone'],
            $t['au.lead.email'] => (string) $lead['email'],
            $t['au.lead.received'] => date('Y-m-d H:i', (int) $lead['created_at']),
            $t['au.lead.message'] => mb_strlen((string) $lead['message']) > 300 ? mb_substr((string) $lead['message'], 0, 300) . '…' : (string) $lead['message'],
        ], fn ($v) => $v !== '');
        $this->notice($person, $kind,
            ['lead' => $lead['name'], 'service' => $lead['service'], 'date' => self::date((int) $lead['created_at'], $lang)] + $extra,
            'leads', [null, 'prospectos/' . (int) $lead['id']], $facts);
    }

    // ------------------------------------------------------------------ people

    /** Active accounts that manage users (the owner included). @return list<array> */
    public function managers(): array
    {
        $out = [];
        foreach ($this->app->db()->all("SELECT * FROM users WHERE status = 'active' ORDER BY id") as $u) {
            if ($this->app->auth()->can($u, 'users')) {
                $out[] = $u;
            }
        }
        return $out;
    }

    /** Who hears about a person's account: whoever invited them if they still manage users, otherwise the owner. @return list<array> */
    private function managersOf(array $person): array
    {
        $inviter = $person['invited_by'] !== null ? (new Users($this->app))->find((int) $person['invited_by']) : null;
        if ($inviter && $inviter['status'] === 'active' && (int) $inviter['id'] !== (int) $person['id'] && $this->app->auth()->can($inviter, 'users')) {
            return [$inviter];
        }
        $owner = $this->app->db()->one("SELECT * FROM users WHERE lower(email) = ? AND status = 'active'", [$this->app->config->ownerEmail()]);
        return $owner && (int) $owner['id'] !== (int) $person['id'] ? [$owner] : [];
    }

    /**
     * Active accounts that follow leads up (the "leads" access). With $orOwner the
     * owner hears when nobody else does. @return list<array>
     */
    public function leadPeople(bool $orOwner): array
    {
        $people = [];
        $owner = null;
        foreach ($this->app->db()->all("SELECT * FROM users WHERE status = 'active' ORDER BY name COLLATE NOCASE") as $u) {
            if ($this->app->auth()->isOwner($u)) {
                $owner = $u;
            } elseif (in_array('leads', Users::permissionsOf($u), true)) {
                $people[] = $u;
            }
        }
        if (!$orOwner) {
            return $owner ? array_merge([$owner], $people) : $people;
        }
        return $people ?: ($owner ? [$owner] : []);
    }

    public function leadPerson(int $id): ?array
    {
        foreach ($this->leadPeople(false) as $p) {
            if ((int) $p['id'] === $id) {
                return $p;
            }
        }
        return null;
    }

    // ------------------------------------------------------------------ helpers

    /**
     * One notice from the language files (au.{kind}.subject|title|intro|action).
     * @param array{0:?string,1:string} $cta [label or null for "Abrir el panel", panel route]
     */
    private function notice(array $to, string $kind, array $vars, string $tag, ?array $cta, array $facts = [], ?string $itemsTitle = null, array $items = [], bool $deferred = true): void
    {
        $lang = self::lang($to);
        $t = $this->app->watchdog()->texts($lang);
        $vars += ['name' => explode(' ', trim((string) $to['name']))[0] ?: (string) $to['name']];
        $fill = fn (string $key) => isset($t[$key]) ? Watchdog::fill($t[$key], $vars) : null;
        $base = 'au.' . $kind;
        $label = $cta ? ($cta[0] ?? ($cta[1] === '' ? $t['wd.cta.panel'] : ($t[$base . '.cta'] ?? $t['wd.cta.panel']))) : null;
        $this->app->watchdog()->notify((string) $to['email'], $lang, $kind, [
            'subject' => $fill($base . '.subject'), 'title' => $fill($base . '.title'), 'intro' => $fill($base . '.intro'),
            'facts' => $facts, 'itemsTitle' => $itemsTitle, 'items' => $items, 'action' => $fill($base . '.action'),
            'cta' => $cta ? [$label, $cta[1]] : null, 'severity' => 'info', 'tag' => $t['au.tag.' . $tag],
        ], $deferred);
    }

    private function accessText(array $user, string $lang): string
    {
        return $this->permText(Users::permissionsOf($user), $lang);
    }

    /** @param list<string> $permissions */
    private function permText(array $permissions, string $lang): string
    {
        $t = $this->app->watchdog()->texts($lang);
        return implode(', ', array_map(fn ($p) => $t['acc.perm.' . $p] ?? $p, $permissions));
    }

    private static function lang(array $u): string
    {
        return ($u['lang'] ?? 'es') === 'en' ? 'en' : 'es';
    }

    private static function date(int $ts, string $lang): string
    {
        return $lang === 'en' ? date('M j, Y', $ts) : date('d/m/Y', $ts);
    }
}
