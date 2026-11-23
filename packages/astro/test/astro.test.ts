// The integration in a real Astro project: a temporary copy of the starter
// (made by /tmp/galley-verify/mksite.sh, with node_modules linked) that
// imports the integration by path. `astro dev` must register the toolbar app
// and answer the status route; `astro build` must produce byte-identical
// output with and without the integration when its parts are off, and with
// the defaults add only the email-link dialog and the agent-readable output
// (docs/ai-first-output.md) — no JavaScript.
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MKSITE = "/tmp/galley-verify/mksite.sh";
const INTEGRATION = fileURLToPath(new URL("../src/index.js", import.meta.url));
const TOOLBAR_APP = fileURLToPath(new URL("../src/toolbar-app.js", import.meta.url));
const available = existsSync(MKSITE);

/** The starter's own config, plus (optionally) the integration with extra options. */
function config(withGalley: string | null, extra = ""): string {
  return [
    'import { defineConfig } from "astro/config";',
    withGalley === null ? "" : `import galley from ${JSON.stringify(INTEGRATION)};`,
    'import site from "./src/data/site.json";',
    "",
    "export default defineConfig({",
    "  site: site.url,",
    '  output: "static",',
    '  trailingSlash: "ignore",',
    '  build: { format: "directory" },',
    withGalley === null ? "" : `  integrations: [galley({ url: ${JSON.stringify(withGalley)}${extra} })],`,
    "});",
    "",
  ].join("\n");
}

/** Only what a plain local run needs: never the caller's agent or CI variables. */
const cleanEnv = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ASTRO_TELEMETRY_DISABLED: "1" };

function astro(root: string, args: string[]): ChildProcess {
  return spawn(join(root, "node_modules/.bin/astro"), args, { cwd: root, env: cleanEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] });
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return;
  const exited = new Promise((done) => child.once("exit", done));

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    return;
  }
  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {}
  }, 5000);
  await exited;
  clearTimeout(timer);
}

async function freePort(): Promise<number> {
  const server = createServer();

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  await new Promise((done) => server.close(done));
  return port;
}

async function until<T>(read: () => Promise<T | undefined>, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms;

  while (Date.now() < end) {
    const value = await read().catch(() => undefined);

    if (value !== undefined) return value;
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

function fakeGalley(port: number): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.url !== "/api/meta") {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ version: "", brand: { productName: "Galley", byline: "" }, mode: "local", authenticated: false, desktop: false, platform: "" }));
  });

  return new Promise((done) => server.listen(port, "127.0.0.1", () => done(server)));
}

/** relative path → sha256, for every file under `dir`. */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);

      if (statSync(path).isDirectory()) walk(path);
      else out[relative(dir, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };

  walk(dir);
  return out;
}

describe.skipIf(!available)("in a real Astro project", () => {
  let root = "";

  beforeAll(() => {
    root = join(mkdtempSync(join(tmpdir(), "galley-astro-it-")), "site");
    execFileSync("sh", [MKSITE, root], { stdio: "ignore" });
  });

  afterAll(() => {
    if (root) rmSync(join(root, ".."), { recursive: true, force: true });
  });

  it("astro dev registers the toolbar app and answers /__galley/status, with and without Galley listening", async () => {
    const galleyPort = await freePort();
    const devPort = await freePort();
    const galleyUrl = `http://127.0.0.1:${galleyPort}`;

    writeFileSync(join(root, "astro.config.ts"), config(galleyUrl));
    const dev = astro(root, ["dev", "--port", String(devPort), "--host", "127.0.0.1"]);
    let log = "";
    let galley: Server | null = null;

    dev.stdout!.on("data", (chunk) => (log += chunk));
    dev.stderr!.on("data", (chunk) => (log += chunk));
    try {
      const base = `http://127.0.0.1:${devPort}`;
      const status = async () => (await fetch(`${base}/__galley/status`)).json();

      await until(async () => ((await fetch(`${base}/`)).ok ? true : undefined), 60_000, `astro dev to start:\n${log}`);

      const registry = await (await fetch(`${base}/@id/__x00__astro:toolbar:internal`)).text();

      expect(registry).toContain('"id":"galley"');
      expect(registry).toContain('"name":"Galley"');
      expect(registry).toContain(TOOLBAR_APP);
      const app = await fetch(`${base}/@fs${TOOLBAR_APP}`);

      expect(app.status).toBe(200);
      expect(await app.text()).toContain("Edit this page in");

      expect(await status()).toEqual({ running: false, url: galleyUrl, root: realpathSync(root) });

      galley = await fakeGalley(galleyPort);
      // The answer is reused for a second; the next one sees Galley.
      const seen = await until(async () => ((await status()).running ? true : undefined), 10_000, "the status to see Galley");

      expect(seen).toBe(true);
      expect((await fetch(`${base}/__galley/status`, { method: "POST" })).status).toBe(405);

      // The agent-readable addresses answer in dev as they will be built (docs/ai-first-output.md).
      const home = await (await fetch(`${base}/`)).text();
      const link = /<link rel="alternate" type="text\/markdown" href="([^"]+)">/.exec(home);

      expect(link?.[1]).toBe("/index.md");
      const twin = await fetch(`${base}/index.md`);

      expect(twin.status).toBe(200);
      expect(twin.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
      expect(await twin.text()).toMatch(/^---\ntitle: /);
      const llms = await fetch(`${base}/llms.txt`);

      expect(llms.status).toBe(200);
      expect(await llms.text()).toMatch(/^# \S/);
      expect(home).toContain('"@type":"WebSite"');
      expect(log).not.toMatch(/\[ERROR\]|error/i);
    } finally {
      await stop(dev);
      if (galley) await new Promise((done) => galley!.close(done));
    }
  }, 120_000);

  // The email-link dialog and the agent-readable output are on by default, so
  // "nothing in the build" holds with both turned off; with them on, pages
  // gain only the dialog's one script (pages with an email link) and, in
  // <head>, the markdown link and JSON-LD; the new files are the twins,
  // llms.txt, llms-full.txt and agent.md.
  it("astro build output is byte-identical with and without the integration (forms and scripts unused, mailto and visibility off)", async () => {
    const build = async (outDir: string) => {
      const child = astro(root, ["build", "--outDir", outDir]);
      let log = "";

      child.stdout!.on("data", (chunk) => (log += chunk));
      child.stderr!.on("data", (chunk) => (log += chunk));
      const code = await new Promise<number | null>((done) => child.once("exit", done));

      expect(code, log).toBe(0);
      return tree(join(root, outDir));
    };

    writeFileSync(join(root, "astro.config.ts"), config(null));
    const without = await build("dist-without");

    writeFileSync(join(root, "astro.config.ts"), config("http://127.0.0.1:4400", ", mailto: false, visibility: false"));
    const withGalley = await build("dist-with");

    expect(Object.keys(withGalley).length).toBeGreaterThan(20);
    expect(withGalley).toEqual(without);
    // (The starter ships the vendored kit, so its own form chunks are named after it in both builds.)

    // Defaults: every file as before plus the agent-readable files; pages gain
    // exactly the dialog's script before </body> and the <head> tags.
    writeFileSync(join(root, "astro.config.ts"), config("http://127.0.0.1:4400"));
    const defaults = await build("dist-defaults");
    const added = Object.keys(defaults).filter((file) => !(file in without)).sort();

    expect(Object.keys(without).every((file) => file in defaults)).toBe(true);
    // robots.txt and sitemap.xml too: the starter leaves them to the kit (its own config adds the vendored integration).
    expect(added.filter((file) => !file.endsWith(".md"))).toEqual(["llms-full.txt", "llms.txt", "robots.txt", "sitemap.xml"]);
    expect(added).toContain("agent.md");
    expect(added).toContain("index.md");
    expect(added.filter((file) => /\.(js|css)$/.test(file))).toEqual([]);
    let changed = 0;

    for (const file of Object.keys(without)) {
      if (defaults[file] === without[file]) continue;
      const before = readFileSync(join(root, "dist-without", file), "utf8");
      const after = readFileSync(join(root, "dist-defaults", file), "utf8");

      changed += 1;
      expect(file.endsWith(".html"), file).toBe(true);
      // (A layout with the vendored <Scripts placement="body-end" /> has the dialog already; it isn't added twice.)
      const stripped = (before.includes("data-galley-mailto-script") ? after : after.replace(/<script data-galley-mailto-script>[\s\S]*?<\/script>(?=<\/body>)/, ""))
        .replace(/<link rel="alternate" type="text\/markdown" href="[^"]+">/, "")
        .replace(/<script type="application\/ld\+json" data-galley-jsonld>[^<]*<\/script>/g, "");

      expect(stripped, file).toBe(before);
    }
    expect(changed).toBeGreaterThan(0);
  }, 240_000);
});
