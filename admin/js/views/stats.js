/**
 * Estadísticas — visits to the public site, counted on this server without
 * cookies (see cms/src/Analytics.php), next to the contact-form messages they
 * turned into. Compared with the previous period of the same length.
 * Owner and accounts with the "leads" access; on/off is the owner's.
 */
import { h, icon, fill } from '../dom.js';
import { t, getLang, fmtDate } from '../i18n.js';
import { api } from '../api.js';
import { pageHead, loading, loadError, toast, errorText, alertBox, cardHead, switchInput } from '../ui.js';

const nf = () => new Intl.NumberFormat(getLang() === 'en' ? 'en-US' : 'es-GT');
const num = (n) => nf().format(n);
const dec = (n) => new Intl.NumberFormat(getLang() === 'en' ? 'en-US' : 'es-GT', { maximumFractionDigits: 1 }).format(n);
const pct = (part, total) => (total > 0 ? Math.round((100 * part) / total) : 0);
const SVG = 'http://www.w3.org/2000/svg';
/** Bar of a given width (CSSOM, allowed by the panel's CSP — inline style attributes are not). */
const barFill = (p) => h('span', { class: 'bar-fill', ref: (el) => { el.style.width = Math.max(2, p) + '%'; } });
const svg = (tag, attrs) => { const el = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };

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

/** Daily visitors as columns, with the numbers in a table for screen readers. */
function dailyChart(days) {
  const max = Math.max(1, ...days.map((d) => d.visitors));
  const w = 600; const hgt = 140; const gap = 2;
  const bw = (w - gap * (days.length - 1)) / days.length;
  const chart = svg('svg', { viewBox: `0 0 ${w} ${hgt}`, class: 'day-chart', role: 'img', 'aria-label': t('stats.dailyAria'), preserveAspectRatio: 'none' });
  days.forEach((d, i) => {
    const bh = Math.max(d.visitors ? 3 : 1, (d.visitors / max) * (hgt - 6));
    const r = svg('rect', { x: (i * (bw + gap)).toFixed(1), y: (hgt - bh).toFixed(1), width: bw.toFixed(1), height: bh.toFixed(1), rx: 2, class: d.visitors ? 'bar' : 'bar zero' });
    const tip = svg('title', {});
    tip.textContent = `${fmtDate(Date.parse(d.day + 'T12:00:00') / 1000, false)}: ${t('stats.visitorsN', { n: num(d.visitors) })}`;
    r.appendChild(tip);
    chart.appendChild(r);
  });
  const table = h('table', { class: 'sr-only' }, h('caption', { text: t('stats.dailyTitle') }),
    h('thead', null, h('tr', null, h('th', { text: t('stats.day') }), h('th', { text: t('stats.visitors') }), h('th', { text: t('stats.views') }))),
    h('tbody', null, days.map((d) => h('tr', null, h('td', { text: d.day }), h('td', { text: String(d.visitors) }), h('td', { text: String(d.views) })))));
  return h('div', { class: 'day-chart-wrap' }, chart,
    h('div', { class: 'row-between tiny muted', 'aria-hidden': 'true' }, h('span', { text: fmtDate(Date.parse(days[0].day + 'T12:00:00') / 1000, false) }), h('span', { text: fmtDate(Date.parse(days[days.length - 1].day + 'T12:00:00') / 1000, false) })),
    table);
}

export async function render({ main }) {
  const periodSel = h('select', { class: 'select', id: 'st-period', 'aria-label': t('stats.period') });
  main.append(pageHead({ title: t('stats.title'), lead: t('stats.lead'), actions: [periodSel] }));
  const body = h('div', { class: 'stack-lg' }, loading());
  main.append(body);
  let period = '30d';
  let alive = true;
  periodSel.addEventListener('change', () => { period = periodSel.value; load(); });

  const load = async () => {
    let d;
    try { d = await api.get('/stats?period=' + encodeURIComponent(period)); } catch (err) { fill(body, loadError(err, load)); return; }
    if (!alive) return;
    const monthName = (p) => new Intl.DateTimeFormat(getLang() === 'en' ? 'en-US' : 'es-GT', { month: 'long', year: 'numeric' }).format(new Date(p + '-15T12:00:00'));
    fill(periodSel, h('option', { value: '30d', text: t('stats.last30'), selected: period === '30d' || null }),
      d.months.map((m) => h('option', { value: m, text: monthName(m), selected: period === m || null })));

    const v = d.visits; const p = d.previous; const l = d.leads; const pl = d.previousLeads;
    const contactClicks = v.clicks.whatsapp + v.clicks.phone + v.clicks.email;
    const prevClicks = p.clicks.whatsapp + p.clicks.phone + p.clicks.email;
    const rate = v.visitors > 0 ? Math.round((1000 * (contactClicks + l.received)) / v.visitors) / 10 : 0;

    const off = !d.enabled ? alertBox('info', t('stats.offTitle'), t(d.canConfigure ? 'stats.offOwner' : 'stats.offOther')) : null;
    const noData = d.enabled && v.views === 0 ? alertBox('info', t('stats.noVisitsTitle'), t('stats.noVisitsBody')) : null;

    const kpis = h('div', { class: 'kpi-grid' },
      kpi(t('stats.visitors'), num(v.visitors), t('stats.viewsN', { n: num(v.views) }), trend(v.visitors, p.visitors)),
      kpi(t('stats.contactClicks'), num(contactClicks), t('stats.contactClicksNote'), trend(contactClicks, prevClicks)),
      kpi(t('stats.formMessages'), num(l.received), t('stats.formMessagesNote'), trend(l.received, pl.received)),
      kpi(t('stats.contactRate'), dec(rate) + (getLang() === 'en' ? '%' : ' %'), t('stats.contactRateNote'), null));

    const daily = h('section', { class: 'card', 'aria-labelledby': 'st-daily' },
      cardHead({ id: 'st-daily', icon: 'graph-up', title: t('stats.dailyTitle') }), dailyChart(v.days));

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
    const funnel = h('section', { class: 'card', 'aria-labelledby': 'st-leads' },
      cardHead({ id: 'st-leads', icon: 'inbox', title: t('stats.leadsTitle'), badge: h('a', { class: 'btn btn-sm btn-ghost', href: '#/prospectos' }, t('stats.openLeads'), icon('chevron-right')) }),
      l.received ? h('ol', { class: 'funnel' }, [['received', l.received], ['contacted', l.contacted + l.quoted + l.won], ['quoted', l.quoted + l.won], ['won', l.won]].map(([k, n]) => h('li', null,
        h('span', { class: 'funnel-num', text: num(n) }), h('span', { class: 'small', text: t('stats.funnel.' + k) }),
        h('span', { class: 'bar-track', 'aria-hidden': 'true' }, barFill(pct(n, l.received)))))) : h('p', { class: 'small muted', text: t('stats.noLeads') }),
      l.wonAmount > 0 ? h('p', { class: 'small', text: t('stats.wonAmount', { amount: 'Q ' + num(l.wonAmount) }) }) : null,
      l.avgResponseHours !== null ? h('p', { class: 'small muted', text: t('stats.responseTime', { h: dec(l.avgResponseHours) }) }) : null,
      Object.keys(l.byService).length ? h('div', { class: 'stack-sm' }, h('h3', { class: 'small strong', text: t('stats.byService') }), bars(l.byService, l.received)) : null);

    let settings = null;
    if (d.canConfigure) {
      const sw = switchInput({ id: 'st-on', checked: d.enabled });
      sw.input.addEventListener('change', async () => {
        sw.input.disabled = true;
        try { await api.put('/stats/settings', { enabled: sw.input.checked }); toast(t(sw.input.checked ? 'stats.turnedOn' : 'stats.turnedOff')); load(); }
        catch (err) { sw.input.checked = !sw.input.checked; toast(errorText(err), { type: 'bad' }); }
        sw.input.disabled = false;
      });
      settings = h('section', { class: 'card', 'aria-labelledby': 'st-set' },
        cardHead({ id: 'st-set', icon: 'shield-lock', title: t('stats.privacyTitle') }),
        h('div', { class: 'rule' }, sw.wrap, h('div', { class: 'grow' }, h('label', { for: 'st-on', text: t('stats.enabled') }), h('div', { class: 'small muted', text: t('stats.enabledHint') }))));
    }
    const privacy = h('details', { class: 'disclosure help-box' }, h('summary', null, t('stats.howTitle'), icon('chevron-down')),
      h('ul', null, ['how1', 'how2', 'how3', 'how4'].map((k) => h('li', { text: t('stats.' + k) }))));

    fill(body, off, noData, kpis, daily,
      h('div', { class: 'dash-grid' },
        h('div', { class: 'stack-lg' }, sources, clicks),
        h('div', { class: 'stack-lg' }, funnel, devices)),
      settings, privacy);
  };

  await load();
  return { destroy: () => { alive = false; } };
}
