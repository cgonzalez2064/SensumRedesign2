// Support tickets: the owner (IT) manages the reports others send — status,
// priority, edits, replies, internal notes — and people are notified by e-mail.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, createAdmin, ADMIN, mailpitUp, waitForMail, messagesTo, message, countTo, unique } from './helpers.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let s; let owner; let ana; let beto; let support; let anaUser; let betoUser;

before(async () => {
  assert.ok(await mailpitUp(), 'Mailpit must be running (mailpit &)');
  support = unique('soporte');
  s = await startServer({ port: 8271, env: { SUPPORT_EMAIL: support } });
  createAdmin(s);
  anaUser = { name: 'Ana Textos', email: unique('ana'), password: 'Clave-Ana-Textos-2026' };
  betoUser = { name: 'Beto Fotos', email: unique('beto'), password: 'Clave-Beto-Fotos-2026' };
  createAdmin(s, anaUser);
  createAdmin(s, betoUser);
  s.sql(`UPDATE users SET role='editor', permissions='texts' WHERE email='${anaUser.email}'`);
  s.sql(`UPDATE users SET role='editor', permissions='photos,documents' WHERE email='${betoUser.email}'`);
  owner = new Client(s.base); await owner.login();
  ana = new Client(s.base); await ana.login(anaUser.email, anaUser.password);
  beto = new Client(s.base); await beto.login(betoUser.email, betoUser.password);
});
after(async () => { await s.stop(); });

const report = (c, title, extra = {}) => c.post('/api/reports', { type: 'problem', area: 'admin', title, description: 'Al guardar el texto aparece un error y no se guarda.', page: '/admin/#/textos', ...extra });
let t1; let t2;

test('new reports are tickets: the owner sees all with counts, each person only their own', async () => {
  const r1 = await report(ana, 'No puedo guardar las preguntas frecuentes');
  assert.equal(r1.status, 201, r1.text);
  t1 = r1.data.report.id;
  assert.equal(r1.data.report.status, 'new');
  t2 = (await report(beto, 'La foto del proyecto 2 se ve recortada', { type: 'design' })).data.report.id;
  await waitForMail(support, 2);

  const list = await owner.get('/api/reports');
  assert.equal(list.status, 200);
  assert.equal(list.data.canManage, true);
  assert.deepEqual(list.data.reports.map((r) => r.id).sort(), [t1, t2].sort());
  assert.equal(list.data.counts.new, 2);
  assert.equal(list.data.counts.open, 2);
  assert.equal(list.data.counts.unread, 2);
  assert.ok(list.data.reports.every((r) => r.unread && r.status === 'new' && r.priority === 'normal'));
  assert.equal((await owner.get('/api/reports/badge')).data.count, 2);

  const own = await ana.get('/api/reports');
  assert.equal(own.data.canManage, false);
  assert.deepEqual(own.data.reports.map((r) => r.id), [t1]);
  assert.equal((await ana.get(`/api/reports/${t2}`)).status, 404, "never another person's ticket");
  assert.equal((await ana.get(`/api/reports/${t2}/screenshot`)).status, 404);
  assert.equal((await new Client(s.base).get(`/api/reports/${t1}`)).status, 401);

  // Search and filters.
  assert.deepEqual((await owner.get('/api/reports?status=all&q=foto')).data.reports.map((r) => r.id), [t2]);
  assert.deepEqual((await owner.get(`/api/reports?status=all&q=%23${t1}`)).data.reports.map((r) => r.id), [t1]);
  assert.equal((await owner.get('/api/reports?status=resolved')).data.reports.length, 0);
  assert.equal((await owner.get("/api/reports?status=all&q=%25'%20OR%201%3D1--")).data.reports.length, 0, 'search is literal');
  // The support e-mail links to the ticket.
  const [mail] = (await messagesTo(support)).filter((m) => /preguntas frecuentes/.test(m.Subject));
  assert.ok((await message(mail.ID)).HTML.includes(`/admin/#/reportes/${t1}`));
});

test('opening a ticket marks it as read; only the owner sees the technical details', async () => {
  const d = await owner.get(`/api/reports/${t1}`);
  assert.equal(d.status, 200);
  assert.equal(d.data.canManage, true);
  assert.equal(d.data.report.reporterEmail, anaUser.email);
  assert.ok('context' in d.data.report);
  assert.equal(d.data.report.unread, false);
  assert.equal((await owner.get('/api/reports/badge')).data.count, 2, 'still "new" until someone acts');
  const mine = await ana.get(`/api/reports/${t1}`);
  assert.equal(mine.data.canManage, false);
  assert.equal(mine.data.canReply, true);
  assert.ok(!('reporterEmail' in mine.data.report) && !('context' in mine.data.report));
});

test('only the owner manages tickets', async () => {
  assert.equal((await ana.put(`/api/reports/${t1}`, { priority: 'urgent' })).status, 403);
  assert.equal((await ana.post(`/api/reports/${t1}/status`, { status: 'resolved' })).status, 403);
  assert.equal((await ana.post(`/api/reports/${t1}/messages`, { body: 'nota', internal: true })).status, 403);
  assert.equal((await beto.post(`/api/reports/${t1}/messages`, { body: 'hola' })).status, 404);
});

test('the owner edits the ticket; changes are validated and recorded', async () => {
  const bad = await owner.put(`/api/reports/${t1}`, { title: 'x', type: 'virus', priority: 'yesterday', description: 'corta' });
  assert.equal(bad.status, 422);
  for (const f of ['title', 'type', 'priority', 'description']) assert.ok(bad.data.fields[f], f);
  const r = await owner.put(`/api/reports/${t1}`, { title: 'Error al guardar Preguntas frecuentes', priority: 'high', area: 'admin' });
  assert.equal(r.status, 200);
  assert.equal(r.data.report.title, 'Error al guardar Preguntas frecuentes');
  assert.equal(r.data.report.priority, 'high');
  const edit = r.data.messages.find((m) => m.kind === 'event' && m.details.action === 'edit');
  assert.deepEqual(Object.keys(edit.details.fields).sort(), ['priority', 'title']);
  // The reporter doesn't see edit events.
  assert.ok(!(await ana.get(`/api/reports/${t1}`)).data.messages.some((m) => m.details.action === 'edit'));
});

test('asking for information needs a message, e-mails the reporter and waits', async () => {
  const empty = await owner.post(`/api/reports/${t1}/status`, { status: 'waiting', message: '' });
  assert.equal(empty.status, 422);
  assert.equal(empty.data.fields.message, 'required');
  const before = await countTo(anaUser.email);
  const r = await owner.post(`/api/reports/${t1}/status`, { status: 'waiting', message: '¿Qué mensaje de error aparece exactamente? <b>Una captura ayuda.</b>', notify: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.report.status, 'waiting');
  const msg = r.data.messages.at(-1);
  assert.equal(msg.kind, 'message');
  assert.equal(msg.emailStatus, 'sent');
  const [m] = (await waitForMail(anaUser.email, before + 1)).filter((x) => /Necesitamos más información/.test(x.Subject));
  assert.ok(m, 'info request e-mailed');
  const full = await message(m.ID);
  assert.ok(full.HTML.includes(`/admin/#/reportes/${t1}`));
  assert.ok(full.HTML.includes('&lt;b&gt;Una captura ayuda.&lt;/b&gt;') && !full.HTML.includes('<b>Una captura'), 'escaped');
  assert.equal(full.ReplyTo[0].Address, support);
  assert.equal((await ana.get('/api/reports/badge')).data.count, 1, 'the reporter sees an unread reply');
});

test('internal notes stay with IT', async () => {
  const before = await countTo(anaUser.email);
  const r = await owner.post(`/api/reports/${t1}/messages`, { body: 'Revisar permisos de la carpeta storage.', internal: true });
  assert.equal(r.status, 200);
  assert.equal(r.data.messages.at(-1).kind, 'note');
  const seen = (await ana.get(`/api/reports/${t1}`)).data.messages;
  assert.ok(!seen.some((m) => m.kind === 'note' || /storage/.test(m.body)));
  await sleep(400);
  assert.equal(await countTo(anaUser.email), before, 'no e-mail for notes');
});

test('the reporter answers: the ticket goes back to "in progress" and IT is e-mailed', async () => {
  const before = await countTo(support);
  const r = await ana.post(`/api/reports/${t1}/messages`, { body: 'Dice "No se pudo guardar". Pasa en Chrome.' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.report.status, 'in_progress');
  const [m] = (await waitForMail(support, before + 1)).filter((x) => /respondió en la solicitud/.test(x.Subject));
  assert.ok(m);
  const full = await message(m.ID);
  assert.match(full.Text, /envió la información que pediste/);
  assert.equal(full.ReplyTo[0].Address, anaUser.email);
  const list = (await owner.get('/api/reports')).data.reports.find((x) => x.id === t1);
  assert.equal(list.unread, true, 'unread for IT again');
});

test('resolving notifies; the reporter can reopen; closed tickets take no more replies', async () => {
  const before = await countTo(anaUser.email);
  const r = await owner.post(`/api/reports/${t1}/status`, { status: 'resolved', message: 'Corregimos los permisos. Ya puedes guardar.', notify: true });
  assert.equal(r.data.report.status, 'resolved');
  assert.ok(r.data.report.resolvedAt);
  const [m] = (await waitForMail(anaUser.email, before + 1)).filter((x) => /fue resuelta/.test(x.Subject));
  assert.ok(m);
  // Not fixed after all.
  const reopen = await ana.post(`/api/reports/${t1}/messages`, { body: 'Sigue sin funcionar en el celular.' });
  assert.equal(reopen.data.report.status, 'in_progress');
  assert.equal(reopen.data.report.resolvedAt, null);
  // Close without e-mail.
  const count = await countTo(anaUser.email);
  const closed = await owner.post(`/api/reports/${t1}/status`, { status: 'closed', message: '', notify: false });
  assert.equal(closed.data.report.status, 'closed');
  await sleep(400);
  assert.equal(await countTo(anaUser.email), count);
  const late = await ana.post(`/api/reports/${t1}/messages`, { body: 'Una cosa más' });
  assert.equal(late.status, 409);
  assert.equal(late.data.error, 'ticket_closed');
  assert.equal((await ana.get(`/api/reports/${t1}`)).data.canReply, false);
  // The reporter's timeline: messages and status changes only.
  const seen = (await ana.get(`/api/reports/${t1}`)).data.messages;
  assert.ok(seen.every((x) => x.kind === 'message' || (x.kind === 'event' && x.details.action === 'status')));
  assert.ok(seen.every((x) => x.emailStatus === null), 'delivery details are for IT');
  const statuses = seen.filter((x) => x.kind === 'event').map((x) => x.details.to);
  assert.deepEqual(statuses, ['waiting', 'in_progress', 'resolved', 'in_progress', 'closed']);
});

test('the first public answer from IT moves a new ticket to "in progress"', async () => {
  const r = await owner.post(`/api/reports/${t2}/messages`, { body: 'Gracias, lo revisamos hoy.', notify: false });
  assert.equal(r.data.report.status, 'in_progress');
  assert.equal(r.data.messages.at(-1).emailStatus, null, 'not e-mailed when notify is off');
  assert.equal((await owner.post(`/api/reports/${t2}/messages`, { body: '' })).status, 422);
  assert.equal((await owner.post(`/api/reports/${t2}/messages`, { body: 'x'.repeat(4001) })).status, 422);
  assert.equal((await owner.post(`/api/reports/${t2}/status`, { status: 'archived' })).status, 422);
});

test('the screenshot is shown only to the reporter and IT, as an image with safe headers', async () => {
  const r = await beto.upload('/api/reports', { type: 'design', area: 'website', title: 'Captura del menú', description: 'Adjunto una captura del menú en el celular.', page: '/' }, { screenshot: 'wide-1600x900.jpg' });
  assert.ok([201, 202].includes(r.status), r.text);
  const id = r.data.report.id;
  for (const c of [owner, beto]) {
    const res = await fetch(s.base + `/api/reports/${id}/screenshot`, { headers: { Cookie: c.cookieHeader() } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^image\/(webp|jpeg)$/);
    assert.match(res.headers.get('cache-control'), /no-store/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('content-security-policy'), /sandbox/);
    assert.ok((await res.arrayBuffer()).byteLength > 1000);
  }
  assert.equal((await fetch(s.base + `/api/reports/${id}/screenshot`, { headers: { Cookie: ana.cookieHeader() } })).status, 404);
  assert.equal((await fetch(s.base + `/api/reports/${t2}/screenshot`, { headers: { Cookie: owner.cookieHeader() } })).status, 404, 'no screenshot');
});

test('demo accounts: one per access profile, passwords only in a private local file', async () => {
  const out = s.cli(['demo-users', '--reports']);
  assert.match(out, /Demo accounts ready \(10\)/);
  assert.match(out, /Sample tickets: 4/);
  const { readFileSync, statSync } = await import('node:fs');
  const file = s.storage('LOCAL-TEST-USERS.txt');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const creds = Object.fromEntries(readFileSync(file, 'utf8').split('\n').map((l) => l.match(/(demo\.[a-z]+@example\.test)\s+(\S+)/)).filter(Boolean).map((m) => [m[1], m[2]]));
  assert.equal(Object.keys(creds).length, 10);
  const perms = Object.fromEntries(s.sql("SELECT email || '=' || permissions || '=' || status FROM users WHERE email LIKE 'demo.%'").split('\n').map((l) => { const [e, p, st] = l.split('='); return [e, `${p}|${st}`]; }));
  assert.equal(perms['demo.textos@example.test'], 'texts|active');
  assert.equal(perms['demo.fotos@example.test'], 'photos,documents|active');
  assert.equal(perms['demo.contacto@example.test'], 'contact|active');
  assert.equal(perms['demo.personalizado@example.test'], 'texts,photos|active');
  assert.equal(perms['demo.completo@example.test'], 'texts,contact,photos,documents,site,leads,stats,monitor,report|active');
  assert.equal(perms['demo.ventas@example.test'], 'leads,stats|active');
  assert.equal(perms['demo.gerencia@example.test'], 'stats,monitor|active');
  assert.equal(perms['demo.soporte@example.test'], 'site,monitor,report,support|active');
  assert.equal(perms['demo.desactivado@example.test'], 'texts|disabled');
  const c = new Client(s.base);
  assert.equal((await c.login('demo.contacto@example.test', creds['demo.contacto@example.test'])).status, 200);
  assert.deepEqual((await c.get('/api/auth/session')).data.user.permissions, ['contact']);
  assert.equal((await new Client(s.base).login('demo.desactivado@example.test', creds['demo.desactivado@example.test'])).status, 401);
  // Sample tickets in different states; running again resets passwords but adds no tickets.
  assert.equal(s.sql("SELECT group_concat(status) FROM (SELECT status FROM support_reports WHERE fingerprint LIKE 'demo-%' ORDER BY id)"), 'new,waiting,in_progress,resolved');
  const again = s.cli(['demo-users', '--reports']);
  assert.match(again, /Sample tickets: 0/);
  assert.equal((await new Client(s.base).login('demo.contacto@example.test', creds['demo.contacto@example.test'])).status, 401, 'old password reset');
  // Never in production.
  const { execFileSync } = await import('node:child_process');
  let refused = false;
  try { execFileSync(process.env.PHP_BIN || 'php', ['cms/bin/console', 'demo-users'], { cwd: (await import('./helpers.mjs')).ROOT, env: { ...s.env, APP_ENV: 'production' }, stdio: 'pipe' }); } catch (e) { refused = /local development only/.test(String(e.stderr)); }
  assert.ok(refused, 'refused in production');
});
