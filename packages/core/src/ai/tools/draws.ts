/**
 * Whether a page still draws after the assistant changed its entry — the
 * same signal the app's preview gets (the status the dev server answers the
 * page with; packages/overlay/src/page.ts), checked here so a tool that left
 * a page failing says so instead of reporting success. Only when the
 * preview is running; never starts it, never fails the edit.
 */
import type { PreviewStatus, SiteService } from "../../types";
import { stripAnsi } from "../../workspace/exec";
import { probe } from "../../workspace/preview/proxy";

/** The dev server needs a moment to see a changed file before the page shows it. */
export const SETTLE_MS = 900;
const PROBE_MS = 15_000;

/** The first line of the dev server's log since `from` that reads like its error, for the assistant to act on. */
export function errorLine(log: readonly string[], from: number): string | null {
  for (const raw of log.slice(from)) {
    const line = stripAnsi(raw).replace(/^\s*\d{1,2}:\d{2}:\d{2}\s*/, "").trim();
    if (/\berror\b|ENOENT|cannot|can't|not found|undefined/i.test(line) && line.length > 8) return line.length > 300 ? `${line.slice(0, 299)}…` : line;
  }
  return null;
}

export interface DrawCheck {
  /** False when the page answered with an error. */
  draws: boolean;
  status: number | null;
  message: string | null;
}

/** Loads the page from the running preview; null when the preview isn't running or the entry has no page. */
export async function checkPageDraws(site: SiteService, url: string | null, wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<DrawCheck | null> {
  if (!url) return null;
  let status: PreviewStatus;
  try {
    status = site.preview().status();
  } catch {
    return null;
  }
  if (status.state !== "ready" || !status.url) return null;
  await wait(SETTLE_MS);
  const before = site.preview().status().log.length;
  const answer = await probe(`${status.url.replace(/\/+$/, "")}${url.startsWith("/") ? url : `/${url}`}`, PROBE_MS);
  if (answer === null || answer < 500) return { draws: true, status: answer, message: null };
  const log = site.preview().status().log;
  // The log is a rolling tail: once full it doesn't grow, so read its last lines instead.
  return { draws: false, status: answer, message: errorLine(log, log.length > before ? before : Math.max(0, log.length - 20)) };
}

/** The warning the tool's result carries for a page that stopped drawing. */
export function drawWarning(url: string, check: DrawCheck | null): string | null {
  if (!check || check.draws) return null;
  return `The page ${url} can't be drawn after this change: the preview answered ${check.status}${check.message ? ` (${check.message})` : ""}. The person sees "This page couldn't be drawn". Fix what you changed — usually a section missing a picture, video or file it needs — or undo it, before you finish.`;
}
