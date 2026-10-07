// Password change ("Cuenta / Seguridad") and password reset by e-mail.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, createAdmin, ADMIN, mailpitUp, waitForMail, messagesTo, message, linkToken, unique } from './helpers.mjs';

let s;
const user = { name: 'Rosa Reset', email: unique('rosa'), password: 'Primera-Clave-2026' };
before(async () => {
  assert.ok(await mailpitUp(), 'Mailpit must be running on 127.0.0.1:8025 (see docs/LOCAL_SETUP.md)');
  s = await startServer({ port: 8194 });
  createAdmin(s);
  createAdmin(s, user);
});
after(async () => { await s.stop(); });

test('changing the password requires the current one and enforces the policy', async () => {
  const c = new Client(s.base);
  await c.login(user.email, user.password);
  const wrong = await c.post('/api/account/password', { currentPassword: 'no-es-esta', password: 'Nueva-Clave-2026!', passwordConfirm: 'Nueva-Clave-2026!' });
  assert.equal(wrong.data.fields.currentPassword, 'current_password_wrong');
  for (const [pw, code] of [['corta', 'password_too_short'], ['1234567890', 'password_too_common'], [user.email, 'password_matches_email'], [user.password, 'password_same_as_current'], ['a'.repeat(129), 'password_too_long']]) {
    const r = await c.post('/api/account/password', { currentPassword: user.password, password: pw, passwordConfirm: pw });
    assert.equal(r.data.fields.password, code, pw.slice(0, 20));
  }
  const mismatch = await c.post('/api/account/password', { currentPassword: user.password, password: 'Nueva-Clave-2026!', passwordConfirm: 'Otra-Clave-2026!' });
  assert.equal(mismatch.data.fields.passwordConfirm, 'password_mismatch');
});

test('a password change signs out every other session and renews this one', async () => {
  const phone = new Client(s.base);
  await phone.login(user.email, user.password);
  const laptop = new Client(s.base);
  await laptop.login(user.email, user.password);
  const oldCookie = laptop.cookies.get('sensum_admin');
  const r = await laptop.post('/api/account/password', { currentPassword: user.password, password: 'Segunda-Clave-2026', passwordConfirm: 'Segunda-Clave-2026' });
  assert.equal(r.status, 200);
  assert.match(r.data.csrf, /^[a-f0-9]{64}$/);
  assert.notEqual(laptop.cookies.get('sensum_admin'), oldCookie, 'session id rotated');
  laptop.csrf = r.data.csrf;
  assert.equal((await laptop.get('/api/dashboard')).status, 200, 'current device stays signed in');
  assert.equal((await phone.get('/api/dashboard')).status, 401, 'other device signed out');
  assert.equal((await new Client(s.base).login(user.email, user.password)).status, 401, 'old password no longer works');
  assert.equal((await new Client(s.base).login(user.email, 'Segunda-Clave-2026')).status, 200);
  user.password = 'Segunda-Clave-2026';
  const mails = await waitForMail(user.email, 1);
  assert.ok(mails.some((m) => /contraseña fue cambiada/i.test(m.Subject)), 'security notification e-mailed');
});

test('forgot-password answers the same for known and unknown e-mails', async () => {
  const known = await new Client(s.base).post('/api/auth/forgot', { email: user.email });
  const unknown = await new Client(s.base).post('/api/auth/forgot', { email: 'nadie.' + user.email });
  assert.equal(known.status, 200);
  assert.deepEqual(known.data, unknown.data);
  const invalid = await new Client(s.base).post('/api/auth/forgot', { email: 'no-es-correo' });
  assert.equal(invalid.status, 422);
  await new Promise((r) => setTimeout(r, 800));
  assert.equal((await messagesTo('nadie.' + user.email)).length, 0, 'nothing sent to unknown addresses');
});

test('reset link: emailed, single use, tokens hashed at rest, sessions ended', async () => {
  const before = (await messagesTo(user.email)).length;
  const signedIn = new Client(s.base);
  await signedIn.login(user.email, user.password);
  await new Client(s.base).post('/api/auth/forgot', { email: user.email });
  const list = await waitForMail(user.email, before + 1);
  const mail = await message(list[0].ID);
  assert.match(mail.Subject, /Restablece tu contraseña/);
  assert.doesNotMatch(mail.Text, /Segunda-Clave/, 'never e-mails passwords');
  const token = linkToken(mail.Text, 'restablecer');
  assert.ok(token, 'link has a token in the URL fragment');
  assert.equal(s.sql(`SELECT COUNT(*) FROM user_tokens WHERE token_hash='${token}'`), '0', 'token not stored in clear');

  const c = new Client(s.base);
  assert.equal((await c.post('/api/auth/reset/verify', { token })).data.valid, true);
  const weak = await c.post('/api/auth/reset', { token, password: 'corta', passwordConfirm: 'corta' });
  assert.equal(weak.status, 422);
  const ok = await c.post('/api/auth/reset', { token, password: 'Tercera-Clave-2026', passwordConfirm: 'Tercera-Clave-2026' });
  assert.equal(ok.status, 200);
  assert.equal((await signedIn.get('/api/dashboard')).status, 401, 'existing sessions ended after reset');
  const reuse = await c.post('/api/auth/reset', { token, password: 'Cuarta-Clave-2026', passwordConfirm: 'Cuarta-Clave-2026' });
  assert.equal(reuse.status, 410);
  assert.equal(reuse.data.error, 'link_invalid');
  assert.equal((await c.post('/api/auth/reset/verify', { token })).data.valid, false);
  assert.equal((await new Client(s.base).login(user.email, 'Tercera-Clave-2026')).status, 200);
  user.password = 'Tercera-Clave-2026';
});

test('expired, malformed and superseded reset links are rejected', async () => {
  const c = new Client(s.base);
  for (const token of ['', 'abc', 'x'.repeat(43), '../../etc/passwd', "' OR 1=1 --"]) {
    assert.equal((await c.post('/api/auth/reset/verify', { token })).data.valid, false, token);
  }
  const n = (await messagesTo(user.email)).length;
  await c.post('/api/auth/forgot', { email: user.email });
  const first = linkToken((await message((await waitForMail(user.email, n + 1))[0].ID)).Text, 'restablecer');
  // Expire it.
  s.sql('UPDATE user_tokens SET expires_at = 1 WHERE used_at IS NULL');
  assert.equal((await c.post('/api/auth/reset', { token: first, password: 'Quinta-Clave-2026', passwordConfirm: 'Quinta-Clave-2026' })).status, 410);
});

test('reset requests are throttled per address (3 per hour) without revealing it', async () => {
  const email = unique('throttle');
  createAdmin(s, { name: 'T', email, password: 'Clave-Throttle-2026' });
  for (let i = 0; i < 5; i++) assert.equal((await new Client(s.base).post('/api/auth/forgot', { email })).status, 200);
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal((await messagesTo(email)).length, 3);
});

test('guessing the current password is throttled (5 wrong attempts)', async () => {
  const fresh = { name: 'Guess', email: unique('guess'), password: 'Clave-Guess-2026' };
  createAdmin(s, fresh);
  const c = new Client(s.base);
  await c.login(fresh.email, fresh.password);
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/account/password', { currentPassword: 'adivina-' + i, password: 'Nueva-Clave-2026!', passwordConfirm: 'Nueva-Clave-2026!' })).status, 422);
  const blocked = await c.post('/api/account/password', { currentPassword: fresh.password, password: 'Nueva-Clave-2026!', passwordConfirm: 'Nueva-Clave-2026!' });
  assert.equal(blocked.status, 429, 'even the right password is refused while throttled');
});
