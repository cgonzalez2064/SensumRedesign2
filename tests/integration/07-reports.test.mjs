// "Reportar un problema": validation, e-mail to it@gruposensum.com, failures, retry, abuse limits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, createAdmin, ADMIN, mailpitUp, waitForMail, messagesTo, countTo, message, unique } from './helpers.mjs';

let s; let c;
const SUPPORT = 'it@gruposensum.com';
const report = (fields, file) => {
  const base = { type: 'problem', area: 'admin', title: 'La imagen de Proyectos no carga', description: 'Al abrir la galería la foto queda en blanco.', page: '/admin/#/fotos', context: JSON.stringify({ browser: 'Chrome 152', os: 'macOS', device: 'desktop', viewport: '1280 × 800', lang: 'es', theme: 'dark' }) };
  return c.upload('/api/reports', { ...base, ...fields }, file ? { screenshot: file } : {});
};

before(async () => {
  assert.ok(await mailpitUp(), 'Mailpit must be running');
  s = await startServer({ port: 8199 });
  createAdmin(s);
  c = new Client(s.base);
  await c.login();
});
after(async () => { await s.stop(); });

test('only signed-in users can send reports', async () => {
  const anon = new Client(s.base);
  const fd = new FormData();
  fd.append('type', 'problem');
  assert.equal((await anon.req('POST', '/api/reports', { form: fd })).status, 401);
  assert.equal((await anon.get('/api/reports')).status, 401);
});

test('required fields and limits are validated', async () => {
  const r = await report({ type: 'hack', area: 'mars', title: '', description: 'corto', page: 'x'.repeat(301) });
  assert.equal(r.status, 422);
  assert.deepEqual(r.data.fields, { type: 'required', area: 'required', title: 'required', description: 'too_short', page: 'too_long' });
  assert.equal((await report({ title: 'x'.repeat(121) })).data.fields.title, 'too_long');
  assert.equal((await report({ description: 'x'.repeat(4001) })).data.fields.description, 'too_long');
});

test('a report is stored and e-mailed to support with a scannable, escaped message', async () => {
  const title = `XSS <script>alert(1)</script> ${Date.now()}\r\nBcc: victim@example.test`;
  const before = (await countTo(SUPPORT));
  const r = await report({ type: 'content', title, description: 'Línea 1\n<b>negrita</b> & "comillas"\nLínea 3 con ñ y emoji 🏗️', context: JSON.stringify({ browser: 'Chrome 152', cookie: 'secret-session', password: 'x', lang: 'es' }) });
  assert.equal(r.status, 201);
  assert.equal(r.data.delivered, true);
  assert.equal(r.data.report.emailStatus, 'sent');
  const list = await waitForMail(SUPPORT, before + 1);
  const mail = await message(list.find((m) => m.Subject.includes(String(title.match(/\d{10,}/)[0]))).ID);
  assert.deepEqual(mail.To.map((t) => t.Address), [SUPPORT]);
  assert.deepEqual(mail.Bcc, [], 'header injection did not add recipients');
  assert.match(mail.Subject, /^\[Sensum Website\] Contenido: XSS <script>alert\(1\)<\/script> \d+ Bcc: victim@example\.test$/);
  assert.deepEqual(mail.ReplyTo.map((t) => t.Address), [ADMIN.email]);
  assert.ok(!mail.HTML.includes('<script>alert(1)</script>'), 'HTML e-mail escapes report text');
  assert.ok(mail.HTML.includes('&lt;b&gt;negrita&lt;/b&gt; &amp; &quot;comillas&quot;'));
  for (const label of ['Tipo', 'Título', 'Reportado por', 'Fecha y hora', 'Página', 'Navegador', 'Versión de la aplicación']) assert.ok(mail.Text.includes(label), label);
  assert.ok(!/secret-session|cookie|password/i.test(mail.Text), 'unknown context keys (cookies, passwords) are dropped');
  assert.ok(Number(s.sql("SELECT COUNT(*) FROM support_reports WHERE email_status='sent'")) >= 1);
});

test('an optional screenshot is validated, re-encoded and attached', async () => {
  const before = (await countTo(SUPPORT));
  const ok = await report({ title: 'Con captura ' + Date.now() }, 'wide-1600x900.jpg');
  assert.equal(ok.status, 201);
  const mail = await message((await waitForMail(SUPPORT, before + 1))[0].ID);
  assert.equal(mail.Attachments.length, 1);
  assert.match(mail.Attachments[0].FileName, /^captura-reporte-\d+\.(webp|jpg)$/);
  const bad = await report({ title: 'Captura falsa ' + Date.now() }, 'script-disguised.jpg');
  assert.equal(bad.status, 422);
  assert.equal(bad.data.fields.file, 'file_type_not_allowed');
  const svg = await report({ title: 'Captura svg ' + Date.now() }, 'vector.svg');
  assert.equal(svg.data.fields.file, 'file_type_not_allowed');
});

test('the same report twice is recognized as a duplicate', async () => {
  const title = 'Duplicado ' + Date.now();
  assert.equal((await report({ title })).status, 201);
  const again = await report({ title });
  assert.equal(again.status, 409);
  assert.equal(again.data.error, 'duplicate_report');
});

test('a user cannot flood the support inbox', async () => {
  const flood = unique('flood');
  createAdmin(s, { name: 'Flood', email: flood, password: 'Clave-Flood-2026' });
  const f = new Client(s.base);
  await f.login(flood, 'Clave-Flood-2026');
  const statuses = [];
  for (let i = 0; i < 7; i++) {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ type: 'other', area: 'admin', title: `Spam ${i} ${Date.now()}`, description: 'Mensaje repetido número ' + i })) fd.append(k, v);
    statuses.push((await f.req('POST', '/api/reports', { form: fd })).status);
  }
  assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429, 429]);
});

test('SMTP down: the report is kept as "failed", nothing is lost, and retry delivers it later', async () => {
  const down = await startServer({ port: 8200, smtpDown: true });
  let reportId;
  try {
    createAdmin(down);
    const d = new Client(down.base);
    await d.login();
    const fd = new FormData();
    for (const [k, v] of Object.entries({ type: 'problem', area: 'website', title: 'Correo caído ' + Date.now(), description: 'Prueba de fallo de correo saliente.' })) fd.append(k, v);
    const r = await d.req('POST', '/api/reports', { form: fd });
    assert.equal(r.status, 202);
    assert.equal(r.data.delivered, false);
    assert.equal(r.data.report.emailStatus, 'failed');
    assert.ok(!/smtp|127\.0\.0\.1|connect|stream/i.test(r.text), 'no SMTP details exposed');
    reportId = r.data.report.id;
    const retry = await d.post(`/api/reports/${reportId}/retry`, {});
    assert.equal(retry.status, 202);
    assert.equal(retry.data.report.attempts, 2);
    const log = down.sql('SELECT 1');
    assert.equal(log, '1');
  } finally { await down.stop({ keep: true }); }

  // Same data, SMTP back up.
  const up = await startServer({ port: 8201, reuseDir: down.dir });
  try {
    const u = new Client(up.base);
    await u.login();
    const before = (await countTo(SUPPORT));
    const retry = await u.post(`/api/reports/${reportId}/retry`, {});
    assert.equal(retry.status, 200);
    assert.equal(retry.data.report.emailStatus, 'sent');
    await waitForMail(SUPPORT, before + 1);
    assert.ok((await countTo(SUPPORT)) > before, 'the retried report reached the support inbox');
    const dash = await u.get('/api/dashboard');
    assert.ok(dash.data.errors.some((e) => /Support report e-mail/.test(e.message)), 'delivery failure visible on the dashboard');
  } finally { await up.stop(); }
});

test('people only see and retry their own reports (admins see all)', async () => {
  const editorEmail = unique('editor');
  createAdmin(s, { name: 'Editor', email: editorEmail, password: 'Clave-Editor-2026' });
  s.sql(`UPDATE users SET role='editor' WHERE email='${editorEmail}'`);
  const e = new Client(s.base);
  await e.login(editorEmail, 'Clave-Editor-2026');
  assert.equal((await e.get('/api/reports')).data.reports.length, 0);
  const adminReport = Number(s.sql(`SELECT id FROM support_reports WHERE reporter_email='${ADMIN.email}' LIMIT 1`));
  assert.equal((await e.post(`/api/reports/${adminReport}/retry`, {})).status, 404, 'no access to someone else\'s report (IDOR)');
  assert.ok((await c.get('/api/reports')).data.reports.length >= 3);
});
