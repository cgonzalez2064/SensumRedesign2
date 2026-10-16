// Moving the photos of one installation to another (local → production) with
// tools/export-photos.php and the importer it puts in the bundle (importar-fotos.php).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, Client, createAdmin, PHP, ROOT } from './helpers.mjs';

let src, dst, other, work, bundle;

/** Runs a PHP script with an installation's environment; never throws. */
function php(args, server) {
  try {
    return { code: 0, out: execFileSync(PHP, args, { cwd: ROOT, env: server.env, stdio: ['pipe', 'pipe', 'pipe'] }).toString() };
  } catch (e) {
    return { code: e.status, out: String(e.stdout) + String(e.stderr) };
  }
}
const importer = (server, ...args) => php([join(bundle, 'importar-fotos.php'), `--cms=${join(ROOT, 'cms')}`, ...args], server);
const rows = (server) => JSON.parse(server.sql("SELECT json_group_array(json_object('slot', slot, 'position', position, 'base', file_base, 'variants', variants, 'es', alt_es, 'en', alt_en)) FROM (SELECT * FROM media WHERE deleted_at IS NULL ORDER BY slot, position)"));

before(async () => {
  [src, dst, other] = await Promise.all([startServer({ port: 8381 }), startServer({ port: 8382 }), startServer({ port: 8383 })]);
  for (const s of [src, dst, other]) createAdmin(s);
  work = mkdtempSync(join(tmpdir(), 'sensum-photos-'));
  bundle = join(work, 'bundle');
});
after(async () => {
  await Promise.all([src.stop(), dst.stop(), other.stop()]);
  rmSync(work, { recursive: true, force: true });
});

test('export carries only the active photos, every width and both descriptions', async () => {
  const c = new Client(src.base);
  await c.login();
  const up = async (slot, file, altEs, altEn) => {
    const r = await c.upload(`/api/media/${slot}/upload`, { altEs, altEn }, { file });
    assert.equal(r.status, 200, `${slot}: ${r.text}`);
    return r.data.item;
  };
  await up('about.photo', 'landscape-4000x3000.jpg', 'Obra en zona 10', 'Site in zone 10');
  await up('proj1.card', 'wide-1600x900.jpg', 'Remodelación de cocina', 'Kitchen remodel');
  await up('proj1.gallery', 'landscape-4000x3000.jpg', 'Antes', 'Before');
  const removed = await up('proj1.gallery', 'wide-1600x900.jpg', 'Borrada', 'Deleted');
  await up('proj1.gallery', 'photo-1600x1200.webp', 'Después', 'After');
  await up('proj2.card', 'wide-1600x900.jpg', 'Bodega', 'Warehouse');
  assert.equal((await c.del(`/api/media/item/${removed.id}`)).status, 200);

  const r = php([join(ROOT, 'tools/export-photos.php'), bundle, `--cms=${join(ROOT, 'cms')}`], src);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Exported 5 item\(s\) in 4 slot\(s\)/);
  assert.deepEqual(readdirSync(bundle).sort(), ['importar-fotos.php', 'manifest.json', 'uploads'], 'nothing else leaves (no database, settings or keys)');
  const m = JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8'));
  assert.equal(m.format, 1);
  const gallery = m.items.filter((i) => i.slot === 'proj1.gallery');
  assert.deepEqual(gallery.map((i) => [i.position, i.alt_es, i.alt_en]), [[0, 'Antes', 'Before'], [1, 'Después', 'After']], 'order and descriptions, without the deleted photo');
  const files = m.items.flatMap((i) => Object.keys(i.files));
  assert.deepEqual(readdirSync(join(bundle, 'uploads')).sort(), [...files].sort(), 'every width of every photo, nothing more');
  assert.ok(files.every((f) => /^[a-z0-9-]+-w[0-9]+\.(webp|jpg)$/.test(f)));
  assert.match(readFileSync(join(bundle, 'importar-fotos.php'), 'utf8'), /Imports the photos exported by tools\/export-photos\.php/);
  const again = php([join(ROOT, 'tools/export-photos.php'), bundle, `--cms=${join(ROOT, 'cms')}`], src);
  assert.equal(again.code, 1, 'never writes into a folder that already has files');
});

test('import fills only the empty slots, byte-identical, and publishes the site', async () => {
  const c = new Client(dst.base);
  await c.login();
  const own = await c.upload('/api/media/proj2.card/upload', { altEs: 'Foto subida en producción', altEn: '' }, { file: 'photo-1600x1200.webp' });
  assert.equal(own.status, 200);

  const dry = importer(dst, '--dry-run');
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, /\+ proj1\.gallery\s+2/);
  assert.match(dry.out, /= proj2\.card\s+ya tiene 1/);
  assert.match(dry.out, /Simulación \(--dry-run\): se importarían 4\. No se cambió nada\./);
  assert.equal(rows(dst).length, 1, 'the simulation writes nothing');

  const r = importer(dst);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Listo: 4 fotos importadas y el sitio publicado\./);
  const got = rows(dst);
  // Same order; positions are renumbered without the gap the deleted photo left.
  const seen = {};
  const want = rows(src).filter((x) => x.slot !== 'proj2.card').map((x) => ({ ...x, position: (seen[x.slot] = (seen[x.slot] ?? -1) + 1) }));
  assert.deepEqual(got.filter((x) => x.slot !== 'proj2.card'), want, 'same slots, order, file names, widths and descriptions');
  const kept = got.filter((x) => x.slot === 'proj2.card');
  assert.equal(kept.length, 1);
  assert.equal(kept[0].es, 'Foto subida en producción', 'a photo already uploaded in the panel is never replaced');
  for (const item of want) {
    for (const w of JSON.parse(item.variants)) {
      const name = `assets/uploads/${item.base}-w${w}.webp`;
      assert.deepEqual(readFileSync(dst.public(name)), readFileSync(src.public(name)), name);
    }
  }
  const home = dst.readPublic('index.html');
  const card = want.find((x) => x.slot === 'proj1.card');
  assert.ok(home.includes(`assets/uploads/${card.base}-w`), 'the published home page shows the imported photos');
  assert.ok(home.includes('Remodelación de cocina'));
  assert.equal((await fetch(`${dst.base}/assets/uploads/${card.base}-w800.webp`)).status, 200);
  assert.ok(dst.sql("SELECT COUNT(*) FROM activity_log WHERE action = 'media_imported_cli'") === '1');

  const again = importer(dst);
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /No hay nada que importar/);
  assert.equal(rows(dst).length, got.length, 'running it twice adds nothing');
});

test('a damaged or altered bundle changes nothing', async () => {
  const uploads = () => (existsSync(other.public('assets/uploads')) ? readdirSync(other.public('assets/uploads')) : []).filter((f) => f !== '.htaccess');
  const before = uploads().length;
  const copy = (name, edit) => {
    const dir = join(work, name);
    cpSync(bundle, dir, { recursive: true });
    edit(dir);
    return (...args) => php([join(dir, 'importar-fotos.php'), `--cms=${join(ROOT, 'cms')}`, ...args], other);
  };

  const damaged = copy('damaged', (dir) => {
    const f = readdirSync(join(dir, 'uploads')).sort().at(-1);
    writeFileSync(join(dir, 'uploads', f), Buffer.concat([readFileSync(join(dir, 'uploads', f)), Buffer.from('x')]));
  });
  let r = damaged();
  assert.equal(r.code, 1);
  assert.match(r.out, /falta o está dañado[\s\S]*No se cambió nada/);

  const traversal = copy('traversal', (dir) => {
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    m.items[0].file_base = '../../../cms/evil';
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m));
  });
  r = traversal();
  assert.equal(r.code, 1);
  assert.match(r.out, /nombre de archivo inválido/);

  const unknownSlot = copy('unknown-slot', (dir) => {
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    m.items[0].slot = 'proj9.card';
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m));
  });
  r = unknownSlot();
  assert.equal(r.code, 1);
  assert.match(r.out, /el espacio «proj9\.card» no existe/);

  r = damaged('--borrar-todo');
  assert.equal(r.code, 1);
  assert.match(r.out, /opción desconocida/);

  assert.equal(rows(other).length, 0, 'no photo was added');
  assert.equal(uploads().length, before, 'no file was copied');
});
