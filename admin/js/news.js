/**
 * «Novedades»: when a feature ships (cms/wiki/wiki.json), the people who can
 * use it see, once, what it is and what they can do, with a link to its wiki
 * article. Shown after signing in (never while viewing as someone); «Ver más
 * tarde» brings it back next time, «Entendido» or opening the article marks it
 * seen. The Wiki menu item counts the ones not seen yet.
 */
import { h, icon, clear } from './dom.js';
import { t, getLang } from './i18n.js';
import { api } from './api.js';
import { openDialog, button } from './ui.js';

const LATER_KEY = 'sensum_news_later';
let listener = null;
let unseen = 0;

/** Called with the number of «Novedades» not seen yet (the menu badge; one listener, the current frame). */
export function onNewsCount(fn) { listener = fn; fn(unseen); }
const setCount = (n) => { unseen = Math.max(0, n); if (listener) listener(unseen); };

export async function markNewsSeen(ids) {
  if (!ids.length) return;
  try { const r = await api.post('/wiki/news/seen', { ids }); setCount(unseen - (r.marked || 0)); } catch (e) { /* shown again next time */ }
}

const theme = () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
const shot = (name) => `../api/wiki/image?name=${encodeURIComponent(name)}&lang=${getLang()}&theme=${theme()}&device=${window.innerWidth < 700 ? 'mobile' : 'desktop'}`;

/**
 * Asks for the «Novedades» not seen yet and, unless postponed in this tab,
 * shows them one after another.
 * @param {{ viewAs: boolean, navigate: (path: string) => void }} opts
 */
export async function checkNews({ viewAs, navigate }) {
  if (viewAs) { setCount(0); return; }
  let items;
  try { items = (await api.get('/wiki/news?lang=' + getLang())).news; } catch (e) { return; }
  setCount(items.length);
  let later = false;
  try { later = sessionStorage.getItem(LATER_KEY) === '1'; } catch (e) { /* ignore */ }
  if (!items.length || later) return;

  let i = 0;
  const body = h('div', { class: 'news' });
  const dots = h('div', { class: 'news-dots', 'aria-hidden': 'true' });
  const counter = h('span', { class: 'tiny muted news-counter' });
  const how = button(t('news.how'), { icon: 'question-circle' });
  const next = button(t('news.next'), { variant: 'primary', icon: 'chevron-right' });
  const draw = () => {
    const n = items[i];
    clear(body);
    body.append(
      n.shot ? h('div', { class: 'news-shot' }, h('img', { src: shot(n.shot), alt: '', decoding: 'async', onerror: (e) => { e.target.parentNode.hidden = true; } })) : null,
      h('div', { class: 'news-text' },
        h('span', { class: 'news-eyebrow' }, icon('star-fill'), t('news.eyebrow')),
        h('h3', { class: 'news-title', text: n.title }),
        h('p', { class: 'muted', text: n.summary }),
        n.points.length ? h('div', null, h('p', { class: 'news-label', text: t('news.whatYouCan') }),
          h('ul', { class: 'news-points' }, n.points.map((p) => h('li', null, icon('check-circle-fill'), h('span', { text: p }))))) : null));
    clear(dots);
    items.forEach((_, j) => dots.append(h('span', { class: j === i ? 'is-on' : null })));
    counter.textContent = items.length > 1 ? t('news.of', { i: i + 1, n: items.length }) : '';
    how.hidden = !n.article;
    next.lastChild.textContent = i < items.length - 1 ? t('news.next') : t('news.done');
  };
  const dlg = openDialog({
    title: t('news.title'), labelledIcon: 'star-fill', body, wide: true,
    actions: [
      { label: t('news.later'), variant: 'ghost', onClick: (b, close) => { try { sessionStorage.setItem(LATER_KEY, '1'); } catch (e) { /* ignore */ } close(); } },
    ],
  });
  dlg.foot.append(how, next);
  // How many there are, under the title: always in view, also on phones where the text scrolls.
  dlg.el.querySelector('.dialog-head h2').after(h('div', { class: 'news-progress' }, dots, counter));
  // On phones the text scrolls inside the dialog: it must be reachable with the keyboard too.
  if (dlg.body) dlg.body.tabIndex = 0;
  how.addEventListener('click', () => {
    const n = items[i];
    markNewsSeen(items.slice(0, i + 1).map((x) => x.id));
    dlg.close();
    navigate('/wiki/' + n.article);
  });
  next.addEventListener('click', () => {
    if (i < items.length - 1) { i++; draw(); return; }
    markNewsSeen(items.map((x) => x.id));
    dlg.close();
  });
  draw();
}
