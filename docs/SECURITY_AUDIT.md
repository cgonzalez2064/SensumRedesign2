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
* No redirects based on user input; no server-side fetches (no SSRF surface).
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
| Single-factor authentication | Medium | Strong passwords + throttling. **Recommended next:** TOTP 2FA for admins. |
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
5. Use a dedicated SMTP mailbox (e.g. `no-reply@sensumconstrucciones.com`) with a
   unique password; publish SPF, DKIM and DMARC (cPanel → Email Deliverability).
6. PHP 8.2+ in cPanel with `pdo_sqlite`, `gd`, `fileinfo`, `mbstring`, `exif`,
   `intl`; `memory_limit` 256M, `upload_max_filesize` 16M, `post_max_size` 20M,
   `display_errors` Off.
7. Keep at least two administrators (one from IT) and remove accounts that are
   no longer needed.
8. Set up the external uptime/SSL monitor; review the dashboard's errors and
   activity monthly; keep PHP and PHPMailer updated (`composer audit`).
9. Back up the database and uploads as described in `NAMECHEAP_DEPLOYMENT.md`.
10. After deployment, verify headers (command in `NAMECHEAP_DEPLOYMENT.md` §10).
