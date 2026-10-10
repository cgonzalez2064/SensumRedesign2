/**
 * Sensum — Administrador de contenido (single-page app, no build step).
 * Hash routes keep reset/invitation tokens out of server logs and referrers.
 */
import { h, icon, clear, initials, fill } from './dom.js';
import { t, setLang, getLang, onLangChange, i18nReady } from './i18n.js';
import { initTheme, setThemePref, getThemePref } from './theme.js';
import { api, setCsrf, onSessionExpired, onTwoFactorRequired } from './api.js';
import { toast, openDialog, confirmDialog, dropdown, segmented, passwordField, textField, setBusy, errorText, alertBox, loading, button } from './ui.js';
import { initTelemetry } from './telemetry.js';
import { can } from './access.js';
import { codeField } from './twofactor.js';

// Screens are loaded when first opened (and prefetched when the pointer or
// focus reaches their menu link), so the panel starts with only the shell.
const lazy = (load) => { let p = null; return () => (p = p || load().catch((e) => { p = null; throw e; })); };
const V = {
  auth: lazy(() => import('./views/auth.js')),
  dashboard: lazy(() => import('./views/dashboard.js')),
  content: lazy(() => import('./views/content.js')),
  media: lazy(() => import('./views/media.js')),
  users: lazy(() => import('./views/users.js')),
  account: lazy(() => import('./views/account.js')),
  reports: lazy(() => import('./views/reports.js')),
  help: lazy(() => import('./views/help.js')),
  monitor: lazy(() => import('./views/monitor.js')),
  siteReport: lazy(() => import('./views/sitereport.js')),
  email: lazy(() => import('./views/email.js')),
  security: lazy(() => import('./views/security.js')),
  form: lazy(() => import('./views/form.js')),
  leads: lazy(() => import('./views/leads.js')),
  stats: lazy(() => import('./views/stats.js')),
  status: lazy(() => import('./views/status.js')),
  translation: lazy(() => import('./views/translation.js')),
};
const loadReport = lazy(() => import('./report.js'));
const openReportDialog = (...args) => loadReport().then((m) => m.openReportDialog(...args));

const state = { session: null, setupRequired: false, view: null, shell: null, path: null, skipGuard: false };

// --------------------------------------------------------------- routes
const PUBLIC = [
  { re: /^\/ingresar$/, mod: V.auth, fn: 'login' },
  { re: /^\/recuperar$/, mod: V.auth, fn: 'forgot' },
  { re: /^\/restablecer\/([A-Za-z0-9_-]+)$/, mod: V.auth, fn: 'reset' },
  { re: /^\/invitacion\/([A-Za-z0-9_-]+)$/, mod: V.auth, fn: 'invitation' },
  { re: /^\/configurar$/, mod: V.auth, fn: 'setup' },
];
const PRIVATE = [
  { re: /^\/$/, mod: V.dashboard, fn: 'render', nav: 'dashboard' },
  { re: /^\/textos$/, mod: V.content, fn: 'list', nav: 'content', perm: ['texts'] },
  { re: /^\/textos\/([a-z]+)$/, mod: V.content, fn: 'editor', nav: 'content', perm: ['texts'] },
  { re: /^\/contacto$/, mod: V.content, fn: 'details', nav: 'details', perm: ['contact'] },
  { re: /^\/formulario$/, mod: V.form, fn: 'render', nav: 'form', perm: ['contact'] },
  { re: /^\/fotos(?:\/(nosotros|proyectos|documentos))?$/, mod: V.media, fn: 'render', nav: 'media', perm: ['photos', 'documents'] },
  { re: /^\/prospectos$/, mod: V.leads, fn: 'render', nav: 'leads', perm: ['leads'] },
  { re: /^\/prospectos\/([1-9][0-9]{0,8})$/, mod: V.leads, fn: 'detail', nav: 'leads', perm: ['leads'] },
  { re: /^\/estadisticas$/, mod: V.stats, fn: 'render', nav: 'stats', perm: ['leads'] },
  { re: /^\/usuarios$/, mod: V.users, fn: 'render', nav: 'users', owner: true },
  { re: /^\/monitoreo$/, mod: V.monitor, fn: 'render', nav: 'monitor', owner: true },
  { re: /^\/monitoreo-basico$/, mod: V.status, fn: 'render', nav: 'status', perm: ['monitor'] },
  { re: /^\/traduccion$/, mod: V.translation, fn: 'render', nav: 'translation', owner: true },
  { re: /^\/informe$/, mod: V.siteReport, fn: 'render', nav: 'siteReport', owner: true },
  { re: /^\/correo$/, mod: V.email, fn: 'render', nav: 'email', owner: true },
  { re: /^\/seguridad$/, mod: V.security, fn: 'render', nav: 'security', owner: true },
  { re: /^\/reportes$/, mod: V.reports, fn: 'render', nav: 'reports' },
  { re: /^\/reportes\/([1-9][0-9]{0,8})$/, mod: V.reports, fn: 'detail', nav: 'reports' },
  { re: /^\/cuenta$/, mod: V.account, fn: 'render', nav: 'account' },
  { re: /^\/ayuda$/, mod: V.help, fn: 'render', nav: 'help' },
];

const currentPath = () => {
  const raw = (location.hash || '#/').slice(1) || '/';
  return raw.startsWith('/') ? raw : '/' + raw;
};
export const navigate = (path) => { location.hash = '#' + path; };
const isOwner = () => !!(state.session && state.session.user.owner);
/** Whether the signed-in account may change this kind of information (see access.js). */
export const userCan = (permission) => !!state.session && can(state.session.user, permission);

// --------------------------------------------------------------- session
async function loadSession() {
  try {
    const data = await api.get('/auth/session', { auth: false });
    if (data.authenticated) setSession(data);
    else { state.session = null; state.setupRequired = !!data.setupRequired; setCsrf(null); }
  } catch (e) {
    state.session = null;
    state.bootError = e;
  }
}

export function setSession(data) {
  state.session = { user: data.user, app: data.app || (state.session && state.session.app) || {} };
  setCsrf(data.csrf);
  // First sign-in on this device: adopt the profile's language/theme.
  try {
    if (!localStorage.getItem('sensum_admin_lang') && data.user.lang) setLang(data.user.lang);
    if (!localStorage.getItem('sensum_admin_theme') && data.user.theme) setThemePref(data.user.theme);
  } catch (e) { /* storage unavailable */ }
}

export function updateUser(user) {
  if (state.session) state.session.user = user;
  if (state.shell) { state.path = null; route(true); }
}

export async function logout() {
  if (!(await guardLeave())) return;
  try { await api.post('/auth/logout', {}, { auth: false }); } catch (e) { /* signed out locally anyway */ }
  state.session = null;
  setCsrf(null);
  state.shell = null;
  state.skipGuard = true;
  toast(t('auth.loggedOut'), { type: 'info' });
  navigate('/ingresar');
}

/** Re-login in place when the session expires — edits stay on screen. */
let reloginPromise = null;
function relogin() {
  if (reloginPromise) return reloginPromise;
  reloginPromise = new Promise((resolve, reject) => {
    const email = state.session ? state.session.user.email : '';
    const emailF = textField({ label: t('auth.email'), value: email, type: 'email', autocomplete: 'username', readOnly: !!email });
    const pwF = passwordField({ label: t('auth.password'), autocomplete: 'current-password' });
    const msg = h('div');
    const codeF = codeField({ allowRecovery: true, id: 'relogin-code' });
    let challenge = null;
    let ok = false;
    const form = h('form', { class: 'stack', novalidate: true }, alertBox('info', null, t('auth.sessionExpiredBody')), emailF.wrap, pwF.wrap, msg);
    const dlg = openDialog({
      title: t('auth.sessionExpiredTitle'), body: form,
      onClose: () => { reloginPromise = null; if (!ok) reject(new Error('relogin_cancelled')); },
      actions: [
        { label: t('common.cancel'), onClick: (b, close) => close() },
        { label: t('auth.reloginSubmit'), variant: 'primary', onClick: () => form.requestSubmit() },
      ],
    });
    setTimeout(() => pwF.input.focus(), 50);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = dlg.foot.lastChild;
      setBusy(btn, true, t('auth.submitting'));
      clear(msg);
      try {
        let data;
        if (challenge) {
          data = await api.post('/auth/login/2fa', { challenge, code: codeF.input.value.trim() }, { auth: false });
        } else {
          data = await api.post('/auth/login', { email: emailF.input.value, password: pwF.input.value }, { auth: false });
          if (data.twoFactor) {
            // Two-step sign-in: ask for the code in the same dialog.
            challenge = data.challenge;
            setBusy(btn, false);
            pwF.wrap.hidden = true;
            emailF.wrap.hidden = true;
            form.insertBefore(codeF.wrap, msg);
            codeF.input.focus();
            return;
          }
        }
        setSession(data);
        ok = true;
        resolve();
        dlg.close();
      } catch (err) {
        if (challenge && err.code === 'two_factor_expired') { challenge = null; pwF.wrap.hidden = false; emailF.wrap.hidden = false; codeF.wrap.remove(); }
        setBusy(btn, false);
        msg.appendChild(alertBox('bad', null, errorText(err)));
        pwF.input.select();
      }
    });
  });
  return reloginPromise;
}

// --------------------------------------------------------------- unsaved changes
async function guardLeave() {
  if (state.view && typeof state.view.isDirty === 'function' && state.view.isDirty()) {
    return confirmDialog({ title: t('common.unsavedTitle'), body: t('common.unsavedBody'), confirmLabel: t('common.unsavedLeave'), cancelLabel: t('common.unsavedStay'), danger: true });
  }
  return true;
}
window.addEventListener('beforeunload', (e) => {
  if (state.view && state.view.isDirty && state.view.isDirty()) { e.preventDefault(); e.returnValue = ''; }
});

// --------------------------------------------------------------- shell
function navLink(path, key, ic, active) {
  const route = PRIVATE.find((r) => r.nav === key);
  const prefetch = () => { if (route) route.mod().catch(() => {}); };
  return h('a', { href: '#' + path, 'data-nav': key, 'aria-current': active === key ? 'page' : null, onclick: closeNav, onpointerenter: prefetch, onfocus: prefetch },
    icon(ic), h('span', { text: t('nav.' + key) }), key === 'reports' || key === 'leads' ? h('span', { class: 'nav-badge', hidden: true }) : null);
}

/**
 * Number next to "Reportes de soporte": tickets that need IT (owner) or
 * replies the person hasn't read yet. Refreshed when the frame is built,
 * after ticket actions, and when the window regains focus (at most every 30 s).
 */
let badgeAt = 0;
export async function refreshReportsBadge(force = true) {
  if (!state.shell || (!force && Date.now() - badgeAt < 30000)) return;
  badgeAt = Date.now();
  let n = 0;
  try { n = (await api.get('/reports/badge')).count; } catch (e) { return; }
  const el = state.shell && state.shell.sidebar.querySelector('.nav a[data-nav="reports"] .nav-badge');
  if (!el) return;
  el.hidden = !n;
  el.textContent = n > 99 ? '99+' : String(n);
  el.setAttribute('aria-label', t(state.session && state.session.user.owner ? 'tickets.badgeOwner' : 'tickets.badgeReporter', { n }));
}
window.addEventListener('focus', () => { refreshReportsBadge(false); refreshLeadsBadge(false); });

/** Number next to "Prospectos": contact-form messages nobody has opened yet. */
let leadsBadgeAt = 0;
export async function refreshLeadsBadge(force = true) {
  if (!state.shell || !userCan('leads') || (!force && Date.now() - leadsBadgeAt < 30000)) return;
  leadsBadgeAt = Date.now();
  let n = 0;
  try { n = (await api.get('/leads/badge')).count; } catch (e) { return; }
  const el = state.shell && state.shell.sidebar.querySelector('.nav a[data-nav="leads"] .nav-badge');
  if (!el) return;
  el.hidden = !n;
  el.textContent = n > 99 ? '99+' : String(n);
  el.setAttribute('aria-label', t('leads.badge', { n }));
}

function closeNav() {
  if (!state.shell) return;
  state.shell.sidebar.classList.remove('open');
  state.shell.scrim.classList.remove('show');
  state.shell.openBtn.setAttribute('aria-expanded', 'false');
}
function openNav() {
  state.shell.sidebar.classList.add('open');
  state.shell.scrim.classList.add('show');
  state.shell.openBtn.setAttribute('aria-expanded', 'true');
  const first = state.shell.sidebar.querySelector('a[aria-current], .nav a');
  if (first) first.focus();
}

/**
 * The panel frame (sidebar, top bar). Built once and reused while the same
 * person, language and access stay the same: navigating only swaps <main>.
 */
function renderShell(activeNav, force = false) {
  const app = document.getElementById('app');
  const user = state.session.user;
  const active = activeNav ?? (state.shell && state.shell.active);
  const key = [getLang(), user.id, user.name, user.owner, (user.permissions || []).join(','), state.session.app && state.session.app.version].join('|');
  if (!force && state.shell && state.shell.key === key && app.contains(state.shell.main)) {
    state.shell.active = active;
    state.shell.sidebar.querySelectorAll('.nav a[data-nav]').forEach((a) => {
      if (a.getAttribute('data-nav') === active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    closeNav();
    // A new <main> for every screen: a previous screen still finishing its
    // requests writes into its own (detached) element, never into this one.
    const fresh = h('main', { class: 'main view-enter', id: 'main', tabindex: '-1' });
    state.shell.main.replaceWith(fresh);
    state.shell.main = fresh;
    return fresh;
  }
  const siteUrl = (state.session.app && state.session.app.siteUrl) || '../';

  const openBtn = h('button', { class: 'btn btn-ghost btn-icon open-nav', type: 'button', 'aria-label': t('app.openMenu'), 'aria-expanded': 'false', 'aria-controls': 'sidebar', onclick: openNav }, icon('list'));
  const brand = (cls) => h('a', { class: ['brand', cls], href: '#/' }, h('img', { src: '../assets/logo-icon.png', alt: '', width: 32, height: 32 }),
    h('span', null, t('app.brand'), h('small', { text: t('app.name') })));

  const userBtn = h('button', { class: 'btn btn-ghost', type: 'button', 'aria-label': t('topbar.userMenu') },
    h('span', { class: 'avatar', 'aria-hidden': 'true', text: initials(user.name) }), h('span', { class: 'hide-sm', text: user.name.split(' ')[0] }), icon('chevron-down'));
  const menu = dropdown(userBtn, (close) => [
    h('div', { class: 'menu-user' }, h('strong', { text: user.name }), h('span', { class: 'small muted break', text: user.email })),
    h('hr'),
    h('a', { class: 'menu-item', href: '#/cuenta', onclick: () => close() }, icon('person-circle'), t('nav.account')),
    h('a', { class: 'menu-item', href: '#/ayuda', onclick: () => close() }, icon('question-circle'), t('nav.help')),
    h('hr'),
    h('div', { class: 'menu-label', text: t('topbar.theme') }),
    h('div', { class: 'menu-user' }, themeSwitch()),
    h('div', { class: 'menu-label', text: t('topbar.language') }),
    h('div', { class: 'menu-user' }, langSwitch()),
    h('hr'),
    h('button', { class: 'menu-item danger', type: 'button', onclick: () => { close(); logout(); } }, icon('box-arrow-right'), t('topbar.logout')),
  ]);

  const reportBtn = h('button', { class: 'btn btn-sm report-btn', type: 'button', onclick: () => openReportDialog() },
    icon('life-preserver'), h('span', { class: 'label-text', text: t('topbar.report') }));
  reportBtn.setAttribute('aria-label', t('topbar.report'));

  const topbar = h('header', { class: 'topbar' },
    openBtn, brand(''), h('div', { class: 'spacer' }),
    reportBtn,
    h('a', { class: 'btn btn-ghost btn-sm hide-sm', href: siteUrl, target: '_blank', rel: 'noopener' }, icon('box-arrow-up-right'), t('app.viewSite'), h('span', { class: 'sr-only', text: ' ' + t('app.newTab') })),
    menu.el);

  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': t('nav.main') },
    h('div', { class: 'sidebar-head' }, brand('sidebar-brand'),
      h('button', { class: 'btn btn-ghost btn-icon close-nav', type: 'button', 'aria-label': t('app.closeMenu'), onclick: () => { closeNav(); openBtn.focus(); } }, icon('x-lg'))),
    h('nav', { class: 'nav', 'aria-label': t('nav.main') },
      navLink('/', 'dashboard', 'house', active),
      ['texts', 'photos', 'documents', 'contact'].some((p) => can(user, p)) ? h('div', { class: 'nav-section', text: t('nav.groupSite') }) : null,
      can(user, 'texts') ? navLink('/textos', 'content', 'pencil-square', active) : null,
      can(user, 'photos') || can(user, 'documents') ? navLink('/fotos', 'media', 'images', active) : null,
      can(user, 'contact') ? navLink('/contacto', 'details', 'telephone', active) : null,
      can(user, 'contact') ? navLink('/formulario', 'form', 'card-text', active) : null,
      can(user, 'leads') ? [h('div', { class: 'nav-section', text: t('nav.groupClients') }), navLink('/prospectos', 'leads', 'inbox', active),
        navLink('/estadisticas', 'stats', 'graph-up', active)] : null,
      !user.owner && can(user, 'monitor') ? [h('div', { class: 'nav-section', text: t('nav.groupStatus') }), navLink('/monitoreo-basico', 'status', 'activity', active)] : null,
      user.owner ? [h('div', { class: 'nav-section', text: t('nav.groupAdmin') }), navLink('/usuarios', 'users', 'people', active),
        navLink('/monitoreo', 'monitor', 'activity', active), navLink('/informe', 'siteReport', 'bar-chart', active),
        navLink('/correo', 'email', 'envelope', active), navLink('/traduccion', 'translation', 'translate', active), navLink('/seguridad', 'security', 'shield-lock', active)] : null,
      h('div', { class: 'nav-section', text: t('nav.groupSupport') }),
      navLink('/reportes', 'reports', 'chat-square-text', active),
      navLink('/ayuda', 'help', 'question-circle', active),
      navLink('/cuenta', 'account', 'person-circle', active)),
    h('div', { class: 'sidebar-foot' },
      h('button', { class: 'btn btn-block', type: 'button', onclick: () => { closeNav(); openReportDialog(); } }, icon('life-preserver'), t('topbar.report')),
      h('a', { class: 'btn btn-ghost btn-block', href: siteUrl, target: '_blank', rel: 'noopener' }, icon('box-arrow-up-right'), t('app.viewSite')),
      h('span', { class: 'tiny muted', text: t('app.version', { v: (state.session.app && state.session.app.version) || '' }) })));

  const scrim = h('div', { class: 'scrim', onclick: closeNav });
  const main = h('main', { class: 'main view-enter', id: 'main', tabindex: '-1' });
  const offline = h('div', { class: 'main', hidden: navigator.onLine !== false, role: 'status' }, alertBox('warn', null, t('app.offline')));
  sidebar.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sidebar.classList.contains('open')) { closeNav(); openBtn.focus(); } });

  fill(app, h('a', { class: 'skip-link', href: '#main', onclick: (e) => { e.preventDefault(); state.shell.main.focus(); } }, t('app.skip')),
    h('div', { class: 'app' }, sidebar, topbar, h('div', null, offline, main)), scrim);
  state.shell = { main, sidebar, scrim, openBtn, active, offline, key };
  refreshReportsBadge();
  refreshLeadsBadge();
  return main;
}

export function themeSwitch() {
  return segmented([
    { value: 'light', label: t('theme.light'), icon: 'sun' },
    { value: 'dark', label: t('theme.dark'), icon: 'moon-stars' },
    { value: 'system', label: t('theme.system'), icon: 'circle-half' },
  ], getThemePref(), (v) => {
    setThemePref(v);
    if (state.session) api.put('/account/profile', { name: state.session.user.name, lang: getLang(), theme: v }).then((d) => { state.session.user = d.user; }).catch(() => {});
  }, t('topbar.theme'));
}

export function langSwitch() {
  return segmented([
    { value: 'es', label: 'Español' },
    { value: 'en', label: 'English' },
  ], getLang(), async (v) => {
    if (v === getLang()) return;
    if (!(await guardLeave())) { route(true); return; }
    setLang(v);
    if (state.session) api.put('/account/profile', { name: state.session.user.name, lang: v, theme: getThemePref() }).then((d) => { state.session.user = d.user; }).catch(() => {});
  }, t('topbar.language'));
}

// --------------------------------------------------------------- router
// Each navigation gets a sequence number; an older navigation that is
// still awaiting something stops as soon as a newer one has started, so a
// late render can never replace the screen the user is already using.
let navSeq = 0;
async function route(force = false) {
  const seq = ++navSeq;
  const stale = () => seq !== navSeq;
  const path = currentPath();
  if (!force && path === state.path && state.view) return;

  // Unsaved-changes guard on navigation.
  if (!force && !state.skipGuard && state.path && state.path !== path) {
    if (!(await guardLeave())) {
      state.skipGuard = true;
      history.replaceState(null, '', '#' + state.path);
      state.skipGuard = false;
      return;
    }
    if (stale()) return;
  }
  state.skipGuard = false;
  if (state.view && state.view.destroy) state.view.destroy();
  state.view = null;
  state.path = path;

  const pub = PUBLIC.find((r) => r.re.test(path));
  if (pub) {
    if (state.session && path === '/ingresar') return navigate(sessionStorage.getItem('sensum_after_login') || '/');
    state.shell = null;
    const app = document.getElementById('app');
    let mod;
    try { mod = await pub.mod(); } catch (e) { return showLoadFailed(document.getElementById('app'), e); }
    if (stale()) return;
    clear(app);
    const view = (await mod[pub.fn]({ app, params: path.match(pub.re).slice(1), setupRequired: state.setupRequired, onSignedIn })) || null;
    if (!stale()) state.view = view;
    return;
  }

  if (!state.session) {
    if (path !== '/') try { sessionStorage.setItem('sensum_after_login', path); } catch (e) { /* ignore */ }
    return navigate(state.setupRequired ? '/configurar' : '/ingresar');
  }

  // Covered by the two-step policy but not set up yet: only the set-up screen.
  if (state.session.user.twoFactorRequired && !state.session.user.twoFactor) {
    state.shell = null;
    let mod;
    try { mod = await V.auth(); } catch (e) { return showLoadFailed(document.getElementById('app'), e); }
    if (stale()) return;
    mod.enroll({ app: document.getElementById('app'), onLogout: logout, onDone: async () => {
      await loadSession();
      state.path = null;
      navigate('/');
      route(true);
    } });
    return;
  }

  const priv = PRIVATE.find((r) => r.re.test(path));
  const main = renderShell(priv ? priv.nav : null);
  if (!priv || (priv.owner && !isOwner()) || (priv.perm && !priv.perm.some(userCan))) {
    main.append(h('div', { class: 'card empty' }, h('span', { class: 'icon-tile' }, icon('exclamation-circle')),
      h('h1', { tabindex: '-1', text: t('notFound.title') }), h('p', { text: t('notFound.body') }),
      h('a', { class: 'btn btn-primary', href: '#/' }, t('notFound.home'))));
    document.title = t('notFound.title') + ' · ' + t('app.name');
    focusHeading(main);
    return;
  }
  // Screen code: usually already prefetched; show a placeholder only if it takes a moment.
  const slow = setTimeout(() => { if (!stale() && !main.firstChild) main.append(loading()); }, 120);
  let mod;
  try { mod = await priv.mod(); } catch (e) { clearTimeout(slow); if (!stale()) showLoadFailed(clear(main), e); return; }
  clearTimeout(slow);
  if (stale()) return;
  clear(main);
  const view = (await mod[priv.fn]({ main, params: path.match(priv.re).slice(1), session: state.session, navigate, isOwner: isOwner(), can: userCan })) || null;
  if (stale()) {
    if (view && view.destroy) view.destroy();
    return;
  }
  state.view = view;
  focusHeading(main);
}

/** A screen's code could not be downloaded (offline, or a new version was deployed meanwhile). */
function showLoadFailed(el, err) {
  if (window.console) console.warn(err);
  fill(el, h('div', { class: 'card' }, alertBox('warn', t('common.loadFailed'), t('app.updateAvailable'),
    [button(t('common.reload'), { icon: 'arrow-repeat', small: true, onClick: () => location.reload() })])));
}

function focusHeading(main) {
  const h1 = main.querySelector('h1');
  if (h1) {
    document.title = h1.textContent + ' · ' + t('app.name');
    h1.focus({ preventScroll: false });
  }
  window.scrollTo(0, 0);
}

async function onSignedIn(data) {
  setSession(data);
  let next = '/';
  try { next = sessionStorage.getItem('sensum_after_login') || '/'; sessionStorage.removeItem('sensum_after_login'); } catch (e) { /* ignore */ }
  state.path = null;
  navigate(next);
  if (currentPath() === next) route(true);
}

// --------------------------------------------------------------- boot
async function boot() {
  initTheme();
  initTelemetry();
  await i18nReady();
  onSessionExpired(relogin);
  // The policy changed while signed in: refresh the session and show the set-up screen.
  onTwoFactorRequired(async () => { await loadSession(); state.path = null; route(true); });
  onLangChange(() => { state.path = null; route(true); });
  window.addEventListener('online', () => { if (state.shell) state.shell.offline.hidden = true; });
  window.addEventListener('offline', () => { if (state.shell) state.shell.offline.hidden = false; });
  await loadSession();
  if (state.bootError && !state.session) {
    const app = document.getElementById('app');
    fill(app, h('div', { class: 'auth' }, h('div', { class: 'auth-card' },
      alertBox('bad', t('common.loadFailed'), errorText(state.bootError)),
      h('p'), h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => location.reload() }, icon('arrow-repeat'), t('common.reload')))));
    return;
  }
  window.addEventListener('hashchange', () => route());
  route(true);
  // Once the first screen is up, quietly fetch the screens this person can open.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  idle(() => {
    if (!state.session) return;
    PRIVATE.filter((r) => (!r.owner || isOwner()) && (!r.perm || r.perm.some(userCan))).forEach((r) => r.mod().catch(() => {}));
  }, { timeout: 4000 });
}

boot();
