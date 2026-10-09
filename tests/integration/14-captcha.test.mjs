// Contact-form captcha: the built-in proof-of-work challenge (always on) and the
// optional Cloudflare Turnstile layer configured by the owner in the panel.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { startServer, Client, createAdmin, ADMIN, ROOT, mailpitUp, waitForMail, countTo, solveCaptcha } from './helpers.mjs';

const RUN = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITE_KEY = '0x4AAAAAAATestSiteKey';
const SECRET = '0x4AAAAAAATestSecretKey_local';

let s; let owner; let contactTo; let stub;

/** A local stand-in for Cloudflare's siteverify (TURNSTILE_VERIFY_URL, honored only outside production). */
function startTurnstileStub(port) {
  const st = { requests: [], mode: 'ok', url: `http://127.0.0.1:${port}/siteverify` };
  st.server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const p = Object.fromEntries(new URLSearchParams(body));
      st.requests.push(p);
      if (st.mode === 'down') { res.writeHead(502); res.end('bad gateway'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (p.secret !== SECRET) { res.end(JSON.stringify({ success: false, 'error-codes': ['invalid-input-secret'] })); return; }
      if (p.response === 'ok-token') { res.end(JSON.stringify({ success: true, hostname: '127.0.0.1', action: 'contact' })); return; }
      if (p.response === 'other-site-token') { res.end(JSON.stringify({ success: true, hostname: 'evil.example' })); return; }
      res.end(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }));
    });
  });
  return new Promise((r) => st.server.listen(port, '127.0.0.1', () => r(st)));
}

const resetRateLimit = () => {
  const rl = join(ROOT, 'assets', '.rl-data', createHash('sha256').update('sensum-rl|127.0.0.1').digest('hex') + '.json');
  if (existsSync(rl)) rmSync(rl);
};

async function post(fields) {
  resetRateLimit(); // the handler allows 5 posts per 10 minutes per client
  const fd = new FormData();
  const values = { name: 'Mario Prueba', phone: '5555-4321', email: `mario-${RUN}@example.test`, service: 'Obra civil', message: 'Necesito una cotización para un muro perimetral.', loaded_at: String(Date.now() - 20000), ...fields };
  for (const [k, v] of Object.entries(values)) if (v !== undefined) fd.append(k, v);
  const res = await fetch(s.base + '/assets/contact-handler.php', { method: 'POST', body: fd, headers: { Accept: 'application/json', Origin: s.base } });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const stats = () => {
  const raw = s.sql("SELECT value FROM settings WHERE key = 'contact_stats'");
  const days = raw ? JSON.parse(raw) : {};
  return Object.values(days).reduce((a, d) => ({ sent: a.sent + (d.sent || 0), blocked: a.blocked + (d.blocked || 0) }), { sent: 0, blocked: 0 });
};

const panel = (over = {}) => ({
  smtp: { host: '127.0.0.1', port: 1025, encryption: 'none', username: '', password: '', fromAddress: 'notificaciones@sensumconstrucciones.com', fromName: 'Sensum Construcciones', replyTo: '' },
  supportEmail: 'it@gruposensum.com', alertEmail: 'alerts@example.test',
  contact: { to: [contactTo], fromAddress: 'formulario@sensumconstrucciones.com', fromName: 'Sitio web Sensum', method: 'smtp', turnstileSiteKey: '', turnstileSecret: '', ...over },
  currentPassword: ADMIN.password,
});

before(async () => {
  assert.ok(await mailpitUp(), 'Mailpit must be running (mailpit &)');
  contactTo = `captcha-${RUN}@example.test`;
  stub = await startTurnstileStub(8243);
  s = await startServer({ port: 8241, env: { TURNSTILE_VERIFY_URL: stub.url } });
  createAdmin(s);
  s.cli(['publish']);
  owner = new Client(s.base); await owner.login();
  assert.equal((await owner.put('/api/settings/email', panel())).status, 200);
});
after(async () => { await s.stop(); stub.server.close(); });

test('the challenge is signed, expiring and never cached', async () => {
  const res = await fetch(s.base + '/assets/contact-handler.php?challenge=1', { headers: { Accept: 'application/json' } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /no-store/);
  const c = await res.json();
  assert.equal(c.algorithm, 'SHA-256');
  assert.equal(c.maxnumber, 250000);
  assert.match(c.challenge, /^[0-9a-f]{64}$/);
  assert.match(c.signature, /^[0-9a-f]{64}$/);
  const exp = Number(c.salt.match(/\?expires=(\d+)$/)[1]);
  assert.ok(exp > Date.now() / 1000 + 1700 && exp < Date.now() / 1000 + 1900, 'valid for about 30 minutes');
  const other = await (await fetch(s.base + '/assets/contact-handler.php?challenge=1')).json();
  assert.notEqual(other.challenge, c.challenge, 'a new challenge every time');
  assert.equal((await fetch(s.base + '/assets/contact-handler.php')).status, 405, 'plain GET is still refused');
});

test('a message without a valid captcha answer is refused and nothing is sent', async () => {
  const before = await countTo(contactTo);
  const blocked = stats().blocked;
  const answer = await solveCaptcha(s.base);
  const decoded = JSON.parse(Buffer.from(answer, 'base64').toString());
  const forge = (patch) => Buffer.from(JSON.stringify({ ...decoded, ...patch })).toString('base64');
  for (const [why, captcha] of [
    ['missing', undefined],
    ['empty', ''],
    ['not base64/json', 'not-a-captcha!!'],
    ['huge', 'A'.repeat(5000)],
    ['wrong number', forge({ number: (decoded.number + 1) % 250001 })],
    ['number out of range', forge({ number: 9999999 })],
    ['number as text', forge({ number: String(decoded.number) })],
    ['forged signature', forge({ signature: 'f'.repeat(64) })],
    ['changed expiry', forge({ salt: decoded.salt.replace(/expires=\d+/, 'expires=9999999999') })],
    ['other algorithm', forge({ algorithm: 'SHA-1' })],
  ]) {
    const r = await post({ captcha });
    assert.equal(r.status, 400, why);
    assert.equal(r.data.error, 'captcha_failed', why);
  }
  await sleep(400);
  assert.equal(await countTo(contactTo), before, 'no e-mail for any of them');
  assert.equal(stats().blocked, blocked + 10, 'counted as blocked spam');
  // A self-made challenge (not signed by the server) is refused too.
  const salt = 'a'.repeat(24) + '?expires=' + (Math.floor(Date.now() / 1000) + 600);
  const fake = { algorithm: 'SHA-256', challenge: createHash('sha256').update(salt + '7').digest('hex'), number: 7, salt, signature: 'a'.repeat(64) };
  assert.equal((await post({ captcha: Buffer.from(JSON.stringify(fake)).toString('base64') })).status, 400);
});

test('a solved captcha lets the message through, once', async () => {
  const before = await countTo(contactTo);
  const sent = stats().sent;
  const captcha = await solveCaptcha(s.base);
  const ok = await post({ captcha });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  await waitForMail(contactTo, before + 1);
  assert.equal(await countTo(contactTo), before + 1);
  assert.equal(stats().sent, sent + 1);
  const replay = await post({ captcha });
  assert.equal(replay.status, 400, 'the same answer cannot be used twice');
  assert.equal(replay.data.error, 'captcha_failed');
});

test('honeypot and too-fast submissions still look successful to bots but are counted and dropped', async () => {
  const before = await countTo(contactTo);
  const blocked = stats().blocked;
  assert.equal((await post({ website: 'http://spam.example', captcha: await solveCaptcha(s.base) })).status, 200);
  assert.equal((await post({ loaded_at: String(Date.now()), captcha: await solveCaptcha(s.base) })).status, 200);
  await sleep(400);
  assert.equal(await countTo(contactTo), before);
  assert.equal(stats().blocked, blocked + 2);
});

test('Turnstile: configured in the panel (secret encrypted), published on the page, required by the form', async () => {
  // A site key needs its secret.
  const missing = await owner.put('/api/settings/email', panel({ turnstileSiteKey: SITE_KEY }));
  assert.equal(missing.status, 422);
  assert.equal(missing.data.fields['contact.turnstileSecret'], 'required');
  assert.equal((await owner.put('/api/settings/email', panel({ turnstileSiteKey: 'bad key <x>', turnstileSecret: SECRET }))).status, 422);

  const on = await owner.put('/api/settings/email', panel({ turnstileSiteKey: SITE_KEY, turnstileSecret: SECRET }));
  assert.equal(on.status, 200, on.text);
  assert.equal(on.data.republished, true);
  assert.ok(on.data.changed.includes('turnstile'));
  assert.deepEqual(on.data.settings.turnstile, { siteKey: SITE_KEY, secretSet: true, active: true });
  assert.ok(!on.text.includes(SECRET), 'the secret is never sent back');
  assert.ok(!s.sql("SELECT value FROM settings WHERE key = 'email_settings'").includes(SECRET), 'encrypted at rest');
  const html = s.readPublic('index.html');
  assert.ok(html.includes(`id="formTurnstile" data-sitekey="${SITE_KEY}"`), 'the page carries the site key');
  assert.ok(!html.includes(SECRET));

  const before = await countTo(contactTo);
  const noToken = await post({ captcha: await solveCaptcha(s.base) });
  assert.equal(noToken.status, 400);
  assert.equal(noToken.data.error, 'captcha_failed');
  assert.equal((await post({ captcha: await solveCaptcha(s.base), 'cf-turnstile-response': 'rejected-token' })).status, 400);
  assert.equal((await post({ captcha: await solveCaptcha(s.base), 'cf-turnstile-response': 'other-site-token' })).status, 400, 'token from another site');
  const ok = await post({ captcha: await solveCaptcha(s.base), 'cf-turnstile-response': 'ok-token' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const last = stub.requests.at(-1);
  assert.equal(last.secret, SECRET);
  assert.equal(last.response, 'ok-token');
  assert.equal(last.remoteip, '127.0.0.1');
  assert.ok(last.idempotency_key);
  // Turnstile does not replace the built-in captcha.
  assert.equal((await post({ 'cf-turnstile-response': 'ok-token' })).status, 400);
  await waitForMail(contactTo, before + 1);
  assert.equal(await countTo(contactTo), before + 1);
});

test('Turnstile: if Cloudflare is unreachable the form keeps working with the built-in captcha (and IT is told)', async () => {
  stub.mode = 'down';
  try {
    const r = await post({ captcha: await solveCaptcha(s.base), 'cf-turnstile-response': 'anything' });
    assert.equal(r.status, 200);
    assert.ok(Number(s.sql("SELECT COUNT(*) FROM error_log WHERE event = 'turnstile_unreachable'")) >= 1);
  } finally { stub.mode = 'ok'; }
});

test('Turnstile: turning it off in the panel removes it from the page', async () => {
  const off = await owner.put('/api/settings/email', panel());
  assert.equal(off.status, 200);
  assert.equal(off.data.republished, true);
  assert.equal(off.data.settings.turnstile.active, false);
  assert.ok(!s.readPublic('index.html').includes('formTurnstile'));
  assert.equal((await post({ captcha: await solveCaptcha(s.base) })).status, 200, 'no token needed any more');
});

test('the public page loads the captcha script only from the allowed origin', () => {
  const html = s.readPublic('index.html');
  assert.ok(html.includes('id="formCaptchaAnswer" name="captcha"'));
  assert.ok(html.includes('id="formCaptcha"'));
  assert.ok(!/<script[^>]+challenges\.cloudflare\.com/.test(html), 'Turnstile is loaded lazily by main.js, only when enabled');
});
