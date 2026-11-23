/**
 * Plain names for field paths: ["sections", 0, "heading"] → "Sections › Hero › Heading",
 * using the site's own labels and section types.
 */
import type { Field, FieldPath, JsonValue } from "@galley/core/types";
import { applyOpsLocal, type DataOp } from "./ops";
import { getAt, type JsonObject } from "./paths";
import { blockLabel, blockTypeOf } from "./summary";

function humanKey(key: string): string {
  const words = key.replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function labelForPath(fields: readonly Field[], data: JsonValue, path: FieldPath): string {
  const parts: string[] = [];
  let level: readonly Field[] | undefined = fields;
  let current: Field | undefined;
  for (let index = 0; index < path.length; index++) {
    const segment = path[index];
    if (typeof segment === "number") {
      const item = getAt(data, path.slice(0, index + 1));
      if (current?.type === "blocks") {
        parts.push(blockLabel(item, current));
        level = blockTypeOf(item, current)?.fields;
      } else {
        parts.push(`${current?.of?.label ?? "Item"} ${segment + 1}`);
        level = current?.of?.fields;
      }
      current = undefined;
      continue;
    }
    current = level?.find((field) => field.key === segment);
    parts.push(current?.label ?? humanKey(String(segment)));
    level = current?.fields;
  }
  return parts.join(" › ");
}

/** A short, readable version of a value for "what you typed" lists. */
export function previewValue(value: JsonValue | undefined): string {
  if (value === undefined) return "cleared";
  if (typeof value === "string") return value.length > 80 ? `“${value.slice(0, 78)}…”` : `“${value}”`;
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.every((item) => typeof item === "string") ? value.join(", ") : `${value.length} items`;
  return "a group of fields";
}

/** A reorder, addition or removal that a conflict kept from being saved, with the data it was made on. */
export interface StructureLoss {
  op: Extract<DataOp, { op: "insert" | "move" | "remove" }>;
  /** The entry as it was just before this op. */
  data: JsonObject;
}

const lastPart = (label: string) => label.split(" › ").pop() ?? label;

/**
 * One lost reorder, addition or removal in plain words: “Moved “Hero” in
 * Sections”, “Added “Steps” to Sections”, “Removed “Item 2” from Features”.
 */
export function describeStructureLoss(fields: readonly Field[], loss: StructureLoss): string {
  const { op, data } = loss;
  const list = labelForPath(fields, data, op.path);
  if (op.op === "insert") {
    const after = applyOpsLocal(data, [op]);
    return `Added “${lastPart(labelForPath(fields, after, [...op.path, op.index]))}” to ${list}`;
  }
  if (op.op === "move") {
    return `Moved “${lastPart(labelForPath(fields, data, [...op.path, op.from]))}” in ${list} (to position ${op.to + 1})`;
  }
  return `Removed “${lastPart(labelForPath(fields, data, [...op.path, op.index]))}” from ${list}`;
}
