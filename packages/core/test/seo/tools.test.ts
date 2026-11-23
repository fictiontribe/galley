/** The visibility tools through the shared registry: offered to the assistant in content mode and to MCP, read-only, and useful to a model. */
import { afterAll, describe, expect, it } from "vitest";
import { executeTool, siteTools, toolByName, toolsForMode } from "../../src/ai/tools/index";
import type { ToolContext } from "../../src/ai/tools/types";
import type { GalleyImageService } from "../../src/ai/images/service";
import { disposeAll, openSite } from "../site/helpers";
import { makeFixture, plantedFiles, plantedRendered } from "./fixture";

afterAll(() => disposeAll());

describe("audit tools", () => {
  it("are in the registry for every mode and every surface, read-only", () => {
    for (const name of ["audit_site", "audit_entry"]) {
      expect(toolsForMode("content").map((tool) => tool.name)).toContain(name);
      expect(siteTools.map((tool) => tool.name)).toContain(name);
      expect(toolByName(name)!.effect).toEqual({ readOnly: true, destructive: false, idempotent: true, openWorld: false });
    }
  });

  it("return findings with ready edits and the kind of each statement", async () => {
    const { site } = await openSite(makeFixture(plantedFiles(), plantedRendered()));
    const ctx: ToolContext = { site, siteId: site.id, mode: "content", model: await site.model(), images: {} as GalleyImageService, signal: new AbortController().signal, titles: new Map(), question: null, askedLastTurn: false };
    const whole = await executeTool(toolByName("audit_site"), "audit_site", { severity: "must" }, ctx, "Checking");
    const parsed = JSON.parse(whole.content);

    expect(whole.isError).toBeUndefined();
    expect(whole.doneLabel).toMatch(/^Checked search and AI visibility · \d+ things to fix, \d+ ideas$/);
    expect(parsed.crawlers[0]).toMatch(/^OpenAI: ChatGPT's search crawler is blocked/);
    const noindex = parsed.findings.find((f: { code: string }) => f.code === "noindex-important");

    expect(noindex).toMatchObject({ severity: "must", kind: "measurable", fix: [{ path: "src/content/pages/index.md", ops: [{ op: "set", path: ["noindex"], value: false }] }] });
    expect(parsed.findings.every((f: { severity: string }) => f.severity === "must")).toBe(true);
    const one = JSON.parse((await executeTool(toolByName("audit_entry"), "audit_entry", { path: "src/content/pages/contact.md" }, ctx, "Checking")).content);

    expect(one.result).toMatchObject({ title: "Visit us · Harbour Bakery", from: "rendered" });
    expect(one.findings.map((f: { code: string }) => f.code)).toContain("description-missing");
    expect(one.findings.find((f: { code: string }) => f.code === "description-missing").write).toBe("description");
    expect((await executeTool(toolByName("audit_entry"), "audit_entry", {}, ctx, "Checking")).isError).toBe(true);
  });
});
