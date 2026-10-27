// Monitoring charts (owner), the summary version for the "monitor" access,
// and giving that access as part of a custom access type.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN } from '../integration/helpers.mjs';
import { OTHER_ADMIN, TEXTS_ONLY } from './global-setup.mjs';

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
const chartOf = (page, title) => page.locator('.stack-sm', { has: page.getByRole('heading', { name: title, exact: true }) }).locator('figure.chart');

test('owner: interactive trends — hover, keyboard, legend and range', async ({ page }, info) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Refused to apply a stylesheet/.test(m.text())) errors.push(m.text()); });
  await signIn(page);
  await page.goto('/admin/#/monitoreo');
  await expect(page.getByRole('heading', { name: 'Tendencias' })).toBeVisible();
  const response = chartOf(page, 'Tiempo de respuesta del sitio');
  const errorsChart = chartOf(page, 'Errores por día');
  await expect(chartOf(page, 'Inicios de sesión')).toBeVisible();
  await expect(response.locator('.chart-line')).toHaveCount(1);
  await expect(response.locator('.chart-marker')).toHaveCount(1); // the day with a failed check
  // Hover (or tap) shows the day's values.
  const plot = response.locator('.chart-plot');
  await plot.scrollIntoViewIfNeeded(); // below the uptime section on smaller screens
  const box = await plot.boundingBox();
  if (info.project.name === 'iphone-webkit') await plot.tap({ position: { x: box.width * 0.6, y: box.height / 2 } });
  else await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  const tip = response.locator('.chart-tip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText(/\d+ ms/);
  // Keyboard: End goes to the last day; arrows move.
  await plot.focus();
  await page.keyboard.press('End');
  const last = await tip.locator('strong').textContent();
  await page.keyboard.press('ArrowLeft');
  await expect(tip.locator('strong')).not.toHaveText(last);
  await page.keyboard.press('End');
  await expect(tip.locator('strong')).toHaveText(last);
  await expect(response.locator('[aria-live="polite"]')).toContainText('ms');
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
  // Legend: hide a series (one always stays).
  const warnKey = errorsChart.getByRole('button', { name: 'Advertencia' });
  await warnKey.click();
  await expect(warnKey).toHaveAttribute('aria-pressed', 'false');
  await warnKey.click();
  // Range: 7 days → 7 rows in the data table.
  await page.getByRole('group', { name: 'Período de las gráficas' }).getByRole('button', { name: '7 días' }).click();
  await expect(response.locator('.chart-data tbody tr')).toHaveCount(7);
  await axe(page);
  expect(errors).toEqual([]);
});

test('admins see the summary version: status, figures and charts, without technical details', async ({ page }) => {
  await signIn(page, OTHER_ADMIN);
  if (await page.locator('.open-nav').isVisible()) await page.locator('.open-nav').click();
  await expect(page.locator('.nav a[href="#/salud-del-sitio"]')).toBeVisible();
  await expect(page.locator('.nav a[href="#/monitoreo"]')).toHaveCount(0);
  await page.goto('/admin/#/salud-del-sitio');
  await expect(page.locator('main h1')).toHaveText('Salud del sitio');
  await expect(page.locator('main .alert').first()).toContainText(/Todo funciona correctamente|Hubo un problema|El sitio tiene un problema/);
  await expect(page.locator('.uptime-tiles .kpi')).toHaveCount(4);
  await expect(page.locator('.kpi', { hasText: 'Últimos 30 días' }).locator('.kpi-num')).toHaveText(/\d.*%/);
  await expect(page.locator('.kpi', { hasText: 'Tiempo de respuesta' })).toBeVisible();
  await expect(chartOf(page, 'Tiempo de respuesta del sitio')).toBeVisible();
  await expect(chartOf(page, 'Errores por día')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Inicios de sesión' })).toHaveCount(0);
  await expect(page.getByText('Registro de errores')).toHaveCount(0);
  await expect(page.getByText('Publisher.php')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Seguridad y respaldos' })).toBeVisible();
  await axe(page);
});

test('"Salud del sitio" can be given to anyone as part of a custom access', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'changing access once is enough');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, TEXTS_ONLY);
  await expect(page.locator('.nav a[href="#/salud-del-sitio"]')).toHaveCount(0);
  await page.goto('/admin/#/salud-del-sitio');
  await expect(page.locator('main h1')).toHaveText('No tienes acceso a esta sección');

  const it = await browser.newContext();
  const owner = await it.newPage();
  await signIn(owner);
  await owner.goto('/admin/#/usuarios');
  const row = owner.locator('tr', { hasText: TEXTS_ONLY.name });
  await row.getByRole('button', { name: new RegExp(`Acciones para ${TEXTS_ONLY.name}`) }).click();
  await owner.getByRole('button', { name: 'Cambiar tipo de acceso' }).click();
  const dlg = owner.getByRole('dialog', { name: new RegExp(`Acceso de ${TEXTS_ONLY.name}`) });
  await dlg.getByText('Personalizado').click();
  await dlg.getByRole('checkbox', { name: /^Salud del sitio/ }).check();
  await dlg.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(row.getByText('Textos del sitio · Salud del sitio')).toBeVisible();

  await page.goto('/admin/#/');
  await page.reload();
  await expect(page.locator('.nav a[href="#/salud-del-sitio"]')).toBeVisible();
  await page.goto('/admin/#/salud-del-sitio');
  await expect(page.locator('main h1')).toHaveText('Salud del sitio');

  // Put it back.
  await row.getByRole('button', { name: new RegExp(`Acciones para ${TEXTS_ONLY.name}`) }).click();
  await owner.getByRole('button', { name: 'Cambiar tipo de acceso' }).click();
  await owner.getByRole('dialog').getByText('Redactor', { exact: true }).click();
  await owner.getByRole('dialog').getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(row.getByText('Redactor', { exact: true })).toBeVisible();
  await ctx.close(); await it.close();
});
