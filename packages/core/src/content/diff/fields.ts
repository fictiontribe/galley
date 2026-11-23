/**
 * Semantic field diffs for the Proof screen: what changed, in the words the
 * form uses ("Hero › Heading", "Sections › 2 (Feature grid) › Title"), not
 * as YAML lines. Lists of objects are aligned item by item (lists.ts) so
 * inserting a section reads as one added section, dragging one reads as one
 * move, and two different sections are never compared field by field.
 */
import type { Collection, Field, FieldChange, FieldPath, JsonValue } from "../../types";
import { DISCRIMINATORS } from "../schema/infer";
import { deepEqual, isObject } from "../util/json";
import { labelForBlockType, labelForKey } from "../util/text";
import { planList } from "./lists";

interface Context {
  out: FieldChange[];
}

function fieldFor(fields: Field[] | undefined, key: string): Field | undefined {
  return fields?.find((field) => field.key === key);
}

function itemLabel(item: JsonValue | undefined, field: Field | undefined, index: number): string {
  const position = String(index + 1);

  if (!isObject(item)) return position;
  const discriminator = field?.discriminator ?? DISCRIMINATORS.find((key) => typeof item[key] === "string");

  if (!discriminator || typeof item[discriminator] !== "string") return position;
  const type = item[discriminator] as string;
  const block = field?.blocks?.find((candidate) => candidate.type === type);

  return `${position} (${block?.label ?? labelForBlockType(type)})`;
}

function fieldsOfItem(item: JsonValue | undefined, field: Field | undefined): Field[] | undefined {
  if (!field) return undefined;
  if (field.type === "blocks" && isObject(item)) {
    const discriminator = field.discriminator ?? "type";
    const block = field.blocks?.find((candidate) => candidate.type === item[discriminator]);

    return block?.fields;
  }
  return field.of?.fields;
}

function push(ctx: Context, field: FieldPath, label: string, kind: FieldChange["kind"], before: JsonValue | undefined, after: JsonValue | undefined): void {
  const change: FieldChange = { field, label, kind };

  if (before !== undefined) change.before = before;
  if (after !== undefined) change.after = after;
  ctx.out.push(change);
}

function join(trail: string, label: string): string {
  return trail ? `${trail} › ${label}` : label;
}

function diffValue(ctx: Context, field: Field | undefined, fields: Field[] | undefined, path: FieldPath, label: string, before: JsonValue | undefined, after: JsonValue | undefined): void {
  if (deepEqual(before, after)) return;
  if (before === undefined) return push(ctx, path, label, "added", undefined, after);
  if (after === undefined) return push(ctx, path, label, "removed", before, undefined);
  if (isObject(before) && isObject(after)) {
    diffObject(ctx, field?.fields ?? fields, path, label, before, after);
    return;
  }
  if (Array.isArray(before) && Array.isArray(after) && [...before, ...after].some((item) => isObject(item))) {
    diffList(ctx, field, path, label, before, after);
    return;
  }
  // Scalars and lists of scalars (tags) change as one value.
  push(ctx, path, label, "changed", before, after);
}

/**
 * A list of objects, item by item (see lists.ts for how items are matched).
 * Rows that name an item now (moved, added, edited inside) use its current
 * position; a removed item uses the position it had, and its row sits just
 * after the unmoved item it used to follow.
 */
function diffList(ctx: Context, field: Field | undefined, path: FieldPath, label: string, before: JsonValue[], after: JsonValue[]): void {
  const plan = planList(before, after, field);
  const groups: Array<{ at: number; order: number; rows: FieldChange[] }> = [];
  const stableTo = new Int32Array(before.length).fill(-1);

  for (const pair of plan.pairs) {
    if (!pair.moved) stableTo[pair.from] = pair.to;
    if (pair.exact && !pair.moved) continue;
    const item = after[pair.to];
    const itemPath = [...path, pair.to];
    const trail = join(label, itemLabel(item, field, pair.to));
    const sub: Context = { out: [] };

    if (pair.moved) sub.out.push({ field: itemPath, label: trail, kind: "moved", from: pair.from, to: pair.to });
    // Edited pairs are always two objects of the same type (lists.ts pairs nothing else).
    if (!pair.exact) diffObject(sub, fieldsOfItem(item, field), itemPath, trail, before[pair.from] as never, after[pair.to] as never);
    groups.push({ at: pair.to, order: 0, rows: sub.out });
  }
  for (const to of plan.added) {
    const sub: Context = { out: [] };

    push(sub, [...path, to], join(label, itemLabel(after[to], field, to)), "added", undefined, after[to]);
    groups.push({ at: to, order: 0, rows: sub.out });
  }
  let previous = -1;
  const removed = new Set(plan.removed);

  for (let from = 0; from < before.length; from += 1) {
    if (stableTo[from]! >= 0) previous = stableTo[from]!;
    if (!removed.has(from)) continue;
    const sub: Context = { out: [] };

    push(sub, [...path, from], join(label, itemLabel(before[from], field, from)), "removed", before[from], undefined);
    groups.push({ at: previous + 0.5, order: from, rows: sub.out });
  }
  groups.sort((x, y) => x.at - y.at || x.order - y.order);
  for (const group of groups) ctx.out.push(...group.rows);
}

function diffObject(ctx: Context, fields: Field[] | undefined, path: FieldPath, trail: string, before: { [key: string]: JsonValue }, after: { [key: string]: JsonValue }): void {
  const keys = [...new Set([...(fields ?? []).map((field) => field.key), ...Object.keys(before), ...Object.keys(after)])];

  for (const key of keys) {
    if (!Object.hasOwn(before, key) && !Object.hasOwn(after, key)) continue;
    const field = fieldFor(fields, key);

    diffValue(ctx, field, undefined, [...path, key], join(trail, field?.label ?? labelForKey(key)), before[key], after[key]);
  }
}

export function diffFields(collection: Collection | null, before: { [key: string]: JsonValue } | null, after: { [key: string]: JsonValue } | null): FieldChange[] {
  const ctx: Context = { out: [] };

  diffObject(ctx, collection?.fields, [], "", before ?? {}, after ?? {});
  return ctx.out;
}

/**
 * The form's label for a path into an entry's data, e.g.
 * ["sections", 1, "title"] → "Sections › 2 (Feature grid) › Title".
 */
export function labelForFieldPath(collection: Collection | null, data: { [key: string]: JsonValue }, path: FieldPath): string {
  const parts: string[] = [];
  let fields: Field[] | undefined = collection?.fields;
  let field: Field | undefined;
  let value: JsonValue | undefined = data;

  for (const segment of path) {
    if (typeof segment === "number" && Array.isArray(value)) {
      const item: JsonValue | undefined = value[segment];

      parts.push(itemLabel(item, field, segment));
      fields = fieldsOfItem(item, field);
      field = field?.type === "list" ? field.of : undefined;
      value = item;
      continue;
    }
    field = fieldFor(fields, String(segment));
    parts.push(field?.label ?? labelForKey(String(segment)));
    fields = field?.fields;
    value = isObject(value) ? value[String(segment)] : undefined;
  }
  return parts.join(" › ");
}
