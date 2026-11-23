---
title: Connect the assistant
description: Add an Anthropic API key, choose a model and an effort, and know what the assistant can and cannot do, what it sends where, and how image generation works with or without a key.
group: getting-started
order: 4
---

This page is for the developer who sets Galley up. The assistant is optional: without a key the form, click-to-edit, the proof and publishing all work, and chat is off.

> **What has been checked live.** The assistant has been run against the live Anthropic API: two real turns on a throwaway copy of the starter, with the normal (full) request shape accepted, the edits producing exactly two changed lines, and the second turn reading from the prompt cache. Not yet checked live: the plain fallback request shape (tested against scripted responses only) and both third-party image providers, OpenAI and Google. The [live smoke test](#check-it-with-a-real-key) reproduces the check with your own key.

## Add the key

Any of these. For each request the order is: the site's own key (Site settings › Connections), then the environment, then the key saved in App settings.

- **In App settings › Assistant**, choose **Add key…** and paste it. Galley checks its shape (Anthropic keys start with `sk-ant-`) and stores it in `secrets.json` in the Galley home, readable by your user only (mode 0600, in a 0700 folder). The browser never receives it: Settings only ever shows its last four characters.
- **As `ANTHROPIC_API_KEY`** in the environment Galley starts from. It beats the key saved in App settings, and changing that from App settings is refused with a note saying it comes from the environment.
- **For one site only**, in that site's **Settings › Connections** › **Use a key of this site's own…** — so a client's site is billed to the client's own key ([Look after many sites](/docs/editing/many-sites/#a-clients-site-with-its-own-keys)).

```sh
$ ANTHROPIC_API_KEY=sk-ant-… galley
```

`galley doctor` reports which one is in use: `✓ assistant key: ANTHROPIC_API_KEY (environment)` or `✓ assistant key: stored in settings`.

The desktop app keeps keys the same way, in the Galley home; the OS keychain is not wired up yet ([Desktop app](/docs/running/desktop/)).

## Model and effort

Both are in App settings › Assistant and stored in `settings.json` in the Galley home. They apply to every site on this computer.

| Model | Id | In Settings |
| --- | --- | --- |
| Claude Opus 5.5 | `claude-opus-5-5` | The default. Careful with wording and structure; the right choice for most sites. |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | Faster and about half the price. Good for everyday edits and writing. |
| Claude Haiku 5.5 | `claude-haiku-5-5` | The quickest and cheapest. Fine for small, specific changes; weaker on whole pages. |
| Claude Fable 5.2 | `claude-fable-5-2` | The most capable and the most expensive. For building whole sites or large rewrites. |

**Effort** — Quick (`low`), Balanced (`medium`, the default), Thorough (`high`), Most thorough (`xhigh`) — is passed to the API as the request's effort: higher effort reads and reasons more before it edits, takes longer and uses more tokens.

The list lives in [`packages/core/src/ai/models.ts`]({repository}/blob/main/packages/core/src/ai/models.ts).

## What it costs

You pay Anthropic directly, on your own account, at their prices. Galley adds nothing and sees no bill. Settings shows each model's list price next to it, and **Usage** (`GET /api/usage`) estimates what this computer has spent — today, the last 7 and 30 days, per model — from the token counts each response reports. It is an estimate from list prices, not your invoice; check the Anthropic console for that.

What drives the cost: the model, the effort, how much of the site a request makes it read, and the length of a conversation. The system prompt and the site description are marked for prompt caching, so later turns in a conversation should cost less than the first, and long conversations are compacted on Anthropic's side. When a key is set, the Publish dialog also asks the smallest model (`claude-haiku-5-5`) to suggest the one-line commit message; without a key the message is written from the change list.

## What it can do

The assistant works through tools, and every tool goes through the same engine functions the form uses — the same write rules, the same surgical edits, the same validation. In **content mode**:

| Tool | Does |
| --- | --- |
| `list_collections`, `list_entries`, `read_entry`, `search_content` | Find and read content. |
| `update_entry` | Edit fields, list items and sections, or the body, by [surgical edit](/docs/concepts/surgical-edits/), with a `baseHash` so someone else's change isn't overwritten. |
| `create_entry`, `delete_entry` | Add or remove an entry (deleting only when asked). |
| `list_media`, `generate_image` | Use existing images, or make one with the image provider chosen in Settings. |
| `validate` | Check required fields, types, missing images, broken internal links. |
| `ask_user` | Ask one short question with two to four answers, and stop — never twice in a row. |

**Build mode** adds `list_files`, `read_file`, `write_file`, `edit_file` (exact-string replace), `run_build` (the site's own build command) and `save_site_config` (rewrite `galley.config.json`). A site can turn build mode off with `"ai": { "allowBuild": false }` — see [Modes and the write surface](/docs/concepts/modes/).

Source: [`packages/core/src/ai/tools/`]({repository}/tree/main/packages/core/src/ai/tools).

## What it can't do

- **No shell, no network.** There is no tool that runs a command (other than the site's configured build in build mode) or fetches a URL.
- **Nothing outside the write surface.** Content mode can change content and media only. No mode can write `.git/`, `node_modules/`, `.env*`, lockfiles or hidden settings folders, or anything outside the site folder. The mode is enforced by the engine, not by the prompt.
- **No publishing.** The assistant's changes wait in the proof like anyone else's; publishing is the person's button.
- **No invented facts.** The system prompt tells it not to make up statistics, quotes, names, prices, links or image paths, and to say a change happened only when a tool reported it. That is an instruction to the model, so proof what it wrote.

Each turn opens a checkpoint: **Undo** on a turn restores exactly the files that turn changed and leaves other pending edits alone.

## What it sends, and where

Chat requests go from the Galley server — not the browser — to `api.anthropic.com` (or `GALLEY_ANTHROPIC_BASE_URL`): the system prompt, a description of the site's collections and fields, your messages, images you attach, and whatever the tools read (entries, files in build mode). Nothing is sent until someone asks for something, and nothing goes to Fiction Tribe. Besides chat, these send a request with the same key: the **Publish** window's suggested note (the list of changes, each time it opens), the Brand screen's voice guide (the site's styles, a sample of its words, and any material added), the Search and AI writer (one request per page, counted before it starts) and **Rebuild** after a WordPress import. Conversations are stored in the Galley home on this computer.

## Images

Image generation has four providers, chosen in App settings › Images; **Built-in placeholders** is the default:

| Provider | Key | Notes |
| --- | --- | --- |
| Built-in placeholders | none | Draws an abstract picture at the requested shape, captioned with the description. Nothing leaves the computer. |
| OpenAI | `OPENAI_API_KEY` or App settings | Default model `gpt-image-2.6-sunburst`. Unverified against the live service. |
| Google (Nano Banana) | `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) or App settings | Default model `gemini-nano-banana-2.1`. Unverified against the live service. |
| OpenRouter | its key, in **Plugins** › OpenRouter, or `OPENROUTER_API_KEY` | From the OpenRouter plugin, which also makes videos. Unverified against the live service. |

Generated images are held as candidates until saved into the site's media folder, so a rejected one never touches the site. Each service bills its own account.

## Check it with a real key

The repository has an opt-in smoke test that makes real, billed requests: it copies the starter into a temporary folder, runs two short turns at low effort, and prints the streamed events, the diff and the token usage.

```sh
$ ANTHROPIC_API_KEY=sk-ant-… pnpm --filter @galley/core exec tsx test/ai/live-smoke.mts
```

If the API refuses the request shape Galley normally sends (it uses several beta features), the assistant drops to a plain, generally-available request shape on its own. `GALLEY_AI_PROFILE=plain` pins the plain shape; `GALLEY_AI_PROFILE=full` pins the normal one ([`ai/profiles.ts`]({repository}/blob/main/packages/core/src/ai/profiles.ts)).

## Which endpoint it talks to

Always `https://api.anthropic.com`, unless you set `GALLEY_ANTHROPIC_BASE_URL` — for example to route through a gateway your organisation runs. Galley deliberately ignores `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` in its environment: other tools set those for their own traffic (a coding agent's terminal often points them at a local proxy), and a valid key would otherwise be sent to someone else's proxy and rejected ([`ai/runtime.ts`]({repository}/blob/main/packages/core/src/ai/runtime.ts)).

## Next

- [Assistant instructions and build mode](/docs/configuration/assistant/) — `ai.instructions`, `allowBuild` and the writable globs.
- [Settings, secrets and the Galley home](/docs/running/settings/).
- [Security model](/docs/running/security/).
