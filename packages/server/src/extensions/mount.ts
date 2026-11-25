/**
 * Added routes on the app: after the editor's own, before the catch-all, in
 * a branch of their own. The middleware that guards every `/api/*` route has
 * run by the time one of these is reached (the host check, the body limit,
 * the wait while a backup is put back, the hosted refusals, the origin check
 * on what changes state). This adds:
 *
 *   - where the request came from: with a cookie, the browser must say the
 *     request is the editor's own page's (or typed by hand). The origin check
 *     doesn't cover GET, and a same-site page — the site's own preview, its
 *     live site, anything else on `localhost` — is sent the cookie;
 *   - the route's level, by the same check as a built-in route;
 *   - what a part of the address may be: never a path;
 *   - the handler's own wrapper: it is handed a narrowed request, not the
 *     framework's, and what it returns is sent as JSON or not at all.
 *
 * The handler runs as its caller. Once it has answered — or the sign-in
 * stops counting — work it left running is nobody's: on a hosted install
 * nobody may not publish, use build mode or change the site's settings.
 * (The publishing name is another matter: it follows the work, as it does
 * for any request, so what such work records still carries the name of the
 * person whose request started it.)
 *
 * The body reader runs inside the same care as the handler: its errors are
 * the route's, a promise from it is awaited, and nothing it throws escapes.
 */
import type { Context, Hono, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { GalleyError, isGalleyError } from "@galley/core";
import { asOperator, OUTLIVED_REFUSAL, SIGN_IN_ENDED_REFUSAL, withCaller, type AccessLevel, type Account, type AccountRole } from "@galley/core/install";
import { withSiteScope } from "@galley/core/site";
import type { SiteService } from "@galley/core/types";
import { bearerToken, type SessionInfo } from "../auth";
import { AuthError, errorBody, forbidden, invalid, notFound } from "../errors";
import { NEEDS_A_PERSON } from "../who";
import type { DeclaredRoute } from "./declare";
import { isJson } from "./json";
import { duringGet, guardSite } from "./site";
import type { StartedExtension, StartedExtensions } from "./run";
import type { ExtensionCaller, ExtensionRequest, JsonValue, SessionRef } from "./types";

export const NOT_FROM_THE_EDITOR = "That request didn't come from the editor's own page, so it wasn't done.";
export { isJson } from "./json";
export const NOT_AN_ADDRESS = "There's nothing at this address.";
const TOO_MUCH = "That's too much to send in one go.";

/** Who is calling, as the app's own guards worked it out. Null: nobody (the level check has already refused them). */
export type MountCaller = { kind: "local" } | { kind: "operator" } | { kind: "person"; account: Account; session: SessionInfo };

export interface MountDeps {
  hosted: boolean;
  requireLevel(level: AccessLevel): MiddlewareHandler;
  callerOf(c: Context): MountCaller | null;
  site(siteId: string): Promise<SiteService | null>;
  refOf(session: SessionInfo): SessionRef;
  stillCounts(session: SessionInfo): boolean;
  liveRole(accountId: string): AccountRole | null;
  liveNamed(accountId: string): boolean;
  /** Runs `run` so that what it records in the repository carries this person's name (null: nobody's). */
  withAuthor<T>(person: Account | null, run: () => T): T;
}

/** With a cookie, only the editor's own pages (or an address typed by hand) may call. A Bearer token is a script's, and exempt. */
const fromTheEditor: MiddlewareHandler = async (c, next) => {
  if (bearerToken(c) !== null) return next();
  const from = c.req.header("sec-fetch-site");

  if (from === "same-origin" || from === "none") return next();
  return c.json(errorBody("forbidden", NOT_FROM_THE_EDITOR), 403);
};

/** A decoded part of the address that could be joined into a path somewhere else. */
function pathLike(value: string): boolean {
  return value === "." || value === ".." || value.includes("/") || value.includes("\\") || value.includes("\0");
}

async function readBody(c: Context): Promise<unknown> {
  const text = await c.req.text();

  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalid("The request body isn't valid JSON.");
  }
}

export const NOT_RUNNING = "That part of the editor isn't running just now. Try again in a moment; if it stays so, whoever runs this editor needs to restart it.";

function handlerFor(runtime: StartedExtensions, id: string, key: string, deps: MountDeps): MiddlewareHandler {
  return async (c) => {
    // The one running now: after a backup is put back, extensions are started again, and the routes are theirs.
    const extension = runtime.find(id);
    const declared = extension?.routes.find((candidate) => candidate.key === key);

    if (!extension || !declared) return c.json(errorBody("busy", NOT_RUNNING), 503);
    const { route } = declared;
    const readOnly = declared.method === "GET";
    const who = deps.callerOf(c);

    if (!who) throw new AuthError("Sign in to continue.");
    if (route.person && who.kind === "operator") throw forbidden(NEEDS_A_PERSON);
    const params = c.req.param() as Record<string, string>;

    if (Object.values(params).some(pathLike)) return c.json(errorBody("invalid", NOT_AN_ADDRESS), 400);
    const siteId = declared.siteScoped ? (params.siteId ?? "") : null;
    const site = siteId === null ? null : await deps.site(siteId);

    if (siteId !== null && !site) throw notFound("That site isn't open here. Open it again from the Sites screen.");
    if (site) extension.handed(site.id);
    const read = route.body ? await readBody(c) : undefined;
    const query: Record<string, string | undefined> = Object.create(null) as Record<string, string | undefined>;

    for (const [name, value] of Object.entries(c.req.query())) query[name] = value;
    const caller: ExtensionCaller =
      who.kind === "person" ? Object.freeze({ kind: "person", account: who.account.id, role: who.account.role, name: who.account.name, session: deps.refOf(who.session) }) : Object.freeze({ kind: who.kind });
    // Once the handler has answered, what it left running is no longer its caller's (core install/caller.ts asks `lapsed` at each check).
    let answered = false;
    /** The body's reader, then the handler: both the route's own code, both inside the caller's scope and the same handling of what they throw. */
    const work = async (): Promise<unknown> => {
      const request: ExtensionRequest<unknown> = Object.freeze({
        params: Object.freeze({ ...params }),
        query: Object.freeze(query),
        body: route.body ? await route.body(read) : undefined,
        caller,
        ...(site ? { site: guardSite(site, { readOnly, alive: extension.alive }) } : {}),
        signal: c.req.raw.signal,
      });

      return route.handle(request);
    };
    const inSite = () => (siteId === null ? work() : withSiteScope(siteId, work));
    // On a GET, every site the handler reaches refuses to change, however it reaches it.
    const run = () => (readOnly ? duringGet(inSite) : inSite());
    const asCaller = (): Promise<unknown> => {
      if (who.kind === "person") {
        const { account, session } = who;

        const lapsed = () => (answered ? OUTLIVED_REFUSAL : deps.stillCounts(session) ? null : SIGN_IN_ENDED_REFUSAL);

        return withCaller({ accountId: account.id, role: account.role, current: () => deps.liveRole(account.id), named: () => deps.liveNamed(account.id), lapsed }, () => deps.withAuthor(account, run));
      }
      // The operator's token: everything, while the handler runs. (Where there are no accounts, every request is the operator's, as it always was.)
      if (who.kind === "operator" && deps.hosted) return withCaller({ accountId: "operator", role: "owner", lapsed: () => (answered ? OUTLIVED_REFUSAL : null) }, () => deps.withAuthor(null, run));
      return asOperator(() => deps.withAuthor(null, run));
    };
    let result: unknown;

    try {
      result = await asCaller();
    } catch (error) {
      // Only the editor's own check answers "not signed in": the app sends a person to sign in when it sees a 401, whoever sent it.
      if (error instanceof AuthError) throw new GalleyError("forbidden", extension.scrub(error.message));
      if (error instanceof HTTPException && error.status === 401) throw new GalleyError("forbidden", "That isn't allowed.");
      if (isGalleyError(error)) {
        const notSignedIn = error.code === "unauthorized" || error.status === 401;

        throw new GalleyError(notSignedIn && error.code === "unauthorized" ? "forbidden" : error.code, extension.scrub(error.message), error.detail ? extension.scrub(error.detail) : undefined, notSignedIn ? 403 : error.status);
      }
      throw error;
    } finally {
      answered = true;
    }
    if (!isJson(result)) throw new GalleyError("internal", "That couldn't be done because of an unexpected problem. Try again.", `The extension “${extension.id}” answered ${declared.key} with something that isn't JSON.`);
    return c.json(result);
  };
}

/**
 * Mounts every started extension's routes. Call after the editor's own routes
 * and before its catch-all. The addresses are those the extensions declared
 * when the server started; each call goes to the extension running at that
 * moment, so one started again (after a backup is put back) is the one asked.
 */
export function mountExtensions(app: Hono, runtime: StartedExtensions, deps: MountDeps): void {
  const register = app.on as unknown as (method: string, path: string, ...handlers: MiddlewareHandler[]) => void;

  for (const extension of runtime.list) {
    for (const declared of extension.routes) {
      const limit = bodyLimit({ maxSize: declared.bodyLimit, onError: (c) => c.json(errorBody("invalid", TOO_MUCH), 413) });

      register(declared.method, declared.path, fromTheEditor, deps.requireLevel(declared.route.access), limit, handlerFor(runtime, extension.id, declared.key, deps));
    }
  }
}
