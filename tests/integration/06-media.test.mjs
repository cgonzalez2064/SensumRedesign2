// Photo and document uploads: validation, re-encoding, storage, publishing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, Client, createAdmin, FIXTURES } from './helpers.mjs';

let s; let c;
before(async () => {
  s = await startServer({ port: 8198 });
  createAdmin(s);
  c = new Client(s.base);
  await c.login();
});
after(async () => { await s.stop(); });

const up = (slot, file, fields = {}) => c.upload(`/api/media/${slot}/upload`, { altEs: 'Foto de prueba', anchor: 'center', ...fields }, { file });

test('valid JPG, PNG and WebP photos are accepted, re-encoded and published', async () => {
  const card = await up('proj1.card', 'landscape-4000x3000.jpg');
  assert.equal(card.status, 200);
  assert.match(card.data.item.url, /^assets\/uploads\/proj1-card-[a-f0-9]{12}-w1600\.(webp|jpg)$/);
  assert.deepEqual([card.data.item.width, card.data.item.height], [1600, 1200]);
  assert.equal((await up('proj2.card', 'photo-1600x1200.webp')).status, 200);
  assert.equal((await up('about.photo', 'square-1800.png')).status, 200);
  const html = s.readPublic('index.html');
  assert.match(html, /<img class="case-photo" src="assets\/uploads\/proj1-card-[a-f0-9]{12}-w1600\.\w+" srcset="[^"]+ 800w, [^"]+ 1600w"/);
  assert.match(html, /<div class="about-art has-photo">/);
  assert.match(html, /data-project="proj1" data-images="assets\/uploads\/proj1-card-/, 'card photo becomes the carousel when there is no gallery');
  const served = await fetch(s.base + '/' + card.data.item.url);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
});

test('photos are cropped to the slot shape using the chosen framing', async () => {
  const r = await up('proj1.gallery', 'wide-1600x900.jpg', { anchor: 'start' });
  assert.deepEqual([r.data.item.width, r.data.item.height], [1200, 900], '16:9 cropped to 4:3, never upscaled');
  const p = await up('proj1.gallery', 'portrait-1200x1600.jpg');
  assert.deepEqual([p.data.item.width, p.data.item.height], [1200, 900]);
});

test('dangerous and invalid files are refused with a clear reason', async () => {
  const cases = [
    ['script-disguised.jpg', 'file_type_not_allowed'],
    ['vector.svg', 'file_type_not_allowed'],
    ['page.html', 'file_type_not_allowed'],
    ['png-named.jpg', 'file_type_mismatch'],
    ['corrupt.jpg', 'image_corrupt'],
    ['small-800x600.jpg', 'image_too_small'],
    ['huge-9000x6000.jpg', 'image_too_large_pixels'],
  ];
  for (const [file, code] of cases) {
    const r = await up('proj3.card', file);
    assert.equal(r.status, 422, file);
    assert.equal(r.data.fields.file, code, file);
  }
  const missing = await c.upload('/api/media/proj3.card/upload', { altEs: 'x' }, {});
  assert.equal(missing.data.fields.file, 'file_required');
  const noAlt = await c.upload('/api/media/proj3.card/upload', { altEs: '' }, { file: 'wide-1600x900.jpg' });
  assert.equal(noAlt.data.fields.altEs, 'required');
  const htmlAlt = await c.upload('/api/media/proj3.card/upload', { altEs: '<img onerror=x>' }, { file: 'wide-1600x900.jpg' });
  assert.equal(htmlAlt.data.fields.altEs, 'no_html');
});

test('a polyglot (JPEG + hidden PHP) is neutralized by re-encoding', async () => {
  const r = await up('proj4.card', 'polyglot.jpg');
  assert.equal(r.status, 200);
  for (const f of readdirSync(s.public('assets/uploads')).filter((n) => n.startsWith('proj4-card'))) {
    const bytes = readFileSync(join(s.public('assets/uploads'), f));
    assert.ok(!bytes.includes('<?php') && !bytes.includes('system('), f);
  }
  assert.ok(readFileSync(join(FIXTURES, 'polyglot.jpg')).includes('<?php'), 'fixture really carried a payload');
});

test('oversized uploads are refused', async () => {
  const big = new Uint8Array(11 * 1024 * 1024).fill(0xff);
  const fd = new FormData();
  fd.append('altEs', 'x');
  fd.append('file', new Blob([big]), 'big.jpg');
  const r = await c.req('POST', '/api/media/proj5.card/upload', { form: fd });
  assert.equal(r.status, 422);
  assert.equal(r.data.fields.file, 'file_too_large');
});

test('PDF portfolio: real PDFs only, published as a download', async () => {
  assert.equal((await up('portfolio.pdf', 'fake.pdf')).data.fields.file, 'file_type_mismatch');
  assert.equal((await up('portfolio.pdf', 'landscape-4000x3000.jpg')).data.fields.file, 'file_type_not_allowed');
  const r = await up('portfolio.pdf', 'portfolio.pdf');
  assert.equal(r.status, 200);
  assert.match(s.readPublic('index.html'), new RegExp(`href="${r.data.item.url}" download=`));
  const pdf = await fetch(s.base + '/' + r.data.item.url);
  assert.equal(pdf.headers.get('content-disposition'), 'attachment');
  assert.equal(pdf.headers.get('content-security-policy'), 'sandbox');
});

test('alt text, ordering and removal update the site; bad ids are rejected', async () => {
  const list = (await c.get('/api/media')).data.slots.find((x) => x.id === 'proj1.gallery').items;
  assert.equal(list.length, 2);
  const [a, b] = list.map((i) => i.id);
  assert.equal((await c.put(`/api/media/item/${a}`, { altEs: 'Cocina remodelada', altEn: 'Remodeled kitchen' })).status, 200);
  let data = JSON.parse(s.readPublic('index.html').match(/id="siteContent">(.*?)<\/script>/s)[1]);
  assert.ok(Object.values(data.images).some((im) => im.alt.en === 'Remodeled kitchen'));
  assert.equal((await c.put('/api/media/proj1.gallery/order', { ids: [b, a] })).status, 200);
  assert.equal((await c.get('/api/media')).data.slots.find((x) => x.id === 'proj1.gallery').items[0].id, b);
  assert.equal((await c.put('/api/media/proj1.gallery/order', { ids: [b] })).data.fields.order, 'order_mismatch');
  assert.equal((await c.put('/api/media/proj1.gallery/order', { ids: ['1; DROP TABLE media'] })).status, 400);
  assert.equal((await c.del(`/api/media/item/${a}`)).status, 200);
  assert.equal((await c.del(`/api/media/item/${a}`)).status, 404);
  assert.equal((await c.del('/api/media/item/999999')).status, 404);
  assert.equal((await c.upload('/api/media/proj9.card/upload', { altEs: 'x' }, { file: 'wide-1600x900.jpg' })).status, 404);
  data = JSON.parse(s.readPublic('index.html').match(/id="siteContent">(.*?)<\/script>/s)[1]);
  assert.equal(Object.keys(data.images).filter((k) => k.includes('proj1-gallery')).length, 1);
});

test('galleries are capped at 10 photos', async () => {
  for (let i = 0; i < 9; i++) assert.equal((await up('proj6.gallery', 'wide-1600x900.jpg')).status, 200);
  const before = (await c.get('/api/media')).data.slots.find((x) => x.id === 'proj6.gallery').items.length;
  for (let i = before; i < 10; i++) await up('proj6.gallery', 'wide-1600x900.jpg');
  assert.equal((await up('proj6.gallery', 'wide-1600x900.jpg')).data.fields.file, 'gallery_full');
});

test('uploads are refused without a session or CSRF token', async () => {
  const anon = new Client(s.base);
  assert.equal((await anon.upload('/api/media/proj1.card/upload', { altEs: 'x' }, { file: 'wide-1600x900.jpg' })).status, 401);
  const noCsrf = new Client(s.base);
  noCsrf.cookies = c.cookies;
  assert.equal((await noCsrf.upload('/api/media/proj1.card/upload', { altEs: 'x' }, { file: 'wide-1600x900.jpg' })).status, 403);
});
