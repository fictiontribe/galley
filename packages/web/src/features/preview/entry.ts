/**
 * How the preview frames get in on a hosted install.
 *
 * There the preview and the live comparison are served on hostnames of their
 * own through the server's one address, and nothing is shown there to a
 * browser that hasn't been let in. The editor asks the API for entry
 * addresses (each carrying a one-use ticket), loads each frame there once
 * with the page it wants as `to`, and from then on the frame navigates
 * normally. A frame whose browser isn't let in any more shows a page that
 * says so to the editor (PreviewSignInNeeded); the editor then asks again.
 *
 * On this computer (local mode) none of this happens: the frames load the
 * proxies' own addresses, as they always have.
 */
import type { MetaInfo, PreviewSignInNeeded } from "@galley/core/types";
import { api } from "@/lib/api";

/** The addresses the server says to load the two frames from. */
export interface FrameEntry {
  preview: string | null;
  baseline: string | null;
}

/** Frames go through the entry route on a hosted install, and only there. */
export function needsEntry(meta: MetaInfo | null | undefined): boolean {
  return Boolean(meta?.install);
}

/** Fresh entry addresses for a site's frames. */
export function requestEntry(siteId: string): Promise<FrameEntry> {
  return api("POST /api/sites/:siteId/preview/entry", { params: { siteId } });
}

/** An entry address with the page the frame should land on. */
export function entryAddress(entry: string, path: string): string {
  const url = new URL(entry);
  url.searchParams.set("to", path.startsWith("/") ? path : `/${path}`);
  return url.href;
}

/** The gateway's "not let in" page, telling its parent to ask again. */
export function isSignInNeeded(data: unknown): data is PreviewSignInNeeded {
  return typeof data === "object" && data !== null && (data as Partial<PreviewSignInNeeded>).galley === 1 && (data as Partial<PreviewSignInNeeded>).type === "sign-in-needed";
}

/** At most this many fresh entries per frame in RENEW_WINDOW_MS: a frame that keeps being turned away stops asking. */
export const RENEW_LIMIT = 3;
export const RENEW_WINDOW_MS = 60_000;

export interface EntrySession {
  /** Where the frames were first loaded from. */
  readonly first: FrameEntry;
  /**
   * A fresh entry address for one frame, landing on `path`; null when that
   * frame has no address any more or has asked too often lately. Rejects
   * when the request fails (signed out: the app's own sign-in takes over).
   */
  renew(role: "proposed" | "live", path: string): Promise<string | null>;
  /** A fresh entry address for something the person asked for (a new tab): never limited. */
  address(role: "proposed" | "live", path: string): Promise<string | null>;
}

/** Asks for the first entry addresses, and keeps asking for fresh ones on request, within limits. */
export async function openEntry(siteId: string, request: (siteId: string) => Promise<FrameEntry> = requestEntry, now: () => number = Date.now): Promise<EntrySession> {
  const first = await request(siteId);
  const asked: Record<"proposed" | "live", number[]> = { proposed: [], live: [] };
  const address = async (role: "proposed" | "live", path: string) => {
    const fresh = await request(siteId);
    const entry = role === "proposed" ? fresh.preview : fresh.baseline;
    return entry ? entryAddress(entry, path) : null;
  };

  return {
    first,
    address,
    renew(role, path) {
      const recent = asked[role].filter((at) => now() - at < RENEW_WINDOW_MS);
      asked[role] = recent;
      if (recent.length >= RENEW_LIMIT) return Promise.resolve(null);
      recent.push(now());
      return address(role, path);
    },
  };
}
