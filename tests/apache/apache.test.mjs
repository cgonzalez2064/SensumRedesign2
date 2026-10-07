// Verifies a BUILT release under real Apache + PHP-FPM (production-like).
// Usage (see docs/LOCAL_SETUP.md, "Production build verification"):
//   APACHE_BASE=http://127.0.0.1:8088 APACHE_HOME=/path/to/home node --test tests/apache/
// APACHE_HOME contains public_html/ and sensum-cms/ exactly as uploaded to Namecheap.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Client, ADMIN, PHP } from '../integration/helpers.mjs';

const BASE = process.env.APACHE_BASE;
const HOME = process.env.APACHE_HOME;
const skip = !BASE || !HOME;
const get = (p, h = {}) => fetch(BASE + p, { headers: h, redirect: 'manual' });

before(() => {
  if (skip) return;
  try {
    execFileSync(PHP, [join(HOME, 'sensum-cms/bin/console'), 'create-admin', `--name=${ADMIN.name}`, `--email=${ADMIN.email}`], { input: `${ADMIN.password}\n${ADMIN.password}\n`, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) { /* already exists */ }
});

test('public site headers come from .htaccess (security + caching)', { skip }, async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /^default-src 'self'; script-src 'self'; style-src 'self' https:\/\/fonts\.googleapis\.com/);
  for (const [h, v] of [['x-frame-options', 'DENY'], ['x-content-type-options', 'nosniff'], ['referrer-policy', 'strict-origin-when-cross-origin'], ['cross-origin-opener-policy', 'same-origin']]) assert.equal(r.headers.get(h), v, h);
  assert.match(r.headers.get('strict-transport-security'), /max-age=63072000/);
  assert.equal(r.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  assert.match((await get('/assets/main.js')).headers.get('cache-control'), /immutable/);
});

test('admin gets its own stricter CSP and is never cached', { skip }, async () => {
  const r = await get('/admin/');
  assert.equal(r.status, 200);
  const csp = r.headers.getSetCookie ? r.headers.get('content-security-policy') : '';
  assert.match(csp, /^default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:/);
  assert.ok(!csp.includes('fonts.googleapis'), 'public CSP replaced, not merged');
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  const js = await get('/admin/js/app.js');
  assert.equal(js.headers.get('cache-control'), 'no-cache', 'admin JS must revalidate (not the 1-month immutable rule)');
  assert.match(js.headers.get('content-security-policy'), /style-src 'self';/);
});

test('API answers through the rewrite; internals are not reachable', { skip }, async () => {
  const h = await get('/api/health');
  assert.equal(h.status, 200);
  // PHP's own header + the existing root rule for *.php → "no-store, no-store" on Apache (equivalent).
  assert.match(h.headers.get('cache-control'), /^no-store(, no-store)?$/);
  assert.equal((await (await get('/api/does/not/exist')).json()).error, 'not_found');
  for (const p of ['/api/.htaccess', '/.htaccess', '/admin/.htaccess', '/assets/uploads/.htaccess']) assert.equal((await get(p)).status, 403, p);
});

test('private folders and dev files are denied even if uploaded by mistake', { skip }, async () => {
  const planted = ['cms/bootstrap.php', 'cms/.env', 'docs/NOTES.md', 'tests/package.json', 'composer.json', 'package.json', 'x.tpl', 'README.md', 'backup.sql', '.env'];
  for (const p of planted) {
    mkdirSync(join(HOME, 'public_html', p, '..'), { recursive: true });
    writeFileSync(join(HOME, 'public_html', p), '<?php echo "SECRET"; ?> SMTP_PASSWORD=x');
  }
  try {
    for (const p of planted) {
      const r = await get('/' + p);
      assert.equal(r.status, 403, p);
      assert.ok(!(await r.text()).includes('SECRET'), p);
    }
  } finally {
    for (const d of ['cms', 'docs', 'tests']) rmSync(join(HOME, 'public_html', d), { recursive: true, force: true });
    for (const f of ['composer.json', 'package.json', 'x.tpl', 'README.md', 'backup.sql', '.env']) rmSync(join(HOME, 'public_html', f), { force: true });
  }
});

test('uploads folder: only generated image/PDF names are served; nothing executes', { skip }, async () => {
  const dir = join(HOME, 'public_html/assets/uploads');
  writeFileSync(join(dir, 'evil.php'), '<?php echo "EXECUTED"; ?>');
  writeFileSync(join(dir, 'proj1-card-abc123-w800.php'), '<?php echo "EXECUTED"; ?>');
  writeFileSync(join(dir, 'page.html'), '<script>alert(1)</script>');
  writeFileSync(join(dir, 'x.svg'), '<svg/>');
  writeFileSync(join(dir, 'proj1-card-abc123abc123-w800.webp'), readFileSync(join(HOME, 'public_html/assets/logo-icon.png')));
  writeFileSync(join(dir, 'portfolio-pdf-abc123abc123.pdf'), '%PDF-1.4\n%%EOF');
  try {
    for (const f of ['evil.php', 'proj1-card-abc123-w800.php', 'page.html', 'x.svg']) {
      const r = await get('/assets/uploads/' + f);
      assert.equal(r.status, 403, f);
      assert.ok(!(await r.text()).includes('EXECUTED'), f);
    }
    const img = await get('/assets/uploads/proj1-card-abc123abc123-w800.webp');
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
    const pdf = await get('/assets/uploads/portfolio-pdf-abc123abc123.pdf');
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-disposition'), 'attachment');
    assert.equal(pdf.headers.get('content-security-policy'), 'sandbox');
    assert.equal((await get('/assets/uploads/')).status, 403, 'no directory listing');
  } finally {
    for (const f of ['evil.php', 'proj1-card-abc123-w800.php', 'page.html', 'x.svg', 'proj1-card-abc123abc123-w800.webp', 'portfolio-pdf-abc123abc123.pdf']) rmSync(join(dir, f), { force: true });
  }
});

test('full cycle on Apache: sign in, edit text, upload a photo, publish', { skip }, async () => {
  const c = new Client(BASE);
  const login = await c.login();
  assert.equal(login.status, 200);
  const sec = (await c.get('/api/content')).data.sections.find((x) => x.id === 'footer');
  const r = await c.put('/api/content/footer', { version: sec.version, values: { 'footer.about_desc': { es: 'Prueba en Apache & PHP-FPM' } } });
  assert.equal(r.status, 200);
  const html = readFileSync(join(HOME, 'public_html/index.html'), 'utf8');
  assert.ok(html.includes('data-i18n="footer.about_desc">Prueba en Apache &amp; PHP-FPM<'), 'published into public_html');
  assert.ok((await (await get('/')).text()).includes('Prueba en Apache &amp; PHP-FPM'));
  const fd = new FormData();
  fd.append('altEs', 'Foto Apache');
  fd.append('file', new Blob([readFileSync(new URL('../fixtures/out/wide-1600x900.jpg', import.meta.url))]), 'foto.jpg');
  const up = await c.req('POST', '/api/media/proj6.card/upload', { form: fd });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal((await get('/' + up.data.item.url)).status, 200);
  // Put things back.
  await c.put('/api/content/footer', { version: r.data.version, values: { 'footer.about_desc': { es: sec.fields[0].default.es } } });
  assert.equal((await c.del('/api/media/item/' + up.data.item.id)).status, 200);
  assert.ok(!/cookie|session/i.test(JSON.stringify(login.data)));
});
