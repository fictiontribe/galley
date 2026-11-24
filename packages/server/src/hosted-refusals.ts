/**
 * What a hosted install refuses before any handler runs. A hosted server
 * looks after exactly one site, so everything that would add, remove, scan
 * for, file or switch sites answers 403 with one plain sentence, and
 * "Host the editor online" (which only the desktop and local app offer)
 * isn't there at all (404).
 *
 * The engine refuses the same actions too (core install/single-site.ts);
 * this list is what the HTTP layer says, so the answer is the same however
 * a route is written.
 */
import type { MiddlewareHandler } from "hono";
import type { ApiRouteKey } from "@galley/core/api";
import { ONE_SITE_MESSAGE } from "@galley/core/install";
import { errorBody } from "./errors";

/** Every route a hosted install refuses with 403. */
export const MULTI_SITE_ROUTES = [
  "POST /api/sites/open",
  "POST /api/sites/clone",
  "POST /api/sites/create",
  "POST /api/sites/scan",
  "POST /api/sites/scan/cancel",
  "POST /api/sites/add",
  "DELETE /api/sites/:siteId",
  "POST /api/groups",
  "PATCH /api/groups/:groupId",
  "DELETE /api/groups/:groupId",
  "PUT /api/groups/order",
  "PATCH /api/sites/:siteId/listing",
  "GET /api/open",
  "GET /api/fs/list",
] as const satisfies readonly ApiRouteKey[];

/** "Host the editor online": not part of a hosted install (404). Prefixes, so routes added there later are covered too. */
export const EDITOR_HOST_PATHS: readonly RegExp[] = [/^\/api\/editor-hosts(?:\/|$)/, /^\/api\/sites\/[^/]+\/editor(?:\/|$)/];

interface CompiledRoute {
  method: string;
  pattern: RegExp;
}

function compile(key: string): CompiledRoute {
  const space = key.indexOf(" ");
  const path = key.slice(space + 1);
  const source = path
    .split("/")
    .map((segment) => (segment.startsWith(":") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");

  return { method: key.slice(0, space), pattern: new RegExp(`^${source}/?$`) };
}

const REFUSED = MULTI_SITE_ROUTES.map(compile);

/** Whether a request is one of MULTI_SITE_ROUTES. HEAD counts as the GET it stands for. */
export function isMultiSiteRoute(method: string, path: string): boolean {
  const verb = method.toUpperCase() === "HEAD" ? "GET" : method.toUpperCase();

  return REFUSED.some((route) => route.method === verb && route.pattern.test(path));
}

export function isEditorHostRoute(path: string): boolean {
  return EDITOR_HOST_PATHS.some((pattern) => pattern.test(path));
}

/** The guard createApp puts in front of every route in hosted mode. */
export function hostedRefusals(): MiddlewareHandler {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;

    if (isEditorHostRoute(path)) return c.json(errorBody("not-found", "Hosting the editor online isn't available on a hosted editor. Use the desktop app for that."), 404);
    if (isMultiSiteRoute(c.req.method, path)) return c.json(errorBody("forbidden", ONE_SITE_MESSAGE), 403);
    return next();
  };
}
