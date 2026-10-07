# Frontend integration — how managed content reaches the approved site

Goal: **same frontend, same appearance, same interactions — managed content
replacing hard-coded content.** This document lists every change made to the
public site and explains how to keep working on the site's design safely.

---

## 1. Every public-site change (vs. the approved `main`)

| File | Change | Why | Visible effect |
|---|---|---|---|
| `index.html`, `404.html`, `privacy-notice.html` | Now **generated** from `cms/templates/*.tpl`. Committed copies = output with default content. `?v=2` → `?v=3` on `main.css`/`main.js`. In `privacy-notice.html` the address line is no longer wrapped across two source lines. | Content must flow into the pages; cache busting for the changed CSS/JS | None (re-wrap renders identically) |
| `assets/main.js` (+52 lines, existing code unchanged) | Reads published overrides from `<script type="application/json" id="siteContent">` and merges them into the existing `I18N` dictionary (markup only allowed for `hero.title` and `form.fallback`, both built server-side); WhatsApp number override; carousel photos use alt text/srcset from the Content Manager when present | Keeps the ES/EN toggle in sync with the published Spanish page | None with default content (the data block is absent) |
| `assets/main.css` (+9 lines, additive) | Rules for an optional About photo, active only with `.about-art.has-photo` | The client was promised a "Nosotros" photo; no CSS for it existed | None until a photo is uploaded |
| `.htaccess` (+13 lines) | Deny rules for `cms/`, `tests/`, `tools/`, `docs/`, `dist/`, `node_modules/`, `_to_delete/`, `composer.*`, `package*.json`, `*.tpl` | Safety net if private or dev files are uploaded by mistake | None |
| `assets/uploads/.htaccess` (new) | Serves only server-generated image/PDF names; nothing executes; PDFs download with `CSP: sandbox` | Upload hardening | None |
| `assets/error-reporter.js` (new) | Optional public JS error reporting | Telemetry | None — only included when `PUBLIC_ERROR_REPORTING=true` |
| `admin/`, `api/` (new folders) | The Content Manager | — | Not linked from the public site |

Not changed: layout, components, classes, typography, colors, animations,
breakpoints, navigation, icons/illustrations, contact form and its handler,
SEO meta, fonts, logos, `robots.txt`, `sitemap.xml`, `site.webmanifest`.

**Proof:** `tests/integration/01-public-site.test.mjs` checks the default render
is byte-identical to the committed pages; `tests/visual` compares 22 states
(5 widths × 2 languages, modal, mobile menu, form errors, FAQ, privacy, 404)
against screenshots of `main`: 22/22 identical.

## 2. How publishing works

1. `cms/src/Publisher.php` builds a view model from current content: every
   value HTML-escaped for its context (text, attribute, URL, JSON-LD string).
2. `cms/src/Template.php` renders `cms/templates/*.tpl`. Syntax is deliberately
   tiny and cannot run code:
   * `{{name}}` — inserts a pre-escaped value; unknown names abort publishing.
   * `{{#if flag}}…{{else}}…{{/if}}` — chooses between two blocks (e.g. photo vs.
     the approved illustration).
3. Output is validated, the live files are backed up, and each page is replaced
   atomically (see `CONTENT_MANAGER.md` §7).

### Placeholder reference

| Placeholder | Becomes |
|---|---|
| `{{t:<key>}}` | Spanish text of a bilingual field (e.g. `{{t:hero.desc}}`) |
| `{{em:hero.title}}` | Title with `*word*` → `<em>word</em>` (text escaped first) |
| `{{phones_contact_html}}`, `{{phones_footer_html}}`, `{{phones_privacy_html}}`, `{{phone_office_link}}` | `tel:` links in each place's approved format (non-breaking hyphens) |
| `{{email_link}}`, `{{whatsapp}}`, `{{whatsapp_text_url}}` | e-mail link, WhatsApp digits, URL-encoded opening message |
| `{{address_full}}`, `{{address_short}}`, `{{address_map}}`, `{{map_title}}` | the four address formats used by the approved pages |
| `{{maps_url}}`, `{{instagram_url}}`, `{{instagram_handle}}` | validated links (allow-listed hosts) |
| `{{ld:<name>}}` | JSON-encoded string for the structured data blocks |
| `{{#if ld_hours}}` | structured opening hours, kept only while the hours text is the approved one |
| `{{#if has_card_photo:projN}}` / `{{card_photo:projN}}` | project card photo, otherwise the approved category illustration |
| `{{gallery:projN}}` | value of the existing `data-images` attribute |
| `{{#if has_about_photo}}` / `{{about_photo}}` / `{{about_art_class}}` | About photo, otherwise the approved blueprint icon |
| `{{portfolio_href}}`, `{{projects_cta_aria}}` | portfolio PDF link and its accessible label |
| `{{site_content_script}}` | the JSON data block for the language toggle (empty when nothing changed) |
| `{{extra_scripts}}` | optional telemetry scripts (empty by default) |
| `{{asset_version}}` | `?v=` cache-busting number (`Publisher::ASSET_VERSION`) |

### The JSON data block

Only present when something differs from the approved defaults:

```json
{"v":1,
 "i18n":{"es":{"hero.eyebrow":"…"},"en":{"hero.eyebrow":"…","media.proj1.card.alt":"…"}},
 "whatsapp":"50255551234",
 "images":{"assets/uploads/proj1-gallery-…-w1600.webp":{"alt":{"es":"…","en":"…"},"srcset":"… 800w, … 1600w"}}}
```

It is `type="application/json"` (inert — allowed by the existing CSP, which has
no `unsafe-inline`), encoded with `JSON_HEX_TAG` so it can never close its
`<script>` element.

## 3. Photos — how they fit the approved containers

| Slot | Container (measured) | Stored as | Public markup |
|---|---|---|---|
| Project card (×6) | always 4:3, ≤ 376 px wide | cropped to exactly 4:3 with the user's framing; 800 w + 1600 w WebP | `<img class="case-photo">` (CSS already existed) with `srcset`/`sizes`, `loading="lazy"` |
| "Ver detalles" gallery (≤ 10 per project) | always 4:3, ≤ 640 px wide | as above | existing `data-images` mechanism; alt/srcset from the data block |
| Nosotros | 420 px tall, 0.70–1.68 wide depending on screen | original shape, 800 w + 1600 w | `<img class="about-photo">` inside `.about-art.has-photo` (new additive CSS: cover crop + the project-card gradient behind the caption) |

Rules: minimum 1000 × 750 (cards/gallery) or 1000 × 1000 (Nosotros), recommended
1600 × 1200 / 1600 × 1600, JPG/PNG/WebP ≤ 10 MB. Nothing is ever upscaled.
WebP is produced when the server's GD supports it, JPEG otherwise.

## 4. Content limits (stress-tested)

`tests/e2e/public.spec.js` fills **every** field to its maximum with realistic
words and checks 320, 390, 768, 1024, 1280 and 1440 px for page overflow, text
spilling out of cards/buttons/badges, and project titles leaving their 4:3 card.
Hero and project-card limits were tightened after reviewing those screenshots
so the client cannot unintentionally change the approved look:

| Field | Limit | Longest approved text |
|---|---|---|
| Hero label / title / description | 48 / 90 / 180 | 45 / 79 / 144 |
| Hero buttons | 30 | 30 |
| Badges / pillars | 28 / 22 | 23 / 19 |
| Project tag / title / description | 20 / 30 / 60 | 18 / 24 / 55 |
| Service title / description | 50 / 220 | 42 / 163 |
| About description | 500 | 347 |
| FAQ question / answer | 90 / 400 | 57 / 247 |

(Full list: `cms/content/schema.php`.)

## 5. Changing the public site's design later (developer workflow)

The templates are now the source of the three pages.

1. Edit `cms/templates/index.html.tpl` (or `404`/`privacy-notice`) — **not**
   `index.html`. Keep placeholders intact.
2. If you change **copy** in `assets/main.js` (`I18N`) that is also an editable
   field, run `node tools/extract-defaults.mjs` to refresh
   `cms/content/defaults.php` (a test fails if they differ).
3. If you change `assets/main.css` or `assets/main.js`, increase
   `Publisher::ASSET_VERSION` in `cms/src/Publisher.php` (this sets `?v=`).
4. Regenerate the committed pages: `php cms/bin/console render .`
5. Run `npm --prefix tests test` and the visual suite.
6. After deploying, publish once in production (dashboard → "Volver a
   publicar el sitio", or `php ~/sensum-cms/bin/console publish`) so the live
   pages combine the new templates with the client's current content.

If someone edits `index.html` directly on the server, the next publish backs it
up (`storage/backups/published/`) and replaces it; the dashboard reports the
external edit.

## 6. Making another text editable

1. Make sure the element has a `data-i18n="key"` and the key exists in both
   languages of `I18N` in `assets/main.js`.
2. Add the field to `cms/content/schema.php` (type + max), run
   `node tools/extract-defaults.mjs`.
3. In the template replace the Spanish text with `{{t:key}}`.
4. Add the label/help to `admin/js/i18n/es.js` and `en.js` (`fields`).
5. Render, test, commit.

## 7. Optional improvements (not implemented — design decisions for the owner)

| Recommendation | Example | Benefit | Risk | Disruption |
|---|---|---|---|---|
| Self-host Oswald/Roboto (scaffold in `assets/fonts/`) | `<link rel="stylesheet" href="assets/fonts/local-fonts.css">` + drop Google hosts from the CSP | Removes the only render-blocking third party; Lighthouse outliers (desktop 64–71) were all slow Google Fonts responses | Font files must be fetched once and tested | Low (no visual change) |
| Raise contrast of the orange "eyebrow" labels and the small header text on the privacy page | e.g. `--brand-orange` text → `#b84a00` on the light pill | Fixes the only axe "serious" findings on the public site (pre-existing, 9–10 nodes) | Slightly darker orange on labels | Low–medium (visible color change) |
| Hide carousel arrows/dots when a project has a single photo | `.project-modal-slideshow.single .project-modal-nav{display:none}` | Cleaner modal for one-photo projects | None | Low |
| Crawlable English page (`/en/`) | separate generated page + `hreflang` | English SEO | More pages to maintain | Medium |
