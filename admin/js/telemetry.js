/**
 * Sends uncaught JavaScript errors from the admin panel to /api/telemetry/error
 * so they appear under "Errores recientes" on the dashboard. Never sends form
 * values, cookies, storage or tokens; at most 5 reports per page load.
 * If the endpoint is unavailable nothing else is affected.
 */
let sent = 0;
const seen = new Set();

/** Current screen without any token (reset/invitation links). */
export function safeRoute() {
  return (location.hash || '#/').replace(/\/(restablecer|invitacion)\/[^/?#]+/, '/$1/…').slice(0, 120);
}

function send(message, where) {
  if (sent >= 5) return;
  const key = message + '|' + where;
  if (seen.has(key)) return;
  seen.add(key);
  sent++;
  try {
    const body = JSON.stringify({ source: 'admin', message: String(message).slice(0, 300), location: String(where).slice(0, 200), page: location.pathname + safeRoute() });
    fetch('../api/telemetry/error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'same-origin' }).catch(() => {});
  } catch (e) { /* telemetry must never break the app */ }
}

export function initTelemetry() {
  window.addEventListener('error', (e) => {
    if (!e || !e.message) return;
    const file = (e.filename || '').replace(location.origin, '').split('?')[0];
    send(e.message, file + ':' + (e.lineno || 0) + ':' + (e.colno || 0));
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason;
    if (r && (r.name === 'ApiError' || r.code || r.message === 'relogin_cancelled')) return; // handled API errors are not bugs
    send('Unhandled promise rejection: ' + (r && r.message ? r.message : String(r)), 'promise');
  });
}

/** Non-sensitive technical context for support reports (shown to the user before sending). */
export function technicalContext(extra = {}) {
  const ua = navigator.userAgent || '';
  const browser = /Edg\/(\d+)/.test(ua) ? 'Edge ' + RegExp.$1
    : /OPR\/(\d+)/.test(ua) ? 'Opera ' + RegExp.$1
      : /Firefox\/(\d+)/.test(ua) ? 'Firefox ' + RegExp.$1
        : /(?:Chrome|CriOS)\/(\d+)/.test(ua) ? 'Chrome ' + RegExp.$1
          : /Version\/(\d+(?:\.\d+)?).*Safari/.test(ua) ? 'Safari ' + RegExp.$1 : 'Otro';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Otro';
  const w = window.innerWidth;
  const device = /Mobi|iPhone|Android.+Mobile/.test(ua) || w < 640 ? 'mobile' : (/iPad|Tablet/.test(ua) || w < 1024 ? 'tablet' : 'desktop');
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* ignore */ }
  return {
    browser, os, device,
    viewport: w + ' × ' + window.innerHeight,
    screen: screen.width + ' × ' + screen.height,
    dpr: String(Math.round((window.devicePixelRatio || 1) * 100) / 100),
    timezone: tz,
    locale: navigator.language || '',
    online: navigator.onLine === false ? 'offline' : 'online',
    route: safeRoute(),
    ...extra,
  };
}
