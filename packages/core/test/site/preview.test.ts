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
import { OVERLAY_TAG, type PreviewControllerHandle } from "../../src/workspace/index";
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
  const pid = (site.preview() as PreviewControllerHandle).pid;

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
