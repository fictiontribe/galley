---
title: Tour of the app
description: What Galley looks like, screen by screen — changing a page, Proof and Publish, building pages, forms, scripts, redirects, the brand, search checks, going online and moving from WordPress.
sections:
  - type: hero
    layout: text
    heading: See the whole app.
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
          alt: The form beside the Caddow home page, its campaign section open and the edited heading marked.
        inset:
          src: docs/form-field-edited
          alt: A section’s Heading field just after an edit, with a green Edited mark and a Put back button beside its label.
      - id: on-the-page
        layout: half
        heading: On the page
        text: Click the words where they sit and type over them. When the same words come from two places, it asks which one you meant.
        howto: edit-on-the-page
        guide: /docs/editing/on-the-page/
        visual:
          src: click
          y: -150
          alt: On the Caddow page, the heading over four knitwear photographs retyped in place to “Coats and knits to start with”, outlined in blue.
      - id: assistant
        layout: half
        heading: By asking
        text: Ask for a change in plain words. The assistant says exactly what it changed, and Undo puts it back.
        howto: ask-the-assistant
        guide: /docs/editing/assistant/
        visual:
          src: assistant
          x: -520
          alt: The assistant’s reply beside the Caddow page after changing the campaign heading and its first button, with Review in Proof and Undo this change beneath.
  - type: tour
    id: check
    label: Check and publish
    heading: Check and publish.
    text: Nothing is live until someone presses Publish, and a publish can be undone.
    items:
      - id: proof
        layout: full
        heading: Proof
        text: Every change waiting, in the site’s own words — the old struck out, the new written in. Put back any one.
        status: proof
        howto: proof-and-publish
        guide: /docs/editing/proof-and-publish/
        visual:
          src: proof-changes
          alt: Galley’s proof of the Caddow home page — “Coats for the long afternoon.” struck out and “Coats for low sun.” written in, the button “See the lookbook” renamed “See the eight looks”, and “begin” changed to “start” in a heading.
      - id: publish
        layout: half
        heading: Publish
        text: A one-line note for the version history, a list of what goes, and one button. Untick anything you’d rather keep back.
        status: publish
        howto: proof-and-publish
        guide: /docs/editing/proof-and-publish/
        visual:
          src: docs/publish-dialog
          alt: The Publish 3 changes? window — a suggested note for version history, three ticked changes under What goes, and the buttons Not yet and Publish 3 changes.
      - id: history
        layout: half
        heading: Version history
        text: Every published version, newest first, with who published it and when. Undoing one adds a new version, so nothing is erased.
        guide: /docs/editing/history/
        visual:
          src: docs/history
          alt: Version history for Caddow — the newest version, by Sam Okafor, marked Latest and Published here, with an Undo this publish button, and the first version below it.
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
          alt: A newsletter section found in the section library, dragged onto the Caddow page and dropped under the campaign photograph.
  - type: tour
    id: run
    label: Run the site
    heading: Run the site.
    text: Forms, scripts, redirects, the brand and search checks live in the same app — and changing them is a change like any other.
    items:
      - id: forms
        layout: wide
        heading: Forms and the inbox
        text: Build a form, then choose where it sends — HubSpot, Marketo, Salesforce, Pardot, a webhook, or the app’s own inbox.
        status: forms
        howto: add-a-form
        guide: /docs/editing/forms/
        visual:
          src: docs/form-builder
          alt: The form builder on Caddow’s Write to the workroom form — field types on the left, the form as visitors see it in the middle, its name, button text and appearance on the right.
        inset:
          src: docs/inbox
          alt: The Inbox for Caddow — one test submission open, every answer with its label, and the buttons Mark unread, Spam and Delete.
      - id: scripts
        layout: half
        heading: Scripts, with consent
        text: Google Analytics, Tag Manager and others, chosen from a list. With the built-in banner, each loads only after the visitor agrees.
        status: scripts
        howto: add-analytics
        guide: /docs/editing/scripts/
        visual:
          src: docs/scripts-add-ga4
          alt: The Add Google Analytics 4 window with a measurement ID filled in, and what is already chosen — loads straight away, in the page head, waits for consent to analytics, on every page.
      - id: media
        layout: half
        heading: Images and video
        text: Upload pictures, video and documents, or make an image from a description and save it to the site’s media.
        status: plugins
        guide: /docs/editing/media/
        visual:
          src: docs/media-generate
          alt: The Generate an image window — a description of a wool coat on a hook, two candidate pictures, a name for the chosen one and the Save to media button.
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
          alt: The brand proposal for Caddow, read from the site — Nothing is saved yet with Save the brand, Worth a look notes on near-identical greys and text contrast, and the first colours, Lime-wash, Paper white, Chalk grey and Ink, each marked Measured or Declared with where it was found.
        inset:
          src: brand-material
          x: -485
          y: -243
          w: 560
          h: 222
          alt: The material the brand was also read from — caddow-brand-notes.pdf, two pages, with the note that the colours on page 1 are current, and caddow-wordmark.png, each kept outside the site.
      - id: search
        layout: flip
        heading: Search and AI checks
        text: Titles, headings, images, links, indexing and structured data, checked in plain words. Fixes that are certain land in Proof.
        status: checks
        howto: search-and-ai
        guide: /docs/editing/search-and-ai/
        visual:
          src: docs/search-and-ai
          alt: Search & AI for Caddow — counts of Must fix, Should fix and Ideas, the findings in groups, and the AI crawlers panel on the right.
  - type: tour
    id: live
    label: Go live and grow
    heading: Go live and grow.
    text: A real address, every site you look after, and a way out of WordPress.
    items:
      - id: online
        layout: wide
        heading: Put it online
        text: A real address on Cloudflare in four steps — even for a site that so far lives only on your computer. Your own domain is added at the host.
        status: deploy-cloudflare
        howto: put-online
        guide: /docs/editing/online/
        visual:
          src: docs/online-setup
          alt: Step 1 of 4 of Put this site online — Cloudflare, marked Recommended, and Vercel, each with a line about what it suits, and the buttons Not now and Continue.
      - id: sites
        layout: flip
        heading: Many sites, one app
        text: Every site you look after in one list, filed by client, each card saying what it is waiting on — changes, unread submissions, versions not yet live.
        status: agencies
        guide: /docs/editing/many-sites/
        visual:
          src: docs/sites
          alt: Your sites — a group called Caddow Ltd holding the Caddow site’s card with the chips 8 changes and Preview running and a note, above it the search box, Needs attention and the Add sites button.
      - id: wordpress
        layout: full
        heading: Move from WordPress
        text: Posts, pages, images and search details come across in four steps, as changes you check before anything goes live.
        status: wordpress-guided
        howto: move-from-wordpress
        guide: /docs/editing/wordpress/
        visual:
          src: wordpress-plan
          alt: "The move’s second step, “Here’s what comes across from Fernhill Garden Studio”: 60 posts, 12 pages, 84 images, 3 authors and 4 categories, and which collection each goes into."
        inset:
          src: wordpress-report
          alt: "The report at the end, “Your WordPress site is here”, with five next steps: review it in Proof, rebuild the page-builder pages, set the redirects, put the site online, switch the domain."
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
