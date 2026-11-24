/**
 * The preview proxies mounted on a gateway (a hosted install's one address)
 * instead of listening on ports of their own, and the cookie hardening that
 * applies in both modes. The gateway here is a stand-in made of plain
 * node:http servers (one per kind, so the two have different origins); the
 * server's real gateway is tested in packages/server.
 */
import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OVERLAY_SCRIPT_PATH, PROXY_HEALTH_PATH } from "../../src/api";
import { PRODUCT } from "../../src/brand";
import { createPreviewController, isAppCookie, viewerCookieName, withoutAppCookies, type PreviewControllerHandle, type PreviewGateway, type ProxyHandlers } from "../../src/workspace/index";
import { startBaselineProxy, startPreviewProxy } from "../../src/workspace/preview/proxy";
import { cleanupAll, tempDir, writeTree } from "./helpers";

const slug = PRODUCT.slug;
const servers: http.Server[] = [];
const controllers: PreviewControllerHandle[] = [];
/** Upgraded sockets leave their server's books, so they are closed by hand. */
const piped = new Set<Duplex>();

afterEach(async () => {
  vi.restoreAllMocks();
  while (controllers.length) await controllers.pop()?.stop();
  for (const socket of piped) socket.destroy();
  piped.clear();
  while (servers.length) {
    const server = servers.pop() as http.Server;

    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  cleanupAll();
});

function listen(server: http.Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)));
}

/** A site's server: echoes what it was sent, redirects, sets cookies, and echoes WebSocket frames. */
async function upstream(): Promise<{ port: number; seen: http.IncomingHttpHeaders[] }> {
  const seen: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers);
    const port = (server.address() as net.AddressInfo).port;

    if (req.url === "/redirect") {
      res.writeHead(302, { location: `http://localhost:${port}/landing/` });
      res.end();
      return;
    }
    if (req.url === "/echo") {
      res.writeHead(200, { "content-type": "application/json", "set-cookie": ["site=1; Domain=example.com; Path=/", "other=2; Path=/; domain=.example.com; HttpOnly"] });
      res.end(JSON.stringify({ cookie: req.headers.cookie ?? null, origin: req.headers.origin ?? null }));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-frame-options": "DENY", "x-robots-tag": "all" });
    res.end("<!doctype html><html><head><title>T</title></head><body>Hello</body></html>");
  });

  server.on("upgrade", (req, socket: Duplex) => {
    piped.add(socket);
    seen.push(req.headers);
    const accept = crypto.createHash("sha1").update(`${String(req.headers["sec-websocket-key"])}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");

    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on("data", (data) => socket.write(data));
  });
  return { port: await listen(server), seen };
}

/** A stand-in gateway: one listening server per kind, dispatching to whatever is mounted there. */
async function fakeGateway() {
  const mounted: Record<"preview" | "baseline", ProxyHandlers | null> = { preview: null, baseline: null };
  const upgrades = new Set<Duplex>();
  const origins = { preview: "", baseline: "" };

  for (const kind of ["preview", "baseline"] as const) {
    const server = http.createServer((req, res) => {
      const handlers = mounted[kind];

      if (!handlers) {
        res.writeHead(503);
        res.end("nothing mounted");
        return;
      }
      handlers.request(req, res);
    });

    server.on("upgrade", (req, socket: Duplex, head: Buffer) => {
      upgrades.add(socket);
      piped.add(socket);
      const handlers = mounted[kind];

      if (handlers) handlers.upgrade(req, socket, head);
      else socket.destroy();
    });
    origins[kind] = `http://127.0.0.1:${await listen(server)}`;
  }
  const gateway: PreviewGateway = {
    mount(kind, handlers) {
      mounted[kind] = handlers;
      return {
        url: `${origins[kind]}/`,
        unmount: () => {
          if (mounted[kind] === handlers) mounted[kind] = null;
        },
      };
    },
  };

  return { gateway, mounted, origins, upgrades };
}

/** Opens a WebSocket through `origin`, sends "ping", and resolves with the handshake head and the echo. */
function websocket(origin: string, headers = ""): Promise<{ head: string; echo: string; socket: net.Socket }> {
  const port = Number(new URL(origin).port);

  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let buffer = "";
    let head = "";

    socket.on("error", reject);
    // Refused upgrades are closed without a word; once resolved this is a no-op.
    socket.on("close", () => reject(new Error("closed")));
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (!head && buffer.includes("\r\n\r\n")) {
        head = buffer.slice(0, buffer.indexOf("\r\n\r\n"));
        buffer = buffer.slice(head.length + 4);
        socket.write("ping");
      }
      if (head && buffer === "ping") resolve({ head, echo: buffer, socket });
    });
    socket.write(
      `GET /hmr HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n${headers}\r\n`
    );
  });
}

const appCookies = `${slug}_session=a; ${slug}_session_4400=b; __Host-${slug}_session=c; __Host-${slug}_viewer=d; ${slug}_viewer=e`;

describe("the app's own cookies", () => {
  it("knows every form of the session and viewer cookie, and nothing else", () => {
    for (const name of [`${slug}_session`, `${slug}_session_4400`, `__Host-${slug}_session`, `__Secure-${slug}_session`, `__Host-${slug}_viewer`, `${slug}_viewer`]) {
      expect(isAppCookie(name)).toBe(true);
    }
    for (const name of ["session", `${slug}_sessions`, `${slug}_session_x`, `x${slug}_session`, `${slug}_prefs`, `__Host-session`, `${slug.toUpperCase()}_SESSION`]) {
      expect(isAppCookie(name)).toBe(false);
    }
    expect(viewerCookieName(true)).toBe(`__Host-${slug}_viewer`);
    expect(viewerCookieName(false)).toBe(`${slug}_viewer`);
  });

  it("drops them from a Cookie header and keeps the site's own", () => {
    expect(withoutAppCookies(`theme=dark; ${appCookies}; cart=3`)).toBe("theme=dark; cart=3");
    expect(withoutAppCookies(appCookies)).toBeUndefined();
    expect(withoutAppCookies(["a=1", `${slug}_session=x; b=2`])).toBe("a=1; b=2");
    expect(withoutAppCookies(undefined)).toBeUndefined();
    expect(withoutAppCookies("token=a=b==")).toBe("token=a=b==");
  });
});

describe("a preview proxy mounted on a gateway", () => {
  it("behaves as it does on a port, on the gateway's origin, and opens no port of its own", async () => {
    const site = await upstream();
    const { gateway, mounted, origins, upgrades } = await fakeGateway();
    const activity = vi.fn();
    const proxy = await startPreviewProxy({
      upstreamHost: "127.0.0.1",
      upstreamPort: site.port,
      host: "127.0.0.1",
      publicHost: "127.0.0.1",
      overlayScript: () => "window.__overlay = true;",
      onActivity: activity,
      gateway,
    });

    expect(proxy.url).toBe(origins.preview);
    expect(proxy.port).toBe(0);
    expect(mounted.preview).not.toBeNull();

    // HTML: the overlay is injected, frame blocking removed, and the page is never indexed.
    const page = await fetch(`${proxy.url}/`);

    expect(await page.text()).toContain(`<title>T</title><script src="${OVERLAY_SCRIPT_PATH}" defer></script></head>`);
    expect(page.headers.get("x-frame-options")).toBeNull();
    expect(page.headers.get("x-robots-tag")).toBe("noindex");
    expect(await (await fetch(proxy.url + OVERLAY_SCRIPT_PATH)).text()).toBe("window.__overlay = true;");
    expect(await (await fetch(proxy.url + PROXY_HEALTH_PATH)).json()).toEqual({ ok: true, kind: "preview" });

    // Redirects come back to the mounted origin.
    expect((await fetch(`${proxy.url}/redirect`, { redirect: "manual" })).headers.get("location")).toBe(`${origins.preview}/landing/`);

    // The app's cookies never reach the site; the site's own do. Domain= is cut from what the site sets.
    // The browser's Origin is the gateway's, and is rewritten for the dev server's own checks.
    const echo = await fetch(`${proxy.url}/echo`, { headers: { cookie: `theme=dark; ${appCookies}`, origin: origins.preview } });

    expect(await echo.json()).toEqual({ cookie: "theme=dark", origin: `http://localhost:${site.port}` });
    expect(echo.headers.getSetCookie()).toEqual(["site=1; Path=/", "other=2; Path=/; HttpOnly"]);

    // Hot reload: the upgrade is piped both ways, without the app's cookies.
    const ws = await websocket(proxy.url, `Cookie: ${appCookies}; hmr=1\r\n`);

    expect(ws.head).toMatch(/^HTTP\/1\.1 101/);
    expect(ws.head).toContain("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    expect(ws.echo).toBe("ping");
    expect(site.seen.at(-1)?.cookie).toBe("hmr=1");
    expect(activity).toHaveBeenCalled();

    // close(): unmounted, and the piped upgrade is closed with it.
    const ended = new Promise<void>((resolve) => ws.socket.once("close", () => resolve()));

    await proxy.close();
    await proxy.close();
    expect(mounted.preview).toBeNull();
    await ended;
    expect([...upgrades].every((socket) => socket.destroyed)).toBe(true);
    expect((await fetch(`${origins.preview}/`)).status).toBe(503);
  });

  it("mounts the baseline on its own origin: redirects rewritten, Domain cut, the app's cookies kept back, no upgrades", async () => {
    const site = await upstream();
    const { gateway, mounted, origins } = await fakeGateway();
    const proxy = await startBaselineProxy({ url: `http://127.0.0.1:${site.port}`, host: "127.0.0.1", publicHost: "127.0.0.1", overlayScript: () => "x", gateway });

    expect(proxy.url).toBe(origins.baseline);
    expect(mounted.baseline).not.toBeNull();
    expect(mounted.preview).toBeNull();
    const echo = await fetch(`${proxy.url}/echo`, { headers: { cookie: `${appCookies}; prefs=1` } });

    expect(await echo.json()).toMatchObject({ cookie: "prefs=1" });
    expect(echo.headers.getSetCookie()).toEqual(["site=1; Path=/", "other=2; Path=/; HttpOnly"]);
    expect(echo.headers.get("x-robots-tag")).toBe("noindex");
    await expect(websocket(proxy.url)).rejects.toThrow();
    await proxy.close();
    expect(mounted.baseline).toBeNull();
  });
});

describe("a preview proxy on a port of its own", () => {
  it("also keeps the app's cookies from the site, and leaves the site's Set-Cookie as it was", async () => {
    const site = await upstream();
    const proxy = await startPreviewProxy({ upstreamHost: "127.0.0.1", upstreamPort: site.port, host: "127.0.0.1", publicHost: "127.0.0.1", overlayScript: () => "x" });

    try {
      expect(proxy.port).toBeGreaterThan(0);
      const echo = await fetch(`${proxy.url}/echo`, { headers: { cookie: `${appCookies}; theme=dark` } });

      expect(await echo.json()).toMatchObject({ cookie: "theme=dark" });
      expect(echo.headers.getSetCookie()).toEqual(["site=1; Domain=example.com; Path=/", "other=2; Path=/; domain=.example.com; HttpOnly"]);
      expect(echo.headers.get("x-robots-tag")).toBeNull();
      const ws = await websocket(proxy.url, `Cookie: ${slug}_session_4400=x\r\n`);

      expect(ws.echo).toBe("ping");
      expect(site.seen.at(-1)?.cookie).toBeUndefined();
      ws.socket.destroy();
    } finally {
      await proxy.close();
    }
  });
});

describe("the preview controller with a gateway", () => {
  const DEV_SERVER = `
import http from "node:http";
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><head></head><body>dev</body></html>");
});
server.listen(0, "127.0.0.1", () => console.log("Local http://localhost:" + server.address().port + "/"));
`;

  it("reports the gateway's addresses, opens no listening socket, and unmounts on stop", async () => {
    const deployed = await upstream();
    const { gateway, mounted, origins } = await fakeGateway();
    const root = tempDir("ws-gateway-");

    writeTree(root, { "dev-server.mjs": DEV_SERVER });
    const listens = vi.spyOn(net.Server.prototype, "listen");
    const controller = createPreviewController({
      root,
      settings: () => ({ dev: { command: "node dev-server.mjs", port: null }, packageManager: null, installed: true, urls: { staging: `http://127.0.0.1:${deployed.port}` } }),
      overlayScript: () => "window.__overlay = true;",
      gateway,
    });

    controllers.push(controller);
    const status = await controller.start();

    expect(status).toMatchObject({ state: "ready", url: origins.preview, baselineUrl: origins.baseline, baselineSource: "staging" });
    // The deployed site was asked directly (it answered), not through the gateway.
    expect(status.detail).toBe("The preview is ready.");
    expect(listens).not.toHaveBeenCalled();
    expect(await (await fetch(`${status.url}/`)).text()).toContain(OVERLAY_SCRIPT_PATH);
    expect(await (await fetch(`${status.baselineUrl}/`)).text()).toContain('data-galley-role="follow"');

    await controller.stop();
    expect(mounted).toEqual({ preview: null, baseline: null });
    expect(controller.status()).toMatchObject({ state: "stopped", url: null, baselineUrl: null });
  });
});
