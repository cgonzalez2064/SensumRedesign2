# Current site baseline (approved design — protected)

This document records the Sensum Construcciones public website **as approved**,
before the Content Manager was added. It is the reference for every later
regression check. It describes git `main` at commit `dff7928`
("Unify all icons sitewide with Bootstrap Icons").

> Rule for all future work: the public site's design, layout, typography,
> colors, animations, image placement, navigation and responsive behavior
> are a protected baseline. The Content Manager adapts to the site, never
> the other way around.

---

## 1. Architecture and tech stack

| Aspect | Finding |
|---|---|
| Type | Single-page marketing site with in-page sections + 2 standalone pages |
| Markup | Hand-written HTML5 (`index.html`, `privacy-notice.html`, `404.html`) |
| Styling | One stylesheet, `assets/main.css` (~54 KB, no preprocessor, no framework) |
| Behavior | One vanilla-JS file, `assets/main.js` (~59 KB, IIFE, no dependencies) |
| Backend | One PHP script, `assets/contact-handler.php` (contact form → `mail()`; optional SMTP hook) |
| Build step | **None.** What is in the repo is exactly what is uploaded. |
| Package managers | None (no `package.json`, no `composer.json`) |
| Fonts | Google Fonts: Oswald 600/700 (headings), Roboto 400/500/600/700 (body). Self-hosting scaffold exists in `assets/fonts/` but is not wired in. |
| Icons | Inline SVG, Bootstrap Icons set (MIT) + 6 custom line-art category illustrations in "Tipos de proyectos" |
| Server | Apache-compatible `.htaccess` (Namecheap shared hosting / cPanel) |
| Database | None |
| Auth | None |
| Analytics / monitoring / 3rd-party scripts | None by design (see `MEASUREMENT-PLAN.md`; the privacy notice states no analytics are used) |
| Preview hosting | GitHub Pages (`https://cgonzalez2064.github.io/SensumRedesign2/`) — static only, no PHP |
| Production target | Namecheap Stellar Plus, `https://sensumconstrucciones.com` |

## 2. Project structure

```
index.html                 the whole site (one page, in-page sections)
privacy-notice.html        Spanish privacy notice (has [PLACEHOLDER] blocks)
404.html                   bilingual not-found page (ErrorDocument)
.htaccess                  HTTPS/canonical redirect, security headers, caching, deny rules
robots.txt / sitemap.xml / site.webmanifest
assets/main.css            all styles
assets/main.js             i18n dictionary + toggle, nav, modal/carousel, reveal, form
assets/contact-handler.php contact form endpoint (validation, honeypot, rate limit, mail)
assets/*.png               logo lockups, logo mark, favicons, app icons, og-image (1200×630)
assets/projects/README.md  manual "data-images" photo-swap instructions
assets/portfolio/          placeholder portfolio PDF (clearly labelled as a sample)
assets/fonts/              optional self-hosting scaffold
sensum-mail-config.example.php   SMTP hook template (real file lives outside public_html)
*.md                       project notes (never uploaded)
```

## 3. Pages, routes and sections

| URL | Content |
|---|---|
| `/` (`index.html`) | Header + sections: `#inicio` (hero), `#nosotros`, `#servicios`, process (no id), `#proyectos` ("Tipos de proyectos" + modal), CTA banner, `#contacto` (info + map card + form), `#faq`; footer; WhatsApp FAB; back-to-top; project modal |
| `/privacy-notice.html` | Legal page, Spanish only, simplified header |
| `/404.html` | Bilingual error page |
| `/assets/contact-handler.php` | POST-only form endpoint (JSON for fetch, HTML fallback without JS) |

Navigation is anchor-based (`#inicio` … `#contacto`), with an
IntersectionObserver highlighting the active desktop link.

## 4. Major components

| Component | Markup hook | Behavior |
|---|---|---|
| Header | `.site-header#siteHeader` | Transparent over hero, `.is-scrolled` (solid) after 24 px; desktop nav, CTA, ES/EN toggle, hamburger |
| Mobile nav | `#mobileNav`, `#navScrim` | Right drawer, focus trap, `inert` background, Esc/backdrop close, focus restore |
| Hero | `#inicio .hero` | Eyebrow, H1 with `<em>` highlight, description, 2 CTAs, 3 check badges, 4-pillar "how we work" panel, animated grid + glows |
| About | `#nosotros` | `.about-art` decorative box (blueprint icon + caption), text, Mission & Vision cards |
| Services | `#servicios` | 6 `.service-card`s with icon, title, description, "Solicitar cotización" link |
| Process | `.process` | 4 numbered steps |
| Types of projects | `#proyectos` | 6 `.project-card`s (4:3, dark gradient, category illustration, tag/title/desc, "Ver detalles"), portfolio PDF button |
| Project modal | `#projectModal` | Dialog with 4:3 carousel (arrows, dots, swipe, keyboard), tag/title/desc, placeholder note; bottom sheet ≤ 560 px |
| CTA banner | `.cta-banner` | Gradient band, title, text, dark button |
| Contact | `#contacto` | Contact list (address, phones, email, hours, Instagram), static map card linking to Google Maps, contact form |
| FAQ | `#faq` | 6 native `<details>` items |
| Footer | `.site-footer` | Brand + blurb + Instagram pill, quick links, services links, contact, copyright + privacy link |
| WhatsApp FAB / Back-to-top | `#whatsappFab`, `#backToTop` | Fixed bottom-left / bottom-right |

## 5. Design system

**Colors** (CSS custom properties in `:root`, sampled from the logo):
`--ink #1c1c1c`, `--charcoal #222`, `--charcoal-2 #3a3a3a`, `--brand-red #f0351f`,
`--brand-orange #f6740a`, `--brand-amber #ffaa0b`, `--brand-gradient`
(red → orange → amber, 135°), grays `#555 / #373737 / #888`, borders `#dfe3e4`,
backgrounds `#f5f5f5 / #fefefe / #fff`, footer `#090909`.
The site is **light-only** (`color-scheme: light`); it has no dark mode.

**Typography:** Oswald (headings, uppercase in cards/sections) and Roboto (body).
Fluid sizes via `clamp()` — hero H1 `clamp(2.4rem, 5.6vw, 4.1rem)`, section titles
`clamp(1.9rem, 3.6vw, 2.7rem)`, CTA banner `clamp(1.8rem, 4vw, 2.6rem)`.

**Spacing/shape:** container `min(92%, 1180px)`; radius `10px` (cards), `14px`
(form/modal), `18px` (about art); shadows `--shadow-sm/md/gold`.

**Motion tokens:** `--ease-out`, `--ease-spring`, `--ease-fluid`, `--ease-glide`;
durations 150 / 300 / 550 ms, carousel step 520 ms.

## 6. Responsive behavior

Breakpoints (all `max-width`): **400, 560, 620, 900, 980 px**.

| Width | Layout |
|---|---|
| > 980 | 3-column services & projects, 2-column contact, 4-column footer, desktop nav |
| ≤ 980 | 2-column services/projects/footer, contact stacks |
| ≤ 900 | Mobile nav (hamburger), about stacks, process 2 columns |
| ≤ 620 | 1-column services/projects |
| ≤ 560 | form rows stack, 1-column footer & process, modal becomes bottom sheet |
| ≤ 400 | header tightening for 320 px screens |

Verified free of horizontal overflow at 320, 390, 768, 1024, 1280 and 1440 px.

## 7. Animations and interactions

* Hero background grid drift (40 s) and floating glows (16 s), disabled for reduced motion.
* Scroll reveal (`.reveal` → `.in-view`, staggered `i0…i5`), `<noscript>` fallback.
* Header becomes solid/translucent after scrolling.
* Card hovers: lift/scale, gradient top bar on services, illustration zoom on projects.
* Project modal: fade + glide-in panel, 10 % drift-and-fade slide transition, discrete swipe.
* Mobile drawer slide-in, hamburger morph.
* WhatsApp FAB pulse, back-to-top reveal after 600 px.
* `prefers-reduced-motion`, `prefers-reduced-transparency` and `prefers-contrast` are honored.

## 8. Image handling (measured)

The site currently has **no photographs**. All visuals are CSS gradients, inline SVG
icons and the logo PNGs. Three photo slots were already designed and promised to
the client (see `Sensum-Construcciones-Actualizacion-Sitio-Web.docx`, section 4):

| Slot | Container | Measured size (CSS px) | Aspect | Fit / crop | Existing hook |
|---|---|---|---|---|---|
| Project card photo (×6) | `.project-card` | 376×282 @1440 · 375×282 @1280 · 340×255 @768 · 359×269 @390 · 294×221 @320 | **always 4:3** | `object-fit: cover`, hover scale 1.06, dark bottom gradient overlay | `.case-photo` CSS already exists; replaces `<span class="illus">` |
| Project modal carousel (per project, 1–n) | `.project-modal-slideshow` | max 640 wide | **always 4:3** | `object-fit: cover` | `data-images="…"` on each card (already implemented in `main.js`) |
| About photo | `.about-art` | 530×420 @1440 · 529×420 @1280 · 417×420 @1024 · 707×420 @768 · 359×420 @390 · 294×420 @320 | **variable 0.70 → 1.68** (height fixed at 420 px) | no photo support yet | — |

Implications for uploads: 4:3 slots can be cropped exactly; the About slot changes
shape with the screen, so a photo there must keep its subject centered with margin
(the client spec asks for 1:1 to 4:5, ≥ 1600×1600 px).

Logo, favicons, app icons and `og-image.png` are brand assets and are **not**
client-editable content.

## 9. Content sources (before the Content Manager)

| Content | Where it lives today |
|---|---|
| All visible copy, ES (server-rendered, crawlable) | `index.html` (each element tagged `data-i18n="key"`) |
| All visible copy, ES + EN (used by the toggle) | `I18N` object in `assets/main.js` (keys mirror the HTML) |
| SEO meta (title/description/OG/Twitter) | `index.html` `<head>` + `I18N` `meta.*`, `og.*`, `twitter.*` |
| Structured data | 2 JSON-LD blocks in `index.html` (business info incl. phones/address/hours/services; FAQ mirroring the visible FAQ) |
| Phones, email, address, Maps URL, Instagram | Hard-coded in `index.html` (contact list, map card, footer, mobile nav, WhatsApp FAB), `I18N` `form.fallback`, `404.html`, `privacy-notice.html` |
| WhatsApp number | `WHATSAPP_NUMBER` in `main.js` + static `href`s |
| Contact-form destination | `TO_EMAIL` constant in `contact-handler.php` |
| Form service options | `index.html` `<select>` + `ALLOWED_SERVICES` allowlist in `contact-handler.php` (must match) |
| Project carousel photos | `data-images=""` attribute per card (all empty) |
| Portfolio PDF | `assets/portfolio/sensum-portafolio-proyectos.pdf` (placeholder) |

The ES/EN dictionary has 159 `data-i18n` usages / 133 unique keys in the HTML; both
languages have identical key sets.

**Contact information (current):** Edificio Ascend, 13 Calle 5-31 Zona 9, Oficina 641,
Guatemala · 2256-7954 / 3481-9804 · WhatsApp +502 3481-9804 ·
contacto@sensumconstrucciones.com · instagram.com/sensumconstruccionesgt ·
Mon–Fri 8:00–17:00, Sat 8:00–12:00.

**External URLs:** Google Fonts, Google Maps search link, Instagram, `wa.me`.

## 10. Forms

One form (`#contactForm`): name, phone, email, service (select), message, honeypot,
load-time stamp. Client validation in `main.js`; server re-validation, origin
allowlist (production domains only), file-based rate limit, honeypot and minimum
completion time in `contact-handler.php`. Locally, submissions are rejected with
`403 origin_not_allowed` unless an `Origin: https://sensumconstrucciones.com`
header is forged (expected — the allowlist is production-only).

## 11. SEO

Canonical `https://sensumconstrucciones.com/`, robots `index, follow`, OG/Twitter
cards, sitemap with 2 URLs, JSON-LD `GeneralContractor` + `FAQPage`. One URL for both
languages (client-side toggle; only Spanish is crawlable — documented decision).

## 12. Security posture (existing)

`.htaccess`: forced HTTPS to a hard-coded canonical host, HSTS, strict CSP with
**no `unsafe-inline`** (`default-src 'self'; script-src 'self'; style-src 'self'
fonts.googleapis.com; img-src 'self' data:; connect-src 'self'; frame-ancestors
'none'` …), `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy,
COOP/CORP, deny rules for `.md/.sql/.env/…` and dotfiles, `Options -Indexes`.
Consequence for any new public code: **no inline scripts, no inline `style`
attributes** — styling must come from classes in `main.css`.

Caching: CSS/JS/images `max-age=2592000, immutable` (cache-busted with `?v=`),
HTML `max-age=0, must-revalidate`, PHP `no-store`.

## 13. Build, deployment and integrations

* No build. Deployment = upload files to `public_html` via cPanel File Manager (see `DEPLOY.md`).
* Cache-busting by bumping `?v=` on `main.css` / `main.js`.
* Integrations: Google Fonts, `mail()` (optional SMTP hook), nothing else.
* No environment variables; config lives in PHP constants.

## 14. Performance and accessibility characteristics

* Page weight is small: HTML 79 KB, CSS 54 KB, JS 59 KB (uncompressed), 2 logo
  images, 6 font files; no images above the fold besides the 44 px logo mark.
* Accessibility work already done: skip link, landmarks, heading outline, focus
  styles, `inert` + focus traps for drawer/modal, `aria-live` for form and carousel,
  error messages not color-only, reduced-motion support.

## 15. What the Content Manager may change vs. must not touch

**Expected to change (minimal, content-only):**

* `index.html`, `404.html`, `privacy-notice.html` become *generated* from templates
  that reproduce them byte-for-byte when content is unchanged (only the `?v=`
  cache-busting numbers differ).
* `assets/main.js`: a small, isolated addition that reads published content
  overrides (ES/EN text, WhatsApp number, carousel photo alt text). No change to
  existing behavior.
* `assets/main.css`: additive rules for an optional About photo (only active when a
  photo exists).
* `.htaccess`: additive deny/routing rules for the new private folders and API.

**Must remain untouched:** layout, components, classes, animations, breakpoints,
navigation labels and structure, the contact form and its handler, the
illustrations (when no photo is set), logos/icons, SEO meta, fonts, colors.

## 16. Areas where unrestricted content could break the design

| Area | Risk | Guard needed |
|---|---|---|
| Hero H1 (`clamp` up to 4.1 rem, uppercase) | very long titles push the hero far down on mobile | tight character limit |
| Buttons (uppercase, no wrap on desktop) | long labels overflow at 320 px | short limits |
| Project card tag/title (uppercase, over a 4:3 box) | long text overflows the card | short limits |
| Hero pillars / badges | small fixed boxes | very short limits |
| FAQ questions | wrap acceptably | moderate limit |
| Any field | `<`/`>` would be interpreted as HTML by the i18n toggle (`innerHTML` when a value contains `<`) | reject `<` and `>` server-side |
| Phones / emails / URLs | broken links, phishing redirects | strict format validation + host allowlists |
| Photos | wrong aspect ratio, huge files, EXIF location data | server-side validation, exact 4:3 crop, re-encode, size variants |

## 17. Visual reference states

Captured with Playwright (system Chrome, reduced motion, reveal animations forced to
their final state) by `tests/visual/public-site.spec.js`:

* Home, ES and EN, at 1440, 1280, 768, 390 and 320 px (full page)
* Project modal open at all five widths
* Mobile navigation open (390 px)
* Contact form validation state (1280 px)
* FAQ item open (768 px)
* Privacy notice and 404 at 1440 and 390 px

Screenshots are stored in `tests/visual/baseline/` (git-ignored, ~12 MB). To
regenerate the baseline from the approved version at any time:

```bash
git worktree add ../sensum-baseline main
php -S 127.0.0.1:8091 -t ../sensum-baseline
BASE_URL=http://127.0.0.1:8091 npm --prefix tests run test:visual:update
```

A re-run against the unchanged site produced 22/22 identical captures, so the
baseline is deterministic.
