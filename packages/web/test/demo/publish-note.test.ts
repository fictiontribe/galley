/**
 * The stand-in backend (and so the public demo) says what the engine says:
 * the suggested publish note calls the home page "Home page", and dragging a
 * section is one move, not an edit to every field of every section it passed.
 */
import { describe, expect, it } from "vitest";
import type { ChangeSet } from "@galley/core/types";
import { editsWithin } from "@/features/content/form/marks";
import { createMockServer, type MockServer } from "../../mock/server.ts";
import { planList } from "../../mock/diff.ts";
import { suggestedNote } from "../../mock/describe.ts";

async function call<T>(server: MockServer, method: string, url: string, body?: unknown): Promise<T> {
  const answer = await server.handle({ method, url, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: Buffer.from(JSON.stringify(body)) }) });
  expect(answer.status).toBeLessThan(300);
  return JSON.parse(String(answer.body)) as T;
}

const HOME = "src/content/pages/index.md";

describe("the stand-in's words match the engine's", () => {
  it("names the home page Home page in the suggested publish note, and counts a moved section as one change", async () => {
    const server = createMockServer({ mode: "local" });
    const siteId = [...server.backend.sites.keys()][0]!;
    const base = `/api/sites/${siteId}`;
    await call(server, "POST", `${base}/discard`, {});
    const entry = await call<{ hash: string; title: string; data: { sections: unknown[] } }>(server, "GET", `${base}/entry?path=${encodeURIComponent(HOME)}`);
    expect(entry.data.sections.length).toBeGreaterThan(2);
    expect(entry.title).not.toBe("Home page");

    await call(server, "PATCH", `${base}/entry?path=${encodeURIComponent(HOME)}`, { baseHash: entry.hash, ops: [{ op: "move", path: ["sections"], from: 0, to: 2 }] });
    const changes = await call<ChangeSet>(server, "GET", `${base}/changes`);
    const home = changes.files.find((file) => file.path === HOME)!;

    expect(home.fieldChanges?.map((change) => change.kind)).toEqual(["moved"]);
    expect(editsWithin(home.fieldChanges, ["sections"])).toBe(1);
    expect(home.summary).toMatch(/^Moved the /);
    expect((await call<{ message: string }>(server, "POST", `${base}/publish/message`, { paths: [HOME] })).message).toBe("Update Home page");
  });

  it("writes the note as the engine's deterministic summary does", () => {
    const page = (path: string, title: string, url: string, status: "modified" | "added" = "modified") => ({ path, title, url, status, kind: "content" as const, binary: false, additions: 1, deletions: 1, summary: "" });

    expect(suggestedNote([page(HOME, "Caddow — coats and knitwear, made in runs of forty", "/"), page("src/content/pages/atelier.md", "The atelier — where the coats are cut", "/atelier/")])).toBe("Update Home page and The atelier");
    expect(suggestedNote([page(HOME, "Caddow", "/"), { path: "public/images/a.webp", status: "added", kind: "media", binary: true, additions: 0, deletions: 0, summary: "" }])).toBe("Update Home page and add 1 image");
    expect(suggestedNote([])).toBe("No changes");
  });

  it("lines list items up: a move is one move, an edit stays in its section", () => {
    const hero = { type: "hero", heading: "A" };
    const text = { type: "rich-text", text: "B" };
    const cta = { type: "cta", label: "C" };

    expect(planList([hero, text, cta], [text, cta, hero]).pairs.filter((pair) => pair.moved)).toEqual([{ from: 0, to: 2, exact: true, moved: true }]);
    expect(planList([hero, text], [hero, { ...text, text: "B2" }])).toEqual({ pairs: [{ from: 0, to: 0, exact: true, moved: false }, { from: 1, to: 1, exact: false, moved: false }], removed: [], added: [] });
    expect(planList([hero, text], [hero])).toMatchObject({ removed: [1], added: [] });
  });
});
