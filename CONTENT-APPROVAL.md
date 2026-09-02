# Content approval checklist

Everything on this list was either removed from the live page, replaced
with non-numeric/verifiable language, or left as a placeholder, because it
could not be independently verified during this pass. Nothing below was
silently rewritten and republished as if it were confirmed — review each
item and tell the developer which ones to restore (with real, current
numbers/details) and which to leave as-is.

## Removed from the page — needs your decision to restore

| # | What it said | Where it was | What replaced it | To restore, you need to confirm |
|---|---|---|---|---|
| 1 | "298 proyectos completados" | Hero stat panel | A non-numeric "how we work" panel (Planificación / Precisión / Comunicación clara / Respaldo técnico) | The current, accurate count and a source for it |
| 2 | "289 remodelaciones" | Hero stat panel | Same as above | Same as above |
| 3 | "100% clientes satisfechos" | Hero stat panel | Same as above | The actual figure and how it's measured (survey? repeat business?) |
| 4 | "100%" / "De nuestros clientes recomiendan nuestro trabajo" | About section art caption | A non-numeric caption ("Planificación y supervisión técnica en cada etapa del proyecto") | Same as #3 |
| 5 | "+10 años construyendo en Ciudad de Guatemala" (hero eyebrow) | Hero | "Construcción y remodelación en Ciudad de Guatemala" (no year count) | The company's actual founding/operating year, so the count stays accurate over time |
| 6 | "con más de 10 años de experiencia" | Footer bio | "Diseño y construcción profesional en Ciudad de Guatemala." | Same as #5 |
| 7 | "Trabajo garantizado" (hero badge) | Hero badges | "Supervisión técnica" (from the approved About copy) | The actual warranty/guarantee terms you offer, if any — see #12 below on the Entrega y garantía process step, which already says only that warranty conditions are documented at delivery, without specifying what they are |
| 8 | "Evaluación técnica gratuita" (hero badge + old hero/CTA copy + old contact copy) | Hero badges, hero CTA, CTA banner, Contact intro | "Comunicación clara" (hero badge); CTAs and copy now say "Solicitar/agenda una evaluación técnica" with no cost claim | Whether the technical evaluation is actually free, and if so, restore that specific claim explicitly (don't imply it) |
| 9 | "Pagos seguros con VISA (VisaNet)" trust badge | Footer | Removed entirely | Whether Sensum has a real, current relationship with VisaNet as a payment processor. If yes, the real badge/logo (not a recreated icon) and its terms of use |
| 10 | "Respaldo de Aseguradora General" trust badge | Footer | Removed entirely | Whether Sensum has a real, current relationship/policy with Aseguradora General. If yes, the real badge/logo and what the coverage actually protects (the client's project? the business's liability?) — this reads as an insurance/guarantee claim to a visitor and should not be vague |
| 11 | `priceRange: "$$"` | JSON-LD structured data | Removed | Whether you want a price-range signal in search results at all, and if so, the right value for your typical project sizes |

## Kept as previously-established/confirmed content

These were already carried into the redesign in earlier passes (per
`NOTES.md`) as content pulled directly from the live site or explicitly
confirmed by the business owner at the time, so they were **not** treated
as new unverified claims and were left in place:

- Business hours (Mon–Fri, 8:00–17:30) — explicitly confirmed by the
  owner in an earlier pass.
- Address, phone numbers, email — carried from the live site's contact
  information; not altered per the instruction to preserve verified
  business contact details.
- Instagram handle (`@sensumconstruccionesgt`) — verified to exist.
- Slogan "Tu mejor opción en servicios de construcción" — noted in
  `NOTES.md` as the business's real tagline.
- The 6 service names/descriptions — cross-checked against the live
  site's services page in an earlier pass.

**Still worth a final sign-off before launch**, even though these weren't
flagged as new risks: reconfirm the address, phone numbers, hours, and
geographic coordinates in the JSON-LD (`latitude: 14.5951, longitude:
-90.5136`) are still current, since geocoded coordinates were derived
from the address and not independently re-verified against a map this
pass.

## New/rewritten copy — approved by the requester for this pass

The hero title/description, primary/secondary CTAs, About paragraph,
Mission, Vision, Services introduction, the 4 process steps, the Contact
intro, and the form privacy note all use the exact wording supplied for
this pass (with natural English translations). No numbers, credentials,
guarantees, or specific commitments were added beyond what was supplied.

## "Tipos de proyectos" section (formerly "Proyectos")

Relabeled from a portfolio-style "Proyectos" section to "Tipos de
proyectos" because the six cards show project **categories**
(Remodelación residencial, Ampliación comercial, etc.) illustrated with
custom line-art icons — not real photos, addresses, client names, or
completed-project claims. The cards are now built as a reusable
case-study structure (see the HTML comment inside the first card in
`index.html`) ready to receive a real photo, location, scope, summary,
and optional before/after images per project — once you can supply:

- Real project photos you have the right to publish (client permission
  where the project isn't yours alone to show).
- The real location (at least the zone/neighborhood — full addresses of
  client properties generally shouldn't be published without consent).
- A short, accurate scope description and summary.
- Optional before/after photo pairs, only where both exist and
  publishing them has been confirmed with the client.

## FAQ section

Every question/answer in the new FAQ section is derived only from
information already approved or visible elsewhere on the page (services
list, the 4-step process, hours, contact channels, and the language
toggle). No pricing, warranty specifics, financing terms, or other
commercial policy was invented to answer a question — if you want
additional FAQs about topics like pricing, financing, or minimum project
size, supply the approved answer and it can be added the same way.

## Privacy notice placeholders

`privacy-notice.html` is a real, published page, but contains several
`[PLACEHOLDER: ...]` blocks (visually marked in a highlighted box) for
details that need your or counsel's confirmation before this can be
considered final: the company's full legal name/NIT, the applicable
Guatemalan data-protection legal basis, any third-party email/hosting
processor, exact data-retention periods, and the ARCO-rights request
procedure/timeline. See that file directly for the full list, and
`MEASUREMENT-PLAN.md` for how analytics — if added later — would need to
be disclosed there too.

## Bilingual SEO architecture

Documented in the completion report, not this file: the site keeps its
single-URL, client-side ES/EN toggle rather than shipping separate
`/` and `/en/` documents, and why. This is a decision, not an
unverified-content item, but it does affect what search engines can
independently index — see the report for the full reasoning.
