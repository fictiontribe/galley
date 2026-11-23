/**
 * The importer's data model.
 *
 * Both ways in (the REST API of a live site and an export file) produce the
 * same `WordPressSite`; everything after reading — planning, converting,
 * writing, reporting — works on that one shape, so neither source has code
 * paths of its own past `source/`.
 */
import type { JsonValue } from "@galley/core/types";

// ─────────────────────────────────────────────────────────────── source model

export type WordPressStatus = "publish" | "draft" | "pending" | "private" | "future" | "trash" | "inherit" | "auto-draft";

/** Which page builder made an item, when one did. */
export type BuilderName = "elementor" | "divi" | "wpbakery" | "beaver";

export interface WordPressSeo {
  title?: string;
  description?: string;
  canonical?: string;
  noindex?: boolean;
  /** The plugin the values came from. */
  plugin?: "yoast" | "rank-math" | "aioseo";
}

export interface WordPressItem {
  id: number;
  /** "post", "page", or a custom post type's slug. */
  type: string;
  /** As WordPress stores it, percent-decoded. May be empty for drafts. */
  slug: string;
  /** Plain text, entities decoded. */
  title: string;
  status: WordPressStatus;
  /** ISO 8601 in UTC when the source gave a GMT date, else the site's local time without an offset. */
  date: string;
  /** The publication date in the site's own time zone ("2024-05-03T10:15:00"), for date-only fields. */
  dateLocal?: string;
  modified?: string;
  /** The public permalink, absolute. */
  link: string;
  parentId?: number;
  menuOrder?: number;
  authorId?: number;
  /** The author's name when the site keeps its author list private (read from the SEO plugin's details). */
  authorName?: string;
  /** HTML. */
  excerpt: string;
  /** HTML: `content.rendered` from the REST API, raw `post_content` from an export file. */
  content: string;
  /**
   * "rendered": WordPress already ran its filters (shortcodes expanded, blocks
   * rendered, paragraphs added). "raw": straight from the database, as an
   * export file carries it — block comments, shortcodes and bare newlines.
   */
  contentForm: "rendered" | "raw";
  categoryIds: number[];
  tagIds: number[];
  /** Terms of other taxonomies, by taxonomy. */
  otherTerms?: Record<string, number[]>;
  featuredMediaId?: number;
  seo: WordPressSeo;
  builder?: { name: BuilderName; data?: unknown };
  template?: string;
  sticky?: boolean;
  /** The content sits behind a password. */
  passwordProtected?: boolean;
  commentCount?: number;
  /** Yoast's primary category, when set. */
  primaryCategoryId?: number;
}

export interface WordPressMedia {
  id: number;
  /** The full-size file's URL. */
  url: string;
  /** Every other size WordPress generated, so a thumbnail reference resolves to this item. */
  sizes: string[];
  title: string;
  alt: string;
  /** Plain text. */
  caption: string;
  mime: string;
  width?: number;
  height?: number;
  date?: string;
  parentId?: number;
}

export interface WordPressTerm {
  id: number;
  taxonomy: string;
  slug: string;
  name: string;
  parentId?: number;
  link?: string;
}

export interface WordPressAuthor {
  id: number;
  /** Login or nicename. */
  slug: string;
  name: string;
}

/** A content type the source has besides posts and pages. Offered, never imported unless asked for. */
export interface WordPressPostType {
  slug: string;
  name: string;
  count?: number;
  restBase?: string;
}

export interface WordPressSite {
  source: {
    kind: "rest" | "file";
    /** The URL or file path the person gave. */
    input: string;
    apiRoot?: string;
    authenticated: boolean;
  };
  /** The site's public home URL, no trailing slash. */
  siteUrl: string;
  title: string;
  description: string;
  language?: string;
  items: WordPressItem[];
  media: WordPressMedia[];
  terms: WordPressTerm[];
  authors: WordPressAuthor[];
  postTypes: WordPressPostType[];
  /** Reusable blocks (`wp_block`) from an export file, by id — inlined where content refers to them. */
  reusableBlocks: Record<number, string>;
  /** Plugins and features the source shows signs of ("woocommerce", "contact-form-7", "wpml"…). */
  features: string[];
  /** Comments on the content read (counted, never imported). */
  commentCount: number;
  /** Plain-language notes from reading ("The site's list of authors is private, so names come from each post."). */
  notes: string[];
}

export type WordPressSource =
  | { url: string; auth?: { user: string; password: string } }
  | { file: string };

export type ImportKind = "posts" | "pages" | "media";

export interface ReadOptions {
  only?: ImportKind[];
  /** At most this many posts and this many pages. */
  limit?: number;
  /** Only items published or changed on or after this date (YYYY-MM-DD). */
  since?: string;
  /** Custom post types to read as well (by slug). */
  types?: string[];
  /** Where fetched JSON is kept so an interrupted import picks up where it stopped. */
  cacheDir?: string;
  /** Ignore what is cached and fetch again. */
  fresh?: boolean;
  concurrency?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  onProgress?: (event: ProgressEvent) => void;
}

// ─────────────────────────────────────────────────────────────── page outline

export type OutlineItem =
  | { kind: "heading"; level: number; text: string }
  | { kind: "text"; markdown: string }
  | { kind: "image"; src: string; alt: string; caption?: string; href?: string }
  | { kind: "button"; label: string; href: string }
  | { kind: "list"; items: string[]; ordered?: boolean }
  | { kind: "icon"; name?: string }
  /** An icon box, image box or call-out: a small group that belongs together. */
  | { kind: "card"; icon?: string; image?: { src: string; alt: string }; heading?: string; text?: string; link?: { label: string; href: string } }
  | { kind: "quote"; text: string; name?: string; role?: string; image?: string }
  | { kind: "faq"; items: Array<{ question: string; answer: string }> }
  | { kind: "price"; name: string; price: string; period?: string; features: string[]; button?: { label: string; href: string }; featured?: boolean }
  | { kind: "counter"; value: string; label: string }
  | { kind: "gallery"; images: Array<{ src: string; alt: string; caption?: string }> }
  | { kind: "form"; name?: string; fields: string[] }
  | { kind: "embed"; html: string; provider?: string }
  | { kind: "other"; widget: string; text?: string }
  /** A row of columns nested inside a column (an inner section, or child containers). */
  | { kind: "row"; columns: OutlineColumn[] };

export interface OutlineColumn {
  /** Share of the row, 0–100, when the builder records it. */
  width?: number;
  items: OutlineItem[];
}

export interface OutlineSection {
  index: number;
  /** The anchor the builder gave it, when it had one. */
  anchor?: string;
  columns: OutlineColumn[];
  /** Plain descriptions of the layout: "three equal columns each with an icon, a heading and text". */
  hints: string[];
}

export interface PageOutline {
  builder: BuilderName;
  /** Where the structure was read from. */
  from: "elementor-data" | "html" | "shortcodes";
  sections: OutlineSection[];
}

// ─────────────────────────────────────────────────────────────── plan

export interface PlanOptions {
  only?: ImportKind[];
  limit?: number;
  since?: string;
  /** Answers to the plan's questions: which collection takes posts, which takes pages. */
  postsCollection?: string;
  pagesCollection?: string;
  /** Custom post types to import, and the collection each goes into. */
  types?: Record<string, string>;
  /** Values for required fields WordPress has nothing for, by collection then field key. */
  defaults?: Record<string, Record<string, JsonValue>>;
  /** Media directory (repo-relative); defaults to the site's own. */
  mediaDirectory?: string;
  /** Existing entries of the collections that reference fields point into, for matching authors by name. */
  context?: PlanContext;
}

export interface PlanContext {
  /** collection id → entries (slug and title). */
  entries: Record<string, Array<{ slug: string; title: string }>>;
  /** Paths of media the site already has — tells whether it files media by year and month. */
  mediaPaths?: string[];
}

export interface PlanQuestion {
  /** `default:<collection>.<field>` questions are answered with a default value for that field (`--default`). */
  id: "posts-collection" | "pages-collection" | `type:${string}` | `default:${string}`;
  question: string;
  options: Array<{ value: string; label: string }>;
  /** The sensible answer, offered first; the person can take it with one click. */
  default?: string;
}

/** One target field and where its value comes from, in words. */
export interface FieldMapping {
  field: string;
  label: string;
  from: string;
}

export interface CollectionTarget {
  /** The collection id. */
  collection: string;
  label: string;
  fields: FieldMapping[];
  /** How content lands: the markdown body, or a section of the given type. */
  content: { kind: "body" } | { kind: "section"; field: string; blockType: string; textField: string; discriminator: string } | { kind: "none" };
  /** WordPress details the target has no field for ("SEO titles", "categories"). */
  unmapped: string[];
}

export interface MediaRef {
  /** The URL exactly as it appears in the planned content. */
  url: string;
  /** Where it is used: "image" (featured), "body", "link" (a downloadable file). */
  role: "featured" | "body" | "link" | "library";
  alt?: string;
}

export interface PlannedItem {
  sourceId: number;
  sourceType: string;
  kind: "post" | "page";
  title: string;
  status: WordPressStatus;
  oldUrl: string;
  collection: string;
  slug: string;
  /** Predicted repo path. */
  path: string;
  newUrl: string | null;
  /** Field values, with media still at their WordPress URLs (run.ts swaps them). */
  data: { [key: string]: JsonValue };
  body: string;
  /** Field keys holding a media URL to swap, and where to fall back to when the download fails. */
  imageFields: Array<{ field: string; candidates: string[]; required: boolean; altField?: string }>;
  media: MediaRef[];
  /** Fields filled from something other than their natural source, in words ("description from the opening paragraph"). */
  derived: string[];
  /** Hash of everything planned for this item — the import record compares it on the next run. */
  hash: string;
  embeds: number;
  shortcodes: string[];
  builder?: BuilderName;
  outline?: PageOutline;
  /** Things a person should look at, in plain words. */
  notes: string[];
  /** Links to the old site that point at something not imported. */
  externalLinks: string[];
  /** What happened to the SEO plugin's details. */
  seo: { title: "kept" | "not-kept" | null; description: "seo" | "excerpt" | "written" | null; canonical: boolean };
}

export interface SkippedItem {
  sourceId: number;
  title: string;
  kind: string;
  oldUrl: string;
  reason: string;
}

export interface ImportPlan {
  source: { siteUrl: string; title: string; kind: "rest" | "file" };
  siteName: string;
  posts: CollectionTarget | null;
  pages: CollectionTarget | null;
  /** Custom post type slug → target. */
  types: Record<string, CollectionTarget>;
  /** Decisions the plan won't make by itself. Nothing they cover is planned until answered. */
  questions: PlanQuestion[];
  items: PlannedItem[];
  skipped: SkippedItem[];
  /** The media library itself, when `only` includes media. */
  library: MediaRef[];
  mediaDirectory: string;
  /** Whether media keeps WordPress's year/month folders. */
  datedMediaFolders: boolean;
  redirects: Redirect[];
  rebuilds: RebuildBrief[];
  /** Content types the source has that were not asked for. */
  offeredTypes: Array<{ slug: string; name: string; count?: number }>;
  notImported: Array<{ what: string; why: string }>;
  features: FeatureNote[];
}

export interface Redirect {
  from: string;
  to: string;
  /** Title of what moved. */
  title: string;
}

export interface FeatureNote {
  feature: "forms" | "comments" | "e-commerce" | "membership" | "search" | "events" | "multilingual" | "scripts";
  title: string;
  where: string[];
  advice: string;
}

// ─────────────────────────────────────────────────────────────── rebuild

export interface SectionSuggestion {
  /** Index into the outline's sections. */
  section: number;
  /** The target's block type, or null for "no close match". */
  blockType: string | null;
  confidence: "high" | "medium" | "low" | "none";
  reason: string;
  /** Content for the section's fields, read from the outline (no invented text). */
  content?: { [key: string]: JsonValue };
}

export interface RebuildBrief {
  title: string;
  /** The entry the safe import created. */
  path: string;
  url: string | null;
  builder: BuilderName;
  outline: PageOutline;
  suggestions: SectionSuggestion[];
  /** The task for the assistant, in plain words. */
  brief: string;
}

// ─────────────────────────────────────────────────────────────── run & report

export type ProgressEvent =
  | { phase: "read"; label: string; done?: number; total?: number }
  | { phase: "media"; label: string; done: number; total: number }
  /** `kind` says which count this is, so a screen can show "Bringing over posts — 41 of 312". */
  | { phase: "entries"; label: string; done: number; total: number; kind?: "posts" | "pages" }
  | { phase: "finish"; label: string };

export interface RunOptions {
  dryRun?: boolean;
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
  /** Largest single media file to download, in bytes. Default 25 MB (the site's own upload limit). */
  maxFileBytes?: number;
  /** Stop downloading media past this total, in bytes. Default 1 GB. */
  maxTotalBytes?: number;
  /** Write redirect files (`public/_redirects`, and an Astro snippet in the import folder). */
  writeRedirects?: boolean;
  /**
   * Where the redirect files go. "site" (the default): `public/_redirects`
   * plus the Astro snippet. "import-folder": both files beside the import
   * record only, for the app's Redirects screen to take in — so the site's
   * own redirect file is never written behind that screen's back.
   */
  redirectFiles?: "site" | "import-folder";
  concurrency?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export type ItemAction = "created" | "updated" | "unchanged" | "skipped" | "held-back" | "would-create" | "would-update";

export interface ReportItem {
  title: string;
  kind: string;
  action: ItemAction;
  oldUrl: string;
  newUrl: string | null;
  path?: string;
  reason?: string;
  notes: string[];
}

export interface ImportReport {
  dryRun: boolean;
  /** The run was stopped part-way: what is listed arrived and is kept; the rest didn't. */
  stopped?: boolean;
  source: { siteUrl: string; title: string; kind: "rest" | "file" };
  siteName: string;
  counts: {
    posts: Record<"created" | "updated" | "unchanged" | "skipped", number>;
    pages: Record<"created" | "updated" | "unchanged" | "skipped", number>;
    media: { saved: number; reused: number; failed: number; skipped: number; planned: number };
    embeds: number;
  };
  items: ReportItem[];
  needsAttention: {
    shortcodes: Array<{ name: string; count: number; items: string[] }>;
    rebuilds: number;
    media: Array<{ url: string; reason: string; items: string[] }>;
    links: Array<{ url: string; items: string[] }>;
    features: FeatureNote[];
    notes: Array<{ title: string; note: string }>;
    questions: PlanQuestion[];
  };
  notImported: Array<{ what: string; why: string }>;
  offeredTypes: Array<{ slug: string; name: string; count?: number }>;
  seo: { titlesKept: number; titlesNotKept: number; descriptions: number; descriptionsWritten: number; canonicals: number };
  redirects: Redirect[];
  snippets: { astro: string; netlify: string };
  rebuilds: RebuildBrief[];
  /** Files written for the record and redirects. */
  files: string[];
  nextSteps: string[];
}
