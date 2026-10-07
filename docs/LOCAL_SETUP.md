# Local setup — Sensum website + Content Manager

This guide takes you from a fresh copy of the repository to a working public
website, admin panel, database, sign-in and e-mail testing on your own
computer. Nothing here sends real e-mail: every message goes to **Mailpit**, a
local inbox that only you can see.

Commands are for macOS with [Homebrew](https://brew.sh). Linux and Windows (WSL)
work the same way with their own package manager.

---

## 1. Requirements

| Tool | Version | Needed for | Install (macOS) |
|---|---|---|---|
| PHP | **8.1 or newer** (tested 8.2 and 8.5) with `pdo_sqlite`, `gd` (with WebP), `fileinfo`, `mbstring`, `json`; recommended `exif`, `intl` | the site's PHP and the Content Manager | `brew install php@8.2` (or `brew install php`) |
| Composer | 2.x | installing PHPMailer | `brew install composer` |
| Mailpit | any recent | local fake inbox for every e-mail | `brew install mailpit` |
| Git | any | getting the code | included with Xcode tools |
| Node.js | **20 or newer** (tested 24) | automated tests only — not needed to run the site | `brew install node` |
| sqlite3 CLI | any | optional: inspecting the database, some tests | preinstalled on macOS |
| Google Chrome | current | browser tests (Playwright uses the installed Chrome) | — |

Check PHP has what it needs:

```bash
php -v
php -m | grep -E -i "pdo_sqlite|gd|fileinfo|mbstring|exif|intl"
php -r 'var_dump(function_exists("imagewebp"));'
```

No MySQL or other database server is needed: the Content Manager uses one
SQLite file.

## 2. Get the code and install dependencies

```bash
git clone git@github.com:cgonzalez2064/SensumRedesign2.git sensum
cd sensum
git switch content-manager
composer install --working-dir=cms
```

`composer install` creates `cms/vendor/` (PHPMailer). It is not committed.

## 3. Configure (`cms/.env`)

```bash
cp .env.example cms/.env
```

Edit `cms/.env` and set these local values (everything else can stay as in the
example):

```ini
APP_ENV=development
APP_URL=http://127.0.0.1:8080
EXTRA_ALLOWED_ORIGINS=http://localhost:8080

# Mailpit — nothing leaves your computer
MAIL_DRIVER=smtp
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_ENCRYPTION=none
SMTP_FROM_NAME="Sensum Construcciones (local)"
SUPPORT_EMAIL=it@gruposensum.com

# Publish to a local overlay folder instead of rewriting the committed index.html
PUBLIC_DIR=storage/dev-public
```

Why each matters:

* `APP_ENV=development` allows the session cookie over plain `http://` (production
  requires HTTPS and uses a `__Host-` secure cookie).
* `APP_URL` must match the address in your browser, or every change is refused
  as "cross-site" (`forbidden_origin`).
* `PUBLIC_DIR=storage/dev-public` makes the Content Manager publish into
  `cms/storage/dev-public/`. The local server shows those files on top of the
  repository, so testing never modifies the committed `index.html`.
* `SUPPORT_EMAIL` stays `it@gruposensum.com` — locally, Mailpit catches that
  message; it is never delivered.

`cms/.env` is git-ignored. Never commit it.

## 4. Create the database and the first administrator

```bash
php cms/bin/console migrate
php cms/bin/console create-admin --name="Tu nombre" --email=tu@correo.com
```

`create-admin` asks for the password twice (minimum 10 characters; it is never
shown). The database is `cms/storage/database.sqlite`; migrations also run
automatically on the first request if you skip `migrate`.

Check the installation:

```bash
php cms/bin/console check
```

Every required line must say `OK`. (`mail` shows OK only while Mailpit is running.)

## 5. Start everything

```bash
tools/dev-server.sh
```

This starts Mailpit (if it isn't running) and PHP's built-in server with a
router (`cms/dev/router.php`) that reproduces the production `.htaccess` rules:
security headers, the admin's stricter CSP, the deny rules for private folders
and the `/api` routing.

| What | URL |
|---|---|
| Public website | http://127.0.0.1:8080/ |
| Content Manager | http://127.0.0.1:8080/admin/ |
| Health check | http://127.0.0.1:8080/api/health |
| Mailpit (local inbox) | http://127.0.0.1:8025/ |

Stop with `Ctrl+C` (Mailpit keeps running in the background; stop it with
`pkill mailpit`).

> **Safety:** the dev server routes PHP's `mail()` — used by the existing
> public contact form — into Mailpit as well. Never test the contact form with
> a plain `php -S` command: on macOS `mail()` hands messages to the system mail
> server, which may try to deliver them to the real business inbox.

## 6. Day-to-day workflows

### Sign in / sign out
Open http://127.0.0.1:8080/admin/, sign in with the account from step 4. Sign out
from the account menu (top right). Sessions end after 60 minutes without
activity (`SESSION_IDLE_MINUTES`) or 12 hours in total (`SESSION_ABSOLUTE_HOURS`);
if that happens while editing, the panel asks for the password in place and
keeps your changes.

### Edit content and see it on the site
Change a text under **Textos del sitio**, press **Guardar cambios**, then reload
http://127.0.0.1:8080/. Published files are in `cms/storage/dev-public/`. To
return the local site to the approved content, restore each field's original
text in the panel (or delete `cms/storage/dev-public/` and the database — see
"Start over").

### Password reset (by e-mail)
1. On the sign-in page choose **¿Olvidaste tu contraseña?** and enter your e-mail.
2. Open Mailpit (http://127.0.0.1:8025) — the message "Restablece tu contraseña"
   is there. Open its link.
3. Choose the new password. A "Tu contraseña fue cambiada" notice arrives in Mailpit.

Links expire after 60 minutes (`RESET_TTL_MINUTES`) and work once.

### Invitations
1. As an administrator: **Usuarios → Invitar usuario**.
2. The invitation e-mail appears in Mailpit; open its link (use a private
   window if you want to stay signed in as the administrator).
3. The invited person sets a name and password and is signed in.

Links expire after 72 hours (`INVITE_TTL_HOURS`) and work once. If e-mail cannot
be sent, the panel shows the link once so it can be shared another way.

### "Reportar un problema" (issue reports)
Use the button in the top bar. The report is stored and e-mailed to
`SUPPORT_EMAIL`; locally it lands in Mailpit addressed to `it@gruposensum.com`.
To test a delivery failure, stop Mailpit (`pkill mailpit`) and send a report:
the panel says it was saved but not sent; restart Mailpit and use
**Reportes de soporte → Reintentar envío** (or `php cms/bin/console reports:retry`).

### SMTP configuration
Any SMTP server works through the `SMTP_*` values. Send a test message with the
current settings:

```bash
php cms/bin/console mail:test you@example.com
```

`MAIL_DRIVER=log` writes messages to `cms/storage/mail/*.eml` instead of sending;
`MAIL_DRIVER=disabled` simulates "no e-mail available".

### Automatic translation (DeepL)
Off until you add a key. Create a free **DeepL API Free** account at
https://www.deepl.com/pro-api (the API plan, not the DeepL Translator app),
copy the *Authentication Key* (it ends in `:fx`) and add it to `cms/.env`:

```ini
DEEPL_API_KEY=your-key:fx
```

Restart `tools/dev-server.sh`, then check it:

```bash
php cms/bin/console translate:test
```

In **Textos del sitio** a blue notice confirms it is on; type in Spanish and the
English box fills in after a second. Every translation uses your real DeepL
quota (500,000 characters/month on the free plan). The automated tests never
call DeepL — they use a local stand-in (`tests/integration/deepl-stub.mjs`).

### Telemetry
Off by default. To try public-site error reporting locally set
`PUBLIC_ERROR_REPORTING=true` in `cms/.env`, then republish
(`php cms/bin/console publish`): the pages include `assets/error-reporter.js`,
and JavaScript errors appear on the dashboard under **Errores recientes**.
Cloudflare Web Analytics (`CF_WEB_ANALYTICS_TOKEN`) is described in
`docs/CONTENT_MANAGER.md`; it needs a real Cloudflare account and a CSP change.

## 7. Automated tests

All test tooling lives in `tests/` and is never uploaded to the server.

```bash
npm --prefix tests ci                    # once
npx --prefix tests playwright install webkit   # once, for Safari/iPhone tests (≈ 70 MB)
```

Mailpit must be running for the e-mail tests (`mailpit &`).

| Suite | Command | What it covers |
|---|---|---|
| API integration (95 tests) | `npm --prefix tests test` | auth, sessions, CSRF, passwords, invitations, content, automatic translation, uploads, reports, telemetry, failure handling. Each file starts its own server with a throwaway database. |
| Browser E2E | `npm --prefix tests run test:e2e` | every admin screen in light/dark on desktop Chrome, tablet and iPhone (WebKit) with accessibility scans; automatic translation; public site with managed content; content stress test; existing site behavior |
| Visual regression | see below | the public site against the approved screenshots |
| Production build on Apache | see section 8 | `.htaccess` behavior of the built release |

**Visual regression.** The baseline is the approved site (`main`):

```bash
git worktree add ../sensum-baseline main
php -S 127.0.0.1:8091 -t ../sensum-baseline &
BASE_URL=http://127.0.0.1:8091 npm --prefix tests run test:visual:update   # capture baseline
kill %1
tools/dev-server.sh &                                                    # or any server with default content
BASE_URL=http://127.0.0.1:8080 npm --prefix tests run test:visual        # compare
```

Compare against a server with the approved (default) content — e.g. a fresh
database — or the screenshots will (correctly) show your local edits.

## 8. Production build (and optional Apache check)

```bash
tools/build-release.sh
```

Creates `dist/release-<date>-<commit>/` with `public_html/` and `sensum-cms/`
exactly as they are uploaded to Namecheap (see `docs/NAMECHEAP_DEPLOYMENT.md`),
plus a zip. The tree must be committed first.

Optional — run the build under real Apache + PHP-FPM (closest to the hosting):

```bash
brew install httpd
# 1. copy dist/release-*/public_html and sensum-cms into a folder, e.g. ~/sensum-apache/
# 2. in that copy only, comment out the 3 lines of the HTTPS/canonical redirect at the
#    top of public_html/.htaccess (local http://127.0.0.1 would otherwise be redirected)
# 3. create ~/sensum-apache/sensum-cms/.env with APP_ENV=development and
#    APP_URL=http://127.0.0.1:8088 (+ the Mailpit SMTP values)
# 4. start PHP-FPM on 127.0.0.1:9082 and Apache on 127.0.0.1:8088 with
#    AllowOverride All and mod_rewrite/headers/expires/deflate enabled
APACHE_BASE=http://127.0.0.1:8088 APACHE_HOME=~/sensum-apache node --test "tests/apache/*.test.mjs"
```

## 9. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "No pudimos verificar la solicitud por seguridad" on every save | `APP_URL` in `cms/.env` doesn't match the browser address (e.g. `localhost` vs `127.0.0.1`). Use the same host, or add it to `EXTRA_ALLOWED_ORIGINS`. |
| Sign-in works but you are immediately signed out | `APP_ENV=production` over `http://` — secure cookies need HTTPS. Use `APP_ENV=development` locally. |
| `/api/health` says `service_unavailable` | `composer install --working-dir=cms` wasn't run, or PHP < 8.1. Run `php cms/bin/console check`. |
| Photos are refused as "demasiados píxeles" | PHP's `memory_limit` is low; `tools/dev-server.sh` uses 256M. |
| "El archivo es demasiado grande" below 10 MB | PHP `upload_max_filesize`/`post_max_size`; the dev server sets 16M/20M. |
| No e-mails appear | Mailpit isn't running (`mailpit &`) or `SMTP_PORT` isn't 1025. Check `cms/storage/logs/app-*.log` for `mail_failed`. |
| The public site doesn't show my edit | Hard-reload (Cmd+Shift+R). Check `cms/storage/dev-public/index.html` exists. |
| Changes to `main.css`/`main.js` don't show | Browser cache — bump `Publisher::ASSET_VERSION` (and `?v=`) as described in `docs/FRONTEND_INTEGRATION.md`. |

**Start over** (fresh database, keeps your code):

```bash
rm -rf cms/storage/database.sqlite cms/storage/dev-public cms/storage/logs cms/storage/backups
php cms/bin/console migrate && php cms/bin/console create-admin
```

**Where things are:** application code `cms/src`, editable-field definitions
`cms/content/schema.php`, page templates `cms/templates/`, admin interface
`admin/`, private data `cms/storage/` (database, logs, backups, report
screenshots, outbox), logs `cms/storage/logs/app-YYYY-MM.log`.
