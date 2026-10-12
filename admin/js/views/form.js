/**
 * Formulario de contacto — the questions of the site's contact form: which
 * fields visitors see, their order, which are required, the options of lists,
 * and (cuenta propietaria) who receives the messages. Live preview; saving
 * publishes the site. Same access as the business details ("contact").
 *
 * Name is always asked; e-mail and phone can be removed one at a time, but at
 * least one stays and is required, so every message can be answered.
 */
import { h, icon, fill } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { pageHead, loading, loadError, button, setBusy, toast, errorText, fieldErrorText, textField, segmented, cardHead, alertBox, switchInput, openDialog, askPassword } from '../ui.js';
import { autoTranslatePair } from '../autotranslate.js';

let uid = 0;
const key = () => 'k' + (++uid);

/** Field types, in the order the "Agregar campo" dialog shows them. */
export const TYPES = ['text', 'textarea', 'email', 'tel', 'number', 'date', 'select', 'radio', 'checkbox'];
const WITH_OPTIONS = new Set(['select', 'radio', 'checkbox']);
const TYPE_ICON = { text: 'ff-text', textarea: 'ff-paragraph', email: 'envelope', tel: 'telephone', number: 'ff-number', date: 'ff-date', select: 'ff-select', radio: 'ff-radio', checkbox: 'ff-checkbox' };
const CONTACT = ['email', 'phone'];

const clone = (o) => JSON.parse(JSON.stringify(o));
const optText = (o, lang) => (lang === 'en' ? (o.en.trim() || o.es.trim()) : o.es.trim());

export async function render({ main, session }) {
  const translate = !!(session.app && session.app.translation);
  main.append(pageHead({ title: t('form.title'), lead: t('fb.lead') }));
  const body = h('div', { class: 'stack-lg' }, loading());
  main.append(body);
  let alive = true;
  let dirty = () => false;

  const load = async () => {
    let data;
    try { data = await api.get('/contact-form'); } catch (err) { fill(body, loadError(err, load)); return; }
    if (alive) draw(data);
  };

  const draw = (data) => {
    const L = data.limits;
    const toRow = (f) => ({ ...clone(f), key: key(), help: f.help || { es: '', en: '' }, options: (f.options || []).map((o) => ({ ...o, key: key(), savedPair: { es: o.es, en: o.en }, tr: {} })), saved: clone(f), tr: {} });
    let rows = data.fields.map(toRow);
    let openKey = null;
    let pairs = [];
    let errors = {};
    const plain = (list) => list.map(({ key: _k, saved: _s, tr: _t, isNew: _n, ...f }) => ({ ...f, options: WITH_OPTIONS.has(f.type) ? f.options.map(({ key: _o, savedPair: _p, tr: _r, ...o }) => o) : undefined }));
    const initial = JSON.stringify(plain(rows));
    dirty = () => JSON.stringify(plain(rows)) !== initial;

    // ---- the rules that keep every message answerable
    const has = (core) => rows.find((r) => r.core === core);
    const isLocked = (r) => r.core === 'name' || (CONTACT.includes(r.core) && !CONTACT.some((c) => c !== r.core && has(c)));
    const otherContact = (r) => has(CONTACT.find((c) => c !== r.core));
    const canBeOptional = (r) => r.core !== 'name' && !(CONTACT.includes(r.core) && !(otherContact(r) && otherContact(r).required));
    const label = (r) => r.label.es.trim() || t('fb.untitled');

    // ---------------------------------------------------------------- the list
    const list = h('ol', { class: 'fb-list' });
    const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    const countBadge = h('span', { class: 'badge' });
    const addBtn = button(t('fb.add'), { icon: 'plus-lg', variant: 'primary' });
    const resetBtn = button(t('fb.reset'), { variant: 'link', small: true });

    const meta = (r) => {
      const bits = [t('fb.type.' + r.type)];
      if (WITH_OPTIONS.has(r.type)) bits.push(t('fb.nOptions', { n: r.options.length }));
      if (r.width === 'half') bits.push(t('fb.halfShort'));
      return bits.join(' · ');
    };

    const renderRow = (r, i) => {
      const isOpen = openKey === r.key;
      const editorId = 'fb-ed-' + r.key;
      const name = label(r);
      const up = button('', { icon: 'arrow-up', small: true, variant: 'ghost', attrs: { 'aria-label': t('fb.moveUp', { name }), disabled: i === 0 || null, 'data-act': 'up' } });
      const down = button('', { icon: 'arrow-down', small: true, variant: 'ghost', attrs: { 'aria-label': t('fb.moveDown', { name }), disabled: i === rows.length - 1 || null, 'data-act': 'down' } });
      const edit = button('', { icon: 'pencil', small: true, variant: 'ghost', attrs: { 'aria-label': t('fb.edit', { name }), 'aria-expanded': String(isOpen), 'aria-controls': editorId, 'data-act': 'edit' } });
      const locked = isLocked(r);
      const del = button('', { icon: 'trash3', small: true, variant: 'ghost', attrs: { 'aria-label': locked ? t('fb.cannotRemove', { name }) : t('fb.remove', { name }), disabled: locked || null, 'data-act': 'del', title: locked ? t(r.core === 'name' ? 'fb.lockName' : 'fb.lockContact') : null } });
      for (const b of [up, down, edit, del]) b.classList.add('btn-icon');
      up.addEventListener('click', () => move(i, -1));
      down.addEventListener('click', () => move(i, 1));
      edit.addEventListener('click', () => { openKey = isOpen ? null : r.key; renderList({ key: r.key, sel: isOpen ? '[data-act="edit"]' : 'input' }); });
      del.addEventListener('click', () => remove(i));
      const grip = h('span', { class: 'fb-grip', 'aria-hidden': 'true', title: t('fb.drag') }, icon('grip-vertical'));
      grip.addEventListener('pointerdown', (e) => startDrag(e, r.key));
      const chips = h('span', { class: 'fb-chips' },
        h('span', { class: ['fb-chip', r.required ? 'req' : 'opt'], text: t(r.required ? 'fb.required' : 'fb.optional') }),
        locked ? h('span', { class: 'fb-chip fixed' }, icon('lock'), h('span', { text: t('fb.fixed') })) : null);
      const li = h('li', { class: ['fb-row', isOpen && 'open', r.isNew && 'is-new'], 'data-key': r.key },
        h('div', { class: 'fb-row-head' },
          grip,
          h('span', { class: 'fb-type', 'aria-hidden': 'true' }, icon(TYPE_ICON[r.type])),
          h('div', { class: 'fb-summary' },
            h('strong', { class: ['fb-label', !r.label.es.trim() && 'empty'], text: name }),
            h('span', { class: 'fb-meta' }, h('span', { text: meta(r) }), chips)),
          h('div', { class: 'fb-actions' }, up, down, edit, del)),
        isOpen ? editor(r, editorId) : null);
      r.isNew = false;
      return li;
    };

    // ---------------------------------------------------------------- one field's settings
    const editor = (r, id) => {
      const lab = (k) => t('fb.' + k);
      const es = textField({ label: lab('question'), langTag: 'ES', value: r.label.es, maxlength: L.maxLabel, lang: 'es', spellcheck: true });
      const en = textField({ label: lab('question'), langTag: 'EN', value: r.label.en, maxlength: L.maxLabel, optionalTag: true, placeholder: r.label.es, lang: 'en' });
      const hes = textField({ label: lab('help'), langTag: 'ES', value: r.help.es, maxlength: L.maxHelp, optionalTag: true, lang: 'es', hint: lab('helpHint') });
      const hen = textField({ label: lab('help'), langTag: 'EN', value: r.help.en, maxlength: L.maxHelp, optionalTag: true, placeholder: r.help.es, lang: 'en' });
      const sync = () => {
        const li = list.querySelector(`[data-key="${r.key}"]`);
        const title = li && li.querySelector('.fb-label');
        if (title) { title.textContent = label(r); title.classList.toggle('empty', !r.label.es.trim()); }
        changed();
      };
      es.input.addEventListener('input', () => { r.label.es = es.input.value; en.input.placeholder = r.label.es; sync(); });
      en.input.addEventListener('input', () => { r.label.en = en.input.value; sync(); });
      hes.input.addEventListener('input', () => { r.help.es = hes.input.value; hen.input.placeholder = r.help.es; sync(); });
      hen.input.addEventListener('input', () => { r.help.en = hen.input.value; sync(); });
      if (translate) {
        r.tr.label = r.tr.label || {}; r.tr.help = r.tr.help || {};
        pairs.push(autoTranslatePair({ es, en, saved: r.saved.label || { es: '', en: '' }, memory: r.tr.label }));
        pairs.push(autoTranslatePair({ es: hes, en: hen, saved: r.saved.help || { es: '', en: '' }, memory: r.tr.help }));
      }
      const err = (k, f) => { if (errors[`${r.key}.${k}`]) f.setError(fieldErrorText(errors[`${r.key}.${k}`], { max: L.maxLabel })); };
      err('label.es', es); err('label.en', en); err('help.es', hes); err('help.en', hen);

      // Required (switch) and width (segmented)
      const reqHintId = id + '-req-hint';
      const fixedReq = !canBeOptional(r);
      const req = switchInput({ id: id + '-req', checked: r.required, describedBy: reqHintId, onChange: (on, input) => {
        if (!on && !canBeOptional(r)) { input.checked = true; return; }
        r.required = on;
        renderList({ key: r.key, sel: `#${id}-req` });
        changed();
      } });
      if (fixedReq) req.input.disabled = true;
      const reqBox = h('div', { class: 'fb-setting' },
        h('label', { class: 'fb-switch', for: id + '-req' }, req.wrap, h('span', { text: lab('requiredLabel') })),
        h('p', { class: 'hint', id: reqHintId, text: fixedReq ? t(r.core === 'name' ? 'fb.lockName' : 'fb.lockContactReq') : lab('requiredHint') }));
      const width = h('div', { class: 'fb-setting' },
        h('span', { class: 'label', id: id + '-w', text: lab('width') }),
        segmented([{ value: 'half', label: lab('half') }, { value: 'full', label: lab('full') }], r.width, (v) => { r.width = v; sync(); renderList({ key: r.key, sel: `[aria-labelledby="${id}-w"] [aria-pressed="true"]` }); }, lab('width')));
      width.querySelector('.segmented').setAttribute('aria-labelledby', id + '-w');

      // Type-specific settings
      let specific = null;
      if (WITH_OPTIONS.has(r.type)) specific = optionsEditor(r, id);
      else if (r.type === 'number') {
        const mn = textField({ label: lab('min'), type: 'number', value: r.min ?? '', optionalTag: true, inputmode: 'numeric' });
        const mx = textField({ label: lab('max'), type: 'number', value: r.max ?? '', optionalTag: true, inputmode: 'numeric' });
        mn.input.addEventListener('input', () => { r.min = mn.input.value === '' ? null : Number(mn.input.value); changed(); });
        mx.input.addEventListener('input', () => { r.max = mx.input.value === '' ? null : Number(mx.input.value); changed(); });
        specific = h('div', { class: 'fb-pair' }, mn.wrap, mx.wrap);
      } else if (r.type === 'date') {
        const fut = switchInput({ id: id + '-future', checked: r.future, onChange: (on) => { r.future = on; changed(); } });
        specific = h('div', { class: 'fb-setting' }, h('label', { class: 'fb-switch', for: id + '-future' }, fut.wrap, h('span', { text: lab('future') })));
      } else if (r.type === 'text' || r.type === 'textarea') {
        const mx = textField({ label: lab('maxChars'), type: 'number', value: r.max ?? '', inputmode: 'numeric', hint: t('fb.maxCharsHint', { max: r.type === 'text' ? 200 : 4000 }) });
        mx.input.addEventListener('input', () => { r.max = mx.input.value === '' ? null : Number(mx.input.value); changed(); });
        specific = h('div', { class: 'fb-pair' }, mx.wrap);
      }

      const done = button(lab('done'), { small: true, icon: 'check-lg' });
      done.addEventListener('click', () => { openKey = null; renderList({ key: r.key, sel: '[data-act="edit"]' }); });
      return h('div', { class: 'fb-editor', id },
        translate ? alertBox('info', null, t('content.autoTr.intro')) : null,
        h('div', { class: 'fb-pair' }, es.wrap, en.wrap),
        h('div', { class: 'fb-pair' }, hes.wrap, hen.wrap),
        h('div', { class: 'fb-settings' }, reqBox, width),
        specific,
        h('div', { class: 'fb-editor-foot' }, done));
    };

    const optionsEditor = (r, id) => {
      const ol = h('ol', { class: 'fb-opts', 'aria-label': t('fb.optionsOf', { name: label(r) }) });
      const draw = (focus) => {
        fill(ol, r.options.map((o, i) => {
          const es = h('input', { class: 'input', value: o.es, lang: 'es', maxlength: L.maxOption, 'aria-label': t('fb.optionEs', { n: i + 1 }) });
          const en = h('input', { class: 'input', value: o.en, lang: 'en', maxlength: L.maxOption, placeholder: o.es, 'aria-label': t('fb.optionEn', { n: i + 1 }) });
          es.addEventListener('input', () => { o.es = es.value; en.placeholder = o.es; changed(); });
          en.addEventListener('input', () => { o.en = en.value; changed(); });
          const esWrap = h('span', { class: 'fb-opt-in' }, es);
          const enWrap = h('span', { class: 'fb-opt-in' }, en);
          if (translate) pairs.push(autoTranslatePair({ es: { input: es, wrap: esWrap }, en: { input: en, wrap: enWrap }, saved: o.savedPair || { es: '', en: '' }, memory: o.tr || (o.tr = {}) }));
          const name = o.es.trim() || t('fb.optionN', { n: i + 1 });
          const up = button('', { icon: 'arrow-up', small: true, variant: 'ghost', attrs: { 'aria-label': t('fb.moveUp', { name }), disabled: i === 0 || null, 'data-o': 'up' } });
          const del = button('', { icon: 'trash3', small: true, variant: 'ghost', attrs: { 'aria-label': t('fb.remove', { name }), disabled: r.options.length <= 1 || null, 'data-o': 'del' } });
          for (const b of [up, del]) b.classList.add('btn-icon');
          up.addEventListener('click', () => { [r.options[i - 1], r.options[i]] = [r.options[i], r.options[i - 1]]; draw({ i: i - 1, sel: '[data-o="up"]' }); changed(); });
          del.addEventListener('click', () => { r.options.splice(i, 1); draw({ i: Math.max(0, i - 1), sel: 'input' }); changed(); syncMeta(); });
          const err = errors[`${r.key}.options.${i}`];
          return h('li', { class: ['fb-opt', err && 'invalid'], 'data-i': String(i) },
            h('span', { class: 'svc-num', 'aria-hidden': 'true', text: String(i + 1) }),
            h('span', { class: 'fb-opt-inputs' }, esWrap, enWrap),
            h('span', { class: 'fb-opt-actions' }, up, del),
            err ? h('span', { class: 'field-error' }, icon('exclamation-circle'), h('span', { text: fieldErrorText(err, { max: L.maxOption }) })) : null);
        }));
        if (focus) { const el = ol.querySelector(`[data-i="${focus.i}"] ${focus.sel}`) || ol.querySelector(`[data-i="${focus.i}"] input`); if (el) el.focus(); }
        addOpt.disabled = r.options.length >= L.maxOptions;
      };
      const syncMeta = () => { const m = list.querySelector(`[data-key="${r.key}"] .fb-meta > span`); if (m) m.textContent = meta(r); };
      const addOpt = button(t('fb.addOption'), { small: true, icon: 'plus-lg' });
      addOpt.addEventListener('click', () => { r.options.push({ key: key(), id: null, es: '', en: '', tr: {} }); draw({ i: r.options.length - 1, sel: 'input' }); changed(); syncMeta(); });
      draw();
      return h('div', { class: 'fb-setting fb-options' },
        h('span', { class: 'label', text: t('fb.options') }),
        h('p', { class: 'hint', text: t('fb.optionsHint') }),
        ol, h('div', { class: 'row' }, addOpt));
    };

    const renderList = (focus) => {
      pairs = [];
      fill(list, rows.map(renderRow));
      countBadge.textContent = t('fb.count', { n: rows.length, max: L.maxFields });
      addBtn.disabled = rows.length >= L.maxFields;
      if (focus) {
        const el = list.querySelector(`[data-key="${focus.key}"] ${focus.sel}`) || list.querySelector(`[data-key="${focus.key}"] [data-act="edit"]`);
        if (el) { el.focus(); if (focus.scroll) el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
      }
      renderPreview();
    };

    const move = (i, d) => {
      const j = i + d;
      if (j < 0 || j >= rows.length) return;
      [rows[i], rows[j]] = [rows[j], rows[i]];
      renderList({ key: rows[j].key, sel: `[data-act="${d < 0 ? 'up' : 'down'}"]:not([disabled])` });
      live.textContent = t('fb.moved', { name: label(rows[j]), n: j + 1 });
      changed();
    };

    // Drag by the handle (mouse or finger); the arrow buttons do the same from the keyboard.
    const startDrag = (e, k) => {
      e.preventDefault();
      const from = rows.findIndex((r) => r.key === k);
      const li = list.querySelector(`[data-key="${k}"]`);
      li.classList.add('dragging');
      li.setPointerCapture(e.pointerId);
      let idx = from;
      const onMove = (ev) => {
        const items = [...list.children];
        for (let j = 0; j < items.length; j++) {
          if (j === idx) continue;
          const b = items[j].getBoundingClientRect();
          const mid = b.top + b.height / 2;
          if ((j < idx && ev.clientY < mid) || (j > idx && ev.clientY > mid)) {
            const [r] = rows.splice(idx, 1);
            rows.splice(j, 0, r);
            if (j < idx) list.insertBefore(items[idx], items[j]); else list.insertBefore(items[idx], items[j].nextSibling);
            idx = j;
            break;
          }
        }
      };
      const onUp = () => {
        li.removeEventListener('pointermove', onMove);
        li.removeEventListener('pointerup', onUp);
        li.removeEventListener('pointercancel', onUp);
        li.classList.remove('dragging');
        if (idx !== from) { renderList(); live.textContent = t('fb.moved', { name: label(rows[idx]), n: idx + 1 }); changed(); }
      };
      li.addEventListener('pointermove', onMove);
      li.addEventListener('pointerup', onUp);
      li.addEventListener('pointercancel', onUp);
    };

    const remove = (i) => {
      const [gone] = rows.splice(i, 1);
      if (openKey === gone.key) openKey = null;
      const next = rows[Math.min(i, rows.length - 1)];
      renderList(next ? { key: next.key, sel: '[data-act="edit"]' } : null);
      changed();
      toast(t('fb.removed', { name: label(gone) }), { type: 'info', action: { label: t('form.undo'), onClick: () => { rows.splice(Math.min(i, rows.length), 0, gone); renderList({ key: gone.key, sel: '[data-act="edit"]' }); changed(); } } });
    };

    // "Agregar campo": choose the type; the new question opens ready to write.
    addBtn.addEventListener('click', () => {
      if (rows.length >= L.maxFields) return;
      const grid = h('div', { class: 'fb-types', role: 'list' }, TYPES.map((type) => {
        const b = h('button', { type: 'button', class: 'fb-type-card', role: 'listitem', 'data-type': type },
          h('span', { class: 'fb-type', 'aria-hidden': 'true' }, icon(TYPE_ICON[type])),
          h('span', { class: 'fb-type-text' }, h('strong', { text: t('fb.type.' + type) }), h('span', { text: t('fb.typeHint.' + type) })));
        b.addEventListener('click', () => { dlg.close(); addField(type); });
        return b;
      }));
      const dlg = openDialog({ title: t('fb.addTitle'), lead: t('fb.addLead'), body: grid, wide: true, labelledIcon: 'plus-lg' });
    });
    const addField = (type) => {
      const r = { key: key(), id: null, core: null, type, label: { es: '', en: '' }, help: { es: '', en: '' }, required: false, width: 'full', isNew: true, saved: {}, tr: {},
        options: WITH_OPTIONS.has(type) ? [{ key: key(), id: null, es: '', en: '' }, { key: key(), id: null, es: '', en: '' }] : [] };
      if (type === 'date') r.future = true;
      // Before the message box when it is last: it reads better at the end.
      const last = rows[rows.length - 1];
      rows.splice(last && last.core === 'message' ? rows.length - 1 : rows.length, 0, r);
      openKey = r.key;
      renderList({ key: r.key, sel: 'input', scroll: true });
      changed();
    };

    resetBtn.addEventListener('click', () => {
      rows = data.defaults.map(toRow);
      openKey = null;
      errors = {};
      renderList();
      changed();
      toast(t('fb.resetDone'), { type: 'info' });
    });

    // ---------------------------------------------------------------- preview (nothing is sent)
    let previewLang = 'es';
    let device = 'phone';
    let openSelect = null;
    const picked = {};
    const sim = (k) => t('form.sim.' + k + (previewLang === 'en' ? 'En' : 'Es'));
    const simForm = h('div', { class: 'form-sim', lang: 'es' });
    const frame = h('div', { class: 'sim-frame' }, simForm);
    const stage = h('div', { class: 'sim-stage' }, frame);
    const fit = () => {
      const w = { phone: 360, tablet: 720, desktop: 540 }[device];
      frame.dataset.device = device;
      frame.style.width = w + 'px';
      const scale = Math.min(1, stage.clientWidth / w);
      frame.style.transform = scale < 1 ? `scale(${scale})` : '';
      stage.style.height = Math.ceil(frame.offsetHeight * scale) + 'px';
    };
    new ResizeObserver(() => requestAnimationFrame(fit)).observe(stage);
    stage.addEventListener('scroll', () => { stage.scrollTop = 0; stage.scrollLeft = 0; });
    const simValues = {};
    const simInvalid = new Set();
    const pv = (o) => (previewLang === 'en' ? (o.en.trim() || o.es.trim()) : o.es.trim());

    const simControl = (r, cid) => {
      const v = simValues[r.key];
      if (r.type === 'textarea') {
        const ta = h('textarea', { id: cid, rows: 3 });
        ta.value = v || '';
        ta.addEventListener('input', () => { simValues[r.key] = ta.value; });
        return ta;
      }
      if (r.type === 'select') {
        const opts = r.options.filter((o) => o.es.trim());
        const cur = opts.find((o) => o.key === picked[r.key]);
        const isOpen = openSelect === r.key;
        const btn = h('button', { type: 'button', id: cid, class: ['sim-select', !cur && 'placeholder', isOpen && 'open'], 'aria-haspopup': 'listbox', 'aria-expanded': String(isOpen) },
          h('span', { class: 'sim-select-text', text: cur ? pv(cur) : t(previewLang === 'en' ? 'fb.chooseEn' : 'fb.chooseEs') }), icon('chevron-down'));
        btn.addEventListener('click', () => { openSelect = isOpen ? null : r.key; renderPreview(); });
        const ul = h('ul', { class: 'sim-list', role: 'listbox', 'aria-label': pv(r.label) || t('fb.untitled'), hidden: !isOpen }, opts.map((o) => {
          const li = h('li', { class: ['sim-option', o.key === picked[r.key] && 'chosen'], role: 'option', tabindex: '0', 'aria-selected': String(o.key === picked[r.key]), text: pv(o) });
          const pick = () => { picked[r.key] = o.key; openSelect = null; simInvalid.delete(r.key); renderPreview(); };
          li.addEventListener('click', pick);
          li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
          return li;
        }));
        return [btn, ul];
      }
      if (r.type === 'radio' || r.type === 'checkbox') {
        const opts = r.options.filter((o) => o.es.trim());
        return h('div', { class: 'sim-choices', role: r.type === 'radio' ? 'radiogroup' : 'group' }, opts.map((o, i) => {
          const oid = `${cid}-${i}`;
          const input = h('input', { type: r.type, id: oid, name: cid, checked: (r.type === 'radio' ? picked[r.key] === o.key : (picked[r.key] || []).includes(o.key)) || null });
          input.addEventListener('change', () => {
            if (r.type === 'radio') picked[r.key] = o.key;
            else { const s = new Set(picked[r.key] || []); input.checked ? s.add(o.key) : s.delete(o.key); picked[r.key] = [...s]; }
            simInvalid.delete(r.key);
          });
          return h('label', { class: 'sim-choice', for: oid }, input, h('span', { text: pv(o) }));
        }));
      }
      const input = h('input', { type: r.type === 'tel' ? 'tel' : r.type, id: cid, autocomplete: 'off' });
      input.value = v || '';
      input.addEventListener('input', () => { simValues[r.key] = input.value; });
      return input;
    };

    const simValid = (r) => {
      const v = (simValues[r.key] || '').trim();
      const filled = WITH_OPTIONS.has(r.type) ? (r.type === 'checkbox' ? (picked[r.key] || []).length > 0 : !!picked[r.key]) : v !== '';
      if (!filled) return !r.required;
      if (r.type === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      if (r.type === 'tel') return /^[0-9+\-\s()]{8,30}$/.test(v);
      if (r.core === 'name') return v.length >= 2;
      if (r.core === 'message') return v.length >= 10;
      if (r.type === 'number') return !Number.isNaN(Number(v)) && (r.min == null || Number(v) >= r.min) && (r.max == null || Number(v) <= r.max);
      return true;
    };
    const simError = (r) => {
      if (r.core && previewLang) { const k = { name: 'nameErr', phone: 'phoneErr', email: 'emailErr', service: 'serviceErr', message: 'messageErr' }[r.core]; if (k) return sim(k); }
      const lang = previewLang === 'en' ? 'En' : 'Es';
      if (r.type === 'email') return sim('emailErr');
      if (r.type === 'tel') return sim('phoneErr');
      return t((WITH_OPTIONS.has(r.type) ? 'fb.errChoose' : 'fb.errRequired') + lang);
    };

    const submit = h('button', { type: 'button', class: 'sim-submit' });
    const status = h('p', { class: 'sim-status', role: 'status' });
    submit.addEventListener('click', () => {
      simInvalid.clear();
      for (const r of rows) if (!simValid(r)) simInvalid.add(r.key);
      renderPreview();
      status.textContent = simInvalid.size ? sim('fix') : sim('sent');
      status.className = 'sim-status ' + (simInvalid.size ? 'bad' : 'ok');
    });

    const renderPreview = () => {
      simForm.lang = previewLang;
      const parts = [h('h3', { class: 'sim-title', text: sim('title') })];
      let half = [];
      const flush = () => { if (half.length) parts.push(h('div', { class: 'sim-row' }, half)); half = []; };
      rows.forEach((r) => {
        const cid = 'sim-' + r.key;
        const text = pv(r.label) || t('fb.untitled');
        const helpText = pv(r.help);
        const bad = simInvalid.has(r.key);
        const control = simControl(r, cid);
        const isGroup = r.type === 'radio' || r.type === 'checkbox';
        const optMark = !r.required ? h('span', { class: 'sim-opt', text: ' ' + t(previewLang === 'en' ? 'fb.optionalEn' : 'fb.optionalEs') }) : null;
        const tag = changedTag(r) ? h('span', { class: ['sim-tag', changedTag(r)], text: t('form.sim.' + changedTag(r)) }) : null;
        const head = isGroup
          ? h('span', { class: 'sim-legend', id: cid + '-label' }, text, optMark, tag)
          : h('label', { for: cid }, text, optMark, tag);
        if (isGroup) control.setAttribute('aria-labelledby', cid + '-label');
        const main = Array.isArray(control) ? control[0] : control;
        if (bad) {
          main.setAttribute('aria-describedby', cid + '-err');
          if (main.matches('input, textarea')) main.setAttribute('aria-invalid', 'true'); // allowed on text boxes only
        }
        const field = h('div', { class: ['sim-field', bad && 'invalid', isGroup && 'sim-group'] },
          head,
          h('small', { class: 'sim-help', text: helpText }), // always there: half-row neighbours keep their inputs aligned
          control,
          bad ? h('small', { class: 'sim-err', id: cid + '-err', text: simError(r) }) : null);
        if (r.width === 'half') { half.push(field); if (half.length === 2) flush(); } else { flush(); parts.push(field); }
      });
      flush();
      submit.textContent = sim('submit');
      parts.push(submit, status, h('p', { class: 'sim-note', text: sim('note') }));
      fill(simForm, parts);
      fit();
    };
    const changedTag = (r) => (!r.id ? 'new' : JSON.stringify(plain([r])[0]) !== JSON.stringify(r.saved) ? 'edited' : null);

    // ---------------------------------------------------------------- who receives the messages
    const recipients = () => {
      const rc = data.recipients;
      if (!rc.canEdit) {
        return h('section', { class: 'card', 'aria-labelledby': 'fb-rcpt' },
          cardHead({ id: 'fb-rcpt', icon: 'inbox', title: t('fb.rcpt.title'), lead: t('fb.rcpt.readLead') }),
          h('ul', { class: 'tag-list' }, rc.to.map((m) => h('li', { class: 'tag tag-fixed', text: m }))),
          h('p', { class: 'hint', text: t('fb.rcpt.ownerOnly') }));
      }
      let to = [...rc.to];
      const saved = JSON.stringify(rc.to);
      const tags = h('ul', { class: 'tag-list', 'aria-label': t('fb.rcpt.listLabel') });
      const input = textField({ label: t('fb.rcpt.add'), type: 'email', placeholder: 'ventas@sensumconstrucciones.com', autocomplete: 'off' });
      const addMail = button(t('fb.rcpt.addBtn'), { icon: 'plus-lg' });
      const save = button(t('fb.rcpt.save'), { icon: 'shield-lock', variant: 'primary' });
      const drawTags = () => {
        fill(tags, to.map((m, i) => h('li', { class: 'tag' }, h('span', { text: m }),
          h('button', { type: 'button', class: 'tag-x', 'aria-label': t('fb.rcpt.remove', { email: m }), disabled: to.length === 1 || null, onclick: () => { to.splice(i, 1); drawTags(); } }, icon('x-lg')))));
        addMail.disabled = to.length >= rc.max;
        save.disabled = JSON.stringify(to) === saved;
      };
      const tryAdd = () => {
        const v = input.input.value.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { input.setError(t('fb.rcpt.invalid')); return; }
        if (to.includes(v)) { input.setError(t('fb.rcpt.duplicate')); return; }
        input.setError(null); to.push(v); input.input.value = ''; drawTags();
      };
      addMail.addEventListener('click', tryAdd);
      input.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); tryAdd(); } });
      save.addEventListener('click', async () => {
        const pw = await askPassword({ title: t('fb.rcpt.confirmTitle'), lead: t('fb.rcpt.confirmLead'), confirmLabel: t('fb.rcpt.save') });
        if (!pw) return;
        setBusy(save, true, t('email.saving'));
        try {
          const r = await api.put('/contact-form/recipients', { to, currentPassword: pw });
          data.recipients.to = r.to;
          toast(t('fb.rcpt.saved'));
          fill(rcptSlot, recipients());
          return;
        } catch (err) {
          const pwErr = err.code === 'validation' && err.fields && err.fields.currentPassword;
          toast(pwErr ? fieldErrorText(pwErr) : errorText(err), { type: 'bad' });
        }
        setBusy(save, false);
      });
      drawTags();
      return h('section', { class: 'card', 'aria-labelledby': 'fb-rcpt' },
        cardHead({ id: 'fb-rcpt', icon: 'inbox', title: t('fb.rcpt.title'), lead: t('fb.rcpt.lead') }),
        tags,
        h('div', { class: 'fb-rcpt-add' }, input.wrap, addMail),
        h('p', { class: 'hint', text: t('fb.rcpt.hint', { max: rc.max }) }),
        h('div', { class: 'card-foot' }, save));
    };
    const rcptSlot = h('div', null, recipients());

    // ---------------------------------------------------------------- save
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
      rows.forEach((r) => {
        const es = r.label.es.trim();
        if (!es) e[`${r.key}.label.es`] = 'required';
        else if (/[<>]/.test(es)) e[`${r.key}.label.es`] = 'no_html';
        if (WITH_OPTIONS.has(r.type)) {
          const seen = new Set();
          r.options.forEach((o, i) => {
            const v = o.es.trim().toLowerCase();
            if (!v) e[`${r.key}.options.${i}`] = 'required';
            else if (seen.has(v)) e[`${r.key}.options.${i}`] = 'duplicate';
            seen.add(v);
          });
        }
      });
      return e;
    };
    const showErrors = (e) => {
      errors = e;
      const first = Object.keys(e)[0];
      if (!first) return false;
      const k = first.split('.')[0];
      openKey = k;
      renderList({ key: k, sel: first.includes('options') ? '.fb-opt.invalid input' : 'input[lang="es"]', scroll: true });
      toast(t('email.fixErrors'), { type: 'bad' });
      return true;
    };
    saveBtn.addEventListener('click', async () => {
      if (pairs.length) { setBusy(saveBtn, true, t('content.autoTr.finishing')); await Promise.allSettled(pairs.map((p) => p.settle())); setBusy(saveBtn, false); }
      if (showErrors(check())) return;
      setBusy(saveBtn, true, t('email.saving'));
      try {
        const r = await api.put('/contact-form', { fields: plain(rows), version: data.version });
        toast(r.changed ? t('fb.saved') : t('email.savedNoChange'));
        draw({ ...data, fields: r.fields, version: r.version, isDefault: r.isDefault });
        return;
      } catch (err) {
        if (err.code === 'validation') {
          // "fields.<n>.<what>" → that question; anything else is about the whole form.
          const mapped = {};
          let general = null;
          for (const [k, code] of Object.entries(err.fields || {})) {
            const m = /^fields\.(\d+)\.(.+)$/.exec(k);
            if (m && rows[Number(m[1])] && m[2] !== 'required') mapped[`${rows[Number(m[1])].key}.${m[2]}`] = code;
            else general = code;
          }
          if (!showErrors(mapped)) toast(t(general === 'name_required' ? 'fb.lockName' : general === 'contact_required' ? 'fb.lockContact' : 'email.fixErrors'), { type: 'bad' });
        } else if (err.code === 'conflict') toast(t('form.conflict'), { type: 'bad', action: { label: t('common.reload'), onClick: () => load() } });
        else toast(errorText(err, { preserved: true }), { type: 'bad' });
      }
      setBusy(saveBtn, false);
    });

    // ---------------------------------------------------------------- layout
    const langSwitch = segmented([{ value: 'es', label: 'Español' }, { value: 'en', label: 'English' }], 'es', (v) => { previewLang = v; renderPreview(); }, t('form.previewLang'));
    const deviceSwitch = segmented([{ value: 'phone', label: t('form.sim.phone'), icon: 'phone' }, { value: 'tablet', label: t('form.sim.tablet'), icon: 'laptop' }, { value: 'desktop', label: t('form.sim.desktop'), icon: 'globe2' }],
      device, (v) => { device = v; fit(); }, t('form.sim.device'));
    const fieldsCard = h('section', { class: 'card', 'aria-labelledby': 'fb-title' },
      cardHead({ id: 'fb-title', icon: 'card-text', title: t('fb.title'), lead: t('fb.cardLead'), badge: countBadge }),
      alertBox('info', null, t('fb.rule')),
      list, live,
      h('div', { class: 'card-foot' }, resetBtn, addBtn));
    const preview = h('section', { class: 'card svc-preview-card', 'aria-labelledby': 'fb-prev' },
      cardHead({ id: 'fb-prev', icon: 'eye', title: t('form.previewTitle'), lead: t('fb.previewLead') }),
      h('div', { class: 'sim-controls' }, langSwitch, deviceSwitch),
      h('div', { class: 'svc-preview' }, stage),
      h('p', { class: 'tiny muted', text: t('fb.legend') }),
      h('ul', { class: 'tips' }, ['tip1', 'tip2', 'tip3'].map((k) => h('li', null, icon('info-circle-fill'), h('span', { text: t('fb.' + k) })))));
    fill(body, h('div', { class: 'dash-grid' }, h('div', { class: 'stack-lg' }, fieldsCard, rcptSlot), h('div', { class: 'stack-lg svc-side' }, preview)), saveRow);
    renderList();
    changed();
  };

  await load();
  return { destroy: () => { alive = false; }, isDirty: () => dirty() };
}
