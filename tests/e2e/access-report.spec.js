// Access types (owner manages users) and the monthly client report.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN } from '../integration/helpers.mjs';
import { TEXTS_ONLY, OTHER_ADMIN } from './global-setup.mjs';

async function login(page, user = ADMIN) {
  await page.goto('/admin/#/ingresar');
  await page.getByLabel(/Correo electrónico|^Email$/).fill(user.email);
  await page.getByLabel(/^Contraseña$|^Password$/).fill(user.password);
  await page.getByRole('button', { name: /Iniciar sesión|Sign in/ }).click();
  await expect(page.locator('main h1')).toHaveText(/^(Hola|Hi), /);
}

test('the owner invites someone with a role and changes it later, with an extra section', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one invitation is enough');
  await login(page);
  await page.goto('/admin/#/usuarios');
  await page.getByRole('button', { name: 'Invitar usuario' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre').fill('Pedro Fotos');
  await dialog.getByLabel('Correo electrónico').fill(`pedro.${Date.now()}@example.test`);
  // Four roles; the extra sections are folded away (exceptions only).
  await expect(dialog.locator('.choice')).toHaveText([/^Administrador/, /^Editor del sitio web/, /^Ventas y prospectos/, /^Consulta \(solo lectura\)/]);
  await expect(dialog.getByText('Editor del sitio web', { exact: true }).locator('xpath=ancestor::label').locator('input')).toBeChecked();
  await dialog.getByText('Consulta (solo lectura)', { exact: true }).click();
  await expect(dialog.locator('details.extras')).not.toHaveAttribute('open', '');
  await dialog.getByRole('button', { name: 'Enviar invitación' }).click();
  await expect(page.getByText(/Invitación enviada a/)).toBeVisible();
  const row = page.locator('tr', { hasText: 'Pedro Fotos' });
  await expect(row.getByText('Consulta (solo lectura)', { exact: true })).toBeVisible();
  // Another role, plus one section it doesn't include.
  await row.getByRole('button', { name: /Acciones para Pedro Fotos/ }).click();
  await page.getByRole('button', { name: 'Cambiar rol' }).click();
  const dlg = page.getByRole('dialog', { name: /Rol de Pedro Fotos/ });
  await dlg.getByText('Editor del sitio web', { exact: true }).click();
  await dlg.locator('details.extras > summary').click();
  await expect(dlg.getByRole('checkbox', { name: /^Textos del sitio/ })).toHaveCount(0); // already in the role
  await dlg.getByRole('checkbox', { name: /^Prospectos/ }).check();
  await expect(dlg.locator('.extras-count')).toHaveText('1 marcadas');
  const r = (await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  expect(r.map((v) => v.id)).toEqual([]);
  await dlg.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Rol actualizado. Se aplica de inmediato.')).toBeVisible();
  await expect(row.getByText('Editor del sitio web + Prospectos')).toBeVisible();
});

test('an account with "Solo textos" only sees and opens what it may change', async ({ page }) => {
  await login(page, TEXTS_ONLY);
  const nav = page.locator('.nav');
  await expect(nav.locator('a[href="#/textos"]')).toHaveCount(1);
  for (const href of ['#/fotos', '#/contacto', '#/formulario', '#/usuarios', '#/monitoreo', '#/informe', '#/correo']) await expect(nav.locator(`a[href="${href}"]`)).toHaveCount(0);
  await expect(page.locator('.quick a[href="#/fotos"]')).toHaveCount(0);
  for (const hash of ['#/fotos', '#/contacto', '#/formulario', '#/usuarios', '#/informe']) {
    await page.goto('/admin/' + hash);
    await expect(page.locator('main h1')).toHaveText('No tienes acceso a esta sección');
  }
  await page.goto('/admin/#/cuenta');
  await expect(page.locator('main').getByText('Textos del sitio', { exact: true })).toBeVisible();
});

test('monthly report: preview, recipients with the owner always copied, test e-mail', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one submission is enough');
  await login(page);
  await page.goto('/admin/#/informe');
  await expect(page.locator('main h1')).toHaveText('Informe mensual');
  // Two versions: what clients receive (no technical details) and the team's technical detail.
  const tabs = page.getByRole('group', { name: 'Versión del informe' });
  await expect(tabs.getByRole('button', { name: 'Para clientes' })).toHaveAttribute('aria-pressed', 'true');
  const client = page.locator('.report-preview');
  await expect(client.locator('.report-headline')).toBeVisible();
  await expect(client).toContainText('Monitoreo y protección');
  await expect(client).toContainText('Vigilado las 24 horas');
  for (const word of ['respaldo', 'Respaldo', 'Requiere atención', 'Pendientes técnicos', 'certificado']) await expect(client).not.toContainText(word);
  await tabs.getByRole('button', { name: 'Detalle técnico' }).click();
  const tech = page.locator('.report-preview.report-technical');
  await expect(tech).toContainText('Interno');
  await expect(tech).toContainText('Seguridad y respaldos');
  await expect(tech).toContainText('Último respaldo');
  await expect(page.getByText('No se envía a los clientes.', { exact: false })).toBeVisible();
  const v = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.filter((x) => ['serious', 'critical'].includes(x.impact));
  expect(v.map((x) => `${x.id}: ${x.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
  await tabs.getByRole('button', { name: 'Para clientes' }).click();
  await expect(page.locator('.tag-fixed')).toContainText(ADMIN.email);
  await page.getByLabel('Agregar correo').fill('no-es-un-correo');
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(page.getByText('Escribe un correo válido, por ejemplo nombre@empresa.com.')).toBeVisible();
  await page.getByLabel('Agregar correo').fill('Cliente@Example.test');
  await page.getByLabel('Agregar correo').press('Enter');
  await expect(page.locator('.tag', { hasText: 'cliente@example.test' })).toBeVisible();
  await page.getByRole('button', { name: 'Guardar destinatarios' }).click();
  await expect(page.getByText('Destinatarios guardados.')).toBeVisible();
  await page.getByRole('button', { name: 'Enviarme una prueba' }).click();
  await expect(page.getByText(`Prueba enviada a ${ADMIN.email}.`)).toBeVisible();
  await page.getByRole('button', { name: /Quitar a cliente@example.test/ }).click();
  await expect(page.locator('.tag', { hasText: 'cliente@example.test' })).toHaveCount(0);
});

test('site administrators view both versions of the monthly report, without sending it', async ({ page }, info) => {
  await login(page, OTHER_ADMIN);
  const nav = page.locator('.nav');
  if (await page.locator('.open-nav').isVisible()) await page.locator('.open-nav').click();
  await expect(nav.locator('a[href="#/informe"]')).toBeVisible();
  await nav.locator('a[href="#/informe"]').click();
  await expect(page.locator('main h1')).toHaveText('Informe mensual');
  await expect(page.locator('.report-preview .report-headline')).toBeVisible();
  await expect(page.getByRole('button', { name: /Enviar informe/ })).toHaveCount(0);
  await expect(page.getByText('Destinatarios')).toHaveCount(0);
  await page.getByRole('button', { name: 'Detalle técnico' }).click();
  await expect(page.locator('.report-preview.report-technical')).toContainText('Seguridad y respaldos');
  await page.getByLabel('Mes del informe').selectOption({ index: 1 });
  await expect(page.locator('.report-preview.report-technical')).toBeVisible();
  if (info.project.name !== 'desktop-chrome') expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
