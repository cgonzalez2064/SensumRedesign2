/**
 * Actividad — who changed what in the panel, newest first and grouped by day,
 * with filters (person, kind, dates) and an export for Excel. Each account
 * sees the kinds its access covers; the owner sees everything (sign-ins and
 * settings included). "?persona=ID" comes from Usuarios → «Ver actividad».
 */
import { h, icon, fill } from '../dom.js';
import { t, fmtDate, locale } from '../i18n.js';
import { api, saveBlob } from '../api.js';
import { pageHead, loading, loadError, emptyState, button, setBusy, toast, errorText, filtersToggle } from '../ui.js';

const GROUP_ICON = { content: 'pencil-square', media: 'images', users: 'people', leads: 'inbox', security: 'shield-lock', settings: 'person-gear', support: 'headset', other: 'clock-history' };

/** "estableció la contraseña de un usuario"; an action the panel has no words for yet reads as a generic change. */
export function actionLabel(action) {
  const s = t('dashboard.actions.' + action);
  return s.startsWith('dashboard.') ? t('activity.otherAction') : s;
}

export async function render({ main, query }) {
  const exportBtn = button(t('activity.export'), { icon: 'download' });
  main.append(pageHead({ title: t('activity.title'), lead: t('activity.lead'), actions: [exportBtn] }));
  const filters = { person: /^\d+$/.test(query.get('persona') || '') ? query.get('persona') : '', group: '', from: '', to: '' };
  const personSel = h('select', { class: 'select', id: 'act-person', 'aria-label': t('activity.person') });
  const groupSel = h('select', { class: 'select', id: 'act-group', 'aria-label': t('activity.kind') });
  const from = h('input', { class: 'input', type: 'date', id: 'act-from', 'aria-label': t('activity.from') });
  const to = h('input', { class: 'input', type: 'date', id: 'act-to', 'aria-label': t('activity.to') });
  const clearBtn = button(t('activity.clear'), { variant: 'ghost', small: true, icon: 'x-lg' });
  const toolbar = h('div', { class: 'activity-toolbar filters-more' },
    h('div', { class: 'field' }, h('label', { class: 'label', for: 'act-person', text: t('activity.person') }), personSel),
    h('div', { class: 'field' }, h('label', { class: 'label', for: 'act-group', text: t('activity.kind') }), groupSel),
    h('div', { class: 'field' }, h('label', { class: 'label', for: 'act-from', text: t('activity.from') }), from),
    h('div', { class: 'field' }, h('label', { class: 'label', for: 'act-to', text: t('activity.to') }), to),
    h('div', { class: 'activity-clear' }, clearBtn));
  const list = h('div', { 'aria-live': 'polite' }, loading());
  const more = button(t('activity.more'), { icon: 'arrow-down' });
  more.hidden = true;
  // Phones: the four filters wait behind «Filtros», so the list starts on the first screen.
  const filtersBtn = filtersToggle(toolbar, () => Object.values(filters).filter(Boolean).length);
  main.append(h('div', { class: 'stack' }, h('div', { class: 'card activity-filters' }, filtersBtn.button, toolbar), list, h('div', { class: 'row row-center' }, more)));

  let items = [];
  let alive = true;
  const qs = (extra = {}) => new URLSearchParams(Object.fromEntries(Object.entries({ ...filters, ...extra }).filter(([, v]) => v !== ''))).toString();

  const dayLabel = (ts) => {
    const d = new Date(ts * 1000);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    if (d.toDateString() === today.toDateString()) return t('activity.today');
    if (d.toDateString() === yesterday.toDateString()) return t('activity.yesterday');
    return d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  };
  const row = (a) => h('li', { class: 'activity-row' },
    h('span', { class: ['icon-tile', 'icon-tile-sm', 'tile-' + a.group] }, icon(GROUP_ICON[a.group] || 'clock-history')),
    h('div', { class: 'grow' },
      h('span', null, h('strong', { text: a.actor || t(a.group === 'users' || a.group === 'other' ? 'activity.system' : 'dashboard.someone') }), ' ', actionLabel(a.action)),
      a.targetName && a.targetName !== a.actor ? h('span', { class: 'muted break', text: ' — ' + a.targetName }) : null,
      a.action === 'content_updated' && a.target ? h('span', { class: 'muted', text: ' — ' + (t('sections.' + a.target)[0] || a.target) }) : null),
    h('time', { class: 'tiny muted nowrap', datetime: new Date(a.at * 1000).toISOString(), text: new Date(a.at * 1000).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' }) }));
  const draw = () => {
    if (!items.length) {
      fill(list, h('div', { class: 'card' }, Object.values(filters).some(Boolean)
        ? emptyState('funnel', t('activity.emptyFilterTitle'), t('activity.emptyFilterBody'))
        : emptyState('clock-history', t('activity.emptyTitle'), t('activity.emptyBody'))));
      return;
    }
    const days = [];
    for (const a of items) {
      const key = new Date(a.at * 1000).toDateString();
      if (!days.length || days[days.length - 1].key !== key) days.push({ key, at: a.at, items: [] });
      days[days.length - 1].items.push(a);
    }
    fill(list, days.map((d) => h('section', { class: 'card activity-day', 'aria-label': dayLabel(d.at) },
      h('h2', { class: 'activity-day-title', text: dayLabel(d.at) }),
      h('ul', { class: 'activity-list' }, d.items.map(row)))));
  };

  const load = async (append = false) => {
    let data;
    try { data = await api.get('/activity?' + qs(append && items.length ? { before: String(items[items.length - 1].id) } : {})); }
    catch (err) { fill(list, loadError(err, () => load(append))); return; }
    if (!alive) return;
    if (data.people) {
      fill(personSel, h('option', { value: '', text: t('activity.everyone') }), data.people.map((p) => h('option', { value: String(p.id), text: p.name, selected: String(p.id) === filters.person || null })));
      fill(groupSel, h('option', { value: '', text: t('activity.allKinds') }), data.groups.map((g) => h('option', { value: g, text: t('activity.groups.' + g), selected: g === filters.group || null })));
    }
    items = append ? items.concat(data.items) : data.items;
    more.hidden = !data.more;
    draw();
  };
  const change = () => {
    Object.assign(filters, { person: personSel.value, group: groupSel.value, from: from.value, to: to.value });
    clearBtn.hidden = !Object.values(filters).some(Boolean);
    filtersBtn.update();
    load();
  };
  [personSel, groupSel, from, to].forEach((el) => el.addEventListener('change', change));
  clearBtn.addEventListener('click', () => { personSel.value = ''; groupSel.value = ''; from.value = ''; to.value = ''; change(); });
  clearBtn.hidden = !filters.person;
  more.addEventListener('click', async () => { setBusy(more, true, t('app.loading')); await load(true); setBusy(more, false); });

  // Export: what the filters show (up to 5,000 lines), with the same words as the screen.
  exportBtn.addEventListener('click', async () => {
    setBusy(exportBtn, true, t('activity.exporting'));
    try {
      const data = await api.get('/activity?' + qs({ export: '1' }));
      const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
      const lines = [[t('activity.csv.date'), t('activity.csv.person'), t('activity.csv.action'), t('activity.csv.about'), t('activity.csv.kind')].map(cell).join(',')]
        .concat(data.items.map((a) => [fmtDate(a.at), a.actor || t('activity.system'), actionLabel(a.action),
          a.targetName || (a.action === 'content_updated' && a.target ? t('sections.' + a.target)[0] || a.target : ''), t('activity.groups.' + a.group)].map(cell).join(',')));
      saveBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'actividad-sensum-' + new Date().toISOString().slice(0, 10) + '.csv');
      toast(t('activity.exported', { n: data.items.length }));
    } catch (err) { toast(errorText(err), { type: 'bad' }); }
    setBusy(exportBtn, false);
  });

  await load();
  return { destroy: () => { alive = false; } };
}
