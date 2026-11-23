// @ts-check
// The dev-server side of the toolbar app: `GET /__galley/status` answers
// whether a Galley server is listening at the configured address. The check
// runs from Node, so the page never makes a cross-origin request and Galley
// needs no CORS rules for it.

import { PROBE_TIMEOUT_MS, STATUS_CACHE_MS, STATUS_PATH } from "./constants.js";

/**
 * @typedef {object} GalleyStatus
 * @property {boolean} running Whether a Galley server answered at `url`.
 * @property {string} url The address that was checked.
 * @property {string} root The project's folder, absolute, without a trailing slash.
 */

/**
 * Whether a Galley server answers at `url`. `GET /api/meta` is the one route
 * Galley serves without a session; a Galley answer carries a `brand` object
 * and a `mode`. Anything else — refused, timed out, another app, not JSON —
 * counts as not running.
 *
 * @param {string} url
 * @param {{ timeoutMs?: number, fetch?: typeof fetch }} [options]
 * @returns {Promise<boolean>}
 */
export async function probeGalley(url, options = {}) {
  const { timeoutMs = PROBE_TIMEOUT_MS, fetch: fetchImpl = fetch } = options;
  let target;

  try {
    target = new URL("/api/meta", url);
  } catch {
    return false;
  }
  try {
    const response = await fetchImpl(target, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) return false;
    /** @type {unknown} */
    const body = await response.json();

    return isMeta(body);
  } catch {
    return false;
  }
}

/** @param {unknown} body */
function isMeta(body) {
  if (typeof body !== "object" || body === null) return false;
  const { brand, mode } = /** @type {{ brand?: unknown, mode?: unknown }} */ (body);

  return typeof brand === "object" && brand !== null && (mode === "local" || mode === "hosted");
}

/**
 * The paths the status route answers on: the bare path, and the path under
 * the site's `base` (Astro serves a project at `/<base>/` in development too).
 *
 * @param {string} base
 * @returns {Set<string>}
 */
export function statusPaths(base = "/") {
  const prefix = base.replace(/\/+$/, "");

  return new Set([STATUS_PATH, `${prefix}${STATUS_PATH}`]);
}

/**
 * A Connect-style middleware for Vite's dev server.
 *
 * @param {{ url: string, root: string, base?: string, probe?: (url: string) => Promise<boolean>, cacheMs?: number, now?: () => number }} options
 * @returns {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, next: (error?: unknown) => void) => void}
 */
export function createStatusMiddleware(options) {
  const { url, root, base = "/", probe = probeGalley, cacheMs = STATUS_CACHE_MS, now = Date.now } = options;
  const paths = statusPaths(base);
  /** @type {{ at: number, running: Promise<boolean> } | null} */
  let cached = null;

  const running = () => {
    const at = now();

    if (!cached || at - cached.at >= cacheMs) cached = { at, running: probe(url).catch(() => false) };
    return cached.running;
  };

  return (req, res, next) => {
    const pathname = (req.url ?? "").split("?")[0] ?? "";

    if (!paths.has(pathname)) {
      next();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.statusCode = 405;
      res.setHeader("allow", "GET, HEAD");
      res.end();
      return;
    }
    running().then((isRunning) => {
      /** @type {GalleyStatus} */
      const status = { running: isRunning, url, root };
      const body = JSON.stringify(status);

      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-content-type-options", "nosniff");
      res.end(req.method === "HEAD" ? undefined : body);
    }, next);
  };
}
