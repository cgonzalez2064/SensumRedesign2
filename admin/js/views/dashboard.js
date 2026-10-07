/** Inicio — overview, quick actions, website health. */
import { h, icon, clear } from '../dom.js';
import { t, fmtRelative, fmtDate } from '../i18n.js';
import { api } from '../api.js';
import { pageHead, loading, loadError, alertBox, button, setBusy, toast, errorText } from '../ui.js';
import { openReportDialog } from '../report.js';

const INTRO_KEY = (id) => 'sensum_admin_intro_done_' + id;

export async function render({ main, session, isAdmin }) {
  const user = session.user;
  main.append(pageHead({ title: t('dashboard.hello', { name: user.name.split(' ')[0] }), lead: t('dashboard.lead') }), loading());
  const body = h('div', { class: 'stack-lg' });

  const load = async () => {
    let data;
    try {
      data = await api.get('/dashboard');
    } catch (err) {
      main.lastChild.replaceWith(loadError(err, () => { main.lastChild.replaceWith(loading()); load(); }));
      return;
    }
    clear(body);

    // First-use introduction (dismissible, remembered on this device).
    let introDone = false;
    try { introDone = localStorage.getItem(INTRO_KEY(user.id)) === '1'; } catch (e) { introDone = true; }
    if (!introDone) {
      const intro = h('section', { class: 'card intro-card', 'aria-labelledby': 'intro-title' },
        h('div', { class: 'card-header' }, h('h2', { id: 'intro-title', text: t('dashboard.introTitle') })),
        h('ol', { class: 'intro-steps' }, t('dashboard.introSteps').map((s) => h('li', null, h('span', { text: s })))),
        h('div', { class: 'row intro-actions' }, button(t('dashboard.introDismiss'), { variant: 'primary', small: true, onClick: () => {
          try { localStorage.setItem(INTRO_KEY(user.id), '1'); } catch (e) { /* ignore */ }
          intro.remove();
        } })));
      body.append(intro);
    }

    const quick = (href, ic, key, external) => h('a', { class: 'card card-link', href, target: external ? '_blank' : null, rel: external ? 'noopener' : null },
      h('span', { class: 'icon-tile' }, icon(ic)), h('span', null, h('strong', { text: t(`dashboard.quick.${key}`)[0] }), h('span', { text: t(`dashboard.quick.${key}`)[1] })));
    body.append(h('nav', { class: 'quick', 'aria-label': t('nav.main') },
      quick('#/textos', 'pencil-square', 'content'),
      quick('#/fotos', 'images', 'media'),
      quick('#/contacto', 'telephone', 'details'),
      quick(data.site.url + '/', 'box-arrow-up-right', 'site', true)));

    // Website status.
    const healthy = data.health.status === 'ok';
    const statusCard = h('section', { class: 'card', 'aria-labelledby': 'status-title' },
      h('div', { class: 'card-header' }, h('h2', { id: 'status-title', text: t('dashboard.siteStatus') }),
        h('span', { class: ['badge', healthy ? 'badge-ok' : 'badge-bad'] }, icon(healthy ? 'check-circle-fill' : 'exclamation-triangle-fill'), t(healthy ? 'dashboard.online' : 'dashboard.degraded'))),
      h('div', { class: 'stack-sm' },
        h('p', { class: 'muted', text: data.site.publishedAt
          ? t('dashboard.lastPublished', { when: fmtRelative(data.site.publishedAt) }) + (data.site.publishedBy ? ' · ' + t('common.by', { name: data.site.publishedBy }) : '')
          : t('dashboard.notPublishedYet') }),
        h('p', { class: 'small muted', text: t('dashboard.stats', { fields: data.stats.customizedFields, photos: data.stats.photos }) })));
    if (data.site.inSync === false) {
      const actions = [];
      if (isAdmin) {
        const btn = button(t('dashboard.republish'), { icon: 'arrow-repeat', small: true, variant: 'primary' });
        btn.addEventListener('click', async () => {
          setBusy(btn, true, t('common.saving'));
          try { await api.post('/site/republish'); toast(t('dashboard.republished')); load(); }
          catch (err) { setBusy(btn, false); toast(errorText(err), { type: 'bad' }); }
        });
        actions.push(btn);
      }
      statusCard.append(h('div', { class: 'stack-sm' }, alertBox('warn', null, t(isAdmin ? 'dashboard.outOfSync' : 'dashboard.outOfSyncEditor'), actions)));
    }
    if (data.reports.pending > 0) {
      statusCard.append(alertBox('warn', null, t('dashboard.reportsPending', { n: data.reports.pending }), [h('a', { class: 'btn btn-sm', href: '#/reportes' }, t('dashboard.viewReports'))]));
    }

    const left = h('div', { class: 'stack-lg' }, statusCard);
    const right = h('div', { class: 'stack-lg' });

    if (isAdmin) {
      // Recent activity.
      const acts = data.activity || [];
      left.append(h('section', { class: 'card', 'aria-labelledby': 'act-title' },
        h('div', { class: 'card-header' }, h('h2', { id: 'act-title', text: t('dashboard.activityTitle') })),
        acts.length ? h('ul', { class: 'status-list' }, acts.map((a) => h('li', null, icon('clock-history', 'muted'),
          h('div', { class: 'grow' }, h('span', null, h('strong', { text: a.user || t('dashboard.someone') }), ' ', t('dashboard.actions.' + a.action)),
            a.action === 'content_updated' && a.target ? h('span', { class: 'muted', text: ' — ' + (t('sections.' + a.target)[0] || a.target) }) : null,
            h('div', { class: 'tiny muted', text: fmtDate(a.at) }))))) : h('p', { class: 'muted', text: t('dashboard.noActivity') })));

      // Diagnostics.
      const checks = data.health.checks || {};
      right.append(h('section', { class: 'card', 'aria-labelledby': 'health-title' },
        h('div', { class: 'card-header' }, h('h2', { id: 'health-title', text: t('dashboard.healthTitle') })),
        h('ul', { class: 'status-list' }, Object.entries(checks).map(([k, c]) => {
          const cls = c.ok ? 'ok-text' : c.optional ? 'warn-text' : 'bad-text';
          return h('li', null, h('span', { class: cls }, icon(c.ok ? 'check-circle-fill' : c.optional ? 'exclamation-triangle-fill' : 'x-circle-fill')),
            h('div', { class: 'grow' }, h('div', { text: t('dashboard.checks.' + k) }), c.detail ? h('div', { class: 'tiny muted break', text: c.detail }) : null));
        }))));

      // Recent errors.
      const errs = data.errors || [];
      right.append(h('section', { class: 'card', 'aria-labelledby': 'err-title' },
        h('div', { class: 'card-header' }, h('h2', { id: 'err-title', text: t('dashboard.errorsTitle') })),
        errs.length ? h('ul', { class: 'status-list' }, errs.map((e) => h('li', null, h('span', { class: 'bad-text' }, icon('bug')),
          h('div', { class: 'grow' }, h('div', { class: 'break', text: e.message }),
            h('div', { class: 'tiny muted break', text: [t('dashboard.sources.' + e.source), e.page, t('dashboard.times', { n: e.count }), fmtRelative(e.lastSeen)].filter(Boolean).join(' · ') })))))
          : h('p', { class: 'muted', text: t('dashboard.noErrors') })));

      right.append(h('section', { class: 'card', 'aria-labelledby': 'tel-title' },
        h('div', { class: 'card-header' }, h('h2', { id: 'tel-title', text: t('dashboard.telemetryTitle') })),
        h('ul', { class: 'status-list' },
          h('li', null, icon('bar-chart', data.telemetry.analytics ? 'ok-text' : 'muted'), h('span', { text: t(data.telemetry.analytics ? 'dashboard.analyticsOn' : 'dashboard.analyticsOff') })),
          h('li', null, icon('activity', data.telemetry.publicErrors ? 'ok-text' : 'muted'), h('span', { text: t(data.telemetry.publicErrors ? 'dashboard.publicErrorsOn' : 'dashboard.publicErrorsOff') }))),
        h('p', { class: 'tiny muted', text: t('dashboard.telemetryHint') })));
    } else {
      right.append(h('section', { class: 'card' },
        h('div', { class: 'card-header' }, h('h2', { text: t('help.contactTitle') })),
        h('p', { class: 'muted', text: t('help.contactBody') }),
        button(t('topbar.report'), { icon: 'life-preserver', onClick: () => openReportDialog() })));
    }

    body.append(h('div', { class: 'dash-grid' }, left, right));
    main.lastChild.replaceWith(body);
  };
  await load();
}
