#!/usr/bin/env python3
"""Technical documentation as PDFs for Google Drive (same names every time, so an
upload replaces the previous version instead of adding a copy).

  python3 tools/docs-pdf/build.py      → dist/documentacion-tecnica/*.html
  node tools/docs-pdf/print.mjs        → dist/documentacion-tecnica/*.pdf

A small Markdown reader (headings, paragraphs, lists, tables, code, quotes,
links, bold/italic) is enough for docs/*.md; anything else is shown as text.
"""
import html, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'dist', 'documentacion-tecnica')
DOCS = [
    ('USER_GUIDE_ES.md', '01 Guía de uso del panel (español)'),
    ('USER_GUIDE_EN.md', '02 Panel user guide (English)'),
    ('GUIA_DESPLIEGUE_NAMECHEAP.md', '03 Guía de despliegue en Namecheap'),
    ('CONTENT_MANAGER.md', '04 Documentación técnica del Administrador de contenido'),
    ('SECURITY_AUDIT.md', '05 Revisión de seguridad (diseño)'),
    ('TEST_REPORT.md', '06 Informe de pruebas'),
]


def inline(s):
    s = html.escape(s, quote=False)
    codes = []
    s = re.sub(r'`([^`]+)`', lambda m: codes.append(m.group(1)) or f'\x00{len(codes) - 1}\x00', s)
    s = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'(?<![\w*])\*([^*\n]+)\*(?![\w*])', r'<em>\1</em>', s)
    s = re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)', lambda m: f'<a href="{m.group(2)}">{m.group(1)}</a>' if m.group(2).startswith(('http', '#', 'mailto')) else m.group(1), s)
    return re.sub('\x00(\\d+)\x00', lambda m: f'<code>{codes[int(m.group(1))]}</code>', s)


def render(md):
    lines = md.replace('\r\n', '\n').split('\n')
    out, i = [], 0
    list_re = re.compile(r'^(\s*)([-*]|\d+\.)\s+(.*)$')

    def lists(i):
        stack = []  # (indent, tag)
        while i < len(lines):
            m = list_re.match(lines[i])
            if not m:
                if lines[i].strip() and stack and len(lines[i]) - len(lines[i].lstrip()) > stack[-1][0]:
                    out[-1] = out[-1][:-5] + ' ' + inline(lines[i].strip()) + '</li>'
                    i += 1
                    continue
                break
            ind, tag = len(m.group(1)), 'ol' if m.group(2)[0].isdigit() else 'ul'
            while stack and ind < stack[-1][0]:
                out.append(f'</{stack.pop()[1]}>')
            if not stack or ind > stack[-1][0]:
                out.append(f'<{tag}>')
                stack.append((ind, tag))
            out.append(f'<li>{inline(m.group(3))}</li>')
            i += 1
        while stack:
            out.append(f'</{stack.pop()[1]}>')
        return i

    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
        elif line.startswith('```'):
            j = i + 1
            while j < len(lines) and not lines[j].startswith('```'):
                j += 1
            out.append('<pre><code>' + html.escape('\n'.join(lines[i + 1:j])) + '</code></pre>')
            i = j + 1
        elif re.match(r'^#{1,6}\s', line):
            n = len(line) - len(line.lstrip('#'))
            out.append(f'<h{n}>{inline(line[n:].strip())}</h{n}>')
            i += 1
        elif re.match(r'^(-{3,}|\*{3,})\s*$', line):
            out.append('<hr>')
            i += 1
        elif line.startswith('|') and i + 1 < len(lines) and re.match(r'^\|[\s:|-]+\|?\s*$', lines[i + 1]):
            cells = lambda r: [c.strip() for c in r.strip().strip('|').split('|')]
            head = cells(line)
            j = i + 2
            rows = []
            while j < len(lines) and lines[j].startswith('|'):
                rows.append(cells(lines[j]))
                j += 1
            out.append('<table><thead><tr>' + ''.join(f'<th>{inline(c)}</th>' for c in head) + '</tr></thead><tbody>'
                       + ''.join('<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in r) + '</tr>' for r in rows) + '</tbody></table>')
            i = j
        elif line.startswith('>'):
            j = i
            buf = []
            while j < len(lines) and lines[j].startswith('>'):
                buf.append(lines[j][1:].strip())
                j += 1
            out.append('<blockquote>' + inline(' '.join(buf)) + '</blockquote>')
            i = j
        elif list_re.match(line):
            i = lists(i)
        else:
            j = i
            buf = []
            while j < len(lines) and lines[j].strip() and not re.match(r'^(#{1,6}\s|```|\||>|(\s*)([-*]|\d+\.)\s)', lines[j]):
                buf.append(lines[j].strip())
                j += 1
            out.append('<p>' + inline(' '.join(buf)) + '</p>')
            i = max(j, i + 1)
    return '\n'.join(out)


CSS = """
@page{ size:Letter; margin:16mm 15mm 18mm; }
body{ font:10.5pt/1.55 'Helvetica Neue',Arial,sans-serif; color:#14202e; margin:0; }
.cover{ border-bottom:3px solid #e8650a; padding-bottom:10px; margin-bottom:18px; }
.cover small{ display:block; font:600 8pt/1.4 Menlo,monospace; letter-spacing:.12em; text-transform:uppercase; color:#a94700; }
.cover h1{ font-size:22pt; margin:6px 0 2px; }
.cover p{ color:#5a6b7d; margin:0; font-size:9pt; }
h1{ font-size:17pt; margin:18px 0 8px; } h2{ font-size:14pt; margin:18px 0 6px; border-bottom:1px solid #cdd7e2; padding-bottom:3px; }
h3{ font-size:11.5pt; margin:14px 0 4px; } h4{ font-size:10.5pt; margin:12px 0 4px; }
h1,h2,h3,h4{ break-after:avoid; }
p{ margin:0 0 7px; } ul,ol{ margin:0 0 8px; padding-left:20px; } li{ margin:2px 0; }
code{ font:9pt Menlo,monospace; background:#eef2f6; padding:0 3px; border-radius:3px; }
pre{ background:#eef2f6; border:1px solid #cdd7e2; border-radius:6px; padding:8px 10px; white-space:pre-wrap; word-break:break-word; break-inside:avoid; }
pre code{ background:none; padding:0; }
table{ border-collapse:collapse; width:100%; margin:6px 0 12px; font-size:9pt; }
th,td{ border:1px solid #cdd7e2; padding:4px 6px; text-align:left; vertical-align:top; word-break:break-word; }
th{ background:#eef2f6; } tr{ break-inside:avoid; }
blockquote{ margin:6px 0 10px; padding:6px 10px; border-left:3px solid #e8650a; background:#fdf3ea; }
a{ color:#a94700; text-decoration:none; } hr{ border:0; border-top:1px solid #cdd7e2; margin:14px 0; }
"""

os.makedirs(OUT, exist_ok=True)
for src, title in DOCS:
    md = open(os.path.join(ROOT, 'docs', src), encoding='utf-8').read()
    page = (f'<!doctype html><html lang="es"><head><meta charset="utf-8"><title>{html.escape(title)}</title><style>{CSS}</style></head><body>'
            f'<div class="cover"><small>Sensum Construcciones · Administrador de contenido</small><h1>{html.escape(title[3:])}</h1>'
            f'<p>Generado de docs/{src} · repositorio cgonzalez2064/SensumRedesign2</p></div>{render(md)}</body></html>')
    open(os.path.join(OUT, title + '.html'), 'w', encoding='utf-8').write(page)
    print('ok', title)
