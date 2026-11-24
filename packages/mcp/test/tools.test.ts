/**
 * The MCP server driven through the SDK's own client (in-memory transport)
 * against a real, git-initialised copy of the starter site.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toolByName, type ToolContext } from "@galley/core/ai";
import { PRODUCT } from "@galley/core/brand";
import { createMcpServer, singleSite, toolCatalog } from "../src/index";
import { callTool, connect, git, makeSite, openEngine, tempDir, type Engine } from "./helpers";

const HOME_PAGE = "src/content/pages/index.md";
const HERO_HEADING = "Make more of the *home you already have*.";
/** 1×1 transparent PNG. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function names(engine: Engine, overrides: Parameters<typeof connect>[1] = {}): Promise<string[]> {
  const { client, close } = await connect(engine, overrides);
  const list = await client.listTools();

  await close();
  return list.tools.map((tool) => tool.name);
}

describe("which tools a connection offers", () => {
  let engine: Engine;

  beforeAll(async () => {
    engine = await openEngine(makeSite());
  });
  afterAll(() => engine.site.dispose());

  it("content mode: content, proof, publish and preview — no source files", async () => {
    const list = await names(engine);

    expect(list).toEqual(
      expect.arrayContaining(["get_site", "list_entries", "read_entry", "search_content", "find_text", "update_entry", "create_entry", "delete_entry", "list_media", "add_media", "validate", "get_changes", "get_diff", "discard_changes", "publish", "get_history", "undo_publish", "start_preview", "stop_preview"])
    );
    for (const name of ["write_file", "edit_file", "read_file", "list_files", "run_build", "save_site_config", "list_sites", "ask_user", "list_collections", "generate_image"]) {
      expect(list).not.toContain(name);
    }
    expect(list[0]).toBe("get_site");
  });

  it("build mode adds the source-file tools from the shared registry", async () => {
    const list = await names(engine, { mode: "build" });

    expect(list).toEqual(expect.arrayContaining(["list_files", "read_file", "write_file", "edit_file", "run_build", "save_site_config"]));
  });

  it("read-only offers only list, read, search and proof tools", async () => {
    const list = await names(engine, { readOnly: true, mode: "build" });

    expect(list.sort()).toEqual(
      ["audit_entry", "audit_site", "check_brand", "check_redirects", "find_text", "get_brand", "get_changes", "get_diff", "get_history", "get_site", "list_entries", "list_files", "list_media", "read_entry", "read_file", "search_content", "validate"].sort()
    );
  });

  it("with publishing off, publish and undo_publish are not listed (history is)", async () => {
    const list = await names(engine, { allowPublish: false });

    expect(list).not.toContain("publish");
    expect(list).not.toContain("undo_publish");
    expect(list).toContain("get_history");
  });

  it("generate_image only with an image provider", async () => {
    expect(await names(engine, { images: engine.images })).toContain("generate_image");
  });

  it("several sites: list_sites, and an optional site argument everywhere", async () => {
    const { client, close } = await connect(engine, { sites: { ...singleSite(engine.site), kind: "many" }, transport: "http" });
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name)).toContain("list_sites");
    const read = tools.find((t) => t.name === "read_entry")!;

    expect(Object.keys(read.inputSchema.properties ?? {})).toContain("site");
    expect(read.inputSchema.required).not.toContain("site");
    const add = tools.find((t) => t.name === "add_media")!;

    expect(Object.keys(add.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(["data", "filename"]));
    await close();
  });

  it("annotations are set on every tool, truthfully", async () => {
    const { client, close } = await connect(engine, { mode: "build", images: engine.images });
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));

    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.annotations, tool.name).toMatchObject({
        readOnlyHint: expect.any(Boolean),
        destructiveHint: expect.any(Boolean),
        idempotentHint: expect.any(Boolean),
        openWorldHint: tool.name === "generate_image",
      });
    }
    expect(byName.get("read_entry")!.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.get("update_entry")!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(byName.get("create_entry")!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(byName.get("discard_changes")!.annotations).toMatchObject({ destructiveHint: true });
    expect(byName.get("publish")!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
    expect(byName.get("publish")!.description).toContain("only when the person has asked to publish");
    expect(byName.get("get_changes")!.outputSchema).toBeDefined();
    expect(byName.get("get_site")!.outputSchema).toBeDefined();
    await close();
  });

  it("the registry tools are the assistant's own definitions", async () => {
    const { client, close } = await connect(engine);
    const { tools } = await client.listTools();

    for (const name of ["list_entries", "read_entry", "update_entry", "validate"]) {
      expect(tools.find((t) => t.name === name)!.description).toBe(toolByName(name)!.description);
    }
    await close();
  });
});

describe("orientation", () => {
  it("get_site returns the site card, the content guide, and structured detail", async () => {
    const engine = await openEngine(makeSite());
    const { client, close } = await connect(engine);
    const site = await callTool(client, "get_site");
    const structured = site.result.structuredContent as Record<string, any>;

    expect(site.isError).toBe(false);
    expect(site.text).toContain("# The site: Lowfield Studio");
    expect(site.text).toContain("Section types for sections");
    expect(site.text).toContain('<instructions file="CONTENT-GUIDE.md">');
    expect(site.text).toContain("only when the person asks you to");
    expect(site.text).not.toContain("you never publish");
    expect(structured.name).toBe("Lowfield Studio");
    expect(structured.pendingChanges).toBe(0);
    const pages = structured.collections.find((c: { id: string }) => c.id === "pages");
    const sections = pages.fields.find((f: { key: string }) => f.key === "sections");

    expect(sections.type).toBe("blocks");
    expect(sections.sections.map((s: { type: string }) => s.type)).toContain("hero");
    const instructions = (await client.getServerVersion(), client.getInstructions());

    expect(instructions).toContain("Call get_site first");
    expect(instructions).toContain(PRODUCT.name);
    expect(instructions).toContain("content mode");
    await close();
    await engine.site.dispose();
  });
});

describe("prompt → proof → publish, end to end", () => {
  let engine: Engine;
  let root: string;

  beforeAll(async () => {
    root = makeSite();
    engine = await openEngine(root);
  });
  afterAll(() => engine.site.dispose());

  it("edits the hero heading surgically, proofs it, publishes, and undoes the publish", async () => {
    const { client, close } = await connect(engine);
    const read = await callTool(client, "read_entry", { path: HOME_PAGE });
    const entry = read.json();

    expect(entry.data.sections[0].heading).toBe(HERO_HEADING);
    const update = await callTool(client, "update_entry", {
      path: HOME_PAGE,
      baseHash: entry.hash,
      ops: [{ op: "set", path: "sections.0.heading", value: "Make more of the home you already love." }],
    });

    expect(update.isError).toBe(false);
    expect(update.json().applied).toBe(1);

    // Exactly one line changed on disk.
    const diff = git(root, "diff", "--unified=0", "--", HOME_PAGE);
    const changed = diff.split("\n").filter((line) => /^[+-](?![+-])/.test(line));

    expect(changed).toEqual([`-    heading: ${HERO_HEADING}`, "+    heading: Make more of the home you already love."]);
    expect(git(root, "status", "--porcelain")).toBe(` M ${HOME_PAGE}\n`);

    // The proof, in plain terms and structured.
    const changes = await callTool(client, "get_changes");
    const set = changes.result.structuredContent as Record<string, any>;

    expect(set.files).toHaveLength(1);
    expect(set.files[0]).toMatchObject({ path: HOME_PAGE, status: "modified", kind: "content" });
    expect(set.files[0].fieldChanges).toEqual([
      expect.objectContaining({ field: "sections.0.heading", kind: "changed", before: HERO_HEADING, after: "Make more of the home you already love." }),
    ]);
    expect(changes.text).toContain("1 file changed on main");
    expect(changes.text).toContain(`“${HERO_HEADING}” → “Make more of the home you already love.”`);

    const fileDiff = await callTool(client, "get_diff", { path: HOME_PAGE });

    expect(fileDiff.text).toContain(`-    heading: ${HERO_HEADING}`);
    expect(fileDiff.text).toContain("+    heading: Make more of the home you already love.");

    // The edit went through the engine as the agent's.
    expect(engine.events.events).toContainEqual(expect.objectContaining({ type: "changes.updated", origin: "agent", paths: [HOME_PAGE] }));

    // Publish.
    const published = await callTool(client, "publish", {});

    expect(published.isError).toBe(false);
    expect(published.text).toContain("no remote");
    const commit = (published.result.structuredContent as Record<string, any>).commit as string;

    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    const log = git(root, "log", "-1", "--format=%H%n%B");

    expect(log).toContain(commit);
    expect(log).toContain(`${PRODUCT.commitTrailer}: 1`);
    expect(log).toContain("Update Home page");
    expect(git(root, "status", "--porcelain")).toBe("");

    const history = (await callTool(client, "get_history", { limit: 5 })).json() as unknown as Array<Record<string, unknown>>;

    expect(history[0]).toMatchObject({ commit, files: 1, viaThisApp: true });

    const undone = await callTool(client, "undo_publish", { commit });

    expect(undone.isError).toBe(false);
    expect(undone.text).toContain("Undid that version");
    expect(readFileSync(join(root, HOME_PAGE), "utf8")).toContain(`heading: ${HERO_HEADING}`);
    expect(git(root, "log", "--format=%s", "-2").split("\n")[0]).toMatch(/^Undo “Update/);

    expect((await callTool(client, "publish", {})).text).toBe("There's nothing waiting to be published.");
    await close();
  });

  it("discard_changes needs paths or all, and puts files back", async () => {
    const { client, close } = await connect(engine);
    const entry = (await callTool(client, "read_entry", { path: "src/content/pages/about.md" })).json();

    await callTool(client, "update_entry", { path: entry.path, baseHash: entry.hash, ops: [{ op: "set", path: "title", value: "About us" }] });
    expect((await callTool(client, "discard_changes", {})).isError).toBe(true);
    expect((await callTool(client, "discard_changes", { paths: ["src/content/pages/nope.md"] })).text).toContain("no pending changes");
    const discarded = await callTool(client, "discard_changes", { paths: [entry.path] });

    expect(discarded.text).toContain("Discarded the changes to 1 file");
    expect(git(root, "status", "--porcelain")).toBe("");
    await close();
  });
});

describe("find_text never guesses", () => {
  let engine: Engine;

  beforeAll(async () => {
    engine = await openEngine(makeSite());
  });
  afterAll(() => engine.site.dispose());

  it("unique, ambiguous and none", async () => {
    const { client, close } = await connect(engine);
    const unique = (await callTool(client, "find_text", { text: "Four ways we usually help", url: "http://127.0.0.1:4611/" })).json();

    expect(unique.status).toBe("unique");
    expect(unique.matches[0]).toMatchObject({ path: HOME_PAGE, field: "sections.2.heading", editable: true });
    expect(unique.next).toContain('"set" at "sections.2.heading"');

    const ambiguous = (await callTool(client, "find_text", { text: "Book a free first visit" })).json();

    expect(ambiguous.status).toBe("ambiguous");
    expect(ambiguous.matches.length).toBeGreaterThan(1);
    expect(ambiguous.next).toContain("Ask the person");

    const none = (await callTool(client, "find_text", { text: "This sentence is on no page at all", url: "/" })).json();

    expect(none.status).toBe("none");
    await close();
  });

  it("with no page given favours none — not the home page", async () => {
    const { client, close } = await connect(engine);
    const homeHeading = (await engine.site.readEntry(HOME_PAGE)).data as { sections: Array<{ heading?: string }> };
    const text = homeHeading.sections.find((section) => section.heading)!.heading!;
    const onHome = (await callTool(client, "find_text", { text, url: "/" })).json();
    const anywhere = (await callTool(client, "find_text", { text })).json();
    const direct = await engine.site.resolveText({ urlPath: "", text });

    expect(onHome.status).toBe("unique");
    // The same answer as asking the engine with no page at all.
    expect(anywhere.status).toBe(direct.status);
    expect(anywhere.matches.map((match: { path: string }) => match.path)).toEqual(direct.matches.map((match) => match.path));
    await close();
  });
});

describe("add_media", () => {
  let engine: Engine;
  let root: string;

  beforeAll(async () => {
    root = makeSite();
    engine = await openEngine(root);
  });
  afterAll(() => engine.site.dispose());

  it("copies a local image into the media folder (stdio)", async () => {
    const dir = tempDir("pictures-");
    const file = join(dir, "Team Photo.png");

    writeFileSync(file, PNG);
    const { client, close } = await connect(engine);
    const added = await callTool(client, "add_media", { file });

    expect(added.isError).toBe(false);
    expect(added.json()).toMatchObject({ url: "/images/team-photo.png", path: "public/images/team-photo.png", width: 1, height: 1 });
    expect(readFileSync(join(root, "public/images/team-photo.png")).equals(PNG)).toBe(true);
    const again = await callTool(client, "add_media", { file, filename: "team-photo" });

    expect(again.json().path).toBe("public/images/team-photo-2.png");
    await close();
  });

  it("refuses what isn't media, hidden folders, and relative paths", async () => {
    const dir = tempDir("pictures-");
    const fake = join(dir, "notes.png");
    const hidden = join(dir, ".secrets");

    writeFileSync(fake, "not an image at all");
    mkdirSync(hidden);
    writeFileSync(join(hidden, "key.png"), PNG);
    writeFileSync(join(dir, "id_rsa"), "-----BEGIN KEY-----");
    const { client, close } = await connect(engine);

    expect((await callTool(client, "add_media", { file: fake })).text).toContain("doesn't look like a valid image");
    expect((await callTool(client, "add_media", { file: join(hidden, "key.png") })).text).toContain("hidden folders");
    expect((await callTool(client, "add_media", { file: join(dir, "id_rsa"), filename: "photo.png" })).text).toContain("Only images");
    expect((await callTool(client, "add_media", { file: "photo.png" })).text).toContain("full location");
    expect((await callTool(client, "add_media", { file: join(dir, "notes.png"), filename: "x.pdf" })).text).toContain("keep the file's type");
    await close();
  });

  it("takes base64 data over HTTP", async () => {
    const { client, close } = await connect(engine, { transport: "http" });
    const added = await callTool(client, "add_media", { data: PNG.toString("base64"), filename: "dot.png" });

    expect(added.json().url).toBe("/images/dot.png");
    expect((await callTool(client, "add_media", { data: Buffer.from("<html>").toString("base64"), filename: "page.html" })).text).toContain("can't be added to the media library");
    await close();
  });
});

describe("guard rails", () => {
  let engine: Engine;
  let root: string;

  beforeAll(async () => {
    root = makeSite();
    engine = await openEngine(root);
  });
  afterAll(() => engine.site.dispose());

  it("a content-mode connection can't call build tools", async () => {
    const { client, close } = await connect(engine);
    const result = await callTool(client, "write_file", { path: "src/components/Evil.astro", content: "<p>x</p>" });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("write_file");
    await close();
  });

  it("the engine refuses a content-mode source write even when the handler is called directly", async () => {
    const write = toolByName("write_file")!;
    const model = await engine.site.model();
    // Exactly the context a content-mode MCP call builds — skipping the tool list and the dispatcher.
    const ctx: ToolContext = { site: engine.site, siteId: engine.site.id, mode: "content", model, images: engine.images, signal: new AbortController().signal, titles: new Map(), question: null, askedLastTurn: false };
    const before = readFileSync(join(root, "astro.config.ts"), "utf8");

    await expect(write.run({ path: "astro.config.ts", content: "export default {};" }, ctx)).rejects.toMatchObject({ code: "forbidden" });
    await expect(write.run({ path: "src/components/Evil.astro", content: "<p>x</p>" }, ctx)).rejects.toMatchObject({ code: "forbidden" });
    expect(readFileSync(join(root, "astro.config.ts"), "utf8")).toBe(before);
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("build mode works where the site allows it, and is refused where its settings turn it off", async () => {
    const { client, close } = await connect(engine, { mode: "build" });
    const wrote = await callTool(client, "write_file", { path: "src/components/Note.astro", content: "<p>Note</p>\n" });

    expect(wrote.isError).toBe(false);
    await engine.site.discard(["src/components/Note.astro"]);
    await close();

    const config = JSON.parse(readFileSync(join(root, "galley.config.json"), "utf8"));

    writeFileSync(join(root, "galley.config.json"), JSON.stringify({ ...config, ai: { ...config.ai, allowBuild: false } }));
    await engine.site.refresh();
    const locked = await connect(engine, { mode: "build" });
    const refused = await callTool(locked.client, "write_file", { path: "src/components/Note.astro", content: "<p>Note</p>\n" });

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("turned off in this site's own settings");
    await locked.close();
    git(root, "checkout", "--", "galley.config.json");
    await engine.site.refresh();
  });

  it("the engine itself refuses build-mode work on a site that turns build mode off, whoever calls", async () => {
    const config = JSON.parse(readFileSync(join(root, "galley.config.json"), "utf8"));

    writeFileSync(join(root, "galley.config.json"), JSON.stringify({ ...config, ai: { ...config.ai, allowBuild: false } }));
    await engine.site.refresh();
    const model = await engine.site.model();
    // A build-mode context as a harness that skipped every check of its own would build it.
    const ctx: ToolContext = { site: engine.site, siteId: engine.site.id, mode: "build", model, images: engine.images, signal: new AbortController().signal, titles: new Map(), question: null, askedLastTurn: false };
    const message = "Build mode is turned off for this site, so only its content can be changed. The site's settings (ai.allowBuild) control it.";

    await expect(toolByName("write_file")!.run({ path: "src/components/Note.astro", content: "<p>x</p>" }, ctx)).rejects.toMatchObject({ code: "forbidden", message });
    await expect(toolByName("save_site_config")!.run({ config: { ...config, ai: { allowBuild: true } } }, ctx)).rejects.toMatchObject({ code: "forbidden", message });
    await expect(toolByName("run_build")!.run({}, ctx)).rejects.toMatchObject({ code: "forbidden", message });
    expect((await engine.site.model()).ai.allowBuild).toBe(false);
    git(root, "checkout", "--", "galley.config.json");
    await engine.site.refresh();
  });

  it("invalid arguments come back as a tool error, not a crash", async () => {
    const { client, close } = await connect(engine);
    const bad = await callTool(client, "update_entry", { path: HOME_PAGE, ops: [{ op: "explode" }] });

    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/Invalid arguments for tool update_entry/);
    const missing = await callTool(client, "read_entry", { path: "src/content/pages/missing.md" });

    expect(missing.isError).toBe(true);
    expect(missing.text).not.toMatch(/Error:|at .*\.ts/);
    // The connection is still usable.
    expect((await callTool(client, "list_entries", { collection: "pages" })).isError).toBe(false);
    await close();
  });

  it("a stale baseHash is refused instead of overwriting someone else's edit", async () => {
    const { client, close } = await connect(engine);
    const entry = (await callTool(client, "read_entry", { path: HOME_PAGE })).json();

    writeFileSync(join(root, HOME_PAGE), readFileSync(join(root, HOME_PAGE), "utf8").replace("Four ways", "Five ways"));
    const stale = await callTool(client, "update_entry", { path: HOME_PAGE, baseHash: entry.hash, ops: [{ op: "set", path: "title", value: "x" }] });

    expect(stale.isError).toBe(true);
    git(root, "checkout", "--", HOME_PAGE);
    await close();
  });
});

describe("resources and prompts", () => {
  it("serves the site card, the guide and entries by path; three prompts", async () => {
    const engine = await openEngine(makeSite());
    const { client, close } = await connect(engine);
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);

    expect(uris).toEqual(expect.arrayContaining(["galley://site", "galley://guide", `galley://entry/${HOME_PAGE}`]));
    const { resourceTemplates } = await client.listResourceTemplates();

    expect(resourceTemplates.map((t) => t.uriTemplate)).toContain("galley://entry/{+path}");
    const card = await client.readResource({ uri: "galley://site" });

    expect((card.contents[0] as { text: string }).text).toContain("## Collections");
    const guide = await client.readResource({ uri: "galley://guide" });

    expect((guide.contents[0] as { text: string }).text).toContain("CONTENT-GUIDE.md");
    const page = await client.readResource({ uri: `galley://entry/${HOME_PAGE}` });

    expect((page.contents[0] as { text: string }).text).toContain(`heading: ${HERO_HEADING}`);
    const { prompts } = await client.listPrompts();

    expect(prompts.map((p) => p.name).sort()).toEqual(["edit_page", "review_and_publish", "write_post"]);
    const edit = await client.getPrompt({ name: "edit_page", arguments: { change: "Say we open on Saturdays" } });

    expect((edit.messages[0]!.content as { text: string }).text).toContain("read_entry");
    const review = await client.getPrompt({ name: "review_and_publish" });

    expect((review.messages[0]!.content as { text: string }).text).toContain("Only if I say yes");
    await close();
    await engine.site.dispose();
  });
});

describe("the catalog", () => {
  it("never offers a write in read-only mode", () => {
    for (const mode of ["content", "build"] as const) {
      const entries = toolCatalog({ mode, allowPublish: true, readOnly: true, images: true, transport: "stdio", sites: "many" });

      expect(entries.every((entry) => entry.effect.readOnly)).toBe(true);
    }
  });

  it("names every tool in snake_case and keeps them unique", () => {
    const entries = toolCatalog({ mode: "build", allowPublish: true, readOnly: false, images: true, transport: "http", sites: "many" });
    const all = entries.map((e) => e.name);

    expect(new Set(all).size).toBe(all.length);
    for (const name of all) expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/);
    expect(createMcpServer).toBeTypeOf("function");
  });
});
