---
title: AI-first websites
description: A website people and AI assistants can both read. Your pages are already plain files in git; Galley's site kit adds a script-free copy of every page for AI agents, and its checks find what search engines and assistants miss.
sections:
  - type: hero
    layout: split
    heading: A website people and AI assistants can both read.
    text: Your pages are already plain files in git. Galley’s site kit adds a script-free copy of every page for AI agents, and its checks find what search engines and assistants miss.
    cta:
      label: Read this page as an agent does
      href: /ai-first.md
    secondary:
      label: Open /llms.txt
      href: /llms.txt
    visual:
      kind: file
      src: /ai-first.md
      alt: This page’s markdown copy, served at /ai-first.md — the same words, no scripts or layout.
  - type: status
    id: today
    heading: What’s in it today.
    only: [mcp, checks, twins, crawlers]
    groups: [built, new, progress]
  - type: split
    id: twins
    heading: This site does it already.
    text: Every page here links to a markdown copy with the same words, and /llms.txt lists them all. Your content is markdown in git from the start.
    link:
      label: Open /agent.md
      href: /agent.md
    flip: true
    visual:
      kind: file
      src: /llms.txt
      alt: This site’s /llms.txt, listing every page and its markdown copy.
  - type: faq
    id: questions
    heading: Questions.
    items:
      - q: Will it get me cited?
        a: Nobody can promise that. Galley makes your pages easy for assistants and search engines to read; what they do with them is up to them.
      - q: Do I need Galley to serve them?
        a: No. They are ordinary files in your build, served by whatever hosts your site.
      - q: Is anything proprietary?
        a: No. Markdown in git, plain HTML, an llms.txt index and a robots.txt. Any tool can read them, and you can leave with your repository.
---
