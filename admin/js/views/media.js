/** Fotos y archivos — photo slots, project galleries and the portfolio PDF. */
import { h, icon, clear } from '../dom.js';
import { t, fmtBytes, fmtRelative } from '../i18n.js';
import { api, upload } from '../api.js';
import { pageHead, loading, loadError, textField, alertBox, toast, errorText, fieldErrorText, openDialog, confirmDialog, setBusy, button } from '../ui.js';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const CLIENT_MAX_SIDE = 3200; // larger photos are reduced in the browser before uploading

export async function render({ main, params, navigate }) {
  const tab = params[0] || 'nosotros';
  main.append(pageHead({ title: t('media.title'), lead: t('media.lead') }));
  const tabs = h('nav', { class: 'tabs', 'aria-label': t('media.title') },
    [['nosotros', 'about', 'people'], ['proyectos', 'projects', 'images'], ['documentos', 'documents', 'file-earmark-pdf']].map(([slug, key, ic]) =>
      h('a', { class: 'tab', href: '#/fotos/' + slug, 'aria-current': slug === tab ? 'page' : null }, icon(ic), t('media.tabs.' + key))));
  const body = h('div', { class: 'stack-lg' }, loading());
  main.append(tabs, body);

  const ctx = { maxImage: 0, maxPdf: 0, titles: {}, ctaLabel: '' };
  const load = async () => {
    let media, content;
    try {
      [media, content] = await Promise.all([api.get('/media'), api.get('/content')]);
    } catch (err) {
      clear(body).append(loadError(err, load));
      return;
    }
    ctx.maxImage = media.maxImageBytes;
    ctx.maxPdf = media.maxPdfBytes;
    const proj = content.sections.find((s) => s.id === 'projects');
    for (const f of proj.fields) {
      const m = f.key.match(/^(proj\d)\.title$/);
      if (m) ctx.titles[m[1]] = f.value.es;
      if (f.key === 'projects.cta') ctx.ctaLabel = f.value.es;
    }
    const slots = Object.fromEntries(media.slots.map((s) => [s.id, s]));
    const y = window.scrollY;
    clear(body);
    if (tab === 'nosotros') body.append(singleSlot(slots['about.photo'], ctx, load));
    else if (tab === 'documentos') body.append(pdfSlot(slots['portfolio.pdf'], ctx, load));
    else {
      for (let i = 1; i <= 6; i++) {
        const pid = 'proj' + i;
        body.append(h('section', { class: 'card project-panel', 'aria-labelledby': pid + '-t' },
          h('div', { class: 'card-header' }, h('div', null,
            h('div', { class: 'tiny muted', text: t('content.groups.project', { n: i }) }),
            h('h2', { id: pid + '-t', text: ctx.titles[pid] }))),
          singleSlot(slots[pid + '.card'], ctx, load, true),
          gallerySlot(slots[pid + '.gallery'], ctx, load)));
      }
    }
    window.scrollTo(0, y);
  };
  await load();
}

// ------------------------------------------------------------------ requirement list
function requirements(slot, ctx) {
  const items = [
    t('media.reqFormats', { max: fmtBytes(ctx.maxImage) }),
    t('media.reqRecommended', { w: slot.recommended[0], h: slot.recommended[1], mw: slot.min[0], mh: slot.min[1] }),
    slot.ratio ? t('media.req43') : t('media.reqFree'),
  ];
  return h('ul', { class: 'reqs' }, items.map((s) => h('li', null, icon('info-circle-fill'), h('span', { text: s }))));
}

function slotTexts(slot, ctx) {
  if (slot.id === 'about.photo') return t('media.about');
  const [title, where] = slot.multiple ? t('media.gallery') : t('media.card');
  return [title, where.replace('{project}', ctx.titles[slot.project] || '')];
}

// ------------------------------------------------------------------ single image slot
function singleSlot(slot, ctx, reload, compact = false) {
  const item = slot.items[0] || null;
  const [title, where] = slotTexts(slot, ctx);
  const media = h('div', { class: 'slot-media' });
  media.style.aspectRatio = slot.ratio ? `${slot.ratio[0]} / ${slot.ratio[1]}` : `${slot.frames[0][0]} / ${slot.frames[0][1]}`;
  if (item) media.append(h('img', { src: '../' + item.thumb, alt: '', loading: 'lazy' }));
  else media.append(h('div', { class: 'slot-empty' }, icon('image'), h('strong', { text: t('media.noPhoto') }), h('span', { text: t(slot.id === 'about.photo' ? 'media.noPhotoAbout' : 'media.noPhotoCard') })));

  const actions = h('div', { class: 'row' },
    button(item ? t('media.change') : t('media.upload'), { variant: 'primary', icon: 'cloud-arrow-up', small: compact, onClick: () => imageDialog(slot, ctx, item, reload) }),
    item ? button(t('media.editAlt'), { icon: 'pencil', small: true, onClick: () => altDialog(slot, item, reload) }) : null,
    item ? button(t('media.remove'), { icon: 'trash3', small: true, variant: 'ghost', onClick: () => removeItem(item, reload) }) : null);

  const info = h('div', { class: 'stack-sm' },
    h(compact ? 'h3' : 'h2', { text: title }),
    h('p', { class: 'small muted', text: where }),
    requirements(slot, ctx),
    item ? h('p', { class: 'small' }, h('strong', { text: t('media.altLabel') + ': ' }), h('span', { class: item.altEs ? '' : 'muted', text: item.altEs || t('media.altMissing') })) : null,
    item ? h('p', { class: 'tiny muted', text: `${item.width} × ${item.height} px · ${fmtBytes(item.bytes)} · ${fmtRelative(item.createdAt)}` }) : null,
    actions);
  return h(compact ? 'div' : 'section', { class: [compact ? '' : 'card', 'slot', 'split'] }, media, info);
}

// ------------------------------------------------------------------ gallery slot
function gallerySlot(slot, ctx, reload) {
  const [title, where] = slotTexts(slot, ctx);
  const ids = slot.items.map((i) => i.id);
  const move = async (from, to) => {
    const order = ids.slice();
    order.splice(to, 0, order.splice(from, 1)[0]);
    try { await api.put(`/media/${slot.id}/order`, { ids: order }); toast(t('media.reordered')); reload(); }
    catch (err) { toast(errorText(err), { type: 'bad' }); }
  };
  const grid = h('div', { class: 'gallery' }, slot.items.map((item, i) => h('div', { class: 'gallery-item' },
    h('div', { class: 'thumb' }, h('img', { src: '../' + item.thumb, alt: item.altEs || t('media.photoN', { n: i + 1 }), loading: 'lazy' })),
    h('div', { class: 'tools' },
      h('span', { class: 'pos', text: '#' + (i + 1) }),
      h('div', { class: 'row', style: null },
        h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': t('common.moveUp') + ' — ' + t('media.photoN', { n: i + 1 }), disabled: i === 0, onclick: () => move(i, i - 1) }, icon('arrow-up')),
        h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': t('common.moveDown') + ' — ' + t('media.photoN', { n: i + 1 }), disabled: i === ids.length - 1, onclick: () => move(i, i + 1) }, icon('arrow-down')),
        h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': t('media.editAlt') + ' — ' + t('media.photoN', { n: i + 1 }), onclick: () => altDialog(slot, item, reload) }, icon('pencil')),
        h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': t('media.remove') + ' — ' + t('media.photoN', { n: i + 1 }), onclick: () => removeItem(item, reload) }, icon('trash3')))))),
  slot.items.length < slot.max ? h('button', { type: 'button', class: 'gallery-add', onclick: () => imageDialog(slot, ctx, null, reload) }, icon('plus-lg', 'icon-lg'), t('media.add')) : null);
  return h('div', { class: 'stack-sm' },
    h('div', { class: 'row-between' }, h('h3', { text: title }), h('span', { class: 'badge', text: t('media.galleryCount', { n: slot.items.length, max: slot.max }) })),
    h('p', { class: 'small muted', text: where }),
    slot.items.length ? null : h('p', { class: 'small muted', text: t('media.galleryEmpty') }),
    grid);
}

// ------------------------------------------------------------------ PDF slot
function pdfSlot(slot, ctx, reload) {
  const item = slot.items[0] || null;
  const [title, where] = t('media.pdf');
  return h('section', { class: 'card stack' },
    h('div', { class: 'row' }, h('span', { class: 'icon-tile' }, icon('file-earmark-pdf')), h('div', { class: 'grow' }, h('h2', { text: title }), h('p', { class: 'small muted', text: where.replace('{button}', ctx.ctaLabel) }))),
    h('dl', { class: 'kv' },
      h('dt', { text: t('media.pdfCurrent') }),
      h('dd', { text: item ? `${item.originalName || 'PDF'} · ${fmtBytes(item.bytes)} · ${fmtRelative(item.createdAt)}` : t('media.pdfDefault') })),
    h('ul', { class: 'reqs' }, h('li', null, icon('info-circle-fill'), h('span', { text: t('media.reqPdf', { max: fmtBytes(ctx.maxPdf) }) }))),
    h('div', { class: 'row' },
      button(t('media.pdfReplace'), { variant: 'primary', icon: 'cloud-arrow-up', onClick: () => pdfDialog(ctx, reload) }),
      h('a', { class: 'btn btn-sm', href: '../' + (item ? item.url : 'assets/portfolio/sensum-portafolio-proyectos.pdf'), download: '' }, icon('download'), t('media.pdfDownload')),
      item ? button(t('media.pdfRestore'), { small: true, variant: 'ghost', icon: 'arrow-counterclockwise', onClick: async () => {
        if (!(await confirmDialog({ title: t('media.pdfRestoreTitle'), body: t('media.pdfRestoreBody'), confirmLabel: t('media.pdfRestore') }))) return;
        try { await api.del('/media/item/' + item.id); toast(t('media.removed')); reload(); } catch (err) { toast(errorText(err), { type: 'bad' }); }
      } }) : null));
}

// ------------------------------------------------------------------ actions
async function removeItem(item, reload) {
  if (!(await confirmDialog({ title: t('media.confirmRemoveTitle'), body: t('media.confirmRemoveBody'), confirmLabel: t('media.remove'), danger: true }))) return;
  try { await api.del('/media/item/' + item.id); toast(t('media.removed')); reload(); }
  catch (err) { toast(errorText(err), { type: 'bad' }); }
}

function altFields(slot, item) {
  const es = textField({ label: t('media.altEs'), value: item ? item.altEs : '', max: 150, hint: t('media.altHelp'), optionalTag: !slot.altRequired, lang: 'es' });
  const en = textField({ label: t('media.altEn'), value: item ? item.altEn : '', max: 150, hint: t('media.altEnHelp'), optionalTag: true, lang: 'en' });
  const check = () => {
    let ok = true;
    for (const [f, req] of [[es, slot.altRequired], [en, false]]) {
      const v = f.input.value.trim();
      const code = !v && req ? 'required' : /[<>]/.test(v) ? 'no_html' : [...v].length > 150 ? 'too_long' : null;
      f.setError(code ? fieldErrorText(code, { max: 150 }) : null);
      if (code && ok) { f.input.focus(); ok = false; }
    }
    return ok;
  };
  return { es, en, check };
}

function altDialog(slot, item, reload) {
  const f = altFields(slot, item);
  const msg = h('div');
  const dlg = openDialog({
    title: t('media.dialogAlt'), body: h('div', { class: 'stack' }, h('img', { src: '../' + item.thumb, alt: '', class: 'slot-media' }), f.es.wrap, f.en.wrap, msg),
    actions: [
      { label: t('common.cancel'), onClick: (b, close) => close() },
      { label: t('common.save'), variant: 'primary', onClick: async (btn, close) => {
        clear(msg);
        if (!f.check()) return;
        setBusy(btn, true, t('common.saving'));
        try { await api.put('/media/item/' + item.id, { altEs: f.es.input.value, altEn: f.en.input.value }); toast(t('media.altSaved')); close(); reload(); }
        catch (err) {
          setBusy(btn, false);
          if (err.code === 'validation') { if (err.fields.altEs) f.es.setError(fieldErrorText(err.fields.altEs, { max: 150 })); if (err.fields.altEn) f.en.setError(fieldErrorText(err.fields.altEn, { max: 150 })); }
          else msg.append(alertBox('bad', null, errorText(err, { preserved: true })));
        }
      } },
    ],
  });
  setTimeout(() => f.es.input.focus(), 60);
}

/** Reads a local image (orientation-corrected) and reduces it if it is very large. */
async function prepareImage(file) {
  const bitmap = await createImageBitmap(file);
  const w = bitmap.width;
  const h0 = bitmap.height;
  let out = file;
  let resized = false;
  const big = Math.max(w, h0) > CLIENT_MAX_SIDE;
  if (big) {
    const scale = CLIENT_MAX_SIDE / Math.max(w, h0);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h0 * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
    if (blob) {
      out = new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
      resized = true;
    }
  }
  bitmap.close && bitmap.close();
  return { file: out, width: big ? Math.round(w * (CLIENT_MAX_SIDE / Math.max(w, h0))) : w, height: big ? Math.round(h0 * (CLIENT_MAX_SIDE / Math.max(w, h0))) : h0, resized };
}

function frameLabels(slot) {
  if (slot.id === 'about.photo') return ['desktop', 'tablet', 'mobile'];
  return [slot.multiple ? 'modal' : 'card'];
}

function imageDialog(slot, ctx, current, reload) {
  let chosen = null; // { file, width, height, resized, url }
  let anchor = 'center';
  const fileInput = h('input', { type: 'file', accept: IMAGE_TYPES.join(','), class: 'sr-only', id: 'media-file' });
  const fileErr = h('div', { class: 'field-error', hidden: true, role: 'alert' });
  const pick = h('div', { class: 'stack' });
  const previewArea = h('div', { class: 'stack' });
  const alt = altFields(slot, current);
  const msg = h('div', { 'aria-live': 'polite' });
  const progress = h('div', { class: 'stack-sm', hidden: true }, h('div', { class: 'progress', 'aria-hidden': 'true' }, h('span')), h('span', { class: 'small muted', role: 'status' }));

  const dropzone = h('label', { class: 'dropzone', for: 'media-file' },
    icon('cloud-arrow-up'), h('strong', { text: t('media.drop') }), h('span', { class: 'small', text: t('media.or') }),
    h('span', { class: 'btn btn-sm', text: t('media.choose') }), h('span', { class: 'tiny', text: t('media.tapHint') }));
  ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('over'); }));
  dropzone.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });
  pick.append(fileInput, dropzone, requirements(slot, ctx), fileErr);

  const showErr = (text) => { fileErr.textContent = text; fileErr.hidden = !text; };

  async function handleFile(file) {
    showErr('');
    if (!IMAGE_TYPES.includes(file.type) && !IMAGE_EXT.test(file.name)) return showErr(t('media.notImage'));
    let prepared;
    try { prepared = await prepareImage(file); } catch (e) { return showErr(t('media.unreadable')); }
    const [mw, mh] = slot.min;
    const fitsMin = (prepared.width >= mw && prepared.height >= mh);
    if (!fitsMin) return showErr(t('media.tooSmall', { w: prepared.width, h: prepared.height, mw, mh }));
    if (prepared.file.size > ctx.maxImage) return showErr(t('media.tooBig', { size: fmtBytes(prepared.file.size), max: fmtBytes(ctx.maxImage) }));
    if (chosen && chosen.url) URL.revokeObjectURL(chosen.url);
    chosen = { ...prepared, url: URL.createObjectURL(prepared.file) };
    anchor = 'center';
    renderPreview();
  }

  function renderPreview() {
    clear(previewArea);
    if (!chosen) { pick.hidden = false; return; }
    pick.hidden = true;
    const imgRatio = chosen.width / chosen.height;
    const target = slot.ratio ? slot.ratio[0] / slot.ratio[1] : null;
    const crops = target && Math.abs(imgRatio - target) / target > 0.02;
    const horizontal = target && imgRatio > target;
    const pos = { start: horizontal ? '0% 50%' : '50% 0%', center: '50% 50%', end: horizontal ? '100% 50%' : '50% 100%' };
    const frames = h('div', { class: 'frames' }, slot.frames.map((fr, i) => {
      const box = h('div', { class: 'box' }, h('img', { src: chosen.url, alt: '' }));
      box.style.aspectRatio = `${fr[0]} / ${fr[1]}`;
      box.firstChild.style.objectPosition = pos[anchor];
      return h('div', { class: 'frame' }, box, h('span', { class: 'cap', text: t('media.frames.' + frameLabels(slot)[i]) }));
    }));
    const warnings = [];
    if (chosen.resized) warnings.push(alertBox('info', null, t('media.infoResized')));
    if (chosen.width < slot.recommended[0] || chosen.height < slot.recommended[1]) warnings.push(alertBox('warn', null, t('media.warnSmall', { w: chosen.width, h: chosen.height, rw: slot.recommended[0], rh: slot.recommended[1] })));
    if (crops) warnings.push(alertBox('warn', null, t('media.warnCrop')));
    let anchorCtl = null;
    if (crops) {
      const labels = horizontal ? t('media.anchorH') : t('media.anchorV');
      anchorCtl = h('div', { class: 'field' }, h('span', { class: 'label', id: 'anchor-l', text: t('media.anchor') }),
        h('div', { class: 'segmented', role: 'group', 'aria-labelledby': 'anchor-l' }, ['start', 'center', 'end'].map((a) => h('button', {
          type: 'button', 'aria-pressed': String(a === anchor), onclick: () => { anchor = a; renderPreview(); },
        }, labels[a]))), h('span', { class: 'hint', text: t('media.anchorHelp') }));
    }
    previewArea.append(
      h('div', { class: 'row-between' }, h('span', { class: 'small', text: `${chosen.file.name} · ${chosen.width} × ${chosen.height} px · ${fmtBytes(chosen.file.size)}` }),
        h('label', { class: 'btn btn-sm', for: 'media-file' }, icon('arrow-repeat'), t('media.chooseOther'))),
      h('p', { class: 'small muted', text: t('media.previewHelp') }), frames, anchorCtl, ...warnings);
  }

  const dlg = openDialog({
    title: current ? t('media.dialogChange') : (slot.multiple ? t('media.dialogAdd') : t('media.upload')),
    lead: slotTexts(slot, ctx)[0], wide: true,
    body: h('div', { class: 'stack' }, pick, previewArea, alt.es.wrap, alt.en.wrap, progress, msg),
    actions: [
      { label: t('common.cancel'), onClick: (b, close) => close() },
      { label: t('media.save'), variant: 'primary', icon: 'cloud-arrow-up', onClick: async (btn, close) => {
        clear(msg);
        if (!chosen) { showErr(fieldErrorText('file_required')); return; }
        if (!alt.check()) return;
        const fd = new FormData();
        fd.append('file', chosen.file, chosen.file.name);
        fd.append('anchor', anchor);
        fd.append('altEs', alt.es.input.value);
        fd.append('altEn', alt.en.input.value);
        setBusy(btn, true, t('common.saving'));
        progress.hidden = false;
        const bar = progress.querySelector('.progress span');
        const label = progress.lastChild;
        const setP = (p) => { bar.style.width = p + '%'; label.textContent = p < 100 ? t('media.uploading', { p }) : t('media.processing'); };
        setP(0);
        try {
          await upload(`/media/${slot.id}/upload`, fd, setP);
          toast(t('media.uploaded'));
          close();
          reload();
        } catch (err) {
          setBusy(btn, false);
          progress.hidden = true;
          if (err.code === 'validation') {
            const f = err.fields || {};
            if (f.file) { pick.hidden = false; showErr(fieldErrorText(f.file, { max: fmtBytes(ctx.maxImage), formats: 'JPG, PNG, WebP', w: slot.min[0], h: slot.min[1] })); }
            if (f.altEs) alt.es.setError(fieldErrorText(f.altEs, { max: 150 }));
            if (f.altEn) alt.en.setError(fieldErrorText(f.altEn, { max: 150 }));
          }
          msg.append(alertBox('bad', null, err.code === 'validation' ? t('errors.validation') : errorText(err, { preserved: true })));
        }
      } },
    ],
    onClose: () => { if (chosen && chosen.url) URL.revokeObjectURL(chosen.url); },
  });
  return dlg;
}

function pdfDialog(ctx, reload) {
  let chosen = null;
  const input = h('input', { type: 'file', accept: 'application/pdf,.pdf', class: 'sr-only', id: 'pdf-file' });
  const err = h('div', { class: 'field-error', hidden: true, role: 'alert' });
  const info = h('p', { class: 'small', hidden: true });
  const dropzone = h('label', { class: 'dropzone', for: 'pdf-file' }, icon('file-earmark-pdf'), h('strong', { text: t('media.dropPdf') }),
    h('span', { class: 'small', text: t('media.or') }), h('span', { class: 'btn btn-sm', text: t('media.choose') }));
  const msg = h('div');
  const progress = h('div', { class: 'stack-sm', hidden: true }, h('div', { class: 'progress', 'aria-hidden': 'true' }, h('span')), h('span', { class: 'small muted', role: 'status' }));
  const handle = (file) => {
    err.hidden = true;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { err.textContent = t('media.notPdf'); err.hidden = false; return; }
    if (file.size > ctx.maxPdf) { err.textContent = t('media.tooBig', { size: fmtBytes(file.size), max: fmtBytes(ctx.maxPdf) }); err.hidden = false; return; }
    chosen = file;
    info.textContent = `${file.name} · ${fmtBytes(file.size)}`;
    info.hidden = false;
  };
  input.addEventListener('change', () => input.files[0] && handle(input.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('over'); }));
  dropzone.addEventListener('drop', (e) => e.dataTransfer.files[0] && handle(e.dataTransfer.files[0]));
  openDialog({
    title: t('media.dialogPdf'),
    body: h('div', { class: 'stack' }, input, dropzone, info, h('p', { class: 'small muted', text: t('media.reqPdf', { max: fmtBytes(ctx.maxPdf) }) }), err, progress, msg),
    actions: [
      { label: t('common.cancel'), onClick: (b, close) => close() },
      { label: t('media.save'), variant: 'primary', icon: 'cloud-arrow-up', onClick: async (btn, close) => {
        clear(msg);
        if (!chosen) { err.textContent = fieldErrorText('file_required'); err.hidden = false; return; }
        const fd = new FormData();
        fd.append('file', chosen, chosen.name);
        setBusy(btn, true, t('common.saving'));
        progress.hidden = false;
        const bar = progress.querySelector('.progress span');
        try {
          await upload('/media/portfolio.pdf/upload', fd, (p) => { bar.style.width = p + '%'; progress.lastChild.textContent = p < 100 ? t('media.uploading', { p }) : t('media.processing'); });
          toast(t('media.pdfUploaded'));
          close();
          reload();
        } catch (e) {
          setBusy(btn, false);
          progress.hidden = true;
          if (e.code === 'validation' && e.fields.file) { err.textContent = fieldErrorText(e.fields.file, { max: fmtBytes(ctx.maxPdf), formats: 'PDF' }); err.hidden = false; }
          else msg.append(alertBox('bad', null, errorText(e, { preserved: true })));
        }
      } },
    ],
  });
}
