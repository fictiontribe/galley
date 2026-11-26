---
title: Section gallery
description: One short example of every section type, for scripts/make-thumbnails.mjs.
sections:
  - type: intro
    layout: portrait
    image: /images/people/ines-calloway.webp
    imageAlt: Ines Calloway on the stairs with a notebook.
    eyebrow: A notebook from a 1930s semi
    heading: Making an old house warm, cheap to run and *a third as hungry*.
    text: Every meter reading, every quote and every mistake.
    cta: { label: Start with the numbers, href: /blog/ }
    secondaryCta: { label: About the house, href: /about/ }
  - type: featured
    more: 3
  - type: posts
    eyebrow: Lately
    heading: More from the notebook
    limit: 3
    cta: { label: Everything, href: /blog/ }
  - type: topics
    eyebrow: Topics
    heading: What Sarking writes about
  - type: series
    eyebrow: Read in order
    heading: Series
  - type: author
    author: ines-calloway
    heading: Who writes it
  - type: newsletter
    heading: Get the next post by email
    text: About once a month. Never more than twice.
  - type: rich-text
    layout: margin
    eyebrow: The house
    heading: What I started with
    text: A three-bedroom semi, built in 1934, with solid brick walls, a hipped clay-tile roof and single-glazed sashes at the back. It used 19,960 kWh in its first year with me.
  - type: image
    image: /images/blog/street.webp
    imageAlt: A street of 1930s semis at dusk.
    ratio: panorama
    caption: The street. Ours is the fourth bay from the left.
  - type: cta
    heading: Get the next post by email
    text: One letter a month, the day a post goes up.
    cta: { label: Subscribe, href: /subscribe/ }
    secondaryCta: { label: RSS feed, href: /rss.xml }
  - type: contact
    heading: Write to Sarking
    text: Corrections are the most useful thing you can send.
    items:
      - { label: Email, value: hello@example.com, href: "mailto:hello@example.com" }
  - type: chart
    chart: line
    title: Monthly energy use, 2023 and 2025
    labels: [Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec]
    series:
      - { name: "2023", values: [2900, 2600, 2200, 1500, 900, 600, 550, 560, 800, 1500, 2200, 2800] }
      - { name: "2025", values: [980, 860, 700, 450, 300, 240, 230, 235, 290, 480, 760, 940] }
    highlight: "2025"
    unit: kWh
  - type: compare
    title: Four ways to heat the house
    columns: [Gas boiler, Heat pump, Hybrid, Storage heaters]
    highlight: 2
    badge: Our pick
    rows:
      - { label: Price after grants, values: ["£2,900", "£3,600", "£5,800", "£4,200"] }
      - { label: Cost a year, values: ["£1,040", "£760", "£930", "£2,150"] }
      - { label: Lower carbon, values: ["no", "yes", "partly", "partly"] }
  - type: stats
    title: Then and now
    items:
      - { value: "19,960", label: kWh a year in 2022 }
      - { value: "6,465", label: kWh in 2025, change: "−68%", trend: good }
      - { value: "£1,190", label: running cost in 2025, change: "−£1,220", trend: good }
  - type: timeline
    title: What was done, when
    items:
      - { date: Mar 2023, title: Draughts, text: Twelve small fixes for £214. }
      - { date: Jun 2023, title: Loft, text: 300 mm of sheep's wool. }
      - { date: Jul 2024, title: Heat pump, text: A 7 kW air-source unit. }
  - type: faq
    title: Questions people ask
    items:
      - { question: Are the numbers real?, answer: In this template, no — the blog is invented. }
      - { question: Do you take money from installers?, answer: No. Nothing here is sponsored. }
  - type: pullquote
    quote: The letterbox, on the screen, looked like a small window left open all winter.
    name: Ines Calloway
  - type: gallery
    columns: 3
    items:
      - { image: /images/blog/loft.webp, imageAlt: Wool insulation in the loft., caption: The loft, day two. }
      - { image: /images/blog/hallway.webp, imageAlt: The tiled hallway., caption: The hallway, after. }
      - { image: /images/blog/window.webp, imageAlt: A sash window with secondary glazing., caption: Secondary glazing. }
---
