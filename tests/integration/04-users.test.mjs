// User management (owner only), invitations and access types (what each account may change).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, createAdmin, ADMIN, mailpitUp, waitForMail, message, linkToken, unique } from './helpers.mjs';

const ALL = ['texts', 'contact', 'photos', 'documents', 'site', 'leads'];
let s; let owner;
before(async () => {
  assert.ok(await mailpitUp(), 'Mailpit must be running');
  s = await startServer({ port: 8195 }); // the test administrator (ADMIN) is the owner
  createAdmin(s);
  s.cli(['publish']);
  owner = new Client(s.base);
  await owner.login();
});
after(async () => { await s.stop(); });

// Invitations are limited to 20 per hour; these tests invite many people, so they reset that counter.
const resetInviteLimit = () => s.sql("DELETE FROM rate_limits WHERE bucket = 'invite'");

async function inviteAndAccept(permissions) {
  resetInviteLimit();
  const email = unique('inv');
  const r = await owner.post('/api/users', { name: 'Persona Invitada', email, permissions, lang: 'es' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.emailSent, true);
  assert.equal(r.data.inviteLink, null, 'link not exposed when the e-mail was sent');
  const mail = await message((await waitForMail(email, 1))[0].ID);
  const token = linkToken(mail.Text, 'invitacion');
  const c = new Client(s.base);
  const acc = await c.post('/api/auth/invitation/accept', { token, name: 'Persona Activa', password: 'Clave-Invitada-2026', passwordConfirm: 'Clave-Invitada-2026' });
  assert.equal(acc.status, 200);
  const sess = await c.get('/api/auth/session');
  c.csrf = sess.data.csrf;
  return { email, token, client: c, id: r.data.user.id, session: sess.data };
}

const version = async (c, id) => (await c.get('/api/content')).data.sections.find((x) => x.id === id).version;

test('invitation: e-mailed link, account activates, link is single use', async () => {
  const email = unique('maria');
  const r = await owner.post('/api/users', { name: 'María', email, permissions: ['texts'], lang: 'en' });
  assert.equal(r.data.user.status, 'invited');
  assert.deepEqual(r.data.user.permissions, ['texts']);
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
  const r = await owner.post('/api/users', { name: 'Exp', email, permissions: ['texts'], lang: 'es' });
  const first = linkToken((await message((await waitForMail(email, 1))[0].ID)).Text, 'invitacion');
  assert.equal((await owner.post(`/api/users/${r.data.user.id}/resend`, {})).data.emailSent, true);
  const second = linkToken((await message((await waitForMail(email, 2))[0].ID)).Text, 'invitacion');
  assert.notEqual(first, second);
  assert.equal((await new Client(s.base).post('/api/auth/invitation/verify', { token: first })).data.valid, false, 'old link superseded');
  s.sql(`UPDATE user_tokens SET expires_at = 1 WHERE user_id = ${r.data.user.id}`);
  assert.equal((await new Client(s.base).post('/api/auth/invitation/verify', { token: second })).data.valid, false, 'expired');
});

test('invite validation: duplicates, bad e-mails, access types', async () => {
  const ok = { lang: 'es', permissions: ['texts'] };
  assert.equal((await owner.post('/api/users', { ...ok, name: 'Dup', email: ADMIN.email })).data.fields.email, 'email_taken');
  assert.equal((await owner.post('/api/users', { ...ok, name: 'Bad', email: 'no@@x' })).data.fields.email, 'invalid_email');
  for (const permissions of [[], ['superuser'], 'texts', { a: 'texts' }, [1], null]) {
    const r = await owner.post('/api/users', { name: 'P', email: unique('p'), lang: 'es', permissions });
    assert.equal(r.status, 422, JSON.stringify(permissions));
    assert.ok(['invalid', 'required'].includes(r.data.fields.permissions));
  }
  // Duplicates and order are normalized.
  const r = await owner.post('/api/users', { name: 'Orden', email: unique('o'), lang: 'es', permissions: ['site', 'texts', 'texts'] });
  assert.deepEqual(r.data.user.permissions, ['texts', 'site']);
  assert.equal((await owner.post('/api/users', { ...ok, name: '<b>x</b>', email: unique('h') })).data.fields.name, 'no_html');
  assert.equal((await owner.post('/api/users', { ...ok, name: 'X', email: 'a@example.test\r\nBcc: victim@example.test' })).status, 422);
  // The list offers the ready-made access types.
  const list = (await owner.get('/api/users')).data;
  assert.deepEqual(list.permissions, ALL);
  assert.deepEqual(list.accessTypes.texts, ['texts']);
});

test('only the owner can manage users — not other accounts, whatever their access', async () => {
  const { client: full } = await inviteAndAccept(ALL);
  for (const [m, p, body] of [['GET', '/api/users'], ['POST', '/api/users', { name: 'X', email: unique('x'), permissions: ['texts'], lang: 'es' }], ['PUT', '/api/users/1', { permissions: ['texts'] }], ['DELETE', '/api/users/1'], ['POST', '/api/users/1/resend', {}]]) {
    const r = await full.req(m, p, { json: body });
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.equal(r.data.error, 'forbidden');
  }
  // A legacy "admin" role does not grant user management either: only OWNER_EMAIL does.
  s.sql(`UPDATE users SET role = 'admin' WHERE email = '${(await full.get('/api/auth/session')).data.user.email}'`);
  assert.equal((await full.get('/api/users')).status, 403);
});

test('each access type can change only its own information', async () => {
  const cases = {
    texts: { texts: true, contact: false, photos: false, documents: false, site: false },
    contact: { texts: false, contact: true, photos: false, documents: false, site: false },
    media: { texts: false, contact: false, photos: true, documents: true, site: false },
  };
  const presets = (await owner.get('/api/users')).data.accessTypes;
  for (const [type, expect] of Object.entries(cases)) {
    const { client: c, session } = await inviteAndAccept(presets[type]);
    assert.deepEqual(session.user.permissions, presets[type]);
    assert.equal(session.user.owner, false);
    const tries = {
      texts: async () => (await c.put('/api/content/footer', { version: await version(c, 'footer'), values: { 'footer.about_desc': { es: 'Texto ' + type } } })).status,
      contact: async () => (await c.put('/api/content/details', { version: await version(c, 'details'), values: { 'contact.address_office': { '*': 'Oficina 64' + type.length } } })).status,
      photos: async () => (await c.upload('/api/media/proj1.card/upload', { anchor: 'center', altEs: 'Foto', altEn: 'Photo' }, { file: 'landscape-4000x3000.jpg' })).status,
      documents: async () => (await c.upload('/api/media/portfolio.pdf/upload', {}, { file: 'portfolio.pdf' })).status,
      site: async () => (await c.post('/api/site/republish', {})).status,
    };
    for (const [perm, allowed] of Object.entries(expect)) {
      const status = await tries[perm]();
      if (allowed) assert.equal(status, 200, `${type} should change ${perm}`);
      else assert.equal(status, 403, `${type} must not change ${perm}`);
    }
    // Activity is part of "site"; everyone can still read content and send reports.
    assert.equal((await c.get('/api/dashboard')).data.activity, undefined);
    assert.equal((await c.get('/api/content')).status, 200);
  }
});

test('photo items: permission is checked on the item, and translation needs "texts"', async () => {
  const { client: photos } = await inviteAndAccept(['photos']);
  const up = await photos.upload('/api/media/proj2.gallery/upload', { anchor: 'center', altEs: 'Foto', altEn: 'Photo' }, { file: 'landscape-4000x3000.jpg' });
  assert.equal(up.status, 200);
  const { client: texts } = await inviteAndAccept(['texts']);
  assert.equal((await texts.put(`/api/media/item/${up.data.item.id}`, { altEs: 'x', altEn: 'x' })).status, 403);
  assert.equal((await texts.del(`/api/media/item/${up.data.item.id}`)).status, 403);
  assert.equal((await texts.put('/api/media/proj2.gallery/order', { ids: [up.data.item.id] })).status, 403);
  assert.equal((await photos.del(`/api/media/item/${up.data.item.id}`)).status, 200);
  assert.equal((await photos.post('/api/content/translate', { from: 'es', to: 'en', items: [{ key: 'hero.cta1', text: 'Hola' }] })).status, 403);
});

test('the owner changes access types; changes apply on the next request', async () => {
  const { client, id } = await inviteAndAccept(['texts']);
  assert.equal((await client.post('/api/site/republish', {})).status, 403);
  const r = await owner.put(`/api/users/${id}`, { permissions: ['texts', 'site'] });
  assert.deepEqual(r.data.user.permissions, ['texts', 'site']);
  assert.equal((await client.post('/api/site/republish', {})).status, 200);
  assert.deepEqual((await client.get('/api/auth/session')).data.user.permissions, ['texts', 'site']);
  assert.equal((await owner.put(`/api/users/${id}`, { permissions: [] })).status, 422);
  assert.equal((await owner.put(`/api/users/${id}`, { role: 'admin' })).status, 200, 'unknown fields are ignored');
  assert.equal((await client.get('/api/users')).status, 403, 'role is not a way in');
});

test('the owner cannot be changed or locked out, not even by itself', async () => {
  const me = (await owner.get('/api/users')).data.users.find((u) => u.isSelf);
  assert.equal(me.isOwner, true);
  assert.equal((await owner.put(`/api/users/${me.id}`, { status: 'disabled' })).data.fields.user, 'cannot_change_self');
  assert.equal((await owner.put(`/api/users/${me.id}`, { permissions: ['texts'] })).data.fields.user, 'cannot_change_self');
  assert.equal((await owner.del(`/api/users/${me.id}`)).data.fields.user, 'cannot_change_self');
  const session = (await owner.get('/api/auth/session')).data.user;
  assert.deepEqual([session.owner, session.permissions], [true, ALL]);
});

test('disabling a user ends their sessions immediately; deleting removes access', async () => {
  const { client, id } = await inviteAndAccept(['texts']);
  assert.equal((await client.get('/api/dashboard')).status, 200);
  assert.equal((await owner.put(`/api/users/${id}`, { status: 'disabled' })).status, 200);
  assert.equal((await client.get('/api/dashboard')).status, 401);
  assert.equal((await owner.del(`/api/users/${id}`)).status, 200);
  assert.equal((await owner.put(`/api/users/${id}`, { status: 'active' })).status, 404);
  assert.equal((await owner.put('/api/users/999999', { status: 'active' })).status, 404);
  assert.equal((await owner.put('/api/users/abc', { status: 'active' })).status, 404);
});

test('without e-mail the invitation link is returned once so it can be shared', async () => {
  const down = await startServer({ port: 8196, smtpDown: true });
  try {
    createAdmin(down);
    const a = new Client(down.base);
    await a.login();
    const r = await a.post('/api/users', { name: 'Sin Correo', email: unique('nomail'), permissions: ['texts'], lang: 'es' });
    assert.equal(r.status, 200);
    assert.equal(r.data.emailSent, false);
    assert.match(r.data.inviteLink, /\/admin\/#\/invitacion\/[A-Za-z0-9_-]{43}$/);
  } finally { await down.stop(); }
});

test('invitations are limited to 20 per hour', async () => {
  resetInviteLimit();
  let last;
  for (let i = 0; i < 21; i++) last = await owner.post('/api/users', { name: 'Lote', email: unique('lote'), permissions: ['texts'], lang: 'es' });
  assert.equal(last.status, 429);
  assert.equal(last.data.error, 'too_many_attempts');
});
