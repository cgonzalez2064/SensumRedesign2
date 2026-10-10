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
  // The preview's option list (the site's select, opened).
  const preview = page.locator('#sim-list [role="option"]:not(.placeholder) > span:first-child');
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
  await page.locator('.svc-preview-card').getByRole('button', { name: 'Español' }).click();
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

test('the preview works like the site: sizes, the open list, changes marked and the error messages', async ({ page }, info) => {
  const sent = [];
  page.on('request', (r) => { if (/contact-handler/.test(r.url()) || (r.method() === 'POST' && /\/api\/leads/.test(r.url()))) sent.push(r.url()); });
  await login(page);
  await page.goto('/admin/#/formulario');
  const card = page.locator('.svc-preview-card');
  const frame = card.locator('.sim-frame');
  const stage = card.locator('.sim-stage');
  await expect(card.getByRole('heading', { name: 'Envíanos un mensaje' })).toBeVisible();
  // Screen sizes: the phone layout stacks name and phone; tablet and computer put them side by side.
  const sizes = card.getByRole('group', { name: 'Tamaño de pantalla' });
  const sideBySide = async () => {
    const [a, b] = [await card.getByLabel('Nombre completo').boundingBox(), await card.getByLabel('Teléfono').boundingBox()];
    return Math.abs(a.y - b.y) < 2;
  };
  await expect(frame).toHaveAttribute('data-device', 'phone');
  expect(await sideBySide()).toBe(false);
  await sizes.getByRole('button', { name: 'Tableta' }).click();
  await expect(frame).toHaveAttribute('data-device', 'tablet');
  await expect.poll(sideBySide).toBe(true);
  // Never wider than the card: scaled down to fit.
  const fits = async () => (await frame.boundingBox()).width <= (await stage.boundingBox()).width + 1;
  await expect.poll(fits).toBe(true);
  await sizes.getByRole('button', { name: 'Computadora' }).click();
  await expect(frame).toHaveAttribute('data-device', 'desktop');
  await expect.poll(fits).toBe(true);
  await expect.poll(sideBySide).toBe(true); // like the site above 560 px
  await sizes.getByRole('button', { name: 'Celular' }).click();

  // Changes not saved yet are marked in the list.
  const rows = page.locator('.svc-row');
  await rows.nth(0).getByLabel('Español').fill('Remodelaciones y ampliaciones');
  await page.getByRole('button', { name: 'Agregar opción' }).click();
  await rows.nth(6).getByLabel('Español').fill('Pérgolas');
  const select = card.getByRole('button', { name: /Servicio de interés/ });
  await expect(select).toHaveAttribute('aria-expanded', 'false');
  await select.click();
  const list = card.getByRole('listbox');
  await expect(list).toBeVisible();
  await expect(list.getByRole('option', { name: /Remodelaciones y ampliaciones/ })).toContainText('Modificada');
  await expect(list.getByRole('option', { name: /Pérgolas/ })).toContainText('Nueva');
  await expect(list.getByRole('option', { name: /Obra civil/ }).locator('.sim-tag')).toHaveCount(0);
  await axeOk(page);

  // Sending empty shows the site's error messages; nothing is sent.
  await list.getByRole('option', { name: /Pérgolas/ }).click();
  await expect(list).toBeHidden();
  await expect(select).toContainText('Pérgolas');
  await card.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(card.getByRole('status')).toHaveText('Revisa los campos marcados.');
  await expect(card.getByText('Ingresa tu nombre completo.')).toBeVisible();
  await expect(card.getByLabel('Nombre completo')).toHaveAttribute('aria-invalid', 'true');
  await expect(card.getByText('Selecciona el servicio que te interesa.')).toBeHidden();
  await card.getByLabel('Nombre completo').fill('Ana López');
  await card.getByLabel('Teléfono').fill('5555-1234');
  await card.getByLabel('Correo electrónico').fill('ana@example.test');
  await card.getByLabel('Cuéntanos sobre tu proyecto').fill('Una pérgola para el jardín.');
  await card.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(card.getByRole('status')).toContainText('vista previa, no se envió');
  expect(sent).toEqual([]);
  // In English, with the same choice.
  await card.getByRole('button', { name: 'English' }).click();
  await expect(card.getByRole('heading', { name: 'Send us a message' })).toBeVisible();
  await expect(card.getByLabel('Full name')).toHaveValue('Ana López');
  await expect(page.locator('.save-row')).toContainText('Tienes cambios sin guardar');
  // Nothing was saved: leaving asks first, and coming back shows the saved options.
  await page.goto('/admin/#/');
  await page.getByRole('dialog', { name: '¿Salir sin guardar?' }).getByRole('button', { name: 'Salir sin guardar' }).click();
  await expect(page.locator('main h1')).toHaveText(/^Hola, /);
  await page.goto('/admin/#/formulario');
  await expect(rows.nth(0).getByLabel('Español')).toHaveValue('Remodelaciones');
  if (info.project.name === 'iphone-webkit') expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

async function axeOk(page) {
  const v = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.filter((x) => ['serious', 'critical'].includes(x.impact));
  expect(v.map((x) => `${x.id}: ${x.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
}
