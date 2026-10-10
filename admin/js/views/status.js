/**
 * Salud del sitio — the summary version of Monitoring for accounts with the
 * "monitor" access (and the owner): is the site working, uptime, speed,
 * incidents, error counts and key dates, with the same charts. No error
 * messages, settings or server details (those stay in the owner's Monitoreo).
 */
import { h, icon, fill } from '../dom.js';
import { t, tp, fmtDate, fmtRelative, getLang } from '../i18n.js';
import { api } from '../api.js';
import { pageHead, loading, loadError, button, alertBox, cardHead } from '../ui.js';
import { trendsCard, uptimeTiles, incidentsCard } from '../monitorCharts.js';

const num = (n, d = 1) => new Intl.NumberFormat(getLang() === 'en' ? 'en-US' : 'es-GT', { maximumFractionDigits: d }).format(n);

export async function render({ main, isOwner }) {
  const refresh = button(t('monitor.refresh'), { icon: 'arrow-repeat', small: true });
  main.append(pageHead({ title: t('status.title'), lead: t(isOwner ? 'status.leadOwner' : 'status.lead'), actions: [refresh] }));
  const body = h('div', { class: 'stack-lg' }, loading());
  main.append(body);
  let alive = true;
  let trends = null;

  const load = async () => {
    let d;
    try { d = await api.get('/monitor/overview'); } catch (err) { fill(body, loadError(err, load)); return; }
    if (!alive) return;
    const banner = {
      ok: alertBox('ok', t('status.okTitle'), t('status.okBody')),
      attention: alertBox('warn', t('status.attentionTitle'), t('status.attentionBody')),
      degraded: alertBox('bad', t('status.degradedTitle'), t('status.degradedBody')),
    }[d.status];

    const tile = (label, value, note, tone) => h('div', { class: ['kpi', tone && 'kpi-' + tone] },
      h('span', { class: 'kpi-label', text: label }), h('span', { class: 'kpi-num', text: value }), note ? h('span', { class: 'kpi-label', text: note }) : null);
    const e = d.errors7;
    const tiles = h('div', { class: 'kpi-grid' },
      tile(t('status.response'), d.responseMs7 === null ? '—' : num(d.responseMs7, 0) + ' ms', t('status.responseNote'), d.responseMs7 === null ? null : d.responseMs7 < 1500 ? 'ok' : 'warn'),
      tile(t('status.errors'), num(e.critical + e.error, 0), tp('status.criticalN', e.critical) + ' · ' + tp('status.warningN', e.warning), e.critical ? 'bad' : null),
      tile(t('status.lastCheck'), d.lastCheckAt ? fmtRelative(d.lastCheckAt) : t('status.never'), d.lastCheckAt ? fmtDate(d.lastCheckAt) : t('status.neverNote'), d.lastCheckAt && Date.now() / 1000 - d.lastCheckAt < 3600 ? 'ok' : 'warn'));

    const row = (ic, tone, label, value) => h('li', null, h('span', { class: tone + '-text' }, icon(ic)), h('div', { class: 'grow' }, h('div', { text: label }), h('div', { class: 'tiny muted', text: value })));
    const soon = (ts, days) => ts && ts - Date.now() / 1000 < days * 86400;
    const facts = h('section', { class: 'card', 'aria-labelledby': 'st-facts' },
      cardHead({ id: 'st-facts', icon: 'shield-lock', title: t('status.factsTitle') }),
      h('ul', { class: 'status-list' },
        row(d.inSync ? 'check-circle-fill' : 'exclamation-triangle-fill', d.inSync ? 'ok' : 'warn', t('status.published'), d.inSync ? (d.lastPublishedAt ? t('status.publishedAt', { when: fmtDate(d.lastPublishedAt) }) : t('status.inSync')) : t('status.outOfSync')),
        row(d.certificateUntil ? (soon(d.certificateUntil, 21) ? 'exclamation-triangle-fill' : 'check-circle-fill') : 'info-circle-fill', d.certificateUntil ? (soon(d.certificateUntil, 21) ? 'warn' : 'ok') : 'muted', t('status.certificate'), d.certificateUntil ? t('status.until', { date: fmtDate(d.certificateUntil, false) }) : t('status.unknown')),
        row(d.domainUntil ? (soon(d.domainUntil, 30) ? 'exclamation-triangle-fill' : 'check-circle-fill') : 'info-circle-fill', d.domainUntil ? (soon(d.domainUntil, 30) ? 'warn' : 'ok') : 'muted', t('status.domain'), d.domainUntil ? t('status.until', { date: fmtDate(d.domainUntil, false) }) : t('status.unknown')),
        row(d.emailDomainOk === null ? 'info-circle-fill' : d.emailDomainOk ? 'check-circle-fill' : 'exclamation-triangle-fill', d.emailDomainOk === null ? 'muted' : d.emailDomainOk ? 'ok' : 'warn', t('status.emailDomain'), d.emailDomainOk === null ? t('status.unknown') : t(d.emailDomainOk ? 'status.emailOk' : 'status.emailIssue')),
        row(d.lastBackupAt ? 'check-circle-fill' : 'exclamation-triangle-fill', d.lastBackupAt ? 'ok' : 'warn', t('status.backup'), d.lastBackupAt ? fmtDate(d.lastBackupAt) : t('status.noBackup')),
        row(d.offsiteBackupAt ? 'check-circle-fill' : 'info-circle-fill', d.offsiteBackupAt ? 'ok' : 'muted', t('status.offsite'), d.offsiteBackupAt ? fmtDate(d.offsiteBackupAt) : t('status.noOffsite')),
        d.pagespeedMobile !== null ? row('phone', d.pagespeedMobile >= 75 ? 'ok' : 'warn', t('status.google'), d.pagespeedMobile + '/100') : null));

    const help = h('section', { class: 'card', 'aria-labelledby': 'st-help' },
      cardHead({ id: 'st-help', icon: 'life-preserver', title: t('status.helpTitle'), lead: t('status.helpLead') }),
      h('div', null, button(t('topbar.report'), { icon: 'life-preserver', onClick: () => document.querySelector('.topbar .report-btn')?.click() })));

    if (trends) trends.destroy();
    trends = trendsCard({ security: false });
    fill(body, banner, h('section', { class: 'stack-sm', 'aria-labelledby': 'st-uptime' }, h('h2', { class: 'section-title', id: 'st-uptime', text: t('uptime.title') }), uptimeTiles(d.uptime)),
      tiles, trends.el, h('div', { class: 'dash-grid' }, h('div', { class: 'stack-lg' }, incidentsCard(d.incidents), help), facts));
  };
  refresh.addEventListener('click', () => { fill(body, loading()); load(); });
  await load();
  return { destroy: () => { alive = false; if (trends) trends.destroy(); } };
}
