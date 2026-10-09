// Owner-only e-mail settings (Administración → Correo) and the automatic alerts in Monitoring.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN } from '../integration/helpers.mjs';

async function login(page, user = ADMIN) {
  await page.goto('/admin/#/ingresar');
  await page.getByLabel(/Correo electrónico|^Email$/).fill(user.email);
  await page.getByLabel(/^Contraseña$|^Password$/).fill(user.password);
  await page.getByRole('button', { name: /Iniciar sesión|Sign in/ }).click();
  await expect(page.locator('main h1')).toHaveText(/^(Hola|Hi), /);
}

const seriousViolations = async (page, include) => {
  let b = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']);
  if (include) b = b.include(include);
  const v = (await b.analyze()).violations.filter((x) => ['serious', 'critical'].includes(x.impact));
  if (process.env.AXE_DEBUG) console.log(JSON.stringify(v.map((x) => x.nodes.map((n) => [n.target, n.failureSummary])), null, 1));
  return v.map((x) => x.id);
};

test('the owner configures the contact form and the sending account', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one save is enough');
  await login(page);
  await page.locator('.nav a[href="#/correo"]').click();
  await expect(page.locator('main h1')).toHaveText('Correo');
  // Where each value comes from (.env on a fresh install, the panel once saved).
  await expect(page.getByText(/Tomado del archivo de configuración del servidor|Configurado en este panel/).first()).toBeVisible();

  const to = page.getByLabel('Recibe los mensajes');
  await to.fill('contacto@sensumconstrucciones.com, no-es-correo');
  await page.getByRole('button', { name: 'Guardar configuración' }).click();
  await expect(page.getByText('Escribe de 1 a 3 correos válidos, separados por coma.')).toBeVisible();
  await expect(to).toBeFocused();
  await to.fill('contacto@sensumconstrucciones.com');
  await page.getByLabel('Correo que envía los mensajes').fill('formulario@sensumconstrucciones.com');
  await page.getByLabel('Correo remitente').fill('notificaciones@sensumconstrucciones.com');
  await page.getByLabel(/Las respuestas llegan a/).fill('soporte@sensumconstrucciones.com');

  // Password confirmation: wrong, then right.
  await page.getByRole('button', { name: 'Guardar configuración' }).click();
  const dlg = page.getByRole('dialog', { name: 'Confirma que eres tú' });
  await expect(dlg).toBeVisible();
  await dlg.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished))); // scan the settled dialog, not its fade-in
  expect(await seriousViolations(page, 'dialog')).toEqual([]);
  await dlg.getByLabel('Tu contraseña').fill('no-es-mi-clave');
  await dlg.getByRole('button', { name: 'Guardar configuración' }).click();
  await expect(page.getByText('La contraseña actual no es correcta.')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar configuración' }).click();
  await page.getByRole('dialog', { name: 'Confirma que eres tú' }).getByLabel('Tu contraseña').fill(ADMIN.password);
  await page.getByRole('dialog', { name: 'Confirma que eres tú' }).getByLabel('Tu contraseña').press('Enter');
  await expect(page.getByText('Configuración guardada. Te enviamos un aviso de seguridad por correo.')).toBeVisible();
  await expect(page.getByText('Configurado en este panel.').first()).toBeVisible();

  // Test e-mails (Mailpit receives them in the test environment).
  await page.getByRole('button', { name: 'Enviar mensaje de prueba' }).click();
  await expect(page.getByText(/Correo de prueba enviado a contacto@sensumconstrucciones.com/)).toBeVisible();
  await page.getByRole('button', { name: 'Enviar correo de prueba' }).click();
  await expect(page.getByText(/Correo de prueba enviado a .*ana\.admin@example\.test/)).toBeVisible();

  // Namecheap helper fills the server details (not saved here).
  await page.getByRole('button', { name: 'Completar con los datos de Namecheap' }).click();
  await expect(page.getByLabel('Servidor', { exact: true })).toHaveValue('mail.sensumconstrucciones.com');
  await expect(page.getByLabel('Puerto')).toHaveValue('465');
  await page.reload();
  await expect(page.getByLabel('Servidor', { exact: true })).toHaveValue('127.0.0.1');
  expect(await seriousViolations(page)).toEqual([]);
});

test('Monitoring lists the automatic alerts and the file check', async ({ page }) => {
  await login(page);
  await page.goto('/admin/#/monitoreo');
  const rules = page.locator('section[aria-labelledby="rules-title"]');
  await expect(rules.getByRole('heading', { name: 'Alertas automáticas' })).toBeVisible();
  await expect(rules.getByRole('checkbox')).toHaveCount(12);
  const weekly = rules.getByRole('checkbox', { name: 'Resumen técnico semanal' });
  await expect(weekly).toBeChecked();
  await weekly.uncheck();
  await expect(page.getByText('«Resumen técnico semanal» desactivada.')).toBeVisible();
  await page.reload();
  await expect(page.locator('section[aria-labelledby="rules-title"]').getByRole('checkbox', { name: 'Resumen técnico semanal' })).not.toBeChecked();
  await page.locator('section[aria-labelledby="rules-title"]').getByRole('checkbox', { name: 'Resumen técnico semanal' }).check();
  await expect(page.getByText('«Resumen técnico semanal» activada.')).toBeVisible();

  const files = page.locator('section[aria-labelledby="integ-title"]');
  await files.getByRole('button', { name: 'Revisar ahora' }).click();
  await expect(files.locator('.ok-text, .warn-text').first()).toBeVisible();
});
