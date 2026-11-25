import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OVERLAY_SCRIPT_PATH, PROXY_HEALTH_PATH } from "../../src/api";
import type { PreviewStatus } from "../../src/types";
import { listenerStartedHere, type PortStanding } from "../../src/workspace/preview/owner";
import { createPortPool, parsePortRange, portIsFree } from "../../src/workspace/preview/ports";
import { HELD_DETAIL, isWorkingPage, portArguments } from "../../src/workspace/preview/controller";
import {
  createPreviewController,
  detectPid,
  detectPort,
  expandOutputLine,
  isAgentMarker,
  injectIntoHtml,
  overlayTagWithStatus,
  parseCommand,
  stripFrameAncestors,
  type PreviewControllerHandle,
  type PreviewSettings,
} from "../../src/workspace/index";
import { cleanupAll, tempDir, until, writeTree } from "./helpers";

/** A stand-in dev server: frame-blocking headers, gzip on one route, a WebSocket echo, and a grandchild process. */
const DEV_SERVER = `
import http from "node:http";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync("pids.json", JSON.stringify({ self: process.pid, grandchild: grandchild.pid }));
const page = "<!doctype html><html><head><title>T</title></head><body><h1>Hello</h1></body></html>";
const blocking = { "x-frame-options": "DENY", "content-security-policy": "default-src 'self'; frame-ancestors 'none'; img-src *" };
const server = http.createServer((req, res) => {
  const port = server.address().port;
  if (req.url === "/gzip") {
    const body = zlib.gzipSync(page);
    res.writeHead(200, { ...blocking, "content-type": "text/html; charset=utf-8", "content-encoding": "gzip", "content-length": body.length });
    return res.end(body);
  }
  if (req.url === "/app.js") {
    res.writeHead(200, { ...blocking, "content-type": "text/javascript" });
    return res.end("console.log('</head>')");
  }
  if (req.url === "/redirect") {
    res.writeHead(302, { location: "http://localhost:" + port + "/landing/" });
    return res.end();
  }
  if (req.url === "/moved") {
    res.writeHead(308, { location: "/moved/", "cache-control": "public, max-age=3600" });
    return res.end();
  }
  if (req.url === "/hashed.js") {
    res.writeHead(200, { "content-type": "text/javascript", "cache-control": "public, max-age=31536000, immutable" });
    return res.end("1");
  }
  if (req.url === "/broken") {
    // Astro's dev error page: no <html>, no <head>, the message comes later over the socket.
    res.writeHead(500, { "content-type": "text/html" });
    return res.end("<title>Error</title><script type=\\"module\\" src=\\"/@vite/client\\"></script>");
  }
  if (req.url === "/echo") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ host: req.headers.host, origin: req.headers.origin ?? null }));
  }
  res.writeHead(200, { ...blocking, "content-type": "text/html; charset=utf-8" });
  res.end(page);
});
server.on("upgrade", (req, socket) => {
  const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: " + accept + "\\r\\n\\r\\n");
  socket.on("data", (data) => socket.write(data));
});
server.listen(0, "127.0.0.1", () => console.log("  \\u001b[32mLocal\\u001b[0m:   http://localhost:" + server.address().port + "/"));
`;

/** A server that runs detached from whoever started it, like a backgrounded dev server. */
const BG_SERVER = `
import http from "node:http";
import { writeFileSync } from "node:fs";
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><head></head><body>background</body></html>");
});
server.listen(0, "127.0.0.1", () => writeFileSync("bg.json", JSON.stringify({ port: server.address().port, pid: process.pid })));
`;

/**
 * Behaves like Astro 7's dev command: with an agent marker in its environment
 * (or FIXTURE_MODE set — vitest itself sets MODE), it starts the server detached, prints one JSON log line and
 * exits 0. Otherwise it serves in the foreground.
 */
const LAUNCHER = `
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
writeFileSync("seen-env.json", JSON.stringify(Object.keys(process.env).filter((k) => /^(AI_AGENT|CLAUDECODE|_*CLAUDE_|CURSOR_AGENT|CURSOR_TRACE|CODEX_)/i.test(k))));
const agent = process.env.AI_AGENT || process.env.CLAUDECODE;
const mode = process.env.FIXTURE_MODE || (agent ? "with-pid" : "foreground");
if (mode === "foreground") {
  const server = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<html><head></head><body>fg</body></html>"); });
  server.listen(0, "127.0.0.1", () => console.log("ready  Local http://localhost:" + server.address().port + "/"));
} else {
  spawn(process.execPath, ["bg-server.mjs"], { detached: true, stdio: "ignore" }).unref();
  const wait = setInterval(() => {
    if (!existsSync("bg.json")) return;
    clearInterval(wait);
    const { port, pid } = JSON.parse(readFileSync("bg.json", "utf8"));
    const message = mode === "with-pid"
      ? "Dev server running at http://localhost:" + port + " (pid " + pid + ")\\n  Stop:   x dev stop\\n  Logs:   x dev logs"
      : "Dev server running at http://localhost:" + port;
    console.log(JSON.stringify({ message, label: "SKIP_FORMAT", level: "info" }));
    process.exit(0);
  }, 20);
}
`;

/**
 * A dev server that serves its own folder's label (label.txt) and takes
 * `--port <n>` the way Astro's does; without it, the system picks a port.
 * It writes everything it was started with to started.json.
 */
const SITE_SERVER = `
import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
const at = process.argv.indexOf("--port");
const port = at === -1 ? 0 : Number(process.argv[at + 1]);
const label = readFileSync("label.txt", "utf8").trim();
writeFileSync("started.json", JSON.stringify({ argv: process.argv.slice(2), env: { PORT: process.env.PORT ?? null, AI_AGENT: process.env.AI_AGENT ?? null, SITE_FLAVOUR: process.env.SITE_FLAVOUR ?? null }, cwd: process.cwd(), pid: process.pid }));
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><head></head><body><h1>" + label + "</h1></body></html>");
});
server.listen(port, "127.0.0.1", () => console.log("  Local   http://localhost:" + server.address().port + "/"));
`;

/**
 * A dev server that insists on the port it is told: it says which port that
 * is (asked.json), takes a moment as a real one does, and stops with the
 * system's own error when the port isn't free by then.
 */
const STRICT_SERVER = `
import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
const host = process.env.LISTEN_ON || "127.0.0.1";
let asked = [];
try { asked = JSON.parse(readFileSync("asked.json", "utf8")); } catch {}
writeFileSync("asked.json", JSON.stringify([...asked, port]));
await new Promise((done) => setTimeout(done, 400));
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><head></head><body><h1>strict</h1></body></html>");
});
// Says where it is only when asked to: one that doesn't leaves the port it was given as all there is to go by.
server.listen(port, host, () => { writeFileSync("listening.txt", String(port)); if (!process.env.SAY_NOTHING) console.log("  Local   http://localhost:" + port + "/"); });
`;

/**
 * A dev server that moves to the next port when the one it is told isn't
 * free, as Astro and Vite do, and says where it is only once it is ready.
 */
const MOVING_SERVER = `
import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
const told = Number(process.argv[process.argv.indexOf("--port") + 1]);
let asked = [];
try { asked = JSON.parse(readFileSync("asked.json", "utf8")); } catch {}
writeFileSync("asked.json", JSON.stringify([...asked, told]));
await new Promise((done) => setTimeout(done, 400));
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><head></head><body><h1>moving</h1></body></html>");
});
const listen = (port) => {
  server.once("error", (error) => { if (error.code === "EADDRINUSE") listen(port + 1); else throw error; });
  server.listen(port, "127.0.0.1", () => setTimeout(() => console.log("  Local   http://localhost:" + port + "/"), 900));
};
listen(told);
`;

/**
 * Behaves like a dev server that restarts itself just after its first
 * answer (Astro restarting Vite after its first content sync): the first
 * request gets a page, then the server closes, sits dark for a moment, and
 * comes back serving Astro's error page twice before the real page.
 */
const RESTARTING_SERVER = `
import http from "node:http";
import { appendFileSync } from "node:fs";
let phase = "first";
let errors = 0;
const handler = (req, res) => {
  appendFileSync("requests.log", phase + "\\n");
  if (phase === "first") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body>too early</body></html>");
    phase = "restarting";
    setTimeout(restart, 20);
    return;
  }
  if (errors < 2) {
    errors += 1;
    res.writeHead(500, { "content-type": "text/html" });
    return res.end("<title>Error</title><script type=\\"module\\" src=\\"/@vite/client\\"></script>");
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><head></head><body>settled</body></html>");
};
let server = http.createServer(handler);
let port = 0;
function restart() {
  server.closeAllConnections();
  server.close(() => setTimeout(() => {
    server = http.createServer(handler);
    server.listen(port, "127.0.0.1", () => { phase = "after"; appendFileSync("requests.log", "relistened\\n"); });
  }, 400));
}
server.listen(0, "127.0.0.1", () => {
  port = server.address().port;
  console.log("Local http://localhost:" + port + "/");
});
`;

const controllers: PreviewControllerHandle[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  while (controllers.length) await controllers.pop()?.stop();
  while (servers.length) {
    const server = servers.pop() as http.Server;

    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  cleanupAll();
});

function site(label = "site"): string {
  const root = tempDir("ws-site-");

  writeTree(root, {
    "dev-server.mjs": DEV_SERVER,
    "bg-server.mjs": BG_SERVER,
    "launcher.mjs": LAUNCHER,
    "site-server.mjs": SITE_SERVER,
    "strict-server.mjs": STRICT_SERVER,
    "moving-server.mjs": MOVING_SERVER,
    "restarting-server.mjs": RESTARTING_SERVER,
    "label.txt": label,
  });
  return root;
}

/** Whether this system has what is needed to say which program listens on a port (lsof and ps): the checks are "unknown" without. */
async function canSayWhoseAPortIs(): Promise<boolean> {
  const probe = http.createServer();

  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  try {
    return (await listenerStartedHere((probe.address() as net.AddressInfo).port, process.pid, process.cwd(), -1)) !== "unknown";
  } finally {
    await new Promise((done) => probe.close(done));
  }
}

/** Whether this machine lets a program listen on an address (a runner without IPv6 has no ::1). */
function canListenOn(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();

    probe.once("error", () => resolve(false));
    probe.listen(0, host, () => probe.close(() => resolve(true)));
  });
}

/** A free port on 127.0.0.1, to configure as a site's dev port. */
function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = net.createServer();

    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as net.AddressInfo).port;

      probe.close(() => resolve(port));
    });
  });
}

/**
 * `count` consecutive free ports below the system's ephemeral range (where a
 * dev server asking for "any port" would land), like an operator's range.
 */
async function freeRange(count: number): Promise<number> {
  for (let from = 41000 + Math.floor(Math.random() * 4000); from < 48000; from += count) {
    let ok = true;

    for (let port = from; port < from + count && ok; port += 1) ok = await portIsFree(port);
    if (ok) return from;
  }
  throw new Error("no free range");
}

/** Starts `node site-server.mjs --port <port>` in `root`, as a person would in a terminal. */
async function runOwnServer(root: string, port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["site-server.mjs", "--port", String(port)], { cwd: root, stdio: ["ignore", "pipe", "ignore"] });

  terminals.push(child);
  await new Promise<void>((resolve) => child.stdout!.on("data", (chunk: Buffer) => chunk.toString().includes("Local") && resolve()));
  return child;
}

const terminals: ChildProcess[] = [];

afterEach(() => {
  for (const child of terminals.splice(0)) child.kill("SIGKILL");
});

const stray: number[] = [];

afterEach(() => {
  for (const pid of stray.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
});

function controllerFor(root: string, settings: Partial<PreviewSettings>, extra: Partial<Parameters<typeof createPreviewController>[0]> = {}) {
  const statuses: PreviewStatus[] = [];
  const controller = createPreviewController({
    root,
    settings: () => ({ dev: { command: "node dev-server.mjs", port: null }, packageManager: null, installed: true, urls: {}, ...settings }),
    overlayScript: () => "window.__overlay = true;",
    onStatus: (status) => statuses.push(status),
    ...extra,
  });

  controllers.push(controller);
  return { controller, statuses };
}

/** A controller whose settings reads are counted, with a start that can be held. */
function createCounter(root: string, onSettings: () => void, holdStart: () => Promise<void> | null) {
  const controller = createPreviewController({
    root,
    settings: () => {
      onSettings();
      return { dev: { command: "node site-server.mjs", port: null }, packageManager: null, installed: true, urls: {} };
    },
    overlayScript: () => "window.__overlay = true;",
    holdStart,
  });

  return { controller };
}

function listen(handler: http.RequestListener): Promise<number> {
  const server = http.createServer(handler);

  servers.push(server);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)));
}

/** Whether this computer can listen on the IPv6 loopback (some CI containers can't). */
const ipv6Loopback = await new Promise<boolean>((resolve) => {
  const probe = net.createServer();

  probe.once("error", () => resolve(false));
  probe.listen(0, "::1", () => probe.close(() => resolve(true)));
});

function refused(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");

    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(true));
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("helpers", () => {
  it("detects the port a dev server announces", () => {
    expect(detectPort("  ➜  Local:   http://localhost:5173/")).toBe(5173);
    expect(detectPort("┃ Local    http://127.0.0.1:4322/")).toBe(4322);
    expect(detectPort("[11ty] Server at http://[::1]:8080/")).toBe(8080);
    expect(detectPort("\u001b[32mLocal\u001b[0m: http://localhost:\u001b[1m3000\u001b[22m/")).toBe(3000);
    expect(detectPort("building…")).toBeNull();
  });

  it("splits commands without a shell and refuses shell features", () => {
    expect(parseCommand("npm run dev")).toEqual({ env: {}, argv: ["npm", "run", "dev"] });
    expect(parseCommand(`HOST=0 astro dev --title "My site" 'a b'`)).toEqual({ env: { HOST: "0" }, argv: ["astro", "dev", "--title", "My site", "a b"] });
    for (const bad of ["npm run dev && rm -rf /", "a | b", "a; b", "echo $HOME", "a > b", "echo `id`", `echo "$(id)"`, "x 'unclosed"]) {
      expect(() => parseCommand(bad)).toThrow();
    }
  });

  it("strips only frame-ancestors from a CSP and injects before </head>, else after <body>, else appended", () => {
    expect(stripFrameAncestors("default-src 'self'; frame-ancestors 'none'; img-src *")).toBe("default-src 'self'; img-src *");
    expect(stripFrameAncestors("frame-ancestors 'self'")).toBe("");
    const tag = `<script src="${OVERLAY_SCRIPT_PATH}" defer></script>`;

    expect(injectIntoHtml(Buffer.from("<html><HEAD></HEAD><body></body>")).toString()).toBe(`<html><HEAD>${tag}</HEAD><body></body>`);
    expect(injectIntoHtml(Buffer.from('<body class="x">hi')).toString()).toBe(`<body class="x">${tag}hi`);
    expect(injectIntoHtml(Buffer.from("plain")).toString()).toBe(`plain${tag}`);
    expect(injectIntoHtml(Buffer.from(`<head>${tag}</head>`)).toString()).toBe(`<head>${tag}</head>`);
    expect(overlayTagWithStatus(tag, 200)).toBe(tag);
    expect(overlayTagWithStatus(tag, 404)).toBe(`<script data-galley-status="404" src="${OVERLAY_SCRIPT_PATH}" defer></script>`);
    expect(overlayTagWithStatus(tag, 502, true)).toBe(`<script data-galley-status="502" data-galley-unavailable src="${OVERLAY_SCRIPT_PATH}" defer></script>`);
  });
});

describe("preview controller", () => {
  it("starts the dev server, proxies with injection and stripped headers, and leaves nothing behind on stop", async () => {
    const root = site();
    const { controller, statuses } = controllerFor(root, {});
    const status = await controller.start();

    expect(status.state).toBe("ready");
    expect(statuses.map((s) => s.state)).toEqual(["starting", "ready"]);
    expect(controller.status()).toEqual(status);
    const url = status.url as string;

    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const pids = JSON.parse(readFileSync(join(root, "pids.json"), "utf8")) as { self: number; grandchild: number };
    const devPort = Number(/localhost:(\d+)/.exec(status.log.join("\n"))?.[1]);

    // HTML: overlay injected before </head>, frame blocking removed, rest of CSP kept.
    const page = await fetch(url + "/");
    const html = await page.text();

    expect(html).toContain(`<title>T</title><script src="${OVERLAY_SCRIPT_PATH}" defer></script></head>`);
    expect(page.headers.get("x-frame-options")).toBeNull();
    expect(page.headers.get("content-security-policy")).toBe("default-src 'self'; img-src *");
    expect(Number(page.headers.get("content-length"))).toBe(Buffer.byteLength(html));

    // Gzipped HTML is decoded, injected and sent uncompressed.
    const gz = await fetch(url + "/gzip", { headers: { "accept-encoding": "gzip" } });

    expect(gz.headers.get("content-encoding")).toBeNull();
    expect(await gz.text()).toContain(OVERLAY_SCRIPT_PATH);

    // A page the dev server answered with an error carries its status to the overlay, whatever shape the page has.
    const broken = await fetch(url + "/broken");

    expect(broken.status).toBe(500);
    expect(await broken.text()).toBe(`<title>Error</title><script type="module" src="/@vite/client"></script><script data-galley-status="500" src="${OVERLAY_SCRIPT_PATH}" defer></script>`);

    // Non-HTML passes through untouched.
    const js = await fetch(url + "/app.js");

    expect(await js.text()).toBe("console.log('</head>')");
    expect(js.headers.get("x-frame-options")).toBeNull();

    // Host and Origin are rewritten for the dev server's own checks; redirects come back to the proxy.
    expect(await (await fetch(url + "/echo", { headers: { origin: url } })).json()).toEqual({ host: `localhost:${devPort}`, origin: `http://localhost:${devPort}` });
    const redirect = await fetch(url + "/redirect", { redirect: "manual" });

    expect(redirect.headers.get("location")).toBe(`${url}/landing/`);

    // Nothing is kept on a guess: the preview's origin outlives the server behind it. A permanent
    // redirect is never cached, whatever it says; a response with its own policy keeps it.
    expect(redirect.headers.get("cache-control")).toBe("no-store");
    expect(js.headers.get("cache-control")).toBe("no-store");
    const moved = await fetch(url + "/moved", { redirect: "manual" });

    expect(moved.status).toBe(308);
    expect(moved.headers.get("cache-control")).toBe("no-store");
    expect((await fetch(url + "/hashed.js")).headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

    // The proxy's own routes.
    const overlay = await fetch(url + OVERLAY_SCRIPT_PATH);

    expect(await overlay.text()).toBe("window.__overlay = true;");
    expect(overlay.headers.get("cache-control")).toBe("no-store");
    expect(await (await fetch(url + PROXY_HEALTH_PATH)).json()).toEqual({ ok: true, kind: "preview" });

    // WebSocket upgrade (hot reload) is forwarded byte for byte.
    const proxyPort = Number(new URL(url).port);
    const echoed = await new Promise<{ head: string; echo: string }>((resolve, reject) => {
      const socket = net.connect(proxyPort, "127.0.0.1");
      let buffer = "";
      let head = "";

      socket.on("error", reject);
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        if (!head && buffer.includes("\r\n\r\n")) {
          head = buffer.slice(0, buffer.indexOf("\r\n\r\n"));
          buffer = buffer.slice(head.length + 4);
          socket.write("ping");
        }
        if (head && buffer === "ping") {
          socket.destroy();
          resolve({ head, echo: buffer });
        }
      });
      socket.write(
        "GET /hmr HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n"
      );
    });

    expect(echoed.head).toMatch(/^HTTP\/1\.1 101/);
    expect(echoed.head).toContain("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");

    // Stop: idempotent, ports closed, the dev server and its child gone.
    expect(alive(pids.self)).toBe(true);
    expect(alive(pids.grandchild)).toBe(true);
    await controller.stop();
    await controller.stop();
    expect(controller.status()).toMatchObject({ state: "stopped", url: null, baselineUrl: null });
    expect(statuses.filter((s) => s.state === "stopped")).toHaveLength(1);
    expect(await refused(proxyPort)).toBe(true);
    expect(await refused(devPort)).toBe(true);
    await until(() => !alive(pids.self) && !alive(pids.grandchild), 5000);
  });

  it("fronts the deployed site with a baseline proxy: headers stripped, redirects rewritten, the overlay injected to follow", async () => {
    let baselinePort = 0;

    baselinePort = await listen((req, res) => {
      if (req.url === "/old") {
        res.writeHead(301, { location: `http://127.0.0.1:${baselinePort}/new/` });
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": "text/html",
        "x-frame-options": "SAMEORIGIN",
        "content-security-policy": "frame-ancestors 'self'; script-src 'self'",
        "set-cookie": "session=1; Domain=example.org; Path=/",
      });
      res.end(`<html><head></head><body>deployed ${req.headers.host}</body></html>`);
    });
    const { controller } = controllerFor(site(), {
      urls: { staging: `http://127.0.0.1:${baselinePort}`, production: "http://127.0.0.1:1" },
    });
    const status = await controller.start();

    expect(status).toMatchObject({ state: "ready", baselineSource: "staging" });
    const baseline = status.baselineUrl as string;
    const page = await fetch(baseline + "/");

    // The deployed page gets the overlay in its read-only "follow" role, served by the proxy itself.
    expect(await page.text()).toBe(`<html><head><script src="${OVERLAY_SCRIPT_PATH}" data-galley-role="follow" defer></script></head><body>deployed 127.0.0.1:${baselinePort}</body></html>`);
    const overlay = await fetch(baseline + OVERLAY_SCRIPT_PATH);

    expect(overlay.headers.get("content-type")).toContain("javascript");
    expect(await overlay.text()).toBe("window.__overlay = true;");
    expect(page.headers.get("x-frame-options")).toBeNull();
    expect(page.headers.get("content-security-policy")).toBe("script-src 'self'");
    expect(page.headers.get("set-cookie")).toBe("session=1; Path=/");
    const moved = await fetch(baseline + "/old", { redirect: "manual" });

    expect(moved.headers.get("location")).toBe(`${baseline}/new/`);
    // The live site's own headers are its business.
    expect(moved.headers.get("cache-control")).toBeNull();
    expect(await (await fetch(baseline + PROXY_HEALTH_PATH)).json()).toEqual({ ok: true, kind: "baseline" });
    const baselineProxyPort = Number(new URL(baseline).port);

    await controller.stop();
    expect(await refused(baselineProxyPort)).toBe(true);
  });

  it("notes a password-protected deployed site but keeps proxying it", async () => {
    const port = await listen((_req, res) => {
      res.writeHead(401, { "www-authenticate": 'Basic realm="staging"' });
      res.end("auth");
    });
    const { controller } = controllerFor(site(), { urls: { production: `http://127.0.0.1:${port}` } });
    const status = await controller.start();

    expect(status).toMatchObject({ state: "ready", baselineSource: "production" });
    expect(status.detail).toContain("asks for a password");
    const response = await fetch((status.baselineUrl as string) + "/");

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Basic realm="staging"');
  });

  it("adopts a dev server that runs from this site's own folder, and does not stop it", async () => {
    const root = site("own");
    const port = await freeLoopbackPort();

    await runOwnServer(root, port);
    const { controller } = controllerFor(root, { dev: { command: "node site-server.mjs", port, portArgs: ["--port", "{port}"] } });
    const status = await controller.start();

    expect(status.state).toBe("ready");
    expect(status.detail).toContain("already running");
    expect(controller.pid).toBeUndefined();
    expect(await (await fetch((status.url as string) + "/")).text()).toContain("<h1>own</h1>");
    await controller.stop();
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toContain("own");
  });

  it("never adopts a server on the configured port that runs from another folder", async () => {
    // This one runs inside the test process, whose folder is not the site's.
    const port = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><head></head><body>someone else's site</body></html>");
    });
    const root = site("mine");
    const { controller } = controllerFor(root, { dev: { command: "node site-server.mjs", port, portArgs: ["--port", "{port}"] } });
    const status = await controller.start();

    expect(status).toMatchObject({ state: "ready", detail: "The preview is ready." });
    expect(status.log.join("\n")).toContain(`Port ${port} is already used by another program`);
    expect(controller.pid).toBeGreaterThan(0);
    const page = await (await fetch((status.url as string) + "/")).text();

    expect(page).toContain("<h1>mine</h1>");
    expect(page).not.toContain("someone else");
    // Started on a port of its own, which it was told explicitly.
    const started = JSON.parse(readFileSync(join(root, "started.json"), "utf8")) as { argv: string[]; env: { PORT: string } };

    expect(started.argv[0]).toBe("--port");
    expect(Number(started.argv[1])).not.toBe(port);
    expect(started.env.PORT).toBe(started.argv[1]);
  });

  it("passes a free PORT when the configured port is taken and the adapter has no portArgs", async () => {
    const port = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><head></head><body>someone else's site</body></html>");
    });
    const root = site("mine");

    writeTree(root, {
      "env-port-server.mjs": `
import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
const port = Number(process.env.PORT || process.argv[2]);
const label = readFileSync("label.txt", "utf8").trim();
writeFileSync("started.json", JSON.stringify({ portEnv: process.env.PORT ?? null, port }));
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><head></head><body><h1>" + label + "</h1></body></html>");
});
server.listen(port, "127.0.0.1", () => console.log("  Local: http://localhost:" + server.address().port + "/"));
`,
    });
    const { controller } = controllerFor(root, { dev: { command: `node env-port-server.mjs ${port}`, port } });
    const status = await controller.start();

    expect(status).toMatchObject({ state: "ready", detail: "The preview is ready." });
    const page = await (await fetch((status.url as string) + "/")).text();

    expect(page).toContain("<h1>mine</h1>");
    expect(page).not.toContain("someone else");
    const started = JSON.parse(readFileSync(join(root, "started.json"), "utf8")) as { portEnv: string | null; port: number };

    expect(started.portEnv).not.toBeNull();
    expect(Number(started.portEnv)).not.toBe(port);
  });

  it("never proxies the foreign server on the configured port when a dev server announces that port", async () => {
    const port = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><head></head><body>someone else's site</body></html>");
    });
    const root = site("mine");

    writeTree(root, {
      "announce-conflict.mjs": `
import http from "node:http";
import { readFileSync } from "node:fs";
const busyPort = Number(process.argv[2]);
const label = readFileSync("label.txt", "utf8").trim();
console.log("  Local: http://localhost:" + busyPort + "/");
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><head></head><body><h1>" + label + "</h1></body></html>");
});
server.listen(0, "127.0.0.1", () => console.log("  Local: http://localhost:" + server.address().port + "/"));
`,
    });
    const { controller } = controllerFor(root, { dev: { command: `node announce-conflict.mjs ${port}`, port } });
    const status = await controller.start();

    expect(status.state).toBe("ready");
    const page = await (await fetch((status.url as string) + "/")).text();

    expect(page).toContain("<h1>mine</h1>");
    expect(page).not.toContain("someone else");
  });

  // The case seen with `next dev` on macOS: another project's server holds the
  // port on IPv4, and a dev server that falls back to the same port number binds
  // it again on IPv6, so 127.0.0.1 reaches the other project.
  it.skipIf(!ipv6Loopback)("steers a dev server off a port another program holds on IPv4 when it would bind the same number on IPv6", async () => {
    const foreign = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><head></head><body>someone else's site</body></html>");
    });

    servers.push(foreign);
    const port = await new Promise<number>((resolve) => foreign.listen(0, "0.0.0.0", () => resolve((foreign.address() as net.AddressInfo).port)));
    const root = site("mine");

    writeTree(root, {
      "dual-stack-server.mjs": `
import http from "node:http";
import { readFileSync } from "node:fs";
const port = Number(process.env.PORT || process.argv[2]);
const label = readFileSync("label.txt", "utf8").trim();
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><head></head><body><h1>" + label + "</h1></body></html>");
});
server.listen({ port, host: "::", ipv6Only: true }, () => console.log("  Local: http://localhost:" + port + "/"));
`,
    });
    const { controller } = controllerFor(root, { dev: { command: `node dual-stack-server.mjs ${port}`, port } });
    const status = await controller.start();

    expect(status.state).toBe("ready");
    const page = await (await fetch((status.url as string) + "/")).text();

    expect(page).toContain("<h1>mine</h1>");
    expect(page).not.toContain("someone else");
  });

  it("doesn't adopt a listener it can't identify", async () => {
    const root = site("unknown-owner");
    const port = await freeLoopbackPort();

    await runOwnServer(root, port);
    const asked: number[] = [];
    const { controller } = controllerFor(
      root,
      { dev: { command: "node site-server.mjs", port, portArgs: ["--port", "{port}"] } },
      { ownership: async (asking) => (asked.push(asking), "unknown") }
    );
    const status = await controller.start();

    expect(asked).toEqual([port]);
    expect(status.detail).toBe("The preview is ready.");
    expect(status.log.join("\n")).toContain("couldn't be confirmed to be this site's preview");
    expect(controller.pid).toBeGreaterThan(0);
  });

  it("starts the dev server on another port when the one it chose is taken before the dev server could ask for it", async () => {
    // Between choosing a free port and the dev server asking for it, the port can go to something else: on Linux
    // the next outgoing connection of any program may be given it. A dev server that insists on its port then stops.
    const root = site("strict");
    const port = await freeLoopbackPort();
    const { controller } = controllerFor(root, { dev: { command: "node strict-server.mjs", port, portArgs: ["--port", "{port}"] } });
    const starting = controller.start();
    // The moment the dev server says which port it was told, and before it asks for it, something else takes it.
    await until(() => existsSync(join(root, "asked.json")), 5000, 10);
    const told = (JSON.parse(readFileSync(join(root, "asked.json"), "utf8")) as number[])[0]!;
    const taker = http.createServer((_req, res) => res.end("not this site"));

    servers.push(taker);
    await new Promise<void>((done) => taker.listen(told, "127.0.0.1", done));
    const status = await starting;

    expect(status.state).toBe("ready");
    expect(await (await fetch((status.url as string) + "/")).text()).toContain("<h1>strict</h1>");
    const asked = JSON.parse(readFileSync(join(root, "asked.json"), "utf8")) as number[];

    // Started twice, the second time somewhere else; and the log says why.
    expect(asked).toHaveLength(2);
    expect(asked[1]).not.toBe(asked[0]);
    expect(status.log.join("\n")).toContain(`Port ${told} was taken by another program before the preview could use it, so the preview is starting again on another port.`);
  });

  /** Waits until the dev server in `root` has said which port it was told, and has something else take that port first. */
  async function takeThePortFirst(root: string, how: "answering" | "silent"): Promise<number> {
    await until(() => existsSync(join(root, "asked.json")), 5000, 10);
    const told = (JSON.parse(readFileSync(join(root, "asked.json"), "utf8")) as number[])[0]!;

    if (how === "answering") {
      const taker = http.createServer((_req, res) => res.end("<html><head></head><body><h1>not this site</h1></body></html>"));

      servers.push(taker);
      await new Promise<void>((done) => taker.listen(told, "127.0.0.1", done));
    } else {
      // Has the port and says nothing on it: what a dev server finds when the system gave the port to something else.
      const taker = net.createServer((socket) => socket.destroy());

      silent.push(taker);
      await new Promise<void>((done) => taker.listen(told, "127.0.0.1", done));
    }
    return told;
  }
  const silent: net.Server[] = [];

  afterEach(async () => {
    while (silent.length) await new Promise((done) => silent.pop()!.close(done));
  });

  it("starts the dev server again on another port when the one it chose was taken by something that says nothing", async () => {
    const root = site("strict");
    const port = await freeLoopbackPort();
    const { controller } = controllerFor(root, { dev: { command: "node strict-server.mjs", port, portArgs: ["--port", "{port}"] } });
    const starting = controller.start();
    const told = await takeThePortFirst(root, "silent");
    const status = await starting;

    expect(status.state).toBe("ready");
    expect(await (await fetch((status.url as string) + "/")).text()).toContain("<h1>strict</h1>");
    expect(JSON.parse(readFileSync(join(root, "asked.json"), "utf8"))).toHaveLength(2);
    expect(status.log.join("\n")).toContain(`Port ${told} was taken by another program before the preview could use it, so the preview is starting again on another port.`);
  });

  it("follows the dev server to the next port when it moves there by itself and says so late", async () => {
    // What Astro and Vite do with a port that is taken: use the next one, and announce it once they are ready.
    // By then the port they were given has long been answering, for the program that took it. The preview waits
    // for the dev server's own port rather than settling on the other program's, and doesn't start it over.
    const root = site("moving");
    const port = await freeLoopbackPort();
    const { controller, statuses } = controllerFor(root, { dev: { command: "node moving-server.mjs", port, portArgs: ["--port", "{port}"] } });
    const starting = controller.start();

    await takeThePortFirst(root, "answering");
    const status = await starting;

    expect(status.state, status.log.join("\n")).toBe("ready");
    expect(await (await fetch((status.url as string) + "/")).text()).toContain("<h1>moving</h1>");
    // The dev server moved itself; the controller did not start it again (one spawn) and never said it was ready
    // on the other program's port.
    expect(JSON.parse(readFileSync(join(root, "asked.json"), "utf8"))).toHaveLength(1);
    expect(statuses.filter((each) => each.state === "ready")).toHaveLength(1);
    expect(status.log.join("\n")).not.toContain("starting again on another port");
  });

  it.each([
    ["the other program on 127.0.0.1, the dev server on ::1", "127.0.0.1", "::1"],
    ["the other program on ::1, the dev server on 127.0.0.1", "::1", "127.0.0.1"],
  ] as const)("never shows another program's pages when the two share a port number on different addresses (%s)", async (_which, otherOn, devOn) => {
    // One port number can have two listeners at once, each on its own address. The preview asks both addresses and
    // uses whichever answers first, so "a listener on this port is ours" is not enough: every one of them has to be.
    if (!(await canListenOn("::1"))) return;
    const root = site("strict");
    const port = await freeLoopbackPort();
    const { controller, statuses } = controllerFor(root, { dev: { command: "node strict-server.mjs", port, portArgs: ["--port", "{port}"] }, environment: { LISTEN_ON: devOn, SAY_NOTHING: "1" } });
    const starting = controller.start();

    // The other program arrives the moment the dev server has its address, so both are listening when the preview
    // looks: whichever address the preview asks first, it must not settle on the other program's.
    await until(() => existsSync(join(root, "listening.txt")), 5000, 2);
    const told = Number(readFileSync(join(root, "listening.txt"), "utf8"));
    const other = http.createServer((_req, res) => res.end("<html><head></head><body><h1>not this site</h1></body></html>"));

    servers.push(other);
    await new Promise<void>((done) => other.listen(told, otherOn, done));
    const status = await starting;

    expect(status.state, status.log.join("\n")).toBe("ready");
    expect(await (await fetch((status.url as string) + "/")).text()).toContain("<h1>strict</h1>");
    expect(statuses.filter((each) => each.state === "ready")).toHaveLength(1);
    // The port wasn't this preview's alone, so the dev server was started again somewhere that is.
    expect(JSON.parse(readFileSync(join(root, "asked.json"), "utf8"))).toHaveLength(2);
    expect(status.log.join("\n")).toContain(`Port ${told} was taken by another program`);
  });

  it("re-checks the other address of a confirmed port, so a program that takes it later is not shown", async () => {
    // The port is confirmed to carry only the dev server (on ::1). Then a foreign program binds 127.0.0.1 of that
    // same number — the address the preview reaches first — in the settle gap. Keyed by the address confirmed, the
    // preview re-checks the new address (it now finds the port shared) and starts again on another; keyed only by the
    // port number it would trust the stale verdict and show the foreign page. The ownership check is stood in for so
    // the window is hit squarely, not raced: it answers "own" until the foreign is up, then "shared" for that port.
    if (!(await canListenOn("::1"))) return;
    const root = site("otheraddr");
    const port = await freeLoopbackPort();

    writeTree(root, {
      "two-addr-server.mjs": `
import http from "node:http";
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
http.createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<html><head></head><body><h1>the site</h1></body></html>"); }).listen(port, "::1");
`,
    });
    let confirmedPort = false;
    let foreignUp = false;
    // Stands in for listenerStartedHere: the confirmed port reads "own" until the foreign binds it, then "shared".
    // Keyed on the number so a restart's fresh port is clean. Setting confirmedPort lets the test wait for the first
    // confirmation before it binds the foreign, so ::1 is cached before 127.0.0.1 is ever reached.
    const startedHere = async (asking: number): Promise<PortStanding> => {
      if (asking === port) confirmedPort = true;
      return asking === port && foreignUp ? "shared" : "own";
    };
    const { controller } = controllerFor(root, { dev: { command: "node two-addr-server.mjs", port, portArgs: ["--port", "{port}"] } }, { startedHere });
    const starting = controller.start();
    const other = http.createServer((_req, res) => res.end("<html><head></head><body><h1>not this site</h1></body></html>"));

    servers.push(other);
    // Only once ::1:port is confirmed the preview's own — and so cached by that address — take 127.0.0.1 of that port.
    await until(() => confirmedPort, 8000, 2);
    await new Promise<void>((done) => other.listen(port, "127.0.0.1", () => ((foreignUp = true), done())));
    const status = await starting;

    expect(status.state, status.log.join("\n")).toBe("ready");
    const page = await (await fetch((status.url as string) + "/")).text();

    expect(page).not.toContain("not this site");
    expect(page).toContain("<h1>the site</h1>");
  });

  it("gives up with a sentence that names the setting when every port it is given is shared with another program", async () => {
    const root = site("strict");
    const port = await freeLoopbackPort();
    // Every port this preview is told has its dev server and another program both: a shared port, to move off.
    const { controller } = controllerFor(root, { dev: { command: "node strict-server.mjs", port, portArgs: ["--port", "{port}"] } }, { startedHere: async () => "shared" });
    const status = await controller.start();

    expect(status.state).toBe("error");
    expect(status.detail).toMatch(/^Port \d+ keeps being taken by another program before the preview can use it\./);
    expect(status.detail).toContain("dev.trustPort");
    // The first start and two more, and no further.
    expect(JSON.parse(readFileSync(join(root, "asked.json"), "utf8"))).toHaveLength(3);
  });

  it("takes an answer on its port as the dev server's where the system can't say whose it is, and says so with the port", async () => {
    const root = site("unannounced");
    const port = await freeLoopbackPort();

    // A dev server that never says where it is, so the port it was given is all there is to go by.
    writeTree(root, { "quiet-server.mjs": 'import http from "node:http";\nconst port = Number(process.argv[process.argv.indexOf("--port") + 1]);\nhttp.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<html><head></head><body><h1>quiet</h1></body></html>"); }).listen(port, "127.0.0.1");\n' });
    const asked: number[] = [];
    const { controller } = controllerFor(root, { dev: { command: "node quiet-server.mjs", port, portArgs: ["--port", "{port}"] } }, { startedHere: async (asking) => (asked.push(asking), "unknown") });
    const status = await controller.start();

    expect(status.state).toBe("ready");
    // Asked each time the port answered (twice, to settle), about that port and no other; and said once.
    expect([...new Set(asked)]).toEqual([port]);
    expect(asked.length).toBeGreaterThanOrEqual(2);
    expect(status.log.filter((line) => line.includes("couldn't be checked here"))).toEqual([expect.stringContaining(`Port ${port} is answering, and it couldn't be checked here that it is this site's own preview answering`)]);
    // With a system that can say, the same server is found to be this preview's own, and nothing is said.
    await controller.stop();
    const real = controllerFor(root, { dev: { command: "node quiet-server.mjs", port, portArgs: ["--port", "{port}"] } });
    const again = await real.controller.start();

    expect(again.state).toBe("ready");
    expect(await (await fetch((again.url as string) + "/")).text()).toContain("<h1>quiet</h1>");
    if (await canSayWhoseAPortIs()) expect(again.log.join("\n")).not.toContain("couldn't be checked");
  });

  it("doesn't start a dev server again when it stopped for a reason of its own", async () => {
    const root = site("broken");
    const port = await freeLoopbackPort();

    writeTree(root, { "broken-server.mjs": 'import { appendFileSync } from "node:fs";\nappendFileSync("runs.txt", "x");\nconsole.error("SyntaxError: the site is broken");\nprocess.exit(1);\n' });
    const { controller } = controllerFor(root, { dev: { command: "node broken-server.mjs", port, portArgs: ["--port", "{port}"] } });
    const status = await controller.start();

    expect(status.state).toBe("error");
    expect(status.detail).toContain("stopped before it was ready");
    expect(readFileSync(join(root, "runs.txt"), "utf8")).toBe("x");
  });

  it("doesn't start a dev server again when it stopped but its own child still holds the port", async () => {
    // A wrapper exits for its own reason while the server it started, in its process group, still listens. The
    // port isn't free, but the listener is this preview's own, so it is not another program taking it.
    const root = site("wrapper");
    const port = await freeLoopbackPort();

    writeTree(root, { "wrapper.mjs": 'import { appendFileSync } from "node:fs";\nappendFileSync("runs.txt", "x");\nconst held = (await import("node:net")).createServer();\nawait new Promise((d) => held.listen(Number(process.argv[process.argv.indexOf("--port") + 1]), "127.0.0.1", d));\nconsole.error("the wrapper failed");\nprocess.exit(1);\n' });
    // The system says the held port is this preview's own (the child is in its group); only the wrapper exited.
    const { controller } = controllerFor(root, { dev: { command: "node wrapper.mjs", port, portArgs: ["--port", "{port}"] } }, { startedHere: async () => "own" });
    const status = await controller.start();

    expect(status.state).toBe("error");
    expect(status.detail).toContain("stopped before it was ready");
    expect(readFileSync(join(root, "runs.txt"), "utf8")).toBe("x");
  });

  it("takes the port on trust, without checking which program has it, when the site's settings say to", async () => {
    const root = site("strict");
    const port = await freeLoopbackPort();
    const asked: number[] = [];
    // A program answers on the port before the dev server; with trustPort the preview settles on it and the check
    // is never asked. (For a dev command that runs its server in a container, that program is the dev server.)
    const { controller } = controllerFor(root, { dev: { command: "node strict-server.mjs", port, portArgs: ["--port", "{port}"], trustPort: true } }, { startedHere: async (asking) => (asked.push(asking), "foreign") });
    const starting = controller.start();
    const other = http.createServer((_req, res) => res.end("<html><head></head><body><h1>the container's dev server</h1></body></html>"));

    servers.push(other);
    await until(() => existsSync(join(root, "asked.json")), 5000, 10);
    await new Promise<void>((done) => other.listen((JSON.parse(readFileSync(join(root, "asked.json"), "utf8")) as number[])[0], "127.0.0.1", done));
    const status = await starting;

    expect(status.state).toBe("ready");
    expect(await (await fetch((status.url as string) + "/")).text()).toContain("the container's dev server");
    expect(asked).toEqual([]);
  });

  it("gives up, naming the setting, when another program holds the port the whole time and the dev server neither stops nor moves", async () => {
    const root = site("idle");
    const port = await freeLoopbackPort();

    // A dev server that writes which port it was told and then stays alive without ever listening on it.
    writeTree(root, { "idle-server.mjs": 'import { readFileSync, writeFileSync } from "node:fs";\nlet a = [];\ntry { a = JSON.parse(readFileSync("asked.json", "utf8")); } catch {}\nwriteFileSync("asked.json", JSON.stringify([...a, Number(process.argv[process.argv.indexOf("--port") + 1])]));\nsetInterval(() => {}, 1000);\n' });
    const { controller } = controllerFor(root, { dev: { command: "node idle-server.mjs", port, portArgs: ["--port", "{port}"] }, environment: {} }, { portHeldMs: 400 });
    const starting = controller.start();

    await takeThePortFirst(root, "answering");
    const status = await starting;

    expect(status.state).toBe("error");
    expect(status.detail).toContain("dev.trustPort");
    // It was not started over: another port would be as invisible.
    expect(JSON.parse(readFileSync(join(root, "asked.json"), "utf8"))).toHaveLength(1);
  });

  it("gives two sites with the same configured port a preview of their own each", async () => {
    const port = await freeLoopbackPort();
    const first = site("Site A");
    const second = site("Site B");
    const dev = { command: "node site-server.mjs", port, portArgs: ["--port", "{port}"] };
    const a = controllerFor(first, { dev });
    const b = controllerFor(second, { dev });
    const [statusA, statusB] = await Promise.all([a.controller.start(), b.controller.start()]);

    expect(statusA.state).toBe("ready");
    expect(statusB.state).toBe("ready");
    expect(await (await fetch((statusA.url as string) + "/")).text()).toContain("<h1>Site A</h1>");
    expect(await (await fetch((statusB.url as string) + "/")).text()).toContain("<h1>Site B</h1>");
    // And again once one of them already holds the port: the other still gets its own.
    await b.controller.stop();
    const again = await b.controller.start();

    expect(await (await fetch((again.url as string) + "/")).text()).toContain("<h1>Site B</h1>");
    expect(await (await fetch((statusA.url as string) + "/")).text()).toContain("<h1>Site A</h1>");
  });

  it("is ready only after two good answers a moment apart, never on an answer just before a restart or on an error page", async () => {
    const root = site();
    const { controller, statuses } = controllerFor(root, { dev: { command: "node restarting-server.mjs", port: null } });
    const status = await controller.start();
    const requests = readFileSync(join(root, "requests.log"), "utf8").trim().split("\n");

    expect(status.state).toBe("ready");
    expect(statuses.map((s) => s.state)).toEqual(["starting", "ready"]);
    // The early answer, the restart, the two error pages, then two good answers.
    expect(requests[0]).toBe("first");
    expect(requests).toContain("relistened");
    expect(requests.filter((line) => line === "after").length).toBeGreaterThanOrEqual(4);
    expect(await (await fetch((status.url as string) + "/")).text()).toContain("settled");
  });

  it("recognises a framework error page", () => {
    expect(isWorkingPage(200, "<html><body>hi</body></html>")).toBe(true);
    expect(isWorkingPage(404, "Not found")).toBe(true);
    expect(isWorkingPage(500, `<title>Error</title><script type="module" src="/@vite/client"></script>`)).toBe(false);
    expect(isWorkingPage(200, "<html><body><vite-error-overlay></vite-error-overlay></body></html>")).toBe(false);
    expect(isWorkingPage(0, "")).toBe(false);
    expect(portArguments(["--port", "{port}"], 4322)).toEqual(["--port", "4322"]);
    expect(portArguments(["--port={port}"], 8080)).toEqual(["--port=8080"]);
  });

  it("runs the dev server with the adapter's environment, applied after inherited markers are removed", async () => {
    const saved = process.env.AI_AGENT;

    process.env.AI_AGENT = "inherited";
    try {
      const root = site();
      const { controller } = controllerFor(root, {
        dev: { command: "node site-server.mjs", port: null },
        environment: { SITE_FLAVOUR: "from-the-adapter", AI_AGENT: "set-on-purpose" },
      });

      expect((await controller.start()).state).toBe("ready");
      const started = JSON.parse(readFileSync(join(root, "started.json"), "utf8")) as { env: Record<string, string | null> };

      expect(started.env).toMatchObject({ SITE_FLAVOUR: "from-the-adapter", AI_AGENT: "set-on-purpose" });
    } finally {
      if (saved === undefined) delete process.env.AI_AGENT;
      else process.env.AI_AGENT = saved;
    }
  });

  it("allocates both proxies from the operator's port range, lowest free first, and says plainly when it is full", async () => {
    const first = await freeRange(3);
    const range = parsePortRange(`${first}-${first + 2}`);
    const pool = createPortPool(range);
    let baselinePort = 0;

    baselinePort = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><head></head><body>deployed</body></html>");
    });
    const urls = { production: `http://127.0.0.1:${baselinePort}` };
    const one = controllerFor(site("one"), { dev: { command: "node site-server.mjs", port: null }, urls }, { ports: pool });
    const statusOne = await one.controller.start();

    expect(statusOne.state).toBe("ready");
    const used = [Number(new URL(statusOne.url as string).port), Number(new URL(statusOne.baselineUrl as string).port)].sort();

    expect(used).toEqual([first, first + 1]);
    const two = controllerFor(site("two"), { dev: { command: "node site-server.mjs", port: null }, urls }, { ports: pool });
    const statusTwo = await two.controller.start();

    // One port left: the preview gets it, the baseline can't.
    expect(statusTwo).toMatchObject({ state: "error" });
    expect(statusTwo.detail).toBe(`All 3 preview ports (${first}–${first + 2}) are in use, and 2 previews are open. Stop a preview you aren't using, or give the server more ports with GALLEY_PREVIEW_PORTS.`);
    // Stopping frees its ports for the next one.
    await one.controller.stop();
    const retried = await two.controller.start();

    expect(retried.state).toBe("ready");
    expect(Number(new URL(retried.url as string).port)).toBe(first);
    expect(() => parsePortRange("4429-4410")).toThrow("GALLEY_PREVIEW_PORTS must be a range of ports like 4410-4429");
    expect(parsePortRange("4410–4429")).toEqual({ from: 4410, to: 4429 });
  });

  it("offers the preview with the scheme a TLS-terminating proxy in front serves it on", async () => {
    const { controller } = controllerFor(site(), { dev: { command: "node site-server.mjs", port: null } }, { publicProtocol: "https" });
    const status = await controller.start();

    // The proxy itself still speaks plain HTTP; the address is the one browsers use.
    expect(status.url).toMatch(/^https:\/\/127\.0\.0\.1:\d+$/);
    const port = new URL(status.url as string).port;

    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toContain("<h1>site</h1>");
  });

  it("reports a dev server that exits before it is ready, with its output", async () => {
    const root = site();
    const { controller } = controllerFor(root, { dev: { command: `node -e "console.error('boom: missing module'); process.exit(3)"`, port: null } });
    const status = await controller.start();

    expect(status.state).toBe("error");
    expect(status.detail).toContain("stopped before it was ready");
    expect(status.log.join("\n")).toContain("boom: missing module");
    expect(status.url).toBeNull();
  });

  it("times out a dev server that never answers, and kills it", async () => {
    const root = site();

    writeTree(root, { "hang.mjs": `import { writeFileSync } from "node:fs"; writeFileSync("pid", String(process.pid)); setInterval(() => {}, 1000);` });
    const { controller } = controllerFor(root, { dev: { command: "node hang.mjs", port: null } }, { readyTimeoutMs: 1500 });
    const status = await controller.start();

    expect(status).toMatchObject({ state: "error", detail: expect.stringContaining("didn't start in time") });
    const pid = Number(readFileSync(join(root, "pid"), "utf8"));

    await until(() => !alive(pid), 5000);
  });

  it("explains a missing preview command or binary", async () => {
    const none = controllerFor(site(), { dev: null });

    expect(await none.controller.start()).toMatchObject({ state: "error", detail: expect.stringContaining("no preview command") });
    const missing = controllerFor(site(), { dev: { command: "definitely-not-a-binary-xyz dev", port: null } });

    expect(await missing.controller.start()).toMatchObject({ state: "error", detail: expect.stringContaining("isn't installed") });
  });

  it("installs dependencies first when they are missing", async () => {
    const root = site();

    writeTree(root, { "package.json": JSON.stringify({ name: "t", version: "1.0.0", private: true }) });
    const { controller, statuses } = controllerFor(root, { installed: false, packageManager: "npm" });
    const status = await controller.start();

    expect(status.state).toBe("ready");
    expect(statuses.map((s) => s.state)).toEqual(["installing", "starting", "ready"]);
  }, 90_000);

  it("stop() during start cancels it cleanly — called from the starting event, nothing is left running", async () => {
    const root = site();
    let stopping: Promise<void> | null = null;
    const { controller, statuses } = controllerFor(
      root,
      { dev: { command: "node site-server.mjs", port: null } },
      {
        onStatus: (status) => {
          statuses.push(status);
          // The earliest a stop can land: synchronously, as start announces itself.
          if (status.state === "starting" && !stopping) stopping = controller.stop();
        },
      }
    );
    const result = await controller.start();

    await stopping;
    expect(result.state).toBe("stopped");
    expect(controller.status().state).toBe("stopped");
    expect(statuses.map((s) => s.state)).toEqual(["starting", "stopped"]);
    expect(controller.pid).toBeUndefined();
    // If the dev server got as far as starting, it has been stopped again.
    if (existsSync(join(root, "started.json"))) {
      const { pid } = JSON.parse(readFileSync(join(root, "started.json"), "utf8")) as { pid: number };

      await until(() => !alive(pid), 5000);
    }
  });

  it("a start that is held reads no settings and runs nothing until it is let go, and stop() ends the wait", async () => {
    const root = site();
    let release: () => void = () => undefined;
    let held: Promise<void> | null = new Promise<void>((resolve) => (release = resolve));
    let settingsRead = 0;
    const { controller, statuses } = controllerFor(
      root,
      { dev: { command: "node site-server.mjs", port: null } },
      { holdStart: () => held }
    );
    const original = controller.status;
    const counted = createCounter(root, () => (settingsRead += 1), () => held);

    controllers.push(counted.controller);
    // Held: it says why, and nothing has been read or run.
    const starting = counted.controller.start();

    await until(() => counted.controller.status().state === "starting");
    expect(counted.controller.status()).toMatchObject({ state: "starting", detail: HELD_DETAIL, url: null });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settingsRead).toBe(0);
    expect(existsSync(join(root, "started.json"))).toBe(false);
    // Let go: the settings are read now, and it starts.
    held = null;
    release();
    expect((await starting).state).toBe("ready");
    expect(settingsRead).toBe(1);
    await counted.controller.stop();

    // Held again, and stopped while it waits: the stop doesn't wait for whatever holds the start.
    held = new Promise<void>(() => undefined);
    const again = controller.start();

    await until(() => original().state === "starting");
    const before = Date.now();

    await controller.stop();
    expect(Date.now() - before).toBeLessThan(2000);
    expect((await again).state).toBe("stopped");
    expect(statuses.map((status) => status.state)).toEqual(["starting", "stopped"]);
    expect(statuses[0]?.detail).toBe(HELD_DETAIL);
    expect(controller.pid).toBeUndefined();
  });

  it("a stop() that lands while start is finishing always wins", async () => {
    const root = site();
    let stopping: Promise<void> | null = null;
    let controllerRef: PreviewControllerHandle | null = null;
    // The deployed site is checked after both proxies exist and just before
    // "ready": stopping from inside that check is the latest a stop can land.
    const baselinePort = await listen((_req, res) => {
      stopping ??= controllerRef!.stop();
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><head></head><body>deployed</body></html>");
    });
    const { controller, statuses } = controllerFor(root, { dev: { command: "node site-server.mjs", port: null }, urls: { production: `http://127.0.0.1:${baselinePort}` } });

    controllerRef = controller;
    const result = await controller.start();

    await stopping;
    expect(result.state).toBe("stopped");
    expect(statuses.map((s) => s.state)).toEqual(["starting", "stopped"]);
    expect(statuses.some((s) => s.state === "ready")).toBe(false);
    const { pid } = JSON.parse(readFileSync(join(root, "started.json"), "utf8")) as { pid: number };

    await until(() => !alive(pid), 5000);
    expect(controller.status()).toMatchObject({ state: "stopped", url: null, baselineUrl: null });
  });

  it("restart() during a start starts afresh rather than joining the cancelled attempt", async () => {
    const { controller } = controllerFor(site("fresh"), { dev: { command: "node site-server.mjs", port: null } });
    const first = controller.start();
    const restarted = await controller.restart();

    expect((await first).state).toBe("stopped");
    expect(restarted.state).toBe("ready");
    expect(await (await fetch((restarted.url as string) + "/")).text()).toContain("<h1>fresh</h1>");
  });

  it("runs the dev command without inherited AI-agent markers, so it stays in the foreground", async () => {
    const markers = { AI_AGENT: "1", CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_AGENT_SDK_VERSION: "1", CURSOR_TRACE_ID: "t", CODEX_SANDBOX: "seatbelt" };
    const saved = Object.fromEntries(Object.keys(markers).map((k) => [k, process.env[k]]));

    Object.assign(process.env, markers);
    const root = site();

    try {
      const { controller } = controllerFor(root, { dev: { command: "node launcher.mjs", port: null } });
      const status = await controller.start();

      expect(status.state).toBe("ready");
      expect(JSON.parse(readFileSync(join(root, "seen-env.json"), "utf8"))).toEqual([]);
      expect(await (await fetch((status.url as string) + "/")).text()).toContain("fg");
      expect(controller.pid).toBeGreaterThan(0);
    } finally {
      if (existsSync(join(root, "bg.json"))) stray.push((JSON.parse(readFileSync(join(root, "bg.json"), "utf8")) as { pid: number }).pid);
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("follows a dev command that backgrounds itself and names its pid, and stops that process", async () => {
    const root = site();
    const { controller } = controllerFor(root, { dev: { command: "FIXTURE_MODE=with-pid node launcher.mjs", port: null } });
    const status = await controller.start();
    const bg = JSON.parse(readFileSync(join(root, "bg.json"), "utf8")) as { port: number; pid: number };

    stray.push(bg.pid);
    expect(status.state).toBe("ready");
    expect(status.log).toContain(`Dev server running at http://localhost:${bg.port} (pid ${bg.pid})`);
    expect(status.log).toContain("  Stop:   x dev stop");
    expect(controller.pid).toBe(bg.pid);
    expect(await (await fetch((status.url as string) + "/")).text()).toContain(OVERLAY_SCRIPT_PATH);
    await controller.stop();
    expect(await refused(bg.port)).toBe(true);
    await until(() => !alive(bg.pid), 5000);
  });

  it("adopts a backgrounded server that names no pid as someone else's, and leaves it running", async () => {
    const root = site();
    const { controller } = controllerFor(root, { dev: { command: "FIXTURE_MODE=no-pid node launcher.mjs", port: null } });
    const status = await controller.start();
    const bg = JSON.parse(readFileSync(join(root, "bg.json"), "utf8")) as { port: number; pid: number };

    stray.push(bg.pid);
    expect(status).toMatchObject({ state: "ready", detail: expect.stringContaining("keeps running after the preview stops") });
    expect(controller.pid).toBeUndefined();
    await controller.stop();
    expect(alive(bg.pid)).toBe(true);
    expect(await refused(bg.port)).toBe(false);
  });

  it("checks a backgrounded server's announced port rather than trusting any host of it", async () => {
    const root = site();
    let asked = 0;
    // The dev server backgrounds itself and names its pid; the ownership check reports its announced port as
    // another program's (as a foreign listener on the port's other address would). Trusting the port on any host,
    // as it did before, would serve that; now the port is checked, found not the dev server's, and not served.
    const { controller } = controllerFor(
      root,
      { dev: { command: "FIXTURE_MODE=with-pid node launcher.mjs", port: null } },
      { startedHere: async () => ((asked += 1), "foreign"), readyTimeoutMs: 3000 }
    );
    const status = await controller.start();
    const bg = JSON.parse(readFileSync(join(root, "bg.json"), "utf8")) as { port: number; pid: number };

    stray.push(bg.pid);
    expect(asked, "the backgrounded port was checked, not trusted on any host").toBeGreaterThan(0);
    expect(status.state, status.log.join("\n")).toBe("error");
    await controller.stop();
  });

  it("unwraps JSON log lines and finds an announced pid", () => {
    const line = JSON.stringify({ message: "Dev server running at http://localhost:4399 (pid 26439)\n  Stop:   astro dev stop", label: "SKIP_FORMAT", level: "info" });

    expect(expandOutputLine(line)).toEqual(["Dev server running at http://localhost:4399 (pid 26439)", "  Stop:   astro dev stop"]);
    expect(detectPort(line)).toBe(4399);
    expect(detectPid(line)).toBe(26439);
    expect(detectPid("no pid here")).toBeNull();
    expect(expandOutputLine("{not json}")).toEqual(["{not json}"]);
    expect(isAgentMarker("CLAUDE_CODE_SSE_PORT")).toBe(true);
    expect(isAgentMarker("claudecode")).toBe(true);
    expect(isAgentMarker("_CLAUDE_CODE_X")).toBe(true);
    expect(isAgentMarker("CLAUDE_PID")).toBe(true);
    expect(isAgentMarker("PATH")).toBe(false);
  });

  it("restart() brings it back", async () => {
    const { controller } = controllerFor(site(), {});
    const first = await controller.start();
    const second = await controller.restart();

    expect(first.state).toBe("ready");
    expect(second.state).toBe("ready");
    expect(await (await fetch((second.url as string) + "/")).text()).toContain(OVERLAY_SCRIPT_PATH);
  });
});
