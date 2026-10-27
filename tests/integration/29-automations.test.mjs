// Account controls and automations: temporary passwords that expire, temporary
// access, closing someone's sessions, «Pedir acceso», the Accesos summary, the
// activity history, the Seguridad account rules (inactivity, remembered
// browsers, leaked passwords), and the automations (invitation reminders and
// notices, temporary access, inactivity, lead assignment, follow-up, the Monday
// summary and the visitor's confirmation).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, Client, createAdmin, ADMIN, ROOT, unique, waitForMail, messagesTo, countTo, message, linkToken, totp, solveCaptcha } from './helpers.mjs';

let s; let owner; let presets;
before(async () => {
  s = await startServer({ port: 8329 });
  createAdmin(s);
  owner = new Client(s.base);
  await owner.login();
  presets = (await owner.get('/api/users')).data.accessTypes;
});
after(async () => { await s.stop(); });

const PW = 'Clave-Persona-2026';
const now = () => Math.floor(Date.now() / 1000);
const resetLimits = () => s.sql("DELETE FROM rate_limits WHERE bucket IN ('invite', 'user_admin', 'admin_reset_link', 'password_change', 'login_email', 'login_ip', 'access_request', 'contact_confirmation')");
const field = (r) => r.data && r.data.fields && Object.values(r.data.fields)[0];
const subjects = async (email) => (await messagesTo(email)).map((m) => m.Subject);
const automations = (at) => s.cli(['automations', ...(at ? [String(at)] : [])]);
const day = (n) => { const d = new Date(Date.now() + n * 86400000); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };

/** Invites someone (as `by`, the owner by default) and signs them in. */
async function person(permissions, { name = 'Persona Prueba', lang = 'es', by = owner, extra = {} } = {}) {
  resetLimits();
  const email = unique('au');
  const r = await by.post('/api/users', { name, email, permissions, lang, ...extra });
  assert.equal(r.status, 200, r.text);
  const token = linkToken((await message((await waitForMail(email, 1))[0].ID)).Text, 'invitacion');
  const c = new Client(s.base);
  assert.equal((await c.post('/api/auth/invitation/accept', { token, name, password: PW, passwordConfirm: PW })).status, 200);
  c.csrf = (await c.get('/api/auth/session')).data.csrf;
  return { c, id: r.data.user.id, email, name };
}

test('a password given by a manager stops working after 72 hours if it is not replaced; the message to send is ready', async () => {
  const p = await person(presets.content, { name: 'Elena Ruiz', lang: 'en' });
  const r = await owner.post(`/api/users/${p.id}/password`, { password: 'Lago-Pino-Ruta-472', mustChange: true, currentPassword: ADMIN.password });
  assert.equal(r.status, 200, r.text);
  // The message is in the person's language, with where, who and the password; never e-mailed.
  assert.match(r.data.message, /^Hi Elena,/);
  for (const part of [s.base + '/admin/', p.email, 'Lago-Pino-Ruta-472', '72 hours']) assert.ok(r.data.message.includes(part), part);
  assert.ok(r.data.user.tempPasswordExpiresAt - now() > 71 * 3600);
  for (const m of await messagesTo(p.email)) assert.ok(!(await message(m.ID)).Text.includes('Lago-Pino-Ruta-472'));
  // Still valid: the sign-in works (and must change it).
  resetLimits();
  assert.equal((await new Client(s.base).login(p.email, 'Lago-Pino-Ruta-472')).status, 200);
  // 72 hours later it no longer works, with a clear answer.
  s.sql(`UPDATE users SET temp_password_expires_at = ${now() - 1} WHERE id = ${p.id}`);
  const late = await new Client(s.base).login(p.email, 'Lago-Pino-Ruta-472');
  assert.equal(late.status, 401);
  assert.equal(late.data.error, 'temporary_password_expired');
  assert.equal((await owner.get('/api/users')).data.users.find((u) => u.id === p.id).tempPasswordExpired, true);
  // A permanent password (not to be replaced) has no expiry.
  resetLimits();
  const perm = await owner.post(`/api/users/${p.id}/password`, { password: 'Lago-Pino-Ruta-473', mustChange: false, currentPassword: ADMIN.password });
  assert.equal(perm.data.user.tempPasswordExpiresAt, null);
  assert.match(perm.data.message, /Password: Lago-Pino-Ruta-473/);
});

test('temporary access: a date when inviting or changing access; the account turns off at the end, even without the scheduled check', async () => {
  resetLimits();
  const past = await owner.post('/api/users', { name: 'Fecha Pasada', email: unique('au'), permissions: ['texts'], lang: 'es', accessUntil: day(-1) });
  assert.equal(field(past), 'date_past');
  assert.equal(field(await owner.post('/api/users', { name: 'Muy Lejos', email: unique('au'), permissions: ['texts'], lang: 'es', accessUntil: day(900) })), 'date_too_far');
  assert.equal(field(await owner.post('/api/users', { name: 'Mal', email: unique('au'), permissions: ['texts'], lang: 'es', accessUntil: '2026-02-30' })), 'invalid');

  const p = await person(['photos'], { name: 'Pedro Fotógrafo', extra: { accessUntil: day(10) } });
  let row = (await owner.get('/api/users')).data.users.find((u) => u.id === p.id);
  assert.ok(row.accessUntil > now() + 9 * 86400);
  assert.equal(new Date(row.accessUntil * 1000).getHours(), 23, 'until the end of that day');
  // Changing the access keeps the date unless it comes; '' removes it.
  assert.equal((await owner.put(`/api/users/${p.id}`, { permissions: ['photos', 'documents'] })).status, 200);
  assert.ok((await owner.get('/api/users')).data.users.find((u) => u.id === p.id).accessUntil);
  assert.equal((await owner.put(`/api/users/${p.id}`, { permissions: ['photos'], accessUntil: '' })).data.user.accessUntil, null);
  assert.ok((await owner.put(`/api/users/${p.id}`, { permissions: ['photos'], accessUntil: day(3) })).data.user.accessUntil);

  // The date passes while signed in: the next request turns the account off.
  assert.equal((await p.c.get('/api/dashboard')).status, 200);
  s.sql(`UPDATE users SET access_until = ${now() - 5} WHERE id = ${p.id}`);
  assert.equal((await p.c.get('/api/dashboard')).status, 401);
  row = (await owner.get('/api/users')).data.users.find((u) => u.id === p.id);
  assert.equal(row.status, 'disabled');
  assert.equal(s.sql(`SELECT COUNT(*) FROM activity_log WHERE action = 'access_expired' AND target = '${p.id}'`), '1');
  resetLimits();
  assert.equal((await new Client(s.base).login(p.email, PW)).data.error, 'invalid_credentials', 'same answer as any turned-off account');
  // Whoever invited them (the owner) is told.
  await waitForMail(ADMIN.email, 1);
  assert.ok((await subjects(ADMIN.email)).some((x) => x === 'Terminó el acceso temporal de Pedro Fotógrafo'));
  // Reactivating removes the date that passed.
  const back = await owner.put(`/api/users/${p.id}`, { status: 'active' });
  assert.equal(back.data.user.status, 'active');
  assert.equal(back.data.user.accessUntil, null);
});

test('closing someone\'s sessions: they sign in again, are told, and remembered browsers ask for the code again', async () => {
  const mgr = await person(presets.admin, { name: 'Andrea Gerente' });
  const p = await person(presets.content, { name: 'Marta Editora' });
  s.sql(`INSERT INTO trusted_devices (user_id, token_hash, label, created_at, last_used_at, expires_at) VALUES (${p.id}, 'h${p.id}', 'Chrome · macOS', 1, 1, ${now() + 86400})`);
  const r = await mgr.c.post(`/api/users/${p.id}/sessions/revoke`, {});
  assert.equal(r.status, 200, r.text);
  assert.ok(r.data.ended >= 1);
  assert.equal((await p.c.get('/api/dashboard')).status, 401);
  assert.equal(s.sql(`SELECT COUNT(*) FROM trusted_devices WHERE user_id = ${p.id}`), '0');
  await waitForMail(p.email, 3);
  assert.ok((await subjects(p.email)).includes('Se cerraron tus sesiones del panel'));
  // Not the owner, not another manager, not yourself.
  const ownerId = (await owner.get('/api/users')).data.users.find((u) => u.isSelf).id;
  assert.equal(field(await mgr.c.post(`/api/users/${ownerId}/sessions/revoke`, {})), 'owner_protected');
  assert.equal(field(await mgr.c.post(`/api/users/${mgr.id}/sessions/revoke`, {})), 'cannot_change_self');
});

test('«Pedir acceso»: the request reaches whoever manages users; one click grants it and the person is told', async () => {
  const mgr = await person(presets.admin, { name: 'Andrea Gerente' });
  const p = await person(presets.content, { name: 'Marketing Sensum', by: mgr.c });
  assert.equal(field(await p.c.post('/api/account/access-request', { permissions: ['texts'] })), 'already_have');
  const r = await p.c.post('/api/account/access-request', { permissions: ['leads'], message: 'Para la campaña.' });
  assert.equal(r.status, 200, r.text);
  // A second request replaces the first.
  assert.equal((await p.c.post('/api/account/access-request', { permissions: ['leads', 'stats'], message: 'Para la campaña de remodelaciones.' })).status, 200);
  assert.deepEqual((await p.c.get('/api/account/access-request')).data.request.permissions, ['leads', 'stats']);
  assert.equal(s.sql(`SELECT COUNT(*) FROM access_requests WHERE user_id = ${p.id} AND status = 'pending'`), '1');
  // Managers hear about it (the owner and Andrea).
  await waitForMail(mgr.email, 2);
  assert.ok((await subjects(mgr.email)).includes('Marketing Sensum pide acceso a Prospectos, Estadísticas de visitas'));
  const body = (await message((await messagesTo(mgr.email)).find((m) => /pide acceso/.test(m.Subject)).ID)).Text;
  assert.match(body, /Para la campaña de remodelaciones\./);
  assert.match(body, /usuarios\?revisar=solicitudes/);
  // In Usuarios, with whether this manager can grant it.
  const list = (await mgr.c.get('/api/users')).data;
  const req = list.requests.find((x) => x.userId === p.id);
  assert.equal(req.canGrant, true);
  const ok = await mgr.c.post(`/api/users/requests/${req.id}`, { grant: true });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(ok.data.user.permissions, [...presets.content, 'leads', 'stats']);
  await waitForMail(p.email, 2);
  assert.ok((await subjects(p.email)).includes('Ya tienes acceso a Prospectos, Estadísticas de visitas'));
  assert.equal((await mgr.c.post(`/api/users/requests/${req.id}`, { grant: true })).status, 404, 'answered once');
  // Support management is the owner's to give: it can't be asked for. A request from before
  // (or anything a manager can't give) is granted only by the owner; declining tells the person.
  resetLimits();
  assert.equal(field(await p.c.post('/api/account/access-request', { permissions: ['support'] })), 'not_requestable');
  s.sql(`INSERT INTO access_requests (user_id, permissions, message, created_at) VALUES (${p.id}, 'support', '', ${now()})`);
  const req2 = (await mgr.c.get('/api/users')).data.requests.find((x) => x.userId === p.id);
  assert.equal(req2.canGrant, false);
  assert.equal(field(await mgr.c.post(`/api/users/requests/${req2.id}`, { grant: true })), 'not_assignable');
  assert.equal((await owner.post(`/api/users/requests/${req2.id}`, { grant: false })).status, 200);
  await waitForMail(p.email, 3);
  assert.ok((await subjects(p.email)).includes('Tu solicitud de acceso no se aprobó'));
  // The owner can't ask (has everything).
  assert.equal((await owner.post('/api/account/access-request', { permissions: ['texts'] })).status, 403);
});

test('Inicio → Accesos: what needs attention, only for whoever manages users', async () => {
  const mgr = await person(presets.admin, { name: 'Andrea Gerente' });
  const a = (await mgr.c.get('/api/dashboard')).data.access;
  for (const k of ['requests', 'invitesPending', 'invitesExpiring', 'invitesExpired', 'mustChange', 'withoutTwoFactor', 'inactive', 'temporaryEnding']) assert.equal(typeof a[k], 'number', k);
  const editor = await person(presets.content);
  assert.equal((await editor.c.get('/api/dashboard')).data.access, undefined);
});

test('Actividad: kinds by access, a person\'s history, dates and paging', async () => {
  const mgr = await person(presets.admin, { name: 'Andrea Gerente' });
  const p = await person(presets.content, { name: 'Luis Historial', by: mgr.c });
  resetLimits();
  await mgr.c.post(`/api/users/${p.id}/password-link`, {});
  const all = await mgr.c.get('/api/activity');
  assert.equal(all.status, 200, all.text);
  assert.deepEqual(all.data.groups, ['content', 'media', 'users', 'leads'], 'a manager sees no sign-ins or settings');
  assert.ok(!all.data.items.some((i) => i.group === 'security'));
  const mine = (await mgr.c.get(`/api/activity?person=${p.id}`)).data.items;
  assert.ok(mine.some((i) => i.action === 'user_password_link_sent' && i.targetName === 'Luis Historial' && i.actor === 'Andrea Gerente'));
  assert.ok(mine.some((i) => i.action === 'invitation_accepted' && i.actor === 'Luis Historial'));
  assert.ok((await owner.get('/api/activity?group=security')).data.items.some((i) => i.action === 'login'), 'the owner sees sign-ins');
  assert.equal(field(await mgr.c.get('/api/activity?group=security')), 'invalid');
  assert.equal((await mgr.c.get(`/api/activity?from=${day(1)}`)).data.items.length, 0);
  assert.ok((await mgr.c.get(`/api/activity?from=${day(0)}&to=${day(0)}`)).data.items.length > 0);
  // Paging: 50 at a time, then "before".
  for (let i = 0; i < 55; i++) s.sql(`INSERT INTO activity_log (user_id, action, target, details, created_at) VALUES (${p.id}, 'content_updated', 'hero', '{}', ${now()})`);
  const page1 = (await mgr.c.get('/api/activity?group=content')).data;
  assert.equal(page1.items.length, 50);
  assert.equal(page1.more, true);
  const page2 = (await mgr.c.get(`/api/activity?group=content&before=${page1.items.at(-1).id}`)).data;
  assert.ok(page2.items.length >= 5 && page2.items[0].id < page1.items.at(-1).id);
  // Someone with neither "site" nor "users": not allowed.
  assert.equal((await p.c.get('/api/activity')).status, 403);
});

test('Seguridad → two-step sign-in for whoever administers; remembered browsers skip the code for 30 days', async () => {
  const mgr = await person(presets.admin, { name: 'Gerente Dos Pasos' });
  const editor = await person(presets.content, { name: 'Editor Sin Pasos' });
  const support = await person(['support', 'monitor', 'report', 'site'], { name: 'Soporte Publica' });
  const p0 = await owner.put('/api/security/policy', { twoFactor: 'admins', currentPassword: ADMIN.password });
  assert.equal(p0.status, 200, p0.text);
  // The owner, whoever manages users and whoever publishes must set it up; everyone else carries on.
  for (const [who, expected] of [[owner, 403], [mgr.c, 403], [support.c, 403], [editor.c, 200]]) {
    const r = await who.get('/api/dashboard');
    assert.equal(r.status, expected, r.text);
    if (expected === 403) assert.equal(r.data.error, 'two_factor_setup_required');
  }
  s.sql("UPDATE settings SET value = json_set(value, '$.twoFactor', 'none') WHERE key = 'security_policy'");

  // Editor sets up two-step sign-in.
  const setup = await editor.c.post('/api/account/2fa/setup', { currentPassword: PW });
  const secret = setup.data.secret.replace(/ /g, '');
  assert.equal((await editor.c.post('/api/account/2fa/enable', { code: await totp(secret) })).status, 200);
  const signIn = async (c, remember) => {
    resetLimits();
    const r = await c.login(editor.email, PW);
    if (!r.data.twoFactor) return { remembered: true, r };
    s.sql(`UPDATE users SET totp_last_step = 0 WHERE id = ${editor.id}`);
    const two = await c.post('/api/auth/login/2fa', { challenge: r.data.challenge, code: await totp(secret), remember });
    assert.equal(two.status, 200, two.text);
    return { remembered: false, r };
  };
  // Not allowed by Seguridad: no "remember" offered, and asking for it does nothing.
  const browser = new Client(s.base);
  let first = await signIn(browser, true);
  assert.equal(first.r.data.rememberAllowed, false);
  assert.equal((await signIn(browser, true)).remembered, false);
  // The owner allows it.
  const acc = await owner.put('/api/security/accounts', { rememberDevice: true, currentPassword: ADMIN.password });
  assert.equal(acc.status, 200, acc.text);
  first = await signIn(browser, true);
  assert.equal(first.r.data.rememberAllowed, true);
  assert.equal((await signIn(browser, false)).remembered, true, 'same browser: no code');
  assert.equal(s.sql(`SELECT details FROM activity_log WHERE user_id = ${editor.id} AND action = 'login' ORDER BY id DESC LIMIT 1`), '{"twoFactor":"remembered"}');
  assert.equal((await signIn(new Client(s.base), false)).remembered, false, 'another browser: code');
  // Mi cuenta → forget them.
  const st = await editor.c.get('/api/account/2fa');
  assert.equal(st.data.rememberAllowed, true);
  const loggedIn = new Client(s.base);
  await signIn(loggedIn, false);
  loggedIn.csrf = (await loggedIn.get('/api/auth/session')).data.csrf;
  assert.ok((await loggedIn.get('/api/account/2fa')).data.rememberedDevices >= 1);
  assert.ok((await loggedIn.post('/api/account/2fa/forget-devices', {})).data.forgotten >= 1);
  assert.equal((await signIn(browser, false)).remembered, false);
  // Turning the option off forgets every remembered browser.
  await signIn(browser, true);
  await owner.put('/api/security/accounts', { rememberDevice: false, currentPassword: ADMIN.password });
  assert.equal(s.sql('SELECT COUNT(*) FROM trusted_devices'), '0');
  assert.equal(field(await owner.put('/api/security/accounts', { inactiveDays: 45, currentPassword: ADMIN.password })), 'invalid');
  assert.equal(field(await owner.put('/api/security/accounts', { rememberDevice: true, currentPassword: 'mala' })), 'current_password_wrong');
});

test('leaked passwords are refused (anonymous range check); an unreachable service never blocks anyone', async () => {
  const leaked = 'Clave-Filtrada-Sensum-2026';
  const sha = createHash('sha1').update(leaked).digest('hex').toUpperCase();
  const asked = [];
  const stub = http.createServer((req, res) => {
    asked.push(req.url);
    res.end(`0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${sha.slice(5)}:42\r\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:0\r\n`);
  });
  await new Promise((r) => stub.listen(8398, '127.0.0.1', r));
  const s2 = await startServer({ port: 8330, env: { PWNED_PASSWORDS_URL: 'http://127.0.0.1:8398/range/' } });
  try {
    createAdmin(s2);
    const c = new Client(s2.base);
    await c.login();
    const r = await c.post('/api/account/password', { currentPassword: ADMIN.password, password: leaked, passwordConfirm: leaked });
    assert.equal(field(r), 'password_breached');
    assert.equal(asked.at(-1), '/range/' + sha.slice(0, 5), 'only the first five characters of the hash');
    assert.equal((await c.post('/api/account/password', { currentPassword: ADMIN.password, password: 'Otra-Clave-Segura-2026', passwordConfirm: 'Otra-Clave-Segura-2026' })).status, 200);
    // The owner can turn the check off.
    const c2 = new Client(s2.base);
    await c2.login(ADMIN.email, 'Otra-Clave-Segura-2026');
    assert.equal((await c2.put('/api/security/accounts', { breachedCheck: false, currentPassword: 'Otra-Clave-Segura-2026' })).status, 200);
    assert.equal((await c2.post('/api/account/password', { currentPassword: 'Otra-Clave-Segura-2026', password: leaked, passwordConfirm: leaked })).status, 200);
  } finally {
    await s2.stop();
    stub.close();
  }
  // Unreachable (this suite's server points at "off"; a closed port behaves the same): allowed.
  const s3 = await startServer({ port: 8331, env: { PWNED_PASSWORDS_URL: 'http://127.0.0.1:9/range/' } });
  try {
    createAdmin(s3);
    const c = new Client(s3.base);
    await c.login();
    assert.equal((await c.post('/api/account/password', { currentPassword: ADMIN.password, password: leaked, passwordConfirm: leaked })).status, 200);
  } finally { await s3.stop(); }
});

test('invitations: a reminder with a fresh link 24 h before expiry (once), the inviter told when it expires or is accepted', async () => {
  const mgr = await person(presets.admin, { name: 'Andrea Invita' });
  resetLimits();
  const email = unique('inv');
  const r = await mgr.c.post('/api/users', { name: 'Diego Invitado', email, permissions: ['texts'], lang: 'es' });
  const id = r.data.user.id;
  const oldToken = linkToken((await message((await waitForMail(email, 1))[0].ID)).Text, 'invitacion');
  // 52 hours later: 20 left.
  s.sql(`UPDATE user_tokens SET created_at = ${now() - 52 * 3600}, expires_at = ${now() + 20 * 3600} WHERE user_id = ${id} AND purpose = 'invite'`);
  automations();
  const reminder = (await waitForMail(email, 2)).find((m) => /Recordatorio/.test(m.Subject));
  assert.ok(reminder, 'reminder sent');
  const fresh = linkToken((await message(reminder.ID)).Text, 'invitacion');
  assert.notEqual(fresh, oldToken);
  assert.equal((await new Client(s.base).post('/api/auth/invitation/verify', { token: oldToken })).data.valid, false, 'the old link no longer works');
  assert.equal((await new Client(s.base).post('/api/auth/invitation/verify', { token: fresh })).data.valid, true);
  automations();
  assert.equal(await countTo(email), 2, 'only once');
  // It still expires: whoever invited hears it, once.
  s.sql(`UPDATE user_tokens SET expires_at = ${now() - 60} WHERE user_id = ${id} AND purpose = 'invite'`);
  automations();
  automations();
  await waitForMail(mgr.email, 1);
  assert.equal((await subjects(mgr.email)).filter((x) => x === 'La invitación de Diego Invitado venció sin aceptarse').length, 1);
  // Accepted: whoever invited hears that too.
  resetLimits();
  const email2 = unique('inv');
  await mgr.c.post('/api/users', { name: 'Carla Acepta', email: email2, permissions: ['texts'], lang: 'es' });
  const token = linkToken((await message((await waitForMail(email2, 1))[0].ID)).Text, 'invitacion');
  await new Client(s.base).post('/api/auth/invitation/accept', { token, name: 'Carla Acepta', password: PW, passwordConfirm: PW });
  await new Promise((done) => setTimeout(done, 600));
  assert.ok((await subjects(mgr.email)).includes('Carla Acepta activó su cuenta del panel'));
});

test('temporary access: 3 days before, the person and whoever invited them are told (once)', async () => {
  const mgr = await person(presets.admin, { name: 'Andrea Temporal' });
  const p = await person(['photos'], { name: 'Pedro Agencia', by: mgr.c, extra: { accessUntil: day(2) } });
  automations();
  automations();
  await waitForMail(p.email, 2);
  assert.equal((await subjects(p.email)).filter((x) => /^Tu acceso al panel termina el /.test(x)).length, 1);
  await waitForMail(mgr.email, 1);
  assert.equal((await subjects(mgr.email)).filter((x) => /^El acceso de Pedro Agencia termina el /.test(x)).length, 1);
  // Then it ends.
  s.sql(`UPDATE users SET access_until = ${now() - 1} WHERE id = ${p.id}`);
  automations();
  assert.equal(s.sql(`SELECT status FROM users WHERE id = ${p.id}`), 'disabled');
});

test('Seguridad → unused accounts: a warning 7 days before, then turned off; signing in cancels it; never the owner', async () => {
  assert.equal((await owner.put('/api/security/accounts', { inactiveDays: 90, currentPassword: ADMIN.password })).status, 200);
  const mgr = await person(presets.admin, { name: 'Andrea Inactivas' });
  const idle = await person(['texts'], { name: 'Sofía Inactiva', by: mgr.c });
  const back = await person(['texts'], { name: 'Raúl Regresa', by: mgr.c });
  s.sql(`UPDATE users SET last_login_at = ${now() - 85 * 86400} WHERE id IN (${idle.id}, ${back.id})`);
  s.sql(`UPDATE users SET last_login_at = ${now() - 400 * 86400} WHERE lower(email) = '${ADMIN.email}'`);
  automations();
  await waitForMail(idle.email, 2);
  assert.ok((await subjects(idle.email)).some((x) => /^Tu cuenta del panel se desactivará el /.test(x)));
  assert.notEqual(s.sql(`SELECT inactive_warned_at FROM users WHERE id = ${back.id}`), '');
  // Raúl signs in: the warning is cleared.
  resetLimits();
  await new Client(s.base).login(back.email, PW);
  assert.equal(s.sql(`SELECT inactive_warned_at IS NULL FROM users WHERE id = ${back.id}`), '1');
  // A week later, 92 days without signing in: Sofía is turned off; whoever invited her is told.
  s.sql(`UPDATE users SET inactive_warned_at = ${now() - 8 * 86400}, last_login_at = ${now() - 92 * 86400} WHERE id = ${idle.id}`);
  automations();
  assert.equal(s.sql(`SELECT status FROM users WHERE id = ${idle.id}`), 'disabled');
  assert.equal(s.sql(`SELECT status FROM users WHERE lower(email) = '${ADMIN.email}'`), 'active', 'never the owner');
  await waitForMail(mgr.email, 1);
  assert.ok((await subjects(mgr.email)).includes('Se desactivó la cuenta de Sofía Inactiva por falta de uso'));
  s.sql(`UPDATE users SET last_login_at = ${now()} WHERE lower(email) = '${ADMIN.email}'`);
  await owner.put('/api/security/accounts', { inactiveDays: 0, currentPassword: ADMIN.password });
});

/** Posts the public contact form like the site's own JavaScript does. */
async function submitContact(values) {
  const rl = join(ROOT, 'assets', '.rl-data', createHash('sha256').update('sensum-rl|127.0.0.1').digest('hex') + '.json');
  if (existsSync(rl)) rmSync(rl);
  const fd = new FormData();
  for (const [k, v] of Object.entries({ phone: '5555-1234', message: 'Quisiera una cotización.', loaded_at: String(Date.now() - 20000), captcha: await solveCaptcha(s.base), ...values })) fd.append(k, v);
  const res = await fetch(s.base + '/assets/contact-handler.php', { method: 'POST', body: fd, headers: { Accept: 'application/json', Origin: s.base } });
  assert.equal(res.status, 200, await res.text());
}

test('Prospectos: assignment by service (from either language), the assignee\'s notice, hand-overs and «Mis prospectos»', async () => {
  const luis = await person(presets.sales, { name: 'Luis Ventas' });
  const andrea = await person(presets.admin, { name: 'Andrea Diseño' });
  const save = await andrea.c.put('/api/leads/automation', { rules: [{ service: 'Remodelaciones', userId: luis.id }], fallbackUserId: andrea.id, followupHours: 48, weeklySummary: true });
  assert.equal(save.status, 200, save.text);
  assert.equal(field(await andrea.c.put('/api/leads/automation', { rules: [{ service: 'Obra civil', userId: 999999 }], fallbackUserId: null, followupHours: 48, weeklySummary: true })), 'invalid');
  await submitContact({ name: 'Lucía Remodela', email: unique('lead'), service: 'Remodelaciones' });
  await submitContact({ name: 'Mary Remodel', email: unique('lead'), service: 'remodel', lang: 'en' }); // the English page sends the option's id
  await submitContact({ name: 'Otto Obra', email: unique('lead'), service: 'Obra civil' });
  const leads = (await andrea.c.get('/api/leads?status=all')).data.leads;
  const by = (name) => leads.find((l) => l.name === name);
  assert.equal(by('Lucía Remodela').assignedTo, luis.id);
  assert.equal(by('Mary Remodel').assignedTo, luis.id, 'same service from the English page');
  assert.equal(by('Otto Obra').assignedTo, andrea.id, 'no rule: the default person');
  await waitForMail(luis.email, 3);
  assert.ok((await subjects(luis.email)).includes('Nuevo prospecto para ti: Lucía Remodela'));
  const hist = (await andrea.c.get(`/api/leads/${by('Otto Obra').id}`)).data.notes;
  assert.ok(hist.some((n) => n.details.action === 'assigned' && n.details.auto === true && n.details.to === 'Andrea Diseño'));
  // «Mis prospectos».
  assert.deepEqual((await luis.c.get('/api/leads?status=all&assigned=me')).data.leads.map((l) => l.name).sort(), ['Lucía Remodela', 'Mary Remodel']);
  // Andrea hands Otto over to Luis: Luis hears it; taking one yourself sends nothing.
  const before = await countTo(luis.email);
  const moved = await andrea.c.put(`/api/leads/${by('Otto Obra').id}`, { assignedTo: luis.id });
  assert.equal(moved.data.lead.assignedTo, luis.id);
  await waitForMail(luis.email, before + 1);
  assert.ok((await subjects(luis.email)).includes('Andrea Diseño te asignó un prospecto: Otto Obra'));
  assert.equal(field(await andrea.c.put(`/api/leads/${by('Otto Obra').id}`, { assignedTo: 424242 })), 'invalid');
  const editor = await person(presets.content);
  assert.equal((await editor.c.put('/api/leads/automation', { rules: [], fallbackUserId: null, followupHours: 0, weeklySummary: false })).status, 403);
});

test('Prospectos: one reminder for a lead still "new" after 48 h, and the Monday summary (only with something to say)', async () => {
  const luis = await person(presets.sales, { name: 'Luis Seguimiento' });
  const mgr = await person(presets.admin, { name: 'Andrea Lunes' });
  await mgr.c.put('/api/leads/automation', { rules: [], fallbackUserId: luis.id, followupHours: 48, weeklySummary: true });
  await submitContact({ name: 'Ana Espera', email: unique('lead'), service: 'Otro' });
  const lead = (await mgr.c.get('/api/leads?status=all')).data.leads.find((l) => l.name === 'Ana Espera');
  s.sql(`UPDATE leads SET created_at = ${now() - 50 * 3600} WHERE id = ${lead.id}`);
  automations();
  automations();
  await waitForMail(luis.email, 3);
  assert.equal((await subjects(luis.email)).filter((x) => x === 'Ana Espera sigue esperando respuesta').length, 1);
  // Monday, 12:00 (any time zone the server uses keeps it Monday after 08:00).
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  d.setUTCHours(18, 0, 0, 0);
  const monday = Math.floor(d.getTime() / 1000);
  s.sql("DELETE FROM settings WHERE key = 'lead_weekly_week'");
  const out = automations(monday);
  assert.match(out, /Weekly lead summary: sent to \d+/);
  assert.match(automations(monday), /Weekly lead summary: not due/, 'once a week');
  await waitForMail(luis.email, 4);
  const weekly = (await messagesTo(luis.email)).find((m) => /^Prospectos de la semana/.test(m.Subject));
  assert.ok(weekly);
  assert.match((await message(weekly.ID)).Text, /Ana Espera · Otro · hace \d+ días/);
});

test('the visitor\'s confirmation: off by default; with Sensum\'s text, its placeholders filled; once per address every 10 minutes', async () => {
  const mgr = await person(presets.admin, { name: 'Andrea Confirma' });
  const off = unique('visit');
  await submitContact({ name: 'Visitante Sin Aviso', email: off, service: 'Obra civil' });
  await new Promise((done) => setTimeout(done, 800));
  assert.equal(await countTo(off), 0, 'off until Sensum turns it on');
  const cfg = (await mgr.c.get('/api/leads')).data.confirmation;
  assert.equal(cfg.enabled, false);
  assert.match(cfg.es.body, /\{nombre\}/);
  assert.equal(field(await mgr.c.put('/api/leads/confirmation', { enabled: true, es: { subject: '', body: 'x' }, en: cfg.en })), 'required');
  const saved = await mgr.c.put('/api/leads/confirmation', { enabled: true, es: { subject: 'Recibimos su mensaje, {nombre}', body: 'Estimado(a) {nombre}:\n\nRecibimos su solicitud de {servicio}.\n\nWhatsApp: {whatsapp}' }, en: cfg.en });
  assert.equal(saved.status, 200, saved.text);
  const email = unique('visit');
  await submitContact({ name: 'Rosa Cliente', email, service: 'Obra civil' });
  const m = (await waitForMail(email, 1))[0];
  assert.equal(m.Subject, 'Recibimos su mensaje, Rosa');
  const full = await message(m.ID);
  assert.match(full.Text, /Recibimos su solicitud de Obra civil\./);
  assert.match(full.Text, /WhatsApp: \+502 \d{4} \d{4}/);
  assert.ok(full.ReplyTo && full.ReplyTo.length, 'answers go to Sensum');
  await submitContact({ name: 'Rosa Cliente', email, service: 'Obra civil' });
  await new Promise((done) => setTimeout(done, 800));
  assert.equal(await countTo(email), 1, 'not twice in 10 minutes');
  const lead = (await mgr.c.get('/api/leads?status=all')).data.leads.find((l) => l.email === email);
  assert.equal(s.sql(`SELECT MAX(confirmation_sent) FROM leads WHERE email = '${email}'`), '1');
  assert.ok(lead);
  await mgr.c.put('/api/leads/confirmation', { enabled: false, es: cfg.es, en: cfg.en });
});
