// The contact form's questions (Sitio web → Formulario de contacto): change texts, required or
// optional, order, new questions of every type; the rules that keep every message answerable;
// the published form; a visitor's answers in Prospectos, the e-mail and the CSV; and who receives
// the messages (owner only, with the password).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { startServer, Client, createAdmin, ADMIN, ROOT, mailpitUp, waitForMail, message, countTo, unique, solveCaptcha } from './helpers.mjs';

const CONTACT = { name: 'Carmen Contacto', email: 'carmen.contacto@example.test', password: 'Clave-Carmen-Contacto-2026' };
const TEXTS = { name: 'Tito Textos', email: 'tito.textos@example.test', password: 'Clave-Tito-Textos-2026' };
let s; let owner; let contactUser; let textsUser; let inbox;

before(async () => {
  assert.ok(await mailpitUp(), 'Mailpit must be running');
  inbox = unique('formulario');
  s = await startServer({ port: 8361 });
  createAdmin(s);
  createAdmin(s, CONTACT);
  createAdmin(s, TEXTS);
  s.sql(`UPDATE users SET role='editor', permissions='contact' WHERE email='${CONTACT.email}'`);
  s.sql(`UPDATE users SET role='editor', permissions='texts' WHERE email='${TEXTS.email}'`);
  owner = new Client(s.base); await owner.login();
  contactUser = new Client(s.base); await contactUser.login(CONTACT.email, CONTACT.password);
  textsUser = new Client(s.base); await textsUser.login(TEXTS.email, TEXTS.password);
  const saved = await owner.put('/api/settings/email', {
    smtp: { host: '127.0.0.1', port: 1025, encryption: 'none', username: '', password: '', fromAddress: 'notificaciones@sensumconstrucciones.com', fromName: 'Sensum Construcciones', replyTo: '' },
    supportEmail: unique('soporte'), alertEmail: unique('alertas'),
    contact: { to: [inbox], fromAddress: 'formulario@sensumconstrucciones.com', fromName: 'Sitio web Sensum', method: 'smtp' },
    currentPassword: ADMIN.password,
  });
  assert.equal(saved.status, 200, saved.text);
});
after(async () => { await s.stop(); });

const get = (c = owner) => c.get('/api/contact-form');
const put = (fields, version, c = owner) => c.put('/api/contact-form', { fields, version });
const strip = (fields) => JSON.parse(JSON.stringify(fields));
const byId = (fields, id) => fields.find((f) => f.id === id);

async function submit(values) {
  const rl = join(ROOT, 'assets', '.rl-data', createHash('sha256').update('sensum-rl|127.0.0.1').digest('hex') + '.json');
  if (existsSync(rl)) rmSync(rl);
  const fd = new FormData();
  for (const [k, v] of Object.entries({ loaded_at: String(Date.now() - 20000), captcha: await solveCaptcha(s.base), ...values })) {
    for (const one of Array.isArray(v) ? v : [v]) fd.append(Array.isArray(v) ? k + '[]' : k, one);
  }
  const res = await fetch(s.base + '/assets/contact-handler.php', { method: 'POST', body: fd, headers: { Accept: 'application/json', Origin: s.base } });
  return { status: res.status, data: await res.json().catch(() => null) };
}

test('the approved form: five questions, the service options, limits; recipients are the owner\'s', async () => {
  const r = await get();
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.fields.map((f) => [f.id, f.type, f.required, f.width]),
    [['name', 'text', true, 'half'], ['phone', 'tel', true, 'half'], ['email', 'email', true, 'full'], ['service', 'select', true, 'full'], ['message', 'textarea', true, 'full']]);
  assert.equal(byId(r.data.fields, 'service').options.length, 7);
  assert.equal(r.data.isDefault, true);
  assert.equal(r.data.limits.maxFields, 15);
  assert.deepEqual(r.data.recipients, { to: [inbox], canEdit: true, max: 3 });
  const c = await get(contactUser);
  assert.equal(c.status, 200);
  assert.equal(c.data.recipients.canEdit, false, 'only the owner changes who receives the messages');
  assert.equal((await get(textsUser)).status, 403);
  assert.equal((await put(r.data.fields, r.data.version, textsUser)).status, 403);
});

test('rules: the name always, at least one way to answer, plain texts, valid options', async () => {
  const { data } = await get();
  const base = strip(data.fields);
  const without = (id) => base.filter((f) => f.id !== id);
  const err = async (fields) => (await put(fields, data.version)).data;
  assert.equal((await err(without('name'))).fields.fields, 'name_required');
  assert.equal((await err(base.filter((f) => !['email', 'phone'].includes(f.id)))).fields.fields, 'contact_required');
  const bothOptional = base.map((f) => (['email', 'phone'].includes(f.id) ? { ...f, required: false } : f));
  assert.equal((await err(bothOptional)).fields['fields.2.required'], 'contact_required');
  const html = base.map((f) => (f.id === 'message' ? { ...f, label: { es: '<b>Hola</b>', en: '' } } : f));
  assert.equal((await err(html)).fields['fields.4.label.es'], 'no_html');
  const radio = { id: null, type: 'radio', label: { es: '¿Cuándo?', en: '' }, help: { es: '', en: '' }, required: true, width: 'full', options: [{ id: null, es: 'Ya', en: '' }] };
  assert.equal((await err([...base, radio])).fields['fields.5.options'], 'too_few');
  const dup = { ...radio, options: [{ id: null, es: 'Ya', en: '' }, { id: null, es: 'ya', en: '' }] };
  assert.equal((await err([...base, dup])).fields['fields.5.options.1'], 'duplicate');
  assert.equal((await err([...base, { ...radio, type: 'file' }])).fields['fields.5.type'], 'invalid');
  const many = Array.from({ length: 11 }, (_, i) => ({ id: null, type: 'text', label: { es: 'Pregunta ' + i, en: '' }, help: { es: '', en: '' }, required: false, width: 'full' }));
  assert.equal((await err([...base, ...many])).fields.fields, 'too_many');
  const number = { id: null, type: 'number', label: { es: 'Metros', en: '' }, help: { es: '', en: '' }, required: false, width: 'full', min: 50, max: 10 };
  assert.equal((await err([...base, number])).fields['fields.5.max'], 'invalid');
  // Removing the e-mail makes the phone required (the only way left to answer).
  const r = await put(without('email'), data.version);
  assert.equal(r.status, 200, r.text);
  assert.equal(byId(r.data.fields, 'phone').required, true);
  assert.equal((await put(base, r.data.version)).status, 200, 'back to the approved form');
  assert.equal((await put(base, data.version)).status, 409, 'a stale version is a conflict');
});

let saved;
test('new questions of every type, a new order and optional phone are published to the site', async () => {
  const { data } = await get();
  const f = strip(data.fields);
  const phone = { ...byId(f, 'phone'), required: false, help: { es: 'Con código de país si no es de Guatemala', en: 'With country code if not from Guatemala' } };
  const start = { id: null, type: 'radio', label: { es: '¿Cuándo te gustaría iniciar?', en: 'When would you like to start?' }, help: { es: 'Nos ayuda a planificar.', en: 'It helps us plan.' }, required: true, width: 'full',
    options: [{ id: null, es: 'Lo antes posible', en: 'As soon as possible' }, { id: null, es: 'En 1 a 3 meses', en: 'In 1 to 3 months' }, { id: null, es: 'Solo cotizo', en: '' }] };
  const place = { id: null, type: 'text', label: { es: 'Ubicación del proyecto', en: 'Project location' }, help: { es: 'Ciudad o zona', en: '' }, required: false, width: 'half', max: 100 };
  const size = { id: null, type: 'number', label: { es: 'Metros cuadrados', en: 'Square metres' }, help: { es: '', en: '' }, required: false, width: 'half', min: 1, max: 100000 };
  const visit = { id: null, type: 'date', label: { es: 'Fecha para visitarte', en: 'Visit date' }, help: { es: '', en: '' }, required: false, width: 'full', future: true };
  const heard = { id: null, type: 'checkbox', label: { es: '¿Cómo nos conociste?', en: 'How did you hear about us?' }, help: { es: '', en: '' }, required: false, width: 'full',
    options: [{ id: null, es: 'Google', en: '' }, { id: null, es: 'Redes sociales', en: 'Social media' }, { id: null, es: 'Recomendación', en: 'Referral' }] };
  const fields = [byId(f, 'name'), phone, byId(f, 'email'), start, byId(f, 'service'), place, size, byId(f, 'message'), visit, heard];
  const r = await put(fields, data.version);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.changed, true);
  saved = r.data.fields;
  assert.deepEqual(saved.map((x) => x.type), ['text', 'tel', 'email', 'radio', 'select', 'text', 'number', 'textarea', 'date', 'checkbox']);
  for (const q of saved.filter((x) => !x.core)) assert.match(q.id, /^q_[a-f0-9]{6}$/);
  for (const o of saved[3].options) assert.match(o.id, /^o_[a-f0-9]{4}$/);
  assert.equal(saved[1].required, false);
  // Saving the same again changes nothing; the ids stay.
  const again = await put(strip(saved), r.data.version);
  assert.equal(again.data.changed, false);
  assert.deepEqual(again.data.fields.map((x) => x.id), saved.map((x) => x.id));

  const page = s.readPublic('index.html');
  const startId = saved[3].id;
  assert.match(page, new RegExp(`<legend data-i18n="form\\.${startId}_label">¿Cuándo te gustaría iniciar\\?</legend>`));
  assert.match(page, new RegExp(`<input type="radio" name="${startId}" value="${saved[3].options[0].id}" required`));
  assert.match(page, new RegExp(`name="${saved[9].id}\\[\\]"`), 'checkboxes send a list');
  assert.match(page, /<label for="phone"><span data-i18n="form.phone_label">Teléfono<\/span> <span class="field-opt" data-i18n="form.optional">\(opcional\)<\/span><\/label>/);
  assert.match(page, /<input type="tel" id="phone" name="phone" autocomplete="tel" pattern=/, 'the phone is no longer required');
  assert.match(page, new RegExp(`<input type="date" id="${saved[8].id}" name="${saved[8].id}" data-future`));
  assert.match(page, new RegExp(`<input type="number" id="${saved[6].id}" name="${saved[6].id}" inputmode="decimal" step="any" min="1" max="100000"`));
  assert.match(page, /<div class="form-row">\s+<div class="field">\s+<label for="q_[a-f0-9]{6}"><span data-i18n="form\.q_[a-f0-9]{6}_label">Ubicación del proyecto/, 'two half-width questions share a row');
  const content = JSON.parse(page.match(/<script type="application\/json" id="siteContent">(.*?)<\/script>/s)[1]);
  assert.equal(content.i18n.en[`form.${startId}_label`], 'When would you like to start?');
  assert.equal(content.i18n.en[`form.${startId}_${saved[3].options[2].id}`], 'Solo cotizo', 'English left empty shows the Spanish');
  assert.ok(!page.includes('<b>') && !page.includes('<script>alert'), 'texts are plain');
  // The service options still live in their own list (and endpoint).
  const svc = await owner.get('/api/contact-form/services');
  assert.deepEqual(svc.data.items.map((o) => o.id), saved[4].options.map((o) => o.id));
});

test('a visitor\'s answers: required, options and formats checked; kept in Prospectos, the e-mail and the CSV', async () => {
  const [, , , start, , place, size, , visit, heard] = saved;
  const ok = { name: 'Rosa Ramírez', email: 'rosa.ramirez@example.test', service: 'remodel', message: 'Quiero remodelar la cocina y el baño.' };
  let r = await submit(ok);
  assert.equal(r.status, 422);
  assert.deepEqual(r.data.fields, [start.id], 'the required question is missing');
  r = await submit({ ...ok, [start.id]: 'o_ffff' });
  assert.deepEqual(r.data.fields, [start.id], 'an option that is not offered');
  r = await submit({ ...ok, [start.id]: start.options[0].id, [size.id]: '0' });
  assert.deepEqual(r.data.fields, [size.id], 'below the minimum');
  r = await submit({ ...ok, [start.id]: start.options[0].id, [visit.id]: '2001-01-01' });
  assert.deepEqual(r.data.fields, [visit.id], 'dates from today on');
  assert.equal((await submit({ ...ok, [start.id]: start.options[0].id, unknown: 'x' })).data.error, 'unexpected_field');
  assert.equal((await submit({ ...ok, [start.id]: [start.options[0].id, start.options[1].id] })).data.error, 'invalid_field_type', 'only checkboxes send lists');
  const before = await countTo(inbox);
  r = await submit({ ...ok, [start.id]: start.options[1].id, [place.id]: 'Zona 10, Guatemala', [size.id]: '85.5', [heard.id]: [heard.options[0].id, heard.options[2].id] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // Prospectos: the core fields in their columns (no phone: it is optional now), the rest as answers.
  const row = s.sql("SELECT name || '|' || phone || '|' || service || '|' || answers FROM leads ORDER BY id DESC LIMIT 1").split('|');
  assert.deepEqual(row.slice(0, 3), ['Rosa Ramírez', '', 'Remodelaciones']);
  assert.deepEqual(JSON.parse(row[3]).map((a) => [a.label, a.value]), [
    ['¿Cuándo te gustaría iniciar?', 'En 1 a 3 meses'], ['Ubicación del proyecto', 'Zona 10, Guatemala'], ['Metros cuadrados', '85.5'], ['¿Cómo nos conociste?', 'Google, Recomendación']]);
  const id = Number(s.sql('SELECT id FROM leads ORDER BY id DESC LIMIT 1'));
  const lead = await owner.get('/api/leads/' + id);
  assert.equal(lead.data.lead.answers[0].value, 'En 1 a 3 meses');
  // The e-mail lists them.
  const [m] = (await waitForMail(inbox, before + 1)).slice(0, 1);
  const mail = await message(m.ID);
  for (const t of ['Servicio de interés: <strong', 'Otras respuestas', '¿Cuándo te gustaría iniciar?', 'En 1 a 3 meses', 'Zona 10, Guatemala', 'Google, Recomendación']) assert.ok(mail.HTML.includes(t), t);
  assert.ok(mail.Text.includes('¿Cómo nos conociste?: Google, Recomendación'));
  // The CSV too.
  const csv = await fetch(s.base + '/api/leads/export', { method: 'POST', body: JSON.stringify({ status: 'all' }),
    headers: { 'Content-Type': 'application/json', Origin: s.base, Cookie: owner.cookieHeader(), 'X-CSRF-Token': owner.csrf } });
  assert.match(await csv.text(), /¿Cuándo te gustaría iniciar\?: En 1 a 3 meses \| Ubicación del proyecto: Zona 10, Guatemala/);
});

test('a form without e-mail or service still works: the e-mail offers to call', async () => {
  const { data } = await get();
  const fields = strip(data.fields).filter((f) => !['email', 'service'].includes(f.id)).map((f) => (f.id === 'phone' ? { ...f, required: false } : f));
  const r = await put(fields, data.version);
  assert.equal(r.status, 200, r.text);
  assert.equal(byId(r.data.fields, 'phone').required, true, 'the only way to answer is required');
  const start = byId(r.data.fields, saved[3].id);
  const before = await countTo(inbox);
  const res = await submit({ name: 'Pedro Pérez', phone: '5555-0101', [start.id]: start.options[0].id, message: 'Necesito una cotización.' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(s.sql("SELECT email || '|' || service FROM leads ORDER BY id DESC LIMIT 1"), '|');
  const mail = await message((await waitForMail(inbox, before + 1))[0].ID);
  assert.ok(mail.HTML.includes('Llamar a Pedro') && mail.HTML.includes('href="tel:55550101"'), 'no e-mail: the button calls');
  assert.ok(!mail.HTML.includes('Servicio de interés:'), 'no service line when the form has no service question');
  assert.equal((await submit({ name: 'Pedro Pérez', phone: '5555-0101', email: 'x@example.test', [start.id]: start.options[0].id })).data.error, 'unexpected_field', 'a removed question is not accepted');
});

test('the older service-options endpoint stays in step with the questions', async () => {
  const { data } = await get();
  // put the service back first
  const fields = strip(data.fields);
  fields.splice(2, 0, ...strip(saved).filter((f) => f.id === 'email' || f.id === 'service'));
  let r = await put(fields, data.version);
  assert.equal(r.status, 200, r.text);
  const svc = await owner.get('/api/contact-form/services');
  const items = svc.data.items.map((o) => (o.id === 'remodel' ? { ...o, es: 'Remodelaciones y acabados' } : o));
  assert.equal((await owner.put('/api/contact-form/services', { items, version: svc.data.version })).status, 200);
  r = await get();
  assert.equal(byId(r.data.fields, 'service').options[0].es, 'Remodelaciones y acabados');
  assert.notEqual(r.data.version, data.version, 'the form version follows the options');
});

test('who receives the messages: owner only, with the password, and a security notice', async () => {
  assert.equal((await contactUser.put('/api/contact-form/recipients', { to: ['otro@example.test'], currentPassword: CONTACT.password })).status, 403);
  let r = await owner.put('/api/contact-form/recipients', { to: ['ventas@example.test'] });
  assert.equal(r.data.fields.currentPassword, 'current_password_wrong');
  r = await owner.put('/api/contact-form/recipients', { to: ['no-es-correo'], currentPassword: ADMIN.password });
  assert.equal(r.data.fields['to.0'], 'invalid_email');
  r = await owner.put('/api/contact-form/recipients', { to: ['a@example.test', 'b@example.test', 'c@example.test', 'd@example.test'], currentPassword: ADMIN.password });
  assert.equal(r.data.fields.to, 'too_many');
  const notices = await countTo(ADMIN.email);
  const next = unique('ventas');
  r = await owner.put('/api/contact-form/recipients', { to: [inbox, next.toUpperCase()], currentPassword: ADMIN.password });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.to, [inbox, next]);
  assert.deepEqual((await get()).data.recipients.to, [inbox, next]);
  const mails = await waitForMail(ADMIN.email, notices + 1);
  assert.ok(mails.some((m) => /Se cambió la configuración de correo del panel/.test(m.Subject)), 'the owner is told');
  // Everything else in the e-mail settings is kept.
  const email = await owner.get('/api/settings/email');
  assert.equal(email.data.smtp.host, '127.0.0.1');
  assert.equal(email.data.contact.fromAddress, 'formulario@sensumconstrucciones.com');
});
