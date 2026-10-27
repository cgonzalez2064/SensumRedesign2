/**
 * The wiki's Markdown (cms/wiki/articles/*.md) turned into DOM nodes with h():
 * text is always text, so an article can never inject markup.
 *
 * Blocks: ## / ### headings, paragraphs, - lists, 1. numbered steps,
 * > [!tip|note|warn] callouts, | tables |, --- and ![caption](shot:name)
 * screenshots. Inline: **bold**, *italic*, `UI label` (shown like the
 * panel's button), [text](wiki:slug | #/route | https://…).
 */
import { h, icon } from './dom.js';

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const slugify = (s) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** Inline Markdown → nodes. */
export function inline(text) {
  const out = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(h('strong', null, inline(m[1])));
    else if (m[2] !== undefined) out.push(h('em', null, inline(m[2])));
    else if (m[3] !== undefined) out.push(h('span', { class: 'ui-chip', text: m[3] }));
    else {
      const [label, href] = [m[4], m[5]];
      if (href.startsWith('wiki:')) out.push(h('a', { href: '#/wiki/' + href.slice(5).replace(/[^a-z0-9-]/g, '') }, inline(label)));
      else if (href.startsWith('#/')) out.push(h('a', { href }, inline(label)));
      else if (/^https:\/\//.test(href)) out.push(h('a', { href, target: '_blank', rel: 'noopener' }, inline(label), icon('box-arrow-up-right', 'ext')));
      else out.push(label);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const plain = (s) => s.replace(/\*\*|\*|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

const CALLOUT_ICON = { tip: 'lightbulb', note: 'info-circle-fill', warn: 'exclamation-triangle-fill', important: 'shield-lock' };

/**
 * @param {string} md
 * @param {{ figure: (name: string, caption: string) => Node, calloutTitle: (kind: string) => string }} opts
 * @returns {{ nodes: Node[], headings: {id: string, text: string, level: number}[], text: string }}
 */
export function render(md, opts) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const nodes = [];
  const headings = [];
  const textParts = [];
  const used = new Set();
  let i = 0;
  const idFor = (t) => { let id = slugify(t) || 'seccion'; let n = 2; while (used.has(id)) id = slugify(t) + '-' + n++; used.add(id); return id; };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = /^(#{2,3})\s+(.+)$/.exec(line))) {
      const level = m[1].length;
      const id = idFor(m[2]);
      headings.push({ id, text: plain(m[2]), level });
      textParts.push(plain(m[2]));
      nodes.push(h(level === 2 ? 'h2' : 'h3', { id, tabindex: '-1' }, inline(m[2])));
      i++;
    } else if ((m = /^!\[([^\]]*)\]\(shot:([a-z0-9-]+)\)\s*$/.exec(line))) {
      textParts.push(m[1]);
      nodes.push(opts.figure(m[2], m[1]));
      i++;
    } else if (/^---\s*$/.test(line)) {
      nodes.push(h('hr'));
      i++;
    } else if (/^>\s?/.test(line)) {
      const body = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      const head = /^\[!(tip|note|warn|important)\]\s*(.*)$/.exec(body[0] || '');
      const kind = head ? head[1] : 'note';
      const first = head ? head[2] : body[0];
      const paras = [first, ...body.slice(1)].join('\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
      textParts.push(paras.map(plain).join(' '));
      nodes.push(h('aside', { class: ['callout', 'callout-' + kind] },
        h('span', { class: 'callout-icon', 'aria-hidden': 'true' }, icon(CALLOUT_ICON[kind])),
        h('div', null, h('strong', { class: 'callout-title', text: opts.calloutTitle(kind) }), paras.map((p) => h('p', null, inline(p.replace(/\n/g, ' ')))))));
    } else if (/^\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(rows[1] && /^\|[\s:|-]+\|?\s*$/.test(rows[1]) ? 2 : 1).map(cells);
      textParts.push([head, ...body].flat().map(plain).join(' '));
      nodes.push(h('div', { class: 'table-scroll' }, h('table', { class: 'wiki-table' },
        h('thead', null, h('tr', null, head.map((c) => h('th', { scope: 'col' }, inline(c))))),
        h('tbody', null, body.map((r) => h('tr', null, r.map((c, j) => h(j ? 'td' : 'th', j ? null : { scope: 'row' }, inline(c)))))))));
    } else if (/^\s*(-|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && (/^\s*(-|\d+\.)\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const l = lines[i++];
        if (/^\s*(-|\d+\.)\s+/.test(l)) items.push(l.replace(/^\s*(-|\d+\.)\s+/, ''));
        else items[items.length - 1] += ' ' + l.trim();
      }
      textParts.push(items.map(plain).join(' '));
      nodes.push(ordered
        ? h('ol', { class: 'wiki-steps' }, items.map((t) => h('li', null, h('span', null, inline(t)))))
        : h('ul', { class: 'wiki-list' }, items.map((t) => h('li', null, inline(t)))));
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|>|\||---\s*$|!\[|\s*(-|\d+\.)\s+)/.test(lines[i])) para.push(lines[i++].trim());
      textParts.push(plain(para.join(' ')));
      nodes.push(h('p', null, inline(para.join(' '))));
    }
  }
  return { nodes, headings, text: textParts.join(' ') };
}

/** The words of an article, for searching (captions included, markup left out). */
export function plainText(md) {
  return String(md || '')
    .replace(/!\[([^\]]*)\]\(shot:[^)]+\)/g, '$1')
    .replace(/^>\s?\[![a-z]+\]/gm, '')
    .replace(/^#{2,3}\s+|^>\s?|^\s*(-|\d+\.)\s+|^\|[\s:|-]+\|?\s*$/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*|\*|`/g, '')
    .replace(/\s+/g, ' ');
}

export { fold };
