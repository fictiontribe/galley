/**
 * Measuring the site in the person's own browser: a hidden frame on the
 * preview, the overlay's read-only `measure` request on each page, and the
 * answers collected. Pages: home, one per collection that has pages, then
 * the most-linked pages the home page points to — five at most.
 *
 * The frame only answers to this window at the app's origin (the overlay's
 * own check); answers are taken only from that frame, at the preview's origin.
 */
import type { MeasureSummary } from "@galley/core/sitebrand/types";

const PER_PAGE_MS = 20_000;
export const MAX_PAGES = 5;

type Fields = Record<string, unknown>;
const isObject = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);

export interface MeasureProgress {
  path: string;
  index: number;
  total: number;
}

function measureOne(frame: HTMLIFrameElement, origin: string, path: string, signal: AbortSignal): Promise<MeasureSummary | null> {
  return new Promise((resolve) => {
    const id = `m${Math.random().toString(36).slice(2, 10)}`;
    let asked = false;
    const finish = (value: MeasureSummary | null) => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const ask = () => {
      asked = true;
      frame.contentWindow?.postMessage({ galley: 1, type: "measure", id }, origin);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== origin || !isObject(event.data) || event.data.galley !== 1) return;
      if (event.data.type === "ready" && !asked) {
        // Let fonts settle so the measurement sees the page as people do.
        window.setTimeout(ask, 600);
        return;
      }
      if (event.data.type === "measure-result" && event.data.id === id && isObject(event.data.summary)) finish(event.data.summary as unknown as MeasureSummary);
    };
    const onAbort = () => finish(null);
    const timer = window.setTimeout(() => finish(null), PER_PAGE_MS);

    window.addEventListener("message", onMessage);
    signal.addEventListener("abort", onAbort);
    frame.src = `${origin}${path}`;
  });
}

/** Measures `paths` (plus the most-linked pages, up to MAX_PAGES) on the preview at `origin`. */
export async function measureSite(origin: string, paths: string[], onProgress: (progress: MeasureProgress) => void, signal: AbortSignal): Promise<MeasureSummary[]> {
  const frame = document.createElement("iframe");

  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.title = "Measuring the site";
  // Off screen but laid out at a desktop width, so the page measures as a visitor sees it.
  Object.assign(frame.style, { position: "fixed", left: "-10000px", top: "0", width: "1280px", height: "800px", border: "0", visibility: "hidden" });
  document.body.appendChild(frame);
  const queue = [...new Set(["/", ...paths])].slice(0, MAX_PAGES);
  const results: MeasureSummary[] = [];

  try {
    for (let i = 0; i < queue.length && results.length < MAX_PAGES; i += 1) {
      if (signal.aborted) break;
      const path = queue[i]!;

      onProgress({ path, index: i, total: queue.length });
      const summary = await measureOne(frame, origin, path, signal);

      if (!summary) continue;
      results.push(summary);
      if (i === 0) {
        for (const link of summary.internalLinks) {
          if (queue.length >= MAX_PAGES) break;
          if (!queue.includes(link.path) && !/^\/(api|_|__)/.test(link.path)) queue.push(link.path);
        }
      }
    }
  } finally {
    frame.remove();
  }
  return results;
}
