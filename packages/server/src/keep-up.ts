/**
 * A hosted editor keeping up with its repository by itself. Every few
 * minutes (GALLEY_SYNC_MINUTES) it looks at the code host and, when the
 * code host has versions this copy lacks and nothing here is in the way,
 * brings them in forward only, as Get latest does (SiteService.catchUp).
 *
 * Only a hosted install runs it: on a person's own computer nothing reaches
 * for the network by itself. A round is skipped — never queued — while the
 * install is busy (a connect, a restore, a publish job), while git work on
 * the site is in progress, or while the previous round is still going.
 */
import { asEngine } from "@galley/core/install";
import type { CatchUpResult, SiteService } from "@galley/core/types";

/** Minutes between looks when GALLEY_SYNC_MINUTES isn't set. */
export const DEFAULT_SYNC_MINUTES = 5;

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
  /** Install-level work a round must not run beside: a connect, a restore, a publish job. */
  busy(): boolean;
  /** One line for the operator's log. */
  log(line: string): void;
  timer?: KeepUpTimer;
}

export interface KeepUp {
  round(): Promise<RoundOutcome>;
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

  function cleared(): void {
    if (said) options.log(said.kind === "failed" ? "Repository: the code host answers again." : "Repository: nothing is in the way of newer versions any more.");
    said = null;
  }

  async function once(): Promise<RoundOutcome> {
    if (options.busy()) return "busy";
    const site = await options.site().catch(() => null);

    if (!site) return "no-site";
    if (stopped) return "stopped";
    let result: CatchUpResult | null;

    try {
      // The engine's mark around exactly the guarded call: bringing versions in is what Get latest does, and nobody asked for this one.
      result = await asEngine(() => site.catchUp());
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);

      return report("failed", text, `Repository: couldn't check for newer versions: ${text}`);
    }
    if (!result) return "busy";
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
    async stop() {
      stopped = true;
      cancel();
      await running?.catch(() => undefined);
    },
  };

  return keepUp;
}
