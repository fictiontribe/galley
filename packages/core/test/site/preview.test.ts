/**
 * The whole Prompt → Proof loop against the starter's real Astro dev server:
 * start the preview through the facade, see the page through the proxy with
 * the overlay injected, edit the hero heading through updateEntry, watch hot
 * reload show it, and leave no process or port behind.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { OVERLAY_SCRIPT_PATH } from "../../src/api";
import type { OpenSite } from "../../src/site/service";
import { OVERLAY_TAG } from "../../src/workspace/index";
import { cleanupAll, disposeAll, HOME, makeSite, openSite, until } from "./helpers";

// Astro switches off its page handler when it sees vitest's markers (every
// request then gets a bare "Cannot GET /"). The dev server inherits our
// environment, so hide them from it for this file.
const TEST_RUNNER_ENV = Object.keys(process.env).filter((name) => name === "TEST" || name.startsWith("VITEST"));
const saved = Object.fromEntries(TEST_RUNNER_ENV.map((name) => [name, process.env[name]]));

beforeAll(() => {
  for (const name of TEST_RUNNER_ENV) delete process.env[name];
});

afterAll(() => {
  Object.assign(process.env, saved);
});

afterEach(async () => {
  await disposeAll();
  cleanupAll();
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;

      server.close(() => resolve(port));
    });
  });
}

function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });

    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** Processes whose command line mentions the temp site — the dev server we started, if it survived. */
function processesUnder(root: string): string {
  try {
    return execFileSync("pgrep", ["-fl", root], { encoding: "utf8" }).trim();
  } catch {
    return ""; // pgrep exits 1 when nothing matches.
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function page(url: string): Promise<string> {
  const response = await fetch(url, { headers: { accept: "text/html" } });

  return response.text();
}

it("shows the real site, never another program's pages, when that program takes the port just before Astro asks for it", { timeout: 120_000 }, async () => {
  const root = makeSite({ nodeModules: true });
  const devPort = await freePort();
  const config = JSON.parse(readFileSync(join(root, "galley.config.json"), "utf8")) as Record<string, unknown>;

  // As a site made from the starter runs: its own dev script, the port passed as `--port` (the Astro adapter's doing),
  // which Astro moves on from when it is taken. Only the port is set here, so a dev server someone runs on 4321 is not met.
  writeFileSync(join(root, "galley.config.json"), JSON.stringify({ ...config, dev: { port: devPort } }));
  const { site, of } = await openSite(root, { watch: true, overlayScript: () => "window.__overlayLoaded = true;" });

  expect((await site.model()).dev).toMatchObject({ port: devPort, portArgs: ["--port", "{port}"] });
  const starting = site.preview().start();
  // The preview has chosen its port and started Astro, which takes a second or more to ask for it. Another
  // program takes the port in that time, and answers on it.
  let other: import("node:http").Server | null = null;
  const { createServer } = await import("node:http");

  await until(() => (site as OpenSite).previewHandle()!.pid !== undefined, 20_000, 5);
  other = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><head></head><body><h1>Another program's page</h1></body></html>");
  });
  const took = await new Promise<boolean>((resolve) => {
    other!.once("error", () => resolve(false));
    other!.listen(devPort, "127.0.0.1", () => resolve(true));
  });

  try {
    const status = await starting;

    // Only tested when the race was set up: the other program got the port before Astro. If Astro took it first
    // (on Linux it binds 127.0.0.1), there is nothing to steer around here.
    if (!took) return;
    expect(status.state, status.log.join("\n")).toBe("ready");
    let html = "";

    await until(async () => {
      html = await page(`${status.url}/`);
      return html.includes("home you already have");
    }, 30_000, 200).catch((error: Error) => {
      throw new Error(`${error.message}\n${html.slice(0, 300)}\n${site.preview().status().log.join("\n")}`);
    });
    // The real site, never the other program's — whether the controller started Astro again on another port
    // (it listened only on the other address) or Astro moved itself and was followed.
    expect(html).not.toContain("Another program's page");
    for (const event of of("preview.status").filter((each) => each.status.state === "ready")) expect(await page(`${event.status.url}/`)).not.toContain("Another program's page");
    console.info(`preview with its port taken: ${status.log.filter((line) => /taken|Local|local|starting again|couldn't be checked|in use/i.test(line)).join(" | ")} :: ready at ${status.url}`);
  } finally {
    await site.dispose();
    await new Promise((done) => other!.close(done));
  }
});

it("shows the real site, never another program's pages, when that program takes the port after Astro has announced it", { timeout: 120_000 }, async () => {
  // Astro prints "Local http://localhost:P" and, on this machine, listens only on [::1]:P. A program then takes
  // 127.0.0.1:P — the address the preview reaches first. The announcement is no proof the port is Astro's alone.
  const root = makeSite({ nodeModules: true });
  const devPort = await freePort();
  const config = JSON.parse(readFileSync(join(root, "galley.config.json"), "utf8")) as Record<string, unknown>;

  writeFileSync(join(root, "galley.config.json"), JSON.stringify({ ...config, dev: { port: devPort } }));
  const { site, of } = await openSite(root, { watch: true, overlayScript: () => "window.__overlayLoaded = true;" });
  const starting = site.preview().start();
  const { createServer } = await import("node:http");
  const other = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><head></head><body><h1>Another program's page</h1></body></html>");
  });

  // Wait until Astro has said where it listens, then take 127.0.0.1:devPort.
  await until(() => site.preview().status().log.some((line) => /Local\s+https?:\/\/localhost:/.test(line)), 40_000, 20);
  const took = await new Promise<boolean>((resolve) => {
    other.once("error", () => resolve(false));
    other.listen(devPort, "127.0.0.1", () => resolve(true));
  });

  try {
    const status = await starting;

    // If Astro happened to bind 127.0.0.1 too, the other program couldn't get it; the point is only tested when it did.
    if (!took) return;
    expect(status.state, status.log.join("\n")).toBe("ready");
    let html = "";

    await until(async () => {
      html = await page(`${status.url}/`);
      return html.includes("home you already have");
    }, 30_000, 200).catch((error: Error) => {
      throw new Error(`${error.message}\n${html.slice(0, 300)}\n${site.preview().status().log.join("\n")}`);
    });
    expect(html).not.toContain("Another program's page");
    for (const event of of("preview.status").filter((each) => each.status.state === "ready")) expect(await page(`${event.status.url}/`)).not.toContain("Another program's page");
  } finally {
    await site.dispose();
    await new Promise((done) => other.close(done));
  }
});

it("previews the real site, shows an edit through hot reload, and cleans up after itself", { timeout: 120_000 }, async () => {
  const root = makeSite({ nodeModules: true });
  const devPort = await freePort();
  const config = JSON.parse(readFileSync(join(root, "galley.config.json"), "utf8")) as Record<string, unknown>;

  // A port of our own, so a dev server someone already runs on 4321 is never adopted.
  writeFileSync(join(root, "galley.config.json"), JSON.stringify({ ...config, dev: { command: `astro dev --port ${devPort} --host 127.0.0.1`, port: devPort } }));
  const { site, of } = await openSite(root, { watch: true, overlayScript: () => "window.__overlayLoaded = true;" });
  const coldStart = Date.now();
  const status = await site.preview().start();
  const readyMs = Date.now() - coldStart;

  expect(status.state, status.log.join("\n")).toBe("ready");
  expect(status.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(of("preview.status").map((event) => event.status.state)).toEqual(expect.arrayContaining(["starting", "ready"]));
  // "Ready" is the first HTTP answer. Astro restarts Vite once right after its
  // first content sync, and a request in that window gets a bare "Cannot GET /",
  // so wait for the first real render of the page.
  let html = "";

  await until(async () => {
    html = await page(`${status.url}/`);
    return html.includes("home you already have");
  }, 30_000, 200).catch((error: Error) => {
    throw new Error(`${error.message}\n${html.slice(0, 300)}\n${site.preview().status().log.join("\n")}`);
  });
  const renderedMs = Date.now() - coldStart;

  expect(html).toContain(OVERLAY_TAG);
  expect(html).toMatch(/Make more of the <em>home you already have<\/em>\./);
  expect(await page(`${status.url}${OVERLAY_SCRIPT_PATH}`)).toBe("window.__overlayLoaded = true;");

  const editedAt = Date.now();

  await site.updateEntry(HOME, [{ op: "set", path: ["sections", 0, "heading"], value: "Proof that the preview *follows edits*." }]);
  await until(async () => (await page(`${status.url}/`)).includes("Proof that the preview <em>follows edits</em>."), 60_000, 250);
  const visibleMs = Date.now() - editedAt;
  const proxyPort = Number(new URL(status.url!).port);
  const pid = (site as OpenSite).previewHandle()!.pid;

  console.info(`preview: cold start to ready ${readyMs} ms, to first full render ${renderedMs} ms, edit to visible ${visibleMs} ms`);
  expect(await answers(devPort)).toBe(true);
  expect(pid).toBeGreaterThan(1);
  await site.dispose();
  expect(of("preview.status").at(-1)?.status.state).toBe("stopped");
  expect(await answers(proxyPort)).toBe(false);
  await until(async () => !(await answers(devPort)), 10_000);
  // Astro may re-exec itself from the package store, so its command line need
  // not mention the site folder: check by pid and by the unique port as well.
  await until(() => processesUnder(root) === "" && processesUnder(`port ${devPort} `) === "" && !alive(pid!), 10_000);
  expect(processesUnder(root)).toBe("");
});
