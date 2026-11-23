/**
 * check_redirects: the assistant's and MCP's read-only view of the list —
 * where it lives, what's wrong with it, where an address ends up.
 */
import { afterEach, describe, expect, it } from "vitest";
import { toolByName } from "../../src/ai/tools/index";
import type { ToolContext } from "../../src/ai/tools/types";
import { disposeAll, makeSite, openSite, writeTree } from "../site/helpers";

afterEach(() => disposeAll());

describe("check_redirects", () => {
  it("reports the file, the problems and traces", async () => {
    const root = makeSite();

    writeTree(root, {
      "src/data/redirects.json": '{\n  "redirects": [\n    {"from":"/a/","to":"/b/","status":301},\n    {"from":"/b/","to":"/about/","status":301},\n    {"from":"/x/","to":"/x/","status":301}\n  ]\n}\n',
    });
    const { site } = await openSite(root);
    const tool = toolByName("check_redirects")!;
    const outcome = await tool.run({ addresses: ["/a/"] }, { site, mode: "content" } as unknown as ToolContext);
    const value = JSON.parse(outcome.content as string);

    expect(tool.effect.readOnly).toBe(true);
    expect(value).toMatchObject({ file: "src/data/redirects.json", exists: true, count: 3 });
    expect(value.issues.map((issue: { code: string }) => issue.code)).toEqual(expect.arrayContaining(["chain", "self"]));
    expect(value.traces[0]).toMatchObject({ final: "/about/", kind: "page", steps: ["/a/ → /b/ (301)", "/b/ → /about/ (301)"] });
  });
});
