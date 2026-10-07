/** Usuarios (administrators only). Table on large screens, cards on phones. */
import { h, icon, clear, initials } from '../dom.js';
import { t, fmtRelative, fmtDate } from '../i18n.js';
import { api } from '../api.js';
import { pageHead, loading, loadError, textField, alertBox, toast, errorText, fieldErrorText, openDialog, confirmDialog, setBusy, button, dropdown, copyText } from '../ui.js';

const STATUS_BADGE = { active: 'badge-ok', invited: 'badge-warn', disabled: 'badge' };

export async function render({ main }) {
  const add = button(t('users.invite'), { variant: 'primary', icon: 'person-plus' });
  main.append(pageHead({ title: t('users.title'), lead: t('users.lead'), actions: [add] }));
  const body = h('div', null, loading());
  main.append(body);

  const load = async () => {
    let data;
    try { data = await api.get('/users'); } catch (err) { clear(body).append(loadError(err, load)); return; }
    const users = data.users;
    const statusText = (u) => {
      if (u.status !== 'invited') return null;
      return u.inviteExpiresAt && u.inviteExpiresAt * 1000 > Date.now()
        ? t('users.inviteExpires', { when: fmtDate(u.inviteExpiresAt) })
        : t('users.inviteExpired');
    };
    const actionsMenu = (u) => {
      const trigger = h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': t('users.actionsFor', { name: u.name }) }, icon('three-dots-vertical'));
      if (u.isSelf) return h('span', { class: 'badge badge-brand', text: t('users.you') });
      // The owner account (IT) is protected: other administrators cannot change it.
      if (u.isOwner) return h('span', { class: 'badge', title: t('users.ownerHint') }, icon('shield-lock'), t('users.owner'));
      return dropdown(trigger, (close) => [
        u.status === 'invited' ? menuItem('send', t('users.resend'), () => { close(); resend(u); }) : null,
        u.role === 'editor' ? menuItem('shield-lock', t('users.makeAdmin'), () => { close(); update(u, { role: 'admin' }); })
          : menuItem('pencil-square', t('users.makeEditor'), () => { close(); update(u, { role: 'editor' }); }),
        u.status === 'disabled' ? menuItem('check2-circle', t('users.enable'), () => { close(); update(u, { status: 'active' }); })
          : u.status === 'active' ? menuItem('lock', t('users.disable'), () => { close(); disable(u); }) : null,
        h('hr'),
        menuItem('trash3', t('users.remove'), () => { close(); remove(u); }, true),
      ]).el;
    };
    const person = (u) => h('div', { class: 'person' }, h('span', { class: 'avatar', 'aria-hidden': 'true', text: initials(u.name) }),
      h('div', { class: 'grow' }, h('strong', { class: 'break', text: u.name }), h('div', { class: 'small muted break', text: u.email })));
    const statusBadge = (u) => h('div', { class: 'stack-sm' }, h('span', { class: ['badge', STATUS_BADGE[u.status]], text: t('users.status.' + u.status) }),
      statusText(u) ? h('span', { class: 'tiny muted', text: statusText(u) }) : null);

    const table = h('div', { class: 'table-wrap responsive hide-sm' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, ['name', 'role', 'status', 'lastLogin'].map((c) => h('th', { scope: 'col', text: t('users.cols.' + c) })), h('th', { scope: 'col' }, h('span', { class: 'sr-only', text: t('users.cols.actions') })))),
      h('tbody', null, users.map((u) => h('tr', null,
        h('td', null, person(u)),
        h('td', { text: t('users.roles.' + u.role)[0] }),
        h('td', null, statusBadge(u)),
        h('td', { class: 'small muted', text: u.lastLoginAt ? fmtRelative(u.lastLoginAt) : t('users.neverLoggedIn') }),
        h('td', { class: 'nowrap' }, actionsMenu(u)))))));
    const cards = h('div', { class: 'list-cards only-sm' }, users.map((u) => h('div', { class: 'card stack-sm' },
      h('div', { class: 'row-between' }, person(u), actionsMenu(u)),
      h('div', { class: 'row' }, h('span', { class: 'badge', text: t('users.roles.' + u.role)[0] }), statusBadge(u)),
      h('div', { class: 'tiny muted', text: u.lastLoginAt ? t('users.lastLogin', { when: fmtRelative(u.lastLoginAt) }) : t('users.neverLoggedIn') }))));
    clear(body).append(table, cards);
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
  const disable = async (u) => {
    if (await confirmDialog({ title: t('users.disableTitle', { name: u.name }), body: t('users.disableBody'), confirmLabel: t('users.disable'), danger: true })) update(u, { status: 'disabled' });
  };
  const remove = async (u) => {
    if (!(await confirmDialog({ title: t('users.removeTitle', { name: u.name }), body: t('users.removeBody'), confirmLabel: t('users.remove'), danger: true }))) return;
    try { await api.del(`/users/${u.id}`); toast(t('users.removed')); load(); }
    catch (err) { toast(err.code === 'validation' ? fieldErrorText(Object.values(err.fields)[0]) : errorText(err), { type: 'bad' }); }
  };

  add.addEventListener('click', () => {
    const name = textField({ label: t('users.name'), autocomplete: 'off', max: 80, required: true });
    const email = textField({ label: t('users.email'), type: 'email', autocomplete: 'off', inputmode: 'email', required: true });
    const roles = h('fieldset', { class: 'field fieldset-reset' }, h('legend', { class: 'label', text: t('users.role') }),
      h('div', { class: 'choice-group' }, ['editor', 'admin'].map((r) => h('label', { class: 'choice' },
        h('input', { type: 'radio', name: 'role', value: r, checked: r === 'editor' }),
        h('div', null, h('strong', { text: t('users.roles.' + r)[0] }), h('span', { text: t('users.roles.' + r)[1] }))))));
    const lang = h('div', { class: 'field' }, h('label', { class: 'label', for: 'inv-lang', text: t('users.language') }),
      h('select', { class: 'select', id: 'inv-lang' }, h('option', { value: 'es', text: 'Español' }), h('option', { value: 'en', text: 'English' })));
    const msg = h('div');
    const form = h('form', { class: 'stack', novalidate: true }, name.wrap, email.wrap, roles, lang, msg);
    const dlg = openDialog({
      title: t('users.inviteTitle'), lead: t('users.inviteLead'), labelledIcon: 'person-plus', body: form,
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
      setBusy(btn, true, t('common.saving'));
      try {
        const r = await api.post('/users', { name: n, email: em, role: form.querySelector('input[name="role"]:checked').value, lang: form.querySelector('#inv-lang').value });
        dlg.close();
        if (r.emailSent) toast(t('users.invited', { email: em })); else linkFallback(r.inviteLink);
        load();
      } catch (err) {
        setBusy(btn, false);
        if (err.code === 'validation') {
          if (err.fields.name) name.setError(fieldErrorText(err.fields.name, { max: 80 }));
          if (err.fields.email) { email.setError(fieldErrorText(err.fields.email)); email.input.focus(); }
        } else msg.append(alertBox('bad', null, errorText(err, { preserved: true })));
      }
    });
  });

  await load();
}
