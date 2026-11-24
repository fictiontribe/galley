// The command-line reference (src/content/docs/reference/cli.md), rendered
// from the CLI itself: every command in COMMANDS (packages/cli/src/main.ts)
// gets a section with its real --help output, and so does every sub-command
// a command lists. The words around each help text are the notes below; a
// command with no note stops sync-docs and check-docs, so a new command
// can't go undocumented.
//
//   pnpm --filter @galley/site sync-docs     regenerate the page

import { spawnSync } from "node:child_process";
import { join } from "node:path";

/** What to say about each command, above its help. Markdown; may link to other pages. */
const NOTES = {
  open: `Opens the site in your browser, signed in. A folder counts as a site when it has a \`package.json\`, \`.git\`, \`galley.config.json\`, \`hugo.toml\` or \`config.toml\`, \`_config.yml\`, or a \`content/\` or \`src/content/\` folder. The server keeps running until \`Ctrl+C\`, which stops the previews it started.

\`\`\`sh
galley ~/sites/caddow --no-open
\`\`\`

\`\`\`output
Galley is running at http://127.0.0.1:4400
…
Open: http://127.0.0.1:4400/sites/e9f5bf4fa34d?token=…
\`\`\``,
  serve: `A hosted install: Galley for one site, on a server, for the people its owner invites, each signing in with their own e-mail and password. Everything it keeps is in its data folder (\`GALLEY_HOME\`). With no owner yet it prints a one-time setup link, and whoever opens it creates the owner's account; \`--reset-password\` prints a one-time link for a locked-out owner to choose a new password (\`--email\` says which owner, when there are several) and keeps serving. Not in a release yet: it is in the repository. What it prints, the image, the three addresses and the proxy in front: [Run a hosted install](/docs/running/hosted/).`,
  backup: `Backs up a hosted install's data folder into one file sealed with a passphrase, or puts such a file back — the same file the Install page downloads. Stop the server first. In a container whose only volume is \`/data\`, write to \`/data/backups/\`: no backup includes it and no restore replaces it. Not in a release yet. What a backup holds: [Run a hosted install](/docs/running/hosted/#back-it-up).

\`\`\`sh
GALLEY_HOME=/data galley backup create --out /data/backups/site.bak
\`\`\``,
  host: `Puts an editor for the site online on your own account — Fly.io, Cloudflare in front of a computer of yours, or any server with Docker — as the Online screen's **Host the editor online** does. It prints the plan and the monthly cost before anything is created, and asks. \`galley host recipe\` writes the files to run one install with Docker, for an operator. \`--preview-address\` and \`--live-address\` set the other two names (needed for an address like \`example.co.uk\`). Not in a release yet: it is in the repository. [Host the editor online](/docs/editing/editor-online/).

\`\`\`sh
galley host --host fly --address cms.example.com --dry-run
galley host recipe --name acme --address cms.example.com --out -
\`\`\``,
  init: `Writes the corrections file with what detection found, for you to edit. Without \`--force\`, an existing file is left alone (exit 1). The file: [galley.config.json](/docs/configuration/).`,
  doctor: `Reads the site without running any of its code and prints what Galley sees — framework, package manager, dev and build commands, each collection with its fields, media, git, and the assistant's key. Exits with 1 only when something would stop Galley working. [Detection](/docs/concepts/detection/) explains each line.`,
  deploy: `Puts the site online from a terminal, as the app's **Online** screen does. Not run against the live services by the docs; Cloudflare has been verified by the people who built it, Vercel not yet. \`--domain\` is new in 0.1.1. Details: [Deploying, for developers](/docs/running/deploy/).`,
  media: `Keeps the site's new media in a bucket (Cloudflare R2 or Amazon S3), and pictures in Cloudflare Images, instead of its repository, as Media › Keep media outside the repository does in the app. \`connect\` asks only for what the chosen bucket needs, reads the key from the environment or asks for it with nothing shown, and saves only after a real check passes. \`move\` shows its plan and needs \`--yes\`. Not yet run against the live services by the people who built it. Details: [Media in a bucket](/docs/configuration/media-storage/).`,
  domain: `New in 0.1.1. Uses your own address for a site that is already online: it shows what will change, attaches the address on yes, waits until it answers over HTTPS, and makes it the site's live address. It never replaces a DNS record, and it detaches only an address it attached itself. On Cloudflare the domain has to be in the same account as the site. Details: [Deploying, for developers](/docs/running/deploy/).`,
  new: `Copies a starter into a new folder named after the site, installs its dependencies, records a first version with git, and opens it — the step-by-step version is [Create a new site](/docs/getting-started/new-site/). In a terminal it asks for a missing name or starter. The options a first site doesn't need:

- \`--starter <name>\` — \`caddow\`, \`ferrow\`, \`lowfield\` (the default) or \`storefront\`; \`galley starters\` describes them. [Starters](/docs/astro/starters/).
- \`--look <id>\` — one of the starter's looks (default: its first).
- \`--dir <folder>\` — where the site's folder goes (default: the current folder). It is made if it doesn't exist.
- \`--use <manager>\` — install with npm, pnpm, yarn or bun.
- \`--no-install\`, \`--no-start\`, \`--no-open\` — skip installing, stop once the site is made, or start Galley without opening the browser.
- \`--port <port>\` — the port Galley listens on.`,
  import: `Brings content from another system into a site as pending changes. Each importer has its own help.`,
  "import wordpress": `The same move as the app's guided one, from a terminal. \`--plan\` writes nothing; run it first, answer its questions with the options it names, then run the import. The whole story — what comes across, rebuilding page-builder pages, redirects: [Moving from WordPress](/docs/getting-started/wordpress/).

\`\`\`sh
galley import wordpress https://old.example.com ./site --plan
galley import wordpress https://old.example.com ./site --posts-into journal --write-redirects
\`\`\``,
  starters: `The starters \`galley new --starter\` accepts, with their looks.`,
  mcp: `Lets an AI tool work on a site with the same tools as Galley's own assistant. The tool starts \`galley mcp\` itself; \`galley mcp config --client <name>\` prints what to paste into its settings. Every tool and setup per client: [Galley over MCP](/docs/integrations/mcp/).`,
  plugin: `Adds and switches plugins for every site this Galley opens. Adding one runs \`npm\` with \`--ignore-scripts\` into Galley's home. [Plugins](/docs/plugins/).`,
  schema: `Prints the JSON Schema that \`galley.config.json\` is checked against. The address it names is where the schema will be published; until the site serves it, point \`$schema\` at a local copy (\`galley schema > galley.schema.json\`).`,
  version: `\`galley --version\` and \`galley -v\` print the same.

\`\`\`sh
galley version
\`\`\`

\`\`\`output
galley {version}
\`\`\``,
  desktop: `Not in the main help: the desktop app starts the server with this, and people don't type it. [Desktop app](/docs/running/desktop/).`,
};

const INTRO = `This page is for developers. The \`galley\` command is the one binary of the \`galley-cms\` package on npm: type \`npx galley-cms\` where this page writes \`galley\` ([Quickstart](/docs/getting-started/quickstart/#open-your-site)). The source is [\`packages/cli/src/\`]({repository}/tree/main/packages/cli/src). **This page is generated from the CLI itself** (\`apps/site/scripts/reference-cli.mjs\`): every help text below is the command's real output, from the repository — so where a command or option is newer than the release on npm, its note says so.

**Exit codes**: \`0\` success; \`1\` it couldn't do it (no such folder, a refused start-up, \`doctor\` found a blocking problem, a failed deploy); \`2\` the command was typed wrong — an unknown option, a missing value, too many arguments.

Environment variables the commands read: [Environment variables](/docs/reference/environment/).`;

function run(repoRoot, args) {
  const result = spawnSync(process.execPath, [join(repoRoot, "packages/cli/bin/galley.js"), ...args], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME } });

  if (result.status !== 0) throw new Error(`galley ${args.join(" ")} exited with ${result.status}: ${result.stderr}`);
  return result.stdout.replace(/\s+$/gm, "").trim();
}

/** Sub-commands a command's help lists in the form "Run `galley <cmd> <from> --help`". */
function subcommands(help) {
  if (!/Run `galley \S+ <[^>]+> --help`/.test(help)) return [];
  return [...help.matchAll(/^  ([a-z][a-z-]+)  /gm)].map((m) => m[1]);
}

export async function commandNames(repoRoot) {
  const { register } = await import("tsx/esm/api");
  register();
  const { COMMANDS } = await import(join(repoRoot, "packages/cli/src/main.ts"));
  return Object.keys(COMMANDS);
}

/** The page's body (no front matter). Throws when a command has no note. */
export function renderCliReference(repoRoot, names) {
  const sections = [{ title: "`galley [path]`", note: NOTES.open, help: run(repoRoot, [".", "--help"]) }];

  for (const name of names) {
    const help = run(repoRoot, [name, "--help"]);
    const title = name === "new" ? "`galley new <name>`" : ["init", "doctor", "deploy", "mcp"].includes(name) ? `\`galley ${name} [path]\`` : `\`galley ${name}\``;

    sections.push({ title, note: NOTES[name], help, name });
    for (const sub of subcommands(help)) sections.push({ title: `\`galley ${name} ${sub}\``, note: NOTES[`${name} ${sub}`], help: run(repoRoot, [name, sub, "--help"]), name: `${name} ${sub}` });
  }
  const missing = sections.filter((s) => !s.note).map((s) => s.title);

  if (missing.length) throw new Error(`these commands have no note in apps/site/scripts/reference-cli.mjs: ${missing.join(", ")}`);
  const known = new Set(["open", ...sections.map((s) => s.name).filter(Boolean)]);
  const stale = Object.keys(NOTES).filter((key) => !known.has(key));

  if (stale.length) throw new Error(`apps/site/scripts/reference-cli.mjs has notes for commands that don't exist: ${stale.join(", ")}`);
  const out = [INTRO, "", "Every command, from `galley --help`:", "", "```text", run(repoRoot, ["--help"]), "```", ""];

  for (const s of sections) out.push(`## ${s.title}`, "", s.note, "", "Its help (`--help`):", "", "```text", s.help, "```", "");
  out.push("## Next", "", "- [Environment variables](/docs/reference/environment/).", "- [Troubleshooting](/docs/reference/troubleshooting/) — what the messages mean.");
  return `${out.join("\n")}\n`;
}
