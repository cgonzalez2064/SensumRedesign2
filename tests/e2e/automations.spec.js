// Accounts and automations in the browser: Inicio → Accesos, answering an
// access request, inviting with temporary access (and the e-mail typo hint),
// the message to send with a given password, Actividad, asking for access from
// a screen you can't open, Seguridad's account rules, Prospectos' automation
// and the visitor's confirmation, and remembering a browser for two-step sign-in.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { ADMIN, Client, waitForMail, message, linkToken, totp } from '../integration/helpers.mjs';
import { OTHER_ADMIN, SALES } from './global-setup.mjs';

const BASE = 'http://127.0.0.1:8210';
const tag = (info) => ({ 'desktop-chrome': 'Escritorio', 'tablet-chrome': 'Tableta', 'iphone-webkit': 'Celular' }[info.project.name] || info.project.name);
const phone = (info) => info.project.name === 'iphone-webkit';

async function signIn(page, user) {
  await page.goto('/admin/#/ingresar');
  await page.getByLabel(/Correo electrónico|^Email$/).fill(user.email);
  await page.getByLabel(/^Contraseña$|^Password$/).fill(user.password);
  await page.getByRole('button', { name: /Iniciar sesión|Sign in/ }).click();
  await home(page);
}
/** After signing in: the first-time welcome (once per account) or straight to Inicio. */
async function home(page) {
  await expect(page.locator('main h1')).toHaveText(/^(Te damos la bienvenida|Hola), /);
  if (await page.getByRole('button', { name: 'Guardar y continuar' }).isVisible()) await page.getByRole('button', { name: 'Guardar y continuar' }).click();
  await expect(page.locator('main h1')).toHaveText(/^Hola, /);
}
async function axe(page) {
  const v = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.filter((x) => ['serious', 'critical'].includes(x.impact));
  expect(v.map((x) => `${x.id}: ${x.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
}
const noSideScroll = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

/** An active account made by the owner through the API (its own password). */
async function account(info, name, permissions) {
  const owner = new Client(BASE);
  await owner.login();
  const email = `${name.split(' ')[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()}.${info.project.name}.${Date.now()}@example.test`;
  const r = await owner.post('/api/users', { name, email, permissions, lang: 'es' });
  expect(r.status, r.text).toBe(200);
  const token = linkToken((await message((await waitForMail(email, 1))[0].ID)).Text, 'invitacion');
  const password = 'Clave-Automatica-2026';
  const c = new Client(BASE);
  expect((await c.post('/api/auth/invitation/accept', { token, name, password, passwordConfirm: password })).status).toBe(200);
  c.csrf = (await c.get('/api/auth/session')).data.csrf;
  return { id: r.data.user.id, email, password, name, c };
}

test('a site administrator sees what needs attention on Inicio and grants an access request with one click', async ({ page }, info) => {
  const marina = await account(info, `Marina ${tag(info)}`, ['texts', 'contact', 'photos', 'documents']);
  expect((await marina.c.post('/api/account/access-request', { permissions: ['leads'], message: 'Para la campaña.' })).status).toBe(200);
  await signIn(page, OTHER_ADMIN);
  const access = page.locator('#access-title').locator('xpath=ancestor::section');
  await expect(access).toBeVisible();
  await access.getByRole('link', { name: /solicitud(es)? de acceso/ }).click();
  await expect(page.locator('main h1')).toHaveText('Usuarios');
  const card = page.locator('.requests-card');
  await expect(card).toContainText(marina.name);
  await expect(card).toContainText('Para la campaña.');
  await axe(page);
  await noSideScroll(page);
  await card.getByRole('button', { name: `Dar acceso a ${marina.name}` }).click();
  await expect(page.getByText(`Listo: ${marina.name} ya tiene el acceso. Le avisamos por correo.`)).toBeVisible();
  await expect(page.locator('.request-row', { hasText: marina.name })).toHaveCount(0);
  // "?revisar=" links from Inicio and the e-mails open the matching filter (tabs; a menu on phones).
  await page.goto('/admin/#/usuarios?revisar=invitaciones');
  await expect(page.locator('main h1')).toHaveText('Usuarios');
  if (phone(info)) {
    await expect(page.locator('#users-view')).toHaveValue('invitaciones');
    await expect(page.locator('.users-tabs')).toBeHidden();
  } else {
    await expect(page.locator('.users-tabs').getByRole('button', { name: /^Invitaciones/ })).toHaveAttribute('aria-pressed', 'true');
  }
});

test('inviting with temporary access and a typo hint; a given password comes with a message ready to send', async ({ page, browserName }, info) => {
  if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page, OTHER_ADMIN);
  await page.goto('/admin/#/usuarios');
  await page.getByRole('button', { name: 'Invitar usuario' }).click();
  const dlg = page.getByRole('dialog');
  const name = `Carla ${tag(info)}`;
  const local = `carla.${info.project.name}.${Date.now()}`;
  await dlg.getByLabel('Nombre').fill(name);
  await dlg.getByLabel('Correo electrónico').fill(`${local}@hotmial.com`);
  await dlg.getByLabel('Nombre').focus();
  await expect(dlg.locator('.email-hint')).toContainText(`¿Quisiste decir ${local}@hotmail.com?`);
  await dlg.getByRole('button', { name: 'Usar este' }).click();
  await expect(dlg.getByLabel('Correo electrónico')).toHaveValue(`${local}@hotmail.com`);
  await expect(dlg.locator('.email-hint')).toBeHidden();
  // It ends by itself: the switch shows the date (30 days ahead by default).
  await expect(dlg.getByLabel('Acceso hasta')).toBeHidden();
  await dlg.getByRole('switch', { name: 'Acceso temporal' }).check();
  await expect(dlg.getByLabel('Acceso hasta')).toBeVisible();
  await axe(page);
  await dlg.getByRole('button', { name: 'Enviar invitación' }).click();
  await expect(page.getByText(`Invitación enviada a ${local}@hotmail.com.`)).toBeVisible();
  await page.getByLabel(/Buscar por nombre/).fill(name);
  await expect(page.locator('.users-count')).toHaveText(/^1 de \d+ personas$/);
  await expect(page.locator('.table-wrap:visible, .list-cards:visible').getByText(/^Acceso hasta el /).first()).toBeVisible();

  // Give them a password: the message to send has where, who and the password.
  await page.locator('.table-wrap:visible, .list-cards:visible').getByRole('button', { name: `Acciones para ${name}`, exact: true }).first().click();
  await page.locator('.menu-panel').getByRole('button', { name: 'Establecer contraseña' }).click();
  const set = page.getByRole('dialog');
  await expect(set.locator('output.pw-generated')).toHaveText(/\d{3}$/);
  const password = await set.locator('output.pw-generated').textContent();
  await set.getByLabel('Tu contraseña (para confirmar)').fill(OTHER_ADMIN.password);
  await set.getByRole('button', { name: 'Guardar contraseña' }).click();
  const done = page.getByRole('dialog', { name: 'Contraseña guardada' });
  const msg = done.locator('.share-message');
  await expect(msg).toContainText(`Hola ${name.split(' ')[0]}:`);
  await expect(msg).toContainText(`Correo: ${local}@hotmail.com`);
  await expect(msg).toContainText(`Contraseña temporal: ${password}`);
  await expect(done.getByRole('button', { name: 'Copiar contraseña' })).toBeVisible();
  if (browserName === 'chromium') {
    await done.getByRole('button', { name: 'Copiar mensaje' }).click();
    await expect(page.getByText('Mensaje copiado.')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(password);
  }
  await axe(page);
  await noSideScroll(page);
});

test('Actividad: a person\'s history from Usuarios, filters and the export for Excel', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one browser is enough for the export');
  const p = await account(info, `Rita ${tag(info)}`, ['texts']);
  await signIn(page, OTHER_ADMIN);
  await page.goto('/admin/#/usuarios');
  await page.getByLabel(/Buscar por nombre/).fill(p.name);
  await page.locator('.table-wrap').getByRole('button', { name: `Acciones para ${p.name}`, exact: true }).click();
  await page.locator('.menu-panel').getByRole('button', { name: 'Cerrar sus sesiones' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar sesiones' }).click();
  await expect(page.getByText(new RegExp(`Cerramos 1 sesión de ${p.name}|${p.name} no tenía sesiones abiertas`))).toBeVisible();
  await page.locator('.table-wrap').getByRole('button', { name: `Acciones para ${p.name}`, exact: true }).click();
  await page.locator('.menu-panel').getByRole('button', { name: 'Ver actividad' }).click();
  await expect(page).toHaveURL(new RegExp(`#/actividad\\?persona=${p.id}$`));
  await expect(page.locator('main h1')).toHaveText('Actividad');
  await expect(page.getByLabel('Persona')).toHaveValue(String(p.id));
  const list = page.locator('.activity-list');
  await expect(list.getByText(/cerró las sesiones de un usuario/).first()).toBeVisible();
  await expect(list.getByText(/activó su cuenta/).first()).toBeVisible();
  await expect(page.locator('.activity-day-title').first()).toHaveText(/^Hoy$/i);
  await axe(page);
  await page.getByLabel('Tipo').selectOption('content');
  await expect(page.getByText('Nada con estos filtros')).toBeVisible();
  await page.getByRole('button', { name: 'Quitar filtros' }).click();
  await expect(page.getByLabel('Persona')).toHaveValue('');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar a Excel' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^actividad-sensum-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync(await download.path(), 'utf8');
  expect(csv.split('\r\n')[0]).toBe('﻿"Fecha","Persona","Acción","Sobre","Tipo"');
  expect(csv).toContain('"cerró las sesiones de un usuario","' + p.name + '"');
});

test('a screen you can\'t open says so and lets you ask for it; Mi cuenta shows the request', async ({ page }, info) => {
  const p = await account(info, `Nora ${tag(info)}`, ['texts', 'contact', 'photos', 'documents']);
  await signIn(page, p);
  await page.goto('/admin/#/prospectos');
  await expect(page.locator('main h1')).toHaveText('No tienes acceso a esta sección');
  await axe(page);
  await page.getByRole('button', { name: 'Pedir acceso' }).click();
  const dlg = page.getByRole('dialog', { name: 'Pedir acceso' });
  await expect(dlg.getByRole('checkbox', { name: /^Prospectos/ })).toBeChecked();
  await expect(dlg.getByRole('checkbox', { name: /^Textos del sitio/ })).toHaveCount(0);
  await dlg.getByLabel(/^Mensaje/).fill('Para atender los mensajes del sitio.');
  await axe(page);
  await noSideScroll(page);
  await dlg.getByRole('button', { name: 'Enviar solicitud' }).click();
  await expect(page.getByText('Solicitud enviada. Te avisaremos por correo cuando la revisen.')).toBeVisible();
  await page.goto('/admin/#/cuenta');
  await expect(page.getByText(/Pediste Prospectos el .+\. Está pendiente\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cambiar solicitud' })).toBeVisible();
  await page.goto('/admin/#/monitoreo');
  await expect(page.locator('main h1')).toHaveText('No tienes acceso a esta sección');
  await expect(page.getByText('Esta sección es solo para la cuenta propietaria.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pedir acceso' })).toHaveCount(0);
});

test('Seguridad: the account rules; Prospectos: automation, the person in charge and the visitor\'s confirmation', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'settings shared by every device');
  await signIn(page, ADMIN);
  await page.goto('/admin/#/seguridad');
  const accounts = page.locator('#sec-acc').locator('xpath=ancestor::section');
  await expect(page.getByLabel('Exigir verificación en dos pasos a').locator('option')).toContainText(['La cuenta propietaria y quienes administran']);
  await accounts.getByLabel('Desactivar cuentas sin uso').selectOption('120');
  await accounts.getByRole('button', { name: 'Guardar cambios' }).click();
  const ask = page.getByRole('dialog');
  await ask.getByLabel(/Tu contraseña/).fill(ADMIN.password);
  await ask.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Reglas de las cuentas guardadas.')).toBeVisible();
  await expect(page.locator('#sec-acc').locator('xpath=ancestor::section').getByLabel('Desactivar cuentas sin uso')).toHaveValue('120');
  await axe(page);
  const owner = new Client(BASE);
  await owner.login();
  expect((await owner.put('/api/security/accounts', { inactiveDays: 0, currentPassword: ADMIN.password })).status).toBe(200);

  // Prospectos (as the site administrator).
  await page.context().clearCookies();
  await page.goto('about:blank');
  await signIn(page, OTHER_ADMIN);
  await page.goto('/admin/#/prospectos');
  const auto = page.locator('#lead-auto').locator('xpath=ancestor::section');
  await auto.getByLabel('Responsable de Remodelaciones').selectOption({ label: SALES.name });
  await auto.getByLabel('Recordatorio si sigue «Nuevo»').selectOption('24');
  await auto.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Automatización guardada.')).toBeVisible();
  await axe(page);
  // The visitor's confirmation: off; the example shows the placeholders filled.
  const cf = page.locator('#cf-title').locator('xpath=ancestor::section');
  await expect(cf.getByRole('switch', { name: 'Enviar la confirmación' })).not.toBeChecked();
  await cf.getByText('Ver con un ejemplo').first().click();
  await expect(cf.locator('.confirm-sample').first()).toContainText('Estimado(a) Ana:');
  await cf.getByRole('button', { name: '{servicio}' }).first().click();
  await expect(cf.locator('.confirm-sample').first()).toContainText('Remodelaciones');
  await cf.getByRole('switch', { name: 'Enviar la confirmación' }).check();
  await cf.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Guardado. La confirmación ya se envía.')).toBeVisible();
  await cf.getByRole('switch', { name: 'Enviar la confirmación' }).uncheck();
  await cf.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Guardado. La confirmación está apagada.')).toBeVisible();
  // One lead: who follows it up, in its history.
  await page.locator('.ticket-row', { hasText: 'Lucía Méndez' }).click();
  await page.getByLabel('Responsable').selectOption({ label: SALES.name });
  await page.locator('#ld-follow').locator('xpath=ancestor::section').getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText(`${OTHER_ADMIN.name} asignó el prospecto a ${SALES.name}`)).toBeVisible();
  await axe(page);
});

test('two-step sign-in can remember this browser for 30 days when Seguridad allows it', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one browser is enough');
  const p = await account(info, 'Rocío Recuerda', ['texts']);
  const setup = await p.c.post('/api/account/2fa/setup', { currentPassword: p.password });
  const secret = setup.data.secret.replace(/ /g, '');
  expect((await p.c.post('/api/account/2fa/enable', { code: await totp(secret) })).status).toBe(200);
  const owner = new Client(BASE);
  await owner.login();
  expect((await owner.put('/api/security/accounts', { rememberDevice: true, currentPassword: ADMIN.password })).status).toBe(200);
  try {
    const codeStep = async (remember) => {
      await page.goto('/admin/#/ingresar');
      await page.getByLabel('Correo electrónico').fill(p.email);
      await page.getByLabel(/^Contraseña$/).fill(p.password);
      await page.getByRole('button', { name: 'Iniciar sesión' }).click();
      const box = page.getByLabel('Recordar este dispositivo por 30 días');
      await expect(box).toBeVisible();
      if (remember) await box.check();
      await page.getByLabel('Código de 6 dígitos').fill(await totp(secret, 1));
    };
    await codeStep(true);
    await home(page);
    // Sign out and in again: no code in this browser.
    await page.getByRole('button', { name: /Menú de tu cuenta/ }).click();
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await page.getByLabel('Correo electrónico').fill(p.email);
    await page.getByLabel(/^Contraseña$/).fill(p.password);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page.locator('main h1')).toHaveText(/^Hola, /);
    // Mi cuenta: the browser is listed and can be forgotten.
    await page.goto('/admin/#/cuenta');
    await expect(page.getByText('1 navegador recordado: no pide el código.')).toBeVisible();
    await page.getByRole('button', { name: 'Olvidarlos' }).click();
    await expect(page.getByText('Listo: la próxima vez te pediremos el código en todos tus navegadores.')).toBeVisible();
  } finally {
    await owner.put('/api/security/accounts', { rememberDevice: false, currentPassword: ADMIN.password });
  }
});
