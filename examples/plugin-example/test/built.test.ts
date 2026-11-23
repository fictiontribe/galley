/**
 * The plugin is installed as built JavaScript (installing runs npm with
 * --ignore-scripts, and Node won't run TypeScript from node_modules), so the
 * folder ships dist/. These checks keep it honest: dist is exactly what src
 * builds to, and it imports nothing — it installs and loads anywhere.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const out = mkdtempSync(join(tmpdir(), "plugin-example-build-"));

afterAll(() => rmSync(out, { recursive: true, force: true }));

describe("the built plugin", () => {
  it("is exactly what src builds to (run `pnpm build` after changing src)", () => {
    const tsc = createRequire(join(here, "package.json")).resolve("typescript/bin/tsc");

    execFileSync(process.execPath, [tsc, "-p", join(here, "tsconfig.build.json"), "--outDir", out], { stdio: "pipe" });
    for (const file of readdirSync(out)) expect(readFileSync(join(here, "dist", file), "utf8"), `dist/${file}`).toBe(readFileSync(join(out, file), "utf8"));
  });

  it("imports nothing at run time and exports the plugin as its default", async () => {
    const code = readFileSync(join(here, "dist", "index.js"), "utf8");

    expect(code).not.toMatch(/^\s*import\s/m);
    const built = (await import(join(here, "dist", "index.js"))) as { default: { name: string; apiVersion: number } };

    expect(built.default).toMatchObject({ name: "galley-plugin-example", apiVersion: 1 });
  });
});
