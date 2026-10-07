/** Textos del sitio (section list + editor) and Datos de contacto. */
import { h, icon, clear, nextId } from '../dom.js';
import { t, fieldText, fmtRelative } from '../i18n.js';
import { api } from '../api.js';
import { pageHead, loading, loadError, textField, alertBox, toast, errorText, fieldErrorText, openDialog, setBusy, button } from '../ui.js';

const ICONS = { hero: 'house', about: 'people', services: 'building', process: 'list', projects: 'images', cta: 'send', contact: 'envelope', faq: 'question-circle', footer: 'card-text', details: 'telephone' };

const differs = (field) => Object.keys(field.value).some((l) => field.value[l] !== field.default[l]);

function splitName(id) {
  const [name, desc] = t('sections.' + id);
  const parts = name.split(' → ');
  return { crumb: parts.length > 1 ? parts[0] : null, title: parts[parts.length - 1], full: name, desc };
}

// ------------------------------------------------------------------ list
export async function list({ main }) {
  main.append(pageHead({ title: t('content.title'), lead: t('content.lead') }), loading());
  let data;
  try { data = await api.get('/content'); } catch (err) {
    main.lastChild.replaceWith(loadError(err, () => { clear(main); list({ main }); }));
    return;
  }
  const cards = data.sections.filter((s) => s.id !== 'details').map((s) => {
    const n = splitName(s.id);
    const changed = s.fields.filter(differs).length;
    return h('a', { class: 'card card-link section-card', href: '#/textos/' + s.id },
      h('div', { class: 'row' }, h('span', { class: 'icon-tile' }, icon(ICONS[s.id] || 'pencil-square')),
        h('div', { class: 'grow' }, n.crumb ? h('div', { class: 'tiny muted', text: n.crumb }) : null, h('h2', { text: n.title }))),
      h('p', { text: n.desc }),
      h('div', { class: 'meta' },
        h('span', { class: 'badge', text: t('content.fieldsCount', { n: s.fields.length }) }),
        changed ? h('span', { class: 'badge badge-brand', text: t('content.customized', { n: changed }) }) : null,
        s.updatedAt ? h('span', { class: 'badge', text: t('content.lastChange', { when: fmtRelative(s.updatedAt) }) }) : null));
  });
  main.lastChild.replaceWith(h('div', { class: 'grid-cards' }, cards));
}

// ------------------------------------------------------------------ editor
function groupOf(key) {
  let m;
  if ((m = key.match(/^service(\d)\./))) return ['service', m[1]];
  if ((m = key.match(/^process(\d)\./))) return ['step', m[1]];
  if ((m = key.match(/^proj(\d)\./))) return ['project', m[1]];
  if ((m = key.match(/^faq\.[qa](\d)$/))) return ['faq', m[1]];
  if (/^hero\.badge/.test(key)) return ['badges'];
  if (/^hero\.cta/.test(key)) return ['buttons'];
  if (/^pillar\./.test(key)) return ['pillars'];
  if (/^about\.mission/.test(key)) return ['mission'];
  if (/^about\.vision/.test(key)) return ['vision'];
  if (/^contact\.phone/.test(key)) return ['phones'];
  if (key === 'contact.whatsapp') return ['whatsapp'];
  if (key === 'contact.email') return ['email'];
  if (/^contact\.address/.test(key)) return ['address'];
  if (/^contact\.maps?_/.test(key)) return ['map'];
  if (/^contact\.instagram/.test(key)) return ['social'];
  if (key === 'contact.hours_value' || key === 'whatsapp.message') return ['hours'];
  if (key === 'form.title') return ['form'];
  return ['general'];
}

/** Mirrors the server validator (cms/src/Content/Validator.php) for instant feedback. */
function validate(field, raw) {
  const v = raw.replace(/\s+/g, ' ').trim();
  if (!v) return field.required ? ['required'] : null;
  const len = (s) => [...s].length;
  switch (field.type) {
    case 'text': case 'textarea': case 'emphasis':
      if (/[<>]/.test(v)) return ['no_html'];
      if (len(field.type === 'emphasis' ? v.replace(/\*/g, '') : v) > field.max) return ['too_long', { max: field.max }];
      if (field.type === 'emphasis' && (v.split('*').length - 1) % 2 !== 0) return ['emphasis_unbalanced'];
      if (field.type === 'emphasis' && /\*\s*\*/.test(v)) return ['emphasis_empty'];
      return null;
    case 'phone': {
      const d = v.replace(/\D/g, '');
      return /^[0-9+()\- ]{8,20}$/.test(v) && d.length >= 8 && d.length <= 15 ? null : ['invalid_phone'];
    }
    case 'whatsapp': return /^\d{8,15}$/.test(v.replace(/[\s+()-]/g, '')) ? null : ['invalid_whatsapp'];
    case 'email': return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v) && len(v) <= field.max ? null : ['invalid_email'];
    case 'url': {
      let u;
      try { u = new URL(v); } catch (e) { return ['invalid_url']; }
      if (u.protocol !== 'https:' || u.username || u.password || u.port || /\s/.test(v)) return ['invalid_url'];
      return (field.hosts || []).includes(u.hostname.toLowerCase()) ? null : ['url_host_not_allowed', { hosts: (field.hosts || []).filter((x) => !x.startsWith('www.')).join(', ') }];
    }
    case 'handle': return /^@?[A-Za-z0-9._]{1,30}$/.test(v) ? null : ['invalid_handle'];
    default: return null;
  }
}

/** Builds "Construimos con *precisión*" as text + <em> nodes (never innerHTML). */
function emphasisPreview(text) {
  const out = h('div', { class: 'preview-title', 'aria-hidden': 'true' });
  text.split('*').forEach((part, i) => out.append(i % 2 ? h('em', { text: part }) : document.createTextNode(part)));
  return out;
}

const INPUT_TYPES = { phone: 'tel', whatsapp: 'tel', email: 'email', url: 'url' };

function buildEditor(main, section, { siteUrl, onSaved, singleLanguage = false, extras = null }) {
  const fieldsState = new Map(); // key -> { field, inputs: {lang: textField}, card, loaded: {lang: value} }
  let version = section.version;
  const groups = new Map();

  for (const field of section.fields) {
    const [gid, n] = groupOf(field.key);
    const gkey = gid + (n || '');
    if (!groups.has(gkey)) groups.set(gkey, { gid, n, fields: [] });
    groups.get(gkey).fields.push(field);
  }

  const savebarText = h('span', { class: 'savebar-text' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span'));
  const saveBtn = button(t('common.save'), { variant: 'primary', icon: 'check-lg' });
  const discardBtn = button(t('common.discard'), { variant: 'ghost' });
  const savebar = h('div', { class: 'savebar', role: 'region', 'aria-label': t('common.unsavedBar') }, savebarText, h('div', { class: 'actions' }, discardBtn, saveBtn));
  const status = h('div', { 'aria-live': 'polite' });

  const dirtyKeys = () => {
    const out = [];
    for (const st of fieldsState.values()) {
      for (const [lang, f] of Object.entries(st.inputs)) {
        if (f.input.value !== st.loaded[lang]) out.push([st.field.key, lang]);
      }
    }
    return out;
  };
  const refresh = () => {
    const d = dirtyKeys();
    savebar.classList.toggle('show', d.length > 0);
    savebar.inert = d.length === 0;
    savebarText.lastChild.textContent = t('common.unsavedCount', { n: d.length });
    for (const st of fieldsState.values()) {
      const isDirty = Object.entries(st.inputs).some(([l, f]) => f.input.value !== st.loaded[l]);
      st.card.classList.toggle('dirty', isDirty);
      const differsNow = Object.entries(st.inputs).some(([l, f]) => f.input.value.replace(/\s+/g, ' ').trim() !== st.field.default[l]);
      st.resetBtn.hidden = !differsNow;
      st.modified.hidden = !Object.entries(st.loaded).some(([l, v]) => v !== st.field.default[l]);
    }
  };

  const groupEls = [];
  for (const g of groups.values()) {
    let title = t('content.groups.' + g.gid, { n: g.n });
    const titleKey = g.gid === 'service' ? `service${g.n}.title` : g.gid === 'project' ? `proj${g.n}.title` : g.gid === 'step' ? `process${g.n}.title` : null;
    const titleField = titleKey && section.fields.find((f) => f.key === titleKey);
    const groupEl = h('section', { class: 'editor-group', 'aria-label': title },
      h('h2', { class: 'group-title' }, title, titleField ? h('span', { class: 'badge', text: titleField.value.es }) : null));
    for (const field of g.fields) {
      const ft = fieldText(field.key);
      const headingId = nextId('fh');
      const langs = field.bilingual ? ['es', 'en'] : ['*'];
      const inputs = {};
      const loaded = {};
      for (const lang of langs) {
        loaded[lang] = field.value[lang] ?? '';
        const f = textField({
          label: field.bilingual ? (lang === 'es' ? t('common.spanish') : t('common.english')) : ft.label,
          langTag: field.bilingual ? lang.toUpperCase() : null,
          value: loaded[lang], max: field.type === 'phone' || field.type === 'whatsapp' ? null : field.max,
          // Long one-line texts get a 2-line box so they can be read whole;
          // Enter is blocked below because the site shows them on one line.
          multiline: field.type === 'textarea' || (['text', 'emphasis'].includes(field.type) && field.max >= 80),
          rows: field.type === 'textarea' ? (field.max > 250 ? 5 : 3) : 2,
          type: INPUT_TYPES[field.type] || 'text', inputmode: field.type === 'phone' || field.type === 'whatsapp' ? 'tel' : null,
          hint: field.bilingual && lang === 'en' ? t('content.enHint') : (!field.bilingual ? ft.help : null),
          optionalTag: !field.required, lang: lang === '*' ? null : lang,
          countFn: field.type === 'emphasis' ? (v) => [...v.replace(/\*/g, '')].length : null,
          spellcheck: ['url', 'email', 'handle', 'phone', 'whatsapp'].includes(field.type) ? false : null,
        });
        // Accessible name "Título principal — Español", not just "Español".
        if (field.bilingual) f.input.setAttribute('aria-labelledby', headingId + ' ' + f.label.id);
        if (field.type !== 'textarea' && f.input.tagName === 'TEXTAREA') {
          f.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
        }
        f.input.addEventListener('input', () => {
          const err = validate(field, f.input.value);
          f.setError(err ? fieldErrorText(err[0], err[1]) : null);
          refresh();
          if (preview && lang === 'es') clear(previewWrap).append(emphasisPreview(f.input.value));
          if (extras && extras.onInput) extras.onInput(field.key, f.input.value);
        });
        inputs[lang] = f;
      }
      let preview = null;
      const previewWrap = h('div');
      if (field.type === 'emphasis') {
        preview = true;
        previewWrap.append(emphasisPreview(inputs.es.input.value));
      }
      const resetBtn = h('button', { type: 'button', class: 'btn btn-link small', hidden: true }, icon('arrow-counterclockwise'), t('content.resetDefault'));
      const modified = h('span', { class: 'badge badge-brand', hidden: true, text: t('content.modified') });
      resetBtn.addEventListener('click', () => {
        for (const [l, f] of Object.entries(inputs)) { f.input.value = field.default[l]; f.input.dispatchEvent(new Event('input')); }
        toast(t('content.resetDone'), { type: 'info' });
      });
      const card = h('div', { class: 'field-card' },
        h('div', { class: 'field-card-head' },
          // Single-language fields carry their label on the input itself.
          field.bilingual ? h('div', null, h('h3', { id: headingId, text: ft.label }), ft.help ? h('p', { class: 'hint', text: ft.help }) : null) : h('span'),
          h('div', { class: 'row' }, modified, resetBtn)),
        field.type === 'emphasis' ? h('p', { class: 'hint', text: t('content.emphasisHelp') }) : null,
        preview ? h('div', { class: 'stack-sm' }, h('span', { class: 'tiny muted', text: t('content.preview') }), previewWrap) : null,
        field.bilingual ? h('div', { class: ['lang-cols', 'two'] }, inputs.es.wrap, inputs.en.wrap) : inputs['*'].wrap,
        extras && extras.afterField ? extras.afterField(field, inputs) : null);
      fieldsState.set(field.key, { field, inputs, loaded, card, resetBtn, modified });
      groupEl.append(card);
    }
    groupEls.push(groupEl);
  }

  const discard = () => {
    for (const st of fieldsState.values()) for (const [l, f] of Object.entries(st.inputs)) { f.input.value = st.loaded[l]; f.setError(null); f.refreshCounter(); f.input.dispatchEvent(new Event('input')); }
    clear(status);
    refresh();
  };
  discardBtn.addEventListener('click', discard);

  const save = async () => {
    clear(status);
    const changed = dirtyKeys();
    if (!changed.length) return toast(t('content.savedNothing'), { type: 'info' });
    let firstBad = null;
    const values = {};
    for (const [key, lang] of changed) {
      const st = fieldsState.get(key);
      const f = st.inputs[lang];
      const err = validate(st.field, f.input.value);
      f.setError(err ? fieldErrorText(err[0], err[1]) : null);
      if (err && !firstBad) firstBad = f.input;
      (values[key] ||= {})[lang] = f.input.value;
    }
    if (firstBad) {
      status.append(alertBox('bad', null, t('content.fixErrors')));
      firstBad.focus();
      return;
    }
    setBusy(saveBtn, true, t('common.saving'));
    try {
      const res = await api.put('/content/' + section.id, { version, values });
      version = res.version;
      for (const [key, lang] of changed) {
        const st = fieldsState.get(key);
        // Store what the server will render (whitespace collapsed).
        st.loaded[lang] = st.inputs[lang].input.value.replace(/\s+/g, ' ').trim();
        st.inputs[lang].input.value = st.loaded[lang];
      }
      setBusy(saveBtn, false);
      refresh();
      toast(t('content.saved'), { action: siteUrl ? { label: t('content.viewOnSite'), href: siteUrl + '/' + (section.anchor || ''), external: true } : null });
      if (onSaved) onSaved();
    } catch (err) {
      setBusy(saveBtn, false);
      if (err.code === 'validation') {
        let first = null;
        for (const [k, code] of Object.entries(err.fields || {})) {
          const m = k.match(/^(.*)\.(es|en)$/);
          const key = m ? m[1] : k;
          const lang = m ? m[2] : '*';
          const st = fieldsState.get(key);
          if (st && st.inputs[lang]) {
            st.inputs[lang].setError(fieldErrorText(code, { max: st.field.max, hosts: (st.field.hosts || []).join(', ') }));
            first ||= st.inputs[lang].input;
          }
        }
        status.append(alertBox('bad', null, t('content.fixErrors')));
        if (first) first.focus();
      } else if (err.code === 'conflict') {
        openDialog({
          title: t('content.conflictTitle'), labelledIcon: 'exclamation-triangle-fill',
          body: h('p', { class: 'muted', text: t('content.conflictBody', { name: err.data.updatedBy || t('dashboard.someone') }) }),
          actions: [
            { label: t('common.unsavedStay'), onClick: (b, close) => close() },
            { label: t('content.reloadSection'), variant: 'primary', onClick: (b, close) => { close(); for (const st of fieldsState.values()) for (const l of Object.keys(st.inputs)) st.loaded[l] = st.inputs[l].input.value; location.reload(); } },
          ],
        });
      } else {
        status.append(alertBox('bad', null, errorText(err, { preserved: true })));
      }
    }
  };
  saveBtn.addEventListener('click', save);
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  };
  document.addEventListener('keydown', onKey);

  const form = h('form', { class: 'stack-lg', novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } }, extras && extras.top ? extras.top : null, groupEls, status);
  main.append(form, savebar);
  savebar.inert = true;
  refresh();

  return {
    isDirty: () => dirtyKeys().length > 0,
    destroy: () => { document.removeEventListener('keydown', onKey); savebar.remove(); },
    fieldsState,
  };
}

export async function editor({ main, params, navigate }) {
  const id = params[0];
  main.append(loading());
  let data;
  try { data = await api.get('/content'); } catch (err) {
    main.lastChild.replaceWith(loadError(err, () => { clear(main); editor({ main, params, navigate }); }));
    return null;
  }
  const section = data.sections.find((s) => s.id === id);
  if (!section || id === 'details') { navigate('/textos'); return null; }
  const n = splitName(id);
  clear(main).append(pageHead({
    crumbs: [{ label: t('content.title'), href: '#/textos' }].concat(n.crumb ? [{ label: n.crumb }] : []),
    title: n.title,
    lead: n.desc + ' ' + t('content.editorLead'),
    actions: [h('a', { class: 'btn btn-sm', href: data.siteUrl + '/' + section.anchor, target: '_blank', rel: 'noopener' }, icon('box-arrow-up-right'), t('content.viewOnSite'))],
  }));
  return buildEditor(main, section, { siteUrl: data.siteUrl });
}

// ------------------------------------------------------------------ contact details
export async function details({ main }) {
  main.append(pageHead({ title: t('details.title'), lead: t('details.lead') }), loading());
  let data;
  try { data = await api.get('/content'); } catch (err) {
    main.lastChild.replaceWith(loadError(err, () => { clear(main); details({ main }); }));
    return null;
  }
  main.lastChild.remove();
  const section = data.sections.find((s) => s.id === 'details');
  const val = (k) => section.fields.find((f) => f.key === k).value['*'];
  const current = { building: val('contact.address_building'), street: val('contact.address_street'), office: val('contact.address_office'), city: val('contact.address_city'), map: val('contact.map_title') };

  const dl = h('dl', { class: 'preview-box' });
  const join = (parts) => parts.map((p) => p.trim()).filter(Boolean).join(', ');
  const renderPreview = () => {
    const short = current.office.trim().replace(/^Oficina\s+/, 'Of. ');
    clear(dl).append(
      h('dt', { text: t('details.previewFull') }), h('dd', { text: join([current.building, current.street, current.office, current.city]) }),
      h('dt', { text: t('details.previewShort') }), h('dd', { text: join([current.building, current.street, short]) }),
      h('dt', { text: t('details.previewMap') }), h('dd', null, h('strong', { text: current.map }), h('br'), join([current.street, current.office, current.city])));
  };
  renderPreview();
  const map = { 'contact.address_building': 'building', 'contact.address_street': 'street', 'contact.address_office': 'office', 'contact.address_city': 'city', 'contact.map_title': 'map' };

  return buildEditor(main, section, {
    siteUrl: data.siteUrl,
    extras: {
      onInput: (key, value) => { if (map[key]) { current[map[key]] = value; renderPreview(); } },
      afterField: (field, inputs) => {
        if (field.key === 'contact.address_city') return h('div', { class: 'stack-sm' }, h('span', { class: 'tiny muted', text: t('details.previewTitle') }), dl);
        if (field.type === 'url') {
          const test = h('button', { type: 'button', class: 'btn btn-sm' }, icon('box-arrow-up-right'), t('details.testLink'));
          test.addEventListener('click', () => {
            const v = inputs['*'].input.value.trim();
            if (validate(field, v)) return inputs['*'].input.focus();
            window.open(v, '_blank', 'noopener');
          });
          return h('div', null, test);
        }
        return null;
      },
    },
  });
}
