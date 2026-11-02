// «Avisos al equipo» in real browsers: Inicio reminds the owner of «Novedades»
// the team hasn't had by e-mail; the owner picks one, writes a message, sends a
// test and then the announcement; the people get it (Mailpit) and it is logged.
// Each device sends a different «Novedad» (nobody gets the same one twice).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN, waitForMail, message, messagesTo } from '../integration/helpers.mjs';
import { EDITOR } from './global-setup.mjs';

const ITEM = { 'desktop-chrome': 'Nueva wiki del panel', 'tablet-chrome': '¿Cambiaste de teléfono?', 'iphone-webkit': 'El panel, más cómodo' };

async function signIn(page) {
  await page.goto('/admin/#/ingresar');
  await page.getByLabel(/Correo electrónico|^Email$/).fill(ADMIN.email);
  await page.getByLabel(/^Contraseña$|^Password$/).fill(ADMIN.password);
  await page.getByRole('button', { name: /Iniciar sesión|Sign in/ }).click();
  await expect(page.locator('main h1')).toHaveText(/^(Te damos la bienvenida|Hola), /);
  if (await page.getByRole('button', { name: 'Guardar y continuar' }).isVisible()) await page.getByRole('button', { name: 'Guardar y continuar' }).click();
  await expect(page.locator('main h1')).toHaveText(/^Hola, /);
}
async function axe(page) {
  const v = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.filter((x) => ['serious', 'critical'].includes(x.impact));
  expect(v.map((x) => `${x.id}: ${x.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
}
const noSideScroll = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

test('the owner tells the team what is new: one «Novedad», a message, a test, then the announcement', async ({ page }, info) => {
  const item = ITEM[info.project.name];
  await signIn(page);
  // Inicio: the reminder after an update.
  const nudge = page.locator('.announce-nudge');
  await expect(nudge).toContainText(/novedad(es)? que el equipo aún no recibió por correo/);
  await nudge.getByRole('link', { name: 'Avisar al equipo' }).click();
  await expect(page.locator('main h1')).toHaveText('Avisos al equipo');
  await expect(page.locator('.nav a[href="#/avisos"]')).toHaveAttribute('aria-current', 'page');

  // Only this device's «Novedad» (.all() does not wait: the list loads after the title).
  await expect(page.locator('.announce-item input').first()).toBeVisible();
  for (const box of await page.locator('.announce-item input').all()) await box.uncheck();
  await expect(page.getByText('Elige al menos una novedad.')).toBeVisible();
  await page.locator('.announce-item', { hasText: item }).locator('input').check();
  await expect(page.locator('.announce-count')).toHaveText(/^Lo recibirán \d+ personas:$/);
  const count = Number((await page.locator('.announce-count').textContent()).match(/\d+/)[0]);
  expect(count).toBeGreaterThan(1);
  await expect(page.locator('.announce-people li', { hasText: EDITOR.name })).toBeVisible();
  await page.getByLabel(/^Tu mensaje/).fill(`Actualizamos el panel (${info.project.name}).`);
  await axe(page);
  await noSideScroll(page);

  // A test to the owner first.
  const before = (await messagesTo(ADMIN.email)).length;
  await page.getByRole('button', { name: 'Enviarme una prueba' }).click();
  await expect(page.getByText(`Te enviamos una prueba a ${ADMIN.email}.`)).toBeVisible();
  const test1 = await message((await waitForMail(ADMIN.email, before + 1))[0].ID);
  expect(test1.Subject).toBe('[Prueba] Novedades en el Administrador de contenido');
  expect(test1.Text).toContain(item);

  // Then everyone (on phones, from the bar at the bottom).
  const send = page.getByRole('button', { name: `Enviar a ${count} personas` });
  await expect(send).toBeVisible();
  await send.click();
  const dlg = page.getByRole('dialog', { name: '¿Enviar el aviso?' });
  await dlg.getByRole('button', { name: 'Enviar aviso' }).click();
  await expect(page.getByText(`Aviso enviado a ${count} personas.`)).toBeVisible();
  await expect(page.locator('.announce-history li').first()).toContainText(item);
  await expect(page.locator('.announce-item', { hasText: item })).toHaveClass(/is-done/);

  // Elena (Editor) got it, with the owner's words and the wiki link.
  await expect.poll(async () => (await messagesTo(EDITOR.email)).filter((m) => m.Subject === 'Novedades en el Administrador de contenido').length).toBeGreaterThan(0);
  const mails = (await messagesTo(EDITOR.email)).filter((m) => m.Subject === 'Novedades en el Administrador de contenido');
  const bodies = await Promise.all(mails.map((m) => message(m.ID)));
  const got = bodies.find((b) => b.Text.includes(item));
  expect(got, 'the e-mail with this «Novedad»').toBeTruthy();
  expect(got.Text).toContain(`Actualizamos el panel (${info.project.name}).`);
  expect(got.HTML).toContain('/admin/#/wiki/');
});

test('«No avisar»: an item set aside is marked, and «Volver a proponer» brings it back', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one browser is enough');
  await signIn(page);
  await page.goto('/admin/#/avisos');
  await expect(page.locator('main h1')).toHaveText('Avisos al equipo');
  const item = page.locator('.announce-item', { hasText: 'Más secciones: pide lo que necesitas' });
  await expect(item).toBeVisible();
  for (const box of await page.locator('.announce-item input:checked').all()) await box.uncheck();
  await item.locator('input').check();
  await page.getByRole('button', { name: 'No avisar las marcadas' }).click();
  await expect(page.getByText('Listo: esas novedades quedan sin aviso.', { exact: false })).toBeVisible();
  await expect(item.locator('.badge', { hasText: 'Sin aviso' })).toBeVisible();
  await expect(item.locator('input')).not.toBeChecked();
  // The e-mail to the owner about new «Novedades» is on by default.
  await expect(page.locator('#announce-notify')).toBeChecked();
  await item.getByRole('button', { name: 'Volver a proponer' }).click();
  await expect(page.getByText('La novedad vuelve a estar pendiente de aviso.')).toBeVisible();
  await expect(item.locator('.badge', { hasText: 'Sin aviso' })).toHaveCount(0);
  await expect(item.locator('input')).toBeChecked();
});
