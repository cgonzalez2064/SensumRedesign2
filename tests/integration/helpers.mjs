// Shared harness for the API integration tests.
//
// Every test file calls startServer(): a dedicated `php -S` instance on its
// own port, with a throwaway STORAGE_DIR (fresh SQLite database, fresh rate
// limits) and PUBLIC_DIR (published pages land there, never in the repo).
// E-mail goes to Mailpit (http://127.0.0.1:8025), or to a closed port when
// `smtpDown: true`, to exercise delivery failures.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURES = join(ROOT, 'tests', 'fixtures', 'out');
export const PHP = process.env.PHP_BIN || 'php';
export const MAILPIT = 'http://127.0.0.1:8025';

// Test images are generated, not committed: create them on first use.
if (!existsSync(join(FIXTURES, 'polyglot.jpg'))) {
  execFileSync(PHP, ['-d', 'memory_limit=1G', join(ROOT, 'tests', 'fixtures', 'make-fixtures.php')], { stdio: 'ignore' });
}
export const ADMIN = { name: 'Ana Administradora', email: 'ana.admin@example.test', password: 'Clave-De-Prueba-2026' };
// Critical-error alerts go to their own Mailpit address so they never mix with support-report counts.
export const ALERTS_TO = 'alerts@example.test';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startServer({ port, smtpDown = false, env = {}, reuseDir = null } = {}) {
  const dir = reuseDir || mkdtempSync(join(tmpdir(), 'sensum-test-'));
  const base = `http://127.0.0.1:${port}`;
  const fullEnv = {
    ...process.env,
    APP_ENV: 'development',
    APP_URL: base,
    EXTRA_ALLOWED_ORIGINS: '',
    STORAGE_DIR: join(dir, 'storage'),
    PUBLIC_DIR: join(dir, 'public'),
    MAIL_DRIVER: 'smtp',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: smtpDown ? '1' : '1025',
    SMTP_ENCRYPTION: 'none',
    SMTP_USERNAME: '',
    SMTP_TIMEOUT: '3',
    SMTP_FROM_ADDRESS: 'no-reply@sensumconstrucciones.com',
    SUPPORT_EMAIL: 'it@gruposensum.com',
    SETUP_TOKEN: 'test-setup-token-0123456789abcdef',
    OWNER_EMAIL: ADMIN.email, // the test administrator is the owner unless a test says otherwise
    ALERT_EMAIL: ALERTS_TO,
    TWO_FACTOR_POLICY: 'none', // two-step sign-in has its own tests (17-protection)
    PWNED_PASSWORDS_URL: 'off', // the leaked-password check has its own test with a local stub (29-automations)
    ...env,
  };
  const proc = spawn(PHP, ['-d', 'upload_max_filesize=16M', '-d', 'post_max_size=20M', '-d', 'memory_limit=256M',
    '-d', 'sendmail_path=/usr/bin/false', '-S', `127.0.0.1:${port}`, 'cms/dev/router.php'], { cwd: ROOT, env: fullEnv, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(base + '/api/health'); await r.arrayBuffer(); if (r.status) break; } catch (e) { /* not up yet */ }
    await sleep(100);
  }
  const cli = (args, input, env = {}) => execFileSync(PHP, ['cms/bin/console', ...args], { cwd: ROOT, env: { ...fullEnv, ...env }, input, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
  return {
    base, dir, env: fullEnv, cli,
    storage: (p = '') => join(dir, 'storage', p),
    public: (p = '') => join(dir, 'public', p),
    readPublic: (p) => readFileSync(join(dir, 'public', p), 'utf8'),
    exists: (p) => existsSync(join(dir, p)),
    // .timeout: wait for the server's write lock instead of failing with "database is locked".
    sql: (q) => execFileSync('sqlite3', ['-cmd', '.timeout 5000', join(dir, 'storage', 'database.sqlite'), q]).toString().trim(),
    async stop({ keep = false } = {}) { proc.kill(); await sleep(150); if (!keep) rmSync(dir, { recursive: true, force: true }); },
  };
}

export function createAdmin(server, user = ADMIN) {
  return server.cli(['create-admin', `--name=${user.name}`, `--email=${user.email}`], `${user.password}\n${user.password}\n`);
}

/** Minimal browser-like client: cookie jar, Origin header, CSRF header. */
export class Client {
  constructor(base, { origin } = {}) {
    this.base = base;
    this.origin = origin === undefined ? base : origin;
    this.cookies = new Map();
    this.csrf = null;
  }
  cookieHeader() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) {
    for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const [pair, ...attrs] = c.split(';');
      const [k, v] = pair.split('=');
      if (/expires=Thu, 01 Jan 1970|max-age=0/i.test(attrs.join(';')) || v === '' || v === 'deleted') this.cookies.delete(k.trim());
      else this.cookies.set(k.trim(), v.trim());
      this.lastSetCookie = c;
    }
  }
  async req(method, path, { json, form, headers = {}, csrf = true } = {}) {
    const h = { Accept: 'application/json', ...headers };
    if (this.origin) h.Origin = this.origin;
    if (this.cookies.size) h.Cookie = this.cookieHeader();
    if (csrf && this.csrf && method !== 'GET') h['X-CSRF-Token'] = this.csrf;
    let body;
    if (json !== undefined) { h['Content-Type'] = headers['Content-Type'] || 'application/json'; body = typeof json === 'string' ? json : JSON.stringify(json); }
    if (form) body = form;
    const res = await fetch(this.base + path, { method, headers: h, body, redirect: 'manual' });
    this.store(res);
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    return { status: res.status, data, text, headers: res.headers };
  }
  get(p, o) { return this.req('GET', p, o); }
  post(p, json, o = {}) { return this.req('POST', p, { json, ...o }); }
  put(p, json, o = {}) { return this.req('PUT', p, { json, ...o }); }
  del(p, o) { return this.req('DELETE', p, o); }
  async login(email = ADMIN.email, password = ADMIN.password) {
    const r = await this.post('/api/auth/login', { email, password });
    if (r.data && r.data.csrf) this.csrf = r.data.csrf;
    return r;
  }
  upload(path, fields, files = {}) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    for (const [k, f] of Object.entries(files)) fd.append(k, new Blob([readFileSync(join(FIXTURES, f))]), f);
    return this.req('POST', path, { form: fd });
  }
}

// ------------------------------------------------------------------ Mailpit
export async function mailpitUp() {
  try { return (await fetch(MAILPIT + '/api/v1/messages?limit=1')).ok; } catch (e) { return false; }
}
export async function messagesTo(address) {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent('to:' + address)}`);
  const data = await r.json();
  return data.messages || [];
}
export async function message(id) {
  return (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json();
}
/** Total matching messages (the search result itself is paged at 50). */
export async function countTo(address) {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent('to:' + address)}`);
  return (await r.json()).messages_count;
}
/** Waits until at least `count` messages exist for the address; returns the newest page. */
export async function waitForMail(address, count = 1, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await countTo(address)) >= count) return messagesTo(address);
    await sleep(150);
  }
  return messagesTo(address);
}
/** The 6-digit sign-in code in the newest e-mail to the address (sent after `before` messages). */
export async function emailedCode(address, before) {
  const list = await waitForMail(address, before + 1);
  const m = await message(list[0].ID);
  const found = /(\d{3}) (\d{3})/.exec(m.Text || '');
  return found ? found[1] + found[2] : null;
}
/** Signs in after «Quitar dispositivos registrados»: password, then the code e-mailed to the account. */
export async function loginWithEmailCode(client, email, password) {
  const before = await countTo(email);
  const r = await client.login(email, password);
  if (!r.data || r.data.method !== 'email') return r;
  const done = await client.post('/api/auth/login/2fa', { challenge: r.data.challenge, code: await emailedCode(email, before) });
  if (done.data && done.data.csrf) client.csrf = done.data.csrf;
  return done;
}
export function linkToken(text, kind) {
  const m = text.match(new RegExp(`#/${kind}/([A-Za-z0-9_-]{43})`));
  return m ? m[1] : null;
}
export const unique = (prefix) => `${prefix}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.test`;

// ------------------------------------------------------------------ contact-form captcha
/** Does what assets/main.js does in the browser: gets a challenge and finds the number. */
export async function solveCaptcha(base) {
  const { createHash } = await import('node:crypto');
  const c = await (await fetch(base + '/assets/contact-handler.php?challenge=1', { headers: { Accept: 'application/json' } })).json();
  for (let n = 0; n <= c.maxnumber; n++) {
    if (createHash('sha256').update(c.salt + n).digest('hex') === c.challenge) {
      return Buffer.from(JSON.stringify({ algorithm: c.algorithm, challenge: c.challenge, number: n, salt: c.salt, signature: c.signature })).toString('base64');
    }
  }
  throw new Error('captcha not solved');
}

// ------------------------------------------------------------------ two-step sign-in
/** The current 6-digit code for a base32 secret (what an authenticator app shows). */
export async function totp(secret, offsetSteps = 0) {
  const { createHmac } = await import('node:crypto');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = secret.replace(/[^A-Z2-7]/gi, '').toUpperCase().split('').map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from((bits.match(/.{8}/g) || []).map((b) => parseInt(b, 2)));
  const step = Math.floor(Date.now() / 1000 / 30) + offsetSteps;
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(step / 2 ** 32), 0);
  msg.writeUInt32BE(step >>> 0, 4);
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[19] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}

