/**
 * Reportes de soporte — tickets.
 *  - Everyone: their own reports, their status and the conversation with IT;
 *    they can answer (which reopens a ticket waiting for information or resolved).
 *  - Owner (IT): every ticket, filters and search, and on each ticket: status
 *    changes with an optional e-mail to the person, priority, edits, public
 *    replies and internal notes.
 */
import { h, icon, fill, initials } from '../dom.js';
import { t, fmtDate, fmtRelative } from '../i18n.js';
import { api } from '../api.js';
import { pageHead, loading, loadError, emptyState, toast, errorText, setBusy, button, openDialog, textField, fieldErrorText, alertBox, cardHead } from '../ui.js';
import { openReportDialog } from '../report.js';
import { refreshReportsBadge } from '../app.js';

const TYPE_ICON = { problem: 'bug', improvement: 'lightbulb', content: 'card-text', design: 'palette', other: 'three-dots' };
const STATUS_BADGE = { new: 'badge-brand', in_progress: 'badge-info', waiting: 'badge-warn', resolved: 'badge-ok', closed: '' };
const STATUS_ICON = { new: 'bell', in_progress: 'arrow-repeat', waiting: 'hourglass-split', resolved: 'check-circle-fill', closed: 'lock' };
const PRIORITY_BADGE = { low: '', normal: '', high: 'badge-warn', urgent: 'badge-bad' };
const FILTERS = ['open', 'new', 'in_progress', 'waiting', 'resolved', 'closed', 'all'];

const statusBadge = (s) => h('span', { class: ['badge', STATUS_BADGE[s]] }, icon(STATUS_ICON[s]), t('tickets.status.' + s));
const priorityBadge = (p, always = false) => (p === 'normal' && !always ? null
  : h('span', { class: ['badge', PRIORITY_BADGE[p]] }, p === 'urgent' || p === 'high' ? icon('exclamation-triangle-fill') : null, t('tickets.priority.' + p)));

// ------------------------------------------------------------------ list

export async function render({ main, isOwner }) {
  const newBtn = button(t('reports.new'), { variant: 'primary', icon: 'life-preserver', onClick: () => openReportDialog() });
  main.append(pageHead({ title: t('reports.title'), lead: isOwner ? t('tickets.leadOwner') : t('reports.lead'), actions: [newBtn] }));
  const body = h('div', { class: 'stack' }, loading());
  main.append(body);
  let filter = 'open';
  let q = '';
  let alive = true;
  let timer = null;

  const search = h('input', { class: 'input', type: 'search', placeholder: t('tickets.search'), 'aria-label': t('tickets.search'), autocomplete: 'off' });
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { q = search.value.trim(); load(); }, 300); });
  const tabs = h('div', { class: 'filter-tabs', role: 'group', 'aria-label': t('tickets.filterLabel') });
  const listBox = h('div', { 'aria-live': 'polite' });

  const load = async () => {
    let data;
    try {
      const qs = new URLSearchParams(isOwner ? { status: filter, ...(q ? { q } : {}) } : {}).toString();
      data = await api.get('/reports' + (qs ? '?' + qs : ''));
    } catch (err) { fill(listBox, loadError(err, load)); return; }
    if (!alive) return;
    if (isOwner) {
      fill(tabs, FILTERS.map((f) => h('button', {
        type: 'button', class: 'filter-tab', 'aria-pressed': String(f === filter),
        onclick: () => { filter = f; load(); },
      }, t('tickets.filter.' + f), h('span', { class: 'count', text: String(data.counts[f] ?? 0) }))));
    }
    if (!data.reports.length) {
      fill(listBox, h('div', { class: 'card' }, q || (isOwner && filter !== 'all')
        ? emptyState('check2-circle', t('tickets.emptyFilterTitle'), t('tickets.emptyFilterBody'))
        : emptyState('chat-square-text', t('reports.emptyTitle'), t('reports.emptyBody'), button(t('reports.new'), { icon: 'life-preserver', onClick: () => openReportDialog() }))));
      return;
    }
    fill(listBox, h('ul', { class: 'ticket-list' }, data.reports.map((r) => h('li', null,
      h('a', { class: ['ticket-row', r.unread && 'unread'], href: '#/reportes/' + r.id },
        h('span', { class: 'icon-tile' }, icon(TYPE_ICON[r.type] || 'three-dots')),
        h('span', { class: 'grow ticket-main' },
          h('span', { class: 'ticket-title' }, r.unread ? h('span', { class: 'unread-dot', title: t(isOwner ? 'tickets.unreadOwner' : 'tickets.unreadReporter') }, h('span', { class: 'sr-only', text: t(isOwner ? 'tickets.unreadOwner' : 'tickets.unreadReporter') })) : null, h('span', { class: 'break', text: r.title })),
          h('span', { class: 'tiny muted', text: ['#' + r.id, isOwner ? r.reporterName : null, t('report.types.' + r.type), t('tickets.updated', { when: fmtRelative(r.updatedAt) })].filter(Boolean).join(' · ') })),
        h('span', { class: 'ticket-badges' }, isOwner ? priorityBadge(r.priority) : null, statusBadge(r.status)),
        icon('chevron-right', 'ticket-chevron'))))));
  };

  fill(body, isOwner ? h('div', { class: 'ticket-toolbar' }, tabs, h('div', { class: 'ticket-search' }, search)) : null, listBox);
  listBox.append(loading());
  await load();
  return { destroy: () => { alive = false; clearTimeout(timer); } };
}

// ------------------------------------------------------------------ one ticket

export async function detail({ main, params, isOwner }) {
  const id = Number(params[0]);
  const body = h('div', null, loading());
  main.append(pageHead({ crumbs: [{ label: t('reports.title'), href: '#/reportes' }, { label: '#' + id }], title: t('tickets.loadingTitle') }), body);
  let alive = true;
  let draftDirty = () => false;

  const load = async () => {
    let data;
    try { data = await api.get('/reports/' + id); } catch (err) {
      if (err.status === 404) { fill(body, h('div', { class: 'card' }, emptyState('exclamation-circle', t('tickets.notFoundTitle'), t('tickets.notFoundBody'), h('a', { class: 'btn', href: '#/reportes' }, t('tickets.backToList'))))); return; }
      fill(body, loadError(err, load)); return;
    }
    if (!alive) return;
    draw(data);
    refreshReportsBadge();
  };

  const draw = ({ report: r, messages, canManage, canReply }) => {
    const h1 = main.querySelector('.page-head h1');
    h1.textContent = r.title;
    document.title = '#' + r.id + ' ' + r.title + ' · ' + t('app.name');

    // Summary under the title.
    const summary = h('div', { class: 'ticket-summary' },
      statusBadge(r.status), priorityBadge(r.priority, canManage),
      h('span', { class: 'badge' }, icon(TYPE_ICON[r.type] || 'three-dots'), t('report.types.' + r.type)),
      h('span', { class: 'tiny muted', text: [t('report.areas.' + r.area), t('tickets.created', { when: fmtDate(r.createdAt) })].join(' · ') }));

    // Status guidance for the person who reported it.
    const guidance = !canManage ? {
      waiting: alertBox('warn', t('tickets.guide.waitingTitle'), t('tickets.guide.waiting')),
      resolved: alertBox('ok', t('tickets.guide.resolvedTitle'), t('tickets.guide.resolved')),
      closed: alertBox('info', t('tickets.guide.closedTitle'), t('tickets.guide.closed'), [button(t('reports.new'), { small: true, icon: 'life-preserver', onClick: () => openReportDialog() })]),
      new: alertBox('info', null, t('tickets.guide.new')),
      in_progress: alertBox('info', null, t('tickets.guide.inProgress')),
    }[r.status] : null;

    // Original report.
    const original = h('section', { class: 'card', 'aria-labelledby': 'tk-desc' },
      cardHead({ id: 'tk-desc', icon: 'card-text', title: t('tickets.description'), lead: [r.reporterName, fmtDate(r.createdAt)].join(' · ') }),
      h('div', { class: 'report-desc', text: r.description }),
      r.page ? h('p', { class: 'tiny muted break', text: t('reports.page', { page: r.page }) }) : null,
      r.hasScreenshot ? h('a', { class: 'ticket-shot', href: '../api/reports/' + r.id + '/screenshot', target: '_blank', rel: 'noopener' },
        h('img', { src: '../api/reports/' + r.id + '/screenshot', alt: t('tickets.screenshotAlt'), loading: 'lazy' }),
        h('span', { class: 'tiny' }, icon('box-arrow-up-right'), ' ', t('tickets.openScreenshot'))) : null);

    // Conversation.
    const timeline = h('ol', { class: 'timeline', 'aria-label': t('tickets.conversation') }, messages.length
      ? messages.map((m) => timelineItem(m, canManage))
      : h('li', { class: 'timeline-empty muted small', text: t(canManage ? 'tickets.noMessagesOwner' : 'tickets.noMessages') }));

    // Composer.
    let composer = null;
    if (canReply) {
      const text = textField({ label: t(canManage ? 'tickets.replyLabelOwner' : 'tickets.replyLabel'), multiline: true, rows: 4, max: 4000, placeholder: t(r.status === 'waiting' && !canManage ? 'tickets.replyPlaceholderWaiting' : 'tickets.replyPlaceholder') });
      draftDirty = () => text.input.value.trim() !== '';
      let internal = false;
      const notify = h('input', { type: 'checkbox', id: 'tk-notify', checked: true });
      const notifyRow = canManage ? h('label', { class: 'check', for: 'tk-notify' }, notify, h('span', { text: t('tickets.notify', { name: r.reporterName.split(' ')[0] }) })) : null;
      const modeTabs = canManage ? h('div', { class: 'segmented', role: 'group', 'aria-label': t('tickets.mode') },
        ...['reply', 'note'].map((mode) => h('button', { type: 'button', 'aria-pressed': String(mode === 'reply'), onclick: (e) => {
          internal = mode === 'note';
          for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
          composerCard.classList.toggle('is-note', internal);
          if (notifyRow) notifyRow.hidden = internal;
          send.lastChild.textContent = t(internal ? 'tickets.saveNote' : 'tickets.send');
          text.label.lastChild.textContent = t(internal ? 'tickets.noteLabel' : 'tickets.replyLabelOwner');
        } }, icon(mode === 'reply' ? 'chat-square-text' : 'lock'), t('tickets.mode_' + mode)))) : null;
      const send = button(t('tickets.send'), { variant: 'primary', icon: 'send' });
      send.addEventListener('click', async () => {
        const v = text.input.value.trim();
        if (!v) { text.setError(fieldErrorText('required')); text.input.focus(); return; }
        text.setError(null);
        setBusy(send, true, t('report.sending'));
        try {
          const res = await api.post('/reports/' + id + '/messages', { body: v, internal, notify: canManage ? notify.checked : true });
          text.input.value = '';
          toast(t(internal ? 'tickets.noteSaved' : (canManage ? (notify.checked ? emailedText(res) : 'tickets.replySaved') : 'tickets.replySent')), { type: emailFailed(res) ? 'warn' : 'ok' });
          draw(res);
          refreshReportsBadge();
          return;
        } catch (err) {
          if (err.code === 'validation') text.setError(fieldErrorText(err.fields.body, { max: 4000 }));
          else toast(errorText(err, { preserved: true }), { type: 'bad' });
        }
        setBusy(send, false);
      });
      const composerCard = h('section', { class: 'card composer', 'aria-label': t('tickets.composer') },
        modeTabs, text.wrap, h('div', { class: 'row-between' }, notifyRow || h('span'), send));
      composer = composerCard;
    }

    // Side: actions (owner) and details.
    const side = [];
    if (canManage) {
      side.push(actionsCard(r, (res) => { draw(res); refreshReportsBadge(); }));
      side.push(h('section', { class: 'card', 'aria-labelledby': 'tk-who' },
        cardHead({ id: 'tk-who', icon: 'person-circle', title: t('tickets.reporter') }),
        h('div', { class: 'row' }, h('span', { class: 'avatar', 'aria-hidden': 'true', text: initials(r.reporterName) }),
          h('div', { class: 'grow' }, h('strong', { text: r.reporterName }), h('div', null, h('a', { class: 'small break', href: 'mailto:' + r.reporterEmail, text: r.reporterEmail })))),
        h('dl', { class: 'kv kv-tight' },
          h('dt', { text: t('tickets.emailToSupport') }), h('dd', null, h('span', { class: ['badge', r.emailStatus === 'sent' ? 'badge-ok' : 'badge-warn'], text: t('reports.status.' + r.emailStatus) }))),
        Object.keys(r.context || {}).length ? h('details', { class: 'disclosure' }, h('summary', null, t('tickets.tech'), icon('chevron-down')),
          h('dl', { class: 'kv kv-tight' }, Object.entries(r.context).map(([k, v]) => [h('dt', { text: t('tickets.ctx.' + k) }), h('dd', { class: 'break', text: String(v) })]))) : null));
    } else {
      side.push(h('section', { class: 'card', 'aria-labelledby': 'tk-states' },
        cardHead({ id: 'tk-states', icon: 'info-circle-fill', title: t('tickets.statesTitle') }),
        h('ul', { class: 'status-steps' }, ['new', 'in_progress', 'waiting', 'resolved', 'closed'].map((s) => h('li', { class: s === r.status ? 'current' : null },
          statusBadge(s), h('span', { class: 'small muted', text: t('tickets.statesHelp.' + s) }))))));
    }

    fill(body, h('div', { class: 'stack-lg' }, summary, guidance,
      h('div', { class: 'dash-grid' },
        h('div', { class: 'stack-lg' }, original, h('section', { class: 'card', 'aria-labelledby': 'tk-conv' }, cardHead({ id: 'tk-conv', icon: 'chat-square-text', title: t('tickets.conversation') }), timeline), composer),
        h('div', { class: 'stack-lg ticket-side' }, side))));
  };

  await load();
  return { destroy: () => { alive = false; }, isDirty: () => draftDirty() };
}

const emailFailed = (res) => { const m = res.messages[res.messages.length - 1]; return m && m.emailStatus === 'failed'; };
const emailedText = (res) => (emailFailed(res) ? 'tickets.replyEmailFailed' : 'tickets.replyEmailed');

function timelineItem(m, canManage) {
  const when = h('time', { class: 'tiny muted', datetime: new Date(m.createdAt * 1000).toISOString(), title: fmtDate(m.createdAt), text: fmtRelative(m.createdAt) });
  if (m.kind === 'event') {
    const d = m.details || {};
    // People who reported something see "Soporte técnico", not who in IT did it.
    const who = m.role === 'support' && !canManage ? t('tickets.support') : m.author;
    const text = d.action === 'status'
      ? t('tickets.event.status', { name: who, from: t('tickets.status.' + d.from), to: t('tickets.status.' + d.to) })
      : d.action === 'edit' ? t('tickets.event.edit', { name: who, fields: Object.keys(d.fields || {}).map((f) => t('tickets.field.' + f)).join(', ') }) : '';
    return h('li', { class: 'timeline-event' }, icon(d.action === 'status' ? STATUS_ICON[d.to] || 'arrow-repeat' : 'pencil'), h('span', { class: 'small', text }), when);
  }
  const support = m.role === 'support';
  return h('li', { class: ['timeline-msg', support ? 'from-support' : 'from-reporter', m.kind === 'note' && 'note'] },
    h('span', { class: 'avatar', 'aria-hidden': 'true', text: support ? 'IT' : initials(m.author) }),
    h('div', { class: 'bubble' },
      h('div', { class: 'bubble-head' },
        h('strong', { text: support ? (canManage ? m.author : t('tickets.support')) : m.author }),
        m.kind === 'note' ? h('span', { class: 'badge badge-warn' }, icon('lock'), t('tickets.internal')) : null,
        when),
      h('div', { class: 'bubble-body', text: m.body }),
      canManage && m.emailStatus ? h('div', { class: ['tiny', m.emailStatus === 'sent' ? 'ok-text' : 'bad-text'] },
        icon(m.emailStatus === 'sent' ? 'envelope' : 'exclamation-triangle-fill'), ' ', t('tickets.email.' + m.emailStatus)) : null));
}

/** Owner: status actions, priority and edit. */
function actionsCard(r, done) {
  const id = r.id;
  const ACTIONS = {
    in_progress: { icon: 'arrow-repeat', notify: false, needs: false },
    waiting: { icon: 'hourglass-split', notify: true, needs: true },
    resolved: { icon: 'check-circle-fill', notify: true, needs: false },
    closed: { icon: 'lock', notify: false, needs: false },
  };
  const available = {
    new: ['in_progress', 'waiting', 'resolved', 'closed'],
    in_progress: ['waiting', 'resolved', 'closed'],
    waiting: ['in_progress', 'resolved', 'closed'],
    resolved: ['in_progress', 'closed'],
    closed: ['in_progress'],
  }[r.status];
  const buttons = available.map((s) => {
    const label = s === 'in_progress' && (r.status === 'resolved' || r.status === 'closed') ? t('tickets.action.reopen') : t('tickets.action.' + s);
    return button(label, { icon: ACTIONS[s].icon, attrs: { class: 'btn btn-block' + (s === 'resolved' ? ' btn-primary' : '') }, onClick: () => statusDialog(s, label) });
  });

  const statusDialog = (status, label) => {
    const cfg = ACTIONS[status];
    const msg = textField({ label: t(cfg.needs ? 'tickets.dialog.messageRequired' : 'tickets.dialog.message'), multiline: true, rows: 5, max: 4000, placeholder: t('tickets.dialog.placeholder.' + status) });
    const notify = h('input', { type: 'checkbox', id: 'tk-dlg-notify', checked: cfg.notify || null });
    const dlg = openDialog({
      title: label, lead: t('tickets.dialog.lead.' + status, { name: r.reporterName }), labelledIcon: cfg.icon,
      body: h('div', { class: 'stack' }, msg.wrap, h('label', { class: 'check', for: 'tk-dlg-notify' }, notify, h('span', { text: t('tickets.notify', { name: r.reporterName.split(' ')[0] }) }))),
      actions: [
        { label: t('common.cancel'), onClick: (b, close) => close() },
        { label, variant: 'primary', icon: cfg.icon, onClick: async (btn, close) => {
          const v = msg.input.value.trim();
          if (cfg.needs && !v) { msg.setError(fieldErrorText('required')); msg.input.focus(); return; }
          setBusy(btn, true, t('common.saving'));
          try {
            const res = await api.post('/reports/' + id + '/status', { status, message: v, notify: notify.checked });
            close();
            const failed = notify.checked && res.messages.some((m) => m.emailStatus === 'failed' && m.createdAt >= Date.now() / 1000 - 30);
            toast(t('tickets.statusChanged', { status: t('tickets.status.' + status) }) + (notify.checked ? ' ' + t(failed ? 'tickets.emailFailedShort' : 'tickets.emailSentShort') : ''), { type: failed ? 'warn' : 'ok' });
            done(res);
          } catch (err) {
            setBusy(btn, false);
            if (err.code === 'validation' && err.fields.message) msg.setError(fieldErrorText(err.fields.message, { max: 4000 }));
            else toast(errorText(err), { type: 'bad' });
          }
        } },
      ],
    });
    setTimeout(() => msg.input.focus(), 60);
    return dlg;
  };

  const prio = h('select', { class: 'select', id: 'tk-priority' }, ['low', 'normal', 'high', 'urgent'].map((p) => h('option', { value: p, selected: p === r.priority || null, text: t('tickets.priority.' + p) })));
  prio.addEventListener('change', async () => {
    prio.disabled = true;
    try { const res = await api.put('/reports/' + id, { priority: prio.value }); toast(t('tickets.prioritySaved')); done(res); } catch (err) { toast(errorText(err), { type: 'bad' }); prio.disabled = false; }
  });

  const editBtn = button(t('tickets.edit'), { icon: 'pencil', small: true, variant: 'ghost', onClick: () => editDialog(r, done) });
  return h('section', { class: 'card', 'aria-labelledby': 'tk-actions' },
    cardHead({ id: 'tk-actions', icon: 'activity', title: t('tickets.actions'), badge: editBtn }),
    h('div', { class: 'stack-sm' }, buttons),
    h('div', { class: 'field field-group' }, h('label', { class: 'label', for: 'tk-priority', text: t('tickets.priorityLabel') }), prio));
}

function editDialog(r, done) {
  const title = textField({ label: t('report.titleLabel'), value: r.title, max: 120 });
  const desc = textField({ label: t('tickets.description'), value: r.description, multiline: true, rows: 6, max: 4000 });
  const sel = (id, label, values, current, prefix) => {
    const el = h('select', { class: 'select', id }, values.map((v) => h('option', { value: v, selected: v === current || null, text: t(prefix + v) })));
    return { el, wrap: h('div', { class: 'field' }, h('label', { class: 'label', for: id, text: label }), el) };
  };
  const type = sel('tk-e-type', t('report.type'), ['problem', 'improvement', 'content', 'design', 'other'], r.type, 'report.types.');
  const area = sel('tk-e-area', t('tickets.area'), ['website', 'admin', 'both'], r.area, 'report.areas.');
  openDialog({
    title: t('tickets.editTitle', { id: r.id }), lead: t('tickets.editLead'), labelledIcon: 'pencil', wide: true,
    body: h('div', { class: 'stack' }, title.wrap, h('div', { class: 'form-grid' }, type.wrap, area.wrap), desc.wrap),
    actions: [
      { label: t('common.cancel'), onClick: (b, close) => close() },
      { label: t('common.save'), variant: 'primary', icon: 'check-lg', onClick: async (btn, close) => {
        setBusy(btn, true, t('common.saving'));
        try {
          const res = await api.put('/reports/' + r.id, { title: title.input.value, description: desc.input.value, type: type.el.value, area: area.el.value });
          close();
          toast(t('tickets.edited'));
          done(res);
        } catch (err) {
          setBusy(btn, false);
          if (err.code === 'validation') {
            title.setError(err.fields.title ? fieldErrorText(err.fields.title, { max: 120 }) : null);
            desc.setError(err.fields.description ? fieldErrorText(err.fields.description, { max: 4000 }) : null);
          } else toast(errorText(err), { type: 'bad' });
        }
      } },
    ],
  });
}

