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
import { galleyWeb, galleyWebAliases } from "../../vite.preset.mjs";

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

  it("the preset sets the two aliases the source is written with, and nothing else", async () => {
    expect(Object.keys(galleyWebAliases)).toEqual(["@", "@brand"]);
    expect(existsSync(join(galleyWebAliases["@"], "app", "App.tsx"))).toBe(true);
    expect(existsSync(join(galleyWebAliases["@brand"], "tokens.css"))).toBe(true);
    const plugin = galleyWeb() as { name: string; config(): unknown };

    expect(Object.keys(plugin)).toEqual(["name", "config"]);
    expect(plugin.config()).toEqual({ resolve: { alias: { ...galleyWebAliases } } });
    const resolved = await resolveConfig({ configFile: false, plugins: [galleyWeb()], logLevel: "silent" }, "build");

    expect(resolved.resolve.alias.filter((alias) => alias.find === "@" || alias.find === "@brand").map((alias) => alias.replacement)).toEqual([galleyWebAliases["@"], galleyWebAliases["@brand"]]);
  });
});

describe("the example edition", () => {
  it("builds with the package's entry points and the preset alone", async () => {
    const out = await mkdtemp(join(tmpdir(), "galley-edition-"));

    made.push(out);
    await build({ configFile: false, root: here("./example"), logLevel: "silent", plugins: [react(), galleyWeb()], build: { outDir: out, emptyOutDir: true, target: "es2023" } });
    const files = readdirSync(join(out, "assets"));
    const scripts = files.filter((file) => file.endsWith(".js")).map((file) => readFileSync(join(out, "assets", file), "utf8"));

    expect(existsSync(join(out, "index.html"))).toBe(true);
    expect(files.some((file) => file.endsWith(".css"))).toBe(true);
    // The app is in it, and so is the addition with its own route's address and its words.
    expect(scripts.some((script) => script.includes("/api/x/"))).toBe(true);
    expect(scripts.some((script) => script.includes("waiting to publish"))).toBe(true);
    expect(scripts.some((script) => script.includes("/api/events"))).toBe(true);
  }, 240_000);
});
