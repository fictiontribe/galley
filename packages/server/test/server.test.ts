import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { GalleyError } from "@galley/core";
import { resolveConfig, sessionKey, startServer, StartupError } from "../src/server";
import type { RunningServer } from "../src/types";
import { buildServices, createBus } from "./helpers";

const home = mkdtempSync(join(tmpdir(), "galley-server-home-"));
const running: RunningServer[] = [];
const blockers: Server[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
  await Promise.all(blockers.splice(0).map((server) => new Promise((done) => server.close(done))));
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

function fakeServices(disposed: { count: number } = { count: 0 }) {
  const events = createBus();

  return {
    events,
    disposed,
    services: buildServices({ events, registry: { list: async () => [], dispose: async () => void (disposed.count += 1) } }),
  };
}

async function start(options: Parameters<typeof startServer>[0] = {}) {
  const server = await startServer({ port: 0, home, env: {}, webDir: join(home, "no-ui"), notice: () => {}, ...options });

  running.push(server);
  return server;
}

function rawGet(port: number, path: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, headers }, (res) => {
      let body = "";

      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });

    req.on("error", reject);
    req.end();
  });
}

describe("resolveConfig", () => {
  it("defaults to local mode on 127.0.0.1:4400 with a minted token", () => {
    const config = resolveConfig({ env: {} });

    expect(config).toMatchObject({ mode: "local", host: "127.0.0.1", port: 4400, findFreePort: true, password: null });
    expect(config.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(resolveConfig({ env: {} }).token).not.toBe(config.token);
  });

  it("reads GALLEY_* variables", () => {
    const config = resolveConfig({
      env: {
        GALLEY_PORT: "5000",
        GALLEY_HOST: "0.0.0.0",
        GALLEY_PASSWORD: "a long enough password",
        GALLEY_PUBLIC_URL: "https://cms.example.com",
        GALLEY_HOME: "/data",
        GALLEY_TRUST_PROXY: "1",
        GALLEY_DESKTOP: "1",
      },
    });

    // Hosted: one site, kept in the data folder (the owner's single-site decision).
    expect(config).toMatchObject({ mode: "hosted", port: 5000, home: "/data", sitesDir: "/data/site", trustProxy: true, desktop: true, token: null, findFreePort: false });
    expect(config.publicUrl?.origin).toBe("https://cms.example.com");
  });

  it("starts hosted mode without a password: first run chooses it behind a one-time setup link", () => {
    // Was "refuses hosted mode without a password" before installs had first run.
    expect(resolveConfig({ env: { GALLEY_HOST: "0.0.0.0" } })).toMatchObject({ mode: "hosted", password: null });
    expect(resolveConfig({ env: {}, mode: "hosted" })).toMatchObject({ mode: "hosted", password: null, starting: {} });
  });

  it("refuses a password under 12 characters", () => {
    expect(() => resolveConfig({ env: { GALLEY_HOST: "0.0.0.0", GALLEY_PASSWORD: "short" } })).toThrow(/at least 12 characters/);
  });

  it("refuses local mode on a public interface", () => {
    expect(() => resolveConfig({ env: {}, mode: "local", host: "0.0.0.0" })).toThrow(/only listens on this computer/);
  });

  it("refuses a bad port, public URL or short token", () => {
    expect(() => resolveConfig({ env: { GALLEY_PORT: "eighty" } })).toThrow(/GALLEY_PORT must be a port number/);
    expect(() => resolveConfig({ env: { GALLEY_HOST: "0.0.0.0", GALLEY_PASSWORD: "a long enough password", GALLEY_PUBLIC_URL: "cms" } })).toThrow(/full address/);
    expect(() => resolveConfig({ env: { GALLEY_TOKEN: "short" } })).toThrow(/at least 16/);
  });

  it("reads the preview port range and refuses a bad one in one plain sentence", () => {
    expect(resolveConfig({ env: { GALLEY_PREVIEW_PORTS: "4410-4429" } }).previewPorts).toEqual({ from: 4410, to: 4429 });
    expect(resolveConfig({ previewPorts: "5000-5001", env: {} }).previewPorts).toEqual({ from: 5000, to: 5001 });
    expect(resolveConfig({ env: {} }).previewPorts).toBeNull();
    expect(() => resolveConfig({ env: { GALLEY_PREVIEW_PORTS: "lots" } })).toThrow(new StartupError("GALLEY_PREVIEW_PORTS must be a range of ports like 4410-4429, not “lots”."));
    expect(() => resolveConfig({ env: { GALLEY_PREVIEW_PORTS: "4390-4410" } })).toThrow(/includes the server's own port, 4400/);
  });

  it("refuses a broken brand file or accent as a plain error, never a stack trace", () => {
    const missing = join(home, "no-such-brand.json");

    for (const env of [{ GALLEY_BRAND_FILE: missing }, { GALLEY_BRAND_ACCENT: "blue" }]) {
      let caught: unknown;

      try {
        resolveConfig({ env });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GalleyError);
      expect((caught as Error).message).not.toMatch(/\n|\bat\b .*\(/);
    }
    expect(() => resolveConfig({ env: { GALLEY_BRAND_FILE: missing } })).toThrow(`The brand file ${missing} can't be used because it doesn't exist.`);
    expect(() => resolveConfig({ env: { GALLEY_BRAND_ACCENT: "blue" } })).toThrow("GALLEY_BRAND_ACCENT must be a hex color like #1a2b3c, not “blue”.");
  });

  it("warns about a missing or unencrypted public URL", () => {
    expect(resolveConfig({ env: { GALLEY_HOST: "0.0.0.0", GALLEY_PASSWORD: "a long enough password" } }).warnings[0]).toMatch(/GALLEY_PUBLIC_URL isn't set/);
    expect(resolveConfig({ env: { GALLEY_HOST: "0.0.0.0", GALLEY_PASSWORD: "a long enough password", GALLEY_PUBLIC_URL: "http://cms.example.com" } }).warnings[0]).toMatch(/unencrypted/);
  });
});

describe("startServer", () => {
  it("serves over HTTP: token hand-off, then the cookie works", async () => {
    const { services } = fakeServices();
    const server = await start({ services });
    const first = await fetch(server.openUrl("/sites/a"), { redirect: "manual" });

    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe("/sites/a");
    const cookie = first.headers.getSetCookie()[0]!.split(";")[0]!;

    expect(cookie).toMatch(new RegExp(`^galley_session_${server.port}=`));
    expect((await fetch(`${server.url}/api/sites`)).status).toBe(401);
    expect((await fetch(`${server.url}/api/sites`, { headers: { cookie } })).status).toBe(200);
    expect((await fetch(`${server.url}/api/sites`, { headers: { authorization: `Bearer ${server.token}` } })).status).toBe(200);
  });

  it("refuses a foreign Host header over the wire", async () => {
    const server = await start({ services: fakeServices().services });

    expect((await rawGet(server.port, "/api/meta", { host: `rebind.example:${server.port}` })).status).toBe(403);
    expect((await rawGet(server.port, "/api/meta", { host: `localhost:${server.port}` })).status).toBe(200);
  });

  it("moves to the next free port in local mode and says so", async () => {
    const blocker = createServer();

    blockers.push(blocker);
    await new Promise<void>((done) => blocker.listen(0, "127.0.0.1", done));
    const busy = (blocker.address() as { port: number }).port;
    const notices: string[] = [];
    const server = await start({ services: fakeServices().services, port: busy, notice: (line) => notices.push(line) });

    expect(server.port).not.toBe(busy);
    expect(notices.join("\n")).toContain(`Port ${busy} is in use`);
  });

  it("fails plainly when the port is busy in hosted mode", async () => {
    const blocker = createServer();

    blockers.push(blocker);
    await new Promise<void>((done) => blocker.listen(0, "127.0.0.1", done));
    const busy = (blocker.address() as { port: number }).port;

    await expect(
      start({ services: fakeServices().services, port: busy, mode: "hosted", password: "a long enough password", host: "127.0.0.1" })
    ).rejects.toThrow(/already in use/);
  });

  it("streams events over HTTP and drops the subscription when the client disconnects", async () => {
    const { services, events } = fakeServices();
    const server = await start({ services });
    // node:http rather than fetch: undici keeps an aborted socket open, which isn't what a browser does.
    const req = httpRequest({ host: "127.0.0.1", port: server.port, path: "/api/events", headers: { authorization: `Bearer ${server.token}` } });
    const first = await new Promise<string>((done) => {
      req.on("response", (res) => res.once("data", (chunk: Buffer) => done(chunk.toString())));
      req.end();
    });

    expect(first).toContain("hello");
    expect(events.listenerCount).toBe(1);
    req.destroy();
    const deadline = Date.now() + 3000;

    while (events.listenerCount > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events.listenerCount).toBe(0);
  });

  it("close() ends open event streams and disposes the registry", async () => {
    const disposed = { count: 0 };
    const { services, events } = fakeServices(disposed);
    const server = await startServer({ port: 0, home, env: {}, services, notice: () => {} });
    const response = await fetch(`${server.url}/api/events`, { headers: { authorization: `Bearer ${server.token}` } });
    const reader = response.body!.getReader();

    await reader.read();
    await server.close();
    let done = false;

    while (!done) done = (await reader.read()).done;
    expect(events.listenerCount).toBe(0);
    expect(disposed.count).toBe(1);
    await server.close();
    expect(disposed.count).toBe(1);
    await expect(fetch(`${server.url}/api/meta`)).rejects.toThrow();
  });

  it("keeps the open UI signed in across a restart in local mode, with the key readable only by the owner", async () => {
    const localHome = mkdtempSync(join(tmpdir(), "galley-server-local-"));

    try {
      const first = await start({ services: fakeServices().services, home: localHome });
      const port = Number(new URL(first.url).port);
      const handOff = await fetch(`${first.url}/api/meta?token=${first.token}`);
      const cookie = handOff.headers.get("set-cookie")!.split(";")[0]!;

      expect(statSync(join(localHome, "session.key")).mode & 0o777).toBe(0o600);
      expect((await fetch(`${first.url}/api/meta`, { headers: { cookie } }).then((response) => response.json() as Promise<{ authenticated: boolean }>)).authenticated).toBe(true);
      await first.close();

      // Restarted on the same port (adding a plugin needs a restart): a new start-up token, the same cookie still works.
      const second = await start({ services: fakeServices().services, home: localHome, port });

      expect(second.token).not.toBe(first.token);
      expect((await fetch(`${second.url}/api/meta`, { headers: { cookie } }).then((response) => response.json() as Promise<{ authenticated: boolean }>)).authenticated).toBe(true);
      expect((await fetch(`${second.url}/api/sites`, { headers: { cookie } })).status).toBe(200);
      // A key file someone loosened is tightened again; one that isn't a key is replaced.
      chmodSync(join(localHome, "session.key"), 0o644);
      await sessionKey(localHome);
      expect(statSync(join(localHome, "session.key")).mode & 0o777).toBe(0o600);
      writeFileSync(join(localHome, "session.key"), "not a key\n");
      expect((await sessionKey(localHome)).byteLength).toBe(32);
      expect(readFileSync(join(localHome, "session.key"), "utf8").trim()).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await Promise.all(running.splice(0).map((server) => server.close()));
      rmSync(localHome, { recursive: true, force: true });
    }
  });

  it("hosted mode keeps its cookie key in the home, readable only by the owner", async () => {
    const hostedHome = mkdtempSync(join(tmpdir(), "galley-server-hosted-"));

    try {
      const server = await start({ services: fakeServices().services, home: hostedHome, mode: "hosted", password: "a long enough password", host: "127.0.0.1" });

      expect(server.mode).toBe("hosted");
      expect(server.token).toBeNull();
      expect(server.openUrl("/")).toBe(`${server.url}/`);
      expect(statSync(join(hostedHome, "session.key")).mode & 0o777).toBe(0o600);
      const login = await fetch(`${server.url}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: server.url },
        body: JSON.stringify({ password: "a long enough password" }),
      });

      expect(login.status).toBe(200);
    } finally {
      await Promise.all(running.splice(0).map((server) => server.close()));
      rmSync(hostedHome, { recursive: true, force: true });
    }
  });
});
