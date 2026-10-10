/* ============================================================
   Cookie-free visit statistics (the Content Manager's "Estadísticas").
   Included only while the owner keeps statistics on in the panel.
   Sends one small beacon per page view, and one per click on WhatsApp,
   phone, e-mail, map, social links or the PDF portfolio, to this site's
   own /api/collect (allowed by the existing connect-src 'self' CSP).

   Sent: which page (home / privacy / not found), the referring site
   (reduced to a fixed list of sources on the server), the window width
   (mobile / tablet / desktop) and the page language. Never sent: cookies,
   storage, form values, the full address or anything typed. Nothing at
   all is sent when the browser asks not to be tracked (Do Not Track or
   Global Privacy Control), for automated browsers, or for previews.
   Any failure is ignored so it can never affect the page.
   ============================================================ */
(function () {
  'use strict';
  try {
    var nav = window.navigator || {};
    if (typeof nav.sendBeacon !== 'function') return;
    if (nav.doNotTrack === '1' || window.doNotTrack === '1' || nav.globalPrivacyControl === true) return;
    if (nav.webdriver || document.visibilityState === 'prerender') return;
  } catch (e) { return; }

  var path = window.location.pathname.replace(/\/index\.html$/, '/');
  var page = /(^|\/)$/.test(path) ? 'home' : (/privacy-notice\.html$/.test(path) ? 'privacy' : 'notfound');

  function send(data) {
    try {
      data.page = page;
      navigator.sendBeacon('/api/collect', new Blob([JSON.stringify(data)], { type: 'application/json' }));
    } catch (e) { /* never interfere with the page */ }
  }

  function lang() {
    return /^en/i.test(document.documentElement.lang || '') ? 'en' : 'es';
  }

  var utm = '';
  try { utm = (new URLSearchParams(window.location.search).get('utm_source') || '').slice(0, 30); } catch (e) { /* old browser */ }
  send({ type: 'view', ref: String(document.referrer || '').slice(0, 300), utm: utm, w: Math.round(window.innerWidth || 0), lang: lang() });

  /* Clicks that turn a visit into a contact. */
  function kind(a) {
    var href = (a.getAttribute('href') || '').toLowerCase();
    if (/^https:\/\/(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\//.test(href)) return 'whatsapp';
    if (href.indexOf('tel:') === 0) return 'phone';
    if (href.indexOf('mailto:') === 0) return 'email';
    if (/^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.|maps\.app\.goo\.gl|goo\.gl\/maps|waze\.com)/.test(href)) return 'map';
    if (/^https:\/\/(www\.)?(facebook\.com|instagram\.com|linkedin\.com|youtube\.com|tiktok\.com)\//.test(href)) return 'social';
    if (/\.pdf($|[?#])/.test(href)) return 'portfolio';
    return '';
  }
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    var what = a ? kind(a) : '';
    if (what) send({ type: 'click', what: what });
  }, true);
})();
