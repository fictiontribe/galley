# Integrations catalog — `@galley/astro`

There is nothing to submit. astro.build/integrations is rebuilt from npm once
a week and lists every package whose `keywords` include `astro-integration`
(or `astro-component` / `withastro`). Publishing `@galley/astro` is the
submission.

## What the listing will show

Read from `packages/astro/package.json`:

| Listing field | Value |
| --- | --- |
| Name | `@galley/astro` |
| Description | Dev Toolbar app for editing an Astro site with Galley, the open-source, git-based AI CMS: see whether Galley is running and open the current page in it. Development only. |
| Category | **Dev Toolbar** — from the keywords `dev-toolbar` and `devtools` (Astro has no CMS category; `cms` is a plain keyword). |
| Repository | https://github.com/fictiontribe/galley (directory `packages/astro`) |
| Homepage | https://galley.fictiontribe.com/astro/ |
| Install | `npx astro add @galley/astro` — `astro add` accepts a third-party package when its `keywords` include `astro-integration` and its default export is the integration function; both are true. |

Keywords: `astro-integration`, `withastro`, `astro`, `dev-toolbar`, `devtools`,
`cms`, `galley`.

## Before publishing

1. The `@galley` scope must belong to the project on npm (create the
   organisation `galley`, or change the package name everywhere if it is
   taken).
2. In `packages/astro/package.json`: remove `"private": true`, set the
   version.
3. The homepage and repository must answer: publish the Galley repository
   and deploy galley.fictiontribe.com first.
4. The Galley server must serve `/open` (see "What the server must add" in
   `README.md`); until it does, the toolbar's "Edit this page in Galley"
   button lands on a page that doesn't exist.
5. `cd packages/astro && npm publish --access public`.

The listing appears after the next weekly sync.

## Optional: an avatar

Without one the listing shows a generic icon. After the package is on npm,
open an issue at https://github.com/withastro/astro.build/issues/new/choose
(their docs point there for avatars and for overriding the name, description
or homepage):

```
Title: Add an avatar for @galley/astro

Hi! @galley/astro (https://www.npmjs.com/package/@galley/astro) is listed in the integrations library. Could you use the attached image as its avatar?

It is the Galley mark, square, on a solid background. Thank you.
```

Attach `docs/astro-catalog/galley-logo.svg` (and a 512 × 512 PNG export of it
if they ask for a raster).
