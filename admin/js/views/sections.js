/**
 * «Más secciones»: every part of the panel an account can be given. The menu
 * only lists what a person can open, so this is where they see the rest and
 * ask for it (one click opens «Pedir acceso» with that section ticked).
 */
import { h, icon, clear } from '../dom.js';
import { t, fmtDate } from '../i18n.js';
import { api } from '../api.js';
import { pageHead, alertBox, button } from '../ui.js';
import { askable, can, permissionList } from '../access.js';
import { openAccessRequest } from '../accessrequest.js';

/** One entry per kind of access, in the menu's order: [permission, icon, screen]. */
const SECTIONS = [
  ['texts', 'pencil-square', '/textos'],
  ['photos', 'images', '/fotos'],
  ['documents', 'file-earmark-pdf', '/fotos/documentos'],
  ['contact', 'telephone', '/contacto'],
  ['leads', 'inbox', '/prospectos'],
  ['stats', 'graph-up', '/estadisticas'],
  ['monitor', 'heart-pulse', '/salud-del-sitio'],
  ['report', 'bar-chart', '/informe'],
  ['site', 'clock-history', '/actividad'],
  ['support', 'headset', '/reportes'],
  ['users', 'people', '/usuarios'],
];

export async function render({ main, session }) {
  const user = session.user;
  // While the owner views the panel as someone: the same page, but only that person can ask.
  const preview = !!session.viewAs;
  main.append(pageHead({ title: t('moreSections.title'), lead: t(user.owner ? 'moreSections.leadOwner' : 'moreSections.lead') }));
  const body = h('div', { class: 'stack-lg' });
  main.append(body);

  let pending = null;
  const ask = (perms) => openAccessRequest(user, perms, (request) => { pending = request; draw(); });

  const draw = () => {
    const open = askable(user);
    const name = (p) => t('access.perms.' + p);
    const locked = SECTIONS.filter(([p]) => open.includes(p)).map(([p, ic]) => {
      const requested = !!pending && pending.permissions.includes(p);
      return h('li', { class: ['card', 'section-tile', requested && 'is-requested'] },
        h('div', { class: 'section-tile-head' },
          h('span', { class: 'icon-tile section-icon' }, icon(ic), h('span', { class: 'section-lock' }, icon(requested ? 'hourglass-split' : 'lock'))),
          h('h3', { text: name(p) })),
        h('p', { class: 'small muted', text: t('access.permHelp.' + p) }),
        h('div', { class: 'section-tile-foot' }, requested
          ? h('span', { class: 'badge badge-info' }, icon('hourglass-split'), t('moreSections.requested'))
          : button(t('accessRequest.ask'), { small: true, icon: 'send', onClick: () => ask([p]),
            attrs: { disabled: preview || null, 'aria-label': t('moreSections.askFor', { name: name(p) }) } })));
    });
    const mine = SECTIONS.filter(([p]) => can(user, p)).map(([p, ic, path]) => h('a', { class: 'card card-link', href: '#' + path },
      h('span', { class: 'icon-tile' }, icon(ic)), h('span', null, h('strong', { text: name(p) }), h('span', { text: t('access.permHelp.' + p) }))));

    clear(body);
    if (preview && !user.owner) body.append(alertBox('info', null, t('moreSections.preview', { name: user.name })));
    if (pending && !preview) {
      body.append(alertBox('info', null, t('accessRequest.pendingShort', { perms: permissionList(pending.permissions), when: fmtDate(pending.createdAt, false) }),
        [button(t('accessRequest.change'), { small: true, icon: 'send', onClick: () => ask([]) })]));
    }
    if (locked.length) {
      body.append(h('section', { class: 'stack', 'aria-labelledby': 'sec-ask' },
        h('div', null, h('h2', { class: 'section-title', id: 'sec-ask', text: t('moreSections.askTitle') }),
          h('p', { class: 'small muted section-lead', text: t('moreSections.askLead') })),
        h('ul', { class: 'section-tiles' }, locked)));
    } else if (!user.owner) {
      body.append(alertBox('ok', null, t('moreSections.allYours')));
    }
    if (mine.length) {
      body.append(h('section', { class: 'stack', 'aria-labelledby': 'sec-mine' },
        h('h2', { class: 'section-title', id: 'sec-mine', text: t('moreSections.mineTitle') }),
        h('nav', { class: 'quick', 'aria-labelledby': 'sec-mine' }, mine)));
    }
  };

  draw();
  if (!user.owner) {
    try { pending = (await api.get('/account/access-request')).request; } catch (e) { /* the page works without it */ }
    if (pending) draw();
  }
}
