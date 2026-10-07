# Deploying to Namecheap (Stellar Plus) — website + Content Manager

This guide matches the implementation on the `content-manager` branch. It
replaces `DEPLOY.md` for this release (`DEPLOY.md` still documents the original
static site's DNS, AutoSSL and contact-form details, referenced below).

**What you deploy**

```
/home/<cpanel-user>/
├── public_html/          ← the website, admin interface and API entry point (public)
└── sensum-cms/           ← PRIVATE application: code, configuration, database, logs
```

`sensum-cms/` must be **next to** `public_html`, never inside it.
No MySQL database, Node.js app, cron job or SSH is required (all optional).

Estimated time: 60–90 minutes the first time.

---

## 0. What you need before starting

- [ ] cPanel login for the hosting account of `sensumconstrucciones.com`
- [ ] A mailbox to send from (e.g. `no-reply@sensumconstrucciones.com`) and its
      password — or the SMTP details of the mail provider (§7)
- [ ] The e-mail of the first administrator
- [ ] A computer with the repository and the tools from `docs/LOCAL_SETUP.md`
- [ ] Local tests passing (`docs/PRODUCTION_CHECKLIST.md`, section A)

## 1. Back up the current live site

1. cPanel → **File Manager** → Settings → tick **Show Hidden Files**.
2. Right-click `public_html` → **Compress** → Zip → `public_html-backup-YYYYMMDD.zip`.
   Download it to your computer and keep it.
3. Also download the whole account backup: cPanel → **Backup** (or Backup Wizard)
   → **Download a Full Account Backup** (home directory). Stellar Plus also keeps
   automatic backups, but don't rely only on those.
4. If a previous Content Manager is already installed (updates), also follow §11
   ("Updating later") — never overwrite `sensum-cms/.env`, `sensum-cms/storage/`
   or `public_html/assets/uploads/`.

The approved site has **no database**, so there is nothing else to back up on
the first deployment.

## 2. Build the release (on your computer)

```bash
git switch content-manager
git status                     # must be clean
tools/build-release.sh
```

Result: `dist/release-<date>-<commit>.zip` containing `public_html/` and
`sensum-cms/` with production dependencies only (≈ 700 KB).

**Included:** pages, `assets/`, `admin/`, `api/`, `.htaccess` files,
`robots.txt`, `sitemap.xml`, `site.webmanifest`; the private app with
`vendor/`, templates, migrations and an empty `storage/`.

**Never uploaded (excluded by the build):** `.git`, `cms/.env`, `cms/storage/*`
(local database, logs, test account note), `tests/`, `tools/`, `docs/`, `*.md`,
`node_modules`, `dist`, `_to_delete/`, `sensum-mail-config.example.php`,
`cms/dev/` (local router), the client `.docx`.

## 3. PHP settings (cPanel → Select PHP Version)

1. **PHP version:** 8.2 or 8.3 (minimum 8.1).
2. **Extensions** tab — make sure these are ticked: `pdo_sqlite`, `sqlite3`,
   `gd`, `fileinfo`, `mbstring`, `exif`, `intl`, `json`, `openssl`.
3. **Options** tab:

| Option | Value |
|---|---|
| `memory_limit` | `256M` |
| `upload_max_filesize` | `16M` |
| `post_max_size` | `20M` |
| `max_execution_time` | `60` |
| `display_errors` | `Off` |
| `log_errors` | `On` |

(Photo processing needs the memory; uploads up to 10 MB photos / 20 MB PDF.)

## 4. Upload the files

1. cPanel → **File Manager** → go to your home directory (`/home/<user>`, one
   level **above** `public_html`).
2. **Upload** the release zip there, right-click → **Extract**. You get
   `release-<date>-<commit>/` with `public_html/` and `sensum-cms/` inside.
3. Move `release-…/sensum-cms` to `/home/<user>/sensum-cms`.
4. Move **the contents** of `release-…/public_html` into `/home/<user>/public_html`
   (overwrite the existing site files; the backup from §1 is your safety net).
   Make sure hidden files came along: `.htaccess`, `admin/.htaccess`,
   `api/.htaccess`, `assets/uploads/.htaccess`.
5. Delete the empty `release-…` folder and the zip.

Final layout check:

```
/home/<user>/sensum-cms/bootstrap.php
/home/<user>/sensum-cms/vendor/autoload.php
/home/<user>/public_html/index.html
/home/<user>/public_html/api/index.php
/home/<user>/public_html/admin/index.html
```

If `sensum-cms` cannot live there for some reason, put it elsewhere outside
`public_html` and add to `public_html/.htaccess`:
`SetEnv SENSUM_CMS_DIR /home/<user>/your/path/sensum-cms` (and `PUBLIC_DIR` in `.env`).

## 5. Permissions

File Manager → right-click → **Change Permissions**:

| Path | Permission |
|---|---|
| folders in `public_html` (incl. `assets/uploads`) | `755` |
| files in `public_html` | `644` |
| `sensum-cms` and its folders | `755`; **`sensum-cms/storage`** → `700` |
| `sensum-cms/.env` (after §6) | `600` |

Never use `777`. PHP runs as your cPanel user, so `755`/`644` are writable by the
application where needed (the generated pages and `assets/uploads`).

## 6. Configure `sensum-cms/.env`

In File Manager open `sensum-cms/`, create a new file `.env` (or copy
`.env.example` from your computer) and fill it:

```ini
APP_ENV=production
APP_URL=https://sensumconstrucciones.com
APP_TIMEZONE=America/Guatemala

# One-time setup code — only if you will create the first admin from the browser (§8B).
# Use a long random value (e.g. from a password manager) and DELETE this line afterwards.
SETUP_TOKEN=

MAIL_DRIVER=smtp
SMTP_HOST=<from §7>
SMTP_PORT=465
SMTP_ENCRYPTION=ssl
SMTP_USERNAME=no-reply@sensumconstrucciones.com
SMTP_PASSWORD=<mailbox password>
SMTP_FROM_ADDRESS=no-reply@sensumconstrucciones.com
SMTP_FROM_NAME="Sensum Construcciones"
SMTP_TIMEOUT=15

SUPPORT_EMAIL=it@gruposensum.com

# Monitoring: owner account (sees Monitoreo) and critical-error alerts
OWNER_EMAIL=it@gruposensum.com
ALERTS_ENABLED=true
ALERT_EMAIL=it@gruposensum.com
ALERT_COOLDOWN_MINUTES=60
ALERT_DAILY_MAX=20

SESSION_IDLE_MINUTES=60
SESSION_ABSOLUTE_HOURS=12
INVITE_TTL_HOURS=72
RESET_TTL_MINUTES=60
UPLOAD_MAX_MB=10
PUBLIC_ERROR_REPORTING=false
CF_WEB_ANALYTICS_TOKEN=

# Automatic translation ES <-> EN in the text editor (optional, see §7b)
DEEPL_API_KEY=
TRANSLATE_DAILY_CHAR_LIMIT=60000
```

Then set the file's permission to `600`. Keep a copy of these values in a
password manager — never e-mail them.

**The database.** There is nothing to create in cPanel's MySQL sections. The
SQLite database `sensum-cms/storage/database.sqlite` is created and migrated
automatically on the first request (or with `php ~/sensum-cms/bin/console migrate`
if you have Terminal/SSH). Access control = the file's location outside the web
root plus `700`/`600` permissions — there are no database credentials to leak.

## 7. E-mail (SMTP) and deliverability

**Sending mailbox.** cPanel → **Email Accounts** → Create
`no-reply@sensumconstrucciones.com` with a strong password. Then click
**Connect Devices** next to it: "Mail Client Manual Settings" shows the exact
outgoing server, port and security. Typical Namecheap shared-hosting values:

| Setting | Value |
|---|---|
| `SMTP_HOST` | the server shown under *Outgoing Server* (e.g. `mail.sensumconstrucciones.com` or the server hostname like `serverXXX.web-hosting.com` — prefer the hostname if the mail certificate doesn't match the domain) |
| `SMTP_PORT` / `SMTP_ENCRYPTION` | `465` / `ssl` (or `587` / `tls`) |
| `SMTP_USERNAME` | the full address |
| `SMTP_PASSWORD` | the mailbox password |

If the company uses another provider (Google Workspace, Microsoft 365,
Namecheap Private Email…), use that provider's SMTP host/port and an app
password or dedicated mailbox instead.

**Deliverability.** cPanel → **Email Deliverability** → `sensumconstrucciones.com`:
install/repair the suggested **SPF** and **DKIM** records, and add a **DMARC**
record (`_dmarc` TXT, e.g. `v=DMARC1; p=quarantine; rua=mailto:it@gruposensum.com`).
Without these, invitations, resets and support reports may land in spam.

**Support reports** go to `SUPPORT_EMAIL` (**it@gruposensum.com**). Make sure that
mailbox accepts mail from `sensumconstrucciones.com` (whitelist the sender if it
uses aggressive filtering).

## 7b. Automatic translation (DeepL) — optional

1. Create a **DeepL API Free** account at https://www.deepl.com/pro-api
   (choose the *API* plan, not the Translator app; DeepL may ask for a card to
   verify the account — the Free plan is not charged).
2. DeepL account → **API Keys** → copy the key (Free keys end in `:fx`).
3. Put it in `sensum-cms/.env` as `DEEPL_API_KEY=…` (it is a secret: never
   e-mail it or commit it).
4. Check it from Terminal: `php ~/sensum-cms/bin/console translate:test`
   (shows a sample translation and the characters used this month), or open
   Dashboard → *Diagnóstico técnico* → "Traducción automática (DeepL)".

The free plan allows 500,000 characters per month; all of the site's editable
text is about 5,000 characters per language. `TRANSLATE_DAILY_CHAR_LIMIT` caps
daily use. Without a key the panel works exactly the same, minus automatic
translation. Outgoing HTTPS from PHP (curl) is enabled on Namecheap shared
hosting; nothing else needs configuring.

## 8. HTTPS and first administrator

**HTTPS:** follow `DEPLOY.md` §4 (cPanel → SSL/TLS Status → Run AutoSSL) before
anything else. The site's `.htaccess` forces `https://sensumconstrucciones.com`;
production cookies require HTTPS (`__Host-` / `Secure`), so signing in over
plain HTTP is impossible by design.

**Check the installation:** open `https://sensumconstrucciones.com/api/health` —
expected `{"ok":true,"status":"ok",…}` with every check `"ok"`.

Create the first administrator in **one** of these ways:

**A. Terminal / SSH (preferred if available).** cPanel → *Terminal* (or SSH, which
Namecheap support can enable for Stellar Plus):

```bash
cd ~
php sensum-cms/bin/console check
php sensum-cms/bin/console create-admin --name="IT Grupo Sensum" --email=it@gruposensum.com
```

(If `php` points to another version, use the path shown in cPanel → Select PHP
Version, e.g. `/opt/alt/php82/usr/bin/php`.)

**B. Browser (no command line).** With `SETUP_TOKEN` set in `.env`, open
`https://sensumconstrucciones.com/admin/#/configurar`, enter the token, name,
e-mail and password. Setup closes permanently once an account exists.
**Then remove the `SETUP_TOKEN` line from `.env`.**

Sign in at `https://sensumconstrucciones.com/admin/`, then **Usuarios → Invitar
usuario** for the client's staff (role *Editor* for content-only access).

## 9. First publish

The uploaded `index.html`/`404.html`/`privacy-notice.html` contain the approved
default content. Publishing once records their fingerprints:

* Dashboard → if it shows "El sitio publicado no coincide…", click **Volver a
  publicar el sitio**; or
* Terminal: `php ~/sensum-cms/bin/console publish`.

## 10. Post-deployment tests

Do these on the live site and tick them in `docs/PRODUCTION_CHECKLIST.md`:

1. `https://sensumconstrucciones.com/` looks exactly like before (desktop + phone),
   ES/EN toggle works, project modal, menu, FAQ, contact form (per `DEPLOY.md` §7).
2. Headers — from any computer:
   ```bash
   curl -sI https://sensumconstrucciones.com/ | grep -Ei 'strict-transport|content-security|x-frame|x-content-type'
   curl -sI https://sensumconstrucciones.com/admin/ | grep -Ei 'content-security|x-robots|referrer'
   curl -s  https://sensumconstrucciones.com/api/health
   for p in sensum-cms/.env api/.htaccess assets/uploads/x.php .env.example docs/LOCAL_SETUP.md; do curl -s -o /dev/null -w "%{http_code} $p\n" https://sensumconstrucciones.com/$p; done
   ```
   Expect the admin CSP to contain `style-src 'self';` (no Google Fonts) and the
   last loop to print only `403`/`404`.
3. Admin: sign in; wrong password shows a generic error; sign out.
4. Unauthorized: in a private window open `https://sensumconstrucciones.com/api/dashboard`
   → `{"ok":false,"error":"unauthenticated"}`.
5. Content: change a short text (e.g. footer description), save, check the live
   page (hard reload), restore the original text.
6. Photo: upload a project card photo, check the card and "Ver detalles", then remove it.
7. Password change: Mi cuenta → Cuenta / Seguridad.
8. Password reset: "¿Olvidaste tu contraseña?" → e-mail arrives → new password works.
9. Invitation: invite a test address you control → e-mail → activate → delete the test user.
10. Issue report: **Reportar un problema** → the message arrives at
    **it@gruposensum.com** with subject `[Sensum Website] …`.
11. Report failure handling: temporarily set a wrong `SMTP_PASSWORD`, send a
    report → the panel says it was saved but not sent → restore the password →
    **Reportes de soporte → Reintentar envío** → it arrives.
12. Upload restrictions: try a `.svg` or a renamed text file → friendly refusal.
13. Dashboard → *Diagnóstico técnico*: all green (the "Carpeta privada fuera del
    sitio público" check confirms the folder layout).
14. Logs: File Manager → `sensum-cms/storage/logs/app-YYYY-MM.log` contains the
    test actions and no passwords or tokens.
15. Automatic translation (if configured): in a text section type a word in
    Spanish → the English box fills in marked "Traducido automáticamente";
    press **Deshacer** and leave without saving.
16. Monitoring: sign in as it@gruposensum.com → **Monitoreo** loads; **Enviar
    correo de prueba** arrives; after the cron job's first run, *Última revisión
    automática* shows a time. Sign in as another administrator → no Monitoreo menu.

## 11. Updating later (new release)

1. Back up (§1) **and** copy `sensum-cms/storage/database.sqlite` +
   `public_html/assets/uploads/` (or run `php ~/sensum-cms/bin/console backup`).
2. Build the new release locally.
3. Upload and replace **code only**:
   - `public_html`: everything **except** `assets/uploads/` (keep its contents).
   - `sensum-cms`: everything **except** `.env` and `storage/`.
4. Migrations run automatically on the next request (or `bin/console migrate`).
5. Republish (§9) so the new templates are combined with the current content —
   the uploaded pages contain default content until you do.
6. Re-run the post-deployment tests that relate to the change.

## 12. Backups

| What | How | When |
|---|---|---|
| Whole account | Stellar Plus automatic backups + cPanel → Backup → download | monthly download, before every deployment |
| Database | `php ~/sensum-cms/bin/console backup` (consistent copy to `sensum-cms/storage/backups/db/`, keeps 14). Optional cron (cPanel → Cron Jobs, daily 03:15): `/usr/local/bin/php /home/<user>/sensum-cms/bin/console backup >/dev/null 2>&1` — use the PHP path cPanel shows | daily (cron) or before changes |
| Uploaded photos/PDF | download `public_html/assets/uploads/` (Compress → download) | monthly / before deployments |
| Published pages | automatic: last 30 versions in `sensum-cms/storage/backups/published/` | every save |
| Configuration | `sensum-cms/.env` values in a password manager | when changed |
| Releases | keep the last 3 `release-*.zip` files | every deployment |

Download the database backups regularly: copies that only live on the same
server don't protect against losing the account.

## 13. Rollback

**Bad content change** (wrong text/photo): fix it in the panel; the previous text
is in Dashboard → *Actividad reciente* / the activity log. To restore whole pages,
copy `sensum-cms/storage/backups/published/<date>/index.html` back to
`public_html/` (then republish later from the panel to re-sync).

**Bad deployment:**
1. Restore the previous release's code: re-upload the previous `release-*.zip`
   (same steps as §11, keeping `.env`, `storage/` and `uploads/`), **or**
2. Restore `public_html-backup-YYYYMMDD.zip` from §1 to return to the original
   static site (the Content Manager then simply isn't reachable; the public site
   works on its own).
3. If the database is damaged: replace `sensum-cms/storage/database.sqlite` with
   the newest copy from `storage/backups/db/` (or your download).
4. Check `/api/health`, sign in, republish.

**Emergency stop of the admin** (e.g. suspected compromise): rename
`public_html/api/index.php` to `index.php.off` — the public site keeps working,
the admin API stops. Then disable accounts / reset passwords and restore.

## 14. Monitoring

* **Uptime + SSL:** create a free [Better Stack](https://betterstack.com) monitor
  for `https://sensumconstrucciones.com` (HTTP status, response time, SSL and
  domain expiry) and a second one for `https://sensumconstrucciones.com/api/health`
  (expect status 200 and the keyword `"status":"ok"`). Alerts to it@gruposensum.com.
  UptimeRobot's free plan (50 monitors, 5-minute checks) is an alternative but
  its free tier doesn't alert on SSL expiry.
* **Owner account:** create the first administrator as **it@gruposensum.com**
  (§8): that account (`OWNER_EMAIL`) is the only one that sees **Monitoreo** —
  error log, figures, alert settings — and other administrators cannot remove it.
* **Scheduled check (cron) — required for proactive alerts:** cPanel → **Cron
  Jobs** → *Add New Cron Job* → Common Settings "Twice Per Hour" or custom
  `*/15 * * * *`, command:
  ```
  php ~/sensum-cms/bin/console monitor > /dev/null 2>&1
  ```
  (use the full PHP path from *Select PHP Version* if `php` is another version,
  e.g. `/opt/alt/php82/usr/bin/php`). Then Monitoreo → *Última revisión
  automática* shows the time of the last run.
* **Critical-error alerts:** Monitoreo → *Alertas por correo* → **Enviar correo de
  prueba** (or `php ~/sensum-cms/bin/console alert:test`). Check that it arrives at
  it@gruposensum.com and is not in spam; whitelist `no-reply@sensumconstrucciones.com`.
* **Errors:** Monitoreo → *Registro de errores* (server, panel and — if
  `PUBLIC_ERROR_REPORTING=true` — public-site errors; critical ones are e-mailed).
* **Analytics (optional):** see `docs/CONTENT_MANAGER.md` §9 — requires a privacy
  notice update and a CSP change first.
* **Logs:** `sensum-cms/storage/logs/` (application) and cPanel → *Errors* /
  *Raw Access* (server).

## 15. Troubleshooting

| Symptom | Fix |
|---|---|
| `/api/health` → `{"error":"service_unavailable"}` | `sensum-cms` not found next to `public_html` (or `vendor/` missing). Check §4 layout or set `SENSUM_CMS_DIR`. |
| `/api/health` → 503 `degraded` | Permissions (§5) or missing PHP extension (§3); run `bin/console check` or see the dashboard diagnostics. |
| Every save says the request couldn't be verified | `APP_URL` must be exactly `https://sensumconstrucciones.com`. |
| Can't stay signed in | The site isn't served over HTTPS (production cookies are `Secure`) — run AutoSSL and open the `https://` address. |
| Photos refused as too large in pixels/bytes | Raise `memory_limit` / `upload_max_filesize` / `post_max_size` (§3). |
| E-mails not arriving | `bin/console mail:test you@domain`, check logs for `mail_failed`, verify §7 values and SPF/DKIM. |
| API returns 403 for everything | An old `api/.htaccess` with a `FilesMatch` rule — upload the one from this release. |
| Live page shows old content after a deployment | Republish (§9). |
