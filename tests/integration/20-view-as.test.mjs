// "Ver como": the owner sees the panel as another account — read-only, logged,
// 30 minutes at most — and can switch between accounts or go back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, createAdmin, ADMIN } from './helpers.mjs';

let s; let owner; let editor; let ids;
const EDITOR = { name: 'Elsa Textos', email: 'elsa.textos@example.test', password: 'Clave-Elsa-Textos-2026' };
const SALES = { name: 'Saúl Ventas', email: 'saul.ventas@example.test', password: 'Clave-Saul-Ventas-2026' };
const OFF = { name: 'Olga Desactivada', email: 'olga.off@example.test', password: 'Clave-Olga-Off-2026' };

before(async () => {
  s = await startServer({ port: 8311 });
  createAdmin(s); createAdmin(s, EDITOR); createAdmin(s, SALES); createAdmin(s, OFF);
  s.sql(`UPDATE users SET role='editor', permissions='texts' WHERE email='${EDITOR.email}'`);
  s.sql(`UPDATE users SET role='editor', permissions='leads' WHERE email='${SALES.email}'`);
  s.sql(`UPDATE users SET status='disabled' WHERE email='${OFF.email}'`);
  s.sql(`INSERT INTO users (email, name, role, status, password_hash, permissions, lang, theme, created_at, updated_at) VALUES ('ivan.invitado@example.test', 'Iván Invitado', 'editor', 'invited', '', 'photos,documents', 'es', 'system', strftime('%s','now'), strftime('%s','now'))`);
  ids = Object.fromEntries(s.sql('SELECT email, id FROM users').split('\n').map((l) => l.split('|')).map(([e, i]) => [e, Number(i)]));
  owner = new Client(s.base); await owner.login();
  editor = new Client(s.base); await editor.login(EDITOR.email, EDITOR.password);
  // Something unread for the editor (a ticket answer) and for sales (a new lead).
  const now = Math.floor(Date.now() / 1000);
  s.sql(`INSERT INTO support_reports (user_id, reporter_name, reporter_email, type, title, description, area, page, context, fingerprint, email_status, email_attempts, created_at, updated_at, status, priority, owner_unread, reporter_unread)
    VALUES (${ids[EDITOR.email]}, '${EDITOR.name}', '${EDITOR.email}', 'problem', 'No guarda', 'Al guardar sale un error.', 'admin', '/admin/', '{}', 'va1', 'sent', 1, ${now}, ${now}, 'waiting', 'normal', 0, 1)`);
  s.sql(`INSERT INTO leads (name, email, phone, service, message, created_at, updated_at) VALUES ('Lucía', 'lucia@example.test', '5555-1234', 'Obra civil', 'Hola, quiero una cotización.', ${now}, ${now})`);
});
after(async () => { await s.stop(); });

const session = async (c) => (await c.get('/api/auth/session')).data;

test('only the owner can view as someone, and it needs the password', async () => {
  assert.equal((await editor.get('/api/view-as')).status, 403);
  assert.equal((await editor.post('/api/view-as', { userId: ids[ADMIN.email], currentPassword: EDITOR.password })).status, 403);
  const list = await owner.get('/api/view-as');
  assert.equal(list.status, 200);
  assert.equal(list.data.active, false);
  assert.deepEqual(list.data.users.map((u) => u.email).sort(), [EDITOR.email, 'ivan.invitado@example.test', SALES.email].sort(), 'active and invited, never the owner or disabled');
  assert.equal((await owner.post('/api/view-as', { userId: ids[EDITOR.email], currentPassword: 'incorrecta' })).status, 422);
  for (const bad of [ids[ADMIN.email], ids[OFF.email], 99999, '2']) {
    assert.equal((await owner.post('/api/view-as', { userId: bad, currentPassword: ADMIN.password })).status, 422, String(bad));
  }
});

test('viewing as a "texts only" account: their menus and data, nothing can be changed', async () => {
  const r = await owner.post('/api/view-as', { userId: ids[EDITOR.email], currentPassword: ADMIN.password });
  assert.equal(r.status, 200, r.text);
  const sess = await session(owner);
  assert.equal(sess.user.email, EDITOR.email);
  assert.equal(sess.user.owner, false);
  assert.deepEqual(sess.user.permissions, ['texts']);
  assert.deepEqual([sess.viewAs.by, sess.viewAs.accessType, sess.viewAs.status], [ADMIN.name, 'texts', 'active']);
  assert.ok(sess.viewAs.until > Date.now() / 1000 + 29 * 60);
  const content = await owner.get('/api/content');
  assert.equal(content.status, 200);
  assert.equal(content.headers.get('x-view-as'), String(ids[EDITOR.email]));
  // What they cannot open.
  for (const p of ['/api/users', '/api/monitor/summary', '/api/leads', '/api/settings/email', '/api/monitor/overview', '/api/stats']) assert.equal((await owner.get(p)).status, 403, p);
  // Read-only: every change is refused, nothing is saved.
  const hero = content.data.sections.find((x) => x.id === 'hero');
  const put = await owner.put('/api/content/hero', { version: hero.version, values: { 'hero.cta1': { es: 'Cambio no permitido' } } });
  assert.equal(put.status, 403);
  assert.equal(put.data.error, 'view_only');
  assert.equal(s.sql("SELECT COUNT(*) FROM content WHERE value = 'Cambio no permitido'"), '0');
  assert.equal((await owner.post('/api/reports', { type: 'problem', area: 'admin', title: 'Prueba', description: 'No debería enviarse nada.' })).data.error, 'view_only');
  assert.equal((await owner.post('/api/account/password', { currentPassword: EDITOR.password, newPassword: 'Otra-Clave-Larga-2026' })).data.error, 'view_only');
  // Their tickets, without marking the answer as read for them.
  const list = await owner.get('/api/reports');
  assert.deepEqual(list.data.reports.map((x) => x.title), ['No guarda']);
  assert.equal((await owner.get(`/api/reports/${list.data.reports[0].id}`)).status, 200);
  assert.equal(s.sql("SELECT reporter_unread FROM support_reports WHERE fingerprint = 'va1'"), '1', 'still unread for them');
  // Starting again is not possible while viewing (switch instead).
  assert.equal((await owner.post('/api/view-as', { userId: ids[SALES.email], currentPassword: ADMIN.password })).data.error, 'view_only');
});

test('switching to another account needs no password; leads stay unread', async () => {
  const r = await owner.post('/api/view-as/switch', { userId: ids[SALES.email] });
  assert.equal(r.status, 200, r.text);
  const sess = await session(owner);
  assert.equal(sess.user.email, SALES.email);
  assert.equal(sess.viewAs.accessType, 'sales');
  const leads = await owner.get('/api/leads');
  assert.equal(leads.status, 200);
  await owner.get(`/api/leads/${leads.data.leads[0].id}`);
  assert.equal(s.sql("SELECT unread FROM leads WHERE name = 'Lucía'"), '1', 'opening it as them does not mark it read');
  const csv = await owner.post('/api/leads/export', { status: 'all' });
  assert.equal(csv.status, 200, 'read-only downloads are allowed');
  assert.equal((await owner.put(`/api/leads/${leads.data.leads[0].id}`, { status: 'contacted' })).data.error, 'view_only');
  assert.equal((await owner.get('/api/users')).status, 403, 'not the owner while viewing');
  // An invited account can be viewed too.
  await owner.post('/api/view-as/switch', { userId: ids['ivan.invitado@example.test'] });
  const inv = await session(owner);
  assert.deepEqual([inv.user.email, inv.viewAs.status, inv.viewAs.accessType], ['ivan.invitado@example.test', 'invited', 'media']);
  assert.equal((await owner.post('/api/view-as/switch', { userId: ids[ADMIN.email] })).status, 422, 'not the owner');
});

test('going back restores the owner; every step is logged (never the password)', async () => {
  assert.equal((await owner.post('/api/view-as/stop', {})).status, 200);
  const sess = await session(owner);
  assert.deepEqual([sess.user.email, sess.user.owner, sess.viewAs], [ADMIN.email, true, null]);
  const users = await owner.get('/api/users');
  assert.equal(users.status, 200);
  assert.equal(users.headers.get('x-view-as'), '0');
  assert.equal((await owner.post('/api/view-as/switch', { userId: ids[SALES.email] })).status, 409, 'switch only while viewing');
  const log = s.sql("SELECT action || ':' || target FROM activity_log WHERE action LIKE 'view_as_%' ORDER BY id").split('\n');
  assert.deepEqual(log, [`view_as_started:${ids[EDITOR.email]}`, `view_as_switched:${ids[SALES.email]}`, `view_as_switched:${ids['ivan.invitado@example.test']}`, `view_as_ended:${ids['ivan.invitado@example.test']}`]);
  assert.ok(!s.sql("SELECT group_concat(details) FROM activity_log WHERE action LIKE 'view_as_%'").includes(ADMIN.password));
  // The editor's own session was never touched.
  assert.equal((await session(editor)).user.email, EDITOR.email);
});

test('it ends by itself after 30 minutes, or when the account is disabled', async () => {
  await owner.post('/api/view-as', { userId: ids[EDITOR.email], currentPassword: ADMIN.password });
  s.sql("UPDATE sessions SET view_as_until = strftime('%s','now') - 1 WHERE view_as_user_id IS NOT NULL");
  const after1 = await owner.get('/api/users');
  assert.equal(after1.status, 200, 'back to the owner');
  assert.equal(after1.headers.get('x-view-as'), '0');
  assert.equal(s.sql("SELECT details FROM activity_log WHERE action = 'view_as_ended' ORDER BY id DESC LIMIT 1"), '{"reason":"expired"}');
  await owner.post('/api/view-as', { userId: ids[EDITOR.email], currentPassword: ADMIN.password });
  s.sql(`UPDATE users SET status = 'disabled' WHERE id = ${ids[EDITOR.email]}`);
  assert.equal((await session(owner)).user.email, ADMIN.email);
  s.sql(`UPDATE users SET status = 'active' WHERE id = ${ids[EDITOR.email]}`);
});

test('signing out while viewing ends the owner session', async () => {
  const c = new Client(s.base); await c.login();
  await c.post('/api/view-as', { userId: ids[SALES.email], currentPassword: ADMIN.password });
  assert.equal((await c.post('/api/auth/logout', {})).status, 200);
  assert.equal((await session(c)).authenticated, false);
});
