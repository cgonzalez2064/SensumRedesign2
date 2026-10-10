/** Informe mensual — a short site-health report for clients (owner account only). */
import { h, icon, clear, fill } from '../dom.js';
import { t, fmtDate } from '../i18n.js';
import { api } from '../api.js';
import { pageHead, loading, loadError, button, setBusy, toast, errorText, alertBox, confirmDialog, textField, cardHead } from '../ui.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CARD_ICONS = { 'sr-prev': 'eye', 'sr-rec': 'people', 'sr-send': 'send', 'sr-hist': 'clock-history' };

function card(id, title, ...children) {
  return h('section', { class: 'card', 'aria-labelledby': id }, cardHead({ id, icon: CARD_ICONS[id], title }), h('div', { class: 'stack' }, ...children));
}

/** The report as clients will read it (same text as the e-mail, built by the server). */
function preview(r) {
  return h('article', { class: 'report-preview', lang: r.lang },
    h('div', { class: 'report-eyebrow', text: r.periodLabel }),
    h('h3', { class: 'report-headline', text: r.headline }),
    h('span', { class: ['badge', r.status === 'good' ? 'badge-ok' : 'badge-warn'] }, icon(r.status === 'good' ? 'check-circle-fill' : 'exclamation-triangle-fill'), r.statusLabel),
    h('p', { class: 'report-summary', text: r.summary }),
    h('div', { class: 'kpi-grid' }, r.kpis.map((k) => h('div', { class: 'kpi' },
      h('span', { class: 'kpi-label', text: k.label }), h('span', { class: 'kpi-num', text: k.value }), h('span', { class: 'kpi-label', text: k.note })))),
    r.sections.map((s) => h('div', { class: 'report-section' },
      h('h4', { text: s.title }), s.intro ? h('p', { class: 'small muted', text: s.intro }) : null,
      h('ul', null, s.items.map((i) => h('li', { text: i }))))));
}

export async function render({ main }) {
  main.append(pageHead({ title: t('siteReport.title'), lead: t('siteReport.lead') }));
  const body = h('div', { class: 'stack-lg' }, loading());
  main.append(body);
  let alive = true;
  let data;
  let period;
  let recipients = [];
  const previewBox = h('div', { 'aria-live': 'polite' });

  const loadPreview = async () => {
    fill(previewBox, loading());
    try {
      const r = await api.get('/site-report/preview?period=' + encodeURIComponent(period));
      if (alive) fill(previewBox, preview(r.report));
    } catch (err) { fill(previewBox, loadError(err, loadPreview)); }
  };

  const load = async () => {
    try { data = await api.get('/site-report'); } catch (err) { fill(body, loadError(err, load)); return; }
    if (!alive) return;
    recipients = [...data.settings.recipients];
    period = period || data.status.period;
    const st = data.status;
    const periodLabel = (p) => (data.periods.find((x) => x.value === p) || { label: p }).label;

    // Status of last month's report.
    const statusBox = st.sentAt
      ? alertBox('ok', t('siteReport.sentTitle', { month: periodLabel(st.period) }), t('siteReport.sentBody', { when: fmtDate(st.sentAt) }))
      : alertBox(st.overdue ? 'warn' : 'info', t('siteReport.pendingTitle', { month: periodLabel(st.period) }),
        t(st.overdue ? 'siteReport.overdueBody' : 'siteReport.pendingBody') + (st.reminderSentAt ? ' ' + t('siteReport.reminded', { when: fmtDate(st.reminderSentAt) }) : ''));

    // Preview with month selector.
    const monthSel = h('select', { class: 'select', id: 'sr-period' }, data.periods.map((p) => h('option', { value: p.value, text: p.label, selected: p.value === period || null })));
    monthSel.addEventListener('change', () => { period = monthSel.value; sendBtn.lastChild.textContent = t('siteReport.send', { month: periodLabel(period) }); loadPreview(); });
    const previewCard = card('sr-prev', t('siteReport.previewTitle'),
      h('div', { class: 'row-between' }, h('label', { class: 'field grow' }, h('span', { class: 'label', text: t('siteReport.month') }), monthSel)),
      h('p', { class: 'small muted', text: t('siteReport.previewHint') }),
      data.pagespeed.enabled || data.pagespeed.fetchedAt ? null : h('p', { class: 'small muted', text: t('siteReport.noPagespeed') }),
      previewBox);

    // Recipients (owner always in copy) and language.
    const chips = h('ul', { class: 'chips', 'aria-label': t('siteReport.recipientsTitle') });
    const renderChips = () => {
      fill(chips, h('li', { class: 'chip chip-fixed' }, icon('lock'), h('span', { text: data.ownerEmail }), h('span', { class: 'tiny muted', text: t('siteReport.alwaysCc') })),
        ...recipients.map((r) => h('li', { class: 'chip' }, h('span', { text: r }),
          h('button', { type: 'button', class: 'chip-x', 'aria-label': t('siteReport.removeRecipient', { email: r }), onclick: () => { recipients = recipients.filter((x) => x !== r); renderChips(); } }, icon('x-lg')))));
    };
    renderChips();
    const add = textField({ label: t('siteReport.addLabel'), type: 'email', inputmode: 'email', autocomplete: 'off', placeholder: 'nombre@empresa.com' });
    const addBtn = button(t('siteReport.add'), { icon: 'plus-lg', small: true });
    const addRecipient = () => {
      const v = add.input.value.trim().toLowerCase();
      if (!EMAIL_RE.test(v)) { add.setError(t('siteReport.invalidEmail')); return add.input.focus(); }
      if (v === data.ownerEmail) { add.setError(t('siteReport.ownerAlready')); return; }
      if (recipients.length >= data.maxRecipients) { add.setError(t('siteReport.tooMany', { n: data.maxRecipients })); return; }
      add.setError(null);
      if (!recipients.includes(v)) recipients.push(v);
      add.input.value = '';
      renderChips();
      add.input.focus();
    };
    addBtn.addEventListener('click', addRecipient);
    add.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addRecipient(); } });
    const langSel = h('select', { class: 'select', id: 'sr-lang' }, ['es', 'en'].map((l) => h('option', { value: l, text: t('langs.' + l), selected: l === data.settings.lang || null })));
    const saveBtn = button(t('siteReport.save'), { variant: 'primary', icon: 'check-lg' });
    saveBtn.addEventListener('click', async () => {
      setBusy(saveBtn, true, t('common.saving'));
      try {
        const r = await api.put('/site-report/settings', { recipients, lang: langSel.value });
        recipients = r.settings.recipients;
        data.settings = r.settings;
        renderChips();
        toast(t('siteReport.saved'));
        loadPreview();
      } catch (err) { toast(errorText(err), { type: 'bad' }); }
      setBusy(saveBtn, false);
    });
    const recipientsCard = card('sr-rec', t('siteReport.recipientsTitle'),
      h('p', { class: 'small muted', text: t('siteReport.recipientsLead') }),
      chips,
      h('div', { class: 'add-row' }, add.wrap, addBtn),
      h('label', { class: 'field' }, h('span', { class: 'label', text: t('siteReport.language') }), langSel),
      h('div', null, saveBtn));

    // Send.
    const note = h('textarea', { class: 'textarea', id: 'sr-note', rows: 3, maxlength: data.noteMax, placeholder: t('siteReport.notePlaceholder') });
    const testBtn = button(t('siteReport.test'), { icon: 'envelope', small: true });
    const sendBtn = button(t('siteReport.send', { month: periodLabel(period) }), { variant: 'primary', icon: 'send' });
    const dirty = () => JSON.stringify(recipients) !== JSON.stringify(data.settings.recipients) || langSel.value !== data.settings.lang;
    testBtn.addEventListener('click', async () => {
      setBusy(testBtn, true, t('report.sending'));
      try { await api.post('/site-report/send', { period, note: note.value, test: true }); toast(t('siteReport.testSent', { email: data.ownerEmail })); }
      catch (err) { toast(errorText(err), { type: 'bad' }); }
      setBusy(testBtn, false);
    });
    sendBtn.addEventListener('click', async () => {
      if (dirty()) return toast(t('siteReport.saveFirst'), { type: 'warn' });
      const list = data.settings.recipients.length ? data.settings.recipients : [];
      const ok = await confirmDialog({
        title: t('siteReport.confirmTitle', { month: periodLabel(period) }),
        body: list.length ? t('siteReport.confirmBody', { list: list.join(', '), owner: data.ownerEmail }) : t('siteReport.confirmOnlyOwner', { owner: data.ownerEmail }),
        confirmLabel: t('siteReport.confirmSend'),
      });
      if (!ok) return;
      setBusy(sendBtn, true, t('report.sending'));
      try {
        await api.post('/site-report/send', { period, note: note.value });
        toast(t('siteReport.sentToast'));
        note.value = '';
        fill(body, loading());
        await load();
      } catch (err) { setBusy(sendBtn, false); toast(errorText(err), { type: 'bad' }); }
    });
    const sendCard = card('sr-send', t('siteReport.sendTitle'),
      h('label', { class: 'field' }, h('span', { class: 'label', text: t('siteReport.noteLabel') }), note,
        h('span', { class: 'hint', text: t('siteReport.noteHint') })),
      h('div', { class: 'row' }, sendBtn, testBtn));

    // History.
    const history = card('sr-hist', t('siteReport.historyTitle'), data.history.length
      ? h('ul', { class: 'status-list' }, data.history.map((x) => h('li', null,
        h('span', { class: x.status === 'sent' ? 'ok-text' : 'bad-text' }, icon(x.status === 'sent' ? 'check-circle-fill' : 'x-circle-fill')),
        h('div', { class: 'grow' }, h('div', { text: x.periodLabel + ' · ' + t('siteReport.status.' + x.status) }),
          h('div', { class: 'tiny muted break', text: [fmtDate(x.sentAt), x.sentBy, x.recipients.join(', ')].filter(Boolean).join(' · ') })))))
      : h('p', { class: 'muted', text: t('siteReport.noHistory') }));

    fill(body, statusBox, h('div', { class: 'dash-grid' },
      h('div', { class: 'stack-lg' }, previewCard),
      h('div', { class: 'stack-lg' }, recipientsCard, sendCard, history)));
    loadPreview();
  };
  await load();
  return { destroy: () => { alive = false; } };
}
