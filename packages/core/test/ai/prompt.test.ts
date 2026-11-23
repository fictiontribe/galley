/** The site card, the system prompt, the brief, and publish summaries. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, briefToPrompt, buildSiteCard, deterministicSummary } from "../../src/ai/index";
import { describeChangeSet } from "../../src/ai/describe";
import { INSTRUCTIONS_FILE_CHARS } from "../../src/ai/site-card";
import { PRODUCT } from "../../src/brand";
import { loadSiteModel } from "../../src/content/config/config";
import type { ChangeSet, FileChange, SiteModel } from "../../src/types";
import { fakeModel } from "./helpers/fake-site";
import { jsonResponse, scriptedFetch, testClient } from "./helpers/scripted-fetch";

const STARTER = join(dirname(fileURLToPath(import.meta.url)), "../../../../starters/astro-starter");

describe("site card", () => {
  it("describes the starter deterministically, section types included", async () => {
    const model = await loadSiteModel(STARTER);
    const guide = readFileSync(join(STARTER, "CONTENT-GUIDE.md"), "utf8");
    const a = buildSiteCard(model, [{ path: "CONTENT-GUIDE.md", content: guide }]);
    const shuffled: SiteModel = { ...model, collections: [...model.collections].reverse() };
    const b = buildSiteCard(await loadSiteModel(STARTER), [{ path: "CONTENT-GUIDE.md", content: guide }]);

    expect(a).toBe(b);
    expect(buildSiteCard(shuffled, [{ path: "CONTENT-GUIDE.md", content: guide }])).toBe(a);
    expect(a).toContain("# The site: Lowfield Studio");
    expect(a).toContain("### pages");
    expect(a).toContain("Section types for sections");
    expect(a).toMatch(/- hero/);
    expect(a).toContain('<instructions file="CONTENT-GUIDE.md">');
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
    // Item counts change with every new post; they'd break the cache.
    expect(a.slice(0, a.indexOf("<instructions"))).not.toMatch(/\b\d+ (items?|posts?|pages?|entries)\b/);
  });

  it("caps a long instructions file and says so", () => {
    const card = buildSiteCard(fakeModel(), [{ path: "GUIDE.md", content: "word ".repeat(10_000) }]);

    expect(card).toContain("[Shortened here");
    expect(card.length).toBeLessThan(INSTRUCTIONS_FILE_CHARS + 5_000);
    expect(buildSiteCard(fakeModel(), [{ path: "MISSING.md", content: null }])).toContain("couldn't be read");
  });
});

describe("system prompt", () => {
  it("uses the product name from brand.ts and holds the rules that were earned", () => {
    expect(SYSTEM_PROMPT).toContain(`inside ${PRODUCT.name}`);
    for (const rule of ["smallest change", "dictates wording", "Don't invent facts", "ask_user", "never ask two questions in a row".slice(1), "about 60 characters", "about 160", "build mode", "run the build", "Only say something changed if a tool in this turn reported", "You never publish"]) {
      expect(SYSTEM_PROMPT).toContain(rule);
    }
    expect(SYSTEM_PROMPT).not.toMatch(/\b(blade|harness)\b/i);
    expect(SYSTEM_PROMPT).not.toMatch(/\bNEVER\b|\bALWAYS\b|\bMUST\b/);
  });
});

describe("brief", () => {
  it("turns the wizard's brief into a build task that names the starter's own files", async () => {
    const model = await loadSiteModel(STARTER);
    const prompt = briefToPrompt({ description: "A family-run bike repair shop in Leeds.", audience: "commuters", tone: "friendly, practical", pages: ["Home", "Services", "Contact"], brandColor: "#0B7A75", notes: "Open Saturdays." }, model);

    expect(prompt).toContain("A family-run bike repair shop in Leeds.");
    expect(prompt).toContain("Pages wanted: Home, Services, Contact");
    expect(prompt).toContain("CONTENT-GUIDE.md");
    expect(prompt).toContain("#0B7A75");
    expect(prompt).toContain("4.5:1");
    expect(prompt).toMatch(/Never invent testimonials, client or partner names, statistics/);
    expect(prompt).toContain("Image generation isn't set up");
    expect(prompt).toContain("Run the build");
    expect(briefToPrompt({ description: "A shop." }, model, { imagesAvailable: true })).toContain("generate_image");
    expect(() => briefToPrompt({ description: " " }, model)).toThrow(/Describe the organisation/);
    expect(() => briefToPrompt({ description: "A shop.", brandColor: "teal" }, model)).toThrow(/hex value/);
  });
});

describe("describeChanges", () => {
  const file = (extra: Partial<FileChange>): FileChange => ({ path: "src/content/pages/about.md", status: "modified", kind: "content", binary: false, additions: 1, deletions: 1, summary: "Changed the heading", ...extra });
  const changes = (files: FileChange[]): ChangeSet => ({ branch: "main", baseCommit: "abc", files, totals: { files: files.length, additions: 0, deletions: 0 } });

  it("summarises deterministically", () => {
    expect(deterministicSummary(changes([file({ title: "About" })]))).toBe("Update About");
    expect(deterministicSummary(changes([file({ title: "Home" }), file({ title: "About" }), file({ path: "public/images/a.png", kind: "media", status: "added" })]))).toBe("Update Home and About, and add 1 image");
    expect(deterministicSummary(changes(Array.from({ length: 5 }, (_, i) => file({ title: `P${i}` }))))).toBe("Update 5 pages and posts");
    expect(deterministicSummary(changes([]))).toBe("No changes");
  });

  it("asks Haiku for one sentence, and falls back when there's no client or the call fails", async () => {
    const script = scriptedFetch([
      () => jsonResponse(200, { id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [{ type: "text", text: "Refresh the About page heading." }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 80, output_tokens: 9 } }),
      () => jsonResponse(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }),
    ]);
    const recorded: unknown[] = [];
    const deps = { client: testClient(script.fetch), record: async (u: unknown) => void recorded.push(u), log: () => undefined };
    const set = changes([file({ title: "About" })]);

    expect(await describeChangeSet(set, deps)).toBe("Refresh the About page heading");
    expect(script.requests[0]!.body).toMatchObject({ model: "claude-haiku-5-5", output_config: { effort: "low" } });
    expect(script.requests[0]!.body).not.toHaveProperty("fallbacks");
    expect(recorded).toHaveLength(1);
    expect(await describeChangeSet(set, deps)).toBe("Update About");
    expect(await describeChangeSet(set, { ...deps, client: null })).toBe("Update About");
  });

  it("gives up after three seconds", async () => {
    const script = scriptedFetch([(_r, signal) => new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))]);
    const started = Date.now();
    const result = await describeChangeSet(changes([file({ title: "About" })]), { client: testClient(script.fetch), record: async () => undefined, log: () => undefined });

    expect(result).toBe("Update About");
    expect(Date.now() - started).toBeLessThan(4_500);
  });
});
