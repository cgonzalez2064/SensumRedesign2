/* Applies the saved theme before first paint (no light/dark flash).
   Kept as a tiny classic script because the CSP forbids inline scripts. */
(function () {
  var pref = 'system';
  try { pref = localStorage.getItem('sensum_admin_theme') || 'system'; } catch (e) {}
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  var lang = 'es';
  try { lang = localStorage.getItem('sensum_admin_lang') === 'en' ? 'en' : 'es'; } catch (e) {}
  document.documentElement.lang = lang;
})();
