// The "Servicio de interés" options: edited in the panel, shown on the website (ES/EN).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN } from '../integration/helpers.mjs';

async function login(page) {
  await page.goto('/admin/#/ingresar');
  await page.getByLabel(/Correo electrónico|^Email$/).fill(ADMIN.email);
  await page.getByLabel(/^Contraseña$|^Password$/).fill(ADMIN.password);
  await page.getByRole('button', { name: /Iniciar sesión|Sign in/ }).click();
  await expect(page.locator('main h1')).toHaveText(/^(Hola|Hi), /);
}

test('the team edits the form options and the website shows them', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one edit is enough');
  await login(page);
  await page.locator('.nav a[href="#/formulario"]').click();
  await expect(page.locator('main h1')).toHaveText('Formulario de contacto');
  const rows = page.locator('.svc-row');
  const preview = page.locator('.svc-preview-item');
  await expect(rows).toHaveCount(7);
  await expect(preview).toHaveCount(7);
  await expect(page.locator('.save-row')).toContainText('Sin cambios pendientes');

  // Add: the new option goes before "Otro" and gets the focus.
  await page.getByRole('button', { name: 'Agregar opción' }).click();
  await expect(rows).toHaveCount(8);
  const added = rows.nth(6);
  await expect(added.getByLabel('Español')).toBeFocused();
  await added.getByLabel('Español').fill('Construcción de casas');
  await added.getByLabel(/Inglés/).fill('Home building');
  await expect(added.locator('.svc-title')).toHaveText('Construcción de casas');
  await expect(page.locator('.save-row')).toContainText('Tienes cambios sin guardar');
  await expect(preview.nth(6)).toHaveText('Construcción de casas');

  // Reorder and remove (with undo).
  await page.getByRole('button', { name: 'Subir «Construcción de casas»' }).click();
  await expect(rows.nth(5).locator('.svc-title')).toHaveText('Construcción de casas');
  await page.getByRole('button', { name: 'Eliminar «Instalaciones generales»' }).click();
  await expect(rows).toHaveCount(7);
  await page.getByRole('button', { name: 'Eliminar «Otro»' }).click();
  await page.locator('.toast', { hasText: '«Otro»' }).getByRole('button', { name: 'Deshacer' }).click();
  await expect(rows).toHaveCount(7);
  await expect(rows.last().locator('.svc-title')).toHaveText('Otro');

  // A duplicate name is caught before saving.
  await rows.nth(0).getByLabel('Español').fill('Obra civil');
  await page.getByRole('button', { name: 'Guardar y publicar' }).click();
  await expect(page.getByText('Ya hay una opción con este nombre.')).toBeVisible();
  await rows.nth(0).getByLabel('Español').fill('Remodelaciones');

  // English preview.
  await page.locator('.svc-preview-card').getByRole('button', { name: 'English' }).click();
  await expect(preview.nth(4)).toHaveText('Home building');
  const v = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter((x) => ['serious', 'critical'].includes(x.impact));
  expect(v.map((x) => x.id)).toEqual([]);

  await page.getByRole('button', { name: 'Guardar y publicar' }).click();
  await expect(page.getByText('Opciones guardadas. El formulario del sitio ya las muestra.')).toBeVisible();
  await expect(page.locator('.save-row')).toContainText('Sin cambios pendientes');

  // The website: Spanish, then English.
  await page.goto('/');
  const select = page.locator('#service');
  await expect(select.locator('option', { hasText: 'Construcción de casas' })).toHaveCount(1);
  await expect(select.locator('option', { hasText: 'Instalaciones generales' })).toHaveCount(0);
  await page.locator('#langToggle').click();
  await expect(select.locator('option', { hasText: 'Home building' })).toHaveCount(1);
  await page.locator('#langToggle').click();

  // Back to the approved options so the other tests see them.
  await page.goto('/admin/#/formulario');
  await page.getByRole('button', { name: 'Restaurar las opciones originales' }).click();
  await expect(rows).toHaveCount(7);
  await page.getByRole('button', { name: 'Guardar y publicar' }).click();
  await expect(page.getByText('Opciones guardadas. El formulario del sitio ya las muestra.')).toBeVisible();
});
