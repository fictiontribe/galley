import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { RunningServer } from "@galley/server";
import { nodeCheck, remoteHost } from "../src/commands/doctor";
import type { Io } from "../src/io";
import { HELP, main, route } from "../src/main";
import { shownPath } from "../src/commands/new";

const fixture = fileURLToPath(new URL("../../core/test/fixtures/astro-site", import.meta.url));
const tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-cli-")));

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

interface TestIo extends Io {
  stdout: string[];
  stderr: string[];
  opened: string[];
}

function testIo(overrides: Partial<Io> = {}): TestIo {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const opened: string[] = [];

  return {
    stdout,
    stderr,
    opened,
    out: (line = "") => stdout.push(line),
    err: (line = "") => stderr.push(line),
    cwd: tmp,
    env: { PATH: process.env.PATH, HOME: tmp, GALLEY_HOME: join(tmp, "home") },
    startServer: () => {
      throw new Error("startServer not faked");
    },
    openBrowser: async (url) => {
      opened.push(url);
      return true;
    },
    waitForStop: async () => {},
    watchParent: () => ({ gone: new Promise<void>(() => {}), stop: () => {} }),
    ...overrides,
  };
}

function copyFixture(name: string): string {
  const target = join(tmp, name);

  cpSync(fixture, target, { recursive: true });
  return target;
}

describe("argument routing", () => {
  it.each([
    [[], "open", []],
    [["serve", "--port", "5000"], "serve", ["--port", "5000"]],
    [["./serve"], "open", ["./serve"]],
    [["my-site", "--no-open"], "open", ["my-site", "--no-open"]],
    [["--help"], "help", []],
    [["help"], "help", []],
    [["--version"], "version", []],
    [["new", "x"], "new", ["x"]],
  ] as const)("%j → %s", (argv, name, args) => {
    expect(route([...argv])).toEqual({ name, args: [...args] });
  });

  it("prints the main help", async () => {
    const io = testIo();

    expect(await main(["--help"], io)).toBe(0);
    expect(io.stdout.join("\n")).toBe(HELP);
    expect(HELP).toContain("galley new <name>");
  });

  it.each(["serve", "init", "doctor", "new", "version"])("%s --help", async (command) => {
    const io = testIo();

    expect(await main([command, "--help"], io)).toBe(0);
    expect(io.stdout.join("\n")).toMatch(new RegExp(`^Usage: galley ${command}`));
  });

  it("galley <path> --help is the open command's help", async () => {
    const io = testIo();

    expect(await main([".", "--help"], io)).toBe(0);
    expect(io.stdout[0]).toMatch(/^Usage: galley \[path\]/);
  });

  it.each([
    [["init", "--bogus"], /--bogus isn't an option here/],
    [["doctor", "a", "b"], /Too many arguments/],
    [["new"], /Name the new site/],
    [[".", "--port", "eighty"], /--port must be a number/],
    [["serve", "--port"], /--port needs a value/],
    [["version", "--wat"], /isn't an option/],
  ])("%j is a usage error (exit 2)", async (argv, message) => {
    const io = testIo();

    expect(await main(argv, io)).toBe(2);
    expect(io.stderr.join("\n")).toMatch(message);
  });

  it("version prints the version, and JSON with --json", async () => {
    const io = testIo();

    expect(await main(["version"], io)).toBe(0);
    expect(io.stdout[0]).toMatch(/^galley \d+\.\d+\.\d+/);
    expect(await main(["--version", "--json"], io)).toBe(0);
    expect(JSON.parse(io.stdout[1]!)).toMatchObject({ name: "galley" });
  });
});

describe("galley schema", () => {
  it("prints the config's JSON Schema, with the address editors fetch it from", async () => {
    const io = testIo();

    expect(await main(["schema"], io)).toBe(0);
    const schema = JSON.parse(io.stdout.join("\n")) as { $id: string; properties: Record<string, unknown> };

    expect(schema.$id).toBe("https://galley.fictiontribe.com/schema/galley.config.json");
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(["collections", "templates"]));
    expect(await main(["schema", "extra"], testIo())).toBe(2);
  });

  it("writes every schema the app's files name into a folder, and says where each must be served", async () => {
    const out = mkdtempSync(join(tmpdir(), "galley-schemas-"));
    const io = testIo({ cwd: out });

    try {
      expect(await main(["schema", "--out", "site-public/schema"], io)).toBe(0);
      const config = JSON.parse(readFileSync(join(out, "site-public/schema/galley.config.json"), "utf8")) as { $id: string };
      const brand = JSON.parse(readFileSync(join(out, "site-public/schema/brand.json"), "utf8")) as { $id: string; properties: Record<string, unknown> };

      expect(config.$id).toBe("https://galley.fictiontribe.com/schema/galley.config.json");
      expect(brand.$id).toBe("https://galley.fictiontribe.com/schema/brand.json");
      expect(Object.keys(brand.properties)).toEqual(expect.arrayContaining(["$schema", "colors", "typography"]));
      const said = io.stdout.join("\n");

      expect(said).toContain("→ https://galley.fictiontribe.com/schema/galley.config.json");
      expect(said).toContain("→ https://galley.fictiontribe.com/schema/brand.json");
      expect(said).toContain(join(out, "site-public/schema/brand.json"));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe("galley init", () => {
  it("writes galley.config.json with name, collections and their urls, and prints what it found", async () => {
    const site = copyFixture("init-site");
    const io = testIo({ cwd: site });

    expect(await main(["init"], io)).toBe(0);
    const config = JSON.parse(readFileSync(join(site, "galley.config.json"), "utf8"));

    // One constant, the planned public address the docs site serves from `galley schema`.
    expect(config.$schema).toBe("https://galley.fictiontribe.com/schema/galley.config.json");
    expect(typeof config.name).toBe("string");
    expect(config.collections.map((collection: { id: string }) => collection.id)).toEqual(["blog", "pages", "guides", "authors", "navigation"]);
    expect(config.collections[0]).toEqual({ id: "blog", label: "Blog posts", url: "/blog/{slug}/" });
    expect(Object.keys(config).sort()).toEqual(expect.arrayContaining(["$schema", "collections", "name"]));
    expect(config).not.toHaveProperty("writable");
    const output = io.stdout.join("\n");

    expect(output).toContain("✓ Astro");
    expect(output).toContain("✓ 5 collections: blog (3), pages (3), guides (2), authors (data), navigation (data)");
    expect(output).toContain(`✓ Wrote ${join(site, "galley.config.json")}`);
  });

  it("never overwrites without --force", async () => {
    const site = copyFixture("init-twice");
    const io = testIo({ cwd: site });

    expect(await main(["init"], io)).toBe(0);
    writeFileSync(join(site, "galley.config.json"), '{"name":"Hand-edited"}\n');
    expect(await main(["init"], io)).toBe(1);
    expect(io.stderr.join("\n")).toContain("already exists");
    expect(readFileSync(join(site, "galley.config.json"), "utf8")).toContain("Hand-edited");
    expect(await main(["init", "--force", "--json"], io)).toBe(0);
    expect(JSON.parse(io.stdout.slice(-1)[0]!).config.collections).toHaveLength(5);
  });

  it("fails plainly on a missing folder", async () => {
    const io = testIo();

    expect(await main(["init", join(tmp, "nope")], io)).toBe(1);
    expect(io.stderr[0]).toMatch(/There's no folder at/);
  });
});

describe("galley doctor", () => {
  it("prints what detection found and exits 0 on a workable site", async () => {
    const site = copyFixture("doctor-site");

    execFileSync("git", ["init", "-q"], { cwd: site });
    const io = testIo({ cwd: site, env: { PATH: process.env.PATH, HOME: tmp, GALLEY_HOME: join(tmp, "home"), ANTHROPIC_API_KEY: "sk-ant-secret-value-9999" } });

    expect(await main(["doctor"], io)).toBe(0);
    const output = io.stdout.join("\n");

    expect(output).toMatch(/^✓ Node \d+/m);
    expect(output).toMatch(/^✓ Astro .* · pnpm · dev: /m);
    expect(output).toMatch(/^✓ 5 collections: /m);
    expect(output).toMatch(/^ {2}blog: “Blog posts” · \d+ fields/m);
    expect(output).toMatch(/^✓ media: public\/images → \/images/m);
    expect(output).toMatch(/^! Dependencies aren't installed/m);
    expect(output).toMatch(/^✓ git: \d+ pending changes on \S+ · no remote/m);
    expect(output).toMatch(/^✓ assistant key: ANTHROPIC_API_KEY \(environment\)/m);
    expect(output).not.toContain("sk-ant-secret-value-9999");
    expect(output).not.toContain("9999");
  });

  it("exits 1 when the folder is missing", async () => {
    const io = testIo();

    expect(await main(["doctor", join(tmp, "missing")], io)).toBe(1);
    expect(io.stdout.join("\n")).toMatch(/can't work here until this is fixed/);
  });

  it("exits 1 when git isn't installed", async () => {
    const site = copyFixture("doctor-nogit");
    const io = testIo({ cwd: site, env: { PATH: join(tmp, "empty-bin"), HOME: tmp, GALLEY_HOME: join(tmp, "home") } });

    expect(await main(["doctor"], io)).toBe(1);
    expect(io.stdout.join("\n")).toMatch(/^! git isn't installed/m);
  });

  it("warns, but passes, outside a git repository and without a key", async () => {
    const site = join(tmp, "plain");

    mkdirSync(join(site, "content/notes"), { recursive: true });
    writeFileSync(join(site, "content/notes/a.md"), "---\ntitle: A\n---\nHi\n");
    writeFileSync(join(site, "content/notes/b.md"), "---\ntitle: B\n---\nHi\n");
    // Keep git from finding the test runner's own repository above the temp dir.
    const io = testIo({ cwd: site, env: { PATH: process.env.PATH, HOME: tmp, GALLEY_HOME: join(tmp, "home"), GIT_CEILING_DIRECTORIES: tmp } });
    const code = await main(["doctor", "--json"], io);
    const report = JSON.parse(io.stdout.join("\n"));

    expect(code).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.checks.some((check: { text: string }) => /isn't a git repository/.test(check.text))).toBe(true);
    expect(report.checks.some((check: { text: string }) => /No assistant key/.test(check.text))).toBe(true);
    // Settings has no image service chosen, so doctor says what generation will use — the same thing.
    expect(report.checks).toContainEqual({ level: "info", text: "Image generation: placeholder artwork — no image service is chosen in Settings (add an OpenAI or Google key, then choose it there)" });
  });

  it("agrees with Settings about the image service", async () => {
    const home = join(tmp, "doctor-images-home");
    const { createSettingsService } = await import("@galley/core/ai");
    const env = { PATH: process.env.PATH, HOME: tmp, GALLEY_HOME: home, OPENAI_API_KEY: "sk-proj-0123456789abcdefghijklmnop" };

    await createSettingsService({ home, env }).update({ images: { provider: "openai" } });
    const chosen = testIo({ cwd: copyFixture("doctor-images"), env });

    await main(["doctor", "--json"], chosen);
    expect(JSON.parse(chosen.stdout.join("\n")).checks).toContainEqual({ level: "info", text: "Image generation: OpenAI (chosen in Settings)" });
    // Without the key, Settings falls back to the placeholder, and so does doctor.
    const keyless = testIo({ cwd: copyFixture("doctor-images-2"), env: { ...env, OPENAI_API_KEY: "" } });

    await main(["doctor", "--json"], keyless);
    expect(JSON.parse(keyless.stdout.join("\n")).checks).toContainEqual({ level: "info", text: "Image generation: placeholder artwork — no image service is chosen in Settings (add an OpenAI or Google key, then choose it there)" });
  });

  it("knows which Node versions are too old", () => {
    expect(nodeCheck("18.19.0").level).toBe("fail");
    expect(nodeCheck("20.10.0").level).toBe("fail");
    expect(nodeCheck("20.11.0").level).toBe("ok");
    expect(nodeCheck("22.1.0").level).toBe("ok");
  });

  it("shows a remote's host, never its credentials", () => {
    expect(remoteHost("https://user:hunter2@github.com/a/b.git")).toBe("github.com");
    expect(remoteHost("git@gitlab.com:a/b.git")).toBe("gitlab.com");
    expect(remoteHost("/srv/repos/site.git")).toBe("a local folder");
  });
});

describe("galley [path]", () => {
  it("explains what it looked for when the folder isn't a site", async () => {
    const empty = join(tmp, "empty-folder");

    mkdirSync(empty, { recursive: true });
    const io = testIo();

    expect(await main([empty], io)).toBe(1);
    const message = io.stderr.join("\n");

    expect(message).toContain("doesn't look like a site");
    expect(message).toContain("package.json, .git, galley.config.json");
    expect(message).toContain("galley new my-site");
  });

  it("starts the server, opens the site and the browser on it, and stops cleanly", async () => {
    const site = copyFixture("open-site");
    const calls: string[] = [];
    const fakeServer = {
      url: "http://127.0.0.1:4400",
      port: 4400,
      token: "tok",
      openUrl: (path: string) => `http://127.0.0.1:4400${path}?token=tok`,
      close: async () => void calls.push("close"),
      services: {
        registry: {
          open: async ({ path }: { path: string }) => {
            calls.push(`open ${path}`);
            return { id: "abc", model: async () => ({ name: "Tide Notes" }) };
          },
        },
      },
    } as unknown as RunningServer;
    const io = testIo({
      startServer: async (options) => {
        calls.push(`start ${options?.host} ${options?.mode} ${options?.port}`);
        return fakeServer;
      },
      waitForStop: async () => void calls.push("stop requested"),
    });

    expect(await main([site, "--port", "4500"], io)).toBe(0);
    expect(calls).toEqual(["start 127.0.0.1 local 4500", `open ${site}`, "stop requested", "close"]);
    expect(io.opened).toEqual(["http://127.0.0.1:4400/sites/abc?token=tok"]);
    expect(io.stdout).toContain("Open: http://127.0.0.1:4400/sites/abc?token=tok");
    expect(io.stdout).toContain(`Site: Tide Notes (${site})`);
  });

  it("--no-open prints the link without opening a browser", async () => {
    const site = copyFixture("open-noopen");
    const fakeServer = {
      url: "u",
      openUrl: (path: string) => `u${path}`,
      close: async () => {},
      services: { registry: { open: async () => ({ id: "x", model: async () => ({ name: "S" }) }) } },
    } as unknown as RunningServer;
    const io = testIo({ startServer: async () => fakeServer });

    expect(await main([site, "--no-open"], io)).toBe(0);
    expect(io.opened).toEqual([]);
  });
});

describe("galley serve", () => {
  it("refuses to start without a password, saying why", async () => {
    const { startServer } = await import("@galley/server");
    const io = testIo({ startServer, env: { HOME: tmp, GALLEY_HOME: join(tmp, "serve-home") } });

    expect(await main(["serve", "--port", "4999"], io)).toBe(1);
    expect(io.stderr.join("\n")).toMatch(/won't start on 0\.0\.0\.0 without a password/);
    expect(existsSync(join(tmp, "serve-home"))).toBe(false);
  });

  it("refuses a short password", async () => {
    const { startServer } = await import("@galley/server");
    const io = testIo({ startServer, env: { HOME: tmp, GALLEY_HOME: join(tmp, "serve-home"), GALLEY_PASSWORD: "short" } });

    expect(await main(["serve"], io)).toBe(1);
    expect(io.stderr.join("\n")).toMatch(/at least 12 characters/);
  });

  it("prints what is exposed and how sign-in works", async () => {
    let received: Record<string, unknown> = {};
    const io = testIo({
      env: { HOME: tmp, GALLEY_PASSWORD: "a long enough password", GALLEY_PUBLIC_URL: "https://cms.example.com", GALLEY_HOME: "/data" },
      startServer: async (options) => {
        received = { ...options };
        return { url: "https://cms.example.com", port: 4400, close: async () => {} } as unknown as RunningServer;
      },
    });

    expect(await main(["serve", "--sites-dir", "sites"], io)).toBe(0);
    expect(received).toMatchObject({ mode: "hosted", host: "0.0.0.0", sitesDir: join(tmp, "sites") });
    const output = io.stdout.join("\n");

    expect(output).toContain("0.0.0.0 (every network interface), port 4400");
    expect(output).toContain("Address:   https://cms.example.com");
    expect(output).toContain("password from GALLEY_PASSWORD");
    expect(output).toContain(`Sites:     ${join(tmp, "sites")}`);
    expect(output).not.toContain("a long enough password");
    expect(output).toContain("Requests:  only for cms.example.com and loopback names; changes must come from that address");
  });

  it("says plainly what it answers to without a public address", async () => {
    const io = testIo({
      env: { HOME: tmp, GALLEY_PASSWORD: "a long enough password" },
      startServer: async () => ({ url: "http://127.0.0.1:4400", port: 4400, close: async () => {} }) as unknown as RunningServer,
    });

    expect(await main(["serve"], io)).toBe(0);
    expect(io.stdout.join("\n")).toContain("Requests:  for any hostname (GALLEY_PUBLIC_URL limits them to one); changes must come from the address they were loaded from");
  });

  it("prints a broken brand setting or port range as one plain line and exits 1", async () => {
    const { startServer } = await import("@galley/server");

    for (const [env, expected] of [
      [{ GALLEY_BRAND_FILE: join(tmp, "missing-brand.json") }, `The brand file ${join(tmp, "missing-brand.json")} can't be used because it doesn't exist.`],
      [{ GALLEY_BRAND_ACCENT: "blue" }, "GALLEY_BRAND_ACCENT must be a hex color like #1a2b3c, not “blue”."],
      [{ GALLEY_PREVIEW_PORTS: "lots" }, "GALLEY_PREVIEW_PORTS must be a range of ports like 4410-4429, not “lots”."],
    ] as const) {
      const io = testIo({ env: { HOME: tmp, GALLEY_HOME: join(tmp, "brand-home"), GALLEY_PASSWORD: "a long enough password", ...env }, startServer });

      expect(await main(["serve"], io)).toBe(1);
      expect(io.stderr).toEqual([expected]);
    }
  });
});

describe("galley new", () => {
  const starters = join(tmp, "starters");

  mkdirSync(join(starters, "tiny/src/content/pages"), { recursive: true });
  writeFileSync(join(starters, "tiny/package.json"), JSON.stringify({ name: "tiny", private: true, scripts: { dev: "echo dev" } }, null, 2));
  writeFileSync(join(starters, "tiny/src/content/pages/index.md"), "---\ntitle: Home\n---\nHello\n");
  mkdirSync(join(starters, "tiny/node_modules/junk"), { recursive: true });

  it("copies the starter into a new folder with a first version, then says what's next", async () => {
    const io = testIo({ env: { PATH: process.env.PATH, HOME: tmp, GALLEY_STARTERS_DIR: starters } });

    expect(await main(["new", "Harbour Notes", "--starter", "tiny", "--no-start", "--skip-install"], io)).toBe(0);
    const target = join(tmp, "harbour-notes");

    expect(JSON.parse(readFileSync(join(target, "package.json"), "utf8")).name).toBe("harbour-notes");
    expect(existsSync(join(target, "node_modules"))).toBe(false);
    expect(execFileSync("git", ["log", "--format=%s"], { cwd: target, encoding: "utf8" })).toContain("Harbour Notes");
    expect(io.stdout.join("\n")).toContain("Next: galley harbour-notes");
  });

  it("puts the site's name where the site and the app read it, and leaves nothing pending", async () => {
    mkdirSync(join(starters, "named/src/data"), { recursive: true });
    mkdirSync(join(starters, "named/src/content/pages"), { recursive: true });
    writeFileSync(join(starters, "named/package.json"), '{\n  "name": "named-starter",\n  "private": true\n}\n');
    writeFileSync(join(starters, "named/galley.config.json"), '{\n  "name": "Sample Studio",\n  "collections": [{ "id": "pages", "url": "/{slug}/" }]\n}\n');
    writeFileSync(join(starters, "named/src/data/site.json"), '{\n  "name": "Sample Studio",\n  "tagline": "A sample"\n}\n');
    writeFileSync(join(starters, "named/src/content/pages/index.md"), "---\ntitle: Home\n---\n");
    const io = testIo({ env: { PATH: process.env.PATH, HOME: tmp, GALLEY_STARTERS_DIR: starters } });

    expect(await main(["new", "Tide Tables", "--starter", "named", "--no-start", "--skip-install"], io)).toBe(0);
    const target = join(tmp, "tide-tables");

    expect(readFileSync(join(target, "galley.config.json"), "utf8")).toBe('{\n  "name": "Tide Tables",\n  "collections": [{ "id": "pages", "url": "/{slug}/" }]\n}\n');
    expect(readFileSync(join(target, "src/data/site.json"), "utf8")).toBe('{\n  "name": "Tide Tables",\n  "tagline": "A sample"\n}\n');
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: target, encoding: "utf8" })).toBe("");
  });

  it("names the folder relative to where it was run, even through a symlink", async () => {
    const link = join(tmpdir(), `galley-cli-link-${process.pid}`);

    if (existsSync(link)) unlinkSync(link);
    symlinkSync(tmp, link);
    try {
      // process.cwd() reports the real path (/private/tmp…); the target is built from the path as typed (/tmp…).
      const io = testIo({ cwd: tmp, env: { PATH: process.env.PATH, HOME: tmp, GALLEY_STARTERS_DIR: starters } });

      expect(await main(["new", "Linked Notes", "--starter", "tiny", "--no-start", "--skip-install", "--dir", join(link, "nested")], io)).toBe(0);
      expect(io.stdout.at(-1)).toBe("Next: galley nested/linked-notes");
      expect(shownPath(tmp, join(link, "nested", "linked-notes"))).toBe("nested/linked-notes");
      expect(shownPath(join(tmp, "nested"), "/elsewhere/site")).toBe("/elsewhere/site");
    } finally {
      unlinkSync(link);
    }
  });

  it("lists starters with their looks, and applies or refuses a look", async () => {
    mkdirSync(join(starters, "looks/galley"), { recursive: true });
    mkdirSync(join(starters, "looks/src/styles"), { recursive: true });
    writeFileSync(join(starters, "looks/package.json"), JSON.stringify({ name: "looks", private: true }));
    writeFileSync(join(starters, "looks/starter.json"), JSON.stringify({ name: "Looks", tokens: "src/styles/tokens.css", looks: [{ id: "day", label: "Day", file: "galley/day.css" }, { id: "night", label: "Night", file: "galley/night.css" }] }));
    writeFileSync(join(starters, "looks/galley/day.css"), "day\n");
    writeFileSync(join(starters, "looks/galley/night.css"), "night\n");
    writeFileSync(join(starters, "looks/src/styles/tokens.css"), "day\n");
    const env = { PATH: process.env.PATH, HOME: tmp, GALLEY_STARTERS_DIR: starters };
    const list = testIo({ env });

    expect(await main(["starters"], list)).toBe(0);
    expect(list.stdout).toContain("looks — Looks (generic) · looks: day (default), night");
    const help = testIo({ env });

    expect(await main(["new", "--help"], help)).toBe(0);
    expect(help.stdout.join("\n")).toContain("  looks — Looks (generic) · looks: day (default), night");
    const wrong = testIo({ env });

    expect(await main(["new", "Moon", "--starter", "looks", "--look", "dusk", "--no-start", "--skip-install"], wrong)).toBe(1);
    expect(wrong.stderr[0]).toBe("looks has no look called “dusk”. Available: day, night.");
    expect(existsSync(join(tmp, "moon"))).toBe(false);
    const right = testIo({ env });

    expect(await main(["new", "Moon", "--starter", "looks", "--look", "night", "--no-start", "--skip-install"], right)).toBe(0);
    expect(readFileSync(join(tmp, "moon/src/styles/tokens.css"), "utf8")).toBe("night\n");
    expect(existsSync(join(tmp, "moon/starter.json"))).toBe(false);
  });

  it("refuses an unknown starter and lists the ones there are", async () => {
    const io = testIo({ env: { PATH: process.env.PATH, HOME: tmp, GALLEY_STARTERS_DIR: starters } });

    expect(await main(["new", "x", "--starter", "nope", "--no-start"], io)).toBe(1);
    expect(io.stderr[0]).toMatch(/^There's no starter called “nope”\. Available: .*tiny/);
  });

  it("refuses a folder that already exists", async () => {
    mkdirSync(join(tmp, "taken"), { recursive: true });
    const io = testIo({ env: { PATH: process.env.PATH, HOME: tmp, GALLEY_STARTERS_DIR: starters } });

    expect(await main(["new", "taken", "--no-start"], io)).toBe(1);
    expect(io.stderr[0]).toMatch(/already exists/);
  });
});
