# Measurement plan (no analytics installed)

No analytics or marketing tags are installed on this site as delivered.
This document is a plan for what to measure and how, for whenever the
business decides it wants that visibility — it is intentionally not
implemented yet, so nothing collects data about visitors by default.

## What's worth measuring

| Event | Why it matters | Where it happens today |
|---|---|---|
| Contact form submission (success) | The core conversion — a lead | `assets/main.js`, `form.status_ok` path |
| Contact form submission (failed/invalid) | Where visitors get stuck before converting | `assets/main.js`, `form.status_error`/`form.status_invalid` paths |
| Phone number click (`tel:` links) | High-intent contact, especially on mobile | Contact section list, footer, 404 page |
| WhatsApp click | High-intent contact; also the no-JS/no-form fallback | Floating WhatsApp button, contact list, form fallback note, footer |
| Google Maps click | Interest in the physical location | `.map-card` link in Contact section, footer address link |
| Primary CTA clicks ("Solicitar evaluación técnica", "Cotizar proyecto", "Conversemos sobre tu proyecto", "Contáctanos ahora") | Which messaging/section actually drives people toward the form | Hero, header, Tipos de proyectos, CTA banner |
| Language toggle usage (ES→EN or EN→ES) | Whether the English audience is meaningful enough to justify the "distinct crawlable /en/ page" investment described in the completion report | `#langToggle` in `assets/main.js` |
| FAQ item opened | Which questions visitors actually have (native `<details>`, so this is a `toggle` event) | FAQ section |

## Recommended approach

**Privacy-conscious, cookie-free analytics** (e.g. Plausible, Fathom, or
Google's GA4 configured in a privacy-hardened way) rather than a
full-tracking suite. For a small local-business marketing site with no
user accounts, a lightweight tool that doesn't set tracking cookies and
gives page views + the custom events above is enough, and it sidesteps
most of the consent-banner complexity below. Whichever tool is chosen,
implement it as: page views (aggregate, no need to track individuals)
plus the 7 custom events in the table above, nothing more (no session
recording, no cross-site tracking, no ad pixels).

## Requirements before turning anything on

1. **Classify what the tool stores.** Document, in writing, whether the
   chosen tool sets cookies or uses any other client-side storage
   (localStorage, fingerprinting), and whether it's "strictly
   necessary" or "analytics" under whatever consent framework applies.
   Cookie-free tools (Plausible/Fathom-style) generally avoid needing a
   consent banner at all for basic page-view analytics; anything that
   sets a persistent identifier does need one.
2. **Consent before storage, not after.** If the chosen tool needs
   consent, no analytics/marketing script may load — and no cookie may
   be set — until the visitor has affirmatively consented. A banner
   that loads the script by default and only stops on "reject" is not
   compliant with that requirement.
3. **Disclose it in the Privacy Notice.** `privacy-notice.html` §2
   currently states "This site does not use analytics or tracking
   tools by default." That line must be replaced with a real
   description of the tool, what it collects, and (if applicable) how
   to opt out, *before* the tool goes live — not after.
4. **Retention and minimization.** Configure the shortest retention
   period the tool allows that still serves the business need (most
   privacy-conscious tools default to well under a year). Turn off any
   optional data collection not in the table above.
5. **IP/data minimization.** Use the tool's IP-anonymization/truncation
   option if it has one (GA4: IP anonymization is on by default in most
   configurations; Plausible/Fathom don't store raw IPs at all by
   design). Never proxy raw IP addresses into a third-party marketing
   pixel.
6. **No marketing tags before consent.** This applies doubly to any ad
   retargeting pixel (Meta Pixel, Google Ads conversion tracking,
   etc.) — those are marketing tags, not "analytics," and must never
   fire before consent, since they typically involve cross-site data
   sharing.
7. **Event implementation should stay defensive**, matching the rest of
   the codebase: event-tracking calls must no-op safely if the
   analytics script fails to load or is blocked (ad blockers routinely
   block these), and must never be the only way a feature works (e.g.
   never gate form submission itself on an analytics call succeeding).

## What this document is not

This is not a legal opinion on which consent framework applies to
Sensum Construcciones' visitors (that depends on where visitors are
located and what law governs — see the placeholders in
`privacy-notice.html` §4). It's an engineering and product plan for
*what* to measure and *how* to do it responsibly once that legal
question is answered.
