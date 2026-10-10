# Test report — Content Manager branch

Environment: macOS 26 (Apple M4), PHP 8.2.34 (and 8.5.11 for compatibility),
SQLite 3 (bundled), Apache 2.4.69 + PHP-FPM 8.2 for the production-like run,
Google Chrome (desktop and tablet profiles), WebKit (iPhone 13 profile),
Playwright 1.63, axe-core 4.x, Lighthouse 12, Mailpit 1.31 as the SMTP server.

## Test suites

| Suite | Location | Size |
|---|---|---|
| API integration | `tests/integration/*.test.mjs` | 184 tests in 19 files; each file runs its own PHP server with a throwaway database; some servers deliberately have SMTP down; translation and PageSpeed tests use local stand-ins |
| Browser E2E | `tests/e2e/*.spec.js` | 48 specs × 3 browser profiles (144 runs, 42 skipped by design: phone-only, desktop-only or single-submission tests) |
| Visual regression | `tests/visual/public-site.spec.js` | 22 reference states of the public site vs. the approved `main` |
| Production build | `tests/apache/apache.test.mjs` | 6 checks of the built release under Apache + PHP-FPM |

## Local Test Pass 1 — functional and integration

**Public website:** major pages, navigation and anchors, external links
(`rel=noopener`), images, contact form validation (values kept), mobile menu
(Escape/link/backdrop), project modal (arrows, keyboard, focus return), FAQ,
ES/EN toggle and persistence, privacy and 404 pages, console and network
(no errors), responsive widths 320–1440 (no overflow), animations untouched
(visual suite with forced reveal states).

**Admin:** login, invalid login, logout, protected routes and APIs, content
editing (all 104 fields), contact details, image upload/replace/remove/reorder,
invalid uploads, PDF replacement, password change, invitations, password reset,
Spanish/English, light/dark, phone/tablet/desktop, issue reporting with and
without screenshot, delivery to Mailpit, SMTP failure + retry, error states,
network failure.

**Issues found in Pass 1 and fixed before Pass 2:**

| Found by | Issue | Fix |
|---|---|---|
| Manual review in the browser | Avatar initials showed "C(" for names with punctuation | letters-only initials |
| Manual review | Every bilingual input was announced only as "Español"/"English" | inputs labelled "‹field› Español" |
| Manual review | Long one-line titles were cramped | 2-line box for fields ≥ 80 characters (Enter blocked) |
| Upload testing | Truncated/corrupt images accepted | decoder warnings rejected |
| Phone review | Language/theme switches overflowed sign-in screens at 390 px | responsive placement, icon-only theme options |
| Phone review | Report dialog was not full-width on phones | bottom-sheet rule fixed for wide dialogs |
| Integration tests | Password-change throttle counted policy mistakes | counts only wrong current passwords |
| Integration tests | Report rate limit ran before duplicate detection/screenshot validation | reordered |
| Browser tests | Navigation race could wipe a field the user had just typed in | race-safe routing |
| Browser tests | Contact-details page 31 px too wide on iPhone (long URL in a hint) | wrapping + `min-width:0` |
| Browser tests (axe) | Green "online" badge 4.4:1 contrast | darker green (6.0:1) |
| Browser tests (axe) | `aria-selected` on link tabs | `aria-current` only |
| Content stress test | At maximum lengths the hero label wrapped to 3 lines and the title to 9 lines at 320 px | limits tightened (label 48, title 90, description 180, buttons 30, card text 60) |
| Apache verification | API returned 403 for every call on real Apache | `api/.htaccess` fixed |
| Apache verification | Duplicate/merged headers on uploads and PDFs | fixed |

**Pass 1 result:** API 77/77 · E2E all passing on 3 browser profiles ·
visual 22/22 identical · Apache 6/6.

## Local Test Pass 2 — regression and adversarial (clean state)

**Clean state:** a **fresh `git clone`** set up by following `docs/LOCAL_SETUP.md`
literally (dependencies, `.env`, migrations, first admin, servers, test tools),
a fresh database for every test file, a release built from that clone, and the
visual baseline captured from `main` via `git worktree` as documented.

**Adversarial checks** (in addition to all Pass 1 tests): invalid credentials,
repeated logins / lockout, session expiry (idle and absolute), direct protected
URL access, unauthorized API calls, modified parameters, unexpected and
malformed IDs, method-override headers, missing fields, long strings, special
characters and emoji, HTML/script payloads, email-header injection, invalid and
disallowed URLs, empty fields, malformed JSON and invalid UTF-8, NUL/bidi/
zero-width characters, oversized bodies, unsupported/oversized/corrupt/polyglot
uploads, path-traversal file names, arrays of files, expired/reused/invalid/
superseded reset and invitation links, repeated report submissions, report XSS
viewed in the admin, tampered cookies and swapped CSRF tokens, concurrent saves,
telemetry blocked, SMTP down, read-only database, API completely down (public
site still served), offline save in the browser, small landscape phones.

**Issues found in Pass 2 and fixed:**

| Found by | Issue | Fix |
|---|---|---|
| Following LOCAL_SETUP on a fresh clone | `check` reported publishing/uploads as FAIL before the first publish | checks accept creatable folders |
| Same | Optional checks printed as FAIL | printed as WARN |
| Same | `migrate` said "up to date" on a new database | reports auto-applied migrations |
| Same | Upload tests failed: image fixtures are generated, not committed | generated automatically on first run |
| Fresh-clone test run | Mailpit search pages at 50 messages; e-mail counting tests became unreliable | tests count via `messages_count` |

**Pass 2 result (fresh clone):** API 84/84 · E2E 59 passed / 13 skipped (by design) ·
visual 22/22 · release from the clone 6/6 on Apache. Re-run after the security
fixes: API 84/84 on PHP 8.2 **and** 8.5, E2E 59/59, Apache 6/6.

## Change after the two passes — automatic translation (DeepL)

Added at the owner's request after Pass 2: typing in one language fills the
other for review (see `CONTENT_MANAGER.md` §2a). Tested against a local DeepL
stand-in (`tests/integration/deepl-stub.mjs`) — the real service is never
called by tests.

| Suite | Added | Result |
|---|---|---|
| API (`10-translation`) | off without a key; access control; ES→EN with `*highlights*`, `&` and the company name; EN→ES (ES-419, informal); validation; hostile replies; quota/rate-limit/outage/bad-key handling; key never logged; daily character cap; CLI `check`/`translate:test`; production ignores the test URL | 10/10 |
| Browser (`translate.spec.js`) | auto-fill + review note, Undo, manual edits kept, "Traducir del español", save publishes both (3 devices, axe scan); English-first; revert when the source returns to the saved text; save waits for a pending translation; failure message; no controls without a key | 7 passed, 8 skipped by design |

Full re-run after the change: API **95/95**, browser **66 passed / 21 skipped**,
PHPStan level 6 **0 errors**. The visual regression suite was not re-run for
this change because no public-site file changed (only `admin/`, `cms/`, docs
and tests).

## Change after the two passes — monitoring, error log and critical-error alerts

| Suite | Added | Result |
|---|---|---|
| API (`11-monitoring`) | owner-only access (owner / other admin / editor / anonymous); owner protection; unexpected server error → error-log entry with location, request, reference and user + one alert e-mail (no secrets); cooldown suppression and repeat count; failing health check (once per 15 min); browser errors without alerts; filters, search, paging and hostile filter values; test alert (3/h); PHP fatal-error capture; SMTP down → "failed" → `monitor` re-sends a summary; daily cap; alerts off; retention | 10/10 |
| Existing API suites | dashboard errors now owner-only (the test administrator is the owner); grouped `error_events` replaced by `error_log` | updated, passing |
| Browser | Monitoring page added to the every-screen tour (light/dark, 3 devices, axe, no overflow); owner sees and filters the log; other administrator and editor see no menu entry and are refused | passing |

Issue found and fixed while testing: the log was ordered by insertion order, so
entries carried over from the old table appeared out of time order — now sorted
by time.

Full re-run: API **105/105**, browser **69 passed / 21 skipped**, PHPStan level 6
**0 errors**. Built release on Apache 2.4 + PHP-FPM: **6/6**, plus a critical
error forced under PHP-FPM — the visitor's error response returned in 10 ms and
the alert e-mail was delivered afterwards (`fastcgi_finish_request`), logged with
status "sent".

## Change — owner-only users, access types, monthly report, new report e-mail

| Suite | Added | Result |
|---|---|---|
| API (`04-users`, rewritten) | owner-only management; invitations with access types; validation of permissions; each access type allowed/refused per area (texts, contact, photos, documents, site); item-level photo checks; translation needs `texts`; changes apply on the next request; owner cannot be changed; invitation rate limit | 11/11 |
| API (`12-site-report`) | owner-only; recipients validation; plain-language content from seeded figures (good vs attention, Spanish and English); scheduled check records availability, Google scores (stand-in) once a day; sending with To/Cc/Reply-To and embedded logo; test sends; reminder after day 5 once a month; SMTP failure recorded | 8/8 |
| Browser (`access-report.spec.js`) | owner invites with "Solo fotos y portafolio" and changes to a custom set (axe on the dialog); a "Solo textos" account only sees and opens text; report page: preview, recipients (owner fixed), validation, test e-mail | passing |
| Browser (`admin.spec.js`) | every-screen tour now includes *Informe mensual* (light/dark, 3 devices, axe, no overflow) | passing |

Issues found while testing and fixed: added recipients rendered as
"[object HTMLLIElement]" (array appended to the DOM); availability shown as
"99,0 %" instead of "99 %"; report wording used "(s)" plurals — replaced by
proper singular/plural.

Full re-run: API **117/117**, browser **74 passed / 25 skipped**.

## Change — e-mail settings, contact-form captcha, automatic alerts, admin redesign

| Suite | What it covers | Result |
|---|---|---|
| API (`13-email-alerts`) | owner-only e-mail settings; password re-check; validation and header-injection attempts; SMTP password encrypted at rest and never returned; security notice; panel sender/Reply-To used for all mail; contact form delivered through the handler with the panel settings (visitor in Reply-To, HTML escaped); `mail()` failure → 500 + error log; `EMAIL_SETTINGS_LOCKED`; alert toggles (owner only, allow-list); integrity baseline, new/odd/modified files, cPanel `.htaccess` blocks ignored, accept via panel (password) and CLI; login attack; new device (first device silent, same browser silent); certificate 21/7/1; backup > 48 h; error spike; stopped scheduler via `/api/health`; weekly digest and monthly review once per period; critical-error e-mails switchable | 15/15 |
| API (`14-captcha`) | signed, expiring, never-cached challenge; refused: missing, empty, malformed, oversized, wrong/out-of-range/string number, forged signature, altered expiry, other algorithm, self-made challenge, replay; solved → delivered once; honeypot/too-fast counted; Turnstile: keys validated, secret encrypted, page republished with the site key, token required, rejected/other-site tokens refused, built-in captcha still required, Cloudflare down → built-in only + logged, turned off → removed from the page | 8/8 |
| Browser (`contact-captcha`) | the real public form in Chrome, tablet and iPhone WebKit: captcha solved in the background, message delivered once, new answer prepared; a spent answer is replaced and the message still sent | 4/4 (+2 skipped by design) |
| Browser (`email-alerts`) | Correo page: source badges, unsaved-changes bar, validation, password dialog (axe), save, both test e-mails, Namecheap helper; Monitoring: 12 alert switches persist, file check; performance: English dictionary not downloaded for Spanish users, panel frame kept across screens, screens fetched on demand | 7/7 (+2 skipped) |
| Existing suites | `00-static` (public CSP allows only `challenges.cloudflare.com`), `01-public-site` (pages byte-identical with the new captcha markup, asset version 4), `08-system` | updated, passing |

Full re-run: API **140/140**, browser **85 passed / 29 skipped** (skips are single-browser tests by design).

Admin performance: the panel now loads only its frame and the first screen
(initial JavaScript 309 KB → 130 KB, ≈ 98 KB → 40 KB gzip), the other screens in
the background or when the pointer reaches their menu link; core modules are
preloaded in parallel (`modulepreload`); the English dictionary loads only for
English sessions; the frame is no longer rebuilt on every navigation. A stress
test of 27 rapid navigations showed a single, correct screen and no errors.
Entrance effects use only opacity/transform and are disabled with
*reduce motion* (the browser suite runs with it so accessibility scans see the
settled page).

Production build (`release-20261009-130b052`, 52 public + 151 private files,
820 KB zip, includes `release-manifest.json` with 49 hashed public files) under
Apache 2.4.69 + PHP-FPM 8.2: `tests/apache` **6/6**; the live CSP allows only
`https://challenges.cloudflare.com` beyond the site itself; `assets/.rl-data/`
(captcha replay store) answers 403; the public contact form was sent from real
Chrome and WebKit under that CSP, captcha solved in the background, message
delivered.

Public site: the only visual change is the one-line captcha note under the
form's submit button (+31 px desktop, +52 px phones; screenshots reviewed in
Chrome desktop and phone). The visual baselines in `tests/visual/baseline/`
differ by that line and should be regenerated once approved.

## Change — editable "Servicio de interés" options

| Suite | What it covers | Result |
|---|---|---|
| API (`15-contact-services`) | approved options by default; access = "contact" permission (texts-only 403, anonymous 401); refused: empty list, > 20, empty/short/long/HTML/control-character names, duplicates ignoring case, HTML in English; rename keeps the id, new ids, removal, order; page published at once with escaped texts and ES/EN overrides only where they differ; activity logged; no-change save; edit conflict (409); the public form accepts ids and Spanish names, e-mails the Spanish name, refuses removed or unknown options; restoring the originals gives back the approved page byte for byte | 6/6 |
| Browser (`contact-services`) | add (focus, placed before "Otro"), live titles and preview, move up, remove + undo, duplicate caught before saving, English preview, axe, save, public site in Spanish and English, restore | 1/1 (desktop; the screen itself is also covered on 3 devices × 2 themes by `admin.spec`) |
| Existing suites | `01-public-site` (committed page uses option ids), `access-report` (new menu entry hidden for "Solo textos"), all screens on iPhone (fixed a horizontal overflow caused by long option names) | passing |

Full re-run: API **146/146**, browser **86 passed / 31 skipped**.

## Change — support tickets, demo accounts, monthly report value

| Suite | What it covers | Result |
|---|---|---|
| API (`16-tickets`) | owner sees all with counts, filters and literal search; others only their own (404 for anything else, screenshot included); owner-only edit/status/notes (403); edits validated and recorded (hidden from the reporter); "ask for information" needs a message, e-mails the reporter (escaped HTML, link to the ticket, Reply-To support); notes never reach the reporter; reporter answer reopens and e-mails IT (Reply-To reporter); resolve → e-mail; reopen; close without e-mail; closed takes no replies (409); unread markers and menu badge; first public answer moves "new" to "in progress"; screenshot served with safe headers; `demo-users`: 7 profiles, private 0600 file, permissions per profile, disabled account cannot sign in, reruns reset passwords and add no tickets, refused in production | 11/11 |
| API (`12-site-report`, extended) | tickets of the month (received, resolved, average time, resolved titles, still open), messages received KPI, automatic maintenance section (health checks, file scans, backups, certificate, Google, blocked spam, notices) in Spanish, English and in the e-mail; only known figures shown | 9/9 |
| Browser (`tickets`) | two people in separate sessions: report → IT sees it unread with the menu badge → asks for information (required) → the person sees the guidance and answers → IT adds an internal note and resolves → the person sees "resolved", no note; axe on the ticket screen | 1/1 (desktop) |
| Existing suites | ticket screen added to every-screen checks (3 devices × 2 themes); HTML in report titles/descriptions shown as text in the list and on the ticket | passing |

Full re-run: API **158/158**, browser **87 passed / 33 skipped**.

## Change — protection: two-step sign-in, off-server backups, domain checks, CI

| Suite | Added | Result |
|---|---|---|
| API (`17-protection`) | TOTP setup (password, QR as SVG data URI, wrong code refused, recovery codes once); login becomes two steps (no session after the password; wrong code counted, 5 attempts, challenge single use; replayed code refused); recovery code works once and e-mails the person; disabling needs password + code; policy owner/all/none (owner only, password), a required account can only reach the setup routes (403 elsewhere); owner resets someone else's 2FA (sessions ended, e-mail) but never their own (422); `2fa:reset` CLI; off-server backup: owner-only, password ≥ 12 stored encrypted, AES-256 ZIP e-mailed and **opened with the password** (fails without it), download with password, sent by the scheduled check when due, failure alert; domain check: SPF/DKIM/DMARC/MX and RDAP expiry read from local stand-ins, shown in Monitoring and the report; missing/weak records and an expiring domain alert once | 9/9 |
| Browser (`protection`) | owner forced to enrol at first sign-in (QR, code, recovery codes) and then signs in with a code; Seguridad page saves the backup settings (password confirmation, validation messages) | 2/2 (desktop) |
| Existing suites | 15 automatic alerts (was 12); Seguridad in every-screen checks (3 devices × 2 themes); self-hosted fonts: no third-party requests on the public site, CSP `font-src 'self'` | passing |
| Static analysis | PHPStan level 6 now also in CI | 0 errors |

Full re-run: API **168/168**, browser **92 passed / 37 skipped** (skips by design: phone-only, desktop-only or single-submission tests).

## Change — value for the client: leads, visit statistics, service levels, report trends and PDF

| Suite | Added | Result |
|---|---|---|
| API (`18-value`) | every contact-form message stored (language, notified flag) and linked from the e-mail; unknown fields still refused; `leads` access only (403 for others, owner-only settings); read marking, unread badge; status/amount validation and history; notes kept as typed; filters, literal search, service filter; CSV with BOM, header, filtering and formula neutralisation; retention (allow-listed, privacy notice republished, old leads purged by `monitor`); deletion with pseudonymised log; 200/day cap; visits counted per day without cookies (views, visitors once per day, sources from a fixed list, utm, device, language, clicks), hashes only, no IP or URLs stored; bots/headless/previews, DNT, GPC, prefetch, junk and other origins ignored (403 for foreign origin); daily salt rotation deletes old markers; statistics endpoint with previous period; owner switch removes/adds the script and changes the privacy text; ticket first response (notes excluded), rating rules (reporter only, resolved only, 1–5 integer, once, low rating flagged), response target, auto-close after 7 days; report trends (+50 % vs. previous month, ES/EN), visits-and-contacts section, won amount, first-response and satisfaction lines; PDF download parsed (structure, xref offset, text, escaped note, Windows-1252 accents), owner only, attached to the e-mail and the temporary file removed | 16/16 |
| Browser (`value`) | sales account sees only Prospectos/Estadísticas; filters, search, warning badge, CSV download, contact links (wa.me with 502), status + amount + note with history, axe; statistics page (30 daily bars, sources, funnel, won amount, period switch, no owner switch for sales); public page sends one beacon per view and per WhatsApp click (no cookies, no storage); reporter rates with stars (validation, a11y), IT sees the rating and the service-level strip; report preview trends and PDF download | 10 passed, 5 skipped by design |
| Existing suites | Prospectos, one lead and Estadísticas in every-screen checks (3 devices × 2 themes, axe, no overflow); contact failure now keeps the lead and answers 200 (500 only when nothing could be stored); 8 demo profiles (`demo.ventas`); `leads` in the full access type; report KPI order; `sqlite3` reads in tests wait for the server's write lock | passing |
| Visual regression | public site with `stats.js` added | 20/22 identical; the 2 privacy-notice states differ only by the new statistics/retention paragraphs (intended text change) |
| Static analysis | PHPStan level 6 (now run with `--memory-limit=1G`) | 0 errors |
| Production build on Apache | release `57ede71` (62 public + 245 private files, 1.1 MB zip; no PHPStan, no `phpstan.neon`) under Apache + PHP-FPM; `/api/collect` through the rewrite (204, foreign origin 403), `stats.js` served immutable | 6/6 |

Full re-run: API **184/184**, browser **102 passed / 42 skipped**.

## Other audits

| Audit | Result |
|---|---|
| Security Audit 1 & 2 | see `SECURITY_AUDIT.md` (no critical findings; 9 findings fixed and re-verified) |
| Dependency audit | `composer audit`: no advisories (PHPMailer 6.12.0); `npm audit` (dev tools): 0 |
| Static analysis | PHPStan level 6, PHP 8.1 target: 0 errors (also run in GitHub Actions on every push, with `composer audit` and `npm audit`) |
| Accessibility — admin | axe-core WCAG 2.1 AA on 12 screens + drawer + dialog, light and dark, 3 devices: no serious/critical violations; keyboard navigation, focus management, reduced motion and 44 px targets reviewed |
| Accessibility — public | identical before/after; pre-existing contrast findings on the approved orange labels reported as an optional recommendation |
| Performance | Lighthouse before/after: equal (desktop 99, mobile 84–85 locally with network throttling); +7 KB (main.js/css additions), no extra requests; with photos the LCP stays the hero heading (photos lazy, responsive `srcset`). Outliers were traced to slow Google Fonts responses (affects the approved site equally). Fonts are now self-hosted (no requests to Google; the two Latin files are preloaded). |
| Visual regression | 20/22 identical to `main` (desktop 1440/1280, tablet 768, phones 390/320, ES and EN, modal, menu, form errors, FAQ, 404); the 2 privacy-notice states differ only by the paragraphs that now describe the built-in statistics and the retention period |
| Production build | `tools/build-release.sh` → 48 public files + 133 private files (≈ 700 KB zip), no secrets/dev files; verified under Apache |

## How to re-run

See `docs/LOCAL_SETUP.md` §7–8. In short:

```bash
npm --prefix tests ci && npx --prefix tests playwright install webkit
mailpit &
npm --prefix tests test            # API (≈ 30 s)
npm --prefix tests run test:e2e    # browsers (≈ 4 min)
```
