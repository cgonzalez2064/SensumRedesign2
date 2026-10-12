// E-mail settings (owner only), the public contact form using them, and the automatic alerts (Watchdog).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, appendFileSync, mkdirSync, utimesSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { startServer, Client, createAdmin, ADMIN, ROOT, mailpitUp, waitForMail, messagesTo, message, countTo, unique, solveCaptcha } from './helpers.mjs';

const RUN = Date.now().toString(36);
const OTHER_ADMIN = { name: 'Otra Admin', email: 'otra.admin@example.test', password: 'Clave-Otra-Admin-2026' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const UA_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const UA_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

let s; let owner; let other; let alertsTo; let supportTo; let contactTo;

/** The panel settings the tests save: Mailpit on 127.0.0.1:1025, no encryption, no login. */
const settings = (over = {}) => ({
  smtp: { host: '127.0.0.1', port: 1025, encryption: 'none', username: '', password: '', fromAddress: 'notificaciones@sensumconstrucciones.com', fromName: 'Sensum Construcciones', replyTo: 'soporte@sensumconstrucciones.com', ...(over.smtp || {}) },
  supportEmail: over.supportEmail || supportTo,
  alertEmail: over.alertEmail || alertsTo,
  contact: { to: [contactTo], fromAddress: 'formulario@sensumconstrucciones.com', fromName: 'Sitio web Sensum', method: 'smtp', ...(over.contact || {}) },
  currentPassword: over.currentPassword === undefined ? ADMIN.password : over.currentPassword,
});

/** Posts the public contact form like the site's own JavaScript does. */
async function submitContact(fields = {}) {
  // The handler allows 5 submissions per client every 10 minutes: start each test clean.
  const rl = join(ROOT, 'assets', '.rl-data', createHash('sha256').update('sensum-rl|127.0.0.1').digest('hex') + '.json');
  if (existsSync(rl)) rmSync(rl);
  const fd = new FormData();
  const values = { name: 'Lucía Visitante', phone: '5555-1234', email: `visitante-${RUN}@example.test`, service: 'Remodelaciones', message: 'Quisiera una cotización para remodelar mi cocina.', loaded_at: String(Date.now() - 20000), captcha: await solveCaptcha(s.base), ...fields };
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  const res = await fetch(s.base + '/assets/contact-handler.php', { method: 'POST', body: fd, headers: { Accept: 'application/json', Origin: s.base } });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const subjects = async (address) => (await messagesTo(address)).map((m) => m.Subject);
const monitor = () => s.cli(['monitor']);
const setSetting = (key, value) => s.sql(`INSERT INTO settings (key, value, updated_at) VALUES ('${key}', '${value}', ${now()}) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);

before(async () => {
  assert.ok(await mailpitUp(), 'Mailpit must be running (mailpit &)');
  alertsTo = `alerts-${RUN}@example.test`;
  supportTo = `support-${RUN}@example.test`;
  contactTo = `contacto-${RUN}@example.test`;
  s = await startServer({ port: 8231, env: { ALERT_EMAIL: alertsTo } });
  createAdmin(s);
  createAdmin(s, OTHER_ADMIN);
  s.cli(['publish']);
  owner = new Client(s.base); await owner.login();
  other = new Client(s.base); await other.login(OTHER_ADMIN.email, OTHER_ADMIN.password);
});
after(async () => { await s.stop(); });

// ------------------------------------------------------------------ e-mail settings

test('only the owner can see or change the e-mail settings', async () => {
  for (const [method, path, body] of [['GET', '/api/settings/email'], ['PUT', '/api/settings/email', settings()], ['POST', '/api/settings/email/test', { target: 'panel' }]]) {
    assert.equal((await other.req(method, path, { json: body })).status, 403, path);
    assert.equal((await new Client(s.base).req(method, path, { json: body })).status, 401, path);
  }
  const r = await owner.get('/api/settings/email');
  assert.equal(r.status, 200);
  assert.equal(r.data.locked, false);
  assert.equal(r.data.smtp.host, '127.0.0.1', 'falls back to .env');
  assert.equal(r.data.sources.smtp, 'env');
  assert.equal(r.data.sources.contact, 'default');
  assert.equal(r.data.contact.configured, false);
  assert.equal(r.data.alertEmail, alertsTo);
  assert.ok(!('password' in r.data.smtp), 'the SMTP password is never sent to the browser');
});

test('saving needs the password again and valid values', async () => {
  const noPw = await owner.put('/api/settings/email', settings({ currentPassword: '' }));
  assert.equal(noPw.status, 422);
  assert.equal(noPw.data.fields.currentPassword, 'current_password_wrong');
  const wrong = await owner.put('/api/settings/email', settings({ currentPassword: 'no-es-la-clave' }));
  assert.equal(wrong.status, 422);
  assert.equal(wrong.data.fields.currentPassword, 'current_password_wrong');

  const bad = await owner.put('/api/settings/email', settings({
    smtp: { host: 'mail server', port: 70000, encryption: 'starttls', fromAddress: 'no es correo', fromName: "Sensum\r\nBcc: x@evil.test" },
    supportEmail: 'x', contact: { to: ['a@example.test', 'b@example.test', 'c@example.test', 'd@example.test'], fromAddress: 'formulario@sensumconstrucciones.com', fromName: '<b>Sensum</b>' },
  }));
  assert.equal(bad.status, 422);
  for (const f of ['smtp.host', 'smtp.port', 'smtp.encryption', 'smtp.fromAddress', 'smtp.fromName', 'supportEmail', 'contact.to', 'contact.fromName']) assert.ok(bad.data.fields[f], f);
  const injected = await owner.put('/api/settings/email', settings({ contact: { to: ['contacto@example.test\r\nBcc: x@evil.test'] } }));
  assert.equal(injected.status, 422);
  assert.equal((await owner.get('/api/settings/email')).data.sources.contact, 'default', 'nothing was saved');
});

test('the owner saves the settings: stored encrypted, logged, and a security notice is e-mailed', async () => {
  const before = await countTo(ADMIN.email);
  const r = await owner.put('/api/settings/email', settings({ smtp: { password: 'Prueba-Smtp-Solo-Local-1' } }));
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.changed.sort(), ['contact', 'smtp', 'supportEmail'], 'the alerts address was already the same');
  assert.equal(r.data.settings.sources.smtp, 'panel');
  assert.equal(r.data.settings.smtp.passwordSet, true);
  assert.ok(!r.text.includes('Prueba-Smtp-Solo-Local-1'), 'the password is not echoed');
  const stored = s.sql("SELECT value FROM settings WHERE key = 'email_settings'");
  assert.ok(stored.includes('passwordEnc') && !stored.includes('Prueba-Smtp-Solo-Local-1'), 'encrypted at rest');
  assert.ok(Number(s.sql("SELECT COUNT(*) FROM activity_log WHERE action = 'email_settings_changed'")) >= 1);
  const mails = await waitForMail(ADMIN.email, before + 1);
  const notice = mails.find((m) => /configuración de correo/i.test(m.Subject));
  assert.ok(notice, 'security notice to the owner');
  const full = await message(notice.ID);
  assert.equal(full.From.Address, 'notificaciones@sensumconstrucciones.com', 'sent with the new settings');
  assert.match(full.Text, /formulario de contacto/);

  // Saving again with an empty password keeps the stored one; no changes → no notice.
  // (Compared by message id, not by count: the shared test inbox drops its oldest messages.)
  const notices = async () => (await messagesTo(ADMIN.email)).filter((m) => /configuración de correo/i.test(m.Subject)).map((m) => m.ID);
  const seen = new Set(await notices());
  const again = await owner.put('/api/settings/email', settings());
  assert.equal(again.status, 200);
  assert.deepEqual(again.data.changed, []);
  assert.equal(again.data.settings.smtp.passwordSet, true);
  await sleep(600);
  assert.deepEqual((await notices()).filter((id) => !seen.has(id)), [], 'no notice without changes');
});

test('panel e-mail uses the saved sender and Reply-To; the test reaches owner, reports and alerts', async () => {
  const r = await owner.post('/api/settings/email/test', { target: 'panel' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.to.sort(), [ADMIN.email, alertsTo, supportTo].sort());
  const [m] = (await waitForMail(supportTo, 1)).filter((x) => /Prueba de la cuenta/.test(x.Subject));
  assert.ok(m);
  const full = await message(m.ID);
  assert.equal(full.From.Address, 'notificaciones@sensumconstrucciones.com');
  assert.equal(full.ReplyTo[0].Address, 'soporte@sensumconstrucciones.com');
  assert.ok(full.HTML.includes('cid:'), 'branded layout with the embedded logo');
});

test('the public contact form is delivered with the panel settings', async () => {
  const r = await submitContact();
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const [m] = await waitForMail(contactTo, 1);
  assert.ok(m, 'lead delivered to the configured inbox');
  const full = await message(m.ID);
  assert.equal(full.From.Address, 'formulario@sensumconstrucciones.com');
  assert.equal(full.From.Name, 'Sitio web Sensum');
  assert.equal(full.ReplyTo[0].Address, `visitante-${RUN}@example.test`, 'replying goes to the visitor');
  assert.match(full.Subject, /Lucía Visitante/);
  assert.match(full.Text, /cotización para remodelar/);
  assert.ok(full.HTML.includes('Lucía Visitante') && full.HTML.includes('Remodelaciones'));

  // HTML in the visitor's text is shown as text, never as markup.
  const x = await submitContact({ name: 'Eva <img src=x onerror=alert(1)>', message: '<script>alert(1)</script> necesito una cotización' });
  assert.equal(x.status, 200);
  const latest = (await waitForMail(contactTo, 2)).find((mm) => /Eva/.test(mm.Subject));
  const html = (await message(latest.ID)).HTML;
  assert.ok(!html.includes('<script>alert(1)') && !html.includes('<img src=x'), 'escaped');
  assert.ok(html.includes('&lt;script&gt;'));

  // The test button sends a sample lead marked [Prueba].
  const t = await owner.post('/api/settings/email/test', { target: 'contact' });
  assert.equal(t.status, 200);
  assert.ok((await waitForMail(contactTo, 3)).some((mm) => /^\[Prueba\]/.test(mm.Subject)));
});

test('if the contact e-mail cannot be sent, the message is still saved in Prospectos and the owner sees the failure', async () => {
  // The hosting's mail() is unavailable in tests (sendmail_path=/usr/bin/false).
  assert.equal((await owner.put('/api/settings/email', settings({ contact: { method: 'mail' } }))).status, 200);
  const before = Number(s.sql('SELECT COUNT(*) FROM leads'));
  const r = await submitContact();
  assert.equal(r.status, 200, 'the visitor is told it was received: it is stored');
  assert.equal(Number(s.sql('SELECT COUNT(*) FROM leads')), before + 1);
  assert.equal(s.sql('SELECT notified FROM leads ORDER BY id DESC LIMIT 1'), '0', 'marked as not e-mailed');
  assert.ok(Number(s.sql("SELECT COUNT(*) FROM error_log WHERE event = 'contact_form_failed'")) >= 1);
  // Without the Content Manager database the visitor still gets the error (nothing was kept).
  s.sql('ALTER TABLE leads RENAME TO leads_off');
  try {
    const r2 = await submitContact();
    assert.equal(r2.status, 500);
    assert.equal(r2.data.error, 'send_failed');
  } finally { s.sql('ALTER TABLE leads_off RENAME TO leads'); }
  assert.equal((await owner.put('/api/settings/email', settings())).status, 200);
});

test('EMAIL_SETTINGS_LOCKED makes the page read-only', async () => {
  const locked = await startServer({ port: 8232, env: { ALERT_EMAIL: alertsTo, EMAIL_SETTINGS_LOCKED: 'true' } });
  try {
    createAdmin(locked);
    const c = new Client(locked.base); await c.login();
    assert.equal((await c.get('/api/settings/email')).data.locked, true);
    const r = await c.put('/api/settings/email', settings());
    assert.equal(r.status, 409);
    assert.equal(r.data.error, 'settings_locked');
  } finally { await locked.stop(); }
});

// ------------------------------------------------------------------ automatic alerts

test('automatic alerts: the owner can list and switch them; nobody else can', async () => {
  const sum = (await owner.get('/api/monitor/summary')).data;
  assert.equal(Object.keys(sum.rules.enabled).length, 16);
  assert.ok(Object.values(sum.rules.enabled).every((v) => v === true), 'all on by default');
  const off = await owner.put('/api/monitor/alerts', { rules: { weekly_digest: false } });
  assert.equal(off.status, 200);
  assert.equal(off.data.enabled.weekly_digest, false);
  assert.equal(off.data.enabled.integrity, true);
  assert.equal((await owner.put('/api/monitor/alerts', { rules: { not_a_rule: false } })).status, 422);
  assert.equal((await owner.put('/api/monitor/alerts', { rules: { integrity: 'no' } })).status, 422);
  assert.equal((await other.put('/api/monitor/alerts', { rules: { integrity: false } })).status, 403);
  assert.equal((await other.get('/api/monitor/integrity')).status, 403);
  assert.equal((await owner.put('/api/monitor/alerts', { rules: { weekly_digest: true } })).data.enabled.weekly_digest, true);
});

test('integrity: first check records the files; new, odd or changed files are reported once', async () => {
  mkdirSync(s.public('assets/uploads'), { recursive: true });
  writeFileSync(s.public('.htaccess'), 'RewriteEngine On\n');
  const first = monitor();
  assert.match(first, /Alert integrity: baseline recorded/);
  assert.match(monitor(), /Alert integrity: ok/);

  // cPanel rewriting its own block in .htaccess (e.g. changing the PHP version) is not tampering.
  appendFileSync(s.public('.htaccess'), '\n# php -- BEGIN cPanel-generated handler, do not edit\n<IfModule mime_module>\n  AddHandler application/x-httpd-ea-php83 .php\n</IfModule>\n# php -- END cPanel-generated handler, do not edit\n');
  assert.match(monitor(), /Alert integrity: ok/);

  const before = await countTo(alertsTo);
  writeFileSync(s.public('assets/wp-config.php'), '<?php // dropped by an attacker');
  writeFileSync(s.public('assets/uploads/shell.php.jpg'), 'GIF89a<?php');
  writeFileSync(s.public('.htaccess'), 'RewriteEngine On\nAddType application/x-httpd-php .jpg\n');
  assert.match(monitor(), /Alert integrity: 3 finding\(s\), notified/);
  const mails = await waitForMail(alertsTo, before + 1);
  const alert = mails.find((m) => /cambios en los archivos/i.test(m.Subject));
  assert.ok(alert);
  const text = (await message(alert.ID)).Text;
  for (const p of ['assets/wp-config.php', 'assets/uploads/shell.php.jpg', 'Modificado: .htaccess']) assert.ok(text.includes(p), p);
  assert.match(text, /integrity:accept/);
  // Same findings: no new e-mail until the daily reminder.
  assert.match(monitor(), /already notified/);
  await sleep(300);
  assert.equal(await countTo(alertsTo), before + 1);

  // The owner reviews them in the panel and accepts with the password.
  const list = (await owner.get('/api/monitor/integrity')).data.findings;
  assert.deepEqual(list.map((f) => f.type).sort(), ['modified', 'new', 'upload']);
  assert.equal((await owner.post('/api/monitor/integrity/accept', { currentPassword: 'mal' })).status, 422);
  rmSync(s.public('assets/uploads/shell.php.jpg'));
  const ok = await owner.post('/api/monitor/integrity/accept', { currentPassword: ADMIN.password });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data.findings, []);
  assert.match(monitor(), /Alert integrity: ok/);
  // From the server terminal too.
  rmSync(s.public('assets/wp-config.php'));
  assert.match(s.cli(['integrity:accept']), /Accepted the current public files/);
  assert.match(monitor(), /Alert integrity: ok/);
});

test('login attack: many failed sign-ins in an hour alert the owner once', async () => {
  const before = await countTo(alertsTo);
  for (let i = 0; i < 12; i++) s.sql(`INSERT INTO activity_log (user_id, action, target, details, ip_hash, created_at) VALUES (NULL, 'login_failed', '', '{}', 'ip${i % 4}', ${now() - i * 60})`);
  assert.match(monitor(), /Alert login_attack: notified/);
  const mail = (await waitForMail(alertsTo, before + 1)).find((m) => /intentos fallidos/i.test(m.Subject));
  assert.ok(mail);
  assert.match((await message(mail.ID)).Text, /Contraseñas incorrectas: 12/);
  assert.match(monitor(), /Alert login_attack: attack in progress, already notified/);
  // Switched off: not even evaluated.
  await owner.put('/api/monitor/alerts', { rules: { login_attack: false } });
  assert.match(monitor(), /Alert login_attack: off/);
  await owner.put('/api/monitor/alerts', { rules: { login_attack: true } });
});

test('new device: the person is told about a sign-in from a browser they had not used', async () => {
  const user = { name: 'Nina Nueva', email: unique('nina'), password: 'Clave-Nina-Nueva-2026' };
  createAdmin(s, user);
  const login = (ua) => new Client(s.base).post('/api/auth/login', { email: user.email, password: user.password }, { headers: { 'User-Agent': ua } });
  assert.equal((await login(UA_MAC)).status, 200);
  await sleep(600);
  assert.equal(await countTo(user.email), 0, 'the first device of an account is not "new"');
  assert.equal((await login(UA_MAC)).status, 200);
  await sleep(400);
  assert.equal(await countTo(user.email), 0, 'same browser: no notice');
  assert.equal((await login(UA_WIN)).status, 200);
  const [m] = await waitForMail(user.email, 1);
  assert.ok(m && /Nuevo inicio de sesión/.test(m.Subject));
  const text = (await message(m.ID)).Text;
  assert.match(text, /Chrome · Windows/);
  assert.match(text, /127\.0\.0\.1/);
  assert.equal(Number(s.sql(`SELECT COUNT(*) FROM known_devices d JOIN users u ON u.id = d.user_id WHERE u.email = '${user.email}'`)), 2);
});

test('certificate, backup, error spike: each alerts once per period', async () => {
  const before = await countTo(alertsTo);
  setSetting('tls_expiry', JSON.stringify({ validTo: now() + 5 * 86400 + 3600, checkedAt: now() }));
  const dir = s.storage('backups/db');
  mkdirSync(dir, { recursive: true });
  const old = join(dir, 'database-20260101-000000.sqlite');
  writeFileSync(old, 'x');
  utimesSync(old, now() - 3 * 86400, now() - 3 * 86400);
  for (let i = 0; i < 30; i++) s.sql(`INSERT INTO error_log (created_at, severity, source, event, message, fingerprint) VALUES (${now() - i * 30}, 'error', 'server', 'mail_failed', 'SMTP timeout', 'fp-spike')`);
  const out = monitor();
  assert.match(out, /Alert certificate: expires in 5 day\(s\), notified/);
  assert.match(out, /Alert backup: latest 72 h ago, notified/);
  assert.match(out, /Alert error_spike: spike \(3\d\), notified/);
  const subs = await (async () => { await waitForMail(alertsTo, before + 3); return subjects(alertsTo); })();
  assert.ok(subs.some((x) => /vence en 5 día/.test(x)), 'certificate');
  assert.ok(subs.some((x) => /respaldo automático/.test(x)), 'backup');
  assert.ok(subs.some((x) => /Aumento inusual de errores/.test(x)), 'error spike');
  const again = monitor();
  assert.match(again, /certificate: expires in 5 day\(s\), already notified/);
  assert.match(again, /backup: latest 72 h ago, already notified/);
  assert.match(again, /error_spike: spike, already notified/);
  rmSync(old);
});

test('a stopped scheduler is noticed from the health check', async () => {
  const before = await countTo(alertsTo);
  setSetting('monitor_last_run', String(now() - 3 * 3600));
  await (await fetch(s.base + '/api/health')).arrayBuffer();
  const mail = (await waitForMail(alertsTo, before + 1)).find((m) => /dejó de ejecutarse/.test(m.Subject));
  assert.ok(mail, 'scheduler alert');
  await (await fetch(s.base + '/api/health')).arrayBuffer();
  await sleep(500);
  assert.equal(await countTo(alertsTo), before + 1, 'once a day');
});

test('weekly summary and monthly review once the site has been in use for a week', async () => {
  // Monday 00:00–08:00 and the 1st 00:00–08:00 (site time) are "not yet": skip those assertions then.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Guatemala', weekday: 'short', day: 'numeric', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  const early = Number(parts.hour) < 8;
  const before = await countTo(alertsTo);
  assert.match(monitor(), /weekly_digest: not due/, 'not during the first week');
  s.sql(`UPDATE users SET created_at = ${now() - 10 * 86400}`);
  const out = monitor();
  let expected = before;
  if (!(early && parts.weekday === 'Mon')) { assert.match(out, /weekly_digest: sent/); expected++; }
  if (!(early && parts.day === '1')) { assert.match(out, /monthly_review: sent/); expected++; }
  const subs = await (async () => { await waitForMail(alertsTo, expected); return subjects(alertsTo); })();
  if (out.includes('weekly_digest: sent')) {
    const m = (await messagesTo(alertsTo)).find((x) => /Resumen técnico semanal/.test(x.Subject));
    const text = (await message(m.ID)).Text;
    for (const k of ['Disponibilidad', 'Errores críticos', 'Inicios de sesión', 'Certificado HTTPS', 'Formulario de contacto']) assert.ok(text.includes(k), k);
  }
  if (out.includes('monthly_review: sent')) {
    assert.ok(subs.some((x) => /Revisión mensual de seguridad/.test(x)));
    const m = (await messagesTo(alertsTo)).find((x) => /Revisión mensual/.test(x.Subject));
    assert.match((await message(m.ID)).Text, /PHP \d+\.\d+/);
  }
  const again = monitor();
  assert.match(again, /weekly_digest: not due/);
  assert.match(again, /monthly_review: not due/);
});

test('critical-error e-mails can be switched off (still logged)', async () => {
  await owner.put('/api/monitor/alerts', { rules: { critical_errors: false } });
  chmodSync(s.public(), 0o555);
  try {
    const sections = (await owner.get('/api/content')).data.sections;
    const v = sections.find((x) => x.id === 'footer').version;
    const r = await owner.put('/api/content/footer', { version: v, values: { 'footer.about_desc': { es: 'Texto que no se puede publicar ' + RUN } } });
    assert.equal(r.status, 500);
  } finally { chmodSync(s.public(), 0o755); }
  await sleep(300);
  assert.equal(s.sql("SELECT alert FROM error_log WHERE severity = 'critical' ORDER BY id DESC LIMIT 1"), 'off');
  await owner.put('/api/monitor/alerts', { rules: { critical_errors: true } });
});
