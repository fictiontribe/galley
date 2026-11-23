/**
 * Click to edit, decided: what a resolver answer lets the person do, and
 * exactly which write it becomes. Nothing here guesses — a write only ever
 * goes to the file and place the resolver named.
 */
import type { EditOp, Field, FieldPath, JsonValue, ResolveResult, SourceMatch } from "@galley/core/types";
import { fileName, friendlyLabel } from "@/lib/format";

export type EditAction =
  /** Retype it on the page: the stored value is exactly the visible text. */
  | { kind: "in-place"; match: SourceMatch }
  /** Edit the stored value as written (it carries formatting the page doesn't show). */
  | { kind: "stored"; match: SourceMatch }
  /** Several places hold this text; the person picks one. */
  | { kind: "choose"; matches: SourceMatch[]; reason: string }
  /** Not content: part of the site's design (its code). Hand it to the assistant. */
  | { kind: "design"; reason: string };

const DESIGN_REASON = "It isn’t stored with the page’s content: it’s part of the site’s design, or worked out from other details, so it can’t be edited here.";
/** Resolver reasons worth passing on as they are (they say something specific); the rest get the plain sentence. */
const SPECIFIC = /too (many|short)|no words/i;

/** What one match allows on its own. */
export function actionForMatch(match: SourceMatch): EditAction {
  if (!match.editable || match.location.kind === "source") {
    return { kind: "design", reason: "It’s written into the site’s design, so it can’t be edited here." };
  }
  return match.plain ? { kind: "in-place", match } : { kind: "stored", match };
}

export function actionFor(result: ResolveResult): EditAction {
  if (result.status === "none" || result.matches.length === 0) return { kind: "design", reason: result.reason && SPECIFIC.test(result.reason) ? result.reason : DESIGN_REASON };
  if (result.status === "unique" && result.matches.length === 1 && result.matches[0]) return actionForMatch(result.matches[0]);
  return { kind: "choose", matches: result.matches, reason: result.reason ?? "This text appears in more than one place. Choose the one you meant." };
}

/** The write for a new value at a match, or null when the match isn't content. */
export function editFor(match: SourceMatch, value: string): { path: string; ops: EditOp[] } | null {
  switch (match.location.kind) {
    case "field":
      return { path: match.path, ops: [{ op: "set", path: match.location.field, value }] };
    case "body":
      return { path: match.path, ops: [{ op: "body-replace", find: match.value, replace: value }] };
    default:
      return null;
  }
}

/**
 * A field label in the words of the form: "Sections › 1 (Hero) › Heading"
 * reads "Hero › Heading" — the section's own name stands for its place.
 */
export function plainFieldLabel(label: string): string {
  return label.replace(/(^|› )[^›]*? › \d+ \(([^)]+)\)/g, "$1$2");
}

/**
 * The same label with each section's place kept: "Sections › 2 (Features) ›
 * Button" reads "Features (section 2) › Button". For choosing between
 * matches that would otherwise read alike — two "Learn more" buttons in two
 * Features sections.
 */
export function placedFieldLabel(label: string): string {
  // The outermost list is the page's sections; anything deeper is an item within one ("Item 2").
  let depth = 0;
  return label.replace(/(^|› )[^›]*? › (\d+) \(([^)]+)\)/g, (_all, lead: string, at: string, type: string) => (depth++ === 0 ? `${lead}${type} (section ${at})` : `${lead}${type} ${at}`));
}

/** What a person calls the entry: "Home page" for a site's front page, else its title, shortened at a dash. */
export function entryName(path: string, title: string | undefined): string {
  if (/(^|\/)index\.[a-z0-9]+$/i.test(path) && /\/pages\/index\.|^src\/content\/index\.|^content\/_?index\./i.test(path)) return "Home page";
  if (!title) return friendlyLabel(path);
  const short = title.split(/ [—–|·] /)[0] ?? title;
  return short.length >= 3 ? short : title;
}

/** "Home page › Hero › Heading", "Site settings › Tagline", "About › Body text". */
export function matchLabel(match: SourceMatch, collectionLabel?: string, options: { places?: boolean } = {}): string {
  const title = match.title ? entryName(match.path, match.title) : (collectionLabel ?? entryName(match.path, undefined));
  switch (match.location.kind) {
    case "field":
      return `${title} › ${options.places ? placedFieldLabel(match.location.label) : plainFieldLabel(match.location.label)}`;
    case "body":
      return `${title} › Body text`;
    default:
      return `${fileName(match.path)} · line ${match.location.line}`;
  }
}

/** The forms an image address can take on the page that point at the same stored value. */
function imageAliases(src: string): string[] {
  const out = new Set<string>([src]);
  try {
    out.add(decodeURI(src));
  } catch {
    // Not encoded.
  }
  // Optimised images (/_image?href=/src/assets/a.png&w=…) name the original in a parameter.
  const query = src.indexOf("?");
  if (query >= 0) {
    const href = new URLSearchParams(src.slice(query + 1)).get("href");
    if (href) out.add(href);
    out.add(src.slice(0, query));
  }
  return [...out];
}

/** Every place in an entry's data whose value is exactly this image's address. */
export function findImageFields(data: { [key: string]: JsonValue }, src: string): FieldPath[] {
  const aliases = new Set(imageAliases(src));
  const found: FieldPath[] = [];
  const walk = (value: JsonValue, at: FieldPath) => {
    if (typeof value === "string") {
      if (aliases.has(value)) found.push(at);
    } else if (Array.isArray(value)) value.forEach((item, index) => walk(item, [...at, index]));
    else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) walk(item, [...at, key]);
  };
  walk(data, []);
  return found;
}

const humanize = (key: string): string => {
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** A field path in the form's own words: "Sections › Hero › Image". */
export function fieldPathLabel(fields: Field[], data: { [key: string]: JsonValue }, path: FieldPath): string {
  const parts: string[] = [];
  let level: Field[] | undefined = fields;
  let field: Field | undefined;
  let value: JsonValue | undefined = data;
  for (const segment of path) {
    if (typeof segment === "number") {
      const item: JsonValue | undefined = Array.isArray(value) ? value[segment] : undefined;
      const blockKey = field?.discriminator ?? "type";
      const type = item && typeof item === "object" && !Array.isArray(item) ? item[blockKey] : undefined;
      const block = typeof type === "string" ? field?.blocks?.find((candidate) => candidate.type === type) : undefined;
      parts.push(block?.label ?? (typeof type === "string" ? humanize(type) : `Item ${segment + 1}`));
      level = block?.fields ?? field?.of?.fields;
      value = item;
      continue;
    }
    field = level?.find((candidate) => candidate.key === segment);
    parts.push(field?.label ?? humanize(segment));
    level = field?.fields;
    value = value && typeof value === "object" && !Array.isArray(value) ? value[segment] : undefined;
  }
  return parts.join(" › ");
}
