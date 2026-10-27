/**
 * Two-step sign-in in the panel: the guided set-up (password → QR code and
 * key → first code → recovery codes) and the small "enter a code" dialog
 * used to change it. Shared by "Mi cuenta" and the required set-up screen.
 */
import { h, icon, fill } from './dom.js';
import { t } from './i18n.js';
import { api, saveBlob } from './api.js';
import { button, setBusy, toast, errorText, fieldErrorText, textField, passwordField, alertBox, openDialog, copyText } from './ui.js';

/** A field for the 6-digit code (or, if allowed, a recovery code). */
export function codeField({ allowRecovery = false, id, hint } = {}) {
  const f = textField({ id, label: t('twofa.codeLabel'), hint: hint || t('twofa.codeHint'), inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, spellcheck: false, placeholder: '123456' });
  f.input.classList.add('code-input');
  let recovery = false;
  const toggle = allowRecovery ? button(t('twofa.useRecovery'), { variant: 'link', small: true }) : null;
  if (toggle) {
    toggle.addEventListener('click', () => {
      recovery = !recovery;
      f.input.value = '';
      f.input.inputMode = recovery ? 'text' : 'numeric';
      f.input.autocomplete = recovery ? 'off' : 'one-time-code';
      f.input.maxLength = recovery ? 11 : 6;
      f.input.placeholder = recovery ? 'ABCDE-FGHIJ' : '123456';
      f.label.lastChild.textContent = t(recovery ? 'twofa.recoveryLabel' : 'twofa.codeLabel');
      toggle.textContent = t(recovery ? 'twofa.useApp' : 'twofa.useRecovery');
      f.setError(null);
      f.input.focus();
    });
  }
  return { ...f, wrap: h('div', { class: 'stack-sm' }, f.wrap, toggle), isRecovery: () => recovery };
}

/** Recovery codes with copy and download, and a confirmation before continuing. */
function recoveryCodes(codes, onDone, doneLabel) {
  const text = t('twofa.codesFileHeader') + '\n\n' + codes.join('\n') + '\n';
  const saved = h('input', { type: 'checkbox', id: 'tf-saved' });
  const cont = button(doneLabel, { variant: 'primary', icon: 'check-lg', attrs: { disabled: true } });
  saved.addEventListener('change', () => { cont.disabled = !saved.checked; });
  cont.addEventListener('click', onDone);
  return h('div', { class: 'stack' },
    alertBox('ok', t('twofa.enabledTitle'), t('twofa.codesLead')),
    h('ol', { class: 'recovery-codes', 'aria-label': t('twofa.codesTitle') }, codes.map((c) => h('li', null, h('code', { text: c })))),
    h('div', { class: 'row' },
      button(t('twofa.copy'), { icon: 'clipboard', small: true, onClick: async () => { if (await copyText(text)) toast(t('common.copied')); } }),
      button(t('twofa.download'), { icon: 'download', small: true, onClick: () => saveBlob(new Blob([text], { type: 'text/plain' }), 'sensum-codigos-recuperacion.txt') })),
    h('label', { class: 'check', for: 'tf-saved' }, saved, h('span', { text: t('twofa.savedCheck') })),
    h('div', null, cont));
}

/**
 * Guided set-up inside `target`. onEnabled() runs after the person confirmed
 * they saved the recovery codes.
 */
export function renderSetup(target, { onEnabled, doneLabel }) {
  // Step 1: password.
  const pw = passwordField({ label: t('common.yourPassword'), autocomplete: 'current-password', required: true });
  const next = button(t('twofa.start'), { variant: 'primary', icon: 'arrow-right', type: 'submit' });
  const step1 = h('form', { class: 'stack', novalidate: true },
    h('ol', { class: 'steps-intro' }, ['step1', 'step2', 'step3'].map((k) => h('li', null, h('strong', { text: t('twofa.intro.' + k + 'Title') }), ' ', t('twofa.intro.' + k)))),
    pw.wrap, h('div', null, next));
  step1.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pw.input.value) { pw.setError(fieldErrorText('required')); pw.input.focus(); return; }
    setBusy(next, true, t('common.saving'));
    try {
      const r = await api.post('/account/2fa/setup', { currentPassword: pw.input.value });
      showQr(r);
    } catch (err) {
      setBusy(next, false);
      if (err.code === 'validation') { pw.setError(fieldErrorText('current_password_wrong')); pw.input.select(); } else toast(errorText(err), { type: 'bad' });
    }
  });

  // Step 2: QR code and first code.
  const showQr = (r) => {
    const code = codeField({ id: 'tf-first' });
    const activate = button(t('twofa.activate'), { variant: 'primary', icon: 'shield-lock', type: 'submit' });
    const form = h('form', { class: 'stack', novalidate: true },
      h('div', { class: 'qr-block' },
        h('img', { class: 'qr', src: r.qr, width: 232, height: 232, alt: t('twofa.qrAlt') }),
        h('div', { class: 'stack-sm' },
          h('p', { class: 'small', text: t('twofa.scan') }),
          h('p', { class: 'tiny muted', text: t('twofa.apps') }),
          h('details', { class: 'disclosure' }, h('summary', null, t('twofa.manual'), icon('chevron-down')),
            h('div', { class: 'code-line' }, h('code', { class: 'break', text: r.secret }),
              button(t('twofa.copyKey'), { icon: 'clipboard', small: true, onClick: async () => { if (await copyText(r.secret.replace(/ /g, ''))) toast(t('common.copied')); } }))))),
      code.wrap, h('div', null, activate));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = code.input.value.trim();
      if (!/^\d{6}$/.test(v)) { code.setError(t('twofa.sixDigits')); code.input.focus(); return; }
      setBusy(activate, true, t('common.saving'));
      try {
        const res = await api.post('/account/2fa/enable', { code: v });
        fill(target, recoveryCodes(res.recoveryCodes, onEnabled, doneLabel || t('twofa.continue')));
      } catch (err) {
        setBusy(activate, false);
        if (err.code === 'validation') { code.setError(t('twofa.wrongCode')); code.input.select(); } else toast(errorText(err), { type: 'bad' });
      }
    });
    code.input.addEventListener('input', () => { if (/^\d{6}$/.test(code.input.value)) form.requestSubmit(); });
    fill(target, form);
    setTimeout(() => code.input.focus(), 60);
  };

  fill(target, step1);
  setTimeout(() => pw.input.focus(), 60);
}

/** Dialog asking for the password and a current code. Resolves { password, code } or null. */
export function confirmWithCode({ title, lead, confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const pw = passwordField({ label: t('common.yourPassword'), autocomplete: 'current-password', required: true });
    const code = codeField({ allowRecovery: true, id: 'tf-confirm' });
    const submit = () => {
      if (!pw.input.value) { pw.setError(fieldErrorText('required')); pw.input.focus(); return; }
      if (!code.input.value.trim()) { code.setError(fieldErrorText('required')); code.input.focus(); return; }
      done = true;
      resolve({ password: pw.input.value, code: code.input.value.trim() });
      dlg.close();
    };
    const dlg = openDialog({
      title, lead, labelledIcon: 'shield-lock',
      body: h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); submit(); } }, pw.wrap, code.wrap),
      onClose: () => { if (!done) resolve(null); },
      actions: [
        { label: t('common.cancel'), onClick: (b, close) => close() },
        { label: confirmLabel, variant: danger ? 'danger' : 'primary', icon: 'check-lg', onClick: () => submit() },
      ],
    });
    setTimeout(() => pw.input.focus(), 60);
  });
}

export { recoveryCodes };
