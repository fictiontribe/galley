/**
 * Writing galley.config.json the way an editor would: only the values that
 * differ change, through the same format-preserving JSON edits as content
 * files (Principle 3 holds for the config file too). A compact one-line
 * object a person wrote stays one line unless something in it changes.
 */
import type { FieldPath, GalleyConfig, JsonValue } from "../../types";
import type { DataOp } from "../edit/expected";
import { applyJsonOp } from "../edit/json";
import { deepEqual, isObject } from "../util/json";
import { serializeConfig } from "./config";

/** What makes two list items "the same item" when the list is reordered or grows. */
function identity(value: JsonValue): string {
  if (isObject(value)) {
    for (const key of ["id", "key", "type"]) {
      if (typeof value[key] === "string") return `${key}:${value[key] as string}`;
    }
  }
  return `json:${JSON.stringify(value)}`;
}

/** Longest common subsequence of two identity lists, as matched index pairs. */
function matchItems(before: string[], after: string[]): Array<[number, number]> {
  const rows = before.length;
  const cols = after.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i]![j] = before[i] === after[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];

  for (let i = 0, j = 0; i < rows && j < cols; ) {
    if (before[i] === after[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i += 1;
    else j += 1;
  }
  return pairs;
}

/** The smallest list of data ops that turns `before` into `after`. */
export function diffOps(before: JsonValue, after: JsonValue, path: FieldPath = []): DataOp[] {
  if (deepEqual(before, after)) return [];
  if (isObject(before) && isObject(after)) {
    const ops: DataOp[] = [];

    for (const key of Object.keys(before)) if (!(key in after)) ops.push({ op: "unset", path: [...path, key] });
    for (const [key, value] of Object.entries(after)) {
      ops.push(...(key in before ? diffOps(before[key]!, value, [...path, key]) : [{ op: "set" as const, path: [...path, key], value }]));
    }
    return ops;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const pairs = matchItems(before.map(identity), after.map(identity));
    const keptBefore = new Set(pairs.map(([i]) => i));
    const keptAfter = new Set(pairs.map(([, j]) => j));
    const ops: DataOp[] = [];

    // Removals from the end first, so earlier indexes stay valid; then
    // insertions in order, which leaves every kept item at its new index.
    for (let i = before.length - 1; i >= 0; i -= 1) if (!keptBefore.has(i)) ops.push({ op: "remove", path, index: i });
    for (let j = 0; j < after.length; j += 1) if (!keptAfter.has(j)) ops.push({ op: "insert", path, index: j, value: after[j]! });
    for (const [i, j] of pairs) ops.push(...diffOps(before[i]!, after[j]!, [...path, j]));
    return ops;
  }
  return [{ op: "set", path, value: after }];
}

/**
 * The config file's new text: `previous` with only the changed values
 * edited in place, or the canonical serialisation when there is no file yet
 * (or it can't be read as JSON). A `$schema` the file has is kept when the
 * new config leaves it out.
 */
export function updateConfigText(previous: string | null, next: GalleyConfig): string {
  if (previous === null || previous.trim() === "") return serializeConfig(next);
  let stored: JsonValue;

  try {
    stored = JSON.parse(previous.replace(/^﻿/, "")) as JsonValue;
  } catch {
    return serializeConfig(next);
  }
  if (!isObject(stored)) return serializeConfig(next);
  // Through JSON once, so keys set to undefined count as absent, as they would on disk.
  const wanted = JSON.parse(JSON.stringify(next)) as { [key: string]: JsonValue };

  if (wanted.$schema === undefined && typeof stored.$schema === "string") wanted.$schema = stored.$schema;
  let text = previous;

  for (const op of diffOps(stored, wanted)) {
    const outcome = applyJsonOp(text, op, false);

    if (!outcome.ok) return serializeConfig(next);
    text = outcome.text;
  }
  try {
    if (deepEqual(JSON.parse(text.replace(/^﻿/, "")) as JsonValue, wanted)) return text;
  } catch {
    // fall through
  }
  return serializeConfig(next);
}
