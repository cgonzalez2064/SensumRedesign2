/**
 * Minimal DOM builder. Text is ALWAYS inserted as text nodes — there is no
 * way to pass raw HTML through h(), which keeps user content (report text,
 * names, site copy) from ever being interpreted as markup.
 */
const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'readOnly', 'multiple', 'indeterminate']);

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (PROPS.has(k)) el[k] = v;
      else if (k === 'ref' && typeof v === 'function') v(el);
      else if (k === 'style' || k === 'html' || k === 'innerHTML') throw new Error('h(): ' + k + ' is not allowed');
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Inline SVG icon from the sprite (decorative: hidden from assistive tech). */
export function icon(name, cls = '') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', ('icon ' + cls).trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', 'icons.svg#i-' + name);
  svg.appendChild(use);
  return svg;
}

let uid = 0;
export const nextId = (p = 'f') => `${p}-${++uid}`;

export function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}
