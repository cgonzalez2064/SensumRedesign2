// "Ver como": the owner checks what each access type sees, read-only, switching
// between accounts from the bar and going back.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ADMIN } from '../integration/helpers.mjs';
import { TEXTS_ONLY, SALES } from './global-setup.mjs';

const sql = (q) => execFileSync('sqlite3', ['-cmd', '.timeout 5000', join(process.env.E2E_STORAGE, 'database.sqlite'), q]).toString().trim();

async function signIn(page) {
  await page.goto('/admin/#/ingresar');
  await page.getByLabel('Correo electrónico').fill(ADMIN.email);
  await page.getByLabel(/^Contraseña$/).fill(ADMIN.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('main h1')).toHaveText(/^Hola, /);
}
async function axe(page) {
  const v = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.filter((x) => ['serious', 'critical'].includes(x.impact));
  expect(v.map((x) => `${x.id}: ${x.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
}
const navLinks = async (page) => {
  if (await page.locator('.open-nav').isVisible()) {
    await page.locator('.open-nav').click();
    await expect(page.locator('.sidebar.open')).toBeVisible();
  }
  const hrefs = await page.locator('nav.nav a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  if (await page.locator('.sidebar.open').count()) await page.keyboard.press('Escape');
  return hrefs;
};

test('the owner views the panel as other accounts, switches, and goes back', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);
  await page.goto('/admin/#/usuarios');
  await page.getByRole('button', { name: 'Ver como…' }).click();
  const pick = page.getByRole('dialog', { name: 'Ver el panel como otra persona' });
  await expect(pick.getByText(ADMIN.name)).toHaveCount(0); // never the owner
  await pick.getByRole('button', { name: `Ver el panel como ${TEXTS_ONLY.name}` }).click();
  const pw = page.getByRole('dialog', { name: `Ver el panel como ${TEXTS_ONLY.name}` });
  await pw.getByLabel('Tu contraseña').fill(ADMIN.password);
  await pw.getByRole('button', { name: 'Ver como' }).click();

  // Their panel, with the bar.
  const bar = page.getByRole('region', { name: 'Modo «Ver como»' });
  await expect(bar).toContainText(`Viendo el panel como ${TEXTS_ONLY.name}`);
  await expect(bar).toContainText('Solo textos · solo lectura');
  await expect(bar).toContainText(/quedan (29|30) min/);
  await expect(page.locator('main h1')).toHaveText(`Hola, ${TEXTS_ONLY.name.split(' ')[0]}`);
  const links = await navLinks(page);
  expect(links).toContain('#/textos');
  for (const href of ['#/usuarios', '#/monitoreo', '#/fotos', '#/prospectos', '#/correo']) expect(links).not.toContain(href);
  await axe(page);
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw).toBeLessThanOrEqual(iw);

  // Read-only: trying to save explains why nothing changed.
  await page.goto('/admin/#/textos/hero');
  const field = page.getByRole('textbox', { name: 'Botón secundario Español', exact: true });
  await field.fill('Cambio desde Ver como');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText(/no se guardan cambios/)).toBeVisible();
  expect(sql("SELECT COUNT(*) FROM content WHERE value = 'Cambio desde Ver como'")).toBe('0');
  await page.goto('/admin/#/');
  if (await page.getByRole('dialog').count()) await page.getByRole('dialog').getByRole('button', { name: /Salir sin guardar|Descartar/ }).click();

  // Switch from the bar, no password.
  await bar.getByRole('button', { name: 'Cambiar de persona' }).click();
  await page.getByRole('dialog', { name: 'Cambiar a otra persona' }).getByRole('button', { name: `Ver el panel como ${SALES.name}` }).click();
  await expect(bar).toContainText(`Viendo el panel como ${SALES.name}`);
  await expect(bar).toContainText('Ventas: prospectos');
  const salesLinks = await navLinks(page);
  expect(salesLinks).toEqual(expect.arrayContaining(['#/prospectos', '#/estadisticas']));
  expect(salesLinks).not.toContain('#/textos');
  const unread = sql('SELECT COUNT(*) FROM leads WHERE unread = 1');
  await page.goto('/admin/#/prospectos/1');
  await expect(page.locator('main h1')).not.toHaveText('Prospecto');
  expect(sql('SELECT COUNT(*) FROM leads WHERE unread = 1')).toBe(unread); // opening it as them changes nothing

  // Back to the owner.
  await bar.getByRole('button', { name: 'Volver a mi cuenta' }).click();
  await expect(page.getByRole('region', { name: 'Modo «Ver como»' })).toHaveCount(0);
  await expect(page.locator('main h1')).toHaveText('Usuarios');
  expect(sql("SELECT group_concat(action) FROM (SELECT action FROM activity_log WHERE action LIKE 'view_as_%' ORDER BY id DESC LIMIT 3)")).toBe('view_as_ended,view_as_switched,view_as_started');
  expect(errors).toEqual([]);
});

test('when it expires the panel notices and returns to the owner', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one browser is enough');
  await signIn(page);
  await page.goto('/admin/#/usuarios');
  const row = page.locator('tr', { hasText: TEXTS_ONLY.name });
  await row.getByRole('button', { name: new RegExp(`Acciones para ${TEXTS_ONLY.name}`) }).click();
  await page.getByRole('button', { name: 'Ver el panel como esta persona' }).click();
  await page.getByRole('dialog').getByLabel('Tu contraseña').fill(ADMIN.password);
  await page.getByRole('dialog').getByRole('button', { name: 'Ver como' }).click();
  await expect(page.getByRole('region', { name: 'Modo «Ver como»' })).toBeVisible();
  sql("UPDATE sessions SET view_as_until = strftime('%s','now') - 1 WHERE view_as_user_id IS NOT NULL");
  await page.goto('/admin/#/textos');
  await expect(page.getByText('La vista cambió; el panel se volvió a cargar.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Modo «Ver como»' })).toHaveCount(0);
  const links = await navLinks(page);
  expect(links).toContain('#/usuarios');
});
