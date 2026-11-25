/** What Version history says about this copy and the repository (pure, so each state can be checked on its own). */
import type { GitStatus } from "@galley/core/types";
import { count, relativeTime } from "@/lib/format";

/**
 * How long a successful look still counts when a newer one failed. Older
 * than this, the line says when it last knew instead of "in step": it never
 * says all is well on the strength of an old look.
 */
export const FRESH_MS = 10 * 60_000;

/** "review": a change here is in the newer versions' way, so the way on is Proof (which shows it), not a "Get latest" that would be refused. */
export type SyncAction = "get-latest" | "review" | "send" | "retry" | null;

export interface SyncLine {
  text: string;
  tone: "success" | "warning" | "neutral";
  action: SyncAction;
  /** Still finding out: nothing to act on yet. */
  checking?: boolean;
}

export interface SyncLineOptions {
  /** A look is on its way and no answer has come back since the screen opened. */
  checking: boolean;
  /** The look itself couldn't be asked for (the app's server didn't answer): its plain message. */
  lookFailed?: string | null;
  mayGetLatest: boolean;
  maySend: boolean;
  /** Where versions are recorded, in the place's own words ("on this computer", "in this editor"). */
  recorded: string;
  /** A hosted editor: a look that fails is worth a warning; on a person's own computer it fails quietly. */
  hosted: boolean;
  now?: number;
}

const withStop = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`);

export function syncLine(status: GitStatus | null, options: SyncLineOptions): SyncLine {
  const now = options.now ?? Date.now();

  if (status && !status.hasRemote) return { text: `Versions are kept ${options.recorded} only — they aren’t backed up or shared anywhere.`, tone: "neutral", action: null };
  if (options.checking) return { text: "Checking the repository…", tone: "neutral", action: null, checking: true };
  const problem = options.lookFailed ?? status?.checkProblem ?? null;
  const knownAt = status?.checkedAt ? Date.parse(status.checkedAt) : NaN;
  const fresh = Number.isFinite(knownAt) && now - knownAt <= FRESH_MS;
  const checked = Number.isFinite(knownAt) ? `checked ${relativeTime(knownAt, now)}` : null;

  if (!status || (problem && !fresh)) {
    const reason = problem ? ` ${withStop(problem)}` : "";
    const last = checked ? ` It was last ${checked}.` : "";

    return { text: `Couldn’t check the repository.${reason}${last}`, tone: options.hosted ? "warning" : "neutral", action: "retry" };
  }
  if (status.inTheWay?.kind === "separate-ways") return { text: status.inTheWay.message, tone: "warning", action: null };
  if (status.behind > 0) {
    const waiting = `${count(status.behind, "newer version")} ${status.behind === 1 ? "is" : "are"} waiting in the repository${checked ? ` (${checked})` : ""}.`;
    const what = status.inTheWay ? ` ${status.inTheWay.message}` : options.mayGetLatest ? "" : " An editor or owner can bring them in.";

    return { text: `${waiting}${what}`, tone: "warning", action: status.inTheWay ? "review" : options.mayGetLatest ? "get-latest" : null };
  }
  if (status.ahead > 0) {
    return {
      text: `${count(status.ahead, "version")} published here ${status.ahead === 1 ? "hasn’t" : "haven’t"} been sent to the repository yet.`,
      tone: "warning",
      action: options.maySend ? "send" : null,
    };
  }
  return { text: `In step with the repository${checked ? `, ${checked}` : ""}. Everything published is here.`, tone: "success", action: null };
}
