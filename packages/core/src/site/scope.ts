/**
 * Which site the work in progress is for, carried implicitly.
 *
 * A site can have its own keys and its own author (an agency's sites belong
 * to different clients). Everything that reads a key — the assistant, image
 * generation, putting a site online — asks the settings service for it, and
 * most of those callers don't pass a site id: they were written before keys
 * could be per site, and some are still being written. Rather than thread an
 * id through every one of them, the server runs each `/api/sites/:siteId/…`
 * request inside `withSiteScope(siteId, …)`, and the settings service
 * resolves a key for `currentSiteId()` when no id is given. The scope follows
 * the request's asynchronous work — an assistant turn or a deploy job started
 * by that request keeps it to the end — and nothing outside a site request
 * (the app's own Settings screen, a background timer) is in any site's scope.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<string>();

/** Site ids are hex digests (siteIdFor); anything else never names a scope. */
const SITE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function withSiteScope<T>(siteId: string, run: () => T): T {
  return SITE_ID.test(siteId) ? storage.run(siteId, run) : run();
}

/** The site of the request being served, or null outside one. */
export function currentSiteId(): string | null {
  return storage.getStore() ?? null;
}

/** Runs `run` outside any site's scope (work that must use the shared settings). */
export function withoutSiteScope<T>(run: () => T): T {
  return storage.exit(run);
}

export function isSiteId(value: unknown): value is string {
  return typeof value === "string" && SITE_ID.test(value);
}
