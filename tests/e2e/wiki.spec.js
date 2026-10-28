// The wiki in real browsers: from the menu, searching, an article with its
// steps and «En esta página», screenshots that follow the device and the
// theme, marking text to ask support, a role's locked article, and the
// «Novedades» dialog (with answers prepared here: the test server has them off).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SALES } from './global-setup.mjs';

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
  // The theme was just switched: colors are checked once the new styles apply (two frames) and their transitions end.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect && a.effect.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
  const v = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.filter((x) => ['serious', 'critical'].includes(x.impact));
  expect(v.map((x) => `${x.id}: ${x.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
}
const noSideScroll = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

test('the wiki: menu, search, an article with steps, screenshots that follow device and theme, asking support about marked text', async ({ page }, info) => {
  await signIn(page, SALES);
  if (await page.locator('.open-nav').isVisible()) await page.locator('.open-nav').click();
  await page.locator('.nav a[data-nav="wiki"]').click();
  await expect(page.locator('main h1')).toHaveText('Wiki');
  await expect(page.locator('.wiki-cat')).not.toHaveCount(0);
  // «Para tu rol»: Ventas y prospectos sees its articles; «Todo el panel» adds the rest, marked.
  await expect(page.locator('a.wiki-card[href="#/wiki/prospectos"]')).toBeVisible();
  await expect(page.locator('a.wiki-card[href="#/wiki/textos"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Todo el panel' }).click();
  await expect(page.locator('a.wiki-card.is-locked[href="#/wiki/textos"]')).toBeVisible();
  await axe(page);
  await noSideScroll(page);

  // Searching (accents and capitals don't matter), then opening the first result.
  await page.getByLabel('Buscar en la wiki').fill('EXPORTAR estadisticas');
  await expect(page.locator('.wiki-results a.wiki-card').first()).toHaveAttribute('href', '#/wiki/estadisticas');
  await expect(page.locator('.wiki-results mark').first()).toBeVisible();
  await page.getByLabel('Buscar en la wiki').press('Enter');
  await expect(page.locator('main h1')).toHaveText('Estadísticas: ver, filtrar y compartir');
  await expect(page.locator('.wiki-steps li').first()).toBeVisible();
  await expect(page.locator('.ui-chip', { hasText: 'Enviar por correo' }).first()).toBeVisible();

  // Screenshots: the device chosen here (remembered) and the panel's theme.
  const img = page.locator('.wiki-figure img').first();
  await expect(img).toHaveAttribute('src', /theme=light/);
  await page.locator('.wiki-device').getByRole('button', { name: 'Celular' }).click();
  await expect(page.locator('.wiki-figure').first()).toHaveAttribute('data-device', 'mobile');
  await expect(img).toHaveAttribute('src', /device=mobile/);
  await expect.poll(async () => img.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await expect(img).toHaveAttribute('src', /theme=dark/);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.locator('.wiki-device').getByRole('button', { name: 'Computadora' }).click();
  await axe(page);
  await noSideScroll(page);

  // Marking text → «Preguntar a soporte» → a request with the topic and the quote.
  await page.evaluate(() => {
    const p = document.querySelector('.wiki-body p');
    const r = document.createRange();
    r.selectNodeContents(p);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  });
  const pop = page.locator('.ask-pop');
  await expect(pop).toBeVisible();
  await pop.click();
  const dlg = page.getByRole('dialog', { name: 'Preguntar a soporte' });
  await expect(dlg.getByLabel(/^Título/)).toHaveValue('Pregunta: Estadísticas: ver, filtrar y compartir');
  await expect(dlg.getByLabel(/^Descripción/)).toHaveValue(/^Sobre «Estadísticas muestra cuántas personas visitan el sitio/);
  await expect(dlg.locator('input[name="rtype"][value="other"]')).toBeChecked();
  await dlg.getByLabel(/^Descripción/).press('End');
  // One question per device: the same request twice in 15 minutes is refused as a duplicate.
  await dlg.getByLabel(/^Descripción/).pressSequentially(` ¿Se cuentan las visitas desde ${info.project.name}?`);
  await dlg.getByRole('button', { name: 'Enviar solicitud' }).click();
  await expect(dlg.getByRole('heading', { name: 'Solicitud enviada' })).toBeVisible();
});

test('an article the role doesn\'t include offers to ask for it; app.…/wiki/<artículo> opens it', async ({ page }) => {
  await signIn(page, SALES);
  await page.goto('/wiki/textos');
  await expect(page.locator('main h1')).toHaveText('Cambiar los textos del sitio');
  await expect(page.getByText('Tu rol no incluye esta sección')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pedir acceso' })).toBeVisible();
  await expect(page.locator('.wiki-who')).toContainText('Textos del sitio');
});

test('«Novedades»: shown once after signing in, «Ver cómo funciona» opens the article and marks it seen', async ({ page }) => {
  const seen = [];
  await page.route('**/api/wiki/news?**', (route) => route.fulfill({ json: { ok: true, news: [
    { id: 'n1', date: '2026-10-27', article: 'estadisticas', shot: 'estadisticas', title: 'Estadísticas para compartir', summary: 'Elige el período, expórtalas o envíalas.', points: ['Exporta a hoja de cálculo.', 'Envía un reporte por correo.'], seen: false },
    { id: 'n2', date: '2026-10-27', article: 'mas-secciones', shot: 'mas-secciones', title: 'Más secciones', summary: 'Pide lo que necesitas.', points: [], seen: false },
  ] } }));
  await page.route('**/api/wiki/news/seen', async (route) => { seen.push(route.request().postDataJSON().ids); await route.fulfill({ json: { ok: true, marked: 1 } }); });
  await signIn(page, SALES);
  const dlg = page.getByRole('dialog', { name: 'Novedades para ti' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('heading', { name: 'Estadísticas para compartir' })).toBeVisible();
  await expect(dlg.locator('.dialog-head .news-progress')).toContainText('1 de 2'); // under the title, always in view
  await expect(page.locator('.nav a[data-nav="wiki"] .nav-badge')).toHaveText('2');
  await axe(page);
  await dlg.getByRole('button', { name: 'Siguiente' }).click();
  await expect(dlg.getByRole('heading', { name: 'Más secciones' })).toBeVisible();
  await dlg.getByRole('button', { name: 'Ver cómo funciona' }).click();
  await expect(page.locator('main h1')).toHaveText('Más secciones y pedir acceso');
  expect(seen[0]).toEqual(['n1', 'n2']);
});
