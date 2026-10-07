// Pass 2: actively trying to break things.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, Client, createAdmin, FIXTURES } from './helpers.mjs';

let s; let c;
before(async () => {
  s = await startServer({ port: 8205 });
  createAdmin(s);
  c = new Client(s.base);
  await c.login();
  s.cli(['publish']);
});
after(async () => { await s.stop(); });

const sectionVersion = async (id) => (await c.get('/api/content')).data.sections.find((x) => x.id === id).version;

test('two simultaneous saves of the same section: exactly one wins, the other gets a conflict', async () => {
  const v = await sectionVersion('cta');
  const d = new Client(s.base);
  await d.login();
  const [a, b] = await Promise.all([
    c.put('/api/content/cta', { version: v, values: { 'ctabanner.title': { es: 'Versión A' } } }),
    d.put('/api/content/cta', { version: v, values: { 'ctabanner.title': { es: 'Versión B' } } }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const html = s.readPublic('index.html');
  assert.ok(html.includes('>Versión A<') !== html.includes('>Versión B<'), 'published page matches the winner');
});

test('tampered cookies, swapped CSRF tokens and replayed sessions are refused', async () => {
  const d = new Client(s.base);
  await d.login();
  const cookie = d.cookies.get('sensum_admin');
  const tampered = new Client(s.base);
  tampered.cookies.set('sensum_admin', cookie.slice(0, -1) + (cookie.endsWith('A') ? 'B' : 'A'));
  assert.equal((await tampered.get('/api/dashboard')).status, 401);
  const swapped = new Client(s.base);
  swapped.cookies = d.cookies;
  swapped.csrf = c.csrf; // another session's token
  assert.equal((await swapped.put('/api/account/profile', { name: 'X', lang: 'es', theme: 'system' })).status, 403);
  for (const bad of ['', 'x', 'A'.repeat(42), 'A'.repeat(44), '../../../etc/passwd', "' OR 1=1 --"]) {
    const t = new Client(s.base);
    t.cookies.set('sensum_admin', encodeURIComponent(bad));
    assert.equal((await t.get('/api/dashboard')).status, 401, bad);
  }
});

test('hostile upload names and shapes', async () => {
  const jpg = readFileSync(join(FIXTURES, 'wide-1600x900.jpg'));
  const send = (name, field = 'file', extra = (fd) => fd) => {
    const fd = new FormData();
    fd.append('altEs', 'x');
    fd.append(field, new Blob([jpg]), name);
    return c.req('POST', '/api/media/proj2.gallery/upload', { form: extra(fd) });
  };
  const trav = await send('../../../../cms/evil.jpg');
  assert.equal(trav.status, 200);
  assert.match(trav.data.item.url, /^assets\/uploads\/proj2-gallery-[a-f0-9]{12}-w\d+\.(webp|jpg)$/, 'server-generated name');
  assert.equal(trav.data.item.originalName, 'evil.jpg');
  assert.equal((await send('foto.php')).data.fields.file, 'file_type_not_allowed');
  assert.equal((await send('foto.php.jpg')).status, 200, 'double extension is harmless: the name is regenerated');
  assert.equal((await send('foto.jpg', 'file[]')).data.fields.file, 'file_required', 'arrays of files are ignored');
  assert.equal((await send('foto.jpg', 'file', (fd) => { fd.append('file', new Blob([jpg]), 'dos.jpg'); return fd; })).status, 200);
});

test('unexpected ids, routes and methods', async () => {
  for (const p of ['/api/media/item/0', '/api/media/item/-1', '/api/media/item/99999999999', '/api/media/item/1.5', '/api/media/item/1e3', '/api/users/1%20OR%201=1']) {
    assert.ok([404, 405].includes((await c.del(p)).status), p);
  }
  const override = await c.req('POST', '/api/users/1', { json: {}, headers: { 'X-HTTP-Method-Override': 'DELETE' } });
  assert.equal(override.status, 405, 'method override headers are ignored');
  assert.equal(Number(s.sql('SELECT COUNT(*) FROM users')), 1);
});

test('broken encodings, control characters and huge values', async () => {
  const raw = await fetch(s.base + '/api/content/footer', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Origin: s.base, Cookie: c.cookieHeader(), 'X-CSRF-Token': c.csrf },
    body: Buffer.concat([Buffer.from('{"version":0,"values":{"footer.about_desc":{"es":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}}}')]),
  });
  assert.equal(raw.status, 400, 'invalid UTF-8 rejected');
  const v = await sectionVersion('footer');
  const ctl = await c.put('/api/content/footer', { version: v, values: { 'footer.about_desc': { es: 'Hola\u0000mundo‮evil​' } } });
  assert.equal(ctl.status, 200);
  assert.ok(s.readPublic('index.html').includes('>Holamundoevil<'), 'NUL, bidi-override and zero-width characters stripped');
  const huge = await c.put('/api/content/footer', { version: await sectionVersion('footer'), values: { 'footer.about_desc': { es: 'x'.repeat(30000) } } });
  assert.equal(huge.status, 413);
  const login = await new Client(s.base).post('/api/auth/login', { email: 'a@b.c', password: 'x'.repeat(5000) });
  assert.equal(login.status, 401);
});

test('a read-only database fails safely with a friendly, opaque error', async () => {
  const db = s.storage('database.sqlite');
  chmodSync(db, 0o444);
  try {
    const r = await c.put('/api/content/footer', { version: await sectionVersion('footer'), values: { 'footer.about_desc': { es: 'No se guardará' } } });
    assert.equal(r.status, 500);
    assert.deepEqual(Object.keys(r.data).sort(), ['error', 'ok', 'ref']);
    assert.ok(!/sqlite|readonly|SQLSTATE|\/tmp|\/Users/i.test(r.text));
    assert.ok(!s.readPublic('index.html').includes('No se guardará'));
  } finally { chmodSync(db, 0o644); }
  assert.equal((await c.get('/api/dashboard')).status, 200, 'recovers as soon as the database is writable again');
});

test('the public site keeps working with the admin API completely down', async () => {
  await s.stop({ keep: true });
  const staticOnly = await startServer({ port: 8206, reuseDir: s.dir, env: { STORAGE_DIR: '/nonexistent-dir/x' } });
  try {
    assert.equal((await fetch(staticOnly.base + '/')).status, 200);
    const health = await fetch(staticOnly.base + '/api/health');
    assert.ok([200, 503].includes(health.status));
  } finally { await staticOnly.stop({ keep: true }); }
  s = await startServer({ port: 8205, reuseDir: s.dir });
});
