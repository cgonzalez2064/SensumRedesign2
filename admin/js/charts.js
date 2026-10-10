/**
 * Small interactive SVG charts for the panel (no library, CSP-safe: no inline
 * style attributes, only CSSOM). Line/area and (stacked) bar charts over days.
 *
 *  - Hover, touch or the keyboard (← → Home End) to read each day's values;
 *    a live region announces them to screen readers.
 *  - Legend buttons show or hide each series.
 *  - Redraws to the available width; a short entrance animation that the
 *    reduced-motion setting turns off (CSS).
 *  - The same numbers are available as a table under "Ver datos".
 *
 *   const c = chart({ type: 'line', labels, series: [{ key, label, values, tone, format }], ... });
 *   card.append(c.el);
 */
import { h, icon, fill } from './dom.js';
import { t, getLang } from './i18n.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  return el;
};
let uid = 0;

/** A "nice" upper bound and step for the y axis (1, 2, 2.5, 5 × 10ⁿ; whole steps for counts). */
function niceScale(max, ticks = 4, integer = false) {
  if (!(max > 0)) return integer ? { max: 1, step: 1 } : { max: 1, step: 0.25 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = (integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]).map((m) => m * mag).find((x) => x >= raw);
  if (integer) step = Math.max(1, Math.round(step));
  return { max: step * Math.ceil(max / step), step };
}

/**
 * @param {object} o
 * @param {'line'|'bar'} o.type
 * @param {string[]} o.labels           one per point (e.g. YYYY-MM-DD)
 * @param {{key:string,label:string,values:(number|null)[],tone?:string,format?:(v:number)=>string,hidden?:boolean}[]} o.series
 * @param {boolean} [o.stacked]         bars stacked
 * @param {boolean} [o.area]            fill under lines
 * @param {number}  [o.yMax]            fixed top (e.g. 100 for percentages)
 * @param {boolean} [o.integer]         counts: whole-number ticks only
 * @param {number}  [o.yMin]            fixed bottom for lines (default 0)
 * @param {(v:number)=>string} [o.yFormat]
 * @param {(label:string)=>string} [o.xFormat]       short axis label
 * @param {(label:string)=>string} [o.titleFormat]   tooltip title
 * @param {{values:boolean[],label:string|((i:number)=>string)}} [o.markers] red dots on the baseline (e.g. days with failed checks)
 * @param {boolean} [o.tipSkipEmpty]   leave series without a value out of the tooltip (category bars)
 * @param {number}  [o.height]
 * @param {string}  o.ariaLabel
 * @param {string}  [o.empty]          shown when every value is empty
 */
export function chart(o) {
  const id = 'ch' + ++uid;
  const height = o.height || 220;
  const series = o.series.map((x, i) => ({ ...x, tone: x.tone || ['brand', 'info', 'ok', 'warn'][i % 4], hidden: !!x.hidden }));
  const n = o.labels.length;
  const yFormat = o.yFormat || ((v) => String(Math.round(v)));
  const xFormat = o.xFormat || ((l) => l);
  const titleFormat = o.titleFormat || xFormat;
  let width = 0;
  let active = -1;
  let entered = false;

  const plot = h('div', { class: 'chart-plot', tabindex: '0', role: 'group', 'aria-roledescription': t('charts.role'), 'aria-label': o.ariaLabel, 'aria-describedby': id + '-help' });
  const tip = h('div', { class: 'chart-tip', hidden: true, 'aria-hidden': 'true' });
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
  const help = h('p', { class: 'sr-only', id: id + '-help', text: t('charts.keys') });
  plot.append(tip);
  plot.style.height = height + 'px'; // reserve the space: no layout jump when it is drawn

  const legend = series.length > 1 ? h('div', { class: 'chart-legend', role: 'group', 'aria-label': t('charts.legend') }, series.map((x) => {
    const b = h('button', { type: 'button', class: 'chart-key', 'aria-pressed': String(!x.hidden) },
      h('span', { class: ['chart-swatch', 'tone-' + x.tone], 'aria-hidden': 'true' }), x.label);
    b.addEventListener('click', () => {
      if (!x.hidden && series.filter((y) => !y.hidden).length === 1) return; // keep one visible
      x.hidden = !x.hidden;
      b.setAttribute('aria-pressed', String(!x.hidden));
      draw();
    });
    return b;
  })) : null;

  const table = h('details', { class: 'chart-data' }, h('summary', null, t('charts.showData'), icon('chevron-down')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table table-compact' },
      h('thead', null, h('tr', null, h('th', { scope: 'col', text: t('charts.day') }), series.map((x) => h('th', { scope: 'col', class: 'num', text: x.label })))),
      h('tbody', null, o.labels.map((l, i) => h('tr', null, h('th', { scope: 'row', text: titleFormat(l) }),
        series.map((x) => h('td', { class: 'num', text: x.values[i] === null || x.values[i] === undefined ? '—' : (x.format || yFormat)(x.values[i]) }))))))));

  const allEmpty = series.every((x) => x.values.every((v) => v === null || v === undefined || v === 0));
  const el = h('figure', { class: 'chart' }, legend, plot, help, live,
    allEmpty && o.empty ? h('p', { class: 'small muted chart-empty', text: o.empty }) : null, table);

  // ------------------------------------------------------------ geometry
  let g = null; // computed on each draw
  const visible = () => series.filter((x) => !x.hidden);

  function draw() {
    if (!width) return;
    const vis = visible();
    let max = 0;
    const min = o.yMin ?? 0;
    for (let i = 0; i < n; i++) {
      if (o.type === 'bar' && o.stacked) max = Math.max(max, vis.reduce((a, x) => a + (x.values[i] || 0), 0));
      else for (const x of vis) if (x.values[i] !== null && x.values[i] !== undefined) max = Math.max(max, x.values[i]);
    }
    const scale = niceScale(o.yMax !== undefined ? Math.max(o.yMax, max) - min : max - min, 4, !!o.integer);
    const top = min + scale.max;
    const ticks = [];
    for (let v = min; v <= top + 1e-9; v += scale.step) ticks.push(v);
    const left = Math.max(28, ...ticks.map((v) => yFormat(v).length * 6.6 + 10));
    const pad = { l: left, r: 12, t: 12, b: 26 };
    const pw = Math.max(10, width - pad.l - pad.r);
    const ph = height - pad.t - pad.b;
    const band = pw / n;
    const xAt = (i) => pad.l + (o.type === 'bar' ? band * (i + 0.5) : n === 1 ? pw / 2 : (pw * i) / (n - 1));
    const yAt = (v) => pad.t + ph - ((v - min) / (top - min)) * ph;
    g = { pad, pw, ph, band, xAt, yAt };

    const svgEl = s('svg', { class: ['chart-svg', !entered && 'chart-enter'].filter(Boolean).join(' '), width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true', focusable: 'false' });
    // Grid and y labels.
    for (const v of ticks) {
      const y = yAt(v);
      svgEl.append(s('line', { class: 'chart-grid', x1: pad.l, x2: pad.l + pw, y1: y, y2: y }));
      const tx = s('text', { class: 'chart-axis', x: pad.l - 8, y: y + 4, 'text-anchor': 'end' });
      tx.textContent = yFormat(v);
      svgEl.append(tx);
    }
    // X labels: as many as fit.
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 70))));
    for (let i = 0; i < n; i += every) {
      const tx = s('text', { class: 'chart-axis', x: xAt(i), y: height - 6, 'text-anchor': i === 0 && o.type !== 'bar' ? 'start' : 'middle' });
      tx.textContent = xFormat(o.labels[i]);
      svgEl.append(tx);
    }
    if (o.type === 'bar') {
      const bw = Math.max(2, Math.min(36, band * 0.7));
      for (let i = 0; i < n; i++) {
        let base = 0;
        for (const x of vis) {
          const v = x.values[i] || 0;
          if (!v) continue;
          const y0 = yAt(o.stacked ? base : 0); const y1 = yAt(o.stacked ? base + v : v);
          svgEl.append(s('rect', { class: `chart-bar tone-${x.tone}`, 'data-i': i, x: (xAt(i) - bw / 2).toFixed(1), y: y1.toFixed(1), width: bw.toFixed(1), height: Math.max(1, y0 - y1).toFixed(1), rx: Math.min(3, bw / 4) }));
          if (o.stacked) base += v;
        }
      }
    } else {
      vis.forEach((x, si) => {
        let d = ''; let area = ''; let open = false; let start = 0;
        for (let i = 0; i < n; i++) {
          const v = x.values[i];
          if (v === null || v === undefined) {
            if (open && o.area && si === 0) area += `L${xAt(i - 1).toFixed(1)},${yAt(min).toFixed(1)}L${xAt(start).toFixed(1)},${yAt(min).toFixed(1)}Z`;
            open = false; continue;
          }
          const p = `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`;
          d += (open ? 'L' : 'M') + p;
          if (o.area && si === 0) area += (open ? 'L' : 'M') + p;
          if (!open) start = i;
          open = true;
        }
        if (open && o.area && si === 0) area += `L${xAt(n - 1).toFixed(1)},${yAt(min).toFixed(1)}L${xAt(start).toFixed(1)},${yAt(min).toFixed(1)}Z`;
        if (area) svgEl.append(s('path', { class: `chart-area tone-${x.tone}`, d: area }));
        if (d) svgEl.append(s('path', { class: `chart-line tone-${x.tone}`, d, pathLength: 1 }));
        // Single points (no neighbour) still need a dot to be seen.
        x.values.forEach((v, i) => {
          if (v === null || v === undefined) return;
          const lone = (i === 0 || x.values[i - 1] === null || x.values[i - 1] === undefined) && (i === n - 1 || x.values[i + 1] === null || x.values[i + 1] === undefined);
          if (lone) svgEl.append(s('circle', { class: `chart-dot tone-${x.tone}`, cx: xAt(i), cy: yAt(v), r: 3 }));
        });
      });
    }
    if (o.markers) {
      o.markers.values.forEach((on, i) => { if (on) svgEl.append(s('circle', { class: 'chart-marker', cx: xAt(i), cy: pad.t + ph, r: 4 })); });
    }
    // Hover guide and highlighted points.
    svgEl.append(s('line', { class: 'chart-cross', x1: 0, x2: 0, y1: pad.t, y2: pad.t + ph, visibility: 'hidden' }));
    const old = plot.querySelector('svg');
    if (old) old.replaceWith(svgEl); else plot.prepend(svgEl);
    entered = true;
    if (active >= 0) show(active, false);
  }

  // ------------------------------------------------------------ interaction
  function show(i, announce = true) {
    if (!g || i < 0 || i >= n) return hide();
    active = i;
    const svgEl = plot.querySelector('svg');
    const x = g.xAt(i);
    const cross = svgEl.querySelector('.chart-cross');
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
    svgEl.querySelectorAll('.chart-hl').forEach((e) => e.remove());
    svgEl.querySelectorAll('.chart-bar').forEach((b) => b.classList.toggle('dim', Number(b.getAttribute('data-i')) !== i));
    const rows = [];
    for (const sx of visible()) {
      const v = sx.values[i];
      if (o.tipSkipEmpty && (v === null || v === undefined)) continue;
      const txt = v === null || v === undefined ? '—' : (sx.format || yFormat)(v);
      rows.push([sx, txt]);
      if (o.type === 'line' && v !== null && v !== undefined) svgEl.append(s('circle', { class: `chart-hl tone-${sx.tone}`, cx: x, cy: g.yAt(v), r: 4.5 }));
    }
    const marker = o.markers && o.markers.values[i] ? (typeof o.markers.label === 'function' ? o.markers.label(i) : o.markers.label) : null;
    fill(tip, h('strong', { text: titleFormat(o.labels[i]) }),
      rows.map(([sx, txt]) => h('div', { class: 'chart-tip-row' }, h('span', { class: ['chart-swatch', 'tone-' + sx.tone] }), h('span', { class: 'grow', text: sx.label }), h('b', { text: txt }))),
      marker ? h('div', { class: 'chart-tip-warn', text: marker }) : null);
    tip.hidden = false;
    const tw = tip.offsetWidth; const th = tip.offsetHeight;
    let left = x + 12;
    if (left + tw > width - 4) left = x - tw - 12;
    tip.style.left = Math.max(4, left) + 'px';
    tip.style.top = Math.max(0, g.pad.t + 4) + 'px';
    if (th > height) tip.style.top = '0px';
    if (announce) live.textContent = titleFormat(o.labels[i]) + ': ' + rows.map(([sx, txt]) => `${sx.label} ${txt}`).join('; ') + (marker ? '; ' + marker : '');
  }
  function hide() {
    active = -1;
    tip.hidden = true;
    const svgEl = plot.querySelector('svg');
    if (!svgEl) return;
    svgEl.querySelector('.chart-cross').setAttribute('visibility', 'hidden');
    svgEl.querySelectorAll('.chart-hl').forEach((e) => e.remove());
    svgEl.querySelectorAll('.chart-bar.dim').forEach((b) => b.classList.remove('dim'));
  }
  const indexAt = (clientX) => {
    const r = plot.getBoundingClientRect();
    const x = clientX - r.left - g.pad.l;
    return o.type === 'bar' ? Math.floor(x / g.band) : Math.round((x / g.pw) * (n - 1));
  };
  plot.addEventListener('pointermove', (e) => { if (g) show(Math.max(0, Math.min(n - 1, indexAt(e.clientX))), false); });
  plot.addEventListener('pointerdown', (e) => { if (g) show(Math.max(0, Math.min(n - 1, indexAt(e.clientX)))); });
  plot.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && document.activeElement !== plot) hide(); });
  plot.addEventListener('focus', () => show(active >= 0 ? active : n - 1));
  plot.addEventListener('blur', hide);
  plot.addEventListener('keydown', (e) => {
    const next = { ArrowLeft: active - 1, ArrowRight: active + 1, Home: 0, End: n - 1 }[e.key];
    if (next !== undefined) { e.preventDefault(); show(Math.max(0, Math.min(n - 1, next))); }
    else if (e.key === 'Escape') { hide(); }
  });

  // Redraw on the next frame, outside the observer's callback (drawing inside it
  // can trigger "ResizeObserver loop" warnings when scrollbars appear).
  let frame = 0;
  const ro = new ResizeObserver((entries) => {
    const w = Math.floor(entries[0].contentRect.width);
    if (!w || w === width) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { width = w; draw(); });
  });
  ro.observe(plot);
  return { el, destroy: () => { cancelAnimationFrame(frame); ro.disconnect(); } };
}

/** Labelled horizontal bars (share of a total), e.g. tickets by status or visits by source. */
export function barList(rows, { labelOf = (k) => k, format = (n) => String(n), total = null, empty = '' } = {}) {
  const entries = Object.entries(rows).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const sum = total ?? entries.reduce((a, [, n]) => a + n, 0);
  if (!entries.length) return h('p', { class: 'small muted', text: empty });
  return h('ul', { class: 'bar-list' }, entries.map(([k, n]) => {
    const share = sum > 0 ? Math.round((100 * n) / sum) : 0;
    return h('li', null,
      h('div', { class: 'bar-head' }, h('span', { class: 'break', text: labelOf(k) }), h('span', { class: 'tiny muted', text: format(n) + ' · ' + share + (getLang() === 'en' ? '%' : ' %') })),
      h('div', { class: 'bar-track', 'aria-hidden': 'true' }, h('span', { class: 'bar-fill', ref: (el) => { el.style.width = Math.max(2, share) + '%'; } })));
  }));
}

