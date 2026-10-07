// Automatic ES <-> EN translation in the text editor, against a DeepL stand-in.
// Runs its own Content Manager (port 8211) so the other browser tests keep
// the default "no translation key" setup.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startServer, createAdmin, ADMIN } from '../integration/helpers.mjs';
import { startDeepLStub, STUB_KEY } from '../integration/deepl-stub.mjs';

const BASE = 'http://127.0.0.1:8211';
let server; let stub;

test.beforeAll(async () => {
  stub = await startDeepLStub({ port: 8218 });
  server = await startServer({ port: 8211, env: { DEEPL_API_KEY: STUB_KEY, DEEPL_API_URL: stub.url } });
  createAdmin(server);
  server.cli(['publish']);
});
test.afterAll(async () => { await server.stop(); await stub.stop(); });

function watch(page) {
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Refused to apply a stylesheet/.test(m.text())) problems.push('console: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  return problems;
}

async function openHero(page) {
  await page.goto(BASE + '/admin/#/ingresar');
  await page.getByLabel('Correo electrónico').fill(ADMIN.email);
  await page.getByLabel(/^Contraseña$/).fill(ADMIN.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('main h1')).toHaveText(/^Hola, /);
  await page.goto(BASE + '/admin/#/textos/hero');
  await expect(page.getByText(/Traducción automática activada/)).toBeVisible();
}

const box = (page, field, lang) => page.getByRole('textbox', { name: `${field} ${lang === 'es' ? 'Español' : 'Inglés'}`, exact: true });
const card = (page, field) => page.locator('.field-card').filter({ has: page.getByRole('heading', { name: field, exact: true }) });

test('Spanish fills English for review; Undo, manual edits and "Traducir del español" behave', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const problems = watch(page);
  await openHero(page);
  const F = 'Botón principal (naranja)';
  const es = box(page, F, 'es');
  const en = box(page, F, 'en');

  // 1. Typing Spanish → English translated after a short pause, marked for review.
  await es.fill('Agenda una visita');
  await expect(en).toHaveValue('EN: Agenda una visita');
  await expect(card(page, F).getByText('Traducido automáticamente del español. Revísalo.')).toBeVisible();
  await new AxeBuilder({ page }).include('.field-card').withTags(['wcag2a', 'wcag2aa']).analyze().then((r) => {
    expect(r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)).toEqual([]);
  });

  // 2. Undo brings back the previous English and keeps it while Spanish changes again.
  await card(page, F).getByRole('button', { name: /Deshacer la traducción automática/ }).click();
  await expect(en).toHaveValue('Request a Technical Evaluation');
  await es.fill('Agenda una visita técnica');
  await page.waitForTimeout(1800);
  await expect(en).toHaveValue('Request a Technical Evaluation');

  // 3. On demand: "Traducir del español" replaces the English again.
  await card(page, F).getByRole('button', { name: `Traducir del español — ${F}` }).click();
  await expect(en).toHaveValue('EN: Agenda una visita técnica');

  // 4. English written by hand is never overwritten by later Spanish edits.
  await en.fill('Book a site visit');
  await es.fill('Agenda tu visita');
  await page.waitForTimeout(1800);
  await expect(en).toHaveValue('Book a site visit');

  // 5. Saving publishes both languages as shown.
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Cambios publicados en el sitio.')).toBeVisible();
  const html = server.readPublic('index.html');
  expect(html).toContain('Agenda tu visita');
  expect(html).toContain('Book a site visit');
  expect(problems).toEqual([]);
});

test('English typed first fills Spanish; returning to the saved text reverts the translation', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'logic is device-independent');
  await openHero(page);
  const F = 'Descripción';
  const es = box(page, F, 'es');
  const en = box(page, F, 'en');
  const savedEs = await es.inputValue();
  const savedEn = await en.inputValue();
  await en.fill('We remodel homes and offices.');
  await expect(es).toHaveValue('ES: We remodel homes and offices.');
  await en.fill(savedEn);
  await expect(es).toHaveValue(savedEs);
  await expect(page.locator('.savebar')).not.toHaveClass(/show/);
});

test('saving right after typing waits for the translation and saves it too', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one save is enough');
  await openHero(page);
  const F = 'Texto superior';
  stub.mode = 'delay';
  try {
    await box(page, F, 'es').fill('Construcción en Guatemala');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Cambios publicados en el sitio.')).toBeVisible({ timeout: 10_000 });
  } finally {
    stub.mode = 'ok';
  }
  await expect(box(page, F, 'en')).toHaveValue('EN: Construcción en Guatemala');
  const json = server.readPublic('index.html').match(/<script type="application\/json" id="siteContent">(.*?)<\/script>/s)[1];
  expect(JSON.parse(json).i18n.en['hero.eyebrow']).toBe('EN: Construcción en Guatemala');
});

test('when DeepL fails, the text stays as it was and the editor explains why', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one failure path is enough');
  await openHero(page);
  const F = 'Botón secundario';
  const before = await box(page, F, 'en').inputValue();
  stub.mode = 'quota';
  try {
    await box(page, F, 'es').fill('Ver proyectos ahora');
    await expect(card(page, F).getByText('Se alcanzó el límite de traducción automática. Escribe el texto tú.')).toBeVisible();
    await expect(box(page, F, 'en')).toHaveValue(before);
  } finally {
    stub.mode = 'ok';
  }
});

test('without a DeepL key the editor shows no translation controls', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one check is enough');
  // The shared E2E server (port 8210) has no key.
  await page.goto('/admin/#/ingresar');
  await page.getByLabel('Correo electrónico').fill(ADMIN.email);
  await page.getByLabel(/^Contraseña$/).fill(ADMIN.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('main h1')).toHaveText(/^Hola, /);
  await page.goto('/admin/#/textos/hero');
  await expect(page.getByRole('heading', { name: 'Título principal' })).toBeVisible();
  await expect(page.getByText(/Traducción automática activada/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Traducir del/ })).toHaveCount(0);
});
