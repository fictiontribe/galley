---
title: Scripts, for developers
navTitle: Scripts
description: How a site's analytics and tags are kept in one file and written into every page by the site kit — placement, timing, consent, Google Consent Mode, the editor's preview and Content Security Policy.
group: astro
order: 6
---

This page is for developers; editors add scripts on the **Scripts** screen ([Add Google Analytics](/docs/editing/scripts/)), which links here. *Status: built.*

A site's tags — Google Tag Manager, GA4, ad pixels, chat — are listed in **one file**, `src/data/scripts.json`, and the [site kit](/docs/astro/site-kit/) writes them into every page from each vendor's own snippet: in the right place, at the right moment, and only once the visitor has agreed to what they do. Because the setup is a content file, every change to it waits in Proof.

## Placing them

With the vendored kit, the layout renders the three placements once:

```astro
---
import { Scripts } from "../galley/components/index.js";
---
<html>
  <head>
    <meta charset="utf-8" />
    <Scripts placement="head" />
  </head>
  <body>
    <Scripts placement="body-start" />
    <slot />
    <Scripts placement="body-end" />
  </body>
</html>
```

`Scripts` reads `src/data/scripts.json` when it exists and does nothing when it doesn't. The body-end placement also carries the email-link dialog. **Set it up for me** on the Scripts screen adds these lines when exactly one layout writes its own `<html>`. With the published integration (not on npm yet), its middleware places them with no template changes.

## The file

```jsonc
{
  "consent": { "mode": "banner", "defaults": [], "googleConsentMode": true },
  "scripts": [
    { "id": "ga4", "kind": "ga4", "enabled": true, "settings": { "measurementId": "G-4B2C9XK7QZ" } },
    { "id": "chat", "kind": "custom", "label": "Support chat", "enabled": true,
      "settings": { "src": "https://cdn.example.com/widget.js" },
      "consent": "preferences", "placement": "body-end", "load": "interaction", "include": ["/support/**"] }
  ]
}
```

| Key | |
| --- | --- |
| `kind` | One of the catalogue's — `gtm`, `ga4`, `meta-pixel`, `linkedin-insight`, `hubspot`, `marketo-munchkin`, `plausible`, `segment`, `hotjar`, `clarity`, `intercom` — or `custom`. The format and the catalogue are `ScriptsConfig` in [`packages/core/src/kit.ts`]({repository}/blob/main/packages/core/src/kit.ts) and `SCRIPT_INTEGRATIONS` in [`kit-catalog.ts`]({repository}/blob/main/packages/core/src/kit-catalog.ts). |
| `settings` | The vendor's ids, checked against its pattern: a wrong id **fails the build** with a message saying what it should look like. |
| `placement` | `head`, `body-start`, `body-end`. |
| `load` | `eager`, `idle` (after load, when the browser is idle) or `interaction` (the first scroll, tap, click or key). |
| `consent` | `necessary`, `analytics`, `marketing` or `preferences`. |
| `include` / `exclude` | Page-path globs, matched per page at build time. |
| `inPreview` | Also load in `astro dev` and the editor's preview. Default `false`. |

Every key, with defaults: [`docs/scripts.md`]({repository}/blob/main/docs/scripts.md).

## Consent

Every snippet goes into the page inert and is switched on by a small runtime (2.4 KB gzipped) once its consent category is granted.

- `"mode": "none"` — everything enabled loads; no banner.
- `"mode": "banner"` — the built-in banner: **Accept all**, **Reject all** (equally prominent) and **Choose…**; the choice is kept in the visitor's browser. Any element with `data-galley-consent-open` reopens it.
- `"mode": "external"` — another consent tool decides. The kit listens for Google Consent Mode updates and Cookiebot's events; for other tools call `window.galleyConsent.set({ analytics, marketing, preferences })` from the tool's callback.

`googleConsentMode: true` sends Google Consent Mode v2 defaults before any Google tag and updates them with the visitor's choice.

## In development and the editor's preview

In `astro dev`, and in the editor's preview, only scripts with `inPreview: true` run: editing a page never counts as a visit or fires an ad pixel. Forms and the email-link dialog behave as on the published site. `astro build` logs one line per script — what loads, where, when, under which consent, on which pages.

## Content Security Policy

Everything the kit writes inline is constant per site, so a hash-based policy works: hash the runtime, the three placement calls and each inline snippet, and allow the vendors' own hosts. Details: [`docs/scripts.md`]({repository}/blob/main/docs/scripts.md#content-security-policy).

## Adding a kind of script

Plugins can add integrations to the app's catalogue ([Plugins](/docs/plugins/)); a kind the kit has no snippet for is written from its `settings.src` or `settings.inline`.
