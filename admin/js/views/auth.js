/** Sign-in, password recovery, invitation, first-time setup and the first-sign-in welcome screens. */
import { h, icon, clear, fill } from '../dom.js';
import { t, getLang, setLang } from '../i18n.js';
import { getThemePref, setThemePref } from '../theme.js';
import { api, setCsrf } from '../api.js';
import { textField, passwordField, passwordGuide, alertBox, errorText, fieldErrorText, setBusy, toast, button } from '../ui.js';
import { themeSwitch, langSwitch } from '../app.js';
import { codeField, renderSetup } from '../twofactor.js';

/** Common auth layout: centered card + theme/language switches. */
function layout(app, title, lead, ...content) {
  const h1 = h('h1', { tabindex: '-1', text: title });
  const card = h('div', { class: 'auth-card' },
    h('div', { class: 'auth-brand' }, h('img', { src: '../assets/logo-icon.png', alt: '', width: 46, height: 46 }),
      h('div', null, h('strong', { text: t('app.brand') }), h('span', { text: t('app.name') }))),
    h1, lead ? h('p', { class: 'lead', text: lead }) : null, ...content);
  fill(app, 
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
      if (data.twoFactor) { secondStep(app, data.challenge, onSignedIn, !!data.rememberAllowed, data.method === 'email' ? data.sentTo : null); return; }
      onSignedIn(data);
    } catch (err) {
      setBusy(submit, false);
      msg.append(alertBox('bad', null, errorText(err)));
      pw.input.value = '';
      pw.input.focus();
    }
  });
}

/**
 * Second step of the sign-in: the code from the authenticator app (or a recovery
 * code) — or, after «Quitar dispositivos registrados», a code sent to the e-mail.
 */
function secondStep(app, challenge, onSignedIn, rememberAllowed = false, sentTo = null) {
  const byEmail = !!sentTo;
  const code = codeField({ allowRecovery: !byEmail, id: 'login-code', hint: byEmail ? t('twofa.emailCodeHint') : null });
  if (byEmail) code.input.setAttribute('aria-describedby', 'login-code-sent');
  const msg = h('div', { 'aria-live': 'assertive' });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, icon('shield-lock'), t('twofa.verify'));
  // Seguridad allows it: this browser skips the code for 30 days (not on a shared computer).
  const remember = rememberAllowed ? h('label', { class: 'check check-help' }, h('input', { type: 'checkbox', id: 'login-remember' }),
    h('span', null, h('span', { class: 'check-title', text: t('twofa.rememberDevice') }), h('span', { class: 'tiny muted check-hint', text: t('twofa.rememberDeviceHint') }))) : null;
  // «Reenviar código»: a new code by e-mail (three at most); the previous one stops working.
  const sentNote = byEmail ? h('p', { class: 'small muted', id: 'login-code-sent', text: t('twofa.emailSent', { email: sentTo, minutes: 10 }) }) : null;
  const resend = byEmail ? button(t('twofa.resend'), { variant: 'link', small: true, onClick: async () => {
    setBusy(resend, true, t('twofa.resending'));
    try {
      const r = await api.post('/auth/login/2fa/resend', { challenge }, { auth: false });
      setBusy(resend, false);
      code.input.value = '';
      code.setError(null);
      toast(t('twofa.resent', { email: r.sentTo }));
      code.input.focus();
    } catch (err) {
      setBusy(resend, false);
      if (err.code === 'two_factor_expired') { login({ app, onSignedIn }); toast(t('twofa.expired'), { type: 'warn' }); return; }
      if (err.code === 'too_many_attempts') resend.hidden = true;
      clear(msg);
      msg.append(alertBox('bad', null, err.code === 'too_many_attempts' ? t('twofa.resendLimit') : errorText(err)));
    }
  } }) : null;
  const form = h('form', { class: 'stack', novalidate: true }, sentNote, code.wrap, remember, msg, submit,
    h('p', { class: 'small row-between' }, h('a', { href: '#/ingresar', onclick: (e) => { e.preventDefault(); login({ app, onSignedIn }); }, text: t('twofa.backToPassword') }), resend));
  layout(app, t(byEmail ? 'twofa.emailTitle' : 'twofa.loginTitle'), t(byEmail ? 'twofa.emailLead' : 'twofa.loginLead'), form);
  setTimeout(() => code.input.focus(), 50);
  const send = async () => {
    const v = code.input.value.trim();
    if (!v) { code.setError(fieldErrorText('required')); code.input.focus(); return; }
    clear(msg);
    setBusy(submit, true, t('auth.submitting'));
    try {
      onSignedIn(await api.post('/auth/login/2fa', { challenge, code: v, remember: !!(remember && remember.firstChild.checked) }, { auth: false }));
    } catch (err) {
      setBusy(submit, false);
      if (err.code === 'two_factor_expired') {
        login({ app, onSignedIn });
        toast(t('twofa.expired'), { type: 'warn' });
        return;
      }
      const left = err.data && typeof err.data.attemptsLeft === 'number' ? err.data.attemptsLeft : null;
      code.setError(err.code === 'validation' ? (left !== null ? t('twofa.wrongCodeLeft', { n: left }) : t('twofa.wrongCode')) : errorText(err));
      code.input.select();
    }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
  code.input.addEventListener('input', () => { if (!code.isRecovery() && /^\d{6}$/.test(code.input.value)) send(); });
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
      fill(card, h('div', { class: 'empty' }, h('span', { class: 'icon-tile' }, icon('envelope')),
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
  layout(app, t('auth.checking'), null, h('div', { class: 'row', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' })));
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
      fill(card, h('div', { class: 'empty' }, h('span', { class: 'icon-tile' }, icon('check-circle-fill')),
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

/**
 * Required two-step set-up: the policy covers this account and it isn't set up
 * yet, or its devices were removed and the e-mail code was confirmed (reenroll).
 */
export function enroll({ app, onDone, onLogout, reenroll = false }) {
  const box = h('div');
  layout(app, t(reenroll ? 'twofa.newDeviceTitle' : 'twofa.requiredTitle'), t(reenroll ? 'twofa.newDeviceLead' : 'twofa.requiredLead'), box,
    h('p', { class: 'small auth-alt' }, h('a', { href: '#/ingresar', onclick: (e) => { e.preventDefault(); onLogout(); }, text: t('topbar.logout') })));
  renderSetup(box, { onEnabled: onDone, doneLabel: t('twofa.goToPanel') });
}

/**
 * Signed in with a password someone else gave the account (Usuarios): before
 * anything else, the person creates a password only they know.
 */
export function changePassword({ app, onDone, onLogout }) {
  const current = passwordField({ label: t('auth.tempPassword'), autocomplete: 'current-password', required: true });
  const pw = passwordField({ label: t('auth.newPassword'), autocomplete: 'new-password', required: true });
  const pw2 = passwordField({ label: t('auth.confirmPassword'), autocomplete: 'new-password', required: true });
  const msg = h('div', { 'aria-live': 'assertive' });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, t('auth.mustChangeSubmit'));
  const form = h('form', { class: 'stack', novalidate: true }, current.wrap, pw.wrap, pw2.wrap, passwordGuide(pw.input, pw2.input), msg, submit);
  layout(app, t('auth.mustChangeTitle'), t('auth.mustChangeLead'), form,
    h('p', { class: 'small auth-alt' }, h('a', { href: '#/ingresar', onclick: (e) => { e.preventDefault(); onLogout(); }, text: t('topbar.logout') })));
  setTimeout(() => current.input.focus(), 60);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(msg);
    if (!current.input.value) { current.setError(fieldErrorText('required')); return current.input.focus(); }
    current.setError(null);
    if ([...pw.input.value].length < 10) { pw.setError(fieldErrorText('password_too_short')); return pw.input.focus(); }
    pw.setError(null);
    if (pw.input.value !== pw2.input.value) { pw2.setError(fieldErrorText('password_mismatch')); return pw2.input.focus(); }
    pw2.setError(null);
    setBusy(submit, true, t('common.saving'));
    try {
      const r = await api.post('/account/password', { currentPassword: current.input.value, password: pw.input.value, passwordConfirm: pw2.input.value });
      if (r.csrf) setCsrf(r.csrf);
      toast(t('account.passwordChanged'));
      onDone();
    } catch (err) {
      setBusy(submit, false);
      if (err.code === 'validation' && applyFieldErrors(err, { currentPassword: current, password: pw, passwordConfirm: pw2 })) return;
      msg.append(alertBox('bad', null, errorText(err)));
    }
  });
}

// ------------------------------------------------------------------ first sign-in

/** Which option keeps the keyboard focus when the screen is redrawn in the other language. */
let welcomeFocus = null;

/**
 * First sign-in (once): the language of the panel (and of its e-mails) and the
 * appearance. Both apply at once as a preview; «Guardar y continuar» stores
 * them in the account. Automático (like the device) is the default appearance.
 */
export function welcome({ app, user, onDone }) {
  const lang = getLang();
  const theme = getThemePref();
  const first = String(user.name || '').trim().split(' ')[0] || user.name;
  const h1 = h('h1', { tabindex: '-1', text: t('welcome.title', { name: first }) });
  const check = () => icon('check-circle-fill', 'opt-check');
  const langOption = (value, badge, name, hint) => h('label', { class: 'welcome-option', id: 'opt-' + value },
    h('input', { type: 'radio', name: 'w-lang', value, checked: value === lang || null }),
    h('span', { class: 'opt-badge', 'aria-hidden': 'true', text: badge }),
    h('span', { class: 'opt-text' }, h('strong', { text: name }), h('small', { text: hint })), check());
  const mini = (tone) => h('span', { class: 'tp tp-' + tone, 'aria-hidden': 'true' },
    h('span', { class: 'tp-side' }, h('i'), h('i'), h('i')), h('span', { class: 'tp-main' }, h('i', { class: 'w60' }), h('i', { class: 'card' }), h('i', { class: 'w40' })));
  const themeOption = (value, ic, preview) => h('label', { class: 'welcome-option theme', id: 'opt-' + value },
    h('input', { type: 'radio', name: 'w-theme', value, checked: value === theme || null }), preview,
    h('span', { class: 'theme-name' }, icon(ic), h('span', null, h('span', { text: t('welcome.' + value) }), h('small', { text: t('welcome.' + value + 'Hint') }))), check());
  const save = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, h('span', { text: t('welcome.go') }), icon('chevron-right'));
  const msg = h('div', { 'aria-live': 'assertive' });
  const form = h('form', { class: 'welcome-form', novalidate: true },
    h('fieldset', { class: 'fieldset-reset welcome-group' },
      h('legend', { class: 'welcome-legend' }, icon('translate'), h('span', { text: t('welcome.langTitle') })),
      h('p', { class: 'welcome-hint', text: t('welcome.langHint') }),
      h('div', { class: 'welcome-options two' }, langOption('es', 'ES', 'Español', t('welcome.esHint')), langOption('en', 'EN', 'English', t('welcome.enHint')))),
    h('fieldset', { class: 'fieldset-reset welcome-group' },
      h('legend', { class: 'welcome-legend' }, icon('circle-half'), h('span', { text: t('welcome.themeTitle') })),
      h('p', { class: 'welcome-hint', text: t('welcome.themeHint') }),
      h('div', { class: 'welcome-options three' },
        themeOption('light', 'sun', mini('light')),
        themeOption('dark', 'moon-stars', mini('dark')),
        themeOption('system', 'circle-half', h('span', { class: 'tp-auto', 'aria-hidden': 'true' }, mini('light'), mini('dark'))))),
    msg,
    h('div', { class: 'welcome-actions' }, save, h('p', { class: 'welcome-note', text: t('welcome.note') })));
  const card = h('div', { class: 'auth-card' },
    h('div', { class: 'auth-brand' }, h('img', { src: '../assets/logo-icon.png', alt: '', width: 46, height: 46 }),
      h('div', null, h('strong', { text: t('app.brand') }), h('span', { text: t('app.name') }))),
    h('p', { class: 'welcome-eyebrow' }, icon('star-fill'), h('span', { text: t('welcome.eyebrow') })),
    h1, h('p', { class: 'lead', text: t('welcome.lead') }), form);
  fill(app, h('main', { class: 'auth welcome', id: 'main' }, h('div', { class: 'stack' }, card)));
  document.title = t('welcome.eyebrow') + ' · ' + t('app.name');

  // Preview: the language redraws the screen (keeping the focus on the option); the theme applies at once.
  form.querySelectorAll('input[name="w-lang"]').forEach((i) => i.addEventListener('change', () => { welcomeFocus = 'opt-' + i.value; setLang(i.value); }));
  form.querySelectorAll('input[name="w-theme"]').forEach((i) => i.addEventListener('change', () => setThemePref(i.value)));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(msg);
    setBusy(save, true, t('common.saving'));
    try {
      const r = await api.put('/account/welcome', { lang: getLang(), theme: getThemePref() });
      onDone(r.user);
    } catch (err) {
      setBusy(save, false);
      msg.append(alertBox('bad', null, errorText(err)));
    }
  });
  const keep = welcomeFocus && document.querySelector('#' + welcomeFocus + ' input');
  welcomeFocus = null;
  (keep || h1).focus();
}

