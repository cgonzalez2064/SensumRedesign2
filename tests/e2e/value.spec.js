// Prospectos, Estadísticas, ticket ratings and the report's PDF, in real browsers.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIN } from '../integration/helpers.mjs';
import { SALES, EDITOR } from './global-setup.mjs';

const sql = (q) => execFileSync('sqlite3', ['-cmd', '.timeout 5000', join(process.env.E2E_STORAGE, 'database.sqlite'), q]).toString().trim();

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

test('sales: only Prospectos and Estadísticas; follow a lead up and export the list', async ({ page }, info) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await signIn(page, SALES);
  const nav = page.locator('nav.nav');
  if (await page.locator('.open-nav').isVisible()) await page.locator('.open-nav').click();
  await expect(nav.locator('a[href="#/prospectos"]')).toBeVisible();
  await expect(nav.locator('a[href="#/estadisticas"]')).toBeVisible();
  for (const href of ['#/textos', '#/fotos', '#/contacto', '#/usuarios', '#/monitoreo']) await expect(nav.locator(`a[href="${href}"]`)).toHaveCount(0);
  await expect(nav.getByText('Sitio web')).toHaveCount(0);
  await expect(nav.locator('a[href="#/prospectos"] .nav-badge')).toHaveText(/^\d+$/);
  if (await page.locator('.sidebar.open').count()) await page.keyboard.press('Escape');

  await page.goto('/admin/#/prospectos');
  await expect(page.locator('main h1')).toHaveText('Prospectos');
  const row = page.locator('.ticket-row', { hasText: 'Lucía Méndez' });
  await expect(row).toBeVisible();
  await expect(row.locator('.lead-excerpt')).toContainText('cotización para remodelar');
  // Filters and search.
  await page.getByRole('button', { name: /^Ganados/ }).click();
  await expect(page.locator('.ticket-row')).toHaveCount(1);
  await expect(page.locator('.ticket-row')).toContainText('Q 185,000');
  await page.getByRole('button', { name: /^Todos/ }).click();
  await page.getByRole('searchbox').fill('Robert');
  await expect(page.locator('.ticket-row')).toHaveCount(1);
  await expect(page.locator('.ticket-row .badge-warn')).toHaveCount(1); // e-mail notice failed
  await page.getByRole('searchbox').fill('');
  await expect(page.locator('.ticket-row')).toHaveCount(Number(sql('SELECT COUNT(*) FROM leads'))); // other specs send the form too
  await axe(page);

  // CSV export (desktop only: downloads on WebKit iPhone are not files).
  if (info.project.name === 'desktop-chrome') {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar CSV' }).click()]);
    expect(dl.suggestedFilename()).toMatch(/^prospectos-sensum-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = readFileSync(await dl.path(), 'utf8');
    expect(csv).toContain('Lucía Méndez');
    expect(csv.split('\n')[0]).toContain('Número,Fecha,Nombre');
  }

  // One lead: contact links, status, amount, a note and its history.
  await page.goto('/admin/#/prospectos/1');
  await expect(page.locator('main h1')).toHaveText('Lucía Méndez');
  await expect(page.getByRole('link', { name: 'Responder a Lucía por correo' })).toHaveAttribute('href', /^mailto:lucia\.mendez%40example\.test\?subject=/);
  await expect(page.getByRole('link', { name: /Escribir por WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/50255551234');
  await page.getByLabel('Estado', { exact: true }).selectOption('quoted');
  await page.getByLabel('Monto cotizado o ganado (Q)').fill('12a5000');
  await expect(page.getByLabel('Monto cotizado o ganado (Q)')).toHaveValue('125000');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Seguimiento guardado.')).toBeVisible();
  await expect(page.locator('.ticket-summary')).toContainText('Cotizado');
  await expect(page.locator('.timeline')).toContainText('Vera Ventas cambió el estado: Nuevo → Cotizado');
  await expect(page.locator('.timeline')).toContainText('registró un monto de Q 125,000');
  await page.getByLabel('Nueva nota').fill('Visita el jueves a las 10. <b>Llevar muestras</b>');
  await page.getByRole('button', { name: 'Agregar nota' }).click();
  await expect(page.locator('.timeline .bubble-body').last()).toHaveText('Visita el jueves a las 10. <b>Llevar muestras</b>');
  await axe(page);
  expect(sql("SELECT status || '|' || amount FROM leads WHERE id = 1")).toBe('quoted|125000');
  // Put it back for the other device runs.
  sql("UPDATE leads SET status='new', amount=NULL, unread=1, contacted_at=NULL WHERE id=1; DELETE FROM lead_notes WHERE lead_id=1;");
  expect(errors).toEqual([]);
});

test('statistics: visits per day, sources, clicks and the path from message to project', async ({ page }) => {
  await signIn(page, SALES);
  await page.goto('/admin/#/estadisticas');
  await expect(page.locator('main h1')).toHaveText('Estadísticas');
  await expect(page.locator('.kpi').first().locator('.kpi-num')).toHaveText(/^\d[\d,.]*$/);
  const daily = page.locator('section', { has: page.getByRole('heading', { name: 'Visitas por día' }) });
  await expect(daily.locator('.chart-line')).toHaveCount(2);
  await expect(daily.locator('.chart-data tbody tr')).toHaveCount(30);
  await expect(page.getByRole('heading', { name: 'De dónde llegan' })).toBeVisible();
  await expect(page.locator('.bar-list').first()).toContainText('Google');
  await expect(page.locator('.funnel')).toContainText('mensajes recibidos');
  await expect(page.getByText('Ganados por un total de Q 185,000.')).toBeVisible();
  // Only the owner can switch statistics off.
  await expect(page.getByLabel('Contar visitas del sitio (sin cookies)')).toHaveCount(0);
  await page.getByLabel('Período').selectOption({ index: 1 });
  await expect(page.locator('.kpi').first()).toBeVisible();
  await axe(page);
});

test('the public site counts a visit and a WhatsApp click, without cookies', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one browser is enough for the counting');
  // Headless browsers announce themselves ("HeadlessChrome") and are not counted: look like a person's Chrome.
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' });
  const page = await context.newPage();
  const before = Number(sql("SELECT COALESCE(SUM(count), 0) FROM analytics_daily WHERE metric='view'"));
  // Automated browsers report navigator.webdriver and are not counted (that is the point);
  // here the page must behave as for a person.
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
  const beacons = [];
  page.on('request', (r) => { if (r.url().endsWith('/api/collect')) beacons.push(r.method()); });
  await page.goto('/');
  await expect.poll(() => beacons.length).toBeGreaterThan(0);
  expect(beacons[0]).toBe('POST');
  expect(Number(sql(`SELECT COALESCE(SUM(count), 0) FROM analytics_daily WHERE metric='view' AND dim='home'`))).toBeGreaterThan(0);
  await expect.poll(() => Number(sql("SELECT COALESCE(SUM(count), 0) FROM analytics_daily WHERE metric='view'"))).toBe(before + 1);
  const clicksBefore = Number(sql("SELECT COALESCE(SUM(count), 0) FROM analytics_daily WHERE metric='click' AND dim='whatsapp'"));
  await context.route('https://wa.me/**', (r) => r.fulfill({ status: 200, body: 'ok' }));
  const [popup] = await Promise.all([context.waitForEvent('page'), page.locator('#whatsappFab').click()]);
  await popup.close();
  await expect.poll(() => Number(sql("SELECT COALESCE(SUM(count), 0) FROM analytics_daily WHERE metric='click' AND dim='whatsapp'"))).toBe(clicksBefore + 1);
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k !== 'sensum_lang'))).toEqual([]);
  await context.close();
});

test('the reporter rates resolved help with stars; IT sees it with the service level', async ({ browser }, info) => {
  test.skip(info.project.name === 'tablet-chrome', 'desktop and phone are enough');
  sql("UPDATE support_reports SET status='resolved', resolved_at=strftime('%s','now'), rating=NULL, rating_comment=NULL, rated_at=NULL WHERE id=1");
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, EDITOR);
  await page.goto('/admin/#/reportes/1');
  const card = page.locator('.rate-card');
  await expect(card.getByRole('heading', { name: '¿Cómo te atendimos?' })).toBeVisible();
  await card.getByRole('button', { name: 'Enviar calificación' }).click();
  await expect(card.getByText('Primero elige cuántas estrellas.')).toBeVisible();
  await card.getByRole('button', { name: '4 de 5 estrellas' }).click();
  await expect(card.getByText('Buena')).toBeVisible();
  await expect(card.locator('.star-btn[aria-pressed="true"]')).toHaveCount(4);
  await axe(page);
  await card.getByLabel(/Comentario/).fill('Rápido y claro.');
  await card.getByRole('button', { name: 'Enviar calificación' }).click();
  await expect(page.getByText('¡Gracias por tu calificación!')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tu calificación' })).toBeVisible();
  await expect(page.getByRole('img', { name: '4 de 5 estrellas' })).toBeVisible();
  await ctx.close();

  const it = await browser.newContext({ ...(info.project.use.viewport ? { viewport: info.project.use.viewport } : {}) });
  const owner = await it.newPage();
  await signIn(owner, ADMIN);
  await owner.goto('/admin/#/reportes');
  // The service level lives in the support overview.
  await expect(owner.locator('details.ticket-overview .kpi', { hasText: 'Satisfacción' })).toContainText('4/5');
  await expect(owner.locator('details.ticket-overview .kpi', { hasText: 'Satisfacción' })).toContainText('1 calificación');
  await expect(owner.getByLabel('Objetivo de respuesta')).toHaveValue('24');
  await owner.goto('/admin/#/reportes/1');
  await expect(owner.getByRole('heading', { name: /Calificación de / })).toBeVisible();
  await expect(owner.getByText('Rápido y claro.')).toBeVisible();
  await it.close();
  sql("UPDATE support_reports SET status='waiting', resolved_at=NULL, rating=NULL, rating_comment=NULL, rated_at=NULL WHERE id=1");
});

test('monthly report: trends in the preview and the PDF download', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'downloads are checked on desktop');
  await signIn(page);
  await page.goto('/admin/#/informe');
  await page.getByLabel('Mes').selectOption({ index: 0 });
  await expect(page.locator('.report-preview')).toContainText('Visitas y clientes potenciales');
  await expect(page.locator('.report-preview .trend').first()).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar PDF' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^informe-sitio-sensum-\d{4}-\d{2}\.pdf$/);
  expect(readFileSync(await dl.path()).subarray(0, 8).toString()).toBe('%PDF-1.4');
});
