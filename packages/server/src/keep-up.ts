/**
 * A hosted editor keeping up with its repository by itself. Every few
 * minutes (GALLEY_SYNC_MINUTES) it looks at the code host and, when the
 * code host has versions this copy lacks and nothing here is in the way,
 * brings them in forward only, as Get latest does (SiteService.catchUp).
 *
 * Only a hosted install runs it: on a person's own computer nothing reaches
 * for the network by itself. A round is skipped — never queued — while the
 * install is busy (a connect, a restore, a publish job), while the assistant
 * is working on the site, while a save or other git work on the site is in
 * progress, while the preview is installing the site's dependencies, or
 * while the previous round is still going. Its look at the code host holds
 * up no save, however long the code host takes to answer.
 *
 * A skipped round brings nothing in, but while it is only the assistant or
 * the preview's install that is in the way it still looks, so what the app
 * says is waiting stays true. And skipping is not silent for ever: rounds
 * skipped for half an hour running are said in the log, once, with why (a
 * reply or an install that never ends would otherwise stop the editor
 * keeping up with nobody the wiser), and once more when they run again.
 */
import { asEngine } from "@galley/core/install";
import type { CatchUpResult, SiteService } from "@galley/core/types";

/** Minutes between looks when GALLEY_SYNC_MINUTES isn't set. */
export const DEFAULT_SYNC_MINUTES = 5;
/** Rounds skipped in a row for this long are said in the log. */
export const SKIPPED_SAID_AFTER_MS = 30 * 60_000;
/** Why `SiteService.catchUp` stood aside: it doesn't say which of these it was. */
const SITE_BUSY = "a save or a publish is in progress on the site, or its preview is installing the site's packages";

/** What runs the rounds: a real interval, or a test's hand. Returns how to stop it. */
export interface KeepUpTimer {
  every(ms: number, run: () => Promise<unknown>): () => void;
}

export const intervalTimer: KeepUpTimer = {
  every(ms, run) {
    const timer = setInterval(() => void run().catch(() => undefined), ms);

    // A pending round never keeps the process alive on its own.
    timer.unref?.();
    return () => clearInterval(timer);
  },
};

/** What one round did, for tests and the one log line. */
export type RoundOutcome = "stopped" | "overlap" | "busy" | "no-site" | "quiet" | "brought" | "held" | "failed";

export interface KeepUpOptions {
  /** Minutes between rounds; 0 runs none (a round can still be run by hand). */
  minutes: number;
  /** The connected site, or null while there is none (first run, waiting for its key, a restore). */
  site(): Promise<SiteService | null>;
  /**
   * Install-level work a round must not run beside at all, not even to look
   * (the site may be on its way in or out): a connect, a restore, a publish
   * job, a start or a stop. What it is, as the log would say it after
   * "because", or null.
   */
  busy(): string | null;
  /**
   * Work on the site that versions must not come in under, while looking is
   * still safe: the assistant's turn. Said the same way, or null.
   */
  working?(): string | null;
  /** One line for the operator's log. */
  log(line: string): void;
  timer?: KeepUpTimer;
  /** The clock rounds skipped in a row are measured by. Default: Date.now. */
  now?: () => number;
}

export interface KeepUp {
  round(): Promise<RoundOutcome>;
  /** Resolves once a round in progress has finished (at once when none is). What is about to take the site away waits for it. */
  idle(): Promise<void>;
  /** No more rounds; resolves once a round in progress has finished. */
  stop(): Promise<void>;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function createKeepUp(options: KeepUpOptions): KeepUp {
  let stopped = false;
  let running: Promise<RoundOutcome> | null = null;
  /** What the log last said was wrong, so the same failure is said once — and once more when it clears. */
  let said: { kind: "failed" | "held"; text: string } | null = null;
  const cancel = options.minutes > 0 ? (options.timer ?? intervalTimer).every(options.minutes * 60_000, () => keepUp.round()) : () => undefined;

  function report(kind: "failed" | "held", text: string, line: string): RoundOutcome {
    if (said?.kind !== kind || said.text !== text) options.log(line);
    said = { kind, text };
    return kind;
  }

  /** Since when rounds have been skipped in a row, and whether the log has said so. */
  let skipping: { since: number; said: boolean } | null = null;
  const clock = options.now ?? Date.now;

  function skipped(reason: string): RoundOutcome {
    const now = clock();

    skipping ??= { since: now, said: false };
    if (!skipping.said && now - skipping.since >= SKIPPED_SAID_AFTER_MS) {
      skipping.said = true;
      // Whether there is anything to bring in isn't known here (a skipped round may not even have looked): it says what is known.
      options.log(`Repository: the editor's rounds have been skipped for ${Math.round((now - skipping.since) / 60_000)} minutes, because ${reason}. Newer versions, if there are any, come in once that is over.`);
    }
    return "busy";
  }

  /** A round got its turn: skipping is over, and the log says so if it said rounds were being skipped. */
  function ran(): void {
    if (skipping?.said) options.log("Repository: the editor's rounds run again.");
    skipping = null;
  }

  /** Asks the code host what is new and changes nothing: what a round still does while versions can't come in. */
  const look = (site: SiteService) => site.checkGit().then(() => undefined, () => undefined);

  function cleared(): void {
    if (said) options.log(said.kind === "failed" ? "Repository: the code host answers again." : "Repository: nothing is in the way of newer versions any more.");
    said = null;
  }

  async function once(): Promise<RoundOutcome> {
    const busy = options.busy();

    if (busy) return skipped(busy);
    const site = await options.site().catch(() => null);

    if (!site) {
      skipping = null;
      return "no-site";
    }
    if (stopped) return "stopped";
    const working = options.working?.() ?? null;

    if (working) {
      await look(site);
      return skipped(working);
    }
    let result: CatchUpResult | null;

    try {
      // The engine's mark around exactly the guarded call: bringing versions in is what Get latest does, and nobody asked for this one.
      result = await asEngine(() => site.catchUp());
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);

      ran();
      return report("failed", text, `Repository: couldn't check for newer versions: ${text}`);
    }
    // The site stood aside (it has looked already when it was the preview's install in the way).
    if (!result) return skipped(SITE_BUSY);
    ran();
    const { status } = result;

    if (result.brought > 0) {
      said = null;
      options.log(`Repository: brought in ${plural(result.brought, "newer version")} (${plural(result.paths.length, "file")} changed).`);
      return "brought";
    }
    if (status.checkProblem) return report("failed", status.checkProblem, `Repository: couldn't check for newer versions: ${status.checkProblem}`);
    if (status.inTheWay) {
      return report("held", status.inTheWay.message, `Repository: ${plural(status.behind, "newer version")} waiting, not brought in: ${status.inTheWay.message}`);
    }
    cleared();
    return "quiet";
  }

  const keepUp: KeepUp = {
    async round() {
      if (stopped) return "stopped";
      if (running) return "overlap";
      running = once();
      try {
        return await running;
      } finally {
        running = null;
      }
    },
    async idle() {
      await running?.catch(() => undefined);
    },
    async stop() {
      stopped = true;
      cancel();
      await running?.catch(() => undefined);
    },
  };

  return keepUp;
}
