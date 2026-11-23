---
# The section gallery's fixture: one example of every section type, in the
# order of galley.config.json. scripts/make-thumbnails.mjs photographs each
# one alone (galley/sections/<type>.webp). Keep the examples short enough
# to read in a 640-pixel picture, and keep one entry per type.
title: Section gallery
description: Every section type, rendered alone.
sections:
  - type: hero
    announcement:
      label: "New: inspections that work without signal"
      href: /changelog/
    heading: Every inspection planned, done and *proven*.
    text: Planned maintenance, inspections and contractor work for every site you run, in one schedule.
    cta:
      label: Book a demo
      href: /contact/
    secondaryCta:
      label: See pricing
      href: /pricing/
    items:
      - Live in four weeks
      - No per-user fees
  - type: hero-split
    heading: Every inspection planned, done and *proven*.
    text: One schedule for planned maintenance, inspections and contractor work, with the evidence attached.
    cta:
      label: Book a demo
      href: /contact/
    secondaryCta:
      label: See how it works
      href: /product/
    image: /images/product/dashboard.svg
    imageAlt: The Ferrow estate overview.
  - type: hero-form
    eyebrow: For maintenance contractors
    heading: Run every client's planned work from *one* schedule
    text: Keep each client's checklists and reports apart, and your engineers' week together.
    items:
      - A workspace per client
      - Evidence packs clients open themselves
    formHeading: Get a walkthrough
    form: demo
    note: We reply within one working day.
  - type: logos
    heading: Trusted by operations teams running 21,000 sites
    items:
      - name: Ostrell Logistics
        image: /images/logos/ostrell-logistics.svg
      - name: Wendmoor Senior Living
        image: /images/logos/wendmoor-senior-living.svg
      - name: Linmore Schools
        image: /images/logos/linmore-schools.svg
      - name: Pellow Hotels
        image: /images/logos/pellow-hotels.svg
      - name: Corrin Foods
        image: /images/logos/corrin-foods.svg
  - type: metrics
    tone: inverse
    eyebrow: In the first year
    heading: What changes when the schedule is in one place
    items:
      - value: 41%
        label: fewer overdue inspections
      - value: 3.5 h
        label: saved per site manager, each week
      - value: 2 days
        label: to prepare an audit
  - type: testimonial
    quote: I used to find out about a lapsed certificate from the inspector. Now I see it three months out.
    name: Dana Whitcombe
    role: Head of Estates
    company: Linmore Schools
    image: /images/people/dana-whitcombe.svg
    logo: /images/logos/linmore-schools.svg
  - type: testimonials
    tone: muted
    heading: Fewer surprises, by their own account
    items:
      - quote: Our first audit after moving to Ferrow took an afternoon.
        name: Dana Whitcombe
        role: Head of Estates
        image: /images/people/dana-whitcombe.svg
      - quote: The depots finally run the same checks the same way.
        name: Ellie Strand
        role: Operations Manager
        image: /images/people/ellie-strand.svg
      - quote: Our contractors update jobs themselves now.
        name: Teodor Rask
        role: Facilities Lead
        image: /images/people/teodor-rask.svg
  - type: case-studies
    heading: How teams like yours run Ferrow
    limit: 3
    cta:
      label: All customer stories
      href: /customers/
  - type: awards
    heading: Rated by the people who use it
    items:
      - label: Best for estates
        detail: Facilities Technology Review, 2026
        image: /images/awards/facilities-review.svg
      - label: Easiest to set up
        detail: Operations Software Survey
        image: /images/awards/easiest-setup.svg
      - label: Top-rated support
        detail: Customer Service Index, 2026
        image: /images/awards/support-index.svg
  - type: features
    eyebrow: What you get
    heading: The whole estate, in the shape you manage it
    style: cards
    items:
      - icon: shield
        heading: Compliance at a glance
        text: Statutory checks done on time, by site and standard.
      - icon: certificate
        heading: Certificates that never lapse
        text: Expiry dates tracked and forecast months ahead.
      - icon: users
        heading: Clear ownership
        text: A named owner for every task on every site.
  - type: feature-split
    eyebrow: Planned maintenance
    heading: Set the interval once. Ferrow keeps the calendar.
    items:
      - Templates for fire safety, water and HVAC
      - Intervals by time or meter reading
      - Workload by person, site and week
    image: /images/product/planner.svg
    imageAlt: The planner.
  - type: feature-tabs
    heading: From the plan to the proof
    items:
      - label: Plan
        heading: Every recurring task on one calendar
        text: Ferrow builds the schedule from the intervals you set and keeps it moving.
        image: /images/product/planner.svg
        imageAlt: The planner.
      - label: Inspect
        heading: Checklists on the phone
        text: Offline, with photos and readings.
        image: /images/product/inspection.svg
        imageAlt: An inspection on a phone.
      - label: Fix
        heading: Jobs routed to contractors
        text: With the asset history attached.
        image: /images/product/work-orders.svg
        imageAlt: The work order board.
      - label: Prove
        heading: A register for the auditor
        text: Every certificate filed against its asset.
        image: /images/product/evidence.svg
        imageAlt: The certificate register.
  - type: steps
    heading: Live on your estate in four weeks
    items:
      - heading: Import sites and assets
        text: Send your spreadsheets as they are.
      - heading: Build the schedules
        text: Templates, intervals and owners.
      - heading: Train the site teams
        text: One hour per region.
      - heading: Switch off the spreadsheets
        text: And export your first audit pack.
  - type: integrations
    heading: Fits the systems you already run
    items:
      - name: Single sign-on
        category: Identity
        icon: key
        text: SAML 2.0 and OpenID Connect
      - name: User provisioning
        category: Identity
        icon: directory
        text: SCIM 2.0
      - name: Finance export
        category: Finance
        icon: receipt
        text: Costs to your ledger
      - name: Purchase orders
        category: Finance
        icon: document
        text: From a work order
      - name: REST API
        category: Developers
        icon: code
        text: Every record, documented
      - name: Webhooks
        category: Developers
        icon: webhook
        text: Events as they happen
  - type: comparison
    heading: Ferrow next to the alternatives
    columns:
      - Ferrow
      - Spreadsheets
      - Job software
    items:
      - label: One schedule across all clients
        values: ["yes", "no", "yes"]
      - label: Works offline on site
        values: ["yes", "no", "partial"]
      - label: Clients see their own evidence
        values: ["yes", "no", "no"]
      - label: Priced per site
        values: ["yes", "Free", "no"]
  - type: use-cases
    heading: Built for the people who keep buildings running
    items:
      - icon: building
        label: In-house teams
        heading: Facilities teams
        text: One view of every site's compliance.
        href: /solutions/facilities-teams/
      - icon: truck
        label: Service providers
        heading: Contractors
        text: Planned work for many clients.
        href: /solutions/service-contractors/
      - icon: users
        label: In practice
        heading: Customer stories
        text: How teams run Ferrow day to day.
        href: /customers/
  - type: screenshot
    image: /images/product/dashboard.svg
    imageAlt: The Ferrow estate overview.
    caption: Every site's compliance, this week's work and what is overdue.
    width: normal
  - type: pricing
    heading: Priced per site. Everyone included.
    items:
      - name: Essentials
        price: $9
        period: per site / month
        features:
          - Planned maintenance
          - Offline mobile app
          - Unlimited users
        cta:
          label: Start
          href: /contact/
      - name: Professional
        price: $16
        period: per site / month
        featured: true
        badge: Most chosen
        features:
          - Everything in Essentials
          - Contractor portal
          - Audit packs
        cta:
          label: Book a demo
          href: /contact/
      - name: Enterprise
        price: Custom
        features:
          - Everything in Professional
          - SCIM and audit log
          - Data residency
        cta:
          label: Talk to sales
          href: /contact/
  - type: pricing-table
    heading: Everything in each plan
    plans:
      - Essentials
      - Professional
      - Enterprise
    items:
      - heading: Planning
        rows:
          - label: Planned maintenance
            values: ["yes", "yes", "yes"]
          - label: Meter-based intervals
            values: ["no", "yes", "yes"]
      - heading: Contractors
        rows:
          - label: Work orders
            values: ["partial", "yes", "yes"]
          - label: Contractor portal
            values: ["no", "yes", "yes"]
          - label: Support
            values: ["Email", "Phone", "Named manager"]
  - type: faq
    heading: What estates teams ask us
    items:
      - question: Can we bring our existing asset register?
        answer: Yes. Send it as it is and we map it into Ferrow.
      - question: Do site staff need training?
        answer: Most people are inspecting after a one-hour session.
      - question: What happens to our data if we leave?
        answer: Export everything, any time, in open formats.
  - type: rich-text
    eyebrow: Our story
    heading: Why Ferrow exists
    text: |
      A facilities manager with forty buildings and an engineer who had written one too many spreadsheet macros asked a simple question: *why is the plan in one place and the proof in another?*

      **One schedule, the evidence attached to the work, and nothing that depends on one person remembering.**
  - type: posts
    heading: From the blog
    limit: 3
    cta:
      label: All articles
      href: /blog/
  - type: changelog
    heading: Shipped recently
    limit: 3
    cta:
      label: Full changelog
      href: /changelog/
  - type: team
    heading: The people accountable for Ferrow
    style: compact
  - type: security
    heading: What we do to keep your data safe
    badges:
      - Encrypted in transit and at rest
      - Data hosted in your region
    items:
      - icon: lock
        heading: Encryption everywhere
        text: TLS 1.2+ in transit, AES-256 at rest.
      - icon: key
        heading: Access you control
        text: Single sign-on and roles per site.
      - icon: sync
        heading: Tested backups
        text: Kept for 35 days, restored monthly.
  - type: cta
    heading: See your estate in Ferrow in thirty minutes
    text: Send us a list of your sites; we will show you the schedule Ferrow would build.
    cta:
      label: Book a demo
      href: /contact/
    secondaryCta:
      label: See pricing
      href: /pricing/
  - type: contact
    heading: Talk to a person who knows buildings
    text: We reply within one working day.
    form: contact
    items:
      - label: Sales
        value: sales@example.com
        href: mailto:sales@example.com
      - label: Support
        value: support@example.com
        href: mailto:support@example.com
  - type: newsletter
    heading: One email a month about running buildings well
    text: New guides and product updates. No sales emails.
    form: newsletter
  - type: form
    eyebrow: Request a walkthrough
    heading: See your estate in Ferrow
    text: Thirty minutes with a product specialist. We reply within one working day.
    form: demo
---
