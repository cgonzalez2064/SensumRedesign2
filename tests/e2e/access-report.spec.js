// Access types (owner manages users) and the monthly client report.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN } from '../integration/helpers.mjs';
import { TEXTS_ONLY } from './global-setup.mjs';

async function login(page, user = ADMIN) {
  await page.goto('/admin/#/ingresar');
  await page.getByLabel(/Correo electrónico|^Email$/).fill(user.email);
  await page.getByLabel(/^Contraseña$|^Password$/).fill(user.password);
  await page.getByRole('button', { name: /Iniciar sesión|Sign in/ }).click();
  await expect(page.locator('main h1')).toHaveText(/^(Hola|Hi), /);
}

test('the owner invites someone with a ready-made access type and changes it later', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one invitation is enough');
  await login(page);
  await page.goto('/admin/#/usuarios');
  await page.getByRole('button', { name: 'Invitar usuario' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre').fill('Pedro Fotos');
  await dialog.getByLabel('Correo electrónico').fill(`pedro.${Date.now()}@example.test`);
  await dialog.getByText('Solo fotos y portafolio').click();
  await expect(dialog.locator('.checks')).toBeHidden();
  await dialog.getByRole('button', { name: 'Enviar invitación' }).click();
  await expect(page.getByText(/Invitación enviada a/)).toBeVisible();
  const row = page.locator('tr', { hasText: 'Pedro Fotos' });
  await expect(row.getByText('Solo fotos y portafolio')).toBeVisible();
  // Change to a custom set.
  await row.getByRole('button', { name: /Acciones para Pedro Fotos/ }).click();
  await page.getByRole('button', { name: 'Cambiar tipo de acceso' }).click();
  const dlg = page.getByRole('dialog', { name: /Acceso de Pedro Fotos/ });
  await dlg.getByText('Personalizado').click();
  await expect(dlg.locator('.checks')).toBeVisible();
  await dlg.getByRole('checkbox', { name: 'Datos de contacto' }).check();
  const r = (await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  expect(r.map((v) => v.id)).toEqual([]);
  await dlg.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Tipo de acceso actualizado. Se aplica de inmediato.')).toBeVisible();
  await expect(row.getByText('Datos de contacto · Fotos · Portafolio en PDF')).toBeVisible();
});

test('an account with "Solo textos" only sees and opens what it may change', async ({ page }) => {
  await login(page, TEXTS_ONLY);
  const nav = page.locator('.nav');
  await expect(nav.locator('a[href="#/textos"]')).toHaveCount(1);
  for (const href of ['#/fotos', '#/contacto', '#/usuarios', '#/monitoreo', '#/informe']) await expect(nav.locator(`a[href="${href}"]`)).toHaveCount(0);
  await expect(page.locator('.quick a[href="#/fotos"]')).toHaveCount(0);
  for (const hash of ['#/fotos', '#/contacto', '#/usuarios', '#/informe']) {
    await page.goto('/admin/' + hash);
    await expect(page.locator('main h1')).toHaveText('No encontramos esta pantalla');
  }
  await page.goto('/admin/#/cuenta');
  await expect(page.locator('main').getByText('Textos del sitio', { exact: true })).toBeVisible();
});

test('monthly report: preview, recipients with the owner always copied, test e-mail', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one submission is enough');
  await login(page);
  await page.goto('/admin/#/informe');
  await expect(page.locator('main h1')).toHaveText('Informe mensual');
  await expect(page.locator('.report-preview .report-headline')).toBeVisible();
  await expect(page.locator('.chip-fixed')).toContainText(ADMIN.email);
  await page.getByLabel('Agregar correo').fill('no-es-un-correo');
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(page.getByText('Escribe un correo válido, por ejemplo nombre@empresa.com.')).toBeVisible();
  await page.getByLabel('Agregar correo').fill('Cliente@Example.test');
  await page.getByLabel('Agregar correo').press('Enter');
  await expect(page.locator('.chip', { hasText: 'cliente@example.test' })).toBeVisible();
  await page.getByRole('button', { name: 'Guardar destinatarios' }).click();
  await expect(page.getByText('Destinatarios guardados.')).toBeVisible();
  await page.getByRole('button', { name: 'Enviarme una prueba' }).click();
  await expect(page.getByText(`Prueba enviada a ${ADMIN.email}.`)).toBeVisible();
  await page.getByRole('button', { name: /Quitar a cliente@example.test/ }).click();
  await expect(page.locator('.chip', { hasText: 'cliente@example.test' })).toHaveCount(0);
});
