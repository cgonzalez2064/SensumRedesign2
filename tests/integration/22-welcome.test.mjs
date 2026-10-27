// First sign-in (choose language and appearance once) and the welcome e-mail sent when an invitation is accepted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, createAdmin, ADMIN, mailpitUp, waitForMail, message, linkToken, unique } from './helpers.mjs';

let s; let owner;
const NEW = { name: 'Nora Nueva', email: 'nora.nueva@example.test', password: 'Clave-Nora-Nueva-2026' };

before(async () => {
  assert.ok(await mailpitUp(), 'Mailpit must be running');
  s = await startServer({ port: 8341 });
  createAdmin(s);
  createAdmin(s, NEW);
  s.sql(`UPDATE users SET role='editor', permissions='texts' WHERE email='${NEW.email}'`);
  owner = new Client(s.base); await owner.login();
});
after(async () => { await s.stop(); });

async function accept(email) {
  const mail = await message((await waitForMail(email, 1))[0].ID);
  const c = new Client(s.base);
  const r = await c.post('/api/auth/invitation/accept', { token: linkToken(mail.Text, 'invitacion'), name: 'Laura Pérez', password: 'Clave-Laura-Perez-2026', passwordConfirm: 'Clave-Laura-Perez-2026' });
  assert.equal(r.status, 200, r.text);
  c.csrf = (await c.get('/api/auth/session')).data.csrf;
  return c;
}

test('the first sign-in asks once; the choice is stored in the account', async () => {
  const c = new Client(s.base); await c.login(NEW.email, NEW.password);
  let sess = (await c.get('/api/auth/session')).data;
  assert.equal(sess.user.welcome, true, 'never used the panel');
  assert.equal(sess.user.theme, 'system', 'Automático by default');
  const r = await c.put('/api/account/welcome', { lang: 'en', theme: 'dark' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.data.user.lang, r.data.user.theme], ['en', 'dark']);
  sess = (await c.get('/api/auth/session')).data;
  assert.equal(sess.user.welcome, false);
  const firstAt = s.sql(`SELECT onboarded_at FROM users WHERE email='${NEW.email}'`);
  assert.match(firstAt, /^\d+$/);
  // Again (or anything odd): stays done, the first date is kept, unknown values fall back.
  await c.put('/api/account/welcome', { lang: 'xx', theme: 'neon' });
  assert.equal(s.sql(`SELECT lang || '|' || theme || '|' || onboarded_at FROM users WHERE email='${NEW.email}'`), `es|system|${firstAt}`);
  assert.equal(s.sql("SELECT COUNT(*) FROM activity_log WHERE action = 'welcome_completed'"), '2');
  assert.equal((await new Client(s.base).put('/api/account/welcome', { lang: 'en' })).status, 401);
  // The owner created from the terminal also chooses once.
  assert.equal((await owner.get('/api/auth/session')).data.user.welcome, true, 'the owner never chose either');
  await owner.put('/api/account/welcome', { lang: 'es', theme: 'system' });
  assert.equal((await owner.get('/api/auth/session')).data.user.welcome, false);
});

test('viewing as someone who has not chosen yet never shows it, and cannot store it', async () => {
  createAdmin(s, { name: 'Vale Vista', email: 'vale.vista@example.test', password: 'Clave-Vale-Vista-2026' });
  const id = Number(s.sql("SELECT id FROM users WHERE email='vale.vista@example.test'"));
  assert.equal((await owner.post('/api/view-as', { userId: id, currentPassword: ADMIN.password })).status, 200);
  const sess = (await owner.get('/api/auth/session')).data;
  assert.equal(sess.user.email, 'vale.vista@example.test');
  assert.equal(sess.user.welcome, false);
  assert.equal((await owner.put('/api/account/welcome', { lang: 'en', theme: 'dark' })).data.error, 'view_only');
  assert.equal(s.sql("SELECT onboarded_at IS NULL FROM users WHERE email='vale.vista@example.test'"), '1');
  await owner.post('/api/view-as/stop', {});
});

test('accepting an invitation sends the welcome e-mail once: access in plain words, first steps, help', async () => {
  const email = unique('bienvenida');
  assert.equal((await owner.post('/api/users', { name: 'Laura Pérez', email, permissions: ['texts', 'contact', 'photos', 'documents'], lang: 'es' })).status, 200);
  const c = await accept(email);
  assert.equal((await c.get('/api/auth/session')).data.user.welcome, true, 'the welcome screen comes next');
  const mails = await waitForMail(email, 2);
  const welcome = mails.filter((m) => m.Subject === 'Tu cuenta del Administrador de contenido está lista');
  assert.equal(welcome.length, 1);
  const m = await message(welcome[0].ID);
  for (const text of ['¡Te damos la bienvenida, Laura!', `Entra con tu correo ${email}`, 'Tu acceso: Editor del sitio web', '- Textos del sitio:', '- Portafolio en PDF:',
    'Soporte → Nueva solicitud', 'it@gruposensum.com', 'Nunca te pediremos tu contraseña', 'Ana Administradora te dio acceso']) assert.ok(m.Text.includes(text), text);
  assert.ok(m.HTML.includes('cid:sensum-logo') && m.HTML.includes('Entrar al panel'));
  assert.ok(!m.Text.includes('Clave-Laura-Perez-2026') && !m.HTML.includes('Clave-Laura-Perez-2026'), 'never the password');
  assert.equal(s.sql(`SELECT details FROM activity_log WHERE action = 'welcome_email' ORDER BY id DESC LIMIT 1`), '{"sent":true}');
});

test('the welcome e-mail follows the account language and names a custom access by its parts', async () => {
  const email = unique('welcome-en');
  assert.equal((await owner.post('/api/users', { name: 'Sam Smith', email, permissions: ['photos', 'monitor'], lang: 'en' })).status, 200);
  await accept(email);
  const [w] = (await waitForMail(email, 2)).filter((m) => m.Subject === 'Your Content Manager account is ready');
  const m = await message(w.ID);
  for (const text of ['Welcome, Laura!', 'Your access: Access by section', '- Photos:', '- Site health:', 'Support → New request']) assert.ok(m.Text.includes(text), text);
});

test('upgrading: people who already signed in are not asked', async () => {
  createAdmin(s, { name: 'Antes Usaba', email: 'antes@example.test', password: 'Clave-Antes-Usaba-2026' });
  createAdmin(s, { name: 'Nunca Entró', email: 'nunca@example.test', password: 'Clave-Nunca-Entro-2026' });
  s.sql("UPDATE users SET last_login_at = 1700000000, onboarded_at = NULL WHERE email = 'antes@example.test'");
  s.sql("DELETE FROM schema_migrations WHERE version = '013_welcome'");
  s.sql('ALTER TABLE users DROP COLUMN onboarded_at');
  s.cli(['migrate']);
  assert.equal(s.sql("SELECT onboarded_at FROM users WHERE email = 'antes@example.test'"), '1700000000');
  assert.equal(s.sql("SELECT onboarded_at IS NULL FROM users WHERE email = 'nunca@example.test'"), '1');
});
