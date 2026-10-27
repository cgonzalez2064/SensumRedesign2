/**
 * Estadísticas — visits to the public site, counted on this server without
 * cookies (see cms/src/Analytics.php), next to the contact-form messages they
 * turned into. Compared with the previous period of the same length.
 * Filters: the period (presets, a month or from–to) and, for the messages, a
 * service. «Exportar» (spreadsheet, or print/PDF) and «Enviar por correo»
 * (cms/src/StatsReport.php) use the same filters.
 * Owner and accounts with the "stats" or "leads" access; on/off is the owner's.
 */
import { h, icon, fill, clear } from '../dom.js';
import { t, tp, getLang } from '../i18n.js';
import { api, download, saveBlob } from '../api.js';
import { pageHead, loading, loadError, toast, errorText, fieldErrorText, alertBox, cardHead, switchInput, button, dropdown, openDialog, textField, setBusy } from '../ui.js';
import { chart } from '../charts.js';

const nf = () => new Intl.NumberFormat(getLang() === 'en' ? 'en-US' : 'es-GT');
const num = (n) => nf().format(n);
const dec = (n) => new Intl.NumberFormat(getLang() === 'en' ? 'en-US' : 'es-GT', { maximumFractionDigits: 1 }).format(n);
const pct = (part, total) => (total > 0 ? Math.round((100 * part) / total) : 0);
/** Bar of a given width (CSSOM, allowed by the panel's CSP — inline style attributes are not). */
const barFill = (p) => h('span', { class: 'bar-fill', ref: (el) => { el.style.width = Math.max(2, p) + '%'; } });

/** "+15 %" / "-8 %" against the previous period, or null with nothing to compare. */
function trend(now, before, higherIsBetter = true) {
  if (!before) return null;
  const diff = Math.round((100 * (now - before)) / before);
  if (diff === 0) return h('span', { class: 'trend', text: '= ' + t('stats.same') });
  const good = (diff > 0) === higherIsBetter;
  return h('span', { class: ['trend', good ? 'trend-good' : 'trend-bad'] },
    h('span', { 'aria-hidden': 'true', text: diff > 0 ? '▲ ' : '▼ ' }),
    t('stats.vsPrevious', { change: (diff > 0 ? '+' : '−') + Math.abs(diff) + (getLang() === 'en' ? '%' : ' %') }));
}

function kpi(label, value, note, tr) {
  return h('div', { class: 'kpi' }, h('span', { class: 'kpi-label', text: label }), h('span', { class: 'kpi-num', text: value }),
    note ? h('span', { class: 'kpi-label', text: note }) : null, tr);
}

/** Labelled horizontal bars (sources, devices, services…). */
function bars(rows, total, { labelOf = (k) => k, empty = t('stats.noData') } = {}) {
  const entries = Object.entries(rows).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return h('p', { class: 'small muted', text: empty });
  return h('ul', { class: 'bar-list' }, entries.map(([k, n]) => h('li', null,
    h('div', { class: 'bar-head' }, h('span', { class: 'break', text: labelOf(k) }), h('span', { class: 'tiny muted', text: num(n) + ' · ' + pct(n, total) + (getLang() === 'en' ? '%' : ' %') })),
    h('div', { class: 'bar-track', 'aria-hidden': 'true' }, barFill(pct(n, total))))));
}

/** Daily visitors and page views: interactive chart (hover, touch, keyboard) with the data table. */
function dailyChart(days) {
  const locale = getLang() === 'en' ? 'en-US' : 'es-GT';
  const d = (x) => new Date(x + 'T12:00:00');
  return chart({
    type: 'line', area: true, integer: true, labels: days.map((x) => x.day), ariaLabel: t('stats.dailyAria'),
    xFormat: (x) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(d(x)),
    titleFormat: (x) => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(d(x)),
    series: [
      { key: 'visitors', label: t('stats.visitors'), values: days.map((x) => x.visitors), tone: 'brand', format: num },
      { key: 'views', label: t('stats.views'), values: days.map((x) => x.views), tone: 'info', format: num },
    ],
    yFormat: num, empty: t('stats.noData'),
  });
}

const PRESETS = ['7d', '30d', '90d', 'month'];
const locale = () => (getLang() === 'en' ? 'en-US' : 'es-GT');
const dayFmt = (unix) => new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(unix * 1000));
/** «27 sep 2026 – 26 oct 2026» (ends are exclusive on the server). */
const rangeText = (from, to) => dayFmt(from) + ' – ' + dayFmt(to - 1);
const isoDay = (unix) => { const d = new Date(unix * 1000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

export async function render({ main }) {
  // Filters: kept while the screen is open and sent with the export and the e-mail.
  const f = { period: '30d', from: '', to: '', service: '' };
  const periodSel = h('select', { class: 'select', id: 'st-period' });
  const fromIn = h('input', { class: 'input', type: 'date', id: 'st-from' });
  const toIn = h('input', { class: 'input', type: 'date', id: 'st-to' });
  const apply = button(t('stats.apply'), { small: true, variant: 'primary' });
  const customMsg = h('div', { class: 'stats-custom-msg', 'aria-live': 'polite' });
  const custom = h('div', { class: 'stats-custom no-print', hidden: true },
    h('div', { class: 'field' }, h('label', { class: 'label', for: 'st-from', text: t('stats.from') }), fromIn),
    h('div', { class: 'field' }, h('label', { class: 'label', for: 'st-to', text: t('stats.to') }), toIn),
    apply, customMsg);
  const exportBtn = h('button', { class: 'btn', type: 'button' }, icon('download'), h('span', { text: t('stats.export') }), icon('chevron-down'));
  const exportMenu = dropdown(exportBtn, (close) => [
    h('button', { class: 'menu-item', type: 'button', onclick: () => { close(); exportCsv(); } }, icon('card-text'),
      h('span', { class: 'menu-item-text' }, h('span', { text: t('stats.exportCsv') }), h('span', { class: 'tiny muted', text: t('stats.exportCsvHint') }))),
    h('button', { class: 'menu-item', type: 'button', onclick: () => { close(); window.print(); } }, icon('file-earmark-pdf'),
      h('span', { class: 'menu-item-text' }, h('span', { text: t('stats.exportPrint') }), h('span', { class: 'tiny muted', text: t('stats.exportPrintHint') }))),
  ]);
  const shareBtn = button(t('stats.share'), { icon: 'envelope', variant: 'primary' });
  const rangeLine = h('p', { class: 'small muted stats-range' });
  // One bar under the title: what to look at (left), what to do with it (right).
  const toolbar = h('div', { class: 'stats-toolbar no-print' },
    h('div', { class: 'stats-filter' }, h('label', { class: 'label', for: 'st-period', text: t('stats.period') }), periodSel),
    h('div', { class: 'stats-actions' }, exportMenu.el, shareBtn));
  main.append(pageHead({ title: t('stats.title'), lead: t('stats.lead') }), toolbar, custom, rangeLine);
  const body = h('div', { class: 'stack-lg' }, loading());
  main.append(body);
  let alive = true;
  let dayChart = null;
  let last = null;
  periodSel.addEventListener('change', () => {
    if (periodSel.value === 'custom') {
      custom.hidden = false;
      if (!fromIn.value && last) { fromIn.value = isoDay(last.from); toIn.value = isoDay(last.to - 1); }
      fromIn.focus();
      return;
    }
    custom.hidden = true;
    Object.assign(f, { period: periodSel.value, from: '', to: '' });
    load();
  });
  apply.addEventListener('click', () => {
    clear(customMsg);
    if (!fromIn.value || !toIn.value) { customMsg.append(alertBox('bad', null, t('stats.pickDates'))); return; }
    Object.assign(f, { period: 'custom', from: fromIn.value, to: toIn.value });
    load();
  });
  const query = () => new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '')).toString();

  const exportCsv = async () => {
    setBusy(exportBtn, true, t('stats.exporting'));
    try {
      const file = await download('/stats/export', { ...f, lang: getLang() });
      saveBlob(file.blob, file.filename);
      toast(t('stats.exported'));
    } catch (err) { toast(errorText(err), { type: 'bad' }); }
    setBusy(exportBtn, false);
  };

  shareBtn.addEventListener('click', () => { if (last) openShare(last, f); });

  const load = async () => {
    let d;
    try { d = await api.get('/stats?' + query()); } catch (err) {
      if (err.code === 'validation' && f.period === 'custom') {
        clear(customMsg);
        customMsg.append(alertBox('bad', null, fieldErrorText(Object.values(err.fields)[0])));
        return;
      }
      fill(body, loadError(err, load)); return;
    }
    if (!alive) return;
    last = d;
    clear(customMsg);
    const monthName = (p) => new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(new Date(p + '-15T12:00:00'));
    fill(periodSel,
      PRESETS.map((k) => h('option', { value: k, text: t('stats.presets.' + k), selected: d.period === k || null })),
      h('optgroup', { label: t('stats.byMonth') }, d.months.map((m) => h('option', { value: m, text: monthName(m), selected: d.period === m || null }))),
      h('option', { value: 'custom', text: t('stats.custom'), selected: d.period === 'custom' || null }));
    rangeLine.textContent = t('stats.rangeLine', { range: rangeText(d.from, d.to), previous: rangeText(d.prevFrom, d.prevTo) });

    const v = d.visits; const p = d.previous; const l = d.leads; const pl = d.previousLeads;
    const contactClicks = v.clicks.whatsapp + v.clicks.phone + v.clicks.email;
    const prevClicks = p.clicks.whatsapp + p.clicks.phone + p.clicks.email;
    // Basic version ("stats" access): visits only, no contact-form figures.
    const basic = !l;
    const rate = v.visitors > 0 ? Math.round((1000 * (contactClicks + (basic ? 0 : l.received))) / v.visitors) / 10 : 0;
    const mobile = Object.values(v.devices).reduce((a, b) => a + b, 0);

    const off = !d.enabled ? alertBox('info', t('stats.offTitle'), t(d.canConfigure ? 'stats.offOwner' : 'stats.offOther')) : null;
    const noData = d.enabled && v.views === 0 ? alertBox('info', t('stats.noVisitsTitle'), t('stats.noVisitsBody')) : null;

    const kpis = h('div', { class: 'kpi-grid' },
      kpi(t('stats.visitors'), num(v.visitors), basic ? t('stats.visitorsNote') : t('stats.viewsN', { n: num(v.views) }), trend(v.visitors, p.visitors)),
      kpi(t('stats.contactClicks'), num(contactClicks), t('stats.contactClicksNote'), trend(contactClicks, prevClicks)),
      basic ? kpi(t('stats.views'), num(v.views), t('stats.viewsPerVisit', { n: dec(v.visitors ? v.views / v.visitors : 0) }), trend(v.views, p.views))
        : kpi(t('stats.formMessages'), num(l.received), t('stats.formMessagesNote'), trend(l.received, pl.received)),
      basic ? kpi(t('stats.mobileShare'), (mobile ? Math.round((100 * (v.devices.mobile || 0)) / mobile) : 0) + (getLang() === 'en' ? '%' : ' %'), t('stats.mobileShareNote'), null)
        : kpi(t('stats.contactRate'), dec(rate) + (getLang() === 'en' ? '%' : ' %'), t('stats.contactRateNote'), null));

    if (dayChart) dayChart.destroy();
    dayChart = dailyChart(v.days);
    const daily = h('section', { class: 'card', 'aria-labelledby': 'st-daily' },
      cardHead({ id: 'st-daily', icon: 'graph-up', title: t('stats.dailyTitle') }), dayChart.el);

    const sources = h('section', { class: 'card', 'aria-labelledby': 'st-src' },
      cardHead({ id: 'st-src', icon: 'globe2', title: t('stats.sources'), lead: t('stats.sourcesLead') }),
      bars(v.sources, Object.values(v.sources).reduce((a, b) => a + b, 0), { labelOf: (k) => t('stats.source.' + k) }));
    const devices = h('section', { class: 'card', 'aria-labelledby': 'st-dev' },
      cardHead({ id: 'st-dev', icon: 'phone', title: t('stats.devices') }),
      bars(v.devices, Object.values(v.devices).reduce((a, b) => a + b, 0), { labelOf: (k) => t('stats.device.' + k) }),
      Object.keys(v.langs).length ? h('p', { class: 'small muted', text: t('stats.langs', { es: pct(v.langs.es || 0, (v.langs.es || 0) + (v.langs.en || 0)), en: pct(v.langs.en || 0, (v.langs.es || 0) + (v.langs.en || 0)) }) }) : null);
    const clicks = h('section', { class: 'card', 'aria-labelledby': 'st-clk' },
      cardHead({ id: 'st-clk', icon: 'whatsapp', title: t('stats.clicks'), lead: t('stats.clicksLead') }),
      bars(v.clicks, Math.max(1, Object.values(v.clicks).reduce((a, b) => a + b, 0)), { labelOf: (k) => t('stats.click.' + k), empty: t('stats.noClicks') }));
    // Messages for one service (only the contact-form figures change).
    const serviceSel = basic || !(d.services || []).length ? null : h('select', { class: 'select select-sm', id: 'st-service', 'aria-label': t('stats.service') },
      h('option', { value: '', text: t('stats.allServices') }), d.services.map((x) => h('option', { value: x, text: x, selected: d.service === x || null })));
    if (serviceSel) serviceSel.addEventListener('change', () => { f.service = serviceSel.value; load(); });
    const funnel = basic ? null : h('section', { class: 'card', 'aria-labelledby': 'st-leads' },
      cardHead({ id: 'st-leads', icon: 'inbox', title: t('stats.leadsTitle'), badge: h('a', { class: 'btn btn-sm btn-ghost no-print', href: '#/prospectos' }, t('stats.openLeads'), icon('chevron-right')) }),
      serviceSel ? h('div', { class: 'field stats-service no-print' }, h('label', { class: 'label', for: 'st-service', text: t('stats.service') }), serviceSel,
        h('span', { class: 'tiny muted', text: t('stats.serviceNote') })) : null,
      d.service ? h('p', { class: 'small strong print-only', text: t('stats.service') + ': ' + d.service }) : null,
      l.received ? h('ol', { class: 'funnel' }, [['received', l.received], ['contacted', l.contacted + l.quoted + l.won], ['quoted', l.quoted + l.won], ['won', l.won]].map(([k, n]) => h('li', null,
        h('span', { class: 'funnel-num', text: num(n) }), h('span', { class: 'small', text: t('stats.funnel.' + k) }),
        h('span', { class: 'bar-track', 'aria-hidden': 'true' }, barFill(pct(n, l.received)))))) : h('p', { class: 'small muted', text: t('stats.noLeads') }),
      l.wonAmount > 0 ? h('p', { class: 'small', text: t('stats.wonAmount', { amount: 'Q ' + num(l.wonAmount) }) }) : null,
      l.avgResponseHours !== null ? h('p', { class: 'small muted', text: t('stats.responseTime', { h: dec(l.avgResponseHours) }) }) : null,
      !d.service && Object.keys(l.byService).length ? h('div', { class: 'stack-sm' }, h('h3', { class: 'small strong', text: t('stats.byService') }), bars(l.byService, l.received)) : null);

    let settings = null;
    if (d.canConfigure) {
      const sw = switchInput({ id: 'st-on', checked: d.enabled });
      sw.input.addEventListener('change', async () => {
        sw.input.disabled = true;
        try { await api.put('/stats/settings', { enabled: sw.input.checked }); toast(t(sw.input.checked ? 'stats.turnedOn' : 'stats.turnedOff')); load(); }
        catch (err) { sw.input.checked = !sw.input.checked; toast(errorText(err), { type: 'bad' }); }
        sw.input.disabled = false;
      });
      settings = h('section', { class: 'card no-print', 'aria-labelledby': 'st-set' },
        cardHead({ id: 'st-set', icon: 'shield-lock', title: t('stats.privacyTitle') }),
        h('div', { class: 'rule' }, sw.wrap, h('div', { class: 'grow' }, h('label', { for: 'st-on', text: t('stats.enabled') }), h('div', { class: 'small muted', text: t('stats.enabledHint') }))));
    }
    const privacy = h('details', { class: 'disclosure help-box no-print' }, h('summary', null, t('stats.howTitle'), icon('chevron-down')),
      h('ul', null, ['how1', 'how2', 'how3', 'how4'].map((k) => h('li', { text: t('stats.' + k) }))));

    fill(body, off, noData, kpis, daily,
      h('div', { class: 'dash-grid' },
        h('div', { class: 'stack-lg' }, sources, clicks),
        h('div', { class: 'stack-lg' }, funnel, devices)),
      settings, privacy);
  };

  await load();
  return { destroy: () => { alive = false; if (dayChart) dayChart.destroy(); } };
}

/**
 * «Enviar por correo»: the report for the period on screen (and the service,
 * if one is chosen) to up to five addresses, with the spreadsheet attached.
 */
function openShare(d, f) {
  // Several addresses in one field (commas or spaces), so plain text with the e-mail keyboard.
  const to = textField({ label: t('stats.shareTo'), hint: t('stats.shareToHint'), inputmode: 'email', autocomplete: 'off', placeholder: 'nombre@empresa.com, otra@empresa.com' });
  const parts = ['dailyTitle', 'sources', 'clicks', 'devices', ...(d.leads ? ['leadsTitle'] : [])];
  const keyOf = { dailyTitle: 'daily', sources: 'sources', clicks: 'clicks', devices: 'devices', leadsTitle: 'leads' };
  const boxes = parts.map((k) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: keyOf[k], checked: true }), h('span', { text: t('stats.' + k) })));
  const message = textField({ label: t('stats.shareMessage'), hint: t('stats.shareMessageHint'), multiline: true, rows: 3, max: 500, maxlength: 500, optionalTag: true });
  const copy = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true }), h('span', { text: t('stats.shareCopy') }));
  const langSel = h('select', { class: 'select', id: 'st-share-lang' }, h('option', { value: 'es', text: 'Español', selected: getLang() === 'es' || null }), h('option', { value: 'en', text: 'English', selected: getLang() === 'en' || null }));
  const msg = h('div', { 'aria-live': 'polite' });
  const form = h('form', { class: 'stack', novalidate: true },
    h('div', { class: 'share-period' }, icon('graph-up'), h('div', null, h('strong', { text: rangeText(d.from, d.to) }),
      h('span', { class: 'tiny muted', text: [t('stats.rangeCompared', { previous: rangeText(d.prevFrom, d.prevTo) }), d.service ? t('stats.service') + ': ' + d.service : null].filter(Boolean).join(' · ') }))),
    to.wrap,
    h('fieldset', { class: 'field fieldset-reset' }, h('legend', { class: 'label', text: t('stats.shareInclude') }),
      h('p', { class: 'tiny muted', text: t('stats.shareSummary') }), h('div', { class: 'checks share-checks' }, boxes)),
    message.wrap,
    h('div', { class: 'field' }, h('label', { class: 'label', for: 'st-share-lang', text: t('stats.shareLang') }), langSel),
    copy, msg);
  const dlg = openDialog({
    title: t('stats.shareTitle'), lead: t('stats.shareLead'), labelledIcon: 'envelope', body: form, wide: true,
    actions: [
      { label: t('common.cancel'), onClick: (b, close) => close() },
      { label: t('stats.shareSend'), variant: 'primary', icon: 'send', onClick: () => form.requestSubmit() },
    ],
  });
  setTimeout(() => to.input.focus(), 60);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(msg);
    to.setError(null);
    const recipients = to.input.value.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    const copyMe = copy.firstChild.checked;
    if (!recipients.length && !copyMe) { to.setError(fieldErrorText('required')); to.input.focus(); return; }
    if (recipients.length > 5) { to.setError(fieldErrorText('too_many_recipients')); to.input.focus(); return; }
    const sections = boxes.filter((b) => b.firstChild.checked).map((b) => b.firstChild.value);
    const btn = dlg.foot.lastChild;
    setBusy(btn, true, t('stats.shareSending'));
    try {
      const r = await api.post('/stats/share', { ...f, recipients, copyMe, sections, message: message.input.value.trim(), lang: langSel.value });
      dlg.close();
      toast(r.failed ? t('stats.sharedPartial', { sent: r.sent, failed: r.failed }) : tp('stats.shared', r.sent));
    } catch (err) {
      setBusy(btn, false);
      if (err.code === 'validation' && err.fields.recipients) { to.setError(fieldErrorText(err.fields.recipients)); to.input.focus(); return; }
      msg.append(alertBox('bad', null, err.code === 'validation' ? fieldErrorText(Object.values(err.fields)[0]) : errorText(err, { preserved: true })));
    }
  });
}
