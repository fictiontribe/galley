/**
 * Types that only the content layer speaks. The shared domain contract lives
 * in `../types.ts`; these describe intermediate shapes (a parsed document, a
 * body block, the in-memory index) that other modules consume through the
 * functions exported from `content/index.ts`.
 */
import type {
  AgentMode,
  EntrySummary,
  JsonValue,
  ResolveRequest,
  ResolveResult,
  SearchHit,
} from "../types";

export type FrontMatterSyntax = "yaml" | "toml" | "json";

export interface FrontMatterRegion {
  syntax: FrontMatterSyntax;
  /** Offset in the raw text of the first character of the front matter's content. */
  start: number;
  /** Offset just past the content (the closing fence starts here). */
  end: number;
  /** The content between the fences. */
  text: string;
}

export interface ParsedDocument {
  /** Front matter for markdown, the whole document for data files. */
  data: { [key: string]: JsonValue };
  /** Everything after the closing fence, exactly as stored; null for data formats. */
  body: string | null;
  frontMatter?: FrontMatterRegion;
  /** Offset in the raw text where the body begins (raw.length for data formats). */
  bodyStart: number;
  /** Parse problems in plain words. Empty when the document is well formed. */
  errors: string[];
  /**
   * True when a data file's top level is a list. Such files are presented as
   * `{ items: [...] }` so `data` is always an object; edit paths that start
   * with "items" address the list itself.
   */
  rootList?: boolean;
}

export type BodyBlockKind =
  | "heading"
  | "paragraph"
  | "list-item"
  | "code"
  | "quote"
  | "table"
  | "html"
  | "rule";

export interface BodyBlock {
  /** "body.3", or "body.3.1" for the second item of the fourth block. */
  key: string;
  kind: BodyBlockKind;
  /** Heading level 1–6. */
  level?: number;
  /** Offsets relative to the body: [start, end) of `raw`. */
  start: number;
  end: number;
  /** The block's exact source (list items exclude their bullet marker). */
  raw: string;
  /** What a reader sees: inline markdown stripped, heading `#`s removed. */
  text: string;
  /** True when retyping the rendered text in place is lossless. */
  inline: boolean;
  /** Offsets of the editable content inside the block (a heading without its `#`s). */
  contentStart: number;
  contentEnd: number;
  /** Plain label: "Heading 2", "Paragraph", "List item". */
  label: string;
}

export interface SearchOptions {
  collection?: string;
  limit?: number;
}

export interface ResolveOptions {
  /** Source files are only editable in build mode. */
  mode?: AgentMode;
}

/** One in-memory index of every editable string in a site. */
export interface ContentIndex {
  /** Re-index one file from text you hold. `null` means the file was removed. */
  update(path: string, raw: string | null): void;
  search(query: string, options?: SearchOptions): SearchHit[];
  resolve(request: ResolveRequest, options?: ResolveOptions): ResolveResult;
  entryForUrl(urlPath: string): EntrySummary | null;
  /** The title of an entry by collection and slug — how a reference to it is shown. */
  titleOf(collectionId: string, slug: string): string | null;
  routeExists(urlPath: string): boolean;
  /** Number of files indexed (entries, data files and source files). */
  readonly size: number;
}

export interface ValidationContext {
  /** Whether a site URL such as "/images/a.png" exists under a media root. */
  mediaExists(siteUrl: string): boolean;
  /** Whether an internal URL path is served by the site. */
  routeExists(urlPath: string): boolean;
}
