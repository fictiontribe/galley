#!/usr/bin/env node
// End-to-end check of a server runtime, the way the desktop shell runs it.
//
//   node scripts/sidecar-e2e.mjs [--assets <dir>] -- <command…>
//
// <command…> is how to start the CLI, e.g. `node packages/cli/bin/galley.js`
// or a compiled single-file executable. The script appends
// `desktop --exit-with-parent --port <n>`, holds the child's stdin, and runs:
// open a git-initialised copy of starters/astro-starter (node_modules
// symlinked) → list → read → edit → proof → publish → an outside edit in a
// nested folder reaches /api/events (recursive watching) → start the preview
// (the site's own dev server behind the proxy) → HTML through the proxy with
// the overlay injected → a WebSocket upgrade through the proxy answered by the
// dev server's HMR socket → close stdin → the server, the proxy and the dev
// server are all gone. Exit code 0 only when every step passed.
//
// --assets points GALLEY_WEB_DIR / GALLEY_STARTERS_DIR at a bundle's asset
// folder (needed by runtimes whose module path isn't on disk).
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const args = process.argv.slice(2);
const split = args.indexOf("--");

if (split < 0 || split === args.length - 1) {
  console.error("Usage: node scripts/sidecar-e2e.mjs [--assets <dir>] -- <command…>");
  process.exit(2);
}
const options = args.slice(0, split);
const command = args.slice(split + 1);
const assets = options[0] === "--assets" ? options[1] : null;

const results = [];
const step = async (name, run) => {
  const started = Date.now();

  try {
    const detail = await run();

    results.push({ name, ok: true, ms: Date.now() - started, detail });
    console.log(`✓ ${name}${detail ? ` — ${detail}` : ""} (${Date.now() - started} ms)`);
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, detail: error.message });
    console.log(`✗ ${name} — ${error.message}`);
    throw error;
  }
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();

      server.close(() => resolve(port));
    });
  });
}

function answers(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = connect({ host, port });

    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-sidecar-e2e-")));
const site = join(tmp, "site");
const starter = join(repo, "starters", "astro-starter");
const git = (...gitArgs) => execFileSync("git", gitArgs, { cwd: site, encoding: "utf8" });

cpSync(starter, site, { recursive: true, filter: (source) => !["node_modules", ".astro", "dist"].includes(basename(source)) });
symlinkSync(realpathSync(join(starter, "node_modules")), join(site, "node_modules"));
git("init", "-q");
git("symbolic-ref", "HEAD", "refs/heads/main");
writeFileSync(join(site, ".git", "info", "exclude"), "node_modules\n");
git("config", "user.name", "Sidecar Test");
git("config", "user.email", "sidecar@example.invalid");
git("add", "-A");
git("commit", "-q", "-m", "First version");

const port = await freePort();
const token = randomBytes(24).toString("base64url");
const base = `http://127.0.0.1:${port}`;
// A clean environment, like an app started from the Finder: no agent variables, no inherited GALLEY_*.
const env = {
  PATH: process.env.PATH,
  HOME: tmp,
  TMPDIR: process.env.TMPDIR ?? "/tmp",
  LANG: "en_US.UTF-8",
  ASTRO_TELEMETRY_DISABLED: "1",
  GALLEY_DESKTOP: "1",
  GALLEY_HOST: "127.0.0.1",
  GALLEY_PORT: String(port),
  GALLEY_TOKEN: token,
  GALLEY_HOME: join(tmp, "home"),
  ...(assets ? { GALLEY_WEB_DIR: join(assets, "web"), GALLEY_STARTERS_DIR: join(assets, "starters") } : {}),
};
const child = spawn(command[0], [...command.slice(1), "desktop", "--exit-with-parent", "--port", String(port)], {
  env,
  stdio: ["pipe", "pipe", "pipe"],
});
let output = "";
let exitCode;
const exited = new Promise((resolve) =>
  child.once("exit", (code, signal) => {
    exitCode = code ?? signal;
    resolve();
  })
);

child.stdout.on("data", (chunk) => (output += chunk));
child.stderr.on("data", (chunk) => (output += chunk));

async function api(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text.slice(0, 300)}`);
  return json;
}

let siteId = "";
let previewPort = 0;
let devPort = 0;
let failed = false;

try {
  await step("server answers /api/meta", async () => {
    const deadline = Date.now() + 30_000;

    while (Date.now() < deadline) {
      if (exitCode !== undefined) throw new Error(`exited early (${exitCode}):\n${output}`);
      try {
        const meta = await api("GET", "/api/meta");

        if (!meta.desktop) throw new Error(`desktop flag missing: ${JSON.stringify(meta)}`);
        return `desktop: ${meta.desktop}, version ${meta.version}`;
      } catch (error) {
        if (/desktop flag/.test(error.message)) throw error;
        await delay(150);
      }
    }
    throw new Error(`no answer in 30 s:\n${output}`);
  });

  let entryPath = "";
  let titleField = "";

  await step("open the site", async () => {
    const detail = await api("POST", "/api/sites/open", { path: site });

    siteId = detail.id;
    return `${detail.framework?.name ?? "?"}, ${detail.model.collections.length} collections`;
  });
  await step("list entries", async () => {
    const detail = await api("GET", `/api/sites/${siteId}`);
    const collection = detail.model.collections.find((item) => item.kind === "entries" && item.count > 0 && item.titleField);

    if (!collection) throw new Error("no collection with entries");
    titleField = collection.titleField;
    const list = await api("GET", `/api/sites/${siteId}/entries?collection=${collection.id}`);

    entryPath = list.items[0].path;
    return `${collection.id}: ${list.items.length} entries`;
  });
  await step("read and edit an entry", async () => {
    const entry = await api("GET", `/api/sites/${siteId}/entry?path=${encodeURIComponent(entryPath)}`);
    const edit = await api("PATCH", `/api/sites/${siteId}/entry?path=${encodeURIComponent(entryPath)}`, {
      ops: [{ op: "set", path: [titleField], value: "Sidecar test title" }],
      baseHash: entry.hash,
    });

    if (edit.applied !== 1) throw new Error(JSON.stringify(edit));
    return entryPath;
  });
  await step("proof and publish", async () => {
    const changes = await api("GET", `/api/sites/${siteId}/changes`);

    if (!changes.files.some((file) => file.path === entryPath)) throw new Error(JSON.stringify(changes.files));
    const diff = await api("GET", `/api/sites/${siteId}/diff?path=${encodeURIComponent(entryPath)}`);

    if (!diff.after.includes("Sidecar test title")) throw new Error("diff lacks the edit");
    const published = await api("POST", `/api/sites/${siteId}/publish`, { message: "Sidecar test publish" });

    if (!published.ok) throw new Error(JSON.stringify(published));
    const subject = git("log", "--format=%s", "-n", "1").trim();

    if (subject !== "Sidecar test publish") throw new Error(`last version is “${subject}”`);
    return "committed";
  });
  await step("an outside edit in a nested folder reaches /api/events", async () => {
    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const target = join(site, entryPath);

    // Wait for the hello event before touching the file.
    const deadline = Date.now() + 15_000;

    try {
      while (!buffer.includes("hello")) {
        const { value, done } = await reader.read();

        if (done) throw new Error("stream ended");
        buffer += decoder.decode(value, { stream: true });
      }
      writeFileSync(target, readFileSync(target, "utf8").replace("Sidecar test title", "Edited outside the app"));
      while (Date.now() < deadline) {
        const read = await Promise.race([reader.read(), delay(deadline - Date.now()).then(() => ({ timeout: true }))]);

        if (read.timeout || read.done) break;
        buffer += decoder.decode(read.value, { stream: true });
        const hit = buffer
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => JSON.parse(line.slice(5)))
          .find((event) => event.type === "changes.updated" && event.origin === "external" && event.paths.includes(entryPath));

        if (hit) return `changes.updated ${JSON.stringify(hit.paths)}`;
      }
      throw new Error(`no external changes.updated in 15 s; got:\n${buffer.slice(-800)}`);
    } finally {
      controller.abort();
    }
  });
  await step("start the preview", async () => {
    await api("POST", `/api/sites/${siteId}/preview/start`);
    const deadline = Date.now() + 120_000;
    let status;

    while (Date.now() < deadline) {
      status = await api("GET", `/api/sites/${siteId}/preview`);
      if (status.state === "ready" && status.url) break;
      if (status.state === "error" || status.state === "failed") throw new Error(`${status.detail}\n${status.log.join("\n")}`);
      await delay(500);
    }
    if (status?.state !== "ready") throw new Error(`still ${status?.state}:\n${status?.log.join("\n")}`);
    previewPort = Number(new URL(status.url).port);
    const announced = status.log.map((line) => /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d+)/.exec(line)).find(Boolean);

    devPort = announced ? Number(announced[1]) : 0;
    return `proxy ${status.url}, dev server port ${devPort || "?"}`;
  });
  await step("HTML through the preview proxy, overlay injected", async () => {
    const response = await fetch(`http://127.0.0.1:${previewPort}/`);
    const html = await response.text();

    if (response.status !== 200) throw new Error(`status ${response.status}`);
    if (!html.includes("/__galley/overlay.js")) throw new Error("overlay script not injected");
    if (response.headers.get("x-frame-options")) throw new Error("X-Frame-Options not stripped");
    return `${html.length} bytes`;
  });
  await step("WebSocket upgrade through the preview proxy (HMR)", async () => {
    // Vite only accepts HMR sockets that carry the per-server token baked into its client script.
    const client = await (await fetch(`http://127.0.0.1:${previewPort}/@vite/client`)).text();
    const wsToken = /const wsToken = "([^"]+)"/.exec(client)?.[1];
    const hmrPath = /const socketHost = `[^`]*\$\{"(\/[^"]*)"\}`/.exec(client)?.[1] ?? "/";

    if (!wsToken) throw new Error("couldn't find Vite's wsToken in /@vite/client");
    const key = randomBytes(16).toString("base64");
    const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    const reply = await new Promise((resolve, reject) => {
      const socket = connect({ host: "127.0.0.1", port: previewPort });
      let data = Buffer.alloc(0);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`no upgrade in 10 s: ${JSON.stringify(data.toString("latin1").slice(0, 300))}`));
      }, 10_000);

      socket.once("connect", () =>
        socket.write(
          [
            `GET ${hmrPath}?token=${encodeURIComponent(wsToken)} HTTP/1.1`,
            `Host: 127.0.0.1:${previewPort}`,
            "Upgrade: websocket",
            "Connection: Upgrade",
            `Sec-WebSocket-Key: ${key}`,
            "Sec-WebSocket-Version: 13",
            "Sec-WebSocket-Protocol: vite-hmr",
            `Origin: http://127.0.0.1:${previewPort}`,
            "",
            "",
          ].join("\r\n")
        )
      );
      socket.on("data", (chunk) => {
        data = Buffer.concat([data, chunk]);
        const text = data.toString("latin1");

        // Vite greets a new HMR client with {"type":"connected"} right after the handshake.
        if (text.includes("\r\n\r\n") && (text.includes("connected") || !text.startsWith("HTTP/1.1 101"))) {
          clearTimeout(timer);
          socket.destroy();
          resolve(text);
        }
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    if (!reply.startsWith("HTTP/1.1 101")) throw new Error(`answered ${JSON.stringify(reply.slice(0, 200))}`);
    if (!reply.toLowerCase().includes(`sec-websocket-accept: ${accept.toLowerCase()}`)) throw new Error("wrong Sec-WebSocket-Accept");
    if (!reply.includes('"connected"')) throw new Error("no HMR greeting frame");
    return "101 Switching Protocols + HMR “connected” frame";
  });
} catch {
  failed = true;
} finally {
  await step("closing stdin stops the server, the proxy and the dev server", async () => {
    child.stdin.end();
    const started = Date.now();

    await Promise.race([exited, delay(15_000)]);
    if (exitCode === undefined) {
      child.kill("SIGKILL");
      throw new Error("still running 15 s after stdin closed");
    }
    await delay(300);
    const left = [];

    if (await answers(port)) left.push(`server :${port}`);
    if (previewPort && (await answers(previewPort))) left.push(`proxy :${previewPort}`);
    if (devPort && ((await answers(devPort)) || (await answers(devPort, "::1")))) left.push(`dev server :${devPort}`);
    if (left.length) throw new Error(`still listening: ${left.join(", ")}`);
    return `exit ${exitCode} after ${Date.now() - started} ms; nothing listening`;
  }).catch(() => (failed = true));
  if (failed) console.log(`\n— server output —\n${output.slice(-4000)}`);
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
