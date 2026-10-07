import { test, expect } from '@playwright/test';

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'laptop-1280', width: 1280, height: 800 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-320', width: 320, height: 640 },
];

// Reveal-on-scroll elements start at opacity:0 until scrolled into view;
// force the final state so full-page captures are deterministic.
async function settle(page) {
  await page.evaluate(async () => {
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in-view'));
    const y = document.getElementById('year');
    if (y) y.textContent = '2026';
    await document.fonts.ready;
  });
  await page.waitForTimeout(400);
}

async function open(page, lang) {
  await page.addInitScript((l) => { try { localStorage.setItem('sensum_lang', l); } catch (e) {} }, lang);
  await page.goto('/index.html');
  await settle(page);
}

for (const vp of VIEWPORTS) {
  for (const lang of ['es', 'en']) {
    test(`home ${lang} ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await open(page, lang);
      await expect(page).toHaveScreenshot(`home-${lang}-${vp.name}.png`, { fullPage: true });
    });
  }

  test(`project modal ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await open(page, 'es');
    await page.locator('.project-card').first().click();
    await page.waitForTimeout(700);
    await expect(page).toHaveScreenshot(`modal-es-${vp.name}.png`);
  });
}

test('mobile nav open 390', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'es');
  await page.click('#menuToggle');
  await page.waitForTimeout(600);
  await expect(page).toHaveScreenshot('mobile-nav-es-390.png');
});

test('contact form validation 1280', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, 'es');
  await page.locator('#contactForm button[type=submit]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('#contacto')).toHaveScreenshot('contact-invalid-es-1280.png');
});

test('faq open 768', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await open(page, 'es');
  await page.locator('.faq-item summary').first().click();
  await page.waitForTimeout(300);
  await expect(page.locator('#faq')).toHaveScreenshot('faq-open-es-768.png');
});

for (const p of ['privacy-notice.html', '404.html']) {
  for (const vp of [VIEWPORTS[0], VIEWPORTS[3]]) {
    test(`${p} ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/' + p);
      await settle(page);
      await expect(page).toHaveScreenshot(`${p.replace('.html', '')}-${vp.name}.png`, { fullPage: true });
    });
  }
}
