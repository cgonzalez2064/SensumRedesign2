/** Light / dark / system theme, persisted per device (and in the user profile). */
const KEY = 'sensum_admin_theme';
const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function getThemePref() {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch (e) { return 'system'; }
}

function apply(pref) {
  const dark = pref === 'dark' || (pref === 'system' && media && media.matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#121110' : '#1c1c1c');
}

export function setThemePref(pref) {
  const p = pref === 'light' || pref === 'dark' ? pref : 'system';
  try { localStorage.setItem(KEY, p); } catch (e) { /* ignore */ }
  apply(p);
}

export function initTheme() {
  apply(getThemePref());
  if (media && media.addEventListener) media.addEventListener('change', () => { if (getThemePref() === 'system') apply('system'); });
  // Enable color transitions only after the first paint (no flash on load).
  requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add('theme-ready')));
}
