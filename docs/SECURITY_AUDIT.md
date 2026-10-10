# Security audit — Sensum Content Manager

Scope: everything added on the `content-manager` branch (PHP application in
`cms/`, API entry point `api/`, admin interface `admin/`, public-site changes,
`.htaccess` rules, release packaging) plus its interaction with the existing
site. Date: October 2026. Two audit passes were performed; the second
re-verified every fix.

---

## 1. Method and tools

| Check | Tool / method | Result |
|---|---|---|
| Manual code review | line-by-line review of auth, sessions, tokens, uploads, reports, templates, publishing, admin rendering | findings below |
| Automated security tests | 84 API integration tests (`tests/integration`), incl. 7 adversarial; 59 browser runs (`tests/e2e`) on Chrome and WebKit | all pass |
| Production-like server | built release under **Apache 2.4 + PHP-FPM** (`tests/apache`) — headers, deny rules, upload execution | 6/6 pass |
| Static analysis | PHPStan 2.3, level 6, PHP 8.1 target (`cms/src`, `api/`) | 0 errors |
| Dependency audit | `composer audit` (PHPMailer 6.12.0); `npm audit` (dev-only test tooling) | 0 advisories / 0 vulnerabilities |
| Secrets scan | full git history (`git log --all -p`): secret files, key material, credential patterns, the test passwords used during development | none found |
| Dangerous sinks | grep for `innerHTML`, `eval`, `new Function`, `document.write` (JS) and `eval/exec/system/unserialize` (PHP) | admin: none; PHP: only a fixed `stty` call in the CLI |
| Accessibility of security UI | axe-core WCAG 2.1 AA on every admin screen, light and dark | no serious/critical issues |
| Compatibility | full API suite on PHP 8.2 and 8.5 | 84/84 on both |

## 2. Findings (Audit 1) and fixes

| # | Severity | Finding | Fix | Verified by |
|---|---|---|---|---|
| F1 | **High** (availability) | On real Apache, a `<FilesMatch>` deny in `api/.htaccess` was evaluated against the original URL before the rewrite → **every API call returned 403**. Invisible on PHP's built-in server. | Rule removed (folder only contains `index.php`; dotfiles denied site-wide) | `tests/apache` |
| F2 | Medium | Truncated/corrupted JPEG/PNG/WebP files were accepted (GD decodes partial images with a warning) | Any decoder warning ⇒ `image_corrupt`; `gd.jpeg_ignore_warning` disabled during decode | `06-media`, manual |
| F3 | Medium (integrity) | Overlapping navigations could re-render a screen after the user had started typing, discarding the input | Sequence-numbered, cancellable navigation; no-op language changes ignored | `e2e/admin.spec.js` |
| F4 | Low | Login returned the CSRF token of the user's *latest* session (a concurrent login on another device could receive the wrong token) | Session creation returns its own token | code review, `02-auth` |
| F5 | Low | Password-change throttle counted policy mistakes, so users could lock themselves out | Only wrong *current-password* guesses count (5 / 15 min) | `03-passwords` |
| F6 | Low | Report rate limit ran before validation and duplicate detection | Order: validate → duplicate check → limit → store | `07-reports` |
| F7 | Low | PDFs were served with the site CSP **and** `sandbox` (both enforced, but not the intended policy) | `Header always set` replaces it with `sandbox` only | `tests/apache` |
| F8 | Info | Duplicate `X-Content-Type-Options` header on uploads | Removed (root already sends it) | `tests/apache` |
| F9 | Info | Static-analysis findings: redundant condition, dead catch, unreachable branch, unused state, imprecise types; possible `null` to `strlen`; 0-px image variant edge case | Fixed | PHPStan, tests |

No critical findings. No authentication bypass, injection or access-control
flaw was found.

## 3. Area-by-area review

### Authentication
* **Hashing:** `password_hash` with Argon2id (bcrypt fallback, 72-byte guard);
  rehash on login when the algorithm changes. Never stored or logged in clear
  (tested: hash format, no plaintext in DB).
* **Policy:** 10–128 characters, block-list of common passwords, not equal to the
  e-mail, no composition rules (NIST 800-63B).
* **Brute force:** 5 failures per account and 20 per IP per 15 minutes → 429;
  the correct password is also refused while locked (tested). Unknown accounts
  are throttled identically.
* **Enumeration:** identical response/body for wrong password, unknown or
  disabled account; dummy hash verification equalizes timing; forgot-password
  always answers "ok" and sends e-mail after the response is flushed
  (`fastcgi_finish_request`/`litespeed_finish_request`).
* **Setup:** first admin via CLI, or once via `SETUP_TOKEN` (≥ 24 chars, rate
  limited); closes permanently when any user exists (tested).
* **Registration:** none; accounts only by invitation.

### Sessions and cookies
* 256-bit random value; DB stores only SHA-256; client-chosen IDs never accepted
  (fixation test).
* Production cookie `__Host-sensum_admin; Secure; HttpOnly; SameSite=Strict; Path=/`
  (tested in production mode). Development uses a non-`Secure` name for `http://`.
* Expiry: 60 min idle (sliding), 12 h absolute (tested by aging rows).
* Logout deletes the session server-side (replay test). Password change rotates
  the current session and ends all others; reset, disable and delete end all.
* Role or status changes take effect on the next request (role read per request).

### Authorization
* Route guards: `public` / `user` / `admin` declared per route in `Api/Kernel.php`.
* Tested: every protected route returns 401 anonymously; editors get 403 on user
  management and republish; report retry is limited to its author or an admin
  (IDOR test returns 404); admins cannot demote/disable/delete themselves; the
  last active admin cannot be removed.

### CSRF and request forgery
* SameSite=Strict cookie + per-session token in `X-CSRF-Token` + `Origin`
  allow-list on every state-changing request, including sign-in (login CSRF).
  Requests without `Origin` (or with a foreign one) are refused (tested).

### Password reset and invitations
* 256-bit tokens, SHA-256 at rest, single use (atomic `UPDATE … WHERE used_at IS NULL`),
  expiry 60 min / 72 h, a new token invalidates the previous one, links use the URL
  fragment (never reach server logs or `Referer`), throttled (3 resets per address per
  hour, 30 token checks per IP per 15 min). Never e-mails passwords. Invalid,
  expired, reused and superseded links tested.

### File uploads
* Extension allow-list, sniffed MIME (`finfo`) and decoder type must agree;
  dimension (≥ minimum, ≤ 12 000 px/side, ≤ 40 MP) and memory pre-checks
  (decompression bombs); decoder warnings = corrupt.
* Every image re-encoded from pixels (EXIF/GPS and payloads removed — polyglot
  JPEG+PHP tested). PDFs: `%PDF-` header and `%%EOF` trailer, ≤ 20 MB.
* Server-generated names; uploads folder allows only `name-wNNN.webp|jpg` and
  `name.pdf`; `.php`/`.html`/`.svg` planted there are refused and never executed
  (Apache test); `Options -Indexes -ExecCGI`; PDFs `Content-Disposition:
  attachment` + `CSP: sandbox`.
* Limits: 10 MB images (configurable), 60 uploads/hour/user, 10 photos per gallery.

### Support reporting
* Authenticated only; validated lengths; 5 per 10 min and 20 per day per user;
  duplicates detected; retries throttled.
* Report text is untrusted: escaped in the HTML e-mail, plain text alternative,
  `textContent` in the admin (tested with `<script>`/`onerror` payloads).
* Header injection: subject stripped of CR/LF and encoded by PHPMailer; recipients
  fixed by configuration; Reply-To taken from the session, not the request
  (tested: no `Bcc` injected).
* SMTP errors are logged as a category only; the user sees a friendly message;
  the report is kept as `failed` and can be retried (tested with SMTP down).
* Context is allow-listed (cookies/passwords sent by a tampered client are
  dropped — tested); screenshots validated and re-encoded like other images,
  stored outside the web root.

### Input handling, XSS, injection
* SQL: prepared statements everywhere; `IN (…)` lists built from counts, never
  values; injection strings in login/e-mail fields tested.
* Stored XSS on the public site: `<`/`>` refused in content, every value escaped
  for its context, URLs allow-listed per field (`https`, no credentials/port/
  quotes), JSON blocks `JSON_HEX_TAG`, `main.js` only accepts markup for two
  server-built keys.
* Admin XSS: DOM built with `textContent` only (`h()` refuses `innerHTML`);
  strict CSP with no `unsafe-inline`.
* Control/bidi/zero-width characters stripped; invalid UTF-8 rejected; JSON
  bodies capped at 256 KB; unknown fields/languages rejected.
* No redirects based on user input. The only server-side outbound request is
  the optional DeepL call (§7): fixed host chosen by the key type, never a URL
  from input, no redirects followed (no SSRF surface).
* Path traversal: slot ids validated by pattern and lookup; file names never
  derived from input; screenshot names re-validated before attaching.

### Headers and server configuration
* Public site: existing strict CSP, HSTS, `X-Frame-Options: DENY`, nosniff,
  Referrer-Policy, Permissions-Policy, COOP/CORP — unchanged.
* Admin: own CSP (`default-src 'self'`, `img-src` adds `data: blob:` for upload
  previews, no third parties, `frame-ancestors 'none'`, `base-uri 'none'`,
  `form-action 'none'`), `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`,
  `Cache-Control: no-cache` for admin assets — verified on Apache that these
  replace (not merge with) the public values.
* API: `no-store`, JSON content type, `display_errors` off, `X-Powered-By` removed,
  generic errors with reference codes (tested: no paths/SQL/exception names).
* Private code/data outside `public_html`; `.htaccess` deny rules as a safety net
  (tested by planting files); directory listing off.

### Secrets
* Only `.env.example` is tracked; `.env`, database, `app.key`, uploads, storage and
  the local test-account note are git-ignored; release build refuses to package
  them. History scan clean.
* SMTP credentials only in `.env` (outside the web root); never logged (the
  logger redacts secret-looking keys automatically).

### Telemetry privacy
* Admin/public error reports: message (long tokens and e-mails redacted),
  file:line, path without query string; per-IP and global daily caps.
* Public reporting and analytics are off by default; enabling analytics
  requires a privacy-notice update first (documented).

## 4. Audit 2 — re-verification after fixes

Re-run on commit `c8e709c` (and again for the final release):

| Area | Evidence | Result |
|---|---|---|
| Login, enumeration, throttling, cookies | `02-auth` (12 tests) | pass |
| Authorization / IDOR | `02-auth`, `04-users`, `07-reports`, `09-adversarial` | pass |
| Sessions (expiry, rotation, revocation, tampering, swapped CSRF) | `02`, `03`, `09` | pass |
| Password reset & invitations | `03-passwords`, `04-users` | pass |
| Uploads (malicious, corrupt, polyglot, oversized, traversal names) | `06-media`, `09-adversarial`, `tests/apache` | pass |
| Support reports (auth, limits, escaping, header injection, SMTP failure) | `07-reports`, `e2e` | pass |
| Input sanitization (XSS, HTML, URLs, encodings) | `05-content`, `09-adversarial` | pass |
| Protected APIs / CSRF / origin | `02-auth`, `09-adversarial` | pass |
| Secrets | history + release scan | clean |
| Production assumptions (Apache, `.htaccess`, PHP-FPM) | `tests/apache` on the built release | 6/6 |
| Dependencies | `composer audit`, `npm audit` | clean |

## 5. Remaining risks and accepted limitations

| Risk | Rating | Notes / mitigation |
|---|---|---|
| Second factor optional for editors | Low | Two-step sign-in (TOTP) is mandatory for the owner by default; the owner can require it for everyone (Seguridad). |
| Account lockout as nuisance (5 wrong passwords → 15 min) | Low | Reset by e-mail still works; trade-off accepted against brute force. |
| Throttling uses `REMOTE_ADDR` | Low | Correct on Namecheap shared hosting. If a proxy/CDN is placed in front, trust its client-IP header first. |
| Compromised editor account can deface content or host a PDF | Low–Medium | Limited to escaped text, re-encoded images and real PDFs; everything is logged with old values and backed up; disable the account to stop it. |
| Error telemetry can be flooded (anonymous endpoint) | Low | Per-IP 30/h and global 500/day caps; affects only the dashboard's error list. |
| PDFs not malware-scanned | Low | Uploaded only by trusted users; served as download with sandbox CSP. |
| SQLite single-writer | Low | Writes are rare and serialized (`BEGIN IMMEDIATE`, busy timeout); tested with concurrent saves. |
| `MAIL_DRIVER=log` stores reset links on disk | Low | Development only; private folder; never use in production. |
| PHPMailer 7.x available | Info | 6.12.0 has no advisories; upgrade deliberately later (major version). |

## 6. Production recommendations

1. HTTPS active before go-live (existing `.htaccess` forces it; HSTS already set).
2. `APP_ENV=production`, correct `APP_URL=https://sensumconstrucciones.com`.
3. `sensum-cms/` **outside** `public_html`; `.env` permissions 600; storage 700.
4. Remove `SETUP_TOKEN` from `.env` after creating the first administrator.
5. Use a dedicated SMTP mailbox (e.g. `notificaciones@sensumconstrucciones.com`) with a
   unique password; publish SPF, DKIM and DMARC (cPanel → Email Deliverability).
6. PHP 8.2+ in cPanel with `pdo_sqlite`, `gd`, `fileinfo`, `mbstring`, `exif`,
   `intl`, `curl`, `zip`, `sodium`; `memory_limit` 256M, `upload_max_filesize` 16M, `post_max_size` 20M,
   `display_errors` Off.
7. Keep at least two administrators (one from IT) and remove accounts that are
   no longer needed.
8. Set up the external uptime/SSL monitor; review the dashboard's errors and
   activity monthly; keep PHP and PHPMailer updated (`composer audit`).
9. Back up the database and uploads as described in `NAMECHEAP_DEPLOYMENT.md`, and
   turn on the encrypted off-server backup (Seguridad) to a mailbox outside the hosting.
11. Activate two-step sign-in on the owner account at the first sign-in (forced)
    and store the recovery codes in a password manager.
10. After deployment, verify headers (command in `NAMECHEAP_DEPLOYMENT.md` §10).

## 7. Change review — automatic translation (DeepL), added after Audit 2

A feature added after the two audits, reviewed and tested to the same standard.

| Area | Design | Verified by |
|---|---|---|
| Access | `POST /api/content/translate`: signed-in users only, same-origin + CSRF like every change; saves nothing | `10-translation` (anonymous 401, no CSRF 403, foreign origin 403, version unchanged) |
| Input | only bilingual text fields from the schema; `es`/`en` only and different; ≤ 50 items, ≤ 4,000 bytes each; `<`/`>` refused (`no_html`) | `10-translation` (8 malformed shapes, HTML payload, oversized) |
| Output | DeepL replies are untrusted: tags stripped, entities decoded, `<`/`>` removed, control characters stripped, then shown in a text box (`value`, never HTML) and validated again on save | `10-translation` (hostile reply with `<script>`/`onerror`) |
| Outbound request | fixed host `api-free.deepl.com` / `api.deepl.com`; TLS verified; no redirects; 5 s connect / 15 s total timeout. `DEEPL_API_URL` (tests) is ignored unless `APP_ENV=development` | `10-translation` (production ignores the override) |
| Secret | `DEEPL_API_KEY` only in `.env` (git-ignored, outside the web root); sent only in the `Authorization` header; never logged (logger also redacts `api_key`-like keys) | `10-translation` (logs scanned for the key and for edited text after failures) |
| Data sent | only the text being edited (public website copy); no names, e-mails or settings. DeepL API Free may use submitted text to improve its models; Pro deletes it — documented in `CONTENT_MANAGER.md` §2a | review |
| Abuse / cost | 300 requests per user per hour; `TRANSLATE_DAILY_CHAR_LIMIT` (default 60,000 characters/day, all users) | `10-translation` (cap returns `translation_busy`) |
| Failure | quota (456), rate limit (429), bad key (401/403), outage (5xx/network) → short error code, category logged, nothing changed in the editor, saving unaffected | `10-translation`, `e2e/translate.spec.js` |
| Admin UI | no new `innerHTML`; strict admin CSP unchanged (the browser never talks to DeepL); axe scan of the editor with translation notes: no serious issues | `e2e/translate.spec.js` on Chrome desktop/tablet and iPhone (WebKit) |

Static analysis (PHPStan level 6): 0 errors after the change. No new dependency
(uses PHP's curl, with a stream fallback).

## 8. Change review — monitoring, error log and critical-error alerts

Added after the audits at the owner's request; reviewed and tested to the same standard.

| Area | Design | Verified by |
|---|---|---|
| Access | `GET /api/monitor/*` and `POST /api/monitor/test-alert` use a server-side `owner` guard: active administrator **and** e-mail = `OWNER_EMAIL` (default it@gruposensum.com). The dashboard sends diagnostics and errors only to the owner. The menu entry is cosmetic; the API refuses everyone else | `11-monitoring` (other admin 403, editor 403, anonymous 401; dashboard fields absent); `e2e/admin.spec.js` |
| Owner protection | other administrators cannot demote, disable or delete the owner (`owner_protected`); the owner manages everyone else | `11-monitoring` |
| What is stored | redacted message (no long tokens, no e-mail addresses, no control characters), code location (file:line, no full path), request method + path (no query string), reference code, user id, a few small context values already passed through the logger's secret redaction. Never request bodies, cookies, CSRF/session/reset/invitation tokens, passwords or SMTP data | `11-monitoring` (alert scanned for the password, CSRF token and session cookie); `08-system` (token/e-mail redaction) |
| Alert e-mail | fixed recipient from configuration; every value HTML-escaped; subject built from fixed labels (no user text); link built from `APP_URL` | `11-monitoring` |
| Abuse / flooding | the only anonymous paths that can add entries are the throttled telemetry endpoint (30/h per IP, 500/day) and `/api/health` (a degraded entry at most once per 15 min per failure). Alerts: same error once per cooldown (60 min), ≤ 20/day, file-based state with `flock` (works with the database down) | `11-monitoring` (cooldown, repeats count, daily cap, health polling) |
| Failure safety | recording an error never throws (database down → file log still written, alert still sent); alerts are sent after the response; e-mail failure marks the entry "failed" and the scheduled check re-sends one summary; no recursion between logger, error log and mailer | `11-monitoring` (SMTP down → failed → `monitor` re-sends) |
| Query safety | filters are allow-listed (severity, source), numbers cast, search uses bound parameters with escaped `LIKE` wildcards; hostile values return 200 with no effect | `11-monitoring` |
| Retention | `ERROR_LOG_DAYS` (180) enforced by the scheduled check and opportunistically | `11-monitoring` |
| Admin UI | rendered with `textContent` only (error messages are untrusted text); strict CSP unchanged; axe scans of the Monitoring page in light/dark on 3 devices | `e2e/admin.spec.js` |

Residual risk: an attacker who can trigger many *different* server errors is
still capped at 20 alert e-mails per day (then entries are logged as
"suppressed"). Alerts cannot report a full server outage — the external uptime
monitor covers that. PHPStan level 6: 0 errors after the change.

## 9. Change review — owner-only user management, access types, monthly report

| Area | Design | Verified by |
|---|---|---|
| User management | All `/api/users*` routes use the `owner` guard (active account whose e-mail is `OWNER_EMAIL`). The legacy `role` column grants nothing; a former "admin" without the owner e-mail gets 403 | `04-users` (full-access account, legacy-admin role, editor: all 403) |
| Access types | Permissions `texts`, `contact`, `photos`, `documents`, `site` checked on the server for every change: section saves (`details` → contact), translation, uploads/alt text/delete/reorder (by the item's slot), republish, dashboard activity. Allow-listed values, canonical order, at least one | `04-users` (each type allowed/refused per area; item-level checks; changes apply on the next request) |
| Owner protection | The owner cannot be changed or deleted through the panel (not even by itself); disabling a user ends their sessions | `04-users` |
| Monthly report | Owner-only API. Recipients validated (ASCII e-mail, ≤ 120 chars, ≤ 20, de-duplicated, owner excluded because always in Cc); header injection impossible (PHPMailer + validation). Report text is built from fixed strings and numbers; the optional note is plain text (control characters stripped, ≤ 600, HTML-escaped). Send limited to 10/hour; test sends go only to the owner | `12-site-report` |
| Reminder | At most one per month, only after day 5, only if the site existed during that month; recorded in settings | `12-site-report` |
| Outbound requests | Google PageSpeed (fixed Google host; test override honoured only in development; the API key is never logged) and the daily HTTPS-certificate check of the site's own host (TLS verified). Both fail soft | `12-site-report` |
| E-mail images | Logo and screenshot preview embedded as attachments (`cid:`); no remote images or tracking | `12-site-report`, `07-reports` |

PHPStan was not re-run for this change (the analysis tool copy used earlier was
removed from the temporary folder); all API (117) and browser (74) tests pass.

## 10. Change review — owner e-mail settings, contact-form captcha, automatic alerts

| Area | Design | Verified by |
|---|---|---|
| E-mail settings page | Owner-only routes (`GET/PUT /api/settings/email`, `POST …/test`). Saving re-checks the owner's password (throttled with password changes, failures logged), is logged, and e-mails a security notice to the owner address with the new settings. `EMAIL_SETTINGS_LOCKED=true` makes it read-only (409). | `13-email-alerts` |
| Secrets at rest | SMTP password and Turnstile secret encrypted (libsodium secretbox, AES-256-GCM fallback) with a key derived from the app key; never returned to the browser, never logged; an empty field keeps the stored value. | `13-email-alerts`, `14-captcha` |
| Header injection | All addresses validated (ASCII, ≤ 120, `FILTER_VALIDATE_EMAIL`), names reject control characters and `<>`, SMTP host strict hostname pattern, port range, encryption allow-list; PHPMailer builds the headers. | `13-email-alerts` |
| Contact form delivery | The handler validates first; the CMS only formats (all visitor text HTML-escaped) and sends with the panel's SMTP account or `mail()` (`-f` only for plain addresses). Visitor only in Reply-To; sender fixed by the owner. | `13-email-alerts` (XSS payload in name/message) |
| Built-in captcha | Proof of work: HMAC-SHA256-signed challenge (key derived from the app key, or a 0600 key file when standalone), 30-minute expiry inside the signed hash, max 250 000, strict payload parsing, single use (flock-protected store of solved challenges until expiry). Runs after the origin check, rate limit, honeypot and timing checks. | `14-captcha` (missing, malformed, oversized, wrong/out-of-range/string number, forged signature, altered expiry, other algorithm, self-made challenge, replay) |
| Cloudflare Turnstile | Optional second layer; server-side `siteverify` with secret, remote IP and idempotency key; hostname must be the site's; built-in captcha still required. Cloudflare unreachable or our secret rejected → fail open to the built-in captcha and log for the owner (availability of leads over a second layer). Test endpoint override honoured only outside production. CSP widened only to `https://challenges.cloudflare.com` (script/frame); the script is loaded lazily and only when enabled. | `14-captcha`, `00-static` |
| Automatic alerts | Owner-only toggles (`PUT /api/monitor/alerts`, allow-listed rule names and booleans). De-duplication state in the database; each rule has a minimum period. New-device notice uses only browser family + OS (no fingerprinting data stored; the IP is shown to the account holder, stored only as a keyed pseudonym in the activity log). | `13-email-alerts` |
| File integrity | SHA-256 of public files vs the release manifest (`release-manifest.json`, built by `tools/build-release.sh`) or the owner-accepted state (trust on first use when no manifest). Flags modified/missing files, new executable/config files (`.php`, `.phtml`, `.phar`, `.htaccess`, `.user.ini`…), unexpected files among uploads (name pattern), and published pages that differ from the saved content. cPanel-generated `.htaccess` blocks are ignored. Accepting needs the owner's password and is logged with the findings. | `13-email-alerts` |

## 11. Change review — support tickets, demo accounts, report figures

| Area | Design | Verified by |
|---|---|---|
| Ticket access | Owner: all tickets; everyone else: only their own — another person's ticket, conversation or screenshot answers 404 (no existence leak). Status, priority and edits are owner-only (403); internal notes are owner-only and never returned to the reporter, nor are edit events or e-mail delivery details | `16-tickets` |
| Input | Messages and descriptions keep line breaks but drop control and bidi-override characters, ≤ 4000; titles ≤ 120; type/area/priority/status allow-listed; search is a parameterised `LIKE` with escaped wildcards; reporter messages limited to 20/hour | `16-tickets` |
| Output | The panel renders all ticket text with `textContent`; e-mails escape every value (HTML payloads verified escaped); the screenshot endpoint serves only generated file names with the stored type, `nosniff`, `no-store` and a sandboxing CSP | `16-tickets`, `admin.spec` (HTML in titles/descriptions shown as text) |
| Notifications | Reporter e-mails go to the account's current address with Reply-To = support; support e-mails carry Reply-To = reporter; both link to the ticket in the panel (no tokens in links; sign-in required) | `16-tickets` |
| Demo accounts | `demo-users` refuses to run unless `APP_ENV=development`; random passwords written only to `storage/LOCAL-TEST-USERS.txt` (0600, git-ignored, web-denied); a rerun resets passwords and ends their sessions | `16-tickets` |
| Report figures | Counts only (no personal data); resolved ticket titles appear in the client report — they are written by the client's own team | `12-site-report` |

Accepted limitations: proof of work raises the cost of automated submissions but a
determined attacker running a full browser can still pay it — that is what the
optional Turnstile layer, the rate limit and the honeypot are for. Visitors without
JavaScript can no longer use the form (they are pointed to WhatsApp/phone, already
shown under the form). Integrity checks run from the scheduled task, so an attacker
with write access to `sensum-cms/` could also alter the manifest — the check is
meant to catch web-root tampering (the usual shared-hosting compromise), not a full
account takeover.

## 12. Change review — two-step sign-in, off-server backups, domain checks, CI

| Area | Design | Verified by |
|---|---|---|
| Two-step sign-in (TOTP) | RFC 6238 (SHA-1, 6 digits, 30 s, ±1 step for clock drift). 160-bit secret from `random_bytes`, stored encrypted (`Secrets`, purpose-separated key); a code is accepted once (last used step stored — no replay). Setup needs the password and a valid code before it is switched on; turning it off or regenerating codes needs the password **and** a code. | `17-protection` |
| Login flow | The password step never creates a session for 2FA accounts: it returns a random 256-bit challenge (only its SHA-256 is stored), valid 5 minutes, max 5 code attempts, single use. The password-step throttling and lockout still apply; failed codes are logged. | `17-protection`, `protection.spec` |
| Recovery codes | 10 random codes, shown once, stored as keyed HMAC-SHA256, each single use; using one notifies the account holder by e-mail. | `17-protection` |
| Enforcement | Policy `owner` (default) / `all` / `none`, changed only by the owner with the password. A required account without 2FA gets a session that can only reach the setup routes (`403 two_factor_setup_required` everywhere else) until it enrols. The owner can reset another person's 2FA (password re-check, logged, e-mail notice); the owner's own reset is CLI-only (`2fa:reset`). | `17-protection`, `protection.spec` |
| QR code | Rendered on the server as an SVG data URI (bacon/bacon-qr-code) — the secret never goes to a third-party QR service; `img-src data:` was already allowed. | `protection.spec` |
| Off-server backup | ZIP encrypted with AES-256 (`ZipArchive::EM_AES_256`) using an owner-chosen password (≥ 12 characters, stored encrypted, never e-mailed or returned to the browser). Contains a consistent SQLite copy (`VACUUM INTO`), uploads (optional, skipped above the size limit with a notice) and restore instructions; no `.env`, keys or logs. Sent to an owner-chosen address on a schedule; download needs the password again. Failures and overdue backups raise an alert. | `17-protection` (decrypts the ZIP with the password and fails without it) |
| Domain and e-mail checks | Read-only public lookups: DNS (`dns_get_record`) and RDAP over HTTPS (redirects limited to HTTPS, timeouts, 500 KB cap). Test overrides (`DNS_STUB_FILE`, `RDAP_URL`) ignored in production. Alerts for missing/permissive SPF, missing DKIM, DMARC absent or `p=none`, no MX, and expiry within 60/30/14/7/1 days. | `17-protection` |
| Fonts | Self-hosted WOFF2; CSP narrowed to `style-src 'self'; font-src 'self'` — no request to Google from visitors' browsers. | `00-static`, `site-functional`, `apache` |
| Supply chain | PHPStan level 6 (0 errors), `composer audit` and `npm audit` in CI on every push; Dependabot weekly for Composer, npm and Actions. PHPStan is a dev dependency (not in the release). | CI workflow |

Accepted limitations: TOTP protects against stolen passwords, not against a
compromised device or a real-time phishing proxy (WebAuthn would; not supported by
the hosting's PHP stack without extra libraries). E-mail is the delivery channel for
the off-server backup, so very large photo libraries exceed mailbox limits — the
backup then omits photos and says so, and the full download remains available.

## 13. Change review — leads inbox, visit statistics, ticket service levels, report PDF

| Area | Design | Verified by |
|---|---|---|
| Leads (personal data) | Visible only to the owner and accounts with the `leads` permission (403 otherwise; demo and access type "Ventas"). Stored after the handler's validation, captcha, honeypot, timing and rate limit; control and bidi characters removed; 200 per day at most (a spam wave cannot fill the database). Retention 6–36 months enforced by the scheduled check and stated in the privacy notice; per-lead deletion (data-subject requests) is logged with a pseudonym, not the address. | `18-value` |
| Lead output | The panel renders every field with `textContent`; the notification e-mail escapes all values and links to the panel (sign-in required, no token). CSV export: UTF-8 BOM, RFC 4180 quoting, and cells starting with `=`, `+`, `-`, `@`, tab or CR prefixed with `'` (CSV/formula injection). Export rate-limited (30/h) and logged. | `18-value`, `value.spec` |
| Lead input | Status allow-listed; amount integer 0–999 999 999 (strings, negatives, floats out of range, arrays refused); notes ≤ 2000, search parameterised with escaped `LIKE` wildcards; `lang` from the form reduced to `es`/`en` and added to the handler's field allow-list (any other unknown field still refused). | `18-value` |
| Visit statistics (privacy) | No cookies, no storage, no IP stored, no per-visitor rows: daily totals per fixed dimension. Daily uniques via `sha256(random daily salt ‖ IP ‖ UA)` truncated; the salt and all markers are replaced/deleted when the day changes, so visitors cannot be linked across days. Referrers reduced to a fixed list of sources (never stored as URLs); `utm_source` mapped to the same list. DNT / Sec-GPC / prefetch requests and `navigator.webdriver` send or count nothing. | `18-value`, `value.spec` (no cookies, no storage) |
| Visit statistics (abuse) | Public endpoint, but origin-checked (403 for other sites), body parsed strictly (malformed → ignored), bot/headless/preview user agents ignored, 120 events per IP per hour and 50 000 per day; always answers 204 so it reveals nothing. Worst case: inflated counts, never data exposure. Same-origin only — CSP `connect-src 'self'` unchanged. | `18-value` |
| Ticket ratings and service levels | Only the reporter rates (403 for IT and others), only resolved/closed tickets (409), once (409), integer 1–5, comment ≤ 500. Auto-close only touches `resolved` tickets older than 7 days, recorded as a system event. Response target allow-listed (owner only). | `18-value`, `value.spec` |
| Report PDF | Own minimal writer (`Pdf.php`): standard fonts only (no font files parsed), every string converted to Windows-1252 and escaped (`\`, `(`, `)`), link annotations only for `http(s)` URLs without delimiters, images only the bundled logo re-encoded through GD. Owner-only download (rate-limited); the attachment is written to a private temporary file and deleted after sending. | `18-value` (parses the PDF, escaped note, xref offset) |

Accepted limitations: statistics can be inflated by someone scripting a real browser
with a forged user agent (bounded by the per-IP and daily caps) — they are marketing
figures, not billing data. Visitors with ad blockers may not be counted. Lead
retention deletes by age regardless of status; export the CSV first if a longer
archive is needed.

## 14. Change review — trend charts, summary monitoring access, translation key in the panel, icon alignment

| Area | Design | Verified by |
|---|---|---|
| Summary monitoring (`monitor` access) | New permission in the allow-list (owner always has it; part of *full*; assignable in custom access). `/api/monitor/overview` and `/series` return counts, percentages and dates only; sign-in figures only for the owner; the full Monitoring, error log, integrity and settings stay owner-only (403). | `19-monitor-translation`, `monitoring.spec` |
| Response-time probe | Outgoing GET only to the configured `APP_URL` (no user input), HTTP/HTTPS only, no redirects followed, 5 s connect / 10 s total, body discarded. Failure is recorded as "no measurement", never as downtime or an alert. | `19-monitor-translation` |
| Charts | Built with DOM/SVG APIs only (text via `textContent`), no `innerHTML`, no inline style attributes (CSSOM for sizes/positions), so the admin CSP is unchanged. | every-screen checks (3 devices × 2 themes, no console/CSP errors) |
| DeepL key in the panel | Owner-only, password re-check, logged without the key; encrypted at rest (libsodium secretbox / AES-GCM, purpose-separated key); responses show only the plan and the last 6 characters; format validated; removing it or switching off disables translation for everyone. The translate endpoint now also serves plain labels, but only to accounts that edit bilingual content (texts/contact/photos/documents; site-text items with a field key still need the texts access) and within the existing per-user and daily character limits; HTML still refused. | `19-monitor-translation`, `translate.spec` |
| UI regression guard | Every-screen browser checks now assert that each icon tile and avatar is centred and square (caught the e-mail overview tiles offset by 9 px). | `admin.spec` |

## 15. Change review — "Ver como" (owner views the panel as another account)

| Area | Design | Verified by |
|---|---|---|
| Who | Only the owner (checked on the real person behind the session, also while viewing). Candidates: active or invited accounts, never the owner itself or disabled accounts; anything else 422. | `20-view-as` |
| Starting | Re-check of the owner's password (shared throttling with password changes), rate-limited (60/h), logged `view_as_started`. Switching needs an active view (409 otherwise) and is logged; leaving and expiry are logged. Passwords never logged. | `20-view-as`, `view-as.spec` |
| Read-only | While viewing, the Kernel refuses every non-GET request (`403 view_only`) except switch/stop and the read-only leads CSV — no content, account, ticket, lead or password change can be made in someone else's name. GET side effects are suppressed too (ticket and lead "unread" markers stay as they were). The viewed person's own sessions are untouched. | `20-view-as`, `view-as.spec` |
| Identity | The owner's session (same cookie, CSRF token and expiry) carries the viewed account id and a 30-minute limit; permission checks, menus and lists use the viewed account, so owner-only routes answer 403 while viewing. Expired, disabled or deleted targets drop back to the owner automatically; signing out ends the owner session. Two-step enrolment is never forced on the owner for the viewed account. | `20-view-as` |
| Transparency | A bar on every screen states who is being viewed, the access type, "solo lectura" and the time left; the panel reloads when the server says the view changed (`X-View-As` header). | `view-as.spec` |


## 16. Change review — access profiles, Salud del sitio, basic statistics, support managers, monthly report wording

| Area | Design | Verified by |
|---|---|---|
| Ready-made profiles | Eight concrete jobs (`Users::ACCESS_TYPES`) built from nine allow-listed permissions; anything else is *custom*. Least privilege by default: *Administrador del sitio* does **not** include `support` (other people's requests, screenshots and technical context), and accounts created from the terminal get that administrator set, not every permission. | `21-profiles-health`, `04-users`, `16-tickets` |
| `support` permission | Replaces the hard-coded owner checks in `Tickets` (`manages()` / `requireManager()`): list, read (incl. internal notes and screenshots), status, priority, edit, reply, retry and the response target. Still 403 for Usuarios, Monitoreo, settings and everything else outside the permission. Never granted automatically (not by migration, not by `create-admin`). Reporters keep seeing only their own requests, without internal notes. | `21-profiles-health`, `profiles.spec` |
| Support charts | `GET /api/reports/analytics` (managers only; `days` limited to 30/90/365) returns counts and averages — no names, e-mails, texts or screenshots. | `21-profiles-health` |
| `stats` permission (basic statistics) | Aggregate, cookie-free counts only. Without `leads` the contact-form figures are `null` and every Prospectos endpoint answers 403, so no personal data reaches this access. Migration `011_access_profiles.sql` adds `stats` only to accounts that already had `leads` (idempotent), so nobody gains new data. | `21-profiles-health`, `profiles.spec` |
| Salud del sitio exposure | Uptime percentages, check counts and incident times/durations only. Which checks failed (database, storage, publishing…) reveals internal components, so it is limited to the owner's `/api/monitor/summary`. | `21-profiles-health`, `profiles.spec` |
| Monthly report wording | «Seguridad» now states the concrete reason (no HTTPS, no/old backup, certificate expiring) instead of a vague «Revisar». HTTPS is only required for public addresses; the local-address exception is decided from the server's own `APP_URL`, never from request input. The report contains no secrets, IPs or account names. | `12-site-report`, `21-profiles-health` |
| Users search | Client-side filtering of the list the owner already receives; no new endpoint or query parameter. | `profiles.spec` |
| Contact-form preview | A local replica: no request to the contact handler, no data stored; validation rules mirror the site's for display only (the server still validates every real message). | `contact-services.spec` |

## 17. Change review — monthly report split: client version and technical detail

| Area | Design | Verified by |
|---|---|---|
| What reaches clients | The e-mail and the PDF are built only from `SiteReport::build()` (client version). It contains results, work done and automatic monitoring in plain words; backups, certificates, domain and e-mail-authentication status, errors, interruption details and technical to-dos are not part of it, so none of that internal posture is disclosed outside the team. Tests scan the client JSON and the sent e-mail for those terms. | `12-site-report`, `17-protection`, `access-report.spec` |
| Technical detail | `SiteReport::technical()` is returned only by `GET /api/site-report/preview`, which requires the new `report` permission (owner included); it is never e-mailed or put in the PDF. | `12-site-report`, `21-profiles-health` |
| `report` permission | View-only: both versions of the last 13 months (period validated as before). Sending, recipients, history and the PDF stay owner-only (403). Part of *Administrador del sitio* and *Soporte técnico*; not of *Gerencia*, *Ventas* or content types. Migration `012_report_access.sql` grants it once to accounts that already had `site` and `monitor` (those two types), so their access type is still recognised. | `12-site-report`, `21-profiles-health`, `access-report.spec` |
| Lead figures for viewers | The client version shows aggregate counts and the won amount only — no names, e-mails or messages — so a viewer without `leads` sees no personal data. | `12-site-report` |

## 18. Change review — first-sign-in welcome, welcome e-mail, «solicitud» wording

| Area | Design | Verified by |
|---|---|---|
| Welcome screen | Shown only to the signed-in account itself (session `welcome` flag from `onboarded_at`), never while the owner views as someone; `PUT /api/account/welcome` changes only the caller's language and theme, validates both against fixed lists, keeps the first `onboarded_at`, is CSRF-protected like every change and is refused with `view_only` during "Ver como". Two-step enrolment, when required, still comes first. | `22-welcome`, `welcome.spec` |
| Welcome e-mail | Sent once, after the invitation is accepted (answer first, then the e-mail), to the account's own address in its language. It contains the access type and permission names, first steps, the support address and safety advice — never the password, the invitation token or any link with a secret (only the panel address). The send is logged without content. | `22-welcome`, `welcome.spec` |
| Wording | «Reportar un problema» → «Solicitar soporte», «reporte» → «solicitud» in the panel and e-mails; «Ayuda» → «Guía de uso». Text only: routes, permissions and stored data unchanged. | existing suites |

