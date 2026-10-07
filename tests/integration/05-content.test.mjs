// Text and contact-detail editing, validation and publishing into the public pages.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, Client, createAdmin, ROOT } from './helpers.mjs';

let s; let c;
before(async () => {
  s = await startServer({ port: 8197 });
  createAdmin(s);
  c = new Client(s.base);
  await c.login();
  s.cli(['publish']);
});
after(async () => { await s.stop(); });

const version = async (id) => (await c.get('/api/content')).data.sections.find((x) => x.id === id).version;
const save = async (id, values) => c.put('/api/content/' + id, { version: await version(id), values });
const siteContent = (html) => {
  const m = html.match(/<script type="application\/json" id="siteContent">(.*?)<\/script>/s);
  return m ? JSON.parse(m[1]) : null;
};

test('content listing describes every editable field with limits and defaults', async () => {
  const r = await c.get('/api/content');
  assert.equal(r.status, 200);
  const fields = r.data.sections.flatMap((x) => x.fields);
  assert.equal(fields.length, 104);
  const title = fields.find((f) => f.key === 'hero.title');
  assert.equal(title.type, 'emphasis');
  assert.equal(title.default.es, 'Construcción y remodelación con planificación, *precisión* y respaldo técnico');
});

test('HTML and script payloads are refused in every text field', async () => {
  for (const payload of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', 'a > b', '</title><svg/onload=alert(1)>']) {
    const r = await save('hero', { 'hero.eyebrow': { es: payload }, 'hero.desc': { en: payload } });
    assert.equal(r.status, 422, payload);
    assert.deepEqual(r.data.fields, { 'hero.eyebrow.es': 'no_html', 'hero.desc.en': 'no_html' });
  }
  assert.ok(!s.readPublic('index.html').includes('onerror'));
});

test('length limits, required fields and emphasis syntax are enforced server-side', async () => {
  assert.equal((await save('hero', { 'hero.eyebrow': { es: 'x'.repeat(61) } })).data.fields['hero.eyebrow.es'], 'too_long');
  assert.equal((await save('hero', { 'hero.eyebrow': { es: '   ' } })).data.fields['hero.eyebrow.es'], 'required');
  assert.equal((await save('hero', { 'hero.title': { es: 'Con *precisión y sin cierre' } })).data.fields['hero.title.es'], 'emphasis_unbalanced');
  assert.equal((await save('hero', { 'hero.title': { es: 'Vacío ** aquí' } })).data.fields['hero.title.es'], 'emphasis_empty');
  // Asterisks don't count towards the limit of emphasis fields.
  assert.equal((await save('hero', { 'hero.title': { es: '*' + 'a'.repeat(100) + '*' } })).status, 200);
});

test('unknown fields, languages and sections are rejected', async () => {
  assert.equal((await save('hero', { 'nav.inicio': { es: 'Hackeado' } })).status, 400);
  assert.equal((await save('hero', { 'hero.eyebrow': { fr: 'Bonjour' } })).status, 400);
  assert.equal((await save('hero', { 'hero.eyebrow': { es: ['array'] } })).status, 400);
  assert.equal((await c.put('/api/content/admin', { version: 0, values: { x: { es: 'y' } } })).status, 404);
  assert.equal((await c.put('/api/content/hero', '{"version":0,"values":', {})).status, 400);
  assert.equal((await c.req('PUT', '/api/content/hero', { json: 'not json', headers: { 'Content-Type': 'text/plain' } })).status, 415);
});

test('saving publishes escaped Spanish HTML plus ES/EN data for the language toggle', async () => {
  const r = await save('hero', {
    'hero.eyebrow': { es: 'Construcción & remodelación "integral"', en: 'Build & Remodel' },
    'hero.title': { es: 'Construimos con *precisión* y confianza', en: 'Built with care' },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.changed.sort(), ['hero.eyebrow.en', 'hero.eyebrow.es', 'hero.title.en', 'hero.title.es']);
  const html = s.readPublic('index.html');
  assert.ok(html.includes('data-i18n="hero.eyebrow">Construcción &amp; remodelación &quot;integral&quot;<'));
  assert.ok(html.includes('data-i18n="hero.title">Construimos con <em>precisión</em> y confianza<'));
  const data = siteContent(html);
  assert.equal(data.i18n.es['hero.eyebrow'], 'Construcción & remodelación "integral"');
  assert.equal(data.i18n.es['hero.title'], 'Construimos con <em>precisión</em> y confianza');
  assert.equal(data.i18n.en['hero.title'], 'Built with care', 'no emphasis → plain text (applied with textContent)');
  assert.ok(!/<\/script>[^\n]*hero/.test(html.split('id="siteContent">')[1].split('</script>')[0]), 'JSON cannot break out of its script tag');
});

test('saving the same values twice changes nothing; stale versions conflict', async () => {
  const v = await version('hero');
  const again = await c.put('/api/content/hero', { version: v, values: { 'hero.eyebrow': { es: 'Construcción & remodelación "integral"' } } });
  assert.deepEqual(again.data.changed, []);
  const stale = await c.put('/api/content/hero', { version: v - 1000, values: { 'hero.eyebrow': { es: 'Otro texto' } } });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error, 'conflict');
  assert.equal(stale.data.updatedBy, 'Ana Administradora');
});

test('contact details: validation, normalization and every place they appear', async () => {
  const bad = await save('details', {
    'contact.phone_office': { '*': '12' },
    'contact.whatsapp': { '*': 'abc' },
    'contact.email': { '*': 'not-an-email' },
    'contact.maps_url': { '*': 'https://evil.example/maps' },
    'contact.instagram_url': { '*': 'javascript:alert(1)' },
    'contact.instagram_handle': { '*': '@bad handle!' },
  });
  assert.deepEqual(bad.data.fields, {
    'contact.phone_office': 'invalid_phone', 'contact.whatsapp': 'invalid_whatsapp', 'contact.email': 'invalid_email',
    'contact.maps_url': 'url_host_not_allowed', 'contact.instagram_url': 'invalid_url', 'contact.instagram_handle': 'invalid_handle',
  });
  for (const url of ['http://www.google.com/maps', 'https://user:pass@www.google.com/maps', 'https://www.google.com:8443/maps', 'https://www.google.com/maps?q="><script>']) {
    assert.equal((await save('details', { 'contact.maps_url': { '*': url } })).status, 422, url);
  }
  const ok = await save('details', {
    'contact.phone_office': { '*': '2333 - 4444' },
    'contact.phone_mobile': { '*': '' },
    'contact.whatsapp': { '*': '+502 5555-6666' },
    'contact.email': { '*': 'Info@Sensum.Example' },
    'contact.address_office': { '*': 'Oficina 1201' },
    'contact.instagram_handle': { '*': 'nuevo.usuario' },
  });
  assert.equal(ok.status, 200);
  const html = s.readPublic('index.html');
  assert.ok(html.includes('<a href="tel:+50223334444">2333&#8209;4444</a></span>'), 'single phone in contact list');
  assert.ok(!html.includes('3481'), 'removed mobile number disappears everywhere');
  assert.ok(html.includes('href="https://wa.me/50255556666?text='));
  assert.ok(html.includes('mailto:info@sensum.example'), 'e-mail lower-cased');
  assert.ok(html.includes('>@nuevo.usuario<'));
  assert.ok(html.includes('Edificio Ascend, 13 Calle 5-31 Zona 9, Of. 1201<'), 'footer abbreviation');
  assert.ok(html.includes('"telephone": ["+502-2333-4444"]'));
  const data = siteContent(html);
  assert.equal(data.whatsapp, '50255556666');
  assert.match(data.i18n.en['form.fallback'], /tel:\+50223334444/);
  assert.match(s.readPublic('404.html'), /tel:\+50223334444/);
  assert.match(s.readPublic('privacy-notice.html'), /info@sensum\.example/);
  for (const line of html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(line.replace(/<\/?script[^>]*>/g, ''));
});

test('editing the business hours removes the now-unverified structured hours', async () => {
  assert.ok(s.readPublic('index.html').includes('openingHoursSpecification'));
  await save('contact', { 'contact.hours_value': { es: 'Lunes a sábado, 7:00 – 18:00.' } });
  assert.ok(!s.readPublic('index.html').includes('openingHoursSpecification'));
});

test('unicode, quotes and long-but-valid text round-trip safely', async () => {
  const text = 'Ñandú «comillas» “tipográficas” — emoji 🏗️ & símbolos ©®™ \'apóstrofo\'';
  assert.equal((await save('footer', { 'footer.about_desc': { es: text } })).status, 200);
  const html = s.readPublic('index.html');
  assert.ok(html.includes('data-i18n="footer.about_desc">Ñandú «comillas» “tipográficas” — emoji 🏗️ &amp; símbolos ©®™ &apos;apóstrofo&apos;<'));
  assert.equal(siteContent(html).i18n.es['footer.about_desc'], text);
  const max = 'a'.repeat(90);
  assert.equal((await save('footer', { 'footer.about_desc': { es: max } })).status, 200);
});

test('restoring every default returns the public pages to the approved files', async () => {
  const sections = (await c.get('/api/content')).data.sections;
  for (const sec of sections) {
    const values = {};
    for (const f of sec.fields) values[f.key] = f.default;
    const r = await c.put('/api/content/' + sec.id, { version: sec.version, values });
    assert.equal(r.status, 200, sec.id);
  }
  for (const page of ['index.html', '404.html', 'privacy-notice.html']) {
    assert.equal(s.readPublic(page), readFileSync(join(ROOT, page), 'utf8'), page);
  }
});

test('every save leaves a backup of the previous live pages and an audit entry', () => {
  const backups = Number(s.sql("SELECT COUNT(*) FROM activity_log WHERE action='publish'"));
  assert.ok(backups >= 5);
  assert.ok(Number(s.sql("SELECT COUNT(*) FROM activity_log WHERE action='content_updated'")) >= 5);
  const details = s.sql("SELECT group_concat(details, ' ') FROM activity_log WHERE action='content_updated' AND target='hero'");
  assert.match(details, /"hero\.eyebrow\.es":\["Construcción y remodelación en Guatemala","Construcción & remodelación \\"integral\\""\]/, 'old and new value recorded');
});
