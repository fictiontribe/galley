/**
 * Schema-aware translatable segment extraction & reconstruction.
 *
 * Extracts human-readable strings from structured entry frontmatter (including
 * nested objects, arrays, and page-builder blocks) and Markdown body paragraphs
 * while keeping non-translatable fields (IDs, block discriminators, images,
 * raw URLs, dates, numbers, booleans, enums, fenced code blocks) strictly
 * intact so Astro Zod schemas always validate.
 */
import type { Entry, Field, FieldPath, JsonValue } from "../types";
import { rewriteMarkdownLinks, rewriteUrlValue } from "./slugs";

export interface TranslatableSegment {
  /** Stable id: "field:<dot-path>" or "body:<index>". */
  id: string;
  kind: "field" | "body";
  /** Structured path into `entry.data` (for kind === "field"). */
  fieldPath?: FieldPath;
  /** Paragraph index in body chunks (for kind === "body"). */
  bodyIndex?: number;
  text: string;
}

const SKIP_KEYS = new Set([
  "id",
  "slug",
  "type",
  "_type",
  "_component",
  "component",
  "layout",
  "template",
  "theme",
  "look",
  "variant",
  "tone",
  "align",
  "alignment",
  "size",
  "columns",
  "cols",
  "ratio",
  "aspect",
  "aspectratio",
  "icon",
  "glyph",
  "locale",
  "lang",
  "language",
  "translationkey",
  "translation_key",
  "href",
  "url",
  "link",
  "src",
  "image",
  "avatar",
  "photo",
  "logo",
  "poster",
  "video",
  "email",
  "phone",
  "tel",
  "date",
  "datetime",
  "publishedat",
  "updatedat",
  "color",
  "background",
  "bg",
  "classname",
  "class",
  "target",
  "rel",
  "method",
  "action",
  "form",
  "formid",
  "collection",
  "categoryid",
  "authorid",
]);

const URL_FIELD_KEYS = new Set(["href", "url", "link", "to", "ctaurl", "ctahref", "buttonurl", "buttonhref", "primaryhref", "secondaryhref"]);

const SKIP_FIELD_TYPES = new Set<Field["type"]>(["number", "boolean", "date", "datetime", "image", "url", "color", "select", "reference", "json"]);

function looksLikeNonTranslatableString(value: string): boolean {
  const trimmed = value.trim();

  if (!trimmed) return true;
  if (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(trimmed)) return true;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return true;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) return true;
  if (/^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/.test(trimmed)) return true;
  if (/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/i.test(trimmed) && trimmed.includes("-") && !trimmed.includes(" ") && trimmed.length < 48) {
    // Looks like a slug/token identifier (e.g. "night-shift", "cta-band") unless capitalized prose.
    if (trimmed === trimmed.toLowerCase()) return true;
  }
  if (/^[\d.,%$€£¥+\-:/()\s]+$/.test(trimmed)) return true;
  if (/\.(png|jpe?g|webp|avif|gif|svg|ico|pdf|mp4|webm|woff2?|css|js|json|md|mdx)$/i.test(trimmed)) return true;
  return false;
}

export function fieldPathKey(path: FieldPath): string {
  return path.map(String).join(".");
}

function findFieldDef(fields: readonly Field[] | undefined, key: string): Field | undefined {
  return fields?.find((item) => item.key === key);
}

function walkData(
  value: JsonValue,
  path: FieldPath,
  field: Field | undefined,
  out: TranslatableSegment[],
  discriminatorKey?: string
): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    const key = typeof path[path.length - 1] === "string" ? String(path[path.length - 1]).toLowerCase() : "";

    if (discriminatorKey && key === discriminatorKey.toLowerCase()) return;
    if (key && SKIP_KEYS.has(key)) return;
    if (field && SKIP_FIELD_TYPES.has(field.type)) return;
    if (looksLikeNonTranslatableString(value)) return;
    out.push({
      id: `field:${fieldPathKey(path)}`,
      kind: "field",
      fieldPath: [...path],
      text: value,
    });
    return;
  }
  if (typeof value !== "object") return;

  if (Array.isArray(value)) {
    if (field?.type === "blocks") {
      const disc = field.discriminator ?? "type";

      value.forEach((item, index) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const blockType = typeof item[disc] === "string" ? item[disc] : "";
          const blockDef = field.blocks?.find((b) => b.type === blockType);

          for (const [k, v] of Object.entries(item)) {
            if (k === disc) continue;
            walkData(v, [...path, index, k], findFieldDef(blockDef?.fields, k), out, disc);
          }
        }
      });
      return;
    }
    const itemField = field?.type === "list" ? field.of : field?.type === "tags" ? { key: "tag", label: "Tag", type: "string" as const, required: false, source: "inferred" as const } : undefined;

    value.forEach((item, index) => {
      walkData(item, [...path, index], itemField, out);
    });
    return;
  }

  for (const [k, v] of Object.entries(value)) {
    if (discriminatorKey && k === discriminatorKey) continue;
    walkData(v, [...path, k], findFieldDef(field?.fields, k), out);
  }
}

export interface BodyPart {
  translatable: boolean;
  text: string;
}

/**
 * Splits a Markdown body into alternating verbatim chunks (blank lines, fenced
 * code blocks, horizontal rules) and translatable prose blocks.
 */
export function splitMarkdownBody(body: string): BodyPart[] {
  if (!body || !body.trim()) return [];
  const lines = body.split("\n");
  const parts: BodyPart[] = [];
  let buf: string[] = [];
  let inFence: string | null = null;
  let fenceBuf: string[] = [];

  const flushProse = () => {
    if (!buf.length) return;
    const text = buf.join("\n");

    if (text.trim()) parts.push({ translatable: true, text });
    else parts.push({ translatable: false, text });
    buf = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const fenceMatch = /^(\s*)(`{3,}|~{3,})/.exec(line);

    if (inFence) {
      fenceBuf.push(line);
      if (fenceMatch && fenceMatch[2]!.startsWith(inFence[0]!) && fenceMatch[2]!.length >= inFence.length && line.trim().length === fenceMatch[2]!.length) {
        parts.push({ translatable: false, text: fenceBuf.join("\n") });
        fenceBuf = [];
        inFence = null;
      }
      continue;
    }

    if (fenceMatch) {
      flushProse();
      inFence = fenceMatch[2]!;
      fenceBuf = [line];
      continue;
    }

    if (line.trim() === "") {
      flushProse();
      parts.push({ translatable: false, text: line });
      continue;
    }

    // Keep pure HTML comment / JSX import lines untouched.
    if (/^\s*(import\s+.+from\s+|export\s+|<!--[\s\S]*-->\s*$)/.test(line)) {
      flushProse();
      parts.push({ translatable: false, text: line });
      continue;
    }

    buf.push(line);
  }

  if (fenceBuf.length) parts.push({ translatable: false, text: fenceBuf.join("\n") });
  flushProse();
  return parts;
}

export function extractTranslatableSegments(entry: Pick<Entry, "data" | "body" | "fields">): {
  segments: TranslatableSegment[];
  bodyParts: BodyPart[];
} {
  const segments: TranslatableSegment[] = [];

  for (const [key, value] of Object.entries(entry.data)) {
    walkData(value, [key], findFieldDef(entry.fields, key), segments);
  }
  const bodyParts = entry.body !== null ? splitMarkdownBody(entry.body) : [];
  let bodyIdx = 0;

  for (const part of bodyParts) {
    if (!part.translatable) continue;
    segments.push({
      id: `body:${bodyIdx}`,
      kind: "body",
      bodyIndex: bodyIdx,
      text: part.text,
    });
    bodyIdx += 1;
  }
  return { segments, bodyParts };
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function setAtPath(root: Record<string, JsonValue>, path: FieldPath, value: JsonValue): void {
  if (path.length === 0) return;
  let cursor: unknown = root;

  for (let i = 0; i < path.length - 1; i += 1) {
    const seg = path[i]!;

    if (cursor === null || typeof cursor !== "object") return;
    cursor = (cursor as Record<string | number, unknown>)[seg];
  }
  const last = path[path.length - 1]!;

  if (cursor !== null && typeof cursor === "object") {
    (cursor as Record<string | number, JsonValue>)[last] = value;
  }
}

function rewriteDataUrls(value: JsonValue, keyName: string, field: Field | undefined, urlMap: ReadonlyMap<string, string>): JsonValue {
  if (urlMap.size === 0 || value === null || value === undefined) return value;
  if (typeof value === "string") {
    const lowerKey = keyName.toLowerCase();

    if (field?.type === "url" || URL_FIELD_KEYS.has(lowerKey)) {
      return rewriteUrlValue(value, urlMap);
    }
    if (field?.type === "markdown" || value.includes("](/")) {
      return rewriteMarkdownLinks(value, urlMap);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (field?.type === "blocks") {
      const disc = field.discriminator ?? "type";

      return value.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return item;
        const blockType = typeof item[disc] === "string" ? item[disc] : "";
        const blockDef = field.blocks?.find((b) => b.type === blockType);
        const out: Record<string, JsonValue> = {};

        for (const [k, v] of Object.entries(item)) {
          out[k] = k === disc ? v : rewriteDataUrls(v, k, findFieldDef(blockDef?.fields, k), urlMap);
        }
        return out;
      });
    }
    const itemField = field?.type === "list" ? field.of : undefined;

    return value.map((item) => rewriteDataUrls(item, keyName, itemField, urlMap));
  }
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};

    for (const [k, v] of Object.entries(value)) {
      out[k] = rewriteDataUrls(v, k, findFieldDef(field?.fields, k), urlMap);
    }
    return out;
  }
  return value;
}

/**
 * Applies translated segment strings onto a deep clone of the source entry's
 * data & body and rewrites internal links using the locale counterpart URL map.
 */
export function applyTranslatedSegments(
  sourceEntry: Pick<Entry, "data" | "body" | "fields">,
  translations: ReadonlyMap<string, string>,
  urlMap: ReadonlyMap<string, string>,
  localizedSlug?: string
): { data: Record<string, JsonValue>; body: string | null } {
  const { segments, bodyParts } = extractTranslatableSegments(sourceEntry);
  const nextData = cloneJson(sourceEntry.data as JsonValue) as Record<string, JsonValue>;

  for (const segment of segments) {
    if (segment.kind !== "field" || !segment.fieldPath) continue;
    const translated = translations.get(segment.id);

    if (translated !== undefined) {
      setAtPath(nextData, segment.fieldPath, translated);
    }
  }

  // Only update frontmatter `slug` if the source entry itself already carries one.
  if (localizedSlug && typeof sourceEntry.data.slug === "string") {
    nextData.slug = localizedSlug;
  }

  // Rewrite internal links inside URL & markdown fields.
  const rewrittenData: Record<string, JsonValue> = {};

  for (const [k, v] of Object.entries(nextData)) {
    rewrittenData[k] = rewriteDataUrls(v, k, findFieldDef(sourceEntry.fields, k), urlMap);
  }

  let nextBody: string | null = sourceEntry.body;

  if (sourceEntry.body !== null) {
    let bodyIdx = 0;
    const rebuilt = bodyParts
      .map((part) => {
        if (!part.translatable) return part.text;
        const id = `body:${bodyIdx}`;

        bodyIdx += 1;
        const translated = translations.get(id) ?? part.text;

        return rewriteMarkdownLinks(translated, urlMap);
      })
      .join("\n");

    nextBody = rebuilt;
  }

  return { data: rewrittenData, body: nextBody };
}

/** Word count for user-facing translation summaries. */
export function countWords(text: string): number {
  const trimmed = text.trim();

  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Conservative token estimate (~3.6 chars/token + per-segment JSON key overhead)
 * used for upfront cost & credit previews before any AI request is sent.
 */
export function estimateSegmentTokens(text: string): number {
  if (!text) return 0;
  return Math.max(4, Math.ceil(text.length / 3.6) + 6);
}
