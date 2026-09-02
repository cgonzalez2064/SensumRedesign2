# Deploying Sensum Construcciones to Namecheap (cPanel)

Everything you need to take this folder live on your Namecheap hosting is
below, in order. Most of it doesn't require the command line — cPanel's
File Manager handles it through the browser — except the two optional
command-line steps called out explicitly (self-hosting fonts, and the
post-deploy header-verification command).

## 1. What's in this folder

```
index.html                 the whole site (one page, in-page sections)
404.html                   custom "not found" page (wired via .htaccess ErrorDocument)
privacy-notice.html        Spanish privacy notice — has [PLACEHOLDER] items, see CONTENT-APPROVAL.md
.htaccess                  security headers, HTTPS redirect, caching, compression
assets/
  main.css                 all styles
  main.js                  all interactivity (nav, animations, language toggle, form)
  contact-handler.php      server-side handler for the contact form (hardened — see step 5)
  fonts/                   self-hosting scaffold for Oswald/Roboto (optional — see step 5b)
  logo-*.png, favicon-*.png, icon-*.png, og-image.png   your logo + generated icons
robots.txt
sitemap.xml
site.webmanifest
sensum-mail-config.example.php   template for optional SMTP upgrade — see step 5a. Never upload the filled-in version into public_html.
CONTENT-APPROVAL.md        every unverified claim removed/flagged this pass, and what's needed to restore each
MEASUREMENT-PLAN.md        analytics/measurement plan — nothing is installed yet by design
NOTES.md                   design/content notes from the rebuild
DEPLOY.md                  this file
```

`.htaccess` starts with a dot, so it's normally hidden — see step 3 for how
to make sure your computer and cPanel both show/upload it.

## 2. Point your domain at this hosting (if not already)

If `sensumconstrucciones.com` isn't already pointed at this Namecheap
hosting account, do that first in Namecheap's Domain List → **Manage** →
**Nameservers**, and set them to Namecheap's hosting nameservers (cPanel's
**Statistics** sidebar on the left shows the exact ones for your account —
usually `dns1.namecheaphosting.com` / `dns2.namecheaphosting.com`). DNS
changes can take a few hours to propagate; you can start the rest of this
checklist in the meantime.

## 3. Upload the files

1. Log in to cPanel and open **File Manager**.
2. In File Manager, click **Settings** (top right) and make sure **"Show
   Hidden Files (dotfiles)"** is checked — otherwise you won't see
   `.htaccess` after uploading it, and it's easy to think it didn't upload.
3. Navigate to `public_html` (this is your domain's web root). If you see
   a leftover `index.html`/`index.php` from a previous site or a builder
   template, move it into a backup folder rather than deleting it, in case
   you need to roll back.
4. Click **Upload**, and upload everything from this folder **except**
   `sensum-mail-config.example.php`, `NOTES.md`, `CONTENT-APPROVAL.md`,
   `MEASUREMENT-PLAN.md`, and `DEPLOY.md` itself — those are reference
   documents for you/your developer, not part of the live site (`.htaccess`
   also blocks `.md` files from being served directly, as defense in
   depth, but there's no reason to upload them into `public_html` at all).
   Upload `index.html`, `404.html`, `privacy-notice.html`, `.htaccess`,
   `robots.txt`, `sitemap.xml`, `site.webmanifest`, and the entire
   `assets/` folder (File Manager's uploader accepts a zip you can extract
   in place, which is easier than dragging files one at a time: zip them
   locally, upload the zip, right-click it in File Manager → **Extract**,
   then delete the zip once you've confirmed the files landed in
   `public_html` directly — not inside an extra subfolder).
5. Confirm the layout in `public_html` is flat: `index.html` and
   `.htaccess` sit directly inside `public_html`, with `assets/` as a
   subfolder next to them — not nested inside another folder.

## 4. Enable SSL (HTTPS)

1. In cPanel, go to **Security → SSL/TLS Status** (or **AutoSSL**).
2. Select your domain and click **Run AutoSSL**. Namecheap issues a free
   Let's Encrypt–style certificate automatically; this usually finishes in
   a few minutes.
3. Once it shows a valid certificate, visit `https://sensumconstrucciones.com/`
   directly to confirm it loads over HTTPS with no browser warning.

`.htaccess` (already uploaded) force-redirects any `http://` visit, and any
host other than the bare canonical domain, to `https://sensumconstrucciones.com/`
— **don't skip step 4**, or every visitor will hit a redirect loop (HTTPS
enforced by `.htaccess`, but no certificate yet to actually serve it over
HTTPS).

## 5. Set up the contact form email

`assets/contact-handler.php` uses PHP's built-in `mail()` function by
default, which works out of the box on Namecheap shared hosting — no extra
setup needed for a first version. One thing to check:

1. Open `assets/contact-handler.php` in File Manager's code editor.
2. Find this line near the top:
   ```php
   const TO_EMAIL = 'contacto@sensumconstrucciones.com';
   ```
   Make sure that's the inbox you actually want leads delivered to (create
   it first in cPanel's **Email Accounts** if it doesn't exist yet). Also
   confirm `SENDER_DOMAIN` a few lines below is `sensumconstrucciones.com`
   — this is intentionally hardcoded rather than read from the request, so
   never change it to anything request-derived.
3. Save, then test the live form (see the checklist in step 7).

### 5a. Deliverability: SPF, DKIM, DMARC (required either way)

Whether you stay on `mail()` or upgrade to SMTP below, outgoing mail needs
these DNS records for `sensumconstrucciones.com` or it will land in spam
for Gmail/Outlook recipients:

- **SPF** — a TXT record on the root domain authorizing whichever server
  actually sends the mail (`v=spf1 include:<your-smtp-or-host-provider> ~all`).
- **DKIM** — a signing key published as a TXT record at
  `<selector>._domainkey.sensumconstrucciones.com`.
- **DMARC** — a TXT record at `_dmarc.sensumconstrucciones.com` telling
  receiving mail servers what to do with mail that fails SPF/DKIM, e.g.
  `v=DMARC1; p=quarantine; rua=mailto:contacto@sensumconstrucciones.com`.

**Low effort:** cPanel → **Email Deliverability** shows whether SPF/DKIM
already validate for this domain, and can auto-install the DNS records it
suggests into Namecheap's DNS settings with one click.

### 5b. Optional: upgrade to authenticated SMTP

`contact-handler.php` will automatically use SMTP instead of `mail()` if a
config file exists **one directory above `public_html`** (i.e. outside the
web root — never inside it, and never committed to this repo):

1. Copy `sensum-mail-config.example.php` to your cPanel home directory
   (the level above `public_html`), and rename it to
   `sensum-mail-config.php`.
2. Fill in the real SMTP host/port/username/password for the mailbox you
   want to send as (e.g. the `contacto@` or a dedicated `no-reply@`
   mailbox created in cPanel → Email Accounts).
3. That's it — `contact-handler.php` detects the file and uses it
   automatically on the next form submission. If anything about it fails,
   it silently falls back to `mail()` rather than losing the lead.

If you'd rather use a maintained library (PHPMailer, Symfony Mailer, etc.)
instead of the built-in minimal SMTP client in the example file, replace
the body of `$smtpSend` in your copy — just keep the same function
signature so `contact-handler.php` doesn't need to change.

### 5c. Rate-limiting storage

The contact form's abuse-control data (a salted hash of the sender's IP
plus recent submission timestamps — never the raw IP, and auto-pruned
after 24 hours) is written to `sensum-rl-data/`, created automatically one
directory above `public_html` the first time it's needed. If that
directory can't be created/written on your hosting plan, it falls back to
`assets/.rl-data/` inside `public_html`, which `.htaccess` blocks from
direct web access — either location is fine; no action needed from you.

## 6. WhatsApp number

The floating WhatsApp button and the "click to chat" link use
**+502 3481-9804** (the mobile number from the site's contact section).
If that's not the right number to receive WhatsApp inquiries on, it's set
in one place: search `assets/main.js` for `WHATSAPP_NUMBER` and change the
value (digits only, with country code, no `+` or spaces). Also update the
`href="https://wa.me/..."` in `index.html`'s `#whatsappFab` link and the
form's fallback note if you change it, since those are static HTML (kept
static on purpose, so the number still works before JavaScript loads).

## 7. Post-deploy checklist

Go through this on the live URL once DNS + SSL are both working:

- [ ] `https://sensumconstrucciones.com/` loads with a padlock (no
      certificate warning)
- [ ] `http://sensumconstrucciones.com/`, `https://www.sensumconstrucciones.com/`,
      and any other host pointed at this server all redirect to the
      canonical `https://sensumconstrucciones.com/` (not just www — try a
      made-up subdomain or IP-based Host header if you can, to confirm
      unrecognized hosts don't get served directly)
- [ ] A clearly bad URL (e.g. `/does-not-exist`) shows the branded 404
      page, not a generic Apache error
- [ ] `/privacy-notice.html` loads and is linked from the footer and the
      contact form's note
- [ ] Every nav link (desktop + mobile) scrolls to the right section,
      including the new "Preguntas frecuentes" link
- [ ] Mobile menu opens/closes, closes on Escape and on backdrop tap, Tab
      cycles only through the menu's own links while it's open (it
      shouldn't be possible to Tab into content behind it), and focus
      returns to the hamburger button on close
- [ ] Language toggle (top right, "EN"/"ES") switches every section's
      text — including the new FAQ — and your choice is remembered on
      reload
- [ ] FAQ items expand/collapse with mouse, keyboard (Enter/Space on a
      focused question), and — to confirm the no-JS fallback works —
      with JavaScript disabled in the browser entirely
- [ ] The WhatsApp button (bottom-left) opens a chat pre-filled with a
      message in the currently selected language
- [ ] "Abrir en Google Maps" opens the correct location
- [ ] Submit the contact form with real details and confirm the email
      arrives at the inbox set in step 5 — then submit it once more with a
      field left blank (including leaving the service dropdown on its
      placeholder) and confirm it's rejected with an inline error, focus
      moves to the first invalid field, and nothing you typed is lost
- [ ] With JavaScript disabled, submit the form and confirm it still
      emails the lead (via the plain HTML fallback response) — this is
      the form's no-JS path
- [ ] Run the URL through
      [Google's Mobile-Friendly Test](https://search.google.com/test/mobile-friendly)
      and [PageSpeed Insights](https://pagespeed.web.dev/)
- [ ] Run the URL through [securityheaders.com](https://securityheaders.com)
      to confirm the `.htaccess` headers are being served (shared hosting
      occasionally disables `mod_headers` — if the scan comes back with no
      headers detected, open a support ticket with Namecheap asking them to
      confirm `mod_headers`, `mod_rewrite`, `mod_deflate`, and
      `mod_expires` are enabled on your account, since `.htaccess` alone
      can't turn on a disabled module). Or run this from any machine with
      `curl`, once DNS points here:
      ```
      curl -sI https://sensumconstrucciones.com/ | grep -Ei 'strict-transport|content-security|x-content-type|x-frame|referrer-policy|permissions-policy|cross-origin'
      ```
      All seven headers should be present. **Don't mistake a local/dev
      preview for a production failure** — headers only come from Apache
      reading `.htaccess` on the real hosting account; they will not
      appear when previewing the raw files locally or in a sandboxed tool
      that doesn't run Apache.
- [ ] In **Google Search Console**, add the property, verify ownership, and
      submit `https://sensumconstrucciones.com/sitemap.xml`
- [ ] Validate the JSON-LD blocks at
      [validator.schema.org](https://validator.schema.org/) against the
      live URL (there are two `<script type="application/ld+json">`
      blocks — the business info block and the FAQ block)

## 8. Updating the site later

Any time you want to change text, prices, etc.: edit the relevant file
(`index.html` for content/structure — including both `data-i18n="..."`
Spanish defaults and the matching key in `assets/main.js`'s `I18N.es`/
`I18N.en` objects — `assets/main.css` for styling, `assets/main.js` for
behavior/translations) and re-upload just that file through File Manager,
overwriting the old one. There's no build step — what you upload is
exactly what visitors see.

**Cache-busting:** static assets are requested with a version query
string (`assets/main.css?v=2`, `assets/main.js?v=2` in `index.html`, and
`assets/fonts/local-fonts.css` if you self-host fonts). Bump that `v=`
number whenever you change `main.css` or `main.js`, or returning visitors
may keep serving their browser-cached copy for up to a month (see the
cache headers in `.htaccess`).

If you're working with a developer going forward, the whole site is plain
HTML/CSS/JS with no framework or build tooling, so any standard code
editor and an FTP/SFTP client (cPanel → **FTP Accounts**, or the File
Manager itself) is all that's needed.
