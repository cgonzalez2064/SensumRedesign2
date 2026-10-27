// «Más secciones» (what else the panel has, ready to ask for: from the menu,
// Inicio, Mi cuenta and a screen you can't open), Estadísticas (period
// filters, the spreadsheet and the report by e-mail) and removing your own
// registered devices from Mi cuenta.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { Client, waitForMail, message, countTo, totp, emailedCode, unique } from '../integration/helpers.mjs';
import { OTHER_ADMIN } from './global-setup.mjs';

// People made here are invited by the test administrator (the owner's invitations are left for other
// specs) and get their password from them, so no invitation link is used: the server allows 30 a
// quarter-hour per address and the other specs need them.
const BASE = 'http://127.0.0.1:8210';
const tag = (info) => ({ 'desktop-chrome': 'Escritorio', 'tablet-chrome': 'Tableta', 'iphone-webkit': 'Celular' }[info.project.name] || info.project.name);

async function signIn(page, user) {
  await page.goto('/admin/#/ingresar');
  await page.getByLabel(/Correo electrónico|^Email$/).fill(user.email);
  await page.getByLabel(/^Contraseña$|^Password$/).fill(user.password);
  await page.getByRole('button', { name: /Iniciar sesión|Sign in/ }).click();
}
async function home(page) {
  await expect(page.locator('main h1')).toHaveText(/^(Te damos la bienvenida|Hola), /);
  if (await page.getByRole('button', { name: 'Guardar y continuar' }).isVisible()) await page.getByRole('button', { name: 'Guardar y continuar' }).click();
  await expect(page.locator('main h1')).toHaveText(/^Hola, /);
}
async function axe(page) {
  const v = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.filter((x) => ['serious', 'critical'].includes(x.impact));
  expect(v.map((x) => `${x.id}: ${x.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
}
const noSideScroll = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

async function account(info, name, permissions) {
  const admin = new Client(BASE);
  await admin.login(OTHER_ADMIN.email, OTHER_ADMIN.password);
  const email = `${name.split(' ')[0].toLowerCase()}.${info.project.name}.${Date.now()}@example.test`;
  const r = await admin.post('/api/users', { name, email, permissions, lang: 'es' });
  expect(r.status, r.text).toBe(200);
  const password = 'Clave-Secciones-2026';
  const set = await admin.post(`/api/users/${r.data.user.id}/password`, { password, mustChange: false, currentPassword: OTHER_ADMIN.password });
  expect(set.status, set.text).toBe(200);
  const c = new Client(BASE);
  expect((await c.login(email, password)).status).toBe(200);
  return { id: r.data.user.id, email, password, name, c };
}
/** «Ventas y prospectos», one per device for the first two tests. */
const sales = new Map();
const salesAccount = async (info) => {
  if (!sales.has(info.project.name)) sales.set(info.project.name, await account(info, `Sara ${tag(info)}`, ['leads', 'stats']));
  return sales.get(info.project.name);
};

test('«Más secciones»: from the menu and Inicio, ask for a section with one click; Mi cuenta and a closed screen lead there too', async ({ page }, info) => {
  const p = await salesAccount(info);
  await signIn(page, p);
  await home(page);
  // Inicio: a quiet card next to the shortcuts.
  await expect(page.locator('.quick a.quick-more')).toContainText('Más secciones');
  // The menu: the link after the sections this person has.
  if (await page.locator('.open-nav').isVisible()) await page.locator('.open-nav').click();
  const link = page.locator('.nav a.nav-more');
  await expect(link).toHaveText('Más secciones');
  await link.click();
  await expect(page.locator('main h1')).toHaveText('Secciones del panel');
  const tiles = page.locator('.section-tile');
  const tile = (name) => tiles.filter({ has: page.getByRole('heading', { name, exact: true }) });
  await expect(page.getByRole('heading', { name: 'Puedes pedir' })).toBeVisible();
  await expect(tiles).toHaveCount(7);
  for (const name of ['Gestión de usuarios', 'Gestión de solicitudes de soporte']) await expect(tile(name)).toHaveCount(0); // the owner gives them
  await expect(page.getByRole('heading', { name: 'Ya tienes acceso' })).toBeVisible();
  await expect(page.locator('nav.quick a')).toHaveText([/^Prospectos/, /^Estadísticas de visitas/]);
  await axe(page);
  await noSideScroll(page);

  // One click: the request with that section ticked (others can be added).
  await tile('Fotos').getByRole('button', { name: 'Pedir acceso a Fotos' }).click();
  const dlg = page.getByRole('dialog', { name: 'Pedir acceso' });
  await expect(dlg.getByRole('checkbox', { name: /^Fotos/ })).toBeChecked();
  await expect(dlg.getByRole('checkbox', { name: /^Textos del sitio/ })).not.toBeChecked();
  await dlg.getByRole('checkbox', { name: /^Portafolio en PDF/ }).check();
  await dlg.getByRole('button', { name: 'Enviar solicitud' }).click();
  await expect(page.getByText('Solicitud enviada. Te avisaremos por correo cuando la revisen.')).toBeVisible();
  await expect(tile('Fotos').getByText('Solicitado')).toBeVisible();
  await expect(tile('Portafolio en PDF').getByText('Solicitado')).toBeVisible();
  await expect(tile('Textos del sitio').getByRole('button', { name: 'Pedir acceso a Textos del sitio' })).toBeVisible();
  await expect(page.getByText(/Pediste Fotos · Portafolio en PDF el .+\. Está pendiente\./)).toBeVisible();
  await axe(page);

  // Mi cuenta → «Ver todas las secciones».
  await page.goto('/admin/#/cuenta');
  await page.getByRole('link', { name: 'Ver todas las secciones' }).click();
  await expect(page.locator('main h1')).toHaveText('Secciones del panel');
  // A screen they can't open: ask for it there, or see everything.
  await page.goto('/admin/#/textos');
  await expect(page.locator('main h1')).toHaveText('No tienes acceso a esta sección');
  await expect(page.getByRole('button', { name: 'Pedir acceso' })).toBeVisible();
  await page.getByRole('link', { name: 'Ver todas las secciones' }).click();
  await expect(page.locator('main h1')).toHaveText('Secciones del panel');
});

test('Estadísticas: period filters, the spreadsheet and the report by e-mail', async ({ page }, info) => {
  const p = await salesAccount(info);
  await signIn(page, p);
  await home(page);
  await page.goto('/admin/#/estadisticas');
  await expect(page.locator('main h1')).toHaveText('Estadísticas');
  const period = page.locator('#st-period');
  await expect(period).toHaveValue('30d');
  const range = page.locator('.stats-range');
  await expect(range).toContainText('comparado con');
  const first = await range.textContent();
  await period.selectOption('7d');
  await expect(range).not.toHaveText(first);
  // Chosen dates: checked before asking the server.
  await period.selectOption('custom');
  const custom = page.locator('.stats-custom');
  await expect(custom).toBeVisible();
  const iso = (n) => { const d = new Date(Date.now() + n * 86400000); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
  await page.getByLabel('Desde').fill(iso(-3));
  await page.getByLabel('Hasta').fill(iso(-10));
  await custom.getByRole('button', { name: 'Ver' }).click();
  await expect(custom.getByText('La fecha «Hasta» debe ser igual o posterior a «Desde».')).toBeVisible();
  await page.getByLabel('Hasta').fill(iso(-1));
  await custom.getByRole('button', { name: 'Ver' }).click();
  await expect(custom.locator('.alert')).toHaveCount(0);
  await expect(period).toHaveValue('custom');
  await axe(page);
  await noSideScroll(page);

  // Exportar → the spreadsheet of what is on screen.
  await page.getByRole('button', { name: 'Exportar' }).click();
  await expect(page.getByRole('button', { name: /Imprimir o guardar como PDF/ })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Hoja de cálculo \(CSV\)/ }).click()]);
  expect(download.suggestedFilename()).toBe(`estadisticas-sensum-${iso(-3)}-a-${iso(-1)}.csv`);
  const csv = readFileSync(await download.path(), 'utf8');
  for (const part of ['Estadísticas del sitio web', 'Resumen', 'Visitas por día', 'Del mensaje al proyecto']) expect(csv).toContain(part);

  // «Enviar por correo»: the same period, chosen parts, a message and a copy for me.
  await page.getByRole('button', { name: 'Enviar por correo' }).click();
  const dlg = page.getByRole('dialog', { name: 'Enviar reporte por correo' });
  await expect(dlg.locator('.share-period')).toContainText('comparado con');
  await axe(page);
  await dlg.getByLabel('Enviarme una copia').uncheck();
  await dlg.getByRole('button', { name: 'Enviar reporte' }).click();
  await expect(dlg.getByText('Este campo es obligatorio.')).toBeVisible();
  const to = unique('reporte-e2e');
  await dlg.getByLabel('Para').fill(to);
  await dlg.getByLabel('Dispositivos').uncheck();
  await dlg.getByLabel(/^Mensaje/).fill('Resumen para la junta.');
  await dlg.getByLabel('Enviarme una copia').check();
  const mine = await countTo(p.email);
  await dlg.getByRole('button', { name: 'Enviar reporte' }).click();
  await expect(page.getByText('Reporte enviado a 2 personas.')).toBeVisible();
  const m = await message((await waitForMail(to, 1))[0].ID);
  expect(m.Subject).toMatch(/^Estadísticas del sitio · /);
  expect(m.Text).toContain('Resumen para la junta.');
  expect(m.Text).not.toContain('Dispositivos');
  expect(m.Attachments.map((a) => a.FileName)).toEqual([`estadisticas-sensum-${iso(-3)}-a-${iso(-1)}.csv`]);
  expect((await waitForMail(p.email, mine + 1)).length).toBeGreaterThan(0);
});

test('Mi cuenta: removing my registered devices signs me out; next time a code by e-mail, then the new device', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one set-up is enough');
  const p = await account(info, `Ruth ${tag(info)}`, ['texts', 'contact', 'photos', 'documents']);
  const setup = await p.c.post('/api/account/2fa/setup', { currentPassword: p.password });
  expect((await p.c.post('/api/account/2fa/enable', { code: await totp(setup.data.secret) })).status).toBe(200);
  await signIn(page, p);
  await page.getByLabel('Código de 6 dígitos').fill(await totp(setup.data.secret, 1));
  await home(page);
  await page.goto('/admin/#/cuenta');
  await page.getByRole('button', { name: 'Quitar dispositivos registrados' }).click();
  const ask = page.getByRole('dialog', { name: '¿Quitar tus dispositivos registrados?' });
  await expect(ask).toContainText('registrarás tu dispositivo nuevo');
  await ask.getByLabel('Tu contraseña').fill(p.password);
  await ask.getByRole('button', { name: 'Quitar dispositivos registrados' }).click();
  const done = page.getByRole('dialog', { name: 'Dispositivos quitados' });
  await expect(done).toBeVisible();
  await axe(page);
  const before = await countTo(p.email);
  await done.getByRole('button', { name: 'Ir a iniciar sesión' }).click();
  await signIn(page, p);
  await expect(page.getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible();
  await expect(page.getByText('Los 6 dígitos del correo que te enviamos.', { exact: false })).toBeVisible();
  const subjects = (await waitForMail(p.email, before + 2)).map((x) => x.Subject);
  expect(subjects).toEqual(expect.arrayContaining([expect.stringMatching(/Tu código para entrar al panel/), expect.stringMatching(/Se quitaron los dispositivos/)]));
  await page.getByLabel('Código de 6 dígitos').fill(await emailedCode(p.email, before + 1));
  await expect(page.getByRole('heading', { name: 'Registra tu dispositivo nuevo' })).toBeVisible();
});
