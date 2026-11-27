# @galleycms/astro

The site kit for [Galley](https://galley.fictiontribe.com), the open-source
AI CMS for static sites, as an Astro integration. It turns the site's own
content files into working site features:

- **Forms** — `src/content/forms/contact.json` + `<Form id="contact" />`: a
  server-rendered, accessible, progressively enhanced form that sends to the
  Galley inbox, HubSpot, Marketo, Salesforce Web-to-Lead, Account Engagement
  (Pardot), any webhook, or the visitor's mail program — with conditions,
  steps, UTM attribution, spam checks and after-submit actions.
- **Third-party scripts** — `src/data/scripts.json`: Google Tag Manager, GA4,
  Meta Pixel, LinkedIn Insight, HubSpot, Marketo Munchkin, Plausible,
  Segment, Hotjar, Clarity, Intercom or any script, written from each
  vendor's snippet, loaded when and where you say, only after consent (with a
  built-in banner or another consent tool, and Google Consent Mode v2), and
  never in development or the editor's preview. No template changes.
- **Email links** — every `mailto:` link offers Gmail, Outlook, the
  visitor's mail app or copying the address.
- **An agent-readable version of the site** — `src/data/visibility.json`
  (optional): a clean markdown copy of every page (`/about/` → `/about.md`)
  made from the rendered page, `/llms.txt`, `/llms-full.txt`, `/agent.md`,
  JSON-LD where the page's own facts allow it, and `robots.txt` (with a
  per-crawler AI policy) and `sitemap.xml` when the site has none of its own.
  No JavaScript; the same addresses answer in `astro dev`.
- **Dev Toolbar app** — in `astro dev`, says whether Galley is running and
  opens the current page in it.

Because forms and the scripts setup are plain files in the repository,
they are edited by Galley's form builder and scripts screen, by its
assistant, over MCP or by hand, show up in Proof, and publish like any change.

> **Not published yet.** The package is `private` in the Galley repository.
> Until it is, sites use it [vendored](#vendoring-without-the-package).

Guides: [`docs/forms.md`](../../docs/forms.md) · [`docs/scripts.md`](../../docs/scripts.md) · [`docs/mailto.md`](../../docs/mailto.md) · [`docs/ai-first-output.md`](../../docs/ai-first-output.md)

## Install

```sh
npx astro add @galleycms/astro
```

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import galley from "@galleycms/astro";

export default defineConfig({
  integrations: [galley({ forms: { endpoint: "https://cms.example.com/f/site_abc123" } })],
});
```

```ts
// src/content.config.ts
import { formSchema } from "@galleycms/astro/schema";

export const collections = {
  forms: defineCollection({ loader: glob({ pattern: "*.json", base: "./src/content/forms" }), schema: formSchema }),
};
```

```astro
---
import { Form } from "@galleycms/astro/components";
---
<Form id="contact" submitClass="button" />
```

## Options

| Option | Default | |
| --- | --- | --- |
| `url` | `GALLEY_URL`, else `http://127.0.0.1:4400` | Where the Dev Toolbar app looks for Galley. |
| `toolbar` | `true` | The Dev Toolbar app (`astro dev` only). |
| `forms` | on | `{ collection, dir, endpoint, allowFormScripts, messages, freeEmailDomains }`, or `false`. |
| `scripts` | on | `{ file: "src/data/scripts.json", inject: true }`, or `false`. |
| `mailto` | on | `{ options, strings }`, or `false`. |
| `visibility` | on | `{ file: "src/data/visibility.json" }`, or `false`. |

## What it adds, and when

| | `astro dev` | `astro build` |
| --- | --- | --- |
| Dev Toolbar app, `GET /__galley/status` | yes | — |
| `GET /__galley/scripts.json?path=…` (what a page loads) | yes | — |
| Managed scripts and the consent banner | runtime and banner only; scripts with `inPreview` | every page, per `include`/`exclude` |
| Email-link dialog | pages with an email link | pages with an email link |
| Forms | where you put `<Form>` | where you put `<Form>` |
| Markdown twins, `llms.txt`, `llms-full.txt`, `agent.md` | answered on request | written after the build |
| `<link rel="alternate" type="text/markdown">` and JSON-LD in `<head>` | added to each page as served | added to each built page |
| `robots.txt`, `sitemap.xml` (only when the site has none) | answered on request | written after the build |

With no forms, no scripts file, `mailto: false` and `visibility: false`, the
build output is byte-identical with and without the integration (tested on
the starter in `test/astro.test.ts`).

## Exports

| | |
| --- | --- |
| `@galleycms/astro` | the integration, `galley(options)` |
| `@galleycms/astro/components` | `Form`, `Scripts`, `ConsentBanner` |
| `@galleycms/astro/schema` | `formSchema`, `scriptsSchema` (zod, from `astro/zod`) |
| `@galleycms/astro/catalog` | `scriptIntegrations`, `formProviders`, `aiCrawlers` (each AI crawler's token, what it is for — training, search, fetching for a person — and what blocking it does) — JSON-able, for an app to list |
| `@galleycms/astro/client` | `registerFormProvider(id, submitter)`, `initForms()` |
| `@galleycms/astro/kit` | the contract's types (`FormDefinition`, `ScriptsConfig`, …) |
| `@galleycms/astro/forms.css` | the form CSS, for sites that bundle it themselves (`<Form unstyled />`) |

## Size

| | min | gzip |
| --- | --- | --- |
| Forms runtime (one module for all forms on a page) | 13.7 KB | 5.7 KB |
| Each provider, loaded only when a form uses it | 0.6–2.6 KB | 0.4–1.3 KB |
| Form CSS (inline, once per page with a form) | 5.9 KB | 1.6 KB |
| Scripts runtime (inline in `<head>`, pages with managed scripts) | 5.9 KB | 2.4 KB |
| Email-link dialog (inline, pages with an email link) | 6.4 KB | 2.6 KB |
| Agent-readable output | 0 KB of JavaScript | — |

`node scripts/size.mjs` prints the current figures. The browser code is
dependency-free ES2020 (every evergreen browser since 2022: modules, `fetch`,
`URL`, `CustomEvent`, `:focus-visible`, `@media (scripting)`); no `eval`
except the opt-in `script` action.

## Vendoring without the package

```sh
node packages/astro/scripts/vendor.mjs path/to/site
```

copies the components, the browser runtime, the schemas, the CSS and the
agent-readable output's build step into `src/galley/` as plain files that
depend on nothing but Astro, each headed with the kit version it came from.
The output is byte-stable; running it again replaces the kit files and keeps
`src/galley/settings.json` (the site's forms and email-link settings). The
site then adds the forms collection with `import { formSchema } from
"./galley/schema.js"`, the three `<Scripts placement="…" />` in its layout,
and, for the agent-readable output, `import galley from
"./src/galley/integration.js"` with `integrations: [galley()]` in
`astro.config` (see the guides).

## Verified against (2026-11-23)

Forms: HubSpot — [Submit data to a form (unauthenticated)](https://developers.hubspot.com/docs/api-reference/legacy/marketing/forms/v3-legacy/submit-data-unauthenticated);
Marketo — [Forms API Reference](https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/javascriptapi/forms-api-reference), [Forms 2.0 examples](https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/javascriptapi/examples);
Salesforce Web-to-Lead — Salesforce Help is script-rendered and couldn't be read; servlet and fields checked against [Act-On's guide](https://connect.act-on.com/hc/en-us/articles/360023938733) and [a published implementation](https://gist.github.com/johndturn/cb88bd0571ea413955e0cd59244ce0ad);
Account Engagement — [Form Handler object](https://developer.salesforce.com/docs/marketing/pardot/guide/form-handler-v5.html);
Cloudflare Turnstile — [Client-side rendering](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/).

Scripts: [GTM install](https://support.google.com/tagmanager/answer/14847097),
[Google tag install](https://developers.google.com/tag-platform/gtagjs/install) and [configure](https://developers.google.com/tag-platform/gtagjs/configure),
[Consent mode](https://developers.google.com/tag-platform/security/guides/consent),
[Meta Pixel](https://developers.facebook.com/docs/meta-pixel/get-started),
[LinkedIn Insight Tag](https://www.linkedin.com/help/lms/answer/a418880) (placement; code from Campaign Manager),
[HubSpot tracking code](https://knowledge.hubspot.com/reports/install-the-hubspot-tracking-code) (placement),
[Marketo Munchkin](https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/javascriptapi/leadtracking/lead-tracking),
[Plausible](https://plausible.io/docs/script-update-guide),
[Segment](https://www.twilio.com/docs/segment/connections/sources/catalog/libraries/website/javascript/quickstart),
[Clarity](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-setup) (placement),
[Intercom](https://developers.intercom.com/installing-intercom/web/installation),
[Cookiebot](https://www.cookiebot.com/en/developer/). Hotjar's help centre
refused our tools; its snippet is the classic tracking code.

Email links: Gmail's and Outlook's compose addresses are not documented by
Google or Microsoft — see [`docs/mailto.md`](../../docs/mailto.md).

Agent-readable output: [llms.txt v2](https://llmstxt.org/), the
[sitemaps protocol](https://www.sitemaps.org/protocol.html),
[RFC 9309](https://www.rfc-editor.org/rfc/rfc9309), Google's
[site names](https://developers.google.com/search/docs/appearance/site-names),
[Organization](https://developers.google.com/search/docs/appearance/structured-data/organization),
[Article](https://developers.google.com/search/docs/appearance/structured-data/article) and
[Breadcrumb](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb)
documentation, and each AI crawler's own page — listed with what each says in
[`docs/ai-first-output.md`](../../docs/ai-first-output.md).

## Development

```sh
pnpm --filter @galleycms/astro typecheck
pnpm --filter @galleycms/astro test
node scripts/sync-contract.mjs     # after packages/core/src/kit.ts or kit-catalog.ts change
node scripts/build-inline.mjs      # after src/scripts/runtime.js or src/mailto/runtime.js change
E2E_MODULES=/path/to/node_modules/ node test/e2e/run.mjs   # real build + Chromium (playwright-core, axe-core)
```

The package ships its JavaScript source as is (JSDoc-typed, checked by
`tsc --checkJs` in strict mode); the two inline runtimes are minified into
committed `*.gen.js` files, and the contract is mirrored into `src/kit.d.ts`
and `src/catalog-data.js` — tests fail when any of them is stale.

## Publishing (for maintainers)

1. Set `version` (also `KIT_VERSION` in `src/client/forms.js`) and run `node build.mjs`.
2. Make sure the `@galleycms` scope on npm belongs to the project.
3. Publish from `dist/` (`npm publish --access public` from `packages/astro/dist`, or let `.github/workflows/release.yml` publish it on a version tag).

Astro's integrations catalogue picks it up from npm through the
`astro-integration` keyword (`withastro`, `dev-toolbar`, `forms`,
`analytics` and `cms` file it further).

## Requirements

Astro 7 (tested with 7.4). Node 20.11 or newer — Astro 7 itself needs 22.

## Licence

Apache-2.0. Galley is made by Fiction Tribe. Astro is a trademark of its
respective owner; Galley is an independent project, built for Astro, and is
not affiliated with or endorsed by the Astro project. Other product names are
trademarks of their owners and are used here only to say what the kit works
with.
