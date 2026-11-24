/**
 * Whose request the work in progress is, and what their role lets them do,
 * carried implicitly the way the publishing name is (workspace/author.ts)
 * and the site is (site/scope.ts).
 *
 * The server runs every request of a signed-in person on a hosted install
 * inside `withCaller(…)`. The engine asks `requireLevel` at the point of
 * use — the site's settings file, build mode, publishing — so a route, the
 * assistant's tools, an MCP tool and a plugin's tool are held to the same
 * rule, and the work a request starts that outlives it (an assistant turn,
 * a job) keeps that person's access to the end. The role is also read
 * again when it is checked: a person demoted or switched off mid-turn can
 * do no more than their role allows now.
 *
 * No person in scope — local mode, the desktop app, the operator's token,
 * the engine's own background work — is everything allowed, exactly as
 * before accounts. Long-lived things made lazily during a request (an open
 * site and its watcher, the preview) are made `outsideAnyPerson`, so they
 * carry nobody's name or access into work done later for someone else.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { PRODUCT } from "../brand";
import { GalleyError } from "../errors";
import { withoutAccountAuthor } from "../workspace/author";
import { roleMay, type AccessLevel, type AccountRole } from "./accounts";
import { BUILD_MODE_LEVEL, ROLE_REFUSAL, SITE_SETTINGS_LEVEL } from "./route-access";

export interface Caller {
  /** The account's id, for the log and for tests; never used to decide anything. */
  accountId: string;
  /** The role as the request began. */
  role: AccountRole;
  /** The role now, read whenever access is checked. Null: the account was switched off or removed. */
  current?: () => AccountRole | null;
}

/** Said when someone without BUILD_MODE_LEVEL asks for build mode, whichever way they ask. */
export const BUILD_MODE_REFUSAL = "Your account can change the site's content, but not its code and templates (build mode). Ask an owner or an editor of this editor.";
/** Said when someone without SITE_SETTINGS_LEVEL would change the site's settings file, whichever way. */
export const SITE_SETTINGS_REFUSAL = "Your account can't change the site's settings. Ask an owner of this editor.";

const storage = new AsyncLocalStorage<Caller | null>();

/** Runs `run` as this person (null: nobody — everything allowed). Follows the asynchronous work `run` starts. */
export function withCaller<T>(caller: Caller | null, run: () => T): T {
  return storage.run(caller, run);
}

/** The person whose work this is, or null (local mode, the operator's token, the engine's own work). */
export function currentCaller(): Caller | null {
  return storage.getStore() ?? null;
}

/**
 * Runs `run` as nobody: neither this person's access nor their publishing
 * name. For what is made once during someone's request and serves everyone
 * after (an open site, its watcher, the preview).
 */
export function outsideAnyPerson<T>(run: () => T): T {
  return storage.run(null, () => withoutAccountAuthor(run));
}

/** Whether the work in progress may do what needs `level`: the role it began with and the role now must both allow it. */
export function callerMay(level: AccessLevel): boolean {
  const caller = storage.getStore();

  if (!caller) return true;
  if (!roleMay(caller.role, level)) return false;
  if (!caller.current) return true;
  const now = caller.current();

  return now !== null && roleMay(now, level);
}

/** Refuses, in one plain sentence, what the person whose work this is may not do. */
export function requireLevel(level: AccessLevel, refusal: string = ROLE_REFUSAL): void {
  if (!callerMay(level)) throw new GalleyError("forbidden", refusal);
}

export function requireBuildMode(): void {
  requireLevel(BUILD_MODE_LEVEL, BUILD_MODE_REFUSAL);
}

export function requireSiteSettings(): void {
  requireLevel(SITE_SETTINGS_LEVEL, SITE_SETTINGS_REFUSAL);
}

/**
 * Whether a site-relative path is the site's settings file. Compared without
 * letter case: on the file systems most sites live on, GALLEY.CONFIG.JSON is
 * the same file.
 */
export function isSiteSettingsPath(path: string): boolean {
  return path.toLowerCase() === PRODUCT.configFile.toLowerCase();
}
