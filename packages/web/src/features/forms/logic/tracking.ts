/**
 * "Tracking fields": the hidden fields most marketing forms carry, added in
 * one go — the five UTM parameters, the page the form was sent from, and the
 * referring page.
 */
import type { FormField } from "@galley/core/kit";

export type Touch = "first" | "last";

const UTM = ["source", "medium", "campaign", "term", "content"] as const;

/** The tracking fields, for first-visit or latest-visit attribution. */
export function trackingFields(touch: Touch): FormField[] {
  const utm = UTM.map<FormField>((part) => ({
    id: `utm_${part}`,
    type: "hidden",
    label: `UTM ${part}`,
    autofill: { from: "utm", key: `utm_${part}`, touch },
  }));
  return [
    ...utm,
    { id: "page_url", type: "hidden", label: "Page address", autofill: { from: "page-url" } },
    { id: "referrer", type: "hidden", label: "Referrer", autofill: { from: "referrer" } },
  ];
}

/** The tracking fields this form doesn't have yet (by id). */
export function missingTracking(fields: readonly Pick<FormField, "id">[], touch: Touch): FormField[] {
  const have = new Set(fields.map((field) => field.id));
  return trackingFields(touch).filter((field) => !have.has(field.id));
}

const SOURCES: Record<string, string> = {
  query: "the page address",
  utm: "the campaign link",
  referrer: "the page the visitor came from",
  "page-url": "the page address",
  "page-title": "the page title",
  cookie: "a cookie",
};

/** "Filled from the campaign link (utm_source, first visit)" */
export function describeAutofill(field: Pick<FormField, "autofill">): string | null {
  const autofill = field.autofill;
  if (!autofill) return null;
  const where = SOURCES[autofill.from] ?? "the page";
  const key = autofill.key && (autofill.from === "query" || autofill.from === "utm" || autofill.from === "cookie") ? autofill.key : null;
  const touch = autofill.from === "utm" ? (autofill.touch === "first" ? "first visit" : "latest visit") : null;
  const detail = [key, touch].filter(Boolean).join(", ");
  return `Filled from ${where}${detail ? ` (${detail})` : ""}`;
}
