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

## 2. Features

| Area | What users can do |
|---|---|
| Texts | 92 bilingual fields (ES + EN) across Inicio → Sección principal, Nosotros, Servicios, Proceso, Tipos de proyectos, Llamado a la acción, Contacto, Preguntas frecuentes, Pie de página. Friendly names, help text, limits, live counters, highlight preview (`*palabra*`), restore original, unsaved-changes protection, edit-conflict detection |
| Contact details | Office/mobile phone (mobile optional), WhatsApp number, e-mail, address (building, street, office, city), map card title, Google Maps link (host allow-list), Instagram link and handle. Updates contact section, footer, WhatsApp button, form fallback text, structured data, 404 and privacy pages |
| Photos | "Nosotros" photo; per project: card photo and a "Ver detalles" gallery (up to 10, ordered). Preview of the exact crop per screen shape, framing control, alt text ES/EN, replace, remove |
| Documents | Replace the portfolio PDF (or go back to the sample) |
| Users (admins) | Invite (e-mailed single-use link), resend, change role (Administrador / Editor), disable/enable, delete; last-admin and self-lockout protection |
| Account | Name, panel language, theme; change password (signs out other devices); sign out other sessions |
| Support | "Reportar un problema" from every screen; history with delivery status and retry |
| Dashboard | Site status, last publish, sync check + republish (admins), diagnostics, recent errors, recent activity, monitoring status |
| Interface | Spanish by default, English optional; light/dark/system theme; responsive from 320 px phones to large monitors; reduced-motion aware |

**Roles.** *Administrador*: everything. *Editor*: texts, contact details,
photos, documents, own account, reports — no user management or republish.

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

## 4. Data model (SQLite, `cms/migrations/001_initial.sql`)

| Table | Purpose |
|---|---|
| `users` | e-mail (unique, lower-case), name, role, status (invited/active/disabled), Argon2id/bcrypt hash, language, theme, timestamps |
| `sessions` | SHA-256 of the session cookie, CSRF token, created/last-seen/expiry, pseudonymized IP, user agent |
| `user_tokens` | SHA-256 of invitation/reset tokens, purpose, expiry, used-at |
| `content` | key, language (`es`/`en`/`*`), value, who/when |
| `media` | slot, position, server-generated file base, extension, size, generated widths, alt ES/EN, sanitized original name, soft-delete date |
| `settings` | last publish, published file hashes, drift notice |
| `support_reports` | reporter, type, title, description, area, page, allow-listed context, screenshot file, delivery status/attempts |
| `activity_log` | who did what (content changes keep old/new values, max 300 chars each) |
| `rate_limits` | fixed-window counters (keys are HMAC pseudonyms, never raw IPs/e-mails) |
| `error_events` | grouped server/admin/public errors (message redacted, count, first/last seen) |
| `schema_migrations` | applied migrations (also applied automatically on first request) |

## 5. API (all under `/api`, JSON)

| Method & path | Access | Purpose |
|---|---|---|
| `GET /api/health` | public | status per area only (no versions/paths) |
| `POST /api/telemetry/error` | public, throttled | JS error from the admin (and public site if enabled) |
| `GET /api/auth/session` | public | current user + CSRF token, or `setupRequired` |
| `POST /api/auth/login` · `/logout` | public | sign in/out |
| `POST /api/auth/forgot` · `/reset/verify` · `/reset` | public | password reset |
| `POST /api/auth/invitation/verify` · `/invitation/accept` | public | invitation |
| `POST /api/setup` | public, one-time | first admin with `SETUP_TOKEN` |
| `GET /api/dashboard` | user | dashboard data (admins get diagnostics/errors/activity) |
| `POST /api/site/republish` | admin | regenerate pages |
| `GET /api/content` · `PUT /api/content/{section}` | user | read/save a section (optimistic `version`) |
| `GET /api/media` · `POST /api/media/{slot}/upload` · `PUT /api/media/{slot}/order` · `PUT`/`DELETE /api/media/item/{id}` | user | photos & PDF |
| `PUT /api/account/profile` · `POST /api/account/password` · `POST /api/account/sessions/revoke-others` | user | own account |
| `GET`/`POST /api/reports` · `POST /api/reports/{id}/retry` | user | support reports |
| `GET`/`POST /api/users` · `POST /api/users/{id}/resend` · `PUT`/`DELETE /api/users/{id}` | admin | user management |

Errors are `{"ok":false,"error":"<code>","fields":{…}}`; the admin translates
codes into friendly ES/EN text. Unexpected failures return only
`server_error` and a 6-character reference that matches a line in the log.

## 6. Security model (summary — details in `SECURITY_AUDIT.md`)

* Authentication: Argon2id (bcrypt fallback), 10+ character passwords with a
  common-password block-list, generic errors, timing-equalized lookups,
  per-account (5/15 min) and per-IP (20/15 min) failure throttling.
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
| Health endpoint | `GET /api/health` → `{"status":"ok|degraded","checks":{…}}`, HTTP 200/503 | on |
| Admin JS errors | first-party, grouped on the dashboard (14 days) | on |
| Server errors | log file + grouped on the dashboard with a reference code | on |
| Public JS errors | `PUBLIC_ERROR_REPORTING=true` adds `assets/error-reporter.js` (≤3 reports/page, message + file:line + path only, no cookies) | **off** |
| Visitor analytics + Core Web Vitals (LCP, CLS, INP, TTFB) | Cloudflare Web Analytics: free, cookieless, no DNS change required. Set `CF_WEB_ANALYTICS_TOKEN` and republish | **off** |
| Uptime + SSL expiry | external — Better Stack free plan (10 monitors, 3-min checks, SSL/domain expiry) or UptimeRobot free (50 monitors, 5-min, no SSL alerts on free) | set up at deployment |

**Turning on Cloudflare Web Analytics** (all three steps are required):
1. Update `privacy-notice.html` §2 — it currently states the site uses no
   analytics (see `MEASUREMENT-PLAN.md`) — and republish. *(Legal text: get the
   owner's approval first.)*
2. Add `https://static.cloudflareinsights.com` to `script-src` and
   `https://cloudflareinsights.com` to `connect-src` in the root `.htaccess` CSP.
3. Put the token in `.env` (`CF_WEB_ANALYTICS_TOKEN=…`) and republish.

Evaluated and not chosen: Sentry (free tier 5k errors/month, 1 user, ~20–25 KB
gzipped SDK on every page — heavier than needed here), Google Analytics 4
(cookies → consent banner required), Plausible (no free tier).

## 10. Configuration (`.env`)

All keys are documented in `.env.example`. Required in production: `APP_URL`,
`SMTP_*`. Common: `SUPPORT_EMAIL` (default `it@gruposensum.com`),
`SESSION_IDLE_MINUTES`, `SESSION_ABSOLUTE_HOURS`, `INVITE_TTL_HOURS`,
`RESET_TTL_MINUTES`, `UPLOAD_MAX_MB`, `PUBLIC_ERROR_REPORTING`,
`CF_WEB_ANALYTICS_TOKEN`, `SETUP_TOKEN` (remove after first use), `PUBLIC_DIR`
(only if the folders aren't side by side), `APP_KEY` (optional; otherwise
generated into `storage/app.key`). Testing only: `STORAGE_DIR`.

## 11. Command line (`php sensum-cms/bin/console …`)

`check` · `migrate` · `create-admin` · `publish` · `render <dir>` ·
`mail:test <email>` · `reports:retry` · `backup` (consistent DB copy, keeps 14)

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
* Restore procedures: `NAMECHEAP_DEPLOYMENT.md` §12–13.

## 13. Known limitations

* No draft/review workflow: saved changes publish immediately.
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
