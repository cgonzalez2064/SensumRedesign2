// Monthly site report for clients: owner-only, recipients (owner always copied), content, sending, reminder after day 5.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer, Client, createAdmin, ADMIN, ROOT, PHP, mailpitUp, waitForMail, message, countTo, unique } from './helpers.mjs';

const RUN = Date.now().toString(36);
const EDITOR = { name: 'Ed Itor', email: 'ed.itor@example.test', password: 'Clave-Ed-Itor-2026' };
const OTHER = { name: 'Otra Admin', email: 'otra.admin2@example.test', password: 'Clave-Otra-2026-x' };
const php = (server, code) => execFileSync(PHP, ['-r', `require 'cms/vendor/autoload.php'; $app = Sensum\\Cms\\App::boot(getcwd() . '/cms'); ${code}`], { cwd: ROOT, env: server.env }).toString();
const cliAsync = async (server, args, env = {}) => (await promisify(execFile)(PHP, ['cms/bin/console', ...args], { cwd: ROOT, env: { ...server.env, ...env } })).stdout;

// Google PageSpeed stand-in.
let psiCalls = 0;
const psi = createServer((req, res) => {
  psiCalls++;
  const mobile = new URL(req.url, 'http://x').searchParams.get('strategy') === 'mobile';
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ lighthouseResult: { categories: {
    performance: { score: mobile ? 0.86 : 0.99 }, seo: { score: 1 }, accessibility: { score: 0.96 }, 'best-practices': { score: 0.93 },
  } } }));
});

let s; let owner; let prev;
before(async () => {
  assert.ok(await mailpitUp(), 'Mailpit must be running');
  await new Promise((r) => psi.listen(8226, '127.0.0.1', r));
  s = await startServer({ port: 8225, env: { PAGESPEED_API_URL: 'http://127.0.0.1:8226/run' } });
  createAdmin(s);
  createAdmin(s, OTHER);
  createAdmin(s, EDITOR);
  s.sql(`UPDATE users SET role='editor', permissions='texts,contact,photos,documents' WHERE email='${EDITOR.email}'`);
  // The site has been in use since before last month (the reminder ignores months before that).
  s.sql('UPDATE users SET created_at = created_at - 90 * 86400');
  s.cli(['publish']);
  owner = new Client(s.base); await owner.login();
  prev = (await owner.get('/api/site-report')).data.status.period;
});
after(async () => { await s.stop(); await new Promise((r) => psi.close(r)); });

/** Puts figures into last month: 100 checks (99 ok), 3 text changes, 2 photos, 1 blocked sign-in. */
function seedLastMonth() {
  const [y, m] = prev.split('-').map(Number);
  const t0 = Math.floor(new Date(y, m - 1, 10, 12).getTime() / 1000);
  const runs = Array.from({ length: 100 }, (_, i) => `(${t0 + i * 900}, ${i === 0 ? 0 : 1}, '${i === 0 ? 'database' : ''}')`).join(',');
  s.sql(`INSERT INTO monitor_runs (created_at, ok, failed) VALUES ${runs}`);
  s.sql(`INSERT INTO activity_log (user_id, action, target, details, created_at) VALUES
    (1, 'content_updated', 'hero', '{"changes":{"hero.title.es":["a","b"],"hero.title.en":["a","b"],"hero.desc.es":["a","b"]}}', ${t0}),
    (1, 'media_uploaded', 'proj1.card', '{}', ${t0 + 60}), (1, 'media_uploaded', 'proj1.gallery', '{}', ${t0 + 120}),
    (NULL, 'login_throttled', '', '{}', ${t0 + 180})`);
}

test('the monthly report is for the owner account only', async () => {
  const other = new Client(s.base); await other.login(OTHER.email, OTHER.password);
  const editor = new Client(s.base); await editor.login(EDITOR.email, EDITOR.password);
  for (const c of [other, editor]) {
    assert.equal((await c.get('/api/site-report')).status, 403);
    assert.equal((await c.get('/api/site-report/preview')).status, 403);
    assert.equal((await c.put('/api/site-report/settings', { recipients: [], lang: 'es' })).status, 403);
    assert.equal((await c.post('/api/site-report/send', {})).status, 403);
  }
  assert.equal((await new Client(s.base).get('/api/site-report')).status, 401);
  const r = (await owner.get('/api/site-report')).data;
  assert.equal(r.ownerEmail, ADMIN.email);
  assert.equal(r.periods.length, 13);
});

test('recipients: validated, de-duplicated, owner excluded (always copied), at most 20', async () => {
  const ok = await owner.put('/api/site-report/settings', { recipients: ['Cliente@Example.test', 'cliente@example.test', ADMIN.email, 'gerencia@example.test'], lang: 'es' });
  assert.deepEqual(ok.data.settings.recipients, ['cliente@example.test', 'gerencia@example.test']);
  for (const recipients of [['no-es-correo'], ['a@b.co\r\nBcc: x@y.z'], 'a@b.co', [42]]) {
    const r = await owner.put('/api/site-report/settings', { recipients, lang: 'es' });
    assert.equal(r.status, 422, JSON.stringify(recipients));
  }
  const many = Array.from({ length: 21 }, (_, i) => `c${i}@example.test`);
  assert.equal((await owner.put('/api/site-report/settings', { recipients: many, lang: 'es' })).data.fields.recipients, 'too_many');
});

test('content: plain-language summary built from the month\'s figures, without empty sections', async () => {
  seedLastMonth();
  const r = (await owner.get('/api/site-report/preview?period=' + prev)).data.report;
  assert.equal(r.status, 'good');
  assert.equal(r.statusLabel, 'Todo en orden');
  assert.match(r.summary, /disponible el 99 % de las revisiones automáticas y no se presentaron incidentes técnicos\./);
  assert.match(r.summary, /Se actualizaron 3 textos y se publicaron 2 fotos nuevas\./);
  assert.deepEqual(r.kpis.map((k) => k.label), ['Disponibilidad', 'Actualizaciones', 'Seguridad'], 'no Google score yet → no Google tile');
  assert.equal(r.kpis[1].value, '5');
  assert.equal(r.kpis[2].note, '1 intento de acceso bloqueado');
  assert.deepEqual(r.sections.map((x) => x.title), ['Contenido', 'Seguridad y respaldo', 'Soporte', 'Mantenimiento y análisis automáticos']);
  assert.deepEqual(r.sections[3].items, ['100 revisiones automáticas de funcionamiento (cada 15 minutos)'], 'only what is known');
  // An incident turns it into "Con observaciones".
  const [y, m] = prev.split('-').map(Number);
  s.sql(`INSERT INTO error_log (created_at, severity, source, event, message, fingerprint) VALUES (${Math.floor(new Date(y, m - 1, 15).getTime() / 1000)}, 'critical', 'server', 'unhandled_exception', 'x', 'sr-${RUN}')`);
  const r2 = (await owner.get('/api/site-report/preview?period=' + prev)).data.report;
  assert.equal(r2.status, 'attention');
  assert.match(r2.summary, /y se presentó 1 incidente técnico, que el equipo de soporte atendió\./);
  // English version.
  const en = (await owner.get('/api/site-report/preview?lang=en&period=' + prev)).data.report;
  assert.match(en.subject, /^Monthly website report — /);
  assert.match(en.summary, /available in 99% of the automatic checks/);
  // Only the last 13 months are accepted.
  assert.equal((await owner.get('/api/site-report/preview?period=2001-01')).status, 422);
});

test('support tickets and automatic maintenance of the month show the value of the service', async () => {
  const [y, m] = prev.split('-').map(Number);
  const at = (d, h = 10) => Math.floor(new Date(y, m - 1, d, h).getTime() / 1000);
  const day = (d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // Two tickets resolved (6 h and 30 h), one still open; one resolved from an earlier month.
  s.sql(`INSERT INTO support_reports (user_id, reporter_name, reporter_email, type, title, description, area, fingerprint, email_status, created_at, updated_at, status, resolved_at) VALUES
    (1, 'Ed', 'ed@example.test', 'problem', 'No se guardaba el texto de servicios', 'x', 'admin', 'sr1-${RUN}', 'sent', ${at(3)}, ${at(3, 16)}, 'resolved', ${at(3, 16)}),
    (1, 'Ed', 'ed@example.test', 'content', 'Cambiar el horario de atención', 'x', 'website', 'sr2-${RUN}', 'sent', ${at(8)}, ${at(9, 16)}, 'closed', ${at(9, 16)}),
    (1, 'Ed', 'ed@example.test', 'improvement', 'Agregar testimonios', 'x', 'website', 'sr3-${RUN}', 'sent', ${at(20)}, ${at(20)}, 'in_progress', NULL)`);
  s.sql(`INSERT INTO settings (key, value, updated_at) VALUES ('contact_stats', '${JSON.stringify({ [day(5)]: { sent: 9, blocked: 30 }, [day(6)]: { sent: 3, blocked: 12 } })}', 0)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  s.sql(`INSERT INTO settings (key, value, updated_at) VALUES ('maintenance_log', '${JSON.stringify({ [prev]: { backups: 30, integrity: 2880, certificate: 30, pagespeed: 30, alerts: 2 } })}', 0)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  const r = (await owner.get('/api/site-report/preview?period=' + prev)).data.report;
  assert.match(r.summary, /El equipo de soporte resolvió 2 solicitudes\./);
  const leads = r.kpis.find((k) => k.label === 'Mensajes recibidos');
  assert.equal(leads.value, '12');
  const support = r.sections.find((x) => x.title === 'Soporte').items;
  assert.ok(support.includes('Se recibieron 3 solicitudes de soporte del equipo (2 resueltas)'), JSON.stringify(support));
  assert.ok(support.includes('Tiempo promedio de resolución: 18 horas'));
  assert.ok(support.includes('Resuelto: «No se guardaba el texto de servicios»'));
  assert.ok(support.includes('Resuelto: «Cambiar el horario de atención»'));
  assert.ok(support.includes('1 solicitud sigue en atención'));
  const auto = r.sections.find((x) => x.title === 'Mantenimiento y análisis automáticos');
  assert.ok(auto.intro);
  for (const line of ['2.880 análisis de seguridad de los archivos del sitio', '30 copias de seguridad de la base de datos', 'Certificado de seguridad (HTTPS) verificado 30 veces',
    'Velocidad y preparación para Google medidas 30 veces', '42 mensajes de spam bloqueados en el formulario de contacto']) assert.ok(auto.items.includes(line), line);
  assert.ok(auto.items.some((x) => /^\d+ avisos automáticos enviados al equipo técnico$/.test(x)), 'watchdog + critical alerts');
  // English.
  const en = (await owner.get('/api/site-report/preview?lang=en&period=' + prev)).data.report;
  assert.ok(en.sections.find((x) => x.title === 'Automatic maintenance and checks').items.includes('2,880 security scans of the site files'));
  assert.ok(en.sections.find((x) => x.title === 'Support').items.includes('Average resolution time: 18 hours'));
  // And in the e-mail.
  const mail = (await owner.post('/api/site-report/send', { period: prev, test: true }));
  assert.equal(mail.status, 200, mail.text);
  const [msg] = (await waitForMail(ADMIN.email, 1)).filter((x) => /Informe mensual/.test(x.Subject));
  const html = (await message(msg.ID)).HTML;
  assert.ok(html.includes('Mantenimiento y análisis automáticos') && html.includes('Resuelto: «No se guardaba el texto de servicios»'));
});

test('the scheduled check records availability, Google scores and the certificate step', async () => {
  const before = Number(s.sql('SELECT COUNT(*) FROM monitor_runs'));
  const out = await cliAsync(s, ['monitor']);
  assert.match(out, /Google PageSpeed: mobile 86 · desktop 99/);
  assert.match(out, /Monthly report reminder:/);
  assert.equal(Number(s.sql('SELECT COUNT(*) FROM monitor_runs')), before + 1);
  assert.equal(psiCalls, 2);
  await cliAsync(s, ['monitor']);
  assert.equal(psiCalls, 2, 'scores are refreshed at most once a day');
  const r = (await owner.get('/api/site-report/preview?period=' + prev)).data.report;
  assert.equal(r.kpis.find((k) => k.label === 'Velocidad en celulares').value, '86/100');
  const visibility = r.sections.find((x) => x.title === 'Visibilidad en Google');
  assert.ok(visibility.items.includes('Velocidad en computadoras: 99/100 (excelente)'));
});

test('sending: recipients in To, the owner in Cc, branded e-mail, history recorded', async () => {
  const a = `cliente-${RUN}@example.test`;
  const b = `gerencia-${RUN}@example.test`;
  await owner.put('/api/site-report/settings', { recipients: [a, b], lang: 'es' });
  const r = await owner.post('/api/site-report/send', { period: prev, note: 'Este mes renovamos las fotos.' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.to, [a, b]);
  assert.deepEqual(r.data.cc, [ADMIN.email]);
  const mail = await message((await waitForMail(a, 1))[0].ID);
  assert.match(mail.Subject, /^Informe mensual del sitio web — /);
  assert.deepEqual(mail.To.map((x) => x.Address).sort(), [a, b].sort());
  assert.deepEqual(mail.Cc.map((x) => x.Address), [ADMIN.email]);
  assert.equal(mail.ReplyTo[0].Address, ADMIN.email);
  assert.ok(mail.HTML.includes('cid:sensum-logo'), 'logo embedded, no remote images');
  assert.ok(mail.HTML.includes('Este mes renovamos las fotos.'));
  assert.ok(mail.Text.includes('Disponibilidad: 99 %'));
  const page = (await owner.get('/api/site-report')).data;
  assert.equal(page.history[0].status, 'sent');
  assert.equal(page.history[0].period, prev);
  assert.ok(page.status.sentAt);
});

test('a test goes only to the owner and is not recorded; no recipients → owner only', async () => {
  const historyBefore = (await owner.get('/api/site-report')).data.history.length;
  const before = await countTo(ADMIN.email);
  const t = await owner.post('/api/site-report/send', { period: prev, test: true });
  assert.deepEqual([t.data.to, t.data.cc], [[ADMIN.email], []]);
  const mail = await message((await waitForMail(ADMIN.email, before + 1))[0].ID);
  assert.match(mail.Subject, /^\[Prueba\] Informe mensual/);
  assert.equal((await owner.get('/api/site-report')).data.history.length, historyBefore);
  await owner.put('/api/site-report/settings', { recipients: [], lang: 'en' });
  const solo = await owner.post('/api/site-report/send', { period: prev });
  assert.deepEqual([solo.data.to, solo.data.cc], [[ADMIN.email], []]);
  const enMail = await message((await waitForMail(ADMIN.email, before + 2))[0].ID);
  assert.match(enMail.Subject, /^Monthly website report — /);
});

test('reminder: after day 5, once per month, only while last month\'s report is unsent', async () => {
  const fresh = await startServer({ port: 8227 });
  try {
    createAdmin(fresh);
    fresh.sql('UPDATE users SET created_at = created_at - 90 * 86400');
    const ts = (d) => `strtotime('${d}')`;
    const remind = (d) => php(fresh, `echo $app->siteReport()->maybeRemind(${ts(d)}) ? 'sent' : 'no';`);
    const before = await countTo(ADMIN.email);
    assert.equal(remind('2026-10-05 18:00'), 'no', 'still within the first 5 days');
    assert.equal(remind('2026-10-06 09:00'), 'sent');
    const mail = await message((await waitForMail(ADMIN.email, before + 1))[0].ID);
    assert.match(mail.Subject, /^Recordatorio: el informe de septiembre de 2026 aún no se ha enviado$/);
    assert.ok(mail.Text.includes('/admin/#/informe'));
    assert.equal(remind('2026-10-08 09:00'), 'no', 'only once per month');
    // A sent report means no reminder (next month).
    fresh.sql(`INSERT INTO site_reports (period, sent_at, recipients, status) VALUES ('2026-10', ${Math.floor(Date.UTC(2026, 10, 2) / 1000)}, '[]', 'sent')`);
    assert.equal(remind('2026-11-09 09:00'), 'no');
    // Months before the site was in use are ignored (first account created after December ended).
    fresh.sql('UPDATE users SET created_at = ' + Math.floor(Date.UTC(2027, 0, 3) / 1000));
    assert.equal(remind('2027-01-07 09:00'), 'no');
  } finally {
    await fresh.stop();
  }
});

test('when e-mail fails the report is recorded as failed and the panel says so', async () => {
  const down = await startServer({ port: 8228, smtpDown: true });
  try {
    createAdmin(down);
    const c = new Client(down.base); await c.login();
    await c.put('/api/site-report/settings', { recipients: [unique('x')], lang: 'es' });
    const p = (await c.get('/api/site-report')).data.status.period;
    const r = await c.post('/api/site-report/send', { period: p });
    assert.equal(r.status, 502);
    assert.equal(r.data.error, 'email_failed');
    assert.equal((await c.get('/api/site-report')).data.history[0].status, 'failed');
  } finally {
    await down.stop();
  }
});
