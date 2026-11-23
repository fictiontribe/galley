/**
 * The site kit's files travel inside the CLI bundle — the one every shipped
 * shell runs (npm, the desktop sidecar, the Docker image). This builds the
 * bundle into a temporary folder outside the repository, starts the built
 * server the way the desktop app does, and runs "Set it up for me" on a
 * site through the API: the files can only come from the bundle itself.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../core/test/fixtures/pre-kit-astro", import.meta.url));
const PORT = 4623;
const TOKEN = "kit-bundle-test-token-0123456789";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-kit-bundle-")));
let server: ChildProcess | null = null;

afterAll(() => {
  server?.kill("SIGTERM");
  rmSync(tmp, { recursive: true, force: true });
});

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();

  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
  return JSON.parse(text) as T;
}

describe("the built CLI", () => {
  it("carries the site kit and puts it into a site", async () => {
    const dist = join(tmp, "dist");

    execFileSync(process.execPath, [join(CLI, "build.mjs")], { cwd: CLI, env: { ...process.env, GALLEY_CLI_DIST: dist }, stdio: "pipe" });
    expect(existsSync(join(dist, "galley.mjs"))).toBe(true);
    expect(existsSync(join(CLI, "dist"))).toBe(false);

    const site = join(tmp, "sites", "pre-kit");

    mkdirSync(site, { recursive: true });
    cpSync(FIXTURE, site, { recursive: true });
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Test Editor", "-c", "user.email=editor@example.com", ...args], { cwd: site, stdio: "pipe" });

    git("init", "-q", "-b", "main");
    git("add", "-A");
    git("commit", "-q", "-m", "Initial");

    // As the desktop app starts its sidecar; HOME is the temporary folder, so sites under it may be opened.
    server = spawn(process.execPath, [join(dist, "galley.mjs"), "desktop", "--port", String(PORT)], {
      env: { PATH: process.env.PATH ?? "", HOME: tmp, GALLEY_HOME: join(tmp, "home"), GALLEY_TOKEN: TOKEN, GALLEY_DESKTOP: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    await new Promise<void>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error(`the built server didn't start:\n${output}`)), 60_000);

      server!.stdout!.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (/is running at/.test(output)) {
          clearTimeout(timer);
          resolve();
        }
      });
      server!.stderr!.on("data", (chunk: Buffer) => (output += chunk.toString()));
      server!.on("exit", (code) => reject(new Error(`the built server exited (${code}):\n${output}`)));
    });

    const opened = await api<{ id: string }>("POST", "/api/sites/open", { path: site });
    const before = await api<{ ready: boolean; available: string | null }>("GET", `/api/sites/${opened.id}/kit`);

    expect(before.ready).toBe(false);
    expect(before.available).toMatch(/^\d+\.\d+\.\d+/);
    let job = await api<{ id: string; state: string; detail?: string }>("POST", `/api/sites/${opened.id}/kit/setup`);

    for (let tries = 0; job.state === "running" && tries < 240; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      job = await api("GET", `/api/jobs/${job.id}`);
    }
    expect(job.state, job.detail).toBe("done");
    expect(readFileSync(join(site, "src/galley/schema.js"), "utf8")).toMatch(/^\/\/ Vendored from @galley\/astro \d+\.\d+\.\d+ by scripts\/vendor\.mjs\./);
    expect(readFileSync(join(site, "src/content.config.ts"), "utf8")).toContain('import { formSchema } from "./galley/schema.js";');
    // The kit's build step (the version AI assistants read) comes from the bundle too.
    expect(readFileSync(join(site, "src/galley/integration.js"), "utf8")).toMatch(/^\/\/ Vendored from @galley\/astro/);
    expect(readFileSync(join(site, "astro.config.ts"), "utf8")).toContain('import galley from "./src/galley/integration.js";');
    expect(JSON.parse(readFileSync(join(site, "src/data/visibility.json"), "utf8")).agentReadable.llmsTxt).toBe(true);
    expect((await api<{ ready: boolean }>("GET", `/api/sites/${opened.id}/kit`)).ready).toBe(true);
  }, 300_000);
});
