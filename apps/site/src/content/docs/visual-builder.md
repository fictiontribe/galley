---
title: What Arrange needs from a site
navTitle: What Arrange needs
description: The two attributes that let editors arrange a page's sections on the page itself, what happens without them, and the pictures and descriptions the section panel shows.
group: astro
order: 7
---

This page is for developers. **Arrange**, the on-page page builder ([Build a page from sections](/docs/editing/page-builder/)), links here when it can't arrange a page. *Status: Preview.*

Arrange works on pages whose content has a `blocks` field — a list of sections, each with a type — which Galley detects from the content schema or the files. To arrange them *on the page*, Galley must know which element is which section.

## Mark each section: two attributes

On each section's outermost element, its place in the list and its type:

```astro
{sections.map((section, index) => (
  <section data-galley-block={`sections.${index}`} data-galley-block-type={section.type}>…</section>
))}
```

- `data-galley-block` is `<field key>.<index>` — `sections.0`, `sections.1` — where the key is the field holding the list.
- `data-galley-block-type` is the section's type, so Galley notices when the page hasn't caught up with the content yet.
- Don't nest marked sections of the same list. The attributes cost nothing in production.

When each section is its own component, pass the marker down from the loop and write it in one place — the starters do (the B2B / SaaS starter's `Sections.astro` hands each component `block={{ key, type }}`).

## Without the attributes

Galley looks for evidence instead: text and images that only one section holds, each on exactly one element of the page. It uses that mapping only when **every** section resolves to its own element, none inside another, in the content's order. Otherwise Arrange is not offered for the page — the panel says **Sections can't be arranged on this page**, with the reason under **Technical details**, and the form keeps working. It never uses a partial or "probable" mapping. Typical reasons: two sections show the same words (a duplicated section), a section shows nothing of its own, or the page renders sections out of order or nested.

## Pictures and descriptions in the panel

The panel shows each section type's label, a one-line description and a picture, from the blocks field in `galley.config.json`:

```json galley.config.json
{
  "collections": [
    {
      "id": "pages",
      "fields": [
        {
          "key": "sections",
          "blocks": [
            {
              "type": "hero",
              "label": "Hero",
              "description": "The opening statement of a page: a large heading, a line of text, the main buttons.",
              "thumbnail": "galley/sections/hero.webp"
            }
          ]
        }
      ]
    }
  ]
}
```

`thumbnail` is a path in the site to a WebP or PNG of about 800 × 500 — keep thumbnails outside `public/` so they aren't deployed. The starters make theirs with `scripts/make-thumbnails.mjs`. Without a picture the panel draws a plain card.

A new section starts from the most complete existing one of its type (or the config's `example`), with its words, links and images empty and its settings kept.

## Options

A selected section's **options** are its short, closed choices: `select` fields with two to six values become a segmented control, `boolean` fields a switch. Everything else is edited in the form.

How it works underneath — the overlay protocol, the drag, the edit queue: [`docs/visual-builder.md`]({repository}/blob/main/docs/visual-builder.md).
