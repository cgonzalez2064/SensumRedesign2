/** Sign-in, password recovery, invitation and first-time setup screens. */
import { h, icon, clear } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { textField, passwordField, passwordGuide, alertBox, errorText, fieldErrorText, setBusy } from '../ui.js';
import { themeSwitch, langSwitch } from '../app.js';

/** Common auth layout: centered card + theme/language switches. */
function layout(app, title, lead, ...content) {
  const h1 = h('h1', { tabindex: '-1', text: title });
  const card = h('div', { class: 'auth-card' },
    h('div', { class: 'auth-brand' }, h('img', { src: '../assets/logo-icon.png', alt: '', width: 46, height: 46 }),
      h('div', null, h('strong', { text: t('app.brand') }), h('span', { text: t('app.name') }))),
    h1, lead ? h('p', { class: 'lead', text: lead }) : null, ...content);
  clear(app).append(
    h('main', { class: 'auth', id: 'main' },
      h('div', { class: 'auth-top' }, langSwitch(), themeSwitch()),
      h('div', { class: 'stack' }, card,
        h('p', { class: 'auth-foot' }, h('a', { href: '../' }, icon('arrow-left'), ' ', t('auth.backToSite'))))));
  document.title = title + ' · ' + t('app.name');
  h1.focus();
  return card;
}

function applyFieldErrors(err, map) {
  let first = null;
  for (const [name, field] of Object.entries(map)) {
    const code = err.fields && err.fields[name];
    field.setError(code ? fieldErrorText(code) : null);
    if (code && !first) first = field.input;
  }
  if (first) first.focus();
  return !!first;
}

export function login({ app, onSignedIn }) {
  const email = textField({ label: t('auth.email'), type: 'email', autocomplete: 'username', inputmode: 'email', required: true });
  const pw = passwordField({ label: t('auth.password'), autocomplete: 'current-password', required: true });
  const msg = h('div', { 'aria-live': 'assertive' });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, t('auth.submit'));
  const form = h('form', { class: 'stack', novalidate: true }, email.wrap, pw.wrap, msg, submit,
    h('p', { class: 'small' }, h('a', { href: '#/recuperar', text: t('auth.forgot') })));
  layout(app, t('auth.loginTitle'), t('auth.loginLead'), form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(msg);
    email.setError(email.input.value.trim() ? null : fieldErrorText('required'));
    pw.setError(pw.input.value ? null : fieldErrorText('required'));
    if (!email.input.value.trim()) return email.input.focus();
    if (!pw.input.value) return pw.input.focus();
    setBusy(submit, true, t('auth.submitting'));
    try {
      const data = await api.post('/auth/login', { email: email.input.value.trim(), password: pw.input.value }, { auth: false });
      onSignedIn(data);
    } catch (err) {
      setBusy(submit, false);
      msg.append(alertBox('bad', null, errorText(err)));
      pw.input.value = '';
      pw.input.focus();
    }
  });
}

export function forgot({ app }) {
  const email = textField({ label: t('auth.email'), type: 'email', autocomplete: 'username', inputmode: 'email', required: true });
  const msg = h('div', { 'aria-live': 'assertive' });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, t('auth.forgotSubmit'));
  const form = h('form', { class: 'stack', novalidate: true }, email.wrap, msg, submit,
    h('p', { class: 'small' }, h('a', { href: '#/ingresar', text: t('auth.backToLogin') })));
  const card = layout(app, t('auth.forgotTitle'), t('auth.forgotLead'), form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(msg);
    const value = email.input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { email.setError(fieldErrorText(value ? 'invalid_email' : 'required')); return email.input.focus(); }
    email.setError(null);
    setBusy(submit, true, t('common.saving'));
    try {
      await api.post('/auth/forgot', { email: value }, { auth: false });
      clear(card).append(h('div', { class: 'empty' }, h('span', { class: 'icon-tile' }, icon('envelope')),
        h('h1', { tabindex: '-1', text: t('auth.forgotDoneTitle') }), h('p', { text: t('auth.forgotDone', { email: value }) }),
        h('a', { class: 'btn btn-primary', href: '#/ingresar' }, t('auth.backToLogin'))));
      card.querySelector('h1').focus();
    } catch (err) {
      setBusy(submit, false);
      if (err.code === 'validation') applyFieldErrors(err, { email });
      else msg.append(alertBox('bad', null, errorText(err)));
    }
  });
}

function invalidLink(app, kind) {
  layout(app, t('auth.linkInvalidTitle'), kind === 'reset' ? t('auth.linkInvalidReset') : t('auth.linkInvalidInvite'),
    kind === 'reset' ? h('a', { class: 'btn btn-primary btn-block', href: '#/recuperar' }, t('auth.requestNew'))
      : h('a', { class: 'btn btn-block', href: '#/ingresar' }, t('auth.backToLogin')));
}

function checking(app) {
  layout(app, t('auth.checking'), null, h('div', { class: 'page-loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' })));
}

export async function reset({ app, params }) {
  const token = params[0];
  checking(app);
  let valid = false;
  try { valid = (await api.post('/auth/reset/verify', { token }, { auth: false })).valid; } catch (e) { valid = false; }
  if (!valid) return invalidLink(app, 'reset');

  const pw = passwordField({ label: t('auth.newPassword'), autocomplete: 'new-password', required: true });
  const pw2 = passwordField({ label: t('auth.confirmPassword'), autocomplete: 'new-password', required: true });
  const msg = h('div', { 'aria-live': 'assertive' });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, t('auth.resetSubmit'));
  const form = h('form', { class: 'stack', novalidate: true }, pw.wrap, pw2.wrap, passwordGuide(pw.input, pw2.input), msg, submit);
  const card = layout(app, t('auth.resetTitle'), t('auth.resetLead'), form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(msg);
    if ([...pw.input.value].length < 10) { pw.setError(fieldErrorText('password_too_short')); return pw.input.focus(); }
    pw.setError(null);
    if (pw.input.value !== pw2.input.value) { pw2.setError(fieldErrorText('password_mismatch')); return pw2.input.focus(); }
    pw2.setError(null);
    setBusy(submit, true, t('common.saving'));
    try {
      await api.post('/auth/reset', { token, password: pw.input.value, passwordConfirm: pw2.input.value }, { auth: false });
      clear(card).append(h('div', { class: 'empty' }, h('span', { class: 'icon-tile' }, icon('check-circle-fill')),
        h('h1', { tabindex: '-1', text: t('auth.resetDone') }), h('a', { class: 'btn btn-primary', href: '#/ingresar' }, t('auth.loginTitle'))));
      card.querySelector('h1').focus();
    } catch (err) {
      setBusy(submit, false);
      if (err.code === 'link_invalid') return invalidLink(app, 'reset');
      if (err.code === 'validation' && applyFieldErrors(err, { password: pw, passwordConfirm: pw2 })) return;
      msg.append(alertBox('bad', null, errorText(err)));
    }
  });
}

export async function invitation({ app, params, onSignedIn }) {
  const token = params[0];
  checking(app);
  let info = null;
  try { info = await api.post('/auth/invitation/verify', { token }, { auth: false }); } catch (e) { info = null; }
  if (!info || !info.valid) return invalidLink(app, 'invite');

  const name = textField({ label: t('auth.yourName'), value: info.name, autocomplete: 'name', max: 80, required: true });
  const email = textField({ label: t('auth.email'), value: info.email, type: 'email', autocomplete: 'username', readOnly: true });
  const pw = passwordField({ label: t('auth.newPassword'), autocomplete: 'new-password', required: true });
  const pw2 = passwordField({ label: t('auth.confirmPassword'), autocomplete: 'new-password', required: true });
  const msg = h('div', { 'aria-live': 'assertive' });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, t('auth.inviteSubmit'));
  const form = h('form', { class: 'stack', novalidate: true }, name.wrap, email.wrap, pw.wrap, pw2.wrap, passwordGuide(pw.input, pw2.input), msg, submit);
  layout(app, t('auth.inviteTitle'), t('auth.inviteLead'), form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(msg);
    if (!name.input.value.trim()) { name.setError(fieldErrorText('required')); return name.input.focus(); }
    name.setError(null);
    if ([...pw.input.value].length < 10) { pw.setError(fieldErrorText('password_too_short')); return pw.input.focus(); }
    pw.setError(null);
    if (pw.input.value !== pw2.input.value) { pw2.setError(fieldErrorText('password_mismatch')); return pw2.input.focus(); }
    pw2.setError(null);
    setBusy(submit, true, t('common.saving'));
    try {
      await api.post('/auth/invitation/accept', { token, name: name.input.value.trim(), password: pw.input.value, passwordConfirm: pw2.input.value }, { auth: false });
      const session = await api.get('/auth/session', { auth: false });
      try { sessionStorage.setItem('sensum_after_login', '/'); } catch (x) { /* ignore */ }
      onSignedIn(session);
    } catch (err) {
      setBusy(submit, false);
      if (err.code === 'link_invalid') return invalidLink(app, 'invite');
      if (err.code === 'validation' && applyFieldErrors(err, { name, password: pw, passwordConfirm: pw2 })) return;
      msg.append(alertBox('bad', null, errorText(err)));
    }
  });
}

export function setup({ app, setupRequired, onSignedIn }) {
  if (!setupRequired) {
    layout(app, t('auth.setupTitle'), t('errors.setup_closed'), h('a', { class: 'btn btn-primary btn-block', href: '#/ingresar' }, t('auth.loginTitle')));
    return;
  }
  const token = passwordField({ label: t('auth.setupToken'), hint: t('auth.setupTokenHint'), autocomplete: 'off', required: true });
  const name = textField({ label: t('auth.yourName'), autocomplete: 'name', max: 80, required: true });
  const email = textField({ label: t('auth.email'), type: 'email', autocomplete: 'username', required: true });
  const pw = passwordField({ label: t('auth.newPassword'), autocomplete: 'new-password', required: true });
  const pw2 = passwordField({ label: t('auth.confirmPassword'), autocomplete: 'new-password', required: true });
  const msg = h('div', { 'aria-live': 'assertive' });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, t('auth.setupSubmit'));
  const form = h('form', { class: 'stack', novalidate: true }, token.wrap, name.wrap, email.wrap, pw.wrap, pw2.wrap, passwordGuide(pw.input, pw2.input), msg, submit);
  layout(app, t('auth.setupTitle'), t('auth.setupLead'), form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(msg);
    setBusy(submit, true, t('common.saving'));
    try {
      await api.post('/setup', { setupToken: token.input.value, name: name.input.value.trim(), email: email.input.value.trim(), password: pw.input.value, passwordConfirm: pw2.input.value }, { auth: false });
      onSignedIn(await api.get('/auth/session', { auth: false }));
    } catch (err) {
      setBusy(submit, false);
      if (err.code === 'validation' && applyFieldErrors(err, { setupToken: token, name, email, password: pw, passwordConfirm: pw2 })) return;
      msg.append(alertBox('bad', null, errorText(err)));
    }
  });
}
