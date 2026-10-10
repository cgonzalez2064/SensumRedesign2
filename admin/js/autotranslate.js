/**
 * Automatic ES ⇄ EN for a pair of plain inputs (contact-form options, photo
 * descriptions), the same way the site-text editor works: typing in one
 * language fills the other after a short pause — unless the person already
 * wrote that one themselves in this session. The filled text is marked
 * "Traducido automáticamente · Deshacer" until it is edited. Saves nothing.
 *
 *   const pair = autoTranslatePair({ es: esField, en: enField });   // textField() results
 *   await pair.settle();   // before saving: finishes translations in progress
 */
import { h, icon, fill } from './dom.js';
import { t } from './i18n.js';
import { api } from './api.js';

/**
 * @param {object} o
 * @param {{input:HTMLInputElement,wrap:HTMLElement}} o.es
 * @param {{input:HTMLInputElement,wrap:HTMLElement}} o.en
 * @param {{es:string,en:string}} [o.saved]   the stored values (default: the inputs' current values)
 * @param {{keep?:{es:boolean,en:boolean}}} [o.memory] survives re-rendering the same row
 */
export function autoTranslatePair({ es, en, saved, memory = {}, delay = 700, onChange = () => {} }) {
  const fields = { es, en };
  const state = {};
  memory.keep = memory.keep || { es: false, en: false };
  for (const lang of ['es', 'en']) {
    const note = h('div', { class: 'tr-note small', hidden: true, 'aria-live': 'polite' });
    fields[lang].wrap.append(note);
    const st = { saved: saved ? saved[lang] : fields[lang].input.value, machine: null, prev: null, note, timer: null, inflight: null };
    Object.defineProperty(st, 'keep', { get: () => memory.keep[lang], set: (v) => { memory.keep[lang] = v; } });
    state[lang] = st;
  }
  const other = (l) => (l === 'es' ? 'en' : 'es');

  const setNote = (lang, kind, text) => {
    const st = state[lang];
    if (!kind) { st.note.hidden = true; fill(st.note); return; }
    const undo = kind === 'auto' && st.prev !== null ? h('button', { type: 'button', class: 'btn btn-link', onclick: () => {
      fields[lang].input.value = st.prev;
      st.prev = null; st.machine = null; st.keep = true;
      setNote(lang, null);
      fields[lang].input.dispatchEvent(new Event('input', { bubbles: true }));
      onChange();
    } }, t('content.autoTr.undo')) : null;
    fill(st.note, icon(kind === 'error' ? 'exclamation-circle' : 'translate'), h('span', { text }), undo);
    st.note.className = 'tr-note small ' + (kind === 'error' ? 'bad-text' : 'muted');
    st.note.hidden = false;
  };

  const translate = async (from) => {
    const to = other(from);
    const src = fields[from].input.value.trim();
    const target = state[to];
    if (target.keep) return;
    // Back to the saved text: so is its translation.
    if (src === state[from].saved.trim()) {
      if (target.machine !== null) { fields[to].input.value = target.saved; target.machine = null; target.prev = null; setNote(to, null); onChange(); }
      return;
    }
    if (!src) return;
    const run = api.post('/content/translate', { from, to, items: [{ text: src }] }, { timeout: 20000 });
    target.inflight = run;
    setNote(to, 'working', t('content.autoTr.working'));
    try {
      const res = await run;
      if (target.inflight !== run || target.keep || fields[from].input.value.trim() !== src) return; // something changed meanwhile
      if (target.prev === null) target.prev = fields[to].input.value;
      const text = res.translations[0].text;
      fields[to].input.value = text;
      target.machine = text;
      fields[to].input.dispatchEvent(new CustomEvent('input', { bubbles: true, detail: { machine: true } }));
      setNote(to, 'auto', t(from === 'es' ? 'content.autoTr.doneFromEs' : 'content.autoTr.doneFromEn'));
      onChange();
    } catch (err) {
      if (target.inflight === run) setNote(to, 'error', err.code === 'translation_quota' ? t('content.autoTr.quota') : err.code === 'translation_busy' || err.code === 'too_many_attempts' ? t('content.autoTr.busy') : t('content.autoTr.failed'));
    } finally {
      if (target.inflight === run) target.inflight = null;
    }
  };

  for (const lang of ['es', 'en']) {
    const input = fields[lang].input;
    input.addEventListener('input', (e) => {
      if (e.detail && e.detail.machine) return;
      const st = state[lang];
      // The person typed here: their text wins from now on.
      if (st.machine !== null && input.value !== st.machine) { st.keep = true; st.machine = null; st.prev = null; setNote(lang, null); }
      else if (st.machine === null) st.keep = st.keep || input.value !== st.saved;
      clearTimeout(st.timer);
      st.timer = setTimeout(() => { st.timer = null; translate(lang); }, delay);
    });
    input.addEventListener('blur', () => {
      const st = state[lang];
      if (st.timer) { clearTimeout(st.timer); st.timer = null; translate(lang); }
    });
  }

  return {
    /** Runs translations still waiting for the typing pause and waits for those in progress. */
    async settle() {
      const runs = [];
      for (const lang of ['es', 'en']) {
        const st = state[lang];
        if (st.timer) { clearTimeout(st.timer); st.timer = null; runs.push(translate(lang)); }
      }
      await Promise.allSettled(runs);
      await Promise.allSettled(['es', 'en'].map((l) => state[l].inflight).filter(Boolean));
    },
  };
}
