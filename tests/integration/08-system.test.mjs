// Dashboard, telemetry, optional public error reporting, publish safety and robustness.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, chmodSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, Client, createAdmin, ROOT } from './helpers.mjs';

let s; let c;
before(async () => {
  s = await startServer({ port: 8202 });
  createAdmin(s);
  c = new Client(s.base);
  await c.login();
  s.cli(['publish']);
});
after(async () => { await s.stop(); });

test('dashboard summarizes site status, health, activity and errors for admins', async () => {
  const r = await c.get('/api/dashboard');
  assert.equal(r.status, 200);
  assert.equal(r.data.site.inSync, true);
  assert.equal(r.data.health.status, 'ok');
  assert.ok(r.data.health.checks.database.ok);
  assert.ok(Array.isArray(r.data.activity));
  assert.deepEqual(r.data.telemetry, { publicErrors: false, analytics: false });
});

test('admin-panel JavaScript errors are recorded (grouped, tokens stripped)', async () => {
  const anon = new Client(s.base);
  for (let i = 0; i < 3; i++) {
    const r = await anon.post('/api/telemetry/error', { source: 'admin', message: 'TypeError: x is undefined token=abcdefghijklmnopqrstuvwxyz0123456789ABCD maria@example.test', location: 'js/app.js:10:5', page: '/admin/#/textos?x=1' });
    assert.equal(r.status, 202);
  }
  const dash = await c.get('/api/dashboard');
  const e = dash.data.errors.find((x) => x.source === 'admin');
  assert.equal(e.count, 3);
  assert.ok(!e.message.includes('abcdefghijklmnopqrstuvwxyz0123456789ABCD'), 'long tokens redacted');
  assert.ok(!e.message.includes('maria@example.test'), 'e-mails redacted');
  assert.equal((await anon.post('/api/telemetry/error', { source: 'evil', message: 'x' })).status, 400);
});

test('public-site error reports are ignored unless PUBLIC_ERROR_REPORTING is on', async () => {
  const anon = new Client(s.base);
  await anon.post('/api/telemetry/error', { source: 'public', message: 'ReferenceError: foo', location: '/assets/main.js:1:1', page: '/' });
  assert.ok(!(await c.get('/api/dashboard')).data.errors.some((x) => x.source === 'public'));
  assert.ok(!s.readPublic('index.html').includes('error-reporter.js'), 'script not included by default');
});

test('telemetry is throttled per visitor', async () => {
  const anon = new Client(s.base);
  for (let i = 0; i < 35; i++) await anon.post('/api/telemetry/error', { source: 'admin', message: 'flood ' + i, location: 'x', page: '/' });
  const n = Number(s.sql("SELECT COUNT(*) FROM error_events WHERE message LIKE 'flood%'"));
  assert.ok(n <= 30, `stored ${n}`);
});

test('with PUBLIC_ERROR_REPORTING=true the reporter is added and reports are stored', async () => {
  const p = await startServer({ port: 8203, env: { PUBLIC_ERROR_REPORTING: 'true', CF_WEB_ANALYTICS_TOKEN: '0123456789abcdef0123456789abcdef' } });
  try {
    p.cli(['publish']);
    const html = p.readPublic('index.html');
    assert.ok(html.includes('<script src="assets/error-reporter.js?v=3" defer></script>'));
    assert.ok(html.includes('static.cloudflareinsights.com/beacon.min.js'));
    assert.ok(html.includes('{"token": "0123456789abcdef0123456789abcdef"}'));
    createAdmin(p);
    const a = new Client(p.base);
    await a.login();
    await new Client(p.base).post('/api/telemetry/error', { source: 'public', message: 'ReferenceError: foo is not defined', location: '/assets/main.js:1:1', page: '/?q=secret' });
    const e = (await a.get('/api/dashboard')).data.errors.find((x) => x.source === 'public');
    assert.equal(e.page, '/', 'query strings are not stored');
  } finally { await p.stop(); }
});

test('an invalid analytics token is ignored (no script injection through configuration)', async () => {
  const p = await startServer({ port: 8204, env: { CF_WEB_ANALYTICS_TOKEN: '"><script>alert(1)</script>' } });
  try {
    p.cli(['publish']);
    assert.ok(!p.readPublic('index.html').includes('cloudflareinsights'));
  } finally { await p.stop(); }
});

test('if publishing fails, the change is rolled back and the live site is untouched', async () => {
  const before = s.readPublic('index.html');
  chmodSync(s.public(), 0o555);
  try {
    const sec = (await c.get('/api/content')).data.sections.find((x) => x.id === 'footer');
    const r = await c.put('/api/content/footer', { version: sec.version, values: { 'footer.about_desc': { es: 'Texto que no debe quedar guardado' } } });
    assert.equal(r.status, 500);
    assert.equal(r.data.error, 'server_error');
    assert.match(r.data.ref, /^[A-F0-9]{6}$/);
    assert.ok(!/\/|Exception|\.php|SQL/i.test(JSON.stringify(r.data).replace(/"ref":"[A-F0-9]+"/, '')), 'no internals in the response');
  } finally { chmodSync(s.public(), 0o755); }
  assert.equal(s.readPublic('index.html'), before);
  const sec = (await c.get('/api/content')).data.sections.find((x) => x.id === 'footer');
  assert.notEqual(sec.fields[0].value.es, 'Texto que no debe quedar guardado', 'database change rolled back');
  const log = readFileSync(join(s.storage('logs'), readdirSync(s.storage('logs'))[0]), 'utf8');
  assert.match(log, /unhandled_exception/);
});

test('an edited live file is detected, backed up and republished on demand', async () => {
  writeFileSync(s.public('index.html'), s.readPublic('index.html').replace('</body>', '<!-- manual edit --></body>'));
  const dash = await c.get('/api/dashboard');
  assert.equal(dash.data.site.inSync, false);
  const r = await c.post('/api/site/republish', {});
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.changed, ['index.html']);
  assert.equal(s.readPublic('index.html'), readFileSync(join(ROOT, 'index.html'), 'utf8'));
  const dash2 = await c.get('/api/dashboard');
  assert.equal(dash2.data.site.inSync, true);
  assert.deepEqual(dash2.data.site.drift.files, ['index.html']);
});

test('malformed, oversized and hostile input fails safely', async () => {
  assert.equal((await c.req('PUT', '/api/account/profile', { json: '[1,2,3]' })).status, 400);
  assert.equal((await c.req('PUT', '/api/account/profile', { json: '{"name":' })).status, 400);
  const huge = JSON.stringify({ name: 'x'.repeat(300000) });
  assert.equal((await c.req('PUT', '/api/account/profile', { json: huge })).status, 413);
  for (const email of ["admin' OR '1'='1", 'a@b.c; DROP TABLE users;--', '%00', '\u0000admin']) {
    const r = await new Client(s.base).login(email, "' OR 1=1 --");
    assert.equal(r.status, 401, email);
  }
  assert.equal(Number(s.sql('SELECT COUNT(*) FROM users')), 1, 'users table intact');
  const deep = await c.put('/api/account/profile', { name: { $gt: '' }, lang: ['es'], theme: null });
  assert.equal(deep.status, 422);
});

test('profile preferences persist (language and theme)', async () => {
  const r = await c.put('/api/account/profile', { name: 'Ana Admin', lang: 'en', theme: 'dark' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.user.name, r.data.user.lang, r.data.user.theme], ['Ana Admin', 'en', 'dark']);
  const bad = await c.put('/api/account/profile', { name: 'Ana Admin', lang: 'fr', theme: 'neon' });
  assert.deepEqual([bad.data.user.lang, bad.data.user.theme], ['es', 'system'], 'unknown values fall back to defaults');
});

test('command-line check reports a healthy installation', () => {
  const out = s.cli(['check']);
  assert.match(out, /\[ OK \] database/);
  assert.match(out, /\[ OK \] publishing/);
});
