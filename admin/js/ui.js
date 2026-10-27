/** Shared interface components. Everything renders text with textContent. */
import { h, icon, clear, nextId, fill } from './dom.js';
import { t } from './i18n.js';

// ---------------------------------------------------------------- toasts
export function toast(message, { type = 'ok', action = null, duration } = {}) {
  const region = document.getElementById('toasts');
  if (!region) return;
  const iconName = type === 'bad' ? 'x-circle-fill' : type === 'warn' ? 'exclamation-triangle-fill' : type === 'info' ? 'info-circle-fill' : 'check-circle-fill';
  const close = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  };
  const el = h('div', { class: ['toast', type], role: type === 'bad' ? 'alert' : 'status' },
    icon(iconName),
    h('div', { class: 'grow' },
      h('div', { text: message }),
      action ? (action.href
        ? h('a', { href: action.href, target: action.external ? '_blank' : null, rel: action.external ? 'noopener' : null, text: action.label })
        : h('button', { class: 'toast-action', type: 'button', text: action.label, onclick: () => { action.onClick(); close(); } })) : null),
    h('button', { class: 'toast-close', type: 'button', 'aria-label': t('common.close'), onclick: close }, icon('x-lg')));
  region.appendChild(el);
  const ms = duration ?? (type === 'bad' ? 10000 : 5000);
  if (ms > 0) setTimeout(close, ms);
}

// ---------------------------------------------------------------- errors
/** Friendly text for an API error (what happened + changes preserved + reference). */
export function errorText(err, { preserved = false } = {}) {
  const code = err && err.code ? err.code : 'unknown';
  const parts = [];
  const base = t('errors.' + code);
  parts.push(base.startsWith('errors.') ? t('errors.unknown') : base);
  if (preserved && !['invalid_credentials', 'too_many_attempts', 'validation'].includes(code)) parts.push(t('errors.preserved'));
  if (err && err.data && err.data.ref) parts.push(t('errors.reference', { ref: err.data.ref }));
  return parts.join(' ');
}

export function fieldErrorText(code, params = {}) {
  const v = t('fieldErrors.' + code, params);
  return v.startsWith('fieldErrors.') ? t('fieldErrors.invalid') : v;
}

// ---------------------------------------------------------------- dialogs
/**
 * Native <dialog> (focus trap, Esc and inert background are built in).
 * Returns { el, body, close }.
 */
export function openDialog({ title, lead, body, actions = [], wide = false, dismissible = true, onClose, labelledIcon } = {}) {
  const titleId = nextId('dlg');
  // Where focus goes back on close: what opened it, or — when that was in a dialog
  // that has closed meanwhile — what opened that one.
  const opener = document.activeElement;
  const openerDialog = opener && opener.closest ? opener.closest('dialog') : null;
  const fallback = openerDialog ? openerDialog.focusBack : null;
  const foot = actions.length ? h('div', { class: 'dialog-foot' }) : null;
  const bodyEl = h('div', { class: 'dialog-body' }, body);
  const dlg = h('dialog', { class: ['dialog', wide && 'wide'], 'aria-labelledby': titleId },
    h('div', { class: 'dialog-head' },
      labelledIcon ? h('span', { class: 'icon-tile' }, icon(labelledIcon)) : null,
      h('div', { class: 'grow' }, h('h2', { id: titleId, text: title }), lead ? h('p', { text: lead }) : null),
      dismissible ? h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', 'aria-label': t('common.close'), onclick: () => close() }, icon('x-lg')) : null),
    bodyEl,
    foot);
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    const done = () => { dlg.close(); dlg.remove(); restoreFocus(opener, fallback); if (onClose) onClose(result); };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
    dlg.classList.add('closing');
    setTimeout(done, 190);
  };
  for (const a of actions) {
    const btn = h('button', { type: 'button', class: ['btn', a.variant ? 'btn-' + a.variant : ''], onclick: () => a.onClick ? a.onClick(btn, close) : close() },
      a.icon ? icon(a.icon) : null, a.label);
    if (a.autofocus) btn.setAttribute('autofocus', '');
    foot.appendChild(btn);
  }
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (dismissible) close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg && dismissible) close(); });
  dlg.focusBack = openerDialog ? fallback : opener;
  document.body.appendChild(dlg);
  dlg.showModal();
  return { el: dlg, body: bodyEl, foot, close };
}

/**
 * Focus back on the control that opened a dialog. A list drawn again meanwhile has a
 * new copy of it: the visible element with the same data-focus-key.
 */
function restoreFocus(...candidates) {
  const now = document.activeElement;
  if (now && now !== document.body) return; // something else already has it (another dialog)
  for (const el of candidates) {
    if (!el || el === document.body || !el.focus) continue;
    if (el.isConnected) { el.focus(); return; }
    const key = el.dataset && el.dataset.focusKey;
    const twin = key && [...document.querySelectorAll('[data-focus-key]')].find((x) => x.dataset.focusKey === key && x.offsetParent !== null);
    if (twin) { twin.focus(); return; }
  }
}

/** Promise<boolean> confirmation dialog. */
export function confirmDialog({ title, body, confirmLabel, danger = false, cancelLabel }) {
  return new Promise((resolve) => {
    let answered = false;
    openDialog({
      title,
      body: h('p', { class: 'muted', text: body }),
      onClose: () => { if (!answered) resolve(false); },
      actions: [
        { label: cancelLabel || t('common.cancel'), autofocus: true, onClick: (b, close) => close() },
        { label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: (b, close) => { answered = true; resolve(true); close(); } },
      ],
    });
  });
}

/**
 * Asks for the person's password again before a sensitive change.
 * Resolves with the password, or null if cancelled.
 */
export function askPassword({ title, lead, confirmLabel }) {
  return new Promise((resolve) => {
    let done = false;
    const pw = passwordField({ label: t('common.yourPassword'), autocomplete: 'current-password', required: true });
    const submit = () => {
      if (!pw.input.value) { pw.setError(fieldErrorText('required')); pw.input.focus(); return; }
      done = true;
      resolve(pw.input.value);
      dlg.close();
    };
    const dlg = openDialog({
      title, lead, labelledIcon: 'shield-lock',
      body: h('form', { onsubmit: (e) => { e.preventDefault(); submit(); } }, pw.wrap),
      onClose: () => { if (!done) resolve(null); },
      actions: [
        { label: t('common.cancel'), onClick: (b, close) => close() },
        { label: confirmLabel, variant: 'primary', icon: 'check-lg', onClick: () => submit() },
      ],
    });
    setTimeout(() => pw.input.focus(), 50);
  });
}

// ---------------------------------------------------------------- buttons
const busyContent = new WeakMap();
/** Shows a spinner + label while an action runs; setBusy(btn, false) restores it. */
export function setBusy(btn, busy, busyLabel) {
  if (busy) {
    if (!busyContent.has(btn)) busyContent.set(btn, [...btn.childNodes]);
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    fill(btn, h('span', { class: 'spinner', 'aria-hidden': 'true' }), busyLabel || btn.textContent);
  } else {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    if (busyContent.has(btn)) {
      fill(btn, ...busyContent.get(btn));
      busyContent.delete(btn);
    }
  }
}

export function button(label, { icon: ic, variant, onClick, type = 'button', small, attrs = {} } = {}) {
  return h('button', { type, class: ['btn', variant && 'btn-' + variant, small && 'btn-sm'], onclick: onClick, ...attrs }, ic ? icon(ic) : null, label);
}

// ---------------------------------------------------------------- fields
/**
 * Text field with label, hint, counter and inline error.
 * opts: { label, hint, value, type, required, max, autocomplete, placeholder, multiline, rows, optionalTag, inputmode, readOnly }
 */
export function textField(opts) {
  const id = opts.id || nextId('in');
  const hintId = id + '-hint';
  const errId = id + '-err';
  const tag = opts.multiline ? 'textarea' : 'input';
  const input = h(tag, {
    id, class: opts.multiline ? 'textarea' : 'input', name: opts.name || null,
    type: opts.multiline ? null : (opts.type || 'text'), value: opts.value ?? '', placeholder: opts.placeholder || null,
    autocomplete: opts.autocomplete || 'off', required: opts.required || null, inputmode: opts.inputmode || null,
    rows: opts.rows || null, readOnly: opts.readOnly || false, spellcheck: opts.spellcheck === false ? 'false' : null,
    maxlength: opts.maxlength || null,
    'aria-describedby': [opts.hint ? hintId : '', errId].filter(Boolean).join(' '),
    lang: opts.lang || null,
  });
  if (opts.multiline) input.value = opts.value ?? '';
  const error = h('div', { class: 'field-error', id: errId, hidden: true });
  const counter = opts.max ? h('span', { class: 'counter', 'aria-hidden': 'true' }) : null;
  const updateCounter = () => {
    if (!counter) return;
    const len = opts.countFn ? opts.countFn(input.value) : [...input.value].length;
    counter.textContent = t('common.counter', { n: len, max: opts.max });
    counter.classList.toggle('near', len > opts.max * 0.9 && len <= opts.max);
    counter.classList.toggle('over', len > opts.max);
  };
  input.addEventListener('input', updateCounter);
  updateCounter();
  const label = h('label', { class: 'label', for: id, id: id + '-label' },
    opts.langTag ? h('span', { class: 'lang-tag', 'aria-hidden': 'true', text: opts.langTag }) : null,
    opts.label,
    opts.optionalTag ? h('span', { class: 'opt', text: ' (' + t('common.optional') + ')' }) : null);
  const wrap = h('div', { class: 'field' },
    label,
    opts.prefix || null,
    opts.wrapInput ? opts.wrapInput(input) : input,
    (opts.hint || counter) ? h('div', { class: 'field-foot' }, opts.hint ? h('span', { class: 'hint', id: hintId, text: opts.hint }) : h('span'), counter) : null,
    error);
  return {
    wrap, input, label,
    setError(msg) {
      if (msg) {
        fill(error, icon('exclamation-circle'), h('span', { text: msg }));
        error.hidden = false;
        input.setAttribute('aria-invalid', 'true');
      } else {
        error.hidden = true;
        input.removeAttribute('aria-invalid');
      }
    },
    refreshCounter: updateCounter,
  };
}

export function passwordField(opts) {
  let shown = false;
  let toggle;
  const f = textField({
    ...opts, type: 'password', spellcheck: false,
    wrapInput: (input) => {
      toggle = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': t('auth.show'), 'aria-pressed': 'false', 'aria-controls': input.id || null },
        icon('eye'));
      toggle.addEventListener('click', () => {
        shown = !shown;
        input.type = shown ? 'text' : 'password';
        toggle.setAttribute('aria-pressed', String(shown));
        toggle.setAttribute('aria-label', t(shown ? 'auth.hide' : 'auth.show'));
        fill(toggle, icon(shown ? 'eye-slash' : 'eye'));
      });
      return h('div', { class: 'input-group' }, input, toggle);
    },
  });
  return f;
}

/** Live password guidance: length rule, match rule and a simple strength meter. */
export function passwordGuide(pwInput, confirmInput) {
  const lenItem = h('li', null, icon('check2-circle'), h('span', { text: t('auth.pwLength') }));
  const matchItem = confirmInput ? h('li', null, icon('check2-circle'), h('span', { text: t('auth.pwMatch') })) : null;
  const bar = h('span');
  const level = h('span', { class: 'tiny muted', 'aria-live': 'polite' });
  const update = () => {
    const v = pwInput.value;
    lenItem.classList.toggle('ok', [...v].length >= 10);
    if (matchItem) matchItem.classList.toggle('ok', v.length > 0 && v === confirmInput.value);
    let score = 0;
    if (v.length >= 10) score++;
    if (v.length >= 14) score++;
    if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score++;
    if (/\d/.test(v) || /[^A-Za-z0-9]/.test(v)) score++;
    if (/\s/.test(v.trim()) && v.length >= 16) score++;
    const lvl = v.length === 0 ? null : score <= 1 ? 'weak' : score === 2 ? 'fair' : score === 3 ? 'good' : 'strong';
    bar.style.width = lvl ? ({ weak: 25, fair: 50, good: 75, strong: 100 }[lvl]) + '%' : '0';
    bar.style.background = lvl === 'weak' ? 'var(--bad)' : lvl === 'fair' ? 'var(--warn)' : 'var(--ok)';
    level.textContent = lvl ? t('auth.strength', { level: t('auth.levels.' + lvl) }) : '';
  };
  pwInput.addEventListener('input', update);
  if (confirmInput) confirmInput.addEventListener('input', update);
  update();
  return h('div', { class: 'stack-sm' },
    h('div', { class: 'meter', 'aria-hidden': 'true' }, bar), level,
    h('ul', { class: 'pw-rules' }, lenItem, matchItem),
    h('p', { class: 'hint', text: t('auth.pwTip') }));
}

// ---------------------------------------------------------------- misc
export function alertBox(type, title, body, actions) {
  const ic = type === 'bad' ? 'x-circle-fill' : type === 'warn' ? 'exclamation-triangle-fill' : type === 'ok' ? 'check-circle-fill' : 'info-circle-fill';
  return h('div', { class: ['alert', 'alert-' + type], role: type === 'bad' ? 'alert' : null },
    icon(ic),
    h('div', { class: 'grow' }, title ? h('strong', { text: title }) : null, body ? h('p', { text: body }) : null,
      actions && actions.length ? h('div', { class: 'alert-actions' }, actions) : null));
}

// ---------------------------------------------------------------- e-mail typos
// Domains people at Sensum and their clients use; a near miss gets a suggestion.
const EMAIL_DOMAINS = ['gmail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'outlook.es', 'yahoo.com', 'yahoo.es', 'icloud.com', 'live.com',
  'gruposensum.com', 'sensumconstrucciones.com'];
/** Edit distance with transpositions (gmial → gmail = 1). */
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
/** "ana@hotmial.com" → "ana@hotmail.com"; null when the address looks right. */
export function emailSuggestion(value) {
  const m = /^([^\s@]+)@([^\s@]+\.[^\s@]+)$/.exec(String(value).trim().toLowerCase());
  if (!m || EMAIL_DOMAINS.includes(m[2])) return null;
  let best = null;
  for (const d of EMAIL_DOMAINS) {
    const dist = editDistance(m[2], d);
    if (dist > 0 && dist <= (d.length > 9 ? 2 : 1) && (!best || dist < best[1])) best = [d, dist];
  }
  return best ? m[1] + '@' + best[0] : null;
}
/** Under an e-mail field: «¿Quisiste decir …?» with a button that fixes it. */
export function attachEmailHint(field) {
  const box = h('div', { class: 'email-hint', hidden: true, 'aria-live': 'polite' });
  const check = () => {
    const s = emailSuggestion(field.input.value);
    clear(box);
    box.hidden = !s;
    if (!s) return;
    box.append(icon('lightbulb'), h('span', null, t('common.didYouMean') + ' ', h('strong', { text: s }), '?'),
      h('button', { type: 'button', class: 'btn btn-link btn-sm', onclick: () => { field.input.value = s; field.input.dispatchEvent(new Event('input', { bubbles: true })); box.hidden = true; field.input.focus(); } }, t('common.useThis')));
  };
  field.input.addEventListener('blur', check);
  field.input.addEventListener('input', () => { if (!box.hidden) check(); });
  field.wrap.append(box);
  return box;
}

export function emptyState(ic, title, body, action) {
  return h('div', { class: 'empty' }, h('span', { class: 'icon-tile' }, icon(ic)), h('h3', { text: title }), body ? h('p', { text: body }) : null, action || null);
}

export function pageHead({ crumbs = [], title, lead, actions = [] }) {
  const h1 = h('h1', { tabindex: '-1', text: title });
  return h('div', { class: 'page-head' },
    h('div', { class: 'grow' },
      crumbs.length ? h('nav', { class: 'crumbs', 'aria-label': 'breadcrumb' },
        crumbs.map((c, i) => [i ? icon('chevron-right') : null, c.href ? h('a', { href: c.href, text: c.label }) : h('span', { text: c.label })])) : null,
      h1, lead ? h('p', { text: lead }) : null),
    actions.length ? h('div', { class: 'row' }, actions) : null);
}

/** Placeholder while something loads: shaped like content, shown only after a short delay (CSS). */
export function loading() {
  return h('div', { class: 'page-loading', role: 'status' }, h('span', { class: 'sr-only', text: t('app.loading') }),
    h('div', { class: 'skeleton sk-title', 'aria-hidden': 'true' }), h('div', { class: 'skeleton sk-line', 'aria-hidden': 'true' }),
    h('div', { class: 'skeleton sk-block', 'aria-hidden': 'true' }));
}

/** On/off switch (a checkbox with role="switch"); returns { wrap, input }. */
export function switchInput({ id, checked, describedBy, onChange }) {
  const input = h('input', { type: 'checkbox', role: 'switch', id, checked: checked || null, 'aria-describedby': describedBy || null });
  if (onChange) input.addEventListener('change', () => onChange(input.checked, input));
  return { input, wrap: h('span', { class: 'switch' }, input, h('span', { class: 'track', 'aria-hidden': 'true' }), h('span', { class: 'thumb', 'aria-hidden': 'true' })) };
}

/** Card header: icon tile, title, description and an optional badge on the right. */
export function cardHead({ id, icon: ic, tone, title, lead, badge }) {
  return h('div', { class: ['card-head', !lead && 'title-only'] },
    ic ? h('span', { class: ['icon-tile', tone] }, icon(ic)) : null,
    h('div', { class: 'grow' }, h('h2', { id, text: title }), lead ? h('p', { text: lead }) : null),
    badge || null);
}

export function loadError(err, onRetry) {
  return h('div', { class: 'card' }, alertBox('bad', t('common.loadFailed'), errorText(err), [button(t('common.retry'), { icon: 'arrow-repeat', onClick: onRetry, small: true })]));
}

/** Dropdown menu with keyboard support (Esc, arrows, outside click). */
export function dropdown(trigger, buildItems, { align = 'right' } = {}) {
  const wrap = h('div', { class: 'menu' }, trigger);
  let panel = null;
  const close = (focusTrigger = false) => {
    if (!panel) return;
    panel.remove();
    panel = null;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (focusTrigger) trigger.focus();
  };
  const outside = (e) => { if (!wrap.contains(e.target)) close(); };
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', () => {
    if (panel) return close();
    panel = h('div', { class: 'menu-panel' }, buildItems(close));
    if (align === 'left') { panel.style.left = '0'; panel.style.right = 'auto'; }
    wrap.appendChild(panel);
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    const items = () => [...panel.querySelectorAll('.menu-item, .segmented button')];
    const first = items()[0];
    if (first) first.focus();
    panel.addEventListener('keydown', (e) => {
      const list = items();
      const i = list.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); (list[i + 1] || list[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (list[i - 1] || list[list.length - 1]).focus(); }
      else if (e.key === 'Tab') { close(); }
    });
  });
  return { el: wrap, close };
}

export function segmented(options, value, onChange, label) {
  const group = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
  const render = (current) => {
    clear(group);
    for (const o of options) {
      group.appendChild(h('button', {
        type: 'button', 'aria-pressed': String(o.value === current), 'aria-label': o.icon ? o.label : null,
        onclick: () => { render(o.value); onChange(o.value); },
      }, o.icon ? icon(o.icon) : null, h('span', { class: o.icon ? 'seg-text' : null, text: o.label })));
    }
  };
  render(value);
  return group;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    return false;
  }
}
