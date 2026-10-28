// The UX review (October 2026) in real browsers: Inicio speaks to each role and
// «Primeros pasos» is remembered on the account; phones get sliding status tabs
// and «Filtros»; Tipos de proyectos folds on phones; Usuarios is cards below
// 1100 px; the editor allows longer texts past the recommended length; touch
// targets, dialog close buttons, focused titles and wiki tables.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { Client } from '../integration/helpers.mjs';
import { OTHER_ADMIN, EDITOR } from './global-setup.mjs';

const BASE = 'http://127.0.0.1:8210';
const tag = (info) => ({ 'desktop-chrome': 'Escritorio', 'tablet-chrome': 'Tableta', 'iphone-webkit': 'Celular' }[info.project.name] || info.project.name);
const phone = (info) => info.project.name === 'iphone-webkit';

async function signIn(page, user) {
  await page.goto('/admin/#/ingresar');
  await page.getByLabel(/Correo electrónico|^Email$/).fill(user.email);
  await page.getByLabel(/^Contraseña$|^Password$/).fill(user.password);
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

/** A fresh account per device, with a password set by an administrator (no invitation e-mail). */
async function account(info, name, permissions) {
  const admin = new Client(BASE);
  await admin.login(OTHER_ADMIN.email, OTHER_ADMIN.password);
  const email = `${name.split(' ')[0].toLowerCase()}.${info.project.name}.${Date.now()}@example.test`;
  const r = await admin.post('/api/users', { name, email, permissions, lang: 'es' });
  expect(r.status, r.text).toBe(200);
  const password = 'Clave-Revision-UX-2026';
  const set = await admin.post(`/api/users/${r.data.user.id}/password`, { password, mustChange: false, currentPassword: OTHER_ADMIN.password });
  expect(set.status, set.text).toBe(200);
  return { email, password, name };
}

test('Inicio speaks to the role; «Primeros pasos» closed on one device stays closed on the others', async ({ page, browser }, info) => {
  const p = await account(info, `Bruno ${tag(info)}`, ['leads', 'stats']);
  await signIn(page, p);
  await expect(page.locator('main .page-head > .grow > p')).toHaveText('Desde aquí puedes dar seguimiento a los prospectos y ver las estadísticas de visitas.');
  const intro = page.locator('.intro-card');
  await expect(intro.locator('li').first()).toContainText('En «Prospectos» llegan los mensajes del formulario');
  await expect(intro.locator('li')).toHaveCount(3);
  await expect(intro.locator('li').last()).toContainText('Wiki');
  await expect(intro).not.toContainText('textos, fotos o datos de contacto');
  await intro.getByRole('button', { name: 'Entendido' }).click();
  await expect(intro).toHaveCount(0);
  // Another device (a new browser, nothing stored): not shown again.
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await signIn(page2, p);
  await expect(page2.locator('.quick')).toBeVisible();
  await expect(page2.locator('.intro-card')).toHaveCount(0);
  await other.close();
});

test('phones: the status tabs slide in one row and the other filters wait behind «Filtros»', async ({ page }, info) => {
  await signIn(page, OTHER_ADMIN);
  // Prospectos (Soporte works the same: help-center.spec.js).
  await page.goto('/admin/#/prospectos');
  await expect(page.locator('main h1')).toHaveText('Prospectos');
  const tabs = page.locator('.filter-tabs');
  await expect(tabs.locator('.filter-tab').first()).toBeVisible();
  const selected = await tabs.locator('[aria-pressed="true"]').evaluate((e) => [e.getBoundingClientRect().left, e.getBoundingClientRect().right, innerWidth]);
  expect(selected[0]).toBeGreaterThanOrEqual(0);
  expect(selected[1]).toBeLessThanOrEqual(selected[2]);
  if (phone(info)) expect(await tabs.evaluate((e) => getComputedStyle(e).flexWrap)).toBe('nowrap');
  await expect(page.getByLabel('Buscar por nombre, correo, teléfono, texto o #número')).toBeVisible();
  await noSideScroll(page);
  // Actividad: four filters; on phones behind «Filtros», which counts the ones in use.
  await page.goto('/admin/#/actividad');
  await expect(page.locator('main h1')).toHaveText('Actividad');
  const toggle = page.getByRole('button', { name: /^Filtros/ });
  if (phone(info)) {
    await expect(page.getByLabel('Tipo')).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  } else {
    await expect(toggle).toBeHidden();
  }
  await page.getByLabel('Tipo').selectOption('content');
  if (phone(info)) await expect(toggle).toHaveText('Filtros (1)');
  await page.getByRole('button', { name: 'Quitar filtros' }).click();
  if (phone(info)) await expect(toggle).toHaveText('Filtros');
  await axe(page);
  await noSideScroll(page);
});

test('Fotos: the open tab stays in view; Tipos de proyectos folds on phones with each card photo', async ({ page }, info) => {
  await signIn(page, EDITOR);
  await page.goto('/admin/#/fotos/documentos');
  const tab = page.locator('.tabs [aria-current="page"]');
  await expect(tab).toHaveText('Documentos');
  await expect.poll(() => tab.evaluate((e) => e.getBoundingClientRect().right <= innerWidth && e.getBoundingClientRect().left >= 0)).toBe(true);
  await page.goto('/admin/#/fotos/proyectos');
  const panels = page.locator('details.project-panel');
  await expect(panels).toHaveCount(6);
  await expect(panels.first().locator('summary h2')).not.toBeEmpty();
  await expect(panels.first().locator('summary')).toContainText(/fotos? en la galería/);
  if (phone(info)) {
    for (let i = 0; i < 6; i++) await expect(panels.nth(i)).not.toHaveAttribute('open', '');
    await panels.nth(1).locator('summary').click();
    await expect(panels.nth(1)).toHaveAttribute('open', '');
    await expect(panels.nth(1).getByRole('button', { name: /Subir foto|Cambiar imagen/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(9000);
  } else {
    for (let i = 0; i < 6; i++) await expect(panels.nth(i)).toHaveAttribute('open', '');
  }
  await axe(page);
  await noSideScroll(page);
});

test('Usuarios: cards below 1100 px, a table above with every e-mail on one line', async ({ page }, info) => {
  await signIn(page, OTHER_ADMIN);
  await page.goto('/admin/#/usuarios');
  await expect(page.locator('main h1')).toHaveText('Usuarios');
  if (info.project.name === 'desktop-chrome') {
    await expect(page.locator('.users-table')).toBeVisible();
    await expect(page.locator('.users-cards')).toBeHidden();
    const lines = await page.locator('.users-table .person-email').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight))));
    expect(lines.length).toBeGreaterThan(0);
    for (const n of lines) expect(n).toBe(1);
  } else {
    await expect(page.locator('.users-cards')).toBeVisible();
    await expect(page.locator('.users-table')).toBeHidden();
  }
  await noSideScroll(page);
});

test('the editor takes longer texts: past the recommended length it says so, the maximum still applies', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'the same field on every device');
  await signIn(page, EDITOR);
  await page.goto('/admin/#/textos/hero');
  const field = page.locator('.field').filter({ has: page.locator('.lang-tag', { hasText: 'ES' }) }).first();
  const input = field.locator('input, textarea');
  const original = await input.inputValue();
  await input.fill('x'.repeat(40));
  await expect(field.locator('.counter')).toHaveText('40 / 48');
  await expect(field.locator('.field-note')).toBeHidden();
  await input.fill('x'.repeat(60));
  await expect(field.locator('.counter')).toHaveText('60 / 65');
  await expect(field.locator('.field-note')).toHaveText('Más largo de lo recomendado (48 caracteres). Revisa cómo se ve en el sitio, sobre todo en el celular.');
  await input.fill(original);
  await expect(page.locator('.savebar.show')).toHaveCount(0);
});

test('touch: dialog close buttons keep 44 px; a title that takes focus shows no frame; wiki tables take the keyboard', async ({ page }, info) => {
  await page.goto('/admin/#/ingresar');
  const h1 = page.locator('main h1');
  await expect(h1).toBeFocused();
  expect(await h1.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe('none');
  await signIn(page, OTHER_ADMIN);
  await page.locator('.topbar .report-btn').click();
  const close = page.getByRole('dialog').getByRole('button', { name: 'Cerrar' });
  await expect.poll(() => close.evaluate((e) => e.closest('dialog').getAnimations({ subtree: true }).length)).toBe(0); // measured once it has opened
  const box = await close.boundingBox();
  const min = info.project.name === 'desktop-chrome' ? 36 : 44;
  expect(box.width).toBeGreaterThanOrEqual(min);
  expect(box.height).toBeGreaterThanOrEqual(min);
  await page.keyboard.press('Escape');
  await page.goto('/admin/#/wiki/roles');
  const table = page.locator('.wiki-body .table-scroll').first();
  await expect(table).toHaveAttribute('tabindex', '0');
  await expect(table).toHaveAttribute('role', 'region');
  await expect(table).toHaveAttribute('aria-label', /.+ · .+/);
  await axe(page);
});
