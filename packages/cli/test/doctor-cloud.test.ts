import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { Io } from "../src/io";
import { main } from "../src/main";
import { CLOUDFLARE_MAX_FILE_BYTES, DOCTOR_HELP } from "../src/commands/doctor";

const fixture = fileURLToPath(new URL("../../core/test/fixtures/astro-site", import.meta.url));
const tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-doctor-cloud-")));

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

interface TestIo extends Io {
  stdout: string[];
  stderr: string[];
}

function testIo(cwd: string, envOverrides: Record<string, string | undefined> = {}): TestIo {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    out: (line = "") => stdout.push(line),
    err: (line = "") => stderr.push(line),
    cwd,
    env: { PATH: process.env.PATH, HOME: tmp, GALLEY_HOME: join(tmp, "home"), GIT_CEILING_DIRECTORIES: tmp, ...envOverrides },
    startServer: () => {
      throw new Error("startServer not faked");
    },
    openBrowser: async () => true,
    waitForStop: async () => {},
    watchParent: () => ({ gone: new Promise<void>(() => {}), stop: () => {} }),
  };
}

function makeSite(name: string, initGit = true): string {
  const dir = join(tmp, name);

  cpSync(fixture, dir, { recursive: true });
  if (initGit) {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: dir });
  }
  return dir;
}

describe("galley doctor --cloud & hygiene checks", () => {
  it("documents --cloud in DOCTOR_HELP", () => {
    expect(DOCTOR_HELP).toContain("--cloud");
  });

  it("catches gitignored local file: dependency entrypoints (like vendor/gsap/dist/gsap.js excluded by dist/)", async () => {
    const site = makeSite("gitignored-dep");

    writeFileSync(join(site, ".gitignore"), "node_modules/\ndist/\n");
    mkdirSync(join(site, "vendor/gsap/dist"), { recursive: true });
    writeFileSync(join(site, "vendor/gsap/package.json"), JSON.stringify({ name: "gsap", version: "3.12.0", main: "dist/gsap.js", module: "dist/gsap.js" }, null, 2));
    writeFileSync(join(site, "vendor/gsap/dist/gsap.js"), "export const gsap = {};\n");
    writeFileSync(
      join(site, "package.json"),
      JSON.stringify({ name: "demo", private: true, scripts: { dev: "astro dev", build: "astro build" }, dependencies: { astro: "^5.0.0", gsap: "file:./vendor/gsap" } }, null, 2)
    );

    const io = testIo(site);
    const code = await main(["doctor", "--json"], io);
    const report = JSON.parse(io.stdout.join("\n")) as { ok: boolean; checks: Array<{ level: string; text: string }> };

    expect(code).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        level: "fail",
        text: expect.stringMatching(/gsap.*gitignored.*vendor\/gsap\/dist\/gsap\.js/i),
      })
    );
  });

  it("catches missing local file: dependency entrypoints on disk and untracked entrypoints in committed repos", async () => {
    const site = makeSite("missing-and-untracked-dep");

    mkdirSync(join(site, "vendor/missing-pkg"), { recursive: true });
    writeFileSync(join(site, "vendor/missing-pkg/package.json"), JSON.stringify({ name: "missing-pkg", exports: { ".": { import: "./dist/index.mjs" } } }, null, 2));
    mkdirSync(join(site, "vendor/untracked-pkg/lib"), { recursive: true });
    writeFileSync(join(site, "vendor/untracked-pkg/package.json"), JSON.stringify({ name: "untracked-pkg", main: "lib/index.js" }, null, 2));
    writeFileSync(join(site, "vendor/untracked-pkg/lib/index.js"), "export default 1;\n");
    writeFileSync(
      join(site, "package.json"),
      JSON.stringify(
        {
          name: "demo",
          private: true,
          scripts: { dev: "astro dev" },
          dependencies: { astro: "^5.0.0", "missing-pkg": "file:./vendor/missing-pkg", "untracked-pkg": "link:./vendor/untracked-pkg" },
        },
        null,
        2
      )
    );
    execFileSync("git", ["add", "package.json", "vendor/missing-pkg/package.json", "vendor/untracked-pkg/package.json"], { cwd: site });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: site });

    const io = testIo(site);
    const code = await main(["doctor", "--json"], io);
    const report = JSON.parse(io.stdout.join("\n")) as { ok: boolean; checks: Array<{ level: string; text: string }> };

    expect(code).toBe(1);
    expect(report.checks).toContainEqual(
      expect.objectContaining({ level: "fail", text: expect.stringMatching(/missing-pkg.*vendor\/missing-pkg\/dist\/index\.mjs/) })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({ level: "fail", text: expect.stringMatching(/untracked-pkg.*vendor\/untracked-pkg\/lib\/index\.js.*untracked/) })
    );
  });

  it("passes when local file: dependency entrypoints exist and are tracked in git", async () => {
    const site = makeSite("good-local-dep");

    mkdirSync(join(site, "vendor/good/dist"), { recursive: true });
    writeFileSync(join(site, "vendor/good/package.json"), JSON.stringify({ name: "good", main: "dist/index.js" }, null, 2));
    writeFileSync(join(site, "vendor/good/dist/index.js"), "export const ok = true;\n");
    writeFileSync(
      join(site, "package.json"),
      JSON.stringify({ name: "demo", private: true, scripts: { dev: "astro dev" }, dependencies: { astro: "^5.0.0", good: "file:./vendor/good" } }, null, 2)
    );
    execFileSync("git", ["add", "."], { cwd: site });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: site });

    const io = testIo(site);
    const code = await main(["doctor", "--cloud", "--json"], io);
    const report = JSON.parse(io.stdout.join("\n")) as { ok: boolean; checks: Array<{ level: string; text: string }> };

    expect(code).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.checks).toContainEqual({ level: "ok", text: "local dependencies: 1 package verified" });
    expect(report.checks).toContainEqual({ level: "ok", text: "deploy file sizes: no files over Cloudflare's 25 MiB limit" });
  });

  it("warns in normal mode and fails under --cloud when files in public/ or dist/ exceed Cloudflare's 25 MiB limit", async () => {
    const site = makeSite("oversized-asset");
    const bigFile = join(site, "public/videos/hero.mp4");

    mkdirSync(join(site, "public/videos"), { recursive: true });
    writeFileSync(bigFile, "");
    truncateSync(bigFile, CLOUDFLARE_MAX_FILE_BYTES + 2 * 1024 * 1024); // 27 MiB sparse file

    const normalIo = testIo(site);
    const normalCode = await main(["doctor", "--json"], normalIo);
    const normalReport = JSON.parse(normalIo.stdout.join("\n")) as { ok: boolean; checks: Array<{ level: string; text: string }> };

    expect(normalCode).toBe(0);
    expect(normalReport.checks).toContainEqual(
      expect.objectContaining({
        level: "warn",
        text: expect.stringMatching(/public\/videos\/hero\.mp4 \(27\.0 MiB\)/),
      })
    );

    const cloudIo = testIo(site);
    const cloudCode = await main(["doctor", "--cloud", "--json"], cloudIo);
    const cloudReport = JSON.parse(cloudIo.stdout.join("\n")) as { ok: boolean; checks: Array<{ level: string; text: string }> };

    expect(cloudCode).toBe(1);
    expect(cloudReport.ok).toBe(false);
    expect(cloudReport.checks).toContainEqual(
      expect.objectContaining({
        level: "fail",
        text: expect.stringMatching(/public\/videos\/hero\.mp4 \(27\.0 MiB\)/),
      })
    );
  });

  it("reports invalid galley.config.json syntax and schema errors as fail", async () => {
    const badJsonSite = makeSite("bad-json-config");

    writeFileSync(join(badJsonSite, "galley.config.json"), '{ "name": "Broken", }');
    const jsonIo = testIo(badJsonSite);
    const jsonCode = await main(["doctor", "--json"], jsonIo);
    const jsonReport = JSON.parse(jsonIo.stdout.join("\n")) as { ok: boolean; checks: Array<{ level: string; text: string }> };

    expect(jsonCode).toBe(1);
    expect(jsonReport.checks).toContainEqual(
      expect.objectContaining({ level: "fail", text: expect.stringMatching(/galley\.config\.json is not valid JSON/) })
    );

    const badSchemaSite = makeSite("bad-schema-config");

    writeFileSync(join(badSchemaSite, "galley.config.json"), JSON.stringify({ name: "Ok", bogusKey: true }, null, 2));
    const schemaIo = testIo(badSchemaSite);
    const schemaCode = await main(["doctor", "--json"], schemaIo);
    const schemaReport = JSON.parse(schemaIo.stdout.join("\n")) as { ok: boolean; checks: Array<{ level: string; text: string }> };

    expect(schemaCode).toBe(1);
    expect(schemaReport.checks).toContainEqual(
      expect.objectContaining({ level: "fail", text: expect.stringMatching(/galley\.config\.json.*bogusKey/) })
    );
  });

  it("warns when multiple conflicting lockfiles exist", async () => {
    const site = makeSite("multi-lockfile");

    writeFileSync(join(site, "package-lock.json"), "{}\n");
    const io = testIo(site);
    const code = await main(["doctor", "--json"], io);
    const report = JSON.parse(io.stdout.join("\n")) as { ok: boolean; checks: Array<{ level: string; text: string }> };

    expect(code).toBe(0);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        level: "warn",
        text: expect.stringMatching(/Multiple conflicting lockfiles.*pnpm-lock\.yaml.*package-lock\.json/),
      })
    );
  });
});
