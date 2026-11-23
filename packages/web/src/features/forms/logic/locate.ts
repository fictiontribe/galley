/**
 * Where the site keeps its forms and its scripts setup: the collections the
 * engine marks as the site kit's (`kit: "forms"`, one form per file, the
 * form's id its file name; `kit: "scripts"`, the scripts setup), else — for
 * a model from an older engine — the `forms` collection of JSON entries and
 * the data file whose path ends in `scripts.json`.
 */
import type { Collection, SiteModel } from "@galley/core/types";

export const FORMS_COLLECTION = "forms";

/** The site's forms: the collection the engine recognised as the kit's (by its schema or its files), else the one called "forms". */
export function formsCollection(model: SiteModel | null | undefined): Collection | null {
  return (
    model?.collections.find((collection) => collection.kit === "forms") ??
    model?.collections.find((collection) => collection.id === FORMS_COLLECTION && collection.kind === "entries" && collection.format === "json") ??
    null
  );
}

/** The site's scripts setup: the data file the engine recognised as the kit's, else a data file called scripts.json. */
export function scriptsFile(model: SiteModel | null | undefined): Collection | null {
  return model?.collections.find((collection) => collection.kit === "scripts") ?? model?.collections.find((collection) => collection.kind === "data" && /(^|\/)scripts\.json$/.test(collection.path)) ?? null;
}

/** "src/content/forms/contact.json" → "contact". */
export function formIdOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.json$/i, "");
}

/** The repo path of a form, from its id. */
export function formPath(collection: Collection, formId: string): string {
  return `${collection.path.replace(/\/+$/, "")}/${formId}.json`;
}

/** A form id people can type: lowercase words joined by hyphens. */
export function cleanFormId(typed: string): string {
  return typed
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** The docs page for a site-kit feature (or the adapter guide), under the brand's docs address. */
export function docsPage(docsUrl: string | undefined, page: "forms" | "scripts" | "adapters"): string | null {
  if (!docsUrl) return null;
  return `${docsUrl.replace(/\/+$/, "")}/${page}/`;
}

/** Whether a collection is one of the site kit's files, which have screens of their own (Forms, Scripts). */
/** The settings keys of the site kit's AI-readable output file (src/data/visibility.json) — the engine recognises it by these. */
const VISIBILITY_KEYS = new Set(["site", "crawlers", "robots", "sitemap", "structuredData", "agentReadable"]);

/**
 * The kit's AI-readable output settings, as the engine describes them: a JSON
 * data file whose fields are only those settings (site-kit/detect.ts gives it
 * the kit's own field list). Managed on the Search & AI screen, not as content.
 */
export function isVisibilitySettings(collection: Collection): boolean {
  if (collection.kind !== "data" || collection.format !== "json" || collection.fields.length === 0) return false;
  const keys = collection.fields.map((field) => field.key);
  return keys.every((key) => VISIBILITY_KEYS.has(key)) && keys.some((key) => key === "agentReadable" || key === "structuredData" || key === "crawlers");
}

export function isKitFile(collection: Collection): boolean {
  if (collection.kit) return true;
  if (isVisibilitySettings(collection)) return true;
  if (collection.id === FORMS_COLLECTION && collection.kind === "entries" && collection.format === "json") return true;
  return collection.kind === "data" && /(^|\/)scripts\.json$/.test(collection.path);
}

/** What a person calls a file of this collection: "form", "scripts setup", else "page". */
export function fileNoun(model: SiteModel | null | undefined, collectionId: string): string {
  const collection = model?.collections.find((candidate) => candidate.id === collectionId);
  if (collection && (collection.kit === "forms" || collection === formsCollection(model))) return "form";
  if (collection && (collection.kit === "scripts" || collection === scriptsFile(model))) return "scripts setup";
  return "page";
}
