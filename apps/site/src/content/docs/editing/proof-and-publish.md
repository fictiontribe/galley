---
title: Check and publish
description: Proof lists every change waiting to be published, marked up beside the live site; put back what you don't want, then publish the rest.
group: editing
order: 7
---

For people who edit a site. Every change — yours, a colleague's, the assistant's — waits in **Proof** until someone presses **Publish**.

## Check your changes

1. Press **Proof** in the top bar (its number is how many changes are waiting).
2. The list on the left has one row per page or file: **Edited**, **New** or **Deleted**, with how much changed. Choose one.
3. **What changed** shows each field in the site's own words — the section and field, the old words struck through and the new ones written in.

<figure class="frame" style="padding: clamp(12px, 3vw, 28px); margin-block: 0 1.15em"><img src="/docs/proof-what-changed@1x.webp" srcset="/docs/proof-what-changed@1x.webp 1x, /docs/proof-what-changed.webp 2x" alt="Proof › What changed for The atelier: under Photo and text › Heading, the word three struck through and two written in, beside the Show as stored and Put back buttons." width="870" height="260" loading="lazy" decoding="async"></figure>

4. **On the page** shows the page with your changes beside the live site — once the site's live or staging address is set in **Settings › Addresses**. Until then it says **No live site to compare with.** **Source** shows the file itself.

## Put back what you don't want

- **Put back**, beside a field, undoes just that change.
- **Discard**, on a row, throws away every change to that page.
- **Discard all** throws away everything waiting. It asks first — **Discard 8 changes?** — and says what goes; what's already published stays.

## Publish

1. Press **Publish** in the top bar.
2. Check the window: **Note for version history** is one line in plain words (with an assistant key set, it suggests one). Under **What goes**, untick anything you'd rather keep back.
3. Press **Publish 3 changes** (the number is yours). **Not yet** closes the window and publishes nothing.

<figure class="frame" style="padding: clamp(12px, 3vw, 28px); margin-block: 0 1.15em"><img src="/docs/publish-dialog@1x.webp" srcset="/docs/publish-dialog@1x.webp 1x, /docs/publish-dialog.webp 2x" alt="The Publish 3 changes? window: a line saying it saves the changes as a new version on this computer, a suggested note for version history, three ticked changes under What goes — Home page, Journal and The atelier — and the buttons Not yet and Publish 3 changes." width="520" height="473" loading="lazy" decoding="async"></figure>

What happens next depends on how the site is set up, and the window says which:

- **Published** — the changes are live; the site usually updates within a minute.
- **Published on this computer** — saved as a new version here; the site isn't set up to send versions to a host yet. [Put the site online](/docs/editing/online/) to give it an address.
- **Sent for review** — on sites set to **Send for review**, a developer approves the changes before they go live. The button reads **Send for review**.

Every publish is a version you can undo: [Undo a publish](/docs/editing/history/).

## Share before you publish

On a site that is [online](/docs/editing/online/), **Share a preview link** puts the site as it is now — your changes included — at an address of its own, without touching the live site.

## If something's different

- **"Couldn't publish."** Your changes are safe here. The window says why; **Try again** once it's fixed.
- **"Saved, not live yet."** The new version is saved here but didn't reach the site's host. The status bar offers **Send now** when it can.
- **"The live site has newer changes."** Someone published from elsewhere. Publishing waits so nothing is overwritten; press **Get the latest**, then publish again.
- **"Nothing to publish."** Everything already matches the live site.
