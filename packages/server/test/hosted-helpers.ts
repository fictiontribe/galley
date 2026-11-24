/**
 * Helpers for tests against a started hosted install: real folders, real
 * local git repositories, a fake site whose "dev server" is a tiny node
 * http server, and plain node:http requests where the test sets the Host
 * header itself (the editor, the preview and the live comparison are three
 * names for one port).
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Job } from "@galley/core/types";
import { startServer } from "../src/server";
import type { RunningServer, ServerOptions } from "../src/types";

export const PASSWORD = "correct horse battery staple";
export const EDITOR_HOST = "cms.localhost";
export const PREVIEW_HOST = "preview.cms.localhost";
export const LIVE_HOST = "live.cms.localhost";
export const EDITOR = `https://${EDITOR_HOST}`;

export interface Sandbox {
  root: string;
  folder(prefix: string): string;
  cleanup(): Promise<void>;
  running: RunningServer[];
}

export function sandbox(name: string): Sandbox {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `galley-${name}-`)));
  const gitConfig = join(root, "gitconfig");
  let counter = 0;
  const running: RunningServer[] = [];

  writeFileSync(gitConfig, "[init]\n\tdefaultBranch = main\n[user]\n\tname = Test Person\n\temail = test@example.com\n");
  process.env.GIT_CONFIG_GLOBAL = gitConfig;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  return {
    root,
    running,
    folder(prefix) {
      counter += 1;
      const dir = join(root, `${prefix}-${counter}`);

      mkdirSync(dir, { recursive: true });
      return dir;
    },
    async cleanup() {
      await Promise.all(running.splice(0).map((server) => server.close({ graceMs: 0 }).catch(() => undefined)));
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

/** The fake site's dev server: a page, a cookie echo, a WebSocket echo; every request's cookies written down in `.seen.log`. */
export const DEV_SERVER = `
import http from "node:http";
import crypto from "node:crypto";
import { appendFileSync } from "node:fs";
const seen = (line) => appendFileSync(".seen.log", line + "\\n");
const server = http.createServer((req, res) => {
  seen("request " + req.url + " cookie=" + (req.headers.cookie ?? ""));
  if (req.url === "/echo") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ cookie: req.headers.cookie ?? null, memory: process.env.NODE_OPTIONS ?? null }));
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><head><title>Site</title></head><body>the fake site</body></html>");
});
server.on("upgrade", (req, socket) => {
  seen("upgrade " + req.url + " cookie=" + (req.headers.cookie ?? ""));
  const accept = crypto.createHash("sha1").update(String(req.headers["sec-websocket-key"]) + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: " + accept + "\\r\\n\\r\\n");
  socket.on("data", (data) => socket.write(data));
});
server.listen(0, "127.0.0.1", () => {
  seen("pid " + process.pid);
  console.log("Local http://localhost:" + server.address().port + "/");
});
`;

/** A bare repository holding the fake site (dev command `node server.mjs`), optionally with a live address. */
export function siteRepository(box: Sandbox, options: { liveUrl?: string; extra?: Record<string, string> } = {}): string {
  const bare = join(box.folder("remote"), "site.git");
  const work = box.folder("seed");

  mkdirSync(bare);
  git(bare, "init", "-q", "--bare", "-b", "main");
  git(work, "init", "-q", "-b", "main");
  const files: Record<string, string> = {
    "galley.config.json": JSON.stringify({ name: "Harbour Notes", dev: { command: "node server.mjs" }, ...(options.liveUrl ? { urls: { production: options.liveUrl } } : {}) }, null, 2),
    "server.mjs": DEV_SERVER,
    "src/content/pages/index.md": "---\ntitle: Home\n---\nHello\n",
    ".gitignore": ".seen.log\nnode_modules\n",
    ...options.extra,
  };

  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(work, path, ".."), { recursive: true });
    writeFileSync(join(work, path), content);
  }
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "First");
  git(work, "push", "-q", bare, "main");
  return bare;
}

export interface Started {
  server: RunningServer;
  port: number;
  notices: string[];
  logs: string[];
}

export async function startHosted(box: Sandbox, home: string, env: Record<string, string> = {}, options: Partial<ServerOptions> = {}): Promise<Started> {
  const notices: string[] = [];
  const logs: string[] = [];
  const server = await startServer({
    port: 0,
    host: "127.0.0.1",
    mode: "hosted",
    home,
    webDir: join(box.root, "no-ui"),
    env: { PATH: process.env.PATH, HOME: box.root, GALLEY_MCP: "off", GALLEY_ALLOW_LOCAL_REPOSITORIES: "1", ...env },
    notice: (line) => notices.push(line),
    log: (line) => logs.push(line),
    siteInstall: async () => {},
    ...options,
  });

  box.running.push(server);
  return { server, port: server.port, notices, logs };
}

export async function stopHosted(box: Sandbox, started: Started): Promise<void> {
  box.running.splice(box.running.indexOf(started.server), 1);
  await started.server.close({ graceMs: 0 });
}

export interface Answer<T = any> {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  bytes: Buffer;
  body: T;
  /** "name=value" pairs from Set-Cookie (cleared ones left out). */
  cookies: string[];
}

export interface CallInit {
  host?: string;
  body?: unknown;
  raw?: Buffer | string;
  cookie?: string;
  bearer?: string;
  /** Default: the editor's origin on anything but GET/HEAD; null sends none. */
  origin?: string | null;
  headers?: Record<string, string>;
}

/** Every answer a test got, for the no-secrets checks. */
export const transcript: string[] = [];

/** One request to 127.0.0.1:`port` with the Host header the test chooses. */
export function call<T = any>(port: number, method: string, path: string, init: CallInit = {}): Promise<Answer<T>> {
  const headers: Record<string, string> = { host: init.host ?? EDITOR_HOST, ...init.headers };
  let payload: Buffer | undefined;

  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    payload = Buffer.from(JSON.stringify(init.body));
  } else if (init.raw !== undefined) {
    headers["content-type"] ??= "application/octet-stream";
    payload = Buffer.isBuffer(init.raw) ? init.raw : Buffer.from(init.raw);
  }
  if (payload) headers["content-length"] ??= String(payload.length);
  if (init.cookie) headers.cookie = init.cookie;
  if (init.bearer) headers.authorization = `Bearer ${init.bearer}`;
  if (init.origin !== null && method !== "GET" && method !== "HEAD") headers.origin = init.origin ?? EDITOR;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];

      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const bytes = Buffer.concat(chunks);
        const text = bytes.toString("utf8");
        let body: unknown = null;

        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = null;
        }
        const setCookie = res.headers["set-cookie"] ?? [];

        transcript.push(`${method} ${init.host ?? EDITOR_HOST}${path} ${res.statusCode} ${JSON.stringify(res.headers)} ${text}`);
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          text,
          bytes,
          body: body as T,
          cookies: setCookie.map((line) => line.split(";")[0]!).filter((pair) => !pair.endsWith("=")),
        });
      });
      res.on("error", reject);
    });

    // A server that answers before reading the whole body (413) closes it: the answer still counts.
    req.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EPIPE" || error.code === "ECONNRESET") setTimeout(() => reject(error), 5000).unref();
      else reject(error);
    });
    req.end(payload);
  });
}

export async function signIn(port: number, password = PASSWORD): Promise<string> {
  const answer = await call(port, "POST", "/api/auth/login", { body: { password } });

  if (answer.status !== 200) throw new Error(`sign-in failed: ${answer.status} ${answer.text}`);
  return answer.cookies[0]!;
}

export async function waitForJob(port: number, job: Job, auth: { cookie?: string; bearer?: string }, timeoutMs = 60_000): Promise<Job> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const current = await call<Job>(port, "GET", `/api/jobs/${job.id}`, auth);

    if (current.status !== 200) throw new Error(`the job couldn't be read: ${current.status} ${current.text}`);
    if (current.body.state !== "running") return current.body;
    if (Date.now() > deadline) throw new Error("the job didn't finish");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Opens a WebSocket upgrade on `host`; resolves with the status line and, on 101, whether an echo came back. */
export function upgrade(port: number, host: string, cookie?: string): Promise<{ status: number; echoed: boolean }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    let received = "";
    let upgraded = false;

    socket.on("error", reject);
    socket.on("connect", () => {
      socket.write(
        [
          "GET /hmr HTTP/1.1",
          `Host: ${host}`,
          "Connection: Upgrade",
          "Upgrade: websocket",
          "Sec-WebSocket-Version: 13",
          `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}`,
          ...(cookie ? [`Cookie: ${cookie}`] : []),
          "",
          "",
        ].join("\r\n")
      );
    });
    socket.on("data", (data) => {
      received += data.toString("latin1");
      if (upgraded) {
        if (received.includes("ping-through-the-gateway")) {
          socket.destroy();
          resolve({ status: 101, echoed: true });
        }
        return;
      }
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(received)?.[1] ?? 0);

      if (!status) return;
      if (status !== 101) {
        socket.destroy();
        resolve({ status, echoed: false });
        return;
      }
      if (!upgraded && received.includes("\r\n\r\n")) {
        upgraded = true;
        received = "";
        socket.write("ping-through-the-gateway");
        return;
      }
    });
    setTimeout(() => {
      socket.destroy();
      resolve({ status: 0, echoed: false });
    }, 10_000).unref();
  });
}

/** A "deployed site" for the live comparison. */
export async function liveSite(): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><head><title>Live</title></head><body>the live site</body></html>");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A free port on 127.0.0.1, for a server that must be reached before startServer returns. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;

      server.close(() => resolve(port));
    });
  });
}

export async function until(check: () => Promise<boolean> | boolean, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("the condition never came true");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The entry address's path and query, with where to land. */
export function entryPath(entry: string, to = "/"): string {
  const url = new URL(entry);

  url.searchParams.set("to", to);
  return `${url.pathname}${url.search}`;
}
