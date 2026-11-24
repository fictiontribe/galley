/**
 * Real instances of each section type, with the entry each is on
 * (BlockType.samples). A new section can't start with a blank where the
 * site's component needs a file — a picture, a video — or the page stops
 * drawing; the nearest real value is known to draw, and the person is told
 * where it came from. Kept small: one instance per entry (its most
 * complete), a few entries per type, long strings dropped (they are copy,
 * which a new section never borrows).
 */
import type { BlockSample, Field, JsonValue } from "../../types";
import { isObject, type JsonObject } from "../util/json";
import { leafCount } from "./infer";

/** Entries sampled per section type. */
export const SAMPLES_PER_TYPE = 6;
/** Strings longer than this are copy, not names of things: left out of samples. */
const MAX_SAMPLE_STRING = 300;

export interface SampledEntry {
  path: string;
  data: JsonObject;
}

function trimmed(value: JsonValue): JsonValue | undefined {
  if (typeof value === "string") return value.length > MAX_SAMPLE_STRING ? undefined : value;
  if (Array.isArray(value)) return value.map(trimmed).filter((item): item is JsonValue => item !== undefined);
  if (isObject(value)) {
    const out: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      const kept = trimmed(item);
      if (kept !== undefined) out[key] = kept;
    }
    return out;
  }
  return value;
}

/** The entry's title as people know it, else its file name. */
export function entryTitle(data: JsonObject, path: string, titleField?: string): string {
  for (const key of [titleField, "title", "name", "heading"]) {
    const value = key ? data[key] : undefined;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.[^.]+$/, "");
}

/** The collection's top-level section lists, each type given its samples from these entries. */
export function withBlockSamples(fields: Field[], entries: SampledEntry[], titleField?: string): Field[] {
  return fields.map((field) => {
    if (field.type !== "blocks" || !field.blocks) return field;
    const discriminator = field.discriminator ?? "type";
    return {
      ...field,
      blocks: field.blocks.map((block) => {
        const samples: BlockSample[] = [];
        for (const entry of entries) {
          const list = entry.data[field.key];
          if (!Array.isArray(list)) continue;
          const mine = list.filter((item): item is JsonObject => isObject(item) && item[discriminator] === block.type);
          if (mine.length === 0) continue;
          const best = mine.reduce((a, b) => (leafCount(b) > leafCount(a) ? b : a));
          samples.push({ path: entry.path, title: entryTitle(entry.data, entry.path, titleField), value: trimmed(best) as JsonObject });
          if (samples.length === SAMPLES_PER_TYPE) break;
        }
        return samples.length > 0 ? { ...block, samples } : block;
      }),
    };
  });
}
