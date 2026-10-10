/**
 * Correo — who sends and who receives the site's and the panel's e-mail
 * (owner account only): the public contact form and its spam protection,
 * the panel's sending account (SMTP) and where problem reports and
 * automatic alerts go. Saving asks for the owner's password again; the
 * SMTP password and the Turnstile secret are never sent back to the browser.
 */
import { h, icon, fill } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { pageHead, loading, loadError, button, setBusy, toast, errorText, fieldErrorText, textField, passwordField, alertBox, askPassword, cardHead } from '../ui.js';

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const SOURCE_BADGE = { panel: 'badge-ok', env: 'badge-info', default: 'badge-warn' };

function selectField(id, label, options, value) {
  const el = h('select', { class: 'select', id }, options.map(([v, text]) => h('option', { value: v, text, selected: v === value || null })));
  return { el, wrap: h('div', { class: 'field' }, h('label', { class: 'label', for: id, text: label }), el) };
}

const sourceBadge = (source) => h('span', { class: ['badge', SOURCE_BADGE[source]], title: t('email.source.' + source), text: t('email.sourceShort.' + source) });

/** Collapsible help ("¿Dónde encuentro estos datos?"). */
const helpBox = (summary, ...content) => h('details', { class: 'disclosure help-box' }, h('summary', null, t(summary), icon('chevron-down')), ...content);

function overviewItem(ic, tone, title, detail) {
  return h('div', { class: 'overview-item', role: 'listitem' }, h('span', { class: ['icon-tile', tone] }, icon(ic)),
    h('div', { class: 'grow' }, h('strong', { text: title }), h('span', { text: detail, title: detail })));
}

export async function render({ main, session }) {
  main.append(pageHead({ title: t('email.title'), lead: t('email.lead', { email: session.user.email }) }));
  const body = h('div', { class: 'stack-lg' }, loading());
  main.append(body);
  let alive = true;
  let dirty = () => false;

  const load = async () => {
    let data;
    try { data = await api.get('/settings/email'); } catch (err) { fill(body, loadError(err, load)); return; }
    if (alive) draw(data);
  };

  const draw = (data) => {
    const locked = data.locked;
    const ro = { readOnly: locked };
    const email = (label, value, extra = {}) => textField({ label, value, type: 'email', maxlength: 120, spellcheck: false, autocomplete: 'off', ...ro, ...extra });
    const f = {};

    // ---- state at a glance
    const s = data.smtp;
    const ts = data.turnstile;
    const smtpReady = data.mailDriver === 'smtp' && !!s.host;
    const overview = h('div', { class: 'overview', role: 'list', 'aria-label': t('email.overview.label') },
      overviewItem('envelope', data.contact.configured ? 'ok' : 'warn', t('email.overview.form'),
        data.contact.configured ? t('email.overview.formTo', { to: data.contact.to.join(', ') }) : t('email.overview.formDefault')),
      overviewItem('send', smtpReady ? 'ok' : 'warn', t('email.overview.sending'),
        smtpReady ? s.fromAddress + ' · ' + s.host : t('email.overview.sendingOff')),
      overviewItem('shield-lock', 'ok', t('email.overview.captcha'), ts.active ? t('email.overview.captchaBoth') : t('email.overview.captchaBuiltIn')));

    // ---- contact form
    f['contact.to'] = textField({ label: t('email.contact.to'), hint: t('email.contact.toHint'), value: data.contact.to.join(', '), maxlength: 380, spellcheck: false, ...ro });
    f['contact.to'].wrap.classList.add('span-all');
    f['contact.fromAddress'] = email(t('email.contact.from'), data.contact.fromAddress, { hint: t('email.contact.fromHint') });
    f['contact.fromName'] = textField({ label: t('email.contact.fromName'), value: data.contact.fromName, maxlength: 80, ...ro });
    const method = selectField('contact-method', t('email.contact.method'), [['smtp', t('email.contact.methodSmtp')], ['mail', t('email.contact.methodMail')]], data.contact.method);
    method.el.disabled = locked;
    const testContact = button(t('email.contact.test'), { icon: 'send', small: true });
    testContact.addEventListener('click', () => sendTest(testContact, 'contact'));
    const contactCard = h('section', { class: 'card', 'aria-labelledby': 'em-contact' },
      cardHead({ id: 'em-contact', icon: 'envelope', title: t('email.contact.title'), lead: t('email.contact.lead'), badge: sourceBadge(data.sources.contact) }),
      h('div', { class: 'form-grid' }, f['contact.to'].wrap, f['contact.fromAddress'].wrap, f['contact.fromName'].wrap, method.wrap),
      h('p', { class: 'hint', text: t('email.contact.methodHint') }),
      h('div', { class: 'card-foot' }, h('span', { class: 'tiny muted', text: t('email.testHint') }), testContact));

    // ---- spam protection
    f['contact.turnstileSiteKey'] = textField({ label: t('email.captcha.siteKey'), value: ts.siteKey, maxlength: 100, spellcheck: false, optionalTag: true, ...ro });
    f['contact.turnstileSecret'] = passwordField({ label: t('email.captcha.secret'), hint: ts.secretSet ? t('email.captcha.secretKept') : t('email.captcha.secretHint'), autocomplete: 'new-password', placeholder: ts.secretSet ? '••••••••' : '', ...ro });
    const captchaCard = h('section', { class: 'card', 'aria-labelledby': 'em-captcha' },
      cardHead({ id: 'em-captcha', icon: 'shield-lock', title: t('email.captcha.title'), lead: t('email.captcha.lead'),
        badge: h('span', { class: ['badge', ts.active ? 'badge-ok' : ''], text: t(ts.active ? 'email.captcha.tsOn' : 'email.captcha.tsOff') }) }),
      h('div', { class: 'inline-ok' }, icon('check-circle-fill'), h('div', null, h('strong', { text: t('email.captcha.builtInTitle') }), ' ', t('email.captcha.builtIn'))),
      h('div', { class: 'field-group' },
        h('div', { class: 'subhead' }, h('div', null, h('h3', { text: t('email.captcha.tsTitle') }), h('p', { text: t('email.captcha.tsLead') }))),
        h('div', { class: 'form-grid' }, f['contact.turnstileSiteKey'].wrap, f['contact.turnstileSecret'].wrap),
        helpBox('email.captcha.howKeys', h('ol', null, ['step1', 'step2', 'step3'].map((k) => h('li', { text: t('email.captcha.' + k) }))))));

    // ---- panel's sending account
    f['smtp.fromAddress'] = email(t('email.smtp.from'), s.fromAddress, { hint: t('email.smtp.fromHint') });
    f['smtp.fromName'] = textField({ label: t('email.smtp.fromName'), value: s.fromName, maxlength: 80, ...ro });
    f['smtp.replyTo'] = email(t('email.smtp.replyTo'), s.replyTo, { hint: t('email.smtp.replyToHint'), optionalTag: true });
    f['smtp.host'] = textField({ label: t('email.smtp.host'), value: s.host, maxlength: 253, spellcheck: false, placeholder: 'mail.sensumconstrucciones.com', ...ro });
    f['smtp.port'] = textField({ label: t('email.smtp.port'), value: String(s.port || ''), inputmode: 'numeric', maxlength: 5, ...ro });
    const enc = selectField('smtp-enc', t('email.smtp.encryption'), [['ssl', 'SSL (465)'], ['tls', 'STARTTLS (587)'], ['none', t('email.smtp.encNone')]], s.encryption);
    enc.el.disabled = locked;
    f['smtp.username'] = textField({ label: t('email.smtp.username'), hint: t('email.smtp.usernameHint'), value: s.username, maxlength: 254, spellcheck: false, autocomplete: 'off', ...ro });
    f['smtp.password'] = passwordField({ label: t('email.smtp.password'), hint: s.passwordSet ? t('email.smtp.passwordKept') : t('email.smtp.passwordHint'), autocomplete: 'new-password', placeholder: s.passwordSet ? '••••••••' : '', ...ro });
    const fillBtn = button(t('email.smtp.fill'), { icon: 'lightbulb', small: true, attrs: { disabled: locked || null } });
    fillBtn.addEventListener('click', () => {
      const from = f['smtp.fromAddress'].input.value.trim().toLowerCase();
      const domain = from.includes('@') ? from.split('@')[1] : 'sensumconstrucciones.com';
      f['smtp.host'].input.value = 'mail.' + domain;
      f['smtp.port'].input.value = '465';
      enc.el.value = 'ssl';
      if (!f['smtp.username'].input.value.trim() && from) f['smtp.username'].input.value = from;
      updateDirty();
      toast(t('email.smtp.filled'), { type: 'info' });
      f['smtp.password'].input.focus();
    });
    const testPanel = button(t('email.smtp.test'), { icon: 'send', small: true });
    testPanel.addEventListener('click', () => sendTest(testPanel, 'panel'));
    const smtpCard = h('section', { class: 'card', 'aria-labelledby': 'em-smtp' },
      cardHead({ id: 'em-smtp', icon: 'send', title: t('email.smtp.title'), lead: t('email.smtp.lead'), badge: sourceBadge(data.sources.smtp) }),
      data.mailDriver !== 'smtp' ? alertBox('info', null, t('email.driver.' + data.mailDriver)) : null,
      h('div', { class: 'form-grid' }, f['smtp.fromAddress'].wrap, f['smtp.fromName'].wrap, f['smtp.replyTo'].wrap),
      h('div', { class: 'field-group' },
        h('div', { class: 'subhead' }, h('div', null, h('h3', { text: t('email.smtp.server') }), h('p', { text: t('email.smtp.serverLead') })), fillBtn),
        h('div', { class: 'form-grid' }, f['smtp.host'].wrap, f['smtp.port'].wrap, enc.wrap, f['smtp.username'].wrap, f['smtp.password'].wrap),
        helpBox('email.smtp.where', h('p', { class: 'small muted', text: t('email.smtp.serverHint') }))),
      h('div', { class: 'card-foot' }, h('span', { class: 'tiny muted', text: t('email.testHint') }), testPanel));

    // ---- where notices go
    f.supportEmail = email(t('email.to.support'), data.supportEmail, { hint: t('email.to.supportHint') });
    f.alertEmail = email(t('email.to.alert'), data.alertEmail, { hint: t('email.to.alertHint') });
    const toCard = h('section', { class: 'card', 'aria-labelledby': 'em-to' },
      cardHead({ id: 'em-to', icon: 'bell', title: t('email.to.title'), lead: t('email.to.lead'), badge: sourceBadge(data.sources.alertEmail) }),
      h('div', { class: 'form-grid' }, f.supportEmail.wrap, f.alertEmail.wrap));

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
      if (v.contact.turnstileSiteKey && !v.contact.turnstileSecret && !ts.secretSet) errs['contact.turnstileSecret'] = 'required';
      return errs;
    };

    // ---- save bar: says whether something changed
    const saveBtn = button(t('email.save'), { icon: 'check-lg', variant: 'primary', attrs: { disabled: locked || null } });
    const discardBtn = button(t('email.discard'), { small: true, variant: 'ghost', attrs: { hidden: true } });
    const stateText = h('span', { text: locked ? t('email.locked.short') : t('email.clean') });
    const saveRow = h('div', { class: 'save-row' },
      h('div', { class: 'save-state', 'aria-live': 'polite' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), stateText),
      h('div', { class: 'row' }, discardBtn, saveBtn));
    const initial = JSON.stringify(values());
    dirty = () => !locked && JSON.stringify(values()) !== initial;
    const updateDirty = () => {
      const d = dirty();
      saveRow.classList.toggle('dirty', d);
      discardBtn.hidden = !d;
      stateText.textContent = locked ? t('email.locked.short') : t(d ? 'email.dirty' : 'email.clean');
    };
    discardBtn.addEventListener('click', () => draw(data));

    saveBtn.addEventListener('click', async () => {
      const v = values();
      if (showErrors(check(v))) { toast(t('email.fixErrors'), { type: 'bad' }); return; }
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
      if (dirty()) toast(t('email.testUnsaved'), { type: 'warn' });
      setBusy(btn, true, t('report.sending'));
      try {
        const r = await api.post('/settings/email/test', { target });
        toast(t('email.testSent', { to: r.to.join(', ') }));
      } catch (err) { toast(err.code === 'email_failed' ? t('email.testFailed') : errorText(err), { type: 'bad' }); }
      setBusy(btn, false);
    };

    const form = h('div', { class: 'stack-lg' },
      locked ? alertBox('info', t('email.locked.title'), t('email.locked.body')) : null,
      overview, contactCard, captchaCard, smtpCard, toCard);
    form.addEventListener('input', updateDirty);
    form.addEventListener('change', updateDirty);
    fill(body, form, saveRow);
    updateDirty();
  };

  await load();
  return { destroy: () => { alive = false; }, isDirty: () => dirty() };
}
