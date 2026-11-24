/**
 * Every MCP tool × owner, editor, contributor and nobody, driven from the
 * MCP catalog itself (a tool missing from the table below fails the test),
 * against a real site. The MCP endpoint is reached only with the operator's
 * token — nobody, the reach it always had — and that row allows everything.
 * Were a person's request ever to reach these tools, the engine underneath
 * would still hold them to their role: publishing, undoing a publish, build
 * mode and the site's settings are refused where the work is done.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { GalleyError } from "@galley/core";
import { createImageService, createSettingsService, executeTool, type ToolContext } from "@galley/core/ai";
import { BUILD_MODE_REFUSAL, ROLE_REFUSAL, roleMay, SITE_SETTINGS_REFUSAL, withCaller, type AccessLevel, type AccountRole } from "@galley/core/install";
import { createEventBus, createSiteService } from "@galley/core/site";
import type { GalleyConfig, SiteService } from "@galley/core/types";
import { toolCatalog, type CatalogEntry } from "@galley/mcp";
import { DEV_SERVER } from "./hosted-helpers";

const STARTER = fileURLToPath(new URL("../../../starters/astro-starter", import.meta.url));
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "galley-mcp-access-")));
const opened: SiteService[] = [];

afterAll(async () => {
  for (const site of opened.splice(0)) await site.dispose().catch(() => undefined);
  rmSync(scratch, { recursive: true, force: true });
}, 60_000);

type Who = AccountRole | null;
const EVERYONE: Who[] = ["owner", "editor", "contributor", null];
const REFUSALS = [ROLE_REFUSAL, BUILD_MODE_REFUSAL, SITE_SETTINGS_REFUSAL];

/** What each MCP tool needs, written down on its own (not read from the tools). */
const NEEDS: Record<string, AccessLevel> = {
  get_site: "edit",
  find_text: "edit",
  add_media: "edit",
  get_changes: "edit",
  get_diff: "edit",
  discard_changes: "edit",
  publish: "publish",
  get_history: "edit",
  undo_publish: "publish",
  start_preview: "edit",
  stop_preview: "edit",
  list_entries: "edit",
  read_entry: "edit",
  search_content: "edit",
  update_entry: "edit",
  create_entry: "edit",
  delete_entry: "edit",
  list_media: "edit",
  generate_image: "edit",
  validate: "edit",
  audit_site: "edit",
  audit_entry: "edit",
  get_brand: "edit",
  check_brand: "edit",
  check_redirects: "edit",
  list_files: "publish",
  read_file: "publish",
  write_file: "publish",
  edit_file: "publish",
  run_build: "publish",
  save_site_config: "manage",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" } }).trim();
}

/** The starter in a fresh repository: installed packages linked in, a dev server that starts at once, a build that costs nothing, one version to undo. */
async function starter(who: Who): Promise<{ site: SiteService; config: GalleyConfig; commit: string }> {
  const root = join(scratch, `site-${who ?? "nobody"}-${Math.random().toString(36).slice(2, 8)}`);

  mkdirSync(root);
  cpSync(STARTER, root, { recursive: true, filter: (source) => !["node_modules", "dist", ".astro"].includes(basename(source)) });
  symlinkSync(join(STARTER, "node_modules"), join(root, "node_modules"), "dir");
  const config = { ...JSON.parse(readFileSync(join(root, "galley.config.json"), "utf8")), dev: { command: "node server.mjs" }, build: { command: "node --version" } } as GalleyConfig;

  writeFileSync(join(root, "galley.config.json"), JSON.stringify(config, null, 2));
  writeFileSync(join(root, "server.mjs"), DEV_SERVER);
  writeFileSync(join(root, "src", "components", "Edit.astro"), "<p>before</p>\n");
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, ".git", "info", "exclude"), "node_modules\n.seen.log\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "Initial");
  writeFileSync(join(root, "src", "content", "pages", "privacy.md"), "---\ntitle: Privacy\n---\nShort and plain.\n");
  git(root, "commit", "-q", "-am", "Privacy");
  const commit = git(root, "rev-parse", "HEAD");
  const site = await createSiteService(root, { id: `mcp-${who ?? "nobody"}`, events: createEventBus(), overlayScript: () => "", author: () => ({ name: "Test", email: "test@example.com" }), watch: false });

  opened.push(site);
  return { site, config: (await site.readConfig()) as GalleyConfig, commit };
}

function inputFor(entry: CatalogEntry, who: Who, config: GalleyConfig, commit: string): Record<string, unknown> | undefined {
  const tag = who ?? "nobody";
  const inputs: Record<string, Record<string, unknown>> = {
    get_site: {},
    find_text: { text: "Privacy", url: "/privacy/" },
    add_media: { filename: `note-${tag}.png`, data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" },
    get_changes: {},
    get_diff: { path: "src/content/pages/about.md" },
    discard_changes: { paths: ["src/content/pages/services.md"] },
    publish: { message: `Published by ${tag}`, paths: ["src/content/pages/about.md"] },
    get_history: {},
    undo_publish: { commit },
    start_preview: {},
    stop_preview: {},
    list_entries: { collection: "pages" },
    read_entry: { path: "src/content/pages/about.md" },
    search_content: { query: "studio" },
    update_entry: { path: "src/content/pages/about.md", ops: [{ op: "set", path: "title", value: `About (${tag})` }] },
    create_entry: { collection: "blog", slug: `a-post-by-${tag}`, data: { title: `A post by ${tag}` } },
    delete_entry: { path: "src/content/blog/measured-survey.md" },
    list_media: {},
    generate_image: { prompt: "A quiet studio with a long table" },
    validate: {},
    audit_site: { rendered: false },
    audit_entry: { path: "src/content/pages/about.md" },
    get_brand: {},
    check_brand: {},
    check_redirects: {},
    list_files: { glob: "src/content/pages/*.md", limit: 5 },
    read_file: { path: "package.json" },
    write_file: { path: `src/components/Note-${tag}.astro`, content: "<p>Note</p>\n" },
    edit_file: { path: "src/components/Edit.astro", old_string: "<p>before</p>", new_string: `<p>after ${tag}</p>`, replace_all: true },
    run_build: {},
    save_site_config: { config: { ...config, name: `Renamed by ${tag}` } },
  };

  return inputs[entry.name];
}

const may = (who: Who, level: AccessLevel) => who === null || roleMay(who, level);
const as = <T>(who: Who, run: () => T): T => (who === null ? run() : withCaller({ accountId: `${who}-1`, role: who }, run));

/** One call as the MCP server makes it (packages/mcp server.ts): registry tools through executeTool, the MCP-side verbs directly. */
async function callTool(entry: CatalogEntry, input: Record<string, unknown>, site: SiteService, mode: "build" | "content"): Promise<{ text: string; isError: boolean }> {
  const model = await site.model();

  try {
    if (entry.source === "registry") {
      const home = join(scratch, `home-${Math.random().toString(36).slice(2, 8)}`);
      const settings = createSettingsService({ home, env: { PATH: process.env.PATH } });
      const ctx: ToolContext = { site, siteId: site.id, mode, model, images: createImageService({ home, settings }), signal: new AbortController().signal, titles: new Map(), question: null, askedLastTurn: false };
      const outcome = await executeTool(entry.tool, entry.name, input, ctx, entry.title);

      return { text: outcome.content, isError: Boolean(outcome.isError) };
    }
    if (entry.source === "mcp") {
      const result = await entry.tool.run(input, { site, model, mode, allowPublish: true, readOnly: false, transport: "http", productName: "Test", describeChanges: async () => "Changes", signal: new AbortController().signal });

      return { text: result.text, isError: Boolean(result.isError) };
    }
    return { text: "", isError: false };
  } catch (error) {
    if (error instanceof GalleyError) return { text: error.message, isError: true };
    throw error;
  }
}

describe("every MCP tool, by role", () => {
  // The full list, as a connection with the operator's token is offered it.
  const catalog = toolCatalog({ mode: "build", allowPublish: true, readOnly: false, images: true, transport: "http", sites: "single" });

  it("the table names exactly the tools the catalog offers", () => {
    expect(Object.keys(NEEDS).sort()).toEqual(catalog.map((entry) => entry.name).sort());
  });

  it("runs for whoever's role has its level, nobody included (the operator's token); anyone else is refused, by the engine where the tool doesn't check", async () => {
    for (const who of EVERYONE) {
      const { site, config, commit } = await starter(who);
      const mode = may(who, "publish") ? "build" : "content";

      // Pending changes for the proof and publish tools to find.
      await site.writeFile("src/content/pages/about.md", "---\ntitle: About\n---\nA pending change.\n", { origin: "user", mode: "content" });
      await site.writeFile("src/content/pages/services.md", "---\ntitle: Services\n---\nAnother.\n", { origin: "user", mode: "content" });
      for (const entry of catalog) {
        const input = inputFor(entry, who, config, commit);

        expect(input, `a sample call for ${entry.name}`).toBeDefined();
        const result = await as(who, () => callTool(entry, input!, site, mode));
        const refused = result.isError && REFUSALS.some((sentence) => result.text.startsWith(sentence));

        expect(refused, `${entry.name} as ${who}: ${result.text.slice(0, 300)}`).toBe(!may(who, NEEDS[entry.name]!));
      }
      await site.preview().stop();
    }
  }, 240_000);
});
