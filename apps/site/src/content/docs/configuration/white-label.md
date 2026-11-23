---
title: White-label
description: Rename and recolour the app for a deployment with a brand file or two environment variables — what they change, what they don't, and how they are validated.
group: configuration
order: 6
---

This page is for whoever deploys Galley for other people — an agency running it for its clients, a company running it for its own team. The web UI never hard-codes the product's name: it reads the brand from `GET /api/meta`, so a deployment can call the app *Site editor*, give it its own colour and logo, and point Help at its own pages, without touching the code. This is a server setting, not part of `galley.config.json`.

## The brand file

A JSON file named by `GALLEY_BRAND_FILE` ([`packages/server/src/brand.ts`]({repository}/blob/main/packages/server/src/brand.ts)):

```json
{
  "productName": "Site editor",
  "byline": "",
  "accent": "#0B6E4F",
  "logoUrl": "/brand/mark.svg",
  "supportUrl": "https://help.example.com",
  "docsUrl": "https://help.example.com/editor"
}
```

| Key | Rules | Default |
| --- | --- | --- |
| `productName` | 1–60 characters | `Galley` |
| `byline` | up to 120 characters; `""` hides it | `by Fiction Tribe` |
| `accent` | a hex colour: `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` | the brand accent |
| `logoUrl` | an `http(s)://` URL, a path on the app's origin, or a `data:image/…;base64,` URL (PNG, JPEG, WebP, GIF or SVG), up to 512 KB | the Galley mark |
| `supportUrl` | `http(s)://` | none |
| `docsUrl` | `http(s)://` | `https://galley.fictiontribe.com/docs` |

Every key is optional, and any other key is refused. The UI sets the CSS custom property `var(--accent)` from `accent` (every accent shade in the stylesheet is derived from it), uses `logoUrl` as the mark and the favicon, and shows `productName` wherever the product names itself.

## Two shortcuts

`GALLEY_BRAND_NAME` and `GALLEY_BRAND_ACCENT` set the name and the accent directly, and beat the brand file:

```sh
$ GALLEY_BRAND_FILE=./brand.json GALLEY_BRAND_NAME="Harbour editor" galley --no-open
$ curl -s http://127.0.0.1:4400/api/meta
{"version":"","brand":{"productName":"Harbour editor","byline":"","docsUrl":"https://galley.fictiontribe.com/docs","accent":"#0B6E4F","supportUrl":"https://help.example.com"},"mode":"local","authenticated":false,"desktop":false,"platform":""}
```

(The brand file for that run had no `logoUrl` or `docsUrl`, so the default docs link shows.) In the [container](/docs/running/hosted/#run-it-in-a-container), set them as environment variables, or mount the brand file and point `GALLEY_BRAND_FILE` at it.

## Validation

A brand that can't be used stops start-up rather than showing the wrong name:

```text
Error: GALLEY_BRAND_ACCENT must be a hex color like #1a2b3c, not “blue”.
Error: The brand file ./brand.json can't be used. “colour” isn't expected here.
Error: The brand file ./missing.json can't be used because it doesn't exist.
```

Today the command line prints these with a stack trace underneath; the first line is the message.

## What it doesn't change

- **The command line and server output** — `galley`, *Galley is running at …*, `galley doctor` — and the names of the `GALLEY_*` environment variables.
- **What Galley writes into repositories**: the `galley.config.json` file name, the `Galley-Publish: 1` commit trailer, pull-request branches named `galley/…`, and the `/__galley/` paths the preview proxy reserves.
- **The assistant's instructions**, which name the product as `Galley`.

These come from one place, `PRODUCT` in [`packages/core/src/brand.ts`]({repository}/blob/main/packages/core/src/brand.ts). Renaming them for a fork means changing that file and rebuilding.

## The name and the licence

The Apache-2.0 licence lets you run, modify and rebrand the software. It doesn't grant rights to the Galley name or logo; [TRADEMARKS.md]({repository}/blob/main/TRADEMARKS.md) says how they may be used, including in a white-labelled deployment.

## Next

- [Hosting for a team](/docs/running/hosted/).
- [Settings, secrets and the Galley home](/docs/running/settings/).
