/**
 * «Pedir acceso»: someone asks for sections they can't use; whoever manages
 * users gets it by e-mail and in Usuarios, where one click grants it.
 * Opened from «Más secciones», Mi cuenta and a screen the account can't open.
 */
import { h, clear } from './dom.js';
import { t, fmtDate } from './i18n.js';
import { api } from './api.js';
import { openDialog, textField, alertBox, toast, errorText, setBusy } from './ui.js';
import { askable } from './access.js';

/**
 * @param {object} user the signed-in account
 * @param {string[]} preselect permissions to tick (e.g. the ones the screen needs)
 * @param {(request: object) => void} [onSent]
 */
export async function openAccessRequest(user, preselect = [], onSent) {
  let pending = null;
  try { pending = (await api.get('/account/access-request')).request; } catch (e) { /* the form works without it */ }
  const options = askable(user);
  const boxes = options.map((p) => h('label', { class: 'check check-help' },
    h('input', { type: 'checkbox', value: p, checked: preselect.includes(p) || (pending && pending.permissions.includes(p)) || null }),
    h('span', null, h('span', { class: 'check-title', text: t('access.perms.' + p) }), h('span', { class: 'tiny muted check-hint', text: t('access.permHelp.' + p) }))));
  const message = textField({ label: t('accessRequest.message'), hint: t('accessRequest.messageHint'), multiline: true, rows: 3, max: 500, maxlength: 500, optionalTag: true, value: pending ? pending.message : '' });
  const msg = h('div');
  const form = h('form', { class: 'stack', novalidate: true },
    pending ? alertBox('info', null, t('accessRequest.pending', { when: fmtDate(pending.createdAt, false) })) : null,
    h('fieldset', { class: 'field fieldset-reset' }, h('legend', { class: 'label', text: t('accessRequest.what') }), h('div', { class: 'checks' }, boxes)),
    message.wrap, msg);
  const dlg = openDialog({
    title: t('accessRequest.title'), lead: t('accessRequest.lead'), labelledIcon: 'send', body: form, wide: true,
    actions: [
      { label: t('common.cancel'), onClick: (b, close) => close() },
      { label: t(pending ? 'accessRequest.update' : 'accessRequest.send'), variant: 'primary', icon: 'send', onClick: () => form.requestSubmit() },
    ],
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(msg);
    const permissions = boxes.filter((b) => b.firstChild.checked).map((b) => b.firstChild.value);
    if (!permissions.length) { msg.append(alertBox('bad', null, t('accessRequest.pickOne'))); return; }
    const btn = dlg.foot.lastChild;
    setBusy(btn, true, t('accessRequest.sending'));
    try {
      const r = await api.post('/account/access-request', { permissions, message: message.input.value.trim() });
      dlg.close();
      toast(t('accessRequest.sent'));
      if (onSent) onSent(r.request);
    } catch (err) {
      setBusy(btn, false);
      msg.append(alertBox('bad', null, err.code === 'too_many_attempts' ? t('accessRequest.tooMany') : errorText(err, { preserved: true })));
    }
  });
}
