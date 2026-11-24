/**
 * The two reverse proxies that let the app frame both sites side by side.
 *
 * Preview proxy → the site's own dev server: forwards HTTP and WebSocket
 * upgrades (hot reload), strips frame-blocking headers, injects the overlay
 * script into HTML.
 *
 * Baseline proxy → the deployed staging/production site: the same header
 * stripping and redirect rewriting, and the same overlay script in its
 * read-only "follow" role, so the two frames can scroll and navigate together.
 *
 * Each proxy either listens on a port of its own (on this computer, and on a
 * server with a range of preview ports), or — given a PreviewGateway — is
 * mounted on the server's one address and reached by a hostname of its own,
 * so a hosted install needs no extra ports, certificates or firewall rules.
 * The behaviour is the same either way; only where requests come from differs.
 *
 * Built on node:http/net directly: the behaviour needed is small and specific
 * (header surgery, HTML-only buffering, raw upgrade piping) and a proxy
 * library would add a dependency without removing much code.
 */
import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import net from "node:net";
import { pipeline, type Duplex } from "node:stream";
import zlib from "node:zlib";
import { OVERLAY_SCRIPT_PATH, PROXY_HEALTH_PATH } from "../../api";
import { PRODUCT } from "../../brand";
import type { PortPool } from "./ports";

/** What a proxy does with a request and with an upgrade, apart from where they arrive. */
export interface ProxyHandlers {
  request(req: IncomingMessage, res: ServerResponse): void;
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
}

/** Where the proxies are reached when they don't listen on ports of their own (a hosted install's one address). */
export interface PreviewGateway {
  /** Mounts a proxy under the gateway's address for `kind`; returns that address (an origin, no trailing slash) and how to take it down. */
  mount(kind: "preview" | "baseline", handlers: ProxyHandlers): { url: string; unmount(): void };
}

/**
 * The cookie a gateway keeps to know a browser may see the preview. Host-only
 * on each gateway hostname; `__Host-` (Secure) on https, a plain name on the
 * plain-http addresses of a local trial, where a Secure cookie can't be set.
 */
export function viewerCookieName(secure: boolean): string {
  return secure ? `__Host-${PRODUCT.slug}_viewer` : `${PRODUCT.slug}_viewer`;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** `<slug>_session`, `<slug>_session_<port>`, `__Host-<slug>_session` (and `__Secure-`), and the viewer cookie in both forms. */
const APP_COOKIE = new RegExp(`^(?:__Host-|__Secure-)?${escapeRegExp(PRODUCT.slug)}_(?:session(?:_\\d+)?|viewer)$`);

/** Whether a cookie name is one of this app's own: the editor's session in any of its forms, or a gateway's viewer cookie. */
export function isAppCookie(name: string): boolean {
  return APP_COOKIE.test(name.trim());
}

/**
 * A `Cookie` request header without this app's own cookies; undefined when
 * nothing else is left. The site's dev server runs the site's code (and the
 * deployed site is someone else's server): neither may ever see the editor's
 * session or the preview's viewer cookie. Applies with and without a gateway.
 */
export function withoutAppCookies(header: string | string[] | undefined): string | undefined {
  if (header === undefined) return undefined;
  const kept = (Array.isArray(header) ? header : [header])
    .flatMap((value) => value.split(";"))
    .map((pair) => pair.trim())
    .filter((pair) => pair !== "" && !isAppCookie(pair.split("=")[0] ?? ""));

  return kept.length > 0 ? kept.join("; ") : undefined;
}

/** Headers that describe one hop and must not be forwarded as-is. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const MAX_HTML_BYTES = 20 * 1024 * 1024;

export const OVERLAY_TAG = `<script src="${OVERLAY_SCRIPT_PATH}" defer></script>`;
/** The baseline's tag: the overlay only reports and obeys navigation and scrolling there. */
export const OVERLAY_FOLLOW_TAG = `<script src="${OVERLAY_SCRIPT_PATH}" data-galley-role="follow" defer></script>`;

/** Removes `frame-ancestors` from a CSP value and keeps every other directive. */
export function stripFrameAncestors(policy: string): string {
  return policy
    .split(";")
    .map((directive) => directive.trim())
    .filter((directive) => directive && !/^frame-ancestors(\s|$)/i.test(directive))
    .join("; ");
}

/**
 * Response headers with frame blocking removed. Empty CSPs are dropped
 * entirely (an empty header is not the same as no header to every browser).
 */
export function framableHeaders(headers: IncomingHttpHeaders): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();

    if (lower === "x-frame-options" || HOP_BY_HOP.has(lower)) continue;
    if (lower === "content-security-policy" || lower === "content-security-policy-report-only") {
      const values = (Array.isArray(value) ? value : [value]).map(stripFrameAncestors).filter(Boolean);

      if (values.length > 0) out[lower] = values;
      continue;
    }
    out[lower] = value;
  }
  return out;
}

/**
 * Inserts the overlay tag before `</head>`, else right after `<body…>`, else
 * at the end. Works on bytes (latin1 view) so pages in any ASCII-compatible
 * charset survive untouched.
 */
export function injectIntoHtml(html: Buffer, tag: string = OVERLAY_TAG): Buffer {
  const view = html.toString("latin1");

  if (view.includes(OVERLAY_SCRIPT_PATH)) return html;
  const insert = Buffer.from(tag, "utf8");
  const head = view.search(/<\/head\s*>/i);

  if (head >= 0) return Buffer.concat([html.subarray(0, head), insert, html.subarray(head)]);
  const body = /<body\b[^>]*>/i.exec(view);

  if (body) {
    const at = body.index + body[0].length;

    return Buffer.concat([html.subarray(0, at), insert, html.subarray(at)]);
  }
  return Buffer.concat([html, insert]);
}

/**
 * Adds attributes to the page's `<html>` start tag — those it doesn't have
 * already. How the preview hands a page what it needs before any script
 * runs, without touching the site's files or relying on an inline script a
 * site's CSP may refuse: `data-galley-preview` (the site kit keeps
 * third-party scripts inert) and `data-galley-endpoint` (where the kit's
 * forms send to this app's inbox). Values are attribute-escaped.
 */
export function markHtmlElement(html: Buffer, attributes: Record<string, string>): Buffer {
  const view = html.toString("latin1");
  const tag = /<html\b[^>]*>/i.exec(view);
  const names = Object.keys(attributes).filter((name) => /^[a-z][a-z0-9-]*$/.test(name));

  if (!tag || names.length === 0) return html;
  const missing = names.filter((name) => !new RegExp(`\\s${name}(\\s|=|>|/)`, "i").test(tag[0]));

  if (missing.length === 0) return html;
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const text = missing.map((name) => (attributes[name] === "" ? ` ${name}` : ` ${name}="${escape(attributes[name]!)}"`)).join("");
  const at = tag.index + tag[0].length - (tag[0].endsWith("/>") ? 2 : 1);

  return Buffer.concat([html.subarray(0, at), Buffer.from(text, "utf8"), html.subarray(at)]);
}

function isHtml(headers: IncomingHttpHeaders): boolean {
  const type = String(headers["content-type"] ?? "").toLowerCase();

  return type.includes("text/html") || type.includes("application/xhtml+xml");
}

function decoderFor(encoding: string): NodeJS.ReadWriteStream | null | "unsupported" {
  switch (encoding) {
    case "":
    case "identity":
      return null;
    case "gzip":
    case "x-gzip":
      return zlib.createGunzip();
    case "deflate":
      return zlib.createInflate();
    case "br":
      return zlib.createBrotliDecompress();
    default:
      return "unsupported";
  }
}

export interface ProxyHandle {
  /** The port it listens on; 0 when it is mounted on a gateway and has none of its own. */
  readonly port: number;
  /** Origin as the browser should use it. */
  readonly url: string;
  close(): Promise<void>;
}

interface UpstreamTarget {
  protocol: "http:" | "https:";
  /** Address to connect to. */
  hostname: string;
  port: number;
  /** Value for the Host header (and TLS SNI). */
  hostHeader: string;
  /** Origins the upstream may put in Location headers, mapped back to the proxy. */
  origins: string[];
}

function formatHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

/** Rewrites an absolute redirect that points at the upstream back to the proxy. */
export function rewriteLocation(location: string, upstreamOrigins: string[], proxyOrigin: string): string {
  for (const origin of upstreamOrigins) {
    if (location === origin) return proxyOrigin;
    if (location.startsWith(`${origin}/`) || location.startsWith(`${origin}?`) || location.startsWith(`${origin}#`)) {
      return proxyOrigin + location.slice(origin.length);
    }
  }
  return location;
}

function requestHeaders(req: IncomingMessage, target: UpstreamTarget, proxyOrigin: string, forHtml: boolean): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  const upstreamOrigin = `${target.protocol}//${target.hostHeader}`;

  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();

    if (HOP_BY_HOP.has(lower) || lower === "host") continue;
    if (lower === "cookie") {
      const cookie = withoutAppCookies(value);

      if (cookie !== undefined) out.cookie = cookie;
      continue;
    }
    out[lower] = value;
  }
  out.host = target.hostHeader;
  // Dev servers check Origin/Referer against their own host (CSRF and
  // DNS-rebinding guards); the browser sends the proxy's.
  if (typeof out.origin === "string" && out.origin === proxyOrigin) out.origin = upstreamOrigin;
  if (typeof out.referer === "string" && out.referer.startsWith(proxyOrigin)) {
    out.referer = upstreamOrigin + out.referer.slice(proxyOrigin.length);
  }
  if (forHtml) {
    // Only encodings we can decode before injecting.
    const accepted = String(out["accept-encoding"] ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => /^(gzip|deflate|br)(;|$)/i.test(part));

    if (accepted.length > 0) out["accept-encoding"] = accepted.join(", ");
    else delete out["accept-encoding"];
  }
  return out;
}

function stripCookieDomain(value: string | string[]): string[] {
  return (Array.isArray(value) ? value : [value]).map((cookie) =>
    cookie
      .split(";")
      .filter((part) => !/^\s*domain\s*=/i.test(part))
      .join(";")
  );
}

function sendError(res: ServerResponse, status: number, message: string, retry: boolean) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const body = `<!doctype html><meta charset="utf-8">${retry ? '<meta http-equiv="refresh" content="2">' : ""}<title>${message}</title><body style="font:16px system-ui,sans-serif;padding:2rem;color:#444">${message}</body>`;

  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

interface ProxyOptions {
  kind: "preview" | "baseline";
  target: UpstreamTarget;
  host: string;
  publicHost: string;
  /**
   * The scheme browsers reach the proxy with. "https" when a reverse proxy in
   * front terminates TLS for the preview ports (the proxy itself speaks HTTP). Default "http".
   */
  publicProtocol?: "http" | "https";
  /** The overlay script, served at OVERLAY_SCRIPT_PATH and injected into HTML with `overlayTag`. */
  overlayScript?: () => string | Promise<string>;
  overlayTag?: string;
  /** Allocate the listening port from an operator's range instead of a random one. */
  ports?: ProxyPorts;
  /** Called on every request and upgrade through the proxy (health checks aside): how "unused" is measured. */
  onActivity?: () => void;
  /** Attributes for every page's `<html>` (see markHtmlElement), read per page. */
  pageAttributes?: () => Record<string, string>;
  /** Mount on this gateway instead of listening; `host`, `publicHost`, `publicProtocol` and `ports` are then unused. */
  gateway?: PreviewGateway;
}

/** A port pool and the preview that will hold the port (its two proxies share one owner). */
export interface ProxyPorts {
  pool: PortPool;
  owner: object;
}

async function startProxy(options: ProxyOptions): Promise<ProxyHandle> {
  const { target, kind, gateway } = options;
  const transport = target.protocol === "https:" ? https : http;
  const agent = new transport.Agent({ keepAlive: true, maxSockets: 64 });
  /** Sockets this proxy owns: its listener's connections, piped upgrades and their upstream ends. */
  const sockets = new Set<Duplex>();
  const track = (socket: Duplex) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  };
  let proxyOrigin = "";

  const handleRequest = async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    const pathname = url.split("?")[0];

    if (pathname !== PROXY_HEALTH_PATH) options.onActivity?.();
    if (pathname === PROXY_HEALTH_PATH) {
      const body = JSON.stringify({ ok: true, kind });

      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(body);
      return;
    }
    if (pathname === OVERLAY_SCRIPT_PATH && options.overlayScript) {
      try {
        const script = await options.overlayScript();

        res.writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-store",
          "content-length": Buffer.byteLength(script),
        });
        res.end(script);
      } catch {
        sendError(res, 500, "The editing overlay couldn't be loaded.", false);
      }
      return;
    }
    // Only GET/HEAD responses can be HTML we would inject into; the request
    // encoding is adjusted up front because we cannot know the response type yet.
    const overlayTag = options.overlayScript ? options.overlayTag : undefined;
    const mayInject = overlayTag !== undefined && (req.method === "GET" || req.method === "HEAD");
    const upstream = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: url,
      headers: requestHeaders(req, target, proxyOrigin, mayInject),
      agent,
      servername: target.protocol === "https:" ? target.hostHeader.replace(/:\d+$/, "") : undefined,
      timeout: 60_000,
    });

    upstream.on("timeout", () => upstream.destroy(new Error("upstream timeout")));
    upstream.on("error", () => {
      sendError(
        res,
        502,
        kind === "preview" ? "The preview isn't answering yet. It will reload by itself." : "The deployed site couldn't be reached.",
        kind === "preview"
      );
    });
    res.on("close", () => {
      if (!res.writableFinished) upstream.destroy();
    });

    upstream.on("response", (upstreamRes) => {
      const headers = framableHeaders(upstreamRes.headers);
      const status = upstreamRes.statusCode ?? 502;

      if (typeof headers.location === "string") headers.location = rewriteLocation(headers.location, target.origins, proxyOrigin);
      // Behind a gateway the preview's hostname is a sibling of the editor's:
      // a `Domain=` the previewed server names could reach the editor's own
      // hostname, so it is cut there too (the baseline always cuts it, since
      // its domain is the deployed site's and means nothing here).
      if ((kind === "baseline" || gateway) && headers["set-cookie"]) headers["set-cookie"] = stripCookieDomain(headers["set-cookie"]);
      // A preview reachable on a public hostname must never be indexed, whatever the site says.
      if (gateway) headers["x-robots-tag"] = "noindex";

      const bodyless = req.method === "HEAD" || status === 204 || status === 304 || (status >= 100 && status < 200);
      const encoding = String(upstreamRes.headers["content-encoding"] ?? "").trim().toLowerCase();
      const decoder = decoderFor(encoding);

      if (!mayInject || bodyless || !isHtml(upstreamRes.headers) || decoder === "unsupported") {
        // Everything that is not HTML streams straight through, never buffered.
        res.writeHead(status, upstreamRes.statusMessage, headers);
        pipeline(upstreamRes, res, () => undefined);
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      const source = decoder ? upstreamRes.pipe(decoder) : upstreamRes;

      source.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size <= MAX_HTML_BYTES) chunks.push(chunk);
      });
      source.on("error", () => sendError(res, 502, "The preview sent a page that couldn't be read.", true));
      source.on("end", () => {
        const html = Buffer.concat(chunks);
        const marked = size <= MAX_HTML_BYTES && options.pageAttributes ? markHtmlElement(html, options.pageAttributes()) : html;
        const body = size <= MAX_HTML_BYTES && overlayTag ? injectIntoHtml(marked, overlayTag) : marked;

        delete headers["content-encoding"];
        delete headers["content-md5"];
        headers["content-length"] = String(body.length);
        res.writeHead(status, upstreamRes.statusMessage, headers);
        res.end(body);
      });
    });
    pipeline(req, upstream, () => undefined);
  };

  const handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (kind !== "preview") {
      socket.destroy();
      return;
    }
    track(socket);
    options.onActivity?.();
    const upstream = net.connect({ host: target.hostname, port: target.port });

    track(upstream);
    const fail = () => {
      upstream.destroy();
      socket.destroy();
    };

    upstream.on("error", fail);
    socket.on("error", fail);
    upstream.on("connect", () => {
      const headers = requestHeaders(req, target, proxyOrigin, false);
      const lines = [`${req.method ?? "GET"} ${req.url ?? "/"} HTTP/${req.httpVersion}`];

      // requestHeaders drops hop-by-hop headers; an upgrade needs these two back.
      headers.connection = "Upgrade";
      headers.upgrade = req.headers.upgrade ?? "websocket";
      for (const [name, value] of Object.entries(headers)) {
        if (value === undefined) continue;
        for (const item of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${String(item)}`);
      }
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
  };

  const handlers: ProxyHandlers = {
    request: (req, res) => void handleRequest(req, res),
    upgrade: handleUpgrade,
  };

  if (gateway) {
    // No port of its own: the server's one listener hands this proxy the
    // requests for its hostname. The connections are the server's, so only
    // what the proxy opened itself (piped upgrades, upstream sockets) is closed here.
    const mounted = gateway.mount(kind, handlers);
    let closed = false;

    proxyOrigin = mounted.url.replace(/\/+$/, "");
    return {
      port: 0,
      url: proxyOrigin,
      close: async () => {
        if (closed) return;
        closed = true;
        mounted.unmount();
        for (const socket of sockets) socket.destroy();
        sockets.clear();
        agent.destroy();
      },
    };
  }

  const server = http.createServer(handlers.request);

  server.on("connection", track);
  server.on("upgrade", handlers.upgrade);

  if (options.ports) {
    await options.ports.pool.listen(server, options.host, options.ports.owner);
  } else {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, options.host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  }
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  proxyOrigin = `${options.publicProtocol ?? "http"}://${formatHost(options.publicHost)}:${port}`;

  return {
    port,
    url: proxyOrigin,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          options.ports?.pool.release(port);
          resolve();
        });
        server.closeAllConnections();
        for (const socket of sockets) socket.destroy();
        sockets.clear();
        agent.destroy();
      }),
  };
}

export function startPreviewProxy(options: {
  upstreamHost: string;
  upstreamPort: number;
  host: string;
  publicHost: string;
  publicProtocol?: "http" | "https";
  overlayScript: () => string | Promise<string>;
  ports?: ProxyPorts;
  onActivity?: () => void;
  pageAttributes?: () => Record<string, string>;
  /** Mount on the server's one address instead of listening on a port (see PreviewGateway). */
  gateway?: PreviewGateway;
}): Promise<ProxyHandle> {
  const port = options.upstreamPort;

  return startProxy({
    kind: "preview",
    ...(options.gateway ? { gateway: options.gateway } : {}),
    ...(options.pageAttributes ? { pageAttributes: options.pageAttributes } : {}),
    host: options.host,
    publicHost: options.publicHost,
    ...(options.publicProtocol ? { publicProtocol: options.publicProtocol } : {}),
    ...(options.ports ? { ports: options.ports } : {}),
    ...(options.onActivity ? { onActivity: options.onActivity } : {}),
    overlayScript: options.overlayScript,
    overlayTag: OVERLAY_TAG,
    target: {
      protocol: "http:",
      hostname: options.upstreamHost,
      port,
      // "localhost" passes every dev server's host check (Vite's allowedHosts
      // included), whichever loopback address we actually connect to.
      hostHeader: `localhost:${port}`,
      origins: [`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`, `http://0.0.0.0:${port}`],
    },
  });
}

export function startBaselineProxy(options: {
  url: string;
  host: string;
  publicHost: string;
  /** Served and injected in the follow role; absent leaves the deployed pages untouched. */
  overlayScript?: () => string | Promise<string>;
  ports?: ProxyPorts;
  publicProtocol?: "http" | "https";
  /** Mount on the server's one address instead of listening on a port (see PreviewGateway). */
  gateway?: PreviewGateway;
}): Promise<ProxyHandle> {
  const upstream = new URL(options.url);
  const protocol = upstream.protocol === "http:" ? "http:" : "https:";
  const port = upstream.port ? Number(upstream.port) : protocol === "https:" ? 443 : 80;
  const hostname = upstream.hostname.replace(/^\[|\]$/g, "");

  return startProxy({
    kind: "baseline",
    ...(options.gateway ? { gateway: options.gateway } : {}),
    host: options.host,
    publicHost: options.publicHost,
    ...(options.publicProtocol ? { publicProtocol: options.publicProtocol } : {}),
    ...(options.ports ? { ports: options.ports } : {}),
    overlayScript: options.overlayScript,
    overlayTag: options.overlayScript ? OVERLAY_FOLLOW_TAG : undefined,
    target: {
      protocol,
      hostname,
      port,
      hostHeader: upstream.host,
      origins: [`${protocol}//${upstream.host}`, `http://${upstream.host}`, `https://${upstream.host}`],
    },
  });
}

/** One request to see whether an upstream answers at all, and how. */
export function probe(url: string, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    let parsed: URL;

    try {
      parsed = new URL(url);
    } catch {
      resolve(null);
      return;
    }
    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname.replace(/^\[|\]$/g, ""),
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        headers: { host: parsed.host, "user-agent": "Mozilla/5.0 (preview check)", accept: "text/html" },
        timeout: timeoutMs,
        agent: false,
      },
      (res) => {
        resolve(res.statusCode ?? 0);
        res.resume();
        res.destroy();
      }
    );

    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
    req.end();
  });
}
