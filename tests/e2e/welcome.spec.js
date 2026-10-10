// First sign-in: invitation → create the password → choose language and appearance once
// (Automático by default) → the panel as chosen; the welcome e-mail with their access.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN, waitForMail, message } from '../integration/helpers.mjs';

async function signIn(page, user = ADMIN) {
  await page.goto('/admin/#/ingresar');
  await page.getByLabel(/Correo electrónico|^Email$/).fill(user.email);
  await page.getByLabel(/^Contraseña$|^Password$/).fill(user.password);
  await page.getByRole('button', { name: /Iniciar sesión|Sign in/ }).click();
  await expect(page.locator('main h1')).toHaveText(/^(Hola|Hi), /);
}

test('a new person chooses language and appearance once, and gets the welcome e-mail', async ({ browser }, info) => {
  const email = `nueva.${info.project.name}.${Date.now()}@example.test`;
  const password = `Clave-Nueva-${Date.now()}`;
  // The owner invites them as "Editor de contenido".
  const ownerCtx = await browser.newContext(info.project.use.viewport ? { viewport: info.project.use.viewport } : {});
  const owner = await ownerCtx.newPage();
  await signIn(owner);
  await owner.goto('/admin/#/usuarios');
  await owner.getByRole('button', { name: 'Invitar usuario' }).click();
  const dialog = owner.getByRole('dialog');
  await dialog.getByLabel('Nombre').fill('Laura Pérez');
  await dialog.getByLabel('Correo electrónico').fill(email);
  await dialog.getByText('Editor de contenido', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Enviar invitación' }).click();
  await expect(owner.getByText(/Invitación enviada a/)).toBeVisible();
  await ownerCtx.close();
  const [invite] = await waitForMail(email, 1);
  const link = (await message(invite.ID)).Text.match(/https?:\/\/\S+\/admin\/#\/invitacion\/[A-Za-z0-9_-]+/)[0];

  // On their own device (nothing remembered): create the password.
  const page = await (await browser.newContext({ ...info.project.use, baseURL: undefined })).newPage();
  await page.goto(link);
  await page.getByLabel('Contraseña nueva').fill(password);
  await page.getByLabel('Confirma la contraseña').fill(password);
  await page.getByRole('button', { name: 'Activar mi cuenta' }).click();

  // The welcome screen: Spanish (the invitation's language) and Automático preselected.
  await expect(page.locator('main h1')).toHaveText('Te damos la bienvenida, Laura');
  await expect(page.locator('#opt-es input')).toBeChecked();
  await expect(page.locator('#opt-system input')).toBeChecked();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  const v = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.filter((x) => ['serious', 'critical'].includes(x.impact));
  expect(v.map((x) => `${x.id}: ${x.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  // English: the screen switches at once and the choice keeps the focus.
  await page.locator('#opt-en').click();
  await expect(page.locator('main h1')).toHaveText('Welcome, Laura');
  await expect(page.locator('#opt-en input')).toBeChecked();
  await expect(page.locator('#opt-en input')).toBeFocused();
  // Dark: applied at once.
  await page.locator('#opt-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Save and continue' }).click();

  // The panel as they chose it — and the screen is not shown again.
  await expect(page.locator('main h1')).toHaveText(/^Hi, Laura/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('main h1')).toHaveText(/^Hi, Laura/);
  const session = await page.evaluate(() => fetch('../api/auth/session', { credentials: 'same-origin' }).then((r) => r.json()));
  expect([session.user.lang, session.user.theme, session.user.welcome]).toEqual(['en', 'dark', false]);

  // The welcome e-mail (sent once, in the account's language at activation).
  const mails = await waitForMail(email, 2);
  const welcome = mails.find((m) => m.Subject === 'Tu cuenta del Administrador de contenido está lista');
  expect(welcome, JSON.stringify(mails.map((m) => m.Subject))).toBeTruthy();
  const body = await message(welcome.ID);
  for (const text of ['¡Te damos la bienvenida, Laura!', 'Editor de contenido', 'Textos del sitio', 'Portafolio en PDF', 'Soporte → Nueva solicitud', 'Nunca te pediremos tu contraseña']) {
    expect(body.Text).toContain(text);
  }
  expect(body.Text).toContain('Ana Administradora te dio acceso');
  expect(body.HTML).not.toContain(password);
  expect(body.Text).not.toContain(password);
});

test('people who already used the panel, and the owner viewing as someone, never see it', async ({ page }) => {
  await signIn(page);
  await expect(page.locator('.welcome-option')).toHaveCount(0);
  const session = await page.evaluate(() => fetch('../api/auth/session', { credentials: 'same-origin' }).then((r) => r.json()));
  expect(session.user.welcome).toBe(false);
});
