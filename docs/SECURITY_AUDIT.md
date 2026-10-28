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
| User management | (Superseded by §21.) All `/api/users*` routes use the `owner` guard (active account whose e-mail is `OWNER_EMAIL`). The legacy `role` column grants nothing; a former "admin" without the owner e-mail gets 403 | `04-users` (full-access account, legacy-admin role, editor: all 403) |
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

## 19. Change review — Content Manager on its own address (app.sensumconstrucciones.com)

| Area | Design | Verified by |
|---|---|---|
| Host routing | One document root, two names (cPanel subdomain with "Share document root"). The root `.htaccess` sends plain HTTP, `www.` and any unknown Host to the canonical `https://` name with **literal** targets (the Host header is never reflected). `app.` serves only `/admin`, `/api`, `/assets` and `/404.html` (`/` → `/admin/`; public pages → 301 to the site); the apex forwards `/admin*` to `app.`. | `tests/apache/hosts` (HTTP + HTTPS, spoofed Host) |
| API exposure on the public host | `api/.htaccess` (whose rules replace the root ones) lets only `collect`, `health` and `telemetry/error` reach the application on `sensumconstrucciones.com`; sign-in, password reset, setup and every panel endpoint answer Apache's 404 there. | `tests/apache/hosts` |
| Session isolation | The session cookie is `__Host-sensum_admin` (Secure, HttpOnly, SameSite=Strict, no `Domain`): it exists only on `app.` and is never sent to the public site, so a script injected into a public page cannot read or replay it. Writes still need the CSRF token, which only the panel origin can read (no CORS). | `tests/apache/hosts` (production mode over TLS) |
| Allowed origins | `ADMIN_URL` (default `APP_URL/admin`) is added to `APP_URL` (plus `www.`) and `EXTRA_ALLOWED_ORIGINS`; foreign origins stay 403 for sign-in, beacons and the contact form. An invalid `ADMIN_URL` falls back to `APP_URL/admin`. | `23-panel-address` |
| E-mail links | Every link (invitation, reset, welcome, lead, support request, alerts) is built server-side from `ADMIN_URL`, never from the request. The old `/admin/` links keep working through the 301. | `23-panel-address` |
| HTTPS | HSTS `includeSubDomains` already covers `app.`; the deploy guide requires AutoSSL for `app.` before the owner account is created, and the server check flags a non-https `ADMIN_URL` in production. | `23-panel-address` (check output) |

## 20. Change review — configurable contact form (questions) and privacy notice

| Area | Design | Verified by |
|---|---|---|
| Who may change what | Questions: the `contact` permission (same as the business details). Who receives the messages: **owner only** (`owner` guard), with the password re-typed (`confirmPassword`, throttled), an activity entry and a security notice e-mail — changing it could divert customers' data. Read-only for everyone else; "Ver como" cannot write. | `24-form-builder`, `contact-form.spec` |
| Stored questions | Server-side validation of every field: fixed type list (no file uploads), plain one-line texts (no `<`/`>`/control characters), length limits, 15 questions, 20 options, option texts unique, numbers `min ≤ max`; ids generated by the server (`q_` + 6 hex, `o_` + 4 hex), never taken from the client for new items. Name always required; e-mail or phone always present and required. | `24-form-builder` |
| Published markup | Every text is HTML-escaped into the page and into the inert `siteContent` JSON (`JSON_HEX_TAG`); the language toggle applies them with `textContent` (only two whitelisted keys may carry markup, never these). No inline script or style: the strict CSP is unchanged. | `24-form-builder` (published page) |
| Submissions | The handler accepts only the configured question names plus its system fields (anything else → 400); only checkbox questions may send a list (≤ 20 scalars); answers are checked against the saved options (ids), formats (e-mail, phone, number range, date from today on) and lengths. Answers are stored as plain text (JSON with the question's Spanish label at the time), escaped in the e-mail and the panel, and formula-safe in the CSV. Captcha, honeypot, minimum time and rate limit apply as before. | `24-form-builder`, `contact-form.spec` |
| Privacy notice | Describes what the site actually does (form data, cookie-free statistics, pseudonymous anti-spam control, hosting and e-mail providers, data stored outside Guatemala, retention from the panel setting, Turnstile only when enabled, rights and a 10-business-day answer) under Guatemalan law (Constitution; Decree 57-2008 definitions and the ban on selling personal data without consent; Decrees 47-2008 and 006-2003). No placeholders. | `18-value` (retention, statistics), `site-functional.spec` |

## 21. Change review — user management by site administrators (October 2026)

Replaces the owner-only rule of §9: the owner and accounts with the new permission
`users` ("Gestión de usuarios", part of "Administrador del sitio") manage other accounts.

| Area | Design | Verified by |
|---|---|---|
| Who may manage whom | `/api/users*` require an active session plus the `users` permission (owner always). Nobody changes their own account here (`cannot_change_self`; they use Mi cuenta); the owner account is never changeable by others (`owner_protected`); a non-owner manager only reaches people whose access is a subset of their own **minus** `users` (`manager_protected`), so administrators cannot change each other or the owner, and can only grant what they have themselves, never `users` (`not_assignable`). "Ver como" stays owner-only and read-only. | `28-user-management`, `04-users`, `11-monitoring`, `user-management.spec` |
| Re-typed password | Changing someone's e-mail, setting a password and resetting two-step sign-in ask for the manager's own password (`confirmPassword`, throttled like every other step-up). All management writes share a 60/hour limit per manager; links for a new password 5/hour per person. | `28-user-management` |
| E-mail change | Unique, not the owner's address (`owner_email_reserved`); ends the person's sessions and invalidates pending invitation and reset links; notices go to the old address (no button) and the new one, naming who made the change. | `28-user-management` |
| Passwords set by a manager | Same policy as every password (length, not the e-mail or name). Generated suggestions: 3 words from a fixed 295-word list + 3 digits from `random_int` (≈ 34 bits; the length rule still applies), never stored or logged. By default the account is marked `must_change_password`: until the person replaces it, every API call except `POST /api/account/password` answers 403 `password_change_required` (sign-in, session and sign-out stay public). Sessions end; the notice e-mail never contains the password (asserted on every message). Activity entries pseudonymize e-mail addresses. | `28-user-management`, `user-management.spec` |
| Link for a new password | Active accounts only; reuses the hashed, single-use reset token (24 h) and fails visibly (502) if the e-mail could not be sent, so no silent "sent". | `28-user-management`, `user-management.spec` |
| Two-step sign-in | Per-person requirement (`two_factor_required`) on top of the site policy; the person must enrol on the next sign-in before anything else. Resetting someone's two-step sign-in needs the manager's password and sends the security notice. | `28-user-management`, `user-management.spec` |

## 22. Change review — account controls and automations (October 2026)

| Area | Design | Verified by |
|---|---|---|
| Temporary passwords | A password given by a manager with "must change" expires after 72 h (`temp_password_expires_at`). Only after the correct password does sign-in answer `401 temporary_password_expired` (the person already knows it), so nothing new is revealed about other accounts. The "message to send" is built in the person's language and returned only in that response: never stored, logged or e-mailed. | `29-automations`, `automations.spec` |
| Temporary access | `access_until` is enforced in `Auth::current()` and at sign-in, independently of the scheduled check: the account is turned off, its sessions end, whoever invited them is told, and the answer is the generic `invalid_credentials`. Dates are validated server-side (from today, at most two years). | `29-automations` |
| Closing someone's sessions | Same who-may-manage-whom rules as the rest of `/api/users*`; also forgets their remembered browsers; the person is told. | `29-automations`, `automations.spec` |
| Access requests | Only permissions the account lacks (`already_have`), 500-character message, 3 a day, a new request replaces the pending one; never while "Ver como" or for the owner. Granting goes through `manageable()` + `assertAssignable()`, so a manager can never grant what they couldn't give directly (`users`, `support`). | `29-automations`, `automations.spec` |
| Remembered browsers | Off by default (owner). 32 random bytes in an HttpOnly, SameSite=Strict cookie (`__Host-` in production); only its SHA-256 is stored, bound to one account, 30 days. It only replaces the second step, after the correct password. Forgotten on any password change (own or given), two-step reset/disable, "close sessions" and when the owner turns the option off; listed and forgettable in Mi cuenta. | `29-automations`, `automations.spec` |
| Leaked passwords | Have I Been Pwned range API (k-anonymity: only the first 5 hex characters of the SHA-1 leave the server, with padding), 3 s timeout; unreachable → allowed and logged. Applies to own changes, resets, invitations and passwords given by managers; the owner can turn it off. | `29-automations` (local stub) |
| Unused accounts | Off by default; 90/120/180 days; a warning 7 days before, cleared by signing in; turning off ends sessions; the owner is never affected. | `29-automations` |
| Two-step policy "admins" | Owner plus accounts with `users` or `site` must enrol (same enrolment gate as the other policies). | `29-automations` |
| Activity | Kinds follow the account's permissions (`content`/`media` with `site`, `users`, `leads`); sign-ins, security and settings only for the owner. IP pseudonyms and details are never returned; the export is built in the panel with spreadsheet-formula neutralisation. | `29-automations`, `automations.spec` |
| Automatic e-mails | Each notice is sent once (marked), in the recipient's language, after the response, with no secrets. The visitor's confirmation is off by default, only after a captcha-verified submission, at most one per address every 10 minutes, Reply-To Sensum's contact address; its text is plain text (escaped) with placeholders from fixed site data only. | `29-automations` |

## 23. Change review — fewer roles, «Más secciones», removing registered devices, statistics report (October 2026)

| Area | Design | Verified by |
|---|---|---|
| Roles and the upgrade | Four roles are bundles of the same server-checked permissions; nothing in `Auth::assertCan` changed. `017_roles` only **adds** permissions (the role that adds the least, never Administrador — so nobody gains `users`), keeps every previous one, leaves the owner and accounts already on a role untouched and records each change in `roles_migration_017`. `bin/console roles:rollback` restores only accounts nobody changed since. The API still accepts any valid permission set, so older code and accounts keep working. | `30-roles-devices-stats`, `21-profiles-health`, `04-users` |
| «Más secciones» / «Pedir acceso» | The page lists what exists; the server is unchanged as the authority. `users` and `support` can't be requested (`not_requestable`, server-side as well as in the panel); requests already covered are closed quietly. Nothing is shown to the owner; during «Ver como» the buttons are disabled and the server refuses requests. | `30-roles-devices-stats`, `29-automations`, `sections-stats.spec` |
| Removing registered devices | Needs the acting person's password (a manager, or the person themselves); deletes the TOTP secret, recovery codes and remembered browsers, ends every session and e-mails the person. The next sign-in needs the password **and** a 6-digit code sent to the account's e-mail (random, stored only as an HMAC with the app key, valid 10 minutes, 5 tries, at most 3 sends per sign-in, 10 resends per IP per window; never in the subject or the logs), then the new authenticator must be registered before any other API call (`TwoFactor::required`). This is the same assurance as a password reset by e-mail plus the password itself. `2fa:reset --off` stays for a locked-out owner when e-mail is down. | `30-roles-devices-stats`, `28-user-management`, `17-protection`, `protection.spec`, `sections-stats.spec` |
| Statistics export and e-mail | Same permission as the screen (`stats` or `leads`); the contact-form part only with `leads`. Totals only — no names, e-mails, phones or messages of leads (asserted). Up to 5 recipients validated like account e-mails, one message per recipient (nobody sees the others), 10 sends per hour per person, the message is escaped plain text, the CSV is formula-safe and written to a private temp file deleted after sending. Logged as `stats_shared` with counts, not addresses. | `30-roles-devices-stats`, `sections-stats.spec` |

## 24. Change review — the panel's wiki (October 2026)

| Area | Design | Verified by |
|---|---|---|
| Who reads it | Every `/api/wiki*` route requires a session (401 otherwise); the articles and screenshots live in `sensum-cms/wiki/`, outside `public_html`, so no URL serves them directly. Owner-only articles are never sent to other accounts; the others are readable by everyone, with `allowed` telling whether the role includes the section (the server still checks every action). | `31-wiki`, `hosts.test` (401 on app.) |
| Content safety | Articles are Markdown parsed in the browser into text nodes (`wiki-md.js` uses `h()`, which refuses HTML); links only to `#/…`, `wiki:` or `https://` (external ones with `rel=noopener`); a test refuses HTML in articles. | `31-wiki`, `wiki.spec` |
| Screenshots | Fictitious people and data only (throwaway server in `tests/wiki/shots.mjs`); served with `Cache-Control: private` and an ETag; the name is `[a-z0-9-]{1,60}` and language/theme/device are fixed lists, so no path can be built from the request. | `31-wiki` |
| Ask support | Marked text is only copied into the support dialog the person then sends (same validation, limits and e-mail as any request). | `wiki.spec` |
| «Novedades» | Ids are checked against `wiki.json`; the seen marks are per account (`wiki_news_seen`, cascade on delete); never shown while «Ver como». | `31-wiki`, `wiki.spec` |

## 25. Change review — UX review fixes and longer texts (October 2026)

| Area | Design | Verified by |
|---|---|---|
| Longer texts | Each field keeps its recommended length (`rec`) and gets a larger `max` (labels 1.3×, titles 1.5×, paragraphs 2×). `max` is still enforced server-side (`too_long`), the same validator refuses `<`/`>`, and every text is escaped when published. Every field filled to the new maximum keeps the public site without overflow or spilling text at 320–1440 px. | `05-content`, `public.spec` (content stress test) |
| «Primeros pasos» per account | `PUT /api/account/intro` (signed-in, CSRF, refused while «Ver como») only sets the caller's own `intro_done_at`; nothing else is accepted. | `22-welcome`, `ux-review.spec` |
| Interface only | Role-aware Inicio texts, «Filtros» on phones, folding projects, Usuarios cards, 44 px touch targets, «Soporte» as the page name, keyboard-reachable wiki tables and named landmarks change only how the panel shows what each account could already see. | `ux-review.spec`, `help-center.spec`, axe in every browser spec |

## 26. Change review — «Avisos al equipo» (October 2026)

| Area | Design | Verified by |
|---|---|---|
| Who can send | Owner-only routes (401 signed out, 403 for every other account, including administrators); never available while «Ver como». | `32-announcements` |
| Who receives | Active accounts only, never the owner; each gets only the «Novedades» its own sections allow (`Wiki::forAccount`, the rule the panel uses), only if it existed when the item shipped; ids must be known and not owner-only. Recipients are computed on the server at send time, never taken from the request. | `32-announcements`, `announcements.spec` |
| Content | The owner's message is plain text (control characters removed, ≤ 600 characters) and escaped in the HTML e-mail; item texts come from `wiki.json`; links are built from `ADMIN_URL`, never from request data. | `32-announcements` (`<b>` arrives escaped) |
| Abuse and duplicates | 10 tests and 6 sends an hour per owner; `news_emailed` keeps anyone from getting the same item twice unless the owner explicitly asks; each send is logged (`announcements`, Actividad). | `32-announcements` |

## 27. Change review — scheduled tasks installed from the console (October 2026)

Production sent «La revisión automática dejó de ejecutarse»: the cron job had not been
installed at go-live (the only run was by hand) — and a step that threw would have
stopped the rest of the check silently, since cron discards the output.

| Area | Design | Verified by |
|---|---|---|
| Who can change the crontab | Only `bin/console cron:install`, run by the account in cPanel → Terminal; the panel and the web server never touch it (the console refuses to run under the web server). The panel's Monitoreo card only shows the command to copy. | code review |
| Other lines | Every line that is not this installation's scheduled check or backup is kept byte for byte (acme.sh renewal, other sites); hand-written lines are recognised only by this installation's own console path (absolute, `~/`, `$HOME/` or the guide's `/home/USUARIO/` placeholder); a line for another installation is only reported. The previous crontab is saved to `storage/backups/crontab-*.txt` (0600) before writing, and the result is read back. | `34-cron` |
| Commands | `crontab` and `php -r` run with `proc_open` and an argument list (no shell); the cron line quotes any path that is not plain (`escapeshellarg`) and refuses `%` (special to cron). `CRONTAB_BIN` lets tests use a stand-in. | `34-cron` |
| Logs | Only errors go to `storage/logs/cron.log` (inside the private, 0700 storage folder; kept under 1 MB); normal output is discarded, so cPanel's cron e-mail stays quiet. | `34-cron` |
| Resilience | The check records its time first and runs each step on its own: a failure is logged (`scheduled_step_failed`, Monitoreo → Errores) and the alerts and automations still run. One run at a time (`flock`). | `34-cron` |
