/**
 * "Tendencias" card shared by Monitoreo (owner) and Monitoreo del sitio
 * (summary access): response time with the days that had failed checks,
 * errors per day by severity and — owner only — sign-ins. 7, 30 or 90 days.
 */
import { h, fill } from './dom.js';
import { t, getLang } from './i18n.js';
import { api } from './api.js';
import { loading, loadError, cardHead, segmented } from './ui.js';
import { chart } from './charts.js';

const locale = () => (getLang() === 'en' ? 'en-US' : 'es-GT');
const asDate = (d) => new Date(d + 'T12:00:00');
const shortDay = (d) => new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(asDate(d));
const longDay = (d) => new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(asDate(d));
const num = (n) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(n);

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
    const response = chart({
      ...common, type: 'line', area: true, ariaLabel: t('monitor.trends.responseAria', { n: days }),
      series: [{ key: 'ms', label: t('monitor.trends.responseSeries'), values: d.map((x) => x.responseMs), tone: 'brand', format: (v) => num(v) + ' ms' }],
      yFormat: (v) => num(v) + ' ms',
      markers: { values: d.map((x) => x.availability !== null && x.availability < 100), label: (i) => t('monitor.trends.failedChecks', { pct: num(d[i].availability), n: d[i].checks - d[i].ok }) },
      empty: t('monitor.trends.noResponse'),
    });
    const errors = chart({
      ...common, type: 'bar', stacked: true, ariaLabel: t('monitor.trends.errorsAria', { n: days }),
      series: [
        { key: 'critical', label: t('monitor.severity.critical'), values: d.map((x) => x.critical), tone: 'bad', format: num },
        { key: 'error', label: t('monitor.severity.error'), values: d.map((x) => x.error), tone: 'warn', format: num },
        { key: 'warning', label: t('monitor.severity.warning'), values: d.map((x) => x.warning), tone: 'info', format: num },
      ],
      yFormat: (v) => num(v), empty: t('monitor.trends.noErrors'),
    });
    charts = [response, errors];
    const blocks = [
      h('div', { class: 'stack-sm' }, h('h3', { class: 'chart-title', text: t('monitor.trends.response') }), h('p', { class: 'tiny muted', text: t('monitor.trends.responseHint') }), response.el),
      h('div', { class: 'stack-sm' }, h('h3', { class: 'chart-title', text: t('monitor.trends.errors') }), errors.el),
    ];
    if (security && d.length && 'logins' in d[0]) {
      const logins = chart({
        ...common, type: 'line', ariaLabel: t('monitor.trends.loginsAria', { n: days }),
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
