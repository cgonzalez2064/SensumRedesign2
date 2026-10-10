/**
 * "Ver como" (owner only): see the panel exactly as another account does, to
 * check what each access type can open — read-only, 30 minutes at most.
 * Starting asks for the owner's password; switching between accounts and
 * going back don't. While it is on, a bar on every screen says who you are
 * viewing as, how long is left, and lets you switch or go back.
 */
import { h, icon, initials } from './dom.js';
import { t } from './i18n.js';
import { api } from './api.js';
import { askPassword, openDialog, toast, errorText, button, setBusy } from './ui.js';
import { accessLabel } from './access.js';

/** Starts (password) or switches (no password while active). Resolves true when it changed. */
export async function viewAs(user, { active }) {
  if (!active) {
    const pw = await askPassword({ title: t('viewAs.confirmTitle', { name: user.name }), lead: t('viewAs.confirmLead', { minutes: 30 }), confirmLabel: t('viewAs.start') });
    if (pw === null) return false;
    try { await api.post('/view-as', { userId: user.id, currentPassword: pw }); return true; }
    catch (err) {
      toast(err.code === 'validation' && err.fields.currentPassword ? t('fieldErrors.current_password_wrong') : errorText(err), { type: 'bad' });
      return false;
    }
  }
  try { await api.post('/view-as/switch', { userId: user.id }); return true; }
  catch (err) { toast(errorText(err), { type: 'bad' }); return false; }
}

/** Every account (with its access type) the owner can view the panel as. */
export async function pickViewAs({ active = false, currentId = null, onDone }) {
  let data;
  try { data = await api.get('/view-as'); } catch (err) { toast(errorText(err), { type: 'bad' }); return; }
  const list = data.users.length
    ? h('ul', { class: 'person-list viewas-list' }, data.users.map((u) => {
      const current = u.id === currentId;
      const go = button(current ? t('viewAs.current') : t('viewAs.view'), { small: true, variant: current ? 'ghost' : null, icon: current ? 'check-lg' : 'eye',
        attrs: { disabled: current || null, 'aria-label': current ? t('viewAs.current') : t('viewAs.viewAria', { name: u.name }) } });
      go.addEventListener('click', async () => {
        setBusy(go, true);
        if (await viewAs(u, { active })) { dlg.close(); onDone(u); } else setBusy(go, false);
      });
      return h('li', { class: 'person-row' }, h('span', { class: 'avatar', 'aria-hidden': 'true', text: initials(u.name) }),
        h('div', { class: 'grow' }, h('strong', { class: 'break', text: u.name }),
          h('div', { class: 'tiny muted break', text: accessLabel(u, data.accessTypes) + (u.status === 'invited' ? ' · ' + t('viewAs.invited') : '') })),
        go);
    }))
    : h('p', { class: 'muted', text: t('viewAs.none') });
  const dlg = openDialog({
    title: t(active ? 'viewAs.switchTitle' : 'viewAs.pickTitle'), lead: t('viewAs.pickLead'), labelledIcon: 'eye', wide: true,
    body: list, actions: [{ label: t('common.close'), onClick: (b, close) => close() }],
  });
}

/** The bar shown on every screen while viewing as someone. */
export function viewAsBar(session, onChange) {
  const user = session.user;
  const until = session.viewAs.until;
  const left = h('span', { class: 'viewas-left' });
  let timer = 0;
  const tick = () => {
    if (!el.isConnected && timer) { clearInterval(timer); return; }
    const m = Math.max(0, Math.ceil((until * 1000 - Date.now()) / 60000));
    left.textContent = t('viewAs.left', { n: m });
    if (m <= 0) { clearInterval(timer); onChange('/usuarios'); }
  };
  const switchBtn = button(t('viewAs.switch'), { small: true, icon: 'people', onClick: () => pickViewAs({ active: true, currentId: user.id, onDone: () => onChange('/') }) });
  const back = button(t('viewAs.back'), { small: true, variant: 'primary', icon: 'arrow-left' });
  back.addEventListener('click', async () => {
    setBusy(back, true);
    try { await api.post('/view-as/stop', {}); } catch (e) { /* the session check below settles it */ }
    onChange('/usuarios');
  });
  const access = session.viewAs.accessType === 'custom' ? (user.permissions || []).map((p) => t('access.perms.' + p)).join(' · ') : t('access.types.' + session.viewAs.accessType)[0];
  const el = h('div', { class: 'viewas-bar', role: 'region', 'aria-label': t('viewAs.region') },
    h('span', { class: 'viewas-icon', 'aria-hidden': 'true' }, icon('eye')),
    h('div', { class: 'grow viewas-text' },
      h('strong', { text: t('viewAs.as', { name: user.name }) }),
      h('span', { class: 'viewas-meta', text: [access, session.viewAs.status === 'invited' ? t('viewAs.invited') : null, t('viewAs.readOnly')].filter(Boolean).join(' · ') }),
      left),
    h('div', { class: 'viewas-actions' }, switchBtn, back));
  tick();
  timer = setInterval(tick, 20000);
  return el;
}
