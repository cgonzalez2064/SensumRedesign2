/** Monitoreo — system status, activity, alerts and the error log (owner account only). */
import { h, icon, clear } from '../dom.js';
import { t, fmtDate, fmtRelative, fmtBytes } from '../i18n.js';
import { api } from '../api.js';
import { pageHead, loading, loadError, button, setBusy, toast, errorText, emptyState, copyText } from '../ui.js';

const SEVERITY_BADGE = { critical: 'badge-bad', error: 'badge-warn', warning: 'badge-info' };
const SEVERITY_ICON = { critical: 'x-circle-fill', error: 'exclamation-triangle-fill', warning: 'info-circle-fill' };
const ALERT_BADGE = { sent: 'badge-ok', failed: 'badge-bad', suppressed: 'badge', off: 'badge' };

const eventLabel = (code) => {
  const label = t('monitor.events.' + code);
  return label === 'monitor.events.' + code ? code : label;
};

function card(id, title, ...children) {
  return h('section', { class: 'card', 'aria-labelledby': id }, h('div', { class: 'card-header' }, h('h2', { id, text: title })), ...children);
}

function kpi(value, label, tone) {
  return h('div', { class: ['kpi', tone && 'kpi-' + tone] }, h('span', { class: 'kpi-num', text: String(value) }), h('span', { class: 'kpi-label', text: label }));
}

function kv(rows, tight = false) {
  return h('dl', { class: ['kv', tight && 'kv-tight'] }, rows.filter(Boolean).map(([k, v]) => [h('dt', { text: k }), h('dd', null, v)]));
}

export async function render({ main, session }) {
  const refresh = button(t('monitor.refresh'), { icon: 'arrow-repeat', small: true });
  main.append(pageHead({ title: t('monitor.title'), lead: t('monitor.lead', { email: session.user.email }), actions: [refresh] }));
  const body = h('div', { class: 'stack-lg' }, loading());
  main.append(body);
  const filters = { severity: '', source: '', days: '30', q: '', page: 1 };
  let logBox = null;
  let alive = true;

  const loadLog = async () => {
    if (!logBox) return;
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== '' && v !== 0)).toString();
    clear(logBox).append(loading());
    let data;
    try { data = await api.get('/monitor/errors' + (qs ? '?' + qs : '')); } catch (err) { clear(logBox).append(loadError(err, loadLog)); return; }
    if (!alive) return;
    if (!data.items.length) {
      clear(logBox).append(emptyState('check2-circle', t('monitor.log.emptyTitle'), t('monitor.log.emptyBody')));
      return;
    }
    const pager = h('div', { class: 'row-between log-pager' },
      h('span', { class: 'small muted', 'aria-live': 'polite', text: t('monitor.log.page', { page: data.page, pages: data.pages, total: data.total }) }),
      h('div', { class: 'row' },
        button(t('monitor.log.newer'), { small: true, icon: 'arrow-left', attrs: { disabled: data.page <= 1 || null }, onClick: () => { filters.page = data.page - 1; loadLog(); } }),
        button(t('monitor.log.older'), { small: true, attrs: { disabled: data.page >= data.pages || null }, onClick: () => { filters.page = data.page + 1; loadLog(); } })));
    clear(logBox).append(h('ol', { class: 'log-list' }, data.items.map((e) => h('li', { class: 'log-item' },
      h('div', { class: 'row-between' },
        h('span', { class: ['badge', SEVERITY_BADGE[e.severity]] }, icon(SEVERITY_ICON[e.severity]), t('monitor.severity.' + e.severity)),
        h('span', { class: 'tiny muted', title: fmtDate(e.at), text: fmtRelative(e.at) })),
      h('strong', { class: 'break', text: eventLabel(e.event) }),
      e.message ? h('div', { class: 'small break log-message', text: e.message }) : null,
      h('div', { class: 'tiny muted break', text: [t('monitor.source.' + e.source), e.request, e.user, e.ref ? t('monitor.log.ref', { ref: e.ref }) : null].filter(Boolean).join(' · ') }),
      e.alert ? h('div', null, h('span', { class: ['badge', ALERT_BADGE[e.alert]] }, icon('envelope'), t('monitor.alertStatus.' + e.alert))) : null,
      h('details', { class: 'disclosure' }, h('summary', null, t('monitor.log.details'), icon('chevron-down')),
        kv([
          [t('monitor.log.when'), fmtDate(e.at)],
          [t('monitor.log.code'), h('code', { text: e.event })],
          e.location ? [t('monitor.log.location'), h('code', { class: 'break', text: e.location })] : null,
          e.request ? [t('monitor.log.request'), e.request] : null,
          e.ref ? [t('monitor.log.refLabel'), h('code', { text: e.ref })] : null,
          [t('monitor.log.user'), e.user || t('monitor.log.noUser')],
          ...Object.entries(e.details || {}).map(([k, v]) => [k, h('code', { class: 'break', text: typeof v === 'string' ? v : JSON.stringify(v) })]),
        ]))))), pager);
  };

  const select = (id, key, options) => {
    const el = h('select', { class: 'select', id }, options.map(([v, label]) => h('option', { value: v, text: label, selected: filters[key] === v || null })));
    el.addEventListener('change', () => { filters[key] = el.value; filters.page = 1; loadLog(); });
    return el;
  };

  const load = async () => {
    let data;
    try { data = await api.get('/monitor/summary'); } catch (err) { clear(body).append(loadError(err, load)); return; }
    if (!alive) return;
    const s = data.system;
    const c = data.counts;
    const healthy = data.health.status === 'ok';

    // Key figures.
    const tiles = h('div', { class: 'kpi-grid' },
      h('div', { class: ['kpi', healthy ? 'kpi-ok' : 'kpi-bad'] },
        h('span', { class: 'kpi-num' }, icon(healthy ? 'check-circle-fill' : 'exclamation-triangle-fill'), t(healthy ? 'monitor.healthy' : 'monitor.degraded')),
        h('span', { class: 'kpi-label', text: t('monitor.kpi.status') })),
      kpi(c['24h'].critical, t('monitor.kpi.critical24h'), c['24h'].critical ? 'bad' : null),
      kpi(c['7d'].critical + c['7d'].error, t('monitor.kpi.errors7d'), c['7d'].error ? 'warn' : null),
      kpi(s.lastCheckAt ? fmtRelative(s.lastCheckAt) : t('monitor.never'), t('monitor.kpi.lastCheck'), s.lastCheckAt ? null : 'warn'));

    // Error log with filters.
    const search = h('input', { class: 'input', type: 'search', id: 'log-q', placeholder: t('monitor.log.searchPlaceholder'), autocomplete: 'off' });
    let timer = null;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { filters.q = search.value.trim(); filters.page = 1; loadLog(); }, 400); });
    logBox = h('div', { 'aria-live': 'polite' });
    const logCard = card('log-title', t('monitor.log.title'),
      h('p', { class: 'small muted', text: t('monitor.log.lead') }),
      h('div', { class: 'log-filters', role: 'search', 'aria-label': t('monitor.log.filters') },
        h('label', { class: 'field' }, h('span', { class: 'label', text: t('monitor.log.severity') }), select('log-sev', 'severity', [['', t('monitor.log.all')], ['critical', t('monitor.severity.critical')], ['error', t('monitor.severity.error')], ['warning', t('monitor.severity.warning')]])),
        h('label', { class: 'field' }, h('span', { class: 'label', text: t('monitor.log.sourceLabel') }), select('log-src', 'source', [['', t('monitor.log.all')], ...['server', 'admin', 'public', 'system'].map((x) => [x, t('monitor.source.' + x)])])),
        h('label', { class: 'field' }, h('span', { class: 'label', text: t('monitor.log.period') }), select('log-days', 'days', [['1', t('monitor.period.1')], ['7', t('monitor.period.7')], ['30', t('monitor.period.30')], ['90', t('monitor.period.90')], ['', t('monitor.period.all')]])),
        h('label', { class: 'field log-search' }, h('span', { class: 'label', text: t('monitor.log.search') }), search)),
      logBox);

    // Diagnostics.
    const checks = card('diag-title', t('dashboard.healthTitle'), h('ul', { class: 'status-list' }, Object.entries(data.health.checks).map(([k, ch]) => {
      const cls = ch.ok ? 'ok-text' : ch.optional ? 'warn-text' : 'bad-text';
      return h('li', null, h('span', { class: cls }, icon(ch.ok ? 'check-circle-fill' : ch.optional ? 'exclamation-triangle-fill' : 'x-circle-fill')),
        h('div', { class: 'grow' }, h('div', { text: t('dashboard.checks.' + k) }), ch.detail ? h('div', { class: 'tiny muted break', text: ch.detail }) : null));
    })));

    // System.
    const system = card('sys-title', t('monitor.system.title'), kv([
      [t('monitor.system.version'), s.version],
      [t('monitor.system.php'), s.php],
      [t('monitor.system.env'), t(s.production ? 'monitor.system.production' : 'monitor.system.development')],
      [t('monitor.system.site'), h('span', { class: 'break', text: s.siteUrl })],
      [t('monitor.system.published'), s.lastPublishedAt ? fmtDate(s.lastPublishedAt) : t('monitor.never')],
      [t('monitor.system.inSync'), h('span', { class: s.inSync ? 'ok-text' : 'warn-text', text: t(s.inSync ? 'monitor.system.syncYes' : 'monitor.system.syncNo') })],
      [t('monitor.system.database'), fmtBytes(s.databaseBytes)],
      [t('monitor.system.disk'), s.diskFreeBytes === null ? '—' : fmtBytes(s.diskFreeBytes)],
      [t('monitor.system.uploads'), t('monitor.system.uploadsValue', { n: s.uploadsFiles, size: fmtBytes(s.uploadsBytes) })],
      [t('monitor.system.backup'), s.lastBackupAt ? fmtDate(s.lastBackupAt) : t('monitor.never')],
    ], true));

    // Alerts.
    const testBtn = button(t('monitor.alerts.test'), { icon: 'send', small: true });
    testBtn.addEventListener('click', async () => {
      setBusy(testBtn, true, t('report.sending'));
      try {
        const r = await api.post('/monitor/test-alert', {});
        toast(r.sent ? t('monitor.alerts.testSent', { to: r.recipient }) : t('monitor.alerts.testFailed'), { type: r.sent ? 'ok' : 'warn' });
      } catch (err) { toast(errorText(err), { type: 'bad' }); }
      setBusy(testBtn, false);
    });
    const a = data.alerts;
    const alerts = card('alert-title', t('monitor.alerts.title'),
      h('p', { class: 'small muted', text: t('monitor.alerts.lead') }),
      kv([
        [t('monitor.alerts.status'), h('span', { class: a.enabled ? 'ok-text' : 'warn-text', text: t(a.enabled ? 'monitor.alerts.on' : 'monitor.alerts.off') })],
        [t('monitor.alerts.recipient'), h('span', { class: 'break', text: a.recipient })],
        [t('monitor.alerts.limits'), t('monitor.alerts.limitsValue', { minutes: a.cooldownMinutes, max: a.dailyMax })],
        [t('monitor.alerts.last'), a.lastSentAt ? fmtDate(a.lastSentAt) : t('monitor.never')],
      ], true),
      a.enabled ? h('div', null, testBtn) : null);

    // Activity figures.
    const METRICS = ['critical', 'error', 'warning', 'alertsSent', 'emailsFailed', 'logins', 'loginsFailed', 'contentChanges', 'uploads', 'reports', 'reportsFailed'];
    const activity = card('act-title', t('monitor.activity.title'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table table-compact' },
        h('caption', { class: 'sr-only', text: t('monitor.activity.title') }),
        h('thead', null, h('tr', null, h('th', { scope: 'col', text: t('monitor.activity.metric') }), ['24h', '7d', '30d'].map((p) => h('th', { scope: 'col', class: 'num', text: t('monitor.activity.' + p) })))),
        h('tbody', null, METRICS.map((m) => h('tr', null, h('th', { scope: 'row', text: t('monitor.metrics.' + m) }), ['24h', '7d', '30d'].map((p) => h('td', { class: 'num', text: String(c[p][m]) }))))))));

    // Most frequent errors.
    const top = card('top-title', t('monitor.top.title'), data.top.length
      ? h('ul', { class: 'status-list' }, data.top.map((e) => h('li', null, h('span', { class: SEVERITY_BADGE[e.severity] === 'badge-bad' ? 'bad-text' : 'warn-text' }, icon(SEVERITY_ICON[e.severity])),
        h('div', { class: 'grow' }, h('div', { class: 'break', text: eventLabel(e.event) + (e.message ? ' — ' + e.message : '') }),
          h('div', { class: 'tiny muted', text: [t('monitor.source.' + e.source), t('dashboard.times', { n: e.count }), fmtRelative(e.lastSeen)].join(' · ') })))))
      : h('p', { class: 'muted', text: t('monitor.top.none') }));

    // External monitoring + scheduled check.
    const cron = 'php ~/sensum-cms/bin/console monitor > /dev/null 2>&1';
    const copyBtn = button(t('monitor.setup.copy'), { icon: 'clipboard', small: true, onClick: async () => { if (await copyText(cron)) toast(t('common.copied')); } });
    const setup = card('setup-title', t('monitor.setup.title'),
      h('p', { class: 'small', text: t('monitor.setup.uptime', { site: s.siteUrl, health: s.siteUrl + '/api/health' }) }),
      h('p', { class: 'small', text: t('monitor.setup.cron') }),
      h('div', { class: 'code-line' }, h('code', { class: 'break', text: cron }), copyBtn),
      h('p', { class: 'tiny muted', text: t('monitor.setup.cronHint') }));

    clear(body).append(tiles, h('div', { class: 'dash-grid' }, h('div', { class: 'stack-lg' }, logCard, activity), h('div', { class: 'stack-lg' }, checks, alerts, top, system, setup)));
    loadLog();
  };
  refresh.addEventListener('click', () => { clear(body).append(loading()); load(); });
  await load();
  return { destroy: () => { alive = false; } };
}
