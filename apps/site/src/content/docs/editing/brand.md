---
title: Set up the brand
description: Write the site's look and voice down — read from the site itself or from guidelines, logos and screenshots — so the assistant works inside it.
group: site
order: 5
---

For people who look after a site. The brand is the site's colours, fonts and sizes, its logo, its sections and the way it speaks, written down in the site. Once it's saved, the assistant writes in the site's voice and uses its colours and fonts by name. *Status: new, in final checks.*

## Read it from the site

1. Open **Brand** in the sidebar.
2. Press **Read it from this site**. The app starts the preview and measures a few pages in your browser — the home page, one of each kind, the pages the home page links to most — and reads the site's styles. Nothing about the site changes.
3. The proposal appears as a specimen sheet: each colour with its role and value, how readable each text colour is on each background, the type in the site's own fonts, the logo, the sections and the voice.

<figure class="frame" style="padding: clamp(12px, 3vw, 28px); margin-block: 0 1.15em"><img src="/docs/brand@1x.webp" srcset="/docs/brand@1x.webp 1x, /docs/brand.webp 2x" alt="The brand proposal for Caddow: Nothing is saved yet with a Save the brand button, Worth a look notes about greys and text contrast, and the first colour swatches — Background, Surface, Muted surface and Text — each marked Measured or Declared with where it was found." width="1114" height="685" loading="lazy" decoding="async"></figure>

Each item says where it came from (*tokens.css:48 and measured on /*) and how sure the app is: **Measured** (seen in use), **Declared** (written down in the styles or your material) or **Inferred** (worked out — check it). **Worth a look** lists anything odd, such as near-identical greys or text that is hard to read.

## Or set it up from your material

Under **Set it up from your material**, drop brand guidelines (PDF), logos, screenshots, photos or notes — or **Choose files…** — and add an existing website's address. Each is read for what it says about the look and the voice. Add a note to any file ("old logo, do not use").

## Check, change, save

- Click any name, value or colour to change it. When two sources disagree about a main colour, the proposal asks which is right and can't be saved until you answer.
- **Save the brand** writes it into the site as changes you check in Proof and publish.
- **Apply to the site** writes the brand's values into the site's own stylesheet, when the site keeps them in one file; the change waits in Proof. It says so when there's nothing to change.
- **Check against the site** measures the pages again and lists colours and fonts the brand doesn't know.
- **Export** gives the brand as one file for another site, or as design tokens.

## What is sent where

Colours, fonts and sizes are read on this computer and need no key. **The voice guide needs the assistant**: the site's styles, a sample of its words and its list of sections are sent to the AI provider (Anthropic), and so is every file you add as material — billed to the assistant's key like any request. Nothing is sent until you press a button that reads. Without a key the proposal says the voice and guide weren't written. The docs read Caddow's brand without a key.

## What can go wrong

- **Fonts show in a fallback face.** A font the site doesn't have installed is named, and the next font in its list is used until it's added.
- **A file over 10 MB** stays in this app's own folder for the site, not in the site, so a large PDF never lands in the site by accident.
