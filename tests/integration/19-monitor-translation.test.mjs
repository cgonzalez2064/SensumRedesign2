// Monitoring charts (daily series, response time), the summary version for the
// "monitor" access, and automatic translation configured from the panel.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, createAdmin, ADMIN } from './helpers.mjs';
import { startDeepLStub, STUB_PANEL_KEY } from './deepl-stub.mjs';

let s; let stub; let owner; let watcher; let photos; let sales;
const WATCHER = { name: 'Mario Monitoreo', email: 'mario.monitoreo@example.test', password: 'Clave-Mario-Monitor-2026' };
const PHOTOS = { name: 'Fabi Fotos', email: 'fabi.fotos@example.test', password: 'Clave-Fabi-Fotos-2026' };
const SALES = { name: 'Vera Ventas', email: 'vera.ventas2@example.test', password: 'Clave-Vera-Ventas-2026' };
const now = () => Math.floor(Date.now() / 1000);
/** The site's calendar day (America/Guatemala, the server's APP_TIMEZONE) of a Unix time. */
const siteDay = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(new Date(ts * 1000));

before(async () => {
  stub = await startDeepLStub({ port: 8302 });
  // No DEEPL_API_KEY: the key is added from the panel.
  s = await startServer({ port: 8301, env: { DEEPL_API_URL: stub.url } });
  createAdmin(s); createAdmin(s, WATCHER); createAdmin(s, PHOTOS); createAdmin(s, SALES);
  s.sql(`UPDATE users SET role='editor', permissions='texts,monitor' WHERE email='${WATCHER.email}'`);
  s.sql(`UPDATE users SET role='editor', permissions='photos' WHERE email='${PHOTOS.email}'`);
  s.sql(`UPDATE users SET role='editor', permissions='leads' WHERE email='${SALES.email}'`);
  owner = new Client(s.base); await owner.login();
  watcher = new Client(s.base); await watcher.login(WATCHER.email, WATCHER.password);
  photos = new Client(s.base); await photos.login(PHOTOS.email, PHOTOS.password);
  sales = new Client(s.base); await sales.login(SALES.email, SALES.password);
});
after(async () => { await s.stop(); await stub.stop(); });

// ------------------------------------------------------------------ monitoring

test('every scheduled check times the home page (informational, never counted as downtime)', () => {
  const out = s.cli(['monitor']);
  assert.match(out, /Home page: HTTP 200 in \d+ ms/);
  const [ms, status, ok] = s.sql('SELECT response_ms, http_status, ok FROM monitor_runs ORDER BY id DESC LIMIT 1').split('|').map(Number);
  assert.ok(ms >= 0 && ms < 10000);
  assert.equal(status, 200);
  assert.equal(ok, 1);
});

test('daily series for the charts: checks, availability, response time, errors and (owner) sign-ins', async () => {
  const t0 = now();
  const day = 86400;
  // Two days ago: 4 checks, one failed, ~300 ms; yesterday: errors of each severity.
  s.sql(`INSERT INTO monitor_runs (created_at, ok, failed, response_ms, http_status) VALUES
    (${t0 - 2 * day}, 1, '', 200, 200), (${t0 - 2 * day + 1}, 1, '', 400, 200), (${t0 - 2 * day + 2}, 0, 'database', NULL, NULL), (${t0 - 2 * day + 3}, 1, '', 300, 200)`);
  s.sql(`INSERT INTO error_log (created_at, severity, source, event, message, location, request, ref, fingerprint, alert, details) VALUES
    (${t0 - day}, 'critical', 'server', 'unhandled_exception', 'RuntimeException: secret path /home/x', '', '', 'AAA111', 'f1', 'sent', '{}'),
    (${t0 - day}, 'error', 'server', 'mail_failed', 'Exception', '', '', NULL, 'f2', NULL, '{}'),
    (${t0 - day}, 'warning', 'system', 'disk_space_low', 'Free disk space: 100 MB', '', '', NULL, 'f3', NULL, '{}'),
    (${t0 - day}, 'warning', 'system', 'disk_space_low', 'Free disk space: 90 MB', '', '', NULL, 'f4', NULL, '{}')`);
  await new Client(s.base).login(ADMIN.email, 'contraseña-incorrecta');
  const r = await owner.get('/api/monitor/series?days=7');
  assert.equal(r.status, 200, r.text);
  const d = r.data.days;
  assert.equal(d.length, 7);
  assert.equal(d.at(-1).day, r.data.to);
  const two = d.find((x) => x.day === siteDay(t0 - 2 * day));
  assert.equal(two.checks, 4);
  assert.equal(two.ok, 3);
  assert.equal(two.availability, 75);
  assert.equal(two.responseMs, 300, 'average of the measured runs only');
  const one = d.find((x) => x.day === siteDay(t0 - day));
  assert.deepEqual([one.critical, one.error, one.warning], [1, 1, 2]);
  assert.ok(d.at(-1).logins >= 1 && d.at(-1).loginsFailed >= 1, 'owner sees sign-ins');
  assert.equal((await owner.get('/api/monitor/series?days=5')).data.days.length, 30, 'only 7, 30 or 90');
  assert.equal((await owner.get('/api/monitor/series?days=90')).data.days.length, 90);
});

test('summary version: only for the "monitor" access; counts and dates, no messages or sign-ins', async () => {
  for (const c of [photos, sales]) {
    assert.equal((await c.get('/api/monitor/overview')).status, 403);
    assert.equal((await c.get('/api/monitor/series')).status, 403);
  }
  assert.equal((await new Client(s.base).get('/api/monitor/overview')).status, 401);
  let o = await watcher.get('/api/monitor/overview');
  assert.equal(o.status, 200, o.text);
  assert.equal(o.data.status, 'ok', 'nothing critical in the last 24 h');
  s.sql(`INSERT INTO error_log (created_at, severity, source, event, message, location, request, ref, fingerprint, alert, details) VALUES (${now() - 3600}, 'critical', 'server', 'unhandled_exception', 'RuntimeException: secret path /home/y', '', '', 'BBB222', 'f5', 'sent', '{}')`);
  o = await watcher.get('/api/monitor/overview');
  assert.equal(o.data.status, 'attention', 'a critical error in the last 24 h');
  const exp = s.sql(`SELECT (SELECT COUNT(*) FROM error_log WHERE severity='error' AND created_at > ${now() - 7 * 86400}) || '|' || (SELECT COUNT(*) FROM error_log WHERE severity='warning' AND created_at > ${now() - 7 * 86400})`).split('|').map(Number);
  assert.deepEqual(o.data.errors7, { critical: 2, error: exp[0], warning: exp[1] }); // the scheduled check may add its own warnings
  assert.ok(o.data.availability30 > 0 && o.data.availability30 < 100);
  assert.ok(o.data.responseMs7 > 0);
  assert.ok(o.data.lastCheckAt > 0);
  assert.ok(!/RuntimeException|secret path|Free disk space|AAA111|BBB222/.test(o.text), 'no error messages or references');
  const series = await watcher.get('/api/monitor/series?days=7');
  assert.equal(series.status, 200);
  assert.ok(!('logins' in series.data.days[0]), 'no sign-in figures');
  assert.ok(!/RuntimeException/.test(series.text));
  // The full Monitoring stays owner-only.
  for (const p of ['/api/monitor/summary', '/api/monitor/errors', '/api/monitor/integrity']) assert.equal((await watcher.get(p)).status, 403, p);
  // The owner can open both.
  assert.equal((await owner.get('/api/monitor/overview')).status, 200);
});

test('"monitor" is a regular access: part of full access and of custom choices', async () => {
  const list = (await owner.get('/api/users')).data;
  assert.ok(list.permissions.includes('monitor'));
  assert.ok(list.accessTypes.full.includes('monitor'));
  const id = Number(s.sql(`SELECT id FROM users WHERE email='${PHOTOS.email}'`));
  assert.equal((await owner.put(`/api/users/${id}`, { permissions: ['photos', 'monitor'] })).status, 200);
  const again = new Client(s.base); await again.login(PHOTOS.email, PHOTOS.password);
  assert.deepEqual((await again.get('/api/auth/session')).data.user.permissions, ['photos', 'monitor']);
  assert.equal((await again.get('/api/monitor/overview')).status, 200);
  assert.equal((await owner.put(`/api/users/${id}`, { permissions: ['photos'] })).status, 200);
});

// ------------------------------------------------------------------ translation from the panel

test('translation settings: owner only; the key is saved encrypted and never returned', async () => {
  assert.equal((await watcher.get('/api/settings/translation')).status, 403);
  let tr = (await owner.get('/api/settings/translation')).data.translation;
  assert.deepEqual([tr.active, tr.source, tr.keyHint], [false, 'none', null]);
  assert.equal((await owner.get('/api/auth/session')).data.app.translation, false);
  assert.equal((await owner.put('/api/settings/translation', { enabled: true, key: STUB_PANEL_KEY, currentPassword: 'mal' })).status, 422);
  const bad = await owner.put('/api/settings/translation', { enabled: true, key: 'no es una clave', currentPassword: ADMIN.password });
  assert.equal(bad.status, 422);
  assert.equal(bad.data.fields.key, 'invalid');
  const ok = await owner.put('/api/settings/translation', { enabled: true, key: STUB_PANEL_KEY, currentPassword: ADMIN.password });
  assert.equal(ok.status, 200, ok.text);
  tr = ok.data.translation;
  assert.deepEqual([tr.active, tr.source, tr.plan], [true, 'panel', 'DeepL API Free']);
  assert.equal(tr.keyHint, '••••' + STUB_PANEL_KEY.slice(-6));
  assert.ok(!ok.text.includes(STUB_PANEL_KEY.slice(0, 20)), 'the key is never sent back');
  assert.ok(!s.sql("SELECT value FROM settings WHERE key='translation'").includes(STUB_PANEL_KEY.slice(0, 20)), 'stored encrypted');
  assert.ok(!s.sql("SELECT details FROM activity_log WHERE action='translation_settings_changed'").includes(STUB_PANEL_KEY.slice(0, 8)));
  assert.equal((await watcher.get('/api/auth/session')).data.app.translation, true, 'editors see translation on');
  const test = await owner.post('/api/settings/translation/test', {});
  assert.equal(test.status, 200, test.text);
  assert.deepEqual([test.data.plan, test.data.used, test.data.limit], ['DeepL API Free', 1234, 500000]);
  assert.match(test.data.sample, /^EN: Construimos tu proyecto/);
  // Saving again without a key keeps it.
  assert.equal((await owner.put('/api/settings/translation', { enabled: true, currentPassword: ADMIN.password })).data.translation.source, 'panel');
});

test('editors of photos and form options translate plain labels; others cannot use the quota', async () => {
  const r = await photos.post('/api/content/translate', { from: 'es', to: 'en', items: [{ text: 'Cocina remodelada con granito' }] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.translations[0].text, 'EN: Cocina remodelada con granito');
  assert.equal(r.data.translations[0].key, null);
  const keyed = await watcher.post('/api/content/translate', { from: 'es', to: 'en', items: [{ key: 'hero.title', text: 'Construimos con *precisión*' }] });
  assert.equal(keyed.status, 200, keyed.text);
  assert.equal((await watcher.post('/api/content/translate', { from: 'es', to: 'en', items: [{ key: 'no.such.field', text: 'x' }] })).status, 400);
  assert.equal((await photos.post('/api/content/translate', { from: 'es', to: 'en', items: [{ key: 'hero.title', text: 'Hola' }] })).status, 403, 'site texts need the texts access');
  assert.equal((await photos.post('/api/content/translate', { from: 'es', to: 'en', items: [{ text: '<b>x</b>' }] })).status, 422);
  assert.equal((await sales.post('/api/content/translate', { from: 'es', to: 'en', items: [{ text: 'Hola' }] })).status, 403, 'no editing access, no translation');
});

test('switching it off (or removing the key) turns translation off for everyone', async () => {
  assert.equal((await owner.put('/api/settings/translation', { enabled: false, currentPassword: ADMIN.password })).data.translation.active, false);
  assert.equal((await photos.post('/api/content/translate', { from: 'es', to: 'en', items: [{ text: 'Hola' }] })).status, 503);
  assert.equal((await watcher.get('/api/auth/session')).data.app.translation, false);
  const removed = await owner.put('/api/settings/translation', { enabled: true, removeKey: true, currentPassword: ADMIN.password });
  assert.deepEqual([removed.data.translation.source, removed.data.translation.active], ['none', false]);
  assert.equal((await owner.post('/api/settings/translation/test', {})).status, 503);
});
