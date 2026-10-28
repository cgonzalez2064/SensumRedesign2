# Test report — Content Manager branch

Environment: macOS 26 (Apple M4), PHP 8.2.34 (and 8.5.11 for compatibility),
SQLite 3 (bundled), Apache 2.4.69 + PHP-FPM 8.2 for the production-like run,
Google Chrome (desktop and tablet profiles), WebKit (iPhone 13 profile),
Playwright 1.63, axe-core 4.x, Lighthouse 12, Mailpit 1.31 as the SMTP server.

## Test suites

| Suite | Location | Size |
|---|---|---|
| API integration | `tests/integration/*.test.mjs` | 282 tests in 34 files; each file runs its own PHP server with a throwaway database; some servers deliberately have SMTP down; translation, PageSpeed and `crontab` use local stand-ins |
| Browser E2E | `tests/e2e/*.spec.js` | 93 specs × 3 browser profiles (279 runs, 65 skipped by design: phone-only, desktop-only or single-submission tests) |
| Visual regression | `tests/visual/public-site.spec.js` | 22 reference states of the public site vs. the approved `main` |
| Production build | `tests/apache/apache.test.mjs` | 14 checks of the built release under Apache + PHP-FPM (development and production-like copies) |

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

## Change — icon alignment, monitoring charts, summary monitoring access, translation from the panel

| Suite | Added | Result |
|---|---|---|
| Browser (every screen) | new check: every icon tile and avatar centred and square on all screens and the report dialog (3 devices × 2 themes) — it reproduced the reported e-mail overview offset (9 px) before the CSS fix; Monitoreo del sitio and Traducción added to the screen list | passing |
| API (`19-monitor-translation`) | scheduled check times the home page (HTTP status and ms stored, not counted as downtime); daily series (checks, availability, average response of measured runs, errors by severity, owner-only sign-ins; 7/30/90 days, other values → 30) in the site's time zone; summary endpoint only for the `monitor` access, counts and dates only (no messages/references), status ok → attention after a critical error, full Monitoring still 403; `monitor` in full access and custom choices; translation settings owner-only, password, format check, key encrypted and never returned or logged, connection test with usage and a sample, session flag for editors; plain-label translation for photo editors, site-text keys still need `texts`, HTML refused, no-edit accounts 403; switching off / removing the key disables it | 7/7 |
| Browser (`monitoring`) | owner trends: three charts, failed-check marker, hover/tap tooltip, keyboard End/← and live region, Escape, legend toggle, 7-day range (7 table rows), axe, no console errors; an administrator sees the summary page (status, 4 figures, two charts, no sign-ins/error log/technical text), axe; the owner adds "Monitoreo del sitio (resumen)" to a texts-only account through *Personalizado* and it appears in their menu | 5 passed, 2 skipped by design |
| Browser (`translate`, extended) | contact-form options: Spanish fills English, Undo, the English written by hand is kept, saving waits for the translation; photo descriptions fill the same way; Traducción page shows the key source without revealing it and tests it (usage) | passing |
| Existing suites | photo editors may translate plain labels (503 while off) but not site texts (403); `check` wording; severity filter located by id (charts also mention "gravedad"); charts redraw outside the ResizeObserver callback (WebKit warning) | passing |

| Production build on Apache | release `38a73ec` (67 public + 248 private files, 1.1 MB zip) under Apache + PHP-FPM; the scheduled check times the home page through Apache (HTTP 200); `/api/monitor/series` refuses anonymous requests (401); `admin/js/charts.js` served | 6/6 |

Full re-run: API **191/191**, browser **113 passed / 49 skipped**; PHPStan 0 errors.

## Change — "Ver como" (the owner views the panel as another account)

| Suite | Added | Result |
|---|---|---|
| API (`20-view-as`) | owner only (403 for others); candidates are active/invited non-owner accounts; wrong password 422; owner, disabled, unknown or non-numeric target 422; viewing as a texts-only account: session shows that account (permissions, access type, "by", 30-minute limit), owner-only routes 403, `X-View-As` header; every change refused with `view_only` (content, report, password) and nothing stored; their ticket stays unread; switching without password; leads stay unread, CSV allowed, lead change refused; invited account viewable; going back restores the owner (`X-View-As: 0`), switch then 409; log `started → switched → switched → ended` without the password; the viewed person's own session untouched; expiry and disabling the target drop back to the owner (logged as expired); signing out ends the owner session | 6/6 |
| Browser (`view-as`) | Usuarios → *Ver como…* lists accounts (never the owner), password, the person's dashboard and menu with the blue bar (access type, "solo lectura", minutes left), axe, no horizontal overflow on 3 devices; saving explains it is read-only and stores nothing; switching to the sales account from the bar shows Prospectos/Estadísticas and opening a lead leaves it unread; *Volver a mi cuenta* returns to Usuarios; log order; the row menu entry; an expired view is noticed and the panel reloads as the owner | 4 passed, 2 skipped by design |

| Production build on Apache | release `aee2a4c` (68 public + 250 private files, 1.1 MB zip) under Apache + PHP-FPM; `/api/view-as` answers through the rewrite (401 without a session); `admin/js/viewas.js` served | 6/6 |

Full re-run: API **197/197**, browser **117 passed / 51 skipped**; PHPStan 0 errors.

## Change — access profiles, Salud del sitio, basic statistics, support charts, report wording, form preview, user search

| Suite | Added | Result |
|---|---|---|
| API (`21-profiles-health`, new) | the 9 permissions and 8 ready-made jobs (*Administrador del sitio* without `support`; *Gerencia* = stats + monitor; *Soporte técnico* = support + monitor + site; *Ventas* = leads + stats); terminal-created accounts get the administrator set; basic statistics: visits without contact-form figures (`leads` null, no personal data), Prospectos 403, texts-only 403; uptime 24 h / 7 / 30 / 90 days (percent, checks, failed; `null` without checks), incidents as runs of failed checks (start, end, minutes, checks, ongoing), check names only for the owner; the `support` access lists everyone's requests, changes status, writes internal notes and sets the target, while reporters see only their own (no internal notes); ticket analytics (30 days by day, status mix, type, area, service levels; 30/90/365 only) for managers only; support managers are not administrators (Usuarios and Monitoreo 403); report security note names the reason and the recommendations list the pending clients, backups and open requests; migration `011` adds `stats` only to `leads` holders, once | 6/6 |
| API (updated) | `12-site-report` (new sections, «Protegido» / «Requiere atención» with the reason, local addresses not required to use HTTPS, English subject), `18-value`, `17-protection` (domain lines in *Seguridad y respaldos*), `16-tickets` (10 demo accounts), `04-users`, `19-monitor-translation`, `20-view-as` (the sales account uses the *Ventas* set) | passing |
| Browser (`profiles`, new) | *Gerencia*: menu shows Estadísticas and Salud del sitio only, basic statistics (phone share, page views, no funnel/leads), Prospectos refused; Salud del sitio: 4 uptime tiles, daily-uptime chart, one incident without check names, axe, no horizontal overflow; owner Monitoreo: uptime, «Fallaron: database», daily chart (30 rows, keyboard tooltip), link to the summary; *Soporte técnico*: everyone's requests, *Panorama de soporte* open with KPIs, flow chart (30 → 90 rows), 4 bar lists, fold, axe, Usuarios refused; an administrator sees only their own requests and no overview; Usuarios search (accents/case ignored, e-mail, access label), access and status filters, empty state and «Quitar filtros» | 15/15 (3 devices) |
| Browser (`contact-services`, extended) | the preview replica: phone layout stacks name/phone, tablet puts them side by side, every size scaled to fit the card; unsaved options tagged *Modificada* / *Nueva* in the open list, axe; choosing an option closes the list; «Enviar mensaje» shows the site's messages (`aria-invalid`), then the success note; English keeps the values; nothing is sent to the contact handler; leaving asks first and discards | passing (3 devices) |
| Browser (`profiles`, support) | the response target is chosen inside the overview (8 h saved, back to 24 h) | passing |
| Existing suites | renamed screens and types (*Salud del sitio*, *Redactor*, *Fotos y portafolio*, *Ventas · solo lectura*), Salud del sitio figures, the response chart scrolled into view before hovering (it is now below the uptime section on tablets); the rating test reads satisfaction from the overview | passing |

**Visual review (screenshots of every new screen, desktop and phone) — found and fixed:**

| Issue | Fix |
|---|---|
| Ticket chart axis showed «1, 1, 1, 0, 0» (fractional steps rounded) | whole-number ticks for counts (tickets, errors, sign-ins, visits) |
| Service-level figures shown twice (overview and a separate strip) | one place: the response target moved into *Panorama de soporte*; the strip removed |
| Uptime tiles on phones laid out 1 + 2 + 1 | 2 × 2 grid; the support KPIs also two per row |
| Priority/status badges cut off in the request list on phones | badges wrap under the title |
| «Computadora» preview stacked name and phone, unlike the site | same rule as `assets/main.css` (side by side above 560 px) |
| Basic statistics repeated the page views in two figures | visits note says what a visit is |
| «0 sin atender todavía» | «todas ya tienen atención» |
| The simulated form's labels were not tied to their fields (Spanish-only names in English) | real `<label for>`, error text via `aria-describedby`, `aria-invalid`, named list |


| Production build on Apache | release `3ab8a4a` (68 public + 251 private files, 1.2 MB zip) under Apache + PHP-FPM; migration `011_access_profiles` applied on first request; `/api/reports/analytics` and `/api/monitor/overview` refuse anonymous requests (401); the new admin views served | 6/6 |

Full re-run: API **203/203**, browser **135 passed / 51 skipped**; PHPStan 0 errors.

## Change — Centro de Ayuda (menu «Soporte»), fixed header, phone and tablet review

| Suite | Added | Result |
|---|---|---|
| Browser (`help-center`, new) | menu «Soporte» with the headset icon; page «Centro de Ayuda»; «Mis solicitudes» for everyone, «Gestión de solicitudes» for managers; «Nueva solicitud» opens the request form; breadcrumb; axe; every status filter inside the screen on phones (they wrap), the overview folded on phones and open elsewhere, the person's choice remembered on the device; the top bar stays at the top while the page scrolls and the logo block stays at the top while the side menu (or the phone/tablet drawer) scrolls, both the same height; an English-profile account signing in on a Spanish device gets the whole frame in English | 10 passed, 2 skipped by design |
| Existing suites | `profiles` (new titles, the overview opened first on phones), `access-report` (recipient tags renamed) | passing |

**Phone and tablet review of the module** (320 and 390 px phones, 768 and 1024 px tablets, manager and reporter: list, one request, new-request form) — no horizontal overflow; found and fixed:

| Issue | Fix |
|---|---|
| The request-type pills in the form showed a double border | `.chip` was defined twice (radio pill and recipient tag); the recipient tags now use `.tag` |
| Status filters cut off at the right edge on phones | they wrap |
| On phones the overview pushed the list ~1,500 px down | folded by default on phones (remembered per device) |
| The logo block scrolled away with a long menu; 5 px taller than the top bar | sticky inside the menu, exactly the top bar's height |
| Signing in with an English profile on a device in Spanish left the menu and top bar in Spanish | the frame is rebuilt when the language finishes loading |

| Production build on Apache | release `11d9062` (68 public + 251 private files, 1.2 MB zip) under Apache + PHP-FPM; the new icon is served from the sprite | 6/6 |

Full re-run: API **203/203**, browser **145 passed / 53 skipped**; PHPStan 0 errors.

## Change — monthly report: client version (value of the month) and technical detail

| Suite | Added | Result |
|---|---|---|
| API (`12-site-report`, rewritten) | the owner sends, the `report` access views both versions (preview 200 with `report`/`technical`/`periods`; recipients, sending and PDF 403), content editors 403; client version: headline about the best result, green "Vigilado las 24 horas" pill, summary (uptime, content, monitoring, threats stopped), figures (availability, automatic checks, changes, threats, requests resolved…), sections *Lo más destacado*, *Trabajo realizado*, *Monitoreo y protección*, *Próximos pasos*; the client JSON never contains backups, certificates, DNS/SPF, errors, «Requiere atención» or interruption details (also with no backup and after a critical error); technical detail: *Requiere atención* with the reason, interruption with date/time and failed check, backups, error counts, full service level and maintenance, technical to-dos; English; the sent e-mail carries only the client version | 9/9 |
| API (updated) | `17-protection` (domain lines only in the technical detail), `18-value` (quick answer for clients, low rating only for the team), `21-profiles-health` (client next steps vs. technical to-dos; Gerencia 403; migration `012` grants `report` once to site + monitor accounts, which still match their type), `04-users`, `16-tickets` | passing |
| Browser (`access-report`, `value`) | the owner's preview has *Para clientes* / *Detalle técnico* tabs; the client tab never shows backup or security wording; the technical tab is marked *Interno*, axe; trends checked in the technical tab; a site administrator finds *Estado del sitio → Informe mensual*, sees both tabs and no send or recipients controls, on 3 devices | passing |

| Production build on Apache | release `6ca3c18` (68 public + 252 private files, 1.2 MB zip) under Apache + PHP-FPM; migration `012_report_access` applied on first request; the preview refuses anonymous requests (401) | 6/6 |

Full re-run: API **204/204**, browser **148 passed / 53 skipped**; PHPStan 0 errors.

## Change — first-sign-in welcome, welcome e-mail, «Solicitar soporte» / «solicitud», «Guía de uso»

| Suite | Added | Result |
|---|---|---|
| API (`22-welcome`, new) | a never-used account gets `welcome: true` (Automático by default); `PUT /api/account/welcome` stores language and appearance, keeps the first date, unknown values fall back, 401 without a session; viewing as someone never shows it and refuses the change (`view_only`); accepting an invitation sends one welcome e-mail (access type and permissions in plain words, first steps, support address, safety advice; never the password), in the account's language, naming custom access by its parts; migration `013_welcome` marks accounts that had signed in | 5/5 |
| Browser (`welcome`, new) | the owner invites; the invitation link from Mailpit; on a fresh device the person creates the password and gets the welcome screen (Spanish and Automático preselected, no menu, axe, no horizontal overflow); English switches the screen at once keeping the focus; Dark applies at once; saving lands on the dashboard in English and dark, not shown again after reload; the welcome e-mail arrived with the access and help text | 6/6 (3 devices) |
| Existing suites | new wording (*Nueva solicitud de soporte*, *Enviar solicitud*, *Ver la solicitud*, feminine statuses, e-mail subjects «fue resuelta», e-mail to IT «Enviada por»), seeded accounts marked as past the welcome | passing |

| Production build on Apache | release `d9f8d0d` (68 public + 253 private files, 1.2 MB zip) under Apache + PHP-FPM; migration `013_welcome` applied on first request; the welcome endpoint refuses anonymous requests | 6/6 |

Full re-run: API **209/209**, browser **154 passed / 53 skipped**; PHPStan 0 errors.

## Change — Content Manager on its own address (app.sensumconstrucciones.com)

| Suite | Added | Result |
|---|---|---|
| API (`23-panel-address`, new) | with `ADMIN_URL` on another origin: the panel and the site are both allowed origins, a foreign origin is refused (sign-in and beacons); "Ver sitio" still points to `APP_URL`; invitation, welcome and lead e-mails link to `ADMIN_URL`; the server check prints both addresses; an invalid `ADMIN_URL` falls back to `APP_URL/admin` | 3/3 |
| Production build on Apache (`tests/apache/hosts`, new) | release `14a3b98` untouched (real `.htaccess`) over HTTPS (self-signed) and HTTP with real `Host` headers: http/`www.`/unknown names → canonical `https://` (spoofed Host never reflected); `app.` → `/admin/`, panel CSP/HSTS/noindex, icons and API served, public pages → 301 to the site, missing panel file → 404; apex `/admin*` → 301 to `app.`; on the apex only `health`, `collect` and `telemetry/error` reach PHP, sign-in/session/users/content/setup → Apache 404; production sign-in on `app.` sets `__Host-` Secure HttpOnly SameSite=Strict without `Domain`, foreign origin 403 | 5/5 |
| Existing suites | unchanged behaviour with `ADMIN_URL` empty (local development); the 6 Apache checks on the same release | passing |

Full re-run: API **212/212**, browser **154 passed / 53 skipped**, Apache **11/11**; PHPStan 0 errors.
Also: GitHub Actions crash in `01-public-site` (undici `assert(!this.paused)` on unread response
bodies, Node 22) fixed by always reading bodies in the tests (`9120af2`).

## Change — configurable contact form, recipients in the panel, new privacy notice

| Suite | Added | Result |
|---|---|---|
| API (`24-form-builder`, new) | the approved five questions, limits and recipients (owner can edit, `contact` reads, others 403); rules: name required, e-mail or phone kept and required, no markup, too few / duplicate options, unknown type, 15 questions, number min ≤ max, version conflict; new questions of every type published (legend, radios, `name[]` checkboxes, optional phone with "(opcional)", `data-future` date, number limits, half-width row, ES/EN texts in `siteContent`), ids stable on re-save, service options still in their endpoint; submissions: missing required, unknown option, out-of-range number, past date, unexpected field, list on a non-checkbox → refused; a valid one stored with answers (no phone), e-mail with "Otras respuestas", lead API and CSV; form without e-mail/service → "Llamar a…", removed question refused; older options endpoint in step; recipients: owner only, password, invalid / too many addresses, saved lower-case, security notice, other e-mail settings kept | 7/7 |
| Browser (`contact-form`, new; replaces `contact-services`) | the owner edits service options, adds a required single-choice question, reorders, makes the phone optional (e-mail then locked), removes and undoes, catches a duplicate option, axe with the editor and the "Agregar pregunta" dialog open; the site asks it in ES/EN, checks it, and the visitor's answer appears in Prospectos; the preview (sizes, marked changes, lists, errors, nothing sent, English, leave guard) on 3 devices; recipients with the password | 5 runs |
| Browser (`translate`) | the question's text and its options fill English from Spanish, Undo, own English kept, save waits for translations | 2/2 |
| Visual regression | home ES/EN at 5 widths, modal, menu, FAQ, **form validation**: identical to the approved site (the form is generated now, pixel-identical); only the two privacy-notice states differ (new text) | 20/22 identical |
| Production build on Apache | release `112b540` (68 public + 255 private files): the 11 checks (incl. both hostnames over HTTPS) and a checkbox question saved, published and answered through Apache + PHP-FPM (`q_…[]` list stored as "Google, Recomendación") | 11/11 + smoke |

Full re-run: API **219/219**, browser **155 passed / 55 skipped**, Apache **11/11**; PHPStan 0 errors.

## Change — DeepL quota alert

| Suite | Added | Result |
|---|---|---|
| API (`25-translation-quota`, new; DeepL stand-in with adjustable usage) | below 90 % nothing is sent and DeepL is asked at most every 6 hours; at 90 % one e-mail to the alert address (used / limit / left / plan, what to do, link to Traducción, never the key), not repeated at 95 %, a second one at 100 %; usage going back down starts over; the rule switched off stays quiet; "Probar conexión" checks at once and alerts | 4/4 |
| Existing suites | the new rule listed in Monitoreo (16 switches), `13-email-alerts` counts 16 rules | passing |

## Change — moving photos between installations (`tools/export-photos.php`, `importar-fotos.php`)

| Suite | Added | Result |
|---|---|---|
| API (`26-photo-transfer`, new; three isolated installations) | export carries only active photos (a deleted one stays out), every width, order and both descriptions, and nothing else (no database, settings or keys); refuses a non-empty folder; import simulates without writing, fills only empty slots (a photo uploaded in the panel is kept), files byte-identical, home page published with them, logged once, a second run adds nothing; a damaged file, a path-traversal name, an unknown slot or an unknown option change nothing | 3/3 |
| Rehearsal on a production-like copy (final package, real `.htaccess`, Apache + PHP-FPM) | the real 40-photo bundle: simulation, import, re-run; the 80 files served as `image/webp` with long caching, identical to the local site; integrity check quiet | OK |

## Final pre-production check (2026-10-15)

Run on the final code (only documentation changed after it) before the first upload.

| Check | Result |
|---|---|
| API, PHP 8.2 and PHP 8.5 (production runs 8.4) | 223/223 on each |
| Browsers: Chrome desktop and tablet, iPhone WebKit | 155 passed, 0 failed (55 skipped by design: checks for other devices) |
| Visual regression, public site as packaged | 22/22 (privacy-notice baseline updated to the approved new text) |
| Built release under Apache + PHP-FPM 8.5 and 8.2, both production names over HTTP and HTTPS | 13/13 on each, including certificate checks (`/.well-known/`) passing unredirected on every name and PHP `error_log` files never served (new test; it failed before the `.htaccess` fix) |
| Owner onboarding, production mode (real `.htaccess`, HTTPS on `app.`, the deployment `.env`) | `bin/console check`: required checks OK; `create-admin` rejects short/mismatched passwords and duplicates; first sign-in forces two-step setup (QR, 6-digit code, 10 recovery codes), then the owner manages users; `publish` and the scheduled check run; integrity check quiet with `.well-known/` and `cgi-bin/` kept |
| PHP syntax (73 files, 8.2 and 8.5), PHPStan level 6 | 0 errors |
| `composer audit`, `npm audit` | no advisories |
| Pre-push guard on the outgoing commits | nothing sensitive |
| Production server (read-only) | PHP 8.4.26; DNS of the site, `www.`, `app.` and mail on the hosting; one Let's Encrypt certificate covering the three names |

## Change — search engines (SEO) without changing the visible copy (2026-10-16)

Title, meta description, link-preview tags and structured data now carry the target
searches (constructora, constructora Guatemala, servicios de construcción, remodelaciones,
remodelaciones Guatemala); editable in the panel (Textos del sitio → Google). Old-site
addresses redirect (301) to their section; `/index.html` → `/`; the 404 page uses
root-relative assets. Nothing a visitor sees changes: two visual defects found on the way
(nearly invisible footer headings, the closed drawer's shadow at the right edge on desktop)
are fixed only on the local branch `visual/pie-de-pagina-y-sombra`, kept for a later release.

| Check | Result |
|---|---|
| Visible copy and design unchanged | `assets/main.css` identical to production; page text, image `alt` texts, `aria-label`s and `data-i18n` keys of `index.html`, `404.html` and `privacy-notice.html` identical to `802114e` |
| API integration (27 files) | **232/232**; new `27-seo.test.mjs` (6 tests): target terms in title/description/OG/Twitter/JSON-LD, panel edits reach every tag and both languages without touching the page text, length/HTML limits, dev-router redirects mirror `.htaccess`, 404 at any depth, sitemap/robots/canonical |
| Browser E2E (3 profiles) | **158 passed**, 55 skipped by design, 0 failed; the language-toggle test now also checks the ES/EN title, description and preview tag |
| Visual regression | baseline taken from the version in production (`802114e`) and the new version served the same way: **22/22** twice in a row, and an exact comparison of the 22 captures finds them **pixel-identical** (desktop 1440/1280, tablet 768, phones 390/320, ES and EN, modal, mobile menu, form errors, FAQ, privacy notice, 404). The visual test now starts the contact-form anti-spam check and waits for its final state (before, a full-page capture could catch its note half the time) |
| Built release under Apache + PHP-FPM (real `.htaccess`, HTTP and HTTPS, production `Host` names) | **14/14**; new test: `/index.html`, `/index.php`, `/about`, `/services(.php)`, `/cat`, `/proyects(.php)`, `/contact(.php)` → one 301 to `https://sensumconstrucciones.com/` or its `#section` (fragment not escaped); missing pages are real 404s with their styles |

## Change — user management by site administrators (2026-10-26)

The owner and accounts with the new permission «Gestión de usuarios» (part of
«Administrador del sitio»; migration 015 adds it to accounts that had exactly that type)
can, from Usuarios: correct someone's name and e-mail, send a link to choose a new
password, give a password (typed, or generated: three words and three digits, e.g.
`Lago-Pino-Ruta-472`) that the person replaces at the next sign-in, and require or reset
two-step sign-in. Nobody changes their own account there, the owner is untouchable, and a
manager only reaches people with the same or less access (never «Gestión de usuarios»).
Security design: `SECURITY_AUDIT.md` §21.

| Check | Result |
|---|---|
| API integration (28 files) | **244/244**; new `28-user-management.test.mjs` (12 tests): who manages whom and that nobody gains access through it; e-mail change (password re-typed, sessions end, notices to both addresses, invitation moved to the new address and the old link dead); generated passwords; a given password (manager's password, sessions end, must be replaced before any other call, never in any e-mail; permanent option; invited → active; disabled refused); link for a new password (24 h, single use, not for invited/disabled); two-step sign-in required/not required/reset; password change comes before the two-step set-up; activity log; upgrade of existing accounts. `04-users`, `11-monitoring`, `16-tickets` and `21-profiles-health` follow the new permission |
| Browser E2E (3 profiles) | **167 passed**, 55 skipped by design, 0 failed; new `user-management.spec.js` (3 tests × 3 devices): a site administrator (not the owner) sees the lock on the owner, edits name and e-mail, generates a password (format, «Generar otra», shown once more after saving), the person must create their own at sign-in (no menu until then, nothing e-mailed contains it); requiring two-step sign-in sends the person to the set-up; the link for a new password arrives. Someone whose e-mail an administrator changed while signed in gets the «Tu sesión terminó» dialog with the old address locked, unlocks it with «¿Cambió tu correo? Usar otro» and carries on with the new one. axe (no serious/critical), no side scroll and no console errors on the new screens |
| Visual regression (public site) | **22/22** identical to `main` (baseline re-captured from `main` with `git worktree`; the public site is not touched) |
| Built release under Apache + PHP-FPM | **14/14** (`release-20261026-829456f`, development copy and untouched production copy over HTTP/HTTPS) |
| Found and fixed on the way | On phones a notice at the bottom covered the open actions menu and a tap on it closed the menu (menu above notifications; the page's entrance animation no longer leaves a stacking context behind). The actions menu of the last rows was cut off by the table's rounded box (Usuarios table no longer clips; new check fails without the fix, passes with it). `create-admin` and the demo «Administrador del sitio» account updated to the new rule. While trying it on the local copy: migration 015 compared the permission list as text, so accounts from before migration 011 (stored as `…,monitor,stats,…`) would not have received «Gestión de usuarios»; it now checks the nine permissions in any order (upgrade test covers both orders and a «Administrador del sitio» + support account, which stays as it was) |
| Hands-on walkthrough (2026-10-26) | **26/26** checks with a manager, the owner and four fictitious people on a throwaway server, desktop and phone (screens in `docs/private/users-demo/recorrido/`, not in the repository). Fixed on the way, each with a test that fails without the fix: the «Tu sesión terminó» dialog kept the old e-mail locked after an administrator changed it (now «¿Cambió tu correo? Usar otro»: same account carries on without losing the screen; another account starts from Inicio); changes to other people's accounts did not show in «Actividad reciente» (now shown, with whose account); after a dialog opened from a row menu, keyboard focus fell to the top of the page (now back on that row's ⋮, also after the list is redrawn or two dialogs in a row); the expired-link screen always said «60 minutos» (24 h when an administrator sent it) |

## Change — accounts and automations (2026-10-26)

Usuarios: «Revisar» filters (and `?revisar=` links), access requests answered in one click,
temporary access with an end date, close someone's sessions, «Ver actividad», a message
ready to send with a given password (which now expires after 72 h), and a hint for
mistyped e-mail domains. Inicio → «Accesos». «Actividad» (history with filters, paging and
export). Seguridad → Cuentas (unused accounts, leaked passwords, remembered browsers) and
two-step sign-in for whoever administers. Mi cuenta → «Pedir más acceso». Prospectos →
person in charge, assignment by service, follow-up reminder, Monday summary and the
visitor's confirmation (off by default). Design: `SECURITY_AUDIT.md` §22.

| Check | Result |
|---|---|
| API integration (29 files) | **258/258**; new `29-automations.test.mjs` (14 tests): temporary passwords (expiry, message to send in the person's language, never e-mailed), temporary access (validation, turned off at the next request without the scheduled check, owner told, reactivation), closing sessions (also forgets remembered browsers; who-may-manage rules), access requests (only what is missing, replaces the pending one, grant/decline with manager rules, notices), Inicio → Accesos, Actividad (kinds by access, a person's history, dates, paging), "admins" two-step policy and remembered browsers (allowed / not, same vs other browser, forget, turned off), leaked passwords against a local range-API stub (only 5 hash characters leave; unreachable = allowed), invitation reminder (fresh link, old one dead, once) and expiry/acceptance notices, temporary-access warnings (once), unused accounts (warning, sign-in clears it, turned off, never the owner), lead assignment by service from either language, hand-overs, «Mis prospectos», 48 h reminder (once) and the Monday summary (once a week), the visitor's confirmation (off by default, placeholders, Reply-To, once per address in 10 minutes) |
| Browser E2E (3 profiles) | **179 passed**, 61 skipped by design, 0 failed; new `automations.spec.js` (6 tests): Inicio → Accesos → granting a request; `?revisar=` tabs (a menu on phones); inviting with temporary access and the typo hint; the message to send (copied); Actividad from Usuarios, filters and the export file; a screen you can't open → «Pedir acceso» → Mi cuenta; Seguridad → Cuentas; Prospectos automation, person in charge and the visitor's confirmation; remembering a browser for two-step sign-in. axe (no serious/critical) and no side scroll on the new screens. Existing specs follow the intended changes (the "No tienes acceso…" screen, status tabs instead of a menu, buttons that now appear twice) |
| Visual regression (public site) | **22/22** identical to the approved baseline (the contact form's handler changed, its pages did not) |
| Built release under Apache + PHP-FPM | **14/14** after updating the previous copies the way the deploy guide does (rsync without `.env`/storage, then `publish`): migration 016 applied on the existing databases; `bin/console automations` runs from the release |
| Static analysis | PHPStan: no errors |
| Hands-on walkthrough | 26/26 again (user management, with the focus checks) and the design review of every new screen on desktop, phone and dark mode (`docs/private/automations-demo/`) |
| Found and fixed on the way | On iPhone (WebKit), focusing the row's ⋮ before opening a dialog made typing land in another field: the menu no longer moves focus; the dialog remembers which ⋮ opened it and gives focus back there on close. A screen you can't open crashed the panel's router (inline `style`, refused by the CSP) — now a class. Status badges stretched when a note followed them. On phones the eight filter tabs became a «Mostrar» menu. The visitor's confirmation moved from Formulario (whose save bar publishes the site) to Prospectos. Wording: «Copiar contraseña» next to «Copiar mensaje», «Todo lo demás» instead of a label easy to confuse with the service «Otro», no duplicated name in Actividad |

## Change — fewer roles, «Más secciones», removing registered devices, statistics report (2026-10-26)

Four roles instead of nine profiles (Administrador, Editor del sitio web, Ventas y
prospectos, Consulta) plus optional extra sections, with migration `017_roles` (nobody
loses access; `bin/console roles` / `roles:rollback`). «Más secciones»: every section of
the panel, the ones you can ask for with one click (from the menu, Inicio, Mi cuenta and a
screen you can't open). «Actualizar información» (was «Editar nombre y correo»).
«Quitar dispositivos registrados» (by a manager, by the person or from the console): the
next sign-in asks for a code sent by e-mail, then the new device (`018_device_reset`).
Estadísticas: 7/30/90 days, this month, a month or chosen dates, one service for the
messages, «Exportar» (CSV, or print/PDF) and «Enviar por correo» (a branded report, CSV
attached, totals only). Design: `SECURITY_AUDIT.md` §23.

| Check | Result |
|---|---|
| API integration (30 files) | **266/266**; new `30-roles-devices-stats.test.mjs` (8 tests): the session's role and extra sections; `017_roles` on older access sets (Redactor, Fotos, Gerencia, Soporte, a mix, only `site`) — nothing taken away, never Administrador, owner untouched — then `roles` and `roles:rollback` (an account corrected by hand is kept) and the SQL rollback; `users`/`support` can't be requested and a request already covered goes away; removing your own devices (every session ends, notice), the e-mail code (masked address, not in the subject), «Reenviar código» (old code dead, 3 sends), the new device required before anything else, then the app again; e-mail codes expire after 10 minutes and five tries; statistics presets, chosen dates (validated), one service; the spreadsheet (totals only, no personal data; "Consulta" without the message figures); the report by e-mail (validation, ≤ 5, one message each, chosen parts, message, CSV attached, logged). Existing tests follow the intended changes (four roles, «Quitar dispositivos registrados», demo accounts per role) |
| Browser E2E (3 profiles) | **186 passed**, 63 skipped by design, 0 failed; new `sections-stats.spec.js` (3 tests): «Más secciones» from the menu and Inicio, asking with one click (section ticked, «Solicitado»), Mi cuenta and a closed screen lead there; Estadísticas period filters (chosen dates checked), the CSV download and the report by e-mail; removing your own devices from Mi cuenta → e-mail code → new device. `protection.spec` covers the same flow when IT removes someone's devices (with «Reenviar código»). Role picker: four roles, extra sections folded, an older access keeps its sections. axe (no serious/critical) and no side scroll on the new screens |
| Visual regression (public site) | **22/22** identical to the approved baseline (the public site did not change) |
| Built release under Apache + PHP-FPM | **14/14** (`dist/release-20261026-68055bc`) after updating the previous copies the way the deploy guide does (copy of the program, rsync without `.env`/storage, `publish`): `017_roles` and `018_device_reset` applied on the existing databases; three older accounts in the production-like copy moved onto a role without losing anything, listed by `roles`, undone by `roles:rollback`; the previous program put back over the migrated database still passes its host tests (8/8) |
| Static analysis | PHPStan: no errors |
| Design review | Every new screen checked in the browser (desktop and phone): the statistics bar was reorganised (period left, actions right; full width on phones), the report e-mail shows only the days with visits |
| Found and fixed on the way | An older access (no complete role) lost its sections when another role was ticked: they now stay as extra sections. Pending requests already covered by a role change kept showing in Usuarios: now closed by themselves. Administrators saw «Más secciones» only for «Gestión de solicitudes de soporte»: that section, like «Gestión de usuarios», is now given only by the owner. The e-mail code field said «the number the app shows»: it now has its own hint |

## Change — the panel's wiki (2026-10-27)

`app.sensumconstrucciones.com/wiki` (`#/wiki`, replacing *Guía de uso*): 22 articles in 7
categories, in Spanish and English, with real screenshots of every screen in both
languages, light and dark, computer and phone (208 WebP, `tests/wiki/shots.mjs`, fictitious
data). Search, «Para tu rol / Todo el panel», «En esta página», «Preguntar a soporte» on
marked text, and «Novedades» shown once to whoever can use each new feature. Design:
`SECURITY_AUDIT.md` §24; how to keep it current: `cms/wiki/README.md`.

| Check | Result |
|---|---|
| API integration (31 files) | **271/271**; new `31-wiki.test.mjs` (5 tests): every article in both languages with the same front matter, every `` `UI label` `` a text the panel really shows, every `wiki:` link and every screenshot variant present, no HTML; «Novedades» unique and pointing at real articles; only signed-in accounts read the wiki (401), owner-only articles hidden from others, `allowed` per role, English texts; screenshots private (`Cache-Control: private`, ETag/304), nothing outside the folder (404); «Novedades» only for whoever can use them, once, never older than the account; `/wiki` → the panel |
| Browser E2E (3 profiles) | **185 passed**, 63 skipped by design, 10 failed in the first full run — all in `translate.spec.js`, whose own server showed the «Novedades» dialog over the editor; with `WIKI_NEWS=off` there too, that spec passes (**11 passed**, 0 failed). New `wiki.spec.js` (3 tests × 3 devices, all passing): the menu item, «Para tu rol / Todo el panel», accent-insensitive search with highlights, an article with steps and UI labels, screenshots following the chosen device and the theme, marking text → «Preguntar a soporte» → a request with the topic and the quote, a role's locked article with «Pedir acceso» (opened from `/wiki/<slug>`), and the «Novedades» dialog (prepared answers: counter, next, «Ver cómo funciona», seen marks). axe (no serious/critical) and no side scroll |
| Visual regression (public site) | **22/22** identical |
| Built release under Apache + PHP-FPM | **14/14** (`dist/release-20261027-d2c9524`, 8.8 MB with the screenshots) after updating both previous copies the way the deploy guide does; `019_wiki` applied on the existing databases (also on the copy whose roles had been rolled back). On the panel's address `/wiki` and `/wiki/<artículo>` go to the panel (302), `/wiki` on the public site is 404, and the wiki's API and screenshots answer 401 without a session; nothing of the wiki is inside `public_html` |
| Static analysis | PHPStan: no errors |
| Design review | Home, articles, search, the marked-text button, the support dialog, the «Novedades» dialog, light and dark, desktop and phone, checked in the browser; 208 screenshots reviewed by sample |
| Found and fixed on the way | Three button names in the articles didn't match the panel (caught by the new check). The «Proyecto 1» photo screenshot was empty (no photo on the real site): Fotos now shows «Nosotros». On phones the «Novedades» text scrolled inside the dialog without being focusable (axe): fixed. The same support question sent from each device was refused as a duplicate (correct behaviour): the test now asks a different question per device. On a walk-through of the local panel, an Administrador got the «Más secciones» news although that menu item never shows for them (nothing left to ask for): that news now goes only to accounts with a section they could still ask for (`canAsk`, checked in `31-wiki.test.mjs`) |

## Change — «Avisos al equipo» and the database map (2026-10-27)

The owner e-mails the team the panel's «Novedades» (`Administración → Avisos al equipo`);
each active person gets one e-mail, in their language, with only the items their sections
allow and the wiki link, never the same item twice. Design: `SECURITY_AUDIT.md` §26. The
database map (`tools/plano-bd`) and the technical docs as PDFs (`tools/docs-pdf`) join the
documentation.

| Check | Result |
|---|---|
| API integration (33 files) | **278/278** (+6): `32-announcements` — owner only (401/403 for everyone else, administrators too); the overview counts who can use, saw and got each item; recipients per role (Ventas: statistics and «Más secciones», Editor: only «Más secciones», Administrador: only statistics), never the owner, disabled accounts or people who joined later; the test goes only to the owner, marked «[Prueba]», with the message escaped; one e-mail per person in their language (an English Editor gets English), only their items and links; a second send of the same items is refused (`nobody`) until «again»; history, `news_emailed` and Actividad; owner-only «Novedades». `33-db-map` — every table and migration is described in the map |
| Browser E2E (3 profiles) | Full run: **202 passed**, 65 skipped by design, 12 failed — 9 owner sign-ins while the test server stopped answering for a few minutes, the wiki contrast check measured before the new theme applied, and the recipients list on iPhone overwritten by a late answer (a real race, fixed: only the latest answer counts). Those 12 again: **12 passed**; `announcements` and `wiki` again on the three devices: **12 passed**. New `announcements.spec.js`: Inicio's reminder, one «Novedad» per device, a message, the test e-mail (Mailpit), the send from the bottom bar on phones, the history, and the e-mail Elena receives with the message and the wiki link |
| Visual regression (public site) | **22/22** identical |
| Static analysis | PHPStan: no errors |
| Design review | Two columns on wide screens (the message, who gets it and «Enviar» stay in view), a bottom bar on phones, light and dark, Spanish and English; 8 wiki screenshots |

## Change — UX review fixes and longer texts (2026-10-27)

Every screen with each role (owner, Administrador, Editor del sitio web, Ventas y prospectos,
Consulta, support handler, signed out) at 1366, 768 and 375 px, light and dark, Spanish and
English: 152 screens and dialogs measured (touch targets, overflow, clipped text, tiny text,
axe, console and network errors) and reviewed by eye. 16 findings, all fixed, plus longer
texts in the editor (recommended length and a larger maximum per field). Design:
`SECURITY_AUDIT.md` §25.

| Check | Result |
|---|---|
| API integration (31 files) | **272/272** (+1): «Primeros pasos» closed on one device stays closed on another and keeps the first date; 401 without a session (`22-welcome`); every text reports its recommended length and maximum, saves past the recommendation, refuses past the maximum (`05-content`); the Google title and description keep their single limit (`27-seo`) |
| Browser E2E (3 profiles) | **211 passed**, 65 skipped by design, 0 failed; new `ux-review.spec.js` (6 tests × 3 devices): Inicio speaks to the role and «Primeros pasos» stays closed on another browser; on phones the status tabs slide in one row with the selected one in view and Actividad's filters sit behind «Filtros» (with the count); Fotos keeps the open tab in view and Tipos de proyectos folds on phones; Usuarios is cards below 1100 px and a table with one-line e-mails above; the editor counts to the recommendation, shows the note past it and stops at the maximum; dialog ✕ ≥ 44 px on touch, a focused title shows no ring, wiki tables take keyboard focus. Updated: `help-center` (page «Soporte», sliding filters), `admin` (folding projects), `wiki` (progress under the title; axe waits for the theme transition) |
| Content stress test | Every field filled to its new maximum keeps the public site without overflow or spilling text at 320, 390, 768, 1024, 1280 and 1440 px |
| Visual regression (public site) | **22/22** identical |
| Phone UX measurements, before → after | axe findings 8 → 0; small touch targets 515 → 385 (the rest are inside folded projects, measured stale by the browser, and 44 px once open); Tipos de proyectos 17,504 → 1,257 px tall; Actividad and Prospectos start the list on the first screen |
| Built release under Apache + PHP-FPM | **14/14** (`dist/release-20261027-eb5b1ce`) |
| Production rehearsal | A copy in production's exact state — the release production runs (`ffbb133`, SEO), a database at migration `014`, the site photos, a client text edit and two leads made with that version — updated with the deploy guide's commands (backup, `cp -a` of the program, two `rsync`, `publish`). `publish` answered «Changed: nothing»; the three generated public pages are byte-identical before and after; the public CSS, JS and fonts served by production today are byte-identical to the new release; the only public files that change are `.htaccess` (app. `/wiki` redirect) and the contact handler (lead automation after saving). Screenshots of the public site (ES/EN, 1440 and 390) differ only where the WhatsApp button pulses — the same difference two captures of the same version show. The panel keeps every account (the four single-section ones move to Editor del sitio web, listed by `roles`, undoable), the client's text and both leads; migrations reach `020_intro`; integrity check «ok» with the old files left by `rsync`. **Rollback rehearsed too:** `roles:rollback`, then the previous package with the same commands: the panel opens on `ffbb133` over the updated database with the same accounts, text and leads, and the public pages are byte-identical to before. The deploy guide's rollback now uses the previous package, so the panel (`public_html/admin`) goes back with the program |
| Static analysis | PHPStan: no errors |
| Found and fixed on the way | The Google title and description were going to grow with the other texts; Google cuts longer ones, so they keep their single limit. On a 375 px phone «Filtros» wrapped under the search box: they now share the line. The new close-button check first measured the dialog mid-animation (scale 0.98): it now waits for the dialog to open |

## Change — the scheduled check installed from the console (2026-10-27)

Production e-mailed «La revisión automática dejó de ejecutarse» (last run 2026-10-16 02:18,
server time — the one run by hand at go-live): the cron job had never been installed, and
cron discards the output, so nothing said why. `bin/console cron` now says what is missing,
`bin/console cron:install` installs or repairs the scheduled check and the daily backup, and
one failing step no longer stops the check. Design: `SECURITY_AUDIT.md` §27.

| Check | Result |
|---|---|
| API integration (34 files) | **282/282** (+4, `34-cron`, against a stand-in `crontab`): `cron` reports both jobs missing and the check never run (exit 1); a crontab with `MAILTO`, the acme.sh renewal, a blank line, a hand-written line for this installation and one for another installation → the hand-written line is flagged, the other only mentioned; `--dry-run` changes nothing; `cron:install` saves the previous crontab, replaces the old line, keeps every other line byte for byte and adds both jobs once (a second run: «nothing changed»); after one check `cron` shows both `[ OK ]` and exits 0; errors written by cron are shown; a crontab that refuses the change leaves it as it was and prints the lines to add by hand; with the `monitor_runs` table unavailable the check logs `scheduled_step_failed` («Health») and still runs every later step, alerts and automations included, and records its time; a second check while one is running is skipped. The wiki check caught commands written like button names in the new Monitoreo section (fixed) |
| Production rehearsal of the alert | A copy in production's state — the release production runs (`ffbb133`), the database at migration `014` (accounts, client text, leads, photos) and the scheduled check last run on 2026-10-16 06:18 UTC. The old version sends the same e-mail production sent («no corre desde el 2026-10-16…», «Revisa en cPanel → Cron Jobs…»). Updated with the deploy guide's commands (`backup`, `cp -a`, `unzip`, two `rsync`, `publish` → «Changed: nothing», then `cron:install` and `cron`) against a stand-in crontab holding the acme.sh renewal and the panel's old suggested line (`php ~/sensum-cms/bin/console monitor …`): the old line is replaced, acme.sh kept, a copy saved. The installed line run the way cron runs it (`sh -c`, empty environment, `PATH=/usr/bin:/bin`) exits 0 with an empty `cron.log`; `cron` shows both `[ OK ]` and «just now»; `/api/health` no longer sends the alert. The first check sends, once, what was pending: the monthly security review, the weekly technical summary and the e-mail DNS notice (the guide lists them). The three public pages are byte-identical before and after; no new entries in the error log; migrations reach `021_announcements` |
| Browser E2E (3 profiles) | Full run: **213 passed**, 65 skipped by design, 1 failed — `announcements` on iPhone read the list of «Novedades» before it had loaded (Playwright's `.all()` does not wait, and the server was busy), so nothing was unchecked. The test now waits for the list; `announcements` on the three devices: **3 passed** (and 9 more targeted runs before the fix, all passed) |
| Visual regression (public site) | **22/22** identical |
| Built release under Apache + PHP-FPM | **14/14** (`dist/release-20261027-da678a5`) |
| Static analysis | PHPStan: no errors |

## Other audits

| Audit | Result |
|---|---|
| Security Audit 1 & 2 | see `SECURITY_AUDIT.md` (no critical findings; 9 findings fixed and re-verified) |
| Dependency audit | `composer audit`: no advisories (PHPMailer 6.12.0); `npm audit` (dev tools): 0 |
| Static analysis | PHPStan level 6, PHP 8.1 target: 0 errors (also run in GitHub Actions on every push, with `composer audit` and `npm audit`) |
| Accessibility — admin | axe-core WCAG 2.1 AA on 12 screens + drawer + dialog, light and dark, 3 devices: no serious/critical violations; keyboard navigation, focus management, reduced motion and 44 px targets reviewed |
| Accessibility — public | identical before/after; pre-existing contrast findings on the approved orange labels reported as an optional recommendation |
| Performance | Lighthouse before/after: equal (desktop 99, mobile 84–85 locally with network throttling); +7 KB (main.js/css additions), no extra requests; with photos the LCP stays the hero heading (photos lazy, responsive `srcset`). Outliers were traced to slow Google Fonts responses (affects the approved site equally). Fonts are now self-hosted (no requests to Google; the two Latin files are preloaded). |
| Visual regression | 22/22 (desktop 1440/1280, tablet 768, phones 390/320, ES and EN, modal, menu, form errors, FAQ, 404, privacy notice); identical to `main` except the privacy notice, whose new approved text is the baseline since 2026-10-15 |
| Production build | `tools/build-release.sh` → 68 public files + 251 private files (≈ 1.2 MB zip), no secrets/dev files; verified under Apache |

## How to re-run

See `docs/LOCAL_SETUP.md` §7–8. In short:

```bash
npm --prefix tests ci && npx --prefix tests playwright install webkit
mailpit &
npm --prefix tests test            # API (≈ 30 s)
npm --prefix tests run test:e2e    # browsers (≈ 4 min)
```
