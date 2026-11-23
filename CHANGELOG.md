# Changelog

All notable changes to Galley, newest first. Versions follow
[Semantic Versioning](https://semver.org); while Galley is 0.x, a minor version
may change the configuration file, the HTTP API or the adapter API, and the
entry says how.

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
