---
title: Contributing to the docs
description: How a documentation page is wired, the checks that keep the docs true to the code, and the house rules for writing one. Code contributions are in CONTRIBUTING.md.
group: project
order: 1
---

This page is for anyone improving these docs. The rules for code — setup, tests, sign-off, proposing an adapter — are in [CONTRIBUTING.md]({repository}/blob/main/CONTRIBUTING.md); everything there applies here too, including the [DCO sign-off]({repository}/blob/main/DCO) on every commit.

## Where the pages are

Every page is a markdown file under [`apps/site/src/content/docs/`]({repository}/tree/main/apps/site/src/content/docs). The file path is the URL: `getting-started/new-site.md` is `/docs/getting-started/new-site/`. The site is an Astro project that Galley itself can edit — **Edit this page** at the bottom of each page opens its file.

```yaml
---
title: The page title (also the <title> and the llms.txt entry)
navTitle: Optional shorter label for the left menu
description: One or two sentences — shown under the title and in search results.
group: getting-started   # an id from src/data/docs.json
order: 2                 # position inside the group, lowest first
---
```

The navigation, previous/next links, “On this page”, the filter, `llms.txt`, `llms-full.txt` and the sitemap all come from the files. Groups and their order are in `src/data/docs.json`. `##` and `###` headings get anchors. Text may use the `{repository}`, `{version}` and `{site}` placeholders, filled in from `src/data/site.json`. Install commands come only from that file's `install`: write `install.` and the command's name in braces (`fromClone`, `create`, …), and put text meant for before or after the first npm release in `if install.published` / `else` / `end` HTML comments. The check fails on an install command the file doesn't have, and on `create`, `createStarter` or `run` outside the published branch while `published` is false.

Two pages are **generated** and must not be edited here: [Writing an adapter](/docs/adapters/writing/) is rendered from `docs/adapters.md`, and [Releases](/docs/project/releases/) from `RELEASING.md`. Edit the source, then run `pnpm --filter @galley/site sync-docs`.

## The checks

`pnpm --filter @galley/site check` runs [`scripts/check-docs.mjs`]({repository}/blob/main/apps/site/scripts/check-docs.mjs), and the site's `build` runs it first, so a page that disagrees with the code fails the build. It checks:

- every ```` ```json galley.config.json ```` block against the engine's own `validateConfig`; a block marked `galley.config.json invalid` must be rejected; a json block that looks like a config but isn't marked is an error;
- every `galley …` command in a shell block or code span, and each of its options, against that command's real `--help`; a code span that is only an option must be an option of some command;
- every `GALLEY_*` variable and every `*_API_KEY` against the source;
- every link: `/docs/…` pages and their `#anchors`, other pages of the site, and `{repository}/blob/main/…` paths against the files in the repository;
- that the [config reference](/docs/reference/config/) has a row for exactly the keys of the config's JSON Schema, and the [HTTP API](/docs/reference/api/) page for exactly the routes in `ApiRoutes`;
- that generated pages are up to date, and that every page has a title, a description, a known group and real content.

```sh
pnpm --filter @galley/site check
```

A problem prints as `file:line: message`. The build needs Node 22.23.4 or newer (Astro 7). In a terminal driven by an AI coding agent, run Astro commands with a clean environment (`env -i PATH="$PATH" HOME="$HOME" pnpm --filter @galley/site build`): Astro 7 backgrounds its dev server when it sees agent variables.

## House rules

- **Say who the page is for** in its first lines — an editor or a developer — and lead with the task.
- **Only what is true.** Every command, option, key, variable, path and message on a page must exist in the code; run it and paste the real output, abridged honestly with `…`. Where something isn't built or verified, say so plainly. If the code and `docs/ARCHITECTURE.md` disagree, report it rather than choosing one in the docs.
- **Words.** Developer pages may use git's words; editor pages use the vocabulary in [`brand/voice.md`]({repository}/blob/main/brand/voice.md) — Publish, Changes, Proof, Discard, Undo, Version history. No marketing voice in the docs.
- **One precise example** beats three vague ones. Link to the source file that implements a thing with `{repository}/blob/main/…`.
- **End with what to read next.**
- **No client names**, real companies or people in examples; the starter's fictional studio and invented names are fine.
- **No empty pages.** Add a page when its content is written.

## Next

- [CONTRIBUTING.md]({repository}/blob/main/CONTRIBUTING.md) — code, tests and sign-off.
- [FAQ](/docs/project/faq/).
