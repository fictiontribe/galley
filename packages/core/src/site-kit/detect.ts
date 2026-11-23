/**
 * Recognising the site kit in a site, after the adapter has described it.
 *
 * A collection is a kit collection by evidence, never by its folder's name:
 * - an explicit marker — its schema in the content config is the kit's
 *   `formSchema` (the Astro adapter reports it as `kit: "forms"`, and any
 *   adapter may), or
 * - the kit's schema itself — every one of its files has the shape of a
 *   form (`fields` of known field types and a `destinations` list), or the
 *   data file has the shape of the scripts setup (a `scripts` list of
 *   entries with `id`, `kind` and `enabled`, and nothing but `consent` beside it).
 *
 * Kit collections then carry the kit's own field descriptions, so inference
 * never mistakes a form's fields for page sections.
 */
import { listCollectionFiles, readCached } from "../content/entries/files";
import type { Collection, SiteKitInfo, SiteModel } from "../types";
import { FORM_FIELDS, SCRIPTS_FIELDS, VISIBILITY_FIELDS } from "./fields";
import { FIELD_TYPES } from "./schema";

/** Where the vendored kit keeps its files, and the header each file carries. */
export const KIT_DIR = "src/galley";
export const VENDOR_HEADER = /^(?:---\n)?(?:\/\/|\/\*) Vendored from @galley\/astro (\S+) by scripts\/vendor\.mjs\./;
export const KIT_SETTINGS = `${KIT_DIR}/settings.json`;
/** The file the vendored kit's runtime reads scripts from, and the folder it reads forms from. */
export const SCRIPTS_FILE = "src/data/scripts.json";
export const FORMS_DIR = "src/content/forms";

/** Files sampled to decide a folder holds forms. */
const SAMPLE = 20;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const KNOWN_TYPES: ReadonlySet<string> = new Set(FIELD_TYPES);

/** Whether parsed JSON has the shape of a form file. */
export function looksLikeForm(data: unknown): boolean {
  if (!isObject(data) || !Array.isArray(data.fields) || !Array.isArray(data.destinations)) return false;
  return data.fields.every((field) => isObject(field) && typeof field.id === "string" && typeof field.type === "string" && KNOWN_TYPES.has(field.type));
}

const VISIBILITY_KEYS: ReadonlySet<string> = new Set(["site", "crawlers", "robots", "sitemap", "structuredData", "agentReadable"]);

/** Whether parsed JSON has the shape of the kit's AI-readable output settings (visibility.json). */
export function looksLikeVisibility(data: unknown): boolean {
  if (!isObject(data) || Object.keys(data).length === 0) return false;
  return Object.keys(data).every((key) => VISIBILITY_KEYS.has(key)) && ("agentReadable" in data || "structuredData" in data || "crawlers" in data);
}

/** Whether parsed JSON has the shape of the scripts setup. */
export function looksLikeScripts(data: unknown): boolean {
  if (!isObject(data) || !Array.isArray(data.scripts)) return false;
  if (Object.keys(data).some((key) => key !== "scripts" && key !== "consent")) return false;
  return data.scripts.every((entry) => isObject(entry) && typeof entry.id === "string" && typeof entry.kind === "string" && typeof entry.enabled === "boolean");
}

async function filesLookLike(root: string, model: Pick<SiteModel, "collections">, collection: Collection, test: (data: unknown) => boolean): Promise<boolean> {
  const files = await listCollectionFiles(root, model, collection);

  if (files.length === 0) return false;
  for (const path of files.slice(0, SAMPLE)) {
    const doc = await readCached(root, path, "json");

    if (!doc || doc.errors.length > 0 || !test(doc.data)) return false;
  }
  return true;
}

function asKitCollection(collection: Collection, kit: "forms" | "scripts"): Collection {
  if (kit === "forms") {
    return { ...collection, kit, fields: FORM_FIELDS, source: collection.source === "config" ? "config" : "schema", titleField: "name", body: false, url: null };
  }
  return { ...collection, kit, fields: SCRIPTS_FIELDS, source: collection.source === "config" ? "config" : "schema", body: false, url: null };
}

/**
 * The collections with kit collections recognised and described, and what
 * the site has of the kit. One forms collection and one scripts setup at
 * most: the first with an explicit marker wins, else the first by shape.
 */
export async function applySiteKit(
  root: string,
  collections: Collection[],
  read: { text(path: string): string | null; packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null },
): Promise<{ collections: Collection[]; kit: SiteKitInfo | undefined }> {
  const model = { collections };
  const marked = (kind: "forms" | "scripts") => collections.findIndex((collection) => collection.kit === kind && collection.format === "json");
  let forms = marked("forms");
  let scripts = marked("scripts");

  if (forms === -1) {
    for (let index = 0; index < collections.length && forms === -1; index += 1) {
      const candidate = collections[index]!;

      if (candidate.kind === "entries" && candidate.format === "json" && (await filesLookLike(root, model, candidate, looksLikeForm))) forms = index;
    }
  }
  if (scripts === -1) {
    for (let index = 0; index < collections.length && scripts === -1; index += 1) {
      const candidate = collections[index]!;

      if (candidate.kind === "data" && candidate.format === "json" && (await filesLookLike(root, model, candidate, looksLikeScripts))) scripts = index;
    }
  }
  // The AI-readable output's settings: described as declared (all optional), so inference doesn't make up rules for them.
  const visibility = new Set<number>();

  for (let index = 0; index < collections.length; index += 1) {
    const candidate = collections[index]!;

    if (index !== scripts && candidate.kind === "data" && candidate.format === "json" && (await filesLookLike(root, model, candidate, looksLikeVisibility))) visibility.add(index);
  }
  const result = collections.map((collection, index) => {
    if (visibility.has(index)) {
      const { kit: _drop, ...rest } = collection;

      return { ...rest, fields: VISIBILITY_FIELDS, source: collection.source === "config" ? ("config" as const) : ("schema" as const) };
    }
    if (index === forms) return asKitCollection(collection, "forms");
    if (index === scripts) return asKitCollection(collection, "scripts");
    // A second kit collection, or a marker naming something else, is described as any other collection.
    if ("kit" in collection) {
      const { kit: _drop, ...rest } = collection;

      return rest;
    }
    return collection;
  });

  return { collections: result, kit: kitInfo(read) };
}

/** Whether the site has the kit, and its settings. */
export function kitInfo(read: { text(path: string): string | null; packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null }): SiteKitInfo | undefined {
  const schema = read.text(`${KIT_DIR}/schema.js`);
  const version = schema ? VENDOR_HEADER.exec(schema)?.[1] : undefined;
  let allowFormScripts = false;

  if (version) {
    try {
      const settings = JSON.parse(read.text(KIT_SETTINGS) ?? "{}") as { forms?: { allowFormScripts?: unknown } };

      allowFormScripts = settings.forms?.allowFormScripts === true;
    } catch {
      allowFormScripts = false;
    }
    return { source: "vendored", version, allowFormScripts };
  }
  const pkg = read.packageJson;
  const range = pkg?.dependencies?.["@galley/astro"] ?? pkg?.devDependencies?.["@galley/astro"];

  // The package's options live in astro.config, which isn't run: form code counts as off until it is read there.
  return range ? { source: "package", version: range.replace(/^[\^~]/, ""), allowFormScripts: false } : undefined;
}
