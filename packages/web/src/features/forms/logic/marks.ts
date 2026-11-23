/**
 * What changed when a fresh copy of a form arrives from the assistant (or
 * from outside the app), as marks the builder can flash: a field by id, or a
 * whole area (where it goes, after sending, the form's settings).
 */
import type { JsonValue } from "@galley/core/types";
import { deepEqual } from "@/features/content/form/paths";
import { isObject, type JsonObject } from "./json";

export const AREA_MARKS = { destinations: "area:destinations", afterSubmit: "area:afterSubmit", settings: "area:settings" } as const;

export const fieldMark = (id: string) => `field:${id}`;

function byId(list: JsonValue | undefined): Map<string, JsonValue> {
  const map = new Map<string, JsonValue>();
  if (!Array.isArray(list)) return map;
  for (const item of list) if (isObject(item) && typeof item.id === "string") map.set(item.id, item);
  return map;
}

/** Marks for every field added or changed, and every other area that differs. */
export function formChangeMarks(before: JsonObject, after: JsonObject): string[] {
  const marks: string[] = [];
  const old = byId(before.fields);
  for (const [id, field] of byId(after.fields)) if (!deepEqual(old.get(id), field)) marks.push(fieldMark(id));
  if (!deepEqual(before.destinations, after.destinations)) marks.push(AREA_MARKS.destinations);
  if (!deepEqual(before.afterSubmit, after.afterSubmit)) marks.push(AREA_MARKS.afterSubmit);
  const rest = (doc: JsonObject) => Object.fromEntries(Object.entries(doc).filter(([key]) => key !== "fields" && key !== "destinations" && key !== "afterSubmit"));
  if (!deepEqual(rest(before), rest(after))) marks.push(AREA_MARKS.settings);
  return marks;
}

/** Marks for a scripts setup: each script added or changed, and the consent card. */
export function scriptChangeMarks(before: JsonObject, after: JsonObject): string[] {
  const marks: string[] = [];
  const old = byId(before.scripts);
  for (const [id, entry] of byId(after.scripts)) if (!deepEqual(old.get(id), entry)) marks.push(`script:${id}`);
  if (!deepEqual(before.consent, after.consent)) marks.push("area:consent");
  return marks;
}
