/** Localization runtime. All strings come from i18n/es.js and i18n/en.js. */
import es from './i18n/es.js';
import en from './i18n/en.js';

const DICTS = { es, en };
const KEY = 'sensum_admin_lang';
let lang = 'es';
try { lang = localStorage.getItem(KEY) === 'en' ? 'en' : 'es'; } catch (e) { /* storage unavailable */ }
const listeners = new Set();

const lookup = (dict, key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), dict);

export function interpolate(s, vars) {
  return vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m)) : String(s);
}

/** t('auth.submit'), t('dashboard.hello', { name }) — falls back to Spanish, then to the key. */
export function t(key, vars) {
  let v = lookup(DICTS[lang], key);
  if (v === undefined) v = lookup(DICTS.es, key);
  if (v === undefined) return key;
  return typeof v === 'string' ? interpolate(v, vars) : v;
}

/** Content-field label/help. Keys like "service3.title" fall back to "service#.title". */
export function fieldText(key) {
  const d = DICTS[lang].fields;
  const exact = d[key];
  if (exact) return { label: exact[0], help: exact[1] };
  const m = key.match(/(\d+)/);
  const generic = d[key.replace(/\d+/, '#')];
  if (generic) return { label: interpolate(generic[0], { n: m ? m[1] : '' }), help: generic[1] };
  return { label: key, help: null };
}

export const getLang = () => lang;
export const locale = () => (lang === 'en' ? 'en-US' : 'es-GT');

export function setLang(next) {
  const value = next === 'en' ? 'en' : 'es';
  if (value === lang) {
    try { localStorage.setItem(KEY, lang); } catch (e) { /* ignore */ }
    return;
  }
  lang = value;
  try { localStorage.setItem(KEY, lang); } catch (e) { /* ignore */ }
  document.documentElement.lang = lang;
  listeners.forEach((fn) => fn(lang));
}
export const onLangChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export function fmtDate(ts, withTime = true) {
  if (!ts) return t('common.never');
  const opts = withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' };
  return new Intl.DateTimeFormat(locale(), opts).format(new Date(ts * 1000));
}

export function fmtRelative(ts) {
  if (!ts) return t('common.never');
  const diff = Math.max(0, Date.now() / 1000 - ts);
  if (diff < 60) return t('common.justNow');
  if (diff < 3600) return t('common.minutesAgo', { n: Math.round(diff / 60) });
  if (diff < 86400) return t('common.hoursAgo', { n: Math.round(diff / 3600) });
  if (diff < 86400 * 7) return t('common.daysAgo', { n: Math.round(diff / 86400) });
  return fmtDate(ts, false);
}

export function fmtBytes(n) {
  if (!n && n !== 0) return '';
  const nf = (v, d) => new Intl.NumberFormat(locale(), { maximumFractionDigits: d }).format(v);
  if (n >= 1048576) return nf(n / 1048576, 1) + ' MB';
  if (n >= 1024) return nf(n / 1024, 0) + ' KB';
  return nf(n, 0) + ' B';
}
