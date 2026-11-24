/**
 * The preview gateway: a hosted install's previews on the server's one
 * address.
 *
 * Three hostnames reach the same port — the editor (cms.example.com), the
 * preview (cms-preview.example.com) and the live comparison
 * (cms-live.example.com). Requests for the last two never reach the app:
 * they go to whichever preview proxy is mounted for that hostname (core
 * workspace/preview/proxy.ts), so one certificate and one open port serve
 * everything. Hostnames rather than paths, because sites and dev servers use
 * root-absolute URLs and hot reload assumes the root; and the previewed site
 * must be another origin than the editor, so its scripts can never act as the
 * signed-in person.
 *
 * Who may look: the preview hostname is guessable and what answers there is
 * a dev server running the site's code, so nothing is served to a browser
 * without the viewer cookie. The editor gets a one-use ticket from the API
 * (POST /api/sites/:siteId/preview/entry), loads each frame at
 * GATEWAY_ENTRY_PATH with it, and the gateway trades it for the cookie. The
 * cookie lasts as long as the sign-in it came from (GatewayAuth.check).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { GalleyError } from "@galley/core";
import { OVERLAY_SCRIPT_PATH } from "@galley/core/api";
import type { PreviewSignInNeeded } from "@galley/core/types";
import { viewerCookieName, withoutAppCookies, type PreviewGateway, type ProxyHandlers } from "@galley/core/workspace";

export interface GatewayAuth {
  /** A one-use ticket the editor obtained → the viewer cookie's value to set, or null when the ticket is no good. */
  redeem(ticket: string): string | null;
  /** Whether a viewer cookie value is still good (its sign-in hasn't ended). */
  check(value: string | undefined): boolean;
}

export interface GatewayOptions {
  /** Origins, e.g. "https://cms-preview.example.com" and "https://cms-live.example.com". */
  previewOrigin: string;
  liveOrigin: string;
  /** The editor's origin: the only page allowed to frame the gateway's own pages, and where its "not signed in" page points. */
  editorOrigin: string;
  auth: GatewayAuth;
  /** Where a failure of `auth` itself is reported (default: stderr). Never given a ticket or a cookie. */
  log?: (line: string) => void;
}

export interface ServerGateway extends PreviewGateway {
  readonly origins: { preview: string; live: string };
  /** True when a request's Host header names one of the gateway's hostnames: such a request must NEVER reach the app. */
  owns(host: string | undefined): boolean;
  request(req: IncomingMessage, res: ServerResponse): void;
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): void;
}

/** Where a frame is first loaded: `?ticket=<one-use ticket>&to=<path on the same origin>`. Beside the overlay script, in the paths the proxies reserve. */
export const GATEWAY_ENTRY_PATH = OVERLAY_SCRIPT_PATH.replace(/[^/]+$/, "enter");

/** The entry address for a ticket on a gateway origin; the editor adds `to`. */
export function gatewayEntryUrl(origin: string, ticket: string): string {
  return `${origin.replace(/\/+$/, "")}${GATEWAY_ENTRY_PATH}?ticket=${encodeURIComponent(ticket)}`;
}

/** The message the "not let in" page sends its parent (the editor only). */
export const SIGN_IN_NEEDED: PreviewSignInNeeded = { galley: 1, type: "sign-in-needed" };

type Kind = "preview" | "baseline";

const MAX_TICKET = 1024;
const MAX_PATH = 4096;
/** RFC 6265 cookie-octet: what a cookie value may contain unquoted. */
const COOKIE_VALUE = /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/;

/** "Cms.Example.com.:443" → "cms.example.com"; "[::1]:4400" → "::1". Null when there is nothing to compare. */
export function hostnameOf(host: string | undefined): string | null {
  if (!host) return null;
  let name = host.trim().toLowerCase();

  if (name.startsWith("[")) {
    const end = name.indexOf("]");

    if (end < 0) return null;
    name = name.slice(1, end);
  } else if (name.indexOf(":") === name.lastIndexOf(":")) {
    name = name.replace(/:\d*$/, "");
  }
  name = name.replace(/\.$/, "");
  return name || null;
}

function originOf(value: string, what: string): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new GalleyError("invalid", `The ${what} address must be a full address like https://cms-preview.example.com, not “${value}”.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new GalleyError("invalid", `The ${what} address must start with https:// (or http://), not “${url.protocol}”.`);
  }
  return url;
}

/**
 * A path on the gateway's own origin to send a browser to after entry, or
 * "/". Only a single leading "/" (no scheme, no "//", no backslash, no
 * control characters a browser would drop), re-serialised so the Location
 * header is plain ASCII.
 */
export function safeReturnPath(to: string | null | undefined): string {
  if (!to || to.length > MAX_PATH) return "/";
  if (!to.startsWith("/") || to.startsWith("//") || to.includes("\\") || /[\x00-\x1f\x7f]/.test(to)) return "/";
  const base = "http://gateway.invalid";
  let url: URL;

  try {
    url = new URL(to, base);
  } catch {
    return "/";
  }
  // Dot segments can collapse into "//" ("/..//evil.example"): checked again after serialising.
  if (url.origin !== base || url.pathname.startsWith("//")) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The preview and live hostnames that go with an editor address when the
 * operator set none: same scheme and port; `cms.example.com` →
 * `cms-preview.example.com` / `cms-live.example.com` (siblings, so one
 * wildcard certificate covers them); a two-label name gets `preview.` /
 * `live.` prefixed instead (`example.com` → `preview.example.com`: a sibling
 * of an apex would be someone else's domain); `localhost` and `*.localhost`
 * get the prefixes too. Null for an IP address or a one-label name.
 */
export function defaultGatewayOrigins(publicUrl: URL): { preview: string; live: string } | null {
  const host = publicUrl.hostname.toLowerCase().replace(/\.$/, "");

  if (!host || host.startsWith("[") || host.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  const port = publicUrl.port ? `:${publicUrl.port}` : "";
  const at = (name: string) => `${publicUrl.protocol}//${name}${port}`;
  const labels = host.split(".");

  if (host === "localhost" || host.endsWith(".localhost") || labels.length === 2) {
    return { preview: at(`preview.${host}`), live: at(`live.${host}`) };
  }
  if (labels.length < 2) return null;
  const [first, ...rest] = labels as [string, ...string[]];

  // A DNS label is at most 63 characters.
  if (first.length + "-preview".length > 63) return null;
  return { preview: at(`${first}-preview.${rest.join(".")}`), live: at(`${first}-live.${rest.join(".")}`) };
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function createPreviewGateway(options: GatewayOptions): ServerGateway {
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const preview = originOf(options.previewOrigin, "preview");
  const live = originOf(options.liveOrigin, "live comparison");
  const editor = originOf(options.editorOrigin, "editor");
  const names = { preview: hostnameOf(preview.host)!, baseline: hostnameOf(live.host)! };
  const editorName = hostnameOf(editor.host);

  if (names.preview === names.baseline || names.preview === editorName || names.baseline === editorName) {
    throw new GalleyError("invalid", "The editor, the preview and the live comparison each need a hostname of their own.");
  }
  const origins = { preview: preview.origin, live: live.origin };
  const originFor: Record<Kind, string> = { preview: origins.preview, baseline: origins.live };
  const secureFor: Record<Kind, boolean> = { preview: preview.protocol === "https:", baseline: live.protocol === "https:" };
  /** Newest last: the newest mount for a kind answers, and unmounting it uncovers the one before. */
  const mounts: Record<Kind, Array<{ handlers: ProxyHandlers }>> = { preview: [], baseline: [] };
  const generated: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-robots-tag": "noindex",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors ${editor.origin}`,
  };

  const kindOf = (host: string | undefined): Kind | null => {
    const name = hostnameOf(host);

    return name === names.preview ? "preview" : name === names.baseline ? "baseline" : null;
  };

  function page(res: ServerResponse, status: number, title: string, text: string, extra: { head?: string; body?: string } = {}) {
    const html =
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">${extra.head ?? ""}<title>${escapeHtml(title)}</title>` +
      `<body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1.5rem;color:#333">` +
      `<h1 style="font-size:1.25rem">${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p>${extra.body ?? ""}</body></html>`;

    res.writeHead(status, { ...generated, "content-length": Buffer.byteLength(html) });
    res.end(html);
  }

  /** Not let in. Says where to go instead, and tells an editor framing it to ask for a fresh ticket. */
  function notLetIn(res: ServerResponse) {
    // The editor's origin is a parsed URL origin, so it can't close the script; "<" is escaped regardless.
    const notify = `<script>try{if(parent!==window)parent.postMessage(${JSON.stringify(SIGN_IN_NEEDED)},${JSON.stringify(editor.origin).replace(/</g, "\\u003c")})}catch(e){}</script>`;

    page(res, 401, "Open this from the editor", "This page is shown only inside the editor. Open the editor, sign in if it asks, and open the site there.", {
      body: `<p><a href="${escapeHtml(editor.origin)}/" target="_top">Open the editor</a></p>${notify}`,
    });
  }

  function notRunning(res: ServerResponse) {
    page(res, 503, "The preview isn't running yet.", "This page reloads by itself when it is.", { head: '<meta http-equiv="refresh" content="3">' });
  }

  /** The viewer cookie's values on this request (a page could have planted a second one; any good one will do). */
  function viewerValues(req: IncomingMessage, kind: Kind): string[] {
    const name = viewerCookieName(secureFor[kind]);
    const header = req.headers.cookie;

    if (!header) return [];
    return header
      .split(";")
      .map((pair) => pair.trim())
      .filter((pair) => pair.startsWith(`${name}=`))
      .map((pair) => pair.slice(name.length + 1));
  }

  function letIn(req: IncomingMessage, kind: Kind): boolean {
    try {
      return viewerValues(req, kind).some((value) => options.auth.check(value));
    } catch (error) {
      log(`The preview gateway couldn't check a viewer cookie: ${(error as Error).message}`);
      return false;
    }
  }

  function viewerCookie(kind: Kind, value: string): string {
    const name = viewerCookieName(secureFor[kind]);

    // Partitioned: the frame is usually cross-site to the editor (another
    // registrable domain, or names under a public suffix), and browsers that
    // block third-party cookies still keep a partitioned one for that frame.
    return secureFor[kind] ? `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=None; Partitioned` : `${name}=${value}; Path=/; HttpOnly; SameSite=Lax`;
  }

  function enter(req: IncomingMessage, res: ServerResponse, kind: Kind, url: URL) {
    if (req.method !== "GET") {
      page(res, 405, "Open this from the editor", "This address is only opened by the editor.");
      return;
    }
    const ticket = url.searchParams.get("ticket") ?? "";
    let value: string | null = null;

    if (ticket && ticket.length <= MAX_TICKET) {
      try {
        value = options.auth.redeem(ticket);
      } catch (error) {
        log(`The preview gateway couldn't redeem a ticket: ${(error as Error).message}`);
        page(res, 500, "The preview couldn't be opened", "Something went wrong on the server. Open the preview again from the editor.");
        return;
      }
      if (value !== null && !COOKIE_VALUE.test(value)) {
        log("The preview gateway was given a viewer cookie value it can't set (characters a cookie can't hold).");
        page(res, 500, "The preview couldn't be opened", "Something went wrong on the server. Open the preview again from the editor.");
        return;
      }
    }
    // A used ticket on a browser that is already let in (a frame loaded twice) still goes through.
    if (value === null && !letIn(req, kind)) {
      notLetIn(res);
      return;
    }
    const location = safeReturnPath(url.searchParams.get("to"));
    const headers: Record<string, string | number> = { ...generated, location, "content-length": 0 };

    if (value !== null) headers["set-cookie"] = viewerCookie(kind, value);
    res.writeHead(302, headers);
    res.end();
  }

  /** The Cookie header without the viewer cookie (or the app's session) before anything is proxied. */
  function consumeCookies(req: IncomingMessage) {
    const cookie = withoutAppCookies(req.headers.cookie);

    if (cookie === undefined) delete req.headers.cookie;
    else req.headers.cookie = cookie;
  }

  function refuseUpgrade(socket: Duplex, status: string) {
    socket.on("error", () => socket.destroy());
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\nCache-Control: no-store\r\n\r\n`, () => socket.destroy());
  }

  return {
    origins,
    owns: (host) => kindOf(host) !== null,
    mount(kind, handlers) {
      const entry = { handlers };

      mounts[kind].push(entry);
      return {
        url: originFor[kind],
        unmount() {
          const at = mounts[kind].indexOf(entry);

          if (at >= 0) mounts[kind].splice(at, 1);
        },
      };
    },
    request(req, res) {
      const kind = kindOf(req.headers.host);

      if (!kind) {
        page(res, 421, "Not found", "There's nothing at this address.");
        return;
      }
      let url: URL;

      try {
        url = new URL(req.url ?? "/", originFor[kind]);
      } catch {
        page(res, 400, "Not found", "There's nothing at this address.");
        return;
      }
      if (url.pathname === GATEWAY_ENTRY_PATH) {
        enter(req, res, kind, url);
        return;
      }
      if (!letIn(req, kind)) {
        notLetIn(res);
        return;
      }
      const mounted = mounts[kind].at(-1);

      if (!mounted) {
        notRunning(res);
        return;
      }
      consumeCookies(req);
      // Merged into whatever the proxy writes: a preview on a public hostname is never indexed.
      res.setHeader("x-robots-tag", "noindex");
      mounted.handlers.request(req, res);
    },
    upgrade(req, socket, head) {
      const kind = kindOf(req.headers.host);

      if (!kind || (req.url ?? "").split("?")[0] === GATEWAY_ENTRY_PATH) {
        refuseUpgrade(socket, "404 Not Found");
        return;
      }
      if (!letIn(req, kind)) {
        refuseUpgrade(socket, "401 Unauthorized");
        return;
      }
      const mounted = mounts[kind].at(-1);

      if (!mounted) {
        refuseUpgrade(socket, "503 Service Unavailable");
        return;
      }
      consumeCookies(req);
      mounted.handlers.upgrade(req, socket, head);
    },
    close() {
      mounts.preview.length = 0;
      mounts.baseline.length = 0;
    },
  };
}

/**
 * One Node listener: gateway hosts go to the gateway, everything else to the
 * app. A request for a gateway host goes to the gateway even when nothing is
 * mounted there, never to the app. Upgrades for other hosts are closed: the
 * app itself takes none.
 */
export function withGateway(
  app: (req: IncomingMessage, res: ServerResponse) => void,
  gateway: ServerGateway | null
): { request(req: IncomingMessage, res: ServerResponse): void; upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void } {
  return {
    request(req, res) {
      if (gateway?.owns(req.headers.host)) gateway.request(req, res);
      else app(req, res);
    },
    upgrade(req, socket, head) {
      if (gateway?.owns(req.headers.host)) gateway.upgrade(req, socket, head);
      else socket.destroy();
    },
  };
}
