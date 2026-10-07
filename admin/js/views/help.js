/** Ayuda — short how-to answers and the support entry point. */
import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { pageHead, button } from '../ui.js';
import { openReportDialog } from '../report.js';

export function render({ main }) {
  main.append(pageHead({ title: t('help.title'), lead: t('help.lead') }),
    h('div', { class: 'dash-grid' },
      h('div', { class: 'faq-list' }, t('help.items').map(([q, steps]) => h('details', null,
        h('summary', null, h('span', { text: q }), icon('chevron-down')),
        h('div', { class: 'faq-body' }, h('ol', null, steps.map((s) => h('li', { text: s }))))))),
      h('section', { class: 'card stack' },
        h('span', { class: 'icon-tile' }, icon('life-preserver')),
        h('h2', { text: t('help.contactTitle') }),
        h('p', { class: 'muted', text: t('help.contactBody') }),
        h('div', null, button(t('topbar.report'), { variant: 'primary', icon: 'send', onClick: () => openReportDialog() })))));
}
