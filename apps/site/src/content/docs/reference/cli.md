---
title: "Command line"
description: "Every galley command and option, with its real help text and exit codes. Generated from the CLI."
group: "reference"
order: 1
---

<!-- Generated from the CLI's own --help output by apps/site/scripts/reference-cli.mjs. Edit that file (or the command's help), not this page. -->

This page is for developers. The `galley` command is the one binary of the `galley-cms` package. **That package isn't on npm yet**: run it from a clone of the repository as `node packages/cli/bin/galley.js`, aliased as `galley` ([Quickstart](/docs/getting-started/quickstart/#get-galley)). The source is [`packages/cli/src/`]({repository}/tree/main/packages/cli/src). **This page is generated from the CLI itself** (`apps/site/scripts/reference-cli.mjs`): every help text below is the command's real output.

**Exit codes**: `0` success; `1` it couldn't do it (no such folder, a refused start-up, `doctor` found a blocking problem, a failed deploy); `2` the command was typed wrong — an unknown option, a missing value, too many arguments.

Environment variables the commands read: [Environment variables](/docs/reference/environment/).

```sh
$ galley --help
Galley — The AI CMS for static sites. Prompt it. Proof it. Publish it.
Usage
  galley [path]          Open the site in [path] (default: this folder) in the browser
  galley serve           Run for other computers, behind a password
  galley init [path]     Write galley.config.json from what detection finds
  galley doctor [path]   Check that a site and this computer are ready
  galley deploy [path]   Put the site online with Cloudflare or Vercel (--preview: unpublished changes)
  galley new <name>      Start a new site from a starter
  galley import …        Bring a WordPress site (or another importer's) into a site
  galley starters        List the starters and their looks
  galley mcp [path]      Let an AI tool (Claude, Cursor, VS Code…) edit the site over MCP
  galley plugin …        Add plugins, list them, turn them on or off
  galley schema          Print the JSON Schema of galley.config.json (--out <folder>: write every schema)
  galley version         Print the version
Run `galley <command> --help` for a command's options.
```

## `galley [path]`

Opens the site in your browser, signed in. A folder counts as a site when it has a `package.json`, `.git`, `galley.config.json`, `hugo.toml` or `config.toml`, `_config.yml`, or a `content/` or `src/content/` folder. The server keeps running until `Ctrl+C`, which stops the previews it started.

```sh
$ galley ~/sites/caddow --no-open
Galley is running at http://127.0.0.1:4400
Site: Caddow (/Users/you/sites/caddow)
Open: http://127.0.0.1:4400/sites/e9f5bf4fa34d?token=…
Press Ctrl+C to stop.
```

```text
Usage: galley [path] [options]
Open the site in [path] (default: this folder) and the browser, signed in.
Everything stays on this computer: the server listens on 127.0.0.1 only.
Options
  -p, --port <port>   Port to listen on (default 4400, or the next free one)
      --no-open       Don't open the browser; print the link instead
  -h, --help          Show this help
```

## `galley serve`

Hosted mode: one Galley for several people, behind one shared password. What it prints at start-up, the container and the reverse proxy: [Self-hosting](/docs/running/hosted/).

```text
Usage: galley serve [options]
Run Galley for other computers (hosted mode), behind a password.
Options
      --host <address>      Interface to listen on (default GALLEY_HOST, then 0.0.0.0)
  -p, --port <port>         Port to listen on (default GALLEY_PORT, then 4400)
      --sites-dir <folder>  The only folder sites can be opened from or created in
                            (default GALLEY_SITES_DIR, then <GALLEY_HOME>/sites)
  -h, --help                Show this help
Required
  GALLEY_PASSWORD           The sign-in password, 12 characters or more. Read from the
                            environment only, so it never shows up in a process list.
Recommended
  GALLEY_PUBLIC_URL         The address people use, e.g. https://cms.example.com
  GALLEY_TRUST_PROXY=1      When a reverse proxy terminates HTTPS in front of this server
```

## `galley init [path]`

Writes the corrections file with what detection found, for you to edit. Without `--force`, an existing file is left alone (exit 1). The file: [galley.config.json](/docs/configuration/).

```text
Usage: galley init [path] [options]
Write galley.config.json in [path] (default: this folder) from what detection
finds: the site's name, its live addresses, and each collection's id, label
and URL pattern. Everything else keeps coming from detection.
Options
      --force   Replace an existing galley.config.json
      --json    Print the result as JSON
  -h, --help    Show this help
```

## `galley doctor [path]`

Reads the site without running any of its code and prints what Galley sees — framework, package manager, dev and build commands, each collection with its fields, media, git, and the assistant's key. Exits with 1 only when something would stop Galley working. [Detection](/docs/concepts/detection/) explains each line.

```text
Usage: galley doctor [path] [options]
Check that the site in [path] (default: this folder) and this computer are
ready: what detection finds, Node, git, dependencies, and the assistant's key.
Exits with 1 when something would stop Galley from working.
Options
      --json   Print the checks as JSON
  -h, --help   Show this help
```

## `galley new <name>`

Copies a starter into a new folder, installs its dependencies, records a first version and opens it. [Start a new site from a starter](/docs/getting-started/new-site/); the starters: [Starters](/docs/astro/starters/).

```text
Usage: galley new <name> [options]
Start a new site from a starter: copy it into a new folder with your site's
name, install its dependencies, record a first version with git, then open it
as `galley <folder>` would.
Options
      --starter <id>    Starter to copy (default: astro-starter)
      --look <id>       One of the starter's looks (default: its first)
      --dir <folder>    Where to create the site's folder (default: this folder)
      --no-start        Stop after creating it
      --skip-install    Don't install dependencies
  -p, --port <port>     Port for the server when it starts
  -h, --help            Show this help
Run `galley starters` to see the starters and their looks.
Starters
  astro-saas — B2B / SaaS (astro) · looks: signal (default), meridian, night-shift
  astro-editorial — Caddow — fashion editorial (astro) · looks: chalk (default), paper, night
  astro-storefront — Caddow — storefront (astro) · looks: chalk (default), paper, night
  astro-starter — Small business (astro) · looks: lowfield (default), sage, evening
```

## `galley starters`

The starters `galley new --starter` accepts, with their looks.

```text
Usage: galley starters [--json]
List the starters `galley new` can copy, with the looks each one ships.
Options
      --json   Print them as JSON
  -h, --help   Show this help
```

## `galley mcp [path]`

Lets an AI tool work on a site with the same tools as Galley's own assistant. The tool starts `galley mcp` itself; `galley mcp config --client <name>` prints what to paste into its settings. Every tool and setup per client: [Galley over MCP](/docs/integrations/mcp/).

```text
Usage: galley mcp [path] [options]
       galley mcp config [path] --client <name> [--http]
       galley mcp token [--rotate]
Let an AI tool — Claude, Cursor, VS Code, anything that speaks the Model
Context Protocol — read, edit, proof and publish the site in [path] (default:
this folder), with the same tools Galley's own assistant uses. The tool
starts this command itself; `galley mcp config` prints what to paste into
its settings. Nothing else needs to be running.
Options
      --build         Build mode: also read and change the site's source files
                      (components, layouts, styles) and run its build
      --no-publish    Don't offer publishing; changes wait in Galley for a person
      --read-only     Only look: list, read, search and show pending changes
      --no-watch      Don't watch the folder for changes made elsewhere
  -h, --help          Show this help
galley mcp config [path]
      --client <name> claude-desktop, claude-code, cursor, vscode, generic
      --http          Connect to a running Galley at /mcp instead of starting one
      --url <address> The HTTP endpoint (default http://127.0.0.1:4400/mcp, or GALLEY_PUBLIC_URL/mcp)
                      --build, --no-publish and --read-only are passed on (stdio only)
galley mcp token
      Prints a long-lived access token for the HTTP endpoint, made on first use.
      Only a fingerprint is kept, so it is shown once.
      --rotate        Replace it; the old one stops working at once
```

## `galley plugin`

Adds and switches plugins for every site this Galley opens. Adding one runs `npm` with `--ignore-scripts` into Galley's home. [Plugins](/docs/plugins/).

```text
Usage: galley plugin <command> [options]
Add plugins to Galley on this computer, or turn them on and off.
  galley plugin list              What is built in and installed, and what each adds
  galley plugin add <package>     Install a plugin: an npm name, a folder, or a packed .tgz
  galley plugin remove <name>     Uninstall it
  galley plugin enable <name>     Turn it on
  galley plugin disable <name>    Turn it off (it stays installed)
Options
      --json   Print the result as JSON
  -h, --help   Show this help
An installed plugin runs inside Galley with your permissions: add only
plugins you trust. npm runs with --ignore-scripts, so installing never runs a
package's own scripts, and the exact version that arrived is kept. A running
app picks up changes when it restarts.
```

## `galley import`

Brings content from another system into a site as pending changes. Each importer has its own help.

```text
Usage: galley import <from> <source> [path] [options]
Bring another site's content into this one. It arrives as pending changes: check it in Proof, then publish.
You can import from
  wordpress  WordPress, from an address or an export file
             Posts, pages, images and SEO details from a WordPress site (its address or an export file), as pending changes to proof.
Run `galley import <from> --help` for its options, e.g. `galley import wordpress --help`.
```

## `galley import wordpress`

The same move as the app's guided one, from a terminal. `--plan` writes nothing. The whole story — what comes across, rebuilding page-builder pages, redirects: [Moving from WordPress](/docs/getting-started/wordpress/).

```sh
$ galley import wordpress https://old.example.com ./site --plan
$ galley import wordpress https://old.example.com ./site --posts-into journal --write-redirects
```

```text
Usage: galley import wordpress <address|file> [path] [options]
Bring a WordPress site into this site. Posts, pages, images and SEO details
arrive as pending changes: check them in Proof, then publish. Nothing goes
live by itself.
  <address>  the site's address — read through its REST API
  <file>     an export file (WordPress › Tools › Export › All content)
  [path]     the site to import into (default: this folder)
Options
      --plan                   Show what would come across; write nothing
      --into <path>            The site to import into (same as [path])
      --dry-run                Same as --plan
      --only <kinds>           posts, pages and/or media (comma-separated)
      --limit <n>              At most n posts and n pages (newest first)
      --since <YYYY-MM-DD>     Only what was published or changed since then
      --posts-into <id>        The collection posts go into, when asked
      --pages-into <id>        The collection pages go into, when asked
      --type <slug>:<id>       Also import a custom content type into a collection
      --default <field>=<v>    A value for a required field WordPress can't fill
                               (prefix a collection to target one: blog.image=/images/x.png)
      --user <name>            Sign in to read drafts and private pages…
      --app-password-env <VAR> …with the application password in this variable
                               (default WORDPRESS_APP_PASSWORD)
      --write-redirects        Write redirect files for the addresses that change
      --max-file-mb <n>        Largest single file to download (default 25)
      --max-total-mb <n>       Stop downloading media past this total (default 1024)
      --fresh                  Fetch everything again instead of resuming
      --json                   Print the report as JSON
  -h, --help                   Show this help
```

## `galley deploy [path]`

Puts the site online from a terminal, as the app's **Online** screen does. Not run against the live services by the docs; Cloudflare has been verified by the people who built it, Vercel not yet. Details: [Deploying, for developers](/docs/running/deploy/).

```text
Usage: galley deploy [path] [options]
Put the site in [path] (default: this folder) online with Cloudflare or
Vercel, and print its address. Without --preview it puts the last published
version live — never unpublished changes. The first run sets the site up,
asking only for what it can't find; the choices are saved in
galley.config.json (ids only: the access key stays in Galley's secrets).
Options
      --preview         Upload the site as it is, unpublished changes included,
                        to a preview address of its own
      --target <host>   cloudflare (default) or vercel
      --project <name>  The project on the host (default: from the site's name)
      --account <id>    The Cloudflare account or Vercel team
  -y, --yes             Don't ask: take the defaults (and an existing project)
      --json            Print the result as JSON
  -h, --help            Show this help
Access keys
  Read from CLOUDFLARE_API_TOKEN or VERCEL_TOKEN when set, otherwise the one
  stored with the app, otherwise asked for on a terminal (and stored).
  CLOUDFLARE_ACCOUNT_ID and VERCEL_TEAM_ID name the account when there are several.
Examples
  galley deploy                       Put the published site live
  galley deploy --preview             Share unpublished changes
  galley deploy ./site --target vercel --project my-site --yes
```

## `galley schema`

Prints the JSON Schema that `galley.config.json` is checked against. The address it names is where the schema will be published; until the site serves it, point `$schema` at a local copy (`galley schema > galley.schema.json`).

```text
Usage: galley schema [--out <folder>]
Print the JSON Schema of galley.config.json — the file editors fetch from
https://galley.fictiontribe.com/schema/galley.config.json to check and autocomplete the config.
With --out, write every schema the app's files name instead, one file each,
and list the address each must be served at:
  galley.config.json   https://galley.fictiontribe.com/schema/galley.config.json
  brand.json           https://galley.fictiontribe.com/schema/brand.json
Options
  -o, --out <folder>   Write the schemas into this folder (it is created)
  -h, --help           Show this help
```

## `galley version`

`galley --version` and `galley -v` print the same.

```text
Usage: galley version [--json]
Print the version.
```

## `galley desktop`

Not in the main help: the desktop app starts the server with this, and people don't type it. [Desktop app](/docs/running/desktop/).

```text
Usage: galley desktop [options]
Run the server for the desktop app, which starts it with this command. It
opens no site and no browser: the app shows the sites list in its own window.
Listens on 127.0.0.1 only, on exactly the port given (no fallback), so the app
knows where to find it.
Options
  -p, --port <port>      Port to listen on (default GALLEY_PORT, then 4400)
      --exit-with-parent Stop when standard input closes, i.e. when the
                         process that started this one exits or crashes
  -h, --help             Show this help
Environment
  GALLEY_TOKEN           The session token the app signs in with
  GALLEY_DESKTOP=1       Set by the app (reported by /api/meta)
```

## Next

- [Environment variables](/docs/reference/environment/).
- [Troubleshooting](/docs/reference/troubleshooting/) — what the messages mean.
