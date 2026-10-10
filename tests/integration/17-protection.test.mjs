// Protection: two-step sign-in (TOTP + recovery codes, policy), encrypted
// off-server backups, and the daily e-mail/DNS + domain-expiry check.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer, Client, createAdmin, ADMIN, PHP, ROOT, mailpitUp, waitForMail, messagesTo, message, countTo, unique, totp, MAILPIT } from './helpers.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The RDAP stand-in runs in this process: CLI calls that reach it must not block the event loop.
const cliAsync = async (args) => (await promisify(execFile)(PHP, ['cms/bin/console', ...args], { cwd: ROOT, env: s.env })).stdout;
const nextStep = async () => { const ms = 30000 - (Date.now() % 30000); await sleep(ms + 200); };
let s; let owner; let backupTo; let alertsTo; let rdap; let rdapExpiry; let dnsFile;
const EDITOR = { name: 'Eva Editora', email: 'eva.editora@example.test', password: 'Clave-Eva-Editora-2026' };

before(async () => {
  assert.ok(await mailpitUp(), 'Mailpit must be running (mailpit &)');
  backupTo = unique('respaldos');
  alertsTo = unique('alertas');
  rdapExpiry = new Date(Date.now() + 400 * 86400000).toISOString();
  rdap = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rdap+json' });
    res.end(JSON.stringify({ ldhName: 'SENSUMCONSTRUCCIONES.COM', events: [{ eventAction: 'registration', eventDate: '2020-01-01T00:00:00Z' }, { eventAction: 'expiration', eventDate: rdapExpiry }],
      entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'NameCheap, Inc.']]] }] }));
  });
  await new Promise((r) => rdap.listen(8282, '127.0.0.1', r));
  dnsFile = join(mkdtempSync(join(tmpdir(), 'sensum-dns-')), 'dns.json');
  s = await startServer({ port: 8281, env: { TWO_FACTOR_POLICY: 'owner', ALERT_EMAIL: alertsTo, DNS_STUB_FILE: dnsFile, RDAP_URL: 'http://127.0.0.1:8282/domain' } });
  createAdmin(s);
  createAdmin(s, EDITOR);
  s.sql(`UPDATE users SET role='editor', permissions='texts' WHERE email='${EDITOR.email}'`);
  owner = new Client(s.base);
  await owner.login();
});
after(async () => { await s.stop(); await new Promise((r) => rdap.close(r)); });

// ------------------------------------------------------------------ two-step sign-in
let secret; let recovery;

test('the owner must set up two-step sign-in before using the panel', async () => {
  const sess = (await owner.get('/api/auth/session')).data.user;
  assert.equal(sess.twoFactorRequired, true);
  assert.equal(sess.twoFactor, false);
  const blocked = await owner.get('/api/dashboard');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error, 'two_factor_setup_required');
  assert.equal((await owner.get('/api/users')).status, 403);
  // Set-up needs the password again.
  assert.equal((await owner.post('/api/account/2fa/setup', { currentPassword: 'mal' })).status, 422);
  const setup = await owner.post('/api/account/2fa/setup', { currentPassword: ADMIN.password });
  assert.equal(setup.status, 200, setup.text);
  assert.match(setup.data.uri, /^otpauth:\/\/totp\/Sensum%20Construcciones%3A.+\?secret=[A-Z2-7]{32}&issuer=Sensum%20Construcciones/);
  assert.match(setup.data.qr, /^data:image\/svg\+xml;base64,/);
  assert.ok(Buffer.from(setup.data.qr.split(',')[1], 'base64').toString().includes('<svg'));
  secret = setup.data.secret;
  assert.equal((await owner.post('/api/account/2fa/enable', { code: '000000' })).status, 422);
  const before = await countTo(ADMIN.email);
  const on = await owner.post('/api/account/2fa/enable', { code: await totp(secret) });
  assert.equal(on.status, 200, on.text);
  recovery = on.data.recoveryCodes;
  assert.equal(recovery.length, 10);
  assert.ok(recovery.every((c) => /^[A-Z2-7]{5}-[A-Z2-7]{5}$/.test(c)));
  assert.equal(on.data.status.enabled, true);
  assert.equal((await owner.get('/api/dashboard')).status, 200, 'the panel opens once set up');
  const [m] = (await waitForMail(ADMIN.email, before + 1)).filter((x) => /Verificación en dos pasos activada/.test(x.Subject));
  assert.ok(m, 'security notice');
  // Secrets are encrypted at rest.
  assert.ok(!s.sql(`SELECT totp_secret_enc FROM users WHERE email='${ADMIN.email}'`).includes(secret.replace(/ /g, '')));
});

test('signing in asks for the code after the password; codes work once', async () => {
  await nextStep(); // the set-up code's time step is spent
  const c = new Client(s.base);
  const first = await c.login();
  assert.equal(first.status, 200);
  assert.equal(first.data.twoFactor, true);
  assert.equal(first.data.authenticated, false);
  assert.ok(!c.cookies.size, 'no session before the code');
  assert.equal((await c.get('/api/dashboard')).status, 401);
  const wrong = await c.post('/api/auth/login/2fa', { challenge: first.data.challenge, code: '123456' });
  assert.equal(wrong.status, 422);
  assert.equal(wrong.data.fields.code, 'two_factor_invalid');
  const code = await totp(secret);
  const ok = await c.post('/api/auth/login/2fa', { challenge: first.data.challenge, code });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.data.authenticated, true);
  c.csrf = ok.data.csrf;
  assert.equal((await c.get('/api/dashboard')).status, 200);
  // The same code cannot be used again (replay).
  const c2 = new Client(s.base);
  const again = await c2.login();
  assert.equal((await c2.post('/api/auth/login/2fa', { challenge: again.data.challenge, code })).status, 422);
  // The challenge is single-use and ends after five wrong codes.
  for (let i = 0; i < 4; i++) await c2.post('/api/auth/login/2fa', { challenge: again.data.challenge, code: '000000' });
  const expired = await c2.post('/api/auth/login/2fa', { challenge: again.data.challenge, code: await totp(secret) });
  assert.equal(expired.status, 401);
  assert.equal(expired.data.error, 'two_factor_expired');
  assert.equal((await c2.post('/api/auth/login/2fa', { challenge: 'x'.repeat(43), code: '123456' })).status, 401);
});

test('a recovery code signs in once and the person is told', async () => {
  const before = await countTo(ADMIN.email);
  const c = new Client(s.base);
  const r1 = await c.login();
  const ok = await c.post('/api/auth/login/2fa', { challenge: r1.data.challenge, code: recovery[0].toLowerCase() });
  assert.equal(ok.status, 200, ok.text);
  const c2 = new Client(s.base);
  const r2 = await c2.login();
  assert.equal((await c2.post('/api/auth/login/2fa', { challenge: r2.data.challenge, code: recovery[0] })).status, 422, 'used once');
  const [m] = (await waitForMail(ADMIN.email, before + 1)).filter((x) => /código de recuperación/.test(x.Subject));
  assert.ok(m);
  c.csrf = ok.data.csrf;
  assert.equal((await c.get('/api/account/2fa')).data.recoveryRemaining, 9);
  owner = c; // continue as this session
});

test('policy: the owner cannot turn it off while required; "all" covers everyone; IT can reset someone', async () => {
  const off = await owner.post('/api/account/2fa/disable', { currentPassword: ADMIN.password, code: recovery[1] });
  assert.equal(off.status, 409);
  assert.equal(off.data.error, 'two_factor_required_by_policy');
  const ed = new Client(s.base);
  await ed.login(EDITOR.email, EDITOR.password);
  assert.equal((await ed.get('/api/content')).status, 200, 'optional for others under "owner"');
  assert.equal((await owner.put('/api/security/policy', { twoFactor: 'all', currentPassword: 'mal' })).status, 422);
  const p = await owner.put('/api/security/policy', { twoFactor: 'all', currentPassword: ADMIN.password });
  assert.equal(p.status, 200);
  assert.equal(p.data.twoFactor.policy, 'all');
  assert.equal((await ed.get('/api/content')).status, 403, 'now required for the editor too');
  assert.equal((await ed.put('/api/security/policy', { twoFactor: 'none', currentPassword: EDITOR.password })).status, 403);
  // The editor sets it up, then IT resets it (lost phone).
  const setup = await ed.post('/api/account/2fa/setup', { currentPassword: EDITOR.password });
  await ed.post('/api/account/2fa/enable', { code: await totp(setup.data.secret) });
  const edId = Number(s.sql(`SELECT id FROM users WHERE email='${EDITOR.email}'`));
  assert.ok(s.sql(`SELECT totp_enabled_at FROM users WHERE id=${edId}`));
  const before = await countTo(EDITOR.email);
  const ownerId = Number(s.sql(`SELECT id FROM users WHERE email='${ADMIN.email}'`));
  const self = await owner.post(`/api/users/${ownerId}/2fa-reset`, { currentPassword: ADMIN.password });
  assert.equal(self.status, 422, 'your own second step is turned off in My account, with a code');
  assert.equal(self.data.fields.user, 'two_factor_self');
  const reset = await owner.post(`/api/users/${edId}/2fa-reset`, { currentPassword: ADMIN.password });
  assert.equal(reset.status, 200, reset.text);
  assert.equal(s.sql(`SELECT totp_enabled_at FROM users WHERE id=${edId}`), '');
  assert.equal((await ed.get('/api/auth/session')).data.authenticated, false, 'their sessions ended');
  assert.ok((await waitForMail(EDITOR.email, before + 1)).some((x) => /restableció tu verificación/.test(x.Subject)));
  // Back to "owner" and optional for the editor: they can turn it off with password + code.
  await owner.put('/api/security/policy', { twoFactor: 'owner', currentPassword: ADMIN.password });
  await ed.login(EDITOR.email, EDITOR.password);
  const setup2 = await ed.post('/api/account/2fa/setup', { currentPassword: EDITOR.password });
  await ed.post('/api/account/2fa/enable', { code: await totp(setup2.data.secret) });
  await nextStep();
  const dis = await ed.post('/api/account/2fa/disable', { currentPassword: EDITOR.password, code: await totp(setup2.data.secret) });
  assert.equal(dis.status, 200, dis.text);
  assert.equal(dis.data.status.enabled, false);
});

test('from the server terminal, IT can turn it off for an account (locked out)', () => {
  const out = s.cli(['2fa:reset', ADMIN.email]);
  assert.match(out, /Two-step sign-in turned off/);
  assert.equal(s.sql(`SELECT COUNT(*) FROM recovery_codes r JOIN users u ON u.id = r.user_id WHERE u.email='${ADMIN.email}'`), '0');
});

// ------------------------------------------------------------------ encrypted off-server backup

const pass = 'Respaldo-Sensum-Prueba-2026';
async function asOwner() {
  // After the reset above the owner must set up two-step sign-in again.
  const c = new Client(s.base);
  await c.login();
  const setup = await c.post('/api/account/2fa/setup', { currentPassword: ADMIN.password });
  await c.post('/api/account/2fa/enable', { code: await totp(setup.data.secret) });
  return c;
}

/** Opens the ZIP with PHP's ZipArchive and the password (as 7-Zip would). */
function readZip(path, password) {
  return JSON.parse(execFileSync(PHP, ['-r', `$z = new ZipArchive(); $z->open($argv[1]); $z->setPassword($argv[2]); $out = []; for ($i = 0; $i < $z->numFiles; $i++) { $st = $z->statIndex($i); $data = $z->getFromIndex($i); $out[] = ['name' => $st['name'], 'encrypted' => $st['encryption_method'], 'head' => $data === false ? null : substr($data, 0, 15)]; } echo json_encode($out);`, path, password]).toString());
}

test('encrypted backup: owner-only settings, password required, e-mailed as an AES-256 ZIP', async () => {
  owner = await asOwner();
  const ed = new Client(s.base);
  await ed.login(EDITOR.email, EDITOR.password);
  assert.equal((await ed.get('/api/security')).status, 403);
  const sec = await owner.get('/api/security');
  assert.equal(sec.status, 200);
  assert.equal(sec.data.backup.enabled, false);
  assert.equal(sec.data.backup.supported, true);
  const bad = await owner.put('/api/security/backup', { enabled: true, frequency: 'weekly', email: backupTo, password: 'corta', currentPassword: ADMIN.password });
  assert.equal(bad.status, 422);
  assert.equal(bad.data.fields.password, 'password_too_short');
  assert.equal((await owner.put('/api/security/backup', { enabled: true, frequency: 'hourly', email: backupTo, password: pass, currentPassword: ADMIN.password })).data.fields.frequency, 'invalid');
  const ok = await owner.put('/api/security/backup', { enabled: true, frequency: 'weekly', email: backupTo, password: pass, includePhotos: true, currentPassword: ADMIN.password });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.data.backup.passwordSet, true);
  assert.ok(!ok.text.includes(pass));
  assert.ok(!s.sql("SELECT value FROM settings WHERE key='offsite_backup'").includes(pass), 'encrypted at rest');

  const sent = await owner.post('/api/security/backup/send', {});
  assert.equal(sent.status, 200, sent.text);
  const [m] = await waitForMail(backupTo, 1);
  assert.match(m.Subject, /Respaldo cifrado del sitio/);
  const full = await message(m.ID);
  assert.ok(!full.Text.includes(pass) && !full.HTML.includes(pass), 'the password is never e-mailed');
  const att = full.Attachments.find((a) => /^respaldo-sensum-\d{4}-\d{2}-\d{2}\.zip$/.test(a.FileName));
  assert.ok(att, 'zip attached');
  const zipPath = join(mkdtempSync(join(tmpdir(), 'sensum-zip-')), 'r.zip');
  writeFileSync(zipPath, Buffer.from(await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}/part/${att.PartID}`)).arrayBuffer()));
  const files = readZip(zipPath, pass);
  const db = files.find((f) => f.name === 'sensum-cms/storage/database.sqlite');
  assert.ok(db);
  assert.equal(db.head, 'SQLite format 3');
  assert.ok(files.every((f) => f.encrypted === 259 /* ZipArchive::EM_AES_256 */), 'every entry AES-256');
  assert.ok(files.some((f) => f.name === 'LEEME-RESTAURAR.txt'));
  assert.equal(readZip(zipPath, 'otra-clave-cualquiera').find((f) => f.name.endsWith('database.sqlite')).head, null, 'wrong password → unreadable');
});

test('backup: downloadable with the password; sent by the scheduled check when due; alert when failing', async () => {
  assert.equal((await owner.post('/api/security/backup/download', { currentPassword: 'mal' })).status, 422);
  const res = await fetch(s.base + '/api/security/backup/download', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: s.base, Cookie: owner.cookieHeader(), 'X-CSRF-Token': owner.csrf }, body: JSON.stringify({ currentPassword: ADMIN.password }) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  assert.match(res.headers.get('content-disposition'), /attachment; filename="respaldo-sensum-/);
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 2).toString(), 'PK');

  assert.match(s.cli(['monitor']), /Off-site backup: not due/);
  const before = await countTo(backupTo);
  s.sql(`UPDATE settings SET value = json_set(value, '$.lastSentAt', ${Math.floor(Date.now() / 1000) - 8 * 86400}) WHERE key = 'offsite_backup'`);
  assert.match(s.cli(['monitor']), /Off-site backup: sent/);
  await waitForMail(backupTo, before + 1);
  assert.ok(Number(s.sql("SELECT json_extract(value, '$.\"' || strftime('%Y-%m') || '\".offsite') FROM settings WHERE key = 'maintenance_log'")) >= 2, 'counted for the monthly report');
  // A failing backup alerts the owner (once a day).
  const alerts = await countTo(alertsTo);
  s.sql(`UPDATE settings SET value = json_set(value, '$.lastStatus', 'failed', '$.lastAttemptAt', ${Math.floor(Date.now() / 1000)}) WHERE key = 'offsite_backup'`);
  assert.match(s.cli(['monitor']), /Alert offsite_backup: overdue, notified/);
  assert.ok((await waitForMail(alertsTo, alerts + 1)).some((x) => /respaldo fuera del servidor no se está enviando/.test(x.Subject)));
});

// ------------------------------------------------------------------ e-mail DNS and domain

const goodDns = {
  'sensumconstrucciones.com': { TXT: ['v=spf1 +a +mx include:spf.web-hosting.com ~all', 'google-site-verification=x'], MX: ['mail.sensumconstrucciones.com'] },
  'default._domainkey.sensumconstrucciones.com': { TXT: ['v=DKIM1; k=rsa; p=MIIBIjANBgkq'] },
  '_dmarc.sensumconstrucciones.com': { TXT: ['v=DMARC1; p=quarantine; rua=mailto:dmarc@sensumconstrucciones.com'] },
};

test('domain check: SPF, DKIM, DMARC, MX and expiry are read and shown; the report says so', async () => {
  writeFileSync(dnsFile, JSON.stringify(goodDns));
  const r = await owner.post('/api/monitor/domain-check', {});
  assert.equal(r.status, 200, r.text);
  const d = r.data.domain;
  assert.equal(d.domain, 'sensumconstrucciones.com');
  assert.ok(d.spf.ok && d.dkim.ok && d.dmarc.ok && d.mx.ok);
  assert.equal(d.dmarc.policy, 'quarantine');
  assert.equal(d.expiry.registrar, 'NameCheap, Inc.');
  assert.ok(d.expiry.validTo > Date.now() / 1000 + 300 * 86400);
  assert.deepEqual(d.problems, []);
  assert.equal((await owner.get('/api/monitor/summary')).data.domain.domain, 'sensumconstrucciones.com');
  const report = (await owner.get('/api/site-report/preview')).data.report;
  const sec = report.sections.find((x) => x.title === 'Seguridad y respaldos').items;
  assert.ok(sec.includes('El correo del dominio está protegido contra suplantación (SPF, DKIM y DMARC).'));
  assert.ok(sec.some((x) => /^El dominio sensumconstrucciones\.com está registrado hasta el /.test(x)));
});

test('domain check: missing or weak records and a domain about to expire alert the owner once', async () => {
  const bad = structuredClone(goodDns);
  bad['sensumconstrucciones.com'].TXT.push('v=spf1 -all');
  bad['_dmarc.sensumconstrucciones.com'].TXT = ['v=DMARC1; p=none'];
  delete bad['default._domainkey.sensumconstrucciones.com'];
  writeFileSync(dnsFile, JSON.stringify(bad));
  rdapExpiry = new Date(Date.now() + 20 * 86400000).toISOString();
  s.sql("DELETE FROM settings WHERE key = 'domain_health'");
  const before = await countTo(alertsTo);
  const out = await cliAsync(['monitor']);
  assert.match(out, /Domain and e-mail DNS: problems: spf, dkim, dmarc, expiry/);
  assert.match(out, /Alert email_dns: spf, dkim, dmarc, notified/);
  assert.match(out, /Alert domain_expiry: expires in (19|20) day\(s\), notified/);
  const mails = await waitForMail(alertsTo, before + 2);
  const dns = mails.find((x) => /configuración de correo/.test(x.Subject));
  const text = (await message(dns.ID)).Text;
  for (const k of ['más de un registro SPF', 'Falta la firma DKIM', 'solo observar']) assert.ok(text.includes(k), k);
  assert.ok(mails.some((x) => /El dominio sensumconstrucciones\.com vence en (19|20) día/.test(x.Subject)));
  const again = await cliAsync(['monitor']);
  assert.match(again, /Alert email_dns: spf, dkim, dmarc, already notified/);
  assert.match(again, /Alert domain_expiry: expires in (19|20) day\(s\), already notified/);
});
