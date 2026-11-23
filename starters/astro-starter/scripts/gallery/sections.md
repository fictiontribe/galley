---
# The section gallery's fixture: one example of every section type, in the
# order of galley.config.json. scripts/make-thumbnails.mjs photographs each
# one alone (galley/sections/<type>.webp). Keep the examples short enough
# to read in a 640-pixel picture, and keep one entry per type.
title: Section gallery
description: Every section type, rendered alone.
sections:
  - type: hero
    eyebrow: Architecture & renovation
    heading: Make more of the *home you already have*.
    text: Extensions, loft conversions and garden rooms for houses that are good — and could be better.
    cta:
      label: Book a free first visit
      href: /contact/
    secondaryCta:
      label: See how we work
      href: /services/
    image: /images/projects/hero-house.svg
    imageAlt: Abstract drawing of a brick house with a timber extension
  - type: logos
    heading: Trusted by neighbours, builders and the odd parish council
    items:
      - name: Millbrook Timber
        image: /images/logos/millbrook-timber.svg
      - name: Hartwell Glass
        image: /images/logos/hartwell-glass.svg
      - name: Ostler Lime Co.
        image: /images/logos/ostler-lime.svg
      - name: Wrenhallow Civic Society
        image: /images/logos/wrenhallow-civic.svg
  - type: features
    eyebrow: What we do
    heading: Three ways we usually help
    columns: 3
    items:
      - icon: home
        heading: Extensions
        text: Side returns and rear extensions that bring in light without swallowing the garden.
      - icon: layers
        heading: Loft conversions
        text: Dormers and rooflights, with a stair that arrives somewhere you want to be.
      - icon: leaf
        heading: Garden rooms
        text: Studios and workshops at the end of the garden, built to last.
  - type: split
    eyebrow: How we are different
    heading: Drawings you can understand before you build
    text: Every project starts with a measured survey and plain-English sketches.
    items:
      - A measured survey of the whole house
      - Three sketch options with honest cost ranges
    image: /images/projects/kitchen-extension.svg
    imageAlt: Abstract drawing of a kitchen extension with a rooflight
    cta:
      label: Our fees
      href: /pricing/
  - type: stats
    tone: inverse
    eyebrow: Twelve years in Wrenhallow
    heading: Small studio, long memory
    items:
      - value: "140+"
        label: Homes designed
      - value: "96%"
        label: Planning approvals
      - value: "4"
        label: People in the studio
      - value: "1 hr"
        label: First visit, free
  - type: steps
    eyebrow: The process
    heading: From first visit to final snag list
    items:
      - heading: First visit
        text: An hour at your home, listening and looking.
      - heading: Survey and sketches
        text: We measure the house and draw three options.
      - heading: Design and planning
        text: We develop one scheme and submit the application.
  - type: testimonial
    tone: accent
    quote: They found us a whole extra bedroom without touching the garden.
    name: Hannah & Dev Mistry
    role: Loft conversion, Orchard Street
    image: /images/people/client-mistry.svg
    imageAlt: Portrait illustration of Hannah and Dev Mistry
  - type: testimonials
    eyebrow: Kind words
    heading: From people who have lived through it
    items:
      - quote: The drawings were so clear our builder priced them in a week.
        name: Ruth Calloway
        role: Kitchen extension
      - quote: Nell talked us out of the expensive option and into a better one.
        name: Marcus Bell
        role: Whole-house renovation
      - quote: The garden studio is the best room we own.
        name: Ines & Pablo Ferreira
        role: Garden room
  - type: pricing
    heading: Choose how much help you want
    items:
      - name: First visit
        price: Free
        features:
          - A conversation, not a sales pitch
          - A short written note afterwards
        cta:
          label: Book a visit
          href: /contact/
      - name: Design & planning
        price: £3,800
        period: from, plus VAT
        featured: true
        badge: Most chosen
        features:
          - Measured survey
          - Planning application
        cta:
          label: Start with a visit
          href: /contact/
      - name: Full service
        price: £9,500
        period: from, plus VAT
        features:
          - Technical drawings
          - Site visits to completion
        cta:
          label: Talk it through
          href: /contact/
  - type: faq
    eyebrow: Questions
    heading: Things people ask at the first visit
    items:
      - question: Do I need planning permission?
        answer: It depends on the house and the change. We will tell you which route applies at the first visit.
      - question: How long does it all take?
        answer: For a typical extension, allow two to three months for design and four to six on site.
      - question: Can you recommend a builder?
        answer: We can introduce you to builders we trust, and we never take a commission.
  - type: gallery
    eyebrow: Recent work
    heading: Some houses we have helped
    columns: 3
    items:
      - image: /images/gallery/arched-doorway.svg
        imageAlt: Abstract composition of a tall arched doorway
        caption: Garden doors, Weaver's Row
      - image: /images/gallery/stair.svg
        imageAlt: Abstract composition of a timber stair
        caption: Loft stair, Orchard Street
      - image: /images/gallery/window-seat.svg
        imageAlt: Abstract composition of a window seat framed in oak
        caption: Window seat, Hill Terrace
  - type: team
    eyebrow: The team
    heading: The four of us
    columns: 4
  - type: posts
    eyebrow: From the journal
    heading: Notes from the drawing board
    limit: 3
    cta:
      label: All posts
      href: /blog/
  - type: rich-text
    heading: Finding the studio
    text: |-
      We are on the ground floor of the old tannery, at the end of the cobbled yard behind the market hall.

      - **By train** — two minutes from the station.
      - **By bike** — racks in the yard.
  - type: cta
    heading: Tell us about your house.
    text: The first visit is free and there is no obligation.
    cta:
      label: Book a first visit
      href: /contact/
    secondaryCta:
      label: Call the studio
      href: tel:01632960418
  - type: contact
    eyebrow: Contact
    heading: Tell us about your *home*.
    text: A few lines are plenty. We reply within two working days.
    form: contact
    items:
      - label: Email
        value: hello@example.com
        href: mailto:hello@example.com
      - label: Phone
        value: 01632 960 418
        href: tel:01632960418
  - type: form
    eyebrow: Fee proposal
    heading: Ask for a *fixed quote*
    text: Tell us about the house and the work you have in mind.
    form: contact
    layout: split
---
