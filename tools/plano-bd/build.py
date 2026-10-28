#!/usr/bin/env python3
"""Plano de la base de datos: an interactive map of every table, its columns and
relations, animated walkthroughs and the migration timeline.

  python3 tools/plano-bd/build.py            → dist/plano-base-de-datos.html

It applies every cms/migrations/*.sql to an empty SQLite database (no data, no
people) and reads the real schema; meta.py holds the descriptions, zones and
walkthroughs. After a migration: describe new tables in meta.py (TABLES and a
zone), add the migration to MIGRATIONS, rebuild and republish the artifact.
tests/integration/33-db-map.test.mjs fails if a table or migration is missing.
"""
import glob, json, os, re, sqlite3, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from meta import TABLES, ZONES, FILES, LOGICAL, MIGRATIONS, FLOWS  # noqa: E402


def schema():
    migs = sorted(glob.glob(os.path.join(ROOT, 'cms/migrations/*.sql')))
    texts = {os.path.basename(m)[:-4]: open(m, encoding='utf-8').read() for m in migs}
    with tempfile.TemporaryDirectory() as tmp:
        db = sqlite3.connect(os.path.join(tmp, 'schema.sqlite'))
        for name, sql in texts.items():
            db.executescript(sql)
        # The table the migrator itself creates (cms/src/Db.php).
        db.execute('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)')
        out = []
        for (t,) in db.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name").fetchall():
            cols = [dict(cid=c[0], name=c[1], type=c[2], notnull=bool(c[3]), default=c[4], pk=c[5]) for c in db.execute(f'pragma table_info("{t}")')]
            fks = [dict(table=f[2], col=f[3], to=f[4], onDelete=f[6]) for f in db.execute(f'pragma foreign_key_list("{t}")')]
            idx = [dict(name=i[1], unique=bool(i[2]), origin=i[3], cols=[c[2] for c in db.execute(f'pragma index_info("{i[1]}")')]) for i in db.execute(f'pragma index_list("{t}")').fetchall()]
            sql = db.execute("select sql from sqlite_master where type='table' and name=?", (t,)).fetchone()[0]
            created = next((k for k, v in texts.items() if re.search(r'CREATE TABLE (IF NOT EXISTS )?' + re.escape(t) + r'\b', v)), 'Db.php (migrator)')
            altered = [k for k, v in texts.items() if re.search(r'ALTER TABLE ' + re.escape(t) + r'\b', v)]
            checks = re.findall(r'CHECK\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)', sql)
            out.append(dict(name=t, columns=cols, fks=fks, indexes=idx, sql=sql, created=created, altered=altered, checks=checks))
        db.close()
    return out, list(texts)


tables, migrations = schema()
missing = [t['name'] for t in tables if t['name'] not in TABLES]
placed = {t for z in ZONES for t in z['tables']} | {'users'}
unplaced = [t['name'] for t in tables if t['name'] not in placed]
undescribed = [m for m in migrations if m not in MIGRATIONS]
if missing or unplaced or undescribed:
    sys.exit(f'meta.py is behind the schema — describe: {missing}; place in a zone: {unplaced}; migrations: {undescribed}')
data = {'tables': tables, 'descriptions': TABLES, 'zones': ZONES, 'files': FILES, 'logical': LOGICAL, 'migrations': {m: MIGRATIONS[m] for m in migrations},
        'flows': [{'id': f['id'], 'name': f['name'], 'steps': [[list(a), b] for a, b in f['steps']]} for f in FLOWS]}
tpl = open(os.path.join(HERE, 'template.html'), encoding='utf-8').read()
target = os.path.join(ROOT, 'dist', 'plano-base-de-datos.html')
os.makedirs(os.path.dirname(target), exist_ok=True)
open(target, 'w', encoding='utf-8').write(tpl.replace('/*DATA*/null', json.dumps(data, ensure_ascii=False).replace('</', '<\\/')))
print(f'{target}: {len(tables)} tables, {len(migrations)} migrations')
