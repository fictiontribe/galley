/** The Brand screen's data: the state, refreshed by brand jobs; measuring through the preview; saving edits. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MeasureSummary, SiteBrandFile, SiteBrandState } from "@galley/core/sitebrand/types";
import { api } from "@/lib/api";
import { useServerEvent } from "@/lib/events";
import { setQueryData, useQuery } from "@/lib/query";
import { usePreview } from "@/lib/stores/preview";
import { useMeta } from "@/lib/stores/meta";
import { needsEntry, requestEntry } from "@/features/preview/entry";
import { enterInFrame, measureTarget } from "@/features/hosting/previewLinks";
import { useSite } from "@/lib/stores/site";
import { measureSite, type MeasureProgress } from "./measure";

export const brandKey = (siteId: string) => ["site", siteId, "brand"] as const;

export function useBrandState(siteId: string) {
  const query = useQuery(brandKey(siteId), () => api("GET /api/sites/:siteId/brand", { params: { siteId } }), { deps: [["site", siteId, "changes"]] });
  const { refetch } = query;

  useServerEvent("job", (event) => {
    if (event.job.kind === "brand" && event.job.siteId === siteId) void refetch();
  });
  useServerEvent("changes.updated", (event) => {
    if (event.siteId === siteId) void refetch();
  });
  return query;
}

export function setBrandState(siteId: string, state: SiteBrandState): void {
  setQueryData(brandKey(siteId), state);
}

/** Waits for the preview to be ready (starting it when it isn't), then returns its origin. */
async function previewOrigin(siteId: string, signal: AbortSignal): Promise<string | null> {
  const store = usePreview.getState();
  const current = store.bySite[siteId];

  if (current?.state === "ready" && current.url) return current.url;
  if (current?.state !== "starting" && current?.state !== "installing") await store.run(siteId, "start").catch(() => undefined);
  for (let i = 0; i < 240 && !signal.aborted; i += 1) {
    const status = usePreview.getState().bySite[siteId];

    if (status?.state === "ready" && status.url) return status.url;
    if (status?.state === "error") return null;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

/**
 * Where the measuring frame loads pages: the preview's own address on this
 * computer; on a hosted install, the entry's origin once this browser has been
 * let in there (see features/hosting/previewLinks.tsx).
 */
async function measuredFrom(siteId: string, previewUrl: string, signal: AbortSignal): Promise<{ origin: string } | null> {
  const meta = useMeta.getState().meta;

  if (!needsEntry(meta)) return measureTarget(meta, previewUrl, null);
  const entry = await requestEntry(siteId).catch(() => null);
  const target = measureTarget(meta, previewUrl, entry?.preview ?? null);

  if (target?.enter) await enterInFrame(target.enter, signal);
  return target;
}

/** The pages worth measuring besides home: the first page of every collection that has pages. */
async function representativePages(siteId: string): Promise<string[]> {
  const model = useSite.getState().detail?.model;
  const out: string[] = [];

  for (const collection of model?.collections ?? []) {
    if (collection.kind !== "entries" || !collection.url || collection.count === 0) continue;
    const list = await api("GET /api/sites/:siteId/entries", { params: { siteId }, query: { collection: collection.id, limit: 3 } }).catch(() => null);
    const page = list?.items.find((item) => item.url && item.url !== "/" && !item.draft);

    if (page?.url) out.push(page.url);
  }
  return out;
}

export type MeasureOutcome = { pages: MeasureSummary[]; problem: string | null };

export function useMeasure(siteId: string) {
  const [progress, setProgress] = useState<MeasureProgress | null>(null);
  const [starting, setStarting] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);
  const measure = useCallback(async (): Promise<MeasureOutcome> => {
    controller.current?.abort();
    const abort = new AbortController();

    controller.current = abort;
    setStarting(true);
    try {
      const origin = await previewOrigin(siteId, abort.signal);

      if (!origin) return { pages: [], problem: "The preview couldn't start, so only the site's code was read." };
      const target = await measuredFrom(siteId, origin, abort.signal);

      if (!target) return { pages: [], problem: "The preview couldn't be opened from here, so only the site's code was read." };
      setStarting(false);
      const pages = await measureSite(target.origin, await representativePages(siteId), setProgress, abort.signal);

      return { pages, problem: pages.length ? null : "The preview's pages didn't answer, so only the site's code was read." };
    } finally {
      setStarting(false);
      setProgress(null);
    }
  }, [siteId]);
  const stop = useCallback(() => controller.current?.abort(), []);

  return { measure, stop, progress, starting, busy: starting || progress !== null };
}

/** Edits to the proposal, saved a moment after the last change. */
export function useProposalSaver(siteId: string, onSaved: (state: SiteBrandState) => void) {
  const timer = useRef<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  return {
    saving,
    error,
    save(brand: SiteBrandFile, answers?: Record<string, string>) {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(
        async () => {
          setSaving(true);
          try {
            await api("PUT /api/sites/:siteId/brand/proposal", { params: { siteId }, body: { brand, ...(answers ? { answers } : {}) } });
            onSaved(await api("GET /api/sites/:siteId/brand", { params: { siteId } }));
            setError(null);
          } catch (caught) {
            setError(caught);
          } finally {
            setSaving(false);
          }
        },
        answers ? 0 : 450
      );
    },
  };
}

/**
 * The brand's imagery direction — what image and video generation receive as
 * `brandDirection`, the same brief the assistant's image tool sends — or null
 * when the site has no brand (or the server predates it). Shares the Brand
 * screen's cached state.
 */
export function useImageryDirection(siteId: string): string | null {
  const query = useQuery(brandKey(siteId), () => api("GET /api/sites/:siteId/brand", { params: { siteId } }), { deps: [["site", siteId, "changes"]] });
  return query.data?.imagery?.trim() || null;
}
