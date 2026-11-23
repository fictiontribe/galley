---
title: Add Google Analytics
navTitle: Add Google Analytics
description: Add Google Analytics, Tag Manager or another script to every page, decide what waits for the visitor's consent, and check where each one loads.
group: site
order: 3
---

For people who look after a site. **Scripts** lists the analytics, tags and widgets the site loads. Adding one changes what every page does, so it waits in Proof like any other change.

## Add Google Analytics 4

1. Open **Scripts** in the sidebar and press **Add a script**.
2. Choose **Google Analytics 4** (or search — *analytics, chat, ads…*). The list also has Google Tag Manager, Plausible, Segment, Hotjar, Microsoft Clarity, Meta Pixel, LinkedIn Insight Tag, the HubSpot tracking code, Marketo Munchkin, Intercom, and **Custom script** for anything else.
3. Paste your **Measurement ID** — it looks like `G-XXXXXXXXXX`. Once it's added, **Where to find these in Google Analytics 4** links to Google's own instructions.

<figure class="frame" style="padding: clamp(12px, 3vw, 28px); margin-block: 0 1.15em"><img src="/docs/scripts-add-ga4@1x.webp" srcset="/docs/scripts-add-ga4@1x.webp 1x, /docs/scripts-add-ga4.webp 2x" alt="The Add Google Analytics 4 window with a measurement ID filled in, and under Already chosen for you: loads straight away, in the page head, waits for consent to analytics, on every page; buttons Back to the list and Add Google Analytics 4." width="680" height="409" loading="lazy" decoding="async"></figure>

4. **Already chosen for you** says when and where it loads and which consent it waits for. Press **Add Google Analytics 4**.
5. It appears under **Installed**, switched on. Check it in **Proof**, then **Publish**.

## Ask visitors first

**Consent** › **Ask visitors first**:

- **Built-in banner** — the site shows a small banner with an accept button, a refuse button and a choices button; you set their words, the title and the text, and the **Privacy policy page**. Scripts load only after the visitor agrees to their kind: **Analytics**, **Marketing** or **Preferences**.
- **Another consent tool** — a tool you already use decides; the site listens to it.
- **Off** — everything switched on loads straight away.

**Tell Google tags about consent (Consent Mode)** passes the visitor's choice on to Google Analytics and Tag Manager.

## Check where it loads

**What loads where**: type a page address (or choose one) to see which scripts load there and which don't.

A script can be switched off without removing it, moved up or down (the order they load in), or removed.

## What can go wrong

- **The site has no Scripts screen yet, or it offers "Set it up for me".** The site doesn't have Galley's site kit; the button adds it as pending changes for the site's developer to check. [Scripts, for developers](/docs/scripts/).
- **Analytics shows no visits from the editor.** On purpose: scripts don't run in the editor's preview, so your own editing isn't counted.
- **No visits at all after publishing.** The banner may be waiting for visitors to agree, or the ID is wrong. The docs haven't checked a live Google Analytics property.
