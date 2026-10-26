// Managing other accounts: the owner and accounts with "Gestión de usuarios"
// edit name and e-mail, send a link to choose a password, give a password
// (typed or generated, replaced at first sign-in) and require or reset
// two-step sign-in — without anyone gaining more access than they have.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, createAdmin, ADMIN, unique, waitForMail, messagesTo, message, linkToken, totp } from './helpers.mjs';

let s; let owner; let presets;
before(async () => {
  s = await startServer({ port: 8411 });
  createAdmin(s);
  owner = new Client(s.base);
  await owner.login();
  presets = (await owner.get('/api/users')).data.accessTypes;
});
after(async () => { await s.stop(); });

const PW = 'Clave-Persona-2026';
const resetLimits = () => s.sql("DELETE FROM rate_limits WHERE bucket IN ('invite', 'user_admin', 'admin_reset_link', 'password_change', 'login_email', 'login_ip')");

/** Invites someone with these permissions (as the owner) and signs them in. */
async function person(permissions, name = 'Persona Prueba') {
  resetLimits();
  const email = unique('p');
  const r = await owner.post('/api/users', { name, email, permissions, lang: 'es' });
  assert.equal(r.status, 200, r.text);
  const token = linkToken((await message((await waitForMail(email, 1))[0].ID)).Text, 'invitacion');
  const c = new Client(s.base);
  assert.equal((await c.post('/api/auth/invitation/accept', { token, name, password: PW, passwordConfirm: PW })).status, 200);
  c.csrf = (await c.get('/api/auth/session')).data.csrf;
  return { c, id: r.data.user.id, email, name };
}
const ownerId = async () => (await owner.get('/api/users')).data.users.find((u) => u.isSelf).id;
const signIn = async (email, password) => { const c = new Client(s.base); const r = await c.login(email, password); return { c, r }; };
const field = (r) => r.data && r.data.fields && Object.values(r.data.fields)[0];

test('the owner and accounts with "Gestión de usuarios" manage users; others do not', async () => {
  const mgr = await person(presets.admin, 'Ana Administradora');
  assert.ok(presets.admin.includes('users'), 'site administrators manage users');
  const list = await mgr.c.get('/api/users');
  assert.equal(list.status, 200, list.text);
  assert.equal(list.data.viewerIsOwner, false);
  assert.deepEqual(list.data.assignable, presets.admin.filter((p) => p !== 'users'), 'gives only what it has, never "users"');
  const ownerRow = list.data.users.find((u) => u.isOwner);
  assert.equal(ownerRow.canManage, false);
  assert.equal(list.data.users.find((u) => u.isSelf).canManage, false);

  const editor = await person(['texts']);
  assert.equal((await editor.c.get('/api/users')).status, 403, 'without the permission');
  assert.equal((await mgr.c.get('/api/users')).data.users.find((u) => u.id === editor.id).canManage, true);
});

test('no one gains access through user management', async () => {
  const mgr = await person(presets.admin);
  const peer = await person(presets.admin);
  const support = await person(presets.support); // has "support", which the manager lacks
  const editor = await person(['texts']);
  const rows = (await mgr.c.get('/api/users')).data.users;
  assert.equal(rows.find((u) => u.id === peer.id).canManage, false, 'another user manager');
  assert.equal(rows.find((u) => u.id === support.id).canManage, false, 'more access than the manager');

  const oid = await ownerId();
  assert.equal(field(await mgr.c.put(`/api/users/${oid}`, { status: 'disabled' })), 'owner_protected');
  assert.equal(field(await mgr.c.put(`/api/users/${peer.id}`, { status: 'disabled' })), 'manager_protected');
  assert.equal(field(await mgr.c.put(`/api/users/${support.id}`, { permissions: ['texts'] })), 'manager_protected');
  assert.equal(field(await mgr.c.put(`/api/users/${mgr.id}`, { status: 'disabled' })), 'cannot_change_self');
  for (const [m, p, body] of [['PUT', 'profile', { name: 'X', email: unique('x'), currentPassword: PW }], ['POST', 'password', { password: 'Otra-Clave-Larga-2026', currentPassword: PW }],
    ['POST', 'password-link', {}], ['PUT', '2fa', { required: true }], ['POST', '2fa-reset', { currentPassword: PW }]]) {
    assert.equal(field(await mgr.c.req(m, `/api/users/${oid}/${p}`, { json: body })), 'owner_protected', `${m} ${p} on the owner`);
    assert.equal(field(await mgr.c.req(m, `/api/users/${peer.id}/${p}`, { json: body })), 'manager_protected', `${m} ${p} on a peer`);
  }
  // Only permissions the manager has, and never "users".
  assert.equal(field(await mgr.c.put(`/api/users/${editor.id}`, { permissions: ['texts', 'users'] })), 'not_assignable');
  assert.equal(field(await mgr.c.put(`/api/users/${editor.id}`, { permissions: ['support'] })), 'not_assignable');
  resetLimits();
  assert.equal(field(await mgr.c.post('/api/users', { name: 'N', email: unique('n'), lang: 'es', permissions: ['users'] })), 'not_assignable');
  assert.equal((await mgr.c.put(`/api/users/${editor.id}`, { permissions: ['texts', 'photos'] })).status, 200);
  assert.equal((await mgr.c.put(`/api/users/${editor.id}`, { status: 'disabled' })).status, 200);
  assert.equal((await editor.c.get('/api/dashboard')).status, 401, 'disabled: signed out');
  // The owner manages user managers and gives or removes "users".
  assert.equal((await owner.get('/api/users')).data.users.find((u) => u.id === peer.id).canManage, true);
  assert.equal((await owner.put(`/api/users/${peer.id}`, { permissions: ['texts'] })).status, 200);
  assert.equal((await peer.c.get('/api/users')).status, 403, 'takes effect on the next request');
});

test('name and e-mail: a new e-mail needs the password, ends sessions and tells both addresses', async () => {
  const mgr = await person(presets.admin, 'Ana Administradora');
  const target = await person(['texts'], 'Luis Pérez');
  resetLimits();
  const renamed = await mgr.c.put(`/api/users/${target.id}/profile`, { name: 'Luis Pérez Gómez', email: target.email });
  assert.equal(renamed.status, 200, renamed.text);
  assert.equal(renamed.data.user.name, 'Luis Pérez Gómez');
  assert.equal((await target.c.get('/api/dashboard')).status, 200, 'a new name alone keeps the session');

  const newEmail = unique('nuevo');
  assert.equal(field(await mgr.c.put(`/api/users/${target.id}/profile`, { name: 'Luis', email: newEmail })), 'current_password_wrong');
  assert.equal(field(await mgr.c.put(`/api/users/${target.id}/profile`, { name: 'Luis', email: ADMIN.email, currentPassword: PW })), 'owner_email_reserved');
  assert.equal(field(await mgr.c.put(`/api/users/${target.id}/profile`, { name: 'Luis', email: mgr.email, currentPassword: PW })), 'email_taken');
  assert.equal(field(await mgr.c.put(`/api/users/${target.id}/profile`, { name: 'Luis', email: 'no@@x', currentPassword: PW })), 'invalid_email');
  const ok = await mgr.c.put(`/api/users/${target.id}/profile`, { name: 'Luis Pérez Gómez', email: newEmail.toUpperCase(), currentPassword: PW });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.data.user.email, newEmail, 'stored lower-case');
  assert.equal((await target.c.get('/api/dashboard')).status, 401, 'sessions ended');
  assert.equal((await signIn(target.email, PW)).r.status, 401, 'the old address no longer signs in');
  assert.equal((await signIn(newEmail, PW)).r.status, 200, 'the new one does, with the same password');
  const toOld = await message((await waitForMail(target.email, 2))[0].ID);
  assert.match(toOld.Subject, /Cambió tu correo de acceso/);
  assert.ok(toOld.Text.includes(newEmail) && toOld.Text.includes('Ana Administradora'));
  assert.ok(!toOld.Text.includes('Abrir el panel'), 'no button for the old address');
  const toNew = await message((await waitForMail(newEmail, 1))[0].ID);
  assert.match(toNew.Subject, /Ahora entras al panel con este correo/);
  const log = s.sql(`SELECT details FROM activity_log WHERE action = 'user_profile_updated' AND target = '${target.id}' ORDER BY id DESC LIMIT 1`);
  assert.ok(!log.includes(newEmail) && !log.includes(target.email), 'addresses are pseudonymized in the log');
});

test('an invited person with a corrected e-mail gets the invitation there; the old link stops working', async () => {
  const mgr = await person(presets.admin);
  resetLimits();
  const wrong = unique('equivocado');
  const inv = await mgr.c.post('/api/users', { name: 'Marketing', email: wrong, permissions: ['texts'], lang: 'es' });
  assert.equal(inv.status, 200);
  const oldToken = linkToken((await message((await waitForMail(wrong, 1))[0].ID)).Text, 'invitacion');
  const right = unique('correcto');
  const r = await mgr.c.put(`/api/users/${inv.data.user.id}/profile`, { name: 'Marketing', email: right, currentPassword: PW });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.emailSent, true);
  assert.equal((await new Client(s.base).post('/api/auth/invitation/verify', { token: oldToken })).data.valid, false);
  const newToken = linkToken((await message((await waitForMail(right, 1))[0].ID)).Text, 'invitacion');
  assert.equal((await new Client(s.base).post('/api/auth/invitation/verify', { token: newToken })).data.valid, true);
});

test('generated passwords are easy to read and type, and pass the policy', async () => {
  const mgr = await person(presets.admin);
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    const r = await mgr.c.get('/api/users/password-suggestion');
    assert.equal(r.status, 200);
    assert.match(r.data.password, /^[A-Z][a-z]{2,7}-[A-Z][a-z]{2,7}-[A-Z][a-z]{2,7}-[1-9][0-9]{2}$/);
    seen.add(r.data.password);
  }
  assert.ok(seen.size >= 19, 'random each time');
});

test('a given password: needs the manager’s password, ends sessions, must be changed first, never e-mailed', async () => {
  const mgr = await person(presets.admin, 'Ana Administradora');
  const target = await person(['texts'], 'Carla Ruiz');
  resetLimits();
  const temp = (await mgr.c.get('/api/users/password-suggestion')).data.password;
  assert.equal(field(await mgr.c.post(`/api/users/${target.id}/password`, { password: temp })), 'current_password_wrong');
  assert.equal(field(await mgr.c.post(`/api/users/${target.id}/password`, { password: 'corta', currentPassword: PW })), 'password_too_short');
  assert.equal(field(await mgr.c.post(`/api/users/${target.id}/password`, { password: target.email, currentPassword: PW })), 'password_matches_email');
  const set = await mgr.c.post(`/api/users/${target.id}/password`, { password: temp, currentPassword: PW });
  assert.equal(set.status, 200, set.text);
  assert.equal(set.data.user.mustChangePassword, true);
  assert.equal((await target.c.get('/api/dashboard')).status, 401, 'sessions ended');
  assert.equal((await signIn(target.email, PW)).r.status, 401, 'old password no longer works');

  const { c, r } = await signIn(target.email, temp);
  assert.equal(r.status, 200);
  assert.equal(r.data.user.mustChangePassword, true);
  const blocked = await c.get('/api/dashboard');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error, 'password_change_required');
  assert.equal((await c.get('/api/content')).data.error, 'password_change_required');
  assert.equal((await c.get('/api/auth/session')).status, 200, 'the session itself still answers');
  assert.equal(field(await c.post('/api/account/password', { currentPassword: temp, password: temp, passwordConfirm: temp })), 'password_same_as_current');
  const own = 'Mi-Clave-Propia-2026';
  const changed = await c.post('/api/account/password', { currentPassword: temp, password: own, passwordConfirm: own });
  assert.equal(changed.status, 200, changed.text);
  c.csrf = changed.data.csrf;
  assert.equal((await c.get('/api/dashboard')).status, 200);
  assert.equal((await c.get('/api/auth/session')).data.user.mustChangePassword, false);

  const mails = await messagesTo(target.email);
  const notice = await message(mails.find((m) => /contraseña temporal/i.test(m.Subject)).ID);
  assert.ok(notice.Text.includes('Ana Administradora'));
  for (const m of mails) {
    const full = await message(m.ID);
    assert.ok(!full.Text.includes(temp) && !full.HTML.includes(temp), 'the password is never e-mailed');
  }
  assert.ok(!s.sql('SELECT group_concat(details) FROM activity_log').includes(temp), 'nor logged');
});

test('a given password can be permanent; an invited person becomes active; a disabled one is refused', async () => {
  const mgr = await person(presets.admin);
  const target = await person(['texts']);
  resetLimits();
  const pw = 'Clave-Permanente-2026';
  assert.equal((await mgr.c.post(`/api/users/${target.id}/password`, { password: pw, mustChange: false, currentPassword: PW })).status, 200);
  const { c } = await signIn(target.email, pw);
  assert.equal((await c.get('/api/dashboard')).status, 200, 'no change asked');

  const invEmail = unique('inv');
  const inv = await mgr.c.post('/api/users', { name: 'Sin Correo', email: invEmail, permissions: ['texts'], lang: 'es' });
  const token = linkToken((await message((await waitForMail(invEmail, 1))[0].ID)).Text, 'invitacion');
  const temp = 'Lago-Pino-Ruta-472';
  const act = await mgr.c.post(`/api/users/${inv.data.user.id}/password`, { password: temp, currentPassword: PW });
  assert.equal(act.status, 200, act.text);
  assert.equal(act.data.user.status, 'active');
  assert.equal((await new Client(s.base).post('/api/auth/invitation/verify', { token })).data.valid, false, 'the invitation link stops working');
  assert.equal((await signIn(invEmail, temp)).r.data.user.mustChangePassword, true);

  assert.equal((await mgr.c.put(`/api/users/${target.id}`, { status: 'disabled' })).status, 200);
  assert.equal(field(await mgr.c.post(`/api/users/${target.id}/password`, { password: 'Otra-Clave-Larga-2026', currentPassword: PW })), 'user_disabled');
});

test('a link to choose a new password: e-mailed, valid 24 hours, single use; not for invited or disabled accounts', async () => {
  const mgr = await person(presets.admin, 'Ana Administradora');
  const target = await person(['texts']);
  resetLimits();
  const before = (await messagesTo(target.email)).length;
  const r = await mgr.c.post(`/api/users/${target.id}/password-link`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.hours, 24);
  const mail = await message((await waitForMail(target.email, before + 1))[0].ID);
  assert.match(mail.Subject, /Crea una contraseña nueva/);
  assert.ok(mail.Text.includes('Ana Administradora') && mail.Text.includes('24 horas'));
  const token = linkToken(mail.Text, 'restablecer');
  const left = Number(s.sql(`SELECT expires_at - strftime('%s','now') FROM user_tokens WHERE user_id = ${target.id} AND purpose = 'reset' AND used_at IS NULL`));
  assert.ok(left > 23 * 3600 && left <= 24 * 3600, `expires in ${left}s`);
  assert.equal((await target.c.get('/api/dashboard')).status, 200, 'nothing changes until the link is used');
  const pw = 'Clave-Elegida-2026';
  assert.equal((await new Client(s.base).post('/api/auth/reset', { token, password: pw, passwordConfirm: pw })).status, 200);
  assert.equal((await signIn(target.email, pw)).r.status, 200);
  assert.equal((await new Client(s.base).post('/api/auth/reset', { token, password: pw, passwordConfirm: pw })).status, 410, 'single use');

  const invEmail = unique('inv');
  const inv = await mgr.c.post('/api/users', { name: 'Invitada', email: invEmail, permissions: ['texts'], lang: 'es' });
  assert.equal(field(await mgr.c.post(`/api/users/${inv.data.user.id}/password-link`, {})), 'use_invitation');
  assert.equal((await mgr.c.put(`/api/users/${target.id}`, { status: 'disabled' })).status, 200);
  assert.equal(field(await mgr.c.post(`/api/users/${target.id}/password-link`, {})), 'user_disabled');
});

test('two-step sign-in: require it for one person, stop requiring it, reset it with the manager’s password', async () => {
  const mgr = await person(presets.admin);
  const target = await person(['texts']);
  resetLimits();
  const req = await mgr.c.put(`/api/users/${target.id}/2fa`, { required: true });
  assert.equal(req.status, 200, req.text);
  assert.equal(req.data.user.twoFactorForced, true);
  assert.equal(req.data.user.twoFactorByPolicy, false);
  assert.equal((await target.c.get('/api/dashboard')).data.error, 'two_factor_setup_required', 'applies on the next request');
  assert.equal((await target.c.get('/api/auth/session')).data.user.twoFactorRequired, true);
  assert.equal(field(await mgr.c.put(`/api/users/${target.id}/2fa`, { required: 'yes' })), 'invalid');

  // The person sets it up; the manager can reset it (lost phone) with their own password.
  const setup = await target.c.post('/api/account/2fa/setup', { currentPassword: PW });
  assert.equal(setup.status, 200, setup.text);
  assert.equal((await target.c.post('/api/account/2fa/enable', { code: await totp(setup.data.secret) })).status, 200);
  assert.equal((await target.c.get('/api/dashboard')).status, 200);
  assert.equal(field(await mgr.c.post(`/api/users/${target.id}/2fa-reset`, {})), 'current_password_wrong');
  const reset = await mgr.c.post(`/api/users/${target.id}/2fa-reset`, { currentPassword: PW });
  assert.equal(reset.status, 200, reset.text);
  assert.equal(reset.data.user.twoFactorEnabled, false);
  assert.equal(reset.data.twoFactor, null, 'the site-wide overview is only for the owner');
  assert.equal((await target.c.get('/api/dashboard')).status, 401, 'sessions ended');

  assert.equal((await mgr.c.put(`/api/users/${target.id}/2fa`, { required: false })).status, 200);
  const { c } = await signIn(target.email, PW);
  assert.equal((await c.get('/api/dashboard')).status, 200, 'no longer required');
});

test('a temporary password and required two-step sign-in: the password comes first, then the set-up', async () => {
  const mgr = await person(presets.admin);
  const target = await person(['texts']);
  resetLimits();
  const temp = 'Faro-Nube-Trigo-358';
  assert.equal((await mgr.c.post(`/api/users/${target.id}/password`, { password: temp, currentPassword: PW })).status, 200);
  assert.equal((await mgr.c.put(`/api/users/${target.id}/2fa`, { required: true })).status, 200);
  const { c } = await signIn(target.email, temp);
  assert.equal((await c.get('/api/dashboard')).data.error, 'password_change_required');
  assert.equal((await c.post('/api/account/2fa/setup', { currentPassword: temp })).data.error, 'password_change_required');
  const own = 'Mi-Clave-Propia-2026';
  const changed = await c.post('/api/account/password', { currentPassword: temp, password: own, passwordConfirm: own });
  assert.equal(changed.status, 200, changed.text);
  c.csrf = changed.data.csrf;
  assert.equal((await c.get('/api/dashboard')).data.error, 'two_factor_setup_required');
  assert.equal((await c.post('/api/account/2fa/setup', { currentPassword: own })).status, 200);
});

test('the owner manages everyone but themselves; every change is in the activity log', async () => {
  const mgr = await person(presets.admin);
  resetLimits();
  assert.equal((await owner.put(`/api/users/${mgr.id}/profile`, { name: 'Gerente General', email: mgr.email })).status, 200);
  assert.equal((await owner.post(`/api/users/${mgr.id}/password-link`, {})).status, 200);
  assert.equal((await owner.put(`/api/users/${mgr.id}/2fa`, { required: true })).status, 200);
  const oid = await ownerId();
  assert.equal(field(await owner.put(`/api/users/${oid}/profile`, { name: 'Yo', email: ADMIN.email })), 'cannot_change_self');
  assert.equal(field(await owner.post(`/api/users/${oid}/password`, { password: 'Otra-Clave-Larga-2026', currentPassword: ADMIN.password })), 'cannot_change_self');
  const actions = s.sql("SELECT group_concat(DISTINCT action) FROM activity_log WHERE action IN ('user_profile_updated', 'user_password_set', 'user_password_link_sent', 'two_factor_requirement', 'two_factor_reset')").split(',').sort();
  assert.deepEqual(actions, ['two_factor_requirement', 'two_factor_reset', 'user_password_link_sent', 'user_password_set', 'user_profile_updated']);
});

test('upgrading: accounts that were exactly "Administrador del sitio" also manage users (once); others don’t', async () => {
  const mk = (email, perms) => {
    createAdmin(s, { name: 'Migración', email, password: 'Clave-Migracion-Prueba-2026' });
    s.sql(`UPDATE users SET role='editor', permissions='${perms}' WHERE email='${email}'`);
  };
  mk('m1@example.test', 'texts,contact,photos,documents,site,leads,stats,monitor,report');
  mk('m2@example.test', 'texts,contact,photos,documents,site,leads,stats,monitor');
  mk('m3@example.test', 'support,monitor,report,site');
  s.sql("DELETE FROM schema_migrations WHERE version='015_user_management'");
  s.sql('ALTER TABLE users DROP COLUMN must_change_password');
  s.sql('ALTER TABLE users DROP COLUMN two_factor_required');
  s.cli(['migrate']);
  const perms = (e) => s.sql(`SELECT permissions FROM users WHERE email='${e}'`);
  assert.equal(perms('m1@example.test'), 'texts,contact,photos,documents,site,leads,stats,monitor,report,users');
  assert.equal(perms('m2@example.test'), 'texts,contact,photos,documents,site,leads,stats,monitor', 'custom access stays as it was');
  assert.equal(perms('m3@example.test'), 'support,monitor,report,site');
  assert.equal(s.sql("SELECT must_change_password || two_factor_required FROM users WHERE email='m1@example.test'"), '00');
});
