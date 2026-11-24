---
title: Tour of the app
description: What Galley looks like, screen by screen — changing a page, Proof and Publish, building pages, forms, scripts, redirects, the brand, search checks, going online and moving from WordPress.
sections:
  - type: hero
    layout: text
    heading: See the whole app.
    demo: Or try it yourself, in the demo
    text: Every picture here is a capture of Galley, most of them on Caddow — a fashion label we made up. Open any one to see it full size.
  - type: tour
    id: change
    label: Change a page
    heading: Change a page.
    text: Three ways in. Each ends the same way, as a change waiting in Proof.
    items:
      - id: form
        layout: full
        heading: In the form
        text: Every field of the page in the site’s own words, beside the page itself. An edit is saved as you type and marked Edited.
        status: edit
        howto: change-a-page
        guide: /docs/editing/form/
        visual:
          src: form
          alt: The editor on Caddow’s home page — the page’s form on the left with the Campaign hero section open and its Heading, “Coats for low sun.”, marked Edited beside a Put back button, and the page itself on the right, scrolled to a photograph of the workroom above the Journal heading, Marrowby notes.
        inset:
          src: form
          x: -16
          y: -455
          w: 336
          h: 340
          alt: A close look at the form — the Campaign hero section with 2 edits, and its Heading field marked Edited, with Put back, holding “Coats for low sun.”
      - id: on-the-page
        layout: half
        heading: On the page
        text: Click the words where they sit and type over them. When the same words come from two places, it asks which one you meant.
        howto: edit-on-the-page
        guide: /docs/editing/on-the-page/
        visual:
          src: click
          y: -180
          alt: The Caddow home page in the editor with Click to edit chosen — the heading over four knitwear photographs retyped in place to “Coats and knits to start with”, outlined in blue.
      - id: assistant
        layout: half
        heading: By asking
        text: Ask for a change in plain words. The assistant says exactly what it changed, and Undo puts it back.
        howto: ask-the-assistant
        guide: /docs/editing/assistant/
        visual:
          src: assistant
          x: -700
          y: -90
          alt: The assistant beside the Caddow home page — the request to change the campaign heading and its first button, the lines Read the home page and Edited the home page, the reply saying what changed, that the button still goes to the same lookbook and that the changes wait in Proof, a note about the italics, and the buttons Review in Proof and Undo this change.
      - id: dark
        layout: wide
        whenPictured: true
        heading: Light or dark
        text: The whole app comes in light and dark. One click at the foot of the sidebar switches it.
        visual:
          src: dark-editor
          y: -380
          alt: The editor in the dark theme on Caddow’s home page — the page’s form on the left with Campaign hero showing 2 edits, the page in the middle with the new heading Coats for low sun., and on the right the assistant’s reply saying what it changed, with Review in Proof and Undo this change; the theme switch sits at the foot of the sidebar.
  - type: tour
    id: check
    label: Check and publish
    heading: Check and publish.
    text: Nothing is live until someone presses Publish, and a publish can be undone.
    items:
      - id: proof
        layout: wide
        heading: Proof
        text: Every change waiting, in the site’s own words — the old struck out, the new written in. Put back any one.
        status: proof
        howto: proof-and-publish
        guide: /docs/editing/proof-and-publish/
        visual:
          src: proof-changes
          alt: Proof for the Caddow home page, What changed — “Coats for the long afternoon.” struck out and “Coats for low sun.” written in, “See the lookbook” changed to “See the eight looks”, and “begin” changed to “start” in the Pieces heading, each with Put back.
      - id: publish
        layout: flip
        ratio: 5/4
        heading: Publish
        text: A one-line note for the version history, a list of what goes, and one button. Untick anything you’d rather keep back.
        status: publish
        howto: proof-and-publish
        guide: /docs/editing/proof-and-publish/
        visual:
          src: publish
          x: -440
          y: -170
          alt: The Publish 3 changes? window over Proof — a suggested one-line note for version history, the three pages that go, each ticked (Home page, Journal, The atelier), the name the version is recorded under, and the buttons Not yet and Publish 3 changes.
      - id: history
        layout: full
        heading: Version history
        text: Every published version, newest first, with who published it and when. Undoing one adds a new version, so nothing is erased.
        guide: /docs/editing/history/
        visual:
          src: history
          x: -345
          y: -100
          alt: Version history for Caddow, newest first — the latest version, marked Latest and Published here, with Put this site online and Undo this publish, and the earlier ones below it (an old link fixed, care notes, the brand written down, a phone number on the workroom form), each with who published it, when, and its own Undo this publish.
  - type: tour
    id: build
    label: Build pages
    heading: Build pages.
    text: Put a page together from the site’s own sections, on the page itself.
    items:
      - id: arrange
        layout: flip
        heading: Arrange
        text: Drag a section from the panel onto the page, move it, switch its options. Every move offers Undo and waits in Proof.
        status: builder
        howto: build-a-page
        guide: /docs/editing/page-builder/
        visual:
          kind: recording
          src: arrange-drag
          alt: A Newsletter section found in the section library and dragged onto the Caddow home page, dropped under the campaign photograph.
  - type: tour
    id: run
    label: Run the site
    heading: Run the site.
    text: Forms, scripts, redirects, the brand and search checks live in the same app — and changing them is a change like any other.
    items:
      - id: forms
        layout: full
        heading: Forms and the inbox
        text: Build a form, then choose where it sends — HubSpot, Marketo, Salesforce, Pardot, a webhook, or the app’s own inbox.
        status: forms
        howto: add-a-form
        guide: /docs/editing/forms/
        visual:
          src: forms
          x: -290
          alt: The Forms screen for Caddow — three forms, Become a stockist, Caddow letters and Write to the workroom, each sending to the Inbox, with their number of fields and the page each is used on, under a note about where the live site should send submissions.
        inset:
          src: inbox
          x: -901
          y: -263
          w: 476
          h: 330
          alt: One submission open in the Inbox — Corin Vale, asking about a repair, with every answer beside its label.
      - id: scripts
        layout: half
        heading: Scripts, with consent
        text: Google Analytics, Tag Manager and others, chosen from a list. With the built-in banner, each loads only after the visitor agrees.
        status: scripts
        howto: add-analytics
        guide: /docs/editing/scripts/
        visual:
          src: scripts
          x: -820
          y: -290
          alt: Scripts for Caddow — Plausible switched off and Google Analytics 4 switched on, both marked Analytics, and beside them the built-in consent banner set to ask visitors first, with its words — Counting visits, Count my visit, Don’t count it.
      - id: media
        layout: half
        heading: Images and video
        text: Upload pictures, video and documents, or make an image from a description and save it to the site’s media.
        status: plugins
        guide: /docs/editing/media/
        visual:
          src: media
          x: -290
          y: -60
          alt: Media for Caddow — the site’s photographs with their sizes, filters for images, videos and documents, and the buttons Upload, Generate a video and Generate an image.
      - id: redirects
        layout: flip
        heading: Redirects
        text: Paste a whole list. Loops, chains and doubles are caught before anything is added, and the host’s redirect file stays in step.
        status: redirects
        howto: bulk-redirects
        guide: /docs/editing/redirects/
        visual:
          src: redirects-review
          x: -240
          y: -88
          alt: The Add many redirects window over the Redirects screen — eleven pasted lines on the left; on the right, Understood 11 lines with 10 new, a loop caught (/workroom/ to /our-workroom/ and back) with Leave them out, one new address not found on the site, and one duplicate.
        inset:
          src: redirects-try
          x: -1061
          y: -521
          w: 316
          h: 164
          alt: Try an address on the Redirects screen — /about-us/ goes to /atelier/, Permanent 301, and ends on “The atelier”.
      - id: brand
        layout: wide
        heading: The brand
        text: Read from the site itself, or from guidelines, logos and screenshots — colours, type, logo and voice, each saying where it came from.
        status: brand
        howto: set-up-brand
        guide: /docs/editing/brand/
        visual:
          src: brand-proposal
          x: -290
          y: -64
          alt: The brand proposal for Caddow, read from the site — Nothing is saved yet with Save the brand, Worth a look notes on near-identical greys and text contrast, and the first colours, Lime-wash, Chalk white, Plaster and Ink, each marked Measured or Declared, some with where in the styles they were found.
        inset:
          src: brand-voice
          x: -505
          y: -178
          w: 470
          h: 232
          alt: "The Voice part of the proposal — rules drawn from the site’s own words, each quoting the page it came from, with a line to avoid struck out and the site’s way written in: “Our coats are made in exclusive limited runs” becomes “Forty of each, cut by one cutter in a month.”"
      - id: search
        layout: flip
        heading: Search and AI checks
        text: Titles, headings, images, links, indexing and structured data, checked in plain words. Fixes that are certain land in Proof.
        status: checks
        howto: search-and-ai
        guide: /docs/editing/search-and-ai/
        visual:
          src: search-ai
          x: -290
          y: -64
          alt: Search & AI for Caddow — 1 must fix, 1 should fix and 2 ideas; Titles & descriptions in good shape, a should-fix about example addresses left in, and on the right how AI systems see the site.
  - type: tour
    id: live
    label: Go live and grow
    heading: Go live and grow.
    text: A real address for the site and, if you want one, for its editor and its team; every site you look after, on your desktop; and a way out of WordPress.
    items:
      - id: online
        layout: full
        heading: Put it online
        text: A real address on Cloudflare in four steps — even for a site that so far lives only on your computer. Then your own domain, if you have one; Cloudflare answers it with the site.
        status: deploy-cloudflare
        howto: put-online
        guide: /docs/editing/online/
        note: Pictured against a stand-in for Cloudflare, with made-up addresses.
        visual:
          src: online-domain
          x: -330
          y: -120
          alt: Use your own domain, over the Online screen — the address www.caddow.example, and the note that Cloudflare will answer it with this site and set up its certificate, while nothing else on caddow.example changes; behind it, the site live at caddow.example-studio.workers.dev.
        inset:
          src: online-live
          x: -390
          y: -209
          w: 470
          h: 218
          alt: The Online screen afterwards — www.caddow.example with its Copy button, Live and updated just now, on Cloudflare in the project caddow, marked as your own address.
      - id: editor-online
        layout: flip
        ratio: 5/4
        heading: The editor, online
        text: Edit the site from any browser. The app puts an editor for it on your own Fly.io account, in your Google Cloud project, on Cloudflare in front of a computer of yours, or on a server with Docker — and shows what it will create and what it costs a month before anything exists.
        status: editor-online
        guide: /docs/editing/editor-online/
        note: Pictured against a stand-in for Fly.io, with made-up addresses; nothing was created.
        visual:
          src: editor-online-plan
          x: -350
          y: -230
          alt: Host the editor online, step 5 of 5, Check the plan — what would be created on Fly.io (the editor’s app, two addresses, a 3 GB disk, a computer with 2 GB of memory that sleeps while nobody uses it, three certificates for cms.caddow.example and its preview and live names), and What it costs, up to about $13 a month and usually much less, with each line and where the prices were read; then Back and Create the editor.
        inset:
          src: editor-online
          x: -390
          y: -520
          w: 470
          h: 142
          alt: The Online screen’s Editor online section — edit this site from any browser, not just this computer; the editor runs on your own account with a host, with its own password — and the button Host the editor online.
      - id: hosted
        layout: wide
        heading: One editor per site, on your own server
        text: A hosted install is the same app on a server, for one site, with an account for each person who edits it and everything it keeps in one folder. It runs with Docker on your own server; Fiction Tribe hosts nothing.
        status: hosted-install
        guide: /docs/running/hosted/
        note: Pictured on a test install on one computer, before any site was connected.
        visual:
          src: hosted-first-run
          x: -344
          y: -150
          alt: A hosted install’s first run, step 2 of 3, Connect the site — a repository that already holds the site, or a starter sent to an empty one; the repository’s address; and how the editor reaches it, with its own key (recommended), shown to be added to the repository with write access, or an access token from the code host.
      - id: people
        layout: full
        whenPictured: true
        heading: People and roles
        text: Owners invite everyone else with a one-time link, as an owner, an editor or a contributor. Contributors change the content and see Proof; editors and owners publish; and each publish carries the name of the person who made it.
        status: hosted-accounts
        guide: /docs/running/hosted/#people-and-roles
        visual:
          src: people
          x: -272
          y: -20
          alt: The Install page of a hosted editor, open at People, signed in as Tobiah Rusk — three people listed with their role and when they last signed in, Tobiah Rusk (Owner, marked You), Ines Marrow (Editor) and Corin Vale (Contributor), and below them Invite someone, with an e-mail box, the roles Owner, Editor and Contributor with what each can do, and the Invite button.
        inset:
          src: invite
          x: -450
          y: -306
          w: 540
          h: 290
          alt: A window over the People list titled An invitation for hesper@caddow.example — send this link yourself, the one-time join link with a Copy link button, and a note that it works once, stops working in 7 days and isn’t shown again.
      - id: sites
        layout: flip
        heading: Many sites, one app
        text: Every site you look after in one list, filed by client, each card saying what it is waiting on — changes, unread submissions, versions not yet live.
        status: agencies
        guide: /docs/editing/many-sites/
        visual:
          src: sites
          x: -290
          alt: Your sites — two groups, Caddow Ltd and Fernhill Garden Studio, each holding its site’s card; Caddow’s shows 3 unread, 3 changes and Preview running with a note about its contact, Lowfield’s 38 changes; above them search, Every group and Needs attention · 2.
        inset:
          src: site-home
          x: -266
          y: -366
          w: 480
          h: 238
          alt: Site home for Caddow, Waiting to publish — three pages edited since the last publish, the home page, Journal and The atelier, with Review changes.
      - id: desktop
        layout: wide
        heading: On your desktop
        text: The same app in its own window, for every site you look after — for Mac, Windows and Linux. The Mac app is signed and notarised by Apple, so it opens like any other app.
        link:
          label: See the apps
          href: /apps/
        visual:
          src: desktop-mac-home
          alt: The Galley app on a Mac, in a window titled Caddow — the site’s home screen, with a box to ask for a change, one change waiting to publish, the site live at www.caddow.example, and its pages, lookbooks, journal and forms listed.
      - id: wordpress
        layout: wide
        heading: Move from WordPress
        text: Posts, pages, images and search details come across in four steps, as changes you check before anything goes live.
        status: wordpress-guided
        howto: move-from-wordpress
        guide: /docs/editing/wordpress/
        note: Pictured with a stand-in WordPress site running on the same computer, hence the 127.0.0.1 address.
        visual:
          src: wordpress-where
          y: -90
          alt: The first of four steps, Where is your WordPress site? — the address http://127.0.0.1:4792 checked as Fernhill Garden Studio, with 12 posts, 6 pages, 18 images and files, and 37 comments that stay behind, and the Continue button.
        inset:
          src: wordpress-report
          x: -105
          y: -95
          w: 440
          h: 230
          alt: The fourth step, the report — Your WordPress site is here, then the next steps, Review it in Proof, Rebuild the page-builder pages, Set the redirects, Put the site online, Switch the domain.
  - type: close
    id: start
    heading: Try it on your own site.
    text: Run this in your site’s folder and Galley opens in your browser. The how-to guides take each job a step at a time.
    commands: true
    actions:
      - label: How-to guides
        href: /how-to/
      - label: Read the quickstart
        href: /docs/getting-started/quickstart/
---
