// Public website: unchanged output, served files, security headers, deny rules, health.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, Client, ROOT } from './helpers.mjs';

let s;
before(async () => { s = await startServer({ port: 8191 }); });
after(async () => { await s.stop(); });

test('default content renders the committed public pages byte-for-byte', () => {
  s.cli(['publish']);
  for (const page of ['index.html', '404.html', 'privacy-notice.html']) {
    assert.equal(s.readPublic(page), readFileSync(join(ROOT, page), 'utf8'), `${page} differs from the committed file`);
  }
});

test('public pages and assets are served', async () => {
  for (const [path, type] of [['/', 'text/html'], ['/privacy-notice.html', 'text/html'], ['/assets/main.css', 'text/css'], ['/assets/main.js', 'javascript'], ['/assets/portfolio/sensum-portafolio-proyectos.pdf', 'application/pdf'], ['/admin/', 'text/html'], ['/admin/js/app.js', 'javascript']]) {
    const r = await fetch(s.base + path);
    assert.equal(r.status, 200, path);
    assert.match(r.headers.get('content-type'), new RegExp(type), path);
  }
  const nf = await fetch(s.base + '/no-such-page');
  assert.equal(nf.status, 404);
  assert.match(await nf.text(), /Página no encontrada/);
});

test('security headers on the public site and a stricter CSP on the admin', async () => {
  const pub = await fetch(s.base + '/');
  assert.match(pub.headers.get('content-security-policy'), /default-src 'self'; script-src 'self'/);
  assert.doesNotMatch(pub.headers.get('content-security-policy'), /unsafe-inline/);
  assert.equal(pub.headers.get('x-frame-options'), 'DENY');
  assert.equal(pub.headers.get('x-content-type-options'), 'nosniff');
  const adm = await fetch(s.base + '/admin/');
  const csp = adm.headers.get('content-security-policy');
  assert.match(csp, /style-src 'self';/);
  assert.match(csp, /img-src 'self' data: blob:/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /fonts\.googleapis|unsafe-inline/);
  assert.equal(adm.headers.get('x-robots-tag'), 'noindex, nofollow');
});

test('private code, data, docs, tests and dotfiles are never served', async () => {
  for (const path of ['/cms/bootstrap.php', '/cms/.env', '/cms/storage/database.sqlite', '/cms/templates/index.html.tpl', '/cms/composer.json',
    '/.env', '/.env.example', '/.htaccess', '/.gitignore', '/docs/CURRENT_SITE_BASELINE.md', '/README.md', '/NOTES.md', '/tests/package.json',
    '/tools/dev-server.sh', '/api/.htaccess', '/admin/.htaccess', '/assets/uploads/.htaccess', '/assets/uploads/anything.php',
    '/assets/uploads/x.html', '/sensum-mail-config.example.php', '/.git/config']) {
    const r = await fetch(s.base + path);
    assert.ok([403, 404].includes(r.status), `${path} returned ${r.status}`);
    const body = await r.text();
    assert.doesNotMatch(body, /<\?php|SMTP_PASSWORD|CREATE TABLE/, path);
  }
});

test('health endpoint exposes status only — no versions, paths or settings', async () => {
  const r = await fetch(s.base + '/api/health');
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.status, 'ok');
  assert.deepEqual(Object.keys(data).sort(), ['checks', 'ok', 'status', 'time']);
  for (const v of Object.values(data.checks)) assert.ok(['ok', 'fail'].includes(v));
  assert.doesNotMatch(JSON.stringify(data), /\/Users|\/home|\d+\.\d+\.\d+|\.sqlite|smtp\.|password/i);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('unknown API routes and methods fail cleanly as JSON', async () => {
  const c = new Client(s.base);
  assert.equal((await c.get('/api/nope')).status, 404);
  assert.equal((await c.get('/api/nope')).data.error, 'not_found');
  const m = await c.req('DELETE', '/api/health');
  assert.equal(m.status, 405);
  const traversal = await c.get('/api/media/..%2F..%2Fcms/upload');
  assert.ok([403, 404, 405].includes(traversal.status), String(traversal.status));
});

test('the existing contact form handler still behaves as before', async () => {
  const get = await fetch(s.base + '/assets/contact-handler.php', { headers: { Accept: 'application/json' } });
  assert.equal(get.status, 405);
  const fd = new FormData();
  fd.append('name', 'Test');
  const noOrigin = await fetch(s.base + '/assets/contact-handler.php', { method: 'POST', body: fd, headers: { Accept: 'application/json' } });
  assert.equal(noOrigin.status, 403);
});
