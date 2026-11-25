---
title: Assistant instructions and build mode
navTitle: Assistant and write surface
description: "The ai and writable settings: files the assistant reads before every request, whether build mode is offered, and exactly which paths each mode may write."
group: configuration
order: 5
---

This page is for developers. Two blocks of `galley.config.json` shape what the assistant knows and what Galley may change: `ai` and `writable`. The key and model are not here — they are per-computer settings ([Connect the assistant](/docs/getting-started/assistant/)).

## ai.instructions

Files, relative to the site root, whose text is added to the assistant's instructions for this site — a style guide, a brand voice, house rules. The assistant is told they are *the site's own guidance — follow it unless the person asks otherwise*.

```json galley.config.json
{
  "ai": { "instructions": ["CONTENT-GUIDE.md", "docs/legal-wording.md"] }
}
```

- **Default**: whichever of `STYLE.md`, `STYLEGUIDE.md`, `STYLE_GUIDE.md`, `style-guide.md`, `docs/style-guide.md`, `brand/voice.md`, `VOICE.md` and `BRAND.md` exist. A list in the config **replaces** that default rather than adding to it.
- **Size**: up to 16,000 characters from each file and 24,000 in total; a longer file is cut with a note telling the assistant that the rest can be read in build mode.
- **Freshness**: the files are read again for every message. If they — or the site's collections and fields — changed since the conversation started, the assistant is sent a note with the new version, so an edit to the guide reaches the next request.
- A listed file that doesn't exist is reported to the assistant as unreadable; it doesn't stop anything.
- **Never a secrets file.** A file whose name starts with `.env`, or one under `.git/`, is skipped when it is listed here: what these files hold goes to the model's provider with every message, so a secret must not be among them.

## ai.allowBuild

```json galley.config.json
{
  "ai": { "allowBuild": false }
}
```

**Default `true`.** `false` turns off build mode for this site: a conversation can't be switched to it, and a request for it is refused with *Build mode is turned off for this site, so the assistant can change content only.* It holds for people too, owners included, locally too: a build-mode write over the HTTP API (`PUT …/file` with `"mode": "build"`) or MCP is refused, and nobody can turn a script on, change what one that is on runs, or add custom code to a form. An owner can turn it back on in Site settings › Assistant, so it keeps the site's code out of reach of the assistant and of mistakes; who may sign in is still the control against people. See [Modes and the write surface](/docs/concepts/modes/#who-chooses-the-mode).

## writable

The globs each mode may write, relative to the site root, matched with [picomatch](https://github.com/micromatch/picomatch) (dotfiles included). Everything not matched is read-only. Nothing here can unlock the deny-list: `.git/`, `node_modules/`, `.env*`, lockfiles and hidden folders stay closed whatever the globs say.

| Key | Default | Mode |
| --- | --- | --- |
| `writable.content` | each collection's folder (`src/content/blog/**`) or data file, `<media.dir>/**`, and the image, video and PDF files in the other detected media roots | content mode — and build mode |
| `writable.build` | `["**/*"]` | added in build mode |

For the starter the content list is:

```json
[
  "src/content/pages/**",
  "src/content/blog/**",
  "src/content/team/**",
  "src/data/navigation.json",
  "src/data/site.json",
  "public/images/**",
  "public/**/*.{png,jpg,jpeg,gif,webp,avif,svg,ico,mp4,webm,pdf}"
]
```

Without `writable.content` in the config, collections and a `media.dir` added in the config extend the detected list automatically. With it, the list is **exactly** what you write — so include the content folders and the media folder yourself:

```json galley.config.json
{
  "writable": {
    "content": ["src/content/**", "src/data/*.json", "public/images/**", "public/downloads/*.pdf"],
    "build": ["src/components/**", "src/layouts/**", "src/styles/**", "astro.config.ts"]
  }
}
```

The second example keeps build mode away from `package.json`, scripts and CI configuration: only components, layouts, styles and the Astro config can change.

## Next

- [Config reference](/docs/reference/config/).
- [Security model](/docs/running/security/).
