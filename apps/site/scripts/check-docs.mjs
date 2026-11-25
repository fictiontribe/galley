// Checks the documentation against the code, so a page cannot describe a
// command, flag, setting or file that does not exist. Run from anywhere:
//
//   pnpm --filter @galley/site check      (also runs before every site build)
//
// What it checks, in every page under src/content/docs/ (and, where it applies,
// the repository's README and policy files):
//
//   1. Every ```json galley.config.json block validates with the engine's own
//      validateConfig; a block marked `galley.config.json invalid` must fail.
//      A json block that looks like a config but is not marked is an error.
//   2. Every `galley …` invocation names a real command, and every --flag on it
//      appears in that command's real --help output. A code span that is only
//      a flag (`--no-open`) must be a flag of some command.
//   3. Every GALLEY_* variable, and every *_API_KEY, appears in the source.
//   4. Every internal link resolves: /docs/… to a page (and #anchor to one of
//      its headings), other /… paths to a route of this site, relative links in
//      the repository files to a file, {repository}/blob|tree/<branch>/<path>
//      to a file or folder that exists.
//   5. reference/config.md documents exactly the keys of the config's JSON
//      Schema, and reference/api.md exactly the routes of ApiRoutes.
//   6. Front matter: a title, a description, a group from src/data/docs.json.
//   7. Pages rendered from repository files or from the code (docs-sources.mjs:
//      the HTTP API and command-line references are generated) are up to date.
//   8. reference/environment.md has a row for every GALLEY_* variable the
//      source reads, and none it doesn't.
//   9. astro/site-kit.md documents exactly the site kit's options
//      (packages/astro/src/index.d.ts).
//  10. docs/mcp.md's tool reference matches the MCP tool catalogue.
//  11. Every <img> in the docs: its files exist, it has alt text, width and
//      height match half its 2× file, a docs picture is 120 KB or less, and
//      every picture in public/docs is used.
//  12. A quoted sub-command help ("Usage: galley import wordpress") matches
//      that sub-command's own --help.
//  13. The comparison articles (src/content/compare/): every link in them, and
//      every page their `related` list names, is a page of this site or a
//      full address; each has its claims file (claims/<name>.md, the sources
//      of what it says about other products) and the month its facts were
//      checked (`checked: November 2026`).
//
// Problems print as file:line: message, and the exit code is 1.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GENERATED, relativeTarget, render, renderSchemas, SCHEMA_DIR, targetPath } from "./docs-sources.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, "..");
const repoRoot = resolve(siteRoot, "../..");
const docsRoot = join(siteRoot, "src/content/docs");
const cliBin = join(repoRoot, "packages/cli/bin/galley.js");
const site = JSON.parse(readFileSync(join(siteRoot, "src/data/site.json"), "utf8"));
const docsData = JSON.parse(readFileSync(join(siteRoot, "src/data/docs.json"), "utf8"));

const problems = [];
const report = (file, line, message) => problems.push(`${relative(repoRoot, file)}:${line}: ${message}`);

// ─────────────────────────────────────────────────────────────── the code

const { register } = await import("tsx/esm/api");
register();
const tsImport = (path) => import(pathToFileURL(join(repoRoot, path)).href);

const { validateConfig, configJsonSchema } = await tsImport("packages/core/src/content/config/schema.ts");
const { COMMANDS } = await tsImport("packages/cli/src/main.ts");
const { renderMarkdown } = await tsImport("apps/site/src/lib/markdown.ts");

function runCli(args) {
  const result = spawnSync(process.execPath, [cliBin, ...args], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME } });

  if (result.status !== 0) throw new Error(`galley ${args.join(" ")} exited with ${result.status}: ${result.stderr}`);
  return result.stdout;
}

const flagsIn = (help) => new Set([...help.matchAll(/(?:^|[\s,[])(--[a-z][a-z-]*|-[a-zA-Z])(?=[\s,\]=<]|$)/gm)].map((m) => m[1]));
const commandNames = Object.keys(COMMANDS);
/** command → flags its --help lists. "open" is `galley [path]`; "" is the bare `galley`. */
const helpFlags = new Map();

/** command → its real --help text ("" is the bare `galley --help`). */
const helpText = new Map([["", runCli(["--help"])], ["open", runCli([".", "--help"])]]);

for (const name of commandNames) helpText.set(name, runCli([name, "--help"]));
helpFlags.set("open", flagsIn(helpText.get("open")));
helpFlags.set("", new Set(["--help", "-h", "--version", "-v"]));
for (const name of commandNames) helpFlags.set(name, flagsIn(helpText.get(name)));
// Commands with their own sub-commands ("galley import wordpress …") list those
// sub-commands' options in each sub-command's --help: a flag on `galley import`
// is real when one of them lists it.
function subcommandsOf(name) {
  const help = helpText.get(name) ?? "";
  return [...help.matchAll(/Run `galley \S+ <[^>]+> --help`/g)].length ? [...help.matchAll(/^  ([a-z][a-z-]+)  /gm)].map((m) => m[1]) : [];
}
for (const name of commandNames) {
  for (const sub of subcommandsOf(name)) {
    const help = runCli([name, sub, "--help"]);

    helpText.set(`${name} ${sub}`, help);
    for (const flag of flagsIn(help)) helpFlags.get(name).add(flag);
  }
}

const normalise = (text) => text.replace(/\s+$/gm, "").trim();

/** A block quoting help output must match the command's real --help, character for character. */
function checkHelpQuote(file, line, name, quoted) {
  const real = helpText.get(name);

  if (real === undefined) return;
  counts.helpQuotes += 1;
  if (normalise(quoted) !== normalise(real)) {
    const a = normalise(quoted).split("\n");
    const b = normalise(real).split("\n");
    const at = a.findIndex((text, i) => text !== b[i]);
    const index = at === -1 ? a.length : at;

    report(file, line + index, `this quotes “galley${name && name !== "open" ? ` ${name}` : name === "open" ? " [path]" : ""} --help”, but the real output differs here: expected “${b[index] ?? "(end of output)"}”, found “${a[index] ?? "(end of block)"}”.`);
  }
}
const allFlags = new Set([...helpFlags.values()].flatMap((set) => [...set]));

function walk(dir, test, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);

    if (entry.isDirectory()) walk(full, test, out);
    else if (test(full)) out.push(full);
  }
  return out;
}

// Every package's source, the plugins' included (packages/plugins/<name>/src).
const packageSources = readdirSync(join(repoRoot, "packages"))
  .flatMap((p) => (p === "plugins" ? readdirSync(join(repoRoot, "packages/plugins")).map((q) => `plugins/${q}`) : [p]))
  .map((p) => join(repoRoot, "packages", p, "src"))
  .filter((dir) => existsSync(dir));
const sourceText = [
  ...packageSources.flatMap((dir) => walk(dir, (f) => /\.(ts|tsx|mts|js|mjs)$/.test(f) && !/\.test\./.test(f))),
  ...(existsSync(join(repoRoot, "apps/desktop/src-tauri/src")) ? walk(join(repoRoot, "apps/desktop/src-tauri/src"), (f) => /\.(rs|js)$/.test(f)) : []),
  join(repoRoot, "Dockerfile"),
  join(repoRoot, "docker-compose.yml"),
]
  .filter((file) => existsSync(file))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

// ─────────────────────────────────────────────────────────────── the schema's keys

function schemaPaths(schema) {
  const defs = schema.$defs ?? {};
  const seen = new Set();
  const out = new Set();

  function visit(node, path) {
    if (!node || typeof node !== "object") return;
    if (node.$ref) {
      const name = node.$ref.replace("#/$defs/", "");

      if (seen.has(name)) return;
      seen.add(name);
      visit(defs[name], path);
      return;
    }
    for (const branch of node.anyOf ?? []) visit(branch, path);
    if (node.items) visit(node.items, `${path}[]`);
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      const next = path ? `${path}.${key}` : key;

      out.add(next);
      visit(child, next);
    }
  }
  visit(schema, "");
  return out;
}

// ─────────────────────────────────────────────────────────────── routes

const apiSource = readFileSync(join(repoRoot, "packages/core/src/api.ts"), "utf8");
const apiRoutes = new Set([...apiSource.matchAll(/^\s*"((?:GET|POST|PUT|PATCH|DELETE) \/api\/[^"]+)":/gm)].map((m) => m[1]));

/** Top-level routes this site builds, from src/pages. */
const siteRoutes = new Set(["/"]);
for (const name of readdirSync(join(siteRoot, "src/pages"))) {
  if (name.startsWith("[") || name === "docs" || name.startsWith("index.")) continue;
  if (name.endsWith(".astro")) siteRoutes.add(`/${name.replace(/\.astro$/, "")}/`);
  else if (name.endsWith(".ts")) siteRoutes.add(`/${name.replace(/\.ts$/, "")}`);
}
const compareRoot = join(siteRoot, "src/content/compare");
const compareFiles = existsSync(compareRoot) ? readdirSync(compareRoot).filter((n) => n.endsWith(".md")).map((n) => join(compareRoot, n)) : [];
for (const file of compareFiles) siteRoutes.add(`/compare/${relative(compareRoot, file).replace(/\.md$/, "")}/`);
const howtoData = JSON.parse(readFileSync(join(siteRoot, "src/data/howto.json"), "utf8"));
for (const guide of howtoData.guides ?? []) if (guide?.slug) siteRoutes.add(`/how-to/${guide.slug}/`);

// ─────────────────────────────────────────────────────────────── pages

const docFiles = walk(docsRoot, (f) => f.endsWith(".md"));
const docIds = new Map(docFiles.map((file) => [relative(docsRoot, file).replace(/\.md$/, "").split("\\").join("/"), file]));
const headingCache = new Map();

function frontMatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) return { data: {}, bodyStart: 0, lines: 0 };
  const data = {};

  for (const line of match[1].split("\n")) {
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { data, body: text.slice(match[0].length), lines: match[0].split("\n").length - 1 };
}

function headingsOf(file) {
  if (!headingCache.has(file)) {
    const { body } = frontMatter(readFileSync(file, "utf8"));
    headingCache.set(file, new Set(renderMarkdown(body ?? "").headings.map((h) => h.slug)));
  }
  return headingCache.get(file);
}

function docFileFor(path) {
  const id = path.replace(/^\/docs\/?/, "").replace(/\/$/, "");
  return docIds.get(id === "" ? "index" : id) ?? docIds.get(`${id}/index`) ?? null;
}

/** Splits a markdown file into fenced blocks and prose lines, keeping line numbers. */
function scan(text, firstLine = 1) {
  const blocks = [];
  const prose = [];
  const lines = text.split("\n");
  let open = null;

  lines.forEach((line, index) => {
    const number = index + firstLine;
    const fence = /^\s*(```+|~~~+)\s*(.*)$/.exec(line);

    if (open) {
      if (fence && fence[1].startsWith(open.marker) && fence[2].trim() === "") {
        blocks.push(open);
        open = null;
      } else open.lines.push({ text: line, number });
      return;
    }
    if (fence) open = { marker: fence[1], info: fence[2].trim(), line: number, lines: [] };
    else prose.push({ text: line, number });
  });
  return { blocks, prose };
}

const INVOCATION = /^(?:[A-Z_][A-Z0-9_]*=(?:'[^']*'|"[^"]*"|\S*)\s+)*(?:galley|npx galley-cms|\{install(?:\.run)?\}|node (?:\S*\/)?packages\/cli\/bin\/galley\.js)(?=\s|$)(.*)$/;

function checkInvocation(file, number, command) {
  const match = INVOCATION.exec(command.trim());

  if (!match) return;
  const tokens = match[1].trim().split(/\s+/).filter(Boolean);
  // Everything after a shell comment, pipe or redirection is not the command's.
  const end = tokens.findIndex((token) => /^(#|\||&&|;|>|2>)/.test(token));
  const args = end === -1 ? tokens : tokens.slice(0, end);
  let name = "";

  if (args.length && !args[0].startsWith("-")) {
    if (commandNames.includes(args[0])) name = args[0];
    else if (/^[a-z]+$/.test(args[0]) && args[0] !== "help") {
      report(file, number, `“galley ${args[0]}” is not a command (commands: ${commandNames.join(", ")}). A folder to open is written with a slash or a dash, e.g. ./site or my-site.`);
      return;
    } else name = "open";
  } else if (args.some((arg) => arg.startsWith("-") && !["--help", "-h", "--version", "-v"].includes(arg))) name = "open";
  const known = helpFlags.get(name) ?? new Set();

  for (const arg of args) {
    if (!/^--?[a-zA-Z]/.test(arg)) continue;
    const flag = arg.split("=")[0];

    if (!known.has(flag)) report(file, number, `${flag} is not an option of “galley${name && name !== "open" ? ` ${name}` : name === "open" ? " [path]" : ""}” (its --help lists: ${[...known].join(", ") || "none"}).`);
  }
}

function checkEnv(file, number, text) {
  for (const m of text.matchAll(/\bGALLEY_[A-Z0-9_]*[A-Z0-9]\b/g)) {
    // Some names are built from the product slug: `${PRODUCT.slug.toUpperCase()}_MCP_TOKEN`.
    const rest = m[0].slice("GALLEY_".length);
    const known = new RegExp(`\\b${m[0]}\\b`).test(sourceText) || new RegExp(`slug\\.toUpperCase\\(\\)\\}_${rest}\\b`).test(sourceText);

    if (!known) report(file, number, `${m[0]} does not appear anywhere in the engine, server, CLI or desktop source.`);
  }
  for (const m of text.matchAll(/\b[A-Z]+_API_KEY\b/g)) {
    if (!new RegExp(`\\b${m[0]}\\b`).test(sourceText)) report(file, number, `${m[0]} is not read anywhere in the source.`);
  }
}

function checkRepoPath(file, number, path, kind) {
  const clean = decodeURIComponent(path.replace(/[#?].*$/, "")).replace(/\/$/, "");
  const full = join(repoRoot, clean);

  if (!existsSync(full)) report(file, number, `{repository}/${kind}/…/${clean} points at a path that does not exist.`);
  else if (kind === "blob" && statSync(full).isDirectory()) report(file, number, `{repository}/blob/…/${clean} is a folder; use /tree/.`);
}

function checkLink(file, number, href, { inDocs }) {
  const target = href.trim().replace(/^<|>$/g, "").split(/\s+/)[0];
  const repoPrefix = /^(?:\{repository\}|https:\/\/github\.com\/fictiontribe\/galley)\/(blob|tree)\/[^/]+\/(.+)$/.exec(target);

  if (repoPrefix) return checkRepoPath(file, number, repoPrefix[2], repoPrefix[1]);
  if (/^(https?:|mailto:|\{repository\}|\{site\}|\{license\}|\{maker\})/.test(target)) return;
  if (target.startsWith("#")) {
    if (inDocs && !headingsOf(file).has(target.slice(1))) report(file, number, `#${target.slice(1)} is not a heading on this page.`);
    return;
  }
  if (!inDocs) {
    // Repository files link to each other relatively, as GitHub renders them.
    if (target.startsWith("/")) return report(file, number, `${target}: use a relative path in repository files.`);
    const path = target.replace(/[#?].*$/, "");

    if (path && !existsSync(resolve(dirname(file), path))) report(file, number, `${target} does not exist (relative to ${relative(repoRoot, dirname(file)) || "."}).`);
    return;
  }
  if (!target.startsWith("/")) return report(file, number, `${target}: links between pages start with "/" (e.g. /docs/getting-started/quickstart/).`);
  const [path, anchor] = target.split("#");

  if (path.startsWith("/docs")) {
    if (!path.endsWith("/")) report(file, number, `${path} needs a trailing slash (the site uses trailingSlash: "always").`);
    const page = docFileFor(path);

    if (!page) return report(file, number, `${path} is not a documentation page.`);
    if (anchor && !headingsOf(page).has(anchor)) report(file, number, `#${anchor} is not a heading of ${path}.`);
    return;
  }
  if (!siteRoutes.has(path)) report(file, number, `${path} is not a page of this site (${[...siteRoutes].join(", ")}).`);
}

function checkConfigBlock(file, block) {
  const marked = /\bgalley\.config\.json\b/.test(block.info);
  const lang = block.info.split(/\s+/)[0];

  if (lang !== "json" && lang !== "jsonc") return;
  const text = block.lines.map((l) => l.text).join("\n");
  let value;

  try {
    value = JSON.parse(text);
  } catch (error) {
    if (marked) report(file, block.line, `this galley.config.json example is not valid JSON (${error.message}).`);
    return;
  }
  const looksLikeConfig = value && typeof value === "object" && !Array.isArray(value) && ("collections" in value || ("$schema" in value && String(value.$schema).includes("galley.config")));

  if (!marked) {
    if (looksLikeConfig) report(file, block.line, 'this json block looks like a galley.config.json; mark it ```json galley.config.json so it is validated.');
    return;
  }
  const result = validateConfig(value);
  const expectInvalid = /\binvalid\b/.test(block.info);

  if (expectInvalid && result.ok) report(file, block.line, "this example is marked invalid, but validateConfig accepts it.");
  if (!expectInvalid && !result.ok) report(file, block.line, `validateConfig rejects this example: ${result.errors.join(" ")}`);
  return result.ok ? "valid" : "invalid";
}

const INLINE_CODE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;
const LINK = /\]\(([^)\s]+(?:\s+"[^"]*")?)\)/g;

const counts = { placeholders: 0, outputs: 0, pages: 0, configExamples: 0, invalidExamples: 0, invocations: 0, links: 0, env: 0, helpQuotes: 0, envVars: 0, kitOptions: 0, pictures: 0 };

// ─────────────────────────────────────────────────────────────── code blocks in the docs
//
// The convention every docs page follows:
//   ```sh      only what a person types: one command per line, no prompt ($ or >),
//              no output, no comments. It gets the Copy button, which copies exactly it.
//   ```output  what the person then sees ("You'll see", no Copy button), at most a
//              few lines, trimmed with "…". It belongs to the sh block before it:
//              the nearest block above it, with no heading in between.
//   ```text    reference text, such as a command's whole --help.

/** A line a person would type: an optional VAR=value, then a command or a path, or one of the install placeholders. */
const COMMAND_LINE = /^(?:[A-Z_][A-Z0-9_]*=(?:'[^']*'|"[^"]*"|\S*)\s+)*(?:[a-z][\w.@-]*|\.{0,2}\/\S*|~\/\S*|\{install\.[a-zA-Z]+(?: [^}]*)?\})(?:\s|$)/;

/** The real output of a command whose output a page may show, when it doesn't depend on this computer. */
function realOutput(command) {
  const m = INVOCATION.exec(command.replace(/\{install\.run\}/g, "galley").trim());
  if (!m) return null;
  const args = m[1].trim().split(/\s+/).filter(Boolean);
  const last = args.at(-1);

  if (last === "--help" || last === "-h") {
    const name = args[0] && !args[0].startsWith("-") ? (commandNames.includes(args[0]) ? args[0] : "open") : "";
    const sub = name && name !== "open" && args[1] && subcommandsOf(name).includes(args[1]) ? `${name} ${args[1]}` : name;
    return helpText.get(sub) ?? null;
  }
  if (args.length === 1 && ["version", "starters"].includes(args[0])) return runCli(args);
  if (args.length === 1 && ["--version", "-v"].includes(args[0])) return runCli(["version"]);
  return null;
}

/** Every shown line appears in the real output, in order; "…" stands for anything left out. */
function compareShown(file, firstLine, shown, real) {
  const realLines = normalise(real).split("\n").map((l) => l.trimEnd());
  let at = 0;

  const productVersion = /export const VERSION\s*=\s*["']([^"']+)["']/.exec(readFileSync(join(repoRoot, site.versionFile), "utf8"))?.[1] ?? "";

  shown.forEach((line, i) => {
    // Placeholders the page fills in ({version}) are compared filled in.
    const want = line.trimEnd().replaceAll("{version}", productVersion);
    if (want.trim() === "…" || want.trim() === "") return;
    const pieces = want.split("…").map((piece) => piece.trim()).filter(Boolean);
    const matches = (real) => {
      if (!want.includes("…")) return real === want;
      let from = 0;
      for (const piece of pieces) {
        const found = real.indexOf(piece, from);
        if (found === -1) return false;
        from = found + piece.length;
      }
      return true;
    };
    const found = realLines.findIndex((real, j) => j >= at && matches(real));

    if (found === -1) report(file, firstLine + i, `this output line isn't in what the command really prints (in this order): “${want}”.`);
    else at = found + 1;
  });
}

function checkBlockConvention(file, block, blocks, prose) {
  const kind = block.info.split(/\s+/)[0];
  const texts = block.lines.map((l) => l.text);

  if (/^(shell|bash|console)$/.test(kind)) report(file, block.line, `use \`\`\`sh for commands (not ${kind}): only what a person types, and the output in an \`\`\`output block after it.`);
  if (/^(sh|shell|bash|console)$/.test(kind)) {
    if (!texts.some((t) => t.trim())) report(file, block.line, "this sh block is empty.");
    const prompted = texts.some((t) => /^\s*\$ /.test(t));
    block.lines.forEach((line, i) => {
      const t = line.text;
      const continued = i > 0 && /\\\s*$/.test(block.lines[i - 1].text);

      if (!t.trim() || continued) return;
      if (/^\s*[$>] /.test(t) || /^\s*[$>]$/.test(t)) report(file, line.number, "no prompt in a command block: write the command alone, so Copy takes exactly it.");
      else if (/^\s*#/.test(t)) report(file, line.number, "no comments in a command block: say it in a sentence before or after the block.");
      else if (prompted && !/^\s*[$>]/.test(t)) report(file, line.number, `this line follows a prompt, so it is output; put it in an \`\`\`output block after the command: “${t.trim().slice(0, 60)}”.`);
      else if (!COMMAND_LINE.test(t.trimStart())) report(file, line.number, `this looks like output, not a command; put what the person sees in an \`\`\`output block after the command: “${t.trim().slice(0, 60)}”.`);
      else if (/\s#\s/.test(t.replace(/'[^']*'|"[^"]*"/g, ""))) report(file, line.number, "no trailing comment on a command: say it in a sentence before or after the block.");
    });
  }
  if (kind === "output") {
    const index = blocks.indexOf(block);
    const before = blocks[index - 1];
    const lastLine = before ? before.line + before.lines.length + 1 : 0;
    const heading = before && prose.some((p) => p.number > lastLine && p.number < block.line && /^#{1,6} /.test(p.text));

    if (!before || before.info.split(/\s+/)[0] !== "sh" || heading) {
      report(file, block.line, "an output block shows what a command printed, so it follows that command's sh block (no heading in between).");
      return;
    }
    if (texts.filter((t) => t.trim()).length > 8) report(file, block.line, `keep an output block short (at most about 6 lines, trimmed with “…”); this one has ${texts.length}.`);
    const command = before.lines.map((l) => l.text).filter((t) => t.trim()).at(-1) ?? "";
    const real = realOutput(command);

    if (real !== null) {
      counts.outputs += 1;
      compareShown(file, block.line + 1, texts, real);
    }
  }
}

// ─────────────────────────────────────────────────────────────── placeholders
const installData = site.install ?? null;
const KNOWN_PLACEHOLDERS = new Set(["repository", "version", "site", "license", "maker", "package", "clone"]);

/** {install.KEY …} must name a command in src/data/site.json → install; the published branches must be well formed. */
function checkPlaceholders(file, text, firstLine) {
  let depth = 0;
  let sawElse = false;

  text.split("\n").forEach((line, i) => {
    const number = firstLine + i;

    for (const m of line.matchAll(/\{install\.([a-zA-Z]+)((?: [a-z][a-zA-Z]*=[^\s}]+)*)\}/g)) {
      counts.placeholders += 1;
      const value = installData?.[m[1]];
      // Until the first npm release, a page may show these only for after it.
      if (installData && installData.published !== true && ["create", "createStarter", "run"].includes(m[1]) && !inPublishedBranch(text, i)) report(file, number, `{install.${m[1]}} doesn't work until Galley is on npm (install.published is false); put it inside <!-- if install.published --> … <!-- else --> … <!-- end -->.`);
      if (installData === null) report(file, number, `{install.${m[1]}} needs src/data/site.json → install, which doesn't exist yet.`);
      else if (value === undefined || typeof value === "boolean") report(file, number, `{install.${m[1]}} isn't a command in src/data/site.json → install (it has: ${Object.keys(installData).filter((k) => typeof installData[k] !== "boolean").join(", ")}).`);
      else {
        const filled = [...m[2].matchAll(/ ([a-z][a-zA-Z]*)=/g)].map((a) => a[1]).filter((name) => name !== "take");
        const wanted = [...String(value).matchAll(/\{([a-z][a-zA-Z]*)\}/g)].map((a) => a[1]).filter((name) => !["repoSlug", "repository"].includes(name));
        if (/ take=/.test(m[2]) && !Array.isArray(value)) report(file, number, `{install.${m[1]}} is one command; take= is for lists.`);
        for (const name of wanted) if (!filled.includes(name)) report(file, number, `{install.${m[1]}} needs ${name}=… (its command has {${name}}).`);
        for (const name of filled) if (!wanted.includes(name)) report(file, number, `{install.${m[1]}} has no {${name}} to fill.`);
      }
    }
    if (/\{install\}/.test(line)) report(file, number, "{install} is the old placeholder; use one of src/data/site.json → install, e.g. {install.run}.");
    for (const m of line.matchAll(/(?<![$\w])\{([a-z][a-zA-Z]*)\}/g)) {
      if (m[1] !== "install" && !KNOWN_PLACEHOLDERS.has(m[1]) && /^\s*(```|~~~)/.test(line) === false && inShell(file, number)) report(file, number, `{${m[1]}} isn't a placeholder the docs know (${[...KNOWN_PLACEHOLDERS].join(", ")}, install.…).`);
    }
    for (const marker of line.matchAll(/<!-- (if (!?)([\w.]+)|else|end) -->/g)) {
      if (marker[1].startsWith("if")) {
        if (marker[3] !== "install.published") report(file, number, `the only condition is install.published, not ${marker[3]}.`);
        if (depth > 0) report(file, number, "these branches can't be nested.");
        depth += 1;
        sawElse = false;
      } else if (marker[1] === "else") {
        if (depth === 0 || sawElse) report(file, number, "<!-- else --> without its <!-- if install.published -->.");
        sawElse = true;
      } else {
        if (depth === 0) report(file, number, "<!-- end --> without its <!-- if install.published -->.");
        depth = Math.max(0, depth - 1);
      }
    }
  });
  if (depth > 0) report(file, firstLine, "an <!-- if install.published --> is never closed with <!-- end -->.");
}

/** Whether line i of text is inside the published half of an <!-- if install.published --> branch. */
function inPublishedBranch(text, i) {
  const before = text.split("\n").slice(0, i);
  let state = null;
  for (const m of before.flatMap((line) => [...line.matchAll(/<!-- (if (!?)install\.published|else|end) -->/g)])) {
    if (m[1].startsWith("if")) state = m[2] === "!" ? "unpublished" : "published";
    else if (m[1] === "else") state = state === "published" ? "unpublished" : "published";
    else state = null;
  }
  return state === "published";
}

/** Lines inside sh blocks, per file, for checkPlaceholders. */
const shellLines = new Map();
function inShell(file, number) {
  return shellLines.get(file)?.has(number) ?? false;
}

function checkFile(file, { inDocs }) {
  const text = readFileSync(file, "utf8");
  const fm = inDocs ? frontMatter(text) : { body: text, lines: 0, data: {} };

  if (inDocs) {
    counts.pages += 1;
    if (!fm.data.title) report(file, 1, "front matter needs a title.");
    if (!fm.data.description) report(file, 1, "front matter needs a description.");
    if (!docsData.groups.some((g) => g.id === fm.data.group)) report(file, 1, `group “${fm.data.group}” is not in src/data/docs.json.`);
    if ((fm.body ?? "").trim().length < 300) report(file, 1, "this page is nearly empty; write it or remove it (no stub pages).");
  }
  const { blocks, prose } = scan(fm.body ?? text, fm.lines + 1);

  if (inDocs) {
    shellLines.set(file, new Set(blocks.filter((b) => b.info.split(/\s+/)[0] === "sh").flatMap((b) => b.lines.map((l) => l.number))));
    checkPlaceholders(file, fm.body ?? text, fm.lines + 1);
  }

  for (const block of blocks) {
    const outcome = checkConfigBlock(file, block);
    const kind = block.info.split(/\s+/)[0];
    const texts = block.lines.map((l) => l.text);

    // A text block that starts like a command's --help is that help, quoted whole.
    const helpByFirstLine = [...helpText].find(([, help]) => normalise(help).split("\n")[0] === (texts[0] ?? "").trimEnd() && !/^Usage: galley\b/.test(texts[0] ?? ""));
    if (kind === "text" && helpByFirstLine) checkHelpQuote(file, block.line + 1, helpByFirstLine[0], texts.join("\n"));
    if (kind === "text" && /^Usage: galley\b/.test(texts[0] ?? "")) {
      const m = /^Usage: galley(?: ([a-z]+))?(?: ([a-z][a-z-]+))?/.exec(texts[0]);
      const name = m[1] && commandNames.includes(m[1]) ? m[1] : "open";
      // A sub-command's help ("Usage: galley import wordpress …") is checked against its own --help.
      const sub = name !== "open" && m[2] && subcommandsOf(name).includes(m[2]) ? `${name} ${m[2]}` : name;

      checkHelpQuote(file, block.line + 1, sub, texts.join("\n"));
    }
    if (/^(sh|shell|bash|console)$/.test(kind) && !inDocs) {
      // Repository files may still quote `$ galley … --help` with its output.
      texts.forEach((text, i) => {
        const m = /^\$ galley(?: ([a-z]+))? --help$/.exec(text.trim());

        if (!m) return;
        const end = texts.findIndex((later, j) => j > i && later.startsWith("$ "));
        const output = texts.slice(i + 1, end === -1 ? undefined : end).join("\n");
        const name = m[1] === undefined ? "" : commandNames.includes(m[1]) ? m[1] : "open";

        checkHelpQuote(file, block.line + i + 2, name, output);
      });
    }
    if (inDocs) checkBlockConvention(file, block, blocks, prose);

    if (outcome === "valid") counts.configExamples += 1;
    if (outcome === "invalid") counts.invalidExamples += 1;
    for (const line of block.lines) {
      checkEnv(file, line.number, line.text);
      if (/^(sh|shell|bash|console)$/.test(block.info.split(/\s+/)[0])) {
        const command = line.text.replace(/^\$ /, "").replace(/\{install\.run\}/g, "galley");

        if (line.text.startsWith("$ ") || INVOCATION.test(command.trim())) {
          if (INVOCATION.test(command.trim())) counts.invocations += 1;
          checkInvocation(file, line.number, command);
        }
      }
    }
  }
  for (const line of prose) {
    checkEnv(file, line.number, line.text);
    counts.env += (line.text.match(/\bGALLEY_[A-Z_]+/g) ?? []).length;
    for (const m of line.text.matchAll(INLINE_CODE)) {
      const code = m[2].trim();

      if (/^--?[a-zA-Z][a-z-]*$/.test(code) && code.startsWith("--")) {
        if (!allFlags.has(code)) report(file, line.number, `${code} is not an option of any galley command.`);
      } else if (INVOCATION.test(code)) {
        counts.invocations += 1;
        checkInvocation(file, line.number, code);
      }
    }
    const withoutCode = line.text.replace(INLINE_CODE, "");

    for (const m of withoutCode.matchAll(LINK)) {
      counts.links += 1;
      checkLink(file, line.number, m[1], { inDocs });
    }
  }
}

for (const file of docFiles) checkFile(file, { inDocs: true });

const repoFiles = ["README.md", "CONTRIBUTING.md", "SECURITY.md", "SUPPORT.md", "GOVERNANCE.md", "TRADEMARKS.md", "ROADMAP.md", "CHANGELOG.md", "RELEASING.md", "CODE_OF_CONDUCT.md", "packages/core/README.md", "packages/cli/README.md", "packages/overlay/README.md"]
  .map((path) => join(repoRoot, path))
  .filter((path) => existsSync(path));

for (const file of repoFiles) checkFile(file, { inDocs: false });

// ── the comparison articles: links in the front matter and the body, and `related`
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
for (const file of compareFiles) {
  const name = relative(compareRoot, file).replace(/\.md$/, "");
  const claims = join(siteRoot, "claims", `${name}.md`);
  if (!existsSync(claims)) report(file, 1, `no claims file: claims/${name}.md must list every statement this article makes about another product, with its source and the date read.`);
  const checked = /^checked:\s*["']?(.*?)["']?\s*$/m.exec(readFileSync(file, "utf8").split(/^---$/m)[1] ?? "");
  if (!checked) report(file, 1, "front matter needs `checked:`, the month its facts were last checked against their sources (e.g. checked: November 2026).");
  else if (!new RegExp(`^(${MONTHS}) \\d{4}$`).test(checked[1])) report(file, 1, `checked: “${checked[1]}” should be a month and a year, e.g. November 2026.`);
  readFileSync(file, "utf8").split("\n").forEach((text, i) => {
    for (const m of text.replace(INLINE_CODE, "").matchAll(LINK)) {
      counts.links += 1;
      checkLink(file, i + 1, m[1], { inDocs: true });
    }
    const related = /^related:\s*\[(.*)\]\s*$/.exec(text);
    for (const ref of related ? related[1].split(",").map((r) => r.trim().replace(/^["']|["']$/g, "")).filter(Boolean) : []) {
      if (ref.startsWith("/")) checkLink(file, i + 1, ref, { inDocs: true });
      else if (!siteRoutes.has(`/compare/${ref}/`)) report(file, i + 1, `related: “${ref}” is not an article in src/content/compare/.`);
    }
  });
}

// ── reference pages against the code they document
function tableKeys(file) {
  const keys = new Map();

  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, index) => {
      const m = /^\|\s*`([^`]+)`\s*\|/.exec(line);
      if (m) keys.set(m[1], index + 1);
    });
  return keys;
}

const configRef = docIds.get("reference/config");
if (!configRef) report(join(docsRoot, "reference/config.md"), 1, "the configuration reference page is missing.");
else {
  const documented = tableKeys(configRef);
  const actual = schemaPaths(configJsonSchema());

  for (const path of actual) if (!documented.has(path)) report(configRef, 1, `\`${path}\` is in the config's JSON Schema but has no row in the reference.`);
  for (const [path, line] of documented) if (!actual.has(path)) report(configRef, line, `\`${path}\` is documented but is not a key of the config's JSON Schema.`);
}

const apiRef = docIds.get("reference/api");
if (apiRef) {
  const documented = tableKeys(apiRef);

  for (const route of apiRoutes) if (!documented.has(route)) report(apiRef, 1, `\`${route}\` is in ApiRoutes (packages/core/src/api.ts) but has no row in the reference.`);
  for (const [route, line] of documented) if (/^(GET|POST|PUT|PATCH|DELETE) /.test(route) && !apiRoutes.has(route)) report(apiRef, line, `\`${route}\` is documented but is not in ApiRoutes.`);
}

// ── every environment variable the source reads has a row in reference/environment.md
const envRef = docIds.get("reference/environment");
if (!envRef) report(join(docsRoot, "reference/environment.md"), 1, "the environment variable reference is missing.");
else {
  const documented = [...tableKeys(envRef).keys()];
  const used = new Set([...sourceText.matchAll(/\bGALLEY_[A-Z0-9_]*[A-Z0-9]\b/g)].map((m) => m[0]));

  // Names built from the product slug (`${PRODUCT.slug.toUpperCase()}_MCP_TOKEN`).
  for (const m of sourceText.matchAll(/slug\.toUpperCase\(\)\}_([A-Z0-9_]+)\b/g)) used.add(`GALLEY_${m[1]}`);
  counts.envVars = used.size;
  for (const name of used) {
    // A row may name a family with a placeholder: `GALLEY_DEPLOY_<HOST>_API` covers GALLEY_DEPLOY.
    if (!documented.some((key) => key === name || (key.includes("<") && key.startsWith(`${name}_`)))) report(envRef, 1, `${name} is read by the source but has no row in the environment variable reference.`);
  }
  for (const [key, line] of tableKeys(envRef)) {
    if (/^GALLEY_/.test(key) && !key.includes("<") && !used.has(key)) report(envRef, line, `${key} is documented but the source never reads it.`);
  }
}

// ── the site kit's options (packages/astro/src/index.d.ts) each have a row in astro/site-kit.md
{
  const kitRef = docIds.get("astro/site-kit");
  const dts = readFileSync(join(repoRoot, "packages/astro/src/index.d.ts"), "utf8");
  const props = (name) => {
    const body = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(dts)?.[1] ?? "";
    return [...body.matchAll(/^  (\w+)\??:\s*([^;]+);/gm)].map((m) => ({ key: m[1], type: m[2] }));
  };
  const actual = new Set();

  for (const { key, type } of props("GalleyOptions")) {
    actual.add(key);
    const sub = /^(\w+Options)\b/.exec(type)?.[1];
    if (sub) for (const inner of props(sub)) actual.add(`${key}.${inner.key}`);
  }
  if (!kitRef) report(join(docsRoot, "astro/site-kit.md"), 1, "the site kit page is missing.");
  else if (actual.size === 0) report(kitRef, 1, "no options were read from packages/astro/src/index.d.ts; the check needs updating.");
  else {
    const documented = tableKeys(kitRef);
    counts.kitOptions = actual.size;
    for (const key of actual) if (!documented.has(key)) report(kitRef, 1, `\`${key}\` is an option of the site kit but has no row in its options table.`);
    for (const [key, line] of documented) if (/^[a-z]+(\.[a-zA-Z]+)?$/.test(key) && !actual.has(key) && !key.includes("/")) report(kitRef, line, `\`${key}\` is documented as an option but isn't one.`);
  }
}

// ── docs/mcp.md's generated regions (the tool reference, the client setups) match the tool catalogue
{
  const { renderDocs, DOCS_FILE } = await tsImport("packages/mcp/src/docs.ts");
  const file = join(repoRoot, DOCS_FILE);
  const text = readFileSync(file, "utf8");

  if (renderDocs(text) !== text) report(file, 1, "its tool reference is out of date with the MCP tool catalogue. Run: pnpm --filter @galley/mcp docs, then pnpm --filter @galley/site sync-docs");
}

function webpSize(path) {
  const b = readFileSync(path);
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (chunk === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  const bits = b.readUInt32LE(21);
  return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
}

// ── pictures in the docs: the file exists, every srcset file exists, alt text, size, weight
for (const file of docFiles) {
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, index) => {
      for (const m of line.matchAll(/<img\b[^>]*>/g)) {
        counts.pictures += 1;
        const tag = m[0];
        const attr = (name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
        const files = [attr("src"), ...(attr("srcset") ?? "").split(",").map((part) => part.trim().split(/\s+/)[0])].filter(Boolean);

        for (const src of files) {
          if (!src.startsWith("/")) continue;
          const path = join(siteRoot, "public", decodeURIComponent(src));

          if (!existsSync(path)) report(file, index + 1, `${src} is not in public/.`);
          else if (src.startsWith("/docs/") && statSync(path).size > 120 * 1024) report(file, index + 1, `${src} is ${Math.round(statSync(path).size / 1024)} KB; keep a docs picture at 120 KB or less.`);
        }
        // A 2× capture is shown at half its size: width and height must say so, or the page moves as it loads.
        const twice = (attr("srcset") ?? "").split(",").map((part) => part.trim().split(/\s+/)).find(([, d]) => d === "2x")?.[0];
        if (twice && existsSync(join(siteRoot, "public", twice))) {
          const { width, height } = webpSize(join(siteRoot, "public", twice));
          if (attr("width") !== String(Math.floor(width / 2)) || attr("height") !== String(Math.floor(height / 2))) report(file, index + 1, `${twice} is ${width}×${height}, so the picture is ${Math.floor(width / 2)}×${Math.floor(height / 2)}, not ${attr("width")}×${attr("height")}.`);
        }
        if (!attr("alt") || attr("alt").trim().length < 10) report(file, index + 1, "a picture needs alt text that says what it shows.");
        if (!attr("width") || !attr("height")) report(file, index + 1, "a picture needs width and height, so the page doesn't move as it loads.");
      }
    });
}

// ── every picture in public/docs is used by a page (an unused capture is weight nobody sees)
{
  const all = docFiles.map((file) => readFileSync(file, "utf8")).join("\n");
  const dir = join(siteRoot, "public/docs");

  if (existsSync(dir)) for (const name of readdirSync(dir)) if (!all.includes(`/docs/${name}`)) report(join(dir, name), 1, "this picture isn't used by any documentation page; remove it.");
}

for (const entry of GENERATED) {
  if (!existsSync(join(repoRoot, entry.source))) {
    report(targetPath(entry), 1, `its source ${entry.source} is missing.`);
    continue;
  }
  const current = existsSync(targetPath(entry)) ? readFileSync(targetPath(entry), "utf8") : null;

  if (current !== render(entry)) report(targetPath(entry), 1, `${relativeTarget(entry)} is out of date with ${entry.source}. Run: pnpm --filter @galley/site sync-docs`);
}

// ── the JSON Schemas this site serves (public/schema) are what the CLI writes now
{
  const schemas = renderSchemas();
  const dir = join(siteRoot, SCHEMA_DIR);
  const fix = "Run: pnpm --filter @galley/site sync-docs";

  for (const [name, text] of Object.entries(schemas)) {
    const file = join(dir, name);
    if (!existsSync(file)) report(file, 1, `missing: the CLI writes ${name} (galley schema --out). ${fix}`);
    else if (readFileSync(file, "utf8") !== text) report(file, 1, `out of date with \`galley schema --out\`. ${fix}`);
  }
  if (existsSync(dir)) for (const name of readdirSync(dir)) if (!(name in schemas)) report(join(dir, name), 1, `the CLI no longer writes this schema; remove it. ${fix}`);
  counts.schemas = Object.keys(schemas).length;
}

// ─────────────────────────────────────────────────────────────── result

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\ncheck-docs: ${problems.length} problem${problems.length === 1 ? "" : "s"} in the documentation.`);
  process.exit(1);
}
console.log(
  `check-docs: ${counts.pages} pages and ${repoFiles.length} repository files are consistent with the code — ` +
    `${counts.configExamples} config examples valid, ${counts.invalidExamples} marked invalid and rejected, ` +
    `${counts.invocations} galley invocations checked against ${commandNames.length + 1} commands' --help, ${counts.helpQuotes} quoted help texts identical to the real ones, ` +
    `${counts.links} links resolved, config reference matches ${schemaPaths(configJsonSchema()).size} schema keys, ` +
    `API reference matches ${apiRoutes.size} routes, ${counts.envVars} environment variables and ${counts.kitOptions} site kit options documented, ${counts.pictures} pictures sized and described, MCP tool reference current, ${counts.schemas} JSON Schemas in public/schema current; every command block holds commands only, ${counts.outputs} shown output${counts.outputs === 1 ? "" : "s"} identical to the real one${counts.outputs === 1 ? "" : "s"}, ${counts.placeholders} install placeholders filled from site.json.`
);
