// Prints dist/documentacion-tecnica/*.html to PDF with the installed Chrome (run tools/docs-pdf/build.py first).
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { chromium } = await import(join(ROOT, 'tests/node_modules/@playwright/test/index.mjs'));
const DIR = join(ROOT, 'dist/documentacion-tecnica');
const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage();
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.html')).sort()) {
  await page.goto('file://' + join(DIR, f));
  const title = f.replace(/\.html$/, '');
  await page.pdf({ path: join(DIR, title + '.pdf'), format: 'Letter', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: `<div style="width:100%;font-family:Arial,sans-serif;font-size:7.5px;color:#5a6b7d;padding:0 15mm;display:flex;justify-content:space-between"><span>${title.slice(3)} · Sensum Construcciones</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    margin: { top: '16mm', bottom: '18mm', left: '15mm', right: '15mm' } });
  console.log('ok', title + '.pdf');
}
await b.close();
