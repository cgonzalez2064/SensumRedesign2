/** Reportes de soporte — minimal history of submitted reports, with retry. */
import { h, icon, clear } from '../dom.js';
import { t, fmtDate } from '../i18n.js';
import { api } from '../api.js';
import { pageHead, loading, loadError, emptyState, toast, errorText, setBusy, button } from '../ui.js';
import { openReportDialog } from '../report.js';

const TYPE_ICON = { problem: 'bug', improvement: 'lightbulb', content: 'card-text', design: 'palette', other: 'three-dots' };
const STATUS = { sent: ['badge-ok', 'check-circle-fill'], failed: ['badge-bad', 'exclamation-triangle-fill'], pending: ['badge-warn', 'hourglass-split'] };

export async function render({ main, isAdmin }) {
  const newBtn = button(t('reports.new'), { variant: 'primary', icon: 'life-preserver', onClick: () => openReportDialog() });
  main.append(pageHead({ title: t('reports.title'), lead: isAdmin ? t('reports.leadAdmin') : t('reports.lead'), actions: [newBtn] }));
  const body = h('div', null, loading());
  main.append(body);

  const load = async () => {
    let data;
    try { data = await api.get('/reports'); } catch (err) { clear(body).append(loadError(err, load)); return; }
    if (!data.reports.length) {
      clear(body).append(h('div', { class: 'card' }, emptyState('chat-square-text', t('reports.emptyTitle'), t('reports.emptyBody'),
        button(t('reports.new'), { icon: 'life-preserver', onClick: () => openReportDialog() }))));
      return;
    }
    clear(body).append(h('div', { class: 'list-cards' }, data.reports.map((r) => {
      const [cls, ic] = STATUS[r.emailStatus] || STATUS.pending;
      let retry = null;
      if (r.emailStatus !== 'sent') {
        retry = button(t('reports.retry'), { small: true, icon: 'arrow-repeat' });
        retry.addEventListener('click', async () => {
          setBusy(retry, true, t('report.sending'));
          try {
            const res = await api.postWithStatus(`/reports/${r.id}/retry`, {});
            toast(res.data.delivered ? t('reports.retried') : t('reports.retryFailed'), { type: res.data.delivered ? 'ok' : 'warn' });
            load();
          } catch (err) { setBusy(retry, false); toast(errorText(err), { type: 'bad' }); }
        });
      }
      return h('article', { class: 'card stack-sm' },
        h('div', { class: 'row-between' },
          h('div', { class: 'row' }, h('span', { class: 'icon-tile' }, icon(TYPE_ICON[r.type] || 'three-dots')),
            h('div', null, h('h2', { class: 'break', text: r.title }),
              h('div', { class: 'tiny muted', text: [t('report.types.' + r.type), fmtDate(r.createdAt), isAdmin ? t('reports.by', { name: r.reporterName }) : null].filter(Boolean).join(' · ') }))),
          h('span', { class: ['badge', cls] }, icon(ic), t('reports.status.' + r.emailStatus))),
        h('details', { class: 'disclosure' }, h('summary', null, t('reports.details'), icon('chevron-down')),
          h('div', { class: 'stack-sm' },
            h('div', { class: 'report-desc', text: r.description }),
            h('div', { class: 'tiny muted break', text: [t('report.areas.' + r.area), r.page ? t('reports.page', { page: r.page }) : null, r.hasScreenshot ? t('reports.withScreenshot') : null].filter(Boolean).join(' · ') }))),
        retry ? h('div', null, retry) : null);
    })));
  };
  await load();
}
