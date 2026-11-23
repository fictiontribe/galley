---
title: Forms, for developers
navTitle: Forms
description: How a Galley form works on a site — one JSON file and one component — its destinations, the capture endpoint behind the inbox, and running the inbox where visitors can reach it.
group: astro
order: 5
---

This page is for developers; editors build forms in the form builder ([Make a form](/docs/editing/forms/)). The app's **Forms** screen links here. *Status: built.*

A form is **one JSON file** in the site — `src/content/forms/contact.json` — and one line where it appears:

```astro
---
import { Form } from "../galley/components/index.js"; // vendored; "@galley/astro/components" once published
---
<Form id="contact" />
```

Because it's a content file, the form builder, the assistant, MCP and your editor all change the same thing, and every change shows in Proof. The format is `FormDefinition` in [`packages/core/src/kit.ts`]({repository}/blob/main/packages/core/src/kit.ts); the runtime is the [site kit](/docs/astro/site-kit/).

## Setting a site up

**Set it up for me** on the Forms or Scripts screen does it as pending changes, each step only when still needed and only when the change is unambiguous: the kit's files into `src/galley/`; a first `src/content/forms/contact.json` sending to the inbox; `src/data/scripts.json`; the `forms` collection in `src/content.config.ts` when it exports `collections` as a plain object; the script placements when exactly one layout writes its own `<html>`; and the kit's build step in `astro.config`. Anything it can't do safely it lists, with the lines to add by hand. It needs build mode to be allowed on the site.

The capture address goes into `src/galley/settings.json` (`forms.endpoint`) **only when visitors' browsers can reach this Galley** — an address on your computer or private network is never written into a file that is published.

## The file

```jsonc
{
  "name": "Request a demo",
  "submitLabel": "Request a demo",
  "fields": [
    { "id": "email", "type": "email", "label": "Work email", "required": true, "validation": { "businessEmailOnly": true } },
    { "id": "size", "type": "radio", "label": "Number of sites",
      "options": [{ "value": "1-9", "label": "1–9" }, { "value": "10+", "label": "10 or more" }] },
    { "id": "consent", "type": "consent", "required": true, "text": "I agree to the [privacy policy](/privacy/)." }
  ],
  "destinations": [
    { "provider": "galley", "settings": {} },
    { "provider": "webhook", "settings": { "url": "https://hooks.example.com/sales" }, "when": { "field": "size", "equals": "10+" } }
  ],
  "afterSubmit": [{ "type": "message", "title": "Thanks", "text": "We'll write to **{{email}}**." }]
}
```

Fields, steps, conditions (`showWhen`), mapping, constants, after-submit actions, spam settings and appearance are all in [`docs/forms.md`]({repository}/blob/main/docs/forms.md), which annotates every key.

## Destinations

Every destination whose `when` holds receives the submission; **the first decides success** — its answer is what the visitor sees. Each provider's code loads only when a form on the page uses it.

| `provider` | Sends to |
| --- | --- |
| `galley` | Galley's inbox, through the capture endpoint (below). |
| `hubspot` | A HubSpot form (portal id and form id). |
| `marketo` | A Marketo form, through Marketo's own forms script. |
| `salesforce` | Salesforce Web-to-Lead. |
| `pardot` | An Account Engagement (Pardot) form handler. |
| `webhook` | Any address, as JSON. |
| `mailto` | The visitor's mail program. Nothing is stored. |

A destination with `settings.serverSide: true` isn't sent by the page: the capture server forwards it after storing the submission, so it can hold secrets. Such a form needs a `galley` destination. The docs haven't sent to a real CRM.

## The capture endpoint

`POST <Galley address>/f/<siteId>`, JSON at most 64 KB — outside the app's session, with its own rules: only the site's own addresses may send (its live and staging addresses, plus any listed in **Capture settings…**), or a server sending an `X-Capture-Key` header; rate limits per visitor and per form; a hidden trap field and a minimum time. Answers: `200 { ok, id }`, `422` with a message per field, `429` with `Retry-After`, `403`, `404`. Without JavaScript the form posts normally and is sent back to the page with `303`. The request and answers in full: [`docs/form-capture.md`]({repository}/blob/main/docs/form-capture.md).

## Where visitors can reach it

A static site's visitors can only send to a Galley that is **on the internet**:

- **Hosted** (`galley serve`, or the container) with `GALLEY_PUBLIC_URL` set to a public `https://` address: the capture address is `https://cms.example.com/f/<siteId>`. Put it in `forms.endpoint` (or the destination's `endpoint`) and publish. [Self-hosting](/docs/running/hosted/).
- **On your own computer**: the address is `http://127.0.0.1:<port>/f/<siteId>`. It works from the preview and with **Send a test submission**; real visitors can't reach it. Send live forms to a CRM or webhook instead.

E-mail alerts need `GALLEY_SMTP_URL` and `GALLEY_MAIL_FROM` on the server ([Environment variables](/docs/reference/environment/#forms-and-e-mail)). Submissions are kept in the Galley home, never in the site.

## Next

- [Scripts](/docs/scripts/) — the same kit's managed scripts and consent banner.
- The inbox's routes: [HTTP API](/docs/reference/api/#form-inbox).
