/**
 * Matching a collection's fields by meaning.
 *
 * The target is whatever site is open, so field names can't be assumed:
 * one site says `description`, another `summary`, a third keeps SEO text
 * in `seo.description`. Each WordPress detail has a role and a list of the
 * names people actually use for it, checked against the field's type too
 * (a "date" role needs a date-like field). A field is used for one role at
 * most, and a role with no matching field simply isn't filled — the report
 * names what had nowhere to go.
 */
import type { Collection, Field } from "@galley/core/types";

export type Role =
  | "title"
  | "seoTitle"
  | "description"
  | "seoDescription"
  | "excerpt"
  | "date"
  | "updated"
  | "author"
  | "tags"
  | "categories"
  | "image"
  | "imageAlt"
  | "draft"
  | "canonical"
  | "noindex"
  | "slug";

export interface FieldRef {
  /** Path from the entry's top level, e.g. ["seo", "title"]. */
  path: string[];
  field: Field;
}

export type RoleMap = Partial<Record<Role, FieldRef & { inverse?: boolean }>>;

const NAMES: Record<Role, string[]> = {
  title: ["title", "name", "headline", "heading"],
  seoTitle: ["seotitle", "metatitle", "pagetitle", "ogtitle", "seo.title", "meta.title", "seo.metatitle"],
  description: ["description", "summary", "excerpt", "dek", "lede", "standfirst", "subtitle", "abstract", "teaser", "intro", "blurb"],
  seoDescription: ["metadescription", "seodescription", "ogdescription", "seo.description", "meta.description", "seo.metadescription"],
  excerpt: ["excerpt", "summary", "teaser", "intro"],
  date: ["date", "pubdate", "publishdate", "publishedat", "published", "publisheddate", "postdate", "created", "createdat"],
  updated: ["updated", "updateddate", "updatedat", "modified", "modifieddate", "lastmodified", "lastupdated", "updatedon"],
  author: ["author", "authors", "byline", "writer", "postedby"],
  tags: ["tags", "keywords", "topics", "labels"],
  categories: ["categories", "category", "section", "topic"],
  image: ["image", "cover", "coverimage", "heroimage", "featuredimage", "featured", "thumbnail", "banner", "ogimage", "socialimage", "shareimage", "photo", "picture", "img", "hero"],
  imageAlt: ["imagealt", "coveralt", "imagealttext", "heroimagealt", "featuredimagealt", "thumbnailalt", "alt"],
  draft: ["draft", "published", "status", "isdraft", "unpublished", "hidden"],
  canonical: ["canonical", "canonicalurl", "seo.canonical", "meta.canonical"],
  noindex: ["noindex", "robotsnoindex", "seo.noindex", "hidefromsearch", "meta.noindex"],
  slug: ["slug", "permalink"],
};

/** The order roles claim fields: specific roles before general ones, so `seo.description` isn't taken as the description. */
const ORDER: Role[] = ["seoTitle", "seoDescription", "title", "date", "updated", "author", "tags", "categories", "image", "imageAlt", "draft", "canonical", "noindex", "slug", "description", "excerpt"];

function norm(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, "");
}

function typeFits(role: Role, field: Field): boolean {
  const t = field.type;

  switch (role) {
    case "title":
    case "seoTitle":
    case "imageAlt":
      return t === "string" || t === "text";
    case "description":
    case "seoDescription":
    case "excerpt":
      return t === "string" || t === "text" || t === "markdown";
    case "date":
    case "updated":
      return t === "date" || t === "datetime" || t === "string";
    case "author":
      return t === "string" || t === "reference" || t === "tags" || (t === "list" && (field.of?.type === "string" || field.of?.type === "reference"));
    case "tags":
      return t === "tags" || (t === "list" && field.of?.type === "string");
    case "categories":
      return t === "tags" || t === "select" || t === "string" || (t === "list" && (field.of?.type === "string" || field.of?.type === "select"));
    case "image":
      return t === "image" || t === "string" || t === "url" || (t === "object" && Boolean(field.fields?.some((f) => /^(src|url|image|path)$/i.test(f.key))));
    case "draft":
      return t === "boolean" || (t === "select" && Boolean(field.options?.some((option) => /draft/i.test(option))));
    case "canonical":
      return t === "url" || t === "string";
    case "noindex":
      return t === "boolean";
    case "slug":
      return t === "string";
    default:
      return false;
  }
}

function candidates(collection: Collection): FieldRef[] {
  const out: FieldRef[] = [];

  for (const field of collection.fields) {
    if (field.type === "blocks") continue;
    out.push({ path: [field.key], field });
    if (field.type === "object" && field.fields && /^(seo|meta|metadata|og|social|opengraph)$/i.test(field.key)) {
      for (const inner of field.fields) out.push({ path: [field.key, inner.key], field: inner });
    }
  }
  return out;
}

export function mapRoles(collection: Collection): RoleMap {
  const pool = candidates(collection);
  const used = new Set<string>();
  const map: RoleMap = {};
  const claim = (role: Role, ref: FieldRef, extra: { inverse?: boolean } = {}) => {
    map[role] = { ...ref, ...extra };
    used.add(ref.path.join("."));
  };
  // The collection's own declarations come first: they are what the site's list view uses.
  const declared: Array<[Role, string | undefined]> = [
    ["title", collection.titleField],
    ["date", collection.dateField],
    ["image", collection.imageField],
    ["draft", collection.draftField],
  ];

  for (const [role, key] of declared) {
    const ref = key ? pool.find((entry) => entry.path.length === 1 && entry.path[0] === key) : undefined;

    if (ref && typeFits(role, ref.field)) claim(role, ref, role === "draft" && norm(key!) === "published" ? { inverse: true } : {});
  }
  for (const role of ORDER) {
    if (map[role]) continue;
    for (const name of NAMES[role]) {
      const ref = pool.find((entry) => !used.has(entry.path.join(".")) && (name.includes(".") ? norm(entry.path.join(".")) === name.replace(/[^a-z.]/g, "") : entry.path.length === 1 && norm(entry.path[0]!) === name));

      if (!ref || !typeFits(role, ref.field)) continue;
      // "published" as a boolean means the opposite of draft; "published" as a date is the date.
      if (role === "draft" && ref.field.type === "boolean" && norm(ref.path[ref.path.length - 1]!) === "published") claim(role, ref, { inverse: true });
      else if (role === "draft" && ref.field.type === "boolean" && /^(status)$/.test(norm(ref.path[0]!))) continue;
      else claim(role, ref);
      break;
    }
  }
  // An image object with its own alt key takes the alt there.
  return map;
}

export const ROLE_WORDS: Record<Role, string> = {
  title: "the title",
  seoTitle: "the SEO title",
  description: "the SEO description, else the excerpt, else the opening paragraph",
  seoDescription: "the SEO description",
  excerpt: "the excerpt",
  date: "the publication date",
  updated: "the date it was last changed",
  author: "the author",
  tags: "the tags",
  categories: "the categories",
  image: "the featured image",
  imageAlt: "the featured image's alt text",
  draft: "whether it was published",
  canonical: "the canonical address set in the SEO plugin",
  noindex: "the SEO plugin's “hide from search engines” setting",
  slug: "the slug",
};

/** Required top-level fields the roles don't cover. */
export function uncoveredRequired(collection: Collection, roles: RoleMap, contentField: string | null): Field[] {
  const covered = new Set(Object.values(roles).map((ref) => ref!.path[0]));

  return collection.fields.filter((field) => field.required && !field.hidden && field.default === undefined && !covered.has(field.key) && field.key !== contentField && field.type !== "blocks");
}

/** Sets a value at a path inside entry data, creating nested objects as needed. */
export function setPath(data: Record<string, unknown>, path: string[], value: unknown): void {
  let target = data;

  for (const key of path.slice(0, -1)) {
    if (!target[key] || typeof target[key] !== "object") target[key] = {};
    target = target[key] as Record<string, unknown>;
  }
  target[path[path.length - 1]!] = value;
}
