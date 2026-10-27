/**
 * Roles and sections: what each account may change. The server is the
 * authority (every change is checked there); the panel only hides what an
 * account cannot use and offers the roles when someone is invited.
 */
import { h, fill, icon } from './dom.js';
import { t } from './i18n.js';
import { alertBox } from './ui.js';

export const PERMISSIONS = ['texts', 'contact', 'photos', 'documents', 'site', 'leads', 'stats', 'monitor', 'report', 'support', 'users'];

/** The owner can do everything; everyone else only what their role (and extra sections) allow. */
export const can = (user, permission) => !!user && (user.owner || (user.permissions || []).includes(permission));

/**
 * Permissions one can ask for: those not held yet. «Gestión de usuarios» and «Gestión de solicitudes
 * de soporte» are given by the owner on their own (Users::NOT_REQUESTABLE).
 */
const NOT_REQUESTABLE = ['users', 'support'];
export const askable = (user) => (user && !user.owner ? PERMISSIONS.filter((p) => !NOT_REQUESTABLE.includes(p) && !(user.permissions || []).includes(p)) : []);

/** The role an account is built on: the largest one it has in full, or 'custom' when none (see Users::accessTypeOf). */
export function accessTypeOf(perms, presets) {
  let best = 'custom';
  for (const [k, role] of Object.entries(presets)) {
    if (role.every((p) => perms.includes(p)) && (best === 'custom' || role.length > presets[best].length)) best = k;
  }
  return best;
}

/** For access no role covers: the role adding the least to it (as migration 017_roles did), never Administrador. */
function closestRole(perms, presets) {
  const fit = Object.entries(presets).filter(([k]) => k !== 'admin').map(([k, role], i) => {
    const overlap = role.filter((p) => perms.includes(p)).length;
    return { k, overlap, missing: role.length - overlap, i };
  });
  fit.sort((a, b) => (a.overlap === 0) - (b.overlap === 0) || a.missing - b.missing || b.overlap - a.overlap || a.i - b.i);
  return fit.length ? fit[0].k : 'custom';
}

/** «Editor del sitio web», «Ventas y prospectos + Textos del sitio», or the sections when no role covers them. */
export function accessLabel(user, presets) {
  if (user.isOwner || user.owner) return t('access.owner');
  const perms = user.permissions || [];
  const type = presets ? accessTypeOf(perms, presets) : 'custom';
  if (type === 'custom') return permissionList(perms);
  const extras = perms.filter((p) => !presets[type].includes(p));
  return t('access.types.' + type)[0] + (extras.length ? ' + ' + permissionList(extras) : '');
}

export const permissionList = (perms) => perms.map((p) => t('access.perms.' + p)).join(' · ');

/**
 * Role picker: one role (radio cards) and, folded away, «Secciones adicionales»
 * for exceptions (sections the role doesn't include). `allowed` limits both to
 * what the person giving access may give (the owner: everything; someone else
 * who manages users: their own access, without "users").
 * Returns { el, value(): string[] }.
 */
export function accessPicker(allPresets, initial = allPresets.content, idPrefix = 'acc', allowed = PERMISSIONS) {
  const presets = Object.fromEntries(Object.entries(allPresets).filter(([, perms]) => perms.every((p) => allowed.includes(p))));
  const keys = Object.keys(presets);
  let role = accessTypeOf(initial, presets);
  const legacy = role === 'custom' && keys.length > 0 && initial.length > 0;
  if (role === 'custom' && keys.length) role = initial.length ? closestRole(initial, presets) : keys[0];
  // Extra sections: what the account has beyond its role. An older access (no complete role) keeps
  // everything it had, so ticking another role never takes a section away by surprise.
  const extras = new Set(initial.filter((p) => allowed.includes(p) && (legacy || role === 'custom' || !presets[role].includes(p))));

  const radios = keys.map((k) => h('label', { class: 'choice' },
    h('input', { type: 'radio', name: idPrefix + '-type', value: k, checked: k === role || null }),
    h('div', null, h('strong', { text: t('access.types.' + k)[0] }), h('span', { text: t('access.types.' + k)[1] }))));
  const group = h('div', { class: 'choice-group' }, radios);
  const count = h('span', { class: 'badge badge-brand extras-count' });
  const boxes = h('div', { class: 'checks', id: idPrefix + '-extras' });
  const details = h('details', { class: 'disclosure extras', open: extras.size > 0 || !keys.length || null },
    h('summary', null, h('span', { text: t('access.extras') }), h('span', { class: 'extras-optional', text: '(' + t('access.extrasOptional') + ')' }), icon('chevron-down'), count),
    h('p', { class: 'tiny muted extras-hint', text: t('access.extrasHint') }), boxes);
  const drawExtras = () => {
    const base = role === 'custom' ? [] : presets[role];
    const options = PERMISSIONS.filter((p) => allowed.includes(p) && !base.includes(p));
    fill(boxes, options.map((p) => h('label', { class: 'check check-help' },
      h('input', { type: 'checkbox', value: p, checked: extras.has(p) || null }),
      h('span', null, h('span', { class: 'check-title', text: t('access.perms.' + p) }), h('span', { class: 'tiny muted check-hint', text: t('access.permHelp.' + p) })))));
    const ticked = options.filter((p) => extras.has(p)).length;
    count.hidden = !ticked;
    count.textContent = t('access.extrasCount', { n: ticked });
    details.hidden = !options.length;
  };
  group.addEventListener('change', (e) => {
    if (e.target.name !== idPrefix + '-type') return;
    role = e.target.value;
    drawExtras();
  });
  boxes.addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    if (e.target.checked) extras.add(e.target.value); else extras.delete(e.target.value);
    drawExtras();
  });
  drawExtras();
  const el = h('fieldset', { class: 'field fieldset-reset' }, h('legend', { class: 'label', text: t('access.label') }),
    legacy ? alertBox('info', null, t('access.legacy')) : null, group, details);
  return {
    el,
    value() {
      const base = role === 'custom' ? [] : presets[role];
      return PERMISSIONS.filter((p) => base.includes(p) || (allowed.includes(p) && extras.has(p)));
    },
  };
}
