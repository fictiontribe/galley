/**
 * The line for reading stored files through the server.
 *
 * A read may hold a whole file in memory, so only a few run at once for a
 * site. The rest wait their turn, first come, first served: a browser asks
 * for a screenful of thumbnails together and never asks again for one that
 * was turned away. A read is refused only when the line itself is too long,
 * and one whose request was given up while it waited leaves the line.
 */
import { GalleyError } from "../errors";

interface Waiter {
  /** Its turn has come. */
  go(): void;
}

interface Line {
  running: number;
  waiting: Waiter[];
}

export interface ReadLine {
  /**
   * Runs `work` when its turn comes and gives back what it returns. Refused
   * with "busy" when the line is full. A `signal` that fires while it waits
   * takes it out of the line, and `work` never runs.
   */
  run<T>(siteId: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  /** How many reads a site has running and waiting. */
  size(siteId: string): { running: number; waiting: number };
}

const FULL = "Too many stored files are being shown at once. Try again in a moment.";
const GIVEN_UP = "That file is no longer being asked for.";

export function createReadLine(atOnce: number, waitingLimit: number): ReadLine {
  const lines = new Map<string, Line>();

  function enter(siteId: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new GalleyError("busy", GIVEN_UP));
    const line = lines.get(siteId) ?? { running: 0, waiting: [] };

    lines.set(siteId, line);
    if (line.running < atOnce) {
      line.running += 1;
      return Promise.resolve();
    }
    if (line.waiting.length >= waitingLimit) return Promise.reject(new GalleyError("busy", FULL));
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        go() {
          signal?.removeEventListener("abort", giveUp);
          resolve();
        },
      };
      const giveUp = () => {
        const at = line.waiting.indexOf(waiter);

        if (at === -1) return;
        line.waiting.splice(at, 1);
        reject(new GalleyError("busy", GIVEN_UP));
      };

      line.waiting.push(waiter);
      signal?.addEventListener("abort", giveUp, { once: true });
    });
  }

  function leave(siteId: string): void {
    const line = lines.get(siteId);

    if (!line) return;
    const next = line.waiting.shift();

    // The place goes straight to the next in line, so a read arriving now can't get in ahead of it.
    if (next) next.go();
    else if ((line.running -= 1) <= 0) lines.delete(siteId);
  }

  return {
    async run(siteId, work, signal) {
      await enter(siteId, signal);
      try {
        return await work();
      } finally {
        leave(siteId);
      }
    },
    size(siteId) {
      const line = lines.get(siteId);

      return { running: line?.running ?? 0, waiting: line?.waiting.length ?? 0 };
    },
  };
}
