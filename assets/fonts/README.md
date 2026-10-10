# Self-hosted Oswald + Roboto

The site serves its fonts from this folder — nothing is requested from Google,
so visitors' IP addresses are not shared with a third party, there is one less
DNS lookup and connection, and the Content-Security-Policy allows fonts and
styles only from the site itself.

| File | Family | Weights | Subset |
|---|---|---|---|
| `roboto-latin.woff2` | Roboto (variable) | 400–700 | Latin (preloaded) |
| `oswald-latin.woff2` | Oswald (variable) | 600–700 | Latin (preloaded) |
| `roboto-latin-ext.woff2`, `oswald-latin-ext.woff2` | | | Latin Extended — downloaded by browsers only if a page uses one of its characters |

Both families are licensed under the SIL Open Font License 1.1 (free to embed
and redistribute). The files are the ones Google Fonts serves, so the site
looks exactly as before (visual regression 22/22 identical).

To update them (rarely needed): `cd assets/fonts && ./fetch-fonts.sh`, then bump
`Publisher::ASSET_VERSION` and the `?v=` in the committed pages
(`docs/FRONTEND_INTEGRATION.md`).
