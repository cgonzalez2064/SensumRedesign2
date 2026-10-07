// The public site with managed content: behavior, layout and worst-case text.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client, ADMIN, FIXTURES } from '../integration/helpers.mjs';
import { readFileSync } from 'node:fs';

const SCREENS = join(import.meta.dirname, '.artifacts', 'screens');
mkdirSync(SCREENS, { recursive: true });
const WIDTHS = [320, 390, 768, 1024, 1280, 1440];

async function api() {
  const c = new Client(process.env.E2E_BASE);
  await c.login(ADMIN.email, ADMIN.password);
  return c;
}

async function setValues(c, valueFor) {
  const { sections } = (await c.get('/api/content')).data;
  for (const sec of sections) {
    const values = {};
    for (const f of sec.fields) {
      const v = valueFor(f);
      if (v) values[f.key] = v;
    }
    if (Object.keys(values).length) {
      const r = await c.put('/api/content/' + sec.id, { version: sec.version, values });
      expect(r.status, `${sec.id}: ${JSON.stringify(r.data)}`).toBe(200);
    }
  }
}

function watch(page) {
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  return problems;
}

async function settle(page) {
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in-view')));
  await page.waitForTimeout(300);
}

test.describe.configure({ mode: 'serial' });

test('managed text, photos and contact details work in both languages without errors', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'content is shared; one browser sets it up');
  const c = await api();
  await setValues(c, (f) => (f.key === 'hero.title' ? { es: 'Construimos con *precisión* & confianza', en: 'We build with *precision*' }
    : f.key === 'contact.whatsapp' ? { '*': '+502 5555 1234' } : null));
  await c.upload('/api/media/proj1.gallery/upload', { altEs: 'Cocina terminada', altEn: 'Finished kitchen', anchor: 'center' }, { file: 'wide-1600x900.jpg' });
  await c.upload('/api/media/about.photo/upload', { altEs: 'Equipo en obra', altEn: 'Team on site' }, { file: 'portrait-1200x1600.jpg' });

  const problems = watch(page);
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('Construimos con precisión & confianza');
  await expect(page.locator('h1 em')).toHaveText('precisión');
  await expect(page.locator('#whatsappFab')).toHaveAttribute('href', /wa\.me\/50255551234/);
  await expect(page.locator('.about-art img.about-photo')).toHaveAttribute('alt', 'Equipo en obra');
  await page.locator('#langToggle').click();
  await expect(page.locator('h1')).toContainText('We build with precision');
  await expect(page.locator('h1 em')).toHaveText('precision');
  await expect(page.locator('.about-art img.about-photo')).toHaveAttribute('alt', 'Team on site');
  await expect(page.locator('#whatsappFab')).toHaveAttribute('href', /wa\.me\/50255551234\?text=Hi/);
  await page.locator('.project-card').first().click();
  await expect(page.locator('#projectModalSlides img').first()).toHaveAttribute('alt', 'Finished kitchen');
  await expect(page.locator('#projectModalNote')).toBeHidden();
  await page.keyboard.press('Escape');
  await page.locator('#langToggle').click();
  await expect(page.locator('h1')).toContainText('Construimos con precisión & confianza');
  expect(problems).toEqual([]);
});

test('no horizontal overflow and no errors at every width (current content)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'widths are covered explicitly');
  const problems = watch(page);
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto('/');
    await settle(page);
    const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    expect(sw, `width ${w}`).toBeLessThanOrEqual(iw);
  }
  expect(problems).toEqual([]);
});

test('content stress test: every field at its maximum length keeps the layout intact', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'content is shared; one browser sets it up');
  const c = await api();
  // Worst case: realistic words (they wrap) filling every field to its limit.
  const words = 'Remodelación integral planificada supervisión técnica construcción presupuesto detallado '.split(' ');
  const fill = (max) => { let s = ''; let i = 0; while (s.length < max) s += (s ? ' ' : '') + words[i++ % words.length]; return s.slice(0, max).trim(); };
  await setValues(c, (f) => {
    if (!f.bilingual) return null;
    const v = f.type === 'emphasis' ? '*' + fill(f.max - 2) + '*' : fill(f.max);
    return { es: v, en: v };
  });
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto('/');
    await settle(page);
    const report = await page.evaluate(() => {
      const iw = innerWidth;
      const overflow = document.documentElement.scrollWidth > iw;
      // Text must stay inside its card/box (no clipped or spilling copy).
      const spill = [];
      for (const sel of ['.project-card', '.service-card', '.hero-badge', '.hero-pillar', '.btn', '.mv-card', '.process-item', '.faq-item', '.eyebrow']) {
        document.querySelectorAll(sel).forEach((el) => {
          if (el.scrollWidth > el.clientWidth + 2) spill.push(sel + ' (' + el.textContent.trim().slice(0, 30) + ')');
        });
      }
      const card = document.querySelector('.project-card');
      const cardText = card.querySelector('h3').getBoundingClientRect();
      const cardBox = card.getBoundingClientRect();
      return { overflow, spill: [...new Set(spill)].slice(0, 8), cardTextInside: cardText.top >= cardBox.top - 1 };
    });
    await page.screenshot({ path: join(SCREENS, `stress-${w}.png`), fullPage: true });
    expect(report.overflow, `width ${w}: page overflow`).toBe(false);
    expect(report.spill, `width ${w}: text spilling out of components`).toEqual([]);
    expect(report.cardTextInside, `width ${w}: project title pushed out of its 4:3 card`).toBe(true);
  }
  // Put the approved copy back.
  await setValues(c, (f) => f.default);
});
