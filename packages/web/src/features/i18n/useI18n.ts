import { api } from "@/lib/api";
import { useServerEvent } from "@/lib/events";
import { invalidate, useQuery } from "@/lib/query";

export const i18nKeys = {
  overview: (siteId: string) => ["i18n", siteId] as const,
  entry: (siteId: string, path: string) => ["i18n-entry", siteId, path] as const,
  glossary: (siteId: string) => ["i18n-glossary", siteId] as const,
  memory: (siteId: string) => ["i18n-memory", siteId] as const,
};

export function useI18nOverview(siteId: string) {
  useServerEvent("changes.updated", (event) => {
    if (event.siteId === siteId) {
      invalidate(i18nKeys.overview(siteId));
    }
  });
  return useQuery(
    i18nKeys.overview(siteId),
    () => api("GET /api/sites/:siteId/i18n", { params: { siteId } }),
    { enabled: Boolean(siteId) }
  );
}

export function useI18nEntry(siteId: string, path: string | null, enabled = true) {
  useServerEvent("changes.updated", (event) => {
    if (event.siteId === siteId && path) {
      invalidate(i18nKeys.entry(siteId, path));
    }
  });
  return useQuery(
    i18nKeys.entry(siteId, path ?? ""),
    () => api("GET /api/sites/:siteId/i18n/entry", { params: { siteId }, query: { path: path ?? "" } }),
    { enabled: Boolean(siteId && path && enabled) }
  );
}

export function useI18nGlossary(siteId: string, enabled = true) {
  return useQuery(
    i18nKeys.glossary(siteId),
    () => api("GET /api/sites/:siteId/i18n/glossary", { params: { siteId } }),
    { enabled: Boolean(siteId && enabled) }
  );
}

export function useI18nMemory(siteId: string, enabled = true) {
  return useQuery(
    i18nKeys.memory(siteId),
    () => api("GET /api/sites/:siteId/i18n/memory", { params: { siteId } }),
    { enabled: Boolean(siteId && enabled) }
  );
}
