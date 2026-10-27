// User management by a site administrator (not the owner): fix someone's name
// and e-mail, give them an easy-to-read password that they replace at sign-in,
// require two-step sign-in, send a link for a new password.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN, Client, waitForMail, message, linkToken } from '../integration/helpers.mjs';
import { OTHER_ADMIN } from './global-setup.mjs';

const BASE = 'http://127.0.0.1:8210';

async function signIn(page, user) {
  await page.goto('/admin/#/ingresar');
  await page.getByLabel(/Correo electrónico|^Email$/).fill(user.email);
  await page.getByLabel(/^Contraseña$|^Password$/).fill(user.password);
  await page.getByRole('button', { name: /Iniciar sesión|Sign in/ }).click();
}
async function axe(page) {
  const v = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.filter((x) => ['serious', 'critical'].includes(x.impact));
  expect(v.map((x) => `${x.id}: ${x.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
}
const noSideScroll = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
/** Names differ per device run, so each run finds its own person. */
const tag = (info) => ({ 'desktop-chrome': 'Escritorio', 'tablet-chrome': 'Tableta', 'iphone-webkit': 'Celular' }[info.project.name] || info.project.name);

/** An active account (custom access: texts and contact), made by the owner through the API. */
async function activePerson(info, name) {
  const owner = new Client(BASE);
  await owner.login();
  const email = `${name.split(' ')[0].toLowerCase()}.${info.project.name}.${Date.now()}@example.test`;
  const r = await owner.post('/api/users', { name, email, permissions: ['texts', 'contact'], lang: 'es' });
  expect(r.status, r.text).toBe(200);
  const token = linkToken((await message((await waitForMail(email, 1))[0].ID)).Text, 'invitacion');
  const password = 'Clave-Inicial-2026';
  const c = new Client(BASE);
  expect((await c.post('/api/auth/invitation/accept', { token, name, password, passwordConfirm: password })).status).toBe(200);
  return { id: r.data.user.id, email, password };
}
async function openMenu(page, name) {
  // The list redraws after a save and after typing in the search (debounced):
  // wait for both, or the menu could open on a row that is about to be replaced.
  await page.waitForLoadState('networkidle');
  await page.getByLabel(/Buscar por nombre/).fill(name);
  await expect(page.locator('.users-count')).toHaveText(/^1 de \d+ personas$/);
  const menu = page.locator('.table-wrap:visible, .list-cards:visible').getByRole('button', { name: `Acciones para ${name}`, exact: true });
  await menu.first().click();
  await expect(page.locator('.menu-panel')).toBeVisible();
  // A single row left by the search: the menu is taller than the table, and
  // no box that hides its overflow (the table's rounded box) may cut it off.
  expect(await page.locator('.menu-panel').evaluate((panel) => {
    const r = panel.getBoundingClientRect();
    for (let p = panel.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (!/hidden|clip/.test(`${s.overflowX} ${s.overflowY}`)) continue;
      const b = p.getBoundingClientRect();
      if (r.top < b.top || r.bottom > b.bottom || r.left < b.left || r.right > b.right) return `cut off by .${p.className}`;
    }
    return 'whole menu shown';
  })).toBe('whole menu shown');
}

test('a site administrator fixes someone’s details and gives them a password they replace at sign-in', async ({ browser }, info) => {
  const errors = [];
  const ctx = await browser.newContext(info.project.use);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await signIn(page, OTHER_ADMIN);
  await expect(page.locator('main h1')).toHaveText(/^Hola, /);
  // "Gestión de usuarios" comes with "Administrador del sitio".
  await page.goto('/admin/#/usuarios');
  await expect(page.locator('main h1')).toHaveText('Usuarios');
  await expect(page.getByRole('button', { name: /Ver como/ })).toBeHidden();
  // The owner can't be changed from here: a lock instead of the menu.
  await page.getByLabel(/Buscar por nombre/).fill(ADMIN.name);
  await expect(page.locator('.not-manageable:visible').first()).toHaveAttribute('aria-label', 'Solo la cuenta propietaria puede cambiar a esta persona');
  await axe(page);

  const pablo = `Pablo ${tag(info)}`;
  const person = await activePerson(info, pablo);
  await page.reload();
  await expect(page.locator('main h1')).toHaveText('Usuarios');

  // Name and e-mail: a different e-mail asks for the administrator's password.
  await openMenu(page, pablo);
  await page.getByRole('button', { name: 'Editar nombre y correo' }).click();
  const edit = page.getByRole('dialog');
  await edit.getByLabel('Nombre').fill(`${pablo} Ruiz`);
  const newEmail = person.email.replace('pablo.', 'pablo.ruiz.');
  await edit.getByLabel('Correo electrónico').fill(newEmail);
  await expect(edit.getByLabel('Tu contraseña (para confirmar)')).toBeVisible();
  await edit.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(edit.getByText('Este campo es obligatorio.')).toBeVisible();
  await edit.getByLabel('Tu contraseña (para confirmar)').fill(OTHER_ADMIN.password);
  await edit.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Datos actualizados. Avisamos al correo anterior y al nuevo.')).toBeVisible();
  expect((await waitForMail(person.email, 2)).some((m) => /Cambió tu correo de acceso/.test(m.Subject))).toBe(true);

  // A generated password, easy to read; shown once more after saving.
  await openMenu(page, `${pablo} Ruiz`);
  await page.getByRole('button', { name: 'Establecer contraseña' }).click();
  const dlg = page.getByRole('dialog');
  const shown = dlg.locator('output.pw-generated');
  await expect(shown).toHaveText(/^[A-Z][a-z]+-[A-Z][a-z]+-[A-Z][a-z]+-\d{3}$/);
  const first = await shown.textContent();
  await dlg.getByRole('button', { name: 'Generar otra' }).click();
  await expect(shown).not.toHaveText(first);
  await expect(shown).toHaveText(/^[A-Z][a-z]+-[A-Z][a-z]+-[A-Z][a-z]+-\d{3}$/);
  await expect(dlg.getByLabel('Pedirle que cree su propia contraseña al entrar (recomendado)')).toBeChecked();
  await noSideScroll(page);
  await axe(page);
  const temp = await shown.textContent();
  await dlg.getByLabel('Tu contraseña (para confirmar)').fill(OTHER_ADMIN.password);
  await dlg.getByRole('button', { name: 'Guardar contraseña' }).click();
  const done = page.getByRole('dialog', { name: 'Contraseña guardada' });
  await expect(done.locator('output.pw-generated')).toHaveText(temp);
  await done.locator('.dialog-foot').getByRole('button', { name: 'Cerrar' }).click();
  await page.getByLabel(/Buscar por nombre/).fill(`${pablo} Ruiz`);
  await expect(page.locator('.user-flag:visible', { hasText: 'Debe crear su contraseña' })).toBeVisible();
  expect(errors).toEqual([]);
  await ctx.close();

  // Pablo, on his own device: before anything else, a password of his own.
  const own = await (await browser.newContext(info.project.use)).newPage();
  await signIn(own, { email: newEmail, password: temp });
  await expect(own.locator('main h1')).toHaveText('Crea tu propia contraseña');
  await expect(own.locator('.sidebar')).toHaveCount(0);
  await axe(own);
  await noSideScroll(own);
  await own.getByLabel('Contraseña temporal').fill(temp);
  await own.getByLabel('Contraseña nueva').fill('Clave-De-Pablo-2026');
  await own.getByLabel('Confirma la contraseña').fill('Clave-De-Pablo-2026');
  await own.getByRole('button', { name: 'Guardar y continuar' }).click();
  // Then the panel as usual (his first sign-in: the welcome screen).
  await expect(own.locator('main h1')).toHaveText(/^(Te damos la bienvenida, Pablo|Hola, Pablo)/);
  const mails = await waitForMail(newEmail, 1);
  for (const m of mails) {
    const body = await message(m.ID);
    expect(body.Text).not.toContain(temp);
  }
});

test('someone whose e-mail was changed while signed in carries on with the new one', async ({ browser }, info) => {
  const elena = `Elena ${tag(info)}`;
  const person = await activePerson(info, elena);
  const page = await (await browser.newContext(info.project.use)).newPage();
  await signIn(page, person);
  await expect(page.locator('main h1')).toHaveText(/^(Te damos la bienvenida|Hola), Elena/);
  if (await page.getByRole('button', { name: 'Guardar y continuar' }).isVisible()) await page.getByRole('button', { name: 'Guardar y continuar' }).click();
  await expect(page.locator('main h1')).toHaveText(/^Hola, Elena/);

  // The owner corrects the address: Elena's sessions end.
  const owner = new Client(BASE);
  await owner.login();
  const newEmail = person.email.replace('elena.', 'elena.nuevo.');
  expect((await owner.put(`/api/users/${person.id}/profile`, { name: elena, email: newEmail, currentPassword: ADMIN.password })).status).toBe(200);

  // Her next step asks her to sign in again, in place; the old address is locked
  // until she says it changed.
  await page.goto('/admin/#/cuenta');
  const dlg = page.getByRole('dialog', { name: 'Tu sesión terminó' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByText(/cuando cambian tus datos de acceso/)).toBeVisible();
  const email = dlg.getByLabel('Correo electrónico');
  await expect(email).toHaveAttribute('readonly', '');
  await dlg.getByRole('button', { name: '¿Cambió tu correo? Usar otro' }).click();
  await expect(email).not.toHaveAttribute('readonly', '');
  await email.fill(newEmail);
  await dlg.getByLabel('Contraseña', { exact: true }).fill(person.password);
  await dlg.getByRole('button', { name: 'Continuar' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.locator('main h1')).toHaveText('Mi cuenta');
  // Signed in with the new address (what is on screen stays until it reloads).
  await page.reload();
  await expect(page.getByLabel('Correo', { exact: true })).toHaveValue(newEmail);
});

test('requiring two-step sign-in and sending a link for a new password', async ({ browser }, info) => {
  const rosa = `Rosa ${tag(info)}`;
  const person = await activePerson(info, rosa);
  const page = await (await browser.newContext(info.project.use)).newPage();
  await signIn(page, OTHER_ADMIN);
  await expect(page.locator('main h1')).toHaveText(/^Hola, /);
  await page.goto('/admin/#/usuarios');
  await openMenu(page, rosa);
  await page.getByRole('button', { name: 'Verificación en dos pasos' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByText('Sin configurar')).toBeVisible();
  const sw = dlg.getByRole('switch', { name: `Exigírsela a ${rosa}` });
  await expect(sw).not.toBeChecked();
  await axe(page);
  await sw.click();
  await expect(page.getByText('Ahora se le exige la verificación en dos pasos.')).toBeVisible();
  await dlg.getByRole('button', { name: 'Cerrar' }).first().click();

  // Rosa signs in: the set-up screen comes first.
  const rosaPage = await (await browser.newContext(info.project.use)).newPage();
  await signIn(rosaPage, person);
  await expect(rosaPage.locator('main h1')).toHaveText('Protege tu cuenta');

  // A link to choose a new password, by e-mail.
  await openMenu(page, rosa);
  await page.getByRole('button', { name: 'Enviar enlace para nueva contraseña' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Enviar enlace' }).click();
  await expect(page.getByText(`Enlace enviado a ${person.email}.`)).toBeVisible();
  const link = (await waitForMail(person.email, 3)).find((m) => /Crea una contraseña nueva/.test(m.Subject));
  expect(link).toBeTruthy();
  expect((await message(link.ID)).Text).toContain('24 horas');
});
