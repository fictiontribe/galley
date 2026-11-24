/**
 * Server events → store updates and cache invalidations. Started once at
 * boot. This is the only place that decides which data an event makes stale.
 */
import { coalesceBy } from "./coalesce";
import { count } from "./format";
import { connectEvents, onReconnect, subscribe } from "./events";
import { invalidate } from "./query";
import { useChanges } from "./stores/changes";
import { useJobs } from "./stores/jobs";
import { usePreview } from "./stores/preview";
import { useSite } from "./stores/site";
import { useSites } from "./stores/sites";
import { notify } from "./stores/toasts";

/** Cache keys used across screens. Keep them here so invalidation stays in one place. */
export const keys = {
  settings: () => ["settings"] as const,
  usage: () => ["usage"] as const,
  starters: () => ["starters"] as const,
  site: (siteId: string) => ["site", siteId] as const,
  entries: (siteId: string, collection: string) => ["site", siteId, "entries", collection] as const,
  entry: (siteId: string, path: string) => ["site", siteId, "entry", path] as const,
  search: (siteId: string, q: string) => ["site", siteId, "search", q] as const,
  media: (siteId: string) => ["site", siteId, "media"] as const,
  history: (siteId: string, limit?: number) => ["site", siteId, "history", limit ?? null] as const,
  git: (siteId: string) => ["site", siteId, "git"] as const,
  config: (siteId: string) => ["site", siteId, "config"] as const,
  threads: (siteId: string) => ["site", siteId, "threads"] as const,
  thread: (siteId: string, threadId: string) => ["site", siteId, "threads", threadId] as const,
  fsList: (path: string) => ["fs", path] as const,
  // Plugins: one "plugins" / "catalog" prefix each, so `plugins.updated` refreshes the app's and every site's at once.
  plugins: (siteId?: string) => (siteId ? (["plugins", "site", siteId] as const) : (["plugins", "app"] as const)),
  catalog: (siteId?: string) => (siteId ? (["catalog", "site", siteId] as const) : (["catalog", "app"] as const)),
  videoProviders: () => ["videos", "providers"] as const,
  // A hosted install: the Install page and first run.
  install: () => ["install"] as const,
  setup: () => ["install", "setup"] as const,
  // "Host the editor online" (local mode only): under the site's key, so `site.updated` refreshes it.
  editor: (siteId: string) => ["site", siteId, "editor"] as const,
  editorHosts: () => ["editor-hosts"] as const,
};

let started = false;

/** What the change events of a site since the last settle asked for. */
const pendingChanges = new Map<string, { versions: boolean }>();

/**
 * Every file written is one `changes.updated` event — an import of 159 pages
 * is 159 of them. Acting on each would queue hundreds of identical requests
 * and leave the Proof count trailing for a long time, so a site's events are
 * settled at most once per round trip: everything that arrives while one
 * settle is waiting on the server is handled together by the next.
 */
const settleChanges = coalesceBy(async (siteId: string) => {
  const marks = pendingChanges.get(siteId);
  pendingChanges.delete(siteId);
  if (!marks) return;
  for (const part of ["entries", "entry", "search", "media"] as const) invalidate(["site", siteId, part]);
  const waits: Promise<void>[] = [useSites.getState().load()];
  if (useChanges.getState().siteId === siteId) waits.push(useChanges.getState().refresh());
  if (marks.versions) {
    invalidate(["site", siteId, "history"]);
    invalidate(["site", siteId, "git"]);
    if (useSite.getState().siteId === siteId) waits.push(useSite.getState().refresh());
  }
  await Promise.all(waits);
});

export function startSync(): void {
  if (started) return;
  started = true;

  subscribe("changes.updated", (event) => {
    const marks = pendingChanges.get(event.siteId) ?? { versions: false };
    if (event.origin === "publish" || event.origin === "undo" || event.origin === "external") marks.versions = true;
    pendingChanges.set(event.siteId, marks);
    void settleChanges(event.siteId);
  });

  subscribe("site.updated", (event) => {
    if (useSite.getState().siteId === event.siteId) void useSite.getState().refresh();
    invalidate(["site", event.siteId]);
  });

  // A look found something different, or the hosted editor brought newer versions in by itself: the files that changed come as changes.updated.
  subscribe("repository.checked", (event) => {
    invalidate(keys.git(event.siteId));
    if (useSite.getState().siteId !== event.siteId) return;
    void useSite.getState().refresh();
    if (event.brought > 0) {
      notify({ tone: "neutral", title: "Newer versions brought in", body: `${count(event.brought, "newer version")} from the repository ${event.brought === 1 ? "was" : "were"} brought in.` });
    }
  });

  subscribe("sites.updated", () => {
    void useSites.getState().load();
  });

  subscribe("preview.status", (event) => {
    usePreview.getState().set(event.siteId, event.status);
  });

  subscribe("job", (event) => {
    useJobs.getState().upsert(event.job);
    if (event.job.state === "done") void useSites.getState().load();
  });

  // A plugin was turned on or off, saved or failed: what it adds (providers, catalogues, keys) may have changed.
  subscribe("plugins.updated", () => {
    for (const prefix of [["plugins"], ["catalog"], ["videos"], ["images"], keys.settings()] as const) invalidate(prefix);
  });

  onReconnect(() => {
    void useSites.getState().load();
    void useSite.getState().refresh();
    void useChanges.getState().refresh();
    invalidate([]);
  });

  connectEvents();
}
