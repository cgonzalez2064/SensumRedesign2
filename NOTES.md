# Sensum Construcciones — redesign notes

## What this is
A modern, responsive rebuild of sensumconstrucciones.com: `index.html` plus
`assets/main.css` and `assets/main.js`. For how to actually put this on
your Namecheap hosting, see **DEPLOY.md** — this file is design/content
background and a running list of what changed.

**Colors and logo come from your actual logo artwork** (`Logo Sensum (1).zip`),
not the old template CSS. The old site's CSS used a navy/gold theme left
over from a generic "Colorlib" template — but your real logo is a red →
orange → amber gradient mark on near-black neutrals, with no blue in it at
all. The palette was re-sampled straight from the logo's pixels:

| Token | Hex | Where it comes from |
|---|---|---|
| `--brand-red` | `#f0351f` | top corners of the logo gradient |
| `--brand-orange` | `#f6740a` | main body of the gradient (also `--brand-gradient` with the two below) |
| `--brand-amber` | `#ffaa0b` | brightest highlight in the logo |
| `--ink` | `#1c1c1c` | replaces the old navy for all dark section backgrounds |
| `--charcoal` / `--charcoal-2` | `#222222` / `#3a3a3a` | matches the logo's "SENSUM" wordmark and the bevel lines on the icon |

Typography stays Oswald (headings) + Roboto (body), matching the live site.
Content (services, mission/vision, stats, contact info) was pulled from the
live site and its portfolio PDF.

## Logo files
Your logo is processed into ready-to-use assets in `assets/`:
- `logo-full-color.png` — full lockup (icon + "Sensum Construcciones"), trimmed, transparent background. Use on light backgrounds.
- `logo-full-inverted.png` — same lockup with the wordmark inverted to light gray so it reads on dark backgrounds; the icon's own colors are untouched.
- `logo-icon.png` — just the mark, trimmed tight, transparent background. Used in the header and footer next to the "Sensum" text, and is the source for the favicons, app icons, and Open Graph image.
- `favicon-16/32.png`, `apple-touch-icon.png`, `icon-192/512.png`, `og-image.png` — all generated from your real logo.

## Latest pass: content review, decluttering, and Instagram placement

**Benchmarked against real competitors.** Looked at how other Guatemalan
construction/remodeling sites present themselves — Cover S.A. (23 years in
business), CiviArq, Innova Constructora, Desarrolladora Baluarte — plus
re-checked your own live site. The consistent pattern: concise About
sections (well under 100 words), service lists that lean on scannable
titles rather than long paragraphs, and social links kept small and
tucked into the footer rather than made a focal point. That confirmed two
things worth fixing here: some sections had duplicated content, and the
single Instagram icon was floating alone in a slot designed for a row of
several icons.

**Removed a literal duplicate.** The homepage showed the same 4 stats
(298 proyectos, 289 remodelaciones, 100% clientes satisfechos, 10+ años)
twice — once in the hero panel, and again in a full "Resultados que
hablan por nosotros" section further down with its own heading. Deleted
the second occurrence entirely; the hero panel already carries that
information the moment someone lands on the page.

**Removed a redundant "why us" block.** The About section had 3 cards
(Evaluación gratuita, Equipo calificado, Trabajo garantizado) that
restated — almost word for word — the 3 badges already shown in the hero
just above ("Evaluación técnica gratuita," "Trabajo garantizado," "Equipo
calificado"). Cut the cards; the claim is still on the page, once, where a
visitor sees it first.

**Tightened the footer bio.** It was a third restatement of "servicios de
diseño y construcción... desde su concepción hasta la entrega final" (the
same idea already covered by the About paragraph and the Mission card).
Replaced it with a short, distinct line ("Diseño y construcción
profesional en Ciudad de Guatemala, con más de 10 años de experiencia")
that adds a trust marker instead of repeating itself.

**Rearranged the Instagram icon (your only current social link).** It was
appearing twice as a bare, unlabeled circle — once in the Contacto
section, once in the footer — in UI components clearly designed for a
row of several icons, so a single one looked like something was missing.
Fixed both:
- **Contacto section:** folded it into the existing address/phone/email/
  hours list as a fifth row (Instagram icon, label, and your real handle
  @sensumconstruccionesgt as a clickable link) — it now reads as one more
  way to reach you, consistent with the rest of that list, instead of a
  leftover icon underneath it.
- **Footer:** turned it into a labeled pill button ("Síguenos en
  Instagram" / "Follow us on Instagram") with your brand-orange outline
  and a fill-on-hover effect, sitting under the footer's About blurb. It
  now reads as an intentional follow-us call to action rather than an
  empty social row waiting for more icons.

If you add Facebook or LinkedIn later, both spots (and the JSON-LD
`sameAs` list) can take more icons/rows without any redesign — just send
me the real URLs.

**Net effect:** the homepage is measurably shorter (one full section and
one 3-card grid removed) with no information actually lost — everything
that was cut was said, once, somewhere else on the page.

**Testing done this pass:** re-verified ES/EN dictionary parity (128
keys each, zero missing) and that every `data-i18n`/`data-i18n-attr` key
in the HTML resolves (zero missing) after removing the dead
`achievements.*` and `about.why*` keys; confirmed no leftover CSS/HTML
references to the removed `.achievements`, `.stat-item`, `.why-us`,
`.why-card`, and `.contact-social` selectors; validated the JSON-LD block
still parses; visually reviewed About, Contacto, and the footer in both
languages and at a mobile width, plus the Instagram pill's hover state
specifically; confirmed zero console/page errors (only the sandbox's
Google Fonts network block, unrelated to this site).

## Previous pass: SEO review, real services content, and Proyectos illustrations

**SEO audit (on-page + structured data):**
- **Title tag** tightened from ~77 to 64 characters so Google stops
  truncating it in search results: "Sensum Construcciones | Construcción y
  Remodelación en Guatemala."
- **Meta description** rewritten to 157 characters (was ~178, over the
  ~155–160 safe range) and now explicitly names "Ciudad de Guatemala" for
  local search intent.
- **JSON-LD structured data**: added a `slogan` field (your real tagline,
  "Tu mejor opción en servicios de construcción") and a full
  `hasOfferCatalog` listing all 6 real services with descriptions that
  match what's on the page — search engines can now show your services
  directly in rich results. The `description` field was also refreshed to
  name all 6 real categories instead of 4 generic ones.
- **Fixed a duplicate `<h2>` in the Contacto section.** The contact form's
  own heading ("Envíanos un mensaje") was a second `<h2>` inside a section
  that already had one ("Contacto") — invalid heading hierarchy for SEO
  and screen readers. Changed to `<h3>`, since it's a subsection.
- Verified: only 2 `<img>` tags on the page, both correctly marked
  decorative (`alt=""` next to visible brand text) with no orphaned
  alt-less images; no other duplicate or skipped heading levels found
  anywhere else on the page.

**Corrected the 6 services to match your real business (the biggest content
accuracy fix in this pass).** I checked the redesigned site's service list
against the actual descriptions on your live site
(sensumconstrucciones.com/services.php) and found the redesign was using
generic, paraphrased names that don't match your real service categories —
two of your real categories ("Aplicaciones Técnicas" and "Instalaciones
Generales") weren't represented at all. Fixed:
- Service 3 renamed from "Ampliaciones" → **"Impermeabilización y
  tratamientos técnicos"** (waterproofing/technical treatments), with a
  new droplet icon.
- Service 5 renamed from "Construcción desde cero" → **"Instalaciones
  generales"** (electrical/plumbing/HVAC/comms), with a new icon.
- Service 6 renamed "Mantenimiento general" → **"Mantenimiento
  preventivo"** to match your site's exact naming.
- All 6 descriptions rewritten with real technical detail sourced from
  your services page (e.g. Remodelaciones now specifically mentions
  fachaletas, texturizado, restauración de pisos y cielo falso —
  Impermeabilización mentions tratamiento de muros húmedos, curado de
  hongo, fisuras y juntas frías) instead of generic marketing language.
- The footer's "Servicios" list and the JSON-LD `hasOfferCatalog` were
  updated to match exactly, so the service names are now consistent
  everywhere on the page.
- The Proyectos section's 6 example-project cards (Remodelación
  residencial, Ampliación comercial, etc.) were intentionally left as-is —
  those represent categories of completed work, not a mirror of the
  services menu, so they don't need to match 1:1.
- Business hours (Mon–Fri, 8:00–17:30, shown in the Contacto section and
  in JSON-LD) — you confirmed these are correct, so no change was needed
  there.

**Added illustrations to Proyectos.** You asked for images on the project
cards; real stock photos aren't reachable from this environment (I tested
every major photo/CDN host and none are network-accessible here, and there's
no image-generation tool available), so with your go-ahead I built 6
custom line-art SVG illustrations instead — one per project card, in your
brand's amber tone, each depicting its category (a house with a renewal
arrow for Remodelación residencial, an expanding building for Ampliación
comercial, a foundation cross-section with rebar for Obra gris y
cimentación, a drafting compass for Diseño arquitectónico, a tower crane
for Construcción desde cero, and a gear with tool marks for Mantenimiento
general). They sit inside each card's existing dark gradient, above a
subtle circular frame, and scale up slightly on hover. This keeps the
cards from being large blocks of flat gradient color and gives Proyectos a
more professional, finished look without using any unverified/stock
imagery.

**Copy polish.** Reworded the hero eyebrow and the "Nosotros" intro
paragraph to name "Ciudad de Guatemala" explicitly (both ES and EN) and
work in the real tagline — small, low-risk changes since they only touch
dictionary values, not markup structure.

**Testing done this pass:** re-verified ES/EN dictionary key parity (134
keys each, zero missing in either direction) and that every `data-i18n` /
`data-i18n-attr` key used in the HTML resolves in the dictionary (zero
missing); validated the JSON-LD block still parses as valid JSON; checked
for zero console/page errors on load (the only failed request in testing
was the Google Fonts stylesheet, blocked by this sandbox's network rules —
not a site bug, it will load normally on your real domain); confirmed all
6 in-page anchor links resolve; visually reviewed the Servicios and
Proyectos sections in both languages, the fixed Contacto heading, the
footer, and a full-page scroll-through screenshot in both languages and at
a mobile width.

## Earlier pass: footer layout + icon audit
- **Fixed a real footer layout bug.** The footer's four columns
  (`grid-template-columns: 1.4fr 1fr 1fr 1.2fr`) weren't just unevenly
  weighted on purpose — the Contacto column was being forced wider than
  its fair share by the long email address text, a classic CSS Grid
  trap (`1fr` tracks don't shrink below their content's natural minimum
  width unless you tell them to). Fixed with `minmax(0, 1fr)` on all
  four columns plus `overflow-wrap: anywhere` on the contact links, so
  the email now wraps onto a second line instead of stretching its
  column. All four columns are now pixel-equal width at every screen
  size (verified programmatically, not just eyeballed).
- **The footer's "Servicios" column was missing 2 of your 6 services**
  ("Construcción desde cero" and "Mantenimiento general" weren't
  linked) — that's also why it looked short and lopsided next to
  "Enlaces." All 6 are listed now.
- **Moved the VisaNet/Aseguradora General trust badges** out from
  under the logo column into their own centered row spanning the full
  footer width, above the copyright bar. They were making that one
  column much taller than the other three, which was the biggest
  visible cause of the "not equally distributed" look.
- **Fixed the WhatsApp button overlapping the copyright text** on
  narrow phone screens, where "Todos los derechos reservados." wraps
  to two lines right where the floating button sits.
- **Full icon audit.** Checked all 53 SVG icons on the page
  programmatically (every one has a valid `viewBox` and actually draws
  something) and re-confirmed visually in both languages, both a
  previous pass and this one — services, about, projects, footer nav,
  footer contact, footer social, and the two trust badges. Nothing was
  broken; the footer's icons (arrows, pin/phone/mail, Instagram,
  VISA/shield) were already rendering, they were just squeezed by the
  layout bug above.
- **Facebook / LinkedIn:** you asked to add these, but since I still
  can't verify the real URLs for Sensum's pages from here, I asked and
  you said not to add them for now — so only the verified Instagram
  link remains in the header, mobile menu, contact section, and
  footer. Send me the real URLs whenever you have them and I'll wire
  them in everywhere (including the page's SEO structured data).

## What's new in this pass
- **Bilingual (ES/EN).** A language toggle sits at the top of the header
  (visible on both desktop and mobile) and switches every piece of visible
  text, the WhatsApp pre-filled message, and the browser tab title —
  without a page reload. The choice is remembered (via `localStorage`) so
  a returning visitor stays on the language they picked. All translation
  strings live in one `I18N` object at the top of `assets/main.js` — that's
  the only place you (or a translator) ever need to edit copy for either
  language.
- **Floating WhatsApp button**, bottom-left, opposite the "back to top"
  button. It opens a chat to **+502 3481-9804** (the mobile number from
  the contact section — see DEPLOY.md if that should be a different
  number) with a pre-filled message in whichever language is active.
- **Trust badges** for VisaNet and Aseguradora General, in the footer.
  These are recreated as icon + text badges rather than the original
  site's logo images, since I don't have a way to fetch and verify the
  real logo files from this environment — swap in the real badge images
  yourself if you have them, or ask and I can add them once you upload
  them.
- **Real contact-form submission.** The form now POSTs to
  `assets/contact-handler.php`, a small PHP script that validates the
  input server-side (never trust client-side validation alone), checks
  the honeypot field, and emails the lead. This needs the one-line email
  address check described in DEPLOY.md step 5 before it'll deliver
  anywhere useful.
- **External CSS/JS.** Styles and behavior now live in `assets/main.css`
  and `assets/main.js` instead of inline `<style>`/`<script>` blocks in
  `index.html`. This means the browser caches them separately from your
  page content (so a text edit to `index.html` doesn't force everyone to
  re-download your entire stylesheet), and it's what lets the Content
  Security Policy in `.htaccess` avoid `'unsafe-inline'` for scripts and
  styles — a real, verifiable line of defense against injected/XSS
  scripts, not just a header for header's sake.
- **`.htaccess` for your real host.** Earlier drafts included Netlify's
  `_headers` and an nginx snippet, which don't apply to Namecheap/cPanel
  (Apache). Those are gone now; `.htaccess` is the one that actually runs
  on your hosting — HTTPS redirect, security headers (including a CSP with
  no `unsafe-inline`), gzip compression, and cache headers for `assets/`.
- **Removed two unverified social links.** Earlier drafts included
  Facebook and LinkedIn URLs for Sensum that I could not verify actually
  belong to your business (I searched and found no confirmation either
  way — only unrelated companies with similar names). Rather than ship
  a guess, I removed them from the header, mobile menu, contact section,
  footer, and the page's structured data, keeping only the Instagram
  profile I could verify
  (`https://www.instagram.com/sensumconstruccionesgt/`). **If you do have
  real Facebook/LinkedIn pages, send me the URLs and I'll add them back**
  — they're worth having for SEO's social-profile signals.
- **Fixed a real form-validation bug found during testing.** The phone
  field's validation pattern used an escape sequence
  (`[0-9+\-\s()]`) that current Chrome/Chromium rejects outright as an
  invalid regular expression under its newer, stricter parsing — meaning
  the phone field silently could never validate as correct in a recent
  browser. Fixed to `[\d\s\(\)+\-]{8,}`, verified working.

## Fixed in earlier passes
- **The logo wasn't showing up** in preview contexts that only had
  `index.html` without its `assets/` folder alongside it. This build now
  assumes `assets/` is deployed next to `index.html` (which it will be,
  following DEPLOY.md) rather than inlining images as data — inlining
  bloats the HTML and defeats normal browser/CDN caching, which matters
  more once this is on real hosting than it did for a quick preview.
- **The Google Maps embed wasn't showing up** in sandboxed preview
  contexts that block third-party iframes. It's a self-contained locator
  card (address + a branded pin, linking out to Google Maps) rather than
  a live embed. If you'd like a live embedded map once this is on your
  real domain, add this into the `.contact-map` div in `index.html` in
  place of the `.map-card` link, and add `frame-src https://www.google.com`
  to the CSP line in `.htaccess`:
  ```html
  <iframe title="Ubicación de Sensum Construcciones en Google Maps"
    src="https://www.google.com/maps?q=13+Calle+5-31+Zona+9,+Ciudad+de+Guatemala&output=embed"
    loading="lazy" referrerpolicy="no-referrer-when-downgrade"
    style="width:100%;height:100%;border:0" allowfullscreen></iframe>
  ```

## Testing done this pass
- Every internal anchor link (`#nosotros`, `#servicios`, etc., desktop and
  mobile nav) verified to resolve to an existing section.
- Every external link (Instagram, WhatsApp, Google Maps) verified to open
  in a new tab with `rel="noopener noreferrer"`.
- Mobile nav open/close, focus handling, and Escape-to-close.
- Scroll-reveal animations, animated stat counters, header scroll state,
  back-to-top button.
- Language toggle: text swap, `<html lang>` update, title swap, WhatsApp
  message swap, persistence across reload.
- Contact form: empty-submit validation, honeypot handling, and a full
  valid submission through to the PHP handler.
- Zero JavaScript console errors on load or during any of the above (the
  only console noise in this sandbox is Google Fonts failing to load,
  which is a sandbox network restriction, not a site bug — it'll load
  normally on real hosting).
- HTML structurally validated (every tag properly opened/closed/nested).

Still worth doing once this is live: a real-browser pass on an actual iOS
Safari and Android Chrome device (emulated testing covers a lot, but not
everything — e.g. iOS's "Add to Home Screen" behavior using
`site.webmanifest`), and a Lighthouse/PageSpeed run against the live URL
once DNS/SSL are in place (see DEPLOY.md step 7).

## SEO
- Semantic HTML5 landmarks (`header`, `nav`, `main`, `section`, `footer`)
  and a single `h1` with a logical heading order.
- Full meta set: description, canonical, robots, Open Graph, Twitter Card,
  and `assets/og-image.png` (1200×630) so shared links preview correctly
  on WhatsApp/Facebook/LinkedIn.
- `GeneralContractor` (LocalBusiness) JSON-LD with address, phone, email,
  geo coordinates, opening hours, and verified social profiles.
- `robots.txt` + `sitemap.xml` included.
- Spanish `lang="es-GT"` by default, switching to `lang="en"` when the
  language toggle is used — screen readers and translation tools pick
  this up correctly since it's the real `<html lang>` attribute, not just
  a visual change.

## Performance
- Zero JS/CSS frameworks (no jQuery/Bootstrap/OwlCarousel/Font Awesome,
  all of which the old site loaded) — vanilla CSS Grid/Flexbox and
  dependency-free JS.
- All icons are inline SVG (no icon-font download, no extra request).
- CSS and JS are external files with long-lived cache headers
  (`.htaccess`), so repeat visits only re-download `index.html` itself.
- Only external requests are Google Fonts (preconnected, `display=swap`
  so text isn't blocked) — everything else is same-origin.
- The contact "map" is a static CSS locator card rather than a live
  iframe, so there's no third-party map script/tileset to load at all.
- Animations only touch `transform`/`opacity` (GPU-friendly, no layout
  thrash); scroll effects are gated behind `IntersectionObserver` instead
  of scroll-event polling.

## Security
- No inline event handlers (`onclick=`, etc.) and no inline
  `<style>`/`<script>` blocks anywhere — everything is in `assets/main.css`
  / `assets/main.js`, attached via `addEventListener`. This is what lets
  `.htaccess` ship a CSP with `script-src 'self'` and `style-src 'self'
  https://fonts.googleapis.com` and no `'unsafe-inline'` on either —
  genuinely narrower than most templated sites.
- All `target="_blank"` links carry `rel="noopener noreferrer"` to prevent
  reverse-tab-nabbing.
- Contact form has a honeypot field, full client-side validation, *and*
  server-side re-validation in `contact-handler.php` (client-side checks
  are a UX convenience, never a security boundary on their own).
- Security response headers (HSTS, X-Content-Type-Options, X-Frame-Options,
  Referrer-Policy, Permissions-Policy, Cross-Origin-*, CSP) are set in
  `.htaccess` — see DEPLOY.md to confirm they're actually being served
  once live (some shared-hosting configs disable `mod_headers`).
- No secrets, API keys, or credentials anywhere in the front-end code.
  `contact-handler.php` uses PHP's built-in `mail()`, so there's no SMTP
  password sitting in a file either.

## Motion / interaction design
Built on Apple's fluid-interface principles: instant `:active` press
feedback on every button, a translucent header that blurs in on scroll, a
mobile nav that opens/closes from the same edge it triggers from,
scroll-reveal and counter animations gated by `IntersectionObserver`, a
WhatsApp button with a subtle pulse, and full support for
`prefers-reduced-motion`, `prefers-reduced-transparency`, and
`prefers-contrast` so the site stays comfortable for every visitor.

## Still worth doing (not done — needs your input)
- **VisaNet / Aseguradora General real logos.** Currently text+icon
  badges (see "What's new" above) since I can't fetch the original
  images from this environment.
- **Facebook / LinkedIn links.** Removed rather than guessed — send me
  the real URLs and I'll add them back everywhere (header, mobile menu,
  contact section, footer, and the JSON-LD `sameAs` list).
- **Real project photos.** The "Proyectos" section still uses styled
  cards rather than photos, to avoid shipping stock/fake images that
  misrepresent actual work. Once you can share real project photos, swap
  them in.
- **Email deliverability upgrade.** See DEPLOY.md step 5 if the baseline
  `mail()` setup lands in spam.

## Files in this delivery
- `index.html` — the page structure and content
- `assets/main.css` — all styling
- `assets/main.js` — all interactivity, including the ES/EN dictionary
- `assets/contact-handler.php` — server-side contact form handler
- `assets/` — logo/icon/OG image files (see "Logo files" above)
- `.htaccess` — security headers, HTTPS redirect, caching, compression for Apache/cPanel
- `robots.txt`, `sitemap.xml`, `site.webmanifest`
- `DEPLOY.md` — step-by-step Namecheap/cPanel go-live guide
- `NOTES.md` — this file
