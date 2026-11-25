---
title: Leave WordPress, keep editing it yourself
description: Move your WordPress posts, pages, images and SEO details to a fast static site, then change it in a form, on the page or by asking, and check every change before it goes live.
sections:
  - type: hero
    layout: split
    notice:
      label: "New: the guided move is still being checked."
      href: /docs/getting-started/wordpress/
    heading: Leave WordPress. Keep editing it yourself.
    text: Galley moves your posts, pages, images and SEO details to a fast static site, then lets you change it in a form, on the page or by asking, and check every change before it’s live.
    cta:
      label: Plan your move
      href: /docs/getting-started/wordpress/
    visual:
      kind: screen
      src: wordpress-plan
      fallback: arrange
      alt: "Galley’s “Bring your WordPress site” screen at its second step, “Here’s what comes across from Fernhill Garden Studio”: 12 posts, 6 pages, 18 images, 3 authors and 4 categories, and which collection each goes into."
    caption: The guided move, on an invented WordPress site brought into the Lowfield starter.
  - type: lists
    id: what-moves
    heading: What moves, and what doesn’t.
    text: The site is rebuilt in Astro, a tool for fast sites made of plain files.
    columns:
      - title: Moves across
        mark: insert
        points:
          - Posts and pages
          - Images
          - SEO titles, descriptions, canonical addresses
      - title: You rebuild
        mark: change
        points:
          - Page-builder pages, from sections
          - Forms, in the form builder
        note: Each arrives with a brief for the assistant.
      - title: Stays behind
        mark: delete
        points:
          - Plugin and theme updates
          - The database
          - A login on your live site
          - Security patches
      - title: Doesn’t come
        mark: stet
        points:
          - Shop
          - Memberships
          - Comments
        note: A Shopify storefront starter is in progress.
  - type: comparison
    id: compare
    heading: Galley and WordPress, side by side.
    text: Where WordPress does more, the table says so.
    caption: Galley compared with WordPress
    columns: [What differs, Galley, WordPress]
    rows:
      - label: Speed
        ours: Pages built ahead, served as files
        theirs: Usually built on each visit
        better: ours
      - label: Upkeep
        ours: Update when you choose
        theirs: Core, theme and plugins
        better: ours
      - label: Security
        ours: No database or login online
        theirs: Patches for core and plugins
        better: ours
      - label: Editing
        ours: Form, page or assistant, proofed
        theirs: Block editor or page builder
        better: even
      - label: Page building
        ours: Your own sections (preview)
        theirs: Mature builders, many widgets
        better: theirs
      - label: Forms
        ours: Built in, to your marketing tools
        theirs: Many form plugins
        better: even
      - label: Your content
        ours: Markdown files in your repository
        theirs: Rows in a database
        better: ours
      - label: Hosting
        ours: Static files, often free
        theirs: A PHP server and database
        better: ours
      - label: Extensions
        ours: A few plugins so far
        theirs: Thousands of plugins
        better: theirs
      - label: Maturity
        ours: "New: first released in 2026"
        theirs: Twenty years, thousands of plugins
        better: theirs
    note: WordPress and Elementor are trademarks of their owners, named only to describe them. Galley is not affiliated with either.
  - type: steps
    id: how
    heading: The move, in three steps.
    text: Each step lands as changes you check first.
    items:
      - title: Bring it across
        text: Give the app your site’s address. Everything arrives as changes, with a report.
        status: wordpress-guided
        visual:
          kind: screen
          src: wordpress-report
          fallback: proof-changes
          alt: "The import’s report, “Your WordPress site is here”, with five next steps: review it in Proof, rebuild the page-builder pages, set the redirects, put the site online, switch the domain."
      - title: Rebuild with sections
        text: The assistant rebuilds each page-builder page from your site’s own sections.
        status: builder
        visual:
          kind: screen
          src: arrange
          alt: Galley’s page builder on the Caddow starter — a section selected, its options and the section library beside it.
      - title: Proof and publish
        text: Check every page, publish, then switch your domain.
        visual:
          kind: screen
          src: proof-changes
          alt: The proof of a page, old words struck out and new ones written in.
  - type: faq
    id: questions
    heading: Questions people ask.
    items:
      - q: What is a good alternative to WordPress?
        a: "For a site that is mostly pages and posts, a static site with a Git-based CMS: the pages are built ahead of time and served as files, and the words live in your own repository. Galley is one, and moves the posts, pages, images and SEO details for you. If you need a shop, memberships or comments, WordPress or a dedicated platform may still be the better fit. [The three kinds of CMS](/compare/types-of-cms/)."
      - q: Can I keep editing the site myself after I leave WordPress?
        a: "Yes. In Galley you change a page in a form, by retyping words on the page, or by asking the assistant, and every change waits in Proof beside the live site until someone presses Publish. Publishing is a commit to your own repository, and any publish can be undone."
      - q: What happens to my search rankings when I move?
        a: "Nobody can promise rankings, but the move keeps what search engines read: descriptions come across, SEO titles and canonical addresses go into the site's own fields when it has them, and the report lists the old addresses that need redirects, which you review on the Redirects screen before anything goes live."
      - q: Can I use WordPress as a headless CMS instead?
        a: "You can. WordPress has a REST API, so a separate front end can read its content. You still run WordPress, its database and its updates behind that front end, which is the upkeep most people leaving want to be rid of. [Traditional, headless and Git-based, explained](/compare/types-of-cms/)."
      - q: Is a static site safer than WordPress?
        a: "There is less on the live site to attack and to patch: no database and no login page, because the pages are files built ahead of time. WordPress needs its core, theme and plugin updates kept up. A static site still needs a careful host and careful people; it is not a wall against someone determined."
      - q: How much does the move cost?
        a: "Galley is free and open-source, and the guided move is part of it. Static hosting is often free or cheap. Rebuilding page-builder pages with the assistant uses your own AI key, billed to you by its provider. The guided move is new and still in final checks."
  - type: close
    id: honest
    heading: Galley is new.
    text: Today the app runs on your computer or on a server you manage.
    actions:
      - label: Read the moving guide
        href: /docs/getting-started/wordpress/
      - label: Ways to run it
        href: /apps/
---
