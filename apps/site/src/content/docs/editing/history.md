---
title: Undo a publish
navTitle: Undo a publish
description: Version history lists every published version of the site; undoing one adds a new version that reverses it, so nothing is ever erased.
group: editing
order: 8
---

For people who edit a site. **Version history** is the list of everything ever published on the site, newest first, with who published it and when.

<figure class="frame" style="padding: clamp(12px, 3vw, 28px); margin-block: 0 1.15em"><img src="/docs/history@1x.webp" srcset="/docs/history@1x.webp 1x, /docs/history.webp 2x" alt="Version history for Caddow: a note that versions are kept on this computer only, then the newest version with its note, by Tobiah Rusk just now, marked Latest and Published here, with Put this site online and Undo this publish; the earlier versions below it." width="964" height="353" loading="lazy" decoding="async"></figure>

## Undo a publish

1. Open **Version history** in the sidebar.
2. Beside the version, press **Undo this publish**.
3. The window says what it takes back — **Undo this publish?** — and that it adds a new version on top. Press **Undo this publish** to go ahead, or **Keep it**.

<figure class="frame" style="padding: clamp(12px, 3vw, 28px); margin-block: 0 1.15em"><img src="/docs/undo-publish-dialog@1x.webp" srcset="/docs/undo-publish-dialog@1x.webp 1x, /docs/undo-publish-dialog.webp 2x" alt="The Undo this publish? window: it takes back the named version, adds a new version on top so Version history keeps everything, with the buttons Keep it and Undo this publish." width="440" height="223" loading="lazy" decoding="async"></figure>

The undo is published straight away, as a new version called **Undo "…"** at the top of the list. Undoing that one puts the changes back. Each version's **files** link shows what it changed.

## Undo before you publish

Not published yet? You don't need Version history: put changes back in [Proof](/docs/editing/proof-and-publish/), or press **Undo this change** under an assistant reply.

## What the notes on the list mean

- **Latest** — the newest version.
- **Published here** — published from this computer.
- **Versions are kept on this computer only** — the site isn't connected to a host or a shared copy yet, so nothing is backed up elsewhere. Ask the site's developer, or [put the site online](/docs/editing/online/).

## Newer versions from the repository

When the site lives in a repository that other people publish to too, Version history checks it every time you open the page. While it does, it says **Checking the repository…**; then one of:

- **In step with the repository, checked just now** — everything published anywhere is here. It says when it last checked.
- **3 newer versions are waiting in the repository** — someone published elsewhere. Press **Get latest** to bring them in; nothing you're working on is overwritten. If your account can't, it says an editor or owner can bring them in.
- **Couldn't check the repository** — it says why (no connection, the key was refused) and when it last knew. Press **Try again**.
- **This copy and the repository have gone separate ways** — versions were published both here and there. Someone who knows the repository needs to bring them together; your edits are safe.

On an editor that runs online, newer versions are brought in by themselves every few minutes, and the app says so once: "3 newer versions from the repository were brought in." The pages you have open refresh, and the preview restarts on the new versions. If a page you have unpublished changes to was changed there too, they wait: the bar at the bottom says **Newer versions are waiting**, and Version history says which page and offers **Review in Proof**. Discard your change to it (Proof shows it, so you can copy what you wrote first), and they come in; publishing is paused until they have.
- **Put this site online** / **Put live** — for sites put online from Galley: the published version isn't live yet.

## If something's different

- **"That version can't be undone automatically, because later changes edited the same lines."** Nothing was changed. Undo the later version first, or change the page back by hand.
- **"That version combined two lines of work, so it can't be undone automatically."** Ask the site's developer to undo it.
- **"Some files this would undo have unpublished changes."** Nothing was changed. Publish or discard those changes, then undo. While newer versions are waiting in the repository, publishing is paused: discard them (Proof shows them, so what you wrote can be copied first), press **Get latest**, then undo.
- **"The repository has newer versions than this copy, so the undo is paused."** Someone published elsewhere since this copy last looked. Nothing was changed. Press **Get latest**, then undo.
