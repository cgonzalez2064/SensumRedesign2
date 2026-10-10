/**
 * Formulario de contacto — the "Servicio de interés" options visitors choose
 * from: add, rename (Spanish and English), reorder and remove, with a live
 * preview. Saving publishes the site. Same access as the business details.
 */
import { h, icon, fill } from '../dom.js';
import { t, tp } from '../i18n.js';
import { api } from '../api.js';
import { pageHead, loading, loadError, button, setBusy, toast, errorText, fieldErrorText, textField, segmented, cardHead, alertBox } from '../ui.js';
import { autoTranslatePair } from '../autotranslate.js';

let uid = 0;
const key = () => 'n' + (++uid);

export async function render({ main, session }) {
  const translate = !!(session.app && session.app.translation);
  main.append(pageHead({ title: t('form.title'), lead: t('form.lead') }));
  const body = h('div', { class: 'stack-lg' }, loading());
  main.append(body);
  let alive = true;
  let dirty = () => false;

  const load = async () => {
    let data;
    try { data = await api.get('/contact-form/services'); } catch (err) { fill(body, loadError(err, load)); return; }
    if (alive) draw(data);
  };

  const draw = (data) => {
    // Working copy: each row keeps the saved id (new rows have none yet).
    let rows = data.items.map((it) => ({ key: key(), id: it.id, es: it.es, en: it.en, saved: { es: it.es, en: it.en }, tr: {} }));
    let pairs = [];
    const initial = JSON.stringify(rows.map(({ id, es, en }) => ({ id, es, en })));
    const current = () => rows.map(({ id, es, en }) => ({ id, es: es.trim(), en: en.trim() }));
    dirty = () => JSON.stringify(rows.map(({ id, es, en }) => ({ id, es, en }))) !== initial;
    let previewLang = 'es';
    let errors = {};

    const list = h('ol', { class: 'svc-list' });
    const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    const countBadge = h('span', { class: 'badge' });
    const addBtn = button(t('form.add'), { icon: 'plus-lg' });
    const resetBtn = button(t('form.reset'), { variant: 'link', small: true });
    // ---- Preview: a working copy of the site's contact form (nothing is sent) ----
    let device = 'phone';
    let open = false;
    let chosen = '';
    const sim = (k) => t('form.sim.' + k + (previewLang === 'en' ? 'En' : 'Es'));
    // Each control is labelled by the visible label (it follows the preview language).
    const simField = (control, cls) => h('div', { class: ['sim-field', cls] }, h('label', { for: control.id, id: control.id + '-label' }), control, h('small', { class: 'sim-err', id: control.id + '-err', hidden: true }));
    const simName = h('input', { type: 'text', id: 'sim-name', autocomplete: 'off', 'aria-describedby': 'sim-name-err' });
    const simPhone = h('input', { type: 'tel', id: 'sim-phone', autocomplete: 'off', 'aria-describedby': 'sim-phone-err' });
    const simEmail = h('input', { type: 'email', id: 'sim-email', autocomplete: 'off', 'aria-describedby': 'sim-email-err' });
    const simMsg = h('textarea', { rows: 3, id: 'sim-message', 'aria-describedby': 'sim-message-err' });
    // The select as the site shows it: closed (with the choice) or open (the list).
    const simSelect = h('button', { type: 'button', id: 'sim-service', class: 'sim-select', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': 'sim-list', 'aria-describedby': 'sim-service-err' }, h('span', { class: 'sim-select-text' }), icon('chevron-down'));
    const simList = h('ul', { class: 'sim-list', id: 'sim-list', role: 'listbox', 'aria-labelledby': 'sim-service-label', hidden: true });
    simSelect.addEventListener('click', () => { open = !open; renderPreview(); });
    const simStatus = h('p', { class: 'sim-status', role: 'status' });
    const simSubmit = h('button', { type: 'button', class: 'sim-submit' });
    simSubmit.addEventListener('click', () => {
      // Same checks the site does, so you can see the error states.
      const checks = [[simName, simName.value.trim().length >= 2], [simPhone, /^[0-9+\-\s()]{8,30}$/.test(simPhone.value.trim())], [simEmail, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(simEmail.value.trim())], [simSelect, !!chosen], [simMsg, simMsg.value.trim().length >= 10]];
      for (const [el, ok] of checks) { el.closest('.sim-field').classList.toggle('invalid', !ok); el.closest('.sim-field').querySelector('.sim-err').hidden = ok; el.setAttribute('aria-invalid', String(!ok)); }
      simStatus.textContent = checks.every(([, ok]) => ok) ? sim('sent') : sim('fix');
      simStatus.className = 'sim-status ' + (checks.every(([, ok]) => ok) ? 'ok' : 'bad');
    });
    const svcField = simField(simSelect, 'sim-service');
    simSelect.after(simList);
    const simForm = h('div', { class: 'form-sim', lang: 'es' },
      h('h3', { class: 'sim-title' }),
      h('div', { class: 'sim-row' }, simField(simName), simField(simPhone)),
      simField(simEmail),
      svcField,
      simField(simMsg),
      simSubmit, simStatus,
      h('p', { class: 'sim-note' }));
    const frame = h('div', { class: 'sim-frame' }, simForm);
    const stage = h('div', { class: 'sim-stage' }, frame);
    // Scale the device width to the space available (the layout inside stays the device's).
    const fit = () => {
      // The form card's real width on the site: phone ≈ 360 px, tablet (one column) ≈ 720 px, computer (half of the contact section) ≈ 540 px.
      const w = { phone: 360, tablet: 720, desktop: 540 }[device];
      frame.dataset.device = device;
      frame.style.width = w + 'px';
      const scale = Math.min(1, stage.clientWidth / w);
      frame.style.transform = scale < 1 ? `scale(${scale})` : '';
      stage.style.height = Math.ceil(frame.offsetHeight * scale) + 'px';
    };
    new ResizeObserver(() => requestAnimationFrame(fit)).observe(stage);
    const previewBox = h('div', { class: 'svc-preview' }, stage);

    const renderPreview = () => {
      const opts = rows.filter((r) => r.es.trim());
      simForm.lang = previewLang === 'en' ? 'en' : 'es';
      simForm.querySelector('.sim-title').textContent = sim('title');
      const labels = simForm.querySelectorAll('.sim-field > label');
      [sim('name'), sim('phone'), sim('email'), sim('service'), sim('message')].forEach((txt, i) => { labels[i].textContent = txt; });
      const errs = simForm.querySelectorAll('.sim-err');
      [sim('nameErr'), sim('phoneErr'), sim('emailErr'), sim('serviceErr'), sim('messageErr')].forEach((txt, i) => { errs[i].textContent = txt; });
      simSubmit.textContent = sim('submit');
      simForm.querySelector('.sim-note').textContent = sim('note');
      const label = (r) => (previewLang === 'en' ? (r.en.trim() || r.es.trim()) : r.es.trim());
      if (chosen && !opts.some((r) => r.key === chosen)) chosen = '';
      const current = opts.find((r) => r.key === chosen);
      simSelect.querySelector('.sim-select-text').textContent = current ? label(current) : t(previewLang === 'en' ? 'form.placeholderEn' : 'form.placeholderEs');
      simSelect.classList.toggle('placeholder', !current);
      simSelect.setAttribute('aria-expanded', String(open));
      simSelect.classList.toggle('open', open);
      simList.hidden = !open;
      const changed = (r) => (!r.id ? 'new' : r.saved && (r.saved.es !== r.es || r.saved.en !== r.en) ? 'edited' : null);
      fill(simList, h('li', { class: 'sim-option placeholder', role: 'option', 'aria-disabled': 'true', 'aria-selected': String(!current), text: t(previewLang === 'en' ? 'form.placeholderEn' : 'form.placeholderEs') }),
        opts.map((r) => {
          const c = changed(r);
          const li = h('li', { class: ['sim-option', r.key === chosen && 'chosen', previewLang === 'en' && !r.en.trim() && 'fallback'], role: 'option', 'aria-selected': String(r.key === chosen), tabindex: '0' },
            h('span', { text: label(r) }), c ? h('span', { class: ['sim-tag', c], text: t('form.sim.' + c) }) : null);
          const pick = () => { chosen = r.key; open = false; simSelect.closest('.sim-field').classList.remove('invalid'); simSelect.closest('.sim-field').querySelector('.sim-err').hidden = true; simSelect.removeAttribute('aria-invalid'); renderPreview(); simSelect.focus(); };
          li.addEventListener('click', pick);
          li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
          return li;
        }));
      if (!opts.length) simList.append(h('li', { class: 'sim-option muted', role: 'option', 'aria-disabled': 'true', 'aria-selected': 'false', text: t('form.previewEmpty') }));
      openToggle.lastChild.textContent = t(open ? 'form.sim.closeList' : 'form.sim.openList');
      fit();
    };

    const renderList = (focus) => {
      pairs = [];
      fill(list, rows.map((r, i) => {
        const es = textField({ label: t('form.es'), langTag: 'ES', value: r.es, maxlength: data.maxLabel, spellcheck: true, lang: 'es' });
        const en = textField({ label: t('form.en'), langTag: 'EN', value: r.en, maxlength: data.maxLabel, optionalTag: true, placeholder: r.es || '', lang: 'en' });
        const title = h('strong', { class: ['grow', 'svc-title', !r.es.trim() && 'empty'], text: r.es.trim() || t('form.option', { n: i + 1 }) });
        es.input.addEventListener('input', () => {
          r.es = es.input.value;
          en.input.placeholder = r.es;
          title.textContent = r.es.trim() || t('form.option', { n: i + 1 });
          title.classList.toggle('empty', !r.es.trim());
          labelButtons();
          changed();
        });
        en.input.addEventListener('input', () => { r.en = en.input.value; changed(); });
        if (translate) pairs.push(autoTranslatePair({ es, en, saved: r.saved || { es: '', en: '' }, memory: r.tr || (r.tr = {}) }));
        if (errors[`items.${i}.es`]) es.setError(fieldErrorText(errors[`items.${i}.es`], { max: data.maxLabel }));
        if (errors[`items.${i}.en`]) en.setError(fieldErrorText(errors[`items.${i}.en`], { max: data.maxLabel }));
        const name = r.es.trim() || t('form.unnamed');
        const up = button('', { icon: 'arrow-up', small: true, variant: 'ghost', attrs: { 'aria-label': t('form.moveUp', { name }), disabled: i === 0 || null, 'data-act': 'up' } });
        const down = button('', { icon: 'arrow-down', small: true, variant: 'ghost', attrs: { 'aria-label': t('form.moveDown', { name }), disabled: i === rows.length - 1 || null, 'data-act': 'down' } });
        const del = button('', { icon: 'trash3', small: true, variant: 'ghost', attrs: { 'aria-label': t('form.remove', { name }), disabled: rows.length === 1 || null, 'data-act': 'del' } });
        for (const b of [up, down, del]) b.classList.add('btn-icon');
        // Buttons are named after the option, kept current while it is typed.
        const labelButtons = () => {
          const n = r.es.trim() || t('form.unnamed');
          up.setAttribute('aria-label', t('form.moveUp', { name: n }));
          down.setAttribute('aria-label', t('form.moveDown', { name: n }));
          del.setAttribute('aria-label', t('form.remove', { name: n }));
        };
        up.addEventListener('click', () => move(i, -1));
        down.addEventListener('click', () => move(i, 1));
        del.addEventListener('click', () => remove(i));
        const li = h('li', { class: ['svc-row', r.isNew && 'is-new'], 'data-key': r.key },
          h('div', { class: 'svc-row-head' },
            h('span', { class: 'svc-num', 'aria-hidden': 'true', text: String(i + 1) }),
            title,
            h('div', { class: 'svc-actions' }, up, down, del)),
          h('div', { class: 'svc-fields' }, es.wrap, en.wrap));
        r.isNew = false;
        return li;
      }));
      countBadge.textContent = t('form.count', { n: rows.length, max: data.maxItems });
      addBtn.disabled = rows.length >= data.maxItems;
      if (focus) {
        const el = list.querySelector(`[data-key="${focus.key}"] ${focus.sel}`) || list.querySelector(`[data-key="${focus.key}"] input`);
        if (el) { el.focus(); if (focus.scroll) el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
      }
      renderPreview();
    };

    const move = (i, d) => {
      const j = i + d;
      if (j < 0 || j >= rows.length) return;
      [rows[i], rows[j]] = [rows[j], rows[i]];
      errors = {};
      const r = rows[j];
      renderList({ key: r.key, sel: `[data-act="${d < 0 ? 'up' : 'down'}"]:not([disabled])` });
      live.textContent = t('form.moved', { name: r.es.trim() || t('form.unnamed'), n: j + 1 });
      changed();
    };

    const remove = (i) => {
      const [gone] = rows.splice(i, 1);
      errors = {};
      const next = rows[Math.min(i, rows.length - 1)];
      renderList(next ? { key: next.key, sel: '[data-act="del"]' } : null);
      changed();
      toast(t('form.removed', { name: gone.es.trim() || t('form.unnamed') }), {
        type: 'info',
        action: { label: t('form.undo'), onClick: () => { rows.splice(Math.min(i, rows.length), 0, gone); renderList({ key: gone.key, sel: 'input' }); changed(); } },
      });
    };

    addBtn.addEventListener('click', () => {
      if (rows.length >= data.maxItems) return;
      // New options go before a final "Otro"/"Other", which is best kept last.
      const r = { key: key(), id: null, es: '', en: '', isNew: true };
      const last = rows[rows.length - 1];
      const otherLast = last && (last.id === 'other' || /^otr[oa]s?$/i.test(last.es.trim()));
      rows.splice(otherLast ? rows.length - 1 : rows.length, 0, r);
      renderList({ key: r.key, sel: 'input', scroll: true });
      changed();
    });

    resetBtn.addEventListener('click', () => {
      rows = data.defaults.map((it) => ({ key: key(), id: it.id, es: it.es, en: it.en }));
      errors = {};
      renderList();
      changed();
      toast(t('form.resetDone'), { type: 'info' });
    });

    // ---- save bar
    const saveBtn = button(t('form.save'), { icon: 'check-lg', variant: 'primary' });
    const discardBtn = button(t('email.discard'), { small: true, variant: 'ghost', attrs: { hidden: true } });
    const stateText = h('span', { text: t('email.clean') });
    const saveRow = h('div', { class: 'save-row' },
      h('div', { class: 'save-state', 'aria-live': 'polite' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), stateText),
      h('div', { class: 'row' }, discardBtn, saveBtn));
    function changed() {
      const d = dirty();
      saveRow.classList.toggle('dirty', d);
      discardBtn.hidden = !d;
      stateText.textContent = t(d ? 'email.dirty' : 'email.clean');
      renderPreview();
    }
    discardBtn.addEventListener('click', () => draw(data));

    const check = () => {
      const e = {};
      const seen = new Set();
      current().forEach((r, i) => {
        if (!r.es) e[`items.${i}.es`] = 'required';
        else if ([...r.es].length < 2) e[`items.${i}.es`] = 'too_short';
        else if (/[<>]/.test(r.es)) e[`items.${i}.es`] = 'no_html';
        else if (seen.has(r.es.toLowerCase())) e[`items.${i}.es`] = 'duplicate';
        if (/[<>]/.test(r.en)) e[`items.${i}.en`] = 'no_html';
        seen.add(r.es.toLowerCase());
      });
      return e;
    };
    const showErrors = (e) => {
      errors = e;
      const first = Object.keys(e)[0];
      if (!first) return false;
      const [, idx, lang] = first.split('.');
      renderList({ key: rows[Number(idx)].key, sel: `input[lang="${lang}"]`, scroll: true });
      toast(t('email.fixErrors'), { type: 'bad' });
      return true;
    };

    saveBtn.addEventListener('click', async () => {
      if (pairs.length) {
        // Save what the person is about to see: finish translations still in progress first.
        setBusy(saveBtn, true, t('content.autoTr.finishing'));
        await Promise.allSettled(pairs.map((p) => p.settle()));
        setBusy(saveBtn, false);
      }
      if (showErrors(check())) return;
      setBusy(saveBtn, true, t('email.saving'));
      try {
        const r = await api.put('/contact-form/services', { items: current(), version: data.version });
        toast(r.changed ? t('form.saved') : t('email.savedNoChange'));
        draw({ ...data, items: r.items, version: r.version, isDefault: r.isDefault });
        return;
      } catch (err) {
        if (err.code === 'validation') showErrors(err.fields);
        else if (err.code === 'conflict') toast(t('form.conflict'), { type: 'bad', action: { label: t('common.reload'), onClick: () => load() } });
        else toast(errorText(err, { preserved: true }), { type: 'bad' });
      }
      setBusy(saveBtn, false);
    });

    const langSwitch = segmented([{ value: 'es', label: 'Español' }, { value: 'en', label: 'English' }], 'es', (v) => { previewLang = v; renderPreview(); }, t('form.previewLang'));
    const deviceSwitch = segmented([{ value: 'phone', label: t('form.sim.phone'), icon: 'phone' }, { value: 'tablet', label: t('form.sim.tablet'), icon: 'laptop' }, { value: 'desktop', label: t('form.sim.desktop'), icon: 'globe2' }],
      device, (v) => { device = v; fit(); }, t('form.sim.device'));
    const openToggle = button(t('form.sim.openList'), { small: true, variant: 'ghost', icon: 'chevron-down', onClick: () => { open = !open; renderPreview(); } });

    const editor = h('section', { class: 'card', 'aria-labelledby': 'svc-title' },
      cardHead({ id: 'svc-title', icon: 'card-text', title: t('form.servicesTitle'), lead: t('form.servicesLead'), badge: countBadge }),
      translate ? alertBox('info', null, t('content.autoTr.intro')) : null,
      list, live,
      h('div', { class: 'card-foot' }, resetBtn, addBtn));
    const preview = h('section', { class: 'card svc-preview-card', 'aria-labelledby': 'svc-prev' },
      cardHead({ id: 'svc-prev', icon: 'eye', title: t('form.previewTitle'), lead: t('form.previewLead') }),
      h('div', { class: 'sim-controls' }, langSwitch, deviceSwitch, openToggle),
      previewBox,
      h('p', { class: 'tiny muted', text: t('form.sim.legend') }),
      h('ul', { class: 'tips' }, ['tip1', 'tip2', 'tip3'].map((k) => h('li', null, icon('info-circle-fill'), h('span', { text: t('form.' + k) })))));

    fill(body, h('div', { class: 'dash-grid' }, h('div', { class: 'stack-lg' }, editor), h('div', { class: 'stack-lg svc-side' }, preview)), saveRow);
    renderList();
    changed();
  };

  await load();
  return { destroy: () => { alive = false; }, isDirty: () => dirty() };
}
