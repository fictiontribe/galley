/**
 * createApp — the whole HTTP surface as a Hono app. Pure: it never listens,
 * so every route, guard and header can be exercised with `app.request()`.
 *
 * Order of the guards, for every request:
 *   1. Host check (DNS rebinding) and baseline security headers.
 *   2. Body limit on the API.
 *   3. Origin check on anything that changes state (CSRF), unless a valid
 *      Bearer token is presented.
 *   4. Session check on the API (except meta, sign-in and sign-out).
 * The MCP endpoint (/mcp, when mounted) sits after 1 and 2 and applies its
 * own Origin and Bearer checks (see mcp.ts): it never accepts a cookie.
 * The form capture endpoint (/f/:siteId) sits after 1, with its own 64 KB
 * limit, and applies its own rules (see forms.ts): only the site's own
 * origins, or the site's capture key without an Origin. It reads no cookie
 * and reaches nothing but the submission store.
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { PRODUCT } from "@galley/core/brand";
import type { ApiRouteKey } from "@galley/core/api";
import { withSiteScope } from "@galley/core/site";
import { bearerToken, isAuthenticated, loopbackHostnames, normalizeHostname, requestProtocol, safeEqual, LoginLimiter, type SessionCheck } from "./auth";
import { errorBody, errorResponse } from "./errors";
import { createStreamRegistry } from "./events";
import { captureHandlers, CAPTURE_BODY_LIMIT_BYTES, CAPTURE_PATH } from "./forms";
import { mcpRoute } from "./mcp";
import { handOffToken, routes, type RouteContext } from "./routes";
import { fileResponse, notBuiltPage, resolveStatic } from "./static";
import type { AppOptions, Services } from "./types";

export const BODY_LIMIT_BYTES = 40 * 1024 * 1024;

/** Routes reachable without a session. */
const PUBLIC_ROUTES = new Set(["GET /api/meta", "POST /api/auth/login", "POST /api/auth/logout"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function uiContentSecurityPolicy(frameSources: string[]): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    `frame-src ${frameSources.length ? frameSources.join(" ") : "'none'"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}

function stderrLog(line: string): void {
  process.stderr.write(`${line}\n`);
}

export function createApp(services: Services, options: AppOptions): Hono {
  const log = options.log ?? stderrLog;
  const trustProxy = Boolean(options.trustProxy);
  const session: SessionCheck = {
    key: options.cookieKey,
    token: options.token,
    cookieName: options.cookieName ?? `${PRODUCT.slug}_session`,
    revoked: new Set(),
  };
  const ctx: RouteContext = {
    services,
    options,
    session,
    limiter: new LoginLimiter(),
    streams: options.streams ?? createStreamRegistry(),
  };
  const allowedHosts = options.allowedHosts ? new Set([...options.allowedHosts, ...loopbackHostnames()].map(normalizeHostname)) : null;
  const csp = uiContentSecurityPolicy(options.frameSources);
  const app = new Hono();

  app.onError((error, c) => errorResponse(c, error, log));
  app.notFound((c) => c.json(errorBody("not-found", "There's nothing at this address."), 404));

  // 1. Host + headers
  app.use("*", async (c, next) => {
    const url = new URL(c.req.url);

    if (allowedHosts && !allowedHosts.has(normalizeHostname(url.hostname))) {
      return c.json(errorBody("forbidden", "This address isn't one this app answers to."), 403);
    }
    await next();
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "no-referrer");
    if (url.pathname.startsWith("/api/") && !c.res.headers.has("cache-control")) c.header("cache-control", "no-store");
  });

  // 2. Body limit
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: BODY_LIMIT_BYTES,
      onError: (c) => c.json(errorBody("invalid", "That's too much to send in one go. The limit is 40 MB."), 413),
    })
  );

  // MCP over Streamable HTTP. Registered before the CSRF guard because the
  // protocol's own rules apply there: Origin refused when present and foreign,
  // Bearer only. Its responses are JSON-RPC, never the API's error shape.
  if (options.mcp) {
    const route = mcpRoute(options.mcp, { sessionToken: session.token, expectedOrigins: (c) => expectedOrigins(c), productSlug: PRODUCT.slug });

    app.use(
      "/mcp",
      bodyLimit({
        maxSize: BODY_LIMIT_BYTES,
        onError: () => new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "That request is too large. The limit is 40 MB." }, id: null }), { status: 413, headers: { "content-type": "application/json" } }),
      })
    );
    app.on(["GET", "POST", "DELETE", "PUT", "PATCH"], "/mcp", route);
  }

  // Form capture. Registered before the CSRF guard because pages on the
  // site's own (other) origins post here by design; see forms.ts.
  {
    const capture = captureHandlers(services, options);

    app.use(
      "/f/*",
      bodyLimit({
        maxSize: CAPTURE_BODY_LIMIT_BYTES,
        onError: () => new Response(JSON.stringify({ ok: false, message: "That's more than a form can send. Shorten the answers and try again." }), { status: 413, headers: { "content-type": "application/json", "cache-control": "no-store" } }),
      })
    );
    app.options(CAPTURE_PATH, capture.preflight);
    app.post(CAPTURE_PATH, capture.capture);
    app.on(["GET", "HEAD", "PUT", "PATCH", "DELETE"], CAPTURE_PATH, capture.notAllowed);
  }

  // 3. Origin (CSRF) — every state-changing request
  app.use("*", async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    const bearer = bearerToken(c);

    if (bearer !== null) {
      if (session.token !== null && safeEqual(bearer, session.token)) return next();
      return c.json(errorBody("unauthorized", "That access token isn't valid."), 401);
    }
    const origin = c.req.header("origin");

    if (origin && origin !== "null") {
      if (expectedOrigins(c).includes(origin.toLowerCase())) return next();
    } else if (c.req.header("sec-fetch-site") === "same-origin") {
      return next();
    }
    return c.json(errorBody("forbidden", "This request came from outside the app, so it was blocked."), 403);
  });

  function expectedOrigins(c: Context): string[] {
    const url = new URL(c.req.url);
    const list = [`${requestProtocol(c, trustProxy)}://${url.host}`.toLowerCase()];

    if (options.publicOrigin) list.push(options.publicOrigin.toLowerCase());
    return list;
  }

  // 4. Session
  const requireSession: MiddlewareHandler = async (c, next) => {
    if (isAuthenticated(c, session)) return next();
    const message = options.mode === "local" ? "Open the link printed when the app started to continue." : "Sign in to continue.";

    return c.json(errorBody("unauthorized", message), 401);
  };

  const table: Record<string, (c: Context, ctx: RouteContext) => Promise<unknown>> = routes as unknown as Record<string, (c: Context, ctx: RouteContext) => Promise<unknown>>;

  for (const key of Object.keys(table) as ApiRouteKey[]) {
    const space = key.indexOf(" ");
    const method = key.slice(0, space);
    const path = key.slice(space + 1);
    const handler = table[key]!;
    // A site's own keys and author apply to everything a site request starts,
    // the work that outlives the request included (core site/scope.ts).
    const siteScoped = path.includes(":siteId");
    const respond: MiddlewareHandler = async (c) => {
      const run = () => handler(c, ctx);
      const result = await (siteScoped ? withSiteScope(c.req.param("siteId") ?? "", run) : run());

      return result instanceof Response ? result : c.json(result as object);
    };

    if (PUBLIC_ROUTES.has(key)) app.on(method, path, respond);
    else app.on(method, path, requireSession, respond);
  }
  app.all("/api/*", (c) => c.json(errorBody("not-found", "There's nothing at this address."), 404));

  // The web UI: token hand-off, then static files with SPA fallback.
  app.on(["GET", "HEAD"], "*", async (c) => {
    const url = new URL(c.req.url);
    const token = url.searchParams.get("token");

    if (token !== null) {
      // The token leaves the address bar either way; only a valid one leaves a cookie behind.
      handOffToken(c, ctx, token);
      url.searchParams.delete("token");
      const search = url.searchParams.toString();

      c.header("cache-control", "no-store");
      return c.redirect(`${url.pathname}${search ? `?${search}` : ""}`, 302);
    }
    const file = await resolveStatic(options.webDir, url.pathname);
    const headers = { "content-security-policy": csp };

    if (file === "not-built") {
      return c.html(notBuiltPage(options.brand), 503, { ...headers, "cache-control": "no-cache" });
    }
    if (file === "missing") return c.text("Not found.", 404);
    return fileResponse(file, file.contentType.startsWith("text/html") ? headers : {}, c.req.method === "HEAD");
  });

  return app;
}
