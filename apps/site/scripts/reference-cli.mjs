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
  serve: `Hosted mode: one Galley for several people, behind one shared password. What it prints at start-up, the container and the reverse proxy: [Self-hosting](/docs/running/hosted/).`,
  init: `Writes the corrections file with what detection found, for you to edit. Without \`--force\`, an existing file is left alone (exit 1). The file: [galley.config.json](/docs/configuration/).`,
  doctor: `Reads the site without running any of its code and prints what Galley sees — framework, package manager, dev and build commands, each collection with its fields, media, git, and the assistant's key. Exits with 1 only when something would stop Galley working. [Detection](/docs/concepts/detection/) explains each line.`,
  deploy: `Puts the site online from a terminal, as the app's **Online** screen does. Not run against the live services by the docs; Cloudflare has been verified by the people who built it, Vercel not yet. Details: [Deploying, for developers](/docs/running/deploy/).`,
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

const INTRO = `This page is for developers. The \`galley\` command is the one binary of the \`galley-cms\` package. **That package isn't on npm yet**: run it from a clone of the repository as \`node packages/cli/bin/galley.js\`, aliased as \`galley\` ([Quickstart](/docs/getting-started/quickstart/#open-your-site)). The source is [\`packages/cli/src/\`]({repository}/tree/main/packages/cli/src). **This page is generated from the CLI itself** (\`apps/site/scripts/reference-cli.mjs\`): every help text below is the command's real output.

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
