/** Mi cuenta — profile, preferences and "Cuenta / Seguridad". */
import { h, clear, fill, icon } from '../dom.js';
import { t, tp, getLang, setLang } from '../i18n.js';
import { api, setCsrf } from '../api.js';
import { pageHead, textField, passwordField, passwordGuide, alertBox, toast, errorText, fieldErrorText, setBusy, button, cardHead, openDialog } from '../ui.js';
import { renderSetup, confirmWithCode, recoveryCodes } from '../twofactor.js';
import { updateUser, themeSwitch } from '../app.js';
import { getThemePref } from '../theme.js';
import { permissionList } from '../access.js';

export function render({ main, session }) {
  const user = session.user;
  main.append(pageHead({ title: t('account.title'), lead: t('account.lead') }));

  // Profile.
  const name = textField({ label: t('account.name'), value: user.name, autocomplete: 'name', max: 80, required: true });
  const email = textField({ label: t('account.email'), value: user.email, readOnly: true, hint: t('account.emailHint') });
  const langSel = h('select', { class: 'select', id: 'acc-lang' }, ['es', 'en'].map((l) => h('option', { value: l, text: t('langs.' + l), selected: l === getLang() })));
  const profMsg = h('div');
  const saveProfile = button(t('account.saveProfile'), { variant: 'primary', type: 'submit' });
  const profile = h('form', { class: 'card stack', novalidate: true, 'aria-labelledby': 'prof-t' },
    h('h2', { id: 'prof-t', text: t('account.profile') }),
    name.wrap, email.wrap,
    h('div', { class: 'field' }, h('span', { class: 'label', text: t('access.yours') }),
      h('span', { class: 'small', text: user.owner ? t('access.owner') : permissionList(user.permissions || []) })),
    h('div', { class: 'field' }, h('label', { class: 'label', for: 'acc-lang', text: t('account.language') }), langSel),
    h('div', { class: 'field' }, h('span', { class: 'label', text: t('account.theme') }), themeSwitch()),
    profMsg, h('div', null, saveProfile));
  profile.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(profMsg);
    if (!name.input.value.trim()) { name.setError(fieldErrorText('required')); return name.input.focus(); }
    name.setError(null);
    setBusy(saveProfile, true, t('common.saving'));
    try {
      const r = await api.put('/account/profile', { name: name.input.value.trim(), lang: langSel.value, theme: getThemePref() });
      toast(t('account.profileSaved'));
      setBusy(saveProfile, false);
      if (langSel.value !== getLang()) setLang(langSel.value); // the panel re-renders in the new language
      updateUser(r.user); // and with the new name (menu, greeting)
    } catch (err) {
      setBusy(saveProfile, false);
      if (err.code === 'validation' && err.fields.name) name.setError(fieldErrorText(err.fields.name, { max: 80 }));
      else profMsg.append(alertBox('bad', null, errorText(err, { preserved: true })));
    }
  });

  // Password.
  const current = passwordField({ label: t('account.currentPassword'), autocomplete: 'current-password', required: true });
  const pw = passwordField({ label: t('auth.newPassword'), autocomplete: 'new-password', required: true });
  const pw2 = passwordField({ label: t('auth.confirmPassword'), autocomplete: 'new-password', required: true });
  const pwMsg = h('div', { 'aria-live': 'polite' });
  const savePw = button(t('account.changePassword'), { variant: 'primary', type: 'submit', icon: 'key' });
  const security = h('form', { class: 'card stack', novalidate: true, 'aria-labelledby': 'sec-t' },
    h('div', null, h('h2', { id: 'sec-t', text: t('account.security') }), h('p', { class: 'muted small', text: t('account.securityLead') })),
    h('input', { type: 'text', autocomplete: 'username', value: user.email, class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true', readOnly: true }),
    current.wrap, pw.wrap, pw2.wrap, passwordGuide(pw.input, pw2.input), pwMsg, h('div', null, savePw));
  security.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(pwMsg);
    [current, pw, pw2].forEach((f) => f.setError(null));
    if (!current.input.value) { current.setError(fieldErrorText('required')); return current.input.focus(); }
    if ([...pw.input.value].length < 10) { pw.setError(fieldErrorText('password_too_short')); return pw.input.focus(); }
    if (pw.input.value !== pw2.input.value) { pw2.setError(fieldErrorText('password_mismatch')); return pw2.input.focus(); }
    setBusy(savePw, true, t('common.saving'));
    try {
      const r = await api.post('/account/password', { currentPassword: current.input.value, password: pw.input.value, passwordConfirm: pw2.input.value });
      setCsrf(r.csrf); // this session was renewed; other sessions were closed
      [current, pw, pw2].forEach((f) => { f.input.value = ''; f.input.dispatchEvent(new Event('input')); });
      setBusy(savePw, false);
      pwMsg.append(alertBox('ok', null, t('account.passwordChanged')));
      toast(t('account.passwordChanged'));
    } catch (err) {
      setBusy(savePw, false);
      if (err.code === 'validation') {
        const map = { currentPassword: current, password: pw, passwordConfirm: pw2 };
        let first = null;
        for (const [k, code] of Object.entries(err.fields)) if (map[k]) { map[k].setError(fieldErrorText(code)); first ||= map[k].input; }
        if (first) first.focus();
      } else pwMsg.append(alertBox('bad', null, errorText(err)));
    }
  });

  // Sessions.
  const revoke = button(t('account.revokeOthers'), { icon: 'box-arrow-right' });
  revoke.addEventListener('click', async () => {
    setBusy(revoke, true, t('common.saving'));
    try { const r = await api.post('/account/sessions/revoke-others'); toast(tp('account.revoked', r.ended)); }
    catch (err) { toast(errorText(err), { type: 'bad' }); }
    setBusy(revoke, false);
  });
  const sessions = h('section', { class: 'card stack', 'aria-labelledby': 'ses-t' },
    h('div', null, h('h2', { id: 'ses-t', text: t('account.sessions') }), h('p', { class: 'muted small', text: t('account.sessionsLead') })), h('div', null, revoke));

  // Two-step sign-in.
  const tfBody = h('div', null);
  const twoStep = h('section', { class: 'card', 'aria-labelledby': 'tf-t' },
    cardHead({ id: 'tf-t', icon: 'shield-lock', title: t('twofa.title'), lead: t('twofa.lead') }), tfBody);
  const drawTwoStep = (st) => {
    const badge = h('span', { class: ['badge', st.enabled ? 'badge-ok' : (st.required ? 'badge-warn' : '')] },
      icon(st.enabled ? 'check-circle-fill' : 'exclamation-triangle-fill'), t(st.enabled ? 'twofa.on' : 'twofa.off'));
    if (!st.enabled) {
      const start = button(t('twofa.enable'), { variant: 'primary', icon: 'shield-lock' });
      start.addEventListener('click', () => {
        const box = h('div');
        const dlg = openDialog({ title: t('twofa.setupTitle'), lead: t('twofa.setupLead'), labelledIcon: 'shield-lock', wide: true, body: box });
        renderSetup(box, { onEnabled: async () => { dlg.close(); toast(t('twofa.enabledToast')); drawTwoStep(await api.get('/account/2fa')); } });
      });
      fill(tfBody, h('div', { class: 'stack' }, h('div', null, badge), h('p', { class: 'small', text: t('twofa.why') }), h('div', null, start)));
      return;
    }
    const regen = button(t('twofa.newCodes'), { icon: 'arrow-repeat', small: true });
    regen.addEventListener('click', async () => {
      const c = await confirmWithCode({ title: t('twofa.newCodes'), lead: t('twofa.newCodesLead'), confirmLabel: t('twofa.newCodesConfirm') });
      if (!c) return;
      try {
        const r = await api.post('/account/2fa/recovery-codes', { currentPassword: c.password, code: c.code });
        const box = h('div');
        const dlg = openDialog({ title: t('twofa.codesTitle'), labelledIcon: 'shield-lock', body: box, dismissible: false });
        fill(box, recoveryCodes(r.recoveryCodes, () => { dlg.close(); drawTwoStep(r.status); }, t('twofa.continue')));
      } catch (err) { toast(err.code === 'validation' ? t(err.fields.currentPassword ? 'fieldErrors.current_password_wrong' : 'twofa.wrongCode') : errorText(err), { type: 'bad' }); }
    });
    const off = st.required ? null : button(t('twofa.disable'), { icon: 'x-lg', small: true, variant: 'ghost' });
    if (off) {
      off.addEventListener('click', async () => {
        const c = await confirmWithCode({ title: t('twofa.disable'), lead: t('twofa.disableLead'), confirmLabel: t('twofa.disable'), danger: true });
        if (!c) return;
        try { const r = await api.post('/account/2fa/disable', { currentPassword: c.password, code: c.code }); toast(t('twofa.disabledToast')); drawTwoStep(r.status); }
        catch (err) { toast(err.code === 'validation' ? t(err.fields.currentPassword ? 'fieldErrors.current_password_wrong' : 'twofa.wrongCode') : errorText(err), { type: 'bad' }); }
      });
    }
    fill(tfBody, h('div', { class: 'stack' },
      h('div', { class: 'row' }, badge, st.enabledAt ? h('span', { class: 'tiny muted', text: t('twofa.since', { date: new Date(st.enabledAt * 1000).toLocaleDateString() }) }) : null),
      h('p', { class: 'small', text: t('twofa.recoveryLeft', { n: st.recoveryRemaining }) }),
      st.recoveryRemaining <= 3 ? alertBox('warn', null, t('twofa.fewCodes')) : null,
      st.required ? h('p', { class: 'tiny muted', text: t('twofa.requiredNote') }) : null,
      h('div', { class: 'row' }, regen, off)));
  };
  api.get('/account/2fa').then(drawTwoStep).catch((err) => fill(tfBody, alertBox('bad', null, errorText(err))));

  main.append(h('div', { class: 'dash-grid' }, h('div', { class: 'stack-lg' }, profile, sessions), h('div', { class: 'stack-lg' }, security, twoStep)));
}
