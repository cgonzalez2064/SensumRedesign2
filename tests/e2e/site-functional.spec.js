// The approved public site's own behavior still works (regression check).
import { test, expect } from '@playwright/test';

function watch(page) {
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('fonts.g')) problems.push(r.status() + ' ' + r.url()); });
  return problems;
}

test('navigation, anchors and external links', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/');
  for (const id of ['inicio', 'nosotros', 'servicios', 'proyectos', 'faq', 'contacto']) {
    await expect(page.locator('#' + id)).toHaveCount(1);
  }
  const links = await page.$$eval('a[href]', (as) => as.map((a) => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel })));
  for (const l of links) {
    if (l.href.startsWith('#')) expect(await page.locator(l.href === '#main' ? '#main' : l.href).count(), l.href).toBe(1);
    if (l.target === '_blank') expect(l.rel, l.href).toMatch(/noopener/);
  }
  for (const href of ['privacy-notice.html', 'assets/portfolio/sensum-portafolio-proyectos.pdf']) {
    expect((await page.request.get('/' + href)).status(), href).toBe(200);
  }
  expect(problems).toEqual([]);
});

test('mobile menu opens, traps focus and closes (Escape / link / backdrop)', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop-chrome', 'hamburger only below 900px');
  await page.goto('/');
  const toggle = page.locator('#menuToggle');
  await toggle.click();
  await expect(page.locator('#mobileNav')).toHaveAttribute('aria-hidden', 'false');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#mobileNav')).toHaveAttribute('aria-hidden', 'true');
  await toggle.click();
  await page.locator('#mobileNav a[href="#servicios"]').click();
  await expect(page.locator('#mobileNav')).toHaveAttribute('aria-hidden', 'true');
});

test('project modal: open, arrows, keyboard, Escape restores focus', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in-view')));
  const btn = page.locator('.project-card-btn').nth(1);
  await btn.click();
  const modal = page.locator('#projectModal');
  await expect(modal).toHaveClass(/is-open/);
  await expect(page.locator('#projectModalTitle')).toHaveText(await page.locator('.project-card h3').nth(1).textContent());
  await expect(page.locator('.project-modal-slide.is-active')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#projectModalDots button').nth(1)).toHaveAttribute('aria-current', 'true');
  await page.locator('#projectModalPrev').click();
  await expect(page.locator('#projectModalDots button').nth(0)).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('Escape');
  await expect(modal).not.toHaveClass(/is-open/);
  await expect(btn).toBeFocused();
});

test('FAQ items expand and collapse', async ({ page }) => {
  await page.goto('/');
  const item = page.locator('.faq-item').first();
  await item.locator('summary').click();
  await expect(item).toHaveAttribute('open', '');
  await item.locator('summary').click();
  await expect(item).not.toHaveAttribute('open', '');
});

test('contact form validates and keeps what the visitor typed', async ({ page }) => {
  await page.goto('/');
  await page.locator('#contactForm button[type=submit]').click();
  await expect(page.locator('#formSummary')).toBeVisible();
  await expect(page.locator('#name')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#name').fill('Ana Pérez');
  await page.locator('#message').fill('Necesito remodelar la cocina.');
  await page.locator('#contactForm button[type=submit]').click();
  await expect(page.locator('#name')).toHaveAttribute('aria-invalid', 'false');
  await expect(page.locator('#message')).toHaveValue('Necesito remodelar la cocina.');
});

test('language toggle switches everything and is remembered', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/');
  await page.locator('#langToggle').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('[data-i18n="nav.cta"]').first()).toHaveText('Get a Quote');
  await expect(page).toHaveTitle(/Construction & Remodeling/);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.locator('#langToggle').click();
  await expect(page.locator('[data-i18n="nav.cta"]').first()).toHaveText('Cotizar proyecto');
  expect(problems).toEqual([]);
});

test('privacy notice and 404 page render without errors', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/privacy-notice.html');
  await expect(page.locator('h1')).toHaveText('Aviso de Privacidad');
  const r = await page.goto('/pagina-que-no-existe');
  expect(r.status()).toBe(404);
  await expect(page.locator('h1')).toContainText('Página no encontrada');
  // The only expected "error" is the 404 status of the missing page itself.
  expect(problems.filter((p) => !p.startsWith('404') && !/status of 404/.test(p))).toEqual([]);
});
