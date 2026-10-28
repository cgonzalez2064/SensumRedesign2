// Scheduled tasks: `bin/console cron` says whether the crontab has the scheduled
// check and the daily backup; `cron:install` adds or repairs them, keeps every
// other line and saves the previous crontab. A stand-in `crontab` (CRONTAB_BIN)
// keeps the real one untouched. The scheduled check survives a failing step
// and never runs twice at the same time.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, createAdmin, ROOT, PHP } from './helpers.mjs';

const FAKE = mkdtempSync(join(tmpdir(), 'sensum-crontab-'));
const TAB = join(FAKE, 'crontab.txt');
const BIN = join(FAKE, 'crontab');
writeFileSync(BIN, `#!/bin/sh
if [ "$1" = "-l" ]; then
  if [ -f "${TAB}" ]; then cat "${TAB}"; exit 0; fi
  echo "no crontab for tester" >&2; exit 1
fi
[ -n "$CRONTAB_REFUSE" ] && { echo "crontab: permission denied" >&2; exit 1; }
cp "$1" "${TAB}"
`);
chmodSync(BIN, 0o755);

const CONSOLE = join(ROOT, 'cms', 'bin', 'console');
let s;
before(async () => {
  s = await startServer({ port: 8451, env: { CRONTAB_BIN: BIN } });
  createAdmin(s);
});
after(async () => { await s.stop(); rmSync(FAKE, { recursive: true, force: true }); });

/** Runs the console and returns [exit code, output] (cron exits 1 when something needs attention). */
const run = (args, env = {}) => {
  try {
    return [0, s.cli(args, undefined, env)];
  } catch (e) {
    return [e.status, String(e.stdout)];
  }
};

test('cron: reports the missing jobs, installs them once and keeps the other lines', () => {
  let [code, out] = run(['cron']);
  assert.equal(code, 1);
  assert.match(out, /\[MISS\] Scheduled check, every 15 minutes/);
  assert.match(out, /\[MISS\] Database backup, daily/);
  assert.match(out, /Last scheduled check: never — NOT RUNNING/);
  assert.match(out, /To install or repair: php .*cron:install/);

  const before = [
    'MAILTO="it@example.test"',
    '52 5 * * * "/home/tester/.acme.sh"/acme.sh --cron --home "/home/tester/.acme.sh" > /dev/null',
    '',
    `*/30 * * * * php '${CONSOLE}' monitor > /dev/null 2>&1`,
    '*/15 * * * * /usr/local/bin/php /home/otra-cuenta/sensum-cms/bin/console monitor > /dev/null 2>&1',
  ].join('\n') + '\n';
  writeFileSync(TAB, before);
  [code, out] = run(['cron']);
  assert.match(out, /\[OLD \] \*\/30 \* \* \* \* php/, 'the hand-written line for this installation is flagged');
  assert.match(out, /\[NOTE\] Another line runs the Content Manager/, 'a line for another installation is only mentioned');

  [code, out] = run(['cron:install', '--dry-run']);
  assert.equal(code, 0);
  assert.match(out, /Would remove: \*\/30/);
  assert.equal((out.match(/Would add:/g) || []).length, 2);
  assert.equal(readFileSync(TAB, 'utf8'), before, 'a dry run changes nothing');

  [code, out] = run(['cron:install']);
  assert.equal(code, 0, out);
  assert.match(out, /Saved a copy of the previous crontab: .*crontab-\d{8}-\d{6}\.txt/);
  const tab = readFileSync(TAB, 'utf8').split('\n');
  for (const keep of before.split('\n').filter((l) => !l.startsWith('*/30'))) {
    assert.ok(tab.includes(keep), 'kept: ' + keep);
  }
  assert.ok(!tab.some((l) => l.startsWith('*/30')), 'the old line is replaced');
  const ours = tab.filter((l) => l.endsWith('# sensum-cms'));
  assert.equal(ours.length, 2);
  assert.match(ours[0], /^\*\/15 \* \* \* \* \S*php\S* .*bin\/console'? monitor > \/dev\/null 2>> .*cron\.log'? # sensum-cms$/);
  assert.match(ours[1], /^17 3 \* \* \* .* backup > \/dev\/null 2>> /);
  const saved = readdirSync(s.storage('backups')).filter((f) => f.startsWith('crontab-'));
  assert.equal(saved.length, 1);
  assert.equal(readFileSync(s.storage('backups/' + saved[0]), 'utf8'), before);

  [code, out] = run(['cron:install']);
  assert.match(out, /already installed; nothing changed/);
  assert.equal(readFileSync(TAB, 'utf8').split('\n').filter((l) => l.endsWith('# sensum-cms')).length, 2, 'no duplicates');

  // Installed but not run yet; after one scheduled check everything is in order.
  [code, out] = run(['cron']);
  assert.equal(code, 1);
  assert.match(out, /The jobs are installed\. If the check still has not run/);
  s.cli(['monitor']);
  [code, out] = run(['cron']);
  assert.equal(code, 0, out);
  assert.equal((out.match(/\[ OK \]/g) || []).length, 2);
  assert.match(out, /Last scheduled check: .*\(just now\)$/m);
});

test('cron: shows what cron wrote to its error log, and the manual lines when the crontab refuses', () => {
  mkdirSync(s.storage('logs'), { recursive: true });
  writeFileSync(s.storage('logs/cron.log'), 'PHP Fatal error:  Allowed memory size exhausted in Watchdog.php\n');
  let [, out] = run(['cron']);
  assert.match(out, /Last errors written by cron .*cron\.log/);
  assert.match(out, /PHP Fatal error: {2}Allowed memory size exhausted/);

  writeFileSync(TAB, 'MAILTO=""\n');
  let code;
  [code, out] = run(['cron:install'], { CRONTAB_REFUSE: '1' });
  assert.equal(code, 1);
  assert.match(out, /crontab refused the new jobs: crontab: permission denied/);
  assert.match(out, /Add these lines by hand in cPanel → Cron Jobs/);
  assert.match(out, /\*\/15 \* \* \* \* .* monitor > \/dev\/null/);
  assert.equal(readFileSync(TAB, 'utf8'), 'MAILTO=""\n');
});

test('monitor: a failing step is logged and the rest still runs', () => {
  s.sql("DELETE FROM settings WHERE key = 'monitor_last_run'");
  s.sql('ALTER TABLE monitor_runs RENAME TO monitor_runs_off');
  let out;
  try {
    out = s.cli(['monitor']);
  } finally {
    s.sql('ALTER TABLE monitor_runs_off RENAME TO monitor_runs');
  }
  assert.match(out, /^Health: failed$/m);
  for (const later of ['Disk free:', 'Published pages:', 'Failed alerts re-sent:', 'Monthly report reminder:', 'Alert ', 'Automation ']) {
    assert.ok(out.includes(later), 'still ran: ' + later);
  }
  assert.ok(Number(s.sql("SELECT value FROM settings WHERE key = 'monitor_last_run'")) > Date.now() / 1000 - 60, 'the run is recorded');
  const logged = s.sql("SELECT details FROM error_log WHERE event = 'scheduled_step_failed' ORDER BY id DESC LIMIT 1");
  assert.match(logged, /"step":"Health"/);
});

test('monitor: one run at a time', async () => {
  const holder = spawn(PHP, ['-r', '$f = fopen($argv[1], "c"); flock($f, LOCK_EX); echo "locked\\n"; sleep(10);', s.storage('monitor.lock')]);
  await new Promise((resolve) => holder.stdout.on('data', (d) => String(d).includes('locked') && resolve()));
  try {
    assert.equal(s.cli(['monitor']).trim(), 'The scheduled check is already running; this run was skipped.');
  } finally {
    holder.kill();
  }
  await new Promise((r) => holder.on('exit', r));
  assert.match(s.cli(['monitor']), /^Disk free: /m);
  assert.ok(existsSync(s.storage('monitor.lock')));
});
