// Monthly report, automatic sending (Informe mensual → Envío automático): the owner turns
// it on and picks the day; from 08:00 that day the scheduled check sends last month's
// report to the recipients with its PDF and the owner in copy — once per month, never
// after a manual send, never without recipients or for a month before the site was in
// use; a failed try is repeated 6 hours later, three times at most, then the reminder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, createAdmin, ADMIN, mailpitUp, messagesTo, message, unique } from './helpers.mjs';

let s; let owner;
const CLIENT = unique('cliente-informe');
// Guatemala time (the site's time zone): UTC-6, no daylight saving.
const at = (iso) => Math.floor(Date.parse(iso + '-06:00') / 1000);
const run = (ts, env) => s.cli(['automations', String(ts)], undefined, env);
const line = (out) => (out.match(/^Monthly report: .*$/m) || [''])[0];

before(async () => {
  assert.ok(await mailpitUp(), 'Mailpit must be running');
  s = await startServer({ port: 8471 });
  createAdmin(s);
  owner = new Client(s.base);
  await owner.login();
  // The site has been in use since well before the months below.
  s.sql('UPDATE users SET created_at = 1700000000');
});
after(async () => { await s.stop(); });

test('only the owner turns it on, with a day from 1 to 28; off by default', async () => {
  const d = (await owner.get('/api/site-report')).data;
  assert.equal(d.settings.auto, false);
  assert.equal(d.settings.day, 5);
  assert.equal(d.status.auto, false);
  assert.equal(d.status.nextAuto, null);
  assert.equal((await new Client(s.base).put('/api/site-report/auto', { auto: true, day: 5 })).status, 401);
  for (const bad of [{ auto: true, day: 0 }, { auto: true, day: 29 }, { auto: true, day: '5' }, { auto: 'yes', day: 5 }, {}]) {
    assert.equal((await owner.put('/api/site-report/auto', bad)).status, 422, JSON.stringify(bad));
  }
  const r = await owner.put('/api/site-report/auto', { auto: true, day: 5 });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.data.settings.auto, r.data.settings.day], [true, 5]);
  assert.ok(r.data.status.nextAuto >= Math.floor(Date.now() / 1000) - 5, 'the next send is shown');
  // Saving recipients keeps the automatic sending as it was.
  const saved = await owner.put('/api/site-report/settings', { recipients: [CLIENT], lang: 'es' });
  assert.deepEqual([saved.data.settings.auto, saved.data.settings.day, saved.data.settings.recipients], [true, 5, [CLIENT]]);
  assert.match(s.sql("SELECT details FROM activity_log WHERE action = 'site_report_auto' ORDER BY id DESC LIMIT 1"), /"auto":true,"day":5/);
});

test('from 08:00 on the day: sent once to the recipients with the PDF, the owner in copy', async () => {
  assert.equal(line(run(at('2027-01-04T20:00:00'))), 'Monthly report: not due');
  assert.equal(line(run(at('2027-01-05T07:59:00'))), 'Monthly report: not due');
  const before = (await messagesTo(CLIENT)).length;
  assert.equal(line(run(at('2027-01-05T08:10:00'))), 'Monthly report: sent to 1 recipient(s), the owner in copy');
  const mails = (await messagesTo(CLIENT)).filter((m) => m.Subject === 'Informe del sitio web de diciembre de 2026');
  assert.equal(mails.length, 1);
  assert.equal((await messagesTo(CLIENT)).length, before + 1);
  const m = await message(mails[0].ID);
  assert.ok(m.Cc.some((x) => x.Address === ADMIN.email), 'the owner in copy');
  assert.ok(m.Attachments.some((a) => /\.pdf$/.test(a.FileName)), 'with its PDF');
  assert.doesNotMatch(m.Text, /Esta es una prueba/);
  assert.equal(s.sql("SELECT status || '/' || auto || '/' || IFNULL(sent_by, 'auto') FROM site_reports WHERE period = '2026-12'"), 'sent/1/auto');
  assert.match(s.sql("SELECT details FROM activity_log WHERE action = 'site_report_sent' ORDER BY id DESC LIMIT 1"), /"auto":true/);
  const hist = (await owner.get('/api/site-report')).data.history[0];
  assert.deepEqual([hist.period, hist.status, hist.auto], ['2026-12', 'sent', true]);
  // Later checks the same month: never twice.
  assert.equal(line(run(at('2027-01-05T08:25:00'))), 'Monthly report: already sent');
  assert.equal(line(run(at('2027-01-20T10:00:00'))), 'Monthly report: already sent');
  assert.equal((await messagesTo(CLIENT)).length, before + 1);
});

test('not after a manual send, not without recipients, not for a month before the site was in use, not when off', async () => {
  // January 2027 sent by hand before day 5: day 5 has nothing to do.
  s.sql(`INSERT INTO site_reports (period, sent_at, sent_by, recipients, lang, status, summary, auto) VALUES ('2027-01', ${at('2027-02-02T10:00:00')}, 1, '[]', 'es', 'sent', '{}', 0)`);
  assert.equal(line(run(at('2027-02-05T09:00:00'))), 'Monthly report: already sent');
  // No recipients: nothing goes out (the reminder tells the owner the day after).
  await owner.put('/api/site-report/settings', { recipients: [], lang: 'es' });
  assert.equal(line(run(at('2027-03-05T09:00:00'))), 'Monthly report: no recipients (the owner is reminded)');
  assert.equal(s.sql("SELECT COUNT(*) FROM site_reports WHERE period = '2027-02'"), '0');
  await owner.put('/api/site-report/settings', { recipients: [CLIENT], lang: 'es' });
  // A month before anyone used the site.
  s.sql(`UPDATE users SET created_at = ${at('2027-04-15T12:00:00')}`);
  assert.equal(line(run(at('2027-04-05T09:00:00'))), 'Monthly report: nothing to report (the site was not in use that month)');
  s.sql('UPDATE users SET created_at = 1700000000');
  // Off.
  await owner.put('/api/site-report/auto', { auto: false, day: 5 });
  assert.equal(line(run(at('2027-04-05T09:00:00'))), 'Monthly report: off');
  assert.equal(s.sql("SELECT COUNT(*) FROM site_reports WHERE period = '2027-03'"), '0');
  await owner.put('/api/site-report/auto', { auto: true, day: 5 });
});

test('e-mail down: tried again 6 hours later, three times at most; another day works; the reminder takes over', async () => {
  const down = { SMTP_PORT: '1', SMTP_TIMEOUT: '1' };
  await owner.put('/api/site-report/auto', { auto: true, day: 10 });
  assert.equal(line(run(at('2027-05-05T09:00:00'))), 'Monthly report: not due', 'its own day, not the 5th');
  assert.equal(line(run(at('2027-05-10T08:30:00'), down)), 'Monthly report: failed (retried in 6 hours)');
  assert.equal(line(run(at('2027-05-10T12:00:00'), down)), 'Monthly report: failed, retrying later');
  assert.equal(line(run(at('2027-05-10T15:00:00'), down)), 'Monthly report: failed (retried in 6 hours)');
  assert.equal(line(run(at('2027-05-10T21:00:00'), down)), 'Monthly report: failed (retried in 6 hours)');
  assert.equal(line(run(at('2027-05-11T09:00:00'))), 'Monthly report: failed 3 times (the owner is reminded)');
  assert.equal(s.sql("SELECT COUNT(*) FROM site_reports WHERE period = '2027-04' AND status = 'failed' AND auto = 1"), '3');
  // The next month starts again, with e-mail working.
  assert.equal(line(run(at('2027-06-10T08:00:00'))), 'Monthly report: sent to 1 recipient(s), the owner in copy');
});

test('the reminder follows the chosen day', async () => {
  const st = (await owner.get('/api/site-report')).data.status;
  assert.equal(st.dueDay, 10);
  assert.equal(st.auto, true);
  await owner.put('/api/site-report/auto', { auto: false, day: 10 });
  assert.equal((await owner.get('/api/site-report')).data.status.dueDay, 5, 'off: day 5 again');
});
