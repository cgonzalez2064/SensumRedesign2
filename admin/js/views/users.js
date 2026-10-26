/**
 * Usuarios: the owner account and accounts with "Gestión de usuarios". Table on
 * large screens, cards on phones. The server decides whom each account may
 * change (canManage) and which access it may give (assignable).
 */
import { h, icon, clear, initials, fill } from '../dom.js';
import { t, fmtRelative, fmtDate } from '../i18n.js';
import { api } from '../api.js';
import { pageHead, loading, loadError, textField, passwordField, passwordGuide, alertBox, toast, errorText, fieldErrorText, openDialog, confirmDialog, askPassword, setBusy, button, dropdown, copyText, emptyState, switchInput, segmented } from '../ui.js';
import { accessPicker, accessLabel, accessTypeOf } from '../access.js';
import { viewAs, pickViewAs } from '../viewas.js';
import { reloadSession } from '../app.js';

const STATUS_BADGE = { active: 'badge-ok', invited: 'badge-warn', disabled: 'badge' };

export async function render({ main }) {
  const add = button(t('users.invite'), { variant: 'primary', icon: 'person-plus' });
  // "Ver como" (owner only): check what each access type sees (read-only).
  const viewBtn = button(t('viewAs.pick'), { icon: 'eye', onClick: () => pickViewAs({ onDone: () => reloadSession('/') }) });
  viewBtn.hidden = true;
  main.append(pageHead({ title: t('users.title'), lead: t('users.lead'), actions: [viewBtn, add] }));
  const body = h('div', null, loading());
  main.append(body);

  let presets = null;
  let assignable = [];
  let viewerIsOwner = false;
  // Search and filters (kept while the list reloads after a change).
  const filters = { q: '', status: '', access: '' };
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
      if (u.status !== 'invited') return null;
      return u.inviteExpiresAt && u.inviteExpiresAt * 1000 > Date.now()
        ? t('users.inviteExpires', { when: fmtDate(u.inviteExpiresAt) })
        : t('users.inviteExpired');
    };
    const actionsMenu = (u) => {
      const trigger = h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': t('users.actionsFor', { name: u.name }) }, icon('three-dots-vertical'));
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
        h('hr'),
        menuItem('shield-lock', t('access.change'), () => { close(); changeAccess(u); }),
        u.status === 'disabled' ? menuItem('check2-circle', t('users.enable'), () => { close(); update(u, { status: 'active' }); })
          : u.status === 'active' ? menuItem('lock', t('users.disable'), () => { close(); disable(u); }) : null,
        h('hr'),
        menuItem('trash3', t('users.remove'), () => { close(); remove(u); }, true),
      ]).el;
    };
    const person = (u) => h('div', { class: 'person' }, h('span', { class: 'avatar', 'aria-hidden': 'true', text: initials(u.name) }),
      h('div', { class: 'grow' }, h('strong', { class: 'break', text: u.name }), h('div', { class: 'small muted break', text: u.email })));
    const statusBadge = (u) => h('div', { class: 'stack-sm' }, h('span', { class: ['badge', STATUS_BADGE[u.status]], text: t('users.status.' + u.status) }),
      statusText(u) ? h('span', { class: 'tiny muted', text: statusText(u) }) : null,
      u.mustChangePassword ? h('span', { class: 'tiny user-flag' }, icon('key'), t('users.mustChangeBadge')) : null,
      u.twoFactorEnabled ? h('span', { class: 'tiny muted user-flag' }, icon('shield-lock'), t('users.twoFactorBadge')) : null);

    // ---- search & filters
    const typeOf = (u) => (u.isOwner ? 'owner' : accessTypeOf(u.permissions || [], presets));
    const search = h('input', { class: 'input', type: 'search', value: filters.q, placeholder: t('users.search'), 'aria-label': t('users.search'), autocomplete: 'off' });
    const statusSel = h('select', { class: 'select', 'aria-label': t('users.filterStatus') },
      [['', t('users.allStatuses')], ['active', t('users.status.active')], ['invited', t('users.status.invited')], ['disabled', t('users.status.disabled')]]
        .map(([v, l]) => h('option', { value: v, text: l, selected: v === filters.status || null })));
    const accessSel = h('select', { class: 'select', 'aria-label': t('users.filterAccess') },
      h('option', { value: '', text: t('users.allAccess') }), h('option', { value: 'owner', text: t('users.ownerAccess'), selected: filters.access === 'owner' || null }),
      [...Object.keys(presets), 'custom'].map((k) => h('option', { value: k, text: t('access.types.' + k)[0], selected: k === filters.access || null })));
    const count = h('p', { class: 'small muted users-count', 'aria-live': 'polite' });
    const listBox = h('div');
    const matches = (u) => {
      const q = fold(filters.q.trim());
      if (q && !fold(u.name + ' ' + u.email + ' ' + accessLabel(u, presets)).includes(q)) return false;
      if (filters.status && u.status !== filters.status) return false;
      if (filters.access && typeOf(u) !== filters.access) return false;
      return true;
    };
    const renderList = () => {
      const shown = users.filter(matches);
      count.textContent = shown.length === users.length ? t('users.countAll', { n: users.length }) : t('users.countSome', { n: shown.length, total: users.length });
      if (!shown.length) {
        fill(listBox, h('div', { class: 'card' }, emptyState('people', t('users.noMatchTitle'), t('users.noMatchBody'),
          button(t('users.clearFilters'), { small: true, onClick: () => { filters.q = ''; filters.status = ''; filters.access = ''; search.value = ''; statusSel.value = ''; accessSel.value = ''; renderList(); } }))));
        return;
      }
      fill(listBox, tableOf(shown), cardsOf(shown));
    };
    let timer = 0;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { filters.q = search.value; renderList(); }, 150); });
    statusSel.addEventListener('change', () => { filters.status = statusSel.value; renderList(); });
    accessSel.addEventListener('change', () => { filters.access = accessSel.value; renderList(); });
    const toolbar = h('div', { class: 'users-toolbar' }, h('div', { class: 'users-search' }, icon('search'), search), statusSel, accessSel);

    const tableOf = (list) => h('div', { class: 'table-wrap responsive hide-sm' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, ['name', 'access', 'status', 'lastLogin'].map((c) => h('th', { scope: 'col', text: t('users.cols.' + c) })), h('th', { scope: 'col' }, h('span', { class: 'sr-only', text: t('users.cols.actions') })))),
      h('tbody', null, list.map((u) => h('tr', null,
        h('td', null, person(u)),
        h('td', { class: 'small', text: accessLabel(u, presets) }),
        h('td', null, statusBadge(u)),
        h('td', { class: 'small muted', text: u.lastLoginAt ? fmtRelative(u.lastLoginAt) : t('users.neverLoggedIn') }),
        h('td', { class: 'nowrap' }, actionsMenu(u)))))));
    const cardsOf = (list) => h('div', { class: 'list-cards only-sm' }, list.map((u) => h('div', { class: 'card stack-sm' },
      h('div', { class: 'row-between' }, person(u), actionsMenu(u)),
      h('div', { class: 'small', text: accessLabel(u, presets) }),
      h('div', { class: 'row' }, statusBadge(u)),
      h('div', { class: 'tiny muted', text: u.lastLoginAt ? t('users.lastLogin', { when: fmtRelative(u.lastLoginAt) }) : t('users.neverLoggedIn') }))));
    fill(body, h('div', { class: 'stack' }, toolbar, count, listBox));
    renderList();
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
    const msg = h('div');
    const dlg = openDialog({
      title: t('access.changeTitle', { name: u.name }), labelledIcon: 'shield-lock', body: h('div', { class: 'stack' }, picker.el, msg), wide: true,
      actions: [
        { label: t('common.cancel'), onClick: (b, close) => close() },
        { label: t('common.save'), variant: 'primary', icon: 'check-lg', onClick: async (btn) => {
          clear(msg);
          const permissions = picker.value();
          if (!permissions.length) return msg.append(alertBox('bad', null, t('access.pickOne')));
          setBusy(btn, true, t('common.saving'));
          try { await api.put(`/users/${u.id}`, { permissions }); dlg.close(); toast(t('access.changed')); load(); }
          catch (err) { setBusy(btn, false); msg.append(alertBox('bad', null, err.code === 'validation' ? fieldErrorText(Object.values(err.fields)[0]) : errorText(err, { preserved: true }))); }
        } },
      ],
    });
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
        await api.post(`/users/${u.id}/password`, { password, mustChange, currentPassword: mine.input.value });
        dlg.close();
        load();
        // Shown once more so it can be copied; it is never e-mailed.
        openDialog({
          title: t('users.setPasswordDoneTitle'), labelledIcon: 'check-circle-fill',
          body: h('div', { class: 'stack' }, h('output', { class: 'pw-generated', text: password }),
            h('p', { class: 'muted', text: t('users.setPasswordDoneBody', { name: u.name }) }),
            mustChange ? h('p', { class: 'small muted', text: t('users.setPasswordDoneChange') }) : null),
          actions: [
            { label: t('common.close'), onClick: (b, close) => close() },
            { label: t('users.pwCopy'), variant: 'primary', icon: 'clipboard', onClick: () => copy(password) },
          ],
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
    const resetBtn = u.twoFactorEnabled ? button(t('users.twoFactorReset'), { icon: 'arrow-counterclockwise', small: true, onClick: async () => {
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
      body: h('div', { class: 'stack' }, state, requireRow, resetBtn ? h('div', null, resetBtn) : null),
      actions: [{ label: t('common.close'), onClick: (b, close) => close() }],
    });
  };

  add.addEventListener('click', () => {
    const name = textField({ label: t('users.name'), autocomplete: 'off', max: 80, required: true });
    const email = textField({ label: t('users.email'), type: 'email', autocomplete: 'off', inputmode: 'email', required: true });
    const picker = accessPicker(presets, assignable.length && presets.content.every((p) => assignable.includes(p)) ? presets.content : assignable.slice(0, 1), 'inv', assignable);
    const lang = h('div', { class: 'field' }, h('label', { class: 'label', for: 'inv-lang', text: t('users.language') }),
      h('select', { class: 'select', id: 'inv-lang' }, h('option', { value: 'es', text: 'Español' }), h('option', { value: 'en', text: 'English' })));
    const msg = h('div');
    const form = h('form', { class: 'stack', novalidate: true }, name.wrap, email.wrap, picker.el, lang, msg);
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
        const r = await api.post('/users', { name: n, email: em, permissions, lang: form.querySelector('#inv-lang').value });
        dlg.close();
        if (r.emailSent) toast(t('users.invited', { email: em })); else linkFallback(r.inviteLink);
        load();
      } catch (err) {
        setBusy(btn, false);
        if (err.code === 'validation') {
          if (err.fields.name) name.setError(fieldErrorText(err.fields.name, { max: 80 }));
          if (err.fields.email) { email.setError(fieldErrorText(err.fields.email)); email.input.focus(); }
          if (err.fields.permissions) msg.append(alertBox('bad', null, err.fields.permissions === 'not_assignable' ? fieldErrorText('not_assignable') : t('access.pickOne')));
        } else msg.append(alertBox('bad', null, errorText(err, { preserved: true })));
      }
    });
  });

  await load();
}
