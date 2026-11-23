---
title: "Moving a WordPress site to Galley"
navTitle: "Moving from WordPress"
description: "What comes across from WordPress and what doesn't, the guided move in the app and the command, the report, rebuilding page-builder pages, keeping your search rankings, and the go-live checklist."
group: "getting-started"
order: 6
---

<!-- Generated from docs/wordpress-import.md by apps/site/scripts/sync-docs.mjs. Edit that file, not this one. -->

> This page is [`docs/wordpress-import.md`]({repository}/blob/main/docs/wordpress-import.md) from the repository, rendered as it is. It is the developer's version; the editor's is [Bring a site over from WordPress](/docs/editing/wordpress/). The guided move in the app is new, in final checks; the docs ran it against the importer's own invented WordPress site, not a real one.

Point Galley at a WordPress site and its posts, pages, images and SEO details
arrive in your new site as **pending changes** — nothing goes live until you
have looked through them in Proof and pressed Publish. It is the same
*Prompt it. Proof it. Publish it.* as everything else in Galley, applied to a
migration.

This guide is for site owners and the agencies who move sites for them. It
covers what comes across and what doesn't, the two ways in, doing it in the
app, the command, what the report means, rebuilding page-builder pages,
keeping your search rankings, and a checklist for the day you switch over.

> WordPress, Elementor, Divi, WPBakery, Beaver Builder, Yoast, Rank Math,
> All in One SEO, Jetpack, WooCommerce and the other products named here are
> trademarks of their owners. They are named only to describe what the
> importer reads. Galley is not affiliated with, endorsed by or sponsored by
> any of them.

---

## What comes across

| From WordPress | In your new site | Notes |
| --- | --- | --- |
| Posts | Entries of the site's blog collection | The collection with a date and a body. If there are two, or none, you are asked which to use. |
| Pages | Entries of the site's pages collection | Child pages keep their place (`/visiting/kiln-room/`) when the collection allows folders. |
| Titles, dates, slugs | The matching fields | Slugs are kept, so most addresses don't change. |
| Excerpts | The description (or summary) field | When there is none, the opening paragraph is used — and the report lists every one of those for you to check. |
| SEO titles and descriptions (Yoast, Rank Math, All in One SEO) | SEO fields, when the site has them | The description always comes across when there is a description field. SEO titles are kept only if the site has a field for them. |
| Canonical addresses, “hide from search engines” | Matching fields, when they exist | Otherwise listed in the report. |
| Featured images | The site's image field, downloaded | Originals, not thumbnails. If a post has none and the site needs one, the first image in the post is used, or the post waits for you (see `--default`). |
| Images, PDFs and MP4 videos in the text | The site's media folder, downloaded | Duplicates are saved once. Every address in the text is changed to the new file. |
| Categories and tags | Tag and category fields | Merged into tags when the site only has tags; “Uncategorized” is dropped. |
| Authors | The author field | As a name, or matched to a person in the site's team collection when the field points there. |
| Drafts, scheduled and private posts | Drafts | Only when the collection has a draft setting. Otherwise they are skipped, so nothing private is published by accident. |
| Headings, lists, quotes, code, tables, links | Markdown | Written the way a person would write it. |
| YouTube, Vimeo, maps, other embeds, video and audio players | Kept as HTML in the text | Never dropped. Counted in the report. |
| Galleries and captions | Images with their captions beneath | |
| Shortcodes WordPress ships (`[caption]`, `[gallery]`, `[embed]`, `[video]`, `[audio]`) | Converted | |
| Other shortcodes (`[contact-form-7 …]`, plugin shortcodes) | Left in the text, visibly | Listed in the report with every page that uses them. |
| Elementor, Divi, WPBakery and Beaver Builder pages | Text in the page now, plus a **rebuild brief** | See [Rebuilding page-builder pages](#rebuilding-page-builder-pages). |
| Links between your own posts and pages | Changed to the new addresses | Links to things you didn't import are left pointing at the old site and listed. |

## What doesn't come across, and why

| | Why | What people usually do |
| --- | --- | --- |
| Comments | A static site has no comment system. | Add a hosted comment service, or close comments and keep the old ones in the WordPress export. |
| Forms (Contact Form 7, WPForms, Gravity Forms, Elementor forms) | A static site can't receive form entries by itself. | Use a form service (many hosts include one) or an email link. The form's place is marked in the page. |
| Shop, products, checkout (WooCommerce and others) | **Out of scope.** Products, carts, orders and payments need a shop service. | Keep the shop on a shop platform and link to it, or embed a provider's buy buttons. |
| Members-only content, logins, user accounts | Static pages can't be hidden behind a login. | Keep that content on a membership service, or publish it openly if it no longer needs protecting. Only authors' names come across. |
| Password-protected posts and pages | Same reason. | Skipped and listed. |
| The theme, menus, widgets, sidebars | The new site has its own design and navigation. | Set up the menu in the site's navigation. |
| Plugin settings and data | Plugins don't run on a static site. | What plugins showed on pages is flagged where it needs a person. |
| Custom content types (portfolios, events, courses…) | They are specific to a plugin or theme. | They are **listed and offered** — import any of them by name with `--type`. |
| Audio files, Word documents, ZIPs and other file types | The site's media library takes images, PDFs and MP4 video. | Listed in the report; links still point at the old site. Move them somewhere permanent before the old site goes away. |
| Revisions and trashed items | Only the current version is imported. | |

---

## The two ways in

**1. The site's address.** Galley reads the site through WordPress's REST API
— the same public interface the WordPress editor uses. It finds the API the
way WordPress advertises it (and works on sites without “pretty”
permalinks), reads only what a visitor could see, and is polite about it: a
few requests at a time, slowing down when the server asks, and a cache so an
interrupted import picks up where it stopped.

To bring **drafts and private pages** too, sign in with an *application
password* (WordPress › Users › Profile › Application passwords). WordPress only accepts them over
`https://`. Put it in an
environment variable — never on the command line, where it would end up in
your shell history — and name the user:

```sh
export WORDPRESS_APP_PASSWORD='abcd efgh ijkl mnop qrst uvwx'
galley import wordpress https://example.com --user ana
```

An address typed without `https://` is tried over https first and, when
nothing answers there (a WordPress on your own computer often speaks plain
http), over http.

**2. An export file.** In WordPress, open **Tools › Export**, choose **All
content**, and download the file. It holds everything, drafts included, plus
details the REST API doesn't show (Elementor's own layout data, SEO plugin
fields). Large exports are fine: the file is read as a stream.

```sh
galley import wordpress ~/Downloads/example.WordPress.2026-11-23.xml
```

Images are still downloaded from the live site, so keep it running while you
import.

---

## In the app: “Bring your WordPress site”

Open it from **Site home** (“Moving from WordPress?”), from the command
palette (⌘K › *Bring your WordPress site*), or when you create a site: in the
new-site wizard choose a starter and tick **Start from my WordPress site** —
the starter gives the design, and once it is copied the app opens this flow
on it. Four steps, one on screen at a time:

1. **Where is it?** Paste the site's address. It is checked as you type: is
   it WordPress, can its content be read, how much is there (“60 posts, 12
   pages, 84 images and files, 37 comments — stay behind”). If it can't be
   read you're told why and given the way forward — *“This site hides its
   content from visitors. Add an application password, or upload an export
   file instead.”* — with the application-password fields and the export
   steps right there. Or drop an export file (up to 200 MB; it is uploaded in
   pieces and kept in the app's own state folder, never in your site).
2. **What will come across.** The counts (posts, pages, images, authors,
   categories, tags); where each kind goes on this site and how the details
   match; pages built with a page builder, called out (“4 pages were built
   with Elementor — their words and images come across; their layouts are
   rebuilt from this site's sections”); search rankings (descriptions kept,
   old addresses that will redirect); what stays behind and why; and the few
   questions that need a person — which collection takes posts, who posts
   are credited to when the writers aren't on the new site yet — each
   already answered with a suggested choice you can change. Nothing is
   written yet.
3. **Bringing it over.** Plain steps with real counts — “Downloading images
   — 120 of 870”, “Bringing over posts — 41 of 312” — and **Stop the
   import**. Stopping keeps whatever already arrived and says what that is
   (“27 images had arrived; they're kept as pending changes”); starting again
   brings the rest, and nothing is duplicated. You can leave the screen; it
   keeps going, and the activity tray shows it.
4. **The report.** First the next steps as a short checklist — review in
   Proof → rebuild the page-builder pages → set the redirects → put the site
   online → switch the domain — then what arrived, the pages to rebuild,
   what needs a look (grouped, each item a link to its entry), the redirects
   (“60 old addresses will be redirected — review them”, which opens the
   Redirects screen), the SEO that came across, and what didn't. The report
   stays: opening the flow again shows it until you choose **Import again**.

Everything lands as **pending changes**. The flow never publishes.

**A server reading a typed address.** In hosted mode (`galley serve`) every
request the import makes — the site and every image it names — goes through
the same public-address guard as the forms feature: the host name is
resolved first, every address must be public, the connection goes to exactly
the address that was checked, and each redirect is checked again. A
WordPress on the server's own network is refused before any connection is
made. In local mode (the app on your computer) a WordPress on this computer
or your local network is allowed, and the plan says so.

**Application passwords** are sent with the requests that read the site and
held in memory for that job only. They are never written to disk, never
logged, never put in an event, and an error that quoted one has it removed.
A signed-in read keeps its fetched pages in a temporary folder that is
deleted as soon as the read ends.

---

## Step by step on the command line

`galley import` lists what can be imported from; every importer, the
WordPress one included, is reached the same way — `galley import <from> …`
— and an importer a plugin adds gets the same door.

From the folder of your new site (or name it as the last argument):

1. **See the plan first.** Nothing is written:

   ```sh
   galley import wordpress https://example.com --plan
   galley import wordpress ~/Downloads/export.xml ~/sites/new-site --plan
   ```

   The report says what would be added, where, what needs a person, and
   which old addresses would change. If something can't be decided — two
   collections could take posts — it asks:

   ```
   Questions to answer first
     Posts could go into Journal or News. Which one should they go into?
       · Journal (src/content/blog)  (--posts-into blog)
       · News (src/content/news)  (--posts-into news)
   ```

   Answer with the option shown and run the plan again. The likely answer is
   marked. When the new site credits posts to people in an authors
   collection and WordPress's writers aren't there yet, it asks who to
   credit, answered with `--default blog.author=<entry>`.

2. **Import.**

   ```sh
   galley import wordpress https://example.com --posts-into blog --write-redirects
   ```

3. **Open Galley and go to Proof.** Every imported post, page and image is a
   pending change. Read through them, fix what needs fixing, discard what you
   don't want.

4. **Rebuild page-builder pages** with the assistant (below).

5. **Publish** when you're happy.

You can run the import again at any time. Posts that haven't changed on
WordPress are left alone; posts that changed are updated; nothing is
duplicated; and anything you have edited in Galley since is never
overwritten (the report tells you it was left alone). The record of what was
imported lives in `wordpress-import/manifest.json` in your site — it is
published with the site, so a colleague who imports again picks up where
you left off.

### Options

| Option | What it does |
| --- | --- |
| `[path]`, `--into <path>` | The site to import into (default: this folder). |
| `--plan` (or `--dry-run`) | Plan and report only; write nothing. |
| `--only posts,pages,media` | Import only these. `media` alone brings the whole media library. |
| `--limit <n>` | At most *n* posts and *n* pages, newest first — good for a first try. |
| `--since <YYYY-MM-DD>` | Only what was published or changed since then. |
| `--posts-into <id>`, `--pages-into <id>` | Answer the plan's questions. |
| `--type <slug>:<id>` | Also import a custom content type into a collection, e.g. `--type portfolio:projects`. |
| `--default <field>=<value>` | A value for a required field WordPress can't fill, e.g. `--default blog.image=/images/cover.png`. |
| `--user <name>` `--app-password-env <VAR>` | Sign in (password read from `VAR`, default `WORDPRESS_APP_PASSWORD`). |
| `--write-redirects` | Write the redirect files (see below). |
| `--max-file-mb <n>`, `--max-total-mb <n>` | Limits for downloads (defaults 25 MB per file, 1 GB in all). |
| `--fresh` | Ignore what an interrupted import already fetched. |
| `--json` | The full report as JSON. |

---

## What the report means

- **What came across** — counts of posts and pages added, updated,
  unchanged or not imported; images saved; embeds kept; and what happened to
  SEO titles and descriptions.
- **What needs a person**
  - *Pages built with a page builder* — imported as text, each with a
    rebuild brief.
  - *Shortcodes left in place* — each distinct one, how often, and where.
    They show as text until replaced: a `[contact-form-7 …]` usually becomes
    your site's contact section; a newsletter shortcode becomes a link or an
    embed from the newsletter service.
  - *Files that didn't come across* — with the reason (missing on the old
    site, too large, a file type the media library doesn't take). Where an
    image couldn't be downloaded, a note marks its place in the text.
  - *Links to pages that weren't imported* — still pointing at the old site.
  - *Forms, comments, shop, members-only content, search* — what they were
    used for and what people usually do instead.
  - *Notes on single items* — descriptions written from opening paragraphs,
    featured images taken from the text, drafts, canonical addresses.
- **Not imported** — every item that was skipped, and why (already exists
  here, password-protected, private with nowhere to mark it as a draft, a
  required field with nothing to fill it).
- **Left behind on purpose** — comments, accounts, theme, plugins.
- **Redirects** — old address → new address, for everything that moved.
- **What to do next** — in order.

`--json` gives all of this as data, including the rebuild briefs and
ready-made redirect snippets.

---

## Rebuilding page-builder pages

Elementor (and Divi, WPBakery, Beaver Builder) pages are deeply nested
layouts. The importer does two things with each one:

1. **The safe import.** The page's words, images, buttons and lists come
   across as plain text in document order, with the builder's wrappers
   removed. Nothing is lost, and the page works straight away.
2. **A rebuild brief.** The importer reads the builder's structure — from
   Elementor's own layout data when you used an export file, from the page
   itself otherwise — into an outline of sections: what each holds, and how
   it was laid out (“three equal columns each with an icon, a heading and
   text”, “a row of five logos”, “a quote with a name”). For each section it
   looks for **your site's own section type** that fits:

   | The old section has… | Suggested |
   | --- | --- |
   | one big heading, a short text and a button, at the top | your hero-like section |
   | the same icon/image + heading + text group repeated | a features-like section |
   | numbered groups | a steps-like section |
   | questions with answers | an FAQ section |
   | price plans | a pricing section |
   | one quote with a name / several | a testimonial / testimonials section |
   | numbers with labels | a stats section |
   | a row of logos / several images | a logos / gallery section |
   | a form | a contact section — with a note that forms need a form service |
   | a heading, short text and a button later on | a call-to-action section |
   | an image beside text | a split section |
   | headings and text | a text section |

   A section type is suggested only when its name *and* its fields fit, with
   a confidence (high, medium, low) and the reason. When nothing fits, it says
   **no close match** rather than forcing one.

In the app, each page-builder page in the report has **Rebuild this page**.
It opens the editor on that page with a new assistant conversation in build
mode, already given a prepared brief: the page, the old layout's sections in
order with the section type each should become, the images already in the
media library, the section types this site has, and the content read from
the old page — plus the rules: the page's words exactly, nothing invented,
the imported text removed once the sections hold it, only this page
changed. The result waits in Proof; **The original** beside each page opens
the old page to compare. **Rebuild all…** first shows the pages, the model
and an estimated cost at list prices (what was really spent shows in
App settings › Usage), then rebuilds them one after another, each in its own
conversation, with Stop. It uses the app's one assistant and its tools — the
same ones it uses everywhere else.

On the command line the brief is in the `--json` report as
`rebuilds[].brief`, with the outline and the proposed content of every
section beside it: give it to the assistant (or any AI tool connected over
MCP) with the page open. Do it page by page; publish each when it looks
right.

---

## Keeping your search rankings

| | What Galley does | What you check |
| --- | --- | --- |
| **Addresses** | Keeps every slug. Pages usually keep their exact address. | Posts often move (WordPress's `/2024/05/my-post/` → `/blog/my-post/`). |
| **Redirects** | Lists every address that changes. The app writes the list beside the import record (`wordpress-import/_redirects` and `wordpress-import/redirects.mjs`), where the **Redirects** screen offers it as “The WordPress import's redirects” to review and add — the site's own redirect file is only ever written by that screen. On the command line, `--write-redirects` writes `public/_redirects` (read by Netlify and Cloudflare Pages; beside the record instead when the site already has its own) and `wordpress-import/redirects.mjs` (an Astro `redirects` object). Your config is never edited. | That your host uses them. Category, tag, author and date archive pages aren't redirected — add rules for the ones that had traffic. |
| **Titles** | Page titles come across. SEO titles are kept when the site has a field for them (without the site name the plugin added). | Pages whose SEO title differed from the page title, if the site has no SEO-title field. |
| **Descriptions** | SEO descriptions come across; otherwise the excerpt; otherwise the opening paragraph (listed in the report). | Every description written from an opening paragraph. |
| **Canonical addresses** | Kept when a page pointed search engines somewhere else and the site has a field for it. | That your new site sets its own canonical addresses from its public URL. |
| **Hidden pages** | “Hide from search engines” is kept when the site has a field for it, otherwise listed. | Those pages. |
| **Images** | Alt text comes across; files move to your site. | Images listed as not downloaded. |

---

## Common situations

**“The site doesn't let its content be read over the web.”** Some security
plugins and hosts switch off the REST API or put it behind a login. The
importer says so and stops. Use an export file instead (Tools › Export ›
All content), or sign in with an application password.

**A huge media library.** By default only the media your posts and pages
use is downloaded — usually a fraction of the library. Downloads are capped
at 25 MB per file and 1 GB in all; raise them with `--max-file-mb` and
`--max-total-mb`. An interrupted import resumes without fetching again.
Media keeps WordPress's year/month folders only if your site already files
media that way.

**Lots of posts.** Try `--limit 20` first, look at the result in Proof, then
run the full import. Running again never duplicates.

**Posts that need an image.** If your new site's blog requires a cover image
and some WordPress posts had none, they wait (listed under *Not imported*).
Give them one with `--default blog.image=/images/cover.png`, or add images by
hand and run the import again.

**Multilingual sites (WPML, Polylang).** The importer reads what the site
shows by default — usually the main language only — and the report says the
site uses a translation plugin. Importing the other languages isn't
supported yet; plan for them separately.

**WooCommerce.** Products are out of scope. Posts and pages of a shop site
import normally; product, cart and checkout pages are flagged.

**Your new site already has a page with the same address** (an “About” page
from a starter). It is kept; the WordPress page is skipped and listed. Delete
or rename the existing page and run the import again.

---

## Go-live checklist

1. Import, proof, rebuild the builder pages, publish.
2. Check every item under **What needs a person** — shortcodes, forms,
   files, links to pages you didn't import.
3. Read the descriptions written from opening paragraphs.
4. Put the redirects in place (`--write-redirects`, or copy them from the
   report) and check two or three old addresses on the new site's preview.
5. Set the new site's public URL so canonical links and the sitemap are right.
6. Set up forms and comments if you need them.
7. Move any files listed as not downloadable.
8. Point the domain at the new site.
9. Submit the new sitemap in your search console; watch for not-found
   errors in the first weeks and add redirects for them.
10. Keep the WordPress site (or at least its export file and uploads) until
    you're sure nothing is missing.
