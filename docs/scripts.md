# Third-party scripts

A site's tags — Google Tag Manager, GA4, ad pixels, chat — are listed in
**one file**, `src/data/scripts.json`, and the site kit (`@galleycms/astro`)
writes them into every page correctly: the vendor's own snippet with the
site's ids, in the right place, loaded at the right moment, and only once the
visitor has agreed to what it does. Because the setup is a content file it is
edited in the app's scripts screen, by the assistant, over MCP or by hand,
proofed and published like any change.

The format is the contract in `packages/core/src/kit.ts` (`ScriptsConfig`,
`ScriptEntry`, `ConsentSettings`); the catalogue of known integrations is
`packages/core/src/kit-catalog.ts` (`SCRIPT_INTEGRATIONS`).

- [Setting up a site](#setting-up-a-site)
- [The file](#the-file)
- [The catalogue](#the-catalogue)
- [Where and when a script loads](#where-and-when-a-script-loads)
- [Consent](#consent)
- [Google Consent Mode v2](#google-consent-mode-v2)
- [Development and the editor's preview](#development-and-the-editors-preview)
- [What the build says](#what-the-build-says)
- [Content Security Policy](#content-security-policy)
- [Adding an integration](#adding-an-integration)

## Setting up a site

**Set it up for me.** On an Astro site without the kit, the Scripts screen
(like Forms) offers one button that adds the kit's files, an empty
`src/data/scripts.json` (the built-in banner, Google Consent Mode on) and —
when the site has exactly one layout writing its own `<html>`, `<head>` and
`<body>` — the three placements below, as pending changes in Proof. When the
layout isn't clear it says so, with a request for the assistant and the lines
for a developer, and the Scripts screen keeps a note of it until the
placements are there. It also turns on the kit's build step in
`astro.config` (the version AI assistants read, `docs/ai-first-output.md`)
when that file has the plain `defineConfig({ … })` shape. Details in
`docs/forms.md`, "Setting up a site".

**With the integration** (`npx astro add @galleycms/astro`): nothing else. The
integration reads `src/data/scripts.json` (option `scripts.file`) and its
middleware puts the scripts into every HTML page as it is rendered —
prerendered pages at build time, on-demand pages per request — so **no
template changes**. `scripts: { inject: false }` turns the automatic
placement off; `scripts: false` turns the part off.

Astro's integration API has no hook that writes into `<body>`, so the kit
uses a middleware that edits the finished HTML: the head part goes right
after `<meta charset>` (else right after `<head>`), body-start right after
`<body…>`, body-end right before `</body>`. A layout that prefers to choose
the spot renders `<Scripts placement="head" />` (and `"body-start"`,
`"body-end"`) from `@galleycms/astro/components`; a placement the page already
has is not added again. `<ConsentBanner />` does the same for the banner.

**Without the integration** (vendored, `node packages/astro/scripts/vendor.mjs <site>`):
the layout renders the three placements itself:

```astro
---
import { Scripts } from "../galley/components/index.js";
---
<html>
  <head>
    <meta charset="utf-8" />
    <Scripts placement="head" />
    …
  </head>
  <body>
    <Scripts placement="body-start" />
    …
    <Scripts placement="body-end" />
  </body>
</html>
```

`Scripts` reads `src/data/scripts.json` if it exists (and does nothing if it
doesn't). The body-end placement also carries the email-link dialog
(`docs/mailto.md`).

## The file

```jsonc
{
  "consent": {
    "mode": "banner",                       // "none" | "banner" | "external"
    "defaults": [],                         // categories on before a choice ("necessary" always is)
    "googleConsentMode": true,
    "banner": {                             // every word is optional; defaults below
      "title": "Cookies and tracking",
      "text": "This site would like to measure visits…",
      "acceptLabel": "Accept all", "rejectLabel": "Reject all",
      "settingsLabel": "Choose…", "saveLabel": "Save choices",
      "policyUrl": "/privacy/", "policyLabel": "Privacy policy",
      "categories": { "analytics": { "label": "Analytics", "description": "Counts visits and shows which pages are used." } }
    }
  },
  "scripts": [
    { "id": "gtm", "kind": "gtm", "enabled": true, "settings": { "containerId": "GTM-AB12CDE3" } },
    { "id": "ga4", "kind": "ga4", "enabled": true, "settings": { "measurementId": "G-TEST12345" }, "load": "idle" },
    { "id": "chat", "kind": "custom", "label": "Support chat", "enabled": true,
      "settings": { "src": "https://cdn.example.com/widget.js", "attributes": { "data-key": "pk_live_…" } },
      "consent": "preferences", "placement": "body-end", "load": "interaction",
      "include": ["/pricing/", "/support/**"], "exclude": ["/support/legal/"],
      "note": "Asked for by support, March" }
  ]
}
```

| Key | |
| --- | --- |
| `id` | Unique, lowercase. |
| `kind` | A [catalogue](#the-catalogue) kind, or `custom`. |
| `label` | Shown in the app (default: the integration's name). |
| `enabled` | `false` keeps the entry but writes nothing. |
| `settings` | The integration's ids. Checked against the vendor's pattern: a wrong id **fails the build** with a message saying what it should look like ("“GTM-12” doesn't look like a Google Tag Manager Container ID (it looks like GTM-XXXXXXX)."). |
| `placement` | `head`, `body-start`, `body-end` (default: the integration's). |
| `load` | `eager` (default: as the page is read), `idle` (after the page has loaded and the browser is idle), `interaction` (the first scroll, tap, click or key — never, if there is none). |
| `consent` | `necessary`, `analytics`, `marketing`, `preferences` (default: the integration's; `marketing` for an unknown script). |
| `include` / `exclude` | Page-path globs, matched at build time per page, without the site's base: `/` (home only), `/pricing/` (with or without the trailing slash), `/blog/*` (one level), `/blog/**` (`/blog/` and everything under it), `*/thanks/`. Empty `include` = every page; `exclude` wins. |
| `inPreview` | Also load in `astro dev` and in the editor's preview. Default `false`. |
| `note` | For colleagues. |

`custom` takes `src` (an `https://` address) and/or `inline` (code, run as
written) and `attributes` (`{ "name": "value" | true }`; `src`, `type` and
`on…` handlers are refused — use `src` and `inline`).

A `kind` this version of the kit has no snippet for — one a plugin adds to
the app's catalogue — is written the same way, from its `settings.src` /
`settings.inline` / `settings.attributes`, under the same consent (default
`marketing`) and placement (default `body-end`) rules. Without either, the
build stops with "A “…” script is written from its own settings.src (the
script's address) or settings.inline (its code); give it one of them."

## The catalogue

Exported as JSON-able data from `@galleycms/astro/catalog` (`scriptIntegrations`),
mirrored from `packages/core/src/kit-catalog.ts` (a test fails if they
differ).

| `kind` | Settings | Default consent | Default place | Snippet checked against |
| --- | --- | --- | --- | --- |
| `gtm` | `containerId` (`GTM-…`), `noscript` (`"true"` adds the older `<noscript>` frame after `<body>`) | analytics | head | [Install a web container](https://support.google.com/tagmanager/answer/14847097) — the current one-part snippet (`gtm.js?id=…` + `dataLayer`/`gtag('js')`), and the previous version's `<noscript>` frame |
| `ga4` | `measurementId` (`G-…`) | analytics | head | [Install the Google tag](https://developers.google.com/tag-platform/gtagjs/install) (updated 2026-11-06) + [`config` command](https://developers.google.com/tag-platform/gtagjs/configure) |
| `meta-pixel` | `pixelId` | marketing | head | [Meta Pixel base code](https://developers.facebook.com/docs/meta-pixel/get-started), verbatim (the `<noscript>` image gets `alt=""`) |
| `linkedin-insight` | `partnerId` | marketing | body-end | The code Campaign Manager issues (Signals manager › Insight Tag); LinkedIn's [help page](https://www.linkedin.com/help/lms/answer/a418880) gives the placement but not the code |
| `hubspot` | `portalId`, `region` (`eu1` → `js-eu1.hs-scripts.com`) | marketing | body-end | The HubSpot embed code (`hs-script-loader`); [help page](https://knowledge.hubspot.com/reports/install-the-hubspot-tracking-code) gives the placement |
| `marketo-munchkin` | `munchkinId` | marketing | head | [Lead tracking](https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/javascriptapi/leadtracking/lead-tracking), the asynchronous embed verbatim |
| `plausible` | `scriptId` (`pa-…`, the per-site script since Oct 2025) or `domain` (older `data-domain` script), `host` (self-hosted) | necessary (no cookies) | head | [Script update guide](https://plausible.io/docs/script-update-guide) |
| `segment` | `writeKey` | analytics | head | [Analytics.js quickstart](https://www.twilio.com/docs/segment/connections/sources/catalog/libraries/website/javascript/quickstart), "Minified" snippet 5.2.1, verbatim |
| `hotjar` | `siteId` | analytics | head | The Hotjar Tracking Code (`hjsv: 6`); Hotjar's help centre refused our tools, and Hotjar is moving sites to the Contentsquare tag — check the code in your Hotjar account |
| `clarity` | `projectId` | analytics | head | The Clarity tracking code ([setup](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-setup) gives the placement; the code is shown in the project) |
| `intercom` | `appId`, `region` (`us`/`eu`/`au` → `api_base`) | preferences | body-end | [Installation](https://developers.intercom.com/installing-intercom/web/installation), for visitors who aren't signed in, verbatim |
| `custom` | `src` and/or `inline`, `attributes` | marketing | body-end | — |

All pages were read on 2026-11-23. Where a vendor shows the code only inside
its own dashboard (LinkedIn, HubSpot, Hotjar, Clarity), the snippet follows
the code those dashboards issue; compare it with yours once.
`test/fixtures/vendor-snippets.ts` holds each documented snippet and
`test/scripts.test.ts` checks the kit's output against it, whitespace aside.

GTM is catalogued as **analytics** so that, with a banner, the container
loads only after consent. A container that relies on Google's "advanced"
Consent Mode (the container loads first and each tag waits for its consent
signal) sets `"consent": "necessary"` and turns on `googleConsentMode`.

## Where and when a script loads

Every snippet goes into the page **inert** — `<script type="text/plain"
data-galley-script="gtm" data-consent="analytics" data-load="eager"
data-placement="head" data-src="…">` — so the browser does not run it. A small
inline runtime at the top of `<head>` (2.4 KB gzipped; one constant text per
site) turns a block into a real `<script>` in the same place when all three
hold:

1. its consent category is granted (`necessary` always is);
2. the page isn't in the editor's preview (unless `inPreview`);
3. its moment has come (`eager`: when its placement has been read; `idle`;
   `interaction`).

The parts of one snippet keep their order. `<noscript>` fallbacks (GTM's
frame, the Meta and LinkedIn images) are written only for scripts that need
no consent, because a page without JavaScript can't ask.

## Consent

`consent.mode`:

- **`none`**: everything enabled loads; no banner.
- **`banner`**: the built-in banner asks first. It is a small, non-modal
  region at the foot of the page with **Accept all**, **Reject all** (equally
  prominent) and **Choose…**, which shows the categories the site's scripts
  actually use (plus "Necessary — always on") and **Save choices**. The
  choice is kept in this site's `localStorage` (`galley:consent`,
  `{ v: 1, at, choice }`). Any element with `data-galley-consent-open` (a
  footer "Privacy choices" link) reopens it; Escape closes it once a choice
  exists; focus returns to the link. It shows only when some enabled script
  needs consent, or a form remembers UTM values (see below). Themed with `--galley-consent-bg`, `--galley-consent-text`,
  `--galley-consent-border`, `--galley-consent-radius`,
  `--galley-consent-shadow`, `--galley-consent-width`, `--galley-button-*`
  and `--galley-field-focus`; classes `.galley-consent__…`.
- **`external`**: another consent tool decides. The kit listens for:
  - `window.galleyConsent.set({ analytics: true, marketing: false, preferences: true })`
    — call it from your tool's callback (nothing is stored by the kit);
  - **Google Consent Mode** updates the tool pushes
    (`gtag('consent', 'update', …)`): `analytics_storage` → analytics,
    `ad_storage` → marketing, `functionality_storage`/`personalization_storage`
    → preferences. This is the one signal common to most consent tools;
  - **Cookiebot**'s documented events (`CookiebotOnConsentReady`,
    `CookiebotOnAccept`, `CookiebotOnDecline`) and `Cookiebot.consent`
    (`statistics` → analytics) — [Cookiebot developer docs](https://www.cookiebot.com/en/developer/).
  Other tools (OneTrust's configurable groups, IAB TCF purposes) map
  differently per site, so the kit doesn't guess: call `galleyConsent.set`
  from the tool's callback, e.g. OneTrust:
  `window.OptanonWrapper = () => galleyConsent.set({ analytics: OnetrustActiveGroups.includes("C0002"), marketing: OnetrustActiveGroups.includes("C0004"), preferences: OnetrustActiveGroups.includes("C0003") })` with your own group ids.

### UTM memory and consent

A form field with `autofill: { "from": "utm" }` reads campaign parameters the
visitor arrived with, remembered across pages in this site's own
`localStorage` (`docs/forms.md`). Under a consent mode that memory is kept
only once **marketing** is granted, and the built-in banner offers Marketing
whenever a form uses it — also on a site with no scripts at all.

Why consent, though the storage is first-party and nothing leaves the browser
until a form is sent: the ePrivacy rule (Art. 5(3) of Directive 2002/58/EC)
covers storing anything on the visitor's device, not only cookies — the EDPB
names local storage among the techniques it covers and says the rule applies
once the stored information is read back or leaves the device ([Guidelines
2/2023 on the technical scope of Art. 5(3), v2.0, adopted 7 October
2024](https://edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf),
§2.6 and §3.2, read 2026-11-23) — which a form submission does. The only exemption
for a website is storage *strictly necessary* for a service the visitor
explicitly asked for; the Article 29 Working Party's opinion on the
exemptions puts form-input and shopping-cart storage inside it and tracking
outside it: "tracking is very unlikely to meet CRITERION A or B" ([Opinion
04/2012, WP194](https://datenschutz.hessen.de/sites/datenschutz.hessen.de/files/2022-11/wp_194.pdf),
§2.4 and §3.1, read 2026-11-23). Remembering which campaign brought a visitor
serves the site's marketing attribution, not anything the visitor asked for,
so the kit treats it as marketing. The current page's own parameters are
still used without any storage. With `consent.mode: "none"` (a site that has
decided it needs no consent step) the memory is kept straight away, as
before. This is the kit's reading of the rules, not legal advice.

`consent.defaults` lists categories that are on before a choice (for regions
where that is lawful; the kit doesn't geolocate).

**Changing one's mind**: granting a category later loads its scripts at that
moment. Revoking stops anything new from loading, but **a script that already
ran can't be unloaded**; its cookies stay until they expire or the visitor
clears them. A reload after revoking gives a page without it.

`window.galleyConsent` also offers `granted(category)`, `get()`, `open()`,
`mode`, `preview`; a `galley:consent` event fires on `document` after every
change.

## Google Consent Mode v2

With `googleConsentMode: true`, the runtime — the first script in `<head>`,
before any Google tag can run — pushes the default state exactly as Google
documents it:

```js
gtag("consent", "default", {
  ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied",
  analytics_storage: "denied", functionality_storage: "denied",
  personalization_storage: "denied", security_storage: "granted",
  // mode "external" only: wait_for_update: 500
});
```

(categories in `defaults` start `granted`), then — on later pages — the
stored choice as `gtag("consent", "update", …)` straight away, and an
`update` after every choice. Mapping: analytics → `analytics_storage`;
marketing → `ad_storage`, `ad_user_data`, `ad_personalization`; preferences →
`functionality_storage`, `personalization_storage`; `security_storage` always
granted. Verified against [Set up consent mode on websites](https://developers.google.com/tag-platform/security/guides/consent) (2026-11-23): the default before any measurement command, `wait_for_update` for asynchronous banners, and persisting the choice and calling `update` on later pages.

The real-build test checks the order: with the banner up, no request reaches
Google; after "Accept all", each Google tag finds `default` (denied) then
`update` (granted) already in the `dataLayer` when it runs.

## Development and the editor's preview

- **`astro dev`**: only entries with `inPreview: true` are written. The
  runtime and the banner are still there, so the banner can be styled; no
  third-party request is made.
- **The editor's preview** (the site's dev server or the deployed site, shown
  through Galley's proxy in a frame): nothing loads and no banner shows,
  unless `inPreview`. The runtime takes the page to be in the preview when
  - the frame's `name` starts with `galley-preview` — the app names every
    frame it shows a site in: `galley-preview` (the proposed page),
    `galley-preview-live` (the live-site comparison), and in Proof
    `galley-preview-proof` and `galley-preview-proof-live`, or
  - `window.__galleyPreview === true` / `<html data-galley-preview>` — the
    app's preview proxy adds the attribute to every page it serves from the
    site's dev server, before any script runs, or
  - the page is framed and served from another host than the site's `site`
    address (true of every page the proxy serves today).
  The overlay's own tag is injected before `</head>`, after the runtime has
  run, so it can't serve as the signal.
- The forms runtime's hidden post frames (`galley-post-…`) count as preview
  too, so a page loaded inside one never runs the site's tags.
- That is all that differs there: forms, the email-link dialog, UTM memory
  under its consent rules and the agent-readable output
  (`docs/ai-first-output.md`) behave as on the published site — except that a
  form sends to the address in `<html data-galley-endpoint>` (the app's own
  inbox) ahead of the site-wide one (`docs/forms.md`). The markdown twins are
  made from the page's main content, so the preview's `data-galley-preview` /
  `data-galley-endpoint` attributes and the overlay script never change them.
  `test/kit-fixes.test.ts` sets each documented signal in turn and checks
  this.

## What the build says

`astro build` logs one line per script:

```
[@galleycms/astro] scripts: 3 of 4 enabled · the built-in consent banner · Google Consent Mode v2
[@galleycms/astro]   ✓ gtm · Google Tag Manager GTM-AB12CDE3 · head, eager · after analytics consent · every page
[@galleycms/astro]   ✓ ga · Google Analytics 4 G-TEST12345 · head, idle · after analytics consent · every page
[@galleycms/astro]   ✓ chat · Custom script · body-end, eager · after preferences consent · only /pricing/
[@galleycms/astro]   – off · off
```

In `astro dev`, `GET /__galley/scripts.json?path=/pricing/` answers what a
page would load in production — `{ file, exists, path, consent, scripts: [{
id, kind, label, enabled, consent, placement, load, inPreview, loadsOnPage,
reason, inDev }] }` — for the app's "what loads on this page".

## Content Security Policy

Everything the kit writes inline is constant per site, so a hash-based CSP
works:

- the runtime (`<script data-galley-scripts="head">`), the three
  `galleyScripts.run("…")` calls, the email-link dialog, and each `inline`
  snippet the runtime activates — hash each once (the texts change only when
  `scripts.json` or the kit changes);
- the vendors' own hosts in `script-src`/`connect-src`/`img-src`/`frame-src`
  (Google Tag Manager also needs whatever its tags load);
- the form CSS and banner CSS are inline `<style>` elements (`style-src` hash
  or `'unsafe-inline'`); the email dialog adds one `<style>` when first
  opened.

`'strict-dynamic'` alone is not enough for the inline vendor snippets, which
the runtime inserts as inline scripts.

## Adding an integration

Add its `ScriptIntegrationInfo` (kind, name, settings with patterns, default
consent and placement, docs address) to `packages/core/src/kit-catalog.ts`,
run `node packages/astro/scripts/sync-contract.mjs`, write its builder in
`packages/astro/src/scripts/snippets.js` from the vendor's current snippet
(ids substituted, nothing else), and add the documented snippet to
`test/fixtures/vendor-snippets.ts`. Until then, any script can be added as
`custom`.
