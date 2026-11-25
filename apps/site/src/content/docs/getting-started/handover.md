---
title: Hand a site over to an editor
navTitle: Hand a site over
description: A short checklist for the developer or agency handing a site to the people who edit it — names, the live address, where publishes go, what the assistant may touch, and one round trip together.
group: getting-started
order: 5
---

Start here when you build a site and hand it to someone else to edit. Galley works with no set-up at all; each step below removes a question your editor would otherwise ask you.

## The checklist

1. **See what Galley found.** Run `galley doctor` in the site's folder. Read the collection names as your editor will see them.

2. **Name things in their words.** Run `galley init` to write `galley.config.json`, then fix the labels:

   ```json galley.config.json
   {
     "collections": [
       { "id": "blog", "label": "Journal", "singular": "post" }
     ]
   }
   ```

   Fields can have a label, help text, a fixed list of options, or be hidden ([Collections and fields](/docs/configuration/collections/)).

3. **Give it the live address**, so Proof shows the change beside the live page. On Astro, `site` in `astro.config` is read for you, unless it's a placeholder like `https://www.example.com`.

4. **Decide where a publish goes.** By default it is a commit and a push. To review changes first, use pull requests instead ([Publishing](/docs/configuration/publishing/)). Either way, the computer Galley runs on must be able to push.

5. **Decide what the assistant may touch.** Content mode — pages and pictures — is the default. To keep build mode off on this site, set `"ai": { "allowBuild": false }`. A writing guide such as `CONTENT-GUIDE.md`, listed in `ai.instructions`, is read before every request ([Assistant instructions](/docs/configuration/assistant/)).

6. **Move copy out of components.** Words written inside an `.astro` component can't be edited as content — on the page they show as part of the site's design. Put them in a file under `src/data/` ([Making a site easy to edit](/docs/astro/editable-sites/)).

7. **Choose how they'll run it:** the [desktop app](/docs/running/desktop/) on their own computer, a [shared Galley](/docs/running/hosted/) online, where each person has their own account, or the [command line](/docs/reference/cli/). On each computer, set the publishing name in **App settings** › **You**.

8. **Do one round trip together.** Change a heading, check it in Proof, publish, find it in Version history, and undo it. That proves the sign-in, the branch and the live address before you leave.

## If something's different

- **The site is for a client who pays for their own assistant.** Give the site its own key in its **Settings** › **Connections**.
- **`allowBuild` holds for everyone, but an owner can change it.** With it off, build mode is refused for every account and over the API too, and nobody can turn a script on or add custom code to a form; an owner can turn it back on. Who may sign in is the real control ([Security](/docs/running/security/)).

## Next

1. [Find your way around](/docs/editing/tour/) — send this to your editor.
2. [Prompt, proof, publish](/docs/concepts/prompt-proof-publish/) — the loop, for explaining it.
3. [Security](/docs/running/security/) — for whoever approves the set-up.
