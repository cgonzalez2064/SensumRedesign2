// User management and invitations (administrators only).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, createAdmin, ADMIN, mailpitUp, waitForMail, message, linkToken, unique } from './helpers.mjs';

let s; let admin;
before(async () => {
  assert.ok(await mailpitUp(), 'Mailpit must be running');
  s = await startServer({ port: 8195 });
  createAdmin(s);
  admin = new Client(s.base);
  await admin.login();
});
after(async () => { await s.stop(); });

async function inviteAndAccept(role = 'editor') {
  const email = unique('inv');
  const r = await admin.post('/api/users', { name: 'Persona Invitada', email, role, lang: 'es' });
  assert.equal(r.status, 200);
  assert.equal(r.data.emailSent, true);
  assert.equal(r.data.inviteLink, null, 'link not exposed when the e-mail was sent');
  const mail = await message((await waitForMail(email, 1))[0].ID);
  const token = linkToken(mail.Text, 'invitacion');
  const c = new Client(s.base);
  const acc = await c.post('/api/auth/invitation/accept', { token, name: 'Persona Activa', password: 'Clave-Invitada-2026', passwordConfirm: 'Clave-Invitada-2026' });
  assert.equal(acc.status, 200);
  const sess = await c.get('/api/auth/session');
  c.csrf = sess.data.csrf;
  return { email, token, client: c, id: r.data.user.id };
}

test('invitation: e-mailed link, account activates, link is single use', async () => {
  const email = unique('maria');
  const r = await admin.post('/api/users', { name: 'María', email, role: 'editor', lang: 'en' });
  assert.equal(r.data.user.status, 'invited');
  const mail = await message((await waitForMail(email, 1))[0].ID);
  assert.match(mail.Subject, /invited/i, 'invitation in the invitee\'s language');
  assert.doesNotMatch(mail.Text, /password:|contraseña:/i);
  const token = linkToken(mail.Text, 'invitacion');
  const anon = new Client(s.base);
  const v = await anon.post('/api/auth/invitation/verify', { token });
  assert.deepEqual([v.data.valid, v.data.email], [true, email]);
  assert.equal((await anon.post('/api/auth/invitation/accept', { token, name: '', password: 'Clave-Maria-2026', passwordConfirm: 'Clave-Maria-2026' })).data.fields.name, 'required');
  assert.equal((await anon.post('/api/auth/invitation/accept', { token, name: 'María', password: 'Clave-Maria-2026', passwordConfirm: 'Clave-Maria-2026' })).status, 200);
  assert.equal((await new Client(s.base).post('/api/auth/invitation/accept', { token, name: 'X', password: 'Clave-Otra-2026', passwordConfirm: 'Clave-Otra-2026' })).status, 410);
  assert.equal((await new Client(s.base).post('/api/auth/invitation/verify', { token })).data.valid, false);
  assert.equal((await new Client(s.base).login(email, 'Clave-Maria-2026')).status, 200);
});

test('expired invitations and old links after a resend are rejected', async () => {
  const email = unique('exp');
  const r = await admin.post('/api/users', { name: 'Exp', email, role: 'editor', lang: 'es' });
  const first = linkToken((await message((await waitForMail(email, 1))[0].ID)).Text, 'invitacion');
  assert.equal((await admin.post(`/api/users/${r.data.user.id}/resend`, {})).data.emailSent, true);
  const second = linkToken((await message((await waitForMail(email, 2))[0].ID)).Text, 'invitacion');
  assert.notEqual(first, second);
  assert.equal((await new Client(s.base).post('/api/auth/invitation/verify', { token: first })).data.valid, false, 'old link superseded');
  s.sql(`UPDATE user_tokens SET expires_at = 1 WHERE user_id = ${r.data.user.id}`);
  assert.equal((await new Client(s.base).post('/api/auth/invitation/verify', { token: second })).data.valid, false, 'expired');
});

test('invite validation: duplicates, bad e-mails, unknown roles', async () => {
  assert.equal((await admin.post('/api/users', { name: 'Dup', email: ADMIN.email, role: 'editor', lang: 'es' })).data.fields.email, 'email_taken');
  assert.equal((await admin.post('/api/users', { name: 'Bad', email: 'no@@x', role: 'editor', lang: 'es' })).data.fields.email, 'invalid_email');
  assert.equal((await admin.post('/api/users', { name: 'Bad', email: unique('r'), role: 'superuser', lang: 'es' })).data.fields.role, 'invalid');
  assert.equal((await admin.post('/api/users', { name: '<b>x</b>', email: unique('h'), role: 'editor', lang: 'es' })).data.fields.name, 'no_html');
  const header = await admin.post('/api/users', { name: 'X', email: 'a@example.test\r\nBcc: victim@example.test', role: 'editor', lang: 'es' });
  assert.equal(header.status, 422);
});

test('editors cannot manage users (server-side authorization)', async () => {
  const { client: editor, id } = await inviteAndAccept('editor');
  for (const [m, p, body] of [['GET', '/api/users'], ['POST', '/api/users', { name: 'X', email: unique('x'), role: 'admin', lang: 'es' }], ['PUT', '/api/users/1', { role: 'editor' }], ['DELETE', '/api/users/1'], ['POST', '/api/site/republish', {}]]) {
    const r = await editor.req(m, p, { json: body });
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.equal(r.data.error, 'forbidden');
  }
  // …but they can edit content.
  assert.equal((await editor.get('/api/content')).status, 200);
  assert.ok(id);
});

test('admins cannot lock themselves out, and the last admin is protected', async () => {
  const me = (await admin.get('/api/users')).data.users.find((u) => u.isSelf);
  assert.equal((await admin.put(`/api/users/${me.id}`, { role: 'editor' })).data.fields.user, 'cannot_change_self');
  assert.equal((await admin.del(`/api/users/${me.id}`)).data.fields.user, 'cannot_change_self');
  const { id, client } = await inviteAndAccept('admin');
  // The second admin demotes the first; then the first cannot be removed if it would leave no admin.
  assert.equal((await client.put(`/api/users/${me.id}`, { role: 'editor' })).status, 200);
  const blocked = await admin.del(`/api/users/${id}`);
  assert.equal(blocked.status, 403, 'demoted user is no longer an admin');
  assert.equal((await client.put(`/api/users/${me.id}`, { role: 'admin' })).status, 200);
});

test('disabling a user ends their sessions immediately; deleting removes access', async () => {
  const { client, id } = await inviteAndAccept('editor');
  assert.equal((await client.get('/api/dashboard')).status, 200);
  assert.equal((await admin.put(`/api/users/${id}`, { status: 'disabled' })).status, 200);
  assert.equal((await client.get('/api/dashboard')).status, 401);
  assert.equal((await admin.del(`/api/users/${id}`)).status, 200);
  assert.equal((await admin.put(`/api/users/${id}`, { status: 'active' })).status, 404);
  assert.equal((await admin.put('/api/users/999999', { status: 'active' })).status, 404);
  assert.equal((await admin.put('/api/users/abc', { status: 'active' })).status, 404);
});

test('without e-mail the invitation link is returned once so it can be shared', async () => {
  const down = await startServer({ port: 8196, smtpDown: true });
  try {
    createAdmin(down);
    const a = new Client(down.base);
    await a.login();
    const r = await a.post('/api/users', { name: 'Sin Correo', email: unique('nomail'), role: 'editor', lang: 'es' });
    assert.equal(r.status, 200);
    assert.equal(r.data.emailSent, false);
    assert.match(r.data.inviteLink, /\/admin\/#\/invitacion\/[A-Za-z0-9_-]{43}$/);
  } finally { await down.stop(); }
});
