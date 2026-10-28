/**
 * Usuarios: the owner account and accounts with "Gestión de usuarios". Table on
 * large screens, cards on phones. The server decides whom each account may
 * change (canManage) and which access it may give (assignable).
 */
import { h, icon, clear, initials, fill } from '../dom.js';
import { t, tp, fmtRelative, fmtDate } from '../i18n.js';
import { api } from '../api.js';
import { pageHead, loading, loadError, textField, passwordField, passwordGuide, alertBox, toast, errorText, fieldErrorText, openDialog, confirmDialog, askPassword, setBusy, button, dropdown, copyText, emptyState, switchInput, segmented, attachEmailHint, cardHead } from '../ui.js';
import { accessPicker, accessLabel, accessTypeOf, permissionList } from '../access.js';
import { viewAs, pickViewAs } from '../viewas.js';
import { reloadSession } from '../app.js';

const STATUS_BADGE = { active: 'badge-ok', invited: 'badge-warn', disabled: 'badge' };
const DAY = 86400;
/** "2026-12-31" for a date input, from a timestamp (local time). */
const isoDay = (ts) => { const d = new Date(ts * 1000); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };

/**
 * Filter tabs: everyone, by status, then what may need attention (shown only
 * when someone matches). Their keys are also the "?revisar=" links from Inicio
 * and from the automatic e-mails.
 */
const FILTERS = [
  ['todas', () => true],
  ['activas', (u) => u.status === 'active'],
  ['invitaciones', (u) => u.status === 'invited'],
  ['desactivadas', (u) => u.status === 'disabled'],
  ['contrasena', (u) => u.status === 'active' && u.mustChangePassword, true],
  ['sin-verificacion', (u) => u.status === 'active' && !u.twoFactorEnabled, true],
  ['inactivas', (u) => u.status === 'active' && !u.isOwner && (u.lastLoginAt || u.createdAt) < Date.now() / 1000 - 90 * DAY, true],
  ['temporales', (u) => u.status === 'active' && !!u.accessUntil, true],
];

/** "Acceso temporal" switch with its end date (invite and change access). Returns { el, value(): ''|'YYYY-MM-DD'|null for unchanged }. */
function accessUntilField(idPrefix, current) {
  const sw = switchInput({ id: idPrefix + '-tmp', checked: !!current });
  const today = isoDay(Date.now() / 1000);
  const date = h('input', { class: 'input', type: 'date', id: idPrefix + '-until', min: today, value: current ? isoDay(current) : isoDay(Date.now() / 1000 + 30 * DAY), 'aria-describedby': idPrefix + '-until-hint' });
  const dateBox = h('div', { class: 'field', hidden: !current || null },
    h('label', { class: 'label', for: idPrefix + '-until', text: t('users.accessUntilLabel') }), date,
    h('div', { class: 'field-foot' }, h('span', { class: 'hint', id: idPrefix + '-until-hint', text: t('users.accessUntilHint') })));
  sw.input.addEventListener('change', () => { dateBox.hidden = !sw.input.checked; if (sw.input.checked) date.focus(); });
  const el = h('div', { class: 'stack-sm temp-access' },
    h('div', { class: 'row-between switch-row' }, h('div', null, h('label', { for: idPrefix + '-tmp', class: 'strong', text: t('users.temporaryAccess') }),
      h('p', { class: 'tiny muted', text: t('users.temporaryAccessHelp') })), sw.wrap), dateBox);
  return { el, date, value: () => (sw.input.checked ? date.value : '') };
}

export async function render({ main, query, navigate, can }) {
  const add = button(t('users.invite'), { variant: 'primary', icon: 'person-plus' });
  // "Ver como" (owner only): check what each role sees (read-only).
  const viewBtn = button(t('viewAs.pick'), { icon: 'eye', onClick: () => pickViewAs({ onDone: () => reloadSession('/') }) });
  viewBtn.hidden = true;
  main.append(pageHead({ title: t('users.title'), lead: t('users.lead'), actions: [viewBtn, add] }));
  const body = h('div', null, loading());
  main.append(body);

  let presets = null;
  let assignable = [];
  let viewerIsOwner = false;
  const canSeeActivity = can('site') || can('users');
  // Search and filters (kept while the list reloads after a change).
  const filters = { q: '', view: FILTERS.some(([k]) => k === query.get('revisar')) ? query.get('revisar') : 'todas', access: '' };
  const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const load = async () => {
    let data;
    try { data = await api.get('/users'); } catch (err) { fill(body, loadError(err, load)); return; }
    const users = data.users;
    presets = data.accessTypes;
    assignable = data.assignable || [];
    viewerIsOwner = !!data.viewerIsOwner;
    viewBtn.hidden = !viewerIsOwner;
    const statusText = (u) => {
      if (u.status === 'disabled' && u.accessUntil && u.accessUntil * 1000 <= Date.now()) return t('users.accessEnded', { when: fmtDate(u.accessUntil, false) });
      if (u.status !== 'invited') return null;
      return u.inviteExpiresAt && u.inviteExpiresAt * 1000 > Date.now()
        ? t('users.inviteExpires', { when: fmtDate(u.inviteExpiresAt) })
        : t('users.inviteExpired');
    };
    const actionsMenu = (u) => {
      const trigger = h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': t('users.actionsFor', { name: u.name }), 'data-focus-key': 'user-' + u.id }, icon('three-dots-vertical'));
      if (u.isSelf) return h('span', { class: 'badge badge-brand', text: t('users.you') });
      if (!u.canManage) {
        // The owner, or someone with more access (or who also manages users): only the owner changes them.
        return h('span', { class: 'muted not-manageable', title: t('users.notManageable'), 'aria-label': t('users.notManageable'), role: 'img' }, icon('lock'));
      }
      return dropdown(trigger, (close) => [
        viewerIsOwner && u.status !== 'disabled' && !u.isOwner ? menuItem('eye', t('viewAs.menu'), async () => { close(); if (await viewAs(u, { active: false })) reloadSession('/'); }) : null,
        u.status === 'invited' ? menuItem('send', t('users.resend'), () => { close(); resend(u); }) : null,
        menuItem('pencil', t('users.editProfile'), () => { close(); editProfile(u); }),
        u.status === 'active' ? menuItem('envelope', t('users.sendLink'), () => { close(); sendLink(u); }) : null,
        u.status !== 'disabled' ? menuItem('key', t('users.setPassword'), () => { close(); setPassword(u); }) : null,
        u.status !== 'disabled' ? menuItem('phone', t('users.twoFactor'), () => { close(); twoFactor(u); }) : null,
        u.status === 'active' ? menuItem('box-arrow-right', t('users.revokeSessions'), () => { close(); revokeSessions(u); }) : null,
        h('hr'),
        menuItem('shield-lock', t('access.change'), () => { close(); changeAccess(u); }),
        canSeeActivity ? menuItem('clock-history', t('users.viewActivity'), () => { close(); navigate('/actividad?persona=' + u.id); }) : null,
        u.status === 'disabled' ? menuItem('check2-circle', t('users.enable'), () => { close(); update(u, { status: 'active' }); })
          : u.status === 'active' ? menuItem('lock', t('users.disable'), () => { close(); disable(u); }) : null,
        h('hr'),
        menuItem('trash3', t('users.remove'), () => { close(); remove(u); }, true),
      ]).el;
    };
    const person = (u) => h('div', { class: 'person' }, h('span', { class: 'avatar', 'aria-hidden': 'true', text: initials(u.name) }),
      h('div', { class: 'grow' }, h('strong', { class: 'break', text: u.name }), h('div', { class: 'small muted break person-email', title: u.email, text: u.email })));
    const statusBadge = (u) => h('div', { class: 'stack-sm user-status' }, h('span', { class: ['badge', STATUS_BADGE[u.status]], text: t('users.status.' + u.status) }),
      statusText(u) ? h('span', { class: 'tiny muted', text: statusText(u) }) : null,
      u.tempPasswordExpired ? h('span', { class: 'tiny user-flag warn-text' }, icon('hourglass-split'), t('users.tempExpiredBadge'))
        : u.mustChangePassword ? h('span', { class: 'tiny user-flag' }, icon('key'), t('users.mustChangeBadge')) : null,
      u.status !== 'disabled' && u.accessUntil ? h('span', { class: ['tiny', 'user-flag', u.accessUntil - Date.now() / 1000 < 7 * DAY ? 'warn-text' : 'muted'] }, icon('hourglass-split'), t('users.accessUntilBadge', { when: fmtDate(u.accessUntil, false) })) : null,
      u.twoFactorEnabled ? h('span', { class: 'tiny muted user-flag' }, icon('shield-lock'), t('users.twoFactorBadge')) : null,
      u.twoFactorReenroll ? h('span', { class: 'tiny user-flag' }, icon('phone'), t('users.reenrollBadge')) : null);

    // ---- search & filters
    const typeOf = (u) => (u.isOwner ? 'owner' : accessTypeOf(u.permissions || [], presets));
    const search = h('input', { class: 'input', type: 'search', value: filters.q, placeholder: t('users.search'), 'aria-label': t('users.search'), autocomplete: 'off' });
    // Everyone / by status, then «Revisar»: only the checks someone matches (a link from Inicio keeps its tab).
    const counts = Object.fromEntries(FILTERS.map(([k, test]) => [k, users.filter(test).length]));
    const tabs = h('div', { class: 'filter-tabs users-tabs hide-sm', role: 'group', 'aria-label': t('users.filterLabel') });
    // Phones: the same choices in one menu (eight tabs would take half the screen).
    const viewSel = h('select', { class: 'select only-sm users-view', id: 'users-view', 'aria-label': t('users.filterLabel') });
    viewSel.addEventListener('change', () => { filters.view = viewSel.value; drawTabs(); renderList(); });
    const drawTabs = () => {
      const shown = FILTERS.filter(([k, , review]) => !review || counts[k] > 0 || filters.view === k);
      fill(tabs, shown.map(([k, , review], i) => [
        review && !shown[i - 1][2] ? h('span', { class: 'filter-sep', text: t('users.reviewLabel') }) : null,
        h('button', { type: 'button', class: ['filter-tab', review && 'filter-tab-review'], 'aria-pressed': String(filters.view === k),
          onclick: () => { filters.view = k; drawTabs(); renderList(); } },
        t('users.filters.' + k), h('span', { class: 'count', text: String(counts[k]) }))]));
      const opt = ([k]) => h('option', { value: k, selected: filters.view === k || null, text: `${t('users.filters.' + k)} (${counts[k]})` });
      const review = shown.filter((f) => f[2]);
      fill(viewSel, shown.filter((f) => !f[2]).map(opt), review.length ? h('optgroup', { label: t('users.reviewLabel') }, review.map(opt)) : null);
    };
    const accessSel = h('select', { class: 'select', 'aria-label': t('users.filterAccess') },
      h('option', { value: '', text: t('users.allAccess') }), h('option', { value: 'owner', text: t('users.ownerAccess'), selected: filters.access === 'owner' || null }),
      [...Object.keys(presets), ...(users.some((u) => typeOf(u) === 'custom') ? ['custom'] : [])].map((k) => h('option', { value: k, text: t('access.types.' + k)[0], selected: k === filters.access || null })));
    const count = h('p', { class: 'small muted users-count', 'aria-live': 'polite' });
    const listBox = h('div');
    const matches = (u) => {
      const q = fold(filters.q.trim());
      if (q && !fold(u.name + ' ' + u.email + ' ' + accessLabel(u, presets)).includes(q)) return false;
      if (!FILTERS.find(([k]) => k === filters.view)[1](u)) return false;
      if (filters.access && typeOf(u) !== filters.access) return false;
      return true;
    };
    const renderList = () => {
      const shown = users.filter(matches);
      count.textContent = shown.length === users.length ? t('users.countAll', { n: users.length }) : t('users.countSome', { n: shown.length, total: users.length });
      if (!shown.length) {
        fill(listBox, h('div', { class: 'card' }, emptyState('people', t('users.noMatchTitle'), t('users.noMatchBody'),
          button(t('users.clearFilters'), { small: true, onClick: () => { filters.q = ''; filters.view = 'todas'; filters.access = ''; search.value = ''; accessSel.value = ''; drawTabs(); renderList(); } }))));
        return;
      }
      fill(listBox, tableOf(shown), cardsOf(shown));
    };
    let timer = 0;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { filters.q = search.value; renderList(); }, 150); });
    accessSel.addEventListener('change', () => { filters.access = accessSel.value; renderList(); });
    const toolbar = h('div', { class: 'users-toolbar' }, h('div', { class: 'users-search' }, icon('search'), search), accessSel);

    // Below 1100 px (tablets, small laptops) the list is cards: five columns don't fit there.
    const tableOf = (list) => h('div', { class: 'table-wrap responsive users-table' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, ['name', 'access', 'status', 'lastLogin'].map((c) => h('th', { scope: 'col', text: t('users.cols.' + c) })), h('th', { scope: 'col' }, h('span', { class: 'sr-only', text: t('users.cols.actions') })))),
      h('tbody', null, list.map((u) => h('tr', null,
        h('td', null, person(u)),
        h('td', { class: 'small', text: accessLabel(u, presets) }),
        h('td', null, statusBadge(u)),
        h('td', { class: 'small muted', text: u.lastLoginAt ? fmtRelative(u.lastLoginAt) : t('users.neverLoggedIn') }),
        h('td', { class: 'nowrap' }, actionsMenu(u)))))));
    const cardsOf = (list) => h('div', { class: 'list-cards users-cards' }, list.map((u) => h('div', { class: 'card stack-sm' },
      h('div', { class: 'row-between' }, person(u), actionsMenu(u)),
      h('div', { class: 'small', text: accessLabel(u, presets) }),
      h('div', { class: 'row' }, statusBadge(u)),
      h('div', { class: 'tiny muted', text: u.lastLoginAt ? t('users.lastLogin', { when: fmtRelative(u.lastLoginAt) }) : t('users.neverLoggedIn') }))));
    fill(body, h('div', { class: 'stack' }, requestsCard(data.requests || [], users), toolbar, tabs, viewSel, count, listBox));
    drawTabs();
    renderList();
  };

  // ---- «Pedir acceso»: requests waiting for an answer
  const requestsCard = (requests) => {
    if (!requests.length) return null;
    const answer = async (r, grant, btn) => {
      setBusy(btn, true, t('common.saving'));
      try {
        await api.post(`/users/requests/${r.id}`, { grant });
        toast(t(grant ? 'users.requestGranted' : 'users.requestDeclined', { name: r.name }));
        load();
      } catch (err) { setBusy(btn, false); toast(err.code === 'validation' ? fieldErrorText(Object.values(err.fields)[0]) : errorText(err), { type: 'bad' }); }
    };
    return h('section', { class: 'card requests-card', 'aria-labelledby': 'req-t' },
      cardHead({ id: 'req-t', icon: 'send', tone: 'warn', title: tp('users.requestsTitle', requests.length), lead: t('users.requestsLead') }),
      h('ul', { class: 'request-list' }, requests.map((r) => {
        const grant = r.canGrant ? button(t('users.requestGrant'), { variant: 'primary', small: true, icon: 'check-lg', attrs: { 'aria-label': t('users.requestGrantFor', { name: r.name }) } }) : null;
        const decline = button(t('users.requestDecline'), { small: true, variant: 'ghost', attrs: { 'aria-label': t('users.requestDeclineFor', { name: r.name }) } });
        if (grant) grant.addEventListener('click', () => answer(r, true, grant));
        decline.addEventListener('click', () => answer(r, false, decline));
        return h('li', { class: 'request-row' },
          h('span', { class: 'avatar', 'aria-hidden': 'true', text: initials(r.name) }),
          h('div', { class: 'grow stack-sm' },
            h('div', null, h('strong', { class: 'break', text: r.name }), h('span', { class: 'tiny muted', text: ' · ' + fmtRelative(r.createdAt) })),
            h('div', { class: 'small' }, t('users.requestAsks') + ' ', h('strong', { text: permissionList(r.permissions) })),
            r.message ? h('blockquote', { class: 'request-message small', text: r.message }) : null,
            r.canGrant ? null : h('p', { class: 'tiny muted', text: t('users.requestOwnerOnly') })),
          h('div', { class: 'row request-actions' }, decline, grant));
      })));
  };

  const menuItem = (ic, label, onClick, danger) => h('button', { type: 'button', class: ['menu-item', danger && 'danger'], onclick: onClick }, icon(ic), label);

  const linkFallback = (link) => {
    const input = textField({ label: t('users.copyLink'), value: link, readOnly: true });
    openDialog({
      title: t('users.noEmailTitle'), labelledIcon: 'exclamation-triangle-fill',
      body: h('div', { class: 'stack' }, h('p', { class: 'muted', text: t('users.noEmailBody') }), input.wrap),
      actions: [
        { label: t('common.close'), onClick: (b, close) => close() },
        { label: t('users.copyLink'), variant: 'primary', icon: 'clipboard', onClick: async (b) => { if (await copyText(link)) toast(t('common.copied')); else input.input.select(); } },
      ],
    });
  };

  const resend = async (u) => {
    try {
      const r = await api.post(`/users/${u.id}/resend`);
      if (r.emailSent) toast(t('users.resent')); else linkFallback(r.inviteLink);
      load();
    } catch (err) { toast(errorText(err), { type: 'bad' }); }
  };
  const update = async (u, change) => {
    try { await api.put(`/users/${u.id}`, change); toast(t('users.updated')); load(); }
    catch (err) { toast(err.code === 'validation' ? fieldErrorText(Object.values(err.fields)[0]) : errorText(err), { type: 'bad' }); }
  };
  const changeAccess = (u) => {
    const picker = accessPicker(presets, u.permissions, 'chg', assignable);
    const until = accessUntilField('chg', u.accessUntil && u.accessUntil * 1000 > Date.now() ? u.accessUntil : null);
    const msg = h('div');
    const dlg = openDialog({
      title: t('access.changeTitle', { name: u.name }), labelledIcon: 'shield-lock', body: h('div', { class: 'stack' }, picker.el, until.el, msg), wide: true,
      actions: [
        { label: t('common.cancel'), onClick: (b, close) => close() },
        { label: t('common.save'), variant: 'primary', icon: 'check-lg', onClick: async (btn) => {
          clear(msg);
          const permissions = picker.value();
          if (!permissions.length) return msg.append(alertBox('bad', null, t('access.pickOne')));
          setBusy(btn, true, t('common.saving'));
          try { await api.put(`/users/${u.id}`, { permissions, accessUntil: until.value() }); dlg.close(); toast(t('access.changed')); load(); }
          catch (err) { setBusy(btn, false); msg.append(alertBox('bad', null, err.code === 'validation' ? fieldErrorText(Object.values(err.fields)[0]) : errorText(err, { preserved: true }))); }
        } },
      ],
    });
  };
  const revokeSessions = async (u) => {
    if (!(await confirmDialog({ title: t('users.revokeTitle', { name: u.name }), body: t('users.revokeBody'), confirmLabel: t('users.revokeConfirm') }))) return;
    try {
      const r = await api.post(`/users/${u.id}/sessions/revoke`, {});
      toast(r.ended ? tp('users.revokeDone', r.ended, { name: u.name }) : t('users.revokeNone', { name: u.name }));
    } catch (err) { toast(errorText(err), { type: 'bad' }); }
  };
  const disable = async (u) => {
    if (await confirmDialog({ title: t('users.disableTitle', { name: u.name }), body: t('users.disableBody'), confirmLabel: t('users.disable'), danger: true })) update(u, { status: 'disabled' });
  };
  const remove = async (u) => {
    if (!(await confirmDialog({ title: t('users.removeTitle', { name: u.name }), body: t('users.removeBody'), confirmLabel: t('users.remove'), danger: true }))) return;
    try { await api.del(`/users/${u.id}`); toast(t('users.removed')); load(); }
    catch (err) { toast(err.code === 'validation' ? fieldErrorText(Object.values(err.fields)[0]) : errorText(err), { type: 'bad' }); }
  };

  /** Shows field errors from the server; returns true when it handled them. */
  const showErrors = (err, map, msg) => {
    if (err.code !== 'validation') { msg.append(alertBox('bad', null, errorText(err, { preserved: true }))); return true; }
    let first = null;
    for (const [name, code] of Object.entries(err.fields || {})) {
      if (map[name]) { map[name].setError(fieldErrorText(code, { max: 80 })); first = first || map[name].input; } else msg.append(alertBox('bad', null, fieldErrorText(code)));
    }
    if (first) first.focus();
    return true;
  };

  // ---- name and sign-in e-mail
  const editProfile = (u) => {
    const name = textField({ label: t('users.name'), value: u.name, autocomplete: 'off', max: 80, required: true });
    const email = textField({ label: t('users.email'), value: u.email, type: 'email', autocomplete: 'off', inputmode: 'email', required: true });
    attachEmailHint(email);
    const pw = passwordField({ label: t('users.confirmWithPassword'), autocomplete: 'current-password', required: true });
    const note = h('p', { class: 'small muted', text: t(u.status === 'invited' ? 'users.editInvitedNote' : 'users.editEmailNote') });
    const confirmBox = h('div', { class: 'stack-sm', hidden: true }, note, pw.wrap);
    const changed = () => email.input.value.trim().toLowerCase() !== u.email.toLowerCase();
    email.input.addEventListener('input', () => { confirmBox.hidden = !changed(); });
    const msg = h('div');
    const form = h('form', { class: 'stack', novalidate: true }, name.wrap, email.wrap, confirmBox, msg);
    const dlg = openDialog({
      title: t('users.editTitle', { name: u.name }), labelledIcon: 'pencil', body: form,
      actions: [
        { label: t('common.cancel'), onClick: (b, close) => close() },
        { label: t('common.save'), variant: 'primary', icon: 'check-lg', onClick: () => form.requestSubmit() },
      ],
    });
    setTimeout(() => name.input.focus(), 60);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clear(msg);
      const n = name.input.value.trim();
      const em = email.input.value.trim();
      name.setError(n ? null : fieldErrorText('required'));
      email.setError(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) ? null : fieldErrorText(em ? 'invalid_email' : 'required'));
      if (!n) return name.input.focus();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return email.input.focus();
      if (changed() && !pw.input.value) { pw.setError(fieldErrorText('required')); return pw.input.focus(); }
      pw.setError(null);
      const btn = dlg.foot.lastChild;
      setBusy(btn, true, t('common.saving'));
      try {
        const r = await api.put(`/users/${u.id}/profile`, { name: n, email: em, ...(changed() ? { currentPassword: pw.input.value } : {}) });
        dlg.close();
        if (u.status === 'invited' && changed()) {
          if (r.emailSent === false) linkFallback(r.inviteLink); else toast(t('users.inviteMoved'));
        } else toast(t(changed() ? 'users.profileSavedEmail' : 'users.profileSaved'));
        load();
      } catch (err) {
        setBusy(btn, false);
        showErrors(err, { name, email, currentPassword: pw }, msg);
      }
    });
  };

  // ---- a link to choose a new password
  const sendLink = async (u) => {
    if (!(await confirmDialog({ title: t('users.sendLinkTitle', { name: u.name }), body: t('users.sendLinkBody', { email: u.email }), confirmLabel: t('users.sendLinkConfirm') }))) return;
    try { await api.post(`/users/${u.id}/password-link`, {}); toast(t('users.linkSent', { email: u.email })); }
    catch (err) { toast(err.code === 'validation' ? fieldErrorText(Object.values(err.fields)[0]) : errorText(err), { type: 'bad' }); }
  };

  // ---- give a password (generated or typed)
  const setPassword = (u) => {
    let mode = 'generate';
    const shown = h('output', { class: 'pw-generated', 'aria-live': 'polite', 'aria-label': t('users.pwGenerated') });
    const newSuggestion = async () => {
      shown.textContent = '…';
      try { shown.textContent = (await api.get('/users/password-suggestion')).password; }
      catch (err) { shown.textContent = ''; toast(errorText(err), { type: 'bad' }); }
    };
    const copy = async (value) => { if (value && await copyText(value)) toast(t('users.pwCopied')); };
    const genBox = h('div', { class: 'pw-generated-box' }, shown,
      h('div', { class: 'row' },
        button(t('users.pwAnother'), { small: true, icon: 'arrow-repeat', onClick: newSuggestion }),
        button(t('users.pwCopy'), { small: true, icon: 'clipboard', onClick: () => copy(shown.textContent) })));
    const typed = passwordField({ label: t('users.pwNewLabel'), autocomplete: 'new-password', required: true });
    const typedBox = h('div', { class: 'stack-sm', hidden: true }, typed.wrap, passwordGuide(typed.input));
    const modeGroup = segmented([{ value: 'generate', label: t('users.pwGenerate') }, { value: 'type', label: t('users.pwType') }], mode, (m) => {
      mode = m;
      genBox.hidden = mode !== 'generate';
      typedBox.hidden = mode !== 'type';
      if (mode === 'type') typed.input.focus();
    }, t('users.pwMode'));
    const must = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true }), h('span', { text: t('users.mustChange') }));
    const mine = passwordField({ label: t('users.confirmWithPassword'), autocomplete: 'current-password', required: true });
    const msg = h('div');
    const form = h('form', { class: 'stack', novalidate: true }, modeGroup, genBox, typedBox, must,
      h('p', { class: 'small muted', text: t('users.setPasswordNote') + (u.status === 'invited' ? ' ' + t('users.setPasswordInvited') : '') }), mine.wrap, msg);
    const dlg = openDialog({
      title: t('users.setPasswordTitle', { name: u.name }), lead: t('users.setPasswordLead', { name: u.name }), labelledIcon: 'key', body: form, wide: true,
      actions: [
        { label: t('common.cancel'), onClick: (b, close) => close() },
        { label: t('users.setPasswordSave'), variant: 'primary', icon: 'check-lg', onClick: () => form.requestSubmit() },
      ],
    });
    newSuggestion();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clear(msg);
      const password = mode === 'generate' ? shown.textContent : typed.input.value;
      if (mode === 'type' && [...password].length < 10) { typed.setError(fieldErrorText('password_too_short')); return typed.input.focus(); }
      typed.setError(null);
      if (!mine.input.value) { mine.setError(fieldErrorText('required')); return mine.input.focus(); }
      mine.setError(null);
      const mustChange = must.firstChild.checked;
      const btn = dlg.foot.lastChild;
      setBusy(btn, true, t('common.saving'));
      try {
        const r = await api.post(`/users/${u.id}/password`, { password, mustChange, currentPassword: mine.input.value });
        dlg.close();
        load();
        // Shown once more so it can be copied, with a message ready to send by WhatsApp; it is never e-mailed.
        const message = h('pre', { class: 'share-message', tabindex: '0', 'aria-label': t('users.shareMessageLabel'), text: r.message || '' });
        openDialog({
          title: t('users.setPasswordDoneTitle'), labelledIcon: 'check-circle-fill', wide: true,
          body: h('div', { class: 'stack' }, h('output', { class: 'pw-generated', text: password }),
            h('p', { class: 'muted', text: t('users.setPasswordDoneBody', { name: u.name }) }),
            mustChange ? h('p', { class: 'small muted', text: t('users.setPasswordDoneChange', { hours: 72 }) }) : null,
            r.message ? h('div', { class: 'stack-sm' }, h('span', { class: 'label', text: t('users.shareMessageLabel') }), message,
              h('p', { class: 'tiny muted', text: t('users.shareMessageHint') })) : null),
          actions: [
            { label: t('common.close'), onClick: (b, close) => close() },
            { label: t('users.pwCopyOnly'), icon: 'key', onClick: () => copy(password) },
            r.message ? { label: t('users.shareMessageCopy'), variant: 'primary', icon: 'clipboard', onClick: async () => { if (await copyText(r.message)) toast(t('users.shareMessageCopied')); } } : null,
          ].filter(Boolean),
        });
      } catch (err) {
        setBusy(btn, false);
        showErrors(err, { password: mode === 'type' ? typed : { setError: (m) => msg.append(alertBox('bad', null, m)), input: null }, currentPassword: mine }, msg);
      }
    });
  };

  // ---- two-step sign-in: require it for this person, or reset it (lost phone)
  const twoFactor = (u) => {
    const state = h('p', { class: 'row' }, h('span', { class: ['badge', u.twoFactorEnabled ? 'badge-ok' : 'badge'], text: t(u.twoFactorEnabled ? 'users.tfOn' : 'users.tfOff') }),
      u.twoFactorEnabled && u.twoFactorEnabledAt ? h('span', { class: 'small muted', text: t('users.twoFactorOn', { when: fmtDate(u.twoFactorEnabledAt) }) }) : null);
    const helpId = 'tf-help-' + u.id;
    const sw = switchInput({ id: 'tf-req-' + u.id, checked: u.twoFactorForced || u.twoFactorByPolicy, describedBy: helpId });
    if (u.twoFactorByPolicy) sw.input.disabled = true;
    const requireRow = h('div', { class: 'row-between switch-row' },
      h('div', null, h('label', { for: 'tf-req-' + u.id, class: 'strong', text: t('users.twoFactorRequire', { name: u.name }) }),
        h('p', { class: 'tiny muted', id: helpId, text: u.twoFactorByPolicy ? t('users.twoFactorByPolicy') : t('users.twoFactorRequireHelp') })),
      sw.wrap);
    sw.input.addEventListener('change', async () => {
      sw.input.disabled = true;
      try {
        const r = await api.put(`/users/${u.id}/2fa`, { required: sw.input.checked });
        Object.assign(u, r.user);
        toast(t(sw.input.checked ? 'users.twoFactorRequiredNow' : 'users.twoFactorNotRequired'));
        load();
      } catch (err) { sw.input.checked = !sw.input.checked; toast(errorText(err), { type: 'bad' }); }
      sw.input.disabled = !!u.twoFactorByPolicy;
    });
    const resetBtn = u.twoFactorEnabled ? button(t('users.twoFactorReset'), { icon: 'phone', small: true, onClick: async () => {
      const currentPassword = await askPassword({ title: t('users.twoFactorResetTitle', { name: u.name }), lead: t('users.twoFactorResetLead'), confirmLabel: t('users.twoFactorReset') });
      if (!currentPassword) return;
      try {
        await api.post(`/users/${u.id}/2fa-reset`, { currentPassword });
        dlg.close();
        toast(t('users.twoFactorResetDone', { name: u.name }));
        load();
      } catch (err) { toast(err.code === 'validation' ? fieldErrorText(Object.values(err.fields)[0]) : errorText(err), { type: 'bad' }); }
    } }) : null;
    const dlg = openDialog({
      title: t('users.twoFactorTitle', { name: u.name }), labelledIcon: 'phone',
      body: h('div', { class: 'stack' }, state, u.twoFactorReenroll ? alertBox('info', null, t('users.reenrollNote')) : null, requireRow, resetBtn ? h('div', null, resetBtn) : null),
      actions: [{ label: t('common.close'), onClick: (b, close) => close() }],
    });
  };

  add.addEventListener('click', () => {
    const name = textField({ label: t('users.name'), autocomplete: 'off', max: 80, required: true });
    const email = textField({ label: t('users.email'), type: 'email', autocomplete: 'off', inputmode: 'email', required: true });
    attachEmailHint(email);
    // Starts on «Editor del sitio web» (or the first role this person may give).
    const firstRole = ['content', ...Object.keys(presets)].map((k) => presets[k]).find((perms) => perms && perms.every((p) => assignable.includes(p)));
    const picker = accessPicker(presets, firstRole || assignable.slice(0, 1), 'inv', assignable);
    const until = accessUntilField('inv', null);
    const lang = h('div', { class: 'field' }, h('label', { class: 'label', for: 'inv-lang', text: t('users.language') }),
      h('select', { class: 'select', id: 'inv-lang' }, h('option', { value: 'es', text: 'Español' }), h('option', { value: 'en', text: 'English' })));
    const msg = h('div');
    const form = h('form', { class: 'stack', novalidate: true }, name.wrap, email.wrap, picker.el, until.el, lang, msg);
    const dlg = openDialog({
      title: t('users.inviteTitle'), lead: t('users.inviteLead'), labelledIcon: 'person-plus', body: form, wide: true,
      actions: [
        { label: t('common.cancel'), onClick: (b, close) => close() },
        { label: t('users.sendInvite'), variant: 'primary', icon: 'send', onClick: () => form.requestSubmit() },
      ],
    });
    setTimeout(() => name.input.focus(), 60);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clear(msg);
      const btn = dlg.foot.lastChild;
      const n = name.input.value.trim();
      const em = email.input.value.trim();
      name.setError(n ? null : fieldErrorText('required'));
      email.setError(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) ? null : fieldErrorText(em ? 'invalid_email' : 'required'));
      if (!n) return name.input.focus();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return email.input.focus();
      const permissions = picker.value();
      if (!permissions.length) return msg.append(alertBox('bad', null, t('access.pickOne')));
      setBusy(btn, true, t('common.saving'));
      try {
        const r = await api.post('/users', { name: n, email: em, permissions, lang: form.querySelector('#inv-lang').value, accessUntil: until.value() });
        dlg.close();
        if (r.emailSent) toast(t('users.invited', { email: em })); else linkFallback(r.inviteLink);
        load();
      } catch (err) {
        setBusy(btn, false);
        if (err.code === 'validation') {
          if (err.fields.name) name.setError(fieldErrorText(err.fields.name, { max: 80 }));
          if (err.fields.email) { email.setError(fieldErrorText(err.fields.email)); email.input.focus(); }
          if (err.fields.permissions) msg.append(alertBox('bad', null, err.fields.permissions === 'not_assignable' ? fieldErrorText('not_assignable') : t('access.pickOne')));
          if (err.fields.accessUntil) msg.append(alertBox('bad', null, fieldErrorText(err.fields.accessUntil)));
        } else msg.append(alertBox('bad', null, errorText(err, { preserved: true })));
      }
    });
  });

  await load();
}
