// Centro de Ayuda (menu «Soporte»), the fixed header (logo block + top bar)
// and the frame following the account's language on a new device.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN } from '../integration/helpers.mjs';
import { EDITOR, MANAGER } from './global-setup.mjs';

async function signIn(page, user = ADMIN, hello = /^Hola, /) {
  await page.goto('/admin/#/ingresar');
  await page.getByLabel(/Correo electrónico|^Email$/).fill(user.email);
  await page.getByLabel(/^Contraseña$|^Password$/).fill(user.password);
  await page.getByRole('button', { name: /Iniciar sesión|Sign in/ }).click();
  await expect(page.locator('main h1')).toHaveText(hello);
}
async function openNavIfNeeded(page) {
  if (await page.locator('.open-nav').isVisible()) { await page.locator('.open-nav').click(); await expect(page.locator('.sidebar')).toHaveClass(/open/); }
}
const top = (page, sel) => page.locator(sel).evaluate((e) => Math.abs(Math.round(e.getBoundingClientRect().top)));

test('the menu says «Soporte» (headset icon); the page is the Centro de Ayuda with «Mis solicitudes»', async ({ page }) => {
  await signIn(page, EDITOR);
  await openNavIfNeeded(page);
  const link = page.locator('.nav a[href="#/reportes"]');
  await expect(link).toHaveText(/^Soporte/);
  await expect(link.locator('use')).toHaveAttribute('href', 'icons.svg#i-headset');
  await link.click();
  await expect(page.locator('main h1')).toHaveText('Centro de Ayuda');
  await expect(page.getByRole('heading', { name: 'Mis solicitudes' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Gestión de solicitudes' })).toHaveCount(0);
  await expect(page.locator('.ticket-row', { hasText: 'La galería no abre en el celular' })).toBeVisible();
  await page.getByRole('button', { name: 'Nueva solicitud' }).first().click();
  await expect(page.getByRole('dialog', { name: /Nueva solicitud de soporte/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.ticket-row').first().click();
  await expect(page.locator('.crumbs, nav[aria-label]').filter({ hasText: 'Centro de Ayuda' }).first()).toBeVisible();
  const v = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.filter((x) => ['serious', 'critical'].includes(x.impact));
  expect(v.map((x) => x.id)).toEqual([]);
});

test('managers see «Gestión de solicitudes»; on phones every filter is visible and the overview starts folded', async ({ page }, info) => {
  await signIn(page);
  await page.goto('/admin/#/reportes');
  await expect(page.locator('main h1')).toHaveText('Centro de Ayuda');
  await expect(page.getByRole('heading', { name: 'Gestión de solicitudes' })).toBeVisible();
  const overview = page.locator('details.ticket-overview');
  if (info.project.name === 'iphone-webkit') await expect(overview).not.toHaveAttribute('open', '');
  else await expect(overview).toHaveAttribute('open', '');
  // The filters wrap instead of running off the screen.
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  const tabs = page.locator('.filter-tab');
  await expect(tabs).toHaveCount(7);
  for (const box of await tabs.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) expect(box).toBeLessThanOrEqual(width);
  // The folded state is remembered on this device.
  await overview.locator(':scope > summary').click();
  const after = await overview.evaluate((e) => e.open);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('sensum_support_overview'))).toBe(after ? 'open' : 'closed');
  await page.reload();
  await expect(page.locator('details.ticket-overview')).toHaveJSProperty('open', after);
});

test('the logo block and the top bar stay at the top while the page or the menu scrolls', async ({ page }) => {
  await page.setViewportSize({ width: page.viewportSize().width, height: Math.min(page.viewportSize().height, 640) });
  await signIn(page);
  await page.goto('/admin/#/reportes');
  await expect(page.locator('main h1')).toHaveText('Centro de Ayuda');
  await expect(page.locator('.ticket-row').first()).toBeVisible(); // the page is full height
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  expect(await top(page, '.topbar')).toBe(0);
  await openNavIfNeeded(page);
  // The menu is longer than the screen: scroll it; the logo block stays put, the same height as the top bar.
  await page.locator('.sidebar').evaluate((e) => { e.scrollTop = e.scrollHeight; });
  await expect.poll(() => page.locator('.sidebar').evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  expect(await top(page, '.sidebar-head')).toBe(0);
  await expect(page.locator('.sidebar-head .brand')).toBeVisible();
  const [bar, head] = await Promise.all([page.locator('.topbar').evaluate((e) => e.offsetHeight), page.locator('.sidebar-head').evaluate((e) => e.offsetHeight)]);
  expect(head).toBe(bar);
});

test('an account in English signing in on a new device gets the whole panel in English', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one language check is enough');
  const { execFileSync } = await import('node:child_process');
  const sql = (q) => execFileSync('sqlite3', ['-cmd', '.timeout 5000', process.env.E2E_STORAGE + '/database.sqlite', q]).toString().trim();
  sql(`UPDATE users SET lang='en' WHERE email='${MANAGER.email}'`);
  try {
    await signIn(page, MANAGER, /^Hi, /);
    await openNavIfNeeded(page);
    await expect(page.locator('.nav a[href="#/"]')).toHaveText(/^Home/);
    await expect(page.locator('.nav a[href="#/reportes"]')).toHaveText(/^Support/);
    await expect(page.locator('.sidebar-head .brand small')).toHaveText(/content manager/i);
  } finally {
    sql(`UPDATE users SET lang='es' WHERE email='${MANAGER.email}'`);
  }
});
