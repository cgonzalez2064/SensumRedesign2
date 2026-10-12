// The Content Manager on its own address (ADMIN_URL, e.g. https://app.sensumconstrucciones.com/admin)
// while the public site stays on APP_URL: e-mail links, allowed origins and the "Ver sitio" link.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { startServer, Client, createAdmin, ADMIN, ROOT, mailpitUp, waitForMail, message, linkToken, unique, solveCaptcha } from './helpers.mjs';

const PORT = 8351;
const PANEL = `http://localhost:${PORT}/admin`; // another origin than the site (http://127.0.0.1:8351)
let s; let owner; let contactTo;

before(async () => {
  assert.ok(await mailpitUp(), 'Mailpit must be running');
  contactTo = unique('prospectos-panel');
  s = await startServer({ port: PORT, env: { ADMIN_URL: PANEL + '/' } });
  createAdmin(s);
  owner = new Client(s.base, { origin: `http://localhost:${PORT}` });
  assert.equal((await owner.login()).status, 200, 'signing in from the panel address');
  const saved = await owner.put('/api/settings/email', {
    smtp: { host: '127.0.0.1', port: 1025, encryption: 'none', username: '', password: '', fromAddress: 'notificaciones@sensumconstrucciones.com', fromName: 'Sensum Construcciones', replyTo: '' },
    supportEmail: unique('soporte'), alertEmail: unique('alertas'),
    contact: { to: [contactTo], fromAddress: 'formulario@sensumconstrucciones.com', fromName: 'Sitio web Sensum', method: 'smtp' },
    currentPassword: ADMIN.password,
  });
  assert.equal(saved.status, 200, saved.text);
});
after(async () => { await s.stop(); });

test('the panel and the public site are both allowed origins; anything else is refused', async () => {
  const session = (await owner.get('/api/auth/session')).data;
  assert.equal(session.app.siteUrl, s.base, '"Ver sitio" opens the public site, not the panel address');
  // The public site's own calls keep working from its origin.
  const beacon = await fetch(s.base + '/api/collect', { method: 'POST', body: JSON.stringify({ t: 'pv', p: '/', l: 'es' }), headers: { 'Content-Type': 'application/json', Origin: s.base, 'User-Agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/605.1.15' } });
  assert.equal(beacon.status, 204);
  await beacon.arrayBuffer();
  // A foreign page cannot sign in or send beacons.
  assert.equal((await new Client(s.base, { origin: 'https://evil.example' }).login()).data.error, 'forbidden_origin');
  const foreign = await fetch(s.base + '/api/collect', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' } });
  assert.equal(foreign.status, 403);
  await foreign.arrayBuffer();
});

test('invitation, welcome and lead e-mails link to the panel address', async () => {
  const email = unique('panel-invite');
  assert.equal((await owner.post('/api/users', { name: 'Pía Panel', email, permissions: ['texts'], lang: 'es' })).status, 200);
  const invite = await message((await waitForMail(email, 1))[0].ID);
  assert.ok(invite.Text.includes(`${PANEL}/#/invitacion/`), 'invitation link');
  assert.ok(!invite.Text.includes(`${s.base}/admin/`), 'never the site address');
  const c = new Client(s.base, { origin: `http://localhost:${PORT}` });
  const r = await c.post('/api/auth/invitation/accept', { token: linkToken(invite.Text, 'invitacion'), name: 'Pía Panel', password: 'Clave-Pia-Panel-2026', passwordConfirm: 'Clave-Pia-Panel-2026' });
  assert.equal(r.status, 200, r.text);
  const welcome = (await waitForMail(email, 2)).find((m) => m.Subject === 'Tu cuenta del Administrador de contenido está lista');
  const body = await message(welcome.ID);
  assert.ok(body.Text.includes(`${PANEL}/`) && body.HTML.includes(`href="${PANEL}/"`), 'welcome "Entrar al panel"');

  // A message from the public contact form: the e-mail opens the lead in the panel.
  const rl = join(ROOT, 'assets', '.rl-data', createHash('sha256').update('sensum-rl|127.0.0.1').digest('hex') + '.json');
  if (existsSync(rl)) rmSync(rl);
  const fd = new FormData();
  for (const [k, v] of Object.entries({ name: 'Lea Lead', phone: '5555-2323', email: 'lea.lead@example.test', service: 'Remodelaciones', message: 'Quisiera una cotización para mi casa.', loaded_at: String(Date.now() - 20000), captcha: await solveCaptcha(s.base) })) fd.append(k, v);
  const sent = await fetch(s.base + '/assets/contact-handler.php', { method: 'POST', body: fd, headers: { Accept: 'application/json', Origin: s.base } });
  assert.equal(sent.status, 200, await sent.text());
  const leadId = s.sql('SELECT id FROM leads ORDER BY id DESC LIMIT 1');
  const lead = await message((await waitForMail(contactTo, 1))[0].ID);
  assert.ok(lead.HTML.includes(`${PANEL}/#/prospectos/${leadId}`), 'link to the lead');
});

test('the server check names both addresses; an invalid ADMIN_URL falls back to the site', async () => {
  assert.match(s.cli(['check']), new RegExp(`https\\s+${s.base.replace(/[.]/g, '\\.')} · panel ${PANEL.replace(/[.]/g, '\\.')}`));
  const other = await startServer({ port: PORT + 1, env: { ADMIN_URL: 'not a url' } });
  try {
    createAdmin(other);
    const c = new Client(other.base); await c.login();
    const email = unique('panel-fallback');
    assert.equal((await c.post('/api/users', { name: 'Fede Fallback', email, permissions: ['texts'], lang: 'es' })).status, 200);
    const invite = await message((await waitForMail(email, 1))[0].ID);
    assert.ok(invite.Text.includes(`${other.base}/admin/#/invitacion/`));
  } finally { await other.stop(); }
});
