/**
 * check_redirects: the assistant's and MCP's read-only view of the list —
 * where it lives, what's wrong with it, where an address ends up.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { toolByName } from "../../src/ai/tools/index";
import type { ToolContext } from "../../src/ai/tools/types";
import { firstMistake } from "../../src/redirects/file";
import { listFileOf } from "../../src/redirects/locate";
import { disposeAll, makeSite, openSite, sh, writeTree } from "../site/helpers";

afterEach(() => disposeAll());

describe("where a list stops being JSON", () => {
  it("agrees with the parser about which texts are, and names a place for the rest", () => {
    for (const text of ["{}", "[]", '{"redirects":[]}', ' { "a" : [ 1 , -2.5e3 , true , null , "x\\n\\u00e9" ] } ', '"alone"', "12", "null"]) {
      expect(() => JSON.parse(text), text).not.toThrow();
      expect(firstMistake(text), text).toBeNull();
    }
    for (const [text, at] of [
      ['{"a":1,}', 7],
      ['{"a" 1}', 5],
      ["[1 2]", 3],
      ['{"redirects": [\n  SECRET=1\n]}', 18],
      ['{"a":"unclosed', 14],
      ['{"a":"bad \\q"}', 10],
      ["{} extra", 3],
      ["", 0],
    ] as const) {
      expect(() => JSON.parse(text), text).toThrow();
      expect(firstMistake(text), text).toBe(at);
    }
  });
});

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

  it("never reads a secrets file the settings name as the list, and says nothing of what it holds", async () => {
    const root = makeSite();
    const settingsFile = join(root, "galley.config.json");
    const settings = JSON.parse(readFileSync(settingsFile, "utf8")) as Record<string, unknown>;

    writeTree(root, { "config/.env.json": "SECRET_API_KEY=not-a-list-of-redirects\n" });
    writeFileSync(settingsFile, `${JSON.stringify({ ...settings, redirects: { file: "config/.env.json" } }, null, 2)}\n`);
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "A list named like a secrets file");
    const { site } = await openSite(root);

    expect(listFileOf(await site.model())).toBe("config/.env.json");
    const outcome = await toolByName("check_redirects")!.run({}, { site, mode: "content" } as unknown as ToolContext);

    expect(outcome.content).not.toMatch(/SECRET|not-a-list|"S"/);
    expect(JSON.parse(outcome.content as string)).toMatchObject({ file: "config/.env.json", exists: false, count: 0, problem: "That is a secrets file, so it isn't read here. Ask the person for what you need from it." });
  });

  it("says where a list stops being readable without quoting what is written there", async () => {
    const root = makeSite();

    writeTree(root, { "src/data/redirects.json": '{\n  "redirects": [\n    SECRET_API_KEY=abc\n  ]\n}\n' });
    const { site } = await openSite(root);
    const value = JSON.parse((await toolByName("check_redirects")!.run({}, { site, mode: "content" } as unknown as ToolContext)).content as string);

    expect(value.problem).toBe("The redirects file has a formatting mistake near line 3, column 5, so it can't be read. Look there for a missing comma, quote or bracket.");
    expect(JSON.stringify(value)).not.toMatch(/SECRET|abc/);
  });
});
