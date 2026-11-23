# Galley over MCP — use your own AI tool

Galley's own interface is meant to be the best way to run a site, never the
only way. Everything its built-in assistant can do to a site, any AI tool that
speaks the [Model Context Protocol](https://modelcontextprotocol.io) can do
too — Claude Desktop, Claude Code, Cursor, VS Code, or anything else with an
MCP client. Add one entry to the tool's MCP settings and you can, from that
tool:

- **find** a page by its title, by search, or by text you saw on it
  ("where does ‘Book a free first visit’ live?");
- **read and change** pages, posts and data files with the same surgical
  edits the assistant makes — one field, one section, one sentence — with the
  site's own collections, fields and section types to work within;
- **add images** from your computer, or generate them;
- **proof** what changed, in plain words and field by field, or line by line;
- **publish** (a git commit, and a push when the site has a remote), look at
  version history, and undo a publish;
- **preview** the site with its own dev server.

The tools are not a second implementation: names, descriptions, input
schemas and handlers come from the same registry the built-in assistant uses
(`siteTools` in `@galley/core/ai`), and every call goes through the same
engine, with the same guard rails.

## Quick start

For a site in `~/sites/my-site`:

```sh
npx galley-cms mcp config ~/sites/my-site --client claude-code
```

It prints exactly what to paste for that client — here, a `claude mcp add …`
command. For Claude Desktop, Cursor or VS Code it prints the JSON block for
their config file instead. Paste it, restart the client if it asks, and ask
it to “describe my site”.

It prints the form to use first: `npx -y galley-cms mcp …`. (Versions 0.1.0
and 0.1.1 printed it second, after a command pointing at the copy npx had
downloaded, which npx may clear.) From a clone of this repository, run
`node packages/cli/bin/galley.js mcp config …` instead and use the second
form, “From a copy of the code”. Nothing else needs to be running — the client starts
`galley mcp` itself, and it stops when the client disconnects.

## Setup for each client

Generated from the same code as `galley mcp config` (a test fails if this
section falls behind; `pnpm --filter @galley/mcp docs` rewrites it). The
stdio forms run Galley from a clone: replace `/path/to/galley` with the clone
and `/path/to/your-site` with the site's folder. With the npm package, the
command is `npx` and the arguments are `-y galley-cms mcp /path/to/your-site`
— `galley mcp config` prints that form, filled in.

<!-- generated:setup -->
### Claude Desktop

**On this computer (stdio)** — Settings › Developer › Edit Config — claude_desktop_config.json (macOS: ~/Library/Application Support/Claude/, Windows: %APPDATA%\Claude\). Merge into “mcpServers”, then quit and reopen Claude Desktop.

```json
{
  "mcpServers": {
    "galley": {
      "command": "node",
      "args": [
        "/path/to/galley/packages/cli/bin/galley.js",
        "mcp",
        "/path/to/your-site"
      ]
    }
  }
}
```

**Over HTTP** — Customize › Connectors › Add custom connector.

```text
Name: Galley
URL: http://127.0.0.1:4400/mcp
Request header: Authorization = Bearer <your token>
```

> Claude Desktop reaches custom connectors from Anthropic's cloud, not from this computer, so this only works for a hosted Galley at a public https:// address on port 443. This address is on this computer only — use the stdio configuration instead.

> Make the token with `galley mcp token` (it is shown once) and set GALLEY_MCP_TOKEN to it where the client runs, or paste it in place of the reference in a config file you don't commit.

### Claude Code

**On this computer (stdio)** — Run in a terminal (add --scope user to use it in every project, --scope project to share it through .mcp.json).

```sh
claude mcp add --transport stdio galley -- node /path/to/galley/packages/cli/bin/galley.js mcp /path/to/your-site
```

**Over HTTP** — Run in a terminal where GALLEY_MCP_TOKEN is set (the shell fills it in once, when the server is added).

```sh
claude mcp add --transport http galley http://127.0.0.1:4400/mcp --header "Authorization: Bearer $GALLEY_MCP_TOKEN"
```

> Make the token with `galley mcp token` (it is shown once) and set GALLEY_MCP_TOKEN to it where the client runs, or paste it in place of the reference in a config file you don't commit.

### Cursor

**On this computer (stdio)** — .cursor/mcp.json in the project, or ~/.cursor/mcp.json for every project.

```json
{
  "mcpServers": {
    "galley": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/path/to/galley/packages/cli/bin/galley.js",
        "mcp",
        "/path/to/your-site"
      ]
    }
  }
}
```

**Over HTTP** — .cursor/mcp.json in the project, or ~/.cursor/mcp.json for every project.

```json
{
  "mcpServers": {
    "galley": {
      "url": "http://127.0.0.1:4400/mcp",
      "headers": {
        "Authorization": "Bearer ${env:GALLEY_MCP_TOKEN}"
      }
    }
  }
}
```

> Make the token with `galley mcp token` (it is shown once) and set GALLEY_MCP_TOKEN to it where the client runs, or paste it in place of the reference in a config file you don't commit.

### VS Code

**On this computer (stdio)** — .mcp.json at the workspace root (or ~/.copilot/mcp-config.json for every workspace).

```json
{
  "mcpServers": {
    "galley": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/path/to/galley/packages/cli/bin/galley.js",
        "mcp",
        "/path/to/your-site"
      ]
    }
  }
}
```

> Older VS Code versions read .vscode/mcp.json instead, with “servers” in place of “mcpServers”.

**Over HTTP** — .mcp.json at the workspace root (or ~/.copilot/mcp-config.json for every workspace).

```json
{
  "mcpServers": {
    "galley": {
      "type": "http",
      "url": "http://127.0.0.1:4400/mcp",
      "headers": {
        "Authorization": "Bearer ${GALLEY_MCP_TOKEN}"
      }
    }
  }
}
```

> Make the token with `galley mcp token` (it is shown once) and set GALLEY_MCP_TOKEN to it where the client runs, or paste it in place of the reference in a config file you don't commit.

### Any other MCP client

**On this computer (stdio)** — Start this command as a stdio server (most clients take a command and an argument list).

```json
{
  "transport": "stdio",
  "command": "node",
  "args": [
    "/path/to/galley/packages/cli/bin/galley.js",
    "mcp",
    "/path/to/your-site"
  ]
}
```

**Over HTTP** — Any client that speaks Streamable HTTP.

```json
{
  "type": "http",
  "url": "http://127.0.0.1:4400/mcp",
  "headers": {
    "Authorization": "Bearer <your token>"
  }
}
```

> Make the token with `galley mcp token` (it is shown once) and set GALLEY_MCP_TOKEN to it where the client runs, or paste it in place of the reference in a config file you don't commit.
<!-- /generated:setup -->

The formats were checked against each client's own documentation:
[Claude Code — MCP](https://code.claude.com/docs/en/mcp),
[Claude Desktop — connect local servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers),
[Claude — custom connectors (remote MCP)](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp),
[Cursor — MCP](https://cursor.com/docs/context/mcp),
[VS Code — MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

A note on `command`: `galley mcp config` writes the absolute path of the
`node` it was run with, because desktop apps don't start with your shell's
`PATH` and often can't find a `node` installed by a version manager.

## Two ways to connect

**stdio — `galley mcp [path]`.** The client starts the command and talks to
it over standard input and output. It opens that one site directly; no
server needs to be running. This is the one to use on your own computer.

**Streamable HTTP — `/mcp` on a running server.** Whenever Galley's server is
running (`galley`, `galley serve`, the desktop app, a container), it also
serves the same tools at `POST/GET/DELETE /mcp`. Every site open on that
server is reachable: each tool takes an optional `site` (an id or a name),
needed only when more than one site is open, and `list_sites` lists them.
Because it runs inside the server, edits made this way show up in an open
browser window instantly. This is the one to use for a hosted Galley.

The HTTP endpoint needs `Authorization: Bearer <token>`, where the token is
either

- the server's own session token (`GALLEY_TOKEN`, or the random one a local
  server prints in its sign-in link — it changes on every start), or
- the **stable MCP token**: `galley mcp token` makes one on first use and
  prints it once. Only its SHA-256 hash is kept (in `<GALLEY_HOME>/mcp-token.json`,
  readable by you alone), so it can't be shown again; `galley mcp token --rotate`
  replaces it, and the old one stops working at once, without a restart.
  Every server that uses the same home folder accepts it.

```sh
export GALLEY_MCP_TOKEN=$(galley mcp token)
claude mcp add --transport http galley http://127.0.0.1:4400/mcp --header "Authorization: Bearer $GALLEY_MCP_TOKEN"
```

Cookies are never accepted on `/mcp`, so a web page can't ride on a browser
that is signed in to Galley.

### Using it against a hosted Galley

On the machine (or in the container) that runs `galley serve`, with the same
`GALLEY_HOME`:

```sh
docker compose exec galley node dist/galley.mjs mcp token   # or: galley mcp token
```

Then point the client at `https://<your GALLEY_PUBLIC_URL>/mcp` with that
token. Claude Desktop, claude.ai and the Claude mobile apps reach custom
connectors from Anthropic's cloud, so for them the server must be reachable
from the internet over HTTPS on port 443; add it under
Customize › Connectors › Add custom connector, with the token as a request
header (`Authorization: Bearer …`). Claude Code, Cursor and VS Code connect
from your own computer, so a server on your network works for them too.

## Modes and safety switches

| | stdio (`galley mcp`) | HTTP (`/mcp`) | Default |
| --- | --- | --- | --- |
| Build mode (source files, running the build) | `--build` | `GALLEY_MCP_BUILD=1` | off: content mode |
| Publishing | `--no-publish` turns it off | `GALLEY_MCP_PUBLISH=0` turns it off | allowed |
| Read-only (list, read, search, proof only) | `--read-only` | — | off |
| Watching the folder for outside edits | `--no-watch` turns it off | always on | on |
| The endpoint itself | — | `GALLEY_MCP=off` removes `/mcp` | on |

The defaults are the same locally and hosted: on, content mode, publishing
allowed — a hosted `/mcp` is behind its token like every other route. To turn
it down, set `GALLEY_MCP_PUBLISH=0` (harnesses can edit, people publish from
the UI) or `GALLEY_MCP=off` (no MCP at all).

What each mode means, and where it is enforced:

- **Content mode** can change pages, posts, data files and images — the
  site's `writable.content` globs — and nothing else. Build-mode tools aren't
  even listed, but that is a convenience for the model, not the guardrail:
  every write passes its mode to `SiteService`, which refuses a source file in
  content mode however the call arrived (there is a test that calls the
  `write_file` handler directly with a content-mode context and is refused).
- **Build mode** adds `list_files`, `read_file`, `write_file`, `edit_file`,
  `run_build` and `save_site_config`. It applies only where the site's own
  settings allow it (`ai.allowBuild` in `galley.config.json`); elsewhere those
  tools say build mode is turned off for that site.
- **Nothing**, in any mode, writes `.git/`, `node_modules/`, `.env*` or
  lockfiles, or reaches outside the site's folder. There is no shell tool and
  no network tool (except `generate_image`, which calls the image provider
  chosen in Settings, and is listed only when one is).
- **`add_media` over stdio** copies a file from your computer into the
  site's media folder. It takes images, PDFs and MP4s only, checks that the
  bytes are what the extension says, and refuses anything inside a hidden
  folder (`~/.ssh`, `~/.config`…). Over HTTP it takes the bytes as base64
  instead and never reads the server's disk.
- **Publishing** is listed only when allowed. Its description tells the model
  it makes changes live and is to be called only when the person asked.
- **Read-only** lists only tools whose annotations say `readOnlyHint: true`.

Every tool carries truthful MCP annotations — `readOnlyHint`,
`destructiveHint` (true for anything that can overwrite or remove: updating
an entry, deleting, discarding, publishing, undoing a publish, writing a
source file), `idempotentHint`, and `openWorldHint` (true only for
`generate_image`) — so clients that ask before running a tool ask at the
right moments.

## How MCP edits show up in the Galley UI

Galley has no draft database: the working tree is the draft. So an edit made
over MCP is simply a pending change, and it appears in Proof like any other.

- **Over HTTP**, the edit goes through the running server's own engine and is
  announced on its event stream as `changes.updated` with origin `agent`; an
  open browser window updates at once.
- **Over stdio while the UI is also open on the same folder**, there are two
  processes on one checkout. Both read and write the same files; the UI's
  file watcher notices the MCP process's write and reports it as
  `changes.updated` with origin `external` — the same as an edit in your text
  editor — and it appears in Proof. (Verified by a test that runs the real
  server and a real `galley mcp` child process on one site.) Edits carry a
  content hash (`baseHash`), so an edit based on a stale read is refused
  rather than overwriting the other process's change.

## Tool reference

Generated from the catalog the server registers (`toolCatalog` in
`packages/mcp/src/catalog.ts`). Tools marked *shared with the built-in
assistant* are the registry's own definitions, word for word. Two of the
assistant's tools aren't offered here: `ask_user` (a harness asks the person
itself) and `list_collections` (`get_site` covers it). The publish message,
when the model leaves it out, is a plain deterministic summary over stdio and
the same summary the UI's Publish button proposes over HTTP.

<!-- generated:tools -->
### Orientation

#### `list_sites` — List the open sites

*read-only* · HTTP only

List the sites open on this server, with their ids, names, frameworks and how many changes each has waiting to be published. When more than one is open, pass a site's id or name as `site` to the other tools.

#### `get_site` — Describe the site

*read-only*

Describe the site: its name and framework; every collection (pages, posts, data files…) with its fields, their types, which are required and their allowed values, and for page-section fields every section type with its fields; where images are kept and how pages refer to them; the site's own content guide; where publishing goes; and how many changes are waiting to be published. Call this first — other tools refer to it as the site card — and follow the content guide it includes.

### Content

#### `list_entries` — List entries

*read-only* · shared with the built-in assistant

List the entries in one collection — their titles, paths and page URLs — optionally filtered by a search word. Use it to find the entry a request is about before reading it, and to check that a page you want to link to exists. Results are paged: pass offset for more.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `collection` | string | yes | The collection id from the site card, e.g. "pages". |
| `search` | string | no | Only entries whose title or path contains this text. |
| `limit` | number | no | How many to return (default 20, at most 50). |
| `offset` | number | no |  |

#### `read_entry` — Read an entry

*read-only* · shared with the built-in assistant

Read one entry: its fields, its main text, the fields its collection defines, and any problems found in it. Always read an entry in the current turn before changing it, and use the returned hash as baseHash when you update it. Large entries come back summarised — pass `field` to read one part (for example "sections.3") or `bodyOffset` to read further into the main text.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `path` | string | yes | The entry's path, as listed by list_entries or search_content. |
| `field` | string or list of string or number | no | Where in the entry. A dotted path such as "title", "hero.heading" or "sections.2.heading" (numbers are positions in a list, counting from 0), or the same as an array: ["sections", 2, "heading"]. |
| `bodyOffset` | number | no | Start reading the main text at this character position. |

#### `search_content` — Search the content

*read-only* · shared with the built-in assistant

Search every page, post and data file for a word or phrase. Returns where each match is (which entry, which field or part of the main text) with the text around it. Use it to find text the person quoted or to find every place something is mentioned.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `query` | string | yes |  |
| `collection` | string | no | Only search this collection. |
| `limit` | number | no | Default 15. |

#### `find_text` — Find where a text lives

*read-only*

Given a piece of text the person saw on the website (and, ideally, the address of the page it was on), find which entry and which field or paragraph it comes from. It never guesses: the result is "unique" (exactly one place — safe to edit), "ambiguous" (several candidates are listed; ask the person which one they mean) or "none" (the text isn't in any content file — it may be written into the site's templates, which needs build mode). Use it before editing text the person quoted from a page.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `text` | string | yes | The visible text, as it appears on the page. |
| `url` | string | no | The page it was on: a path such as "/pricing/" or a full address. Strongly recommended. |
| `occurrence` | number | no | When the same text appears several times on that page: which one (0 is the first). |
| `total` | number | no | How many times the text appears on that page. |

#### `update_entry` — Change an entry

*destructive* · shared with the built-in assistant

Change an existing entry with a list of edits, applied in order: set a field, add/move/remove a list item or page section, replace text in the main text, or replace the main text. Only the bytes you change are touched; formatting and comments elsewhere are kept. Pass the hash from read_entry as baseHash so a change made by someone else in the meantime isn't overwritten. The result says which edits were applied and which were refused (with the reason), and lists any errors the entry now has — fix errors your edits caused before finishing.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `path` | string | yes |  |
| `ops` | list of edit (set \| unset \| insert \| move \| remove \| body-replace \| body) | yes |  |
| `baseHash` | string | no | The hash read_entry returned. |

#### `create_entry` — Create an entry

*writes* · shared with the built-in assistant

Create a new entry (a page, a post, a team member…) in a collection that allows new items. Give it a slug — lowercase words joined by hyphens — and its fields; include every required field from the site card. For collections with a main text, pass it as markdown in body. Returns the new entry's path, page URL and any problems.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `collection` | string | yes |  |
| `slug` | string | yes | e.g. "spring-opening-hours". May contain "/" for nested entries. |
| `data` | object | yes | The fields, by key. |
| `body` | string | no | The main text, in markdown. |

#### `delete_entry` — Delete an entry

*destructive, idempotent* · shared with the built-in assistant

Delete an entry. Only when the person asked for it to be removed, or the task plainly requires it (for example replacing sample content). It can be undone until they publish.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `path` | string | yes |  |

#### `list_media` — List images and files

*read-only* · shared with the built-in assistant

List the images and files in the site's media library, with their site URLs and sizes. Use it to find an existing image to place on a page; use the url value exactly as given.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `search` | string | no | Only files whose name contains this text. |
| `limit` | number | no | Default 40. |
| `offset` | number | no |  |

#### `add_media` — Add a file to the media library

*writes* · stdio form; over HTTP it takes `data` (base64) and `filename` instead of `file`

Copy an image (PNG, JPG, WebP, AVIF, GIF, SVG), a PDF or an MP4 video from this computer into the site's media library, so it can be placed on a page. The file name is cleaned up and never overwrites an existing file. Returns the URL to use in an image field (then write alt text that describes the picture).

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `file` | string | yes | The file's full location on this computer, e.g. /Users/ana/Pictures/team.jpg. |
| `filename` | string | no | A name for it in the site, e.g. "team-at-work". Default: the file's own name. |
| `directory` | string | no | A folder inside the site's media folder (see get_site). Default: the media folder itself. |

#### `generate_image` — Generate an image

*writes, open world* · only when an image provider is configured

Generate one image with the image provider chosen in Settings and save it into the site's media. Returns its site URL; then place it on a page with update_entry (and write alt text that describes it). Use it when the person asks for an image, or when a task calls for new imagery. Describe the picture concretely — subject, setting, composition, mood — and never ask for text, logos or real people's likenesses in the image.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `prompt` | string | yes | What the image shows. |
| `aspect` | "1:1" \| "16:9" \| "4:3" \| "3:2" \| "9:16" \| "3:4" \| "2:3" | no | Shape; default 1:1. Heroes are usually 16:9 or 3:2. |
| `style` | string | no | A style direction, e.g. "soft watercolour illustration". |
| `filename` | string | no | A short name hint for the file, e.g. "team-at-work". |

#### `validate` — Check for problems

*read-only* · shared with the built-in assistant

Check entries for problems: missing required fields, wrong types, images that don't exist, links to pages that don't exist. With no paths it checks everything changed since the last publish. Run it after larger changes.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `paths` | list of string | no |  |

#### `audit_entry` — Check one page's search and AI visibility

*read-only* · shared with the built-in assistant

Check one entry: how it would likely show in search results (title, address, description — an approximation), and its findings with evidence, judged against the whole site (duplicates, links). Uses the rendered page when the preview is running or a build exists. Each finding says what kind of statement it is: "measurable" (a fact anyone can check), "documented" (the search engine or AI provider says so; `source` links its page) or "judgement" (plausible, not proven — say so if you mention it). Findings with `fix` list ready edits: apply each exactly as given with update_entry (its `path` and `ops`), after reading the entry. Findings with `write` need text: write it only from what the page (and the site) already says — never invent a fact, figure, name, price or date; if the page doesn't say it, leave it and tell the person what's missing. Never promise rankings or citations.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `path` | string | yes | The entry's path, as listed by list_entries or search_content. |

#### `audit_site` — Check search and AI visibility

*read-only* · shared with the built-in assistant

Check the whole site for what is wrong or missing for search engines and AI assistants: titles and descriptions shown in results, headings, images and alt text, links, indexing (robots rules, sitemap, preferred addresses), structured data, and AI visibility (AI crawler rules, an agent-readable version, plain openings). Reads the content files always, and the rendered pages when the preview is running or a build exists (it never starts either). Returns counts by severity, a summary, the AI crawler policy in plain words, and findings with evidence — filter with groups/severity, page with offset. Each finding says what kind of statement it is: "measurable" (a fact anyone can check), "documented" (the search engine or AI provider says so; `source` links its page) or "judgement" (plausible, not proven — say so if you mention it). Findings with `fix` list ready edits: apply each exactly as given with update_entry (its `path` and `ops`), after reading the entry. Findings with `write` need text: write it only from what the page (and the site) already says — never invent a fact, figure, name, price or date; if the page doesn't say it, leave it and tell the person what's missing. Never promise rankings or citations.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `groups` | list of "titles" \| "content" \| "images" \| "links" \| "indexing" \| "structured" \| "ai" | no | Only these kinds of finding. |
| `severity` | "must" \| "should" \| "idea" | no | Only this severity. |
| `limit` | number | no | Findings to return (default 30). |
| `offset` | number | no |  |
| `rendered` | boolean | no | Use the running preview or existing build too (default true). False checks the content files only. |

#### `check_brand` — Check changes against the brand

*read-only* · shared with the built-in assistant

Check the changes waiting to be published against the site's brand: colours or fonts that aren't the brand's, text that has become hard to read, and words the brand guide says not to use. Read-only; it returns suggestions with the file and line, and never blocks anything. Run it after changing styles or writing a lot of copy.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `paths` | list of string | no | Only these pending files. Default: every pending change. |

#### `check_redirects` — Check the redirects

*read-only* · shared with the built-in assistant

Check the site's redirects (old addresses sent to new ones): duplicates, conflicts, chains, loops, old addresses that are still live pages, new addresses with nothing there, and the host's limits. Optionally trace up to 20 addresses to say where a visitor ends up. The list is a data file (its path is in the result): to change it, read it with read_entry and edit its `redirects` list with update_entry — one object per redirect: `from` (a path, may end in `*`), `to` (a path or https:// address, may end in `:splat`), `status` (301 or 308 permanent, 302 or 307 temporary). The app regenerates the host's redirect file after each edit; never edit that file.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `addresses` | list of string | no |  |

#### `get_brand` — Read the site's brand

*read-only* · shared with the built-in assistant

Read the site's brand: its colours (with roles, values and the CSS property that holds each), fonts, type sizes, spacing and radius scales, logo rules, imagery direction, section types and when to use each, and the voice guide (tone, words to use and avoid, formatting). Use it before writing copy, choosing an image style, or (in build mode) changing styles or components, and work inside it: use its colours and fonts by their property names, and its sections.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `part` | "all" \| "look" \| "voice" \| "sections" | no | Only part of it: look (colours, fonts, sizes, logo, imagery), voice (the guide), or sections. Default all. |

### Proof

#### `get_changes` — Show the pending changes

*read-only*

Show everything that has changed since the last publish — the proof. For each file: its title, whether it is new, changed or removed, a one-line summary, and for pages and posts every field that changed with its value before → after. This is what the person would review before publishing: use it to tell them, in plain words, what is about to go live. Results are paged: pass offset for more. get_diff shows one file's exact lines.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `limit` | number | no | How many files (default 30). |
| `offset` | number | no |  |

#### `get_diff` — Show one file's exact changes

*read-only*

Show exactly which lines of one file changed since the last publish, as a unified diff (lines starting with - were removed, + were added). Use it when the plain summary from get_changes isn't enough, for example to check a long text edit. Long diffs come back in parts: pass offset for more.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `path` | string | yes | The file's path, as get_changes lists it. |
| `offset` | number | no | Skip this many diff lines. |

#### `discard_changes` — Discard pending changes

*destructive, idempotent*

Throw away pending changes, putting files back the way they were at the last publish (new files are removed). Name the files with paths, or pass all: true to discard everything. This can't be undone, and it also throws away changes the person made themselves in those files — only do it when they asked.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `paths` | list of string | no | The files to put back, as get_changes lists them. |
| `all` | boolean | no | Discard every pending change. |

### Publish

#### `publish` — Publish the changes

*destructive* · not listed with publishing turned off

Publish pending changes: save them as a new version of the site (a git commit) and send it on, which makes them live for everyone visiting the site. Call this only when the person has asked to publish, after they have seen what will change (get_changes). Publishes everything pending unless paths are given. Returns the new version, whether it was sent, and — if it was saved but couldn't be sent — why, in plain words.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `message` | string | no | One plain sentence saying what changed, e.g. "Update the opening hours on the Contact page". Written for you when left out. |
| `paths` | list of string | no | Publish only these files (as get_changes lists them). |

#### `get_history` — Show version history

*read-only*

List the site's published versions, newest first: when, by whom, the message, and how many files each changed. Use it to answer "what changed recently" or to find the version to undo with undo_publish.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `limit` | number | no | How many versions (default 10). |

#### `undo_publish` — Undo a published version

*destructive* · not listed with publishing turned off

Undo one published version by publishing a new version that reverses it (history is never rewritten), which changes the live site. Only when the person asked to undo a publish. Give the commit from get_history.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `commit` | string | yes | The version's commit id from get_history. |

### Preview

#### `start_preview` — Start the preview

*writes, idempotent*

Start the site's own development server so the pending changes can be seen in a browser, and return its address (plus the address of the deployed site for comparison, when one is configured). It can take a minute the first time. The preview updates by itself as content changes. Give the person the address; you can't look at it yourself.

#### `stop_preview` — Stop the preview

*writes, idempotent*

Stop the site's development server started by start_preview. Pending changes are kept.

### Build mode only

#### `edit_file` — Edit a source file

*destructive* · shared with the built-in assistant

Change part of a source file by exact replacement: old_string must appear exactly once (include enough surrounding lines to make it unique), or set replace_all to change every occurrence. Copy old_string from read_file without the line numbers.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `path` | string | yes |  |
| `old_string` | string | yes |  |
| `new_string` | string | yes |  |
| `replace_all` | boolean | no |  |

#### `list_files` — List source files

*read-only* · shared with the built-in assistant

List the site's files matching a glob (for example "src/components/**/*.astro" or "src/styles/*.css"). Ignored folders such as node_modules are never listed. Use it to find the component, layout or stylesheet to change.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `glob` | string | no | Default: every file. |
| `limit` | number | no | Default 200. |

#### `read_file` — Read a source file

*read-only* · shared with the built-in assistant

Read a source file, with line numbers. Files longer than 400 lines come back in parts: pass startLine and endLine for the part you need. Read a file before editing it.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `path` | string | yes |  |
| `startLine` | number | no |  |
| `endLine` | number | no |  |

#### `run_build` — Build the site

*writes, idempotent* · shared with the built-in assistant

Run the site's own build and report whether it passed, with the end of its output. Run it after changing components, layouts, styles or configuration, and fix what it reports before you finish.

#### `save_site_config` — Save the site configuration

*destructive, idempotent* · shared with the built-in assistant

Replace the site's configuration file (galley.config.json) with a new version — it corrects or extends what the app detected: collection labels, URL patterns, field settings, the media folder, instruction files. Read the current file with read_file first and send the whole new configuration. The site's structure is re-read afterwards.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `config` | object | yes | The complete configuration object. |

#### `write_file` — Write a source file

*destructive, idempotent* · shared with the built-in assistant

Create a source file, or replace one completely. For changes to an existing file prefer edit_file, which changes only the part you name. Content files (pages, posts) are changed with update_entry, not here.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `path` | string | yes |  |
| `content` | string | yes |  |

Over HTTP, `add_media` takes:

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `data` | string | yes | The file's bytes, base64-encoded (a data: URL is accepted too). At most 25 MB. |
| `filename` | string | yes | Its name including the extension, e.g. "team-at-work.jpg". |
| `directory` | string | no | A folder inside the site's media folder (see get_site). Default: the media folder itself. |

Over HTTP every tool also takes an optional `site` (an id or name from `list_sites`), required only while more than one site is open.
<!-- /generated:tools -->

## Resources and prompts

For clients with a resource picker:

- `galley://site` — the site card (what `get_site` returns, as Markdown).
- `galley://guide` — the site's content guide: the files its settings name
  under `ai.instructions`.
- `galley://entry/{+path}` — one page, post or data file exactly as stored;
  the list offers up to 500 entries, and paths autocomplete.

Over HTTP with more than one site open, resources need a single site; use the
tools (with `site`) instead.

Three prompts encode the workflows that work well, in the assistant's own
principles:

- **`edit_page`** (`change`, optional `page`) — find it, read it, make the
  smallest change, show the proof, don't publish.
- **`write_post`** (`topic`, optional `notes`) — follow the site's structure and
  content guide, never invent facts, leave marked placeholders, validate.
- **`review_and_publish`** — show what changed in plain words, ask, and publish
  only on a yes.

The server's `instructions` (sent when a client connects) brief the model the
same way: call `get_site` first; read an entry before editing it; make the
smallest change; never invent facts, links or image paths; check
`get_changes` and say what changed in plain words before publishing; publish
only when asked; in content mode, say plainly when a request needs build mode.

## Three open doors

1. **It is just files.** The site is a git checkout and the draft is its
   working tree. Edit with anything — a text editor, a script, a coding
   agent with no MCP at all — and the change shows up in Proof.
2. **MCP.** This document: the engine's schema-aware, surgical tools, from any
   harness, over stdio or HTTP.
3. **HTTP.** The typed API the UI itself uses (`ApiRoutes` in
   `packages/core/src/api.ts`), behind the same token.

## Protocol details

- Built on `@modelcontextprotocol/sdk` 1.32, which implements MCP revision
  **2025-11-25** and negotiates down to older revisions (2025-06-18,
  2025-03-26, 2024-11-05) with older clients. The handshake-free 2026-07-28
  revision isn't in the SDK yet; clients that support both eras fall back to
  2025-11-25 on their own.
- stdio: newline-delimited JSON-RPC on stdout and nothing else — every other
  write to stdout (a dependency's `console.log`, a warning) is redirected to
  stderr before the session starts. The process exits when the client closes
  its stdin, stopping the preview and its proxies.
- Streamable HTTP: one session per client (`Mcp-Session-Id`, created only by
  `initialize`; 400 without one, 404 once it has ended; `DELETE` ends it;
  sessions idle for 30 minutes are closed). `MCP-Protocol-Version` is
  checked (400 for an unsupported version). Responses are single JSON
  objects. An `Origin` header that is present and isn't the server's own is
  refused with 403 even with a valid token, and the server's Host check (the
  DNS-rebinding guard) applies too.
- Structured output: `get_site` and `get_changes` declare an `outputSchema`
  and return `structuredContent` beside a readable text rendering; `publish`
  and `undo_publish` return `structuredContent` too.
- Engine refusals come back as tool results with `isError: true`, in plain
  words, so the model can adapt; invalid arguments are refused before
  anything runs.

## Not there yet

- **OAuth.** The HTTP endpoint takes a Bearer token, not OAuth 2.1 with
  dynamic client registration. Clients that can send a header (Claude Code,
  Cursor, VS Code, Claude's custom connectors) work; a client that insists on
  OAuth for remote servers can't connect yet.
- **Resources across several sites.** Over HTTP with more than one site open,
  the `galley://` resources refuse; the tools work.
- **The 2026-07-28 protocol revision**, until the SDK ships it.
- **Undoing one harness turn.** The built-in assistant can undo exactly what
  one of its turns changed; over MCP, use `discard_changes` (per file) instead.
