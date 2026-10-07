# Sensum Construcciones — website + Content Manager

The public website of [sensumconstrucciones.com](https://sensumconstrucciones.com)
(approved redesign, static HTML/CSS/JS) and the **Administrador de contenido**:
a secure, Spanish-first admin panel at `/admin` that lets authorized staff
change texts, photos, the portfolio PDF and contact details without touching
code, and report problems to IT (it@gruposensum.com).

The Content Manager is built *around* the approved site: it re-generates the
same static pages from templates, byte-identical when nothing has changed. The
public site never runs PHP or a database on a visitor's request.

## Quick start (local)

```bash
composer install --working-dir=cms
cp .env.example cms/.env        # then set the local values from docs/LOCAL_SETUP.md §3
php cms/bin/console migrate
php cms/bin/console create-admin
tools/dev-server.sh             # site http://127.0.0.1:8080 · admin /admin · Mailpit :8025
```

Requirements: PHP 8.1+ (pdo_sqlite, gd, fileinfo, mbstring), Composer, Mailpit;
Node 20+ only for the automated tests. Full guide: [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md).

## Repository layout

| Path | What |
|---|---|
| `index.html`, `404.html`, `privacy-notice.html` | public pages — **generated** from `cms/templates/` (committed with the approved default content) |
| `assets/` | site CSS/JS/images; `assets/uploads/` receives published photos |
| `admin/` | admin interface (static HTML + vanilla JS modules, no build step) |
| `api/index.php` | single public entry point of the admin API |
| `cms/` | private application (PHP): code, content schema, templates, migrations, CLI, storage — **outside `public_html` in production** |
| `tests/` | API, browser, visual and Apache tests (dev only) |
| `tools/` | dev server, release build, defaults extractor |
| `docs/` | documentation (below) |

## Documentation

| Document | For |
|---|---|
| [docs/CURRENT_SITE_BASELINE.md](docs/CURRENT_SITE_BASELINE.md) | the approved design and what must not change |
| [docs/CONTENT_MANAGER.md](docs/CONTENT_MANAGER.md) | architecture decision, features, data model, API, security model, telemetry |
| [docs/FRONTEND_INTEGRATION.md](docs/FRONTEND_INTEGRATION.md) | every public-site change, templates, how to keep developing the design |
| [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) | local installation, e-mail testing, automated tests |
| [docs/NAMECHEAP_DEPLOYMENT.md](docs/NAMECHEAP_DEPLOYMENT.md) | production deployment on Namecheap Stellar Plus, backups, rollback |
| [docs/PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md) | go-live checklist |
| [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md) | security audits 1 and 2, risks, recommendations |
| [docs/TEST_REPORT.md](docs/TEST_REPORT.md) | local test passes 1 and 2 |
| [docs/USER_GUIDE_ES.md](docs/USER_GUIDE_ES.md) / [docs/USER_GUIDE_EN.md](docs/USER_GUIDE_EN.md) | guides for the people who use the panel |

Earlier project notes (`NOTES.md`, `DEPLOY.md`, `CONTENT-APPROVAL.md`,
`MEASUREMENT-PLAN.md`, `COMPLETION-REPORT.md`) describe the approved redesign.

## Tests

```bash
npm --prefix tests ci
npm --prefix tests test          # 85 API tests (each with a throwaway database)
npm --prefix tests run test:e2e  # Chrome + WebKit (iPhone), light/dark, accessibility scans
```

## Release

```bash
tools/build-release.sh           # dist/release-<date>-<commit>/{public_html,sensum-cms} + zip
```
