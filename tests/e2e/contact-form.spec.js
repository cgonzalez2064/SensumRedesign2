// The contact form's questions (Sitio web → Formulario de contacto): edited in the panel,
// published on the website (ES/EN), answered by a visitor and kept in Prospectos.
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
async function axeOk(page) {
  const v = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.filter((x) => ['serious', 'critical'].includes(x.impact));
  expect(v.map((x) => `${x.id}: ${x.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
}
const row = (page, name) => page.locator('.fb-row').filter({ has: page.locator('.fb-label', { hasText: name }) });
const START = '¿Cuándo te gustaría iniciar?';

test('the team adds a question, makes the phone optional and edits the service options; the website asks it and Prospectos keeps the answer', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one full edit is enough');
  test.setTimeout(120000);
  await login(page);
  await page.locator('.nav a[href="#/formulario"]').click();
  await expect(page.locator('main h1')).toHaveText('Formulario de contacto');
  const rows = page.locator('.fb-row');
  await expect(rows).toHaveCount(5);
  await expect(page.locator('.save-row')).toContainText('Sin cambios pendientes');
  // The name cannot be removed; e-mail and phone can, one at a time.
  await expect(row(page, 'Nombre completo').getByRole('button', { name: /no se puede eliminar/ })).toBeDisabled();
  await expect(row(page, 'Nombre completo')).toContainText('Fija');

  // Service options: add one, remove one.
  await row(page, 'Servicio de interés').getByRole('button', { name: 'Editar «Servicio de interés»' }).click();
  const svc = row(page, 'Servicio de interés');
  await expect(svc.locator('.fb-opt')).toHaveCount(7);
  await svc.getByRole('button', { name: 'Agregar opción' }).click();
  await svc.getByLabel('Opción 8 en español').fill('Construcción de casas');
  await svc.getByLabel('Opción 8 en inglés').fill('Home building');
  await svc.getByRole('button', { name: 'Eliminar «Instalaciones generales»' }).click();
  await expect(svc.locator('.fb-opt')).toHaveCount(7);
  await svc.getByRole('button', { name: 'Listo' }).click();

  // A new single-choice question, required.
  await page.getByRole('button', { name: 'Agregar pregunta' }).click();
  const dlg = page.getByRole('dialog', { name: 'Agregar una pregunta' });
  await expect(dlg.locator('.fb-type-card')).toHaveCount(9);
  await axeOk(page);
  await dlg.getByRole('listitem').filter({ hasText: 'Opción única' }).click();
  const open = page.locator('.fb-row.open');
  await expect(open.locator('input[lang="es"]').first()).toBeFocused();
  await open.locator('input[lang="es"]').first().fill(START);
  await open.locator('input[lang="en"]').first().fill('When would you like to start?');
  await open.getByLabel('Opción 1 en español').fill('Lo antes posible');
  await open.getByLabel('Opción 1 en inglés').fill('As soon as possible');
  await open.getByLabel('Opción 2 en español').fill('En 1 a 3 meses');
  await open.getByRole('button', { name: 'Agregar opción' }).click();
  await open.getByLabel('Opción 3 en español').fill('Lo antes posible');
  await open.getByRole('switch').first().check();
  await axeOk(page);
  // Two options with the same text are caught before saving.
  await page.getByRole('button', { name: 'Guardar y publicar' }).click();
  await expect(page.getByText('Ya hay una opción con este nombre.')).toBeVisible();
  await page.locator('.fb-row.open').getByLabel('Opción 3 en español').fill('Solo estoy cotizando');
  await page.locator('.fb-row.open').getByRole('button', { name: 'Listo' }).click();
  await expect(row(page, START)).toContainText('Obligatoria');
  // It went before the message box; move it above "Servicio de interés".
  await expect(rows.nth(4).locator('.fb-label')).toHaveText(START);
  await row(page, START).getByRole('button', { name: `Subir «${START}»` }).click();
  await expect(rows.nth(3).locator('.fb-label')).toHaveText(START);

  // The phone becomes optional (the e-mail stays required); then the e-mail cannot.
  await row(page, 'Teléfono').getByRole('button', { name: 'Editar «Teléfono»' }).click();
  await row(page, 'Teléfono').getByRole('switch').uncheck();
  await row(page, 'Teléfono').getByRole('button', { name: 'Listo' }).click();
  await expect(row(page, 'Teléfono')).toContainText('Opcional');
  await row(page, 'Correo electrónico').getByRole('button', { name: 'Editar «Correo electrónico»' }).click();
  await expect(row(page, 'Correo electrónico').getByRole('switch')).toBeDisabled();
  await row(page, 'Correo electrónico').getByRole('button', { name: 'Listo' }).click();
  // Remove the message box and undo.
  await row(page, 'Cuéntanos sobre tu proyecto').getByRole('button', { name: 'Eliminar «Cuéntanos sobre tu proyecto»' }).click();
  await expect(rows).toHaveCount(5);
  await page.locator('.toast', { hasText: '«Cuéntanos sobre tu proyecto»' }).getByRole('button', { name: 'Deshacer' }).click();
  await expect(rows).toHaveCount(6);

  // The preview already shows it.
  const preview = page.locator('.svc-preview-card');
  await expect(preview.getByText(START)).toBeVisible();
  await expect(preview.locator('.sim-tag.new')).toHaveCount(1);
  await page.getByRole('button', { name: 'Guardar y publicar' }).click();
  await expect(page.getByText('Formulario guardado. El sitio ya muestra las preguntas nuevas.')).toBeVisible();
  await expect(page.locator('.save-row')).toContainText('Sin cambios pendientes');

  // The website, Spanish then English.
  await page.goto('/');
  const form = page.locator('#contactForm');
  const start = form.locator('fieldset', { has: page.locator('legend', { hasText: START }) });
  await expect(start.getByRole('radio')).toHaveCount(3);
  await expect(form.locator('label[for="phone"]')).toContainText('(opcional)');
  await expect(form.locator('#service option', { hasText: 'Construcción de casas' })).toHaveCount(1);
  await expect(form.locator('#service option', { hasText: 'Instalaciones generales' })).toHaveCount(0);
  await page.locator('#langToggle').click();
  await expect(form.locator('legend', { hasText: 'When would you like to start?' })).toBeVisible();
  await expect(form.locator('label[for="phone"]')).toContainText('(optional)');
  await expect(form.locator('#service option', { hasText: 'Home building' })).toHaveCount(1);
  await page.locator('#langToggle').click();

  // A visitor: the required question is checked, the phone may stay empty.
  await form.locator('#name').fill('Lucía Herrera');
  await form.locator('#email').fill('lucia.herrera@example.test');
  await form.locator('#service').selectOption({ label: 'Construcción de casas' });
  await form.locator('#message').fill('Queremos construir una casa de dos niveles.');
  await form.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(start.locator('xpath=..')).toHaveClass(/invalid/);
  await expect(form.getByText('Elige una opción.')).toBeVisible();
  await start.getByRole('radio', { name: 'En 1 a 3 meses' }).check();
  await expect(start.locator('xpath=..')).not.toHaveClass(/invalid/);
  await page.waitForTimeout(3200); // the site silently drops messages sent within 3 s of loading (robots)
  await form.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(page.locator('#formStatus')).toContainText('¡Gracias!', { timeout: 30000 });

  // Prospectos keeps the answer.
  await page.goto('/admin/#/prospectos');
  await page.getByRole('link', { name: /Lucía Herrera/ }).first().click();
  const answers = page.locator('.lead-answers');
  await expect(answers).toContainText(START);
  await expect(answers).toContainText('En 1 a 3 meses');

  // Back to the approved form so the other tests see it.
  await page.goto('/admin/#/formulario');
  await page.getByRole('button', { name: 'Restaurar el formulario original' }).click();
  await expect(rows).toHaveCount(5);
  await page.getByRole('button', { name: 'Guardar y publicar' }).click();
  await expect(page.getByText('Formulario guardado. El sitio ya muestra las preguntas nuevas.')).toBeVisible();
});

test('the preview works like the site: sizes, lists, changes marked and the error messages; nothing is sent', async ({ page }, info) => {
  const sent = [];
  page.on('request', (r) => { if (/contact-handler/.test(r.url()) || (r.method() === 'POST' && /\/api\/leads/.test(r.url()))) sent.push(r.url()); });
  await login(page);
  await page.goto('/admin/#/formulario');
  const card = page.locator('.svc-preview-card');
  const frame = card.locator('.sim-frame');
  const stage = card.locator('.sim-stage');
  await expect(card.getByRole('heading', { name: 'Envíanos un mensaje' })).toBeVisible();
  const sizes = card.getByRole('group', { name: 'Tamaño de pantalla' });
  const sideBySide = async () => {
    const [a, b] = [await card.getByLabel('Nombre completo').boundingBox(), await card.getByLabel('Teléfono').boundingBox()];
    return Math.abs(a.y - b.y) < 2;
  };
  await expect(frame).toHaveAttribute('data-device', 'phone');
  expect(await sideBySide()).toBe(false);
  await sizes.getByRole('button', { name: 'Tableta' }).click();
  await expect.poll(sideBySide).toBe(true);
  const fits = async () => (await frame.boundingBox()).width <= (await stage.boundingBox()).width + 1;
  await expect.poll(fits).toBe(true);
  await sizes.getByRole('button', { name: 'Computadora' }).click();
  await expect.poll(fits).toBe(true);
  await sizes.getByRole('button', { name: 'Celular' }).click();

  // Unsaved changes are marked: an edited question and a new one.
  await page.locator('.fb-row').filter({ hasText: 'Servicio de interés' }).getByRole('button', { name: 'Editar «Servicio de interés»' }).click();
  await page.locator('.fb-row.open').getByLabel('Opción 1 en español').fill('Remodelaciones y ampliaciones');
  await page.locator('.fb-row.open').getByRole('button', { name: 'Listo' }).click();
  await page.getByRole('button', { name: 'Agregar pregunta' }).click();
  await page.getByRole('dialog').getByRole('listitem').filter({ hasText: 'Texto corto' }).click();
  await page.locator('.fb-row.open input[lang="es"]').first().fill('Ubicación del proyecto');
  await page.locator('.fb-row.open').getByRole('button', { name: 'Listo' }).click();
  await expect(card.locator('label', { hasText: 'Servicio de interés' }).locator('.sim-tag')).toHaveText('Modificada');
  await expect(card.locator('label', { hasText: 'Ubicación del proyecto' }).locator('.sim-tag')).toHaveText('Nueva');
  await expect(card.locator('label', { hasText: 'Ubicación del proyecto' })).toContainText('(opcional)');
  const select = card.getByRole('button', { name: /Servicio de interés/ });
  await select.click();
  const list = card.getByRole('listbox');
  await expect(list).toBeVisible();
  await axeOk(page);
  await list.getByRole('option', { name: 'Remodelaciones y ampliaciones' }).click();
  await expect(list).toBeHidden();
  await expect(select).toContainText('Remodelaciones y ampliaciones');

  // Sending empty shows the site's error messages; nothing is sent.
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
  await card.getByRole('button', { name: 'English' }).click();
  await expect(card.getByRole('heading', { name: 'Send us a message' })).toBeVisible();
  await expect(card.getByLabel('Full name')).toHaveValue('Ana López');
  await expect(page.locator('.save-row')).toContainText('Tienes cambios sin guardar');
  // Nothing was saved: leaving asks first, and coming back shows the saved form.
  await page.goto('/admin/#/');
  await page.getByRole('dialog', { name: '¿Salir sin guardar?' }).getByRole('button', { name: 'Salir sin guardar' }).click();
  await expect(page.locator('main h1')).toHaveText(/^Hola, /);
  await page.goto('/admin/#/formulario');
  await expect(page.locator('.fb-row')).toHaveCount(5);
  if (info.project.name === 'iphone-webkit') expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('who receives the messages: the owner changes it, confirming with the password', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one browser is enough');
  await login(page);
  await page.goto('/admin/#/formulario');
  const card = page.locator('section', { has: page.locator('#fb-rcpt') });
  await expect(card.getByRole('heading', { name: '¿Quién recibe los mensajes?' })).toBeVisible();
  const before = await card.locator('.tag').allTextContents();
  await card.getByLabel('Agregar un correo').fill('no-es-correo');
  await card.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(card.getByText('Escribe un correo válido.')).toBeVisible();
  await card.getByLabel('Agregar un correo').fill('ventas.e2e@example.test');
  await card.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(card.locator('.tag')).toHaveCount(before.length + 1);
  await card.getByRole('button', { name: 'Guardar destinatarios' }).click();
  const dlg = page.getByRole('dialog', { name: 'Confirma que eres tú' });
  await dlg.getByLabel('Tu contraseña').fill('incorrecta');
  await dlg.getByRole('button', { name: 'Guardar destinatarios' }).click();
  await expect(page.locator('.toast')).toContainText(/contraseña/i);
  await card.getByRole('button', { name: 'Guardar destinatarios' }).click();
  await page.getByRole('dialog', { name: 'Confirma que eres tú' }).getByLabel('Tu contraseña').fill(ADMIN.password);
  await page.getByRole('dialog', { name: 'Confirma que eres tú' }).getByRole('button', { name: 'Guardar destinatarios' }).click();
  await expect(page.getByText('Listo: los mensajes del formulario llegarán a los correos nuevos.')).toBeVisible();
  // Back as it was.
  await card.getByRole('button', { name: 'Quitar ventas.e2e@example.test' }).click();
  await card.getByRole('button', { name: 'Guardar destinatarios' }).click();
  await page.getByRole('dialog', { name: 'Confirma que eres tú' }).getByLabel('Tu contraseña').fill(ADMIN.password);
  await page.getByRole('dialog', { name: 'Confirma que eres tú' }).getByRole('button', { name: 'Guardar destinatarios' }).click();
  await expect(card.locator('.tag')).toHaveCount(before.length);
});
