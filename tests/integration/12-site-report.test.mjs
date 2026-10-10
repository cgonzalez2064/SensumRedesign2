// Monthly site report: the client version (value of the month, no technical details) and the technical
// detail for the team; the owner sends it (recipients, owner always copied), the "report" access views both.
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

test('the owner prepares and sends it; the "report" access (site administrators) only views both versions', async () => {
  const other = new Client(s.base); await other.login(OTHER.email, OTHER.password);
  const editor = new Client(s.base); await editor.login(EDITOR.email, EDITOR.password);
  for (const c of [other, editor]) {
    assert.equal((await c.get('/api/site-report')).status, 403);
    assert.equal((await c.put('/api/site-report/settings', { recipients: [], lang: 'es' })).status, 403);
    assert.equal((await c.post('/api/site-report/send', {})).status, 403);
    assert.equal((await c.post('/api/site-report/pdf', {})).status, 403);
  }
  assert.equal((await editor.get('/api/site-report/preview')).status, 403, 'content editors do not see it');
  const view = await other.get('/api/site-report/preview');
  assert.equal(view.status, 200, view.text);
  assert.equal(view.data.report.audience, 'client');
  assert.equal(view.data.technical.audience, 'technical');
  assert.equal(view.data.periods.length, 13);
  assert.equal(view.data.period, prev);
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

const TECH_WORDS = /respaldo|backup|copia de seguridad|certificad|HTTPS|SPF|DKIM|DMARC|DNS|dominio|error|Requiere atención|interrupci/i;
const clientText = (r) => JSON.stringify({ ...r, figures: undefined });

test('client version: the value of the month in plain words, never technical details', async () => {
  seedLastMonth();
  // Without any backup: the team's technical detail says so; the client version does not mention it.
  let { report: r, technical: tech } = (await owner.get('/api/site-report/preview?period=' + prev)).data;
  assert.equal(tech.status, 'attention');
  assert.equal(tech.kpis.find((k) => k.label === 'Seguridad').value, 'Requiere atención');
  assert.equal(tech.kpis.find((k) => k.label === 'Seguridad').note, 'no hay respaldos de la información', 'the reason, not a vague "review"');
  assert.ok(tech.sections.find((x) => x.title === 'Pendientes técnicos').items.some((i) => /respaldos automáticos/.test(i)));
  assert.equal(r.status, 'good');
  assert.equal(r.statusLabel, 'Vigilado las 24 horas');
  assert.doesNotMatch(clientText(r), TECH_WORDS);
  s.cli(['backup']);
  ({ report: r, technical: tech } = (await owner.get('/api/site-report/preview?period=' + prev)).data);
  assert.deepEqual([tech.status, tech.statusLabel], ['good', 'Todo en orden']);
  assert.match(tech.headline, /^Detalle técnico de .+: todo en orden$/);
  // Client: results, the work done and the monitoring behind it.
  assert.match(r.headline, /^Así cuidamos tu sitio web en /);
  assert.match(r.summary, /tu sitio estuvo en línea el 99 % del tiempo\. Se actualizaron 3 textos y se publicaron 2 fotos nuevas\. Lo vigilamos día y noche con 100 revisiones automáticas\. Además, detuvimos 1 intento de acceso indebido o mensaje de spam\.$/);
  assert.deepEqual(r.kpis.map((k) => [k.label, k.value]), [['Disponibilidad', '99 %'], ['Revisiones automáticas', '100'], ['Cambios publicados', '5'], ['Amenazas detenidas', '1']]);
  assert.equal(r.kpis[0].note, 'del tiempo en línea');
  assert.deepEqual(r.sections.map((x) => x.title), ['Lo más destacado del mes', 'Trabajo realizado este mes', 'Monitoreo y protección']);
  assert.deepEqual(r.sections[0].items, ['Detuvimos 1 amenaza antes de que afectara tu sitio.', 'Se publicaron 5 actualizaciones de contenido.', 'Vigilamos tu sitio 100 veces durante el mes, cada 15 minutos.']);
  assert.deepEqual(r.sections[1].items, ['3 textos actualizados', '2 fotos nuevas publicadas']);
  assert.deepEqual(r.sections[2].items, ['Revisamos que el sitio funcionara 100 veces (cada 15 minutos, día y noche).',
    'Si algo falla, el equipo técnico recibe un aviso al instante para resolverlo.', 'Bloqueamos 1 intento de acceso indebido al panel.']);
  assert.doesNotMatch(clientText(r), TECH_WORDS);
  // Technical: the interruption with its time, and the complete security and maintenance picture.
  assert.equal(tech.kpis[0].note, 'del tiempo en línea · 1 interrupción (15 min)');
  assert.deepEqual(tech.kpis.map((k) => k.label), ['Disponibilidad', 'Interrupciones', 'Errores críticos', 'Último respaldo', 'Seguridad']);
  assert.deepEqual([tech.kpis[2].value, tech.kpis[4].value, tech.kpis[4].note], ['0', 'Protegido', '1 intento de acceso bloqueado'], 'a local address is not expected to have HTTPS');
  assert.deepEqual(tech.sections.map((x) => x.title), ['Funcionamiento y velocidad', 'Seguridad y respaldos', 'Soporte técnico', 'Mantenimiento automático']);
  assert.ok(tech.sections[0].items.includes('Disponible el 99 % del tiempo; hubo 1 interrupción breve (15 min en total), atendida por soporte.'));
  assert.ok(tech.sections[0].items.some((i) => /^Interrupción el .+: 15 min \(1 revisión con fallas; falló: database\)\.$/.test(i)), JSON.stringify(tech.sections[0].items));
  assert.ok(tech.sections[1].items.some((i) => /^Respaldo más reciente: /.test(i)));
  assert.deepEqual(tech.sections.at(-1).items, ['100 revisiones automáticas de funcionamiento (cada 15 minutos)'], 'only what is known');
  // A critical error: the team sees it; the client version stays the same.
  const [y, m] = prev.split('-').map(Number);
  s.sql(`INSERT INTO error_log (created_at, severity, source, event, message, fingerprint) VALUES (${Math.floor(new Date(y, m - 1, 15).getTime() / 1000)}, 'critical', 'server', 'unhandled_exception', 'x', 'sr-${RUN}')`);
  const again = (await owner.get('/api/site-report/preview?period=' + prev)).data;
  assert.deepEqual([again.technical.status, again.technical.statusLabel], ['attention', 'Requiere atención']);
  assert.match(again.technical.summary, /Hubo 1 error técnico, que soporte atendió de inmediato\./);
  assert.equal(again.report.summary, r.summary);
  // English.
  const en = (await owner.get('/api/site-report/preview?lang=en&period=' + prev)).data;
  assert.match(en.report.subject, /^Website report for /);
  assert.match(en.report.summary, /your website was online 99% of the time\./);
  assert.match(en.technical.summary, /the site was online 99% of the time, with 1 brief interruption \(15 min in total\)\./);
  // Only the last 13 months are accepted.
  assert.equal((await owner.get('/api/site-report/preview?period=2001-01')).status, 422);
});

test('support and automatic work: the client sees what was done; the team sees everything', async () => {
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
  const { report: r, technical: tech } = (await owner.get('/api/site-report/preview?period=' + prev)).data;
  // Client
  assert.match(r.summary, /Atendimos y resolvimos 2 solicitudes de tu equipo\./);
  assert.deepEqual(r.kpis.map((k) => k.label), ['Disponibilidad', 'Clientes potenciales', 'Revisiones automáticas', 'Cambios publicados', 'Amenazas detenidas', 'Solicitudes resueltas']);
  assert.deepEqual([r.kpis[1].value, r.kpis[4].value, r.kpis[5].value], ['12', '43', '2']);
  const work = r.sections.find((x) => x.title === 'Trabajo realizado este mes').items;
  assert.ok(work.includes('Atendimos 3 solicitudes de tu equipo (2 resueltas).'), JSON.stringify(work));
  assert.ok(work.includes('Resuelto: «No se guardaba el texto de servicios».'));
  assert.ok(work.includes('Resuelto: «Cambiar el horario de atención».'));
  assert.ok(!work.some((i) => /sigue en atención/.test(i)), 'what is still open is for the team');
  const care = r.sections.find((x) => x.title === 'Monitoreo y protección').items;
  assert.ok(care.includes('Verificamos 2.880 veces que los archivos del sitio no hubieran sido alterados.'), JSON.stringify(care));
  assert.ok(care.includes('El formulario de contacto detuvo 42 mensajes de spam.'));
  assert.doesNotMatch(clientText(r), TECH_WORDS);
  // Team
  const support = tech.sections.find((x) => x.title === 'Soporte técnico').items;
  assert.ok(support.includes('El equipo envió 3 solicitudes de soporte (2 resueltas).'), JSON.stringify(support));
  assert.ok(support.includes('Tiempo promedio hasta la solución: 18 horas.'));
  assert.ok(support.includes('1 solicitud sigue en atención.'));
  assert.ok(tech.sections.find((x) => x.title === 'Pendientes técnicos').items.includes('Dar seguimiento a 1 solicitud de soporte abierta.'));
  const auto = tech.sections.find((x) => x.title === 'Mantenimiento automático');
  assert.ok(auto.intro);
  for (const line of ['2.880 análisis de seguridad de los archivos del sitio', '30 copias de seguridad de la base de datos', 'Certificado de seguridad (HTTPS) verificado 30 veces',
    'Velocidad y preparación para Google medidas 30 veces', '42 mensajes de spam bloqueados en el formulario de contacto']) assert.ok(auto.items.includes(line), line);
  assert.ok(auto.items.some((x) => /^\d+ avisos automáticos enviados al equipo técnico$/.test(x)), 'watchdog + critical alerts');
  // English.
  const en = (await owner.get('/api/site-report/preview?lang=en&period=' + prev)).data;
  assert.ok(en.technical.sections.find((x) => x.title === 'Automatic maintenance').items.includes('2,880 security scans of the site files'));
  assert.ok(en.technical.sections.find((x) => x.title === 'Technical support').items.includes('Average time to resolution: 18 hours.'));
  assert.ok(en.report.sections.find((x) => x.title === 'Monitoring and protection').items.includes('We verified 2,880 times that the website files had not been altered.'));
  // The e-mail carries the client version only.
  const mail = (await owner.post('/api/site-report/send', { period: prev, test: true }));
  assert.equal(mail.status, 200, mail.text);
  const [msg] = (await waitForMail(ADMIN.email, 1)).filter((x) => /Informe del sitio web/.test(x.Subject));
  const full = await message(msg.ID);
  assert.ok(full.HTML.includes('Monitoreo y protección') && full.HTML.includes('Resuelto: «No se guardaba el texto de servicios».'));
  for (const word of ['Mantenimiento automático', 'copias de seguridad', 'Respaldo', 'Certificado', 'Pendientes técnicos']) {
    assert.ok(!full.HTML.includes(word) && !full.Text.includes(word), word);
  }
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
  const { report: r, technical: tech } = (await owner.get('/api/site-report/preview?period=' + prev)).data;
  // Clients: one plain line (scores of 90+ also become a key figure); the team: every score.
  assert.ok(r.sections.find((x) => x.title === 'Monitoreo y protección').items.includes('Google califica la velocidad del sitio en celulares con 86/100 (muy buena).'));
  assert.equal(r.kpis.find((k) => k.label === 'Velocidad en celulares'), undefined, 'below 90: not a headline figure');
  const visibility = tech.sections.find((x) => x.title === 'Visibilidad en Google');
  assert.ok(visibility.items.includes('Velocidad en computadoras: 99/100 (excelente)'));
  assert.ok(visibility.items.includes('Velocidad en celulares: 86/100 (muy buena)'));
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
  assert.match(mail.Subject, /^Informe del sitio web de /);
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
  assert.match(mail.Subject, /^\[Prueba\] Informe del sitio web/);
  assert.equal((await owner.get('/api/site-report')).data.history.length, historyBefore);
  await owner.put('/api/site-report/settings', { recipients: [], lang: 'en' });
  const solo = await owner.post('/api/site-report/send', { period: prev });
  assert.deepEqual([solo.data.to, solo.data.cc], [[ADMIN.email], []]);
  const enMail = await message((await waitForMail(ADMIN.email, before + 2))[0].ID);
  assert.match(enMail.Subject, /^Website report for /);
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
