// "Servicio de interés" options of the contact form: editable in the panel
// (Sitio web → Formulario de contacto), published to the site, used by the form.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { startServer, Client, createAdmin, ADMIN, ROOT, mailpitUp, waitForMail, message, solveCaptcha } from './helpers.mjs';

const RUN = Date.now().toString(36);
const CONTACT_ONLY = { name: 'Carla Contacto', email: 'carla.contacto@example.test', password: 'Clave-Carla-Contacto-2026' };
const TEXTS_ONLY = { name: 'Tomás Textos', email: 'tomas.textos@example.test', password: 'Clave-Tomas-Textos-2026' };
const DEFAULT_IDS = ['remodel', 'design', 'waterproof', 'civil', 'installations', 'maintenance', 'other'];

let s; let owner; let contactOnly; let textsOnly; let inbox;

const get = (c = owner) => c.get('/api/contact-form/services');
const put = (items, version, c = owner) => c.put('/api/contact-form/services', { items, version });
const siteContent = () => {
  const m = s.readPublic('index.html').match(/<script type="application\/json" id="siteContent">(.*?)<\/script>/s);
  return m ? JSON.parse(m[1]) : {};
};

async function post(service) {
  const rl = join(ROOT, 'assets', '.rl-data', createHash('sha256').update('sensum-rl|127.0.0.1').digest('hex') + '.json');
  if (existsSync(rl)) rmSync(rl);
  const fd = new FormData();
  for (const [k, v] of Object.entries({ name: 'Pablo Prueba', phone: '5555-0101', email: `pablo-${RUN}@example.test`, service, message: 'Quiero información sobre este servicio.', loaded_at: String(Date.now() - 20000), captcha: await solveCaptcha(s.base) })) fd.append(k, v);
  const res = await fetch(s.base + '/assets/contact-handler.php', { method: 'POST', body: fd, headers: { Accept: 'application/json', Origin: s.base } });
  return { status: res.status, data: await res.json().catch(() => null) };
}

before(async () => {
  assert.ok(await mailpitUp(), 'Mailpit must be running (mailpit &)');
  inbox = `servicios-${RUN}@example.test`;
  s = await startServer({ port: 8261, env: { CONTACT_TO: inbox } });
  createAdmin(s);
  createAdmin(s, CONTACT_ONLY);
  createAdmin(s, TEXTS_ONLY);
  s.sql(`UPDATE users SET role='editor', permissions='contact' WHERE email='${CONTACT_ONLY.email}'`);
  s.sql(`UPDATE users SET role='editor', permissions='texts' WHERE email='${TEXTS_ONLY.email}'`);
  s.cli(['publish']);
  owner = new Client(s.base); await owner.login();
  contactOnly = new Client(s.base); await contactOnly.login(CONTACT_ONLY.email, CONTACT_ONLY.password);
  textsOnly = new Client(s.base); await textsOnly.login(TEXTS_ONLY.email, TEXTS_ONLY.password);
});
after(async () => { await s.stop(); });

test('the approved options are the starting point; access follows the "contact" permission', async () => {
  const r = await get();
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.items.map((i) => i.id), DEFAULT_IDS);
  assert.equal(r.data.items[3].es, 'Obra civil');
  assert.equal(r.data.items[3].en, 'Civil works');
  assert.equal(r.data.isDefault, true);
  assert.equal(r.data.version, 0);
  assert.equal(r.data.maxItems, 20);
  assert.equal((await get(contactOnly)).status, 200, 'contact details access is enough');
  assert.equal((await get(textsOnly)).status, 403);
  assert.equal((await put(r.data.items, 0, textsOnly)).status, 403);
  assert.equal((await new Client(s.base).get('/api/contact-form/services')).status, 401);
  // The committed page already uses the option ids.
  assert.match(s.readPublic('index.html'), /<option value="civil" data-i18n="form\.opt_civil">Obra civil<\/option>/);
});

test('invalid lists are refused with a reason per option', async () => {
  const d = (await get()).data.items;
  const fields = async (items) => (await put(items, 0)).data.fields;
  assert.equal((await put([], 0)).status, 422);
  assert.equal((await fields([])).items, 'required');
  assert.equal((await fields(Array.from({ length: 21 }, (_, i) => ({ es: 'Opción ' + i, en: '' })))).items, 'too_many');
  const f = await fields([
    { id: 'remodel', es: '', en: 'x' },
    { es: 'A', en: '' },
    { es: 'x'.repeat(61), en: '' },
    { es: '<b>Negrita</b>', en: '' },
    { es: 'Obra civil', en: '' },
    { es: 'OBRA CIVIL', en: '' },
    { es: 'Pisos', en: 'Floors <script>' },
    { es: 'Ventanas\u0007', en: '' },
  ]);
  assert.equal(f['items.0.es'], 'required');
  assert.equal(f['items.1.es'], 'too_short');
  assert.equal(f['items.2.es'], 'too_long');
  assert.equal(f['items.3.es'], 'invalid');
  assert.equal(f['items.4.es'], undefined);
  assert.equal(f['items.5.es'], 'duplicate', 'names are compared ignoring case');
  assert.equal(f['items.6.en'], 'invalid');
  assert.equal(f['items.7.es'], 'invalid', 'control characters');
  assert.equal((await owner.put('/api/contact-form/services', { items: 'nope', version: 0 })).status, 400);
  assert.equal((await get()).data.isDefault, true, 'nothing was saved');
  assert.deepEqual((await get()).data.items, d);
});

let saved;
test('renaming, adding, removing and reordering publishes the site at once', async () => {
  const d = (await get()).data.items;
  const byId = Object.fromEntries(d.map((i) => [i.id, i]));
  const items = [
    byId.remodel,
    { id: 'civil', es: 'Obra gris', en: 'Shell construction' },
    { es: 'Construcción de casas', en: 'Home building' },
    { es: 'Diseño & "planos"', en: '' },
    byId.design, byId.waterproof, byId.maintenance, byId.other,
  ];
  const r = await put(items, 0, contactOnly);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.changed, true);
  assert.ok(r.data.publishedAt);
  assert.equal(r.data.isDefault, false);
  assert.ok(r.data.version > 0);
  saved = r.data;
  const ids = r.data.items.map((i) => i.id);
  assert.equal(ids[1], 'civil', 'renamed options keep their id');
  assert.match(ids[2], /^s-[0-9a-f]{8}$/);
  assert.match(ids[3], /^s-[0-9a-f]{8}$/);
  assert.ok(!ids.includes('installations'));

  const html = s.readPublic('index.html');
  const options = [...html.matchAll(/<option value="([^"]+)" data-i18n="form\.opt_([^"]+)">([^<]*)<\/option>/g)];
  assert.deepEqual(options.map((m) => m[1]), ids, 'same order as saved');
  assert.deepEqual(options.map((m) => m[2]), ids);
  assert.equal(options[1][3], 'Obra gris');
  assert.equal(options[3][3], 'Diseño &amp; &quot;planos&quot;', 'escaped in the page');
  assert.ok(!options.some((m) => m[3] === 'Instalaciones generales'), 'removed from the form (the services section keeps its own text)');
  const i18n = siteContent().i18n;
  assert.equal(i18n.es['form.opt_civil'], 'Obra gris');
  assert.equal(i18n.en['form.opt_civil'], 'Shell construction');
  assert.equal(i18n.en[`form.opt_${ids[2]}`], 'Home building');
  assert.equal(i18n.en[`form.opt_${ids[3]}`], 'Diseño & "planos"', 'no English → the Spanish text');
  assert.equal(i18n.es['form.opt_remodel'], undefined, 'unchanged options use the built-in texts');
  assert.ok(Number(s.sql("SELECT COUNT(*) FROM activity_log WHERE action = 'contact_services_updated'")) === 1);

  // Saving the same list again changes nothing.
  const again = await put(r.data.items, r.data.version);
  assert.equal(again.data.changed, false);
});

test('someone else saving meanwhile is detected', async () => {
  const stale = await put(saved.items, 0);
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error, 'conflict');
});

test('the public form accepts the current options and e-mails the Spanish name', async () => {
  const newId = saved.items[2].id;
  const ok = await post(newId);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const [m] = (await waitForMail(inbox, 1)).filter((x) => /Pablo Prueba/.test(x.Subject));
  assert.ok(m);
  const full = await message(m.ID);
  assert.match(full.Text, /Servicio de interés: Construcción de casas/);
  assert.ok(full.HTML.includes('Construcción de casas'));

  assert.equal((await post('civil')).status, 200, 'renamed option by id');
  assert.equal((await post('Obra gris')).status, 200, 'by its Spanish name (pages published before ids)');
  const removed = await post('installations');
  assert.equal(removed.status, 422);
  assert.ok(removed.data.fields.includes('service'));
  assert.equal((await post('Instalaciones generales')).status, 422);
  assert.equal((await post('<script>')).status, 422);
});

test('restoring the original options brings back the approved page exactly', async () => {
  const d = (await get()).data;
  const r = await put(d.defaults, d.version);
  assert.equal(r.status, 200);
  assert.equal(r.data.isDefault, true);
  assert.deepEqual(r.data.items.map((i) => i.id), DEFAULT_IDS);
  assert.equal(s.readPublic('index.html'), readFileSync(join(ROOT, 'index.html'), 'utf8'));
  assert.equal((await post('installations')).status, 200);
});
