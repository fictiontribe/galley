# Changelog

All notable changes to Galley, newest first. Versions follow
[Semantic Versioning](https://semver.org); while Galley is 0.x, a minor version
may change the configuration file, the HTTP API or the adapter API, and the
entry says how.

## Unreleased

### Added

- **Host the editor online on Google Cloud.** A fourth place for the
  editor: a virtual machine of its own in your Google Cloud project, with a
  20 GB disk, a network of its own, one firewall rule for the web ports (no
  SSH) and a fixed address, running the same compose recipe as "Any server
  with Docker" (the editor and Caddy for HTTPS). It needs a key file from
  Google Cloud (a service account's JSON key) with Compute Instance Admin
  (v1), Compute Network Admin and Compute Security Admin; the app checks the
  roles and the Compute Engine API before anything is made. About $17.88 a
  month with 2 GB, $30.11 with 4 GB (on-demand in Iowa, worked out from
  Google's hourly prices, read 2026-11-24). Also `galley host --host gcp`
  and `GOOGLE_APPLICATION_CREDENTIALS_JSON`. Run only against a stand-in for
  Google's APIs so far.

### Fixed

- **Next.js 16 no longer writes an AGENTS.md into the site** when Galley
  is started from Cursor's agent, GitHub Copilot's CLI, Augment or
  Antigravity: the preview's dev server no longer gets the variables those
  tools set, which `next dev` takes as an AI agent running it.
- **Media detection** no longer picks a `public/images` that doesn't exist
  when the site keeps its images in a folder of another name
  (`public/imagery`): new images are saved there. A site with no images
  folder still gets `public/images`.
- **A list of short values** (a list of strings, links or numbers) no longer
  gives every row the same `id`: the controls inside a group of fields take
  no id from the group, whose legend names it.

## 0.2.0 — 2026-11-24

A hosted install now looks after one site. If you run `galley serve` for
several sites today, read **Changed** before upgrading.

### Added

- **A hosted install looks after one site.** `galley serve` (and the image)
  now runs Galley for exactly one site, with its own state in one data
  folder: ten sites are ten installs that share nothing. The desktop app and
  the local command line stay multi-site. The multi-site routes answer 403 on
  a hosted install, and it has an **Install** page instead of a Sites screen.
  An older hosted data folder with one site is adopted in place; with several,
  `GALLEY_SITE_DIR` names the one to keep. The whole account:
  [`docs/cloud-install.md`](docs/cloud-install.md).
- **First run from a one-time setup link**: choose the password, connect the
  site — an existing repository, a folder inside one, or a starter sent to an
  empty repository — with the install's own deploy key or an access token,
  then the publishing name, the live address and the assistant's key. Or
  restore from a backup. Everything it asks can be given up front as starting
  values (the environment or one JSON file), used once, so restarts change
  nothing.
- **The preview through one address.** The preview and the live comparison
  are served by hostname on the server's one port (`cms-preview.example.com`,
  `cms-live.example.com`), on origins of their own, only to a browser the
  editor let in.
- **Backups**: one file sealed with a passphrase, from the Install page or
  `galley backup create|restore`, with the site's unpublished changes and
  history. Backups kept in the data folder's `backups/` are never part of a
  backup and a restore leaves them alone.
- **Operations**: `/healthz` and `/readyz`, logs with no secrets and one line
  per request, a graceful stop, a memory ceiling for the site's own commands.
- **The image and its files.** The image runs the server as `node` with no
  capabilities. `galley host recipe` writes one install's compose file,
  Caddyfile and `.env` (Caddy, a Caddy shared by several installs, or a
  Cloudflare Tunnel in front), hardened, with no port published for the
  editor; the repository's own `docker-compose.yml`, `Caddyfile` and
  `.env.example` are that output. `scripts/create-install.sh` adds one install
  per run to a server with Docker. Building the image needs Docker's
  BuildKit. The image is not on a registry yet.
- **Host the editor online**, from **Online** or `galley host`: a hosted
  install for the open site on your own Fly.io account, behind a Cloudflare
  Tunnel on a computer of yours, or as files for any server with Docker —
  planned and priced before anything is created, keys handed over only when
  you tick them, removed exactly. `--preview-address` and `--live-address`
  for addresses like `example.co.uk`. Run against strict stand-ins for
  Fly.io and Cloudflare, not yet against the real services. Plugins can add
  hosts (`editorHosts`); `galley.config.json` gains `editor` (`url`, `host`).

### Changed

- **Sign-in on a hosted install**: `galley serve` no longer needs
  `GALLEY_PASSWORD`. The password is stored as an scrypt hash, can be changed
  in the app, and **Sign out everywhere** and sign-outs survive a restart; the
  cookie is `__Host-` on `https://`. `galley serve --reset-password` replaces
  a forgotten password with a new setup link and keeps serving; a setup code
  that was used stays dead.
- On a hosted install, preview ports are no longer used, and
  `GALLEY_PREVIEW_PORTS` and `GALLEY_SITES_DIR` are ignored.
- A hosted install keeps the site's live address in its own state, never in
  the site's `galley.config.json` (the site's own `urls.production` wins), so
  first run leaves no unpublished change; and installing the site's packages
  for the preview never leaves a lockfile in a site that has none.
- `galley serve` exits by itself once it has stopped.
## 0.1.3 — 2026-11-24

Fixes for problems seen while capturing the tour and the how-to guides.

### Fixed

- **Forms**: a form used by a page section is listed as used (a page with
  several forms, a section that names its form by id, and a section showing
  its default form were all missed). **Add a destination** is a proper menu
  inside its column. **Use this form** proposes the section that shows this
  form, not the first form section it finds.
- **Proof**: a new script is named ("Scripts › Google Analytics 4 · Added"),
  and a count of details no longer looks like a link.
- **Search and AI checks**: pages are read once the preview has woken, so the
  first check no longer says pages "didn't answer"; the "Fixed" message goes
  away by itself; and changing an AI-crawler rule keeps its confirm bar in
  view, and no longer loses unsaved choices when the checks refresh.
- **Moving from WordPress**: after the import's changes are discarded or
  published, the report says so and offers to start again; "Put it online" is
  a button like its neighbours.
- **Brand**: material says where it will be kept before and after saving;
  voice examples name their page ("Home page"); colour cards line up.
- **Click to edit**: "Which one did you mean?" can be closed (a Close button,
  Escape, or a click elsewhere), and focus returns to the page. Menus and
  popovers across the app now take focus when they open.
- **Online**: set-up ends by saying its settings are a change waiting in
  Proof, with one press to publish just that; the address has a labelled
  Copy button.
- **Site settings**: the Save bar no longer covers the next section.
- **The assistant**: an empty pane offers to continue the last conversation.
- **Inbox**: "Test" means a submission from the app's own preview or "Send a
  test", not any submission from the same computer.
- Smaller things: the suggested publish note names the home page "Home
  page"; generated file names end on a whole word; the answer under "Try an
  address" has no stray space; the editor's address box shows the whole
  address.

### Changed

- Agent-readable pages and the per-crawler switch are marked built, for
  Astro sites with the site kit.

## 0.1.2 — 2026-11-24

### Fixed

- **Redirects are no longer read as page links.** The Search and AI checks
  and Proof's "things to check" reported every old address in the redirects
  list as a broken link, and **Point it at the new address** rewrote the
  redirect itself. The list and the host files written from it are now left
  out of link checks, and a fix can never edit them. A real broken link in a
  page still gets its fix.
- **Brand: material added after the brand is saved can be read.** New files
  are offered as "new files to read" whenever there are any, and stay offered
  across a restart.
- **The Brand screen opens at once** instead of staying blank while it reads
  the site's styles.
- **From a WordPress move to its redirects**: "Review redirects" opens the
  review with the import's old addresses already chosen, and a list that
  already has redirects says how many of them are still waiting.
- A command whose output is cut short (`galley starters | head`) ends quietly.
- `galley mcp config` prints the `npx -y galley-cms mcp …` form first.
- Wording: the path of a redirect loop, the contrast notes and type sample on
  the Brand screen, the summary of the Search and AI checks, and the WordPress
  report (no command-line option in the app's text; it says when entries were
  left out).

### Changed

- Redirects, the brand set-up and the Search and AI checks are no longer
  marked "new, in final checks".

## 0.1.1 — 2026-11-24

### Added

- **Your own domain** for a site that is online: **Online › Use your own
  domain…** in the app, `galley domain <hostname>` and
  `galley deploy --domain <hostname>` on the command line. Galley shows what
  will change first, never replaces a DNS record, waits until the address
  answers over HTTPS, and detaches only an address it attached itself. On
  Cloudflare the domain has to be in the same account as the site; on Vercel
  you're shown the DNS record to add. New optional settings: `deploy.domain`
  and `deploy.defaultUrl`.

### Changed

- The packages describe Galley as an open-source AI CMS **for static sites**:
  Astro fits deepest, and Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo
  and Jekyll are recognised by their conventions.
- The documentation, the quickstart and the starters' READMEs start from
  `npm create galley@latest` and `npx galley-cms`; running from a clone is in
  `CONTRIBUTING.md`, for people changing Galley itself.
- A site's live address stays the one you chose: a deploy no longer replaces
  an own domain with the host's default address.

### Known problems (fixed in 0.1.2)

- The Search and AI checks, and Proof's "things to check", read the redirects
  list as page links and report every old address as a broken link. Don't use
  **Point it at the new address** or **Fix all** on those findings: it
  rewrites the redirect.
- `galley starters | head` (any command whose output is cut short) ends with
  an error message.

## 0.1.0 — 2026-11-23

The first release, on npm as `galley-cms` and `create-galley`.

### Engine (`@galley/core`)

- **Detection without configuration**: framework, package manager, dev and
  build commands, collections, fields, page sections, URL patterns, media
  folders and the live address, read statically — no site code is run.
- **The Astro adapter**: `astro.config.*`, the content config and its zod
  schemas (glob and file loaders, legacy collections, Starlight's loaders,
  discriminated unions as page sections), and dynamic routes in `src/pages`.
- **Convention adapters** for Eleventy, Hugo, Jekyll, Next.js, Nuxt,
  SvelteKit and Docusaurus, and a generic markdown fallback.
- **The public adapter API** (`GalleyAdapter`, `AdapterContext` and its
  helpers, `defineAdapter`, `conventionAdapter`), with site adapters loaded
  only when `galley.config.json` names them.
- **Schema inference** from the files, with the precedence config > schema >
  inferred.
- **`galley.config.json`**: strict validation with readable errors, and a JSON
  Schema generated from the same definition.
- **Surgical edits**: YAML scalars spliced at their byte range, structural
  edits through the YAML document API, JSON indentation kept, body edits that
  refuse ambiguity, TOML read-only.
- **Click-to-edit resolution** that returns unique, ambiguous or none — never
  a guess.
- **The workspace**: contained paths, a closed write surface per mode, atomic
  writes, change sets with field-level changes, discard, publish (commit and
  push, or a branch and a pull request), undo a publish (`git revert`), pull,
  history, checkpoints, an outside-edit watcher.
- **The preview**: the site's own dev server behind a proxy that keeps hot
  reload, removes frame blocking and adds the overlay; a baseline proxy for the
  deployed site.
- **The assistant**: Anthropic's Messages API with tools, content and build
  modes enforced by the engine, one-question clarification, per-turn undo,
  prompt caching, a plain fallback request profile, settings, secrets and
  usage estimates.
- **Image generation**: OpenAI and Google providers (unverified against the
  live services) and an offline placeholder provider.

### Server, CLI and UI

- **`@galley/server`**: every route of the HTTP API, Server-Sent Events, the
  UI with a strict Content Security Policy, local mode (loopback and a session
  token) and hosted mode (a password, signed cookies, rate-limited sign-in),
  Host and Origin checks, white-label branding.
- **`galley-cms`**: `galley [path]`, `serve`, `init`, `doctor`, `new`, `mcp`,
  `version`, and `desktop` for the desktop app; a single-file bundle build.
- **`@galley/web`**: the shell, Sites (open, clone, create), site home,
  settings, version history and the editor's container. The content form,
  media library, chat, proof, preview pane and new-site screen are in
  progress.
- **`@galley/overlay`**: the script in the preview that outlines, reports
  clicks and allows retyping in place.

### Around it

- **The desktop app** (Tauri 2): runs the server privately, a native folder
  picker, clean shutdown of the server and its dev servers. Built and tested
  on macOS; installers unsigned.
- **`@galley/mcp`** (in progress): Galley over the Model Context Protocol —
  the built-in assistant's tools for any MCP client, over stdio
  (`galley mcp`) or Streamable HTTP at `/mcp` with a Bearer token.
- **`@galley/astro`** (in progress): an optional Astro Dev Toolbar app that
  shows whether Galley is running and opens the current page in it.
- **`@galley/adapter-kit`**: sixteen conformance checks for adapters, as a
  vitest helper and a command-line checker; a worked Eleventy example.
- **The Astro starter**: sixteen section types, a blog, a team, data files for
  every piece of interface text, one theme file and a content guide.
- **The container**: a `Dockerfile` and `docker-compose.yml` for hosted mode
  (not built yet).
- **The website and documentation**, which check themselves against the code
  on every build.
