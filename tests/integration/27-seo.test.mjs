// Search engines: what they read (title, description, structured data) is edited
// in the panel without touching the visible page, and old addresses redirect.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, Client, createAdmin, ROOT } from './helpers.mjs';

let s; let c;
before(async () => {
  s = await startServer({ port: 8391 });
  createAdmin(s);
  c = new Client(s.base);
  await c.login();
  s.cli(['publish']);
});
after(async () => { await s.stop(); });

const version = async (id) => (await c.get('/api/content')).data.sections.find((x) => x.id === id).version;
const save = async (id, values) => c.put('/api/content/' + id, { version: await version(id), values });
const head = (html) => html.slice(0, html.indexOf('</head>'));
const meta = (html, attr, name) => html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`))[1];
const ld = (html) => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
const siteContent = (html) => JSON.parse(html.match(/<script type="application\/json" id="siteContent">(.*?)<\/script>/s)[1]);
/** The text a visitor sees (body without scripts, comments and tags). */
const visible = (html) => html.slice(html.indexOf('<body')).replace(/<script[\s\S]*?<\/script>|<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('the home page tells search engines about every target search, in title, description and structured data', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const title = head(html).match(/<title id="pageTitle">([^<]*)<\/title>/)[1];
  const desc = meta(html, 'name', 'description');
  assert.equal(title, 'Constructora en Guatemala: Construcción y Remodelaciones | Sensum');
  assert.ok(title.length <= 70 && desc.length <= 160);
  for (const term of ['constructora', 'guatemala', 'remodelaciones', 'construcción']) assert.match(title.toLowerCase(), new RegExp(term), term);
  for (const term of ['constructora en guatemala', 'servicios de construcción', 'remodelaciones']) assert.ok(desc.toLowerCase().includes(term), term);
  // Link previews (WhatsApp, Facebook…) say the same.
  assert.equal(meta(html, 'property', 'og:title'), title);
  assert.equal(meta(html, 'property', 'og:description'), desc);
  assert.equal(meta(html, 'name', 'twitter:title'), title);
  assert.equal(meta(html, 'name', 'twitter:description'), desc);

  const [org, site, faq] = ld(html);
  assert.equal(org['@type'], 'GeneralContractor');
  assert.equal(org.description, desc);
  assert.ok(org.knowsAbout.includes('Servicios de construcción') && org.knowsAbout.includes('Remodelaciones'));
  assert.equal(org.hasOfferCatalog.name, 'Servicios de construcción y remodelaciones en Guatemala');
  assert.equal(org.hasOfferCatalog.itemListElement.length, 6);
  assert.equal(site['@type'], 'WebSite');
  assert.equal(site.name, 'Sensum Construcciones');
  assert.equal(site.publisher['@id'], org['@id']);
  assert.equal(faq['@type'], 'FAQPage');
});

test('the visible page text is the approved copy (search wording lives only in metadata)', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const text = visible(html);
  assert.ok(text.includes('Construcción y remodelación con planificación, precisión y respaldo técnico'));
  assert.ok(text.includes('Construcción y remodelación en Guatemala'));
  assert.ok(!text.includes('Constructora en Guatemala'), 'no keyword text added to the page');
});

test('panel: the Google title and description are editable, limited, and reach every tag and both languages', async () => {
  const sec = (await c.get('/api/content')).data.sections.find((x) => x.id === 'seo');
  assert.deepEqual(sec.fields.map((f) => [f.key, f.max]), [['meta.title', 70], ['meta.description', 160]]);

  assert.equal((await save('seo', { 'meta.title': { es: 'x'.repeat(71) } })).data.fields['meta.title.es'], 'too_long');
  assert.equal((await save('seo', { 'meta.description': { es: 'x'.repeat(161) } })).data.fields['meta.description.es'], 'too_long');
  assert.equal((await save('seo', { 'meta.title': { es: '<b>x</b>' } })).data.fields['meta.title.es'], 'no_html');

  const before = visible(s.readPublic('index.html'));
  const r = await save('seo', {
    'meta.title': { es: 'Constructora & remodelaciones «Sensum»', en: 'Builder & remodeling "Sensum"' },
    'meta.description': { es: 'Servicios de construcción en Guatemala.', en: 'Construction services in Guatemala.' },
  });
  assert.equal(r.status, 200);
  const html = s.readPublic('index.html');
  assert.match(html, /<title id="pageTitle">Constructora &amp; remodelaciones «Sensum»<\/title>/);
  assert.equal(meta(html, 'property', 'og:title'), 'Constructora &amp; remodelaciones «Sensum»');
  assert.equal(meta(html, 'name', 'description'), 'Servicios de construcción en Guatemala.');
  assert.equal(meta(html, 'name', 'twitter:description'), 'Servicios de construcción en Guatemala.');
  assert.equal(ld(html)[0].description, 'Servicios de construcción en Guatemala.');
  // The English toggle gets its own title/description; nothing visible changed.
  assert.equal(siteContent(html).i18n.en['meta.title'], 'Builder & remodeling "Sensum"');
  assert.equal(visible(html), before);

  // Back to the approved defaults: the published page equals the committed one.
  const defaults = Object.fromEntries(sec.fields.map((f) => [f.key, f.default]));
  assert.equal((await save('seo', defaults)).status, 200);
  assert.equal(s.readPublic('index.html'), readFileSync(join(ROOT, 'index.html'), 'utf8'));
});

test('addresses of the previous site and /index.html redirect permanently (dev router mirrors .htaccess)', async () => {
  const expected = {
    '/index.html': '/', '/index.php': '/', '/index': '/', '/index2.php': '/', '/indexTest.php': '/',
    '/about': '/#nosotros', '/about.php': '/#nosotros',
    '/services': '/#servicios', '/services.php': '/#servicios', '/cat': '/#servicios', '/cat.php': '/#servicios',
    '/proyects': '/#proyectos', '/proyects.php': '/#proyectos', '/projects': '/#proyectos',
    '/contact': '/#contacto', '/contact.php': '/#contacto',
  };
  for (const [from, to] of Object.entries(expected)) {
    const r = await fetch(s.base + from, { redirect: 'manual' });
    assert.equal(r.status, 301, from);
    assert.equal(new URL(r.headers.get('location'), s.base).href, new URL(to, s.base).href, from);
  }
  // The rules in production (.htaccess) send the same addresses to the same places.
  const htaccess = readFileSync(join(ROOT, '.htaccess'), 'utf8');
  const rules = [...htaccess.matchAll(/RewriteRule \^\(([^)]+)\)\$ (\/[^ ]*) \[L,R=301/g)];
  const fromRules = {};
  for (const [, alts, to] of rules) for (const a of alts.split('|')) fromRules['/' + a.replace(/\\\./g, '.')] = to;
  fromRules['/index.html'] = '/';
  assert.deepEqual(fromRules, expected);
  assert.match(htaccess, /RewriteCond %\{THE_REQUEST\} \\s\/index\\\.html\[\\s\?\]\n  RewriteRule \^index\\\.html\$ \/ \[L,R=301\]/);
  // The home page itself still answers at "/".
  assert.equal((await fetch(s.base + '/', { redirect: 'manual' })).status, 200);
});

test('the "not found" page keeps its styles at any depth (root-relative assets)', async () => {
  const r = await fetch(s.base + '/images/blog/renovation/old-photo.jpg');
  assert.equal(r.status, 404);
  const html = await r.text();
  assert.match(html, /<meta name="robots" content="noindex, follow">/);
  assert.match(html, /href="\/assets\/main\.css\?v=\d+"/);
  assert.doesNotMatch(html, /(href|src)="assets\//);
  const css = await fetch(new URL('/assets/main.css', s.base));
  assert.equal(css.status, 200);
});

test('the sitemap and robots.txt point search engines at the canonical pages', () => {
  const robots = readFileSync(join(ROOT, 'robots.txt'), 'utf8');
  assert.match(robots, /^Sitemap: https:\/\/sensumconstrucciones\.com\/sitemap\.xml$/m);
  const sitemap = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, ['https://sensumconstrucciones.com/', 'https://sensumconstrucciones.com/privacy-notice.html']);
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /<link rel="canonical" href="https:\/\/sensumconstrucciones\.com\/">/);
});
