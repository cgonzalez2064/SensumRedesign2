# Production checklist — Sensum website + Content Manager

Tick each item when done. Section A was completed locally during development
(evidence in `docs/TEST_REPORT.md` and `docs/SECURITY_AUDIT.md`); repeat it if
the code changes before deployment. Sections B–E happen on Namecheap
(`docs/NAMECHEAP_DEPLOYMENT.md`).

Release: `release-________-_______` · Deployed by: __________ · Date: __________

## A. Before deployment (local)

- [x] Local test Pass 1 successful (functional & integration) — 2026-10-07
- [x] Local test Pass 2 successful (clean clone + adversarial) — 2026-10-07
- [x] Security Audit 1 complete (findings fixed)
- [x] Security Audit 2 complete (fixes re-verified)
- [x] Dependency audit complete (`composer audit`, `npm audit` — clean)
- [x] Secrets scan complete (git history + release — clean)
- [x] Public visual regression checked (22/22 identical to the approved site)
- [x] Public performance checked (Lighthouse: no regression; desktop 99 with normal font latency)
- [x] Accessibility checked (admin: no serious/critical issues, both themes; public: unchanged)
- [x] Production build successful (`tools/build-release.sh`) and verified under Apache + PHP-FPM
- [ ] Build rebuilt from the exact commit being deployed, tests re-run if anything changed since

## B. Before going live (Namecheap)

- [ ] Current website backed up (`public_html` zip downloaded)
- [ ] Full account backup downloaded
- [ ] Database backed up (only for updates: `sensum-cms/storage/database.sqlite` / `bin/console backup`)
- [ ] PHP 8.2+ selected; extensions `pdo_sqlite`, `gd`, `fileinfo`, `mbstring`, `exif`, `intl` enabled
- [ ] PHP options: `memory_limit 256M`, `upload_max_filesize 16M`, `post_max_size 20M`
- [ ] `display_errors` Off (debug mode disabled); `APP_ENV=production`
- [ ] `sensum-cms/` uploaded **outside** `public_html`; hidden `.htaccess` files present
- [ ] Permissions: storage `700`, `.env` `600`, no `777` anywhere
- [ ] `.env` filled (`APP_URL=https://sensumconstrucciones.com`, SMTP, `SUPPORT_EMAIL=it@gruposensum.com`)
- [ ] HTTPS enabled (AutoSSL valid, `http://` and `www` redirect to `https://sensumconstrucciones.com`)
- [ ] Database configured (`/api/health` → all `ok`; dashboard diagnostics green)
- [ ] First administrator created as **it@gruposensum.com** (the owner, `OWNER_EMAIL`); `SETUP_TOKEN` removed from `.env`
- [ ] SPF, DKIM and DMARC valid (cPanel → Email Deliverability)
- [ ] Automatic translation: `DEEPL_API_KEY` set and `bin/console translate:test` OK — or consciously left off

## C. Functional tests on the live site

- [ ] Admin login tested (and generic error on a wrong password)
- [ ] Unauthorized access tested (`/api/dashboard` in a private window → `unauthenticated`)
- [ ] Password change tested
- [ ] Password reset tested (e-mail received, link works once)
- [ ] SMTP tested (`bin/console mail:test` or a report)
- [ ] User invitations tested (e-mail received, account activates, test user removed)
- [ ] Issue reporting tested
- [ ] Test issue received at **it@gruposensum.com** (subject `[Sensum Website] …`)
- [ ] Support email failure handling tested (wrong SMTP password → saved as "No enviado" → retry delivers)
- [ ] Image upload tested (card photo, gallery photo, removal)
- [ ] File restrictions tested (`.svg` / renamed file refused)
- [ ] Content updates tested (edit, check live page, restore)
- [ ] Automatic translation tested (Spanish fills English for review; Undo works) — if configured
- [ ] Mobile tested (admin on a phone; public site on a phone)
- [ ] Spanish tested
- [ ] English tested (admin and public toggle)
- [ ] Light mode tested
- [ ] Dark mode tested
- [ ] Public visual regression checked on the live site (desktop/tablet/phone look as approved)
- [ ] Public performance checked (PageSpeed Insights on the live URL)

## D. Monitoring and operations

- [ ] Analytics tested — or consciously left off (default; needs privacy-notice update + CSP change)
- [ ] Error monitoring tested (Monitoreo → *Registro de errores*, signed in as it@gruposensum.com; other admins don't see it)
- [ ] Critical-error alerts tested (Monitoreo → *Enviar correo de prueba* arrives at it@gruposensum.com, not in spam)
- [ ] Scheduled check configured (cPanel cron every 15 min: `bin/console monitor`; Monitoreo shows *Última revisión automática*)
- [ ] Uptime monitoring configured (Better Stack/UptimeRobot for the site and `/api/health`, SSL expiry alerts)
- [ ] Health endpoint checked (`/api/health` → 200 `"status":"ok"`)
- [ ] Logs reviewed (`sensum-cms/storage/logs/` — no secrets, no unexpected errors)
- [ ] Browser console reviewed (public site and admin: no errors)
- [ ] Network requests reviewed (no failed requests; admin loads no third-party resources)
- [ ] Daily database backup cron configured (optional) — `bin/console backup`

## E. Recovery readiness

- [ ] Backup/rollback verified (previous release zip and `public_html` backup available; restore steps read)
- [ ] `.env` values stored in the company password manager
- [ ] At least two administrators exist (one from IT)
- [ ] Client staff invited as *Editor*; user guide shared (`docs/USER_GUIDE_ES.md`)
