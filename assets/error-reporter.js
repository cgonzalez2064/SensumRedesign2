/* ============================================================
   Optional JavaScript error reporting for the public site.
   Only included in the pages when PUBLIC_ERROR_REPORTING=true in the
   Content Manager's server configuration (see docs/CONTENT_MANAGER.md).
   Sends the error message, script location and page path — never form
   values, cookies, storage contents or query strings — to the site's own
   /api/telemetry/error endpoint (allowed by the existing connect-src 'self'
   CSP). At most 3 reports per page view; any failure is silently ignored
   so it can never affect the visitor's experience.
   ============================================================ */
(function () {
  'use strict';
  if (!window.navigator || typeof window.navigator.sendBeacon !== 'function') return;
  var sent = 0;
  var seen = {};
  function report(message, where) {
    try {
      if (sent >= 3 || !message) return;
      var key = message + '|' + where;
      if (seen[key]) return;
      seen[key] = true;
      sent++;
      var body = JSON.stringify({
        source: 'public',
        message: String(message).slice(0, 300),
        location: String(where || '').slice(0, 200),
        page: window.location.pathname
      });
      navigator.sendBeacon('/api/telemetry/error', new Blob([body], { type: 'application/json' }));
    } catch (e) { /* never interfere with the page */ }
  }
  window.addEventListener('error', function (e) {
    var file = String(e.filename || '').replace(window.location.origin, '').split('?')[0];
    report(e.message, file + ':' + (e.lineno || 0) + ':' + (e.colno || 0));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    report('Unhandled promise rejection: ' + (r && r.message ? r.message : String(r)), 'promise');
  });
})();
