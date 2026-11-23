/**
 * What an edit op means, computed on plain JSON values. Every text-level edit
 * is checked against this: after splicing, the file is parsed again and must
 * equal exactly the value computed here, or the edit is not applied.
 */
import type { EditOp, FieldPath, JsonValue } from "../../types";
import { cloneJson, deepEqual, isObject, type JsonObject } from "../util/json";
import { labelForKey } from "../util/text";

export type DataOp = Extract<EditOp, { path: FieldPath }>;

export type Expected = { ok: true; value: JsonValue; changed: boolean } | { ok: false; reason: string };

function describe(path: FieldPath): string {
  const named = [...path].reverse().find((segment) => typeof segment === "string");

  return named === undefined ? "this list" : `“${labelForKey(String(named))}”`;
}

function child(container: JsonValue, segment: string | number): JsonValue | undefined {
  if (Array.isArray(container)) return typeof segment === "number" ? container[segment] : undefined;
  if (isObject(container)) return Object.hasOwn(container, String(segment)) ? container[String(segment)] : undefined;
  return undefined;
}

/**
 * Walks to the container that holds the last segment, creating empty objects
 * for missing (or null) named levels so `set` can add nested fields.
 */
function containerFor(
  root: JsonValue,
  path: FieldPath,
  create: boolean
): { ok: true; container: JsonObject | JsonValue[] } | { ok: false; reason: string } {
  let current: JsonValue = root;

  for (let i = 0; i < path.length - 1; i += 1) {
    const segment = path[i]!;
    const nextSegment = path[i + 1]!;
    let next = child(current, segment);

    if (next === undefined || next === null) {
      if (!create) return { ok: false, reason: `${describe(path.slice(0, i + 1))} does not exist.` };
      if (Array.isArray(current)) {
        return { ok: false, reason: `Item ${Number(segment) + 1} of ${describe(path.slice(0, i))} does not exist.` };
      }
      if (typeof nextSegment === "number") {
        return { ok: false, reason: `${describe(path.slice(0, i + 1))} is not a list yet.` };
      }
      next = {};
      (current as JsonObject)[String(segment)] = next;
    }
    if (!Array.isArray(next) && !isObject(next)) {
      return {
        ok: false,
        reason: `${describe(path.slice(0, i + 1))} holds a single value, so it has no ${describe([nextSegment])} inside it.`,
      };
    }
    current = next;
  }
  if (!Array.isArray(current) && !isObject(current)) {
    return { ok: false, reason: `${describe(path)} cannot be set here.` };
  }
  return { ok: true, container: current };
}

function listAt(root: JsonValue, path: FieldPath): { ok: true; list: JsonValue[] | undefined } | { ok: false; reason: string } {
  let current: JsonValue | undefined = root;

  for (const segment of path) {
    current = current === undefined || current === null ? undefined : child(current, segment);
  }
  if (current === undefined || current === null) return { ok: true, list: undefined };
  if (!Array.isArray(current)) return { ok: false, reason: `${describe(path)} is not a list.` };
  return { ok: true, list: current };
}

export function expectedAfter(before: JsonValue, op: DataOp): Expected {
  const root = cloneJson(before ?? {});

  switch (op.op) {
    case "set": {
      if (op.path.length === 0) return { ok: false, reason: "Say which field to change." };
      const found = containerFor(root, op.path, true);

      if (!found.ok) return found;
      const last = op.path[op.path.length - 1]!;

      if (Array.isArray(found.container)) {
        if (typeof last !== "number" || last < 0 || last > found.container.length) {
          return { ok: false, reason: `There is no item ${Number(last) + 1} in ${describe(op.path)}.` };
        }
        if (deepEqual(found.container[last], op.value)) return { ok: true, value: before, changed: false };
        found.container[last] = op.value;
      } else {
        const key = String(last);

        if (Object.hasOwn(found.container, key) && deepEqual(found.container[key], op.value)) {
          return { ok: true, value: before, changed: false };
        }
        found.container[key] = op.value;
      }
      return { ok: true, value: root, changed: true };
    }
    case "unset": {
      if (op.path.length === 0) return { ok: false, reason: "Say which field to remove." };
      const found = containerFor(root, op.path, false);

      if (!found.ok) return { ok: true, value: before, changed: false };
      const last = op.path[op.path.length - 1]!;

      if (Array.isArray(found.container)) {
        return { ok: false, reason: "Remove list items by position rather than unsetting them." };
      }
      if (!Object.hasOwn(found.container, String(last))) return { ok: true, value: before, changed: false };
      delete found.container[String(last)];
      return { ok: true, value: root, changed: true };
    }
    case "insert": {
      const found = listAt(root, op.path);

      if (!found.ok) return found;
      const length = found.list?.length ?? 0;

      if (!Number.isInteger(op.index) || op.index < 0 || op.index > length) {
        return { ok: false, reason: `Position ${op.index + 1} is outside ${describe(op.path)} (it has ${length}).` };
      }
      if (!found.list) {
        if (op.path.length === 0) return { ok: false, reason: "This file is not a list." };
        return expectedAfter(before, { op: "set", path: op.path, value: [op.value] });
      }
      found.list.splice(op.index, 0, op.value);
      return { ok: true, value: root, changed: true };
    }
    case "move": {
      const found = listAt(root, op.path);

      if (!found.ok) return found;
      const list = found.list ?? [];
      const inRange = (n: number) => Number.isInteger(n) && n >= 0 && n < list.length;

      if (!inRange(op.from) || !inRange(op.to)) {
        return { ok: false, reason: `${describe(op.path)} has ${list.length} items, so that move is not possible.` };
      }
      if (op.from === op.to) return { ok: true, value: before, changed: false };
      const [item] = list.splice(op.from, 1);

      list.splice(op.to, 0, item!);
      return { ok: true, value: root, changed: true };
    }
    case "remove": {
      const found = listAt(root, op.path);

      if (!found.ok) return found;
      const list = found.list ?? [];

      if (!Number.isInteger(op.index) || op.index < 0 || op.index >= list.length) {
        return { ok: false, reason: `There is no item ${op.index + 1} in ${describe(op.path)}.` };
      }
      list.splice(op.index, 1);
      return { ok: true, value: root, changed: true };
    }
  }
}
