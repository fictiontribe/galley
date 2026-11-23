/**
 * The preview policy: with many sites open, how many previews may run at
 * once, and when an unused one is stopped.
 *
 * Every preview is a real dev server (often Vite with a file watcher of its
 * own) plus two proxies, so ten of them running is real load on a laptop. The
 * rules:
 *
 *  - at most `maxRunning` previews run at once (default 3). When one more
 *    becomes ready, the least recently used of the others is paused;
 *  - a preview nobody has used for `idleMinutes` (default 20) is paused.
 *    "Used" is a request through its proxy (a page, an asset, a hot-reload
 *    socket opening) or an editor open on the site (the app reports that — see
 *    `touch`);
 *  - never paused: a preview that is installing or starting, or one whose
 *    site has a build, deploy, publish or install job running;
 *  - a pause leaves the preview "idle" with `paused` set, so the app starts it
 *    again on its own when the person comes back, saying "Waking the
 *    preview…" rather than showing an error.
 *
 * The limit counts previews on their way up too, but only ready ones are ever
 * paused; when every other preview is protected the limit is exceeded for a
 * while, and the next sweep tries again.
 */
import type { EventBus, Job, PreviewPause, PreviewPolicySettings, PreviewState } from "../types";
import type { PreviewControllerHandle } from "../workspace/preview/controller";

/** At most three previews running; one unused for twenty minutes is stopped. */
export const DEFAULT_PREVIEW_POLICY: PreviewPolicySettings = { maxRunning: 3, idleMinutes: 20 };
/** What Settings accepts for each. */
export const PREVIEW_LIMITS = { maxRunning: [1, 12], idleMinutes: [5, 240] } as const;

/** Jobs that hold a site's preview in place while they run. */
const PROTECTING_JOBS = new Set<Job["kind"]>(["build", "deploy", "publish", "install"]);
const RUNNING: PreviewState[] = ["ready", "starting", "installing"];

export interface PreviewPolicyOptions {
  events: EventBus;
  limits: () => Promise<PreviewPolicySettings> | PreviewPolicySettings;
  /** The open site's preview controller, when it has one. */
  controller: (siteId: string) => PreviewControllerHandle | null;
  now?: () => number;
  /** How often unused previews are looked for. Default 30 s; 0 turns the timer off (tests call `sweep`). */
  sweepMs?: number;
  /** An editor counts as open for this long after its last sign of life. Default 90 s (the app reports every 30 s). */
  presenceMs?: number;
  /** Told about every pause, for logs and tests. */
  onPause?: (siteId: string, reason: PreviewPause) => void;
}

export interface PreviewPolicy {
  /** An editor is open on the site. */
  touch(siteId: string): void;
  /** When the site's preview was last used, as the policy sees it (0: never). */
  lastUsed(siteId: string): number;
  /** Whether a job is holding the site's preview in place. */
  isProtected(siteId: string): boolean;
  /** Pauses previews beyond the limit; returns the sites paused. `newest` is never chosen. */
  enforce(newest?: string): Promise<string[]>;
  /** Pauses unused previews (and enforces the limit); returns the sites paused. */
  sweep(): Promise<string[]>;
  /** Sites whose preview is running or on its way, as the policy last heard. */
  running(): string[];
  dispose(): void;
}

export function createPreviewPolicy(options: PreviewPolicyOptions): PreviewPolicy {
  const now = options.now ?? Date.now;
  const presenceMs = options.presenceMs ?? 90_000;
  const states = new Map<string, PreviewState>();
  const used = new Map<string, number>();
  const presence = new Map<string, number>();
  /** Running job id → site id. */
  const jobs = new Map<string, string>();
  /** A pause in flight per site, so two sweeps don't pause one preview twice. */
  const pausing = new Set<string>();
  let disposed = false;

  const bump = (siteId: string, at = now()) => used.set(siteId, Math.max(used.get(siteId) ?? 0, at));

  const lastUsed = (siteId: string): number => Math.max(used.get(siteId) ?? 0, options.controller(siteId)?.lastActivityAt ?? 0, presence.get(siteId) ?? 0);

  const isProtected = (siteId: string): boolean => [...jobs.values()].includes(siteId);

  const present = (siteId: string): boolean => now() - (presence.get(siteId) ?? 0) < presenceMs;

  async function pause(siteId: string, reason: PreviewPause): Promise<boolean> {
    const controller = options.controller(siteId);

    if (!controller || pausing.has(siteId) || controller.status().state !== "ready" || isProtected(siteId)) return false;
    pausing.add(siteId);
    try {
      await controller.pause(reason);
      options.onPause?.(siteId, reason);
      return true;
    } finally {
      pausing.delete(siteId);
    }
  }

  async function enforce(newest?: string): Promise<string[]> {
    if (disposed) return [];
    const { maxRunning } = await options.limits();
    const running = [...states.entries()].filter(([, state]) => RUNNING.includes(state)).map(([siteId]) => siteId);
    let excess = running.length - maxRunning;

    if (excess <= 0) return [];
    // Least recently used first; a preview someone is looking at goes last.
    const candidates = running
      .filter((siteId) => siteId !== newest && states.get(siteId) === "ready" && !isProtected(siteId))
      .sort((a, b) => Number(present(a)) - Number(present(b)) || lastUsed(a) - lastUsed(b));
    const paused: string[] = [];

    for (const siteId of candidates) {
      if (excess <= 0) break;
      if (await pause(siteId, "limit")) {
        paused.push(siteId);
        excess -= 1;
      }
    }
    return paused;
  }

  async function sweep(): Promise<string[]> {
    if (disposed) return [];
    const { idleMinutes } = await options.limits();
    const cutoff = now() - idleMinutes * 60_000;
    const paused: string[] = [];

    for (const [siteId, state] of states) {
      if (state !== "ready" || present(siteId) || isProtected(siteId)) continue;
      if (lastUsed(siteId) < cutoff && (await pause(siteId, "idle"))) paused.push(siteId);
    }
    return [...paused, ...(await enforce())];
  }

  const unsubscribe = options.events.subscribe((event) => {
    if (disposed) return;
    if (event.type === "preview.status") {
      const previous = states.get(event.siteId);

      states.set(event.siteId, event.status.state);
      if (event.status.state === "ready" && previous !== "ready") {
        bump(event.siteId);
        void enforce(event.siteId).catch(() => undefined);
      }
    } else if (event.type === "job" && event.job.siteId && PROTECTING_JOBS.has(event.job.kind)) {
      if (event.job.state === "running") jobs.set(event.job.id, event.job.siteId);
      else jobs.delete(event.job.id);
    }
  });
  const timer = (options.sweepMs ?? 30_000) > 0 ? setInterval(() => void sweep().catch(() => undefined), options.sweepMs ?? 30_000) : null;

  timer?.unref?.();

  return {
    touch(siteId) {
      presence.set(siteId, now());
      bump(siteId);
    },
    lastUsed,
    isProtected,
    enforce,
    sweep,
    running: () => [...states.entries()].filter(([, state]) => RUNNING.includes(state)).map(([siteId]) => siteId),
    dispose() {
      disposed = true;
      unsubscribe();
      if (timer) clearInterval(timer);
    },
  };
}
