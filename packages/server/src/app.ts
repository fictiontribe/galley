/**
 * createApp — the whole HTTP surface as a Hono app. Pure: it never listens,
 * so every route, guard and header can be exercised with `app.request()`.
 *
 * Order of the guards, for every request:
 *   1. Host check (DNS rebinding) and baseline security headers.
 *   2. Body limit on the API.
 *   2b. Hosted mode: the multi-site routes are refused (hosted-refusals.ts).
 *   3. Origin check on anything that changes state (CSRF), unless a valid
 *      Bearer token is presented. On a hosted install the one-time setup
 *      code counts as one for /api/setup/* only: the app that created the
 *      install hands it over from a server, with no Origin.
 *   4. Session check on the API (except meta, sign-in and sign-out). First
 *      run (/api/setup/*) takes the setup code until a password exists, and
 *      a session after that.
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
import { createHash } from "node:crypto";
import { getCookie } from "hono/cookie";
import type { InstallStore } from "@galley/core/install";
import type { PreviewStatus } from "@galley/core/types";
import { bearerToken, clientAddress, isAuthenticated, loopbackHostnames, normalizeHostname, requestProtocol, requestSession, safeEqual, signSession, LoginLimiter, type RevocationList, type SessionCheck } from "./auth";
import { hostedRefusals } from "./hosted-refusals";
import { errorBody, errorResponse } from "./errors";
import { createStreamRegistry } from "./events";
import { captureHandlers, CAPTURE_BODY_LIMIT_BYTES, CAPTURE_PATH } from "./forms";
import { mcpRoute } from "./mcp";
import { handOffToken, routes, type RouteContext } from "./routes";
import { fileResponse, notBuiltPage, resolveStatic } from "./static";
import type { AppOptions, Services } from "./types";

export const BODY_LIMIT_BYTES = 40 * 1024 * 1024;
/** The one route that takes a body larger than BODY_LIMIT_BYTES: a backup, streamed to a file (ops.ts), capped by GALLEY_RESTORE_MAX_MB. */
export const RESTORE_UPLOAD_PATH = "/api/install/restore/upload";
/** The routes that put a backup back: a session, or — while the install has no password yet — the setup code (starting a wiped install from a backup). */
const RESTORE_PATH = /^\/api\/install\/restore(?:\/upload)?$/;
/** While a backup is being put back, only these answer; everything else waits. */
const DURING_RESTORE = /^\/api\/(?:jobs\/[^/]+|events|meta)$/;
/** Install events worth one log line each (hosted mode): the route, and what its outcome means. */
const AUDITED: Record<string, (status: number, client: string) => string | null> = {
  "POST /api/auth/login": (status, client) =>
    status === 200 ? `Signed in from ${client}.` : status === 401 ? `A sign-in from ${client} failed: wrong password.` : status === 429 ? `A sign-in from ${client} was refused: too many attempts.` : null,
  "POST /api/install/password": (status, client) => (status === 200 ? `The password was changed (from ${client}); every other browser was signed out.` : status === 400 || status === 429 ? `A password change from ${client} was refused.` : null),
  "POST /api/auth/logout-all": (status, client) => (status === 200 ? `Signed out everywhere (from ${client}).` : null),
  "POST /api/setup/password": (status, client) => (status === 200 ? `The password was chosen through the setup link (from ${client}).` : null),
  "POST /api/setup/finish": (status) => (status === 200 ? "First run finished." : null),
};

/** Routes reachable without a session. */
const PUBLIC_ROUTES = new Set(["GET /api/meta", "POST /api/auth/login", "POST /api/auth/logout"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** First run: the routes that take the one-time setup code. */
export const SETUP_PATH = /^\/api\/setup(?:\/|$)/;

/**
 * What a Bearer value on a setup route turned out to be. "session": a setup
 * code that is no longer needed beside a signed-in cookie (a page that keeps
 * sending it after choosing the password) — the cookie decides, and the
 * Origin check applies as for any signed-in request.
 */
type SetupBearer = "token" | "code" | "wrong" | "blocked" | "session";

const NEEDS_SETUP_LINK = "Open the setup link to continue. It was printed when this editor started, or given to whoever set it up.";
const SETUP_LINK_USED = "The setup link has been used already. Sign in with the password instead.";

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
  process.stderr.write(`${new Date().toISOString()} ${line}\n`);
}

export function createApp(services: Services, options: AppOptions): Hono {
  const log = options.log ?? stderrLog;
  const trustProxy = Boolean(options.trustProxy);
  const install = options.mode === "hosted" ? (options.install ?? null) : null;
  const ops = options.mode === "hosted" ? (options.ops ?? null) : null;
  const session: SessionCheck = {
    key: options.cookieKey,
    token: options.token,
    cookieName: options.cookieName ?? `${PRODUCT.slug}_session`,
    revoked: options.revocations ?? (install ? installRevocations(install.store, log) : new Set()),
    ...(install
      ? {
          valid: (current: { id: string; issuedAt: number }) => install.store.sessionValid(current),
          issue: () => signSession(options.cookieKey, install.store.nextIssuedAt()),
          verifyPassword: (password: string) => install.store.checkPassword(password),
        }
      : {}),
    ...(options.secureCookie ? { secure: true } : {}),
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

  // 2. Body limit — except for a backup being uploaded, which is streamed to a file under its own cap.
  const limit = bodyLimit({
    maxSize: BODY_LIMIT_BYTES,
    onError: (c) => c.json(errorBody("invalid", "That's too much to send in one go. The limit is 40 MB."), 413),
  });

  app.use("/api/*", async (c, next) => (ops && c.req.method === "POST" && new URL(c.req.url).pathname === RESTORE_UPLOAD_PATH ? next() : limit(c, next)));

  // 2a. While a backup is being put back, the rest of the app waits (the browser that started it still follows it).
  if (ops) {
    app.use("/api/*", async (c, next) => {
      if (!ops.restoring() || DURING_RESTORE.test(new URL(c.req.url).pathname)) return next();
      return c.json(errorBody("busy", "A backup is being put back. Wait a moment, then sign in again."), 503);
    });
  }

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

  // 2b. A hosted install looks after one site: everything that would add, remove or switch sites is refused here.
  if (options.mode === "hosted") app.use("/api/*", hostedRefusals());

  /** The setup code (or the operator's token) on a first-run route; wrong codes count against the sign-in limit. Decided once per request. */
  const setupVerdicts = new WeakMap<Request, SetupBearer | null>();
  function setupBearer(c: Context): SetupBearer | null {
    if (setupVerdicts.has(c.req.raw)) return setupVerdicts.get(c.req.raw) ?? null;
    const bearer = bearerToken(c);
    let verdict: SetupBearer | null = null;

    if (bearer !== null && install) {
      const client = clientAddress(c, trustProxy);

      if (session.token !== null && safeEqual(bearer, session.token)) verdict = "token";
      else if (install.store.hasPassword() && requestSession(c, session) !== null) verdict = "session";
      else if (ctx.limiter.blocked(client)) verdict = "blocked";
      else if (install.store.setupCodeMatches(bearer)) verdict = "code";
      else {
        ctx.limiter.fail(client);
        verdict = "wrong";
      }
    }
    setupVerdicts.set(c.req.raw, verdict);
    return verdict;
  }
  const setupRefusal = (c: Context, verdict: SetupBearer | null) =>
    verdict === "blocked"
      ? c.json(errorBody("busy", "Too many attempts. Wait a minute, then try again."), 429)
      : c.json(errorBody("unauthorized", install?.store.hasPassword() ? (verdict === "wrong" ? SETUP_LINK_USED : "Sign in to continue.") : NEEDS_SETUP_LINK), 401);

  // 3. Origin (CSRF) — every state-changing request
  app.use("*", async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    const bearer = bearerToken(c);

    if (bearer !== null && install && (SETUP_PATH.test(new URL(c.req.url).pathname) || RESTORE_PATH.test(new URL(c.req.url).pathname))) {
      const verdict = setupBearer(c);

      if (verdict === "token" || verdict === "code") return next();
      if (verdict !== "session") return setupRefusal(c, verdict);
    } else if (bearer !== null) {
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

  // 4b. First run: the setup code until a password exists, then a session like everything else.
  const requireSetupAccess: MiddlewareHandler = async (c, next) => {
    if (!install) return requireSession(c, next);
    const verdict = setupBearer(c);

    if (verdict === "token" || verdict === "session") return next();
    if (verdict === "blocked") return setupRefusal(c, verdict);
    if (!install.store.hasPassword()) return verdict === "code" ? next() : setupRefusal(c, verdict);
    if (verdict === null && isAuthenticated(c, session)) return next();
    return setupRefusal(c, verdict);
  };

  // 4c. Putting a backup back: a signed-in browser, or the setup code while there is no password yet. Never a script's token.
  const requireRestoreAccess: MiddlewareHandler = async (c, next) => {
    const verdict = setupBearer(c);

    if (verdict === "code" || verdict === "session") return next();
    if (verdict === null && install && requestSession(c, session) !== null) return next();
    if (verdict === "token") return c.json(errorBody("forbidden", "A backup can only be put back from a signed-in browser."), 403);
    return setupRefusal(c, verdict);
  };

  // The browser (or setup code) that started a restore can still ask how it ended, though the restore signed every session out.
  if (ops) {
    app.get("/api/jobs/:jobId", async (c, next) => {
      const job = ops.grantedJob(c.req.param("jobId") ?? "", restoreCredentials(c, session));

      return job ? c.json(job) : next();
    });
  }

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

    const audit = AUDITED[key];
    const audited: MiddlewareHandler = async (c, next) => {
      await next();
      const line = audit?.(c.res.status, clientAddress(c, trustProxy));

      if (line) log(line);
    };
    const handlers: MiddlewareHandler[] = install && audit ? [audited] : [];

    // A hosted install without an address for the preview never starts one: it would have nowhere to be shown.
    if (options.mode === "hosted" && options.previewUnavailable && /\/preview\/(start|restart)$/.test(path)) {
      const detail = options.previewUnavailable;

      app.on(method, path, requireSession, async (c) => {
        if (!(await services.registry.get(c.req.param("siteId") ?? ""))) return c.json(errorBody("not-found", "That site isn't open here. Open it again from the Sites screen."), 404);
        return c.json({ state: "error", url: null, baselineUrl: null, baselineSource: null, log: [], detail } satisfies PreviewStatus);
      });
      continue;
    }
    const register = (...chain: MiddlewareHandler[]) => (app.on as unknown as (method: string, path: string, ...handlers: MiddlewareHandler[]) => void)(method, path, ...chain);

    if (PUBLIC_ROUTES.has(key)) register(...handlers, respond);
    else if (SETUP_PATH.test(path)) register(...handlers, requireSetupAccess, respond);
    else if (RESTORE_PATH.test(path) && install) register(requireRestoreAccess, respond);
    else register(...handlers, requireSession, respond);
  }
  app.all("/api/*", (c) => c.json(errorBody("not-found", "There's nothing at this address."), 404));

  // The web UI: token hand-off, then static files with SPA fallback.
  app.on(["GET", "HEAD"], "*", async (c) => {
    const url = new URL(c.req.url);
    const token = url.searchParams.get("token");

    // A hosted install's setup link (/setup?token=…) carries the one-time setup code for the page to send as a Bearer: it stays.
    if (token !== null && !(install && url.pathname === "/setup")) {
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
    const response = fileResponse(file, file.contentType.startsWith("text/html") ? headers : {}, c.req.method === "HEAD");

    // The page that holds a setup code in its address is never kept by a cache.
    if (token !== null) response.headers.set("cache-control", "no-store");
    return response;
  });

  return app;
}

/** What a request presents that could have started a restore: its session cookie's value and its Bearer value, hashed. */
export function restoreCredentials(c: Context, session: SessionCheck): string[] {
  const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
  const cookie = getCookie(c, session.cookieName);
  const bearer = bearerToken(c);

  return [...(cookie ? [`cookie:${hash(cookie)}`] : []), ...(bearer ? [`bearer:${hash(bearer)}`] : [])];
}

/**
 * A hosted install's signed-out sessions: kept in its state, so a restart
 * doesn't bring a signed-out cookie back. Taken out of use at once; written
 * to disk in the background (a failure to write is logged).
 */
export function installRevocations(store: Pick<InstallStore, "isRevoked" | "revokeSession">, log: (line: string) => void): RevocationList {
  const pending = new Set<string>();

  return {
    has: (id) => pending.has(id) || store.isRevoked(id),
    add(id) {
      pending.add(id);
      void store
        .revokeSession(id)
        .then(() => pending.delete(id))
        .catch((error: unknown) => log(`A sign-out couldn't be saved, so it lasts only until the server restarts: ${error instanceof Error ? error.message : String(error)}`));
    },
  };
}
