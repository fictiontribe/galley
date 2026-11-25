# Galley — Architecture

Galley is an AI CMS for static websites whose content lives in git. You point
it at a site, it works out the content model by itself, and from then on
anyone can change the site three ways — typing in a form, clicking on the page,
or asking in chat — review exactly what changed, and publish it as a git
commit.

**Prompt it. Proof it. Publish it.**

| Step | What the person does | What happens underneath |
| --- | --- | --- |
| **Prompt** | Asks for a change in chat, edits a field, or retypes text on the page | Files in the checkout's working tree change |
| **Proof** | Reviews the change: live preview beside the deployed site, plus a plain-language list of what changed | `git diff` against the last commit, rendered for humans |
| **Publish** | Presses Publish | `git commit` (+ `git push`, or a pull request) |

This document is the blueprint. If the code and this document disagree, fix
whichever is wrong — do not leave them disagreeing.

---

## 1. Principles

1. **Zero config, then config.** Opening a folder must be enough. Detection
   reads the framework, the content collections and the shape of the content
   itself (field types are inferred from the files). `galley.config.json` only
   exists to correct or extend what detection found.
2. **The working tree is the draft.** There is no draft database and no
   overlay format. A pending change is an uncommitted change in the checkout;
   the proof is `git diff`; discarding is `git restore`; publishing is
   `git commit`. This is what makes every site previewable by its *own* dev
   server, with no renderer of ours in the loop.
3. **Edits are surgical.** Changing one value changes those bytes and nothing
   else. YAML is never re-serialised to change a scalar: the new value is
   spliced in at the old value's byte range. Comments, quoting style, folded
   scalars, key order and the markdown body survive byte-identical. A diff
   that shows more than the person changed is a bug.
4. **Never guess.** When something is ambiguous — which of three identical
   "Learn more" strings was clicked, which page "the pricing page" means — the
   product asks or declines. It does not pick. The assistant never says a
   change was made unless a tool reported that it was.
5. **Plain words.** The person using Galley may never have heard of git. The
   UI says Publish, Changes, Discard, Undo, Version history — not commit,
   diff, checkout, revert. Error messages say what happened and what to do.
6. **Closed write surface.** Writes are confined to the site root and to the
   mode's writable globs. Content mode can touch content and media only.
   Build mode adds source files. Nothing writes `.git/`, `node_modules/` or
   `.env*`, ever. The assistant has no shell and no network tool.
7. **One engine, three shells.** The engine is a Node library. The server
   wraps it in HTTP. The same server + web UI runs from the CLI
   (`npx galley`), inside the desktop app (a Tauri shell with the server as a
   sidecar), and hosted behind a URL. There is no second implementation. The
   hosted shell manages exactly one site: one install, one site, one state
   (`docs/cloud-install.md`); the CLI and the desktop app stay multi-site.
8. **Unbranded by construction.** The name lives in
   `packages/core/src/brand.ts` and is served to the UI at `/api/meta`. No
   user-facing string hard-codes it; a deployment can rename and recolour the
   product with a brand file. No client name, sample company, or site-specific
   assumption appears anywhere in the code.

9. **Astro first, adapters for everything else.** Astro is the framework
   Galley is built around and tested against: the Astro adapter reads the
   content config and zod schemas, drives Astro's dev server for the preview,
   and ships with the starter. Every other framework arrives through the same
   public **adapter API** the Astro adapter itself uses — an adapter is a
   small module that tells the engine how to recognise a site, where its
   collections live, how URLs map to entries and how to run it. Writing one
   must take an afternoon, with a conformance kit to prove it works.
10. **Open source, always.** Apache-2.0. No feature is held back for a paid
    tier, nothing phones home, there is no account to create. Easy to run is
    part of open: one command locally, one container hosted.

11. **No lock-in: three open doors.** Galley's own UI should be the best way
    to run a site, never the only way. (a) *It is just files* — because the
    working tree is the draft, an edit made by any tool (an editor, a coding
    agent, a script) shows up in Galley's Proof like any other change. (b)
    *MCP* — the same schema-aware, surgical tools the built-in assistant uses
    are served over the Model Context Protocol, so any LLM harness (Claude,
    Cursor, anything that speaks MCP) can read, edit, proof and publish a site
    without our UI. (c) *HTTP* — the typed API the UI itself uses is documented
    and stable. One tool registry feeds both the built-in assistant and MCP, so
    the two can never drift apart.

### House opinions

Small, deliberate behaviours every site built on Galley gets by default
(each can be turned off by the site):

- **E-mail links offer a choice.** A `mailto:` link never just fires: the site
  kit opens a small chooser beside the link — send with Gmail, send with
  Outlook, open my mail app, copy the address — so a visitor without a
  configured mail program is not stranded. Without JavaScript the link is a
  normal `mailto:`.

---

## 2. Repository layout and ownership

```
galley/
├── docs/ARCHITECTURE.md        this file
├── brand/                      brand guide, logo, tokens (source of truth for look and voice)
├── packages/
│   ├── core/                   @galley/core — the engine (Node, no HTTP, no UI)
│   │   └── src/
│   │       ├── types.ts        domain contract            ┐ the shared contracts:
│   │       ├── api.ts          HTTP contract               │ change them additively,
│   │       ├── brand.ts        product name                │ and say so in the pull
│   │       ├── errors.ts       GalleyError                 ┘ request.
│   │       ├── content/        pure content logic
│   │       ├── workspace/      the checkout: files, git, changes, preview, media
│   │       ├── site/           SiteService + SiteRegistry (content ∘ workspace)
│   │       ├── ai/             assistant, image generation, settings, usage
│   │       ├── install/        the hosted install: one site, first run, accounts, backups
│   │       └── hosting/        "Host the editor online": editor hosts, recipe, plans
│   ├── server/                 @galley/server — HTTP API, SSE, static UI hosting
│   ├── cli/                    galley-cms — the `galley` binary
│   ├── adapter-kit/            @galley/adapter-kit — adapter types + the conformance kit
│   ├── mcp/                    @galley/mcp — the engine's tools over the Model Context Protocol
│   ├── web/                    @galley/web — the React UI
│   └── overlay/                @galley/overlay — the script injected into previewed pages
├── apps/
│   ├── desktop/                Tauri 2 shell (Rust) + sidecar server
│   └── site/                   marketing + documentation website (itself a Galley-editable Astro site)
├── Dockerfile, docker/         the hosted install's image (one site, state in /data)
├── scripts/create-install.sh   one hosted install per run on a Docker server
├── starters/
│   └── astro-starter/          the site template `galley new` copies
└── examples/
    └── adapter-eleventy/       a worked third-party-style adapter (the template to copy)
```

Each builder owns the directories named in its brief and nothing else. Do not
reformat, rename or "tidy" files outside them.

---

## 3. The engine (`@galley/core`)

Imported as TypeScript source inside the monorepo (no build step); bundled into
the CLI for distribution. ESM, strict TypeScript. Node ≥ 22 in practice
(Astro 7, the first-class target, requires it).

### 3.1 `content/` — pure content logic

No process spawning, no git, no network. Functions take a site root (or file
text) and return data. Deterministic and unit-testable.

- **Detection** — `detectSite(root)` asks every registered **adapter**
  whether the site is its own and builds the `SiteModel` from the winner's
  answers: how to run and build it, where public files and media live, the
  deployed URLs, which collections exist and how URLs map to entries. The
  engine adds what no adapter should have to: package manager (lockfile),
  schema inference, defaults, and the merge with `galley.config.json`.
  Adapters are plain objects implementing the public `GalleyAdapter`
  interface (`@galley/core/adapter`; guide in `docs/adapters.md`); helpers —
  conventional markdown/data discovery, the static module reader, zod → fields,
  file-route scanning — arrive through the adapter's context, so a
  third-party adapter can be one dependency-free file. Built-ins live in
  `src/adapters/`:
  - **Astro (the reference adapter)**: reads `astro.config.*` and
    `src/content.config.*` (or legacy `src/content/config.*`) *statically* —
    it never executes site code. Recovers each collection's loader (`glob` /
    `file`, `base`, `pattern`) and whatever of the zod schema is plainly
    readable (enums, optionals, defaults, numbers, dates, arrays, nested
    objects, `image()`, `reference()`, discriminated unions → page sections),
    and derives URL patterns from the dynamic routes under `src/pages`. It is
    written against the public interface only: whatever it needs, third
    parties get too.
  - **Conventions-only adapters** (Eleventy, Hugo, Jekyll, Next.js, Nuxt,
    SvelteKit, Docusaurus) through one small `conventionAdapter(spec)`
    factory, and a **generic** fallback: any directory holding ≥ 2 markdown
    files with front matter is a collection.
  Sites can name extra adapters in `galley.config.json` (`"adapters": [...]`,
  a package or a file inside the site); they are loaded only when named,
  and `GALLEY_DISABLE_SITE_ADAPTERS=1` turns that off. `@galley/adapter-kit`
  is the conformance kit: `checkAdapter(adapter, fixture)` runs the checks
  that define a correct adapter (detects its own fixture and not foreign
  ones, every entry parses and survives an edit-and-undo byte for byte, URLs
  are unique, nothing is written).
- **Schema inference** — scan the corpus (sampled past ~400 files per
  collection) and derive `Field[]`: type from the values (ISO dates, image
  paths, URLs, hex colours, long text, markdown-looking text, low-cardinality
  strings → `select` only when the schema says enum or the evidence is strong:
  ≤ 8 distinct values across ≥ 12 files), `required` when present in ≥ 95 % of
  items, `examples`, nested objects, lists, and **blocks**: a list of objects
  that share a discriminator key (`type`, `_component`, `_type`, `block`,
  `component`, `template`) becomes a `blocks` field whose `BlockType`s carry
  per-type fields and the most complete real instance as `example`.
  Precedence: config > schema > inferred.
- **Config** — load, validate (zod) and merge `galley.config.json` over
  detection; produce `SiteModel`. Emit a JSON Schema for the config file.
- **Documents** — split/join front matter (YAML `---`, TOML `+++`, JSON
  front matter), parse data files (JSON, YAML, TOML read-only).
- **Edits** — `applyEdits(source, format, ops) → { content, applied, refused }`.
  Scalar `set` on YAML splices at the node's range (see Principle 3); structural
  ops (`insert`, `move`, `remove`, `unset`, setting a non-scalar, adding a key)
  go through the `yaml` Document API so comments and unrelated formatting
  survive. JSON edits preserve the file's indentation and trailing newline.
  Body ops work on the text after the closing fence. Every refusal says why.
- **Body blocks** — enumerate a markdown body into addressable blocks
  (heading, paragraph, list item, code, quote, table, html, rule) by byte
  range, without a full markdown AST dependency; never split fenced code;
  never touch MDX import/export/JSX blocks.
- **Index, search, resolve** — one in-memory index of every editable string in
  the site: front-matter scalars (with their `FieldPath`), body blocks, data
  file strings. `search` is substring + token ranking. `resolveText`
  implements click-to-edit (Principle 4), in this order: candidates from the
  entry mapped to the page's URL first; then site-wide; compare on
  whitespace-collapsed text with markdown inline syntax and HTML tags
  stripped; exactly one candidate → `unique`; several candidates but
  `occurrence`/`total` line up one-to-one with file order on the page's own
  entry → `unique`; otherwise `ambiguous` (listed) or `none`.
- **Routes** — entry ⇄ URL from each collection's `url` pattern. Defaults:
  the pages collection maps `index` → `/` and `a/b` → `/a/b/`; other
  collections map to `/{collection}/{slug}/`. Trailing-slash style follows the
  framework config.
- **Validation** — required fields, types, enums, dates, unknown block types,
  images that do not exist under a media root, internal links that match no
  route. Unknown extra keys are warnings, never errors.

### 3.2 `workspace/` — the checkout

Everything with side effects on the machine.

- **Guarded files** — every path is resolved against the site root and
  re-checked with `realpath` (no `..`, no symlink escape). Writes are checked
  against the mode's writable globs and a hard deny-list (`.git/**`,
  `node_modules/**`, `.env*`, lockfiles). Atomic writes (temp file + rename).
- **Git** — a thin wrapper over the `git` binary via `execFile` (argument
  arrays, never a shell string). Status, diff, show, add, commit, push, pull
  (`--ff-only`), log, revert, branch, init, clone. Works in a repo with zero
  commits. Never force-pushes, never rewrites history, never changes git
  config outside the repo.
- **Changes** — `changes()` builds the `ChangeSet` from porcelain status
  (untracked files included, ignoring what `.gitignore` ignores), classifies
  each file (content / media / code / config), counts line changes, and for
  content entries computes `FieldChange[]` by parsing both versions.
  `diff(path)` returns before/after text plus hunks.
- **Publish** — stage the chosen paths, commit as the configured author (on
  a hosted install, the signed-in person's own account first, carried
  through the request in an async scope like the site's → this site's own
  author → the repository's own `git config --local` → App settings › You
  (a hosted install's publishing name) → the computer's global git identity;
  `workspace/author.ts`, shown in the Publish dialog with where to change it)
  with a
  `Galley-Publish: 1` trailer, push when a remote exists. A failed push leaves
  the commit in place and reports `pushError` in plain words. Pull-request
  mode commits on a new `galley/<slug>` branch, pushes it and returns a
  compare/PR URL (uses `gh` when present, otherwise the host's compare URL).
- **History / revert** — `git log` shaped into `HistoryEntry`; undoing a
  publish is `git revert --no-edit` (a new commit).
- **Checkpoints** — record the pre-image of each file the first time the
  checkpoint's own work writes it: what runs inside `run()`, and whatever
  that starts. A write by anything else (another person's save, another
  turn) is never recorded. `restore()` puts back the files still as that
  work left them (or deletes files that did not exist); a file someone else
  has changed since is left as it is and named by `left()`, because putting
  the whole file back would take their change with it. So is a file that
  work wrote after the checkpoint was closed, and one that can't be put
  back; a page the work moved (one file gone, another made that is the
  same, or much the same where it is long enough to tell) goes back as a
  pair or stays as a pair. What is made during a turn to
  serve everyone after (`outsideAnyPerson`: an open site, its watcher, the
  preview) is no checkpoint's work. This is how one assistant turn is
  undone without touching anyone's other pending edits. Undoing a reply
  made in build mode needs the level build mode needs.
- **Preview** — start the site's dev command (argument array, the site's own
  `node_modules/.bin` on PATH), detect the port it actually bound from its
  output, wait for it to answer, and front it with the **preview proxy** on a
  loopback port of its own: forwards HTTP and WebSocket upgrades (HMR),
  strips `X-Frame-Options` / CSP `frame-ancestors`, and injects
  `<script src="/__galley/overlay.js">` into HTML responses. A second
  **baseline proxy** fronts the deployed staging/production URL the same way
  (no overlay) so both can sit side by side in iframes. Runs `install` first
  when `node_modules` is missing. Locally each proxy listens on a loopback
  port of its own. A hosted install opens no preview port: the proxies are
  mounted on a `PreviewGateway` instead, and the server's gateway
  (`packages/server/src/gateway.ts`) reaches them by hostname on its one
  port — `cms-preview.example.com` and `cms-live.example.com` beside the
  editor's `cms.example.com` — letting in only a browser the editor gave a
  one-use ticket.
- **Build** — run the configured build command, capture the tail of its
  output.
- **Media** — list images under the media roots with dimensions, save uploads
  with collision-safe names.
- **Watcher** — notice edits made outside the app (an editor, a `git pull`)
  and emit `changes.updated` with origin `external`.

### 3.3 `site/` — the facade

`createSiteService(root, deps)` returns the `SiteService` from `types.ts`:
content and workspace composed, with a cached `SiteModel` and content index
that are invalidated by the workspace's change events. `createSiteRegistry`
keeps the list of known sites in the Galley home directory
(`GALLEY_HOME`, default `~/.galley`), opens/clones/creates sites, and copies
starters for `create`. **Server routes and the assistant's tools call
`SiteService` and nothing below it.**

Many sites (docs/multi-site.md): the registry file also holds groups, pins,
notes and each closed site's *facts* (pending changes, versions not sent,
live address, unread submissions, share image), read in the background
after a list is answered — listing never opens, detects or waits on a site.
`scan`/`addMany` add the sites in a folder without opening any. The
**preview policy** (`site/preview-policy.ts`) keeps at most N previews
running and pauses unused ones (they wake when the person returns); an open
site unused for an hour is closed again. `site/scope.ts` carries the site a
request is for, so a site's own keys and author apply to everything that
request starts.

On a hosted install the registry is wrapped by `install/single-site.ts`:
listing and opening see only the install's one site, and open, clone, create,
remove, scan, add and groups refuse. The install's own connect step is the
only way a site gets in.

### 3.5 `install/` — the hosted install

One site and its state in one data folder (`GALLEY_HOME`): the versioned
state file and its migrations (`migrate.ts`; a folder a newer version wrote
is refused), the accounts — people, roles, invitations and one-time links,
kept in the state file since its layout 2 (`state.ts`, `people.ts`; the
contract is `accounts.ts`) — with passwords as scrypt hashes and the setup
code and link codes as SHA-256 only, sessions that each belong to a person
and sign-out everywhere, the install's own deploy key or an access
token for the repository (`access.ts`), connecting the one site (an existing
repository, or a starter sent to an empty one), starting values from the
environment or one file — applied once, only while missing (`starting.ts`)
— and backups: one file sealed with a passphrase (`backup.ts`). Contracts:
`install/types.ts`, `install/accounts.ts` (roles and the levels each has)
and `install/route-access.ts` (the level every API route needs — the one
table the server enforces and the web app reads — and the two levels a
route can't express: build mode, `BUILD_MODE_LEVEL`, and the site's
settings file, `SITE_SETTINGS_LEVEL`). `install/caller.ts` carries the
person whose request it is through the work it starts, so the engine
checks those two where the write happens, whichever way it came; the few
values the engine records in the settings file inside actions below that
level go through `site/settings-records.ts`, each changing only its own
keys. Only a hosted server uses it.

### 3.6 `hosting/` — host the editor online

The sibling of `deploy/`: creating a hosted install for one site on the
person's own account, from the desktop app or `galley host`. An `EditorHost`
inspects what its key can do, plans what it would create with a monthly cost
(creating nothing), creates exactly the plan — recording each resource the
moment it exists — and later removes only what it recorded. Built-ins: Fly.io
(`fly.ts`), Cloudflare in front of a computer of yours (`cloudflare.ts`) and
any server with Docker (`own-server.ts`); plugins add more as `editorHosts`.
`recipe.ts` writes the compose files, Caddyfile and `.env` one install runs
from. Contract: `hosting/types.ts`. Local mode only.

### 3.4 `ai/` — the assistant

- **Loop** — the Anthropic Messages API with tools, hosted in our process
  (the tools act on the local checkout, so the loop must run where the files
  are). Streaming; adaptive thinking; history is append-only; all tool
  results of one step go back in a single user message; tool inputs are
  validated with zod before running; the stop reason is checked before tools
  run. Default model `claude-opus-5-5`; the model and effort are settings.
- **Tools** (all through `SiteService`): `list_collections`, `list_entries`,
  `read_entry`, `search_content`, `update_entry`, `create_entry`,
  `delete_entry`, `list_media`, `generate_image`, `ask_user`, `validate`.
  Build mode adds `list_files`, `read_file`, `write_file`, `edit_file`
  (exact-string replace), `run_build`, `save_site_config`. Tools are filtered by mode, and the
  mode is enforced again by `SiteService` — the prompt is not the guardrail.
- **Behaviour** (each rule was earned with real, non-technical editors):
  read before editing; ask one short question with 2–4 options when a request
  is ambiguous, never two questions in a row; never invent facts, links,
  image paths or statistics; preserve wording the user dictated; say what
  changed in one or two plain sentences with no tool/JSON/YAML talk; never
  claim a change that no tool accepted; images the user attached stay visible
  to the model across turns.
- **Turns** — each turn opens a `Checkpoint`; the reply records
  `changedPaths`; "Undo" restores the checkpoint.
- **Images** — `ImageService` with pluggable providers (OpenAI, Google, and
  an offline `mock` provider that renders labelled SVG placeholders so the
  whole flow works with no key). Candidates are held in a temp directory
  until saved into the site's media directory.
- **Settings, secrets, usage** — stored in the Galley home; secrets in a
  0600 file. A key is looked for as: the site's own key
  (`<home>/state/<siteId>/secrets.json`), then the environment, then the
  shared stored key — the environment beats the shared key (it can't be
  overridden from Settings) but not a key set for one site on purpose
  (`ai/site-settings.ts`). A site can also have its own publishing author. The
  secret store is an interface, so a shell can back it with the OS keychain
  (not wired up yet). Secrets never cross the HTTP boundary.

---

## 4. Server (`@galley/server`) and CLI (`galley-cms`)

Hono on Node. Implements `ApiRoutes` from `api.ts` exactly, plus:

- `GET /api/events` — SSE fan-out of the `EventBus`.
- Static hosting of the built web UI, with SPA fallback.
- **Auth.** Local mode (default, binds `127.0.0.1`): a random session token
  minted at start-up, delivered in the URL the CLI opens, exchanged for an
  HttpOnly cookie. Hosted mode (`galley serve`, `GALLEY_HOST=0.0.0.0`):
  accounts — each person's e-mail and password, kept in the install's state;
  with no owner yet, the server prints a one-time setup link where first run
  creates the owner. `POST /api/auth/login` sets a signed cookie (`__Host-`
  on an `https://` address) that names the person; every request checks the
  person still exists, isn't switched off and hasn't been signed out since,
  across restarts too (`who.ts` works out the caller once per request).
  **Who may call what** is one table, `ROUTE_ACCESS` in
  `core/src/install/route-access.ts`: every route has one level (edit,
  publish, manage — a route without one doesn't compile), each role has a
  set of levels, and the server's guards (`app.ts`) enforce it; the web app
  reads the same table only to hide what a role can't use. Each person's
  request runs inside `withCaller` (`core/src/install/caller.ts`), so build
  mode and the site's settings file are held to their levels in the engine
  too. One-time links are built only from `GALLEY_PUBLIC_URL`. Local mode
  has no accounts and ignores the table.
  `Origin` is checked on every state-changing request. In both modes the
  cookie is signed with a key kept in the Galley home (`session.key`,
  owner-only), so restarting the app — which adding a plugin needs — doesn't
  sign the open UI out.
- Errors: every thrown `GalleyError` becomes `{ error }` with its status;
  anything else is logged and returned as a generic `internal`.
- **Hosted only:** the multi-site routes answer 403 and the "Host the editor
  online" routes 404 (`hosted-refusals.ts`); first run and the Install page
  (`install-routes.ts`, `ops.ts`); people, your own account and one-time
  links (`accounts-routes.ts`), e-mailed when `GALLEY_SMTP_URL` is set;
  `GET /healthz` and `GET /readyz`; the preview gateway on the preview's and
  live comparison's hostnames
  (`gateway.ts`, `gateway-auth.ts`, `preview-entry.ts`); one scrubbed log line
  per request (`log.ts`); a graceful stop on SIGTERM.

CLI: `galley` (open the site in the current directory and launch the
browser), `galley init` (write a starter `galley.config.json` from
detection), `galley new <name>` (scaffold from a starter), `galley serve`
(a hosted install; `--reset-password`), `galley backup create|restore`
(a hosted install's data folder, sealed), `galley host` (host the editor
online for the site; `galley host recipe` writes one install's files),
`galley doctor` (print what detection found), `galley mcp` (serve the tools
to any MCP client), `galley version`. The desktop shell
starts the server through an unlisted `galley desktop` command.

---

### Embedding (`@galley/server/extensions`, experimental)

A program that starts the server can add API routes to it when it is built
(`startServer({ extensions })`). An added route lives under `/api/x/<id>/`,
where no route of the editor's own is, declares its access level, and is
mounted after the built-in routes behind the same guards plus two of its own
(the browser's word that the request is the editor's own page's, on every
method; no path in a part of the address). Its handler is handed a narrowed
request and a guarded site, never the framework's request. An extension is
its author's code with the server's permissions, not a sandbox; the built-in
route table and its levels stay closed.

An extension can also send events on the live stream. One member of
`ServerEvent` carries them all (`{ type: "extension", source, name, siteId,
payload }`), and they are the only events filtered by a declared level:
each window's stream asks, per event, whether its reader still counts and
their role has the level now, and then the event's own rule for what that
reader is sent. They are also the only events a reader may miss: one is left
out for a reader that already has half of what it may have waiting. So an
extension's events never fill more than about half of that, and the
editor's own events always have at least half of it. A stream opened
with a value for an extension (`?x-<id>=<value>`) tells it that a window is
there and when it has gone; it can refuse the value, never the stream.
Because a restore replaces the data folder under a running server,
extensions are stopped before one and started again after it, and each
request finds the extension that is running at that moment, behind the
guards its address was mounted with (one that comes back with other routes
is stopped). See
`packages/server/src/extensions/` and the docs page *Embedding the editor*.

### MCP (`@galley/mcp`)

The engine's tools over the Model Context Protocol, for people who would
rather drive a site from their own LLM harness than from our UI.

- **Two transports, one implementation.** `galley mcp [path]` speaks stdio and
  works directly on the checkout (nothing else needs to be running — this is
  what goes in a harness's MCP config). The running server also mounts the
  same tools over Streamable HTTP at `/mcp`, behind the same token auth and
  Host/Origin checks as the API, so a hosted Galley can be driven remotely and
  edits made over MCP appear live in an open UI.
- **Same tools as the assistant.** Tool names, descriptions, input schemas and
  handlers come from one registry in the engine; MCP adds the verbs our UI
  performs for the built-in assistant: read the proof (pending changes and
  diffs), discard, publish, version history, undo a publish, start the preview.
- **Same guard rails.** Everything goes through `SiteService`. Content mode by
  default; build mode (source files, running the build) only when the operator
  starts the server with it enabled. Publishing can be switched off. Tools
  carry MCP annotations (read-only / destructive) so harnesses prompt
  correctly, and the server's `instructions` teach the workflow: read before
  editing, proof before publishing, publish only when asked.

## 5. Web UI (`@galley/web`)

React + Vite + TypeScript. Talks to the server only through a client typed
from `ApiRoutes` and one SSE subscription. Brand tokens come from
`brand/tokens.css`. Screens:

- **Sites** — open a folder, clone a repository, or create a new site.
- **Site home** — collections with counts, pending changes, recent history.
- **Collection** — searchable, sortable list; new item.
- **Editor** — the centre of the product. Three resizable regions: the
  **form** (fields generated from the collection's schema; blocks editor for
  page sections; markdown editor for the body), the **preview** (the site's
  own dev server, with click-to-edit), and the **assistant** (chat). Any of
  the three can be collapsed.
- **Proof** — every pending change: a plain-language change list, the visual
  split (deployed site ⇄ proposed), and per-file diffs; discard per file;
  Publish.
- **Media** — library, upload, and image generation.
- **History** — published versions; undo a publish.
- **Settings** — AI key and model, image provider, author identity, site
  configuration, usage.
- **New site** — a short brief → a starter is copied → the assistant builds
  the site in build mode while the preview fills in.

### Overlay (`@galley/overlay`)

A dependency-free script served on the previewed site's origin by the preview
proxy. In edit mode it outlines text and images on hover, reports clicks to
the host window (`OverlayToHost`), and — once the host says the text resolved
uniquely and plainly — lets the element be retyped in place. It also reports
navigation and scroll so the baseline frame can follow. The protocol is in
`types.ts`.

---

## 6. Desktop (`apps/desktop`)

A Tauri 2 shell written in Rust. It launches the Galley server as a sidecar
on a free loopback port with a fresh session token, waits for the health
check, and opens the web UI in a native window — and a window per site on
request, each with the same narrowly granted bridge, remembered across
launches. It adds what a browser tab cannot: a native folder picker, a menu
(with recent sites, and a Dock menu on macOS), opening folders dropped on the
app or `galley://open` links, and clean shutdown of the sidecar and any dev
servers. No bundled Chromium; the sidecar is a bundled Node
runtime running the same server bundle the CLI ships. (Keychain storage for
secrets is planned, not built.)

---

## 7. Conventions

- TypeScript strict, ESM, `import type` for types. Named exports only.
- No new dependency without a reason you could say out loud; prefer the
  platform. Add with `pnpm add --filter <package> <dep>`; never delete the
  lockfile or `node_modules`.
- Paths in data are repo-relative POSIX. Convert at the filesystem boundary.
- Throw `GalleyError` for anything the user should read. Never swallow an
  error silently; never log a secret.
- Tests: `vitest`, colocated under `packages/*/test`. Engine code is tested
  against real files and real temporary git repositories, not mocks.
- Comments explain *why* a thing is the way it is. No narration, no
  commented-out code, no TODOs without an owner.
- UI copy follows `brand/voice.md`.
- Changes arrive as pull requests; see `CONTRIBUTING.md`.
