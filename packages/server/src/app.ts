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
 *   4. Who may call the route, from the one table (core
 *      install/route-access.ts): "public" routes need nobody; first run
 *      (/api/setup/*) takes the setup code until an owner exists, then an
 *      owner; putting a backup back takes an owner's browser (or the setup
 *      code while there is no owner); every other route a signed-in person
 *      whose role has the route's level. Someone without it gets 403 and
 *      one plain sentence. Local mode has no accounts: any session will do.
 *      The operator's Bearer token (GALLEY_TOKEN) keeps the reach it always
 *      had: every route but the few that need a person's browser.
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
import { asOperator, ROLE_REFUSAL as CORE_ROLE_REFUSAL, ROUTE_ACCESS, roleMay, withCaller, type AccessLevel, type AccountRole, type InstallStore } from "@galley/core/install";
import type { PreviewStatus } from "@galley/core/types";
import { withAccountAuthor } from "@galley/core/workspace";
import { bearerToken, clientAddress, clientKeyOf, isAuthenticated, loopbackHostnames, normalizeHostname, requestProtocol, requestSession, safeEqual, signSession, LoginLimiter, type RevocationList, type SessionCheck } from "./auth";
import { hostedRefusals } from "./hosted-refusals";
import { withoutKeyHints } from "./key-hints";
import { errorBody, errorResponse } from "./errors";
import { createStreamRegistry } from "./events";
import { captureHandlers, CAPTURE_BODY_LIMIT_BYTES, CAPTURE_PATH } from "./forms";
import { mcpRoute } from "./mcp";
import { handOffToken, routes, type RouteContext } from "./routes";
import { fileResponse, notBuiltPage, resolveStatic } from "./static";
import { themeScript } from "./themes-routes";
import type { AppOptions, Services } from "./types";
import { callerOf, personFromCookie, settleCaller } from "./who";

export const BODY_LIMIT_BYTES = 40 * 1024 * 1024;
/** The one route that takes a body larger than BODY_LIMIT_BYTES: a backup, streamed to a file (ops.ts), capped by GALLEY_RESTORE_MAX_MB. */
export const RESTORE_UPLOAD_PATH = "/api/install/restore/upload";
/** The routes that put a backup back: a session, or — while the install has no password yet — the setup code (starting a wiped install from a backup). */
const RESTORE_PATH = /^\/api\/install\/restore(?:\/upload)?$/;
/** While a backup is being put back, only these answer; everything else waits. */
const DURING_RESTORE = /^\/api\/(?:jobs\/[^/]+|events|meta)$/;
/**
 * Install events worth one log line each (hosted mode) that the route itself
 * doesn't write: the route, and what its outcome means. Sign-ins, password
 * changes and everything about people are written by their handlers, which
 * know whose account it was (accounts-routes.ts).
 */
const AUDITED: Record<string, (status: number, client: string) => string | null> = {
  "POST /api/setup/finish": (status) => (status === 200 ? "First run finished." : null),
};

/** What someone signed in, but without the level a route needs, is told (the same sentence the web app's mock sends). */
export const ROLE_REFUSAL = CORE_ROLE_REFUSAL;
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
const SETUP_LINK_USED = "The setup link has been used already. Sign in instead.";

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
    // Its own name: a browser someone has signed in on before (sign-in-gate.ts), never a session.
    ...(install ? { knownCookieName: `${options.cookieName ?? `${PRODUCT.slug}_session`}_known` } : {}),
    revoked: options.revocations ?? (install ? installRevocations(install.store, log) : new Set()),
    ...(install
      ? {
          // Only a person's cookie counts on a hosted install: one from before accounts (or from a local app) names nobody.
          valid: (current: { id: string; issuedAt: number; accountId?: string }) => current.accountId !== undefined && install.store.sessionValid(current),
          issue: (accountId?: string) => signSession(options.cookieKey, install.store.nextIssuedAt(Date.now(), accountId), undefined, accountId),
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
      const client = clientKeyOf(c, trustProxy);

      if (session.token !== null && safeEqual(bearer, session.token)) verdict = "token";
      else if (install.store.hasOwner() && requestSession(c, session) !== null) verdict = "session";
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
      : c.json(errorBody("unauthorized", install?.store.hasOwner() ? (verdict === "wrong" ? SETUP_LINK_USED : "Sign in to continue.") : NEEDS_SETUP_LINK), 401);

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

  // 4. Who may call the route (core install/route-access.ts).
  const unauthorized = (c: Context) => c.json(errorBody("unauthorized", options.mode === "local" ? "Open the link printed when the app started to continue." : "Sign in to continue."), 401);

  /** A route's level: any session where there are no accounts; on a hosted install a person whose role has it, or the operator's token. */
  const requireLevel =
    (level: AccessLevel): MiddlewareHandler =>
    async (c, next) => {
      if (!install) return isAuthenticated(c, session) ? next() : unauthorized(c);
      const caller = callerOf(c, ctx);

      if (!caller) return unauthorized(c);
      if (caller.kind === "token" || roleMay(caller.account.role, level)) return next();
      return c.json(errorBody("forbidden", ROLE_REFUSAL), 403);
    };
  const requireOwner = requireLevel("manage");
  /** A person's role as the install has it now: null once they are switched off or removed. */
  const liveRole = (accountId: string): AccountRole | null => {
    const account = install?.store.account(accountId);

    return account && !account.disabled ? account.role : null;
  };

  // 4b. First run: the setup code until an owner exists, then an owner like everything else of the install's.
  const requireSetupAccess: MiddlewareHandler = async (c, next) => {
    if (!install) return requireOwner(c, next);
    const verdict = setupBearer(c);

    if (verdict === "token") return next();
    if (verdict === "session") {
      settleCaller(c, personFromCookie(c, ctx));
      return requireOwner(c, next);
    }
    if (verdict === "blocked") return setupRefusal(c, verdict);
    if (!install.store.hasOwner()) return verdict === "code" ? next() : setupRefusal(c, verdict);
    if (verdict === null && callerOf(c, ctx)?.kind === "person") return requireOwner(c, next);
    return setupRefusal(c, verdict);
  };

  // 4c. Putting a backup back: an owner's signed-in browser, or the setup code while there is no owner yet. Never a script's token.
  const requireRestoreAccess: MiddlewareHandler = async (c, next) => {
    const verdict = setupBearer(c);

    if (verdict === "code") return next();
    if (verdict === "session") {
      settleCaller(c, personFromCookie(c, ctx));
      return requireOwner(c, next);
    }
    if (verdict === null && install && callerOf(c, ctx)?.kind === "person") return requireOwner(c, next);
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
      const scoped = () => (siteScoped ? withSiteScope(c.req.param("siteId") ?? "", run) : run());
      // On a hosted install everything a person's request records in the repository carries their name (core workspace/author.ts),
      // and everything it does is held to their role at the point of use, the work it starts included (core install/caller.ts).
      const caller = install ? callerOf(c, ctx) : null;
      const person = caller?.kind === "person" ? caller.account : null;
      // The operator's mark (core install/caller.ts) for the operator's token on a hosted install, and for every request in local mode,
      // where whoever holds the start-up token is the one person who runs the app. Only a hosted server makes guarded work need
      // someone; the mark keeps a local app in the same process (tests, an embedding) as it always was.
      const operator = options.mode === "local" || caller?.kind === "token";
      const result = person
        ? await withCaller({ accountId: person.id, role: person.role, current: () => liveRole(person.id) }, () => withAccountAuthor(person, scoped))
        : operator
          ? await asOperator(() => withAccountAuthor(null, scoped))
          : await withAccountAuthor(null, scoped);

      if (result instanceof Response) return result;
      // A key's last characters are for whoever may manage the keys (key-hints.ts): the role as the request began and as it is now must both allow it.
      const now = caller?.kind === "person" ? install!.people.get(caller.account.id) : null;
      const hide = caller?.kind === "person" && (!roleMay(caller.account.role, "manage") || !now || !roleMay(now.role, "manage"));

      return c.json((hide ? withoutKeyHints(key, result) : result) as object);
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

      app.on(method, path, requireLevel(ROUTE_ACCESS[key] as AccessLevel), async (c) => {
        if (!(await services.registry.get(c.req.param("siteId") ?? ""))) return c.json(errorBody("not-found", "That site isn't open here. Open it again from the Sites screen."), 404);
        return c.json({ state: "error", url: null, baselineUrl: null, baselineSource: null, log: [], detail } satisfies PreviewStatus);
      });
      continue;
    }
    const register = (...chain: MiddlewareHandler[]) => (app.on as unknown as (method: string, path: string, ...handlers: MiddlewareHandler[]) => void)(method, path, ...chain);

    const access = ROUTE_ACCESS[key];

    if (access === "public") register(...handlers, respond);
    else if (access === "setup") register(...handlers, requireSetupAccess, respond);
    else if (access === "restore") register(install ? requireRestoreAccess : requireOwner, respond);
    else register(...handlers, requireLevel(access), respond);
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
    // The start-up script carries the install's default theme, so a first visit paints it from the start.
    if (url.pathname === "/theme.js" && options.webDir) {
      const script = await themeScript(options.webDir, ctx);

      if (script !== null) return c.body(c.req.method === "HEAD" ? null : script, 200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" });
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
