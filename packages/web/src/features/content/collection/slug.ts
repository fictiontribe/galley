/**
 * The address proposed for a new entry: lowercase words joined by hyphens,
 * the way the engine stores slugs ("Five questions — before you extend!" →
 * "five-questions-before-you-extend").
 */
import type { Collection, CreateEntryInput, JsonValue } from "@galley/core/types";

const MAX_LENGTH = 80;

export function suggestSlug(title: string): string {
  const words = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (words.length <= MAX_LENGTH) return words;
  const cut = words.slice(0, MAX_LENGTH);
  const lastBreak = cut.lastIndexOf("-");
  return (lastBreak > 20 ? cut.slice(0, lastBreak) : cut).replace(/-+$/, "");
}

/** Tidy what a person typed into the address box without fighting them mid-word. */
export function cleanSlugInput(typed: string): string {
  return typed
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9/-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/\/{2,}/g, "/");
}

/** Why an address can't be used, in plain words; null when it's fine. */
export function slugProblem(slug: string): string | null {
  const trimmed = slug.replace(/^[-/]+|[-/]+$/g, "");
  if (trimmed === "") return "Give it an address, like “spring-open-day”.";
  if (!/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/.test(trimmed)) return "Use lowercase letters, numbers and hyphens.";
  return null;
}

/** The public address an entry with `slug` would have, from the collection's URL pattern. */
export function urlForSlug(pattern: string | null, slug: string): string | null {
  if (!pattern) return null;
  const clean = slug.replace(/^[-/]+|[-/]+$/g, "");
  return pattern.replace(/\{slug\}/g, clean === "index" ? "" : clean).replace(/\/{2,}/g, "/");
}

/**
 * What "Create" sends. From a template, only the title typed here is laid
 * over it — the other answers start empty, and empty values (or an empty
 * body) would blank the template's own content.
 */
export function newEntryBody(input: {
  collection: Pick<Collection, "id" | "body">;
  slug: string;
  title: string;
  titleKey: string | undefined;
  values: Record<string, JsonValue>;
  template: string;
}): CreateEntryInput {
  const title = input.titleKey ? { [input.titleKey]: input.title.trim() } : {};
  const slug = input.slug.replace(/^[-/]+|[-/]+$/g, "");
  if (input.template) return { collection: input.collection.id, slug, data: title, template: input.template };
  return { collection: input.collection.id, slug, data: { ...title, ...input.values }, ...(input.collection.body ? { body: "" } : {}) };
}
