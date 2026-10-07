// Automatic ES <-> EN translation through DeepL (a local stand-in, never the real service).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer, Client, createAdmin, ROOT, PHP } from './helpers.mjs';
import { startDeepLStub, STUB_KEY } from './deepl-stub.mjs';

let off; let on; let stub; let c;
const tr = (client, from, to, items) => client.post('/api/content/translate', { from, to, items });
// The DeepL stand-in runs in this process: command-line calls must not block it.
const cliAsync = async (server, args) => (await promisify(execFile)(PHP, ['cms/bin/console', ...args], { cwd: ROOT, env: server.env })).stdout;
const logs = (server) => readdirSync(server.storage('logs')).map((f) => readFileSync(server.storage('logs/' + f), 'utf8')).join('');

before(async () => {
  stub = await startDeepLStub({ port: 8217 });
  off = await startServer({ port: 8207 });
  on = await startServer({ port: 8208, env: { DEEPL_API_KEY: STUB_KEY, DEEPL_API_URL: stub.url } });
  createAdmin(off);
  createAdmin(on);
  c = new Client(on.base);
  await c.login();
});
after(async () => { await off.stop(); await on.stop(); await stub.stop(); });

test('without DEEPL_API_KEY the feature is off and the endpoint says so', async () => {
  const client = new Client(off.base);
  await client.login();
  assert.equal((await client.get('/api/content')).data.translation.enabled, false);
  const r = await tr(client, 'es', 'en', [{ key: 'hero.cta1', text: 'Cotiza tu proyecto' }]);
  assert.equal(r.status, 503);
  assert.equal(r.data.error, 'translation_unavailable');
  assert.match(off.cli(['check']), /WARN.*translation.*not configured/);
});

test('only signed-in users with a CSRF token can translate', async () => {
  assert.equal((await c.get('/api/content')).data.translation.enabled, true);
  const anon = await tr(new Client(on.base), 'es', 'en', [{ key: 'hero.cta1', text: 'Hola' }]);
  assert.equal(anon.status, 401);
  const noCsrf = await c.post('/api/content/translate', { from: 'es', to: 'en', items: [{ key: 'hero.cta1', text: 'Hola' }] }, { csrf: false });
  assert.equal(noCsrf.status, 403);
  const foreign = await new Client(on.base, { origin: 'https://evil.example' }).post('/api/content/translate', {});
  assert.equal(foreign.status, 403);
});

test('Spanish → English keeps *highlights*, "&" and the company name, and saves nothing', async () => {
  const before = (await c.get('/api/content')).data.sections.find((s) => s.id === 'hero').version;
  const r = await tr(c, 'es', 'en', [
    { key: 'hero.title', text: 'Construimos con *precisión* & calidad' },
    { key: 'faq.q1', text: '¿Qué hace Sensum Construcciones?' },
  ]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.translations, [
    { key: 'hero.title', text: 'We build with *precision* & quality' },
    { key: 'faq.q1', text: 'EN: ¿Qué hace Sensum Construcciones?' },
  ]);
  const sent = stub.last();
  assert.equal(sent.headers.authorization, `DeepL-Auth-Key ${STUB_KEY}`);
  assert.deepEqual(sent.body.text, [
    'Construimos con <em>precisión</em> &amp; calidad',
    '¿Qué hace <keep>Sensum Construcciones</keep>?',
  ]);
  assert.equal(sent.body.source_lang, 'ES');
  assert.equal(sent.body.target_lang, 'EN-US');
  assert.equal(sent.body.tag_handling, 'xml');
  assert.deepEqual(sent.body.ignore_tags, ['keep']);
  assert.equal(sent.body.formality, undefined);
  // Translating is not saving.
  const after = (await c.get('/api/content')).data.sections.find((s) => s.id === 'hero');
  assert.equal(after.version, before);
  assert.equal(after.fields.find((f) => f.key === 'hero.title').value.en, after.fields.find((f) => f.key === 'hero.title').default.en);
});

test('English → Spanish uses Latin American Spanish and the informal "tú"', async () => {
  const r = await tr(c, 'en', 'es', [{ key: 'hero.cta1', text: 'Get a quote' }]);
  assert.equal(r.status, 200);
  assert.equal(r.data.translations[0].text, 'Cotiza tu proyecto');
  assert.equal(stub.last().body.target_lang, 'ES-419');
  assert.equal(stub.last().body.formality, 'prefer_less');
});

test('requests are validated: fields, languages, size and markup', async () => {
  const bad = [
    { from: 'es', to: 'es', items: [{ key: 'hero.cta1', text: 'x' }] },
    { from: 'es', to: 'fr', items: [{ key: 'hero.cta1', text: 'x' }] },
    { from: 'es', to: 'en', items: [] },
    { from: 'es', to: 'en', items: [{ key: 'nope.field', text: 'x' }] },
    { from: 'es', to: 'en', items: [{ key: 'contact.email', text: 'a@b.co' }] }, // not a bilingual text
    { from: 'es', to: 'en', items: [{ key: 'hero.cta1', text: 42 }] },
    { from: 'es', to: 'en', items: { a: { key: 'hero.cta1', text: 'x' } } },
    { from: 'es', to: 'en', items: Array.from({ length: 51 }, () => ({ key: 'hero.cta1', text: 'x' })) },
  ];
  for (const body of bad) assert.equal((await c.post('/api/content/translate', body)).status, 400, JSON.stringify(body).slice(0, 80));
  const html = await tr(c, 'es', 'en', [{ key: 'hero.desc', text: '<img src=x onerror=alert(1)>' }]);
  assert.equal(html.status, 422);
  assert.deepEqual(html.data.fields, { 'hero.desc.es': 'no_html' });
  const big = await tr(c, 'es', 'en', [{ key: 'hero.desc', text: 'a'.repeat(4001) }]);
  assert.equal(big.status, 413);
});

test('markup coming back from the translation service is neutralized', async () => {
  stub.reply = '<script>alert(1)</script>Hi <img src=x onerror=alert(2)> &lt;b&gt;';
  try {
    const r = await tr(c, 'es', 'en', [{ key: 'hero.desc', text: 'Hola' }]);
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.data.translations[0].text, /[<>]/);
  } finally {
    stub.reply = null;
  }
});

test('DeepL failures become clear codes; the key is never logged', async () => {
  for (const [mode, code] of [['quota', 'translation_quota'], ['busy', 'translation_busy'], ['error', 'translation_failed']]) {
    stub.mode = mode;
    const r = await tr(c, 'es', 'en', [{ key: 'hero.cta1', text: 'Hola ' + mode }]);
    assert.equal(r.status, 503, mode);
    assert.equal(r.data.error, code, mode);
  }
  stub.mode = 'ok';
  const wrongKey = await startServer({ port: 8209, env: { DEEPL_API_KEY: 'wrong-key:fx', DEEPL_API_URL: stub.url } });
  try {
    createAdmin(wrongKey);
    const w = new Client(wrongKey.base);
    await w.login();
    const r = await tr(w, 'es', 'en', [{ key: 'hero.cta1', text: 'Hola' }]);
    assert.equal(r.data.error, 'translation_failed');
    assert.match(logs(wrongKey), /"translation_failed".*"reason":"auth_failed"/);
    assert.doesNotMatch(logs(wrongKey), /wrong-key/);
  } finally {
    await wrongKey.stop();
  }
  assert.match(logs(on), /"reason":"quota_exceeded"/);
  assert.doesNotMatch(logs(on), new RegExp(STUB_KEY.split(':')[0]));
  // Nothing of the edited text is logged either.
  assert.doesNotMatch(logs(on), /Hola quota/);
});

test('a daily character cap protects the DeepL quota', async () => {
  const capped = await startServer({ port: 8209, env: { DEEPL_API_KEY: STUB_KEY, DEEPL_API_URL: stub.url, TRANSLATE_DAILY_CHAR_LIMIT: '1000' } });
  try {
    createAdmin(capped);
    const k = new Client(capped.base);
    await k.login();
    const text = 'palabra '.repeat(70).trim(); // ≈ 560 characters
    assert.equal((await tr(k, 'es', 'en', [{ key: 'faq.a1', text }])).status, 200);
    const second = await tr(k, 'es', 'en', [{ key: 'faq.a2', text }]);
    assert.equal(second.status, 429);
    assert.equal(second.data.error, 'translation_busy');
  } finally {
    await capped.stop();
  }
});

test('command line: check and translate:test report the DeepL setup', async () => {
  assert.match(on.cli(['check']), /OK .*translation\s+DeepL API Free/);
  const out = await cliAsync(on, ['translate:test']);
  assert.match(out, /DeepL API Free is working/);
  assert.match(out, /We build with|EN: Construimos/);
  assert.match(out, /1,234 of 500,000 characters/);
});

test('in production the test-only DEEPL_API_URL is ignored (always the official DeepL host)', () => {
  const script = `
    require 'cms/vendor/autoload.php';
    $app = Sensum\\Cms\\App::boot(getcwd() . '/cms');
    $m = new ReflectionMethod(Sensum\\Cms\\Translator::class, 'baseUrl');
    echo $m->invoke($app->translator());`;
  const run = (env) => execFileSync(PHP, ['-r', script], { cwd: ROOT, env: { ...process.env, DEEPL_API_URL: 'http://127.0.0.1:1', ...env } }).toString();
  assert.equal(run({ APP_ENV: 'production', DEEPL_API_KEY: 'abc:fx' }), 'https://api-free.deepl.com');
  assert.equal(run({ APP_ENV: 'production', DEEPL_API_KEY: 'abc' }), 'https://api.deepl.com');
  assert.equal(run({ APP_ENV: 'development', DEEPL_API_KEY: 'abc:fx' }), 'http://127.0.0.1:1');
});
