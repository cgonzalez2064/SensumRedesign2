/**
 * Correo — who sends and who receives the site's and the panel's e-mail
 * (owner account only): the public contact form, the panel's sending
 * account (SMTP) and where problem reports and automatic alerts go.
 * Saving asks for the owner's password again; the SMTP password is never
 * sent back to the browser.
 */
import { h, icon, clear } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { pageHead, loading, loadError, button, setBusy, toast, errorText, fieldErrorText, textField, passwordField, alertBox, askPassword } from '../ui.js';

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function card(id, title, ...children) {
  return h('section', { class: 'card', 'aria-labelledby': id }, h('div', { class: 'card-header' }, h('h2', { id, text: title })), ...children);
}

function selectField(id, label, options, value, hint) {
  const el = h('select', { class: 'select', id, 'aria-describedby': hint ? id + '-hint' : null },
    options.map(([v, text]) => h('option', { value: v, text, selected: v === value || null })));
  return { el, wrap: h('div', { class: 'field' }, h('label', { class: 'label', for: id, text: label }), el,
    hint ? h('div', { class: 'field-foot' }, h('span', { class: 'hint', id: id + '-hint', text: hint })) : null) };
}

function sourceNote(source) {
  return h('p', { class: 'tiny muted' }, icon(source === 'panel' ? 'check-circle-fill' : 'info-circle-fill'), ' ', t('email.source.' + source));
}

export async function render({ main, session }) {
  main.append(pageHead({ title: t('email.title'), lead: t('email.lead', { email: session.user.email }) }));
  const body = h('div', { class: 'stack-lg' }, loading());
  main.append(body);
  let alive = true;

  const load = async () => {
    let data;
    try { data = await api.get('/settings/email'); } catch (err) { clear(body).append(loadError(err, load)); return; }
    if (!alive) return;
    draw(data);
  };

  const draw = (data) => {
    const locked = data.locked;
    const ro = { readOnly: locked };
    const f = {};

    // ---- contact form
    f['contact.to'] = textField({ label: t('email.contact.to'), hint: t('email.contact.toHint'), value: data.contact.to.join(', '), max: 380, autocomplete: 'off', spellcheck: false, ...ro });
    f['contact.fromAddress'] = textField({ label: t('email.contact.from'), hint: t('email.contact.fromHint'), value: data.contact.fromAddress, type: 'email', max: 120, spellcheck: false, ...ro });
    f['contact.fromName'] = textField({ label: t('email.contact.fromName'), value: data.contact.fromName, max: 80, ...ro });
    const method = selectField('contact-method', t('email.contact.method'), [['smtp', t('email.contact.methodSmtp')], ['mail', t('email.contact.methodMail')]], data.contact.method, t('email.contact.methodHint'));
    method.el.disabled = locked;
    // Anti-spam: the built-in captcha is always on; Cloudflare Turnstile is optional.
    const ts = data.turnstile;
    f['contact.turnstileSiteKey'] = textField({ label: t('email.captcha.siteKey'), value: ts.siteKey, max: 100, spellcheck: false, optionalTag: true, ...ro });
    f['contact.turnstileSecret'] = passwordField({ label: t('email.captcha.secret'), hint: ts.secretSet ? t('email.captcha.secretKept') : t('email.captcha.secretHint'), autocomplete: 'new-password', placeholder: ts.secretSet ? '••••••••' : '', ...ro });
    const captchaBox = h('div', null,
      h('h3', { class: 'h-sub', text: t('email.captcha.title') }),
      h('p', { class: 'small ok-text' }, icon('check-circle-fill'), ' ', t('email.captcha.builtIn')),
      h('p', { class: 'small' }, h('span', { class: ['badge', ts.active ? 'badge-ok' : 'badge'], text: t(ts.active ? 'email.captcha.tsOn' : 'email.captcha.tsOff') }), ' ', t('email.captcha.tsLead')),
      h('ol', { class: 'small muted steps' }, ['step1', 'step2', 'step3'].map((k) => h('li', { text: t('email.captcha.' + k) }))),
      h('div', { class: 'form-grid' }, f['contact.turnstileSiteKey'].wrap, f['contact.turnstileSecret'].wrap));
    const testContact = button(t('email.contact.test'), { icon: 'send', small: true });
    testContact.addEventListener('click', () => sendTest(testContact, 'contact'));
    const contactCard = card('em-contact', t('email.contact.title'),
      h('p', { class: 'small muted', text: t('email.contact.lead') }),
      sourceNote(data.sources.contact),
      h('div', { class: 'form-grid' }, f['contact.to'].wrap, f['contact.fromAddress'].wrap, f['contact.fromName'].wrap, method.wrap),
      h('div', { class: 'row' }, testContact, h('span', { class: 'tiny muted', text: t('email.testHint') })),
      captchaBox);

    // ---- panel's sending account
    const s = data.smtp;
    f['smtp.fromAddress'] = textField({ label: t('email.smtp.from'), hint: t('email.smtp.fromHint'), value: s.fromAddress, type: 'email', max: 120, spellcheck: false, ...ro });
    f['smtp.fromName'] = textField({ label: t('email.smtp.fromName'), value: s.fromName, max: 80, ...ro });
    f['smtp.replyTo'] = textField({ label: t('email.smtp.replyTo'), hint: t('email.smtp.replyToHint'), value: s.replyTo, type: 'email', max: 120, optionalTag: true, spellcheck: false, ...ro });
    f['smtp.host'] = textField({ label: t('email.smtp.host'), value: s.host, max: 253, spellcheck: false, placeholder: 'mail.sensumconstrucciones.com', ...ro });
    f['smtp.port'] = textField({ label: t('email.smtp.port'), value: String(s.port || ''), inputmode: 'numeric', max: 5, ...ro });
    const enc = selectField('smtp-enc', t('email.smtp.encryption'), [['ssl', 'SSL (465)'], ['tls', 'STARTTLS (587)'], ['none', t('email.smtp.encNone')]], s.encryption);
    enc.el.disabled = locked;
    f['smtp.username'] = textField({ label: t('email.smtp.username'), hint: t('email.smtp.usernameHint'), value: s.username, max: 254, spellcheck: false, autocomplete: 'off', ...ro });
    f['smtp.password'] = passwordField({ label: t('email.smtp.password'), hint: s.passwordSet ? t('email.smtp.passwordKept') : t('email.smtp.passwordHint'), autocomplete: 'new-password', placeholder: s.passwordSet ? '••••••••' : '', ...ro });
    const fillBtn = button(t('email.smtp.fill'), { icon: 'lightbulb', small: true, attrs: { disabled: locked || null } });
    fillBtn.addEventListener('click', () => {
      const from = f['smtp.fromAddress'].input.value.trim().toLowerCase();
      const domain = from.includes('@') ? from.split('@')[1] : 'sensumconstrucciones.com';
      f['smtp.host'].input.value = 'mail.' + domain;
      f['smtp.port'].input.value = '465';
      enc.el.value = 'ssl';
      if (!f['smtp.username'].input.value.trim() && from) f['smtp.username'].input.value = from;
      toast(t('email.smtp.filled'), { type: 'info' });
    });
    const testPanel = button(t('email.smtp.test'), { icon: 'send', small: true });
    testPanel.addEventListener('click', () => sendTest(testPanel, 'panel'));
    const smtpCard = card('em-smtp', t('email.smtp.title'),
      h('p', { class: 'small muted', text: t('email.smtp.lead') }),
      sourceNote(data.sources.smtp),
      data.mailDriver !== 'smtp' ? alertBox('info', null, t('email.driver.' + data.mailDriver)) : null,
      h('div', { class: 'form-grid' }, f['smtp.fromAddress'].wrap, f['smtp.fromName'].wrap, f['smtp.replyTo'].wrap),
      h('h3', { class: 'h-sub', text: t('email.smtp.server') }),
      h('p', { class: 'small muted', text: t('email.smtp.serverHint') }),
      h('div', { class: 'form-grid' }, f['smtp.host'].wrap, f['smtp.port'].wrap, enc.wrap, f['smtp.username'].wrap, f['smtp.password'].wrap),
      h('div', { class: 'row' }, fillBtn, testPanel, h('span', { class: 'tiny muted', text: t('email.testHint') })));

    // ---- where reports and alerts go
    f.supportEmail = textField({ label: t('email.to.support'), hint: t('email.to.supportHint'), value: data.supportEmail, type: 'email', max: 120, spellcheck: false, ...ro });
    f.alertEmail = textField({ label: t('email.to.alert'), hint: t('email.to.alertHint'), value: data.alertEmail, type: 'email', max: 120, spellcheck: false, ...ro });
    const toCard = card('em-to', t('email.to.title'),
      h('p', { class: 'small muted', text: t('email.to.lead') }),
      h('div', { class: 'form-grid' }, f.supportEmail.wrap, f.alertEmail.wrap));

    const saveBtn = button(t('email.save'), { icon: 'check-lg', variant: 'primary', attrs: { disabled: locked || null } });
    const values = () => ({
      smtp: {
        host: f['smtp.host'].input.value.trim(), port: f['smtp.port'].input.value.trim(), encryption: enc.el.value,
        username: f['smtp.username'].input.value.trim(), password: f['smtp.password'].input.value,
        fromAddress: f['smtp.fromAddress'].input.value.trim(), fromName: f['smtp.fromName'].input.value.trim(), replyTo: f['smtp.replyTo'].input.value.trim(),
      },
      supportEmail: f.supportEmail.input.value.trim(),
      alertEmail: f.alertEmail.input.value.trim(),
      contact: {
        to: f['contact.to'].input.value.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean),
        fromAddress: f['contact.fromAddress'].input.value.trim(), fromName: f['contact.fromName'].input.value.trim(), method: method.el.value,
        turnstileSiteKey: f['contact.turnstileSiteKey'].input.value.trim(), turnstileSecret: f['contact.turnstileSecret'].input.value.trim(),
      },
    });
    const showErrors = (fields) => {
      let first = null;
      for (const [k, field] of Object.entries(f)) {
        const code = fields[k];
        field.setError(code ? fieldErrorText(code === 'invalid' && k === 'contact.to' ? 'contact_to' : code) : null);
        if (code && !first) first = field.input;
      }
      if (first) first.focus();
      return !!first;
    };
    const check = (v) => {
      const errs = {};
      for (const k of ['smtp.fromAddress', 'supportEmail', 'alertEmail', 'contact.fromAddress']) {
        const val = k.includes('.') ? v[k.split('.')[0]][k.split('.')[1]] : v[k];
        if (!EMAIL_RE.test(val)) errs[k] = 'invalid_email';
      }
      if (v.smtp.replyTo && !EMAIL_RE.test(v.smtp.replyTo)) errs['smtp.replyTo'] = 'invalid_email';
      if (!v.smtp.host) errs['smtp.host'] = 'required';
      if (!/^\d{1,5}$/.test(v.smtp.port)) errs['smtp.port'] = 'invalid';
      if (!v.contact.to.length || v.contact.to.length > 3 || v.contact.to.some((x) => !EMAIL_RE.test(x))) errs['contact.to'] = 'invalid';
      if (!v.smtp.fromName) errs['smtp.fromName'] = 'required';
      if (!v.contact.fromName) errs['contact.fromName'] = 'required';
      if (v.contact.turnstileSiteKey && !/^[0-9A-Za-z_-]{10,100}$/.test(v.contact.turnstileSiteKey)) errs['contact.turnstileSiteKey'] = 'invalid';
      if (v.contact.turnstileSiteKey && !v.contact.turnstileSecret && !data.turnstile.secretSet) errs['contact.turnstileSecret'] = 'required';
      return errs;
    };
    saveBtn.addEventListener('click', async () => {
      const v = values();
      if (showErrors(check(v))) return;
      const password = await askPassword({ title: t('email.confirm.title'), lead: t('email.confirm.lead'), confirmLabel: t('email.save') });
      if (password === null) return;
      setBusy(saveBtn, true, t('email.saving'));
      try {
        const r = await api.put('/settings/email', { ...v, currentPassword: password });
        toast(r.changed.length ? t('email.saved') : t('email.savedNoChange'));
        if (r.republished === true) toast(t('email.captcha.published'), { type: 'info' });
        if (r.republished === false) toast(t('email.captcha.publishFailed'), { type: 'warn' });
        draw(r.settings);
        return;
      } catch (err) {
        if (err.code === 'validation') {
          if (err.fields.currentPassword) toast(fieldErrorText('current_password_wrong'), { type: 'bad' });
          else { showErrors(err.fields); toast(t('email.fixErrors'), { type: 'bad' }); }
        } else toast(errorText(err, { preserved: true }), { type: 'bad' });
      }
      setBusy(saveBtn, false);
    });

    const sendTest = async (btn, target) => {
      setBusy(btn, true, t('report.sending'));
      try {
        const r = await api.post('/settings/email/test', { target });
        toast(t('email.testSent', { to: r.to.join(', ') }));
      } catch (err) { toast(err.code === 'email_failed' ? t('email.testFailed') : errorText(err), { type: 'bad' }); }
      setBusy(btn, false);
    };

    clear(body).append(
      locked ? alertBox('info', t('email.locked.title'), t('email.locked.body')) : null,
      alertBox('info', t('email.howTitle'), t('email.howBody')),
      contactCard, smtpCard, toCard,
      h('div', { class: 'row-between save-row' }, h('span', { class: 'small muted', text: locked ? t('email.locked.short') : t('email.saveHint') }), saveBtn));
  };

  await load();
  return { destroy: () => { alive = false; } };
}
