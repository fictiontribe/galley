---
title: Connect the assistant
description: Add the site owner's Anthropic API key, so people can ask for changes in words. Without one, everything else works.
group: getting-started
order: 4
---

Start here to switch on the assistant — the pane where people ask for changes in plain words. It's optional: without it, the form, editing on the page, Proof and publishing all work.

## Add the key

1. Make an API key in the [Anthropic console](https://console.anthropic.com). It starts with `sk-ant-`.
2. In Galley, open **App settings** in the sidebar.
3. Under **Assistant**, press **Add key…** and paste it.

The key is kept on this computer, in a file only you can read. The browser never receives it; App settings shows only its last four characters.

The assistant pane in the editor is ready: type in **Ask for a change…**.

## Choose a model

Still in **App settings** › **Assistant**: **Claude Opus 5.5** is the default and right for most sites. **Effort** — Quick, Balanced, Thorough or Most thorough — trades speed and cost for care. Each model shows its price beside it.

## What it costs

Anthropic bills the key's owner for each request. Galley adds nothing. **App settings** › **Usage** estimates what this computer has spent, at list prices.

## What it sends

Only when someone asks for something: the request, the page being looked at, the site's writing guide, attached pictures, and the parts of the site the assistant reads to do the job. It goes from this computer to Anthropic — nothing goes to Fiction Tribe. The Publish window's suggested note, the brand's voice guide and the Search and AI writer use the same key.

## If something's different

- **A client's site should pay for its own use.** Give it its own key in that site's **Settings** › **Connections** ([Look after many sites](/docs/editing/many-sites/#a-clients-site-with-its-own-keys)).
- **You run Galley from a terminal or a server.** Set the key in the environment instead; it beats the one in App settings:

  ```sh
  ANTHROPIC_API_KEY=sk-ant-… galley
  ```

- **"The assistant can't connect."** The key was refused. Add a fresh one.

Models, tools, what each request contains, image services and the live test: [The assistant, in detail](/docs/reference/assistant/).

## Next

1. [Ask the assistant](/docs/editing/assistant/) — what to ask, and what it does.
2. [Assistant instructions and build mode](/docs/configuration/assistant/).
3. [Hand the site to an editor](/docs/getting-started/handover/).
