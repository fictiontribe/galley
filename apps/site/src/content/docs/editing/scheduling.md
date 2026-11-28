---
title: Schedule a publish
navTitle: Schedule a publish
description: Pick a future date and time in the Publish window, keep editing other pages while scheduled releases wait safely outside Proof, or filter future-dated posts automatically with @galleycms/astro.
group: editing
order: 7.5
---

For people who edit a site. You can publish changes straight away or choose a future date and time so a launch, announcement or campaign goes live on schedule.

## Schedule changes from Publish

1. Make your edits as usual — every change lands in **Proof**.
2. Press **Publish** in the top bar.
3. Switch the toggle at the top of the window from **Publish now** to **Schedule for later**.
4. Pick a **Publish date** and **Publish time** (shown in your browser's local timezone).
5. Check the note for Version history and untick any files under **What goes** that you want to leave in Proof.
6. If the site is connected to Cloudflare or Vercel, leave **Deploy automatically after publishing** ticked so the live site rebuilds as soon as the release commits.
7. Press **Schedule**.

Galley seals the chosen files into a scheduled release and restores those files in your working copy to the last published version. That way, Proof stays clear and you can keep editing and publishing other pages immediately without accidentally shipping your scheduled release early.

## Manage scheduled releases

Upcoming scheduled releases appear in a **Scheduled** section on both **Proof** (even when no draft changes are waiting) and **Version history**. Each release shows its note, local publish time and timezone, author, and the list of included files.

- **Publish now** — commits and publishes the scheduled release immediately instead of waiting.
- **Reschedule** — opens a dialog to pick a new future date and time.
- **Put back in Proof** — cancels the scheduled release and restores its sealed files into Proof as ordinary pending changes so you can keep editing them.

## How due releases publish

When a Galley server (local or hosted) is running, a background scheduler checks for due releases every 15 seconds. When a release's time arrives, Galley writes only that release's sealed files, commits and pushes them, triggers a production deploy when configured, and leaves any unrelated edits waiting in Proof untouched.

You can also inspect or run due releases from the terminal or CI:

```sh
galley schedule --list
galley schedule --run-due
```

## Future-dated entries in Astro (`publishAt` and `scheduledAt`)

If your site uses date fields in front matter (`publishAt` or `scheduledAt`), `@galleycms/astro/schedules` provides helpers to hide future-dated entries until their timestamp passes:

```ts
import { getCollection } from "astro:content";
import { filterPublished } from "@galleycms/astro/schedules";

const posts = filterPublished(await getCollection("blog"));
```

`@galleycms/astro`'s visibility step automatically leaves future-dated entries — and rendered pages carrying `<meta name="galley:publish-at" content="2026-12-01T09:00:00Z">` — out of `sitemap.xml`, `llms.txt`, `llms-full.txt`, and Markdown twins until that date arrives.

For fully static sites that rely on front matter `publishAt` dates without a running Galley server, you can generate an hourly GitHub Actions rebuild workflow (`.github/workflows/galley-schedule.yml`) via `POST /api/sites/:siteId/schedules/workflow`.

## Next

- [Check and publish](/docs/editing/proof-and-publish/) — how Proof and Publish work.
- [Undo a publish and get the latest](/docs/editing/history/) — Version history and reverting releases.
- [The site kit](/docs/astro/site-kit/#scheduled-publishing) — `@galleycms/astro/schedules` reference.
