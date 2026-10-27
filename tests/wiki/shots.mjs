// Screenshots for the wiki (cms/wiki/img): every screen in Spanish and English,
// light and dark, computer and phone, from a throwaway server with fictitious
// people and data (nothing real, nothing from production).
//
//   npm --prefix tests run wiki:shots            all of them
//   npm --prefix tests run wiki:shots -- '^esta' only names matching a pattern
// Run `-- '^wiki$'` once more after a full run: the wiki's own page shows the
// other screenshots in its «Novedades».
//
// Needs Mailpit (127.0.0.1:8025) and `cwebp` (brew install webp). The site's
// real photos are used when dist/fotos-sitio-20261016 is present.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, createAdmin, PHP, ROOT } from '../integration/helpers.mjs';

const ONLY = process.argv[2] ? new RegExp(process.argv[2]) : null;
const OUT = join(ROOT, 'cms/wiki/img');
const TMP = join(ROOT, 'tests/wiki/.tmp');
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const PW = 'Wiki-Demo-Sensum-2026!';
const OWNER = { name: 'Soporte IT', email: 'soporte.it@example.com' };
const P = {
  admin: { name: 'Andrea Morales', email: 'andrea.morales@example.com', perms: 'texts,contact,photos,documents,site,leads,stats,monitor,report,users' },
  editor: { name: 'Luis Herrera', email: 'luis.herrera@example.com', perms: 'texts,contact,photos,documents' },
  sales: { name: 'Jorge Estrada', email: 'jorge.estrada@example.com', perms: 'leads,stats' },
  viewer: { name: 'Gabriela Ortiz', email: 'gabriela.ortiz@example.com', perms: 'stats,monitor,report' },
  support: { name: 'Kevin Álvarez', email: 'kevin.alvarez@example.com', perms: 'stats,monitor,report,support' },
  extra: { name: 'Paola Méndez', email: 'paola.mendez@example.com', perms: 'texts,contact,photos,documents,leads' },
  newbie: { name: 'Mariana López', email: 'mariana.lopez@example.com', perms: 'texts,contact,photos,documents' },
};

// ------------------------------------------------------------------ the demo installation
const s = await startServer({ port: 8470, env: { OWNER_EMAIL: OWNER.email } });
createAdmin(s, { ...OWNER, password: PW });
for (const p of Object.values(P)) createAdmin(s, { ...p, password: PW });
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
for (const p of Object.values(P)) s.sql(`UPDATE users SET role='editor', permissions=${q(p.perms)} WHERE email=${q(p.email)}`);
const id = (k) => s.sql(`SELECT id FROM users WHERE email=${q((P[k] || OWNER).email)}`);
const now = Math.floor(Date.now() / 1000);
const H = 3600, D = 86400;
const photos = join(ROOT, 'dist/fotos-sitio-20261016/importar-fotos.php');
if (existsSync(photos)) console.log(execFileSync(PHP, [photos, `--cms=${join(ROOT, 'cms')}`], { cwd: ROOT, env: s.env }).toString().trim().split('\n').pop());

const leads = [
  ['Lucía Méndez', 'lucia.mendez@example.com', '5555-1234', 'Remodelaciones', 'Quisiera una cotización para remodelar la cocina y dos baños de mi casa en zona 15. ¿Pueden hacer una visita la próxima semana?', 'es', 'new', 'NULL', now - 2 * H, 'sales'],
  ['Roberto Pineda', 'roberto.pineda@example.com', '4410-2233', 'Obra civil', 'Necesitamos fundición de losa para una bodega de 400 m² en Mixco.', 'es', 'contacted', 'NULL', now - 3 * D, 'sales'],
  ['Ana Lucía Barrios', 'ana.barrios@example.com', '3021-8877', 'Diseño arquitectónico', 'Busco planos y anteproyecto para una casa de dos niveles en Antigua.', 'es', 'quoted', 85000, now - 6 * D, 'sales'],
  ['Constructora Atitlán, S.A.', 'compras@example.com', '2222-3333', 'Impermeabilización y tratamientos técnicos', 'Impermeabilización de 1,200 m² de techo en un centro comercial.', 'es', 'won', 185000, now - 12 * D, 'admin'],
  ['Robert Smith', 'robert.smith@example.com', '+1 305 555 0100', 'Diseño arquitectónico', 'We are planning a small office building in Guatemala City and need architectural design.', 'en', 'contacted', 'NULL', now - 9 * D, 'admin'],
  ['Carmen Juárez', 'carmen.juarez@example.com', '5987-6543', 'Mantenimiento preventivo', 'Mantenimiento preventivo para las oficinas de nuestra empresa (3 niveles).', 'es', 'lost', 'NULL', now - 20 * D, null],
];
s.sql(`INSERT INTO leads (name, email, phone, service, message, lang, status, amount, notified, unread, created_at, updated_at, contacted_at, assigned_to) VALUES ${leads.map((l) => `(${q(l[0])}, ${q(l[1])}, ${q(l[2])}, ${q(l[3])}, ${q(l[4])}, ${q(l[5])}, ${q(l[6])}, ${l[7]}, 1, ${l[6] === 'new' ? 1 : 0}, ${l[8]}, ${l[8] + H}, ${l[6] === 'new' ? 'NULL' : l[8] + 2 * H}, ${l[9] ? id(l[9]) : 'NULL'})`).join(', ')}`);
s.sql(`INSERT INTO lead_notes (lead_id, user_id, author, kind, body, details, created_at) VALUES
  (2, ${id('sales')}, ${q(P.sales.name)}, 'event', '', '{"action":"status","from":"new","to":"contacted"}', ${now - 3 * D + 2 * H}),
  (2, ${id('sales')}, ${q(P.sales.name)}, 'note', 'Llamé el martes: visita a la bodega el jueves a las 10:00.', '{}', ${now - 3 * D + 3 * H}),
  (3, ${id('sales')}, ${q(P.sales.name)}, 'event', '', '{"action":"status","from":"contacted","to":"quoted"}', ${now - 4 * D}),
  (3, ${id('sales')}, ${q(P.sales.name)}, 'note', 'Se envió la propuesta por correo. Dar seguimiento el lunes.', '{}', ${now - 4 * D + 60})`);

const ctx = q('{"browser":"Safari 17","os":"iOS 17","device":"mobile","viewport":"390x844"}');
s.sql(`INSERT INTO support_reports (user_id, reporter_name, reporter_email, type, title, description, area, page, context, fingerprint, email_status, email_attempts, created_at, updated_at, status, priority, owner_unread, reporter_unread, first_response_at, resolved_at, rating, rating_comment, rated_at) VALUES
  (${id('editor')}, ${q(P.editor.name)}, ${q(P.editor.email)}, 'problem', 'La galería de un proyecto no abría en el celular', 'Al tocar «Ver detalles» en Obra gris y cimentación no pasaba nada.', 'website', '/#proyectos', ${ctx}, 'wiki-1', 'sent', 1, ${now - 5 * D}, ${now - 4 * D}, 'resolved', 'high', 0, 0, ${now - 5 * D + 40 * 60}, ${now - 4 * D}, 5, 'Rápido y bien explicado. ¡Gracias!', ${now - 4 * D + H}),
  (${id('sales')}, ${q(P.sales.name)}, ${q(P.sales.email)}, 'improvement', 'Agregar la pregunta «¿En qué municipio es el proyecto?»', 'Nos ayudaría a planificar las visitas.', 'website', '/admin/#/prospectos', '{}', 'wiki-2', 'sent', 1, ${now - 26 * H}, ${now - 20 * H}, 'in_progress', 'normal', 0, 1, ${now - 20 * H}, NULL, NULL, NULL, NULL),
  (${id('extra')}, ${q(P.extra.name)}, ${q(P.extra.email)}, 'other', 'Pregunta: Fotos y portafolio en PDF', 'Sobre «Usa fotos reales, nítidas, bien iluminadas»: ¿podemos usar renders de proyectos en curso?', 'admin', '/admin/#/wiki/fotos-y-portafolio', '{}', 'wiki-3', 'sent', 1, ${now - 3 * H}, ${now - 3 * H}, 'new', 'normal', 1, 0, NULL, NULL, NULL, NULL, NULL)`);
s.sql(`INSERT INTO report_messages (report_id, user_id, author_name, author_role, kind, body, details, email_status, created_at) VALUES
  (1, ${id('owner')}, ${q(OWNER.name)}, 'support', 'message', 'Gracias, Luis. Ya lo estamos revisando en un iPhone igual al tuyo.', '{}', 'sent', ${now - 5 * D + 41 * 60}),
  (1, ${id('owner')}, ${q(OWNER.name)}, 'support', 'message', 'Listo: la galería ya abre en todos los celulares.', '{}', 'sent', ${now - 4 * D + 60}),
  (2, ${id('owner')}, ${q(OWNER.name)}, 'support', 'message', 'Buena idea, Jorge. La agregamos hoy en Formulario de contacto.', '{}', 'sent', ${now - 20 * H + 60})`);

const days = [];
for (let i = 0; i < 90; i++) {
  const d = new Date((now - i * D) * 1000); const day = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const v = 38 + ((i * 7) % 29) + (i < 10 ? 12 : 0);
  days.push(`('${day}', 'visitor', '', ${v})`, `('${day}', 'view', 'home', ${v * 2 + 5})`, `('${day}', 'source', 'google', ${Math.round(v * 0.52)})`, `('${day}', 'source', 'direct', ${Math.round(v * 0.24)})`,
    `('${day}', 'source', 'facebook', ${Math.round(v * 0.14)})`, `('${day}', 'source', 'instagram', ${Math.round(v * 0.1)})`, `('${day}', 'device', 'mobile', ${Math.round(v * 0.68)})`, `('${day}', 'device', 'desktop', ${Math.round(v * 0.32)})`,
    `('${day}', 'lang', 'es', ${v - 3})`, `('${day}', 'lang', 'en', 3)`, `('${day}', 'click', 'whatsapp', ${2 + (i % 4)})`, `('${day}', 'click', 'phone', ${i % 3})`, `('${day}', 'click', 'email', ${i % 2})`, `('${day}', 'click', 'portfolio', ${i % 3})`);
}
s.sql(`INSERT INTO analytics_daily (day, metric, dim, count) VALUES ${days.join(', ')}`);
const runs = [];
for (let i = 0; i < 30 * 48; i++) {
  const ts = now - i * 1800; const failed = i === 300;
  runs.push(`(${ts}, ${failed ? 0 : 1}, '${failed ? 'database' : ''}', ${failed ? 'NULL' : 140 + ((i * 37) % 120)}, ${failed ? 'NULL' : 200})`);
}
s.sql(`INSERT INTO monitor_runs (created_at, ok, failed, response_ms, http_status) VALUES ${runs.join(', ')}`);
s.sql(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('monitor_last_run', '${now - 600}', ${now})`);
s.sql(`INSERT INTO access_requests (user_id, permissions, message, created_at) VALUES (${id('editor')}, 'leads,stats', 'Para dar seguimiento a los mensajes de la campaña de remodelaciones.', ${now - 2 * H})`);
s.sql(`UPDATE users SET onboarded_at = ${now}, last_login_at = ${now - D}, theme = 'system'`);
s.cli(['publish']);

// ------------------------------------------------------------------ capture
const browser = await chromium.launch({ channel: 'chrome' }); // the installed Chrome, like the browser tests
const done = []; const failed = [];
const LANGS = ['es', 'en']; const THEMES = ['light', 'dark']; const DEVICES = ['desktop', 'mobile'];
const L = (lang, es, en) => (lang === 'en' ? en : es);

async function context(lang, theme, device) {
  const c = await browser.newContext({
    ...(device === 'mobile' ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }),
    colorScheme: theme, locale: lang === 'en' ? 'en-US' : 'es-GT', timezoneId: 'America/Guatemala', reducedMotion: 'reduce',
  });
  await c.addInitScript(([lang, theme]) => {
    try {
      localStorage.setItem('sensum_admin_lang', lang);
      localStorage.setItem('sensum_admin_theme', theme);
      for (let i = 1; i < 40; i++) localStorage.setItem('sensum_admin_intro_done_' + i, '1');
      sessionStorage.setItem('sensum_news_later', '1'); // the «Novedades» dialog would cover the screens
    } catch (e) { /* ignore */ }
  }, [lang, theme]);
  return c;
}
async function settle(page, ms = 600) { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(ms); }
async function signIn(c, who) {
  s.sql('DELETE FROM rate_limits');
  const page = await c.newPage();
  await page.goto(s.base + '/admin/#/ingresar');
  await page.locator('input[type=email]').fill((P[who] || OWNER).email);
  await page.locator('input[type=password]').fill(PW);
  await page.locator('form button[type=submit]').click();
  await page.locator('.topbar').waitFor();
  await settle(page);
  return page;
}
async function go(page, hash, ms = 700) {
  await page.goto(s.base + '/admin/#/' + hash);
  await page.locator('main h1').first().waitFor();
  await settle(page, ms);
}
async function shot(page, name, variant) {
  if (ONLY && !ONLY.test(name)) return;
  const png = join(TMP, `${name}.${variant}.png`);
  await page.screenshot({ path: png });
  const [, , device] = variant.split('.');
  execFileSync('cwebp', ['-quiet', '-q', device === 'mobile' ? '70' : '76', ...(device === 'mobile' ? ['-resize', '585', '0'] : []), png, '-o', join(OUT, `${name}.${variant}.webp`)]);
  done.push(`${name}.${variant}`);
}
const want = (...names) => !ONLY || names.some((n) => ONLY.test(n));
async function step(name, variant, fn) {
  if (ONLY && !ONLY.test(name)) return;
  try { await fn(); } catch (e) { failed.push(`${name}.${variant}: ${String(e.message).split('\n')[0]}`); }
}

for (const lang of LANGS) {
  s.sql(`UPDATE users SET lang = '${lang}'`);
  for (const theme of THEMES) {
    for (const device of DEVICES) {
      const v = `${lang}.${theme}.${device}`;
      console.log('…', v);
      // Not signed in.
      if (want('login', 'codigo-correo')) {
        const c = await context(lang, theme, device);
        const page = await c.newPage();
        await step('login', v, async () => { await page.goto(s.base + '/admin/#/ingresar'); await page.locator('input[type=email]').waitFor(); await settle(page); await shot(page, 'login', v); });
        await step('codigo-correo', v, async () => {
          s.sql(`UPDATE users SET two_factor_reenroll_at = ${now} WHERE email = ${q(P.newbie.email)}`);
          s.sql('DELETE FROM rate_limits');
          await page.goto(s.base + '/admin/#/ingresar');
          await page.locator('input[type=email]').fill(P.newbie.email);
          await page.locator('input[type=password]').fill(PW);
          await page.locator('form button[type=submit]').click();
          await page.locator('#login-code').waitFor();
          await settle(page, 400);
          await shot(page, 'codigo-correo', v);
        });
        await c.close();
      }
      // Andrea, administrator.
      if (want('inicio', 'usuarios', 'invitar', 'actividad', 'wiki', 'soporte')) {
        const c = await context(lang, theme, device);
        const page = await signIn(c, 'admin');
        await step('inicio', v, async () => { await go(page, '', 1000); await shot(page, 'inicio', v); });
        await step('usuarios', v, async () => { await go(page, 'usuarios', 900); await shot(page, 'usuarios', v); });
        await step('invitar', v, async () => {
          await page.locator('.page-head .btn-primary').first().click();
          const dlg = page.getByRole('dialog');
          await dlg.locator('input').first().fill('Mariela Rodas');
          await dlg.locator('input[type=email]').fill('mariela.rodas@example.com');
          await dlg.locator('fieldset').first().scrollIntoViewIfNeeded();
          await page.waitForTimeout(400);
          await shot(page, 'invitar', v);
          await page.keyboard.press('Escape');
        });
        await step('actividad', v, async () => { await go(page, 'actividad', 900); await shot(page, 'actividad', v); });
        await step('wiki', v, async () => { await go(page, 'wiki', 1200); await shot(page, 'wiki', v); });
        await step('soporte', v, async () => {
          await go(page, '', 600);
          await page.locator(device === 'mobile' ? '.topbar .report-btn' : '.topbar .report-btn').click();
          const dlg = page.getByRole('dialog');
          await dlg.locator('input[type=text], input:not([type])').first().fill(L(lang, 'El botón de WhatsApp no abre en el celular', "The WhatsApp button doesn't open on my phone"));
          await page.waitForTimeout(400);
          await shot(page, 'soporte', v);
          await page.keyboard.press('Escape');
        });
        await c.close();
      }
      // Luis, website editor.
      if (want('textos', 'textos-editor', 'fotos', 'datos-de-contacto', 'formulario', 'mi-cuenta', 'dos-pasos')) {
        const c = await context(lang, theme, device);
        const page = await signIn(c, 'editor');
        await step('textos', v, async () => { await go(page, 'textos', 900); await shot(page, 'textos', v); });
        await step('textos-editor', v, async () => {
          await page.locator('a.section-card').nth(1).click();
          await page.locator('main h1').waitFor();
          await settle(page, 900);
          await shot(page, 'textos-editor', v);
        });
        await step('fotos', v, async () => { await go(page, 'fotos/nosotros', 1600); await shot(page, 'fotos', v); });
        await step('datos-de-contacto', v, async () => { await go(page, 'contacto', 900); await shot(page, 'datos-de-contacto', v); });
        await step('formulario', v, async () => { await go(page, 'formulario', 1200); await shot(page, 'formulario', v); });
        await step('mi-cuenta', v, async () => { await go(page, 'cuenta', 900); await shot(page, 'mi-cuenta', v); });
        await step('dos-pasos', v, async () => {
          await go(page, 'cuenta', 600);
          await page.locator('#tf-t').locator('xpath=ancestor::section').locator('.btn-primary, .btn').first().click();
          const dlg = page.getByRole('dialog');
          await dlg.locator('input[type=password]').fill(PW);
          await dlg.locator('button[type=submit]').click();
          await dlg.locator('img.qr').waitFor();
          await page.waitForTimeout(500);
          await shot(page, 'dos-pasos', v);
          await page.keyboard.press('Escape');
        });
        await c.close();
      }
      // Jorge, sales and leads.
      if (want('prospectos', 'prospecto', 'estadisticas', 'estadisticas-correo', 'mas-secciones', 'pedir-acceso')) {
        const c = await context(lang, theme, device);
        const page = await signIn(c, 'sales');
        await step('prospectos', v, async () => { await go(page, 'prospectos', 900); await shot(page, 'prospectos', v); });
        await step('prospecto', v, async () => { await go(page, 'prospectos/2', 900); await shot(page, 'prospecto', v); });
        await step('estadisticas', v, async () => { await go(page, 'estadisticas', 1500); await shot(page, 'estadisticas', v); });
        await step('estadisticas-correo', v, async () => {
          await page.locator('.stats-actions .btn-primary').click();
          const dlg = page.getByRole('dialog');
          await dlg.locator('input').first().fill('gerencia@example.com, andrea.morales@example.com');
          await page.waitForTimeout(400);
          await shot(page, 'estadisticas-correo', v);
          await page.keyboard.press('Escape');
        });
        await step('mas-secciones', v, async () => { await go(page, 'secciones', 900); await shot(page, 'mas-secciones', v); });
        await step('pedir-acceso', v, async () => {
          await page.locator('.section-tile .btn').nth(1).click();
          await page.getByRole('dialog').waitFor();
          await page.waitForTimeout(400);
          await shot(page, 'pedir-acceso', v);
          await page.keyboard.press('Escape');
        });
        await c.close();
      }
      // Gabriela, view only.
      if (want('salud', 'informe')) {
        const c = await context(lang, theme, device);
        const page = await signIn(c, 'viewer');
        await step('salud', v, async () => { await go(page, 'salud-del-sitio', 1500); await shot(page, 'salud', v); });
        await step('informe', v, async () => { await go(page, 'informe', 1800); await shot(page, 'informe', v); });
        await c.close();
      }
      // Kevin, support requests.
      if (want('centro-de-ayuda')) {
        const c = await context(lang, theme, device);
        const page = await signIn(c, 'support');
        await step('centro-de-ayuda', v, async () => { await go(page, 'reportes', 1500); await shot(page, 'centro-de-ayuda', v); });
        await c.close();
      }
      // The owner account.
      if (want('seguridad', 'monitoreo')) {
        const c = await context(lang, theme, device);
        const page = await signIn(c, 'owner');
        await step('seguridad', v, async () => { await go(page, 'seguridad', 1200); await shot(page, 'seguridad', v); });
        await step('monitoreo', v, async () => { await go(page, 'monitoreo', 1800); await shot(page, 'monitoreo', v); });
        await c.close();
      }
    }
  }
}

await browser.close();
await s.stop();
rmSync(TMP, { recursive: true, force: true });
console.log(`${done.length} screenshots in cms/wiki/img`);
if (failed.length) { console.log('FAILED:\n' + failed.join('\n')); process.exitCode = 1; }
