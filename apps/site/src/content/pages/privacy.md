---
title: Privacy and notices
description: What this website measures, what Galley the software sends when you use it, and the trademark notes.
eyebrow: Privacy and notices
heading: Plain about what’s sent.
lead: This website loads Google Tag Manager to measure visits. Galley, the open-source software, has zero telemetry and no vendor account.
---

## This website

- **Visit measurement.** This marketing website (`galleycms.com`) loads Google Tag Manager (`GTM-5V755QQ5`) to measure visits and see which documentation pages are read. Fonts, styles and interactive demos are served directly from this site.
- **Theme preference in your browser.** Press the light or dark switch in the header and your choice is saved in `localStorage` (`galley-theme`) so the next page matches. It is never sent anywhere.
- **Email links.** An email link opens a small choice — Gmail, Outlook, your mail app, or copying the address. Nothing is sent until you send the email yourself.

The server that hosts the site may keep ordinary access logs — the address and the page requested — as every web server does.

## Galley, the software

Galley itself has zero telemetry and no vendor account. It runs on your computer, or on a server you control, and talks only to:

- **your git host**, when you publish (the remote your repository already uses);
- **your own deployed site**, when the proof shows it beside your changes;
- **your package registry**, through your own package manager, if it installs your site’s dependencies before the preview;
- **the AI provider whose key you add** — Anthropic for the assistant, and OpenAI or Google for image generation if you choose one. What you ask, and the content the assistant reads to answer, is sent to that provider under your own account and their terms; and
- **the services you connect** — a host you deploy to, a plugin’s image service, a form’s destination — under your accounts with them.

Your keys are stored on your machine and never sent to the browser. Without a key, the assistant is simply off; everything else works.

## Notices

- Astro is a trademark of its owner. Galley is built for Astro and is not affiliated with or endorsed by the Astro project.
- WordPress and Elementor are trademarks of their owners, named on this site only to describe them. Galley is not affiliated with, endorsed by or sponsored by either.
- HubSpot, Marketo, Salesforce, Pardot, Shopify, Cloudflare, Vercel, GitHub and the other products named here are trademarks of their owners, named only to describe what Galley connects to.
- The photographs in the starters and in their pictures on this site are AI-generated. The businesses in them — Caddow, Ferrow, Lowfield Studio, Sarking — are made up.
- Galley is open source under the [Apache-2.0 licence]({license}).

## Questions

Open an issue on the [repository]({repository}), or contact [Fiction Tribe]({maker}).
