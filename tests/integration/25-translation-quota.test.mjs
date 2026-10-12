// The DeepL quota alert: an e-mail to the alert address when the key has used 90 % of its
// characters and when they run out — once per key and level, checked every 6 hours by the
// scheduled check and right away when the owner presses "Probar conexión".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer, Client, createAdmin, mailpitUp, waitForMail, message, countTo, unique, ROOT, PHP } from './helpers.mjs';
import { startDeepLStub, STUB_KEY } from './deepl-stub.mjs';

const exec = promisify(execFile);

let s; let stub; let alerts;
// The scheduled check, run without blocking this process (the DeepL stand-in answers from here).
const rule = async () => (await exec(PHP, ['cms/bin/console', 'monitor'], { cwd: ROOT, env: s.env })).stdout.split('\n').find((l) => l.startsWith('Alert translation_quota')) || '';
const recheck = () => s.sql("UPDATE settings SET value = json_remove(value, '$.translation.checkedAt') WHERE key = 'watchdog_state'");
const usage = (count, limit = 1000000) => { stub.usage = { character_count: count, character_limit: limit }; };
const quotaMails = async () => (await (await fetch(`http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent('to:' + alerts)}`)).json()).messages
  .filter((m) => /Traducción automática/.test(m.Subject));

before(async () => {
  assert.ok(await mailpitUp(), 'Mailpit must be running');
  alerts = unique('alertas-deepl');
  stub = await startDeepLStub({ port: 8371 });
  s = await startServer({ port: 8372, env: { DEEPL_API_KEY: STUB_KEY, DEEPL_API_URL: stub.url, ALERT_EMAIL: alerts } });
  createAdmin(s);
});
after(async () => { await s.stop(); await stub.stop(); });

test('below 90 %: nothing is sent; DeepL is asked at most every 6 hours', async () => {
  usage(100000);
  assert.match(await rule(), /translation_quota: 10% used$/);
  assert.match(await rule(), /checked recently/, 'not asked again within 6 hours');
  assert.equal((await quotaMails()).length, 0);
});

test('at 90 % one alert goes out; again at 100 %; never twice for the same level', async () => {
  recheck(); usage(900000);
  assert.match(await rule(), /90% used, notified/);
  const [m] = await waitForMail(alerts, 1);
  const mail = await message(m.ID);
  assert.equal(mail.Subject, '[Sensum Website] Traducción automática: se usó el 90 % de los caracteres de DeepL');
  for (const t of ['DeepL: 900,000 de 1,000,000 caracteres usados', 'Quedan', '100,000', 'Administración → Traducción', 'botón ES/EN no se ven afectados']) assert.ok(mail.Text.includes(t), t);
  assert.ok(!mail.Text.includes(STUB_KEY) && !mail.HTML.includes(STUB_KEY), 'never the key');
  assert.match(mail.HTML, /href="[^"]*\/admin\/#\/traduccion"/);
  recheck(); usage(950000);
  assert.match(await rule(), /95% used, already notified/);
  recheck(); usage(1000000);
  assert.match(await rule(), /100% used, notified/);
  const subjects = (await quotaMails()).map((x) => x.Subject);
  assert.equal(subjects.length, 2);
  assert.ok(subjects.includes('[Sensum Website] Traducción automática: se agotaron los caracteres de DeepL'));
  const last = Number(s.sql("SELECT json_extract(value, '$.sent.translation_quota') FROM settings WHERE key = 'watchdog_state'"));
  assert.ok(last > 0, 'shown as last sent in Monitoreo');
});

test('when usage goes back down (plan renewed) it starts over; switched off it stays quiet', async () => {
  recheck(); usage(5000);
  assert.match(await rule(), /0% used$/);
  recheck(); usage(910000);
  assert.match(await rule(), /91% used, notified/);
  assert.equal((await quotaMails()).length, 3);
  s.sql(`INSERT INTO settings (key, value, updated_at) VALUES ('alert_rules', '{"translation_quota":false}', strftime('%s','now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  recheck(); usage(1000000);
  assert.match(await rule(), /translation_quota: off/);
  s.sql("DELETE FROM settings WHERE key = 'alert_rules'");
});

test('"Probar conexión" checks at once and alerts if needed', async () => {
  s.sql("UPDATE settings SET value = json_remove(value, '$.translation') WHERE key = 'watchdog_state'");
  usage(930000);
  const before = await countTo(alerts);
  const owner = new Client(s.base); await owner.login();
  const r = await owner.post('/api/settings/translation/test', {});
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.data.used, r.data.limit], [930000, 1000000]);
  const mails = await waitForMail(alerts, before + 1);
  assert.ok(mails.some((m) => /se usó el 93 %/.test(m.Subject)));
});
