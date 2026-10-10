/**
 * Access types: what each account may change. The server is the authority
 * (every change is checked there); the panel only hides what an account
 * cannot use and offers the ready-made types when the owner invites someone.
 */
import { h } from './dom.js';
import { t } from './i18n.js';

export const PERMISSIONS = ['texts', 'contact', 'photos', 'documents', 'site', 'leads'];

/** The owner can do everything; everyone else only what their access type allows. */
export const can = (user, permission) => !!user && (user.owner || (user.permissions || []).includes(permission));

/** Key of the ready-made type matching these permissions, or 'custom'. */
export function accessTypeOf(perms, presets) {
  const key = Object.keys(presets).find((k) => presets[k].length === perms.length && presets[k].every((p) => perms.includes(p)));
  return key || 'custom';
}

export function accessLabel(user, presets) {
  if (user.isOwner || user.owner) return t('access.owner');
  const type = presets ? accessTypeOf(user.permissions || [], presets) : 'custom';
  return type === 'custom' ? permissionList(user.permissions || []) : t('access.types.' + type)[0];
}

export const permissionList = (perms) => perms.map((p) => t('access.perms.' + p)).join(' · ');

/**
 * Radio list of ready-made access types plus "Personalizado" (checkboxes).
 * Returns { el, value(): string[] }.
 */
export function accessPicker(presets, initial = presets.content, idPrefix = 'acc') {
  const start = accessTypeOf(initial, presets);
  const boxes = PERMISSIONS.map((p) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', value: p, checked: initial.includes(p) || null }),
    h('span', { text: t('access.perms.' + p) })));
  const custom = h('div', { class: 'checks', hidden: start !== 'custom' || null, id: idPrefix + '-custom' }, boxes);
  const radios = [...Object.keys(presets), 'custom'].map((k) => h('label', { class: 'choice' },
    h('input', { type: 'radio', name: idPrefix + '-type', value: k, checked: k === start || null }),
    h('div', null, h('strong', { text: t('access.types.' + k)[0] }), h('span', { text: t('access.types.' + k)[1] }))));
  const group = h('div', { class: 'choice-group' }, radios);
  group.addEventListener('change', (e) => {
    if (e.target.name !== idPrefix + '-type') return;
    const k = e.target.value;
    custom.hidden = k !== 'custom';
    if (k !== 'custom') boxes.forEach((b) => { b.firstChild.checked = presets[k].includes(b.firstChild.value); });
  });
  const el = h('fieldset', { class: 'field fieldset-reset' }, h('legend', { class: 'label', text: t('access.label') }), group, custom);
  return {
    el,
    value() {
      const k = el.querySelector(`input[name="${idPrefix}-type"]:checked`).value;
      return k === 'custom' ? boxes.filter((b) => b.firstChild.checked).map((b) => b.firstChild.value) : [...presets[k]];
    },
  };
}
