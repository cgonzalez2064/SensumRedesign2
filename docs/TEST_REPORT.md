# Test report — Content Manager branch

Environment: macOS 26 (Apple M4), PHP 8.2.34 (and 8.5.11 for compatibility),
SQLite 3 (bundled), Apache 2.4.69 + PHP-FPM 8.2 for the production-like run,
Google Chrome (desktop and tablet profiles), WebKit (iPhone 13 profile),
Playwright 1.63, axe-core 4.x, Lighthouse 12, Mailpit 1.31 as the SMTP server.

## Test suites

| Suite | Location | Size |
|---|---|---|
| API integration | `tests/integration/*.test.mjs` | 85 tests in 10 files; each file runs its own PHP server with a throwaway database; one server deliberately has SMTP down |
| Browser E2E | `tests/e2e/*.spec.js` | 24 specs × 3 browser profiles (72 runs, 13 skipped by design: phone-only or single-submission tests) |
| Visual regression | `tests/visual/public-site.spec.js` | 22 reference states of the public site vs. the approved `main` |
| Production build | `tests/apache/apache.test.mjs` | 6 checks of the built release under Apache + PHP-FPM |

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

## Other audits

| Audit | Result |
|---|---|
| Security Audit 1 & 2 | see `SECURITY_AUDIT.md` (no critical findings; 9 findings fixed and re-verified) |
| Dependency audit | `composer audit`: no advisories (PHPMailer 6.12.0); `npm audit` (dev tools): 0 |
| Static analysis | PHPStan level 6, PHP 8.1 target: 0 errors |
| Accessibility — admin | axe-core WCAG 2.1 AA on 12 screens + drawer + dialog, light and dark, 3 devices: no serious/critical violations; keyboard navigation, focus management, reduced motion and 44 px targets reviewed |
| Accessibility — public | identical before/after; pre-existing contrast findings on the approved orange labels reported as an optional recommendation |
| Performance | Lighthouse before/after: equal (desktop 99, mobile 84–85 locally with network throttling); +7 KB (main.js/css additions), no extra requests; with photos the LCP stays the hero heading (photos lazy, responsive `srcset`). Outliers were traced to slow Google Fonts responses (affects the approved site equally). |
| Visual regression | 22/22 identical to `main` (desktop 1440/1280, tablet 768, phones 390/320, ES and EN, modal, menu, form errors, FAQ, privacy, 404) |
| Production build | `tools/build-release.sh` → 48 public files + 133 private files (≈ 700 KB zip), no secrets/dev files; verified under Apache |

## How to re-run

See `docs/LOCAL_SETUP.md` §7–8. In short:

```bash
npm --prefix tests ci && npx --prefix tests playwright install webkit
mailpit &
npm --prefix tests test            # API (≈ 25 s)
npm --prefix tests run test:e2e    # browsers (≈ 3 min)
```
