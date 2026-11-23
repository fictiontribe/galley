/**
 * The shape of a form's field list — ids, steps, widths, types — as one
 * string, so the canvas re-draws when fields are added, moved or resized and
 * not on every keystroke in a label.
 */
import type { JsonValue } from "@galley/core/types";
import type { FormField } from "@galley/core/kit";
import { isObject } from "./json";

export interface FieldSlot {
  /** Position in the file's `fields`. */
  index: number;
  /** A key unique in the list: the field's id (duplicates get a suffix). */
  key: string;
  id: string;
  type: FormField["type"];
  step: number;
  half: boolean;
}

/** One line per field: "id\tstep\twidth\ttype". */
export function structureOf(fields: JsonValue | undefined): string {
  if (!Array.isArray(fields)) return "";
  return fields
    .map((field) => {
      if (!isObject(field)) return "\t0\tfull\ttext";
      const step = typeof field.step === "number" && field.step > 0 ? Math.floor(field.step) : 0;
      return [typeof field.id === "string" ? field.id : "", step, field.width === "half" ? "half" : "full", typeof field.type === "string" ? field.type : "text"].join("\t");
    })
    .join("\n");
}

export function slotsOf(structure: string): FieldSlot[] {
  if (!structure) return [];
  const seen = new Map<string, number>();
  return structure.split("\n").map((line, index) => {
    const [id = "", step = "0", width = "full", type = "text"] = line.split("\t");
    const times = seen.get(id) ?? 0;
    seen.set(id, times + 1);
    return { index, key: times === 0 && id ? id : `${id || "field"}#${index}`, id, type: type as FormField["type"], step: Number(step) || 0, half: width === "half" };
  });
}
