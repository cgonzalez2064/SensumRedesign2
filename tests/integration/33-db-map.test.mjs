// The database map (tools/plano-bd) keeps up with the schema: every table the
// migrations create is described and placed in a zone, and every migration has
// its line in the timeline. Rebuild it with `python3 tools/plano-bd/build.py`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

test('every table and migration is in the database map', () => {
  const meta = readFileSync(join(ROOT, 'tools/plano-bd/meta.py'), 'utf8');
  const migrations = readdirSync(join(ROOT, 'cms/migrations')).filter((f) => f.endsWith('.sql')).map((f) => f.slice(0, -4));
  const tables = new Set(['schema_migrations']);
  for (const m of migrations) {
    const sql = readFileSync(join(ROOT, 'cms/migrations', m + '.sql'), 'utf8');
    for (const x of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_0-9]+)/g)) tables.add(x[1]);
    for (const x of sql.matchAll(/DROP TABLE (?:IF EXISTS )?([a-z_0-9]+)/g)) tables.delete(x[1]); // replaced by a later one
  }
  const described = meta.slice(meta.indexOf('TABLES = {'), meta.indexOf('ZONES = ['));
  const zones = meta.slice(meta.indexOf('ZONES = ['), meta.indexOf('FILES = {'));
  for (const t of tables) {
    assert.ok(described.includes(`'${t}':`), `tools/plano-bd/meta.py: describe the table ${t} in TABLES`);
    if (t !== 'users') assert.ok(zones.includes(`'${t}'`), `tools/plano-bd/meta.py: place ${t} in a zone`);
  }
  const timeline = meta.slice(meta.indexOf('MIGRATIONS = {'), meta.indexOf('FLOWS = ['));
  for (const m of migrations) assert.ok(timeline.includes(`'${m}':`), `tools/plano-bd/meta.py: describe the migration ${m}`);
});
