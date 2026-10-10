/**
 * Formulario de contacto — the "Servicio de interés" options visitors choose
 * from: add, rename (Spanish and English), reorder and remove, with a live
 * preview. Saving publishes the site. Same access as the business details.
 */
import { h, icon, fill } from '../dom.js';
import { t, tp } from '../i18n.js';
import { api } from '../api.js';
import { pageHead, loading, loadError, button, setBusy, toast, errorText, fieldErrorText, textField, segmented, cardHead } from '../ui.js';

let uid = 0;
const key = () => 'n' + (++uid);

export async function render({ main }) {
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
    let rows = data.items.map((it) => ({ key: key(), id: it.id, es: it.es, en: it.en }));
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
    const previewList = h('ul', { class: 'svc-preview-list', role: 'presentation' });
    const previewBox = h('div', { class: 'svc-preview' },
      h('div', { class: 'svc-preview-label', text: t('form.previewLabel') }),
      h('div', { class: 'svc-preview-select', 'aria-hidden': 'true' }, h('span', { class: 'svc-preview-placeholder' }), icon('chevron-down')),
      previewList);

    const renderPreview = () => {
      previewBox.querySelector('.svc-preview-placeholder').textContent = t(previewLang === 'en' ? 'form.placeholderEn' : 'form.placeholderEs');
      fill(previewList, rows.filter((r) => r.es.trim()).map((r) => {
        const text = previewLang === 'en' ? (r.en.trim() || r.es.trim()) : r.es.trim();
        return h('li', { class: ['svc-preview-item', previewLang === 'en' && !r.en.trim() && 'fallback'], text });
      }));
      if (!previewList.childElementCount) previewList.append(h('li', { class: 'svc-preview-item muted', text: t('form.previewEmpty') }));
    };

    const renderList = (focus) => {
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

    const editor = h('section', { class: 'card', 'aria-labelledby': 'svc-title' },
      cardHead({ id: 'svc-title', icon: 'card-text', title: t('form.servicesTitle'), lead: t('form.servicesLead'), badge: countBadge }),
      list, live,
      h('div', { class: 'card-foot' }, resetBtn, addBtn));
    const preview = h('section', { class: 'card svc-preview-card', 'aria-labelledby': 'svc-prev' },
      cardHead({ id: 'svc-prev', icon: 'eye', title: t('form.previewTitle'), lead: t('form.previewLead') }),
      h('div', { class: 'row' }, langSwitch),
      previewBox,
      h('ul', { class: 'tips' }, ['tip1', 'tip2', 'tip3'].map((k) => h('li', null, icon('info-circle-fill'), h('span', { text: t('form.' + k) })))));

    fill(body, h('div', { class: 'dash-grid' }, h('div', { class: 'stack-lg' }, editor), h('div', { class: 'stack-lg' }, preview)), saveRow);
    renderList();
    changed();
  };

  await load();
  return { destroy: () => { alive = false; }, isDirty: () => dirty() };
}
