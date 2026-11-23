/**
 * Reading and immutably writing JSON values by `FieldPath`. Writes copy only
 * the containers along the path, so every untouched subtree keeps its
 * reference — field components subscribed to other paths don't re-render.
 */
import type { FieldPath, JsonValue } from "@galley/core/types";

export type JsonObject = { [key: string]: JsonValue };

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A stable string for a path: ["sections", 2, "heading"] → "sections.2.heading". */
export function pathKey(path: FieldPath): string {
  return path.map(String).join(".");
}

/** The value at `path`, or undefined when any step is missing. */
export function getAt(root: JsonValue | undefined, path: FieldPath): JsonValue | undefined {
  let current: JsonValue | undefined = root;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === "number") current = current[segment];
    else if (isObject(current) && Object.hasOwn(current, String(segment))) current = current[String(segment)];
    else return undefined;
  }
  return current;
}

/** Whether `path` exists (the key is present, even when its value is null or ""). */
export function hasAt(root: JsonValue | undefined, path: FieldPath): boolean {
  if (path.length === 0) return root !== undefined;
  const parent = getAt(root, path.slice(0, -1));
  const last = path[path.length - 1];
  if (Array.isArray(parent)) return typeof last === "number" && last >= 0 && last < parent.length;
  return isObject(parent) && Object.hasOwn(parent, String(last));
}

/**
 * A copy of `root` with `value` at `path`; missing named levels become
 * objects. Returns `root` itself when nothing would change.
 */
export function setAt(root: JsonValue | undefined, path: FieldPath, value: JsonValue): JsonValue {
  if (path.length === 0) return value;
  const [head, ...rest] = path as [string | number, ...FieldPath];
  if (Array.isArray(root) && typeof head === "number") {
    const current = root[head];
    const next = setAt(current, rest, value);
    if (next === current && head < root.length) return root;
    const copy = root.slice();
    copy[head] = next;
    return copy;
  }
  const base: JsonObject = isObject(root) ? root : {};
  const key = String(head);
  const current = Object.hasOwn(base, key) ? base[key] : undefined;
  const next = setAt(current, rest, value);
  if (next === current && Object.hasOwn(base, key)) return base;
  return { ...base, [key]: next };
}

/** A copy of `root` without the key at `path`. Returns `root` when it isn't there. */
export function unsetAt(root: JsonValue, path: FieldPath): JsonValue {
  if (path.length === 0) return root;
  const parentPath = path.slice(0, -1);
  const parent = getAt(root, parentPath);
  const last = path[path.length - 1];
  if (!isObject(parent) || !Object.hasOwn(parent, String(last))) return root;
  const copy = { ...parent };
  delete copy[String(last)];
  return setAt(root, parentPath, copy);
}

/** Replace the list at `path` with `update(list)`. A missing list counts as empty. */
export function updateList(root: JsonValue, path: FieldPath, update: (list: JsonValue[]) => JsonValue[]): JsonValue {
  const current = getAt(root, path);
  const list = Array.isArray(current) ? current : [];
  return setAt(root, path, update(list));
}

/** Whether `path` starts with every segment of `prefix`. */
export function startsWith(path: FieldPath, prefix: FieldPath): boolean {
  if (prefix.length > path.length) return false;
  return prefix.every((segment, index) => String(path[index]) === String(segment));
}

export function samePath(a: FieldPath, b: FieldPath): boolean {
  return a.length === b.length && startsWith(a, b);
}

export function deepEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || a === undefined || b === undefined) return false;
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

/**
 * `next`, but reusing `prev`'s objects wherever the two are equal, so a fresh
 * server response doesn't hand every field a new reference.
 */
export function share<T extends JsonValue>(prev: JsonValue | undefined, next: T): T {
  if (prev === next || prev === undefined) return next;
  if (Array.isArray(next)) {
    if (!Array.isArray(prev)) return next;
    let same = prev.length === next.length;
    const out = next.map((item, index) => {
      const shared = share(prev[index], item);
      if (shared !== prev[index]) same = false;
      return shared;
    });
    return (same ? prev : out) as T;
  }
  if (isObject(next)) {
    if (!isObject(prev)) return next;
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(prev).length;
    const out: JsonObject = {};
    for (const key of keys) {
      const before = Object.hasOwn(prev, key) ? prev[key] : undefined;
      const shared = share(before, next[key] as JsonValue);
      if (shared !== before) same = false;
      out[key] = shared;
    }
    // Key order matters to people reading the source view; equal-but-reordered isn't "same".
    if (same && keys.some((key, index) => Object.keys(prev)[index] !== key)) same = false;
    return (same ? prev : out) as T;
  }
  return deepEqual(prev, next) ? (prev as T) : next;
}
