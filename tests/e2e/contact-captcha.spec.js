// The public contact form in real browsers: the invisible captcha is solved in
// the background and the message reaches the inbox configured in the panel.
import { test, expect } from '@playwright/test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ADMIN, ROOT, waitForMail, countTo } from '../integration/helpers.mjs';

// The handler allows 5 messages per 10 minutes per client (127.0.0.1 for every browser here).
test.beforeEach(() => {
  const rl = join(ROOT, 'assets', '.rl-data', createHash('sha256').update('sensum-rl|127.0.0.1').digest('hex') + '.json');
  if (existsSync(rl)) rmSync(rl);
});

/** Points the contact form at a fresh Mailpit address through the owner's API (password confirmed). */
async function configureContact(request, baseURL, to) {
  const headers = { Origin: baseURL, Accept: 'application/json' };
  const login = await request.post('/api/auth/login', { headers, data: { email: ADMIN.email, password: ADMIN.password } });
  const { csrf } = await login.json();
  const current = await (await request.get('/api/settings/email', { headers })).json();
  const r = await request.put('/api/settings/email', {
    headers: { ...headers, 'X-CSRF-Token': csrf },
    data: {
      smtp: { ...current.smtp, password: '' },
      supportEmail: current.supportEmail, alertEmail: current.alertEmail,
      contact: { to: [to], fromAddress: 'formulario@sensumconstrucciones.com', fromName: 'Sitio web Sensum', method: 'smtp', turnstileSiteKey: '', turnstileSecret: '' },
      currentPassword: ADMIN.password,
    },
  });
  expect(r.status()).toBe(200);
}

test('a visitor sends the contact form; the captcha is solved without them noticing', async ({ page, request, baseURL }, info) => {
  const to = `e2e-contact-${info.project.name}-${Date.now()}@example.test`;
  await configureContact(request, baseURL, to);
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) problems.push(m.text()); });
  const cloudflare = [];
  page.on('request', (r) => { if (r.url().includes('challenges.cloudflare.com')) cloudflare.push(r.url()); });

  await page.goto('/');
  const note = page.locator('#formCaptcha');
  await expect(note).toHaveAttribute('data-state', 'idle');
  await page.locator('#contacto').scrollIntoViewIfNeeded();
  await page.locator('#name').fill('Visitante de Prueba');
  // Solved in the background while the visitor types.
  await expect(note).toHaveAttribute('data-state', 'ok', { timeout: 20000 });
  await expect(page.locator('#formCaptchaText')).toHaveText('Verificación anti-spam completa.');
  await expect(page.locator('#formCaptchaAnswer')).not.toHaveValue('');
  await page.locator('#phone').fill('5555-1234');
  await page.locator('#email').fill('visitante@example.test');
  await page.locator('#service').selectOption('Obra civil');
  await page.locator('#message').fill('Quisiera una cotización para un muro perimetral.');
  await page.waitForTimeout(3200); // the handler ignores forms filled in under 3 seconds
  await page.locator('#contactForm button[type=submit]').click();
  await expect(page.locator('#formStatus')).toHaveText('¡Gracias! Tu mensaje ha sido enviado. Te contactaremos pronto.', { timeout: 20000 });
  await waitForMail(to, 1, 8000);
  expect(await countTo(to)).toBe(1);
  // A new answer is prepared for a second message (each answer works once).
  await expect(note).toHaveAttribute('data-state', 'ok', { timeout: 20000 });
  expect(cloudflare, 'Turnstile is not loaded unless the owner enables it').toEqual([]);
  expect(problems).toEqual([]);
});

test('if the answer was already used, the page gets a new one and sends anyway', async ({ page, request, baseURL }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one browser is enough');
  const to = `e2e-retry-${Date.now()}@example.test`;
  await configureContact(request, baseURL, to);
  await page.goto('/');
  await page.locator('#name').fill('Visitante Insistente');
  await expect(page.locator('#formCaptcha')).toHaveAttribute('data-state', 'ok', { timeout: 20000 });
  // Spend the answer behind the page's back (as if it had expired or been used).
  const answer = await page.locator('#formCaptchaAnswer').inputValue();
  await page.evaluate(async (captcha) => {
    const fd = new FormData();
    Object.entries({ name: 'Otro', phone: '5555-0000', email: 'otro@example.test', service: 'Otro', message: 'Mensaje que gasta la respuesta.', loaded_at: String(Date.now() - 10000), captcha }).forEach(([k, v]) => fd.append(k, v));
    await fetch('assets/contact-handler.php', { method: 'POST', body: fd, headers: { Accept: 'application/json' } });
  }, answer);
  await page.locator('#phone').fill('5555-1234');
  await page.locator('#email').fill('insistente@example.test');
  await page.locator('#service').selectOption('Remodelaciones');
  await page.locator('#message').fill('Segundo intento con una respuesta ya usada.');
  await page.waitForTimeout(3200);
  await page.locator('#contactForm button[type=submit]').click();
  await expect(page.locator('#formStatus')).toHaveText('¡Gracias! Tu mensaje ha sido enviado. Te contactaremos pronto.', { timeout: 20000 });
  await waitForMail(to, 2, 8000);
  expect(await countTo(to)).toBe(2);
});
