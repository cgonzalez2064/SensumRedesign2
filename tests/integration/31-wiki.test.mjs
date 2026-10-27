// The panel's wiki: the articles are complete in both languages and say what
// the panel really shows (button names, links, screenshots in every variant);
// only signed-in accounts read them, each with what its role includes; the
// screenshots are served privately; «Novedades» reach, once, whoever can use them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, Client, createAdmin, ROOT, unique, waitForMail, message, linkToken } from './helpers.mjs';

const WIKI = join(ROOT, 'cms/wiki');
const meta = JSON.parse(readFileSync(join(WIKI, 'wiki.json'), 'utf8'));
const front = (lang, slug) => {
  const raw = readFileSync(join(WIKI, 'articles', `${slug}.${lang}.md`), 'utf8');
  const [, head, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  return { ...Object.fromEntries(head.split('\n').map((l) => /^([a-z]+):\s*(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].trim()])), body };
};
const slugs = readdirSync(join(WIKI, 'articles')).filter((f) => f.endsWith('.es.md')).map((f) => f.slice(0, -6));
const strings = async (lang) => {
  const out = [];
  const walk = (v) => { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk((await import(join(ROOT, `admin/js/i18n/${lang}.js`))).default);
  return out.join('\n');
};

test('every article exists in both languages, consistent, with real button names, links, icons and screenshots', async () => {
  assert.ok(slugs.length >= 20, 'the wiki covers the panel');
  const icons = readFileSync(join(ROOT, 'admin/icons.svg'), 'utf8');
  const cats = meta.categories.map((c) => c.id);
  const variants = ['es', 'en'].flatMap((l) => ['light', 'dark'].flatMap((t) => ['desktop', 'mobile'].map((d) => `${l}.${t}.${d}`)));
  for (const lang of ['es', 'en']) {
    const ui = await strings(lang);
    for (const slug of slugs) {
      assert.ok(existsSync(join(WIKI, 'articles', `${slug}.${lang}.md`)), `${slug}.${lang}.md`);
      const a = front(lang, slug);
      const es = front('es', slug);
      for (const k of ['category', 'order', 'icon', 'perms', 'owner']) assert.equal(a[k] ?? '', es[k] ?? '', `${slug}.${lang}: ${k} as in Spanish`);
      assert.ok(a.title && a.summary && a.updated, `${slug}.${lang}: title, summary, updated`);
      assert.ok(cats.includes(a.category), `${slug}: category ${a.category}`);
      assert.ok(icons.includes(`id="i-${a.icon}"`), `${slug}: icon ${a.icon}`);
      for (const m of a.body.matchAll(/`([^`]+)`/g)) assert.ok(ui.includes(m[1]), `${slug}.${lang}: the panel never says "${m[1]}"`);
      for (const m of a.body.matchAll(/\(wiki:([a-z0-9-]+)\)/g)) assert.ok(slugs.includes(m[1]), `${slug}.${lang}: link to ${m[1]}`);
      for (const m of a.body.matchAll(/\(shot:([a-z0-9-]+)\)/g)) {
        for (const v of variants) assert.ok(existsSync(join(WIKI, 'img', `${m[1]}.${v}.webp`)), `${slug}: screenshot ${m[1]}.${v} (npm --prefix tests run wiki:shots)`);
      }
      assert.doesNotMatch(a.body, /<[a-z]/i, `${slug}.${lang}: Markdown only, no HTML`);
    }
  }
  // «Novedades»: unique, in both languages, pointing at real articles and screenshots.
  const ids = meta.news.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const n of meta.news) {
    assert.match(n.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(n.es.title && n.en.title && n.es.points.length === n.en.points.length, n.id);
    if (n.article) assert.ok(slugs.includes(n.article), `${n.id}: ${n.article}`);
    if (n.shot) assert.ok(existsSync(join(WIKI, 'img', `${n.shot}.es.light.desktop.webp`)), `${n.id}: ${n.shot}`);
  }
});

let s; let owner;
before(async () => {
  s = await startServer({ port: 8431 });
  createAdmin(s);
  owner = new Client(s.base);
  await owner.login();
});
after(async () => { await s.stop(); });

async function person(permissions) {
  s.sql("DELETE FROM rate_limits");
  const email = unique('wiki');
  const r = await owner.post('/api/users', { name: 'Persona Wiki', email, permissions, lang: 'es' });
  assert.equal(r.status, 200, r.text);
  const token = linkToken((await message((await waitForMail(email, 1))[0].ID)).Text, 'invitacion');
  const c = new Client(s.base);
  const pw = 'Clave-Wiki-Prueba-2026';
  assert.equal((await c.post('/api/auth/invitation/accept', { token, name: 'Persona Wiki', password: pw, passwordConfirm: pw })).status, 200);
  c.csrf = (await c.get('/api/auth/session')).data.csrf;
  return { c, id: r.data.user.id, email };
}

test('only signed-in accounts read the wiki; each sees what its role includes, in its language', async () => {
  const anon = new Client(s.base);
  assert.equal((await anon.get('/api/wiki')).status, 401);
  assert.equal((await anon.get('/api/wiki/image?name=inicio&lang=es&theme=light&device=desktop')).status, 401);
  const sales = await person(['leads', 'stats']);
  const w = (await sales.c.get('/api/wiki')).data;
  const by = Object.fromEntries(w.articles.map((a) => [a.slug, a]));
  assert.equal(w.lang, 'es');
  assert.equal(by.prospectos.allowed, true);
  assert.equal(by.textos.allowed, false, 'readable, marked as not in the role');
  assert.equal(by['primeros-pasos'].allowed, true);
  assert.ok(by.prospectos.body.includes('## '), 'the Markdown comes with it');
  for (const ownerOnly of ['seguridad', 'monitoreo', 'ver-como']) assert.equal(by[ownerOnly], undefined, ownerOnly + ' is the owner\'s');
  assert.ok(w.categories.every((c) => c.title && c.icon));
  const en = (await sales.c.get('/api/wiki?lang=en')).data;
  assert.equal(en.articles.find((a) => a.slug === 'prospectos').title, 'Leads: the contact-form messages');
  const own = (await owner.get('/api/wiki')).data.articles;
  assert.ok(own.find((a) => a.slug === 'seguridad') && own.every((a) => a.allowed));
});

test('screenshots: private cache, every variant, a fallback, nothing outside the folder', async () => {
  const sales = await person(['leads', 'stats']);
  const r = await fetch(s.base + '/api/wiki/image?name=prospectos&lang=en&theme=dark&device=mobile', { headers: { Cookie: sales.c.cookieHeader() } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/webp');
  assert.equal(r.headers.get('cache-control'), 'private, max-age=604800');
  const etag = r.headers.get('etag');
  assert.equal((await fetch(s.base + '/api/wiki/image?name=prospectos&lang=en&theme=dark&device=mobile', { headers: { Cookie: sales.c.cookieHeader(), 'If-None-Match': etag } })).status, 304);
  for (const bad of ['name=../wiki&lang=es&theme=light&device=desktop', 'name=prospectos&lang=fr&theme=light&device=desktop', 'name=prospectos&lang=es&theme=sepia&device=desktop', 'name=no-existe&lang=es&theme=light&device=desktop']) {
    assert.equal((await sales.c.get('/api/wiki/image?' + bad)).status, 404, bad);
  }
});

test('«Novedades»: for whoever can use them, once, and never older than the account', async () => {
  const sales = await person(['leads', 'stats']);
  const ids = (await sales.c.get('/api/wiki/news')).data.news.map((n) => n.id);
  assert.ok(ids.includes('2026-10-estadisticas') && ids.includes('2026-10-prospectos') && ids.includes('2026-10-mas-secciones'));
  assert.ok(!ids.includes('2026-10-usuarios') && !ids.includes('2026-10-actividad'), 'not what their role lacks');
  const ownerIds = (await owner.get('/api/wiki/news')).data.news.map((n) => n.id);
  assert.ok(!ownerIds.includes('2026-10-mas-secciones') && ownerIds.includes('2026-10-usuarios'));
  // Seen once: the panel stops showing it, the wiki keeps it (marked seen).
  assert.equal((await sales.c.post('/api/wiki/news/seen', { ids: ['2026-10-estadisticas'] })).data.marked, 1);
  assert.equal((await sales.c.post('/api/wiki/news/seen', { ids: ['2026-10-estadisticas'] })).data.marked, 0);
  assert.ok(!(await sales.c.get('/api/wiki/news')).data.news.some((n) => n.id === '2026-10-estadisticas'));
  assert.equal((await sales.c.get('/api/wiki')).data.news.find((n) => n.id === '2026-10-estadisticas').seen, true);
  assert.equal((await sales.c.post('/api/wiki/news/seen', { ids: ['no-existe'] })).status, 422);
  // Someone who joined after a feature shipped gets the welcome, not that «Novedad».
  s.sql(`UPDATE users SET created_at = ${Math.floor(Date.UTC(2030, 0, 1) / 1000)} WHERE id = ${sales.id}`);
  assert.equal((await sales.c.get('/api/wiki/news')).data.news.length, 0);
});

test('app.…/wiki opens the wiki inside the panel (dev router, like .htaccess)', async () => {
  for (const [path, to] of [['/wiki', '/admin/#/wiki'], ['/wiki/', '/admin/#/wiki'], ['/wiki/estadisticas', '/admin/#/wiki/estadisticas']]) {
    const r = await fetch(s.base + path, { redirect: 'manual' });
    assert.equal(r.status, 302, path);
    assert.equal(r.headers.get('location'), to, path);
  }
});
