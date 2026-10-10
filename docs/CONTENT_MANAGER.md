# Content Manager — technical overview

The Content Manager ("Administrador de contenido") lets authorized Sensum staff
change the website's text, photos, portfolio PDF and contact details without
touching code, and report problems to IT. It is built **around** the approved
public site: with unchanged content, the published pages are byte-identical to
the approved ones.

Related documents: `CURRENT_SITE_BASELINE.md` (the protected design),
`FRONTEND_INTEGRATION.md` (how content reaches the pages), `LOCAL_SETUP.md`,
`NAMECHEAP_DEPLOYMENT.md`, `PRODUCTION_CHECKLIST.md`, `SECURITY_AUDIT.md`,
`TEST_REPORT.md`, `USER_GUIDE_ES.md` / `USER_GUIDE_EN.md`.

---

## 1. Architecture decision

### Options evaluated

| Option | Frontend disruption | Security | Shared hosting | Maintenance | Verdict |
|---|---|---|---|---|---|
| A. Static site + JS fetches a JSON file and patches the DOM | low code change, but visible text flicker, layout shift, crawlers see stale text, JSON-LD stale | ok | good | ok | rejected (quality/SEO) |
| B. Convert pages to PHP that read the DB on every visit | high (URLs, caching, GitHub Pages preview breaks) | DB on the public request path | good | ok | rejected |
| **C. PHP admin + API that re-generates the same static pages on save** | **minimal: identical output with unchanged content** | **public site never runs PHP/DB** | **excellent** | **simple** | **selected** |
| D. Flat JSON files for everything (users, tokens, limits) | — | file locking / token handling fragile | ok | fragile | rejected |
| E. Same as C with MySQL/MariaDB | same | adds DB credentials to manage | good | more setup | viable, not needed |
| F. Node.js app (cPanel "Setup Node.js App") | — | — | long-running process (not assumed available) | — | rejected |
| G. Git-based headless CMS (e.g. Decap) | build step, GitHub logins for the client | external | needs builds | — | rejected (client UX) |
| H. WordPress or similar | full redesign | large attack surface | ok | heavy | rejected |

### Why C + SQLite

* **Preservation:** the public pages stay plain static files rendered from
  templates that reproduce the approved markup exactly. Proven by test: default
  content → byte-identical `index.html` and `404.html`; `privacy-notice.html`
  differs by one line wrap; 22/22 visual captures identical.
* **Reliability:** visitors never touch PHP or the database. If the Content
  Manager is down, the site keeps working (tested).
* **Security:** a small, fully-owned PHP code base with one dependency
  (PHPMailer), no public write paths besides the authenticated API and a
  throttled error-telemetry endpoint.
* **Shared hosting:** PHP 8.1+, GD and SQLite are standard on Namecheap; no
  workers, cron, Redis, Node or root access needed. One SQLite file outside
  `public_html` means no database server, no DB user/password to manage, and
  backup = copy one file. The data volume (a few users, ~100 fields, dozens of
  photos) is far below SQLite's limits.
* **Cost:** no new services or subscriptions.

### Component map

```
public_html/                         (web root)
  index.html, 404.html,              ← generated on publish (static)
  privacy-notice.html
  assets/main.js, main.css           ← approved files + small additions
  assets/uploads/                    ← published photos/PDF (server-named)
  assets/error-reporter.js           ← optional, off by default
  admin/                             ← admin SPA (static HTML/CSS/ES modules)
  api/index.php                      ← single public entry point of the API
sensum-cms/                          (PRIVATE — outside public_html)
  src/                               ← application code (PHP 8.1+, PSR-4)
  content/schema.php, defaults.php,  ← what is editable, limits, defaults, photo slots
  content/media.php
  templates/*.tpl                    ← the three public pages with placeholders
  migrations/                        ← SQLite schema
  lang/es.php, en.php                ← e-mail texts
  bin/console                        ← command line
  vendor/                            ← PHPMailer (Composer)
  storage/                           ← database, logs, backups, outbox, screenshots
  .env                               ← configuration and secrets
```

`api/index.php` finds the private folder via `SENSUM_CMS_DIR`, then
`../../sensum-cms` (next to `public_html`), then `../cms` (development).

### Admin performance

No build step, but the panel is split by screen: `admin/index.html` preloads the
core modules (`modulepreload`), `js/app.js` imports each screen with `import()`
when it is first opened (prefetched on menu hover/focus and when the browser is
idle), the English dictionary is fetched only for English sessions, and the
sidebar/top bar are built once per session (each screen gets a fresh `<main>`,
so a slow screen can never write into the next one).

## 2. Features

| Area | What users can do |
|---|---|
| Texts | 92 bilingual fields (ES + EN) across Inicio → Sección principal, Nosotros, Servicios, Proceso, Tipos de proyectos, Llamado a la acción, Contacto, Preguntas frecuentes, Pie de página. Friendly names, help text, limits, live counters, highlight preview (`*palabra*`), restore original, unsaved-changes protection, edit-conflict detection |
| Automatic translation (optional, DeepL) | Typing in one language fills the other with a machine translation, shown in the editor for review before saving (§2a) |
| Contact details | Office/mobile phone (mobile optional), WhatsApp number, e-mail, address (building, street, office, city), map card title, Google Maps link (host allow-list), Instagram link and handle. Updates contact section, footer, WhatsApp button, form fallback text, structured data, 404 and privacy pages |
| Photos | "Nosotros" photo; per project: card photo and a "Ver detalles" gallery (up to 10, ordered). Preview of the exact crop per screen shape, framing control, alt text ES/EN, replace, remove |
| Documents | Replace the portfolio PDF (or go back to the sample) |
| Users (admins) | Invite (e-mailed single-use link), resend, change role (Administrador / Editor), disable/enable, delete; last-admin and self-lockout protection |
| Account | Name, panel language, theme; change password (signs out other devices); sign out other sessions |
| Support | "Reportar un problema" from every screen; history with delivery status and retry |
| Dashboard | Site status, last publish, sync check + republish (admins), recent activity, monitoring status; diagnostics and recent errors for the owner |
| Monitoring (owner) | Error log with filters and details, key figures (24 h / 7 d / 30 d), most frequent errors, system details, e-mail alerts for critical errors + test e-mail (§9a) |
| Monthly report (owner) | Short plain-language site-health and visibility report for clients; recipients (owner always copied), preview, test, send, history; reminder after day 5 (§9b) |
| Support tickets | Reports become tickets: status (new, in progress, waiting for information, resolved, closed), priority, conversation; the owner edits, replies, adds internal notes, asks for information, resolves/closes/reopens with optional e-mail to the reporter; reporters follow and answer their own tickets (an answer reopens); menu badge; screenshot viewer |
| Monthly report value | Support summary (received, resolved, average resolution time, resolved items, pending) and automatic maintenance (health checks, file-security scans, backups, certificate checks, Google measurements, blocked spam, notices) + messages received through the form |
| Contact-form options | "Servicio de interés" list: add, rename (ES/EN), reorder, remove (up to 20), live preview, restore the approved options; published at once; stable ids so renaming never breaks open pages (access: contact details) |
| E-mail settings (owner) | Panel's SMTP sending account (+ Reply-To), contact-form receivers/sender/method, problem-report and alert recipients, optional Cloudflare Turnstile keys; password re-check, secrets encrypted at rest, security notice, test buttons; `EMAIL_SETTINGS_LOCKED` for .env-only setups |
| Contact-form captcha | Built-in invisible proof-of-work captcha (always on, no keys) + optional Cloudflare Turnstile; counts of messages and blocked spam in the weekly summary |
| Automatic alerts (owner) | 12 rules with their own periods and de-duplication (critical errors, file integrity, sign-in attack, new device, certificate, backup, scheduler, disk, error spike, weekly digest, monthly security review, report reminder), on/off per rule; file-integrity check with "accept" (password) |
| Users (owner) | Invite, change access type, disable/enable, delete (§2b) |
| Interface | Spanish by default, English optional; light/dark/system theme; responsive from 320 px phones to large monitors; reduced-motion aware |

### 2a. Automatic translation ES ⇄ EN

Off until `DEEPL_API_KEY` is set (DeepL API Free: 500,000 characters/month;
all of the site's editable text is ≈ 5,000 characters per language). Then, in
**Textos del sitio**:

| What the person does | What happens |
|---|---|
| Types in Spanish | ~1 s after they stop typing (or when they leave the box) the English box fills in, marked "Traducido automáticamente del español. Revísalo." with **Deshacer**. Same in the other direction. |
| Edits the translated box by hand | That language becomes theirs: later edits in the other language never overwrite it (until the section is saved). Both languages can therefore be written separately. |
| Presses **Deshacer** | The previous text comes back and is kept while they keep editing the other language. |
| Presses **Traducir del español / del inglés** | Translates on demand into that box, even if it was edited by hand. |
| Returns the source text to the saved version | The translation is undone too. |
| Presses **Guardar cambios** while a translation is still coming | The save waits for it ("Terminando traducciones…") and saves what is then on screen. |
| DeepL fails / quota used up / offline | Nothing changes in the box; a short message under it explains why; saving works as usual. |

Nothing is saved by translating: `POST /api/content/translate` only returns
text. Server side (`cms/src/Translator.php`): `*highlights*` are sent as
`<em>` and restored; "Sensum"/"Sensum Construcciones" are excluded from
translation; English target **EN-US**, Spanish target **ES-419** (Latin
American) with the informal *tú* the site uses; tags or `<`/`>` in a reply are
stripped; results that exceed a field's limit are shown with the usual
"demasiado largo" message so the person shortens them before saving.

Limits: 300 translation requests per user per hour and
`TRANSLATE_DAILY_CHAR_LIMIT` (default 60,000) characters per day for all users,
so a runaway or compromised account cannot exhaust the monthly quota.
`php sensum-cms/bin/console translate:test` checks the key and shows the
characters used this period; the dashboard diagnostics show whether it is on.

**Privacy.** Only the text being edited — public website copy — is sent to
DeepL (Germany), never names, e-mails or settings. DeepL API **Free** may use
submitted text to improve its models; DeepL API **Pro** deletes it after
translating. For website copy this is acceptable; switch to a Pro key (no code
change) if that ever matters.

### 2b. Owner account and access types

**Owner account.** The active account whose e-mail is `OWNER_EMAIL` (default
**it@gruposensum.com**) is the owner: the **only** account that manages users,
sees **Monitoreo** and the diagnostics/errors cards on the dashboard, and sends
the **Informe mensual**. Nobody can change or delete it from the panel (not even
itself). Create it first (`bin/console create-admin --email=it@gruposensum.com`);
`bin/console check` warns if it doesn't exist.

**Access types.** Every other account has a set of permissions — what it may
change. The server checks every change (`Auth::assertCan`); the panel only hides
what an account cannot use.

| Permission | Allows |
|---|---|
| `texts` | Textos del sitio (and automatic translation) |
| `contact` | Datos de contacto |
| `photos` | Photos: "Nosotros", project cards and galleries |
| `documents` | The PDF portfolio |
| `site` | Site status: recent activity and *Volver a publicar el sitio* |

Ready-made types: *Acceso completo al contenido* (all five), *Editor de
contenido* (all but `site`), *Solo textos*, *Solo fotos y portafolio*, *Solo
datos de contacto* — or *Personalizado*. Everyone can manage their own account
and send support reports. Existing accounts were migrated in `003_access.sql`
(former administrators: all five; former editors: all but `site`). The old
`role` column is kept only for compatibility; it grants nothing.

## 3. Editable content model

* `cms/content/schema.php` — sections, fields, type, max length, required.
  Bilingual keys are the same keys the public site's i18n uses
  (`data-i18n="hero.title"`), so values flow into both the server-rendered
  Spanish and the ES/EN toggle.
* `cms/content/defaults.php` — approved copy, **generated** from
  `assets/main.js` by `node tools/extract-defaults.mjs`. A test fails if the two
  ever diverge.
* `cms/content/media.php` — photo slots with ratio, minimum/recommended size,
  generated widths and preview frames (from the measured containers).
* Field types and server-side validation (`cms/src/Content/Validator.php`):
  text/textarea/emphasis (no `<`/`>`, length, required, balanced `*`), phone,
  WhatsApp (normalized to digits, `502` added to 8-digit numbers), e-mail,
  https URL to an allowed host, Instagram handle. Control, zero-width and
  bidi-override characters are stripped; text is NFC-normalized.
* Not editable on purpose: navigation labels, form labels/options (tied to the
  contact handler's allow-list), SEO meta, logos and icons, legal text of the
  privacy notice (only its contact details update).

## 4. Data model (SQLite, `cms/migrations/*.sql`)

| Table | Purpose |
|---|---|
| `users` | e-mail (unique, lower-case), name, permissions (access type), status (invited/active/disabled), Argon2id/bcrypt hash, language, theme, timestamps; encrypted TOTP secret (active and pending), enabled date, last used step (`007_two_factor.sql`) |
| `recovery_codes` | keyed HMAC of each two-step recovery code, used-at |
| `login_challenges` | SHA-256 of the 5-minute token between the password and the code, attempts |
| `leads` | contact-form messages: name, e-mail, phone, service, message, language, status, amount, notified, unread, created/updated/contacted/closed (`008_value.sql`) |
| `lead_notes` | notes and history events (status, amount) of each lead, author, time |
| `analytics_daily` | visit statistics, one row per day × metric × value (view/visitor/source/device/lang/click) — totals only |
| `analytics_seen` | today's unique-visitor hashes (random daily salt + IP + browser); deleted when the day changes |
| `monitor_runs` | one row per scheduled check (ok / failed checks) — availability figure of the monthly report |
| `site_reports` | monthly reports sent: month, when, by whom, recipients, language, status, figures |
| `sessions` | SHA-256 of the session cookie, CSRF token, created/last-seen/expiry, pseudonymized IP, user agent |
| `user_tokens` | SHA-256 of invitation/reset tokens, purpose, expiry, used-at |
| `content` | key, language (`es`/`en`/`*`), value, who/when |
| `media` | slot, position, server-generated file base, extension, size, generated widths, alt ES/EN, sanitized original name, soft-delete date |
| `settings` | last publish, published file hashes, drift notice, e-mail/captcha settings (secrets encrypted), off-server backup settings, two-step policy, last domain check |
| `support_reports` | reporter, type, title, description, area, page, allow-listed context, screenshot file, delivery status/attempts |
| `activity_log` | who did what (content changes keep old/new values, max 300 chars each) |
| `rate_limits` | fixed-window counters (keys are HMAC pseudonyms, never raw IPs/e-mails) |
| `error_log` | one row per error (severity critical/error/warning, source, event, redacted message, code location, request line, reference code, user, alert status); kept `ERROR_LOG_DAYS` (180). Replaced `error_events` in `002_monitoring.sql` |
| `schema_migrations` | applied migrations (also applied automatically on first request) |

## 5. API (all under `/api`, JSON)

| Method & path | Access | Purpose |
|---|---|---|
| `GET /api/health` | public | status per area only (no versions/paths) |
| `POST /api/telemetry/error` | public, throttled | JS error from the admin (and public site if enabled) |
| `GET /api/auth/session` | public | current user + CSRF token, or `setupRequired` |
| `POST /api/auth/login` · `/logout` | public | sign in/out; with two-step sign-in the login answers `{twoFactor:true, challenge}` instead of a session |
| `POST /api/auth/login/2fa` | public, 5 attempts | second step: `challenge` + `code` (6-digit TOTP or recovery code) → session |
| `POST /api/auth/forgot` · `/reset/verify` · `/reset` | public | password reset |
| `POST /api/auth/invitation/verify` · `/invitation/accept` | public | invitation |
| `POST /api/setup` | public, one-time | first admin with `SETUP_TOKEN` |
| `GET /api/dashboard` | user | dashboard data (admins get activity; the owner also gets diagnostics and errors) |
| `GET /api/monitor/summary` · `GET /api/monitor/errors?severity=&source=&days=&q=&page=` · `POST /api/monitor/test-alert` | owner | Monitoring page, error log, test alert |
| `PUT /api/monitor/alerts` · `GET /api/monitor/integrity` · `POST /api/monitor/integrity/accept` | owner | automatic-alert toggles; site-file findings; accept current files (password) |
| `POST /api/monitor/domain-check` | owner | SPF/DKIM/DMARC/MX and domain-expiry check now |
| `GET /api/security` · `PUT /api/security/backup` · `POST /api/security/backup/send` · `POST /api/security/backup/download` · `PUT /api/security/policy` | owner | off-server encrypted backup settings (password), send now, download (password); who must use two-step sign-in (password) |
| `POST /api/users/{id}/2fa-reset` | owner | turn off someone else's two-step sign-in (password; ends their sessions; never your own) |
| `GET`/`PUT /api/contact-form/services` | contact | "Servicio de interés" options (PUT: `items` [{id?, es, en}], `version`; publishes; 409 `conflict`) |
| `GET`/`PUT /api/settings/email` · `POST /api/settings/email/test` | owner | e-mail settings (PUT needs `currentPassword`), test e-mails (`target`: `panel` / `contact`) |
| `GET /assets/contact-handler.php?challenge=1` | public | signed single-use captcha challenge for the contact form |
| `POST /api/site/republish` | admin | regenerate pages |
| `GET /api/content` · `PUT /api/content/{section}` | user | read/save a section (optimistic `version`) |
| `POST /api/content/translate` | user | machine-translate field text ES⇄EN for review (saves nothing; off without `DEEPL_API_KEY`) |
| `GET /api/media` · `POST /api/media/{slot}/upload` · `PUT /api/media/{slot}/order` · `PUT`/`DELETE /api/media/item/{id}` | user | photos & PDF |
| `PUT /api/account/profile` · `POST /api/account/password` · `POST /api/account/sessions/revoke-others` | user | own account |
| `GET /api/account/2fa` · `POST /api/account/2fa/setup` · `/enable` · `/recovery-codes` · `/disable` | user | own two-step sign-in: setup (password → secret + QR), enable (code → recovery codes), new codes and disable (password + code). The only routes open to an account that must still enrol |
| `GET /api/reports?status=&q=` · `POST /api/reports` · `POST /api/reports/{id}/retry` · `GET /api/reports/badge` | user | tickets (owner: all, filters, search; others: own) |
| `GET /api/reports/{id}` · `POST /api/reports/{id}/messages` · `GET /api/reports/{id}/screenshot` | user (own) / owner | ticket, conversation (owner: `internal` notes), screenshot |
| `POST /api/reports/{id}/rating` | reporter | rate a resolved/closed ticket once: `rating` 1–5, optional `comment` (≤ 500) |
| `PUT /api/reports/settings` | owner | response-time target `slaHours` (4, 8, 24, 48, 72) |
| `GET /api/leads?status=&q=&service=` · `GET /api/leads/badge` · `GET`/`PUT`/`DELETE /api/leads/{id}` · `POST /api/leads/{id}/notes` · `POST /api/leads/export` | `leads` | Prospectos: list with counts, unread badge, one lead (marks read), status/amount, notes, delete, CSV |
| `PUT /api/leads/settings` | owner | retention `retention` (6, 12, 24, 36 months); republishes the privacy notice |
| `GET /api/stats?period=30d|YYYY-MM` · `PUT /api/stats/settings` | `leads` · owner | visit statistics with the previous period; on/off (`enabled`, republishes) |
| `POST /api/collect` | public, origin-checked | visit/click beacon from `assets/stats.js`; always 204 |
| `POST /api/site-report/pdf` | owner | the report as a PDF (`period`, `lang`, optional `note`) |
| `PUT /api/reports/{id}` · `POST /api/reports/{id}/status` | owner | edit fields/priority; status with optional `message` and `notify` |
| `GET`/`POST /api/users` · `POST /api/users/{id}/resend` · `PUT`/`DELETE /api/users/{id}` | owner | user management, access types |
| `GET /api/site-report` · `GET /api/site-report/preview?period=&lang=` · `PUT /api/site-report/settings` · `POST /api/site-report/send` | owner | monthly client report |

Errors are `{"ok":false,"error":"<code>","fields":{…}}`; the admin translates
codes into friendly ES/EN text. Unexpected failures return only
`server_error` and a 6-character reference that matches a line in the log.

## 6. Security model (summary — details in `SECURITY_AUDIT.md`)

* Authentication: Argon2id (bcrypt fallback), 10+ character passwords with a
  common-password block-list, generic errors, timing-equalized lookups,
  per-account (5/15 min) and per-IP (20/15 min) failure throttling.
* Two-step sign-in: TOTP (RFC 6238) with encrypted secrets, no code reuse,
  single-use hashed recovery codes; required for the owner by default
  (`TWO_FACTOR_POLICY`, changeable in Seguridad); an account that must enrol can
  only reach the setup routes.
* Sessions: 256-bit random cookie (`__Host-sensum_admin`, HttpOnly, Secure,
  SameSite=Strict in production), hash-only storage, 60 min idle / 12 h absolute
  expiry, rotation on login and password change, revocation on logout,
  password change/reset, disable and delete.
* Requests: same-origin check on every state change, per-session CSRF token
  header, strict JSON parsing, 256 KB JSON / 25 MB upload caps, server-side
  authorization per route (public/user/admin) and per object (reports).
* Tokens: invitations (72 h) and resets (60 min) are 256-bit, single-use,
  hashed at rest, carried in the URL fragment (never in server logs).
* Uploads: extension + sniffed MIME + decoder type must agree; dimension,
  pixel-count and memory limits; any decoder warning = corrupt; every image is
  re-encoded from pixels (strips EXIF/GPS and hidden payloads); server-generated
  names; the uploads folder only serves `name-wNNN.webp|jpg` and `name.pdf`, PDFs
  as attachments with `CSP: sandbox`.
* Output: every value escaped for its context; `<`/`>` refused in content; URLs
  allow-listed; JSON in pages encoded with `JSON_HEX_TAG`; the admin never uses
  `innerHTML`.
* Headers: existing strict public CSP unchanged; the admin has its own stricter
  CSP (no third parties at all), `no-referrer`, `noindex`.
* Logs: no passwords, tokens, cookies or SMTP data (keys that look secret are
  redacted automatically); IPs/e-mails pseudonymized with a server secret.

## 7. Publishing pipeline

On every successful change: render the three templates with current content →
validate output (complete document, valid JSON-LD/JSON, no leftover
placeholders) → back up the live files (last 30 kept in
`storage/backups/published/`) → write each page atomically (temp file +
rename) → record hashes. If anything fails the database change is rolled back,
so the editor and the site never disagree. External edits of the live files
(e.g. a deployment) are detected, backed up, and reported on the dashboard;
admins can republish with one click (or `php bin/console publish`).

## 8. Issue reporting ("Reportar un problema")

* Entry points: top bar on every screen (icon-only on phones), sidebar footer,
  Help page, Dashboard (editors), Reports page.
* Fields: Tipo (Problema, Mejora / sugerencia, Contenido, Diseño / visual, Otro),
  Título (3–120), Descripción (10–4000), ¿Dónde lo notaste? (default "Panel de
  administración"), Página (auto-filled with the current screen, editable/
  clearable), optional screenshot (JPG/PNG/WebP ≤ 5 MB, validated and
  re-encoded).
* Automatic context (shown to the user before sending): browser, OS, device
  type, viewport, screen size, pixel density, time zone, browser language,
  connection state, panel language, theme, current screen (tokens stripped),
  app version; reporter name/e-mail and date come from the server session, not
  the browser.
* Never collected: passwords, cookies, tokens, storage, form values, IP.
* Delivery: stored first, then e-mailed to `SUPPORT_EMAIL`
  (**it@gruposensum.com** by default) via SMTP. Subject
  `[Sensum Website] <Tipo>: <Título>`, Reply-To = reporter, plain text + escaped
  HTML, screenshot attached. HTTP 201 = sent, 202 = saved but not sent.
* Failure handling: status `failed`, the text stays on screen, the user can
  retry immediately or later from **Reportes de soporte**; admins see failures on
  the dashboard; `php bin/console reports:retry` resends all pending.
* Abuse limits: 5 reports per 10 minutes and 20 per day per user; identical
  reports within 15 minutes are recognized as duplicates; retries 10 per 10 min.

## 9. Telemetry and monitoring

Everything is optional and independent: if any of it fails or is blocked, the
site and the panel work normally (tested with blocked requests).

| What | How | Default |
|---|---|---|
| Health endpoint | `GET /api/health` → `{"status":"ok|degraded","checks":{…}}`, HTTP 200/503. A failing required check is logged as critical and alerts IT | on |
| Error log | every server, panel and (if enabled) public-site error, one row each, in **Monitoreo** (owner only) | on |
| Critical-error alerts | e-mail to `ALERT_EMAIL` (it@gruposensum.com) for unexpected server errors, PHP fatal errors and failing health checks; throttled (§9a) | on |
| Monitoring page | status, key figures (24 h / 7 d / 30 d), most frequent errors, system details, alert settings + test e-mail, setup help | on (owner) |
| Scheduled check | `bin/console monitor` from cron every 15 min (§9a) | set up at deployment |
| Public JS errors | `PUBLIC_ERROR_REPORTING=true` adds `assets/error-reporter.js` (≤3 reports/page, message + file:line + path only, no cookies) | **off** |
| First-party visit statistics | `assets/stats.js` → `POST /api/collect`: daily totals only (views per page, visitors, source from a fixed list, device, language, clicks on WhatsApp/phone/e-mail/map/social/portfolio). No cookies or storage, no IP stored; one visitor per day via a hash with a random salt that is replaced (and the markers deleted) every day; DNT/GPC, `navigator.webdriver`, prefetch and bot user agents ignored; 120 events/IP/hour, 50 000/day. Page **Estadísticas** (owner + "leads" access); owner switch republishes the pages and the privacy-notice paragraph (§9c) | **on** |
| Visitor analytics + Core Web Vitals (LCP, CLS, INP, TTFB) | Cloudflare Web Analytics: free, cookieless, no DNS change required. Set `CF_WEB_ANALYTICS_TOKEN` and republish | **off** |
| Uptime + SSL expiry | external — Better Stack free plan (10 monitors, 3-min checks, SSL/domain expiry) or UptimeRobot free (50 monitors, 5-min, no SSL alerts on free) | set up at deployment |

### 9a. Error log, critical alerts and the scheduled check

**What is recorded.** Everything the application logs at warning level or
above (e-mail failures, report delivery failures, translation failures,
pages changed outside the panel, low disk space…), every unexpected server
error and PHP fatal error, failing health checks, and JavaScript errors from
the panel (and the public site when `PUBLIC_ERROR_REPORTING=true`). Failed
sign-ins are security events and stay in the activity log. Messages are
redacted (no long tokens, no e-mail addresses), never include request bodies,
cookies or credentials, and the request line has no query string. The log file
(`storage/logs/app-YYYY-MM.log`) still receives everything too.

| Severity | Examples | E-mail alert |
|---|---|---|
| Crítico | unexpected server error (the user saw a reference code), PHP fatal error, failing required health check | **yes** |
| Error | e-mail could not be sent, support report not delivered, automatic translation failed, browser errors | no |
| Advertencia | published pages differ from saved content, low disk space, e-mail disabled | no |

**Alerts.** Subject `[Sensum Website] Error crítico: <qué pasó>`; body: what
happened, detail, code location, request, reference code, user, time, site and
version, repeats since the previous alert, and a link to **Monitoreo**. Sent
after the response is delivered (PHP-FPM/LiteSpeed), so a failing page is not
slowed down. Throttling: the same error at most once per
`ALERT_COOLDOWN_MINUTES` (60), at most `ALERT_DAILY_MAX` (20) per day;
suppressed repeats are counted in the next alert. Throttle state is a small file
in private storage, so alerts work even when the database is down. If e-mail is
unavailable the entry is marked "no enviada" and the scheduled check sends one
summary later. The owner can send a test alert from Monitoreo (3 per hour) or run
`bin/console alert:test`.

**Scheduled check** — cPanel → Cron Jobs, every 15 minutes:

```
*/15 * * * * php ~/sensum-cms/bin/console monitor > /dev/null 2>&1
```

It runs the health checks (critical → alert), checks free disk space
(`DISK_WARN_MB`, 500) and whether the published pages still match the saved
content, re-sends pending support reports and failed alerts, and removes log
entries older than `ERROR_LOG_DAYS`. Monitoreo shows when it last ran.

**What it cannot see.** If the whole server or PHP is down, nothing inside it
can send an alert — that is what the external uptime monitor is for (Better
Stack / UptimeRobot on the site and `/api/health`).

### 9b. Monthly site report for clients

Owner-only page **Informe mensual**. A short report in plain language (Spanish
or English) for people who aren't technical:

* Headline and status (*Todo en orden* / *Con observaciones*: any critical
  incident, or availability below 99 %), one-paragraph summary.
* Figures: availability (share of the month's scheduled checks that passed),
  Google mobile speed score, content updates, security (HTTPS, blocked sign-in
  attempts).
* Sections: *Visibilidad en Google* (PageSpeed performance on phones and
  computers, SEO, accessibility), *Contenido*, *Seguridad y respaldo* (HTTPS
  certificate date, latest backup), *Soporte*. Sections without data are left
  out rather than shown empty.
* Optional message from the team; the branded e-mail embeds the logo (no remote
  images) and replies go to the owner.
* Comparison with the previous month on each figure (`trend`: direction, text,
  good/bad/neutral — green ▲ / red ▼ in the e-mail, PDF and preview).
* *Visitas y contactos* (first-party statistics and Prospectos: visits, sources,
  share from phones, contact clicks, messages by service, follow-up, won amount,
  time to first contact) and service levels under *Soporte* (first-response time
  against the owner's target, satisfaction 1–5) plus tickets closed automatically.
* **PDF version** (`cms/src/Pdf.php`, a ~300-line writer with the standard
  Helvetica fonts and Windows-1252 text — no external library): attached to every
  sent report and downloadable from the page (`POST /api/site-report/pdf`).

Recipients: up to 20 (Namecheap allows 50 per message), validated and saved;
the owner is always in Cc. *Enviarme una prueba* sends only to the owner and is
not recorded. If last month's report hasn't been sent by the end of day 5, the
owner gets one reminder e-mail (from the scheduled check, or when the owner
opens the page), and the dashboard shows a warning. Months before the site was
in use are skipped.

Google PageSpeed scores are fetched by the scheduled check at most once a day,
only when `APP_URL` is a public https address. `PAGESPEED_API_KEY` (free Google
Cloud key restricted to the PageSpeed Insights API) is recommended — Google may
refuse anonymous requests. `PAGESPEED_ENABLED=false` turns it off. The HTTPS
certificate expiry is checked daily; under 3 weeks it is logged as a warning.

### 9c. Prospectos (leads), statistics and service levels

* **Leads.** `assets/contact-handler.php` stores every validated message
  (`Leads::capture`, max 200/day) **before** e-mailing it; the e-mail links to
  `/admin/#/prospectos/{id}`. If the e-mail fails but the lead was stored, the
  visitor still gets "sent" and the lead shows `notified = 0`. Status
  new → contacted → quoted → won/lost (first move records `contacted_at`, won/lost
  `closed_at`), whole-quetzal amount, notes and a history of every change. CSV
  export is UTF-8 with BOM and formula-safe (cells starting with `= + - @` tab/CR get
  an apostrophe). Retention 6/12/24/36 months (owner; default 24): the scheduled
  check deletes older leads and the privacy notice states the period. Access: owner
  and the `leads` permission (access type "Ventas").
* **Tickets.** `first_response_at` = first public answer or status change by IT
  (notes don't count); the reporter rates resolved tickets once (1–5 + comment; 1–2
  marks it unread for IT); resolved tickets close automatically after 7 days
  (`closed_auto`). The owner sets the response target (4/8/24/48/72 h).

**Turning on Cloudflare Web Analytics** (all three steps are required):
1. Update the privacy notice §2 (`cms/templates/privacy-notice.html.tpl`) — it
   describes only the site's own statistics — to name Cloudflare as a third party,
   and republish. *(Legal text: get the owner's approval first.)* The built-in
   statistics (§9c) usually make this unnecessary.
2. Add `https://static.cloudflareinsights.com` to `script-src` and
   `https://cloudflareinsights.com` to `connect-src` in the root `.htaccess` CSP.
3. Put the token in `.env` (`CF_WEB_ANALYTICS_TOKEN=…`) and republish.

Evaluated and not chosen: Sentry (free tier 5k errors/month, 1 user, ~20–25 KB
gzipped SDK on every page — heavier than needed here), Google Analytics 4
(cookies → consent banner required), Plausible (no free tier).

## 10. Configuration (`.env`)

All keys are documented in `.env.example`. Required in production: `APP_ENV`,
`APP_URL`, `OWNER_EMAIL`. E-mail (`SMTP_*`, `SUPPORT_EMAIL`, `ALERT_EMAIL`,
`CONTACT_*`, `TURNSTILE_*`) is normally set by the owner in the panel (panel values
win; `.env` is the fallback; `EMAIL_SETTINGS_LOCKED=true` = .env only). Alerts:
`ALERT_LOGIN_FAILURES`, `ALERT_ERROR_SPIKE`. Common: `SUPPORT_EMAIL` (default `it@gruposensum.com`),
`SESSION_IDLE_MINUTES`, `SESSION_ABSOLUTE_HOURS`, `INVITE_TTL_HOURS`,
`RESET_TTL_MINUTES`, `UPLOAD_MAX_MB`, `PUBLIC_ERROR_REPORTING`,
`CF_WEB_ANALYTICS_TOKEN`, `DEEPL_API_KEY` + `TRANSLATE_DAILY_CHAR_LIMIT`
(automatic translation), `OWNER_EMAIL`, `ALERTS_ENABLED`, `ALERT_EMAIL`,
`ALERT_COOLDOWN_MINUTES`, `ALERT_DAILY_MAX`, `ERROR_LOG_DAYS`, `DISK_WARN_MB`
(monitoring), `PAGESPEED_ENABLED`, `PAGESPEED_API_KEY` (monthly report), `SETUP_TOKEN` (remove after first use), `PUBLIC_DIR`
(only if the folders aren't side by side), `APP_KEY` (optional; otherwise
generated into `storage/app.key`). Testing only: `STORAGE_DIR`, `DEEPL_API_URL`,
`PAGESPEED_API_URL`, `TURNSTILE_VERIFY_URL` (ignored in production).

## 11. Command line (`php sensum-cms/bin/console …`)

`check` · `migrate` · `create-admin` · `publish` · `render <dir>` ·
`mail:test <email>` · `translate:test` (checks the DeepL key, shows usage) ·
`monitor` (scheduled check + automatic alerts, cron) · `alert:test` ·
`reports:retry` · `backup` (consistent DB copy, keeps 14) ·
`integrity:accept` (record the current public files as expected) ·
`2fa:reset <email>` (turn off an account's two-step sign-in when it is locked out) ·
`monitor` also closes resolved tickets after 7 days and deletes leads past retention ·
`demo-users [--reports]` (local demo accounts per access profile; refused in production)

## 12. Logs, backups and recovery

* Logs: `storage/logs/app-YYYY-MM.log` (JSON lines): failed logins, throttling,
  content changes, uploads, password changes/resets, invitations, report
  submissions, e-mail failures, publish drift, unhandled errors (with reference
  codes). Activity is also in the `activity_log` table (shown on the dashboard).
* What to back up: `sensum-cms/storage/database.sqlite`, `public_html/assets/uploads/`,
  `sensum-cms/.env` (in a password manager, not e-mail), and the release zip.
  The three generated pages can always be recreated with `bin/console publish`.
* Automatic safety nets: the last 30 published versions of the pages
  (`storage/backups/published/`), removed photos kept 30 days, every content
  change recorded with its previous value.
* Off-server copy: **Seguridad** e-mails an AES-256 encrypted ZIP (database via
  `VACUUM INTO`, uploads, restore instructions) on a daily/weekly/monthly schedule
  run by the scheduled check; `offsite_backup` alerts when it fails or is overdue.
* Restore procedures: `NAMECHEAP_DEPLOYMENT.md` §12–13 and the guide's rollback section.

## 13. Known limitations

* No draft/review workflow: saved changes publish immediately.
* Automatic translation is machine translation: it must be reviewed (the panel
  says so on every translated box). Photo descriptions (alt text) and contact
  details are not translated automatically.
* No content version history UI (previous values are in the activity log and
  page backups; restoring is manual).
* Single-factor authentication (no 2FA yet).
* Account lockout can be triggered by anyone who knows an editor's e-mail
  (5 wrong passwords → 15 minutes); password reset still works during lockout.
* If a proxy/CDN such as Cloudflare is put **in front** of the site, all visitors
  share the proxy's IP for throttling; the app would need to trust the proxy's
  client-IP header first.
* Structured opening hours (JSON-LD) are dropped — not edited — when the visible
  hours text changes; the FAQ answer about hours must be updated by hand.
* The contact form's recipient (`TO_EMAIL` in `assets/contact-handler.php`) and
  its service options are not editable from the panel.
* PDFs are checked for being real PDFs but not scanned for malware.
* Content limits protect the layout; extremely long words can still wrap
  awkwardly on 320 px phones.
