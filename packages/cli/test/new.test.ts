/**
 * `galley new` as people meet it: starters by name, the picker, the folder
 * rules, the package manager that ran it, and every sentence it stops with.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { RunningServer } from "@galley/server";
import { folderState, freeName, nextSteps, placeSite, siteName } from "../src/commands/new";
import type { Io } from "../src/io";
import { main } from "../src/main";
import { createCommandFor, invokingManager, runCommandFor } from "../src/package-manager";
import {
  folderNotEmpty,
  gitMissing,
  installFailed,
  installOffline,
  looksOffline,
  managerMissing,
  nodeTooOld,
  olderThan,
  registryHost,
  unknownStarter,
} from "../src/problems";
import { pickerKey, renderPicker, type PickerItem, type Prompter } from "../src/prompt";
import { findStarter, loadStarterChoices, minimumNode, shortList } from "../src/starter-choices";

const REPO_STARTERS = fileURLToPath(new URL("../../../starters", import.meta.url));
const tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-new-")));
const starters = join(tmp, "starters");

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function starter(id: string, manifest: Record<string, unknown>, pkg: Record<string, unknown> = {}) {
  mkdirSync(join(starters, id, "src/content/pages"), { recursive: true });
  mkdirSync(join(starters, id, "galley/sections"), { recursive: true });
  writeFileSync(join(starters, id, "package.json"), JSON.stringify({ name: id, private: true, ...pkg }, null, 2));
  writeFileSync(join(starters, id, "starter.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(starters, id, "src/content/pages/index.md"), "---\ntitle: Home\n---\nHello\n");
  writeFileSync(join(starters, id, "galley/sections/hero.webp"), "");
}

starter("astro-plain", { name: "Plain — small business", short: "plain", summary: "A plain site" });
starter("astro-shop", { name: "Shop — storefront", short: "shop", summary: "A shop" }, { engines: { node: ">=22.23.4" } });
// "lowfield" is the default the CLI falls back to.
starter("astro-low", { name: "Lowfield — small business", short: "lowfield", summary: "A site for a small studio" });

interface TestIo extends Io {
  stdout: string[];
  stderr: string[];
}

function testIo(overrides: Partial<Io> = {}): TestIo {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    out: (line = "") => stdout.push(line),
    err: (line = "") => stderr.push(line),
    cwd: tmp,
    env: { PATH: process.env.PATH, HOME: tmp, GALLEY_HOME: join(tmp, "home"), GALLEY_STARTERS_DIR: starters },
    startServer: () => {
      throw new Error("startServer not faked");
    },
    openBrowser: async () => true,
    waitForStop: async () => {},
    watchParent: () => ({ gone: new Promise<void>(() => {}), stop: () => {} }),
    ...overrides,
  };
}

/** A person at the keyboard who answers from a script. */
function scripted(answers: { name?: string | null; pick?: number | null }): Prompter & { asked: string[]; shown: PickerItem[][] } {
  const asked: string[] = [];
  const shown: PickerItem[][] = [];

  return {
    asked,
    shown,
    async text(question, fallback) {
      asked.push(`${question} (${fallback})`);
      return answers.name === undefined ? fallback : answers.name;
    },
    async choose(title, items, initial) {
      asked.push(`${title} [${initial}]`);
      shown.push(items);
      return answers.pick === undefined ? (initial ?? 0) : answers.pick;
    },
  };
}

describe("starters by name", () => {
  it("each real starter declares a short name and a one-line summary", async () => {
    const choices = await loadStarterChoices(REPO_STARTERS);

    expect(choices.map((choice) => choice.short)).toEqual(["lowfield", "caddow", "ferrow", "storefront"]);
    expect(Object.fromEntries(choices.map((choice) => [choice.short, choice.id]))).toEqual({
      lowfield: "astro-starter",
      caddow: "astro-editorial",
      ferrow: "astro-saas",
      storefront: "astro-storefront",
    });
    for (const choice of choices) {
      expect(choice.summary).not.toMatch(/\.$|\n/);
      expect(choice.inside).toMatch(/^\d+ sections · \d+ page templates · 3 looks$/);
      expect(choice.node).toBe("22.23.4");
    }
  });

  it("finds a starter by its name or its folder, in any case", async () => {
    const choices = await loadStarterChoices(REPO_STARTERS);

    expect(findStarter(choices, "Caddow")?.id).toBe("astro-editorial");
    expect(findStarter(choices, "astro-editorial")?.short).toBe("caddow");
    expect(findStarter(choices, "fashion")).toBeNull();
    expect(shortList(choices)).toBe("caddow, ferrow, lowfield or storefront");
  });

  it("reads the lowest Node version a starter accepts", () => {
    expect(minimumNode(">=22.23.4")).toBe("22.23.4");
    expect(minimumNode("^22.12 || >=24")).toBe("22.12.0");
    expect(minimumNode(undefined)).toBeNull();
  });

  it("`galley starters` gives the exact command for each, in the manager that ran it", async () => {
    const io = testIo({ env: { PATH: process.env.PATH, HOME: tmp, GALLEY_STARTERS_DIR: REPO_STARTERS } });

    expect(await main(["starters"], io)).toBe(0);
    expect(io.stdout.slice(0, 4)).toEqual([
      "lowfield: Lowfield — small business (the default)",
      "  A site for a small studio or local business",
      "  17 sections · 5 page templates · looks: lowfield (default), sage, evening",
      "  npm create galley@latest my-site -- --starter lowfield",
    ]);
    expect(io.stdout).toContain("  npm create galley@latest my-site -- --starter caddow");
    expect(io.stdout.at(-1)).toBe("To open a site you made before, run `npx galley-cms` in its folder.");
    const pnpm = testIo({ env: { PATH: process.env.PATH, HOME: tmp, GALLEY_STARTERS_DIR: REPO_STARTERS, npm_config_user_agent: "pnpm/10.15.0 npm/? node/v22.23.4 darwin arm64" } });

    expect(await main(["starters"], pnpm)).toBe(0);
    expect(pnpm.stdout).toContain("  pnpm create galley my-site --starter ferrow");
    expect(pnpm.stdout.at(-1)).toBe("To open a site you made before, run `pnpm dlx galley-cms` in its folder.");
  });
});

describe("the picker", () => {
  const items: PickerItem[] = [
    { label: "Lowfield", summary: "A site for a small studio", detail: "17 sections · 5 page templates · 3 looks" },
    { label: "Caddow", summary: "A photography-led site", detail: "20 sections · 6 page templates · 3 looks" },
    { label: "Ferrow", summary: "A software company's site", detail: "29 sections · 7 page templates · 3 looks" },
  ];

  it("moves with the arrows (and j/k), wrapping round", () => {
    expect(pickerKey(0, 3, { name: "down" })).toEqual({ index: 1 });
    expect(pickerKey(2, 3, { name: "down" })).toEqual({ index: 0 });
    expect(pickerKey(0, 3, { name: "up" })).toEqual({ index: 2 });
    expect(pickerKey(1, 3, { name: "k" })).toEqual({ index: 0 });
    expect(pickerKey(1, 3, { name: "j" })).toEqual({ index: 2 });
    expect(pickerKey(1, 3, { name: "tab" })).toEqual({ index: 2 });
    expect(pickerKey(1, 3, { name: "x", sequence: "x" })).toEqual({ index: 1 });
  });

  it("chooses with Enter or a number, and stops with Esc or Ctrl+C", () => {
    expect(pickerKey(2, 3, { name: "return" })).toEqual({ index: 2, done: "chosen" });
    expect(pickerKey(0, 3, { sequence: "2" })).toEqual({ index: 1, done: "chosen" });
    expect(pickerKey(0, 3, { sequence: "9" })).toEqual({ index: 0 });
    expect(pickerKey(1, 3, { name: "escape" }).done).toBe("cancelled");
    expect(pickerKey(1, 3, { name: "c", ctrl: true }).done).toBe("cancelled");
  });

  it("shows each starter's name, one line and what is inside, the current one marked", () => {
    expect(renderPicker("Which starter?", items, 1)).toEqual([
      "Which starter?",
      "↑ ↓ to move, Enter to choose, Esc to stop",
      "",
      "  Lowfield  A site for a small studio",
      "            17 sections · 5 page templates · 3 looks",
      "› Caddow    A photography-led site",
      "            20 sections · 6 page templates · 3 looks",
      "  Ferrow    A software company's site",
      "            29 sections · 7 page templates · 3 looks",
    ]);
  });
});

describe("the folder", () => {
  it("is named after the site, or is the path given", () => {
    expect(placeSite("/work", undefined, "Harbour Notes")).toEqual({ name: "Harbour Notes", target: "/work/harbour-notes" });
    expect(placeSite("/work", undefined, "my-site")).toEqual({ name: "My site", target: "/work/my-site" });
    expect(placeSite("/work", "sites", "Tide")).toEqual({ name: "Tide", target: "/work/sites/tide" });
    expect(placeSite("/work/shop", undefined, ".")).toEqual({ name: "Shop", target: "/work/shop" });
    expect(placeSite("/work", undefined, "clients/caddow-shop")).toEqual({ name: "Caddow shop", target: "/work/clients/caddow-shop" });
    expect(placeSite("/work", undefined, "~/sites/tide")).toEqual({ name: "Tide", target: join(homedir(), "sites/tide") });
  });

  it("turns a folder-style name into words, and keeps a typed one", () => {
    expect(siteName("my-site")).toBe("My site");
    expect(siteName("caddow_shop")).toBe("Caddow shop");
    expect(siteName("Caddow")).toBe("Caddow");
    expect(siteName("Tide & Co")).toBe("Tide & Co");
  });

  it("knows free, empty, full and file, and suggests the next free name", () => {
    const parent = join(tmp, "folders");

    mkdirSync(join(parent, "my-site"), { recursive: true });
    writeFileSync(join(parent, "my-site", "a.txt"), "");
    mkdirSync(join(parent, "my-site-2"), { recursive: true });
    writeFileSync(join(parent, "notes"), "");
    expect(folderState(join(parent, "nothing"))).toBe("free");
    expect(folderState(join(parent, "my-site-2"))).toBe("empty");
    expect(folderState(join(parent, "my-site"))).toBe("full");
    expect(folderState(join(parent, "notes"))).toBe("file");
    expect(freeName(parent, "my-site")).toBe("my-site-2");
    expect(freeName(parent, "other")).toBe("other");
  });
});

describe("the package manager", () => {
  it.each([
    ["npm/10.9.2 node/v22.23.4 darwin arm64 workspaces/false", "npm"],
    ["pnpm/10.15.0 npm/? node/v22.23.4 darwin arm64", "pnpm"],
    ["yarn/1.22.22 npm/? node/v22.23.4 darwin arm64", "yarn"],
    ["yarn/4.5.0 npm/? node/v22.23.4 linux x64", "yarn"],
    ["bun/1.1.17 npm/? node/v22.3.0 darwin arm64", "bun"],
    ["deno/2.0.0", null],
    ["", null],
  ])("%s → %s", (agent, manager) => {
    expect(invokingManager({ npm_config_user_agent: agent })).toBe(manager);
  });

  it("names the right commands for each", () => {
    expect(createCommandFor("npm", "my-site", "caddow")).toBe("npm create galley@latest my-site -- --starter caddow");
    expect(createCommandFor(null, "my-site", "caddow")).toBe("npm create galley@latest my-site -- --starter caddow");
    expect(createCommandFor("pnpm", "my-site", "caddow")).toBe("pnpm create galley my-site --starter caddow");
    expect(createCommandFor("yarn", "my-site", "caddow")).toBe("yarn create galley my-site --starter caddow");
    expect(createCommandFor("bun", "my-site", "caddow")).toBe("bun create galley my-site --starter caddow");
    expect(runCommandFor("npm")).toBe("npx galley-cms");
    expect(runCommandFor("yarn")).toBe("npx galley-cms");
    expect(runCommandFor("pnpm")).toBe("pnpm dlx galley-cms");
    expect(runCommandFor("bun")).toBe("bunx galley-cms");
  });
});

describe("the sentences it stops with", () => {
  it("each says what happened and the one thing to do", () => {
    expect(nodeTooOld("Caddow", "22.23.4", "v20.11.1")).toBe(
      "Caddow needs Node 22.23.4 or newer, and this computer has Node 20.11.1. Install the current LTS version from https://nodejs.org, then run the same command again."
    );
    expect(gitMissing("darwin")).toBe(
      "A new site keeps its versions with git, and git isn't installed on this computer. Install it with `xcode-select --install` (or from https://git-scm.com/downloads), then run the same command again."
    );
    expect(gitMissing("win32")).toContain("Install it from https://git-scm.com/downloads, then run the same command again.");
    expect(gitMissing("linux")).toContain("`sudo apt install git`");
    expect(folderNotEmpty("my-site", "my-site-2")).toBe(
      "my-site already has files in it, and a new site needs an empty folder, so nothing was copied. Choose another name — for example my-site-2 — or empty that folder first."
    );
    expect(unknownStarter("fashion", "caddow, ferrow, lowfield or storefront")).toBe(
      "There's no starter called “fashion”. Choose caddow, ferrow, lowfield or storefront, or run `galley starters` to see what each one is."
    );
    expect(managerMissing("bun")).toBe(
      "bun isn't installed on this computer, so the site's dependencies couldn't be installed. Install bun (https://bun.sh), or choose another with --use npm."
    );
    expect(installOffline("npm", "registry.npmjs.org", "my-site", "npx galley-cms")).toBe(
      "Couldn't download the site's dependencies: registry.npmjs.org can't be reached, so this computer looks offline. The site is ready in my-site, with its first version recorded. When you're online again, run `npm install` in that folder, then `npx galley-cms`."
    );
    expect(installFailed("pnpm", "my-site", "pnpm dlx galley-cms")).toContain("Run `pnpm install` in that folder to try again, then `pnpm dlx galley-cms`.");
    expect(registryHost({ npm_config_registry: "http://127.0.0.1:4789/" })).toBe("127.0.0.1:4789");
    expect(registryHost({})).toBe("registry.npmjs.org");
  });

  it("recognises being offline in each manager's words", () => {
    expect(looksOffline("npm error code ECONNREFUSED\nnpm error syscall connect")).toBe(true);
    expect(looksOffline("npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org/astro failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org")).toBe(true);
    expect(looksOffline(" ERR_PNPM_META_FETCH_FAIL  GET https://registry.npmjs.org/astro: request to https://registry.npmjs.org/astro failed")).toBe(true);
    expect(looksOffline("info There appears to be trouble with your network connection. Retrying...")).toBe(true);
    expect(looksOffline("error: ConnectionRefused downloading package manifest astro")).toBe(true);
    expect(looksOffline("npm error code ERESOLVE\nnpm error ERESOLVE unable to resolve dependency tree")).toBe(false);
  });

  it("compares versions", () => {
    expect(olderThan("20.11.1", "22.23.4")).toBe(true);
    expect(olderThan("22.23.4", "22.23.4")).toBe(false);
    expect(olderThan("23.6.1", "22.23.4")).toBe(false);
    expect(olderThan("v22.9.0", "22.23.4")).toBe(true);
  });

  it("ends with three next steps and how to come back", () => {
    expect(nextSteps("my-site", "npx galley-cms", true)).toEqual([
      "",
      "Next",
      "  1. Change something: edit a page in its form or on the page, or ask the assistant.",
      "  2. Check it in Proof, beside the live site.",
      "  3. Publish when it looks right.",
      "",
      "To come back to it later: cd my-site, then npx galley-cms",
    ]);
    expect(nextSteps("My Sites/shop", "npx galley-cms", false, "npm install").at(-1)).toBe('To start Galley on it: cd "My Sites/shop", then npm install, then npx galley-cms');
  });
});

describe("galley new, start to finish", () => {
  it("asks for the name and the starter in a terminal, then makes the site", async () => {
    const ask = scripted({ name: "Tide Tables", pick: 2 });
    const io = testIo({ ask });

    expect(await main(["new", "--no-start", "--no-install"], io)).toBe(0);
    expect(ask.asked).toEqual(["What should the site be called? (my-site)", "Which starter? [0]"]);
    expect(ask.shown[0]!.map((item) => item.label)).toEqual(["Lowfield", "Plain", "Shop"]);
    expect(ask.shown[0]![0]!.detail).toBe("1 section");
    const target = join(tmp, "tide-tables");

    expect(JSON.parse(readFileSync(join(target, "package.json"), "utf8")).name).toBe("tide-tables");
    expect(readFileSync(join(target, "src/content/pages/index.md"), "utf8")).toContain("Hello");
    expect(io.stdout[0]).toBe("Making “Tide Tables” from Shop in tide-tables");
    expect(execFileSync("git", ["log", "--format=%s"], { cwd: target, encoding: "utf8" })).toContain("Tide Tables");
    expect(io.stdout.at(-1)).toBe("To start Galley on it: cd tide-tables, then npm install, then npx galley-cms");
  });

  it("asks again when the folder for the name is taken", async () => {
    mkdirSync(join(tmp, "busy"), { recursive: true });
    writeFileSync(join(tmp, "busy", "x"), "");
    const answers = ["busy", "Quiet"];
    const ask: Prompter = {
      text: async () => answers.shift() ?? null,
      choose: async () => 0,
    };
    const io = testIo({ ask });

    expect(await main(["new", "--no-start", "--no-install"], io)).toBe(0);
    expect(io.stderr).toEqual(["busy already has files in it, and a new site needs an empty folder, so nothing was copied. Choose another name — for example busy-2 — or empty that folder first."]);
    expect(existsSync(join(tmp, "quiet", "package.json"))).toBe(true);
  });

  it("stops without making anything when the person cancels", async () => {
    const io = testIo({ ask: scripted({ name: "Never", pick: null }) });

    expect(await main(["new", "--no-start", "--no-install"], io)).toBe(130);
    expect(io.stderr).toEqual(["Stopped. Nothing was created."]);
    expect(existsSync(join(tmp, "never"))).toBe(false);
  });

  it("without a terminal, uses the default name and starter, and says so", async () => {
    const cwd = join(tmp, "quiet-run");

    mkdirSync(cwd, { recursive: true });
    const io = testIo({ cwd });

    expect(await main(["new", "--no-start", "--no-install"], io)).toBe(0);
    expect(io.stdout.slice(0, 3)).toEqual([
      "No name given, so the site is called “My site”, in my-site.",
      "No starter chosen, so this uses Lowfield: a site for a small studio. For another, add --starter plain or shop.",
      "Making “My site” from Lowfield in my-site",
    ]);
    expect(existsSync(join(cwd, "my-site", "package.json"))).toBe(true);
  });

  it("takes a starter's short name or its folder", async () => {
    const short = testIo();
    const folder = testIo();

    expect(await main(["new", "By Name", "--starter", "plain", "--no-start", "--no-install"], short)).toBe(0);
    expect(await main(["new", "By Folder", "--starter", "astro-plain", "--no-start", "--no-install"], folder)).toBe(0);
    expect(short.stdout[0]).toBe("Making “By Name” from Plain in by-name");
    expect(folder.stdout[0]).toBe("Making “By Folder” from Plain in by-folder");
  });

  it("refuses a Node older than the starter needs, before copying anything", async () => {
    const io = testIo({ nodeVersion: "20.11.1" });

    expect(await main(["new", "Old Node", "--starter", "shop", "--no-start"], io)).toBe(1);
    expect(io.stderr).toEqual(["Shop needs Node 22.23.4 or newer, and this computer has Node 20.11.1. Install the current LTS version from https://nodejs.org, then run the same command again."]);
    expect(existsSync(join(tmp, "old-node"))).toBe(false);
  });

  it("refuses to start without git, saying how to get it", async () => {
    const io = testIo({ env: { PATH: join(tmp, "empty-bin"), HOME: tmp, GALLEY_STARTERS_DIR: starters }, platform: "darwin" });

    expect(await main(["new", "No Git", "--starter", "plain", "--no-start"], io)).toBe(1);
    expect(io.stderr).toEqual([gitMissing("darwin")]);
    expect(existsSync(join(tmp, "no-git"))).toBe(false);
  });

  it("refuses a package manager that isn't installed, before copying anything", async () => {
    const bin = join(tmp, "git-only-bin");
    const git = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();

    mkdirSync(bin, { recursive: true });
    symlinkSync(git, join(bin, "git"));
    const io = testIo({ env: { PATH: bin, HOME: tmp, GALLEY_STARTERS_DIR: starters } });

    expect(await main(["new", "No Bun", "--starter", "plain", "--use", "bun"], io)).toBe(1);
    expect(io.stderr).toEqual([managerMissing("bun")]);
    expect(existsSync(join(tmp, "no-bun"))).toBe(false);
  });

  it("says plainly when the dependencies can't be downloaded, and keeps the site", async () => {
    // A starter with one dependency, and a registry nobody answers on.
    starter("astro-deps", { name: "Deps", short: "deps", summary: "Needs a download" }, { dependencies: { "left-pad": "1.3.0" } });
    const saved = { registry: process.env.npm_config_registry, retries: process.env.npm_config_fetch_retries, cache: process.env.npm_config_cache };

    process.env.npm_config_registry = "http://127.0.0.1:4789/";
    process.env.npm_config_fetch_retries = "0";
    process.env.npm_config_cache = join(tmp, "npm-cache");
    try {
      const io = testIo({ env: { PATH: process.env.PATH, HOME: tmp, GALLEY_STARTERS_DIR: starters, npm_config_registry: "http://127.0.0.1:4789/" } });

      expect(await main(["new", "Offline", "--starter", "deps", "--use", "npm"], io)).toBe(1);
      expect(io.stderr.at(-1)).toBe(
        "Couldn't download the site's dependencies: 127.0.0.1:4789 can't be reached, so this computer looks offline. The site is ready in offline, with its first version recorded. When you're online again, run `npm install` in that folder, then `npx galley-cms`."
      );
      expect(execFileSync("git", ["log", "--format=%s"], { cwd: join(tmp, "offline"), encoding: "utf8" })).toContain("Offline");
    } finally {
      for (const [key, name] of [["registry", "npm_config_registry"], ["retries", "npm_config_fetch_retries"], ["cache", "npm_config_cache"]] as const) {
        if (saved[key] === undefined) delete process.env[name];
        else process.env[name] = saved[key];
      }
    }
  }, 120_000);

  it("starts Galley on the new site and prints the next steps before waiting", async () => {
    const calls: string[] = [];
    const fakeServer = {
      url: "http://127.0.0.1:4780",
      openUrl: (path: string) => `http://127.0.0.1:4780${path}?token=t`,
      close: async () => void calls.push("close"),
      services: { registry: { open: async () => ({ id: "s1", model: async () => ({ name: "Running" }) }) } },
    } as unknown as RunningServer;
    const io = testIo({
      startServer: async (options) => {
        calls.push(`start ${options?.port}`);
        return fakeServer;
      },
      openBrowser: async (url) => {
        calls.push(`open ${url}`);
        return true;
      },
      waitForStop: async () => void calls.push("wait"),
    });

    // No dependencies to install in this starter, so installing is quick and real.
    expect(await main(["new", "Running", "--starter", "plain", "--use", "npm", "--port", "4780"], io)).toBe(0);
    expect(calls).toEqual(["start 4780", "open http://127.0.0.1:4780/sites/s1?token=t", "wait", "close"]);
    const out = io.stdout.join("\n");

    expect(out).toMatch(/✓ Installed dependencies with npm \(\d+s\)/);
    expect(out).toContain("✓ Recorded the first version");
    expect(out).toContain("Next\n  1. Change something");
    expect(out).toContain("To come back to it later: cd running, then npx galley-cms\n\nPress Ctrl+C to stop.");
    // The lock file is part of the first version: nothing is pending.
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: join(tmp, "running"), encoding: "utf8" })).toBe("");
  }, 120_000);
});
