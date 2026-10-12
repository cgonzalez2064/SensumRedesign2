/**
 * Prospectos — every message sent with the site's contact form, kept here so
 * none gets lost in an inbox: status (nuevo → contactado → cotizado → ganado /
 * perdido), quoted amount, notes with their history, quick contact links and
 * a CSV export. Owner and accounts with the "leads" access.
 */
import { h, icon, fill, initials } from '../dom.js';
import { t, fmtDate, fmtRelative, getLang } from '../i18n.js';
import { api, download, saveBlob } from '../api.js';
import { pageHead, loading, loadError, emptyState, toast, errorText, setBusy, button, textField, fieldErrorText, alertBox, cardHead, confirmDialog } from '../ui.js';
import { refreshLeadsBadge } from '../app.js';

const STATUSES = ['new', 'contacted', 'quoted', 'won', 'lost'];
const FILTERS = ['active', 'new', 'contacted', 'quoted', 'won', 'lost', 'all'];
const STATUS_BADGE = { new: 'badge-brand', contacted: 'badge-info', quoted: 'badge-warn', won: 'badge-ok', lost: '' };
const STATUS_ICON = { new: 'bell', contacted: 'telephone', quoted: 'card-text', won: 'check-circle-fill', lost: 'x-circle-fill' };

const statusBadge = (s) => h('span', { class: ['badge', STATUS_BADGE[s]] }, icon(STATUS_ICON[s]), t('leads.status.' + s));
const money = (n) => 'Q ' + new Intl.NumberFormat(getLang() === 'en' ? 'en-US' : 'es-GT').format(n);
/** wa.me needs the country code: 8-digit Guatemalan numbers get 502. */
const waLink = (phone) => { const d = phone.replace(/\D/g, ''); return d.length >= 8 ? 'https://wa.me/' + (d.length === 8 ? '502' + d : d) : null; };

// ------------------------------------------------------------------ list

export async function render({ main, isOwner }) {
  const exportBtn = button(t('leads.export'), { icon: 'download' });
  main.append(pageHead({ title: t('leads.title'), lead: t('leads.lead'), actions: [exportBtn] }));
  const body = h('div', { class: 'stack' }, loading());
  main.append(body);
  let filter = 'active';
  let q = '';
  let service = '';
  let alive = true;
  let timer = null;

  const search = h('input', { class: 'input', type: 'search', placeholder: t('leads.search'), 'aria-label': t('leads.search'), autocomplete: 'off' });
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { q = search.value.trim(); load(); }, 300); });
  const serviceSel = h('select', { class: 'select', 'aria-label': t('leads.serviceFilter') });
  serviceSel.addEventListener('change', () => { service = serviceSel.value; load(); });
  const tabs = h('div', { class: 'filter-tabs', role: 'group', 'aria-label': t('leads.filterLabel') });
  const listBox = h('div', { 'aria-live': 'polite' });
  const settingsBox = h('div');

  exportBtn.addEventListener('click', async () => {
    setBusy(exportBtn, true, t('leads.exporting'));
    try {
      const f = await download('/leads/export', { status: filter, q, service, lang: getLang() });
      saveBlob(f.blob, f.filename);
      toast(t('leads.exported'));
    } catch (err) { toast(errorText(err), { type: 'bad' }); }
    setBusy(exportBtn, false);
  });

  const load = async () => {
    let data;
    try {
      const qs = new URLSearchParams({ status: filter, ...(q ? { q } : {}), ...(service ? { service } : {}) }).toString();
      data = await api.get('/leads?' + qs);
    } catch (err) { fill(listBox, loadError(err, load)); return; }
    if (!alive) return;
    fill(tabs, FILTERS.map((f) => h('button', {
      type: 'button', class: 'filter-tab', 'aria-pressed': String(f === filter),
      onclick: () => { filter = f; load(); },
    }, t('leads.filter.' + f), h('span', { class: 'count', text: String(data.counts[f] ?? 0) }))));
    fill(serviceSel, h('option', { value: '', text: t('leads.allServices') }),
      data.services.map((sv) => h('option', { value: sv, text: sv, selected: sv === service || null })));
    serviceSel.hidden = data.services.length < 2;
    if (isOwner) fill(settingsBox, retentionCard(data.retention));
    refreshLeadsBadge();
    if (!data.leads.length) {
      fill(listBox, h('div', { class: 'card' }, q || service || filter !== 'all'
        ? emptyState('funnel', t('leads.emptyFilterTitle'), t('leads.emptyFilterBody'))
        : emptyState('inbox', t('leads.emptyTitle'), t('leads.emptyBody'))));
      return;
    }
    fill(listBox, h('ul', { class: 'ticket-list' }, data.leads.map((l) => h('li', null,
      h('a', { class: ['ticket-row', l.unread && 'unread'], href: '#/prospectos/' + l.id },
        h('span', { class: 'avatar', 'aria-hidden': 'true', text: initials(l.name) }),
        h('span', { class: 'grow ticket-main' },
          h('span', { class: 'ticket-title' }, l.unread ? h('span', { class: 'unread-dot', title: t('leads.unread') }, h('span', { class: 'sr-only', text: t('leads.unread') })) : null, h('span', { class: 'break', text: l.name })),
          h('span', { class: 'tiny muted lead-excerpt', text: l.message }),
          h('span', { class: 'tiny muted', text: [l.service, fmtRelative(l.createdAt), l.lang === 'en' ? 'EN' : null].filter(Boolean).join(' · ') })),
        h('span', { class: 'ticket-badges' },
          !l.notified ? h('span', { class: 'badge badge-warn', title: t('leads.notNotified') }, icon('exclamation-triangle-fill'), h('span', { class: 'sr-only', text: t('leads.notNotified') })) : null,
          l.amount !== null ? h('span', { class: 'badge', text: money(l.amount) }) : null,
          statusBadge(l.status)),
        icon('chevron-right', 'ticket-chevron'))))));
  };

  /** Owner: how long messages are kept (the privacy notice says it). */
  const retentionCard = (months) => {
    const sel = h('select', { class: 'select', id: 'lead-retention' }, [6, 12, 24, 36].map((m) => h('option', { value: String(m), selected: m === months || null, text: t('leads.months', { n: m }) })));
    sel.addEventListener('change', async () => {
      sel.disabled = true;
      try { await api.put('/leads/settings', { retention: Number(sel.value) }); toast(t('leads.retentionSaved')); } catch (err) { sel.value = String(months); toast(errorText(err), { type: 'bad' }); }
      sel.disabled = false;
    });
    return h('section', { class: 'card', 'aria-labelledby': 'lead-ret' },
      cardHead({ id: 'lead-ret', icon: 'shield-lock', title: t('leads.retentionTitle'), lead: t('leads.retentionLead') }),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'lead-retention', text: t('leads.retentionLabel') }), sel));
  };

  fill(body, h('div', { class: 'ticket-toolbar' }, tabs, h('div', { class: 'ticket-search row' }, serviceSel, search)), listBox, settingsBox);
  listBox.append(loading());
  await load();
  return { destroy: () => { alive = false; clearTimeout(timer); } };
}

// ------------------------------------------------------------------ one lead

export async function detail({ main, params }) {
  const id = Number(params[0]);
  const body = h('div', null, loading());
  main.append(pageHead({ crumbs: [{ label: t('leads.title'), href: '#/prospectos' }, { label: '#' + id }], title: t('leads.loadingTitle') }), body);
  let alive = true;
  let draftDirty = () => false;

  const load = async () => {
    let data;
    try { data = await api.get('/leads/' + id); } catch (err) {
      if (err.status === 404) { fill(body, h('div', { class: 'card' }, emptyState('exclamation-circle', t('leads.notFoundTitle'), t('leads.notFoundBody'), h('a', { class: 'btn', href: '#/prospectos' }, t('leads.backToList'))))); return; }
      fill(body, loadError(err, load)); return;
    }
    if (!alive) return;
    draw(data);
    refreshLeadsBadge();
  };

  const draw = ({ lead: l, notes }) => {
    main.querySelector('.page-head h1').textContent = l.name;
    document.title = l.name + ' · ' + t('leads.title') + ' · ' + t('app.name');
    const first = l.name.split(' ')[0];

    const summary = h('div', { class: 'ticket-summary' }, statusBadge(l.status),
      l.service ? h('span', { class: 'badge' }, icon('card-text'), l.service) : null,
      l.amount !== null ? h('span', { class: 'badge', text: money(l.amount) }) : null,
      l.lang === 'en' ? h('span', { class: 'badge', title: t('leads.wroteInEnglish') }, icon('translate'), 'English') : null,
      h('span', { class: 'tiny muted', text: t('leads.received', { when: fmtDate(l.createdAt) }) }));

    const warn = !l.notified ? alertBox('warn', null, t('leads.notNotifiedLong')) : null;

    // The message, and the answers to the form's extra questions (Formulario de contacto).
    const answers = (l.answers || []).length
      ? h('div', { class: 'stack-sm' }, h('h3', { class: 'small-title', text: t('leads.answers') }),
        h('dl', { class: 'kv kv-tight lead-answers' }, l.answers.map((a) => [h('dt', { text: a.label }), h('dd', { text: a.value })])))
      : null;
    const message = h('section', { class: 'card', 'aria-labelledby': 'ld-msg' },
      cardHead({ id: 'ld-msg', icon: 'chat-square-text', title: t('leads.message') }),
      l.message ? h('div', { class: 'report-desc', text: l.message }) : h('p', { class: 'muted small', text: t('leads.noMessage') }),
      answers);

    // Notes and history.
    const timeline = h('ol', { class: 'timeline', 'aria-label': t('leads.history') }, notes.length
      ? notes.map(noteItem)
      : h('li', { class: 'timeline-empty muted small', text: t('leads.noNotes') }));
    const note = textField({ label: t('leads.noteLabel'), multiline: true, rows: 3, max: 2000, placeholder: t('leads.notePlaceholder') });
    draftDirty = () => note.input.value.trim() !== '';
    const addNote = button(t('leads.addNote'), { variant: 'primary', icon: 'plus-lg' });
    addNote.addEventListener('click', async () => {
      const v = note.input.value.trim();
      if (!v) { note.setError(fieldErrorText('required')); note.input.focus(); return; }
      note.setError(null);
      setBusy(addNote, true, t('common.saving'));
      try { const res = await api.post('/leads/' + id + '/notes', { body: v }); note.input.value = ''; toast(t('leads.noteSaved')); draw(res); return; }
      catch (err) { toast(errorText(err, { preserved: true }), { type: 'bad' }); }
      setBusy(addNote, false);
    });
    const history = h('section', { class: 'card', 'aria-labelledby': 'ld-hist' },
      cardHead({ id: 'ld-hist', icon: 'clock-history', title: t('leads.history') }), timeline,
      h('div', { class: 'stack-sm' }, note.wrap, h('div', { class: 'row-end' }, addNote)));

    // Contact: e-mail, phone, WhatsApp.
    const reply = 'mailto:' + encodeURIComponent(l.email) + '?subject=' + encodeURIComponent(t('leads.replySubject'));
    const wa = waLink(l.phone);
    const contact = h('section', { class: 'card', 'aria-labelledby': 'ld-contact' },
      cardHead({ id: 'ld-contact', icon: 'person-circle', title: t('leads.contact') }),
      h('div', { class: 'stack' }, h('dl', { class: 'kv kv-tight' },
        h('dt', { text: t('leads.email') }), h('dd', null, h('a', { class: 'break', href: 'mailto:' + l.email, text: l.email })),
        h('dt', { text: t('leads.phone') }), h('dd', null, h('a', { href: 'tel:' + l.phone.replace(/[^\d+]/g, ''), text: l.phone }))),
      h('div', { class: 'stack-sm' },
        h('a', { class: 'btn btn-primary btn-block', href: reply }, icon('envelope'), t('leads.replyEmail', { name: first })),
        wa ? h('a', { class: 'btn btn-block', href: wa, target: '_blank', rel: 'noopener noreferrer' }, icon('whatsapp'), t('leads.replyWhatsapp'), h('span', { class: 'sr-only', text: ' ' + t('app.newTab') })) : null,
        h('a', { class: 'btn btn-block', href: 'tel:' + l.phone.replace(/[^\d+]/g, '') }, icon('telephone'), t('leads.call'))),
      h('p', { class: 'tiny muted', text: t('leads.contactHint') })));

    // Follow-up: status and amount.
    const statusSel = h('select', { class: 'select', id: 'ld-status' }, STATUSES.map((s) => h('option', { value: s, selected: s === l.status || null, text: t('leads.status.' + s) })));
    const amount = textField({ label: t('leads.amount'), value: l.amount !== null ? String(l.amount) : '', inputmode: 'numeric', hint: t('leads.amountHint'), maxlength: 9 });
    amount.input.addEventListener('input', () => { amount.input.value = amount.input.value.replace(/\D/g, '').slice(0, 9); });
    const save = button(t('common.save'), { variant: 'primary', icon: 'check-lg' });
    save.addEventListener('click', async () => {
      amount.setError(null);
      setBusy(save, true, t('common.saving'));
      try {
        const res = await api.put('/leads/' + id, { status: statusSel.value, amount: amount.input.value === '' ? null : Number(amount.input.value) });
        toast(t('leads.saved'));
        draw(res);
        return;
      } catch (err) {
        if (err.code === 'validation' && err.fields.amount) amount.setError(t('leads.amountInvalid'));
        else toast(errorText(err), { type: 'bad' });
      }
      setBusy(save, false);
    });
    const del = button(t('leads.delete'), { icon: 'trash3', variant: 'ghost', small: true });
    del.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: t('leads.deleteTitle', { name: l.name }), body: t('leads.deleteBody'), confirmLabel: t('leads.delete'), danger: true }))) return;
      try { await api.del('/leads/' + id); toast(t('leads.deleted')); location.hash = '#/prospectos'; } catch (err) { toast(errorText(err), { type: 'bad' }); }
    });
    const follow = h('section', { class: 'card', 'aria-labelledby': 'ld-follow' },
      cardHead({ id: 'ld-follow', icon: 'funnel', title: t('leads.followUp') }),
      h('div', { class: 'stack' },
        h('div', { class: 'field' }, h('label', { class: 'label', for: 'ld-status', text: t('leads.statusLabel') }), statusSel),
        amount.wrap,
        h('div', { class: 'row-between' }, del, save)));

    fill(body, h('div', { class: 'stack-lg' }, summary, warn,
      h('div', { class: 'dash-grid' },
        h('div', { class: 'stack-lg' }, message, history),
        h('div', { class: 'stack-lg ticket-side' }, contact, follow))));
  };

  await load();
  return { destroy: () => { alive = false; }, isDirty: () => draftDirty() };
}

function noteItem(n) {
  const when = h('time', { class: 'tiny muted', datetime: new Date(n.createdAt * 1000).toISOString(), title: fmtDate(n.createdAt), text: fmtRelative(n.createdAt) });
  if (n.kind === 'event') {
    const d = n.details || {};
    const text = d.action === 'status'
      ? t('leads.event.status', { name: n.author, from: t('leads.status.' + d.from), to: t('leads.status.' + d.to) })
      : d.to === null ? t('leads.event.amountCleared', { name: n.author }) : t('leads.event.amount', { name: n.author, amount: money(d.to) });
    return h('li', { class: 'timeline-event' }, icon(d.action === 'status' ? STATUS_ICON[d.to] || 'arrow-repeat' : 'card-text'), h('span', { class: 'small', text }), when);
  }
  return h('li', { class: 'timeline-msg from-support note' },
    h('span', { class: 'avatar', 'aria-hidden': 'true', text: initials(n.author) }),
    h('div', { class: 'bubble' },
      h('div', { class: 'bubble-head' }, h('strong', { text: n.author }), h('span', { class: 'badge badge-warn' }, icon('lock'), t('leads.internal')), when),
      h('div', { class: 'bubble-body', text: n.body })));
}
