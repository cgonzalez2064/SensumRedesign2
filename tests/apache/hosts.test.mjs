// The two names that share public_html in production, checked on the BUILT release with its
// .htaccess untouched: sensumconstrucciones.com (public site) and app.sensumconstrucciones.com
// (Content Manager). Needs the release served by Apache over HTTPS and plain HTTP:
//   APACHE_PROD_HTTPS=https://127.0.0.1:8443 APACHE_PROD_HTTP=http://127.0.0.1:8089 APACHE_PROD_HOME=/path node --test tests/apache/
// APACHE_PROD_HOME holds that release (public_html/ + sensum-cms/ with a production .env:
// APP_URL=https://sensumconstrucciones.com, ADMIN_URL=https://app.sensumconstrucciones.com/admin).
// Self-signed certificate; see docs/LOCAL_SETUP.md, "Production build verification".
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIN, PHP } from '../integration/helpers.mjs';

const HTTPS_BASE = process.env.APACHE_PROD_HTTPS;
const HTTP_BASE = process.env.APACHE_PROD_HTTP;
const HOME = process.env.APACHE_PROD_HOME;
const skip = !HTTPS_BASE || !HTTP_BASE || !HOME;
const SITE = 'sensumconstrucciones.com';
const APP = 'app.sensumconstrucciones.com';

before(() => {
  if (skip) return;
  try {
    execFileSync(PHP, [join(HOME, 'sensum-cms/bin/console'), 'create-admin', `--name=${ADMIN.name}`, `--email=${ADMIN.email}`], { input: `${ADMIN.password}\n${ADMIN.password}\n`, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) { /* already exists */ }
});

/** One request with a chosen Host header; never follows redirects. */
function req(host, path, { secure = true, method = 'GET', headers = {}, body } = {}) {
  const url = new URL(path, secure ? HTTPS_BASE : HTTP_BASE);
  const lib = secure ? https : http;
  return new Promise((resolve, reject) => {
    const r = lib.request(url, { method, headers: { Host: host, ...headers }, rejectUnauthorized: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    r.on('error', reject);
    r.end(body);
  });
}

test('plain http, www. and any other name end on https, on the right name', { skip }, async () => {
  for (const [host, path, location] of [
    [SITE, '/', `https://${SITE}/`],
    [APP, '/admin/', `https://${APP}/admin/`],
    [`www.${SITE}`, '/?x=1', `https://${SITE}/?x=1`],
    ['evil.example', '/admin/', `https://${SITE}/admin/`],
  ]) {
    const r = await req(host, path, { secure: false });
    assert.equal(r.status, 301, `http ${host}${path}`);
    assert.equal(r.headers.location, location);
  }
  const spoofed = await req('evil.example', '/');
  assert.equal(spoofed.status, 301);
  assert.equal(spoofed.headers.location, `https://${SITE}/`, 'never reflects the Host header');
});

test('certificate checks reach their token file over plain http on every name', { skip }, async (t) => {
  // What Namecheap SSL (Sectigo), cPanel and Let's Encrypt fetch before issuing or renewing.
  const dir = join(HOME, 'public_html/.well-known/pki-validation');
  const token = '0123456789ABCDEF0123456789ABCDEF.txt';
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, token), 'dcv-check');
  t.after(() => rmSync(join(HOME, 'public_html/.well-known'), { recursive: true, force: true }));
  for (const host of [APP, `www.${APP}`, `mail.${APP}`, SITE, `www.${SITE}`]) {
    const r = await req(host, `/.well-known/pki-validation/${token}`, { secure: false });
    assert.equal(r.status, 200, host);
    assert.equal(r.text, 'dcv-check', host);
    assert.equal(r.headers.location, undefined, host);
  }
  assert.equal((await req(APP, `/.well-known/pki-validation/${token}`)).status, 200, 'https on app.');
  // A missing token is a plain 404, and nothing else under /.well-known/ skips the redirects.
  assert.equal((await req(APP, '/.well-known/acme-challenge/missing', { secure: false })).status, 404);
  const other = await req(APP, '/.well-known/security.txt', { secure: false });
  assert.equal(other.status, 301);
  assert.equal(other.headers.location, `https://${APP}/.well-known/security.txt`);
});

test('PHP error logs written next to the scripts are never served', { skip }, async (t) => {
  // cPanel's PHP writes "error_log" in the script's folder (server paths, messages).
  const planted = ['error_log', 'api/error_log', 'assets/error_log', 'admin/error_log', 'api/php_errorlog'];
  for (const p of planted) writeFileSync(join(HOME, 'public_html', p), 'PHP Warning: /home/someuser/secret-path');
  t.after(() => { for (const p of planted) rmSync(join(HOME, 'public_html', p), { force: true }); });
  for (const host of [APP, SITE]) {
    for (const p of planted) {
      const r = await req(host, '/' + p);
      assert.ok([403, 404].includes(r.status), `${host}/${p} returned ${r.status}`);
      assert.doesNotMatch(r.text, /secret-path/, `${host}/${p}`);
    }
  }
});

test('app.sensumconstrucciones.com opens the panel and only the panel', { skip }, async () => {
  const root = await req(APP, '/');
  assert.equal(root.status, 302);
  assert.equal(root.headers.location, `https://${APP}/admin/`);
  const admin = await req(APP, '/admin/');
  assert.equal(admin.status, 200);
  assert.match(admin.headers['content-security-policy'], /^default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:/);
  assert.equal(admin.headers['x-robots-tag'], 'noindex, nofollow');
  assert.match(admin.headers['strict-transport-security'], /max-age=63072000; includeSubDomains/);
  assert.equal((await req(APP, '/admin/js/app.js')).status, 200);
  assert.equal((await req(APP, '/assets/favicon-32.png')).status, 200, 'panel icon');
  // The panel's API answers here.
  const session = await req(APP, '/api/auth/session');
  assert.equal(session.status, 200);
  assert.equal(JSON.parse(session.text).authenticated, false);
  // Public pages belong to the site.
  for (const path of ['/index.html', '/privacy-notice.html', '/robots.txt', '/sitemap.xml']) {
    const r = await req(APP, path);
    assert.equal(r.status, 301, path);
    assert.equal(r.headers.location, `https://${SITE}${path}`, path);
  }
  // A missing panel file is a plain 404, not a redirect loop.
  const missing = await req(APP, '/admin/no-such-file.js');
  assert.equal(missing.status, 404);
  // The wiki's own address opens it inside the panel (sign-in first, like every screen).
  for (const [path, to] of [['/wiki', '/admin/#/wiki'], ['/wiki/', '/admin/#/wiki'], ['/wiki/prospectos', '/admin/#/wiki/prospectos']]) {
    const r = await req(APP, path);
    assert.equal(r.status, 302, path);
    assert.equal(r.headers.location, `https://${APP}${to}`, path);
  }
  assert.equal((await req(SITE, '/wiki')).status, 404, 'not on the public site');
  // Its articles and screenshots are only for signed-in accounts, and never files on the web.
  assert.equal((await req(APP, '/api/wiki')).status, 401);
  assert.equal((await req(APP, '/api/wiki/image?name=inicio&lang=es&theme=light&device=desktop')).status, 401);
});

test('sensumconstrucciones.com is the public site; the panel moved to app.', { skip }, async () => {
  const home = await req(SITE, '/');
  assert.equal(home.status, 200);
  assert.match(home.text, /Sensum Construcciones/);
  assert.match(home.headers['content-security-policy'], /script-src 'self' https:\/\/challenges\.cloudflare\.com/);
  for (const path of ['/admin', '/admin/', '/admin/js/app.js']) {
    const r = await req(SITE, path);
    assert.equal(r.status, 301, path);
    assert.equal(r.headers.location, `https://${APP}/admin/`, path);
  }
  assert.equal((await req(SITE, '/assets/main.css')).status, 200);
  assert.equal((await req(SITE, '/no-such-page')).status, 404);
});

test('on the public site the API only answers what the public pages use', { skip }, async () => {
  const health = await req(SITE, '/api/health');
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.text).ok, true);
  // Reaches the application (its own JSON answer), whatever the origin check decides.
  for (const path of ['/api/collect', '/api/telemetry/error']) {
    const r = await req(SITE, path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `https://${SITE}` }, body: '{}' });
    assert.notEqual(r.status, 404, path);
    assert.ok(r.status === 204 || /json/.test(r.headers['content-type']), path);
  }
  // Everything else is not there: no sign-in, no session, no panel data on this name.
  for (const [method, path] of [['GET', '/api/auth/session'], ['POST', '/api/auth/login'], ['POST', '/api/auth/forgot'], ['GET', '/api/users'], ['GET', '/api/content'], ['POST', '/api/setup']]) {
    const r = await req(SITE, path, { method, headers: { 'Content-Type': 'application/json', Origin: `https://${SITE}` }, body: method === 'POST' ? '{}' : undefined });
    assert.equal(r.status, 404, `${method} ${path}`);
    assert.doesNotMatch(r.headers['content-type'] || '', /json/, `${method} ${path} must not reach the application`);
  }
});

test('signing in works on app. in production mode, with a host-only secure cookie', { skip }, async () => {
  const body = JSON.stringify({ email: ADMIN.email, password: ADMIN.password });
  const login = await req(APP, '/api/auth/login', { method: 'POST', body, headers: { 'Content-Type': 'application/json', Origin: `https://${APP}` } });
  assert.equal(login.status, 200, login.text);
  const cookie = login.headers['set-cookie'].find((c) => c.startsWith('__Host-sensum_admin='));
  assert.ok(cookie, 'the __Host- cookie (no Domain: never sent to sensumconstrucciones.com)');
  assert.match(cookie, /; secure/i);
  assert.match(cookie, /; httponly/i);
  assert.match(cookie, /samesite=strict/i);
  assert.doesNotMatch(cookie, /domain=/i);
  const session = await req(APP, '/api/auth/session', { headers: { Cookie: cookie.split(';')[0] } });
  assert.equal(JSON.parse(session.text).user.email, ADMIN.email);
  // A page on another site cannot use the panel's API.
  const foreign = await req(APP, '/api/auth/login', { method: 'POST', body, headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' } });
  assert.equal(foreign.status, 403);
});

test('search engines: old-site addresses and /index.html redirect once, to the matching section', { skip }, async () => {
  for (const [path, location] of [
    ['/index.html', `https://${SITE}/`], ['/index.php', `https://${SITE}/`], ['/indexTest.php', `https://${SITE}/`],
    ['/about', `https://${SITE}/#nosotros`], ['/about.php', `https://${SITE}/#nosotros`],
    ['/services', `https://${SITE}/#servicios`], ['/services.php', `https://${SITE}/#servicios`], ['/cat', `https://${SITE}/#servicios`],
    ['/proyects', `https://${SITE}/#proyectos`], ['/proyects.php', `https://${SITE}/#proyectos`],
    ['/contact', `https://${SITE}/#contacto`], ['/contact.php', `https://${SITE}/#contacto`],
  ]) {
    const r = await req(SITE, path);
    assert.equal(r.status, 301, path);
    assert.equal(r.headers.location, location, path);
  }
  // The home page itself answers directly, with the search title.
  const home = await req(SITE, '/');
  assert.equal(home.status, 200);
  assert.match(home.text, /<title id="pageTitle">Constructora en Guatemala: Construcción y Remodelaciones \| Sensum<\/title>/);
  // A page that never existed is a real 404 whose styles load from any depth.
  const missing = await req(SITE, '/images/blog/renovation/old.jpg');
  assert.equal(missing.status, 404);
  assert.match(missing.text, /href="\/assets\/main\.css\?v=/);
  assert.match(missing.text, /<meta name="robots" content="noindex, follow">/);
});
