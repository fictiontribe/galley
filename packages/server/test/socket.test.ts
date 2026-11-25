/**
 * GALLEY_SOCKET: the server listens on a Unix socket as well as its port, the
 * same app behind both (health, the gateway, upgrades), and believes the
 * forwarded headers (X-Forwarded-For, X-Forwarded-Proto) of requests that came
 * in on the socket — and, once a socket is set, of no others. Without a
 * socket, GALLEY_TRUST_PROXY works as it always has.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { startServer } from "../src/server";
import type { RunningServer, ServerOptions } from "../src/types";

const made: string[] = [];
const running: RunningServer[] = [];
const holders: net.Server[] = [];

afterEach(async () => {
  for (const server of running.splice(0)) await server.close();
  for (const holder of holders.splice(0)) await new Promise<void>((done) => holder.close(() => done()));
});

afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A short folder (a Unix socket's path has a length limit). */
function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), "gs-"));

  made.push(dir);
  return dir;
}

async function start(options: Partial<ServerOptions> = {}, env: Record<string, string> = {}): Promise<{ server: RunningServer; notices: string[] }> {
  const box = folder();
  const notices: string[] = [];
  const server = await startServer({
    port: 0,
    host: "127.0.0.1",
    mode: "hosted",
    home: join(box, "data"),
    webDir: join(box, "no-ui"),
    env: { PATH: process.env.PATH ?? "", HOME: box, GALLEY_MCP: "off", GALLEY_PUBLIC_URL: "http://cms.example.com", ...env },
    notice: (line) => notices.push(line),
    log: () => undefined,
    siteInstall: async () => {},
    ...options,
  });

  running.push(server);
  return { server, notices };
}

interface Answer {
  status: number;
  body: string;
}

/** One request, over the server's port or its Unix socket, with the headers given as they are (Host included). */
function ask(to: { port: number } | { socketPath: string }, method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const request = http.request({ ...("port" in to ? { host: "127.0.0.1", port: to.port } : { socketPath: to.socketPath }), method, path, headers, agent: false }, (response) => {
      const chunks: Buffer[] = [];

      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });

    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

/** A state-changing request from https://cms.example.com, said to have come in over HTTPS by a proxy. */
function fromHttpsPage(to: { port: number } | { socketPath: string }): Promise<Answer> {
  return ask(
    to,
    "POST",
    "/api/auth/login",
    { host: "cms.example.com", origin: "https://cms.example.com", "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.7", "content-type": "application/json" },
    JSON.stringify({ password: "not it" })
  );
}

const OUTSIDE = "came from outside the app";

describe("the server's Unix socket (GALLEY_SOCKET)", { timeout: 60_000 }, () => {
  it("answers health and the app on the socket as on the port", async () => {
    const socketPath = join(folder(), "galley.sock");
    const { server } = await start({ socket: socketPath });

    expect(server.socket).toBe(socketPath);
    expect(await ask({ socketPath }, "GET", "/healthz")).toMatchObject({ status: 200 });
    expect((await ask({ socketPath }, "GET", "/readyz")).status).toBe(200);
    expect((await ask({ socketPath }, "GET", "/api/meta", { host: "cms.example.com" })).status).toBe(200);
    expect((await ask({ port: server.port }, "GET", "/healthz")).status).toBe(200);
  });

  it("believes the forwarded headers of a request on the socket, and not of the same request on the port", async () => {
    const socketPath = join(folder(), "galley.sock");
    const { server } = await start({ socket: socketPath });
    const onSocket = await fromHttpsPage({ socketPath });
    const onPort = await fromHttpsPage({ port: server.port });

    // On the socket the request is taken to have come over HTTPS, so its https:// origin is the app's own.
    expect(onSocket.body).not.toContain(OUTSIDE);
    // On the port the same headers are anyone's to write: the origin doesn't match, and the request is refused.
    expect(onPort).toMatchObject({ status: 403 });
    expect(onPort.body).toContain(OUTSIDE);
  });

  it("with GALLEY_TRUST_PROXY set as well, still believes only the socket, and says so at start", async () => {
    const socketPath = join(folder(), "galley.sock");
    const { server, notices } = await start({ socket: socketPath }, { GALLEY_TRUST_PROXY: "1" });

    expect((await fromHttpsPage({ socketPath })).body).not.toContain(OUTSIDE);
    expect((await fromHttpsPage({ port: server.port })).body).toContain(OUTSIDE);
    expect(notices.join("\n")).toContain("forwarded headers are believed only for requests that come in on the socket");
  });

  it("without a socket, GALLEY_TRUST_PROXY believes the port as it always has", async () => {
    const { server } = await start({}, { GALLEY_TRUST_PROXY: "1" });

    expect(server.socket).toBeNull();
    expect((await fromHttpsPage({ port: server.port })).body).not.toContain(OUTSIDE);
  });

  it("takes upgrades on the socket: one for the preview's address reaches the gateway", async () => {
    const socketPath = join(folder(), "galley.sock");

    await start({ socket: socketPath });
    const answer = await new Promise<string>((resolve) => {
      const socket = net.connect({ path: socketPath });
      let buffer = "";

      socket.on("data", (chunk) => (buffer += chunk.toString()));
      socket.on("close", () => resolve(buffer));
      socket.on("error", () => resolve(buffer));
      socket.write("GET /hmr HTTP/1.1\r\nHost: cms-preview.example.com\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n");
    });

    // No viewer cookie: the gateway turns the upgrade away, as it would on the port.
    expect(answer).toMatch(/^HTTP\/1\.1 401/);
  });

  it("replaces a socket file a stopped server left behind, and removes its own when it stops", async () => {
    const dir = folder();
    const socketPath = join(dir, "galley.sock");
    // A server killed without cleaning up leaves its socket file behind.
    const left = spawn(process.execPath, ["-e", `require("net").createServer().listen(${JSON.stringify(socketPath)}, () => console.log("up"))`], { stdio: ["ignore", "pipe", "ignore"] });

    await new Promise<void>((done) => left.stdout!.once("data", () => done()));
    left.kill("SIGKILL");
    await new Promise<void>((done) => left.once("exit", () => done()));
    expect(existsSync(socketPath)).toBe(true);
    const { server } = await start({ socket: socketPath });

    expect((await ask({ socketPath }, "GET", "/healthz")).status).toBe(200);
    running.splice(running.indexOf(server), 1);
    await server.close();
    expect(existsSync(socketPath)).toBe(false);
  });

  it("stops the start in plain words when a server is still listening there, or the path is something else", async () => {
    const live = join(folder(), "galley.sock");
    const holder = net.createServer();

    holders.push(holder);
    await new Promise<void>((done) => holder.listen(live, () => done()));
    await expect(start({ socket: live })).rejects.toThrow(/Another server is already listening on/);
    const file = join(folder(), "galley.sock");

    writeFileSync(file, "not a socket");
    await expect(start({ socket: file })).rejects.toThrow(/something other than a socket/);
    const missing = join(folder(), "no-such-folder", "galley.sock");

    await expect(start({ socket: missing })).rejects.toThrow(/doesn't exist/);
  });
});
