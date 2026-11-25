import type { JsonValue } from "./types";

/** Whether a value can be sent as JSON as it is: nothing `JSON.stringify` would drop, change or choke on. */
export function isJson(value: unknown, seen: Set<object> = new Set()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;

  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return false;
  seen.add(value);
  const ok = Array.isArray(value) ? value.every((item) => isJson(item, seen)) : Object.values(value).every((item) => isJson(item, seen));

  seen.delete(value);
  return ok;
}

/** How many bytes a value is as JSON. */
export function jsonBytes(value: JsonValue): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
