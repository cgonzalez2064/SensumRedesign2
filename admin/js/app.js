/**
 * Sensum — Administrador de contenido (single-page app, no build step).
 * Hash routes keep reset/invitation tokens out of server logs and referrers.
 */
import { h, icon, clear, initials } from './dom.js';
import { t, setLang, getLang, onLangChange } from './i18n.js';
import { initTheme, setThemePref, getThemePref } from './theme.js';
import { api, setCsrf, onSessionExpired } from './api.js';
import { toast, openDialog, confirmDialog, dropdown, segmented, passwordField, textField, setBusy, errorText, alertBox } from './ui.js';
import { initTelemetry } from './telemetry.js';
import { openReportDialog } from './report.js';
import * as authViews from './views/auth.js';
import * as dashboard from './views/dashboard.js';
import * as content from './views/content.js';
import * as media from './views/media.js';
import * as users from './views/users.js';
import * as account from './views/account.js';
import * as reports from './views/reports.js';
import * as help from './views/help.js';

const state = { session: null, setupRequired: false, view: null, shell: null, path: null, skipGuard: false };

// --------------------------------------------------------------- routes
const PUBLIC = [
  { re: /^\/ingresar$/, view: authViews.login },
  { re: /^\/recuperar$/, view: authViews.forgot },
  { re: /^\/restablecer\/([A-Za-z0-9_-]+)$/, view: authViews.reset },
  { re: /^\/invitacion\/([A-Za-z0-9_-]+)$/, view: authViews.invitation },
  { re: /^\/configurar$/, view: authViews.setup },
];
const PRIVATE = [
  { re: /^\/$/, view: dashboard.render, nav: 'dashboard' },
  { re: /^\/textos$/, view: content.list, nav: 'content' },
  { re: /^\/textos\/([a-z]+)$/, view: content.editor, nav: 'content' },
  { re: /^\/contacto$/, view: content.details, nav: 'details' },
  { re: /^\/fotos(?:\/(nosotros|proyectos|documentos))?$/, view: media.render, nav: 'media' },
  { re: /^\/usuarios$/, view: users.render, nav: 'users', admin: true },
  { re: /^\/reportes$/, view: reports.render, nav: 'reports' },
  { re: /^\/cuenta$/, view: account.render, nav: 'account' },
  { re: /^\/ayuda$/, view: help.render, nav: 'help' },
];

const currentPath = () => {
  const raw = (location.hash || '#/').slice(1) || '/';
  return raw.startsWith('/') ? raw : '/' + raw;
};
export const navigate = (path) => { location.hash = '#' + path; };
export const isAdmin = () => !!(state.session && state.session.user.role === 'admin');

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
  if (state.shell) renderShell();
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
        const data = await api.post('/auth/login', { email: emailF.input.value, password: pwF.input.value }, { auth: false });
        setSession(data);
        ok = true;
        resolve();
        dlg.close();
      } catch (err) {
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
  return h('a', { href: '#' + path, 'aria-current': active === key ? 'page' : null, onclick: closeNav }, icon(ic), h('span', { text: t('nav.' + key) }));
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

function renderShell(activeNav) {
  const app = document.getElementById('app');
  const user = state.session.user;
  const active = activeNav ?? (state.shell && state.shell.active);
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
      h('div', { class: 'nav-section', text: t('nav.groupSite') }),
      navLink('/textos', 'content', 'pencil-square', active),
      navLink('/fotos', 'media', 'images', active),
      navLink('/contacto', 'details', 'telephone', active),
      user.role === 'admin' ? [h('div', { class: 'nav-section', text: t('nav.groupAdmin') }), navLink('/usuarios', 'users', 'people', active)] : null,
      h('div', { class: 'nav-section', text: t('nav.groupSupport') }),
      navLink('/reportes', 'reports', 'chat-square-text', active),
      navLink('/ayuda', 'help', 'question-circle', active),
      navLink('/cuenta', 'account', 'person-circle', active)),
    h('div', { class: 'sidebar-foot' },
      h('button', { class: 'btn btn-block', type: 'button', onclick: () => { closeNav(); openReportDialog(); } }, icon('life-preserver'), t('topbar.report')),
      h('a', { class: 'btn btn-ghost btn-block', href: siteUrl, target: '_blank', rel: 'noopener' }, icon('box-arrow-up-right'), t('app.viewSite')),
      h('span', { class: 'tiny muted', text: t('app.version', { v: (state.session.app && state.session.app.version) || '' }) })));

  const scrim = h('div', { class: 'scrim', onclick: closeNav });
  const main = h('main', { class: 'main', id: 'main', tabindex: '-1' });
  const offline = h('div', { class: 'main', hidden: navigator.onLine !== false, role: 'status' }, alertBox('warn', null, t('app.offline')));
  sidebar.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sidebar.classList.contains('open')) { closeNav(); openBtn.focus(); } });

  clear(app).append(h('a', { class: 'skip-link', href: '#main', onclick: (e) => { e.preventDefault(); main.focus(); } }, t('app.skip')),
    h('div', { class: 'app' }, sidebar, topbar, h('div', null, offline, main)), scrim);
  state.shell = { main, sidebar, scrim, openBtn, active, offline };
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
    clear(app);
    const view = (await pub.view({ app, params: path.match(pub.re).slice(1), setupRequired: state.setupRequired, onSignedIn })) || null;
    if (!stale()) state.view = view;
    return;
  }

  if (!state.session) {
    if (path !== '/') try { sessionStorage.setItem('sensum_after_login', path); } catch (e) { /* ignore */ }
    return navigate(state.setupRequired ? '/configurar' : '/ingresar');
  }

  const priv = PRIVATE.find((r) => r.re.test(path));
  const main = renderShell(priv ? priv.nav : null);
  if (!priv || (priv.admin && !isAdmin())) {
    main.append(h('div', { class: 'card empty' }, h('span', { class: 'icon-tile' }, icon('exclamation-circle')),
      h('h1', { tabindex: '-1', text: t('notFound.title') }), h('p', { text: t('notFound.body') }),
      h('a', { class: 'btn btn-primary', href: '#/' }, t('notFound.home'))));
    document.title = t('notFound.title') + ' · ' + t('app.name');
    focusHeading(main);
    return;
  }
  const view = (await priv.view({ main, params: path.match(priv.re).slice(1), session: state.session, navigate, isAdmin: isAdmin() })) || null;
  if (stale()) {
    if (view && view.destroy) view.destroy();
    return;
  }
  state.view = view;
  focusHeading(main);
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
  onSessionExpired(relogin);
  onLangChange(() => { state.path = null; route(true); });
  window.addEventListener('online', () => { if (state.shell) state.shell.offline.hidden = true; });
  window.addEventListener('offline', () => { if (state.shell) state.shell.offline.hidden = false; });
  await loadSession();
  if (state.bootError && !state.session) {
    const app = document.getElementById('app');
    clear(app).append(h('div', { class: 'auth' }, h('div', { class: 'auth-card' },
      alertBox('bad', t('common.loadFailed'), errorText(state.bootError)),
      h('p'), h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => location.reload() }, icon('arrow-repeat'), t('common.reload')))));
    return;
  }
  window.addEventListener('hashchange', () => route());
  route(true);
}

boot();
