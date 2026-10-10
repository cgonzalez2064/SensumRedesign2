// Support tickets between a person on the team and IT (the owner), in real browsers.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN } from '../integration/helpers.mjs';
import { EDITOR } from './global-setup.mjs';

async function login(page, user) {
  await page.goto('/admin/#/ingresar');
  await page.getByLabel(/Correo electrónico|^Email$/).fill(user.email);
  await page.getByLabel(/^Contraseña$|^Password$/).fill(user.password);
  await page.getByRole('button', { name: /Iniciar sesión|Sign in/ }).click();
  await expect(page.locator('main h1')).toHaveText(/^(Hola|Hi), /);
}

test('IT asks for information, the person answers, IT resolves it', async ({ browser, baseURL }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one conversation is enough');
  const title = 'Ticket E2E ' + Date.now();
  const editorCtx = await browser.newContext();
  const ownerCtx = await browser.newContext();
  const ed = await editorCtx.newPage();
  const it = await ownerCtx.newPage();

  // The editor reports a problem.
  await login(ed, EDITOR);
  await ed.locator('.topbar .report-btn').click();
  const dlg = ed.getByRole('dialog', { name: /Reportar un problema/ });
  await dlg.getByLabel('Título').fill(title);
  await dlg.getByLabel('Descripción').fill('Al guardar la sección de servicios aparece un error.');
  await dlg.getByRole('button', { name: 'Enviar reporte' }).click();
  await dlg.getByRole('link', { name: /Ver el reporte #/ }).click();
  await expect(ed.locator('main h1')).toHaveText(title);
  await expect(ed.locator('.ticket-summary')).toContainText('Nuevo');

  // IT sees it unread and asks for more information.
  await login(it, ADMIN);
  await expect(it.locator('.nav a[data-nav="reports"] .nav-badge')).toBeVisible();
  await it.locator('.nav a[data-nav="reports"]').click();
  const row = it.locator('.ticket-row', { hasText: title });
  await expect(row).toHaveClass(/unread/);
  await row.click();
  await expect(it.locator('main h1')).toHaveText(title);
  await it.getByRole('button', { name: 'Pedir más información' }).click();
  const ask = it.getByRole('dialog', { name: 'Pedir más información' });
  await ask.getByRole('button', { name: 'Pedir más información' }).click();
  await expect(ask.getByText('Este campo es obligatorio.')).toBeVisible();
  await ask.getByLabel('¿Qué información necesitas?').fill('¿Qué mensaje de error aparece exactamente?');
  await ask.getByRole('button', { name: 'Pedir más información' }).click();
  await expect(it.getByText(/Estado: Esperando información\. Se avisó por correo\./)).toBeVisible();
  await expect(it.locator('.ticket-summary')).toContainText('Esperando información');
  await expect(it.locator('.timeline-msg.from-support')).toContainText('¿Qué mensaje de error aparece exactamente?');
  await expect(it.locator('.timeline-msg.from-support')).toContainText('Notificado por correo');

  // The editor sees the reply, the guidance, and answers.
  await ed.reload();
  await expect(ed.locator('.alert', { hasText: 'Soporte técnico necesita más información' })).toBeVisible();
  await expect(ed.locator('.timeline-event')).toContainText('Soporte técnico cambió el estado');
  await ed.getByLabel('Tu respuesta').fill('Dice «No se pudo guardar» y pasa siempre.');
  await ed.getByRole('button', { name: 'Enviar respuesta' }).click();
  await expect(ed.getByText('Respuesta enviada a soporte técnico.')).toBeVisible();
  await expect(ed.locator('.ticket-summary')).toContainText('En progreso');

  // IT adds an internal note and resolves it.
  await it.reload();
  await expect(it.locator('.timeline-msg.from-reporter')).toContainText('No se pudo guardar');
  await it.getByRole('button', { name: 'Nota interna' }).click();
  await it.getByLabel('Nota interna (solo la ve soporte técnico)').fill('Era el permiso de la carpeta storage.');
  await it.getByRole('button', { name: 'Guardar nota' }).click();
  await expect(it.getByText('Nota interna guardada.')).toBeVisible();
  await expect(it.locator('.timeline-msg.note')).toContainText('Era el permiso');
  await it.getByRole('button', { name: 'Marcar como resuelto' }).click();
  const solve = it.getByRole('dialog', { name: 'Marcar como resuelto' });
  await solve.getByLabel(/Mensaje para quien reportó/).fill('Corregido. Ya puedes guardar.');
  await solve.getByRole('button', { name: 'Marcar como resuelto' }).click();
  await expect(it.locator('.ticket-summary')).toContainText('Resuelto');
  const v = (await new AxeBuilder({ page: it }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter((x) => ['serious', 'critical'].includes(x.impact));
  expect(v.map((x) => x.id)).toEqual([]);

  // The editor: resolved, no internal note visible, offered to reopen.
  await ed.reload();
  await expect(ed.locator('.alert', { hasText: 'Marcado como resuelto' })).toBeVisible();
  await expect(ed.getByText('Era el permiso')).toHaveCount(0);
  await expect(ed.locator('.timeline-msg.from-support').last()).toContainText('Corregido');
  await editorCtx.close();
  await ownerCtx.close();
  void baseURL;
});
