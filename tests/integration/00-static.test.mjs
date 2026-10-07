// Fast checks that need no server: translations, defaults, templates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, PHP } from './helpers.mjs';

const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? flat(v, p + k + '.') : [[p + k, Array.isArray(v) ? `array:${v.length}` : typeof v]]));

test('admin translations: Spanish and English have exactly the same keys', async () => {
  const es = (await import(join(ROOT, 'admin/js/i18n/es.js'))).default;
  const en = (await import(join(ROOT, 'admin/js/i18n/en.js'))).default;
  assert.deepEqual(new Map(flat(en)), new Map(flat(es)));
});

test('every editable field has an admin label in both languages', async () => {
  const schema = JSON.parse(execFileSync(PHP, ['-r', `echo json_encode(require '${join(ROOT, 'cms/content/schema.php')}');`]).toString());
  for (const lang of ['es', 'en']) {
    const fields = (await import(join(ROOT, `admin/js/i18n/${lang}.js`))).default.fields;
    for (const f of schema.sections.flatMap((x) => x.fields)) {
      assert.ok(fields[f.key] || fields[f.key.replace(/\d+/, '#')], `${lang}: no label for ${f.key}`);
    }
    for (const sec of schema.sections) assert.ok((await import(join(ROOT, `admin/js/i18n/${lang}.js`))).default.sections[sec.id], `${lang}: section ${sec.id}`);
  }
});

test('editable defaults are identical to the approved copy in assets/main.js', () => {
  const src = readFileSync(join(ROOT, 'assets/main.js'), 'utf8');
  const I18N = Function(`return ${src.match(/var I18N = (\{[\s\S]*?\n  \});/)[1]}`)();
  const defaults = JSON.parse(execFileSync(PHP, ['-r', `echo json_encode(require '${join(ROOT, 'cms/content/defaults.php')}');`]).toString());
  for (const lang of ['es', 'en']) {
    for (const [key, value] of Object.entries(defaults[lang])) {
      assert.equal(value.replace(/\*(.*?)\*/g, '<em>$1</em>'), I18N[lang][key], `${lang} ${key}`);
    }
  }
});

test('templates contain no leftover hard-coded contact details', () => {
  for (const tpl of ['index.html.tpl', '404.html.tpl', 'privacy-notice.html.tpl']) {
    const t = readFileSync(join(ROOT, 'cms/templates', tpl), 'utf8');
    assert.doesNotMatch(t, /2256|3481|contacto@|sensumconstruccionesgt|13 Calle|wa\.me\/5/, tpl);
  }
});

test('the dev router serves the same CSP as the production .htaccess', () => {
  const root = readFileSync(join(ROOT, '.htaccess'), 'utf8').match(/Header always set Content-Security-Policy "(.*)"/)[1];
  assert.match(root, /script-src 'self';/);
  assert.doesNotMatch(root, /unsafe-inline|unsafe-eval/);
  const admin = readFileSync(join(ROOT, 'admin/.htaccess'), 'utf8').match(/Header always set Content-Security-Policy "(.*)"/)[1];
  assert.doesNotMatch(admin, /unsafe-inline|unsafe-eval|https:/);
});
