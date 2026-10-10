// Access profiles (concrete jobs), the basic statistics access, uptime and
// incidents for Salud del sitio / Monitoreo, and support management with charts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, createAdmin, ADMIN } from './helpers.mjs';

let s; let owner; let mgmt; let support; let editor; let ids;
const MGMT = { name: 'Gina Gerencia', email: 'gina.gerencia@example.test', password: 'Clave-Gina-Gerencia-2026' };
const SUPPORT = { name: 'Iván Soporte', email: 'ivan.soporte@example.test', password: 'Clave-Ivan-Soporte-2026' };
const EDITOR = { name: 'Ema Editora', email: 'ema.editora@example.test', password: 'Clave-Ema-Editora-2026' };
const now = () => Math.floor(Date.now() / 1000);

before(async () => {
  s = await startServer({ port: 8331 });
  createAdmin(s); createAdmin(s, MGMT); createAdmin(s, SUPPORT); createAdmin(s, EDITOR);
  s.sql(`UPDATE users SET role='editor', permissions='stats,monitor' WHERE email='${MGMT.email}'`);
  s.sql(`UPDATE users SET role='editor', permissions='site,monitor,support' WHERE email='${SUPPORT.email}'`);
  s.sql(`UPDATE users SET role='editor', permissions='texts' WHERE email='${EDITOR.email}'`);
  ids = Object.fromEntries(s.sql('SELECT email, id FROM users').split('\n').map((l) => l.split('|')).map(([e, i]) => [e, Number(i)]));
  owner = new Client(s.base); await owner.login();
  mgmt = new Client(s.base); await mgmt.login(MGMT.email, MGMT.password);
  support = new Client(s.base); await support.login(SUPPORT.email, SUPPORT.password);
  editor = new Client(s.base); await editor.login(EDITOR.email, EDITOR.password);
});
after(async () => { await s.stop(); });

test('ready-made access types are concrete jobs, and the panel offers each permission', async () => {
  const d = (await owner.get('/api/users')).data;
  assert.deepEqual(d.permissions, ['texts', 'contact', 'photos', 'documents', 'site', 'leads', 'stats', 'monitor', 'support']);
  assert.deepEqual(Object.keys(d.accessTypes), ['admin', 'content', 'texts', 'media', 'contact', 'sales', 'management', 'support']);
  assert.deepEqual(d.accessTypes.admin, ['texts', 'contact', 'photos', 'documents', 'site', 'leads', 'stats', 'monitor'], 'administrators do not handle IT tickets');
  assert.deepEqual(d.accessTypes.management, ['stats', 'monitor']);
  assert.deepEqual(d.accessTypes.support, ['support', 'monitor', 'site']);
  assert.deepEqual(d.accessTypes.sales, ['leads', 'stats']);
  // Accounts made from the terminal are site administrators (not support managers).
  assert.equal(s.sql(`SELECT permissions FROM users WHERE email='${MGMT.email}'`), 'stats,monitor');
  createAdmin(s, { name: 'Nuevo Admin', email: 'nuevo.admin@example.test', password: 'Clave-Nuevo-Admin-2026' });
  assert.equal(s.sql("SELECT permissions FROM users WHERE email='nuevo.admin@example.test'"), 'texts,contact,photos,documents,site,leads,stats,monitor');
});

test('basic statistics: visits without the contact-form figures; no Prospectos', async () => {
  const day = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  s.sql(`INSERT INTO analytics_daily (day, metric, dim, count) VALUES ('${day}', 'visitor', '', 40), ('${day}', 'view', 'home', 90), ('${day}', 'device', 'mobile', 30), ('${day}', 'device', 'desktop', 10)`);
  s.sql(`INSERT INTO leads (name, email, phone, service, message, created_at, updated_at) VALUES ('Ana', 'ana@example.test', '5555-1234', 'Obra civil', 'Hola, una cotización por favor.', ${now()}, ${now()})`);
  const st = await mgmt.get('/api/stats');
  assert.equal(st.status, 200, st.text);
  assert.equal(st.data.visits.visitors, 40);
  assert.equal(st.data.leads, null, 'no contact-form figures without the leads access');
  assert.equal(st.data.previousLeads, null);
  assert.ok(!st.text.includes('ana@example.test'));
  assert.equal((await mgmt.get('/api/leads')).status, 403);
  assert.equal((await editor.get('/api/stats')).status, 403);
  assert.ok((await owner.get('/api/stats')).data.leads.received >= 1, 'the owner sees both');
});

test('uptime for 24 h / 7 / 30 / 90 days and incidents (owner: which checks failed)', async () => {
  const t0 = now() - 3 * 86400;
  // 6 checks: two failed in a row (one incident), then back to normal; one more failure later.
  s.sql(`INSERT INTO monitor_runs (created_at, ok, failed, response_ms, http_status) VALUES
    (${t0}, 1, '', 210, 200), (${t0 + 900}, 0, 'database', NULL, NULL), (${t0 + 1800}, 0, 'database,storage', NULL, NULL),
    (${t0 + 2700}, 1, '', 230, 200), (${t0 + 3600}, 1, '', 250, 200), (${t0 + 86400}, 0, 'publishing', NULL, NULL), (${t0 + 86400 + 900}, 1, '', 240, 200)`);
  const o = await mgmt.get('/api/monitor/overview');
  assert.equal(o.status, 200, o.text);
  assert.deepEqual(o.data.uptime['7d'], { pct: 57.14, checks: 7, failed: 3 });
  assert.equal(o.data.uptime['24h'].checks, 0);
  assert.equal(o.data.uptime['24h'].pct, null);
  assert.equal(o.data.incidents.length, 2);
  const [last, first] = o.data.incidents;
  assert.deepEqual([first.start, first.end, first.minutes, first.checks, first.ongoing], [t0 + 900, t0 + 2700, 30, 2, false]);
  assert.deepEqual([last.minutes, last.checks], [15, 1]);
  assert.ok(!('failed' in first), 'no check names in the summary version');
  const sum = await owner.get('/api/monitor/summary');
  assert.deepEqual(sum.data.incidents.at(-1).failed.sort(), ['database', 'storage'], 'the owner sees which checks failed');
  assert.equal(sum.data.uptime['7d'].failed, 3);
  // An incident still happening is "ongoing".
  s.sql(`INSERT INTO monitor_runs (created_at, ok, failed) VALUES (${now() - 60}, 0, 'storage')`);
  assert.equal((await mgmt.get('/api/monitor/overview')).data.incidents[0].ongoing, true);
});

test('the "support" access manages everyone’s tickets and sees the charts; others only their own', async () => {
  const r = await editor.post('/api/reports', { type: 'problem', area: 'admin', title: 'No guarda los textos', description: 'Al guardar aparece un error en Textos.' });
  assert.equal(r.status, 201, r.text);
  const id = r.data.report.id;
  await owner.post('/api/reports', { type: 'improvement', area: 'website', title: 'Agregar galería', description: 'Una galería con más fotos de proyectos.' });
  const list = await support.get('/api/reports?status=all');
  assert.equal(list.data.canManage, true);
  assert.equal(list.data.reports.length, 2, 'everyone’s tickets');
  const st = await support.post(`/api/reports/${id}/status`, { status: 'in_progress', message: 'Lo revisamos.', notify: false });
  assert.equal(st.status, 200, st.text);
  assert.equal((await support.post(`/api/reports/${id}/messages`, { body: 'Nota interna de prueba', internal: true })).status, 200);
  assert.equal((await support.put('/api/reports/settings', { slaHours: 8 })).status, 200);
  // The reporter: their own ticket only, no internal note, no charts.
  const own = await editor.get('/api/reports');
  assert.equal(own.data.canManage, false);
  assert.deepEqual(own.data.reports.map((x) => x.id), [id]);
  assert.ok(!(await editor.get(`/api/reports/${id}`)).text.includes('Nota interna de prueba'));
  assert.equal((await editor.get('/api/reports/analytics')).status, 403);
  assert.equal((await mgmt.get('/api/reports/analytics')).status, 403);
  // Charts.
  const a = await support.get('/api/reports/analytics?days=30');
  assert.equal(a.status, 200, a.text);
  assert.equal(a.data.days.length, 30);
  assert.equal(a.data.created, 2);
  assert.equal(a.data.days.at(-1).created, 2);
  assert.deepEqual([a.data.status.new, a.data.status.in_progress, a.data.open], [1, 1, 2]);
  assert.deepEqual(a.data.byType, { problem: 1, improvement: 1 });
  assert.deepEqual(a.data.byArea, { admin: 1, website: 1 });
  assert.equal(a.data.service.answered, 1);
  assert.equal(a.data.service.targetHours, 8);
  assert.equal((await support.get('/api/reports/analytics?days=7')).data.days.length, 30, 'only 30, 90 or 365');
  assert.equal((await owner.get('/api/reports/analytics?days=365')).data.days.length, 365);
  // Support managers are not administrators.
  assert.equal((await support.get('/api/users')).status, 403);
  assert.equal((await support.get('/api/monitor/summary')).status, 403);
});

test('the monthly report: concrete security wording, highlights and recommendations', async () => {
  const period = new Date().toISOString().slice(0, 7);
  const r = (await owner.get(`/api/site-report/preview?period=${period}`)).data.report;
  const security = r.kpis.find((k) => k.label === 'Seguridad');
  assert.equal(security.value, 'Requiere atención');
  assert.equal(security.note, 'no hay respaldos de la información', 'says why, instead of a vague "review"');
  const next = r.sections.find((x) => x.title === 'Recomendaciones para el próximo mes').items;
  assert.ok(next.some((i) => /Contactar 1 cliente potencial/.test(i)), JSON.stringify(next));
  assert.ok(next.some((i) => /respaldos automáticos/.test(i)));
  assert.ok(next.some((i) => /Dar seguimiento a 2 solicitudes de soporte abiertas/.test(i)));
  assert.match(r.headline, /hay puntos que conviene atender|buen estado|sin interrupciones/);
});

test('upgrading: accounts that saw Prospectos keep their statistics (now a separate access)', async () => {
  const mk = (email, perms) => {
    createAdmin(s, { name: 'Migración', email, password: 'Clave-Migracion-Prueba-2026' });
    s.sql(`UPDATE users SET role='editor', permissions='${perms}' WHERE email='${email}'`);
  };
  mk('m1@example.test', 'leads'); mk('m2@example.test', 'texts,leads,monitor'); mk('m3@example.test', 'texts'); mk('m4@example.test', 'leads,stats');
  s.sql("DELETE FROM schema_migrations WHERE version='011_access_profiles'");
  s.cli(['migrate']);
  const perms = (e) => s.sql(`SELECT permissions FROM users WHERE email='${e}'`);
  assert.equal(perms('m1@example.test'), 'leads,stats');
  assert.equal(perms('m2@example.test'), 'texts,leads,monitor,stats');
  assert.equal(perms('m3@example.test'), 'texts', 'no leads, no statistics');
  assert.equal(perms('m4@example.test'), 'leads,stats', 'not added twice');
});
