// Content Manager in real browsers: every screen, both themes, three device sizes.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIN, FIXTURES } from '../integration/helpers.mjs';
import { EDITOR } from './global-setup.mjs';

const SCREENS = join(import.meta.dirname, '.artifacts', 'screens');
mkdirSync(SCREENS, { recursive: true });
const sql = (q) => execFileSync('sqlite3', [join(process.env.E2E_STORAGE, 'database.sqlite'), q]).toString().trim();

const PAGES = [
  ['dashboard', '#/'], ['texts', '#/textos'], ['hero', '#/textos/hero'], ['faq', '#/textos/faq'], ['details', '#/contacto'],
  ['photos-about', '#/fotos/nosotros'], ['photos-projects', '#/fotos/proyectos'], ['documents', '#/fotos/documentos'],
  ['users', '#/usuarios'], ['reports', '#/reportes'], ['account', '#/cuenta'], ['help', '#/ayuda'],
];

/** Collects console errors, CSP violations, page errors and failed requests. */
let capturing = false;
function watch(page) {
  const problems = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // Playwright's WebKit screenshot injects a <style>, which the admin's
    // strict CSP correctly refuses. That message is the harness, not the app.
    if (capturing && /Refused to apply a stylesheet/.test(m.text())) return;
    problems.push('console: ' + m.text());
  });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/auth/login')) problems.push(`${r.status()} ${r.url()}`); });
  return problems;
}

async function login(page, user = ADMIN) {
  await page.goto('/admin/#/ingresar');
  await page.getByLabel(/Correo electrónico|^Email$/).fill(user.email);
  await page.getByLabel(/^Contraseña$|^Password$/).fill(user.password);
  await page.getByRole('button', { name: /Iniciar sesión|Sign in/ }).click();
  // The sign-in screen has its own <main><h1>; wait for the panel itself.
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('main h1')).toHaveText(/^(Hola|Hi), /);
}

async function shot(page, path, opts = {}) {
  capturing = true;
  try {
    await page.screenshot({ path, caret: 'initial', ...opts });
    await page.waitForTimeout(100);
  } finally { capturing = false; }
}

async function expectNoOverflow(page, what) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, `${what}: horizontal overflow`).toBeLessThanOrEqual(iw);
}

async function axe(page, what) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`), `${what}: accessibility`).toEqual([]);
}

for (const theme of ['light', 'dark']) {
  test(`sign-in screens (${theme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    const problems = watch(page);
    for (const [slug, hash] of [['login', '#/ingresar'], ['forgot', '#/recuperar'], ['invalid-link', '#/restablecer/' + 'x'.repeat(43)]]) {
      await page.goto('/admin/' + hash);
      await expect(page.locator('h1')).toBeVisible();
      await page.waitForTimeout(250);
      await expectNoOverflow(page, slug);
      await axe(page, slug);
      await shot(page, join(SCREENS, `${info.project.name}-${theme}-${slug}.png`), { fullPage: true });
    }
    expect(problems).toEqual([]);
  });

  test(`every admin screen (${theme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    const problems = watch(page);
    await login(page);
    for (const [slug, hash] of PAGES) {
      await page.goto('/admin/' + hash);
      await expect(page.locator('main h1')).toBeVisible();
      await expect(page.locator('.page-loading')).toHaveCount(0);
      await page.waitForTimeout(200);
      await expectNoOverflow(page, slug);
      await axe(page, slug);
      await shot(page, join(SCREENS, `${info.project.name}-${theme}-${slug}.png`), { fullPage: true });
    }
    // Navigation is reachable on every size (sidebar or drawer).
    if (await page.locator('.open-nav').isVisible()) {
      await page.locator('.open-nav').click();
      await expect(page.locator('.sidebar.open')).toBeVisible();
      await axe(page, 'drawer');
      await shot(page, join(SCREENS, `${info.project.name}-${theme}-drawer.png`));
      await page.keyboard.press('Escape');
      await expect(page.locator('.sidebar.open')).toHaveCount(0);
    }
    // The report dialog from the top bar.
    await page.locator('.topbar .report-btn').click();
    await expect(page.getByRole('dialog', { name: /Reportar un problema/ })).toBeVisible();
    await page.waitForTimeout(400);
    await axe(page, 'report dialog');
    await expectNoOverflow(page, 'report dialog');
    await shot(page, join(SCREENS, `${info.project.name}-${theme}-report-dialog.png`));
    await page.keyboard.press('Escape');
    expect(problems).toEqual([]);
  });
}

test('upload a photo through the dialog: preview, framing, alt text, publish', async ({ page }, info) => {
  const problems = watch(page);
  await login(page);
  await page.goto('/admin/#/fotos/proyectos');
  const panelIndex = { 'desktop-chrome': 3, 'tablet-chrome': 4, 'iphone-webkit': 5 }[info.project.name];
  const panel = page.locator('section.project-panel').nth(panelIndex);
  await panel.getByRole('button', { name: 'Subir foto' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('#media-file').setInputFiles(join(FIXTURES, 'wide-1600x900.jpg'));
  await expect(dlg.locator('.frame img')).toHaveCount(1);
  await expect(dlg.getByText(/se recortarán los bordes/)).toBeVisible();
  await dlg.getByRole('button', { name: 'Derecha' }).click();
  await expect(dlg.locator('.frame img')).toHaveCSS('object-position', '100% 50%');
  await dlg.getByRole('button', { name: 'Publicar' }).click();
  await expect(dlg.locator('.field-error').filter({ hasText: 'obligatorio' })).toBeVisible();
  await dlg.getByLabel(/Descripción de la foto \(español\)/).fill('Fachada de local comercial ' + info.project.name);
  await dlg.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByText('Foto publicada en el sitio.')).toBeVisible();
  await expect(panel.locator('.slot-media img')).toBeVisible();
  expect(problems).toEqual([]);
});

test('unsaved changes are protected when leaving the editor', async ({ page }) => {
  await login(page);
  await page.goto('/admin/#/textos/footer');
  const input = page.locator('main textarea, main input').first();
  await input.fill('Texto sin guardar');
  await expect(page.locator('.savebar.show')).toBeVisible();
  await page.goto('/admin/#/');
  await expect(page.getByRole('dialog', { name: '¿Salir sin guardar?' })).toBeVisible();
  await page.getByRole('button', { name: 'Seguir editando' }).click();
  await expect(input).toHaveValue('Texto sin guardar');
  await page.getByRole('button', { name: 'Descartar' }).click();
  await expect(page.locator('.savebar.show')).toHaveCount(0);
});

test('an expired session asks to sign in again and keeps the edit', async ({ page }, info) => {
  await login(page);
  await page.goto('/admin/#/textos/footer');
  const input = page.locator('main textarea, main input').first();
  const text = 'Diseño y construcción profesional en Guatemala. ' + info.project.name.slice(0, 6);
  await input.fill(text);
  sql(`UPDATE sessions SET last_seen_at = last_seen_at - 7200 WHERE user_id = (SELECT id FROM users WHERE email='${ADMIN.email}')`);
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  const dlg = page.getByRole('dialog', { name: 'Tu sesión terminó' });
  await expect(dlg).toBeVisible();
  await dlg.getByLabel(/^Contraseña$/).fill(ADMIN.password);
  await dlg.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Cambios publicados en el sitio.')).toBeVisible();
  await expect(input).toHaveValue(text);
});

test('language and theme switches apply immediately and persist', async ({ page }) => {
  await login(page);
  await page.locator('.topbar .menu > button').click();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.locator('main h1')).toHaveText(/^Hi, /);
  await page.reload();
  await expect(page.locator('main h1')).toHaveText(/^Hi, /);
  await page.locator('.topbar .menu > button').click();
  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Español' }).click();
  await expect(page.locator('main h1')).toHaveText(/^Hola, /);
  await page.locator('.topbar .menu > button').click();
  await page.getByRole('button', { name: 'Sistema' }).click();
});

test('an editor sees no user management and is refused if they try', async ({ page }) => {
  await login(page, EDITOR);
  await expect(page.locator('.nav a[href="#/usuarios"]')).toHaveCount(0);
  await page.goto('/admin/#/usuarios');
  await expect(page.locator('main h1')).toHaveText('No encontramos esta pantalla');
});

test('sending a report with a screenshot shows the confirmation', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one real submission is enough');
  await login(page);
  await page.goto('/admin/#/textos');
  await page.locator('.topbar .report-btn').click();
  const dlg = page.getByRole('dialog', { name: /Reportar un problema/ });
  await dlg.getByRole('radio', { name: 'Mejora / sugerencia' }).check();
  await dlg.getByLabel('Título').fill('Prueba E2E ' + Date.now());
  await dlg.getByLabel('Descripción').fill('Esto es una prueba automatizada del formulario de reportes.');
  await expect(dlg.getByLabel(/Página/)).toHaveValue('/admin/#/textos');
  await dlg.locator('#report-shot').setInputFiles(join(FIXTURES, 'wide-1600x900.jpg'));
  await dlg.getByRole('button', { name: 'Enviar reporte' }).click();
  await expect(dlg.getByText('¡Gracias! Tu reporte fue enviado correctamente al equipo de soporte.')).toBeVisible();
});

// ---------------------------------------------------------------- Pass 2 (adversarial)
test('losing the connection while saving keeps the edit and explains what to do', async ({ page, context }) => {
  await login(page);
  await page.goto('/admin/#/textos/cta');
  const input = page.locator('main textarea, main input').first();
  await input.fill('Texto escrito sin conexión');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  // The save error explains what happened and that nothing was lost (the
  // offline banner at the top says so too).
  const err = page.locator('main form .alert-bad');
  await expect(err).toContainText('No pudimos conectar con el servidor');
  await expect(err).toContainText('sigue en pantalla');
  await expect(page.getByText('Sin conexión a internet.', { exact: false })).toBeVisible();
  await expect(input).toHaveValue('Texto escrito sin conexión');
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Descartar' }).click();
});

test('the panel works normally when telemetry is blocked (ad-blockers)', async ({ page }) => {
  await page.route('**/api/telemetry/**', (r) => r.abort());
  const problems = watch(page);
  await login(page);
  await page.evaluate(() => setTimeout(() => { throw new Error('forced test error'); }, 0));
  await page.goto('/admin/#/textos');
  await expect(page.locator('main h1')).toHaveText('Textos del sitio');
  // Only the deliberately blocked telemetry request may fail.
  expect(problems.filter((p) => !/forced test error|telemetry|ERR_FAILED/.test(p))).toEqual([]);
});

test('report text containing HTML is shown as text, never executed', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one submission is enough');
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs++; d.dismiss(); });
  await login(page);
  await page.locator('.topbar .report-btn').click();
  const dlg = page.getByRole('dialog', { name: /Reportar un problema/ });
  await dlg.getByLabel('Título').fill('<img src=x onerror=alert(1)> ' + Date.now());
  await dlg.getByLabel('Descripción').fill('<script>alert(2)</script> descripción de prueba');
  await dlg.getByRole('button', { name: 'Enviar reporte' }).click();
  await expect(dlg.getByText(/Tu reporte fue enviado/)).toBeVisible();
  await dlg.getByRole('button', { name: 'Listo' }).click();
  await page.goto('/admin/#/reportes');
  await page.getByText('Ver detalle').first().click();
  await expect(page.getByText('<script>alert(2)</script> descripción de prueba')).toBeVisible();
  expect(await page.locator('main img[src="x"], main script').count()).toBe(0);
  expect(dialogs).toBe(0);
});

test('small landscape phone: editor and dialogs fit', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone-webkit', 'phone only');
  await page.setViewportSize({ width: 667, height: 375 });
  await login(page);
  for (const hash of ['#/textos/hero', '#/fotos/proyectos', '#/usuarios']) {
    await page.goto('/admin/' + hash);
    await expect(page.locator('main h1')).toBeVisible();
    await expectNoOverflow(page, hash);
  }
  await page.locator('.topbar .report-btn').click();
  const box = await page.getByRole('dialog').boundingBox();
  expect(box.height).toBeLessThanOrEqual(375);
});
