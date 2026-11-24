---
title: See who wrote in
description: Read, search, export and delete what visitors send through the site's forms, get an e-mail when they do, and know when the inbox can receive from the live site.
group: site
order: 2
---

For people who look after a site. The **Inbox** keeps what visitors send through forms whose destination is **Inbox**. Submissions are kept by this app, not published with the site.

## Read submissions

1. Open **Inbox** in the sidebar. Its badge is the number of unread submissions.
2. Choose a form on the left. Its submissions are in the middle, newest first; choose one to read it in full on the right — every answer with its label, and the page it was sent from.

<figure class="frame" style="padding: clamp(12px, 3vw, 28px); margin-block: 0 1.15em"><img src="/docs/inbox@1x.webp" srcset="/docs/inbox@1x.webp 1x, /docs/inbox.webp 2x" alt="The Inbox for Caddow: the forms on the left, one test submission from Test visitor in the middle, and on the right its answers — name, email address, what it is about, the message, a phone number and consent — with Mark unread, Spam and Delete." width="1125" height="750" loading="lazy" decoding="async"></figure>

- **Search answers…** looks through every answer. **All**, **Unread** and **Spam** filter the list.
- Select one or more to **Mark unread**, move to or from **Spam**, or **Delete**.
- **Export** downloads what's shown as a spreadsheet file, one column per field.

Opening a submission marks it read.

## Try it

**Send a test submission**, on a form with no submissions yet, sends one through the same path a visitor's does; it is marked **Test**. Forms in the preview send here too.

## Get an e-mail when someone writes

**Capture settings…** › **E-mail alerts**: give each form the addresses to tell. The server Galley runs on needs mail settings for this (whoever runs it sets them); until then the window says **No mail settings** and keeps the addresses for later.

The same window sets **Who can send** (the site's own addresses), **Spam protection**, and keys for sending from another server.

## On the live site

Visitors' browsers can only reach an inbox that is on the internet. When Galley runs on your own computer, the Inbox says so: *Submissions can only arrive when this app runs on a server visitors can reach. On this computer it works for testing.* To collect real submissions, either:

- run the site's editor on a server with a public address ([Host the editor online](/docs/editing/editor-online/), or [Run a hosted install](/docs/running/hosted/) yourself), or
- send the form to your CRM or a webhook instead ([Make a form](/docs/editing/forms/#choose-where-submissions-go)).

## Deleting someone's data

Search for their name or e-mail address, select every match (check **Spam** too) and **Delete**. It's gone from this app at once; **Undo** in the message that follows brings it back only for a moment. Copies outside the app — exported files, e-mail alerts, forwarded webhooks, backups — are yours to delete where they are.

## If something's different

- **Spam you wanted.** Open **Spam**, select it, and move it back.
- **Nothing arrives from the live site.** See [On the live site](#on-the-live-site).
