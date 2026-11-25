/**
 * Building an edition of the editor outside the app's own entry: the entry
 * points the package gives, the Vite preset with the two aliases the source
 * is written with, and the docs' example really built with both.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { build, resolveConfig } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { galleyWeb, galleyWebAliases, galleyWebDedupe, galleyWebPublicDir, galleyWebTarget } from "../../vite.preset.mjs";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const made: string[] = [];

afterAll(async () => {
  for (const folder of made) await rm(folder, { recursive: true, force: true });
});

describe("the web package's entry points", () => {
  it("are the app, what an addition leans on, the interface kit, the styles and the preset, each a file that is there", () => {
    const manifest = JSON.parse(readFileSync(here("../../package.json"), "utf8")) as { exports: Record<string, string | Record<string, string>> };

    expect(Object.keys(manifest.exports)).toEqual(["./app", "./additions", "./ui", "./styles", "./vite", "./package.json"]);
    for (const target of Object.values(manifest.exports).flatMap((entry) => (typeof entry === "string" ? [entry] : Object.values(entry)))) expect(existsSync(here(`../../${target}`)), target).toBe(true);
  });

  it("the preset sets the two aliases, one copy of React and the router, and the app's public folder and build target where the program names none", async () => {
    expect(Object.keys(galleyWebAliases)).toEqual(["@", "@brand"]);
    expect(existsSync(join(galleyWebAliases["@"], "app", "App.tsx"))).toBe(true);
    expect(existsSync(join(galleyWebAliases["@brand"], "tokens.css"))).toBe(true);
    expect(existsSync(join(galleyWebPublicDir, "theme.js"))).toBe(true);
    const plugin = galleyWeb();

    expect(Object.keys(plugin)).toEqual(["name", "config"]);
    expect(plugin.config()).toEqual({ resolve: { alias: { ...galleyWebAliases }, dedupe: ["react", "react-dom", "react-router-dom"] }, publicDir: galleyWebPublicDir, build: { target: "es2023" } });
    // What the program's own config says about either is left as it is, "no public folder" included.
    expect(plugin.config({ publicDir: "/somewhere/else", build: { target: "es2022" } })).toEqual({ resolve: { alias: { ...galleyWebAliases }, dedupe: [...galleyWebDedupe] } });
    expect(plugin.config({ publicDir: false })).toEqual({ resolve: { alias: { ...galleyWebAliases }, dedupe: [...galleyWebDedupe] }, build: { target: galleyWebTarget } });
    const resolved = await resolveConfig({ configFile: false, plugins: [galleyWeb()], logLevel: "silent" }, "build");

    expect(resolved.resolve.alias.filter((alias) => alias.find === "@" || alias.find === "@brand").map((alias) => alias.replacement)).toEqual([galleyWebAliases["@"], galleyWebAliases["@brand"]]);
    expect([resolved.publicDir, resolved.build.target, resolved.resolve.dedupe]).toEqual([galleyWebPublicDir, "es2023", [...galleyWebDedupe]]);
    const named = await resolveConfig({ configFile: false, plugins: [galleyWeb()], publicDir: here("./example"), build: { target: "es2022" }, logLevel: "silent" }, "build");

    expect([named.publicDir, named.build.target]).toEqual([here("./example").replace(/\/$/, ""), "es2022"]);
  });

  it("the app's own builds are as they were: its public folder and target, and the demo's own public folder", async () => {
    const product = await resolveConfig({ configFile: here("../../vite.config.ts"), logLevel: "silent" }, "build");

    expect([product.publicDir, product.build.target]).toEqual([galleyWebPublicDir, "es2023"]);
    const demo = await resolveConfig({ configFile: here("../../vite.demo.config.ts"), logLevel: "silent" }, "build");

    expect(demo.publicDir).toBe(here("../../demo/.work/public"));
    expect(demo.build.target).toBe("es2023");
  });
});

describe("the example edition", () => {
  it("starts from the app's own page: the same shell, with its own entry file", () => {
    const app = readFileSync(here("../../index.html"), "utf8");
    const example = readFileSync(here("./example/index.html"), "utf8");

    // What the app's styles and its theme lean on: without these an edition is drawn without the app's base styles or its surfaces.
    for (const needed of ['data-surfaces="app"', 'data-theme="system"', 'class="g-root"', '<script src="/theme.js"></script>', 'name="color-scheme"']) expect(app, needed).toContain(needed);
    expect(example).toBe(app.replace('src="/src/main.tsx"', 'src="./main.tsx"'));
  });

  it("builds with the package's entry points and the preset alone", async () => {
    const out = await mkdtemp(join(tmpdir(), "galley-edition-"));

    made.push(out);
    await build({ configFile: false, root: here("./example"), logLevel: "silent", plugins: [react(), galleyWeb()], build: { outDir: out, emptyOutDir: true } });
    const files = readdirSync(join(out, "assets"));
    const scripts = files.filter((file) => file.endsWith(".js")).map((file) => readFileSync(join(out, "assets", file), "utf8"));

    const page = readFileSync(join(out, "index.html"), "utf8");

    // The app's shell, and the file that paints the saved theme before the page loads: the server serves it from this folder.
    for (const kept of ['data-surfaces="app"', 'class="g-root"', '<script src="/theme.js"></script>']) expect(page, kept).toContain(kept);
    expect(readFileSync(join(out, "theme.js"), "utf8")).toBe(readFileSync(join(galleyWebPublicDir, "theme.js"), "utf8"));
    expect(files.some((file) => file.endsWith(".css"))).toBe(true);
    // The app is in it, and so is the addition with its own route's address and its words.
    expect(scripts.some((script) => script.includes("/api/x/"))).toBe(true);
    expect(scripts.some((script) => script.includes("waiting to publish"))).toBe(true);
    expect(scripts.some((script) => script.includes("/api/events"))).toBe(true);
  }, 240_000);
});
