/**
 * `galley plugin …` end to end with the real npm, offline: add from a local
 * folder and from a packed tarball, list, disable, enable, remove — and a
 * package that isn't a plugin refused.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { Io } from "../src/io";
import { main } from "../src/main";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-cli-plugin-")));

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function io(home: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const value: Io & { stdout: string[]; stderr: string[] } = {
    stdout,
    stderr,
    out: (line = "") => stdout.push(line),
    err: (line = "") => stderr.push(line),
    cwd: tmp,
    // npm's cache inside the test folder, and offline: nothing here may reach the network.
    env: { PATH: process.env.PATH, HOME: tmp, GALLEY_HOME: home, npm_config_cache: join(tmp, "npm-cache"), npm_config_offline: "true" },
    startServer: () => {
      throw new Error("not in this test");
    },
    openBrowser: async () => true,
    waitForStop: async () => {},
    watchParent: () => ({ gone: new Promise<void>(() => {}), stop: () => {} }),
  };

  return value;
}

/** A dependency-free plugin package on disk. */
function pluginFolder(name: string, version: string, options: { keyword?: boolean; broken?: boolean } = {}): string {
  const dir = join(tmp, "src", `${name}-${version}`);

  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version, type: "module", main: "index.mjs", ...(options.keyword === false ? {} : { keywords: ["galley-plugin"] }) }, null, 2)
  );
  writeFileSync(
    join(dir, "index.mjs"),
    options.broken
      ? `export default { name: ${JSON.stringify(name)}, apiVersion: 7 };\n`
      : `export default {
  name: ${JSON.stringify(name)},
  displayName: "Hello",
  version: ${JSON.stringify(version)},
  apiVersion: 1,
  scriptIntegrations: [{
    kind: "hello-widget", name: "Hello widget", description: "Says hello.", category: "support",
    defaultConsent: "preferences", defaultPlacement: "body-end", settings: [], snippet: { src: "https://cdn.hello.example/w.js" },
  }],
};
`
  );
  return dir;
}

const run = async (home: string, ...argv: string[]) => {
  const handle = io(home);
  const code = await main(["plugin", ...argv], handle);

  return { code, out: handle.stdout.join("\n"), err: handle.stderr.join("\n") };
};

describe("galley plugin", () => {
  it("adds from a folder, lists it, turns it off and on, and removes it", async () => {
    const home = join(tmp, "home-folder");
    const added = await run(home, "add", pluginFolder("galley-plugin-hello", "1.2.3"), "--json");

    expect(added.code, added.err).toBe(0);
    expect(JSON.parse(added.out).added).toMatchObject({ name: "galley-plugin-hello", version: "1.2.3" });
    expect(existsSync(join(home, "plugins", "node_modules", "galley-plugin-hello", "index.mjs"))).toBe(true);
    // Copied, not linked: the installed plugin doesn't change when its source folder does.
    expect(JSON.parse(readFileSync(join(home, "plugins", "package.json"), "utf8")).dependencies["galley-plugin-hello"]).toMatch(/^file:/);

    const listed = await run(home, "list", "--json");
    const names = JSON.parse(listed.out).plugins.map((p: { name: string; source: string; active: boolean }) => `${p.source}:${p.name}:${p.active}`);

    expect(names).toEqual(expect.arrayContaining(["builtin:@galley/builtin:true", "builtin:@galley/plugin-openrouter:true", "user:galley-plugin-hello:true"]));
    expect((await run(home, "list")).out).toContain("• galley-plugin-hello 1.2.3 — on, installed from");

    expect((await run(home, "disable", "galley-plugin-hello")).code).toBe(0);
    expect(JSON.parse((await run(home, "list", "--json")).out).plugins.find((p: { name: string }) => p.name === "galley-plugin-hello")).toMatchObject({ enabled: false, active: false });
    expect((await run(home, "disable", "@galley/builtin")).code).toBe(1);
    expect((await run(home, "disable", "@galley/plugin-openrouter")).code).toBe(0);
    expect((await run(home, "enable", "galley-plugin-hello")).code).toBe(0);
    expect(JSON.parse(readFileSync(join(home, "plugin-state.json"), "utf8"))).toEqual({ disabled: ["@galley/plugin-openrouter"] });

    const removed = await run(home, "remove", "galley-plugin-hello");

    expect(removed.code, removed.err).toBe(0);
    expect(existsSync(join(home, "plugins", "node_modules", "galley-plugin-hello"))).toBe(false);
    expect((await run(home, "remove", "galley-plugin-hello")).code).toBe(1);
  });

  it("adds from a packed tarball, pinned to the version inside it", async () => {
    const home = join(tmp, "home-tarball");
    const folder = pluginFolder("galley-plugin-hello", "2.0.1");
    const packed = execFileSync("npm", ["pack", "--silent", "--pack-destination", tmp], { cwd: folder, encoding: "utf8", env: io(home).env }).trim().split("\n").pop()!;
    const added = await run(home, "add", join(tmp, packed));

    expect(added.code, added.err).toBe(0);
    expect(added.out).toBe("✓ Added galley-plugin-hello 2.0.1. It loads the next time Galley starts.");
    expect(JSON.parse(readFileSync(join(home, "plugins", "installed.json"), "utf8")).plugins).toEqual([
      expect.objectContaining({ name: "galley-plugin-hello", version: "2.0.1", spec: join(tmp, packed) }),
    ]);
  });

  it("installs the example plugin exactly as docs/plugins.md says: `galley plugin add ./galley-plugin-example`", async () => {
    // A reader copies examples/plugin-example (as the docs say) to a folder of their own and adds it from there.
    const home = join(tmp, "home-example");
    const example = fileURLToPath(new URL("../../../examples/plugin-example", import.meta.url));
    const copy = join(tmp, "galley-plugin-example");

    cpSync(example, copy, { recursive: true, filter: (path) => !/[\\/]node_modules([\\/]|$)/.test(path) });
    const added = await run(home, "add", "./galley-plugin-example");

    expect(added.code, added.err).toBe(0);
    expect(added.out).toBe("✓ Added galley-plugin-example 0.1.0. It loads the next time Galley starts.");
    // Only the built plugin went in, and it needs nothing else to load.
    const installed = join(home, "plugins", "node_modules", "galley-plugin-example");

    expect(existsSync(join(installed, "dist", "index.js"))).toBe(true);
    expect(existsSync(join(installed, "src"))).toBe(false);
    expect(existsSync(join(installed, "node_modules"))).toBe(false);
    const listed = JSON.parse((await run(home, "list", "--json")).out).plugins.find((p: { name: string }) => p.name === "galley-plugin-example");

    expect(listed).toMatchObject({ source: "user", active: true, problems: [], contributes: expect.objectContaining({ scriptIntegrations: ["Fathom Analytics"], tools: [expect.objectContaining({ name: "count_words" })], hooks: ["afterPublish"] }) });
  });

  it("refuses a package that isn't a plugin, or isn't a working one, and leaves nothing behind", async () => {
    const home = join(tmp, "home-refused");
    const notPlugin = await run(home, "add", pluginFolder("left-pad-ish", "1.0.0", { keyword: false }));

    expect(notPlugin.code).toBe(1);
    expect(notPlugin.err).toContain("isn't a Galley plugin: its package.json needs the keyword \"galley-plugin\"");
    const broken = await run(home, "add", pluginFolder("galley-plugin-broken", "1.0.0", { broken: true }));

    expect(broken.code).toBe(1);
    expect(broken.err).toContain("isn't a working plugin, so it was removed again");
    expect(broken.err).toContain("plugin API version 7");
    expect(existsSync(join(home, "plugins", "node_modules", "galley-plugin-broken"))).toBe(false);
    expect((await run(home, "add")).code).toBe(2);
    expect((await run(home, "frobnicate")).code).toBe(2);
  });
});
