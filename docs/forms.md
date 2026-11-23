# Forms

A form on a Galley site is **one JSON file** in the site's repository —
`src/content/forms/contact.json` — and one line where it appears:

```astro
---
import { Form } from "@galley/astro/components";
---
<Form id="contact" />
```

Because the form is just a content file, it is edited by the app's form
builder, by the assistant, over MCP or by hand; it shows up in Proof and is
published like any other change. This guide is for site developers and for
whoever builds the app's form builder. The file format is the contract in
`packages/core/src/kit.ts` (`FormDefinition`); the runtime that renders and
sends it is `@galley/astro` (`packages/astro`).

- [Setting up a site](#setting-up-a-site)
- [The file, annotated](#the-file-annotated)
- [Fields](#fields)
- [Destinations](#destinations) — [Galley inbox](#galley-the-capture-endpoint) · [HubSpot](#hubspot) · [Marketo](#marketo) · [Salesforce](#salesforce-web-to-lead) · [Account Engagement](#account-engagement-pardot) · [Webhook](#webhook) · [Mail program](#mailto)
- [After submission](#after-submission)
- [Without JavaScript](#without-javascript)
- [Styling](#styling)
- [Accessibility](#accessibility)
- [Spam](#spam)
- [Attribution fields](#attribution-fields-utm-memory)
- [The capture endpoint](#the-capture-endpoint) (the contract the server implements)
- [Adding a provider](#adding-a-provider)
- [Wording](#wording)
- [What a static page cannot do](#what-a-static-page-cannot-do)

## Setting up a site

**Set it up for me.** On an Astro site without the kit, the app's Forms and
Scripts screens offer one button that does the set-up below as ordinary
pending changes — check them in Proof, Discard any or all of them, publish
like any edit. It needs build mode to be allowed on the site (it changes
code), and does each step only when it is still needed:

1. the kit's files into `src/galley/` — exactly what `scripts/vendor.mjs`
   writes. A new `settings.json` gets `forms.endpoint` = this app's capture
   address **only when visitors' browsers can reach it** (hosted, public);
   an address on this computer or a private network is never written into a
   file that is published (an existing `settings.json` is kept);
2. `src/content/forms/contact.json`, a first "Contact" form sending to the inbox;
3. `src/data/scripts.json`: no scripts, the built-in banner, Google Consent Mode;
4. the `forms` collection in `src/content.config.ts` — **only** when the file
   exports `export const collections = { … }` as a plain object (a
   one-line list gets `const forms = defineCollection({…})` above it and
   `forms` added; a multi-line object gets a first `forms: …` line). The
   import of `formSchema` goes after the last import. Nothing else changes;
5. the three `<Scripts placement="…" />` in the layout — **only** when exactly
   one `.astro` file under `src/` writes its own `<html>`, `<head>` and
   `<body>`: after `<meta charset>` (else `<head>`), after `<body>`, before
   `</body>`, with the import in its frontmatter;
6. the version AI assistants can read (`docs/ai-first-output.md`): the kit's
   build step in `astro.config.*` — `import galley from
   "./src/galley/integration.js";` after the last import and `galley()` first
   in `integrations: [ … ]`, or a new `integrations: [galley()],` when there is
   none — **only** when the file is `export default defineConfig({ … })` (or a
   plain exported object) written as a literal; and `src/data/visibility.json`
   with the starters' defaults (structured data for articles only on the
   collections this site shows as dated posts with pages; its privacy and
   terms pages as secondary in `llms.txt`), when the site has none.

When 4, 5 or 6 isn't that clear-cut (integrations built with code, settings
spread in, the name `galley` taken) set-up does the rest and lists what is
left, as below. A site that got the kit before step 6 existed sees one quiet
line under its forms list — "Also publish a version AI assistants can read"
— which runs step 6 alone (`POST /api/sites/:siteId/kit/visibility`),
updating the kit's files if they predate it.

When 4 or 5 isn't that clear-cut (collections built with code or spread in,
a name already taken, several layouts, a second `<head>`), set-up doesn't
guess: it does the rest and the screen lists exactly what is left, with
**Ask the assistant to finish it** (opens the assistant in build mode with a
request naming the file and the lines) or the lines for a developer. A site
on another framework is told the kit is for Astro sites today, with a link to
the adapter guide. When the site's packages are installed, set-up then builds
the site once and says whether it still builds.

The kit's files travel inside the app: the CLI bundle embeds them (as it
embeds the overlay script), so the npm CLI, the desktop app's sidecar and the
Docker image all have them; run from the repository, the engine reads them
from `packages/astro` in place. `GET /api/sites/:siteId/kit` says what a site
has and what set-up would do; `POST /api/sites/:siteId/kit/setup` runs it as
a job.

**With the integration** (`npx astro add @galley/astro`):

```ts
// src/content.config.ts — three lines
import { formSchema } from "@galley/astro/schema";

export const collections = {
  forms: defineCollection({ loader: glob({ pattern: "*.json", base: "./src/content/forms" }), schema: formSchema }),
  // …the site's other collections
};
```

```js
// astro.config.mjs
integrations: [galley({ forms: { endpoint: "https://cms.example.com/f/site_abc123" } })],
```

`forms.endpoint` is the site's **capture address** (the Galley inbox). The app
shows it under the site's form settings (`captureAddress` on
`GET /api/sites/:siteId/capture`, see `docs/form-capture.md`). A single form
can override it with `settings.endpoint` on its `galley` destination, and a
page can set `<html data-galley-endpoint="…">`. In the browser the address is
chosen in that order: the destination's own `settings.endpoint`, then the
page's `data-galley-endpoint`, then the site-wide address — so the preview's
address (below) wins over the site-wide one, and a published page, which never
carries the attribute unless the site sets it, uses the site-wide one.

When a form sends to the inbox and no address is set anywhere, the build says
so **once** (not once per form):
`The form “contact” sends to the Galley inbox, but no capture address is set:
put the inbox address in forms.endpoint (src/galley/settings.json for a
vendored kit, or the integration's options), or in the destination's
settings.endpoint. Galley's preview supplies its own address; on the live
site the form will say it isn't connected yet.`

**In the app's preview** none of this is needed: the preview proxy adds
`data-galley-endpoint="<this app's capture address>"` (and
`data-galley-preview`) to every previewed page's `<html>` that doesn't say
otherwise, so a form tried in the preview reaches this app's inbox — kept as
a test — with nothing in the site's files.

**For the live site**, while a form sends to the inbox and `forms.endpoint`
is empty, the Forms screen asks "Where should the live site send
submissions?": when this app is reachable from the internet it offers its
address and writes it into `src/galley/settings.json` as a pending change
(`POST /api/sites/:siteId/kit/endpoint`, which takes no address from the
request); on a computer of one's own it says visitors can't reach the inbox
and that the choices are a hosted app or another destination.

Other options: `forms.collection` (default `"forms"`), `forms.dir` (default
`"src/content/forms"`), `forms.allowFormScripts` (default `false`, see
[script actions](#script)), `forms.messages` (site-wide wording),
`forms.freeEmailDomains` (extra domains `businessEmailOnly` refuses).

**Without the integration** (vendored, which is how the starters ship today):

```sh
node packages/astro/scripts/vendor.mjs path/to/site
```

copies the kit into `src/galley/` as plain files and creates
`src/galley/settings.json` for the options above (`forms.endpoint` and the
rest; it is kept when the script runs again). Then:

```ts
// src/content.config.ts
import { formSchema } from "./galley/schema.js";
// forms: defineCollection({ loader: glob({ pattern: "*.json", base: "./src/content/forms" }), schema: formSchema }),
```

```astro
---
import { Form, Scripts } from "../galley/components/index.js";
---
<Form id="contact" />
```

and the three `<Scripts />` placements in the layout (see `docs/scripts.md`).

### `<Form>` props and slots

| Prop | |
| --- | --- |
| `id` | The form's file name in the collection. |
| `definition` | A `FormDefinition` to render instead (validated with `formSchema`). |
| `collection` | Look in another collection. |
| `endpoint` | Capture address for this form only. |
| `class` | Extra classes on the `<form>`. |
| `submitClass` | Extra classes on the submit and next buttons — use the site's own (`"button"`). |
| `backClass` | Extra classes on a multi-step form's back button. |
| `headingLevel` | Level of `heading` fields, 2–6 (default 3). |
| `unstyled` | Emit no CSS at all. |

Slots: `before` (top of the form), `after` (below the button), `submit` (your
own button — keep `type="submit"`), `success` (your own thank-you; elements
with `data-galley-value="fieldId"` are filled with the answer).

## The file, annotated

Comments are not allowed in JSON; they are here to explain.

```jsonc
{
  "name": "Request a demo",                 // the form's accessible name; shown in the app
  "description": "Thirty minutes, no slides.", // optional, shown above the fields
  "submitLabel": "Request a demo",
  "steps": [                                // optional; absent = one step
    { "title": "About you", "nextLabel": "Continue" },
    { "title": "Your company" }
  ],
  "fields": [
    { "id": "first_name", "type": "text", "label": "First name", "required": true, "width": "half" },
    { "id": "last_name",  "type": "text", "label": "Last name",  "required": true, "width": "half" },
    { "id": "email", "type": "email", "label": "Work email", "required": true,
      "validation": { "businessEmailOnly": true } },
    { "id": "company", "type": "text", "label": "Company", "step": 1 },
    { "id": "size", "type": "radio", "label": "Number of sites", "step": 1,
      "options": [{ "value": "1-9", "label": "1–9" }, { "value": "10+", "label": "10 or more" }] },
    { "id": "other", "type": "text", "label": "Tell us more", "step": 1,
      "showWhen": { "field": "size", "equals": "10+" } },  // shown (and sent) only then
    { "id": "consent", "type": "consent", "required": true, "step": 1,
      "text": "I agree to the [privacy policy](/privacy/)." },
    { "id": "campaign", "type": "hidden", "autofill": { "from": "utm", "key": "utm_campaign", "touch": "first" } }
  ],
  "destinations": [                         // every one receives it; the first decides success
    { "provider": "hubspot",
      "settings": { "portalId": "12345678", "formId": "0f8fad5b-d9cb-469f-a165-70867728950e" },
      "mapping": { "first_name": "firstname", "last_name": "lastname", "consent": "consent:process" },
      "constants": { "lifecyclestage": "lead" } },
    { "provider": "galley", "settings": {} },
    { "provider": "webhook", "settings": { "url": "https://hooks.example.com/sales" },
      "when": { "field": "size", "equals": "10+" } }      // only big accounts
  ],
  "afterSubmit": [                          // run in order (a redirect always last)
    { "type": "event", "name": "generate_lead", "params": { "size": "{{size}}" } },
    { "type": "message", "title": "Thanks, {{first_name}}", "text": "We'll write to **{{email}}**." },
    { "type": "redirect", "url": "/thanks/", "passFields": ["email"], "delaySeconds": 3 }
  ],
  "errorMessage": "Your request couldn't be sent. Your answers are still here.",
  "messages": { "next": "Continue" },       // wording overrides for this form
  "spam": { "honeypot": true, "minSeconds": 3, "turnstileSiteKey": "0x4AAAAAAA…" },
  "appearance": { "layout": "stacked", "size": "regular", "labels": "above" }
}
```

The schema (`formSchema`) refuses, with a plain message and the path, what a
type can't: two fields with one id, a choice without options, a condition or
mapping naming a field that doesn't exist, a step past the last, a pattern a
browser can't compile, and a provider setting that doesn't look like the
provider's (a HubSpot form id that isn't a GUID, a Munchkin id that isn't
`123-ABC-456`). Unknown keys are dropped, not refused, so a newer app can add
keys before the kit knows them.

## Fields

| `type` | Renders | Value sent |
| --- | --- | --- |
| `text` `email` `tel` `url` `number` `date` | `<input>` of that type, with `required`, `minlength`, `maxlength`, `min`, `max`, `pattern` and an `autocomplete` hint guessed from the id (`email`, `first_name` → `given-name`, `company` → `organization`, …) | the text |
| `textarea` | `<textarea rows="5">` | the text |
| `select` | `<select>` with a first empty option (`placeholder`, else "Choose one") | the option's `value` |
| `radio` | a `<fieldset>` with a `<legend>` and one radio per option | the chosen `value` |
| `checkboxes` | a `<fieldset>` with one box per option | a list of values |
| `checkbox` | one box with its label | `"true"` / `"false"` |
| `consent` | one box whose label is `text` (inline Markdown, links allowed) | `"true"` / `"false"` |
| `hidden` | `<input type="hidden">` | `defaultValue` or its `autofill` |
| `heading` | `<h3>` (see `headingLevel`) | — never sent |
| `paragraph` | paragraphs of inline Markdown | — never sent |

- **`width: "half"`**: two half fields sit side by side from 36rem wide.
- **`showWhen`**: `{ field, equals }`, `{ field, notEquals }`, `{ field, in: [] }`,
  or `{ field }` (has any answer). A field whose condition fails is hidden,
  disabled, not validated and **not sent**; a field depending on a hidden
  field is hidden too. For a `checkbox`/`consent` controller, a ticked box
  reads as `"yes"` — the same as the capture server and the app's builder.
  Without JavaScript every field shows (so every answer can be given); with
  JavaScript, fields that start hidden are hidden from the first paint
  (`@media (scripting: enabled)`), so nothing jumps.
- **Steps**: fields carry `step` (0-based). Each step is a `<fieldset>` titled by
  its `title`; Next checks that step before moving on, Back keeps every
  answer, a "Step 2 of 3" line updates, focus moves to the step's title, and
  Enter on an earlier step means Next. Without JavaScript all steps show as
  one long form.
- **`autofill`**: `query` (`key` = the parameter), `utm` (see
  [attribution](#attribution-fields-utm-memory)), `referrer`, `page-url`,
  `page-title`, `cookie` (`key` = the cookie name). Hidden fields are always
  filled; visible fields only when empty.
- **`validation`**: `pattern` (whole value, like HTML), `minLength`,
  `maxLength`, `min`, `max`, `businessEmailOnly` (refuses the free mailboxes
  in `packages/astro/src/forms/free-email-domains.js` — 51 domains, the single
  source; the capture server's and the form builder's `FREE_MAILBOXES` is
  one copy in `@galley/core/forms/shared`, kept identical by a test), and
  `message` (replaces every refusal message for that field).
- **Patterns on the server.** The capture endpoint runs `pattern` on text
  anyone can post, so it guards it (no native dependency, no time limit to
  lean on): a pattern with a repeated part inside a repeated part (`(a+)+`,
  unless every pass must end, or start, with a character the rest of it
  can't contain, like `([a-z0-9-]+\.)+`), with alternatives that can start
  alike or match nothing under a repetition (`(a|ab)*`), with three or more
  unbounded repetitions in a row that could take the same character
  (`\w+\w+\w+`), or with a back-reference is **not run** on the server,
  and Proof reports it on the form: "This pattern could be slow enough to
  stall the site's form; simplify it." Answers over 2,000 characters aren't
  checked against a pattern on the server. Either way the visitor is never
  refused for it; the page's own check in the browser runs as before. The
  rule is in `packages/core/src/forms/shared.ts`.

## Destinations

Every destination whose `when` holds receives the submission. **The first one
decides success** — its answer is what the visitor sees; the others get a few
seconds to finish and their failures are reported in the
`galley:form:success` event, not to the visitor. Each destination gets its
own payload: a field is sent under `mapping[fieldId]`, else the field's
`name`, else its `id`; `constants` are added as they are.

A destination with **`settings.serverSide: true`** is not sent by the page at
all: the capture server forwards it after storing the submission (so it can
hold secrets — `docs/form-capture.md`, "Forwarding"). The page never contains
its settings. Such a form needs a `galley` destination.

Each provider's code is its own small file, loaded only when a form on the
page uses it (warmed in idle time after the page loads):

| Provider | Minified | gzip |
| --- | --- | --- |
| core (every form) | 13.7 KB | 5.7 KB |
| `galley` | 1.5 KB | 0.8 KB |
| `hubspot` | 2.6 KB | 1.3 KB |
| `marketo` | 2.2 KB | 1.1 KB |
| `salesforce` (+ shared frame helper 0.6 KB) | 0.9 KB | 0.6 KB |
| `pardot` (+ shared frame helper) | 1.2 KB | 0.6 KB |
| `webhook` | 0.9 KB | 0.6 KB |
| `mailto` | 0.6 KB | 0.4 KB |

(`node packages/astro/scripts/size.mjs` measures them.) The form CSS is
inlined once per page that has a form: 5.9 KB, 1.6 KB gzipped.

### `galley` (the capture endpoint)

The default. Settings: `endpoint` (optional; else the site's capture address).
Sends JSON to the capture endpoint — [the contract](#the-capture-endpoint) is
below. The server checks the answers again, stores them, sends alerts and
forwards to server-side destinations. It can report field errors, so they
appear on the right fields; on 429 the visitor is told how long to wait.

### HubSpot

**Copy from HubSpot**: the Hub ID (account menu), the form's GUID (the form's
address in HubSpot), and the data region if the account isn't in North
America (`eu1`, …).

**What is sent**: `POST https://api.hsforms.com/submissions/v3/integration/submit/{portalId}/{formId}`
(`https://api-{region}.hsforms.com` outside `na1`), JSON:

```json
{
  "submittedAt": "1763900000000",
  "fields": [{ "objectTypeId": "0-1", "name": "email", "value": "kim@example.com" }],
  "context": { "hutk": "<hubspotutk cookie>", "pageUri": "https://www.example.com/demo/", "pageName": "Book a demo" },
  "legalConsentOptions": { "consent": { "consentToProcess": true, "text": "I agree…", "communications": [{ "value": true, "subscriptionTypeId": 999, "text": "Send me…" }] } }
}
```

- `mapping` values name HubSpot properties. `"0-2/name"` sends to another
  object (here the company's name). Multiple choices are joined with `;`.
- **Consent fields**: map one to `"consent:process"` (consent to process; an
  unmapped consent field counts as this) and others to
  `"consent:communication:<subscriptionTypeId>"`. The consent text sent is the
  field's text without its Markdown.
- `hutk` is sent only when the HubSpot tracking code has set the
  `hubspotutk` cookie (it is consent-gated with the rest of the scripts).
- The HubSpot form must exist with these field names; HubSpot validates and
  answers `400 { errors: [{ message, errorType }] }` — messages naming a field
  (`fields.email`) are shown on it. 429 is shown as "too many tries".
- **Cannot be done from the page**: the authenticated (`/secure/submit`)
  endpoint, which needs a private app token. The unauthenticated endpoint is
  HubSpot's documented browser path (CORS-enabled) and is rate limited by
  HubSpot. No form post without JavaScript.

Verified against: [Submit data to a form (unauthenticated)](https://developers.hubspot.com/docs/api-reference/legacy/marketing/forms/v3-legacy/submit-data-unauthenticated) (2026-11-23). The regional `api-eu1` host is from HubSpot's community forum, not the reference page.

### Marketo

**Copy from Marketo**: the Munchkin ID (`123-ABC-456`), the form's ID (the
number in its embed code) and the address the embed code loads from (a
landing-page domain or `https://app-xx.marketo.com`).

**What happens**: Marketo doesn't support posting to its form endpoint
directly, so the kit goes through **Marketo's own Forms 2.0 library**, as
Adobe documents it: it loads `{host}/js/forms2/js/forms2.min.js` (only when a
Marketo form is sent from the page, never before), adds a hidden
`<form id="mktoForm_{formId}">`, calls
`MktoForms2.loadForm(host, munchkinId, formId)`, puts the answers on it —
`setValues` for fields the Marketo form has, `addHiddenFields` for the rest
(the only way values reach a form showing "known visitor" HTML) — registers
`onSuccess(() => false)` so Marketo doesn't navigate, and calls `submit()`.
Marketo's own validation, anti-spam and Munchkin cookie association
(`_mkto_trk`) all run as they would on a Marketo form. If Marketo refuses a
value, its message (`.mktoErrorMsg`) is shown on our field of that name.
Marketo's follow-up URL is reported in the success event; the form's own
`afterSubmit` decides what the visitor sees.

- Mapping values are Marketo field names (`Email`, `FirstName`, custom API
  names). Multiple choices are joined with `;`.
- **Cannot be done**: anything without Marketo's script — no form post
  without JavaScript, and the page must be allowed to load Marketo's script
  (CSP).

Verified against: [Forms API Reference](https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/javascriptapi/forms-api-reference), [Forms 2.0 examples](https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/javascriptapi/examples) (2026-11-23); the hidden-form pattern and the known-visitor note from [Adobe's community](https://experienceleaguecommunities.adobe.com/adobe-marketo-engage-27/marketo-hidden-form-submission-from-non-marketo-form-182471).

### Salesforce (Web-to-Lead)

**Copy from Salesforce** (Setup › Web-to-Lead › Create Web-to-Lead form): the
organization ID (`oid`, `00D…`), the field names of standard lead fields
(`first_name`, `last_name`, `email`, `company`, `phone`, `lead_source`, …) and
the ids of custom fields (`00N…`) — they go in `mapping`. Fixed values
(`lead_source`, `Campaign_ID`, `member_status`, `recordType`, `debug`,
`debugEmail`) go in `constants`.

**What is sent**: a real form post, UTF-8, to
`https://webto.salesforce.com/servlet/servlet.WebToLead?encoding=UTF-8` with
`oid`, the mapped fields (a ticked box as `1`, an unticked box left out, a
multi-choice as repeated fields) and the constants.

- `mode: "frame"` (default): posted into a hidden frame; the visitor stays on
  the page. Without `returnUrl` Salesforce answers with an empty page — the
  lightest end to the post. **The page cannot know whether a lead was
  created**: Salesforce sends no CORS headers and answers the same way for a
  duplicate, a bad picklist value or the daily limit. The kit treats the
  completed post as success and says so in the success event's `detail`.
- `mode: "navigate"`: a normal post; Salesforce sends the visitor to
  `returnUrl` (else this page). Other destinations, `event` and `webhook`
  actions run first; `message` and `redirect` are skipped (the return page is
  the thank-you).
- Works without JavaScript when it is the first destination (with `retURL` =
  `returnUrl`, else this page's `#galley-sent-<form>`).
- **Limits and gotchas**: Salesforce documents a daily limit on Web-to-Lead
  (commonly cited as 500 per 24 hours; overflow is queued); date fields must
  use the org's locale format; the `oid` is public in any Web-to-Lead form.
  Salesforce's **"Require reCAPTCHA"** option is not supported by the kit:
  turn it off and protect the form with the [spam checks](#spam), or send to
  the Galley inbox and forward server-side.

Verified against: Salesforce Help's Web-to-Lead pages are script-rendered and
could not be read by our tools (2026-11-23); the servlet address and `oid`
were checked against [Act-On's integration guide](https://connect.act-on.com/hc/en-us/articles/360023938733), the opaque-response behaviour and date format against [a published implementation](https://gist.github.com/johndturn/cb88bd0571ea413955e0cd59244ce0ad). Check the daily limit and reCAPTCHA wording in your org's Setup.

### Account Engagement (Pardot)

**Copy from Account Engagement**: the form handler's address
(`https://go.example.com/l/123456/2026-01-01/abc123`) and its external field
names (for `mapping`). In the handler, set **Success Location** and **Error
Location** to two pages *on this site* and copy them into `successLocation` /
`errorLocation`.

**What is sent**: a real form post to the handler (form handlers don't accept
`fetch`/XHR — no CORS), into a hidden frame (`mode: "frame"`) or as a normal
navigation (`mode: "navigate"`).

- With both locations on this site, the frame lands on one of them and the
  page reads which (same origin): success, or an error with the handler's
  `errorMessage` parameter when it sends one. Field-level errors are not
  available. Without them, a completed post counts as success.
- **Visitor tracking**: in a hidden frame the handler's tracking cookie is a
  third-party cookie, which most browsers block. If prospect/visitor
  association matters, use `mode: "navigate"`. Don't use Kiosk/Data Entry
  Mode for browser submissions (it stops the handler from cookieing the
  visitor) — that mode is for server-side posts.
- Works without JavaScript when it is the first destination.

Verified against: the [Form Handler object reference](https://developer.salesforce.com/docs/marketing/pardot/guide/form-handler-v5.html) (`successLocation`, `errorLocation`, `isDataForwarded`, Kiosk/Data Entry Mode) as quoted in search results (2026-11-23); "no AJAX posts" from [a Webflow forum report](https://discourse.webflow.com/t/success-error-messages-and-pardot-form-handlers-with-webflow/92580). Salesforce Help's handler pages could not be read.

### Webhook

Settings: `url`, `format` (`"json"`, default, or `"form"`).

- JSON: `POST url` with `{ "form", "values", "page": { url, title, referrer }, "at" }`.
- Form: `application/x-www-form-urlencoded` values (multi-choice repeated).
- **CORS**: the receiving server must allow this site's origin.
  A JSON post is preceded by an `OPTIONS` preflight that must answer
  `Access-Control-Allow-Origin` (and `-Headers: content-type`); a form-encoded
  post has no preflight but its answer is readable only with
  `Access-Control-Allow-Origin`. If the browser can't read the answer, the
  submission counts as failed (it may still have arrived).
- An answer of `{ "errors": { "<name>": "message" } }` puts messages on the fields.
- Anything with a secret (an API key in the address or a header) must be
  `serverSide: true` instead: a page can't keep a secret.
- `format: "form"` works without JavaScript when it is the first destination.

### `mailto`

Settings: `to`, `subject`. Opens the visitor's mail program with "Label:
answer" lines in the body. **Nothing is stored and the page can't know if the
message was sent.** The default thank-you says so ("Your email program
should open…"). A last resort. Works without JavaScript (`enctype="text/plain"`).

## After submission

`afterSubmit` runs in order after the first destination succeeds. A
`redirect` always happens last, so nothing after it is cut short.

| `type` | |
| --- | --- |
| `message` | Replaces the form with the thank-you (`title`, `text` in inline Markdown). `{{fieldId}}` is filled with the answer **as text** (never HTML, never inside a link address). Focus moves to it; it is a `role="status"` region. The default (no `message`) is "Thank you / Your answers were sent." |
| `redirect` | `url` (relative or http/https), `passFields` appended as query parameters, `delaySeconds` (the thank-you shows meanwhile; without a delay and without a `message` action, nothing is shown before the page changes). |
| `download` | A link in the thank-you (`label`, default "Download"); `auto: true` also starts it. |
| `event` | `target: "dataLayer"` (default) pushes `{ event: name, galley_form, ...params }`; `"gtag"` calls `gtag("event", name, params)` if gtag exists; `"dom"` dispatches a `CustomEvent(name)` from the form. `params` values may use `{{fieldId}}`. |
| `webhook` | `navigator.sendBeacon(url, JSON)` (falls back to `fetch` with `keepalive`). Not awaited; the answer is never read. |
| `script` | <a id="script"></a>`code`, run as `new Function("values", "form", "results", code)`. **Only when the site sets `forms.allowFormScripts: true`** — otherwise the build leaves it out of the page and logs why. Code in a content file runs on every visitor's browser with the page's privileges; a site opts in deliberately, because anyone who can edit forms (in content mode, the assistant included) could otherwise add code. |

Every form also dispatches, from its `.galley-form` element (bubbling):
`galley:form:submit` (cancelable — `preventDefault()` stops the send;
`detail: { form, values }`), `galley:form:success` (`{ form, values, results,
redirect }`) and `galley:form:error` (`{ form, detail, errors }`).

## Without JavaScript

The whole form is in the HTML with native validation (`required`, `type`,
`pattern`, lengths). Without JavaScript the browser posts it to the **first
destination, without a `when`, that accepts a plain form post**: `galley`
(urlencoded, see below), `webhook` with `format: "form"`, `salesforce`,
`pardot`, `mailto`. Inputs are named for that destination (its `mapping`) and
its constants are hidden inputs. HubSpot and Marketo need JavaScript; a form
with no plain-post destination says so in a `<noscript>` line.

For `galley`, the post includes `_galley_form` (the form id),
`_galley_return` (this page + `#galley-sent-<form>`) and `_galley_hp` (the
honeypot); the server redirects (303) back to `_galley_return` when it is on
the posting page's own origin, and the thank-you shows through `:target` CSS.
Things that need JavaScript don't happen without it: conditions (every field
shows), steps (one long page), autofill other than `page-url`, the checkbox
groups' "at least one" rule, `afterSubmit` actions.

## Styling

The kit ships **structure only**, driven by custom properties with
fallbacks; font family and size come from the page. A site themes every form
in a few lines of its own CSS:

| Property | Default |
| --- | --- |
| `--galley-form-gap` | `1rem` |
| `--galley-field-bg` | `Canvas` |
| `--galley-field-text` | `inherit` |
| `--galley-field-border` | `currentColor` at 45% |
| `--galley-field-radius` | `0.375rem` |
| `--galley-field-height` | `2.75rem` |
| `--galley-field-padding` | `0.6em 0.8em` |
| `--galley-field-focus` | `Highlight` |
| `--galley-form-error` | `#b3261e` |
| `--galley-form-muted` | `currentColor` at 72% |
| `--galley-label-weight` | `600` |
| `--galley-button-bg` / `--galley-button-text` / `--galley-button-radius` | `CanvasText` / `Canvas` / field radius |

The button falls back to the browser's own text-on-page pair (`CanvasText`
on `Canvas`), legible in light and dark. (It used to fall back to
`currentColor`, which on a button is its own text colour — a site that set
none of these properties got a button the colour of its label.)

Hooks: `.galley-form` (`[data-state="idle|sending|sent"]`, `[data-layout]`,
`[data-size]`, `[data-labels]`), `__form`, `__fields`, `__field`
(`[data-galley-field="id"]`, `[data-type]`, `[data-width]`, `[data-invalid]`),
`__label`, `__control`, `__choice`, `__options`, `__help`, `__error`,
`__required`, `__optional`, `__summary`, `__step`, `__progress`, `__actions`,
`__submit`, `__next`, `__back`, `__status`, `__success`, `__success-title`,
`__success-text`, `__download`. `<Form unstyled />` emits no CSS at all.
`appearance.layout: "inline"` puts the fields and the button in one row (a
newsletter); `size: "compact"` tightens it; `labels: "floating" | "hidden"`
(hidden keeps the accessible name and shows the label as the placeholder).

Pass the site's own button classes with `submitClass` (and `backClass`); the
kit's button styles then step aside.

**The starters' tokens, mapped.** `astro-saas` (`src/styles/tokens.css` + the
`--tone-*` roles in `global.css`):

```css
.galley-form {
  --galley-form-gap: var(--space-s);
  --galley-field-bg: var(--tone-bg);
  --galley-field-text: var(--tone-text);
  --galley-field-border: var(--tone-control);
  --galley-field-radius: var(--radius-m);
  --galley-field-height: 2.875rem;
  --galley-field-focus: var(--tone-focus);
  --galley-form-error: var(--color-negative);
  --galley-form-muted: var(--tone-muted);
  --galley-label-weight: var(--weight-medium);
  --galley-button-bg: var(--tone-button-bg);
  --galley-button-text: var(--tone-button-text);
  --galley-button-radius: var(--radius-button);
}
.galley-form__label { font-size: var(--step--1); }
```

with `<Form id="contact" submitClass="button" />` (and
`backClass="button button--secondary"` on multi-step forms). Because the
values are the tone roles, a form in a `tone-inverse` or `tone-accent`
section follows that section, and every look in `src/styles/themes/` (Night
shift included) applies with no further change. `astro-starter` uses the same
names (`--color-border-strong` for controls, `--color-accent` for focus):

```css
.galley-form {
  --galley-form-gap: var(--space-s);
  --galley-field-bg: var(--color-surface);
  --galley-field-border: var(--color-border-strong);
  --galley-field-radius: var(--radius-m);
  --galley-field-focus: var(--color-accent);
  --galley-form-error: oklch(50% 0.17 25);
  --galley-form-muted: var(--color-text-muted);
  --galley-label-weight: var(--weight-medium);
  --galley-button-bg: var(--color-accent);
  --galley-button-text: var(--color-accent-contrast);
  --galley-button-radius: var(--radius-button);
}
```

## Accessibility

- Every input has a `<label for>`; groups are a `<fieldset>` with a
  `<legend>`; help and error texts are tied with `aria-describedby`;
  required fields carry `required` (the visual `*` is `aria-hidden`).
- Errors: checked when the visitor leaves a field that has an answer, and on
  submit; an error sets `aria-invalid` and `[data-invalid]`, and clears as the
  answer is fixed. On submit, an error summary ("2 answers need checking.")
  with links to each field takes focus. A destination's refusal stays on its
  field until the answer changes.
- "Sending…", failures and "too many tries" go to a `role="status"` region;
  a failure without field errors moves focus there. The thank-you is
  focused and announced. It isn't in the tab order (`tabindex="-1"`), so WCAG
  2.4.7 doesn't strictly ask for a focus ring on it; it gets one anyway when
  the browser shows focus (`:focus-visible` — after a key press, not after a
  click), so a keyboard user sees where focus went. The rule weighs nothing
  (`:where()`), so the site's own focus style wins.
- Steps: the progress line updates, focus moves to the new step's title, and
  everything works by keyboard (Enter = Next).
- `labels: "hidden"` keeps the label for screen readers; placeholders are
  never the only label.
- Focus rings use `--galley-field-focus`; motion is limited to the floating
  label and respects `prefers-reduced-motion`.
- Tested with axe-core in Chromium on the built starter: no violations on the
  forms, their error and thank-you states, the banner and the email dialog.

## Spam

- **Honeypot** (default on): a hidden text input (`_galley_hp`, out of view
  and out of the accessibility tree). If it is filled, the visitor is shown
  the thank-you and nothing is sent. Its value also goes to the capture
  endpoint (`meta.honeypot`), which flags rather than drops.
- **`minSeconds`**: a submission sooner than this after the form appeared is
  held back with "That was quick. Check your answers, then send again."
  (`meta.elapsedMs` lets the capture server apply the same rule).
- **Turnstile**: with `turnstileSiteKey`, the widget renders in the form and
  Cloudflare's script loads only on pages with such a form; its token goes to
  the capture endpoint as `meta.turnstileToken` (tokens last 300 s and must be
  verified server-side — the capture server does). Other destinations can't
  verify it.

## Attribution fields (UTM memory)

`autofill: { "from": "utm", "key": "utm_source", "touch": "first" | "last" }`
reads the visitor's **first** or **latest** landing that carried UTM
parameters (`utm_source`, `utm_medium`, `utm_campaign`, `utm_term`,
`utm_content`, `utm_id`; also `landing_page` and `referrer` of that landing).
They are kept in this site's own `localStorage` (`galley:attribution`,
`{ first, last }`) and leave the browser only in a form submission. Without a
remembered landing, the current address's parameter is used.

When any form uses UTM autofill, a few lines of the scripts runtime record
landings on **every page** (not only pages with a form). When the site uses a
consent mode (`docs/scripts.md`), landings are remembered only once
**marketing** is granted; before that, only the current page's parameters are
available. With the built-in banner, a site whose forms use UTM memory
therefore always offers **Marketing** in the banner — even with no script that
needs consent — so a visitor can grant it (before, such a site showed no
banner at all, and the memory could never start). See "UTM memory and
consent" in `docs/scripts.md` for why this is consent-based. Nothing expires
them; they go when the visitor clears the site's data.

**Sub-path builds.** Links written from the site root in a form's texts
(`[privacy policy](/privacy/)` in help, consent text, headings, the
thank-you), download addresses and redirect addresses get the site's base
path (`/docs/privacy/` under `--base /docs`) — no wrapper needed.

## The capture endpoint

The request and response the page uses (implemented by
`packages/core/src/forms/capture.ts`; operations in `docs/form-capture.md`).

**Request**

```http
POST <capture address>            e.g. https://cms.example.com/f/site_abc123
Content-Type: application/json
Origin: https://www.example.com

{
  "form": "contact",
  "values": { "name": "Kim Lee", "email": "kim@example.com", "topics": ["a", "b"], "updates": "true" },
  "page": { "url": "https://www.example.com/contact/?utm_source=ads", "title": "Contact", "referrer": "" },
  "meta": { "elapsedMs": 5361, "honeypot": "", "turnstileToken": "…", "locale": "en-GB", "kit": "0.1.0" }
}
```

- `values`: the showing, non-layout fields by id after the destination's
  `mapping` and with its `constants` (for `galley` these are usually none).
  Ticked boxes are `"true"`, unticked `"false"` (the server stores `"yes"` or
  nothing). Multi-choice answers are arrays.
- `meta.turnstileToken` only when the form has a Turnstile key.

**Responses**

| Status | Body | The page |
| --- | --- | --- |
| `200` | `{ "ok": true, "id": "sub_…" }` | success |
| `422` | `{ "ok": false, "errors": { "<fieldId>": "message" }, "message"?: "<the form's errorMessage>" }` | messages on the fields, `message` (else the form's wording) in the status |
| `429` | `{ "ok": false, "message" }` + `Retry-After: <seconds>` (exposed with `Access-Control-Expose-Headers`) | "Too many tries just now. Try again in 30 seconds." |
| `403` | `{ "ok": false }` (origin not one of the site's) | generic failure; details in the console |
| `404` | `{ "ok": false, "message" }` (no such site, or the form doesn't list the inbox) | "This form isn't connected yet" |
| other | anything | generic failure |

CORS: the server answers the `OPTIONS` preflight and the POST with
`Access-Control-Allow-Origin: <the site's origin>` and allows the
`content-type` and `accept` headers.

**Without JavaScript**: `application/x-www-form-urlencoded` with fields named
by id, plus `_galley_form`, `_galley_return`, `_galley_hp`; the server answers
`303 See Other` to `_galley_return` (only when it is on the posting page's
origin), where `#galley-sent-<form>` shows the thank-you.

## Adding a provider

A provider is one function:

```ts
type Submitter = (
  values: { [name: string]: string | string[] },   // after mapping and constants
  destination: FormDestination,
  context: SubmitContext,                           // formId, form element, fields, answers, items, page, meta, messages
) => Promise<SubmitResult> | SubmitResult;           // { ok, detail?, errors?, retry?, retryAfter?, message?, notConnected?, redirect? }
```

Register it before or after the page's forms start:

```js
import { registerFormProvider } from "@galley/astro/client";      // vendored: "../galley/client/forms.js"

registerFormProvider("crm", async (values, destination) => {
  const res = await fetch(String(destination.settings.url), { method: "POST", body: JSON.stringify(values) });
  return res.ok ? { ok: true } : { ok: false, detail: `HTTP ${res.status}` };
});
```

or `window.galleyForms.registerProvider("crm", fn)` from a plain script. A
destination naming it (`"provider": "crm"`) then goes through it. To make it
a built-in (with an entry in the app's picker), add its `FormProviderInfo` to
`packages/core/src/kit-catalog.ts`, a module in
`packages/astro/src/client/providers/<id>.js` exporting `submit`, a line in
`BUILT_IN` in `client/forms.js`, and (if it accepts a plain form post) a case
in `nativeTarget` in `forms/render.js`; then `node scripts/sync-contract.mjs`.

## Wording

Every word the runtime says (validation, summary, steps, sending, errors,
default thank-you) is in `packages/astro/src/forms/messages.js`, written to
`brand/voice.md`. Override any of them for the whole site
(`forms.messages` / `src/galley/settings.json`) or for one form (`messages`
in its file). Keys: `required`, `requiredChoice`, `requiredCheck`, `email`,
`businessEmail` ({domain}), `url`, `tel`, `number`, `date`, `min` ({min}),
`max` ({max}), `minLength` ({min}), `maxLength` ({max}), `pattern`,
`summaryOne`, `summaryMany` ({count}), `sending`, `sent`, `error`,
`rateLimited`, `rateLimitedFor` ({seconds}), `rateLimitedForOne`, `tooFast`,
`notConnected`, `noScript`, `next`, `back`, `step` ({step}, {total}),
`choose`, `optional`, `requiredMark`, `honeypotLabel`, `thanksTitle`,
`thanksText`, `mailtoText`, `download`.

## What a static page cannot do

- **Keep a secret.** Anything that needs an API key or token (HubSpot's
  authenticated endpoint, a CRM API, a signed webhook) goes through a
  server-side destination (`serverSide: true`, forwarded by the capture
  server) or the site owner's own function.
- **Read Salesforce's or Account Engagement's answer.** Both are form posts
  without CORS; success means "the post completed" (with the
  success/error-location exception above). They can't report field errors.
- **Trust the browser.** Every check here is a courtesy for the visitor; the
  capture server validates again, and providers do their own.
- **Send without JavaScript** to HubSpot or Marketo.
