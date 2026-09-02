# Sensum Construcciones — Redesign & Hardening Pass: Completion Report

Date: 2026-08-28
Scope: full pass across content, IA/UX, accessibility, bilingual SEO, performance, contact-form/PHP security, `.htaccess` headers, and privacy/analytics posture, per the original brief.

A recoverable baseline was committed to git before any edits (`6ce2b6f Baseline: import current site as delivered before rework`), and the full changeset is a second commit (`542f866`) on top of it — nothing was edited without version control in place. All files below have already been written into your project folder.

---

## 1. Change summary

**Content.** Hero, About, Mission, Vision, Services intro, the 4 Process steps, Contact copy, and the primary/secondary CTAs now use the exact approved wording you supplied (Spanish + a matching English translation in the `I18N` dictionary). Every unverifiable claim was removed rather than silently kept: the 298/289 project counters, "100% satisfechos," "trabajo garantizado," the VisaNet and Aseguradora General badges, and the "evaluación técnica gratuita" language are all gone. Nothing was invented to replace them — see `CONTENT-APPROVAL.md` for the full list and what you'd need to confirm to restore any of it.

**Proyectos section.** Relabeled "Tipos de proyectos" since there are no real project photos/case studies to show yet. The first card is now a documented, reusable case-study template (photo, location, scope, summary, optional before/after) ready to receive real projects — no fabricated examples were added.

**IA/UX.** Added a real (placeholder-marked) Spanish privacy notice, a custom bilingual 404 page, a visible phone/email/WhatsApp fallback next to the contact form, and an FAQ section answered only from information already confirmed elsewhere on the site.

**Accessibility.** Fixed a real heading-hierarchy bug (process steps were `h4` under an `h2`, skipping `h3`), added `select`/`summary` to focus-visible styling, wired proper error association (`aria-invalid`, `aria-describedby`, stable IDs) with a focused/announced error summary on failed submission, and fixed a genuine keyboard-trap bug in the mobile menu: closed-drawer links were `aria-hidden` but still reachable by Tab. The drawer now uses `inert` (with a tabindex-based fallback) plus a real focus trap, Escape/backdrop close, and focus restore on close.

**Bilingual SEO.** Kept the single-URL client-side language toggle rather than building separate crawlable `/es/`/`/en/` pages — see §4 below for why, as required. Removed the meta-keywords tag (dead SEO signal), made meta description/OG/Twitter tags update live when the visitor switches language, and added the required documentation that this is *not* independently indexable in two languages.

**Performance.** Trimmed the Google Fonts request to only the weights actually used, removed a permanent `will-change`, added cache-busting `?v=2` to CSS/JS, and — this is the one substantive pre-existing bug worth flagging — found and fixed 27 inline `style="..."` attributes across the site that would have been silently stripped by the site's own Content-Security-Policy in a real browser (the CSP has no `unsafe-inline` for `style-src`), breaking stagger animations and card gradients in production. Replaced them all with CSS utility classes.

**Contact form / PHP backend.** `assets/contact-handler.php` was substantially hardened: strict field allowlist, size/length/UTF-8 checks, control-character stripping, server-side service allowlist, Origin/Referer checking, file-based rate limiting with automatic cleanup, honeypot + minimum-completion-time anti-spam signal, generic JSON error responses, `Cache-Control: no-store`, and an optional authenticated-SMTP upgrade path (`sensum-mail-config.example.php`, credential-free, meant to sit outside the web root). Two real pre-existing bugs were fixed here: the outgoing mail's sender domain was derived from the (spoofable) `HTTP_HOST` header, and the contact form had no `action`/`method`, so it silently broke for any visitor without JavaScript. It now degrades to a real POST with a branded HTML response.

**`.htaccess` / headers.** Fixed a real security bug: the HTTPS redirect reflected the untrusted `HTTP_HOST` header straight into the redirect target, which is an open-redirect/host-injection risk. It now redirects to a hardcoded canonical host only. HSTS, CSP, COOP/CORP, nosniff, frame protection, referrer-policy, and permissions-policy were all kept and documented; backup/config/dotfiles and the rate-limit data directory are now denied; `.html` and `.php` get different cache-control treatment (the form endpoint is `no-store`); a 404 handler was wired in.

**Privacy/analytics.** No analytics was added. `MEASUREMENT-PLAN.md` documents what should eventually be tracked (form success/failure, phone/WhatsApp/Maps clicks, CTA clicks, language toggle) and the consent/disclosure work required before any tag is turned on.

---

## 2. File-by-file change list

| File | Status | What changed |
|---|---|---|
| `index.html` | Modified | Approved copy throughout; removed meta keywords; runtime-updatable meta/OG/Twitter tag IDs; trimmed Google Fonts weights; JSON-LD (dropped unverified `priceRange`) + new FAQPage schema; nav/FAQ/Proyectos/Contact restructuring; all inline `style` attributes removed; accessibility fixes (headings, `role="group"`, `type="button"`, `inert` on the closed drawer, non-breaking phone numbers); cache-busted asset links |
| `assets/main.js` | Modified | Expanded bilingual `I18N` dictionary; meta-tag sync on language switch; full mobile-drawer focus trap/inert handling; contact-form validation, submission, and error-handling rewrite (timeouts, offline detection, duplicate-submit guard, field-level and summary errors); removed old fabricated stat-counter animation |
| `assets/main.css` | Modified | New utility classes replacing every inline style; FAQ, form-summary/fallback, 404, and privacy-page styles; focus-visible fixes; removed unused trust-badge CSS; removed a duplicate selector found by linting |
| `assets/contact-handler.php` | Modified | Full security hardening (see §1); fixed the `HTTP_HOST`-derived sender bug; added HTML-response fallback for no-JS submissions |
| `.htaccess` | Modified | Fixed the Host-header redirect vulnerability; refined caching, added file-protection rules, wired the 404 page; documented HSTS/CSP decisions |
| `sitemap.xml` | Modified | Added `privacy-notice.html`; documented why `404.html` and a separate `/en/` tree are excluded |
| `DEPLOY.md` | Modified | Updated file inventory, SMTP-upgrade steps, and a substantially expanded post-deploy verification checklist |
| `privacy-notice.html` | New | Spanish privacy notice with clearly marked placeholders for anything requiring legal/owner confirmation |
| `404.html` | New | Bilingual custom error page, no JS dependency |
| `CONTENT-APPROVAL.md` | New | Centralized list of every removed/flagged claim and what's needed to restore it |
| `MEASUREMENT-PLAN.md` | New | Analytics/measurement plan; nothing enabled by default |
| `sensum-mail-config.example.php` | New | Optional, credential-free authenticated-SMTP template |
| `assets/fonts/fetch-fonts.sh`, `local-fonts.css`, `README.md` | New | Ready-to-run font self-hosting scaffold (this sandbox's network can't reach `fonts.gstatic.com`, so the actual `.woff2` files couldn't be fetched here — see §4) |

Untouched: `NOTES.md`, `robots.txt`, `site.webmanifest`, all image assets, and the `_to_delete/` folder (pre-existing cleanup from an earlier pass — left alone).

---

## 3. Tests run and results

- **PHP:** `php -l` on `contact-handler.php` and `sensum-mail-config.example.php` — no syntax errors.
- **JS:** `node --check` on `main.js` — valid; `eslint` with `eslint:recommended` — found and fixed 9 `no-inner-declarations` warnings (function declarations nested in `if` blocks; harmless in modern browsers but rewritten as function expressions for cross-engine safety); clean afterward.
- **HTML:** `html-validate` across all three HTML files — found and fixed real accessibility bugs: missing `type="button"` on icon buttons, `hidden-focusable` (the mobile-drawer keyboard trap described above), invalid `aria-label` usage on a non-interactive group, and non-breaking-space issues in visible phone numbers. Final run: 0 problems.
- **CSS:** `stylelint` + `stylelint-config-standard` — 302 findings, effectively all stylistic (rgba-vs-rgb notation, hex length, one-declaration-per-line) that reflect this codebase's existing terse single-line convention; deliberately left as-is rather than reformatting the whole file, so as not to introduce a giant unrelated diff. The one substantive finding — a duplicate `.footer-contact a` selector — was fixed.
- **Structured data / feeds:** JSON-LD validated as well-formed JSON and cross-checked against visible page content; `sitemap.xml` validated as well-formed XML; `site.webmanifest` and `robots.txt` reviewed, unchanged.
- **i18n:** scripted check confirming the Spanish and English `I18N` key sets are identical (no missing translations) and that every `data-i18n`/`data-i18n-html` reference in the HTML resolves to a real key.
- **`.htaccess`:** tag-balance check (all `<IfModule>`/`<FilesMatch>` blocks close correctly). Full Apache-level validation isn't possible in this sandbox — there's no `apachectl`/`httpd` binary here — so this needs the live `curl -I` / securityheaders.com check in `DEPLOY.md`'s post-deploy checklist once it's on real hosting.
- **Form submission:** no real emails were sent (per your instruction not to send test messages without authorization). Validation logic, error-response shapes, and the no-JS HTML fallback path were reviewed by code inspection and manual tracing, not a live network round-trip.
- **Keyboard/focus, mobile-drawer, language toggle, responsive breakpoints (320/390/768/1024/1440px), contrast, touch targets, 200% zoom:** these were verified by careful code review and manual reasoning (e.g., tracing the actual DOM/`inert`/tabindex state through open→trap→close, checking computed contrast ratios against the CSS custom properties, confirming `rem`-based sizing scales with zoom) rather than by driving an actual browser — this session didn't have a live rendering of the site to test against. I'd flag this as the one area of the verification pass that's design-time reasoning rather than measured results, and recommend a quick manual pass in a real browser before launch, especially the mobile drawer and the FAQ keyboard interaction.
- **Lighthouse / PageSpeed:** not obtainable from this sandbox — there's no live deployed URL and no headless-browser run was performed against a local server. Run PageSpeed Insights (or Lighthouse in Chrome DevTools) against the real URL once deployed; `DEPLOY.md`'s checklist has the exact steps. I'm not reporting before/after numbers because I don't have them — reporting estimates would be misleading.
- **Security review:** no secrets in the repo (checked); PHP inputs are allowlisted/length-limited/type-checked; no raw HTML echoing of user input; no `eval`/dynamic includes driven by request data; the Host-header open-redirect and mail-header injection risks found in the original code are both fixed; rate limiting and honeypot/timing checks are in place against spam; no third-party scripts beyond Google Fonts were added.

---

## 4. The bilingual-SEO decision, explained

The brief's preferred approach was distinct crawlable `/es/` and `/en/` URLs with reciprocal hreflang. I kept the existing single-URL client-side toggle instead, and want to be explicit about why: this is a plain static-file site maintained via cPanel File Manager with no build step and no templating. A second full HTML document per page would mean every future content fix, security patch, or copy change has to be made twice, by hand, with a high risk of the two versions silently drifting apart over time — which is worse for both users and search engines than what exists today. Given that tradeoff, I hardened the toggle instead: language switches now update the visible content *and* the meta description, canonical-adjacent OG/Twitter tags, and `og:locale`, and the `<head>` carries an explicit comment stating the decision. I also made sure nothing on the site claims both languages are independently indexable — they aren't; only the Spanish content is crawlable at a distinct, indexable state, and the English toggle is a client-side convenience for visitors, not a second URL search engines will see. If you later want true bilingual SEO, the honest fix is a `/en/` directory of static duplicates (or a lightweight static-site generator), not a deeper client-side trick.

---

## 5. Remaining owner decisions, in priority order

1. **Legal identity for the privacy notice** (`privacy-notice.html`) — legal business name, NIT, and the applicable Guatemalan data-protection framework. The page is live with clearly marked `[PLACEHOLDER]` blocks; it should not go live as final without this.
2. **Whether to restore any removed claims** (project counts, "100% satisfechos," "trabajo garantizado," free-evaluation offer, VisaNet/Aseguradora General badges) — only if you can supply real, verifiable numbers/credentials. Full list and what's needed for each is in `CONTENT-APPROVAL.md`.
3. **Real project case studies** for the "Tipos de proyectos" section — photos, location, scope, and a short summary per project, whenever you have them to share.
4. **SMTP credentials**, if you want mail delivery upgraded from PHP's built-in `mail()` (more reliable, better deliverability) — see `sensum-mail-config.example.php` and `DEPLOY.md` §5.
5. **SPF/DKIM/DMARC DNS records** for `sensumconstrucciones.com`, needed either way for the contact form's outgoing mail to land reliably in inboxes — steps in `DEPLOY.md`.
6. **Font self-hosting** — the CDN Google Fonts link still works today; `assets/fonts/fetch-fonts.sh` is ready to run from any machine with normal internet access to finish migrating to self-hosted files (this sandbox's network couldn't reach `fonts.gstatic.com` to do it directly — see `assets/fonts/README.md`).
7. **Analytics**, if wanted — `MEASUREMENT-PLAN.md` has a recommended approach and the consent/disclosure work required first. Nothing is installed today.

---

## 6. Deployment & rollback

Full step-by-step instructions are in `DEPLOY.md` (rewritten as part of this pass), including the exact file list to upload, the SPF/DKIM/DMARC and optional-SMTP steps, and a post-deploy checklist covering the Host-header redirect, the 404 page, the privacy notice, FAQ keyboard/no-JS behavior, the mobile-drawer focus trap, a no-JS form submission test, and a `curl -sI` header-verification command.

**Rollback:** everything is in git in the cloud workspace, with the pre-change state preserved as the `6ce2b6f` baseline commit and this pass as `542f866` on top — reverting is a straightforward `git revert`/checkout of the baseline if needed. On the hosting side, keep a copy of whatever is live today before uploading (the checklist in `DEPLOY.md` calls this out explicitly).

---

## 7. Final launch checklist

- [ ] Confirm/replace the privacy-notice placeholders (legal name, NIT, applicable framework, retention period, last-updated date)
- [ ] Decide on any claims to restore from `CONTENT-APPROVAL.md`, with real supporting facts
- [ ] Upload the files listed in `DEPLOY.md` §3
- [ ] Add SPF/DKIM/DMARC DNS records (`DEPLOY.md` §5a)
- [ ] Optionally wire up authenticated SMTP (`DEPLOY.md` §5b)
- [ ] Run the post-deploy checklist in `DEPLOY.md` §7 (Host-header redirect test, header verification via `curl -sI`, 404 page, privacy notice, FAQ, mobile drawer, no-JS form submission)
- [ ] Run PageSpeed Insights / Lighthouse against the live URL and address anything it flags
- [ ] Do a manual keyboard-only and mobile pass — Tab through the whole page, open/close the mobile menu, submit the form with invalid then valid data
- [ ] When ready, migrate fonts to self-hosted (`assets/fonts/README.md`)

---

All 15 changed/new files have already been written into your project folder (`sensum-construcciones-redesign Test`). The pre-existing `_to_delete/` folder was left untouched, as it looked like leftover cleanup from an earlier pass rather than something this task needed to act on.
