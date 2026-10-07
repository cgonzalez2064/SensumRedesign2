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
    ...env,
  };
  const proc = spawn(PHP, ['-d', 'upload_max_filesize=16M', '-d', 'post_max_size=20M', '-d', 'memory_limit=256M',
    '-d', 'sendmail_path=/usr/bin/false', '-S', `127.0.0.1:${port}`, 'cms/dev/router.php'], { cwd: ROOT, env: fullEnv, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + '/api/health')).status) break; } catch (e) { /* not up yet */ }
    await sleep(100);
  }
  const cli = (args, input) => execFileSync(PHP, ['cms/bin/console', ...args], { cwd: ROOT, env: fullEnv, input, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
  return {
    base, dir, env: fullEnv, cli,
    storage: (p = '') => join(dir, 'storage', p),
    public: (p = '') => join(dir, 'public', p),
    readPublic: (p) => readFileSync(join(dir, 'public', p), 'utf8'),
    exists: (p) => existsSync(join(dir, p)),
    sql: (q) => execFileSync('sqlite3', [join(dir, 'storage', 'database.sqlite'), q]).toString().trim(),
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
export function linkToken(text, kind) {
  const m = text.match(new RegExp(`#/${kind}/([A-Za-z0-9_-]{43})`));
  return m ? m[1] : null;
}
export const unique = (prefix) => `${prefix}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.test`;
