// Monitoring: owner-only error log, critical-error alerts by e-mail (throttled), the scheduled check.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { startServer, Client, createAdmin, ADMIN, ROOT, PHP, mailpitUp, waitForMail, message, countTo } from './helpers.mjs';

const RUN = Date.now().toString(36);
const OTHER_ADMIN = { name: 'Otra Admin', email: 'otra.admin@example.test', password: 'Clave-Otra-Admin-2026' };
const EDITOR = { name: 'Edu Editor', email: 'edu.editor@example.test', password: 'Clave-Edu-Editor-2026' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let s; let owner; let other; let editor; let alertsTo;
before(async () => {
  assert.ok(await mailpitUp(), 'Mailpit must be running (mailpit &)');
  alertsTo = `alerts-${RUN}@example.test`;
  s = await startServer({ port: 8221, env: { ALERT_EMAIL: alertsTo } });
  createAdmin(s);
  createAdmin(s, OTHER_ADMIN);
  createAdmin(s, EDITOR);
  s.sql(`UPDATE users SET role='editor' WHERE email='${EDITOR.email}'`);
  s.cli(['publish']);
  owner = new Client(s.base); await owner.login();
  other = new Client(s.base); await other.login(OTHER_ADMIN.email, OTHER_ADMIN.password);
  editor = new Client(s.base); await editor.login(EDITOR.email, EDITOR.password);
});
after(async () => { await s.stop(); });

const version = async (c, id) => (await c.get('/api/content')).data.sections.find((x) => x.id === id).version;
/** Makes publishing fail (read-only public folder) so a save becomes an unexpected server error. */
async function failingSave(server, client, text) {
  chmodSync(server.public(), 0o555);
  try {
    return await client.put('/api/content/footer', { version: await version(client, 'footer'), values: { 'footer.about_desc': { es: text } } });
  } finally {
    chmodSync(server.public(), 0o755);
  }
}

test('Monitoring and the error log are for the owner account only', async () => {
  assert.equal((await owner.get('/api/auth/session')).data.user.owner, true);
  assert.equal((await other.get('/api/auth/session')).data.user.owner, false);
  const sum = await owner.get('/api/monitor/summary');
  assert.equal(sum.status, 200);
  for (const k of ['health', 'system', 'alerts', 'counts', 'top']) assert.ok(k in sum.data, k);
  assert.equal(sum.data.alerts.recipient, alertsTo);
  assert.equal((await owner.get('/api/monitor/errors')).status, 200);
  for (const c of [other, editor]) {
    assert.equal((await c.get('/api/monitor/summary')).status, 403);
    assert.equal((await c.get('/api/monitor/errors')).status, 403);
    assert.equal((await c.post('/api/monitor/test-alert', {})).status, 403);
  }
  assert.equal((await new Client(s.base).get('/api/monitor/errors')).status, 401);
  // Dashboard: diagnostics and errors only for the owner.
  const od = (await owner.get('/api/dashboard')).data;
  assert.ok(Array.isArray(od.errors) && od.health.checks);
  const ad = (await other.get('/api/dashboard')).data;
  assert.equal(ad.errors, undefined);
  assert.equal(ad.health.checks, undefined);
  assert.ok(Array.isArray(ad.activity), 'other admins still see activity');
});

test('other administrators cannot demote, disable or delete the owner', async () => {
  const me = (await owner.get('/api/users')).data.users.find((u) => u.isSelf);
  assert.equal(me.isOwner, true);
  for (const body of [{ role: 'editor' }, { status: 'disabled' }]) {
    const r = await other.put(`/api/users/${me.id}`, body);
    assert.equal(r.status, 422);
    assert.equal(r.data.fields.user, 'owner_protected');
  }
  assert.equal((await other.del(`/api/users/${me.id}`)).data.fields.user, 'owner_protected');
  // The owner can still manage the other accounts.
  const otherId = (await owner.get('/api/users')).data.users.find((u) => u.email === OTHER_ADMIN.email).id;
  assert.equal((await owner.put(`/api/users/${otherId}`, { role: 'admin' })).status, 200);
});

test('a critical error is logged with its details and e-mailed to IT once (throttled)', async () => {
  const before = await countTo(alertsTo);
  const r = await failingSave(s, owner, 'Texto que no se puede publicar');
  assert.equal(r.status, 500);
  assert.match(r.data.ref, /^[0-9A-F]{6}$/);

  const list = (await owner.get('/api/monitor/errors?severity=critical&q=' + r.data.ref)).data;
  assert.equal(list.total, 1);
  const e = list.items[0];
  assert.equal(e.event, 'unhandled_exception');
  assert.equal(e.source, 'server');
  assert.match(e.message, /RuntimeException: publish_write_failed/);
  assert.match(e.location, /Publisher\.php:\d+/);
  assert.equal(e.request, 'PUT /api/content/footer');
  assert.equal(e.user, ADMIN.name);

  const msgs = await waitForMail(alertsTo, before + 1);
  const mail = await message(msgs[0].ID);
  assert.match(mail.Subject, /^\[Sensum Website\] Error crítico: Error inesperado del servidor$/);
  assert.ok(mail.Text.includes(r.data.ref), 'reference code in the alert');
  assert.ok(mail.Text.includes('PUT /api/content/footer'));
  assert.ok(mail.Text.includes('/admin/#/monitoreo'));
  for (const secret of [ADMIN.password, owner.csrf, owner.cookieHeader().split('=')[1]]) assert.ok(!mail.Text.includes(secret), 'no secrets in alerts');
  assert.equal((await owner.get('/api/monitor/errors?q=' + r.data.ref)).data.items[0].alert, 'sent');

  // Same error again within the cooldown: logged, but no second e-mail.
  const again = await failingSave(s, owner, 'Texto que no se puede publicar');
  await sleep(1200);
  assert.equal(await countTo(alertsTo), before + 1);
  assert.equal((await owner.get('/api/monitor/errors?q=' + again.data.ref)).data.items[0].alert, 'suppressed');

  // After the cooldown, the next alert reports the suppressed repeat.
  const stateFile = s.storage('alert-state.json');
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  for (const fp of Object.keys(state.fp)) state.fp[fp].last = 0;
  writeFileSync(stateFile, JSON.stringify(state));
  await failingSave(s, owner, 'Texto que no se puede publicar');
  const third = await message((await waitForMail(alertsTo, before + 2))[0].ID);
  assert.match(third.Text, /Repeticiones desde la alerta anterior \(no notificadas\): 1/);
});

test('a failing health check is critical: logged once per 15 minutes and alerted', async () => {
  const before = await countTo(alertsTo);
  chmodSync(s.public(), 0o555);
  try {
    for (let i = 0; i < 3; i++) assert.equal((await new Client(s.base).get('/api/health')).status, 503);
  } finally {
    chmodSync(s.public(), 0o755);
  }
  const list = (await owner.get('/api/monitor/errors?q=health_degraded')).data;
  assert.equal(list.total, 1, 'one entry for repeated polling');
  assert.match(list.items[0].message, /Failed checks: publishing/);
  const mail = await message((await waitForMail(alertsTo, before + 1))[0].ID);
  assert.match(mail.Subject, /El diagnóstico del sistema tiene fallas/);
});

test('browser errors and e-mail failures are logged as errors without alerts', async () => {
  await new Client(s.base).post('/api/telemetry/error', { source: 'admin', message: 'TypeError: boom ' + RUN, location: 'js/app.js:1:1', page: '/admin/' });
  const e = (await owner.get('/api/monitor/errors?q=boom ' + RUN)).data.items[0];
  assert.equal(e.severity, 'error');
  assert.equal(e.source, 'admin');
  assert.equal(e.event, 'client_error');
  assert.equal(e.alert, null);
});

test('the error log can be filtered, searched and paged', async () => {
  const now = Math.floor(Date.now() / 1000);
  const rows = Array.from({ length: 30 }, (_, i) => `(${now - i}, 'warning', 'system', 'test_event', 'paging ${RUN} ${i}', 'fp${i}', '{}')`).join(',');
  s.sql(`INSERT INTO error_log (created_at, severity, source, event, message, fingerprint, details) VALUES ${rows}`);
  const p1 = (await owner.get(`/api/monitor/errors?q=paging ${RUN}`)).data;
  assert.equal(p1.total, 30);
  assert.equal(p1.items.length, 25);
  assert.equal(p1.pages, 2);
  const p2 = (await owner.get(`/api/monitor/errors?q=paging ${RUN}&page=2`)).data;
  assert.equal(p2.items.length, 5);
  assert.equal((await owner.get(`/api/monitor/errors?q=paging ${RUN}&severity=critical`)).data.total, 0);
  assert.equal((await owner.get(`/api/monitor/errors?q=paging ${RUN}&source=system&severity=warning`)).data.total, 30);
  // Hostile filter values are ignored, never break the query.
  assert.equal((await owner.get("/api/monitor/errors?severity=x'--&source[]=1&days=abc&page=-5&q=%25%27")).status, 200);
});

test('the owner can send a test alert (limited to 3 per hour)', async () => {
  const before = await countTo(alertsTo);
  const r = await owner.post('/api/monitor/test-alert', {});
  assert.equal(r.status, 200);
  assert.equal(r.data.sent, true);
  const mail = await message((await waitForMail(alertsTo, before + 1))[0].ID);
  assert.match(mail.Subject, /Prueba de alertas/);
  await owner.post('/api/monitor/test-alert', {});
  await owner.post('/api/monitor/test-alert', {});
  assert.equal((await owner.post('/api/monitor/test-alert', {})).status, 429);
});

test('PHP fatal errors are captured as critical', async () => {
  const script = `
    require 'cms/vendor/autoload.php';
    $app = Sensum\\Cms\\App::boot(getcwd() . '/cms');
    $k = new Sensum\\Cms\\Api\\Kernel($app);
    $k->recordFatal(['type' => E_ERROR, 'message' => 'Allowed memory size exhausted', 'file' => '/x/ImageProcessor.php', 'line' => 42],
      new Sensum\\Cms\\Http\\Request('POST', '/api/media/proj1.card/upload', [], [], [], [], ''));`;
  const before = await countTo(alertsTo);
  execFileSync(PHP, ['-r', script], { cwd: ROOT, env: s.env });
  const e = (await owner.get('/api/monitor/errors?q=Allowed memory')).data.items[0];
  assert.equal(e.event, 'php_fatal');
  assert.equal(e.severity, 'critical');
  assert.equal(e.location, 'ImageProcessor.php:42');
  assert.match((await message((await waitForMail(alertsTo, before + 1))[0].ID)).Subject, /Error fatal de PHP/);
});

test('when e-mail is down, alerts are kept as failed and the scheduled check re-sends them', async () => {
  const to = `alerts-down-${RUN}@example.test`;
  const down = await startServer({ port: 8222, smtpDown: true, env: { ALERT_EMAIL: to } });
  try {
    createAdmin(down);
    down.cli(['publish']);
    const c = new Client(down.base); await c.login();
    const r = await failingSave(down, c, 'Sin correo');
    await sleep(500);
    const e = (await c.get('/api/monitor/errors?q=' + r.data.ref)).data.items[0];
    assert.equal(e.alert, 'failed');
    assert.ok((await c.get('/api/monitor/errors?q=mail_failed')).data.total >= 1, 'the SMTP failure itself is logged');
    // Mail is back: `monitor` (cron) sends one summary and marks them sent.
    const out = execFileSync(PHP, ['cms/bin/console', 'monitor'], { cwd: ROOT, env: { ...down.env, SMTP_PORT: '1025' } }).toString();
    assert.match(out, /Failed alerts re-sent: 1/);
    assert.match(out, /Health: ok/);
    const digest = await message((await waitForMail(to, 1))[0].ID);
    assert.match(digest.Subject, /1 alerta\(s\) crítica\(s\) que no se pudieron enviar/);
    assert.ok(digest.Text.includes(r.data.ref));
    assert.equal((await c.get('/api/monitor/errors?q=' + r.data.ref)).data.items[0].alert, 'sent');
    assert.ok(Number(down.sql("SELECT value FROM settings WHERE key='monitor_last_run'")) > 0);
  } finally {
    await down.stop();
  }
});

test('daily alert cap, alerts off, and log retention', async () => {
  const to = `alerts-cap-${RUN}@example.test`;
  const p = await startServer({ port: 8223, env: { ALERT_EMAIL: to, ALERT_DAILY_MAX: '1', ALERT_COOLDOWN_MINUTES: '0', ERROR_LOG_DAYS: '30' } });
  try {
    createAdmin(p);
    p.cli(['publish']);
    const c = new Client(p.base); await c.login();
    await failingSave(p, c, 'uno');
    await failingSave(p, c, 'dos');
    await sleep(1200);
    assert.equal(await countTo(to), 1, 'second critical error suppressed by the daily cap');
    assert.deepEqual((await c.get('/api/monitor/errors?severity=critical')).data.items.map((x) => x.alert), ['suppressed', 'sent']);
    // Retention: entries older than ERROR_LOG_DAYS are removed by the scheduled check.
    p.sql(`INSERT INTO error_log (created_at, severity, source, event, message, fingerprint) VALUES (${Math.floor(Date.now() / 1000) - 40 * 86400}, 'error', 'server', 'old', 'old entry', 'old')`);
    assert.match(p.cli(['monitor']), /Old error-log entries removed: 1/);
  } finally {
    await p.stop();
  }
  const off = await startServer({ port: 8224, env: { ALERTS_ENABLED: 'false' } });
  try {
    createAdmin(off);
    off.cli(['publish']);
    const c = new Client(off.base); await c.login();
    const r = await failingSave(off, c, 'sin alertas');
    assert.equal((await c.get('/api/monitor/errors?q=' + r.data.ref)).data.items[0].alert, 'off');
    assert.equal((await c.post('/api/monitor/test-alert', {})).status, 409);
  } finally {
    await off.stop();
  }
});
