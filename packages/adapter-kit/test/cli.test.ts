import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { main } from "../src/cli";

const root = mkdtempSync(join(tmpdir(), "kit-cli-"));

afterAll(() => rmSync(root, { recursive: true, force: true }));

const fixture = join(root, "site");

mkdirSync(join(fixture, "content/posts"), { recursive: true });
writeFileSync(join(fixture, "quay.toml"), "");
writeFileSync(join(fixture, "content/posts/a.md"), "---\ntitle: A\n---\n");
writeFileSync(join(fixture, "content/posts/b.md"), "---\ntitle: B\n---\n");
writeFileSync(
  join(root, "good.mjs"),
  'export default { id: "quay", name: "Quay", detect: (ctx) => (ctx.exists("quay.toml") ? { confidence: 0.9 } : null), conventions: () => ({ dev: { command: "quay serve", port: 7000 }, build: { command: "quay build", outDir: "out" }, contentDirs: ["content"] }) };\n'
);
writeFileSync(join(root, "greedy.mjs"), 'export const adapter = { id: "greedy", name: "Greedy", detect: () => ({ confidence: 1 }) };\n');

async function run(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await main(args, (text) => (out += text), (text) => (err += text));

  return { code, out, err };
}

describe("galley-adapter-check", () => {
  it("exits 0 and prints the report when every check passes", async () => {
    const result = await run(join(root, "good.mjs"), fixture);

    expect(result.code).toBe(0);
    expect(result.out).toMatch(/^Quay adapter — .*\n\nok {4}Is a well-formed adapter object/);
    expect(result.out).toMatch(/All 16 checks passed\.\n$/);
  });

  it("exits 1 when a check fails, saying what to fix", async () => {
    const result = await run(join(root, "greedy.mjs"), fixture);

    expect(result.code).toBe(1);
    expect(result.out).toMatch(/FAIL {2}Does not claim sites that are not its own\n {6}it claimed a plain folder of markdown notes/);
    expect(result.out).toMatch(/\d+ checks? failed/);
  });

  it("exits 2 with usage when it cannot run", async () => {
    expect((await run()).code).toBe(2);
    expect((await run()).err).toMatch(/^Usage: galley-adapter-check <adapter-file> <fixture-dir>/);
    expect(await run(join(root, "missing.mjs"), fixture)).toMatchObject({ code: 2, err: expect.stringMatching(/was not found/) });
    expect(await run(join(root, "good.mjs"), join(root, "nowhere"))).toMatchObject({ code: 2, err: expect.stringMatching(/The fixture folder .* was not found/) });
    expect((await run("--help")).code).toBe(0);
  });
});
