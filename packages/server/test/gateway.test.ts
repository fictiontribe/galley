/**
 * The preview gateway: who is let in, the entry route and its cookie, what
 * reaches the previewed site, and that gateway hostnames and the app never
 * meet. Real node:http servers throughout: a site upstream, a real preview
 * proxy from core mounted on the gateway, and one listener in front made
 * with withGateway.
 */
import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OVERLAY_SCRIPT_PATH, PROXY_HEALTH_PATH } from "@galley/core/api";
import { PRODUCT } from "@galley/core/brand";
import { startBaselineProxy, startPreviewProxy } from "@galley/core/workspace";
import {
  createPreviewGateway,
  defaultGatewayOrigins,
  gatewayEntryUrl,
  GATEWAY_ENTRY_PATH,
  hostnameOf,
  safeReturnPath,
  withGateway,
  type GatewayAuth,
  type ServerGateway,
} from "../src/gateway";

const EDITOR = "https://cms.example.com";
const PREVIEW_HOST = "cms-preview.example.com";
const LIVE_HOST = "cms-live.example.com";
const VIEWER = `__Host-${PRODUCT.slug}_viewer`;

const servers: http.Server[] = [];
const sockets = new Set<Duplex>();
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length) await closers.pop()?.();
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  while (servers.length) {
    const server = servers.pop() as http.Server;

    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

function listen(server: http.Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)));
}

/** The site: a page, an asset, its own copy of the reserved paths, a cookie echo and a WebSocket echo. Records everything it is sent. */
async function siteServer() {
  const seen: Array<{ url: string; cookie: string | null; upgrade: boolean }> = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url ?? "", cookie: req.headers.cookie ?? null, upgrade: false });
    if (req.url === "/echo") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ cookie: req.headers.cookie ?? null }));
      return;
    }
    if (req.url === "/app.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end("console.log(1)");
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><head><title>Site</title></head><body>site page</body></html>");
  });

  server.on("upgrade", (req, socket: Duplex) => {
    sockets.add(socket);
    seen.push({ url: req.url ?? "", cookie: req.headers.cookie ?? null, upgrade: true });
    const accept = crypto.createHash("sha1").update(`${String(req.headers["sec-websocket-key"])}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");

    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on("data", (data) => socket.write(data));
  });
  return { port: await listen(server), seen };
}

/** A GatewayAuth with one-use tickets and sign-ins that can be ended. */
function fakeAuth() {
  const tickets = new Map<string, string>();
  const good = new Set<string>();
  const auth: GatewayAuth = {
    redeem(ticket) {
      const value = tickets.get(ticket) ?? null;

      tickets.delete(ticket);
      if (value) good.add(value);
      return value;
    },
    check: (value) => value !== undefined && good.has(value),
  };

  return {
    auth,
    ticket(value = `viewer-${crypto.randomUUID()}`) {
      const ticket = `ticket-${crypto.randomUUID()}`;

      tickets.set(ticket, value);
      return { ticket, value };
    },
    end: (value: string) => good.delete(value),
  };
}

/** A gateway and the app behind one listener, as startServer wires them. */
async function setup(origins: { preview: string; live: string; editor: string } = { preview: `https://${PREVIEW_HOST}`, live: `https://${LIVE_HOST}`, editor: EDITOR }) {
  const tickets = fakeAuth();
  const gateway = createPreviewGateway({ previewOrigin: origins.preview, liveOrigin: origins.live, editorOrigin: origins.editor, auth: tickets.auth, log: () => undefined });
  const app = vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("the app");
  });
  const listener = withGateway(app, gateway);
  const server = http.createServer(listener.request);

  server.on("upgrade", listener.upgrade);
  const port = await listen(server);

  closers.push(async () => gateway.close());
  return { gateway, app, port, tickets };
}

async function mountPreview(gateway: ServerGateway, sitePort: number) {
  const proxy = await startPreviewProxy({ upstreamHost: "127.0.0.1", upstreamPort: sitePort, host: "127.0.0.1", publicHost: "127.0.0.1", overlayScript: () => "window.__overlay = 1;", gateway });

  closers.push(() => proxy.close());
  return proxy;
}

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function get(port: number, host: string, path: string, headers: Record<string, string> = {}, method = "GET"): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { host, ...headers }, agent: false }, (res) => {
      let body = "";

      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });

    req.on("error", reject);
    req.end();
  });
}

/** An upgrade through the listener: the handshake head and whatever came back to "ping", or how it was refused. */
function upgrade(port: number, host: string, cookie?: string): Promise<{ head: string; echo: string; closed: boolean }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let buffer = "";
    let head = "";

    sockets.add(socket);
    socket.on("error", reject);
    socket.on("close", () => resolve({ head: head || buffer, echo: head ? buffer : "", closed: true }));
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (!head && buffer.includes("\r\n\r\n")) {
        head = buffer.slice(0, buffer.indexOf("\r\n\r\n"));
        buffer = buffer.slice(head.length + 4);
        if (head.startsWith("HTTP/1.1 101")) socket.write("ping");
      }
      if (head.startsWith("HTTP/1.1 101") && buffer === "ping") resolve({ head, echo: buffer, closed: false });
    });
    socket.write(
      `GET /hmr HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n${cookie ? `Cookie: ${cookie}\r\n` : ""}\r\n`
    );
  });
}

/** Enters with a fresh ticket; returns the Cookie header value the browser would send next. */
async function enter(port: number, tickets: ReturnType<typeof fakeAuth>, host = PREVIEW_HOST): Promise<{ cookie: string; value: string }> {
  const { ticket, value } = tickets.ticket();
  const answer = await get(port, host, `${GATEWAY_ENTRY_PATH}?ticket=${ticket}&to=/`);

  expect(answer.status).toBe(302);
  return { cookie: String(answer.headers["set-cookie"]?.[0]).split(";")[0]!, value };
}

function expectGatewayHeaders(answer: Answer) {
  expect(answer.headers["x-robots-tag"]).toBe("noindex");
  expect(answer.headers["cache-control"]).toBe("no-store");
  expect(answer.headers["x-content-type-options"]).toBe("nosniff");
  expect(answer.headers["content-security-policy"]).toBe(`default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors ${EDITOR}`);
}

describe("a stranger", () => {
  it("gets the plain 401 page for a page, an asset, the overlay and the health path, and a closed socket for an upgrade — nothing reaches the site", async () => {
    const site = await siteServer();
    const { gateway, app, port } = await setup();

    await mountPreview(gateway, site.port);
    for (const path of ["/", "/app.js", OVERLAY_SCRIPT_PATH, PROXY_HEALTH_PATH, "/echo?x=1"]) {
      const answer = await get(port, PREVIEW_HOST, path);

      expect(answer.status).toBe(401);
      expectGatewayHeaders(answer);
      expect(answer.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(answer.body).toContain("Open this from the editor");
      expect(answer.body).toContain(`parent.postMessage({"galley":1,"type":"sign-in-needed"},"${EDITOR}")`);
      expect(answer.body).not.toContain("site page");
      expect(answer.body).not.toContain(PRODUCT.name);
    }
    // A cookie that was never issued is no better than none.
    expect((await get(port, PREVIEW_HOST, "/", { cookie: `${VIEWER}=made-up` })).status).toBe(401);
    expect((await get(port, LIVE_HOST, "/")).status).toBe(401);

    const refused = await upgrade(port, PREVIEW_HOST);

    expect(refused.closed).toBe(true);
    expect(refused.head).toMatch(/^HTTP\/1\.1 401/);
    expect(site.seen).toEqual([]);
    expect(app).not.toHaveBeenCalled();
  });
});

describe("entry", () => {
  it("trades a ticket for the viewer cookie, once, and goes to the page asked for", async () => {
    const { port, tickets } = await setup();
    const { ticket, value } = tickets.ticket();
    const answer = await get(port, PREVIEW_HOST, `${GATEWAY_ENTRY_PATH}?ticket=${ticket}&to=${encodeURIComponent("/about/?x=1#team")}`);

    expect(answer.status).toBe(302);
    expect(answer.headers.location).toBe("/about/?x=1#team");
    expect(answer.headers["set-cookie"]).toEqual([`${VIEWER}=${value}; Path=/; Secure; HttpOnly; SameSite=None; Partitioned`]);
    expect(answer.headers["referrer-policy"]).toBe("no-referrer");
    expectGatewayHeaders(answer);

    // One use: the same ticket again lets nobody in.
    const again = await get(port, PREVIEW_HOST, `${GATEWAY_ENTRY_PATH}?ticket=${ticket}&to=/`);

    expect(again.status).toBe(401);
    expect(again.headers["set-cookie"]).toBeUndefined();
    // …unless the browser is already let in (a frame loaded twice): then it just goes on.
    const reloaded = await get(port, PREVIEW_HOST, `${GATEWAY_ENTRY_PATH}?ticket=${ticket}&to=/team/`, { cookie: `${VIEWER}=${value}` });

    expect(reloaded.status).toBe(302);
    expect(reloaded.headers.location).toBe("/team/");
    expect(reloaded.headers["set-cookie"]).toBeUndefined();
    expect((await get(port, PREVIEW_HOST, `${GATEWAY_ENTRY_PATH}?ticket=nonsense`)).status).toBe(401);
    expect((await get(port, PREVIEW_HOST, GATEWAY_ENTRY_PATH)).status).toBe(401);
    expect((await get(port, PREVIEW_HOST, `${GATEWAY_ENTRY_PATH}?ticket=${tickets.ticket().ticket}`, {}, "POST")).status).toBe(405);
  });

  it("goes only to a path on its own origin", async () => {
    const { port, tickets } = await setup();
    const hostile = [
      "https://evil.example/",
      "//evil.example/",
      "///evil.example/",
      "/\\evil.example/",
      "\\\\evil.example",
      "/\t/evil.example",
      "/\r\nSet-Cookie: x=1",
      "/..//evil.example",
      "/%2e%2e//evil.example",
      "javascript:alert(1)",
      "http:/evil.example",
      "evil.example",
      "",
      `/${"a".repeat(5000)}`,
    ];

    for (const to of hostile) {
      const { ticket } = tickets.ticket();
      const answer = await get(port, PREVIEW_HOST, `${GATEWAY_ENTRY_PATH}?ticket=${ticket}&to=${encodeURIComponent(to)}`);

      expect({ to, status: answer.status, location: answer.headers.location }).toEqual({ to, status: 302, location: "/" });
    }
    expect(safeReturnPath(undefined)).toBe("/");
    expect(safeReturnPath("/blog/2024/?page=2")).toBe("/blog/2024/?page=2");
    expect(safeReturnPath("/café/")).toBe("/caf%C3%A9/");
    expect(safeReturnPath("/a/../b/")).toBe("/b/");
  });

  it("sets a plain-http cookie on a plain-http address (local trials), host-only like the secure one", async () => {
    const { port, tickets } = await setup({ preview: "http://preview.localhost:4400", live: "http://live.localhost:4400", editor: "http://localhost:4400" });
    const { ticket, value } = tickets.ticket();
    const answer = await get(port, "preview.localhost:4400", `${GATEWAY_ENTRY_PATH}?ticket=${ticket}&to=/`);

    expect(answer.headers["set-cookie"]).toEqual([`${PRODUCT.slug}_viewer=${value}; Path=/; HttpOnly; SameSite=Lax`]);
  });

  it("refuses a cookie value the auth hands back that a cookie can't hold", async () => {
    const lines: string[] = [];
    const gateway = createPreviewGateway({
      previewOrigin: `https://${PREVIEW_HOST}`,
      liveOrigin: `https://${LIVE_HOST}`,
      editorOrigin: EDITOR,
      auth: { redeem: () => "a; Domain=example.com", check: () => false },
      log: (line) => lines.push(line),
    });
    const server = http.createServer(gateway.request);
    const port = await listen(server);
    const answer = await get(port, PREVIEW_HOST, `${GATEWAY_ENTRY_PATH}?ticket=t`);

    expect(answer.status).toBe(500);
    expect(answer.headers["set-cookie"]).toBeUndefined();
    expect(lines.join("\n")).not.toContain("Domain");
  });
});

describe("a viewer", () => {
  it("sees the site through the mounted proxy, and the site never sees the viewer cookie", async () => {
    const site = await siteServer();
    const { gateway, app, port, tickets } = await setup();

    await mountPreview(gateway, site.port);
    const { cookie } = await enter(port, tickets);
    const page = await get(port, PREVIEW_HOST, "/", { cookie: `${cookie}; theme=dark` });

    expect(page.status).toBe(200);
    expect(page.body).toContain(`<script src="${OVERLAY_SCRIPT_PATH}" defer></script></head>`);
    expect(page.headers["x-robots-tag"]).toBe("noindex");
    expect(await get(port, PREVIEW_HOST, "/echo", { cookie: `theme=dark; ${cookie}; ${PRODUCT.slug}_session_4400=s` }).then((a) => JSON.parse(a.body))).toEqual({ cookie: "theme=dark" });
    expect((await get(port, PREVIEW_HOST, OVERLAY_SCRIPT_PATH, { cookie })).body).toBe("window.__overlay = 1;");

    const ws = await upgrade(port, PREVIEW_HOST, `${cookie}; hmr=1`);

    expect(ws.head).toMatch(/^HTTP\/1\.1 101/);
    expect(ws.echo).toBe("ping");
    expect(site.seen.find((entry) => entry.upgrade)?.cookie).toBe("hmr=1");
    expect(site.seen.every((entry) => !entry.cookie?.includes(PRODUCT.slug))).toBe(true);
    expect(app).not.toHaveBeenCalled();
  });

  it("passes an address that names a secrets file, or anything under .git, to nobody: the site's dev server is never asked", async () => {
    const site = await siteServer();
    const { gateway, port, tickets } = await setup();

    await mountPreview(gateway, site.port);
    const { cookie } = await enter(port, tickets);
    const before = site.seen.length;

    for (const path of ["/.envrc", "/.envrc?raw", "/.env-production?raw", "/%2Eenv_local", "/@fs/home/site/.envrc?raw", "/.git/config", "/sub/.GIT/HEAD"]) {
      const answer = await get(port, PREVIEW_HOST, path, { cookie });

      expect(answer.status, path).toBe(403);
      expect(answer.body, path).toContain("That file can't be shown here.");
    }
    expect(site.seen.length).toBe(before);
    // A page is passed on as it always was.
    expect((await get(port, PREVIEW_HOST, "/", { cookie })).status).toBe(200);
    expect(site.seen.length).toBe(before + 1);
  });

  it("is a stranger again once the sign-in has ended", async () => {
    const site = await siteServer();
    const { gateway, port, tickets } = await setup();

    await mountPreview(gateway, site.port);
    const { cookie, value } = await enter(port, tickets);

    expect((await get(port, PREVIEW_HOST, "/", { cookie })).status).toBe(200);
    tickets.end(value);
    expect((await get(port, PREVIEW_HOST, "/", { cookie })).status).toBe(401);
    expect((await upgrade(port, PREVIEW_HOST, cookie)).head).toMatch(/^HTTP\/1\.1 401/);
  });

  it("gets a page that retries by itself while nothing is mounted, and never the app", async () => {
    const site = await siteServer();
    const { gateway, app, port, tickets } = await setup();
    const { cookie } = await enter(port, tickets);
    const live = await enter(port, tickets, LIVE_HOST);

    for (const [host, sent] of [[PREVIEW_HOST, cookie], [LIVE_HOST, live.cookie]] as const) {
      const answer = await get(port, host, "/", { cookie: sent });

      expect(answer.status).toBe(503);
      expectGatewayHeaders(answer);
      expect(answer.body).toContain("The preview isn't running yet.");
      expect(answer.body).toContain('http-equiv="refresh"');
    }
    expect((await upgrade(port, PREVIEW_HOST, cookie)).head).toMatch(/^HTTP\/1\.1 503/);

    // Mounted, then taken down again: back to the waiting page.
    const proxy = await mountPreview(gateway, site.port);

    expect((await get(port, PREVIEW_HOST, "/", { cookie })).status).toBe(200);
    await proxy.close();
    expect((await get(port, PREVIEW_HOST, "/", { cookie })).status).toBe(503);
    expect(app).not.toHaveBeenCalled();
  });

  it("reaches the live comparison only on the live hostname", async () => {
    const site = await siteServer();
    const { gateway, port, tickets } = await setup();
    const baseline = await startBaselineProxy({ url: `http://127.0.0.1:${site.port}`, host: "127.0.0.1", publicHost: "127.0.0.1", overlayScript: () => "x", gateway });

    closers.push(() => baseline.close());
    expect(baseline.url).toBe(`https://${LIVE_HOST}`);
    const { cookie } = await enter(port, tickets, LIVE_HOST);
    const page = await get(port, LIVE_HOST, "/", { cookie });

    expect(page.body).toContain('data-galley-role="follow"');
    // Nothing is mounted for the preview hostname.
    expect((await get(port, PREVIEW_HOST, "/", { cookie })).status).toBe(503);
  });
});

describe("routing", () => {
  it("sends every gateway hostname to the gateway, however it is written, and everything else to the app", async () => {
    const { gateway, app, port, tickets } = await setup();
    const toGateway = vi.spyOn(gateway, "request");
    const { cookie } = await enter(port, tickets);

    toGateway.mockClear();
    for (const host of [PREVIEW_HOST, "CMS-Preview.Example.COM", `${PREVIEW_HOST}.`, `${PREVIEW_HOST}:443`, `${LIVE_HOST}:8443`]) {
      expect((await get(port, host, "/", { cookie })).status).not.toBe(200);
      expect((await get(port, host, "/api/meta")).body).not.toContain("the app");
    }
    expect(app).not.toHaveBeenCalled();
    expect(toGateway).toHaveBeenCalledTimes(10);

    toGateway.mockClear();
    for (const host of ["cms.example.com", "127.0.0.1", "preview.cms.example.com", "cms-preview.example.com.evil.example"]) {
      expect((await get(port, host, "/")).body).toBe("the app");
    }
    expect(toGateway).not.toHaveBeenCalled();
    expect(app).toHaveBeenCalledTimes(4);
  });

  it("closes upgrades for the app's hostnames and leaves the app alone without a gateway", async () => {
    const { port } = await setup();

    expect((await upgrade(port, "cms.example.com")).closed).toBe(true);
    const app = vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => res.end("the app"));
    const listener = withGateway(app, null);
    const bare = await listen(http.createServer(listener.request));

    expect((await get(bare, PREVIEW_HOST, "/")).body).toBe("the app");
  });

  it("tells its own hostnames apart", () => {
    const gateway = createPreviewGateway({ previewOrigin: `https://${PREVIEW_HOST}`, liveOrigin: `https://${LIVE_HOST}:8443/`, editorOrigin: EDITOR, auth: fakeAuth().auth });
    const table: Array<[string | undefined, boolean]> = [
      [PREVIEW_HOST, true],
      [`${PREVIEW_HOST}:443`, true],
      [`${PREVIEW_HOST}:4400`, true],
      ["CMS-PREVIEW.example.com", true],
      [`${PREVIEW_HOST}.`, true],
      [`${PREVIEW_HOST}.:443`, true],
      [` ${LIVE_HOST} `, true],
      [LIVE_HOST, true],
      ["cms.example.com", false],
      ["example.com", false],
      ["evil-cms-preview.example.com", false],
      [`${PREVIEW_HOST}.evil.example`, false],
      ["127.0.0.1", false],
      ["[::1]:4400", false],
      ["", false],
      [undefined, false],
    ];

    for (const [host, owned] of table) expect({ host, owned: gateway.owns(host) }).toEqual({ host, owned });
    expect(gateway.origins).toEqual({ preview: `https://${PREVIEW_HOST}`, live: `https://${LIVE_HOST}:8443` });
    expect(hostnameOf("[::1]:4400")).toBe("::1");
    expect(hostnameOf("[2001:db8::1]")).toBe("2001:db8::1");
    expect(hostnameOf("Example.COM.:80")).toBe("example.com");
  });

  it("refuses hostnames that collide", () => {
    const auth = fakeAuth().auth;

    expect(() => createPreviewGateway({ previewOrigin: EDITOR, liveOrigin: `https://${LIVE_HOST}`, editorOrigin: EDITOR, auth })).toThrow(/hostname of their own/);
    expect(() => createPreviewGateway({ previewOrigin: `https://${PREVIEW_HOST}`, liveOrigin: `https://${PREVIEW_HOST}:8443`, editorOrigin: EDITOR, auth })).toThrow(/hostname of their own/);
    expect(() => createPreviewGateway({ previewOrigin: "cms-preview", liveOrigin: `https://${LIVE_HOST}`, editorOrigin: EDITOR, auth })).toThrow(/full address/);
  });
});

describe("default gateway addresses", () => {
  it("derives sibling names, keeps scheme and port, and gives up on addresses", () => {
    const table: Array<[string, { preview: string; live: string } | null]> = [
      ["https://cms.example.com", { preview: "https://cms-preview.example.com", live: "https://cms-live.example.com" }],
      ["https://CMS.Example.com/", { preview: "https://cms-preview.example.com", live: "https://cms-live.example.com" }],
      ["https://cms.example.com.", { preview: "https://cms-preview.example.com", live: "https://cms-live.example.com" }],
      ["https://edit.sites.example.co.uk:8443/app", { preview: "https://edit-preview.sites.example.co.uk:8443", live: "https://edit-live.sites.example.co.uk:8443" }],
      ["http://cms.internal.test:4400", { preview: "http://cms-preview.internal.test:4400", live: "http://cms-live.internal.test:4400" }],
      // An apex: a sibling would be another registrable domain, so the names go underneath.
      ["https://example.com", { preview: "https://preview.example.com", live: "https://live.example.com" }],
      ["http://localhost:4400", { preview: "http://preview.localhost:4400", live: "http://live.localhost:4400" }],
      ["http://cms.localhost:4400", { preview: "http://preview.cms.localhost:4400", live: "http://live.cms.localhost:4400" }],
      ["http://127.0.0.1:4400", null],
      ["http://10.0.0.5", null],
      ["http://[::1]:4400", null],
      ["https://[2001:db8::1]", null],
      ["http://myserver:4400", null],
      [`https://${"a".repeat(60)}.example.com`, null],
    ];

    for (const [input, expected] of table) expect({ input, origins: defaultGatewayOrigins(new URL(input)) }).toEqual({ input, origins: expected });
  });

  it("builds entry addresses with the ticket encoded", () => {
    expect(gatewayEntryUrl("https://cms-preview.example.com/", "a+b/c")).toBe(`https://cms-preview.example.com${GATEWAY_ENTRY_PATH}?ticket=a%2Bb%2Fc`);
    expect(GATEWAY_ENTRY_PATH).toBe("/__galley/enter");
  });
});
