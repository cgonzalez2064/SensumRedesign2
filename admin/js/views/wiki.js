/**
 * Wiki — processes, guides and answers inside the panel, with real screenshots
 * that follow the person's language, theme and device. Every signed-in
 * account reads it; the articles and images come from the API (cms/wiki), so
 * nothing of it is public. Marking text in an article offers «Preguntar a
 * soporte», which opens a support request about that text.
 */
import { h, icon, clear, fill } from '../dom.js';
import { t, tp, getLang } from '../i18n.js';
import { api } from '../api.js';
import { loading, loadError, button, segmented, openDialog, alertBox } from '../ui.js';
import { render as renderMd, plainText, fold } from '../wiki-md.js';
import { openReportDialog } from '../report.js';
import { openAccessRequest } from '../accessrequest.js';
import { askable } from '../access.js';
import { markNewsSeen } from '../news.js';

const DEVICE_KEY = 'sensum_wiki_device';
const FILTER_KEY = 'sensum_wiki_filter';
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* the page works without it */ } },
};
const theme = () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
const device = () => store.get(DEVICE_KEY) || (window.innerWidth < 700 ? 'mobile' : 'desktop');
export const shotUrl = (name, d = device()) => `../api/wiki/image?name=${encodeURIComponent(name)}&lang=${getLang()}&theme=${theme()}&device=${d}`;

// The articles of this account in its language, kept for 5 minutes while moving between pages.
let cache = null;
async function wikiData(uid) {
  const key = getLang() + '|' + uid;
  if (cache && cache.key === key && Date.now() - cache.at < 5 * 60000) return cache.data;
  const data = await api.get('/wiki?lang=' + getLang());
  for (const a of data.articles) a.search = fold([a.title, a.summary, plainText(a.body)].join(' '));
  cache = { key, at: Date.now(), data };
  return data;
}

const dateText = (iso) => (iso ? new Intl.DateTimeFormat(getLang() === 'en' ? 'en-US' : 'es-GT', { dateStyle: 'long' }).format(new Date(iso + 'T12:00:00')) : '');

/** Builds `text` with every search term wrapped in <mark>. */
function highlight(text, terms) {
  if (!terms.length) return [text];
  const f = fold(text);
  const marks = [];
  for (const term of terms) {
    let at = f.indexOf(term);
    while (at !== -1) { marks.push([at, at + term.length]); at = f.indexOf(term, at + term.length); }
  }
  marks.sort((a, b) => a[0] - b[0]);
  const out = [];
  let last = 0;
  for (const [s, e] of marks) {
    if (s < last) continue;
    if (s > last) out.push(text.slice(last, s));
    out.push(h('mark', { text: text.slice(s, e) }));
    last = e;
  }
  out.push(text.slice(last));
  return out;
}

function articleCard(a, terms = []) {
  return h('a', { class: ['wiki-card', !a.allowed && 'is-locked'], href: '#/wiki/' + a.slug },
    h('span', { class: 'wiki-card-icon', 'aria-hidden': 'true' }, icon(a.icon)),
    h('span', { class: 'wiki-card-text' },
      h('strong', null, highlight(a.title, terms)),
      h('span', null, highlight(a.summary, terms)),
      !a.allowed ? h('span', { class: 'wiki-lock' }, icon('lock'), t('wiki.notInRoleShort')) : null),
    icon('chevron-right', 'wiki-card-go'));
}

// ------------------------------------------------------------------ home

export async function home({ main, session }) {
  const box = h('div', { class: 'wiki' }, loading());
  main.append(box);
  let data;
  try { data = await wikiData(session.user.id); } catch (err) { fill(box, loadError(err, () => { clear(main); home({ main, session }); })); return; }

  let filter = store.get(FILTER_KEY) === 'all' ? 'all' : 'mine';
  const owner = !!session.user.owner;
  const search = h('input', { class: 'wiki-search-input', type: 'search', id: 'wiki-search', autocomplete: 'off', placeholder: t(window.matchMedia('(max-width: 600px)').matches ? 'wiki.searchLabel' : 'wiki.searchPlaceholder'), 'aria-describedby': 'wiki-search-count' }); // the long example doesn't fit on phones
  const count = h('p', { class: 'small muted wiki-count', id: 'wiki-search-count', 'aria-live': 'polite' });
  const results = h('div', { class: 'wiki-results' });
  const browse = h('div', { class: 'wiki-browse' });
  const filterSeg = owner ? null : segmented([{ value: 'mine', label: t('wiki.forYou') }, { value: 'all', label: t('wiki.all') }], filter, (v) => {
    filter = v; store.set(FILTER_KEY, v); draw();
  }, t('wiki.filterLabel'));

  const hero = h('section', { class: 'wiki-hero', 'aria-labelledby': 'wiki-h1' },
    h('div', { class: 'wiki-hero-text' },
      h('span', { class: 'wiki-eyebrow' }, icon('question-circle'), t('wiki.eyebrow')),
      h('h1', { id: 'wiki-h1', tabindex: '-1', text: t('wiki.title') }),
      h('p', { class: 'wiki-lead', text: t('wiki.lead') })),
    h('div', { class: 'wiki-search', role: 'search' },
      h('label', { class: 'sr-only', for: 'wiki-search', text: t('wiki.searchLabel') }),
      icon('search', 'wiki-search-icon'), search, h('kbd', { class: 'wiki-kbd', 'aria-hidden': 'true', text: '/' })),
    h('div', { class: 'wiki-hero-foot' }, filterSeg, count));

  const visible = () => data.articles.filter((a) => filter === 'all' || owner || a.allowed);

  const newsSection = () => {
    const items = data.news.slice(0, 6);
    if (!items.length) return null;
    return h('section', { class: 'wiki-news', 'aria-labelledby': 'wiki-news-t' },
      h('div', { class: 'wiki-section-head' },
        h('span', { class: 'wiki-cat-icon', 'aria-hidden': 'true' }, icon('star-fill')),
        h('div', null, h('h2', { id: 'wiki-news-t', text: t('wiki.news') }), h('p', { class: 'small muted', text: t('wiki.newsLead') }))),
      h('div', { class: 'wiki-news-row' }, items.map((n) => h('a', { class: ['wiki-news-card', !n.seen && 'is-new'], href: n.article ? '#/wiki/' + n.article : '#/wiki',
        onclick: () => { if (!n.seen) { n.seen = true; markNewsSeen([n.id]); } } },
        n.shot ? h('span', { class: 'wiki-news-img' }, h('img', { src: shotUrl(n.shot, 'desktop'), alt: '', loading: 'lazy', decoding: 'async', onerror: (e) => { e.target.parentNode.hidden = true; } })) : null,
        h('span', { class: 'wiki-news-text' },
          h('span', { class: 'wiki-news-meta' }, !n.seen ? h('span', { class: 'badge badge-brand', text: t('wiki.new') }) : null, h('span', { class: 'tiny muted', text: dateText(n.date) })),
          h('strong', { text: n.title }), h('span', { class: 'small muted', text: n.summary }))))));
  };

  const draw = () => {
    const q = fold(search.value.trim());
    const terms = q.split(/\s+/).filter((x) => x.length > 1);
    if (terms.length) {
      // Search across everything this account may read (its role's articles first).
      const found = data.articles.filter((a) => terms.every((x) => a.search.includes(x)))
        .sort((a, b) => (b.allowed - a.allowed) || (fold(b.title).includes(terms[0]) - fold(a.title).includes(terms[0])));
      browse.hidden = true;
      count.textContent = tp('wiki.results', found.length);
      fill(results, found.length
        ? h('div', { class: 'wiki-card-grid' }, found.map((a) => articleCard(a, terms)))
        : h('div', { class: 'wiki-empty' }, icon('search'), h('p', null, h('strong', { text: t('wiki.noResults', { q: search.value.trim() }) })),
          h('p', { class: 'small muted', text: t('wiki.noResultsHint') }),
          button(t('wiki.askButton'), { icon: 'headset', small: true, onClick: () => askSupport({ subject: t('wiki.askSubjectSearch', { q: search.value.trim() }) }) })));
      return;
    }
    clear(results);
    browse.hidden = false;
    const list = visible();
    count.textContent = tp('wiki.articlesN', list.length);
    fill(browse, newsSection(), data.categories.map((c) => {
      const items = list.filter((a) => a.category === c.id);
      if (!items.length) return null;
      return h('section', { class: 'wiki-cat', id: 'cat-' + c.id, 'aria-labelledby': 'cat-t-' + c.id },
        h('div', { class: 'wiki-section-head' },
          h('span', { class: 'wiki-cat-icon', 'aria-hidden': 'true' }, icon(c.icon)),
          h('div', null, h('h2', { id: 'cat-t-' + c.id, text: c.title }), c.lead ? h('p', { class: 'small muted', text: c.lead }) : null)),
        h('div', { class: 'wiki-card-grid' }, items.map((a) => articleCard(a))));
    }));
  };

  let timer = 0;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(draw, 120); });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = results.querySelector('a.wiki-card'); if (first) location.hash = first.getAttribute('href'); }
    if (e.key === 'Escape') { search.value = ''; draw(); }
  });
  const slash = (e) => { if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { e.preventDefault(); search.focus(); } };
  document.addEventListener('keydown', slash);
  fill(box, hero, results, browse);
  draw();
  return { destroy: () => document.removeEventListener('keydown', slash) };
}

// ------------------------------------------------------------------ article

/** A support request about the wiki, with its topic (and the marked text). */
function askSupport({ subject, quote }) {
  openReportDialog({
    heading: t('wiki.askHeading'), lead: t('wiki.askLead'), type: 'other', area: 'admin', subject,
    description: quote ? t('wiki.askQuote', { text: quote }) + '\n\n' : '', focus: quote ? 'description' : 'title',
  });
}

function lightbox(src, caption) {
  openDialog({ title: caption || t('wiki.zoom'), labelledIcon: 'image', wide: true,
    body: h('div', { class: 'wiki-lightbox' }, h('img', { src, alt: caption || '' })),
    actions: [{ label: t('common.close'), onClick: (b, close) => close() }] });
}

export async function article({ main, params, session }) {
  const slug = params[0];
  const box = h('div', { class: 'wiki' }, loading());
  main.append(box);
  let data;
  try { data = await wikiData(session.user.id); } catch (err) { fill(box, loadError(err, () => { clear(main); article({ main, params, session }); })); return; }
  const a = data.articles.find((x) => x.slug === slug);
  if (!a) {
    fill(box, h('div', { class: 'card empty' }, h('span', { class: 'icon-tile' }, icon('exclamation-circle')),
      h('h1', { tabindex: '-1', text: t('wiki.notFound') }), h('a', { class: 'btn btn-primary', href: '#/wiki' }, t('wiki.back'))));
    return;
  }
  // Opening the article a «Novedad» points to counts as having seen it.
  const news = data.news.filter((n) => n.article === slug && !n.seen);
  if (news.length) { news.forEach((n) => { n.seen = true; }); markNewsSeen(news.map((n) => n.id)); }

  const cat = data.categories.find((c) => c.id === a.category);
  const figures = new Set();
  const figure = (name, caption) => {
    // A screenshot not taken yet shows a quiet placeholder instead of a broken image.
    const img = h('img', { alt: caption, loading: 'lazy', decoding: 'async', onerror: () => fig.classList.add('is-missing'), onload: () => fig.classList.remove('is-missing') });
    const url = h('span', { class: 'shot-url', text: 'app.sensumconstrucciones.com' });
    const frame = h('button', { type: 'button', class: 'shot-frame', 'aria-label': t('wiki.zoomCaption', { caption: caption || '' }),
      onclick: () => lightbox(img.currentSrc || img.src, caption) },
      h('span', { class: 'shot-bar', 'aria-hidden': 'true' }, h('span', { class: 'shot-dots' }, h('i'), h('i'), h('i')), url),
      h('span', { class: 'shot-notch', 'aria-hidden': 'true' }), img);
    const fig = h('figure', { class: 'wiki-figure' }, frame, caption ? h('figcaption', null, icon('image'), h('span', { text: caption })) : null);
    const update = () => { const d = device(); fig.dataset.device = d; img.src = shotUrl(name, d); };
    update();
    figures.add(update);
    return fig;
  };
  const md = renderMd(a.body, { figure, calloutTitle: (k) => t('wiki.callout.' + k) });

  // Who can use what the article is about.
  const who = a.ownerOnly ? [t('wiki.ownerOnly')] : a.perms.length ? a.perms.map((p) => t('access.perms.' + p)) : [t('wiki.forEveryone')];
  const deviceSeg = segmented([{ value: 'desktop', label: t('wiki.desktop'), icon: 'laptop' }, { value: 'mobile', label: t('wiki.mobile'), icon: 'phone' }],
    device(), (v) => { store.set(DEVICE_KEY, v); figures.forEach((f) => f()); }, t('wiki.shots'));
  const head = h('header', { class: 'wiki-article-head' },
    h('nav', { class: 'crumbs', 'aria-label': 'breadcrumb' }, h('a', { href: '#/wiki', text: t('wiki.title') }), icon('chevron-right'),
      cat ? h('a', { href: '#/wiki', text: cat.title, onclick: () => { setTimeout(() => { const el = document.getElementById('cat-' + cat.id); if (el) el.scrollIntoView(); }, 300); } }) : null),
    h('div', { class: 'wiki-title-row' },
      h('span', { class: 'wiki-article-icon', 'aria-hidden': 'true' }, icon(a.icon)),
      h('div', null, h('h1', { id: 'wiki-article-title', tabindex: '-1', text: a.title }), h('p', { class: 'wiki-lead', text: a.summary }))),
    h('div', { class: 'wiki-meta' },
      h('span', { class: 'wiki-who' }, icon(a.perms.length || a.ownerOnly ? 'shield-lock' : 'people'), who.map((w) => h('span', { class: 'wiki-chip', text: w }))),
      a.updated ? h('span', { class: 'tiny muted' }, icon('clock-history'), ' ', t('wiki.updated', { date: dateText(a.updated) })) : null,
      md.nodes.some((n) => n.classList && n.classList.contains('wiki-figure')) ? h('span', { class: 'wiki-device' }, h('span', { class: 'tiny muted', text: t('wiki.shots') }), deviceSeg) : null));

  const locked = !a.allowed && !session.viewAs && askable(session.user).some((p) => a.perms.includes(p))
    ? alertBox('info', t('wiki.notInRole'), t('wiki.notInRoleBody'), [button(t('accessRequest.ask'), { small: true, icon: 'send', onClick: () => openAccessRequest(session.user, a.perms.filter((p) => askable(session.user).includes(p))) })])
    : !a.allowed ? alertBox('info', t('wiki.notInRole'), t('wiki.notInRoleRead')) : null;

  // «En esta página», with the section being read marked.
  const tocLinks = md.headings.filter((x) => x.level === 2).map((x) => h('a', { href: '#/wiki/' + slug, 'data-target': x.id, text: x.text,
    onclick: (e) => { e.preventDefault(); const el = document.getElementById(x.id); if (el) { el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); el.focus({ preventScroll: true }); } } }));
  const toc = tocLinks.length > 1 ? h('nav', { class: 'wiki-toc', 'aria-label': t('wiki.onThisPage') }, h('p', { class: 'wiki-toc-title', text: t('wiki.onThisPage') }), tocLinks) : null;
  // «¿Te quedó una duda?»: beside the article on wide screens, after it on phones.
  const askCard = (cls) => h('div', { class: ['wiki-ask', cls] },
    h('span', { class: 'wiki-ask-icon', 'aria-hidden': 'true' }, icon('headset')),
    h('strong', { text: t('wiki.askCardTitle') }), h('p', { class: 'small', text: t('wiki.askCardBody') }),
    button(t('wiki.askButton'), { small: true, icon: 'send', onClick: () => askSupport({ subject: t('wiki.askSubject', { title: a.title }) }) }));

  const body = h('article', { class: 'wiki-body', 'aria-labelledby': 'wiki-article-title' }, md.nodes);
  // Previous / next within the same category.
  const siblings = data.articles.filter((x) => x.category === a.category && (x.allowed || !a.allowed || session.user.owner));
  const at = siblings.indexOf(a);
  const pager = h('nav', { class: 'wiki-pager', 'aria-label': t('wiki.pager') },
    siblings[at - 1] ? h('a', { class: 'wiki-pager-link', href: '#/wiki/' + siblings[at - 1].slug }, h('span', { class: 'tiny muted' }, icon('arrow-left'), ' ', t('wiki.prev')), h('strong', { text: siblings[at - 1].title })) : h('span'),
    siblings[at + 1] ? h('a', { class: 'wiki-pager-link is-next', href: '#/wiki/' + siblings[at + 1].slug }, h('span', { class: 'tiny muted' }, t('wiki.next'), ' ', icon('chevron-right')), h('strong', { text: siblings[at + 1].title })) : h('span'));

  fill(box, head, locked, h('div', { class: 'wiki-layout' },
    h('div', { class: 'wiki-main' }, body, askCard('wiki-ask-end'), pager),
    h('aside', { class: 'wiki-aside' }, toc, askCard('wiki-ask-side'))));

  // Theme switched while reading: the screenshots follow.
  const themeWatch = new MutationObserver(() => figures.forEach((f) => f()));
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  let spy = null;
  if (toc && 'IntersectionObserver' in window) {
    spy = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        tocLinks.forEach((l) => l.classList.toggle('is-active', l.dataset.target === en.target.id));
      }
    }, { rootMargin: '-15% 0px -70% 0px' });
    md.headings.filter((x) => x.level === 2).forEach((x) => { const el = document.getElementById(x.id); if (el) spy.observe(el); });
  }

  // Mark text → «Preguntar a soporte» next to it.
  const pop = h('button', { type: 'button', class: 'ask-pop', hidden: true }, icon('headset'), t('wiki.askButton'));
  document.body.append(pop);
  let picked = '';
  const place = () => {
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString().replace(/\s+/g, ' ').trim() : '';
    if (!text || text.length < 3 || !sel.rangeCount || !body.contains(sel.getRangeAt(0).commonAncestorContainer)) { pop.hidden = true; return; }
    picked = text.slice(0, 600);
    const r = sel.getRangeAt(0).getBoundingClientRect();
    pop.hidden = false;
    const touch = matchMedia('(pointer: coarse)').matches;
    const top = (touch ? r.bottom + 12 : r.top - pop.offsetHeight - 10) + window.scrollY;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - pop.offsetWidth / 2), document.documentElement.clientWidth - pop.offsetWidth - 8) + window.scrollX;
    pop.style.top = Math.max(window.scrollY + 8, top) + 'px';
    pop.style.left = left + 'px';
  };
  let raf = 0;
  const onSel = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); };
  document.addEventListener('selectionchange', onSel);
  pop.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection while clicking
  pop.addEventListener('click', () => {
    pop.hidden = true;
    askSupport({ subject: t('wiki.askSubject', { title: a.title }), quote: picked });
  });

  return {
    destroy: () => {
      themeWatch.disconnect();
      if (spy) spy.disconnect();
      document.removeEventListener('selectionchange', onSel);
      pop.remove();
    },
  };
}
