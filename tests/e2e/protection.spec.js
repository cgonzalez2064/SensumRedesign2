// Two-step sign-in and the encrypted backup, in real browsers.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN, totp, waitForMail, countTo, unique, emailedCode } from '../integration/helpers.mjs';
import { TWO_STEP } from './global-setup.mjs';

async function signIn(page, user) {
  await page.goto('/admin/#/ingresar');
  await page.getByLabel(/Correo electrónico|^Email$/).fill(user.email);
  await page.getByLabel(/^Contraseña$|^Password$/).fill(user.password);
  await page.getByRole('button', { name: /Iniciar sesión|Sign in/ }).click();
}

test('a person turns on two-step sign-in, signs in with a recovery code; IT removes their devices; a code by e-mail, then the new device', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one set-up is enough');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, TWO_STEP);
  await expect(page.locator('main h1')).toHaveText(/^Hola, /);
  await page.goto('/admin/#/cuenta');
  await page.getByRole('button', { name: 'Activar verificación en dos pasos' }).click();
  const dlg = page.getByRole('dialog', { name: 'Activar la verificación en dos pasos' });
  await dlg.getByLabel('Tu contraseña').fill(TWO_STEP.password);
  await dlg.getByRole('button', { name: 'Continuar' }).click();
  await expect(dlg.locator('img.qr')).toBeVisible();
  const v = (await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter((x) => ['serious', 'critical'].includes(x.impact));
  expect(v.map((x) => x.id)).toEqual([]);
  await dlg.getByText('¿No puedes escanear?').click();
  const secret = await dlg.locator('.code-line code').textContent();
  await dlg.getByLabel('Código de 6 dígitos').fill('000000');
  await dlg.getByRole('button', { name: 'Activar' }).click();
  await expect(dlg.getByText(/El código no es correcto/)).toBeVisible();
  await dlg.getByLabel('Código de 6 dígitos').fill(await totp(secret));
  const codes = dlg.locator('.recovery-codes li');
  await expect(codes).toHaveCount(10);
  const recovery = await codes.first().textContent();
  await expect(dlg.getByRole('button', { name: 'Listo' })).toBeDisabled();
  await dlg.getByLabel('Guardé mis códigos').check();
  await dlg.getByRole('button', { name: 'Listo' }).click();
  await expect(page.locator('#tf-t').locator('xpath=ancestor::section').getByText('Activada')).toBeVisible();

  // Sign in again: password, then the code (a recovery code here).
  await ctx.clearCookies();
  await page.goto('about:blank');
  await signIn(page, TWO_STEP);
  await expect(page.getByRole('heading', { name: 'Verificación en dos pasos' })).toBeVisible();
  await page.getByRole('button', { name: 'Usar un código de recuperación' }).click();
  await page.getByLabel('Código de recuperación').fill(recovery.trim());
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page.locator('main h1')).toHaveText(/^Hola, /);

  // IT removes their devices (lost phone).
  const owner = await (await browser.newContext()).newPage();
  await signIn(owner, ADMIN);
  await expect(owner.locator('main h1')).toHaveText(/^Hola, /);
  await owner.goto('/admin/#/seguridad');
  const row = owner.locator('.person-row', { hasText: TWO_STEP.name });
  await expect(row.getByText('Activada')).toBeVisible();
  await row.getByRole('button', { name: `Quitar los dispositivos registrados de ${TWO_STEP.name}` }).click();
  await expect(owner.getByRole('dialog')).toContainText('confirmará un código enviado a su correo');
  await owner.getByRole('dialog').getByLabel('Tu contraseña').fill(ADMIN.password);
  await owner.getByRole('dialog').getByRole('button', { name: 'Quitar dispositivos' }).click();
  await expect(owner.getByText(new RegExp(`Cuando ${TWO_STEP.name} entre, confirmará un código`))).toBeVisible();
  await expect(owner.locator('.person-row', { hasText: TWO_STEP.name }).getByText('Pendiente')).toBeVisible();

  // They sign in: password, the code sent to their e-mail («Reenviar código» works), then the new device.
  await ctx.clearCookies();
  await page.goto('about:blank');
  const before = await countTo(TWO_STEP.email);
  await signIn(page, TWO_STEP);
  await expect(page.getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible();
  await expect(page.getByText(/Enviamos un código de 6 dígitos a t•••@example\.test/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Usar un código de recuperación' })).toHaveCount(0);
  await emailedCode(TWO_STEP.email, before);
  await page.getByRole('button', { name: 'Reenviar código' }).click();
  await expect(page.getByText(/Te enviamos un código nuevo/)).toBeVisible();
  const code = await emailedCode(TWO_STEP.email, before + 1);
  await page.getByLabel('Código de 6 dígitos').fill(code);
  await expect(page.getByRole('heading', { name: 'Registra tu dispositivo nuevo' })).toBeVisible();
  const axe2 = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter((x) => ['serious', 'critical'].includes(x.impact));
  expect(axe2.map((x) => x.id)).toEqual([]);
  await page.getByLabel('Tu contraseña').fill(TWO_STEP.password);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByText('¿No puedes escanear?').click();
  const secret2 = await page.locator('.code-line code').textContent();
  await page.getByLabel('Código de 6 dígitos').fill(await totp(secret2)); // six digits activate it
  await expect(page.locator('.recovery-codes li')).toHaveCount(10);
  await page.getByLabel('Guardé mis códigos').check();
  await page.getByRole('button', { name: 'Ir al panel' }).click();
  await expect(page.locator('main h1')).toHaveText(/^Hola, /);
  await ctx.close();
});

test('IT sets up the encrypted backup and sends one now', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one backup is enough');
  const to = unique('respaldo-e2e');
  await signIn(page, ADMIN);
  await expect(page.locator('main h1')).toHaveText(/^Hola, /);
  await page.locator('.nav a[href="#/seguridad"]').click();
  await expect(page.locator('main h1')).toHaveText('Seguridad');
  await page.getByRole('switch', { name: 'Enviar respaldos automáticamente' }).check();
  await page.getByLabel('Enviar a').fill(to);
  await page.getByLabel('Contraseña de respaldos', { exact: true }).fill('corta');
  await page.getByLabel('Confirma la contraseña de respaldos').fill('corta');
  await page.locator('#sec-ob').locator('xpath=ancestor::section').getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Usa al menos 12 caracteres.')).toBeVisible();
  await page.getByLabel('Contraseña de respaldos', { exact: true }).fill('Respaldo-E2E-Sensum-2026');
  await page.getByLabel('Confirma la contraseña de respaldos').fill('Respaldo-E2E-Sensum-2026');
  await page.locator('#sec-ob').locator('xpath=ancestor::section').getByRole('button', { name: 'Guardar cambios' }).click();
  await page.getByRole('dialog').getByLabel('Tu contraseña').fill(ADMIN.password);
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Respaldo configurado.')).toBeVisible();
  await page.getByRole('button', { name: 'Enviar respaldo ahora' }).click();
  await expect(page.getByText(/Respaldo de .+ enviado a/)).toBeVisible();
  await waitForMail(to, 1);
  expect(await countTo(to)).toBe(1);
  await expect(page.getByText(/Último respaldo enviado:/)).toBeVisible();
});
