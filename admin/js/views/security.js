/**
 * Seguridad (owner): who must use two-step sign-in (and resetting it for
 * someone who lost their phone), and the encrypted backup kept off the server.
 */
import { h, icon, fill, initials } from '../dom.js';
import { t, fmtDate, fmtBytes } from '../i18n.js';
import { api, download, saveBlob } from '../api.js';
import { pageHead, loading, loadError, button, setBusy, toast, errorText, fieldErrorText, textField, passwordField, alertBox, askPassword, cardHead, switchInput } from '../ui.js';

export async function render({ main, session }) {
  main.append(pageHead({ title: t('security.title'), lead: t('security.lead') }));
  const body = h('div', { class: 'stack-lg' }, loading());
  main.append(body);
  let alive = true;

  const load = async () => {
    let data;
    try { data = await api.get('/security'); } catch (err) { fill(body, loadError(err, load)); return; }
    if (alive) fill(body, h('div', { class: 'dash-grid' }, h('div', { class: 'stack-lg' }, accountsCard(data.accounts), backupCard(data.backup)), h('div', { class: 'stack-lg' }, twoFactorCard(data.twoFactor, session))));
  };

  // ---------------------------------------------------------------- two-step sign-in
  const twoFactorCard = (tf, sess) => {
    const sel = h('select', { class: 'select', id: 'sec-policy' }, ['owner', 'admins', 'all', 'none'].map((p) => h('option', { value: p, selected: p === tf.policy || null, text: t('security.policy.' + p) })));
    sel.addEventListener('change', async () => {
      const password = await askPassword({ title: t('security.policyConfirm'), lead: t('security.policyLead.' + sel.value), confirmLabel: t('common.save') });
      if (password === null) { sel.value = tf.policy; return; }
      try { await api.put('/security/policy', { twoFactor: sel.value, currentPassword: password }); toast(t('security.policySaved')); load(); }
      catch (err) { sel.value = tf.policy; toast(err.code === 'validation' ? t('fieldErrors.current_password_wrong') : errorText(err), { type: 'bad' }); }
    });
    const rows = tf.users.map((u) => {
      const state = u.enabled ? ['badge-ok', 'check-circle-fill', 'security.tfOn'] : u.required ? ['badge-warn', 'exclamation-triangle-fill', 'security.tfPending'] : ['', 'circle-half', 'security.tfOptional'];
      let reset = null;
      if (u.enabled && u.id !== sess.user.id) {
        reset = button(t('security.reset'), { small: true, variant: 'ghost', icon: 'phone', attrs: { 'aria-label': t('security.resetFor', { name: u.name }) } });
        reset.addEventListener('click', async () => {
          const password = await askPassword({ title: t('security.resetTitle', { name: u.name }), lead: t('security.resetLead'), confirmLabel: t('security.reset') });
          if (password === null) return;
          try { await api.post(`/users/${u.id}/2fa-reset`, { currentPassword: password }); toast(t('security.resetDone', { name: u.name })); load(); }
          catch (err) { toast(err.code === 'validation' ? t('fieldErrors.current_password_wrong') : errorText(err), { type: 'bad' }); }
        });
      }
      return h('li', { class: 'person-row' }, h('span', { class: 'avatar', 'aria-hidden': 'true', text: initials(u.name) }),
        h('div', { class: 'grow' }, h('strong', { class: 'break', text: u.name + (u.owner ? ' · ' + t('security.ownerTag') : '') }), h('div', { class: 'tiny muted break', text: u.email + (u.status === 'disabled' ? ' · ' + t('security.disabledAccount') : '') })),
        h('span', { class: ['badge', state[0]] }, icon(state[1]), t(state[2])), reset);
    });
    return h('section', { class: 'card', 'aria-labelledby': 'sec-tf' },
      cardHead({ id: 'sec-tf', icon: 'shield-lock', title: t('security.tfTitle'), lead: t('security.tfLead') }),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'sec-policy', text: t('security.policyLabel') }), sel,
        h('div', { class: 'field-foot' }, h('span', { class: 'hint', text: t('security.policyLead.' + tf.policy) }))),
      h('ul', { class: 'person-list' }, rows),
      h('p', { class: 'tiny muted', text: t('security.tfHelp') }));
  };

  // ---------------------------------------------------------------- account rules
  const accountsCard = (a) => {
    const inactive = h('select', { class: 'select', id: 'sec-inactive', 'aria-describedby': 'sec-inactive-hint' },
      [0, 90, 120, 180].map((d) => h('option', { value: String(d), selected: d === a.inactiveDays || null, text: t('security.inactive.' + d) })));
    const breached = switchInput({ id: 'sec-breached', checked: a.breachedCheck, describedBy: 'sec-breached-hint' });
    const remember = switchInput({ id: 'sec-remember', checked: a.rememberDevice, describedBy: 'sec-remember-hint' });
    const save = button(t('common.save'), { variant: 'primary', icon: 'check-lg' });
    save.addEventListener('click', async () => {
      const password = await askPassword({ title: t('security.accountsConfirm'), lead: t('security.accountsConfirmLead'), confirmLabel: t('common.save') });
      if (password === null) return;
      setBusy(save, true, t('common.saving'));
      try {
        await api.put('/security/accounts', { inactiveDays: Number(inactive.value), breachedCheck: breached.input.checked, rememberDevice: remember.input.checked, currentPassword: password });
        toast(t('security.accountsSaved'));
        load();
        return;
      } catch (err) { toast(err.code === 'validation' && err.fields.currentPassword ? t('fieldErrors.current_password_wrong') : errorText(err), { type: 'bad' }); }
      setBusy(save, false);
    });
    const rule = (sw, id, title, hint) => h('div', { class: 'rule' }, sw.wrap, h('div', { class: 'grow' }, h('label', { for: id, text: title }), h('div', { class: 'small muted', id: id + '-hint', text: hint })));
    return h('section', { class: 'card', 'aria-labelledby': 'sec-acc' },
      cardHead({ id: 'sec-acc', icon: 'person-gear', title: t('security.accountsTitle'), lead: t('security.accountsLead') }),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'sec-inactive', text: t('security.inactiveLabel') }), inactive,
        h('div', { class: 'field-foot' }, h('span', { class: 'hint', id: 'sec-inactive-hint', text: t('security.inactiveHint') }))),
      rule(breached, 'sec-breached', t('security.breachedTitle'), t('security.breachedHint')),
      rule(remember, 'sec-remember', t('security.rememberTitle'), t('security.rememberHint') + (a.rememberedDevices ? ' ' + t('security.rememberedNow', { n: a.rememberedDevices }) : '')),
      h('div', { class: 'card-foot' }, h('span'), save));
  };

  // ---------------------------------------------------------------- off-server backup
  const backupCard = (b) => {
    if (!b.supported) {
      return h('section', { class: 'card' }, cardHead({ icon: 'cloud-arrow-up', title: t('security.backupTitle') }), alertBox('warn', null, t('security.unsupported')));
    }
    const sw = switchInput({ id: 'ob-on', checked: b.enabled });
    const freq = h('select', { class: 'select', id: 'ob-freq' }, ['daily', 'weekly', 'monthly'].map((f) => h('option', { value: f, selected: f === b.frequency || null, text: t('security.freq.' + f) })));
    const email = textField({ label: t('security.backupEmail'), hint: t('security.backupEmailHint'), value: b.email, type: 'email', maxlength: 120, spellcheck: false });
    const photos = h('input', { type: 'checkbox', id: 'ob-photos', checked: b.includePhotos || null });
    const pw = passwordField({ label: t(b.passwordSet ? 'security.backupPasswordNew' : 'security.backupPassword'), hint: t(b.passwordSet ? 'security.backupPasswordKept' : 'security.backupPasswordHint'), autocomplete: 'new-password', placeholder: b.passwordSet ? '••••••••' : '' });
    const pw2 = passwordField({ label: t('security.backupPasswordConfirm'), autocomplete: 'new-password' });
    const save = button(t('common.save'), { variant: 'primary', icon: 'check-lg' });
    save.addEventListener('click', async () => {
      pw.setError(null); pw2.setError(null); email.setError(null);
      if (pw.input.value && pw.input.value.length < 12) { pw.setError(t('security.passwordShort')); pw.input.focus(); return; }
      if (pw.input.value !== pw2.input.value) { pw2.setError(fieldErrorText('password_mismatch')); pw2.input.focus(); return; }
      const password = await askPassword({ title: t('security.backupConfirm'), lead: t('security.backupConfirmLead'), confirmLabel: t('common.save') });
      if (password === null) return;
      setBusy(save, true, t('common.saving'));
      try {
        await api.put('/security/backup', { enabled: sw.input.checked, frequency: freq.value, email: email.input.value.trim(), includePhotos: photos.checked, password: pw.input.value, currentPassword: password });
        toast(t('security.backupSaved'));
        load();
        return;
      } catch (err) {
        if (err.code === 'validation') {
          if (err.fields.currentPassword) toast(t('fieldErrors.current_password_wrong'), { type: 'bad' });
          if (err.fields.email) email.setError(fieldErrorText(err.fields.email));
          if (err.fields.password) pw.setError(err.fields.password === 'required' ? t('security.passwordNeeded') : t('security.passwordShort'));
        } else toast(errorText(err), { type: 'bad' });
      }
      setBusy(save, false);
    });
    const sendNow = button(t('security.sendNow'), { icon: 'send', small: true, attrs: { disabled: !(b.email && b.passwordSet) || null } });
    sendNow.addEventListener('click', async () => {
      setBusy(sendNow, true, t('report.sending'));
      try { const r = await api.post('/security/backup/send', {}); toast(t('security.sent', { size: fmtBytes(r.bytes), to: b.email }) + (r.photos === 'omitted' ? ' ' + t('security.photosOmitted') : '')); load(); return; }
      catch (err) { toast(err.code === 'email_failed' ? t('security.sendFailed') : errorText(err), { type: 'bad' }); }
      setBusy(sendNow, false);
    });
    const dl = button(t('security.download'), { icon: 'download', small: true, attrs: { disabled: !b.passwordSet || null } });
    dl.addEventListener('click', async () => {
      const password = await askPassword({ title: t('security.download'), lead: t('security.downloadLead'), confirmLabel: t('security.download') });
      if (password === null) return;
      setBusy(dl, true, t('security.preparing'));
      try { const f = await download('/security/backup/download', { currentPassword: password }); saveBlob(f.blob, f.filename); toast(t('security.downloaded')); }
      catch (err) { toast(err.code === 'validation' ? t('fieldErrors.current_password_wrong') : errorText(err), { type: 'bad' }); }
      setBusy(dl, false);
    });
    const status = b.lastSentAt
      ? alertBox(b.lastStatus === 'failed' ? 'warn' : 'ok', null, t('security.lastSent', { when: fmtDate(b.lastSentAt), size: b.lastBytes ? fmtBytes(b.lastBytes) : '—' })
        + (b.lastPhotos === 'omitted' ? ' ' + t('security.photosOmitted') : '') + (b.lastStatus === 'failed' ? ' ' + t('security.lastFailed') : ''))
      : alertBox(b.enabled ? 'warn' : 'info', null, t(b.enabled ? 'security.neverSent' : 'security.off'));
    return h('section', { class: 'card', 'aria-labelledby': 'sec-ob' },
      cardHead({ id: 'sec-ob', icon: 'cloud-arrow-up', title: t('security.backupTitle'), lead: t('security.backupLead') }),
      status,
      h('div', { class: 'rule' }, sw.wrap, h('div', { class: 'grow' }, h('label', { for: 'ob-on', text: t('security.backupOn') }), h('div', { class: 'small muted', text: t('security.backupOnHint') }))),
      h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', { class: 'label', for: 'ob-freq', text: t('security.frequency') }), freq),
        email.wrap, pw.wrap, pw2.wrap),
      h('label', { class: 'check', for: 'ob-photos' }, photos, h('span', { text: t('security.includePhotos') })),
      h('details', { class: 'disclosure help-box' }, h('summary', null, t('security.howOpen'), icon('chevron-down')),
        h('ol', null, ['open1', 'open2', 'open3'].map((k) => h('li', { text: t('security.' + k) })))),
      h('div', { class: 'card-foot' }, h('div', { class: 'row' }, sendNow, dl), save));
  };

  await load();
  return { destroy: () => { alive = false; } };
}

