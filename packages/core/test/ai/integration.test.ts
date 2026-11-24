/**
 * The assistant on the real facade: a temp copy of starters/astro-starter in a
 * real git repository, opened through createSiteRegistry, driven by a scripted
 * model conversation through the real SDK.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgentRuntime, createImageService, createSettingsService, filenameFromPrompt } from "../../src/ai/index";
import * as siteModule from "../../src/site/index";
import type { AgentRuntime, ChatMessage, ServerEvent, SiteRegistry, SiteService } from "../../src/types";
import { cleanEnv, recordingBus, tempDir, type RecordingBus } from "./helpers/env";
import { TEST_KEY, scriptedFetch, stream, testClient, type MessageSpec} from "./helpers/scripted-fetch";

const STARTER = join(dirname(fileURLToPath(import.meta.url)), "../../../../starters/astro-starter");
const createSiteRegistry = (siteModule as { createSiteRegistry?: (o: unknown) => Promise<SiteRegistry> }).createSiteRegistry;
const IDENTITY = ["-c", "user.name=Test Person", "-c", "user.email=test@example.com"];

// git in this process must not see the machine's own config or identity.
const gitIsolation = join(tempDir("ai-int-git-"), "gitconfig");

writeFileSync(gitIsolation, "[init]\n\tdefaultBranch = main\n");
process.env.GIT_CONFIG_GLOBAL = gitIsolation;
process.env.GIT_CONFIG_NOSYSTEM = "1";

const git = (cwd: string, ...args: string[]) => execFileSync("git", [...IDENTITY, ...args], { cwd, encoding: "utf8" }).trim();
const tool = (id: string, name: string, input: unknown): MessageSpec => ({ content: [{ type: "thinking", thinking: "", signature: `sig-${id}` }, { type: "tool_use", id, name, input, chunks: 3 }], stop_reason: "tool_use" });
const tools = (calls: Array<[string, string, unknown]>): MessageSpec => ({ content: [{ type: "thinking", thinking: "", signature: "sig-many" }, ...calls.map(([id, name, input]) => ({ type: "tool_use" as const, id, name, input }))], stop_reason: "tool_use" });
const say = (text: string): MessageSpec => ({ content: [{ type: "thinking", thinking: "", signature: "sig-text" }, { type: "text", text }], stop_reason: "end_turn" });

const available = typeof createSiteRegistry === "function" && existsSync(join(STARTER, "package.json"));

// Skipped, with this name in the report, when the facade isn't exported yet.
describe.skipIf(!available)("assistant on the real facade (starters/astro-starter; needs createSiteRegistry)", () => {
  let root: string;
  let registry: SiteRegistry;
  let site: SiteService;
  let runtime: AgentRuntime;
  let bus: RecordingBus;
  let script: ReturnType<typeof scriptedFetch>;
  let threadId: string;

  beforeAll(async () => {
    root = join(tempDir("ai-int-site-"), "site");
    cpSync(STARTER, root, {
      recursive: true,
      filter: (source) => {
        const rel = relative(STARTER, source).split("/")[0];

        return rel !== "node_modules" && rel !== ".astro" && rel !== "dist";
      },
    });
    git(root, "init", "-q", "-b", "main");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "Starter");
    const home = tempDir("ai-int-home-");
    const settings = createSettingsService({ home, env: cleanEnv({ ANTHROPIC_API_KEY: TEST_KEY }) });

    await settings.update({ images: { provider: "mock" } });
    bus = recordingBus();
    registry = await createSiteRegistry!({
      home,
      sitesDir: tempDir("ai-int-sites-"),
      startersDir: tempDir("ai-int-starters-"),
      events: bus,
      overlayScript: () => "",
      settings,
      install: async () => undefined,
    });
    site = await registry.open({ path: root });
    script = scriptedFetch([]);
    runtime = createAgentRuntime({
      home,
      registry,
      settings,
      images: createImageService({ home, settings }),
      events: bus,
      client: testClient(script.fetch),
      maxTokens: 8_000,
      env: {},
      logger: () => undefined,
    });
    threadId = (await runtime.createThread(site.id)).id;
  });

  afterAll(async () => {
    await registry?.dispose();
  });

  async function turn(text: string, specs: MessageSpec[], extra: Record<string, unknown> = {}): Promise<ChatMessage> {
    script.push(...specs.map((spec) => stream(spec)));
    const before = bus.events.length;
    const { turnId } = await runtime.send(site.id, threadId, { text, ...extra });

    await bus.waitFor((e) => e.type === "chat.done" && e.turnId === turnId, 20_000);
    const reply = bus.events
      .slice(before)
      .filter((e): e is Extract<ServerEvent, { type: "chat.message" }> => e.type === "chat.message")
      .map((e) => e.message)
      .filter((m) => m.role === "assistant" && !m.pending)
      .pop();

    expect(script.remaining()).toBe(0);
    return reply!;
  }

  const numstat = (path: string) => git(root, "diff", "--numstat", "--", path);

  it("(a) changes the home hero heading with a one-line diff", async () => {
    const reply = await turn(
      "Change the hero heading to: Better rooms in the home you already have.",
      [
        tool("t1", "read_entry", { path: "src/content/pages/index.md", field: "sections.0" }),
        tool("t2", "update_entry", { path: "src/content/pages/index.md", ops: [{ op: "set", path: "sections.0.heading", value: "Better rooms in the home you already have." }] }),
        say("The heading now reads “Better rooms in the home you already have.” It's waiting in Proof."),
      ],
      { context: { urlPath: "/" } }
    );

    expect(numstat("src/content/pages/index.md")).toBe("1\t1\tsrc/content/pages/index.md");
    expect(git(root, "diff", "-U0", "--", "src/content/pages/index.md")).toContain("+    heading: Better rooms in the home you already have.");
    expect(reply.changedPaths).toEqual(["src/content/pages/index.md"]);
    expect(reply.tools?.map((t) => t.label)).toEqual(["Read the home page", "Edited the home page"]);
    expect(script.requests[0]!.body.system[1].text).toContain("# The site: Lowfield Studio");
  });

  it("(b, c, f) adds a section and writes a post in one turn — and undo puts both back", async () => {
    const contactBefore = readFileSync(join(root, "src/content/pages/contact.md"), "utf8");
    const reply = await turn("Add an opening-hours FAQ to the contact page and write a short post announcing Saturday openings", [
      tools([
        ["t3", "read_entry", { path: "src/content/pages/contact.md" }],
        ["t4", "list_entries", { collection: "blog", limit: 2 }],
      ]),
      tools([
        [
          "t5",
          "update_entry",
          {
            path: "src/content/pages/contact.md",
            ops: [{ op: "insert", path: "sections", value: { type: "faq", heading: "When are you open?", items: [{ question: "Are you open on Saturdays?", answer: "Yes, from 9 until 1." }] } }],
          },
        ],
        [
          "t6",
          "create_entry",
          {
            collection: "blog",
            slug: "saturday-openings",
            data: { title: "We're now open on Saturdays", description: "From this month the studio opens on Saturday mornings, from 9 until 1, for drop-in questions.", date: "2026-11-23", author: "tomas-reyes", image: "/images/blog/planning.svg", imageAlt: "Abstract drawing of a calendar" },
            body: "From this month we open on Saturday mornings.\n",
          },
        ],
      ]),
      say("I added an FAQ section to the Contact page and wrote the post “We're now open on Saturdays”. Both are in Proof."),
    ]);

    expect(readFileSync(join(root, "src/content/pages/contact.md"), "utf8")).toContain("heading: When are you open?");
    expect(existsSync(join(root, "src/content/blog/saturday-openings.md"))).toBe(true);
    expect(reply.changedPaths).toEqual(expect.arrayContaining(["src/content/pages/contact.md", "src/content/blog/saturday-openings.md"]));
    const issues = await site.validate(["src/content/blog/saturday-openings.md", "src/content/pages/contact.md"]);

    expect(issues.filter((i) => i.severity === "error")).toEqual([]);

    const undone = await runtime.undoTurn(site.id, threadId, reply.turnId);

    expect(undone.restored.sort()).toEqual(["src/content/blog/saturday-openings.md", "src/content/pages/contact.md"]);
    expect(undone.left).toEqual([]);
    expect(readFileSync(join(root, "src/content/pages/contact.md"), "utf8")).toBe(contactBefore);
    expect(existsSync(join(root, "src/content/blog/saturday-openings.md"))).toBe(false);
    // (a)'s change is a different turn and stays.
    expect(numstat("src/content/pages/index.md")).toBe("1\t1\tsrc/content/pages/index.md");
  });

  it("undo leaves a page someone else saved after the reply, says which, and tells the assistant", async () => {
    const about = "src/content/pages/about.md";
    const contact = "src/content/pages/contact.md";
    const aboutBefore = readFileSync(join(root, about), "utf8");
    const reply = await turn("Retitle the about and contact pages", [
      tools([
        ["u1", "read_entry", { path: about }],
        ["u2", "read_entry", { path: contact }],
      ]),
      tools([
        ["u3", "update_entry", { path: about, ops: [{ op: "set", path: ["title"], value: "Who we are" }] }],
        ["u4", "update_entry", { path: contact, ops: [{ op: "set", path: ["title"], value: "Get in touch" }] }],
      ]),
      say("I retitled both pages. They are in Proof."),
    ]);

    expect(reply.changedPaths?.slice().sort()).toEqual([about, contact]);
    // Someone else, in their own request, saves the contact page after the reply.
    await site.updateEntry(contact, [{ op: "set", path: ["description"], value: "Write, call or drop in." }], { origin: "user" });
    const contactNow = readFileSync(join(root, contact), "utf8");

    const before = bus.events.length;
    const undone = await runtime.undoTurn(site.id, threadId, reply.turnId);

    expect(undone).toEqual({ restored: [about], left: [contact] });
    expect(readFileSync(join(root, about), "utf8")).toBe(aboutBefore);
    // Their save, and the reply's change under it, are both still there.
    expect(readFileSync(join(root, contact), "utf8")).toBe(contactNow);
    expect(contactNow).toContain("Get in touch");
    expect(contactNow).toContain("Write, call or drop in.");
    const message = bus.events
      .slice(before)
      .filter((e): e is Extract<ServerEvent, { type: "chat.message" }> => e.type === "chat.message")
      .map((e) => e.message)
      .pop();

    expect(message).toMatchObject({ undone: true, undoLeft: [contact], turnId: reply.turnId });

    // The next request tells the model which file still holds its change.
    await turn("Thanks", [say("You're welcome.")]);
    const texts: string[] = script.requests
      .at(-1)!
      .body.messages.flatMap((m: { content: unknown }) => (Array.isArray(m.content) ? m.content : []))
      .map((block: { text?: unknown }) => (typeof block.text === "string" ? block.text : ""));
    const note = texts.find((text) => text.includes("undid your turn that answered “Retitle the about and contact pages”"));

    expect(note).toContain("These files are back to how they were before that turn: src/content/pages/about.md.");
    expect(note).toContain("left as they are and may still hold what your turn wrote: src/content/pages/contact.md.");
    expect(note).not.toContain("Everything that turn changed has been rolled back");
  });

  it("(d) refuses a source file in content mode, at the dispatcher and in the engine", async () => {
    const header = "src/components/Header.astro";
    const before = readFileSync(join(root, header), "utf8");

    await turn("Make the header sticky", [tool("t7", "write_file", { path: header, content: "<header>sticky</header>\n" }), say("I can't change the site's code in content mode.")]);
    expect(readFileSync(join(root, header), "utf8")).toBe(before);
    const lastResults = script.requests.at(-1)!.body.messages.at(-1).content[0];

    expect(lastResults).toMatchObject({ is_error: true });
    await expect(site.writeFile(header, "<header>x</header>\n", { origin: "agent", mode: "content" })).rejects.toMatchObject({ code: "forbidden" });
    expect(readFileSync(join(root, header), "utf8")).toBe(before);
  });

  it("(e) edits the theme tokens file in build mode", async () => {
    const tokens = readFileSync(join(root, "src/styles/tokens.css"), "utf8");
    const accent = /--color-accent:\s*([^;]+);/.exec(tokens)![0];
    const reply = await turn(
      "Make the accent colour navy",
      [
        tool("t8", "read_file", { path: "src/styles/tokens.css", startLine: 1, endLine: 80 }),
        tool("t9", "edit_file", { path: "src/styles/tokens.css", old_string: accent, new_string: "--color-accent: oklch(0.32 0.12 262);" }),
        say("The accent colour is now navy. It's in Proof."),
      ],
      { mode: "build" }
    );

    expect(readFileSync(join(root, "src/styles/tokens.css"), "utf8")).toContain("--color-accent: oklch(0.32 0.12 262);");
    expect(numstat("src/styles/tokens.css")).toBe("1\t1\tsrc/styles/tokens.css");
    expect(reply.tools?.map((t) => t.label)).toEqual(["Read the “tokens” stylesheet", "Edited the “tokens” stylesheet"]);
    const request = script.requests.at(-3)!.body;

    expect(request.messages.at(-1).role).toBe("system");
    expect(request.messages.at(-1).content.some((b: { type: string }) => b.type === "tool_addition")).toBe(true);
  });

  it("(g) generates an image with the mock provider and places it on a page", async () => {
    const prompt = "A sunlit garden room with a timber frame";
    const url = `/images/${filenameFromPrompt(prompt)}.svg`;

    await turn(
      "Make a new picture for the services page hero",
      [
        tool("t10", "generate_image", { prompt, aspect: "4:3" }),
        tool("t11", "update_entry", { path: "src/content/pages/services.md", ops: [{ op: "set", path: "sections.0.image", value: url }, { op: "set", path: "sections.0.imageAlt", value: "A sunlit garden room with a timber frame" }] }),
        say("I made a new hero picture for the Services page. It's in Proof."),
      ],
      { mode: "content" }
    );

    const file = join(root, "public", url);

    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("<svg");
    const services = await site.readEntry("src/content/pages/services.md");
    const hero = (services.data.sections as Array<Record<string, unknown>>)[0]!;

    expect(hero.image).toBe(url);
    expect(services.issues.filter((i) => i.code === "broken-image")).toEqual([]);
    const generated = script.requests.at(-2)!.body.messages.at(-1).content[0];

    expect(JSON.parse(generated.content).url).toBe(url);
  });
});
