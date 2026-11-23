/**
 * The inbox's data: cache keys, the live subscription, and the test
 * submission that goes through the real capture address.
 */
import { useEffect, useState } from "react";
import type { CaptureSettings, InboxFilter } from "@galley/core/api";
import type { FormDefinition } from "@galley/core/kit";
import { api } from "@/lib/api";
import { useServerEvent } from "@/lib/events";
import { invalidate, useQuery } from "@/lib/query";
import { sampleAnswers } from "./summary";

export const inboxKeys = {
  all: (siteId: string) => ["site", siteId, "inbox"] as const,
  forms: (siteId: string) => ["site", siteId, "inbox", "forms"] as const,
  list: (siteId: string, formId: string, filter: InboxFilter, q: string, page: number) => ["site", siteId, "inbox", "list", formId, filter, q, page] as const,
  capture: (siteId: string) => ["site", siteId, "capture"] as const,
};

export function useInboxForms(siteId: string) {
  return useQuery(inboxKeys.forms(siteId), () => api("GET /api/sites/:siteId/inbox", { params: { siteId } }), { enabled: Boolean(siteId) });
}

export function useCaptureSettings(siteId: string) {
  return useQuery(inboxKeys.capture(siteId), () => api("GET /api/sites/:siteId/capture", { params: { siteId } }), { enabled: Boolean(siteId) });
}

/**
 * Keeps every inbox query fresh while the site is open, and remembers which
 * submissions arrived while watching so their rows can slide in.
 */
export function useInboxLive(siteId: string, onAdded?: (id: string, form: string) => void): void {
  useServerEvent("forms.submission", (event) => {
    if (event.siteId !== siteId) return;
    if (event.change === "added") for (const id of event.ids) onAdded?.(id, event.form);
    invalidate(inboxKeys.all(siteId));
  });
}

/** Ids that arrived in the last few seconds. */
export function useFreshIds(siteId: string): ReadonlySet<string> {
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  useInboxLive(siteId, (id) => {
    setFresh((current) => new Set([...current, id]));
    window.setTimeout(() => setFresh((current) => new Set([...current].filter((item) => item !== id))), 4000);
  });
  useEffect(() => setFresh(new Set()), [siteId]);
  return fresh;
}

export interface TestOutcome {
  ok: boolean;
  /** What the endpoint said, in its own plain words. */
  message: string;
  errors?: Record<string, string>;
}

/**
 * Posts a test submission to the site's capture address from this browser —
 * the same request a visitor's browser makes, through the same checks.
 */
export async function sendTestSubmission(settings: CaptureSettings, formId: string, definition: FormDefinition, openedAt: number): Promise<TestOutcome> {
  const body = {
    form: formId,
    values: sampleAnswers(definition),
    page: { url: window.location.origin + "/", title: "Test from the inbox", referrer: "" },
    meta: { honeypot: "", elapsedMs: Math.max(Date.now() - openedAt, 1000 * ((definition.spam?.minSeconds ?? 0) + 1)), test: true },
  };
  let response: Response;
  try {
    response = await fetch(settings.captureAddress, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "omit" });
  } catch {
    return { ok: false, message: "The capture address couldn’t be reached from this browser." };
  }
  const json = (await response.json().catch(() => null)) as { ok?: boolean; message?: string; errors?: Record<string, string> } | null;
  if (response.ok && json?.ok) return { ok: true, message: "Test submission received." };
  if (response.status === 422 && json?.errors) return { ok: false, message: "The form refused the test answers.", errors: json.errors };
  if (response.status === 429) return { ok: false, message: json?.message ?? "Too many submissions in a short time. Wait a minute and try again." };
  if (response.status === 403) return { ok: false, message: "The capture address refused this browser’s address. Add it to the allowed addresses in capture settings." };
  return { ok: false, message: json?.message ?? `The capture address answered ${response.status}.` };
}
