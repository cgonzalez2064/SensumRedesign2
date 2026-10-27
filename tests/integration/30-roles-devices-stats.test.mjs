// Fewer roles (Administrador, Editor del sitio web, Ventas y prospectos,
// Consulta) with extra sections, and the upgrade that moves older accounts
// onto them (with its rollback); «Quitar dispositivos registrados» (a code
// by e-mail, then the new device); and Estadísticas: filters, the
// spreadsheet and the report sent by e-mail.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, createAdmin, ADMIN, unique, waitForMail, messagesTo, countTo, message, linkToken, totp, emailedCode } from './helpers.mjs';

let s; let owner; let presets;
before(async () => {
  s = await startServer({ port: 8421 });
  createAdmin(s);
  owner = new Client(s.base);
  await owner.login();
  presets = (await owner.get('/api/users')).data.accessTypes;
});
after(async () => { await s.stop(); });

const PW = 'Clave-Persona-2026';
const now = () => Math.floor(Date.now() / 1000);
const resetLimits = () => s.sql("DELETE FROM rate_limits WHERE bucket IN ('invite', 'user_admin', 'password_change', 'login_email', 'login_ip', 'login_2fa_ip', 'login_code_ip', 'stats_share', 'stats_export')");
const field = (r) => r.data && r.data.fields && Object.values(r.data.fields)[0];
const day = (n) => { const d = new Date(Date.now() + n * 86400000); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };

async function person(permissions, { name = 'Persona Prueba', lang = 'es' } = {}) {
  resetLimits();
  const email = unique('rd');
  const r = await owner.post('/api/users', { name, email, permissions, lang });
  assert.equal(r.status, 200, r.text);
  const token = linkToken((await message((await waitForMail(email, 1))[0].ID)).Text, 'invitacion');
  const c = new Client(s.base);
  assert.equal((await c.post('/api/auth/invitation/accept', { token, name, password: PW, passwordConfirm: PW })).status, 200);
  c.csrf = (await c.get('/api/auth/session')).data.csrf;
  return { c, id: r.data.user.id, email, name };
}

// ------------------------------------------------------------------ roles

test('the session names the role and the sections added to it', async () => {
  const p = await person([...presets.content, 'leads']);
  const me = (await p.c.get('/api/auth/session')).data.user;
  assert.equal(me.accessType, 'content');
  assert.deepEqual(me.accessExtras, ['leads']);
  // Ventas y prospectos plus Consulta: the larger role, and the rest as an extra section.
  const q = await person(['leads', 'stats', 'monitor', 'report']);
  const them = (await q.c.get('/api/auth/session')).data.user;
  assert.equal(them.accessType, 'management');
  assert.deepEqual(them.accessExtras, ['leads']);
  assert.equal((await owner.get('/api/auth/session')).data.user.accessType, 'owner');
});

test('«Pedir acceso»: user and support management are given by the owner, never asked for', async () => {
  const p = await person(presets.sales);
  assert.equal(field(await p.c.post('/api/account/access-request', { permissions: ['support'] })), 'not_requestable');
  assert.equal(field(await p.c.post('/api/account/access-request', { permissions: ['texts', 'users'] })), 'not_requestable');
  assert.equal((await p.c.post('/api/account/access-request', { permissions: ['texts', 'monitor'] })).status, 200);
  // Once they have all of it some other way (a role change), the request goes away by itself.
  assert.equal((await owner.put(`/api/users/${p.id}`, { permissions: [...presets.sales, 'texts', 'monitor'] })).status, 200);
  assert.equal((await owner.get('/api/users')).data.requests.filter((r) => r.userId === p.id).length, 0);
  assert.equal((await p.c.get('/api/account/access-request')).data.request, null);
});

test('upgrading moves older access onto a role without taking anything away, and can be rolled back', async () => {
  const legacy = {
    'redactor@example.test': ['texts', 'texts,contact,photos,documents'],
    'fotos@example.test': ['photos,documents', 'texts,contact,photos,documents'],
    'gerencia@example.test': ['stats,monitor', 'stats,monitor,report'],
    'soporte@example.test': ['support,monitor,report,site', 'site,stats,monitor,report,support'],
    'mezcla@example.test': ['texts,leads', 'texts,leads,stats'],
    'publica@example.test': ['site', 'site,stats,monitor,report'],
    'ventas@example.test': ['leads,stats', 'leads,stats'],
    'admin2@example.test': ['texts,contact,photos,documents,site,leads,monitor,stats,report,users', 'texts,contact,photos,documents,site,leads,monitor,stats,report,users'],
  };
  for (const [email, [perms]] of Object.entries(legacy)) {
    createAdmin(s, { name: 'Migración', email, password: 'Clave-Migracion-Prueba-2026' });
    s.sql(`UPDATE users SET role='editor', permissions='${perms}' WHERE email='${email}'`);
  }
  s.sql("DELETE FROM schema_migrations WHERE version='017_roles'");
  s.sql('DROP TABLE roles_migration_017');
  s.cli(['migrate']);
  const perms = (e) => s.sql(`SELECT permissions FROM users WHERE email='${e}'`);
  for (const [email, [, after]] of Object.entries(legacy)) assert.equal(perms(email), after, email);
  // Only the accounts that changed are kept, with what they had before.
  assert.equal(s.sql("SELECT before || ' > ' || role FROM roles_migration_017 WHERE email='soporte@example.test'"), 'support,monitor,report,site > management');
  assert.equal(s.sql("SELECT COUNT(*) FROM roles_migration_017 WHERE email IN ('ventas@example.test', 'admin2@example.test')"), '0');
  assert.equal(s.sql(`SELECT COUNT(*) FROM roles_migration_017 WHERE email='${ADMIN.email}'`), '0', 'the owner is not touched');
  // The console lists what changed; an account corrected by hand afterwards is kept by the rollback.
  const report = s.cli(['roles']);
  assert.match(report, /soporte@example\.test {2}\[management\] {2}support,monitor,report,site {2}→ {2}site,stats,monitor,report,support/);
  assert.match(report, /6 account\(s\)/);
  s.sql("UPDATE users SET permissions='leads,stats' WHERE email='mezcla@example.test'");
  assert.match(s.cli(['roles']), /mezcla@example\.test .*\(changed since: leads,stats\)/);
  const undo = s.cli(['roles:rollback']);
  assert.match(undo, /Kept \(changed since the upgrade\): mezcla@example\.test/);
  assert.match(undo, /Previous access restored for 5 account\(s\)/);
  for (const [email, [before]] of Object.entries(legacy)) assert.equal(perms(email), email === 'mezcla@example.test' ? 'leads,stats' : before, 'rolled back: ' + email);
  // The same rollback in SQL (written in the migration) gives the same result.
  s.sql('UPDATE users SET permissions = (SELECT m.before FROM roles_migration_017 m WHERE m.user_id = users.id) WHERE id IN (SELECT user_id FROM roles_migration_017)');
  assert.equal(perms('mezcla@example.test'), 'texts,leads');
});

// ------------------------------------------------------------------ «Quitar dispositivos registrados»

test('removing your own devices: every session ends; a code by e-mail, «Reenviar código», then the new device', async () => {
  const p = await person(presets.content);
  const setup = await p.c.post('/api/account/2fa/setup', { currentPassword: PW });
  assert.equal((await p.c.post('/api/account/2fa/enable', { code: await totp(setup.data.secret) })).status, 200);
  const other = new Client(s.base); // a second browser, already signed in
  const ch = await other.login(p.email, PW);
  assert.equal((await other.post('/api/auth/login/2fa', { challenge: ch.data.challenge, code: await totp(setup.data.secret, 1) })).status, 200);

  assert.equal(field(await p.c.post('/api/account/2fa/remove-devices', { currentPassword: 'mal' })), 'current_password_wrong');
  const before = await countTo(p.email);
  const r = await p.c.post('/api/account/2fa/remove-devices', { currentPassword: PW });
  assert.equal(r.status, 200, r.text);
  assert.equal((await p.c.get('/api/auth/session')).data.authenticated, false, 'this session ended');
  assert.equal((await other.get('/api/auth/session')).data.authenticated, false, 'and the others');
  assert.ok((await waitForMail(p.email, before + 1)).some((m) => /Se quitaron los dispositivos/.test(m.Subject)));

  // Sign-in: the password, then a code sent to the e-mail (not in the subject).
  resetLimits();
  const c = new Client(s.base);
  const sent = await countTo(p.email);
  const step = await c.login(p.email, PW);
  assert.equal(step.data.method, 'email');
  assert.equal(step.data.rememberAllowed, false);
  const code1 = await emailedCode(p.email, sent);
  assert.match(code1, /^\d{6}$/);
  const mail = (await messagesTo(p.email))[0];
  assert.ok(!mail.Subject.includes(code1.slice(0, 3)), 'the code is not in the subject');
  // «Reenviar código»: a new code; the first one stops working. Three sends at most.
  const sent2 = await countTo(p.email);
  assert.equal((await c.post('/api/auth/login/2fa/resend', { challenge: step.data.challenge })).status, 200);
  const code2 = await emailedCode(p.email, sent2);
  if (code1 !== code2) assert.equal((await c.post('/api/auth/login/2fa', { challenge: step.data.challenge, code: code1 })).status, 422, 'the old code');
  assert.equal((await c.post('/api/auth/login/2fa/resend', { challenge: step.data.challenge })).status, 200);
  const third = await c.post('/api/auth/login/2fa/resend', { challenge: step.data.challenge });
  assert.equal(third.status, 429);
  const code3 = await emailedCode(p.email, sent2 + 1);
  const done = await c.post('/api/auth/login/2fa', { challenge: step.data.challenge, code: code3 });
  assert.equal(done.status, 200, done.text);
  c.csrf = done.data.csrf;
  // The new device before anything else (even though the policy doesn't require it).
  const me = (await c.get('/api/auth/session')).data.user;
  assert.deepEqual([me.twoFactor, me.twoFactorRequired, me.twoFactorReenroll], [false, true, true]);
  assert.equal((await c.get('/api/content')).data.error, 'two_factor_setup_required');
  const again = await c.post('/api/account/2fa/setup', { currentPassword: PW });
  assert.equal((await c.post('/api/account/2fa/enable', { code: await totp(again.data.secret) })).status, 200);
  assert.equal((await c.get('/api/content')).status, 200);
  // From now on, the app again (no e-mail code).
  resetLimits();
  const next = await new Client(s.base).login(p.email, PW);
  assert.equal(next.data.method, 'app');
});

test('an e-mail code works once, for 10 minutes, five tries', async () => {
  const p = await person(presets.content);
  s.sql(`UPDATE users SET two_factor_reenroll_at = ${now()} WHERE id = ${p.id}`);
  resetLimits();
  const c = new Client(s.base);
  const sent = await countTo(p.email);
  const step = await c.login(p.email, PW);
  const code = await emailedCode(p.email, sent);
  s.sql(`UPDATE login_challenges SET expires_at = ${now() - 1} WHERE user_id = ${p.id}`);
  const late = await c.post('/api/auth/login/2fa', { challenge: step.data.challenge, code });
  assert.equal(late.data.error, 'two_factor_expired', 'after 10 minutes the password is asked again');
  assert.equal((await c.post('/api/auth/login/2fa/resend', { challenge: step.data.challenge })).data.error, 'two_factor_expired');
  resetLimits();
  const step2 = await c.login(p.email, PW);
  for (let i = 0; i < 5; i++) await c.post('/api/auth/login/2fa', { challenge: step2.data.challenge, code: '999999' });
  assert.equal((await c.post('/api/auth/login/2fa', { challenge: step2.data.challenge, code: '123456' })).data.error, 'two_factor_expired', 'five wrong codes end it');
});

// ------------------------------------------------------------------ Estadísticas

test('statistics: presets, a custom period (validated) and one service for the messages', async () => {
  const sales = await person(presets.sales);
  s.sql(`INSERT INTO analytics_daily (day, metric, dim, count) VALUES ('${day(-1)}', 'visitor', '', 12), ('${day(-1)}', 'view', 'home', 30), ('${day(-20)}', 'visitor', '', 7), ('${day(-20)}', 'view', 'home', 9)`);
  s.sql(`INSERT INTO leads (name, email, phone, service, message, created_at, updated_at) VALUES ('Ana', 'ana@example.test', '5555-1234', 'Obra civil', 'Hola', ${now() - 3600}, ${now()}), ('Luis', 'luis@example.test', '5555-9876', 'Remodelación', 'Hola', ${now() - 7200}, ${now()})`);
  const week = (await sales.c.get('/api/stats?period=7d')).data;
  assert.equal(week.period, '7d');
  assert.equal(week.visits.days.length, 7);
  assert.equal(week.visits.visitors, 12);
  assert.equal(week.prevTo, week.from, 'compared with the 7 days before');
  assert.equal((await sales.c.get('/api/stats?period=90d')).data.visits.visitors, 19);
  const custom = (await sales.c.get(`/api/stats?period=custom&from=${day(-25)}&to=${day(-15)}`)).data;
  assert.deepEqual([custom.period, custom.visits.visitors, custom.visits.days.length], ['custom', 7, 11]);
  assert.equal(field(await sales.c.get(`/api/stats?period=custom&from=${day(-1)}&to=${day(-3)}`)), 'date_before_start');
  assert.equal(field(await sales.c.get(`/api/stats?period=custom&from=${day(-400)}&to=${day(0)}`)), 'range_too_long');
  assert.equal(field(await sales.c.get('/api/stats?period=custom&from=ayer&to=hoy')), 'invalid');
  // One service: only the message figures change.
  assert.ok(week.services.includes('Obra civil'));
  const one = (await sales.c.get('/api/stats?period=7d&service=' + encodeURIComponent('Obra civil'))).data;
  assert.deepEqual([one.service, one.leads.received, one.visits.visitors], ['Obra civil', 1, 12]);
  assert.equal(week.leads.received, 2);
});

test('statistics: the spreadsheet has totals only, and "Consulta" gets no message figures', async () => {
  const sales = await person(presets.sales);
  const file = await sales.c.post('/api/stats/export', { period: '7d', lang: 'es' });
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-type'), /^text\/csv; charset=utf-8/);
  assert.match(file.headers.get('content-disposition'), /filename="estadisticas-sensum-\d{4}-\d{2}-\d{2}-a-\d{4}-\d{2}-\d{2}\.csv"/);
  for (const part of ['Estadísticas del sitio web', 'Resumen', 'Visitas por día', 'De dónde llegan', 'Del mensaje al proyecto', 'Obra civil']) assert.ok(file.text.includes(part), part);
  for (const personal of ['ana@example.test', '5555-1234', 'Luis']) assert.ok(!file.text.includes(personal), 'no personal data: ' + personal);
  const view = await person(presets.management);
  const theirs = await view.c.post('/api/stats/export', { period: '7d', lang: 'es' });
  assert.ok(!theirs.text.includes('Del mensaje al proyecto'));
  assert.equal((await (await person(['texts'])).c.post('/api/stats/export', { period: '7d' })).status, 403);
});

test('statistics by e-mail: up to five people, one message each, the spreadsheet attached, no personal data', async () => {
  const sales = await person(presets.sales, { name: 'Sofía Ventas' });
  assert.equal(field(await sales.c.post('/api/stats/share', { period: '7d', recipients: [] })), 'required');
  assert.equal(field(await sales.c.post('/api/stats/share', { period: '7d', recipients: ['a@example.test', 'nope'] })), 'invalid_email');
  assert.equal(field(await sales.c.post('/api/stats/share', { period: '7d', recipients: ['1', '2', '3', '4', '5', '6'].map((n) => `p${n}@example.test`) })), 'too_many_recipients');
  const to = [unique('st'), unique('st')];
  const counts = await Promise.all([...to, sales.email].map((a) => countTo(a)));
  const r = await sales.c.post('/api/stats/share', { period: '7d', recipients: to.join(', '), copyMe: true, sections: ['daily', 'leads'], message: 'Para la reunión del lunes.', lang: 'es' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.data.sent, r.data.failed], [3, 0]);
  for (const [i, a] of [...to, sales.email].entries()) {
    const list = await waitForMail(a, counts[i] + 1);
    const m = await message(list[0].ID);
    assert.match(m.Subject, /^Estadísticas del sitio · /);
    assert.equal(m.To.length, 1, 'each person gets their own message');
    for (const part of ['Sofía Ventas te comparte', 'Para la reunión del lunes.', 'Resumen', 'Visitas por día', 'Del mensaje al proyecto']) assert.ok(m.Text.includes(part), part);
    assert.ok(!m.Text.includes('De dónde llegan'), 'only the chosen parts');
    for (const personal of ['ana@example.test', '5555-1234']) assert.ok(!m.Text.includes(personal) && !m.HTML.includes(personal), personal);
    assert.ok(m.Attachments.some((x) => /^estadisticas-sensum-.*\.csv$/.test(x.FileName)), 'the spreadsheet');
  }
  // "Consulta": the same report without the message figures, even if asked for.
  const view = await person(presets.management);
  const other = unique('st');
  const r2 = await view.c.post('/api/stats/share', { period: '30d', recipients: [other], sections: ['leads'], lang: 'en' });
  assert.equal(r2.status, 200, r2.text);
  const m2 = await message((await waitForMail(other, 1))[0].ID);
  assert.match(m2.Subject, /^Website statistics · /);
  assert.ok(!m2.Text.includes('From message to project'));
  assert.equal(s.sql(`SELECT COUNT(*) FROM activity_log WHERE action='stats_shared' AND user_id=${sales.id}`), '1');
});
