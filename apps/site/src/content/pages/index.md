---
title: Galley — the open-source AI CMS for static sites
description: Galley is an open-source AI CMS for static sites. Change a page in a form, on the page or by asking, check every change beside the live site, then publish it to your own git repository.
sections:
  - type: hero
    layout: showcase
    heading: The open-source AI CMS.
    text: Prompt it. Proof it. Publish it. Ask for a change, type it in a form or click the page — check it beside the live site, then publish to your own repository.
    cta:
      label: Get started
      href: /docs/getting-started/quickstart/
    note: "Starts a new site and opens Galley. Already have a site? Run npx galley-cms in its folder."
    command: true
    copyFile:
      label: Setting it up with an agent? Copy its context
      href: /agent.md
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
    caption: Caddow, a Galley starter, live — with its proof, waiting for Publish.
  - type: film
    id: film
    heading: 31 seconds, from ask to publish.
    text: Ask for a change, check it beside the live site, publish it.
    video: galley-explainer
    title: Galley in 31 seconds, with captions
    captions: English
    chaptersLabel: Jump to a part of the film
    chapters:
      - { label: Prompt, time: 6 }
      - { label: Proof, time: 12 }
      - { label: Publish, time: 19 }
    transcript:
      label: Read the transcript
      href: /video/galley-explainer.txt
  - type: tabs
    id: edit
    heading: Three ways to change a page.
    text: Type in a form, retype words on the page, or ask the assistant. All three end in the same proof.
    tabsLabel: Ways to change a page
    tabs:
      - label: Form
        visual:
          kind: screen
          src: form
          alt: The form beside the Caddow home page, its campaign section open and the edited heading marked.
      - label: On the page
        visual:
          kind: screen
          src: click
          alt: On the Caddow page, the heading over four knitwear photographs retyped in place to “Coats and knits to start with”, outlined in blue.
      - label: Ask
        visual:
          kind: screen
          src: assistant
          x: -330
          alt: The assistant’s reply beside the Caddow page after changing the campaign heading and its first button, with Review in Proof and Undo beneath.
  - type: proof
    id: proof
    heading: Nothing goes live unproofed.
    text: Your page beside the live site, each change struck out and written in. Put any one back. Nothing is live until someone presses Publish.
    link:
      label: How proof works
      href: /docs/editing/proof-and-publish/
    sheet:
      label: "An example proof: two changes to a home page"
      title: Home page
      badge: Edited
      changes:
        - path: Campaign hero › Heading
          before: Coats for the long afternoon.
          after: Coats for low sun.
        - path: Pieces › Heading
          inline: Coats and knits to [begin|start] with
    notesLabel: Reading the marks
    notes:
      - mark: delete
        title: Struck out.
        text: What goes.
      - mark: insert
        title: Written in.
        text: What comes in.
      - mark: change
        title: Changed.
        text: Swapped inside a field.
  - type: band
    id: publish
    heading: Publish is a commit.
    text: Galley commits the change to your repository as you, or opens a pull request. Undo is a new commit, never a rewrite.
    terminal:
      title: ~/sites/caddow
      note: after one publish
      label: What the repository records after one publish
      lines:
        - "$ git log -1 --format=%B"
        - Shorter campaign heading
        - ""
        - "Galley-Publish: 1"
        - "$ git show --stat --format= HEAD"
        - " src/content/pages/index.md | 6 +++---"
        - " 1 file changed, 3 insertions(+), 3 deletions(-)"
  - type: starters
    id: starters
    layout: feature
    heading: Start from a finished site.
    text: Caddow for a fashion label, Ferrow for B2B software, and a small-business site, each with three looks.
    link:
      label: Browse the starters
      href: /starters/
    items:
      - starter: astro-editorial
        tall: caddow-tall
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
    builder:
      status: builder
      text: Then build pages from their own sections.
      starter: astro-editorial
      sections: [campaign-hero, lookbook-grid, pieces]
      sectionsLabel: Three of Caddow’s 20 sections
      visual:
        kind: recording
        src: arrange-drag
        alt: A newsletter section found in the section library, dragged onto the Caddow page and dropped under the campaign photograph.
  - type: split
    id: repo
    heading: It’s just your repo.
    text: Pages stay markdown and JSON files in git. Publish is a commit or a pull request. Galley adds nothing to your build.
    points:
      - Astro fits deepest; it also recognises Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll — or [teach it yours](/docs/adapters/)
      - Reads Astro’s content collections, no schema to write
      - Previews with your site’s own dev server
      - One field changed, one value changed
    link:
      label: Galley and Astro
      href: /astro/
    visual:
      kind: screen
      src: proof-source
      alt: The proof’s Source view of the same change — one line of the page’s markdown file struck out and one written in.
  - type: filmstrip
    id: tour
    heading: The rest of the app.
    text: Forms and their inbox, scripts with consent, redirects, the brand, search checks and every site you look after — all in the same app.
    link:
      label: Take the tour
      href: /tour/
    items:
      - label: Forms
        href: /tour/#forms
        visual:
          src: docs/form-builder
          alt: The form builder.
      - label: Redirects
        href: /tour/#redirects
        visual:
          src: docs/redirects-list
          alt: The Redirects screen.
      - label: Brand
        href: /tour/#brand
        visual:
          src: brand-proposal
          x: -150
          y: -24
          alt: The brand proposal.
      - label: Search and AI
        href: /tour/#search
        visual:
          src: docs/search-and-ai
          alt: The Search & AI checks.
      - label: Your sites
        href: /tour/#sites
        visual:
          src: docs/sites
          alt: The list of your sites.
  - type: status
    id: whats-in
    heading: What’s in {version}.
    lines: false
    linesFor: [agencies]
    link:
      label: Changelog
      href: /changelog/
  - type: cards
    id: next
    heading: Where next
    quiet: true
    items:
      - title: Leaving WordPress?
        text: Keep editing it yourself.
        href: /wordpress/
      - title: Readable by AI assistants
        text: Markdown copies for agents.
        href: /ai-first/
      - title: "Galley Cloud: coming soon"
        text: The editor, hosted for you.
        href: /cloud/
  - type: close
    id: start
    heading: Built in the open.
    text: Apache-2.0, free to use. The assistant runs on your own AI key. Bring a starter, an adapter, a plugin or a fix.
    actions:
      - label: Read the quickstart
        href: /docs/getting-started/quickstart/
      - label: GitHub
        href: "{repository}"
    commands: true
---
