// Ready-made access profiles at work: Gerencia (basic statistics + Salud del
// sitio), Soporte técnico (everyone's requests + overview charts), uptime and
// incidents in Monitoreo, and finding people in Usuarios.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN } from '../integration/helpers.mjs';
import { MANAGER, SUPPORT, OTHER_ADMIN, SALES, TEXTS_ONLY } from './global-setup.mjs';

async function signIn(page, user = ADMIN) {
  await page.goto('/admin/#/ingresar');
  await page.getByLabel(/Correo electrónico|^Email$/).fill(user.email);
  await page.getByLabel(/^Contraseña$|^Password$/).fill(user.password);
  await page.getByRole('button', { name: /Iniciar sesión|Sign in/ }).click();
  await expect(page.locator('main h1')).toHaveText(/^Hola, /);
}
async function axe(page) {
  const v = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.filter((x) => ['serious', 'critical'].includes(x.impact));
  expect(v.map((x) => `${x.id}: ${x.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
}
const noSideScroll = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
const chartOf = (page, title) => page.locator('.stack-sm', { has: page.getByRole('heading', { name: title, exact: true }) }).locator('figure.chart');
async function navLinks(page) {
  return page.locator('nav.nav a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
}

test('Gerencia: basic statistics and Salud del sitio, without contact details or settings', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await signIn(page, MANAGER);
  const links = await navLinks(page);
  expect(links).toEqual(expect.arrayContaining(['#/estadisticas', '#/salud-del-sitio']));
  for (const href of ['#/prospectos', '#/textos', '#/fotos', '#/usuarios', '#/monitoreo', '#/informe', '#/correo']) expect(links).not.toContain(href);
  await expect(page.locator('.quick a[href="#/estadisticas"]')).toBeVisible();
  await expect(page.locator('.quick a[href="#/salud-del-sitio"]')).toBeVisible();

  // Statistics, the basic version: visits, sources, devices — no contact-form figures.
  await page.goto('/admin/#/estadisticas');
  await expect(page.locator('main h1')).toHaveText('Estadísticas');
  await expect(page.locator('.kpi', { hasText: 'Desde celular' }).locator('.kpi-num')).toHaveText(/\d+ %/);
  await expect(page.locator('.kpi .kpi-label', { hasText: /^Páginas vistas$/ })).toBeVisible();
  await expect(page.getByText('Del mensaje al proyecto')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Ver prospectos' })).toHaveCount(0);
  await expect(page.getByText('Lucía Méndez')).toHaveCount(0);
  await axe(page);
  await noSideScroll(page);
  await page.goto('/admin/#/prospectos');
  await expect(page.locator('main h1')).toHaveText('No tienes acceso a esta sección');

  // Salud del sitio: uptime by period, the daily chart and incidents (without which check failed).
  await page.goto('/admin/#/salud-del-sitio');
  await expect(page.locator('main h1')).toHaveText('Salud del sitio');
  const tiles = page.locator('.uptime-tiles .kpi');
  await expect(tiles).toHaveCount(4);
  await expect(tiles.nth(0)).toContainText('Últimas 24 horas');
  await expect(tiles.nth(3)).toContainText('Últimos 90 días');
  await expect(tiles.nth(2).locator('.kpi-num')).toHaveText(/^\d{2}(\.\d+)? %$/);
  await expect(tiles.nth(2)).toContainText(/1 revisión con fallas de \d+/);
  await expect(chartOf(page, 'Disponibilidad diaria (uptime)')).toBeVisible();
  const incidents = page.locator('section', { has: page.getByRole('heading', { name: 'Incidentes (30 días)' }) });
  await expect(incidents.locator('.incident-list li')).toHaveCount(1);
  await expect(incidents).toContainText('1 revisión con fallas');
  await expect(incidents).not.toContainText('Fallaron');
  await axe(page);
  await noSideScroll(page);
  expect(errors).toEqual([]);
});

test('owner: Monitoreo shows uptime, the daily chart and which checks failed', async ({ page }, info) => {
  await signIn(page);
  await page.goto('/admin/#/monitoreo');
  await expect(page.getByRole('heading', { name: 'Disponibilidad (uptime)' })).toBeVisible();
  await expect(page.locator('.uptime-tiles .kpi')).toHaveCount(4);
  await expect(page.locator('.incident-list')).toContainText('Fallaron: database');
  const daily = chartOf(page, 'Disponibilidad diaria (uptime)');
  await expect(daily).toBeVisible();
  // The day with the failed check is yellow or red; the rest green. Keyboard shows each day.
  await expect(daily.locator('.chart-legend')).toContainText('Sin fallas');
  await expect(daily.locator('.chart-data tbody tr')).toHaveCount(30);
  const plot = daily.locator('.chart-plot');
  await expect(async () => {
    await plot.focus();
    await page.keyboard.press('End');
    await expect(daily.locator('.chart-tip')).toContainText('%', { timeout: 1000 });
  }).toPass();
  await page.keyboard.press('Escape');
  if (info.project.name !== 'desktop-chrome') await noSideScroll(page);
  await axe(page);
  // The summary version is one click away.
  await page.getByRole('link', { name: 'Salud del sitio (resumen)' }).click();
  await expect(page.locator('main h1')).toHaveText('Salud del sitio');
});

test('Soporte técnico: everyone\'s requests, the overview charts and no administration', async ({ page }, info) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await signIn(page, SUPPORT);
  const links = await navLinks(page);
  expect(links).toEqual(expect.arrayContaining(['#/reportes', '#/salud-del-sitio']));
  for (const href of ['#/usuarios', '#/monitoreo', '#/textos', '#/prospectos', '#/correo']) expect(links).not.toContain(href);

  await page.goto('/admin/#/reportes');
  await expect(page.locator('main h1')).toHaveText('Centro de Ayuda');
  await expect(page.getByRole('heading', { name: 'Gestión de solicitudes' })).toBeVisible();
  await expect(page.getByText('La galería no abre en el celular')).toBeVisible(); // Elena's request
  const overview = page.locator('details.ticket-overview');
  // Folded on phones so the list comes first; open on tablets and computers.
  if (info.project.name === 'iphone-webkit') {
    await expect(overview).not.toHaveAttribute('open', '');
    await overview.locator(':scope > summary').click();
  }
  await expect(overview).toHaveAttribute('open', '');
  await expect(overview.locator(':scope > summary')).toContainText('Panorama de soporte');
  await expect(overview.locator('.kpi', { hasText: 'Abiertas ahora' }).locator('.kpi-num')).toHaveText(/^\d+$/);
  const flow = chartOf(page, 'Recibidas y resueltas por día');
  await expect(flow).toBeVisible();
  await expect(flow.locator('.chart-data tbody tr')).toHaveCount(30);
  for (const title of ['Por estado', 'Por tipo', 'Por prioridad', 'Dónde se notó']) await expect(overview.getByRole('heading', { name: title })).toBeVisible();
  await expect(overview.locator('.stack-sm', { has: page.getByRole('heading', { name: 'Por prioridad' }) })).toContainText('Prioridad alta');
  // The response target is set here too (and saved for everyone).
  const target = overview.getByLabel('Objetivo de respuesta');
  await expect(target).toHaveValue('24');
  await target.selectOption('8');
  await expect(page.getByText('Objetivo de respuesta guardado.')).toBeVisible();
  await expect(overview.locator('.kpi', { hasText: 'Primera respuesta' })).toBeVisible();
  await target.selectOption('24');
  await expect(target).toHaveValue('24');
  await overview.getByRole('group', { name: 'Período del panorama' }).getByRole('button', { name: '90 días' }).click();
  await expect(flow.locator('.chart-data tbody tr')).toHaveCount(90);
  await axe(page);
  await noSideScroll(page);
  // Folding it away keeps the list at the top.
  await overview.locator(':scope > summary').click();
  await expect(overview).not.toHaveAttribute('open', '');
  // Not an administrator.
  await page.goto('/admin/#/usuarios');
  await expect(page.locator('main h1')).toHaveText('No tienes acceso a esta sección');
  expect(errors).toEqual([]);
});

test('a site administrator does not manage support: own requests only, no overview', async ({ page }) => {
  await signIn(page, OTHER_ADMIN);
  await page.goto('/admin/#/reportes');
  await expect(page.locator('main h1')).toHaveText('Centro de Ayuda');
  await expect(page.getByRole('heading', { name: 'Mis solicitudes' })).toBeVisible();
  await expect(page.locator('details.ticket-overview')).toHaveCount(0);
  await expect(page.getByText('La galería no abre en el celular')).toHaveCount(0);
});

test('Usuarios: search by name, e-mail or access, and filter by type or status', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/#/usuarios');
  const search = page.getByRole('searchbox', { name: 'Buscar por nombre, correo o acceso' });
  const shown = page.locator('main').locator('tbody tr:visible, .list-cards > .card:visible');
  const count = page.locator('.users-count');
  await expect(count).toHaveText(/^\d+ personas en total$/);
  const total = Number((await count.textContent()).match(/\d+/)[0]);
  // Accents and capitals do not matter.
  await search.fill('gael GERENTE');
  await expect(shown).toHaveCount(1);
  await expect(shown.first()).toContainText(MANAGER.name);
  await expect(count).toHaveText(`1 de ${total} personas`);
  await search.fill('vera.ventas@');
  await expect(shown).toHaveCount(1);
  await expect(shown.first()).toContainText(SALES.name);
  await search.fill('consulta');
  await expect(shown.filter({ hasText: SUPPORT.name })).toHaveCount(0); // its sections, not a role
  await search.fill('tere textos');
  await expect(shown.first()).toContainText(TEXTS_ONLY.name);
  await search.fill('');
  await page.getByRole('combobox', { name: 'Filtrar por rol' }).selectOption({ label: 'Ventas y prospectos' });
  await expect(shown.filter({ hasText: SALES.name })).toHaveCount(1);
  for (const r of await shown.all()) await expect(r).toContainText('Ventas y prospectos');
  // Status: tabs (a menu on phones).
  if (await page.locator('#users-view').isVisible()) await page.locator('#users-view').selectOption('desactivadas');
  else await page.locator('.users-tabs').getByRole('button', { name: /^Desactivadas/ }).click();
  await expect(page.getByText('Nadie coincide')).toBeVisible();
  await axe(page);
  await page.getByRole('button', { name: 'Quitar filtros' }).click();
  await expect(count).toHaveText(`${total} personas en total`);
  await expect(search).toHaveValue('');
  await noSideScroll(page);
});
