/**
 * Charts shared by Monitoreo (owner) and Salud del sitio ("monitor" access):
 * uptime figures and daily availability, response time with the days that
 * had failed checks, errors per day by severity, incidents and — owner only —
 * sign-ins. 7, 30 or 90 days.
 */
import { h, fill, icon } from './dom.js';
import { t, tp, getLang, fmtDate } from './i18n.js';
import { api } from './api.js';
import { loading, loadError, cardHead, segmented } from './ui.js';
import { chart } from './charts.js';

const locale = () => (getLang() === 'en' ? 'en-US' : 'es-GT');
const asDate = (d) => new Date(d + 'T12:00:00');
const shortDay = (d) => new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(asDate(d));
const longDay = (d) => new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(asDate(d));
const num = (n) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(n);
const pct = (n) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(n) + (getLang() === 'en' ? '%' : ' %');

/** Uptime for 24 h, 7, 30 and 90 days, coloured by how good it is. */
export function uptimeTiles(uptime) {
  const tone = (p) => (p === null ? null : p >= 99.9 ? 'ok' : p >= 99 ? 'warn' : 'bad');
  return h('div', { class: 'kpi-grid uptime-tiles' }, ['24h', '7d', '30d', '90d'].map((k) => {
    const u = uptime[k];
    return h('div', { class: ['kpi', tone(u.pct) && 'kpi-' + tone(u.pct)] },
      h('span', { class: 'kpi-label', text: t('uptime.window.' + k) }),
      h('span', { class: 'kpi-num', text: u.pct === null ? '—' : pct(u.pct) }),
      h('span', { class: 'kpi-label', text: u.checks ? (u.failed ? tp('uptime.failedN', u.failed, { total: num(u.checks) }) : t('uptime.allOk', { total: num(u.checks) })) : t('uptime.noChecks') }));
  }));
}

/** Periods when the scheduled checks failed (owner: which checks). */
export function incidentsCard(list, { details = false } = {}) {
  const time = (ts) => new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(ts * 1000));
  const dur = (m) => (m < 60 ? t('uptime.minutes', { n: m }) : m < 2880 ? t('uptime.hours', { n: num(m / 60) }) : t('uptime.days', { n: Math.round(m / 1440) }));
  return h('section', { class: 'card', 'aria-labelledby': 'inc-title' },
    h('div', { class: 'card-head' }, h('span', { class: ['icon-tile', list.length ? 'warn' : 'ok'] }, icon(list.length ? 'exclamation-triangle-fill' : 'check-circle-fill')),
      h('div', { class: 'grow' }, h('h2', { id: 'inc-title', text: t('uptime.incidentsTitle') }), h('p', { text: t('uptime.incidentsLead') }))),
    list.length ? h('ul', { class: 'status-list incident-list' }, list.map((i) => h('li', null,
      h('span', { class: i.ongoing ? 'bad-text' : 'warn-text' }, icon(i.ongoing ? 'x-circle-fill' : 'exclamation-triangle-fill')),
      h('div', { class: 'grow' },
        h('div', null, h('strong', { text: fmtDate(i.start, false) + ', ' + time(i.start) + ' – ' + (i.ongoing ? t('uptime.now') : time(i.end)) }),
          i.ongoing ? h('span', { class: 'badge badge-bad', text: t('uptime.ongoing') }) : null),
        h('div', { class: 'tiny muted', text: [dur(i.minutes), tp('uptime.checksN', i.checks), details && i.failed && i.failed.length ? t('uptime.failedChecks', { list: i.failed.join(', ') }) : null].filter(Boolean).join(' · ') })))))
      : h('p', { class: 'small muted', text: t('uptime.noIncidents') }));
}

export function trendsCard({ security = false } = {}) {
  let days = 30;
  let charts = [];
  const box = h('div', { 'aria-live': 'polite' }, loading());
  const range = segmented([7, 30, 90].map((d) => ({ value: String(d), label: t('charts.days', { n: d }) })), String(days), (v) => { days = Number(v); load(); }, t('charts.range'));

  const load = async () => {
    let data;
    try { data = await api.get('/monitor/series?days=' + days); } catch (err) { fill(box, loadError(err, load)); return; }
    charts.forEach((c) => c.destroy());
    const d = data.days;
    const labels = d.map((x) => x.day);
    const common = { labels, xFormat: shortDay, titleFormat: longDay };
    // Daily availability, coloured by how good the day was (status-page style).
    const band = (x, lo, hi) => (x.availability !== null && x.availability >= lo && x.availability < hi ? x.availability : null);
    const uptimeChart = chart({
      ...common, type: 'bar', stacked: true, yMax: 100, tipSkipEmpty: true, ariaLabel: t('uptime.chartAria', { n: days }),
      series: [
        { key: 'full', label: t('uptime.bandFull'), values: d.map((x) => band(x, 99.9, 101)), tone: 'ok', format: pct },
        { key: 'minor', label: t('uptime.bandMinor'), values: d.map((x) => band(x, 99, 99.9)), tone: 'warn', format: pct },
        { key: 'major', label: t('uptime.bandMajor'), values: d.map((x) => band(x, 0, 99)), tone: 'bad', format: pct },
      ],
      yFormat: (v) => num(v) + (getLang() === 'en' ? '%' : ' %'), empty: t('uptime.noChecks'),
    });
    const response = chart({
      ...common, type: 'line', area: true, ariaLabel: t('monitor.trends.responseAria', { n: days }),
      series: [{ key: 'ms', label: t('monitor.trends.responseSeries'), values: d.map((x) => x.responseMs), tone: 'brand', format: (v) => num(v) + ' ms' }],
      yFormat: (v) => num(v) + ' ms',
      markers: { values: d.map((x) => x.availability !== null && x.availability < 100), label: (i) => t('monitor.trends.failedChecks', { pct: num(d[i].availability), n: d[i].checks - d[i].ok }) },
      empty: t('monitor.trends.noResponse'),
    });
    const errors = chart({
      ...common, type: 'bar', stacked: true, integer: true, ariaLabel: t('monitor.trends.errorsAria', { n: days }),
      series: [
        { key: 'critical', label: t('monitor.severity.critical'), values: d.map((x) => x.critical), tone: 'bad', format: num },
        { key: 'error', label: t('monitor.severity.error'), values: d.map((x) => x.error), tone: 'warn', format: num },
        { key: 'warning', label: t('monitor.severity.warning'), values: d.map((x) => x.warning), tone: 'info', format: num },
      ],
      yFormat: (v) => num(v), empty: t('monitor.trends.noErrors'),
    });
    charts = [uptimeChart, response, errors];
    const blocks = [
      h('div', { class: 'stack-sm' }, h('h3', { class: 'chart-title', text: t('uptime.chartTitle') }), h('p', { class: 'tiny muted', text: t('uptime.chartHint') }), uptimeChart.el),
      h('div', { class: 'stack-sm' }, h('h3', { class: 'chart-title', text: t('monitor.trends.response') }), h('p', { class: 'tiny muted', text: t('monitor.trends.responseHint') }), response.el),
      h('div', { class: 'stack-sm' }, h('h3', { class: 'chart-title', text: t('monitor.trends.errors') }), errors.el),
    ];
    if (security && d.length && 'logins' in d[0]) {
      const logins = chart({
        ...common, type: 'line', integer: true, ariaLabel: t('monitor.trends.loginsAria', { n: days }),
        series: [
          { key: 'logins', label: t('monitor.trends.loginsOk'), values: d.map((x) => x.logins), tone: 'ok', format: num },
          { key: 'failed', label: t('monitor.trends.loginsFailed'), values: d.map((x) => x.loginsFailed), tone: 'bad', format: num },
        ],
        yFormat: (v) => num(v),
      });
      charts.push(logins);
      blocks.push(h('div', { class: 'stack-sm' }, h('h3', { class: 'chart-title', text: t('monitor.trends.logins') }), logins.el));
    }
    fill(box, h('div', { class: 'chart-cards' }, blocks));
  };
  load();
  const el = h('section', { class: 'card', 'aria-labelledby': 'trends-title' },
    h('div', { class: 'range-row' }, cardHead({ id: 'trends-title', icon: 'graph-up', title: t('monitor.trends.title'), lead: t('monitor.trends.lead') }), range),
    box);
  return { el, destroy: () => charts.forEach((c) => c.destroy()) };
}
