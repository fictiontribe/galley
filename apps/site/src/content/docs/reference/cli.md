---
title: "Command line"
description: "Every galley command and option, with its real help text and exit codes. Generated from the CLI."
group: "reference"
order: 1
---

<!-- Generated from the CLI's own --help output by apps/site/scripts/reference-cli.mjs. Edit that file (or the command's help), not this page. -->

This page is for developers. The `galley` command is the one binary of the `galley-cms` package on npm: type `npx galley-cms` where this page writes `galley` ([Quickstart](/docs/getting-started/quickstart/#open-your-site)). The source is [`packages/cli/src/`]({repository}/tree/main/packages/cli/src). **This page is generated from the CLI itself** (`apps/site/scripts/reference-cli.mjs`): every help text below is the command's real output, from the repository — so where a command or option is newer than the release on npm, its note says so.

**Exit codes**: `0` success; `1` it couldn't do it (no such folder, a refused start-up, `doctor` found a blocking problem, a failed deploy); `2` the command was typed wrong — an unknown option, a missing value, too many arguments.

Environment variables the commands read: [Environment variables](/docs/reference/environment/).

Every command, from `galley --help`:

```text
Galley — The AI CMS for static sites. Prompt it. Proof it. Publish it.
Usage
  galley [path]          Open the site in [path] (default: this folder) in the browser
  galley serve           Run for other computers, behind a password
  galley backup …        Back up a hosted install's data folder, or put a backup back
  galley init [path]     Write galley.config.json from what detection finds
  galley doctor [path]   Check that a site and this computer are ready
  galley deploy [path]   Put the site online with Cloudflare or Vercel (--preview: unpublished changes)
  galley domain [path]   Use your own domain for a site that is online
  galley host [path]     Host the editor online for the site, on your own account (Fly.io, Cloudflare, a server)
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
galley ~/sites/caddow --no-open
```

```output
Galley is running at http://127.0.0.1:4400
…
Open: http://127.0.0.1:4400/sites/e9f5bf4fa34d?token=…
```

Its help (`--help`):

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

A hosted install: Galley for one site, on a server, behind a password. Everything it keeps is in its data folder (`GALLEY_HOME`). With no password yet it prints a one-time setup link; `--reset-password` makes a new one for a forgotten password and keeps serving. Not in a release yet: it is in the repository. What it prints, the image, the three addresses and the proxy in front: [Run a hosted install](/docs/running/hosted/).

Its help (`--help`):

```text
Usage: galley serve [options]
Run Galley for other computers (hosted mode): one site, behind a password.
Everything it keeps — the site, settings, keys, sessions — is in its data folder (GALLEY_HOME).
Options
      --host <address>      Interface to listen on (default GALLEY_HOST, then 0.0.0.0)
  -p, --port <port>         Port to listen on (default GALLEY_PORT, then 4400)
      --reset-password      Forget the password, sign everyone out and print a new
                            one-time setup link, then serve as usual until stopped.
                            Whoever opens the link first chooses the new password.
                            Stopped before that, the next start prints a fresh link
  -h, --help                Show this help
First run
  With no password yet, the server prints a one-time setup link. Whoever opens it first
  chooses the password and connects the site, so open it straight away.
Recommended
  GALLEY_PUBLIC_URL         The address people use, e.g. https://cms.example.com
  GALLEY_TRUST_PROXY=1      When a reverse proxy terminates HTTPS in front of this server
Previews (served through this server's one port, by hostname; point both names at it)
  GALLEY_PREVIEW_URL        Where the site's preview is shown. Default: worked out from
                            GALLEY_PUBLIC_URL (cms.example.com → cms-preview.example.com)
  GALLEY_LIVE_VIEW_URL      Where the live site is shown beside it (→ cms-live.example.com)
  GALLEY_PREVIEW_MEMORY_MB  A memory ceiling for the site's own preview, build and install
                            commands (default: none)
Operations
  GET /healthz, /readyz     Health and readiness, for a load balancer or a container's check
  GALLEY_LOG_REQUESTS=0     Leave out the one line per request (on by default)
  GALLEY_SHUTDOWN_GRACE_MS  How long stopping waits for a publish or a connect in progress
                            (default 20000)
  GALLEY_RESTORE_MAX_MB     The largest backup a restore in the app takes (default 2048);
                            larger ones: `galley backup restore` with the server stopped
Unattended start (starting values: each is used once, while the install doesn't have
that thing yet, so what someone later changes in the app sticks)
  GALLEY_PASSWORD           The sign-in password, 12 characters or more
  GALLEY_SETUP_TOKEN        The one-time setup code to use (24 characters or more), or
  GALLEY_SETUP_TOKEN_SHA256 only its SHA-256, so the code never reaches the server
  GALLEY_SITE_REPOSITORY    The site's repository: git@host:owner/name.git or https://…
  GALLEY_SITE_ACCESS        deploy-key (the install's own key; default) or token
  GALLEY_SITE_TOKEN         The access token, with GALLEY_SITE_ACCESS=token
  GALLEY_SITE_BRANCH        Default: the repository's own default branch
  GALLEY_SITE_FOLDER        The folder inside the repository that holds the site (e.g. apps/site)
  GALLEY_SITE_STARTER       Send this starter to an empty repository instead
  GALLEY_AUTHOR_NAME        The name and e-mail every publish is recorded with
  GALLEY_AUTHOR_EMAIL
  GALLEY_SITE_LIVE_URL      The site's live address
  GALLEY_INSTALL_CONFIG     One JSON file with any of the above (the environment wins)
Secrets are read from the environment or that file only, so they never show up in a process list.
```

## `galley backup`

Backs up a hosted install's data folder into one file sealed with a passphrase, or puts such a file back — the same file the Install page downloads. Stop the server first. In a container whose only volume is `/data`, write to `/data/backups/`: no backup includes it and no restore replaces it. Not in a release yet. What a backup holds: [Run a hosted install](/docs/running/hosted/#back-it-up).

```sh
GALLEY_HOME=/data galley backup create --out /data/backups/site.bak
```

Its help (`--help`):

```text
Usage: galley backup create --out <file>
       galley backup restore <file>
Back up a hosted Galley's data folder (GALLEY_HOME), or put a backup
back in its place, with the server stopped. The file is the same one the app's
Install page downloads: the site with its history and unpublished changes, the
settings, the keys and the sign-in, sealed with a passphrase.
Options
      --out <file>          Where to write the backup (create). Inside the data
                            folder, use its backups/ folder: it is never part of
                            a backup and a restore leaves it alone
      --home <folder>       The data folder (default GALLEY_HOME)
      --force               Go ahead though a lock file says a server on another
                            machine uses the folder (only when you know it is stopped)
  -h, --help                Show this help
The passphrase is read from GALLEY_BACKUP_PASSPHRASE, or asked for (not shown as
you type it). It needs at least 12 characters. Without it the backup can't be
opened: keep it somewhere safe.
After a restore everyone is signed out; sign in with the password the backup was
made with.
```

## `galley init [path]`

Writes the corrections file with what detection found, for you to edit. Without `--force`, an existing file is left alone (exit 1). The file: [galley.config.json](/docs/configuration/).

Its help (`--help`):

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

Its help (`--help`):

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

Copies a starter into a new folder named after the site, installs its dependencies, records a first version with git, and opens it — the step-by-step version is [Create a new site](/docs/getting-started/new-site/). In a terminal it asks for a missing name or starter. The options a first site doesn't need:

- `--starter <name>` — `caddow`, `ferrow`, `lowfield` (the default) or `storefront`; `galley starters` describes them. [Starters](/docs/astro/starters/).
- `--look <id>` — one of the starter's looks (default: its first).
- `--dir <folder>` — where the site's folder goes (default: the current folder). It is made if it doesn't exist.
- `--use <manager>` — install with npm, pnpm, yarn or bun.
- `--no-install`, `--no-start`, `--no-open` — skip installing, stop once the site is made, or start Galley without opening the browser.
- `--port <port>` — the port Galley listens on.

Its help (`--help`):

```text
Usage: galley new [name] [options]
Start a new site from a starter: copy it into a new folder named after the
site, install its dependencies, record the first version, and open
Galley on it in the browser. In a terminal it asks for the name and
the starter when they're missing.
Options
      --starter <name>  Which starter (default: lowfield); they're listed below
      --look <id>       One of the starter's looks (default: its first)
      --dir <folder>    Where to make the site's folder (default: this folder)
      --use <manager>   Install with npm, pnpm, yarn or bun (default: the one that ran this)
      --no-install      Don't install dependencies
      --no-open         Start Galley, but don't open the browser
      --no-start        Stop once the site is made
  -p, --port <port>     Port for Galley (default 4400, or the next free one)
  -h, --help            Show this help
Starters
  lowfield: Lowfield — small business (the default)
    A site for a small studio or local business
    17 sections · 5 page templates · looks: lowfield (default), sage, evening
    npm create galley@latest my-site -- --starter lowfield
  caddow: Caddow — fashion editorial
    A photography-led site for a small fashion label
    20 sections · 6 page templates · looks: chalk (default), paper, night
    npm create galley@latest my-site -- --starter caddow
  ferrow: Ferrow — B2B software
    A marketing site for a software company
    29 sections · 7 page templates · looks: signal (default), meridian, night-shift
    npm create galley@latest my-site -- --starter ferrow
  storefront: Caddow — storefront
    A shop for a small fashion label, with products from Shopify
    24 sections · 8 page templates · looks: chalk (default), paper, night
    npm create galley@latest my-site -- --starter storefront
```

## `galley starters`

The starters `galley new --starter` accepts, with their looks.

Its help (`--help`):

```text
Usage: galley starters [--json]
List the starters `galley new` can copy: what each one is, what is
inside, and the command that makes a site from it.
Options
      --json   Print them as JSON
  -h, --help   Show this help
```

## `galley mcp [path]`

Lets an AI tool work on a site with the same tools as Galley's own assistant. The tool starts `galley mcp` itself; `galley mcp config --client <name>` prints what to paste into its settings. Every tool and setup per client: [Galley over MCP](/docs/integrations/mcp/).

Its help (`--help`):

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

Its help (`--help`):

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

Its help (`--help`):

```text
Usage: galley import <from> <source> [path] [options]
Bring another site's content into this one. It arrives as pending changes: check it in Proof, then publish.
You can import from
  wordpress  WordPress, from an address or an export file
             Posts, pages, images and SEO details from a WordPress site (its address or an export file), as pending changes to proof.
Run `galley import <from> --help` for its options, e.g. `galley import wordpress --help`.
```

## `galley import wordpress`

The same move as the app's guided one, from a terminal. `--plan` writes nothing; run it first, answer its questions with the options it names, then run the import. The whole story — what comes across, rebuilding page-builder pages, redirects: [Moving from WordPress](/docs/getting-started/wordpress/).

```sh
galley import wordpress https://old.example.com ./site --plan
galley import wordpress https://old.example.com ./site --posts-into journal --write-redirects
```

Its help (`--help`):

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

Puts the site online from a terminal, as the app's **Online** screen does. Not run against the live services by the docs; Cloudflare has been verified by the people who built it, Vercel not yet. `--domain` is new in 0.1.1. Details: [Deploying, for developers](/docs/running/deploy/).

Its help (`--help`):

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
      --domain <host>   Afterwards, use your own address for the live site
                        (see `galley domain --help`)
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

## `galley domain`

New in 0.1.1. Uses your own address for a site that is already online: it shows what will change, attaches the address on yes, waits until it answers over HTTPS, and makes it the site's live address. It never replaces a DNS record, and it detaches only an address it attached itself. On Cloudflare the domain has to be in the same account as the site. Details: [Deploying, for developers](/docs/running/deploy/).

Its help (`--help`):

```text
Usage: galley domain [path] [hostname] [options]
Use your own domain for the site in [path] (default: this folder), which must
already be online. With a hostname: show what will change, attach it on yes,
and wait until it answers over HTTPS — it then becomes the site's live
address. Without one: show the address in use.
Options
      --check     Look again at an address that isn't answering yet
      --remove    Stop using the address (it is detached only if Galley attached it)
  -y, --yes       Don't ask before attaching or removing
      --json      Print the result as JSON
  -h, --help      Show this help
Examples
  galley domain www.example.com
  galley domain ./site --remove --yes
```

## `galley host`

Puts an editor for the site online on your own account — Fly.io, Cloudflare in front of a computer of yours, or any server with Docker — as the Online screen's **Host the editor online** does. It prints the plan and the monthly cost before anything is created, and asks. `galley host recipe` writes the files to run one install with Docker, for an operator. `--preview-address` and `--live-address` set the other two names (needed for an address like `example.co.uk`). Not in a release yet: it is in the repository. [Host the editor online](/docs/editing/editor-online/).

```sh
galley host --host fly --address cms.example.com --dry-run
galley host recipe --name acme --address cms.example.com --out -
```

Its help (`--help`):

```text
Usage: galley host [path] --host <where> --address <name> [options]
       galley host status|link|check|upgrade|backup|remove [path]
       galley host recipe --name <name> --address <name> [options]
Put an editor for the site in [path] (default: this folder) online, on your
own account: a hosted Galley with its own disk, at three addresses of
your domain (the editor, its preview and the live comparison). It prints
everything it would create and what it costs a month before anything is
created, and asks before creating it. The site's settings
(galley.config.json › editor) then say where its editor lives.
Where (--host)
  fly           Fly.io: everything is created on your Fly.io account
  cloudflare    Cloudflare in front of a computer of yours: a tunnel and three
                DNS names on Cloudflare; you start the files it writes
  own-server    Any server with Docker: it writes the files, you start them
Options
      --address <name>     The editor's address, like cms.example.com
      --preview-address <name>  The preview's address (default: worked out from
                           --address, cms.example.com → cms-preview.example.com)
      --live-address <name>     The live comparison's (→ cms-live.example.com).
                           Give both for an address like example.co.uk, whose
                           worked-out names would be someone else's domain
      --name <name>        The short name everything created carries
                           (default: from the site's name)
      --account <id>       The Fly.io organization or Cloudflare account
      --region <id>        Fly.io: where it runs (default: iad)
      --option <key=value> A host's own choice, e.g. memory=1024, sleep=off,
                           proxy=shared-proxy (repeatable)
      --hand-over <keys>   Keys to copy to it, by name, comma-separated
                           (e.g. anthropic). Default: none
      --out <folder>       Where to write the files a self-run install needs
                           (default: a folder named after it, here)
      --dry-run            Print the plan and stop: nothing is created
  -y, --yes                Don't ask: create (or remove) what the plan says
      --json               Print the result as JSON
  -h, --help               Show this help
Afterwards
  status     Where the editor is, whether it answers, what is left to do
  link       The first-run link, while its first run isn't finished
  check      Look again (after starting the files or adding DNS names by
             hand) and hand the site over once it answers
  upgrade    Move it to this version of Galley, keeping its disk
  backup     Copy its disk on the host, or say where backups are downloaded
  remove     Print exactly what will be deleted, then delete it (asks; --yes)
recipe: the files to run one install with Docker, for an operator
      --name <name> --address <name>      Required
      --preview-address <name> --live-address <name>  As above
      --repository <address>  The site's repository
      --folder <path>         Where the site is inside it ("apps/site")
      --proxy <how>           caddy (default), shared-proxy or tunnel
      --image <reference>     Default: ghcr.io/fictiontribe/galley:0.2.0
      --setup-token-sha256 <hex>  The SHA-256 of a one-time setup code
      --out <folder|->        Write the files there (default -: print them)
Keys
  Read from FLY_API_TOKEN or CLOUDFLARE_API_TOKEN when set, otherwise the one
  stored with the app, otherwise asked for on a terminal (and stored).
Examples
  galley host --host fly --address cms.example.com --dry-run
  galley host --host own-server --address cms.example.com --yes
  galley host recipe --name acme-editor --address cms.example.com --out ./acme
```

## `galley schema`

Prints the JSON Schema that `galley.config.json` is checked against. The address it names is where the schema will be published; until the site serves it, point `$schema` at a local copy (`galley schema > galley.schema.json`).

Its help (`--help`):

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

```sh
galley version
```

```output
galley {version}
```

Its help (`--help`):

```text
Usage: galley version [--json]
Print the version.
```

## `galley desktop`

Not in the main help: the desktop app starts the server with this, and people don't type it. [Desktop app](/docs/running/desktop/).

Its help (`--help`):

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
