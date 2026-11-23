---
title: Move a page without breaking links
navTitle: Move a page safely
description: Add redirects one at a time or a whole list at once, let the checks catch loops and chains, try any old address, and keep the host's redirect file in step.
group: site
order: 4
---

For people who look after a site. When a page moves, a redirect sends visitors and search engines from its old address to the new one, so old links, bookmarks and search results keep working.

## Add one

1. Open **Redirects** in the sidebar and press **Add one**.
2. Type the old address (`/about-us/`) and the new one (`/atelier/`, or a full address elsewhere). Choose **Permanent** for a page that has moved for good — search engines then pass its standing to the new page.

An old address can cover a whole folder: everything under `/lookbook/` goes to the same place under `/collections/`.

## Add many at once

1. Press **Add many** and paste a list — two columns from a spreadsheet, a `_redirects` file, `.htaccess` or nginx lines, a Cloudflare list — or **Choose a file…**.
2. It shows straight away what it understood, and asks about anything it can't decide alone: lines that didn't say permanent or temporary, an old address sent to two places, loops and chains.

<figure class="frame" style="padding: clamp(12px, 3vw, 28px); margin-block: 0 1.15em"><img src="/docs/redirects-add-many@1x.webp" srcset="/docs/redirects-add-many@1x.webp 1x, /docs/redirects-add-many.webp 2x" alt="The Add many redirects window: six pasted lines on the left; on the right, Understood 6 lines with 5 new and 1 left out, a question about one line that didn't say permanent or temporary, another about an old address sent to two places, and the list of what will be added, above the button Add 5 redirects." width="960" height="727" loading="lazy" decoding="async"></figure>

3. Press **Add 5 redirects** (the number is yours). The whole list lands as one change in Proof.

Nothing is guessed: a line that isn't plainly one redirect comes back with its line number and why.

## Where they take effect

The first time, the screen asks **Where is this site hosted?** — **Cloudflare**, **Netlify**, **Vercel** or **Another host**. Galley then writes the file that host reads and keeps it in step with the list.

<figure class="frame" style="padding: clamp(12px, 3vw, 28px); margin-block: 0 1.15em"><img src="/docs/redirects-list@1x.webp" srcset="/docs/redirects-list@1x.webp 1x, /docs/redirects-list.webp 2x" alt="The Redirects screen: eight redirects listed by old address, new address, kind and where they came from, one (/winter-sale/ → /sale/) marked with a warning sign; beside them, Cloudflare as the host, the file public/_redirects In step with the list, 7 of 2,000 exact addresses and 1 of 100 wildcards, and Set them on Cloudflare…" width="1122" height="515" loading="lazy" decoding="async"></figure>

For another host, **Download** the list in its format. On Cloudflare, **Set them on Cloudflare…** can also put the list on Cloudflare itself, for more than the file holds; that needs the site's Cloudflare key with two more permissions, and the docs haven't run it against Cloudflare.

## Try an address

Type an old address under **Try an address** and press **Try**: it shows every step a visitor takes and where they end up — *Ends on "The Long Afternoon"*.

**Health** lists redirects whose new address has gone, and old addresses the site's own pages still link to.

## If something's different

- **A loop (a → b → a)** is refused until you leave it out.
- **"Hides a live page."** The old address is a page the site still has; redirecting it would make the page unreachable.
- **The host's file was edited by hand.** Galley never overwrites it silently: the screen offers to replace it with the list, or to bring its redirects into the list.
- **Moving from WordPress?** The import's list of old addresses is waiting here, under the WordPress import's redirects — [Bring a site over from WordPress](/docs/editing/wordpress/).
