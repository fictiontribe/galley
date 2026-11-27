// Documentation pages rendered from files elsewhere in the repository, so the
// site never paraphrases a document that has its own owner. Each source is
// copied with only mechanical changes (front matter added, the H1 dropped,
// HTML comments removed, repository-relative links made absolute), and
// check-docs fails when a generated page is out of date.
//
//   pnpm --filter @galley/site sync-docs     regenerate them

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderApiReference } from "./reference-api.mjs";
import { commandNames, renderCliReference } from "./reference-cli.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const siteRoot = resolve(here, "..");
export const repoRoot = resolve(siteRoot, "../..");

const cliCommands = await commandNames(resolve(dirname(fileURLToPath(import.meta.url)), "../../.."));

export const GENERATED = [
  {
    source: "packages/cli/src/main.ts",
    target: "src/content/docs/reference/cli.md",
    frontMatter: {
      title: "Command line",
      description: "Every galley command and option, with its real help text and exit codes. Generated from the CLI.",
      group: "reference",
      order: 1,
    },
    build: () => renderCliReference(repoRoot, cliCommands),
    note: "Generated from the CLI's own --help output by apps/site/scripts/reference-cli.mjs. Edit that file (or the command's help), not this page.",
  },
  {
    source: "packages/core/src/api.ts",
    target: "src/content/docs/reference/api.md",
    frontMatter: {
      title: "HTTP API",
      description: "Every route the Galley server answers — what it does, what it takes and returns, who may call it — with authentication, the error shape and the live event stream. Generated from ApiRoutes.",
      group: "reference",
      order: 3,
    },
    // Not a copy of the source: the page is built from the route map itself.
    build: () => renderApiReference(repoRoot),
    note: "Generated from packages/core/src/api.ts (ApiRoutes) by apps/site/scripts/reference-api.mjs. Edit those, not this page.",
  },
  {
    source: "docs/adapters.md",
    target: "src/content/docs/adapters/writing.md",
    frontMatter: {
      title: "Writing a Galley adapter",
      navTitle: "Writing an adapter",
      description: "The adapter API in full — the hooks, the helpers, what the engine fills in, the conformance kit, using and publishing an adapter, and the trust model.",
      group: "extend",
      order: 2,
    },
    intro:
      "> This page is [`docs/adapters.md`]({repository}/blob/main/docs/adapters.md) from the repository, rendered as it is. `@galleycms/adapter-kit` lives in `packages/adapter-kit` in the repository; from a clone you can also run the kit's checker directly as `node packages/adapter-kit/bin/galley-adapter-check.js <adapter> <fixture>`.",
  },
  {
    source: "docs/mcp.md",
    target: "src/content/docs/integrations/mcp.md",
    frontMatter: {
      title: "Galley over MCP — use your own AI tool",
      navTitle: "Galley over MCP",
      description: "Connect Claude Desktop, Claude Code, Cursor, VS Code or any MCP client to a site: setup per client, stdio or HTTP, modes and safety switches, and every tool.",
      group: "extend",
      order: 4,
    },
    intro:
      "> This page is [`docs/mcp.md`]({repository}/blob/main/docs/mcp.md) from the repository, rendered as it is. The tool reference below is generated from the same catalogue the server registers its tools from, and this site's build checks it is current.",
  },
  {
    source: "docs/themes.md",
    target: "src/content/docs/plugins/themes.md",
    frontMatter: {
      title: "Themes for the editing app",
      navTitle: "Themes (developers)",
      description: "The theme contract, the legibility check and how it matches the CSS, where themes are kept and who may change them, the routes, sharing, the plugin contribution and galley theme.",
      group: "extend",
      order: 5,
    },
    intro:
      "> This page is [`docs/themes.md`]({repository}/blob/main/docs/themes.md) from the repository, rendered as it is. The person's version is [Themes: choose one, make one, share one](/docs/editing/themes/).",
  },
  {
    source: "docs/wordpress-import.md",
    target: "src/content/docs/getting-started/wordpress.md",
    frontMatter: {
      title: "Moving a WordPress site to Galley, in full",
      navTitle: "WordPress import in full",
      description: "What comes across from WordPress and what doesn't, the guided move in the app and the command, the report, rebuilding page-builder pages, keeping your search rankings, and the go-live checklist.",
      group: "reference",
      order: 7,
    },
    intro:
      "> This page is [`docs/wordpress-import.md`]({repository}/blob/main/docs/wordpress-import.md) from the repository, rendered as it is. It is the developer's version; the editor's is [Bring a site over from WordPress](/docs/editing/wordpress/). The guided move in the app is new, in final checks; the docs ran it against the importer's own invented WordPress site, not a real one.",
  },
  {
    source: "RELEASING.md",
    target: "src/content/docs/project/releases.md",
    frontMatter: {
      title: "Release process and versioning",
      navTitle: "Releases",
      description: "What a Galley release produces, how versions are numbered, and the checklist for cutting one — including the one-time work the first release still needs.",
      group: "project",
      order: 2,
    },
    intro:
      "> This page is [`RELEASING.md`]({repository}/blob/main/RELEASING.md) from the repository, for maintainers and anyone curious about how Galley ships.",
  },
];

function yamlString(value) {
  return typeof value === "number" ? String(value) : JSON.stringify(value);
}

/** The generated markdown for one source, from the source's current text. */
export function render(entry) {
  if (entry.build) {
    const fm = Object.entries(entry.frontMatter)
      .map(([key, value]) => `${key}: ${yamlString(value)}`)
      .join("\n");

    return `---\n${fm}\n---\n\n<!-- ${entry.note} -->\n\n${entry.build()}`;
  }
  const sourcePath = join(repoRoot, entry.source);
  const sourceDir = posix.dirname(entry.source);
  const text = readFileSync(sourcePath, "utf8");
  const lines = text.split("\n");
  const out = [];
  let droppedTitle = false;
  let markConfig = false;
  let inFence = false;
  let fenceLang = "";
  let lastFenceLang = "";
  let headingSinceFence = false;
  let fenceNotes = [];

  for (const line of lines) {
    if (!inFence && !droppedTitle && /^# /.test(line)) {
      droppedTitle = true;
      continue;
    }
    if (!inFence && /^\s*<!--.*-->\s*$/.test(line)) {
      // A sample marked as a galley.config.json is validated by check-docs.
      if (/sample:\s*galley\.config\.json/.test(line)) markConfig = true;
      continue;
    }
    if (/^\s*(```|~~~)/.test(line)) {
      if (!inFence && markConfig && /^```json\s*$/.test(line.trim())) {
        out.push("```json galley.config.json");
        markConfig = false;
        inFence = true;
        fenceLang = "json";
        continue;
      }
      markConfig = false;
      if (!inFence) {
        // The docs' block convention (check-docs.mjs): a fence with no language that
        // follows a command block is that command's output; any other is plain text.
        const indent = /^\s*/.exec(line)[0];
        fenceLang = line.trim().replace(/^(```|~~~)/, "").trim().split(/\s+/)[0];
        inFence = true;
        if (!fenceLang) {
          fenceLang = lastFenceLang === "sh" && !headingSinceFence ? "output" : "text";
          out.push(`${indent}\`\`\`${fenceLang}`);
          continue;
        }
        out.push(line);
        continue;
      }
      inFence = false;
      out.push(line);
      // A comment after a command moves out of the command block, as a sentence of its own.
      if (fenceLang === "sh" && fenceNotes.length) {
        const indent = /^\s*/.exec(line)[0];
        for (const note of fenceNotes) out.push("", `${indent}${note.charAt(0).toUpperCase()}${note.slice(1)}${/[.!?]$/.test(note) ? "" : "."}`);
        fenceNotes = [];
      }
      lastFenceLang = fenceLang;
      headingSinceFence = false;
      continue;
    }
    if (inFence) {
      const comment = fenceLang === "sh" ? /^(.*?\S)\s+#\s+(.+)$/.exec(line) : null;
      if (comment && !/['"]/.test(comment[1])) {
        out.push(comment[1]);
        fenceNotes.push(comment[2].replace(/^or:\s*(\S.*)$/, "or: `$1`"));
        continue;
      }
      out.push(line);
      continue;
    }
    if (/^#{1,6} /.test(line)) headingSinceFence = true;
    out.push(
      line.replace(/\]\((\.{1,2}\/[^)\s#]*)(#[^)\s]*)?\)/g, (_match, path, anchor = "") => {
        const repoPath = posix.normalize(posix.join(sourceDir, path));
        const full = join(repoRoot, repoPath);
        const kind = existsSync(full) && statSync(full).isDirectory() ? "tree" : "blob";

        return `]({repository}/${kind}/main/${repoPath}${anchor})`;
      })
    );
  }
  while (out.length && out[0].trim() === "") out.shift();
  const fm = Object.entries(entry.frontMatter)
    .map(([key, value]) => `${key}: ${yamlString(value)}`)
    .join("\n");

  return `---\n${fm}\n---\n\n<!-- Generated from ${entry.source} by apps/site/scripts/sync-docs.mjs. Edit that file, not this one. -->\n\n${entry.intro}\n\n${out.join("\n").replace(/\n+$/, "")}\n`;
}

export function targetPath(entry) {
  return join(siteRoot, entry.target);
}

export function relativeTarget(entry) {
  return relative(repoRoot, targetPath(entry));
}

// ─────────────────────────────────────────── JSON Schemas served by this site
// public/schema/*.json are the schemas the app's files name ($schema), written
// by the CLI itself (`galley schema --out`), so the addresses always serve what
// the code validates. sync-docs writes them; check-docs fails when they differ.

export const SCHEMA_DIR = "public/schema";

/** The schema files the CLI writes today: { "galley.config.json": "…", … }. */
export function renderSchemas() {
  const out = mkdtempSync(join(tmpdir(), "galley-schema-"));
  try {
    const run = spawnSync(process.execPath, [join(repoRoot, "packages/cli/bin/galley.js"), "schema", "--out", out], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME } });
    if (run.status !== 0) throw new Error(`galley schema --out exited with ${run.status}: ${run.stderr}`);
    return Object.fromEntries(readdirSync(out).sort().map((name) => [name, readFileSync(join(out, name), "utf8")]));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
