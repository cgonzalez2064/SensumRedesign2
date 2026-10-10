// Value for the client: the leads inbox (contact-form messages kept in the
// panel), cookie-free visit statistics, ticket service levels, and the
// monthly report's comparison with the previous month and PDF version.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { startServer, Client, createAdmin, ADMIN, ROOT, MAILPIT, mailpitUp, waitForMail, messagesTo, message, unique, solveCaptcha } from './helpers.mjs';

let s; let owner; let sales; let editor; let contactTo; let support;
const SALES = { name: 'Vera Ventas', email: 'vera.ventas@example.test', password: 'Clave-Vera-Ventas-2026' };
const EDITOR = { name: 'Eli Editor', email: 'eli.editor@example.test', password: 'Clave-Eli-Editor-2026' };
const BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const day = (ts = Date.now()) => new Date(ts - new Date(ts).getTimezoneOffset() * 60000).toISOString().slice(0, 10);

before(async () => {
  assert.ok(await mailpitUp(), 'Mailpit must be running (mailpit &)');
  contactTo = unique('ventas');
  support = unique('soporte');
  s = await startServer({ port: 8291, env: { SUPPORT_EMAIL: support } });
  createAdmin(s);
  createAdmin(s, SALES);
  createAdmin(s, EDITOR);
  s.sql(`UPDATE users SET role='editor', permissions='leads' WHERE email='${SALES.email}'`);
  s.sql(`UPDATE users SET role='editor', permissions='texts' WHERE email='${EDITOR.email}'`);
  owner = new Client(s.base); await owner.login();
  sales = new Client(s.base); await sales.login(SALES.email, SALES.password);
  editor = new Client(s.base); await editor.login(EDITOR.email, EDITOR.password);
  const saved = await owner.put('/api/settings/email', {
    smtp: { host: '127.0.0.1', port: 1025, encryption: 'none', username: '', password: '', fromAddress: 'notificaciones@sensumconstrucciones.com', fromName: 'Sensum Construcciones', replyTo: '' },
    supportEmail: support, alertEmail: unique('alertas'),
    contact: { to: [contactTo], fromAddress: 'formulario@sensumconstrucciones.com', fromName: 'Sitio web Sensum', method: 'smtp' },
    currentPassword: ADMIN.password,
  });
  assert.equal(saved.status, 200, saved.text);
});
after(async () => { await s.stop(); });

/** Posts the public contact form like the site's own JavaScript does. */
async function submitContact(fields = {}) {
  const rl = join(ROOT, 'assets', '.rl-data', createHash('sha256').update('sensum-rl|127.0.0.1').digest('hex') + '.json');
  if (existsSync(rl)) rmSync(rl);
  const fd = new FormData();
  const values = { name: 'Lucía Prospecto', phone: '5555-1234', email: 'lucia.prospecto@example.test', service: 'Remodelaciones', message: 'Quisiera una cotización para remodelar mi cocina.', loaded_at: String(Date.now() - 20000), captcha: await solveCaptcha(s.base), ...fields };
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  const res = await fetch(s.base + '/assets/contact-handler.php', { method: 'POST', body: fd, headers: { Accept: 'application/json', Origin: s.base } });
  return { status: res.status, data: await res.json().catch(() => null) };
}

/** A beacon from the public site. */
const collect = (body, headers = {}) => fetch(s.base + '/api/collect', {
  method: 'POST', body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', Origin: s.base, 'User-Agent': BROWSER, ...headers },
});
const metric = (m, dim = '') => Number(s.sql(`SELECT COALESCE(SUM(count), 0) FROM analytics_daily WHERE metric='${m}' AND dim='${dim}'`));

// ------------------------------------------------------------------ leads inbox

let leadId;

test('every contact-form message is kept in Prospectos, and the e-mail links to it', async () => {
  const r = await submitContact({ lang: 'en' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const row = s.sql("SELECT id || '|' || name || '|' || email || '|' || service || '|' || lang || '|' || status || '|' || notified || '|' || unread FROM leads ORDER BY id DESC LIMIT 1").split('|');
  leadId = Number(row[0]);
  assert.deepEqual(row.slice(1), ['Lucía Prospecto', 'lucia.prospecto@example.test', 'Remodelaciones', 'en', 'new', '1', '1']);
  const [m] = await waitForMail(contactTo, 1);
  const html = (await message(m.ID)).HTML;
  assert.ok(html.includes(`/admin/#/prospectos/${leadId}`), 'link to the lead in the panel');
  // An unknown language value is stored as Spanish; unexpected fields are still refused.
  assert.equal((await submitContact({ lang: '<script>' })).status, 200);
  assert.equal(s.sql('SELECT lang FROM leads ORDER BY id DESC LIMIT 1'), 'es');
  assert.equal((await submitContact({ extra: 'x' })).status, 400);
});

test('only the owner and accounts with the Leads access see them', async () => {
  assert.equal((await editor.get('/api/leads')).status, 403);
  assert.equal((await editor.get(`/api/leads/${leadId}`)).status, 403);
  assert.equal((await editor.get('/api/stats')).status, 403);
  assert.equal((await new Client(s.base).get('/api/leads')).status, 401);
  const list = await sales.get('/api/leads');
  assert.equal(list.status, 200, list.text);
  assert.equal(list.data.canConfigure, false);
  assert.ok(list.data.leads.length >= 2);
  assert.equal(list.data.counts.unread, list.data.leads.filter((l) => l.unread).length);
  assert.equal((await sales.get('/api/leads/badge')).data.count, 2);
  assert.equal((await sales.put('/api/leads/settings', { retention: 12 })).status, 403, 'settings are the owner\'s');
  assert.equal((await sales.get('/api/users')).status, 403, 'no other admin access');
  assert.deepEqual((await sales.get('/api/auth/session')).data.user.permissions, ['leads']);
});

test('opening a lead marks it read; status, amount and notes are recorded in its history', async () => {
  const d = await sales.get(`/api/leads/${leadId}`);
  assert.equal(d.status, 200);
  assert.equal(d.data.lead.unread, false);
  assert.equal(d.data.lead.message, 'Quisiera una cotización para remodelar mi cocina.');
  assert.equal((await sales.get('/api/leads/badge')).data.count, 1);

  for (const bad of [{ status: 'ganado' }, { amount: -5 }, { amount: 'abc' }, { amount: 1e12 }, { amount: [1] }]) {
    assert.equal((await sales.put(`/api/leads/${leadId}`, bad)).status, 422, JSON.stringify(bad));
  }
  const c1 = await sales.put(`/api/leads/${leadId}`, { status: 'contacted' });
  assert.equal(c1.status, 200);
  assert.ok(c1.data.lead.contactedAt > 0, 'first contact time recorded');
  const q = await sales.put(`/api/leads/${leadId}`, { status: 'quoted', amount: 150000 });
  assert.equal(q.data.lead.amount, 150000);
  assert.equal((await sales.post(`/api/leads/${leadId}/notes`, { body: '   ' })).status, 422);
  const n = await sales.post(`/api/leads/${leadId}/notes`, { body: 'Visita el jueves a las 10.\n<b>Lleva muestras</b>' });
  assert.equal(n.status, 200);
  const won = await sales.put(`/api/leads/${leadId}`, { status: 'won' });
  const notes = won.data.notes;
  assert.deepEqual(notes.filter((x) => x.kind === 'event').map((x) => `${x.details.action}:${x.details.to}`), ['status:contacted', 'status:quoted', 'amount:150000', 'status:won']);
  const note = notes.find((x) => x.kind === 'note');
  assert.equal(note.body, 'Visita el jueves a las 10.\n<b>Lleva muestras</b>', 'kept as typed (shown as text)');
  assert.equal(note.author, SALES.name);
  assert.ok(s.sql(`SELECT closed_at FROM leads WHERE id=${leadId}`));
  // Filters, search and service.
  assert.deepEqual((await sales.get('/api/leads?status=won')).data.leads.map((l) => l.id), [leadId]);
  assert.ok(!(await sales.get('/api/leads')).data.leads.some((l) => l.id === leadId), 'won is not active');
  assert.deepEqual((await sales.get(`/api/leads?status=all&q=%23${leadId}`)).data.leads.map((l) => l.id), [leadId]);
  assert.equal((await sales.get("/api/leads?status=all&q=%25'%20OR%201%3D1--")).data.leads.length, 0, 'search is literal');
  assert.ok((await sales.get('/api/leads?status=all&service=Remodelaciones')).data.leads.length >= 2);
  assert.equal((await sales.get('/api/leads?status=all&service=Nada')).data.leads.length, 0);
});

test('CSV export: Excel-friendly, filtered, and formula-safe', async () => {
  await submitContact({ name: '=HYPERLINK("http://evil.example","x")', message: '+1 llamar urgente; @SUM(A1) -2 y más texto aquí' });
  const res = await fetch(s.base + '/api/leads/export', { method: 'POST', body: JSON.stringify({ status: 'all' }),
    headers: { 'Content-Type': 'application/json', Origin: s.base, Cookie: sales.cookieHeader(), 'X-CSRF-Token': sales.csrf } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="prospectos-sensum-\d{4}-\d{2}-\d{2}\.csv"/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM for Excel');
  const csv = buf.subarray(3).toString('utf8');
  assert.equal(csv.split("\n")[0], "Número,Fecha,Nombre,Correo,Teléfono,Servicio,Estado,\"Monto (Q)\",Mensaje");
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil.example"",""x"")"`), 'formula neutralised');
  assert.ok(csv.includes("'+1 llamar urgente"), 'leading + neutralised');
  assert.ok(csv.includes('Ganado') && csv.includes('150000'));
  const won = await fetch(s.base + '/api/leads/export', { method: 'POST', body: JSON.stringify({ status: 'won' }),
    headers: { 'Content-Type': 'application/json', Origin: s.base, Cookie: sales.cookieHeader(), 'X-CSRF-Token': sales.csrf } });
  assert.equal((await won.text()).trim().split('\n').length, 2, 'header + the won lead');
  assert.equal((await editor.post('/api/leads/export', {})).status, 403);
});

test('retention: the owner chooses it, the privacy notice says it, old leads are deleted', async () => {
  assert.equal((await owner.put('/api/leads/settings', { retention: 5 })).status, 422);
  const r = await owner.put('/api/leads/settings', { retention: 12 });
  assert.equal(r.status, 200, r.text);
  assert.match(s.readPublic('privacy-notice.html'), /como máximo\s+12 meses; después se elimina automáticamente/);
  const old = Math.floor(Date.now() / 1000) - 400 * 86400;
  s.sql(`INSERT INTO leads (name, email, phone, service, message, created_at, updated_at) VALUES ('Viejo', 'viejo@example.test', '5555-0000', 'Otro', 'Mensaje antiguo de prueba', ${old}, ${old})`);
  s.cli(['monitor']);
  assert.equal(s.sql("SELECT COUNT(*) FROM leads WHERE name='Viejo'"), '0');
  assert.equal(s.sql(`SELECT COUNT(*) FROM leads WHERE id=${leadId}`), '1', 'recent ones stay');
  assert.equal((await owner.put('/api/leads/settings', { retention: 24 })).status, 200);
});

test('a lead can be deleted (e.g. when the person asks); it is logged without the address', async () => {
  const id = Number(s.sql("SELECT id FROM leads WHERE name LIKE '=HYPERLINK%'"));
  await sales.post(`/api/leads/${id}/notes`, { body: 'Spam' });
  assert.equal((await sales.del(`/api/leads/${id}`)).status, 200);
  assert.equal((await sales.get(`/api/leads/${id}`)).status, 404);
  assert.equal(s.sql(`SELECT COUNT(*) FROM lead_notes WHERE lead_id=${id}`), '0');
  const log = s.sql("SELECT details FROM activity_log WHERE action='lead_deleted' ORDER BY id DESC LIMIT 1");
  assert.ok(log && !log.includes('lucia.prospecto@example.test'));
});

test('a spam wave past the captcha cannot fill the database (200 a day)', async () => {
  const now = Math.floor(Date.now() / 1000);
  s.sql(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 200) INSERT INTO leads (name, email, phone, service, message, created_at, updated_at) SELECT 'Ola ' || i, 'ola@example.test', '5555-0000', 'Otro', 'x', ${now}, ${now} FROM n`);
  const before = Number(s.sql('SELECT COUNT(*) FROM leads'));
  assert.equal((await submitContact({ name: 'Después del límite' })).status, 200, 'the e-mail still goes out');
  assert.equal(Number(s.sql('SELECT COUNT(*) FROM leads')), before);
  s.sql("DELETE FROM leads WHERE name LIKE 'Ola %'");
});

// ------------------------------------------------------------------ visit statistics

test('visits are counted without cookies or IP addresses: totals per day only', async () => {
  s.sql('DELETE FROM analytics_daily; DELETE FROM analytics_seen;');
  let res = await collect({ type: 'view', page: 'home', ref: 'https://www.google.com/', w: 390, lang: 'en' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('set-cookie'), null, 'no cookie');
  await collect({ type: 'view', page: 'home', ref: '', w: 390, lang: 'en' });
  assert.equal(metric('view', 'home'), 2);
  assert.equal(metric('visitor'), 1, 'same browser, same day: one visitor');
  assert.equal(metric('source', 'google'), 1);
  assert.equal(metric('device', 'mobile'), 1);
  assert.equal(metric('lang', 'en'), 1);
  await collect({ type: 'view', page: 'home', ref: 'https://l.facebook.com/x?fbclid=1', w: 1440 }, { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36' });
  assert.equal(metric('visitor'), 2);
  assert.equal(metric('source', 'facebook'), 1);
  assert.equal(metric('device', 'desktop'), 1);
  await collect({ type: 'view', page: 'home', utm: 'ig', w: 800 }, { 'User-Agent': BROWSER + ' Other' });
  assert.equal(metric('source', 'instagram'), 1, 'utm_source');
  await collect({ type: 'click', page: 'home', what: 'whatsapp' });
  await collect({ type: 'click', page: 'home', what: 'phone' });
  assert.equal(metric('click', 'whatsapp'), 1);
  // Nothing stored identifies a person.
  const hashes = s.sql('SELECT hash FROM analytics_seen').split('\n');
  assert.ok(hashes.every((h) => /^[0-9a-f]{32}$/.test(h)));
  assert.ok(!hashes.includes(createHash('sha256').update('127.0.0.1').digest('hex').slice(0, 32)));
  assert.equal(s.sql("SELECT COUNT(*) FROM analytics_daily WHERE dim LIKE '%google.com%' OR dim LIKE '%127.0.0.1%'"), '0', 'only fixed source names');
});

test('bots, opted-out browsers, other sites and junk are ignored', async () => {
  const before = s.sql('SELECT SUM(count) FROM analytics_daily');
  const ignored = [
    [{ type: 'view', page: 'home' }, { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }],
    [{ type: 'view', page: 'home' }, { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/141.0 Safari/537.36' }],
    [{ type: 'view', page: 'home' }, { 'User-Agent': 'facebookexternalhit/1.1' }],
    [{ type: 'view', page: 'home' }, { DNT: '1' }],
    [{ type: 'view', page: 'home' }, { 'Sec-GPC': '1' }],
    [{ type: 'view', page: 'home' }, { 'Sec-Purpose': 'prefetch' }],
    [{ type: 'view', page: '/admin' }, {}],
    [{ type: 'click', page: 'home', what: 'javascript' }, {}],
    [{ type: 'other', page: 'home' }, {}],
  ];
  for (const [body, headers] of ignored) {
    assert.equal((await collect(body, headers)).status, 204, JSON.stringify(headers));
  }
  const raw = await fetch(s.base + '/api/collect', { method: 'POST', body: '[1,2', headers: { 'Content-Type': 'application/json', Origin: s.base, 'User-Agent': BROWSER } });
  assert.equal(raw.status, 204);
  assert.equal((await collect({ type: 'view', page: 'home' }, { Origin: 'https://evil.example' })).status, 403, 'other sites cannot post');
  assert.equal(s.sql('SELECT SUM(count) FROM analytics_daily'), before);
});

test('a new day gets a new salt: yesterday\'s visitors cannot be linked to today\'s', async () => {
  s.sql("UPDATE settings SET value = json_set(value, '$.day', '2000-01-01') WHERE key = 'analytics_salt'");
  s.sql("INSERT INTO analytics_seen (day, hash) VALUES ('2000-01-01', 'ffffffffffffffffffffffffffffffff')");
  const visitors = metric('visitor');
  await collect({ type: 'view', page: 'home', w: 390 });
  assert.equal(s.sql("SELECT COUNT(*) FROM analytics_seen WHERE day = '2000-01-01'"), '0', 'old markers deleted with the old salt');
  assert.equal(metric('visitor'), visitors + 1);
  assert.notEqual(JSON.parse(s.sql("SELECT value FROM settings WHERE key='analytics_salt'")).day, '2000-01-01');
});

test('statistics page: visits, sources, clicks and leads, compared with the previous period', async () => {
  const st = await sales.get('/api/stats');
  assert.equal(st.status, 200, st.text);
  assert.equal(st.data.period, '30d');
  assert.equal(st.data.enabled, true);
  assert.ok(st.data.visits.views >= 4);
  assert.ok(st.data.visits.visitors >= 3);
  assert.equal(st.data.visits.clicks.whatsapp, 1);
  assert.equal(st.data.visits.days.length, 30);
  assert.equal(st.data.visits.days.at(-1).day, day());
  assert.ok(st.data.leads.received >= 2);
  assert.equal(st.data.canConfigure, false);
  const month = new Date().toISOString().slice(0, 7);
  assert.equal((await sales.get(`/api/stats?period=${month}`)).data.period, month);
  assert.equal((await sales.put('/api/stats/settings', { enabled: false })).status, 403);
});

test('the owner can turn statistics off: the script leaves the pages and the privacy notice changes', async () => {
  assert.match(s.readPublic('index.html'), /<script src="assets\/stats\.js\?v=\d+" defer><\/script>/);
  assert.match(s.readPublic('privacy-notice.html'), /cuenta las visitas de forma anónima/);
  assert.equal((await owner.put('/api/stats/settings', { enabled: 'no' })).status, 422);
  assert.equal((await owner.put('/api/stats/settings', { enabled: false })).status, 200);
  assert.ok(!s.readPublic('index.html').includes('stats.js'));
  assert.match(s.readPublic('privacy-notice.html'), /no utiliza cookies de análisis ni herramientas de\s+rastreo/);
  const before = metric('view', 'home');
  await collect({ type: 'view', page: 'home' });
  assert.equal(metric('view', 'home'), before, 'nothing counted while off');
  assert.equal((await owner.put('/api/stats/settings', { enabled: true })).status, 200);
  assert.ok(s.readPublic('index.html').includes('stats.js'));
});

// ------------------------------------------------------------------ ticket service levels

let ticket;

test('tickets: first response time, rating by the reporter, response target', async () => {
  const r = await editor.post('/api/reports', { type: 'problem', area: 'admin', title: 'No carga la página de fotos', description: 'Al abrir Fotos se queda cargando y no muestra nada.', page: '/admin/#/fotos' });
  assert.equal(r.status, 201, r.text);
  ticket = r.data.report.id;
  assert.equal(r.data.report.firstResponseAt, null);
  await owner.post(`/api/reports/${ticket}/messages`, { body: 'Nota interna: revisar el log', internal: true });
  assert.equal(s.sql(`SELECT first_response_at FROM support_reports WHERE id=${ticket}`), '', 'internal notes are not an answer');
  await owner.post(`/api/reports/${ticket}/messages`, { body: 'Lo estamos revisando.', notify: false });
  assert.ok(Number(s.sql(`SELECT first_response_at FROM support_reports WHERE id=${ticket}`)) > 0);
  // Rating only once resolved, only by the reporter, 1–5, once.
  assert.equal((await editor.post(`/api/reports/${ticket}/rating`, { rating: 5 })).status, 409);
  const res = await owner.post(`/api/reports/${ticket}/status`, { status: 'resolved', message: 'Listo, era la caché.', notify: true });
  assert.equal(res.status, 200);
  const mail = (await waitForMail(EDITOR.email, 1)).find((m) => /resuelto/i.test(m.Subject));
  assert.ok((await message(mail.ID)).Text.includes('calificar la atención'));
  const d = await editor.get(`/api/reports/${ticket}`);
  assert.equal(d.data.canRate, true);
  assert.equal((await owner.get(`/api/reports/${ticket}`)).data.canRate, false);
  assert.equal((await owner.post(`/api/reports/${ticket}/rating`, { rating: 5 })).status, 403);
  for (const bad of [0, 6, '5', 4.5, null]) {
    assert.equal((await editor.post(`/api/reports/${ticket}/rating`, { rating: bad })).status, 422, String(bad));
  }
  const rated = await editor.post(`/api/reports/${ticket}/rating`, { rating: 2, comment: 'Tardó un poco.' });
  assert.equal(rated.status, 200, rated.text);
  assert.equal(rated.data.report.rating, 2);
  assert.equal(rated.data.canRate, false);
  assert.equal((await editor.post(`/api/reports/${ticket}/rating`, { rating: 5 })).status, 409, 'once');
  assert.equal(s.sql(`SELECT owner_unread FROM support_reports WHERE id=${ticket}`), '1', 'a low rating is flagged to IT');
  // Figures on the owner's list, with the target the owner chooses.
  assert.equal((await owner.put('/api/reports/settings', { slaHours: 5 })).status, 422);
  assert.equal((await editor.put('/api/reports/settings', { slaHours: 8 })).status, 403);
  assert.equal((await owner.put('/api/reports/settings', { slaHours: 8 })).status, 200);
  const list = await owner.get('/api/reports?status=all');
  assert.equal(list.data.slaHours, 8);
  assert.equal(list.data.service.answered, 1);
  assert.equal(list.data.service.withinTarget, 100);
  assert.equal(list.data.service.ratingAvg, 2);
});

test('resolved tickets without an answer close on their own after 7 days', async () => {
  const eightDays = Math.floor(Date.now() / 1000) - 8 * 86400;
  s.sql(`UPDATE support_reports SET resolved_at = ${eightDays} WHERE id = ${ticket}`);
  const out = s.cli(['monitor']);
  assert.match(out, /Resolved tickets closed after 7 days: 1/);
  assert.equal(s.sql(`SELECT status || '|' || closed_auto FROM support_reports WHERE id=${ticket}`), 'closed|1');
  const d = await editor.get(`/api/reports/${ticket}`);
  assert.ok(d.data.messages.some((m) => m.kind === 'event' && m.details.to === 'closed' && m.details.auto === true));
  assert.match(s.cli(['monitor']), /Resolved tickets closed after 7 days: 0/);
});

// ------------------------------------------------------------------ monthly report

test('the monthly report compares with the previous month and adds visits, leads and service levels', async () => {
  const now = new Date();
  const period = now.toISOString().slice(0, 7);
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const prevDay = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-15`;
  s.sql('DELETE FROM analytics_daily');
  s.sql(`INSERT INTO analytics_daily (day, metric, dim, count) VALUES ('${day()}', 'visitor', '', 150), ('${day()}', 'view', 'home', 400), ('${day()}', 'source', 'google', 90), ('${day()}', 'source', 'direct', 60),
    ('${day()}', 'device', 'mobile', 120), ('${day()}', 'device', 'desktop', 30), ('${day()}', 'click', 'whatsapp', 12), ('${day()}', 'click', 'phone', 3), ('${day()}', 'click', 'portfolio', 4),
    ('${prevDay}', 'visitor', '', 100), ('${prevDay}', 'view', 'home', 250)`);
  const pv = await owner.get(`/api/site-report/preview?period=${period}&lang=es`);
  assert.equal(pv.status, 200, pv.text);
  const r = pv.data.report;
  const visits = r.kpis.find((k) => k.label === 'Visitas');
  assert.equal(visits.value, '150');
  assert.equal(visits.trend.dir, 'up');
  assert.equal(visits.trend.good, true);
  assert.match(visits.trend.text, /^\+50 % vs\. [a-z]+$/);
  const leads = r.kpis.find((k) => k.label === 'Mensajes recibidos');
  assert.ok(Number(leads.value) >= 1);
  assert.match(leads.note, /15 clics en WhatsApp, teléfono o correo/);
  const reach = r.sections.find((x) => x.title === 'Visitas y contactos');
  assert.ok(reach, 'visits and contacts section');
  const items = reach.items.join('\n');
  assert.match(items, /150 visitas y 400 páginas vistas \(\+50 % vs\. [a-z]+\)\./);
  assert.match(items, /Llegaron principalmente desde Google \(60 %\) y acceso directo \(40 %\)\./);
  assert.match(items, /El 80 % de las visitas fue desde un celular\./);
  assert.match(items, /Clics para contactar a la empresa: 12 en WhatsApp y 3 en teléfono\./);
  assert.match(items, /4 descargas del portafolio/);
  assert.match(items, /Proyectos ganados desde el sitio por un total de Q 150\.000\./);
  assert.match(items, /Servicios más solicitados: Remodelaciones/);
  assert.match(r.summary, /El sitio recibió 150 visitas y \d+ mensajes? de/);
  const support = r.sections.find((x) => x.title === 'Soporte').items.join('\n');
  assert.match(support, /Primera respuesta en menos de una hora en promedio \(100 % dentro del objetivo de 8 horas\)/);
  assert.match(support, /Satisfacción con la atención: 2,0 de 5 \(1 calificación\)/);
  const auto = r.sections.find((x) => x.title === 'Mantenimiento y análisis automáticos').items.join('\n');
  assert.match(auto, /1 solicitud resuelta se cerró sola tras 7 días sin respuesta/);
  // English.
  const en = (await owner.get(`/api/site-report/preview?period=${period}&lang=en`)).data.report;
  assert.match(en.kpis.find((k) => k.label === 'Visits').trend.text, /^\+50% vs\. [A-Z][a-z]+$/);
  assert.ok(en.sections.some((x) => x.title === 'Visits and contacts'));
});

/** Text drawn in a PDF (its content streams are compressed). */
function pdfText(buf) {
  const out = [];
  const bin = buf.toString('latin1');
  for (const m of bin.matchAll(/\/Filter \/FlateDecode >>\nstream\n/g)) {
    const start = m.index + m[0].length;
    const len = Number(/\/Length (\d+)/.exec(bin.slice(bin.lastIndexOf('<<', m.index), m.index))[1]);
    out.push(inflateSync(buf.subarray(start, start + len)).toString('latin1'));
  }
  return [...out.join('\n').matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((x) => Buffer.from(x[1].replace(/\\([()\\])/g, '$1'), 'latin1').toString('latin1')).join('\n');
}

test('the report as a PDF: download from the panel and attached to the e-mail', async () => {
  const period = new Date().toISOString().slice(0, 7);
  const dl = (c, body) => fetch(s.base + '/api/site-report/pdf', { method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Origin: s.base, Cookie: c.cookieHeader(), 'X-CSRF-Token': c.csrf } });
  const res = await dl(owner, { period, lang: 'es', note: 'Este mes renovamos (las fotos) del \\ portafolio.' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), new RegExp(`filename="informe-sitio-sensum-${period}\\.pdf"`));
  const pdf = Buffer.from(await res.arrayBuffer());
  const raw = pdf.toString('latin1');
  assert.ok(raw.startsWith('%PDF-1.4') && raw.trimEnd().endsWith('%%EOF'));
  assert.match(raw, /\/Type \/Pages \/Kids \[[^\]]+\] \/Count [1-9]/);
  const xref = Number(/startxref\n(\d+)/.exec(raw)[1]);
  assert.equal(raw.slice(xref, xref + 4), 'xref', 'cross-reference table where it says');
  const text = pdfText(pdf);
  assert.match(text, /Sensum Construcciones/);
  assert.match(text, /VISITAS/);
  assert.match(text, /\+50 % vs\. /);
  assert.match(text, /Visitas y contactos/);
  assert.match(text, /renovamos \(las fotos\) del \\ portafolio/, 'the note, escaped');
  assert.ok(Buffer.from(text, 'latin1').includes(Buffer.from('Página 1 de', 'latin1')), 'accents in Windows-1252');
  assert.equal((await dl(sales, { period })).status, 403, 'owner only');

  const before = (await messagesTo(ADMIN.email)).length;
  const sent = await owner.post('/api/site-report/send', { period, test: true });
  assert.equal(sent.status, 200, sent.text);
  const mail = (await waitForMail(ADMIN.email, before + 1)).find((m) => /\[Prueba\]/.test(m.Subject));
  const full = await message(mail.ID);
  assert.equal(full.Attachments.length, 1);
  assert.equal(full.Attachments[0].FileName, `informe-sitio-sensum-${period}.pdf`);
  assert.equal(full.Attachments[0].ContentType, 'application/pdf');
  assert.ok(full.HTML.includes('Adjuntamos la versión en PDF'));
  assert.match(full.HTML, /&#9650; \+50 % vs\. /, 'trend arrow in the e-mail');
  const part = await fetch(`${MAILPIT}/api/v1/message/${mail.ID}/part/${full.Attachments[0].PartID}`);
  assert.ok(Buffer.from(await part.arrayBuffer()).toString('latin1').startsWith('%PDF-1.4'));
  assert.equal((await import('node:fs')).readdirSync(s.storage('tmp')).length, 0, 'temporary PDF removed');
});
