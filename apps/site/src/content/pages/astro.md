---
title: Galley and Astro
description: Galley is built for Astro. It reads your content collections and zod schemas without running them, previews with your own astro dev, and adds nothing to your build.
sections:
  - type: hero
    layout: split
    eyebrow: Built for Astro
    heading: Galley and Astro.
    text: Galley reads your content collections and their schemas without running them, turns them into forms, and previews your site with its own dev server.
    cta:
      label: Get started
      href: /docs/getting-started/quickstart/
    secondary:
      label: The Astro guide
      href: /docs/astro/content-collections/
    visual:
      kind: screen
      src: form
      alt: The form Galley made from the Caddow starter’s content schema, beside the page.
  - type: split
    id: reads
    heading: Your schemas become the form.
    text: Strings, enums, booleans, dates, images, references and discriminated unions become fields and page sections. The config is read, never run.
    points:
      - Previews through your own `astro dev`, behind a small proxy
      - Nothing added to your project or your build
      - "In `astro dev`, the site kit’s toolbar app opens the page in Galley"
    link:
      label: How detection works
      href: /docs/concepts/detection/
    flip: true
    visual:
      kind: screen
      src: arrange
      alt: The Caddow starter’s sections, read from its discriminated union, listed as a library beside the page.
  - type: starters
    id: starters
    layout: gallery
    heading: Starters made for it.
    text: Three complete Astro sites built from sections.
    link:
      label: Browse the starters
      href: /starters/
    items:
      - starter: astro-editorial
        name: Caddow
        kind: Fashion
        text: Campaign, lookbooks, journal, stockists.
      - starter: astro-saas
        name: Ferrow
        kind: B2B software
        text: Product, pricing, customer stories, changelog.
  - type: close
    id: note
    heading: Built for Astro.
    text: Astro is a trademark of its owner. Galley is built for Astro and is not affiliated with or endorsed by the Astro project.
    actions:
      - label: Read the quickstart
        href: /docs/getting-started/quickstart/
---
