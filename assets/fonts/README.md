# Self-hosting Oswald + Roboto

The site currently loads Oswald (600, 700) and Roboto (400, 500, 600, 700)
from Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`), trimmed to
exactly the weights `assets/main.css` uses, with `display=swap`. That's a
normal, working, license-compliant setup (both are SIL Open Font License
fonts) and is fine to ship as-is.

Self-hosting is the better long-term option: one less DNS lookup/connection,
no dependency on Google's availability, and it lets the CSP in `.htaccess`
drop `fonts.googleapis.com`/`fonts.gstatic.com` entirely. It could not be
finished from the environment that produced this delivery — that sandbox's
network egress policy blocks both Google Fonts hosts outright (confirmed via
`curl`, which came back `403`/connection-reset from an internal proxy, not
from Google), so the actual `.woff2` files could not be downloaded and
committed here.

## To finish it (5 minutes, from a machine with normal internet access)

1. `cd assets/fonts && ./fetch-fonts.sh` — downloads the 6 required WOFF2
   files (Oswald 600/700, Roboto 400/500/600/700) into this folder.
2. In `index.html`, replace:
   ```html
   <link rel="preconnect" href="https://fonts.googleapis.com">
   <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
   <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@600;700&family=Roboto:wght@400;500;600;700&display=swap">
   ```
   with:
   ```html
   <link rel="stylesheet" href="assets/fonts/local-fonts.css">
   ```
3. In `.htaccess`, remove `https://fonts.googleapis.com` from `style-src` and
   `https://fonts.gstatic.com` from `font-src` in the `Content-Security-Policy`
   header (nothing will load from either host anymore).
4. Confirm in a real browser that both families still render correctly and
   that the Network panel shows the six `.woff2` requests as same-origin.

If you'd rather not self-host, no action is needed — the current Google
Fonts setup is a legitimate, supported configuration.
