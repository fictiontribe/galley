/** JSON-value helpers: normalisation from parser output, equality, path access. */
import { createHash } from "node:crypto";

import type { FieldPath, JsonValue } from "../../types";

export type JsonObject = { [key: string]: JsonValue };

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** ISO form of a date: "YYYY-MM-DD" for midnight UTC, a full timestamp otherwise. */
function dateToIso(value: Date): string {
  if (Number.isNaN(value.getTime())) return String(value);
  const iso = value.toISOString();

  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
}

/**
 * Converts parser output into plain JSON values. Parsers may hand back Dates
 * (TOML, YAML 1.1 timestamps), Maps or bigints; the rest of the engine only
 * ever sees strings, numbers, booleans, null, arrays and plain objects.
 */
export function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return dateToIso(value);
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value instanceof Map) {
    const out: JsonObject = {};

    for (const [key, item] of value) out[String(key)] = toJsonValue(item);
    return out;
  }
  if (typeof value === "object") {
    const out: JsonObject = {};

    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined) out[key] = toJsonValue(item);
    }
    return out;
  }
  return String(value);
}

export function deepEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isObject(a)) {
    if (!isObject(b)) return false;
    const keys = Object.keys(a);

    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

export function getIn(value: JsonValue | undefined, path: FieldPath): JsonValue | undefined {
  let current: JsonValue | undefined = value;

  for (const segment of path) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      if (typeof segment !== "number") return undefined;
      current = current[segment];
    } else if (isObject(current)) {
      current = Object.hasOwn(current, String(segment)) ? current[String(segment)] : undefined;
    } else {
      return undefined;
    }
  }
  return current;
}

export function cloneJson<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}

/** sha-256 hex of the content, first 16 characters — enough to notice a concurrent edit. */
export function hashContent(raw: string | Uint8Array): string {
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export function isScalarValue(value: JsonValue | undefined): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
