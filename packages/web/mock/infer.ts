/**
 * A small, honest stand-in for the engine's schema inference: it derives
 * `Field[]` from real content values so the mock serves believable models
 * (including page-section `blocks` with real examples). Not the engine's
 * algorithm — just close enough for the UI to be built against.
 */
import type { BlockType, Field, FieldType, JsonValue } from "@galley/core/types";

type Record_ = { [key: string]: JsonValue };

const DISCRIMINATORS = ["type", "_component", "_type", "block", "component", "template"];
const ACRONYMS: Record<string, string> = { cta: "CTA", url: "URL", seo: "SEO", id: "ID" };

export function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((word) => ACRONYMS[word] ?? word);
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const isRecord = (value: JsonValue | undefined): value is Record_ => typeof value === "object" && value !== null && !Array.isArray(value);

function scalarType(values: string[]): FieldType {
  if (values.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))) return "date";
  if (values.every((v) => /^\d{4}-\d{2}-\d{2}T/.test(v))) return "datetime";
  if (values.every((v) => /\.(svg|png|jpe?g|webp|gif|avif)$/i.test(v))) return "image";
  if (values.every((v) => /^#[0-9a-f]{3,8}$/i.test(v))) return "color";
  if (values.every((v) => /^(https?:\/\/|mailto:|tel:|\/)\S*$/.test(v))) return "url";
  if (values.some((v) => v.includes("\n") || /\*[^*]+\*|\[[^\]]+\]\(/.test(v))) return "markdown";
  if (values.some((v) => v.length > 90)) return "text";
  return "string";
}

function inferOne(key: string, values: JsonValue[], present: number, total: number): Field {
  const field: Field = { key, label: humanize(key), type: "string", required: total > 0 && present / total >= 0.95, source: "inferred" };
  const defined = values.filter((v) => v !== null && v !== undefined);

  if (defined.length > 0 && defined.every((v) => typeof v === "boolean")) field.type = "boolean";
  else if (defined.length > 0 && defined.every((v) => typeof v === "number")) field.type = "number";
  else if (defined.every((v) => typeof v === "string")) {
    const strings = defined as string[];
    field.type = scalarType(strings);
    const distinct = [...new Set(strings)];
    if (field.type === "string" && distinct.length <= 8 && strings.length >= 12 && distinct.every((v) => /^[a-z-]+$/.test(v))) {
      field.type = "select";
      field.options = distinct.sort();
    }
  } else if (defined.every((v) => Array.isArray(v))) {
    const items = (defined as JsonValue[][]).flat();
    if (items.every((item) => typeof item === "string")) {
      field.type = key === "tags" || items.every((item) => (item as string).length < 24) ? "tags" : "list";
      if (field.type === "tags") field.options = [...new Set(items as string[])].sort();
      else field.of = { key: "item", label: "Item", type: "string", required: true, source: "inferred" };
    } else if (items.every(isRecord)) {
      const discriminator = DISCRIMINATORS.find((d) => items.every((item) => typeof item[d] === "string"));
      if (discriminator) {
        field.type = "blocks";
        field.discriminator = discriminator;
        field.blocks = inferBlocks(items, discriminator);
      } else {
        field.type = "list";
        field.of = { key: "item", label: humanize(key.replace(/s$/, "")), type: "object", required: true, source: "inferred", fields: inferFields(items) };
      }
    } else field.type = "json";
  } else if (defined.every(isRecord)) {
    field.type = "object";
    field.fields = inferFields(defined);
  } else field.type = "json";

  const examples = [...new Set(defined.filter((v) => typeof v !== "object").map((v) => JSON.stringify(v)))].slice(0, 3);
  if (examples.length && field.type !== "boolean") field.examples = examples.map((v) => JSON.parse(v) as JsonValue);
  return field;
}

export function inferFields(records: Record_[]): Field[] {
  const order: string[] = [];
  const values = new Map<string, JsonValue[]>();
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (!values.has(key)) {
        values.set(key, []);
        order.push(key);
      }
      values.get(key)?.push(value);
    }
  }
  return order.map((key) => inferOne(key, values.get(key) ?? [], values.get(key)?.length ?? 0, records.length));
}

function inferBlocks(items: Record_[], discriminator: string): BlockType[] {
  const groups = new Map<string, Record_[]>();
  for (const item of items) {
    const type = item[discriminator] as string;
    groups.set(type, [...(groups.get(type) ?? []), item]);
  }
  return [...groups.entries()].map(([type, group]) => {
    const withoutType = group.map(({ [discriminator]: _omit, ...rest }) => rest);
    const example = [...group].sort((a, b) => Object.keys(b).length - Object.keys(a).length)[0];
    return { type, label: humanize(type), fields: inferFields(withoutType), count: group.length, example };
  });
}
