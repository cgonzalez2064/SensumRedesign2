// «Avisos al equipo»: only the owner e-mails the team the panel's «Novedades»;
// each active person gets one e-mail, in their language, with only the items
// they can use and the wiki link; nobody gets the same item twice; a test goes
// to the owner; every send is logged.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, createAdmin, ADMIN, mailpitUp, waitForMail, messagesTo, message, linkToken, unique } from './helpers.mjs';

let s; let owner;
const P = {};
const OLD = 1700000000; // accounts that existed when the «Novedades» shipped

before(async () => {
  assert.ok(await mailpitUp(), 'Mailpit must be running');
  s = await startServer({ port: 8441 });
  createAdmin(s);
  owner = new Client(s.base);
  await owner.login();
  for (const [k, permissions, lang] of [['sales', ['leads', 'stats'], 'es'], ['editor', ['texts', 'contact', 'photos', 'documents'], 'en'], ['admin', ['texts', 'contact', 'photos', 'documents', 'site', 'leads', 'stats', 'monitor', 'report', 'users'], 'es']]) {
    s.sql('DELETE FROM rate_limits');
    const email = unique('aviso-' + k);
    const r = await owner.post('/api/users', { name: `Persona ${k}`, email, permissions, lang });
    assert.equal(r.status, 200, r.text);
    const token = linkToken((await message((await waitForMail(email, 1))[0].ID)).Text, 'invitacion');
    const c = new Client(s.base);
    assert.equal((await c.post('/api/auth/invitation/accept', { token, name: `Persona ${k}`, password: 'Clave-Avisos-Prueba-2026', passwordConfirm: 'Clave-Avisos-Prueba-2026' })).status, 200);
    c.csrf = (await c.get('/api/auth/session')).data.csrf;
    P[k] = { id: r.data.user.id, email, c };
  }
  s.sql(`UPDATE users SET created_at = ${OLD}`);
});
after(async () => { await s.stop(); });

const mails = async (email) => (await messagesTo(email)).filter((m) => /Novedades|What's new/.test(m.Subject));

test('only the owner opens «Avisos al equipo»', async () => {
  assert.equal((await new Client(s.base).get('/api/announcements')).status, 401);
  for (const k of ['admin', 'sales']) {
    assert.equal((await P[k].c.get('/api/announcements')).status, 403, k);
    assert.equal((await P[k].c.post('/api/announcements/send', { ids: ['2026-10-wiki'] })).status, 403, k);
  }
  const o = (await owner.get('/api/announcements')).data;
  assert.equal(o.mailReady, true);
  const by = Object.fromEntries(o.news.map((n) => [n.id, n]));
  assert.equal(by['2026-10-avisos'], undefined, 'the owner-only «Novedad» is nobody else\'s');
  assert.equal(by['2026-10-wiki'].eligible, 3, 'everyone');
  assert.equal(by['2026-10-estadisticas'].eligible, 2, 'Ventas and the Administrador');
  assert.equal(by['2026-10-mas-secciones'].eligible, 2, 'whoever can still ask: Ventas and the Editor');
  assert.equal(by['2026-10-wiki'].emailed, 0);
});

test('recipients: each person with the chosen items they can use', async () => {
  const r = (await owner.post('/api/announcements/recipients', { ids: ['2026-10-estadisticas', '2026-10-mas-secciones'] })).data.recipients;
  const by = Object.fromEntries(r.map((x) => [x.id, x.items]));
  assert.deepEqual(by[P.sales.id], ['2026-10-estadisticas', '2026-10-mas-secciones']);
  assert.deepEqual(by[P.editor.id], ['2026-10-mas-secciones']);
  assert.deepEqual(by[P.admin.id], ['2026-10-estadisticas']);
  assert.ok(!r.some((x) => x.email === ADMIN.email), 'never the owner');
  // Someone who already saw it in the panel can be left out.
  assert.equal((await P.sales.c.post('/api/wiki/news/seen', { ids: ['2026-10-estadisticas'] })).status, 200);
  const unseen = (await owner.post('/api/announcements/recipients', { ids: ['2026-10-estadisticas'], unseenOnly: true })).data.recipients;
  assert.deepEqual(unseen.map((x) => x.id), [P.admin.id]);
  for (const [body, field] of [[{ ids: ['no-existe'] }, 'ids'], [{ ids: [] }, 'ids'], [{ ids: ['2026-10-avisos'] }, 'ids']]) {
    const bad = await owner.post('/api/announcements/recipients', body);
    assert.equal(bad.status, 422, JSON.stringify(body));
    assert.ok(bad.data.fields[field], JSON.stringify(body));
  }
});

test('a test goes to the owner only, marked as a test', async () => {
  const before = (await messagesTo(ADMIN.email)).length;
  const r = await owner.post('/api/announcements/test', { ids: ['2026-10-wiki', '2026-10-estadisticas'], message: 'Hola equipo <b>esto</b>' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.sent, true);
  const list = await waitForMail(ADMIN.email, before + 1);
  const m = await message(list[0].ID);
  assert.match(m.Subject, /^\[Prueba\] Novedades en el Administrador de contenido$/);
  assert.ok(m.HTML.includes('Hola equipo &lt;b&gt;esto&lt;/b&gt;'), 'the owner\'s words are text, never HTML');
  assert.ok(m.Text.includes('Nueva wiki del panel') && m.Text.includes('#/wiki/estadisticas'));
  for (const k of ['sales', 'editor', 'admin']) assert.equal((await mails(P[k].email)).length, 0, k + ' got nothing');
  assert.equal((await owner.post('/api/announcements/test', { ids: ['2026-10-wiki'], message: 'x'.repeat(601) })).data.fields.message, 'too_long');
});

test('sending: one e-mail per person, in their language, only their items, never twice', async () => {
  const r = await owner.post('/api/announcements/send', { ids: ['2026-10-estadisticas', '2026-10-mas-secciones'], message: 'Actualizamos el panel esta semana.' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.data.sent, r.data.failed], [3, 0]);
  const sales = await message((await waitForMail(P.sales.email, 1)).find((m) => /Novedades/.test(m.Subject)).ID);
  assert.ok(sales.Text.includes('Estadísticas para compartir') || sales.Text.includes('Estadísticas'), 'Ventas: statistics');
  assert.ok(sales.Text.includes('Actualizamos el panel esta semana.') && sales.Text.includes('Mensaje de Ana'));
  assert.ok(sales.HTML.includes('/admin/#/wiki/estadisticas') && sales.HTML.includes('/admin/#/wiki/mas-secciones'));
  const editor = await message((await waitForMail(P.editor.email, 2)).find((m) => /What's new/.test(m.Subject)).ID);
  assert.ok(editor.Text.includes('More sections') && !editor.Text.includes('Statistics'), 'English, only what the Editor can use');
  const admin = await message((await waitForMail(P.admin.email, 1)).find((m) => /Novedades/.test(m.Subject)).ID);
  assert.ok(!admin.HTML.includes('/admin/#/wiki/mas-secciones'), 'an Administrador has nothing to ask for');
  // Again: everyone already has those items.
  const twice = await owner.post('/api/announcements/send', { ids: ['2026-10-estadisticas', '2026-10-mas-secciones'] });
  assert.equal(twice.status, 422);
  assert.equal(twice.data.fields.ids, 'nobody');
  for (const k of ['sales', 'editor', 'admin']) assert.equal((await mails(P[k].email)).length, 1, k + ': still one');
  // Unless the owner asks to send it again.
  assert.equal((await owner.post('/api/announcements/send', { ids: ['2026-10-estadisticas'], again: true })).data.sent, 2);
  // The overview counts it; the history and Actividad keep it.
  const o = (await owner.get('/api/announcements')).data;
  assert.equal(o.news.find((n) => n.id === '2026-10-estadisticas').emailed, 2);
  assert.equal(o.history.length, 2);
  assert.deepEqual([o.history[1].recipients, o.history[1].failed, o.history[1].message], [3, 0, 'Actualizamos el panel esta semana.']);
  assert.match(o.history[1].by, /^Ana/);
  assert.equal(s.sql("SELECT count(*) FROM activity_log WHERE action = 'team_announced'"), '2');
  assert.equal(s.sql("SELECT count(*) FROM news_emailed WHERE news_id = '2026-10-mas-secciones'"), '2');
});

test('inactive accounts, people who joined later and the owner-only «Novedad»', async () => {
  s.sql(`UPDATE users SET status = 'disabled' WHERE id = ${P.editor.id}`);
  const r = (await owner.post('/api/announcements/recipients', { ids: ['2026-10-wiki'] })).data.recipients.map((x) => x.id);
  assert.ok(!r.includes(P.editor.id), 'a disabled account gets nothing');
  s.sql(`UPDATE users SET created_at = ${Math.floor(Date.UTC(2030, 0, 1) / 1000)} WHERE id = ${P.admin.id}`);
  const later = (await owner.post('/api/announcements/recipients', { ids: ['2026-10-wiki'] })).data.recipients.map((x) => x.id);
  assert.ok(!later.includes(P.admin.id), 'someone who joined afterwards had the welcome instead');
  // The owner sees the owner-only «Novedad» in the panel; nobody else does.
  assert.ok((await owner.get('/api/wiki/news')).data.news.some((n) => n.id === '2026-10-avisos'));
  assert.ok(!(await P.sales.c.get('/api/wiki/news')).data.news.some((n) => n.id === '2026-10-avisos'));
});
