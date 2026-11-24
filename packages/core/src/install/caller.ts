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
 * Local mode and the desktop app have no accounts: no person in scope is
 * everything allowed. A hosted install switches that off at start
 * (requireCallerForGuardedWork): there, guarded work runs only for a
 * person, inside `asOperator` (the operator's token on the API and /mcp,
 * the command line's operator commands) or inside `asEngine` (the engine's
 * own unattended steps: start-up, first run, a restore). Anything else —
 * what runs outside any request, such as a plugin reacting to an event
 * after the request that loaded it ended — is refused. The two marks are
 * deliberately few and named, so each use is a decision someone can review.
 *
 * Long-lived things made lazily during a request (an open site and its
 * watcher, the preview, a site's plugins) are made `outsideAnyPerson`, so
 * they carry nobody's name or access into work done later for someone else.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { PRODUCT } from "../brand";
import { GalleyError } from "../errors";
import { withoutAccountAuthor } from "../workspace/author";
import { outsideAnyCheckpoint } from "../workspace/checkpoint";
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

/** Said, on a hosted install, when guarded work runs for nobody. */
export const NO_CALLER_REFUSAL =
  "Only someone signed in to this editor, or whoever runs it, can do that. Work that runs on its own, such as a plugin reacting to an event, can't publish, change the site's settings or change anything outside the content.";

type Scope = { kind: "person"; caller: Caller } | { kind: "operator" } | { kind: "engine" };

const storage = new AsyncLocalStorage<Scope | null>();

/**
 * Hosted install: whether guarded work with nobody in scope is refused. Never set in local mode or the desktop app.
 * One value for the whole process: a hosted and a local server started in the
 * same process (tests, or an embedding) share it, which is why a local
 * server marks its own requests as the operator's (server app.ts).
 */
let callerRequired = false;

/** Set by a hosted server at start (and cleared when it stops): from then on, guarded work needs a person, the operator or the engine. */
export function requireCallerForGuardedWork(on: boolean): void {
  callerRequired = on;
}

/** Runs `run` as this person (null: nobody). Follows the asynchronous work `run` starts. */
export function withCaller<T>(caller: Caller | null, run: () => T): T {
  return storage.run(caller ? { kind: "person", caller } : null, run);
}

/**
 * The operator's mark: `run` is done by whoever runs the server — its access
 * token on the API or /mcp, or an operator's command on the command line.
 * Everything is allowed inside it, as it always was for the operator.
 */
export function asOperator<T>(run: () => T): T {
  return storage.run({ kind: "operator" }, run);
}

/**
 * The engine's mark: `run` is the engine's own unattended work (start-up,
 * first run's steps, a restore, its own bookkeeping in the settings file),
 * which no person asked for and which must not fail for want of one.
 */
export function asEngine<T>(run: () => T): T {
  return storage.run({ kind: "engine" }, run);
}

/** The person whose work this is, or null (nobody, the operator, the engine). */
export function currentCaller(): Caller | null {
  const scope = storage.getStore();

  return scope?.kind === "person" ? scope.caller : null;
}

/**
 * Runs `run` as nobody: neither this person's access nor their publishing
 * name, and no part of an assistant turn that happens to be under way
 * (workspace/checkpoint.ts). For what is made once during someone's request
 * and serves everyone after (an open site, its watcher, the preview).
 */
export function outsideAnyPerson<T>(run: () => T): T {
  return storage.run(null, () => withoutAccountAuthor(() => outsideAnyCheckpoint(run)));
}

/** Whether the work in progress may do what needs `level`: the role it began with and the role now must both allow it. */
export function callerMay(level: AccessLevel): boolean {
  const scope = storage.getStore();

  if (!scope) return !callerRequired;
  if (scope.kind !== "person") return true;
  const { caller } = scope;

  if (!roleMay(caller.role, level)) return false;
  if (!caller.current) return true;
  const now = caller.current();

  return now !== null && roleMay(now, level);
}

/** Refuses, in one plain sentence, what the person whose work this is may not do. */
export function requireLevel(level: AccessLevel, refusal: string = ROLE_REFUSAL): void {
  if (!callerMay(level)) throw new GalleyError("forbidden", callerRefusal(refusal));
}

/** What a refusal says: `refusal` for a person; for work done for nobody (hosted), that it needs someone. */
export function callerRefusal(refusal: string): string {
  return storage.getStore() ? refusal : NO_CALLER_REFUSAL;
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
