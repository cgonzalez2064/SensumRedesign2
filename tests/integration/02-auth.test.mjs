// Authentication: setup, login, sessions, cookies, CSRF/origin, throttling.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, ADMIN } from './helpers.mjs';

let s;
before(async () => { s = await startServer({ port: 8192 }); });
after(async () => { await s.stop(); });

test('first-time setup requires SETUP_TOKEN and closes after the first user', async () => {
  const c = new Client(s.base);
  const sess = await c.get('/api/auth/session');
  assert.equal(sess.data.authenticated, false);
  assert.equal(sess.data.setupRequired, true);
  const bad = await c.post('/api/setup', { setupToken: 'wrong', name: 'X', email: 'x@example.test', password: 'Una-Clave-Larga-1', passwordConfirm: 'Una-Clave-Larga-1' });
  assert.equal(bad.status, 422);
  assert.equal(bad.data.fields.setupToken, 'invalid_setup_token');
  const weak = await c.post('/api/setup', { setupToken: s.env.SETUP_TOKEN, name: ADMIN.name, email: ADMIN.email, password: 'corta', passwordConfirm: 'corta' });
  assert.equal(weak.data.fields.password, 'password_too_short');
  const ok = await c.post('/api/setup', { setupToken: s.env.SETUP_TOKEN, name: ADMIN.name, email: ADMIN.email, password: ADMIN.password, passwordConfirm: ADMIN.password });
  assert.equal(ok.status, 200);
  const again = await new Client(s.base).post('/api/setup', { setupToken: s.env.SETUP_TOKEN, name: 'Y', email: 'y@example.test', password: ADMIN.password, passwordConfirm: ADMIN.password });
  assert.equal(again.status, 410);
  assert.equal(again.data.error, 'setup_closed');
  assert.equal((await new Client(s.base).get('/api/auth/session')).data.setupRequired, false);
});

test('passwords are stored hashed (Argon2id or bcrypt), never in plain text', () => {
  const hash = s.sql(`SELECT password_hash FROM users WHERE email='${ADMIN.email}'`);
  assert.match(hash, /^\$(argon2id|2y)\$/);
  assert.ok(!s.sql('SELECT group_concat(password_hash) FROM users').includes(ADMIN.password));
});

test('login errors are generic for wrong password and unknown accounts', async () => {
  const wrong = await new Client(s.base).login(ADMIN.email, 'incorrecta-123');
  const unknown = await new Client(s.base).login('nadie@example.test', 'incorrecta-123');
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(wrong.data, unknown.data);
  assert.deepEqual(wrong.data, { ok: false, error: 'invalid_credentials' });
});

test('login sets a secure session cookie and returns a CSRF token', async () => {
  const c = new Client(s.base);
  const r = await c.login();
  assert.equal(r.status, 200);
  assert.equal(r.data.user.email, ADMIN.email);
  assert.match(r.data.csrf, /^[a-f0-9]{64}$/);
  assert.match(c.lastSetCookie, /HttpOnly/i);
  assert.match(c.lastSetCookie, /SameSite=Strict/i);
  assert.match(c.lastSetCookie, /path=\//i);
  assert.ok(!JSON.stringify(r.data).includes('password'));
  // Only a hash of the session cookie is stored.
  const raw = [...c.cookies.values()][0];
  assert.equal(s.sql(`SELECT COUNT(*) FROM sessions WHERE id_hash='${raw}'`), '0');
});

test('protected endpoints reject anonymous requests', async () => {
  const anon = new Client(s.base);
  for (const [m, p] of [['GET', '/api/dashboard'], ['GET', '/api/content'], ['PUT', '/api/content/hero'], ['GET', '/api/media'], ['GET', '/api/users'], ['POST', '/api/users'], ['GET', '/api/reports'], ['POST', '/api/reports'], ['PUT', '/api/account/profile'], ['POST', '/api/account/password'], ['POST', '/api/site/republish']]) {
    const r = await anon.req(m, p, { json: m === 'GET' ? undefined : {} });
    assert.equal(r.status, 401, `${m} ${p}`);
    assert.equal(r.data.error, 'unauthenticated');
  }
});

test('state-changing requests need the same Origin and the CSRF token', async () => {
  const c = new Client(s.base);
  await c.login();
  const noCsrf = await c.put('/api/account/profile', { name: 'X', lang: 'es', theme: 'system' }, { csrf: false });
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.data.error, 'csrf_failed');
  const evil = new Client(s.base, { origin: 'https://evil.example' });
  evil.cookies = c.cookies; evil.csrf = c.csrf;
  const r = await evil.put('/api/account/profile', { name: 'X', lang: 'es', theme: 'system' });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, 'forbidden_origin');
  const none = new Client(s.base, { origin: null });
  none.cookies = c.cookies; none.csrf = c.csrf;
  assert.equal((await none.put('/api/account/profile', { name: 'X', lang: 'es', theme: 'system' })).status, 403);
  const loginNoOrigin = await new Client(s.base, { origin: null }).login();
  assert.equal(loginNoOrigin.status, 403);
});

test('a client-chosen session id is never accepted (no fixation)', async () => {
  const c = new Client(s.base);
  c.cookies.set('sensum_admin', 'A'.repeat(43));
  assert.equal((await c.get('/api/dashboard')).status, 401);
  await c.login();
  assert.notEqual(c.cookies.get('sensum_admin'), 'A'.repeat(43));
});

test('logout ends the session on the server', async () => {
  const c = new Client(s.base);
  await c.login();
  const cookie = c.cookies.get('sensum_admin');
  assert.equal((await c.post('/api/auth/logout', {})).status, 200);
  const replay = new Client(s.base);
  replay.cookies.set('sensum_admin', cookie);
  assert.equal((await replay.get('/api/dashboard')).status, 401);
});

test('idle and absolute session expiry are enforced', async () => {
  const c = new Client(s.base);
  await c.login();
  assert.equal((await c.get('/api/dashboard')).status, 200);
  s.sql('UPDATE sessions SET last_seen_at = last_seen_at - 7200');
  assert.equal((await c.get('/api/dashboard')).status, 401);
  const d = new Client(s.base);
  await d.login();
  s.sql('UPDATE sessions SET expires_at = 1');
  assert.equal((await d.get('/api/dashboard')).status, 401);
});

test('disabled accounts cannot sign in (same generic error)', async () => {
  s.sql(`INSERT INTO users (email,name,role,status,password_hash,created_at,updated_at) SELECT 'off@example.test','Off','editor','disabled',password_hash,1,1 FROM users WHERE email='${ADMIN.email}'`);
  const r = await new Client(s.base).login('off@example.test', ADMIN.password);
  assert.equal(r.status, 401);
  assert.equal(r.data.error, 'invalid_credentials');
});

test('brute force: 5 failures lock the account for 15 minutes, even with the right password', async () => {
  const email = 'lock@example.test';
  s.sql(`INSERT INTO users (email,name,role,status,password_hash,created_at,updated_at) SELECT '${email}','Lock','editor','active',password_hash,1,1 FROM users WHERE email='${ADMIN.email}'`);
  for (let i = 0; i < 5; i++) assert.equal((await new Client(s.base).login(email, 'mala-clave-' + i)).status, 401);
  const blocked = await new Client(s.base).login(email, ADMIN.password);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.error, 'too_many_attempts');
  // Unknown accounts are throttled identically (no enumeration via 429).
  for (let i = 0; i < 5; i++) await new Client(s.base).login('ghost@example.test', 'x' + i);
  assert.equal((await new Client(s.base).login('ghost@example.test', 'x')).status, 429);
});

test('production mode uses the __Host- prefixed Secure cookie', async () => {
  const p = await startServer({ port: 8193, env: { APP_ENV: 'production' } });
  try {
    p.cli(['create-admin', `--name=${ADMIN.name}`, `--email=${ADMIN.email}`], `${ADMIN.password}\n${ADMIN.password}\n`);
    const c = new Client(p.base);
    await c.login();
    assert.match(c.lastSetCookie, /^__Host-sensum_admin=/);
    assert.match(c.lastSetCookie, /;\s*secure/i);
  } finally { await p.stop(); }
});
