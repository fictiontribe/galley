---
title: Galley — the open-source AI CMS for static sites
description: Galley is an open-source AI CMS for static sites. Change a page in a form, on the page or by asking, check every change beside the live site, then publish it to your own git repository.
sections:
  - type: hero
    layout: showcase
    align: center
    heading: The open‑source AI CMS.
    text: Ask for a change in plain words, check it beside your live site, then publish it to your own repository.
    cta:
      label: Get started
      href: /docs/getting-started/quickstart/
    secondary:
      label: Take the tour
      href: /tour/
    demo: Try the demo
    command: true
    labels:
      site: Live site
      overlay: Galley · Proof
    visual:
      kind: site
      src: caddow-home
      alt: The home page of Caddow, a fashion label’s site made from a Galley starter, as it is live — a model in a rust coat against a harbour wall under the heading “Coats for the long afternoon.”
    overlay:
      kind: screen
      src: proof-changes
      alt: Galley’s proof of that page — “Coats for the long afternoon.” struck out and “Coats for low sun.” written in, the button “See the lookbook” renamed “See the eight looks”, and “begin” changed to “start” in a heading.
  - type: film
    id: film
    layout: wide
    heading: Prompt it. Proof it. Publish it.
    text: Nothing is live until you press Publish.
    video: galley-explainer
    title: Galley in 31 seconds, with captions
    captions: English
    chaptersLabel: The three steps, and where each starts in the film
    chapters:
      - label: Ask
        time: 6
        text: In plain words — or type in a form, or on the page itself.
      - label: Check
        time: 12
        text: Each change marked up beside the live site. Put back any one.
      - label: Publish
        time: 19
        text: To your own repository, or for review first. Undo adds a new version.
    link:
      label: See every screen on the tour
      href: /tour/
    transcript:
      label: Read the transcript
      href: /video/galley-explainer.txt
  - type: starters
    id: starters
    layout: row
    heading: Start from a finished site.
    text: Three starters, three looks each.
    link:
      label: Browse the starters
      href: /starters/
    items:
      - starter: astro-editorial
        name: Caddow
        kind: Fashion
        text: 20 sections.
      - starter: astro-saas
        name: Ferrow
        kind: B2B software
        text: 29 sections.
      - starter: astro-starter
        name: Lowfield Studio
        kind: Small business
        text: 17 sections.
  - type: filmstrip
    id: tour
    heading: The rest of the app.
    text: Forms and their inbox, scripts with consent, redirects, the brand, search checks and every site you look after.
    link:
      label: Take the tour
      href: /tour/
    items:
      - label: Forms
        icon: form
        href: /tour/#forms
        visual:
          src: forms
          x: -148
          alt: The Forms screen.
      - label: Redirects
        icon: link
        href: /tour/#redirects
        visual:
          src: redirects
          x: -148
          alt: The Redirects screen.
      - label: Brand
        icon: brand
        href: /tour/#brand
        visual:
          src: brand-type
          x: -376
          y: -175
          alt: The brand’s type, set large in the site’s own heading face.
      - label: Search and AI
        icon: visibility
        href: /tour/#search
        visual:
          src: search-ai
          x: -148
          alt: The Search & AI checks.
      - label: Your sites
        icon: sites
        href: /tour/#sites
        visual:
          src: sites
          x: -148
          alt: The list of your sites.
  - type: desktop
    id: desktop
    heading: The desktop app.
    text: The same app, in its own window, for every site you look after — on Mac, Windows and Linux.
    fallback: Download the app
    other: Other systems
    apps: See the apps
    unsigned: not signed yet
  - type: status
    id: whats-in
    heading: What’s in {version}.
    compact: true
    lines: false
    link:
      label: Changelog
      href: /changelog/
  - type: close
    id: start
    heading: Built in the open.
    text: Apache-2.0, free to use. Astro fits deepest; it also recognises Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll. The assistant runs on your own AI key.
    actions:
      - label: Read the quickstart
        href: /docs/getting-started/quickstart/
      - label: GitHub
        href: "{repository}"
    commands: true
---
