/**
 * Galley domain contract.
 *
 * Every package speaks these types: the engine (`@galley/core`), the HTTP
 * server, the web UI, the in-page overlay and the desktop shell. Keep this file
 * free of runtime code and free of Node/DOM imports so any of them can import
 * it.
 *
 * Vocabulary used throughout the product:
 *   Prompt  — ask for a change in the chat
 *   Proof   — review what changed (visual split + field/file diff)
 *   Publish — commit (and push) the proofed changes
 */

// ─────────────────────────────────────────────────────────────── primitives

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** A path into structured data: ["hero", "title"] or ["sections", 2, "heading"]. */
export type FieldPath = Array<string | number>;

/** Where a change came from — shown in the UI and used for event routing. */
export type ChangeOrigin = "user" | "agent" | "external" | "publish" | "discard" | "undo";

/** How a file differs from the base commit. */
export type ChangeStatus = "clean" | "added" | "modified" | "deleted";

// ─────────────────────────────────────────────────────────────── site model

/** The frameworks Galley ships an adapter for. */
export type KnownFrameworkId =
  | "astro"
  | "eleventy"
  | "hugo"
  | "jekyll"
  | "next"
  | "nuxt"
  | "sveltekit"
  | "docusaurus"
  | "generic";

/**
 * A framework adapter's id. The built-in ids autocomplete; any lowercase id
 * an installed adapter declares ("zola", "lume") is valid too. (`string & {}`
 * keeps the literal members visible to editors instead of collapsing them
 * into plain `string`.)
 */
export type FrameworkId = KnownFrameworkId | (string & {});

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface FrameworkInfo {
  id: FrameworkId;
  /** Display name, e.g. "Astro". */
  name: string;
  version?: string;
}

export type FieldType =
  | "string" // one line
  | "text" // multi-line plain text
  | "markdown" // multi-line, markdown allowed
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "image" // a site image path or URL
  | "url"
  | "color"
  | "select" // one of `options`
  | "tags" // list of short strings
  | "list" // list of `of`
  | "object" // nested `fields`
  | "blocks" // list of objects discriminated by `discriminator` (page sections)
  | "reference" // slug of an entry in `collection`
  | "json"; // anything else — edited as source

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  description?: string;
  /** select: allowed values. tags: suggestions seen in the corpus. */
  options?: string[];
  /** list: the shape of one item. */
  of?: Field;
  /** object: nested fields. */
  fields?: Field[];
  /** blocks: the key that names the block type (`type`, `_component`, `_type`, …). */
  discriminator?: string;
  /** blocks: every block type seen or declared. */
  blocks?: BlockType[];
  /** reference: the collection id it points into. */
  collection?: string;
  /**
   * list, tags, blocks: the fewest and most items the site's schema allows
   * (zod's `.min()`, `.max()`, `.length()`, `.nonempty()`); number: the
   * smallest and largest value. A new section starts within them, since a
   * list one item short fails the schema and the page with it.
   */
  min?: number;
  max?: number;
  default?: JsonValue;
  /** Up to three real values from the corpus — shown as placeholders, given to the AI. */
  examples?: JsonValue[];
  /**
   * The site itself declared `examples` (galley.config.json, or zod's
   * `.meta({ examples })`), rather than Galley reading them from the files:
   * a new section may start with the first one where a blank wouldn't draw.
   */
  examplesDeclared?: boolean;
  /** Where this definition came from. Config beats schema beats inference. */
  source: "config" | "schema" | "inferred";
  /** Hidden from the form (still preserved in the file). */
  hidden?: boolean;
  /**
   * A plugin data source the value is picked from (its id, e.g.
   * "shopify-products"). The file keeps a plain string; the app offers a
   * picker that searches the source. Set in galley.config.json.
   */
  dataSource?: string;
}

/** One real instance of a block type (BlockType.samples). */
export interface BlockSample {
  /** Repo-relative path of the entry it is on. */
  path: string;
  /** That entry's title, for "from the “Home” page". */
  title: string;
  value: { [key: string]: JsonValue };
}

/** One kind of block in a blocks field — a hero, a feature grid, a CTA. */
export interface BlockType {
  /** The discriminator value, e.g. "hero". */
  type: string;
  label: string;
  description?: string;
  fields: Field[];
  /** How many times it appears in the corpus. */
  count: number;
  /** The most complete real instance — the scaffold for "add section". */
  example?: { [key: string]: JsonValue };
  /** `example` was declared in galley.config.json, not read from the files. */
  exampleDeclared?: boolean;
  /**
   * Real instances of this block in the collection's files, at most one per
   * entry (its most complete) and a few entries, each with the entry it is
   * on: values a new section can start with where a blank wouldn't draw
   * (a picture, a video), and where to say they came from.
   */
  samples?: BlockSample[];
  /**
   * Repo-relative path of a picture of this block (declared in
   * galley.config.json), shown in the section palette. Absent → the palette
   * falls back to the label and field summary.
   */
  thumbnail?: string;
}

/**
 * A ready-made entry to start from ("Landing page", "Pricing page"): a normal
 * content file kept outside the collection, declared in galley.config.json.
 * Creating from a template copies its data and body into the new entry.
 */
export interface EntryTemplate {
  id: string;
  label: string;
  description?: string;
  /** The collection the new entry is created in. */
  collection: string;
  /** Repo-relative path of the template file (same format as the collection's entries). */
  file: string;
  /** Repo-relative path of a picture of the finished page. */
  thumbnail?: string;
}

export type EntryFormat = "markdown" | "mdx" | "json" | "yaml" | "toml";

export interface Collection {
  id: string;
  /** Plural, e.g. "Blog posts". */
  label: string;
  /** Singular, e.g. "blog post". */
  singular: string;
  description?: string;
  /**
   * "entries": one file per item under `path`.
   * "data": a single data file at `path` (settings, navigation, a list of records).
   */
  kind: "entries" | "data";
  /** Repo-relative directory (entries) or file (data). POSIX separators. */
  path: string;
  /** entries: glob relative to `path`, e.g. "**\/*.{md,mdx}". */
  pattern?: string;
  format: EntryFormat;
  /** Whether items carry a markdown body below the front matter. */
  body: boolean;
  /** Public URL pattern with {slug}, e.g. "/blog/{slug}/". null = no page of its own. */
  url: string | null;
  fields: Field[];
  /** Field keys the list view relies on. */
  titleField?: string;
  dateField?: string;
  imageField?: string;
  draftField?: string;
  /** Whether new items may be created from the app. */
  create: boolean;
  /** Number of items on disk. */
  count: number;
  /** Hidden from navigation (config: { hidden: true }). */
  hidden?: boolean;
  source: "config" | "schema" | "inferred";
  /**
   * Set when the collection holds site-kit files — "forms" (one form per
   * file) or "scripts" (the scripts setup) — recognised by the kit's schema
   * in the site's content config or by the files' own shape. Such files are
   * described and validated with the kit's schema (src/site-kit/).
   */
  kit?: "forms" | "scripts";
}

export interface MediaConfig {
  /** Repo-relative directory new images are written to, e.g. "public/images". */
  dir: string;
  /** The URL prefix that directory is served from, e.g. "/images". */
  publicPath: string;
  /** Every directory scanned for the library (always includes `dir`). */
  roots: Array<{ dir: string; publicPath: string }>;
}

export type PublishMode = "commit" | "pull-request";

export interface PublishConfig {
  /** Branch that publishes land on. Defaults to the checked-out branch. */
  branch: string;
  mode: PublishMode;
  /** Git remote to push to, when one exists. */
  remote: string | null;
  /** Push after committing. */
  push: boolean;
}

export interface AiConfig {
  /** Repo-relative files appended to the assistant's instructions (brand voice, style guide). */
  instructions: string[];
  /** Whether build mode (editing components, layouts, styles) is offered on this site. */
  allowBuild: boolean;
}

/** Path globs (repo-relative) the app may write. Everything else is read-only. */
export interface WritableConfig {
  /** Content mode: content files and media. */
  content: string[];
  /** Build mode: additionally source files. */
  build: string[];
}

/** Everything Galley knows about a site: detection merged with galley.config.json. */
export interface SiteModel {
  name: string;
  framework: FrameworkInfo;
  packageManager: PackageManager | null;
  /** Whether dependencies look installed (node_modules present). */
  installed: boolean;
  dev: {
    command: string;
    port: number | null;
    /**
     * How the dev command is told which port to use, with "{port}" standing
     * for the number (Astro: ["--port", "{port}"]). Absent when the adapter
     * doesn't say, or the command is a custom one it can't vouch for.
     */
    portArgs?: string[];
  } | null;
  build: { command: string; outDir: string } | null;
  collections: Collection[];
  media: MediaConfig;
  /**
   * Repo-relative folder of the site's file-based routes (pages written as
   * code, Astro's `src/pages`), when its adapter reports one.
   */
  routesDir?: string;
  urls: { production?: string; staging?: string };
  publish: PublishConfig;
  ai: AiConfig;
  writable: WritableConfig;
  /** Ready-made entries people can start from, declared in galley.config.json. */
  templates?: EntryTemplate[];
  /** Human-readable notes from detection ("Found 4 collections in src/content.config.ts"). */
  notes: string[];
  /**
   * Extra environment variables the framework's adapter asks for when the
   * site's own commands (dev server, build) run. Absent when it asks for none.
   */
  environment?: Record<string, string>;
  /**
   * Files the framework's dev server saves between runs and trusts on its
   * next start (the adapter's `forgetPreviewSaves`), site-relative. They are
   * removed before the preview starts on newer versions. Absent when it saves none.
   */
  previewSaves?: string[];
  /** Where the site is put online (galley.config.json `deploy`). Absent until it has been set up. */
  deploy?: DeployConfig;
  /** The redirects list and where it takes effect (galley.config.json `redirects`). Absent until set. */
  redirects?: RedirectsConfig;
  /** The site kit (forms, managed scripts), when the site has it. */
  kit?: SiteKitInfo;
}

/** The site kit as detection found it in a site. */
export interface SiteKitInfo {
  /** "vendored": the kit's files are in the site (src/galley/); "package": the site depends on @galley/astro. */
  source: "vendored" | "package";
  /** The kit version the files say they came from. */
  version?: string;
  /** Whether a form may run custom code on the site's pages (`forms.allowFormScripts`). */
  allowFormScripts: boolean;
}

/**
 * galley.config.json — optional, lives at the repo root, committed with the
 * site. Everything is optional: whatever is absent comes from detection.
 * Collections and fields merge by id/key, so a config can correct one label
 * without restating the rest.
 */
export interface GalleyConfig {
  $schema?: string;
  name?: string;
  framework?: FrameworkId;
  /**
   * Adapters to load from the site itself, before the built-in ones: package
   * names (resolved from the site's node_modules) or paths to files inside
   * the site ("./tools/my-adapter.mjs"). Only what is listed here is loaded.
   */
  adapters?: string[];
  /**
   * Plugins to load from the site itself: package names (from the site's
   * node_modules) or paths to files inside it ("./tools/plugin.mjs"). Same
   * trust as `adapters`: this runs the site's own code inside the app, only
   * what is listed, and never when site plugins are turned off.
   */
  plugins?: string[];
  dev?: { command?: string; port?: number };
  build?: { command?: string; outDir?: string };
  urls?: { production?: string; staging?: string };
  media?: { dir?: string; publicPath?: string; roots?: Array<{ dir: string; publicPath: string }> };
  publish?: Partial<PublishConfig>;
  ai?: Partial<AiConfig>;
  writable?: Partial<WritableConfig>;
  collections?: CollectionConfig[];
  templates?: EntryTemplate[];
  /** Where the site is put online. Ids only — the access key lives in the app's secrets, never here. */
  deploy?: DeployConfig;
  /** Where the redirects list lives and which host applies it. See docs/redirects.md. */
  redirects?: RedirectsConfig;
  /**
   * The site's own brand (its look and voice), not the app's white-label
   * brand. `dir`: where brand.json, guide.md and sources/ live (default
   * "galley/brand"). `largeFileMB`: added material above this size stays in
   * the app's own folder for the site instead of the repository (default 10).
   * `tokensFile`: the stylesheet "Apply to the site" edits, when detection
   * picks the wrong one. See docs/brand.md.
   */
  siteBrand?: { dir?: string; largeFileMB?: number; tokensFile?: string };
  /**
   * Where this site's editor is hosted online, when it has one ("Host the
   * editor online"). An address and the host's id — no secrets, safe to
   * publish with the site. See docs/cloud-install.md.
   */
  editor?: import("./hosting/types").EditorConfig;
}

/**
 * galley.config.json `redirects`. The list itself is a file in the site
 * (`file`); the host's own redirect file is generated from it. The host comes
 * from `deploy.target` when one-click deploy is set up, otherwise from `host`.
 */
export interface RedirectsConfig {
  /** Repo-relative path of the list. Default: beside the site's data files (src/data/redirects.json). */
  file?: string;
  /** Where the site is served from, when `deploy` doesn't say. "other": no file is generated. */
  host?: "cloudflare" | "netlify" | "vercel" | "other";
  /** Setting the redirects on Cloudflare itself (Bulk Redirects). Ids only. */
  cloudflare?: {
    /** The account id, when `deploy` doesn't give one. */
    account?: string;
    /** The site's own domains the redirects apply on ("example.com", "www.example.com"). */
    hostnames?: string[];
  };
}

export interface CollectionConfig {
  id: string;
  label?: string;
  singular?: string;
  description?: string;
  kind?: "entries" | "data";
  path?: string;
  pattern?: string;
  format?: EntryFormat;
  body?: boolean;
  url?: string | null;
  titleField?: string;
  dateField?: string;
  imageField?: string;
  draftField?: string;
  create?: boolean;
  hidden?: boolean;
  fields?: FieldConfig[];
}

export type FieldConfig = Partial<Omit<Field, "source" | "of" | "fields" | "blocks">> & {
  key: string;
  of?: FieldConfig;
  fields?: FieldConfig[];
  blocks?: Array<Partial<Omit<BlockType, "fields">> & { type: string; fields?: FieldConfig[] }>;
};

// ─────────────────────────────────────────────────────────────── content

export interface EntrySummary {
  /** Repo-relative path — the entry's identity everywhere. */
  path: string;
  collection: string;
  /** Path within the collection, extension stripped: "2026/launch-notes". */
  slug: string;
  title: string;
  /** Where the title came from; "filename" titles are approximations. */
  titleSource: "field" | "heading" | "filename";
  date?: string;
  /** From an `author`-like field, when the collection has one. */
  author?: string;
  image?: string;
  draft?: boolean;
  /** Public URL path, when the collection has pages. */
  url: string | null;
  status: ChangeStatus;
  /** File mtime, epoch ms. */
  modifiedAt: number;
}

export interface Entry extends EntrySummary {
  format: EntryFormat;
  /** Parsed front matter (or the whole document for data files). */
  data: { [key: string]: JsonValue };
  /** Markdown body; null when the format has none. */
  body: string | null;
  /** The exact file text. */
  raw: string;
  /** Content hash of `raw` — send back as `baseHash` to detect concurrent edits. */
  hash: string;
  /** The collection's fields, plus any keys this entry carries that the schema lacks. */
  fields: Field[];
  issues: ValidationIssue[];
}

export interface EntryQuery {
  search?: string;
  status?: ChangeStatus;
  sort?: "title" | "date" | "modified";
  order?: "asc" | "desc";
  offset?: number;
  limit?: number;
}

export interface EntryList {
  collection: string;
  total: number;
  items: EntrySummary[];
}

/**
 * One edit to an entry. Edits are format-preserving: a scalar `set` splices the
 * new value into the source at the old value's byte range, so every other byte
 * of the file — comments, quoting, folded scalars, key order — is untouched.
 */
export type EditOp =
  | { op: "set"; path: FieldPath; value: JsonValue }
  | { op: "unset"; path: FieldPath }
  /** Insert into a list at `index` (index === length appends). */
  | { op: "insert"; path: FieldPath; index: number; value: JsonValue }
  | { op: "move"; path: FieldPath; from: number; to: number }
  | { op: "remove"; path: FieldPath; index: number }
  /** Replace the whole markdown body. */
  | { op: "body"; value: string }
  /** Replace text inside the body. Refused when `find` is absent, or ambiguous without `all`. */
  | { op: "body-replace"; find: string; replace: string; all?: boolean }
  /** Replace the whole file (source view). */
  | { op: "raw"; value: string };

export interface EditRefusal {
  index: number;
  op: EditOp;
  reason: string;
}

export interface EditResult {
  entry: Entry;
  /** How many ops changed the file. */
  applied: number;
  refused: EditRefusal[];
}

export interface CreateEntryInput {
  collection: string;
  /** Lowercase words joined by hyphens; may contain "/" for nested entries. */
  slug: string;
  /** Values for the new entry; laid over the template's when `template` is given. */
  data: { [key: string]: JsonValue };
  body?: string;
  /** Id of an `EntryTemplate` to start from. */
  template?: string;
}

export interface ValidationIssue {
  severity: "error" | "warning";
  /** Stable machine code, e.g. "required", "type", "enum", "broken-image", "broken-link". */
  code: string;
  message: string;
  path?: string;
  field?: FieldPath;
}

export interface SearchHit {
  path: string;
  collection: string;
  title: string;
  url: string | null;
  /** Where the text was found. */
  location: SourceLocation;
  /** Text around the match, match included. */
  excerpt: string;
}

export type SourceLocation =
  | { kind: "field"; field: FieldPath; label: string }
  | { kind: "body"; start: number; end: number; block: string }
  | { kind: "source"; line: number; column: number };

// ─────────────────────────────────────────────────────── click-to-edit resolve

/** "The visitor clicked this text on this page — where does it live in the repo?" */
export interface ResolveRequest {
  /**
   * Path of the page being previewed, e.g. "/pricing/" ("/" is the home
   * page). Empty when no page is known: no entry is favoured, the whole site
   * is searched alike.
   */
  urlPath: string;
  /** The element's visible text, whitespace-collapsed. */
  text: string;
  /** Which same-text element was clicked, in document order (0-based). */
  occurrence?: number;
  /** How many elements on the page show that exact text. */
  total?: number;
}

export interface SourceMatch {
  path: string;
  collection?: string;
  title?: string;
  location: SourceLocation;
  /** The value exactly as stored. */
  value: string;
  /** True when the stored value equals the visible text, so retyping in place is lossless. */
  plain: boolean;
  /** False for source files while in content mode. */
  editable: boolean;
}

/**
 * Resolution never guesses. "unique" carries exactly one match and is safe to
 * edit in place; "ambiguous" lists candidates for the user to choose from;
 * "none" means the text is not in any content file (it may be hard-coded or
 * computed) and the UI should hand the request to chat instead.
 */
export interface ResolveResult {
  status: "unique" | "ambiguous" | "none";
  matches: SourceMatch[];
  reason?: string;
}

// ─────────────────────────────────────────────────────────────── changes

export type ChangeKind = "content" | "media" | "code" | "config" | "other";

export interface FieldChange {
  field: FieldPath;
  /** "Hero › Heading" */
  label: string;
  /** "moved": a list item that is the same but sits elsewhere; `field` is where it is now. */
  kind: "added" | "removed" | "changed" | "moved";
  before?: JsonValue;
  after?: JsonValue;
  /** For "moved": the item's 0-based position in the published list and in the list now. */
  from?: number;
  to?: number;
}

export interface FileChange {
  path: string;
  status: Exclude<ChangeStatus, "clean">;
  kind: ChangeKind;
  binary: boolean;
  additions: number;
  deletions: number;
  collection?: string;
  /** Entry title when the file is a content entry. */
  title?: string;
  /** Preview URL path for this file's page, when it has one. */
  url?: string | null;
  /** Front-matter/data changes in plain terms. Present for content entries. */
  fieldChanges?: FieldChange[];
  bodyChanged?: boolean;
  /** For images: what the file is now (absent when it was deleted). */
  media?: { type: string; size: number; width?: number; height?: number };
  /** One plain-language line: "Changed the heading and 2 other fields". */
  summary: string;
}

/** Everything that differs between the working tree and the last commit. */
export interface ChangeSet {
  branch: string;
  baseCommit: string | null;
  files: FileChange[];
  totals: { files: number; additions: number; deletions: number };
}

export interface DiffLine {
  type: "context" | "add" | "del";
  text: string;
  oldNumber?: number;
  newNumber?: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  status: Exclude<ChangeStatus, "clean">;
  binary: boolean;
  before: string | null;
  after: string | null;
  hunks: DiffHunk[];
  /** For images: URLs (served by the API) of the two versions. */
  beforeMediaUrl?: string;
  afterMediaUrl?: string;
}

export interface PublishRequest {
  /** Commit message; generated from the change summary when absent. */
  message?: string;
  /** Publish only these paths; default is everything pending. */
  paths?: string[];
  mode?: PublishMode;
}

export interface PublishResult {
  ok: boolean;
  commit?: string;
  branch?: string;
  files: string[];
  pushed: boolean;
  /** Set when the commit succeeded locally but the push did not. */
  pushError?: string;
  pullRequestUrl?: string;
  error?: string;
  /** Technical detail behind `error`/`pushError` (a failing check's output, the code host's reply) — for an expandable "details" view. */
  detail?: string;
  /** What plugins' publish checks warned about. The publish went ahead regardless. */
  warnings?: PublishWarning[];
  /**
   * Nothing was published because the code host has newer versions than this
   * copy: getting them (POST …/pull) first lets the publish go through.
   */
  behind?: boolean;
}

/** One plugin's warning about a publish: shown in Proof and the Publish dialog, never a stop. */
export interface PublishWarning {
  /** The plugin's name as people read it ("Shopify"). */
  plugin: string;
  message: string;
}

/** What the plugins' publish checks say about the pending changes, before anything is published. */
export interface PublishCheck {
  warnings: PublishWarning[];
  /** The first plugin that would stop this publish, and why; null when none would. */
  refusal: PublishWarning | null;
}

export interface HistoryEntry {
  commit: string;
  shortCommit: string;
  message: string;
  author: string;
  email: string;
  /** ISO 8601. */
  date: string;
  files: string[];
  /** Whether Galley made this commit (it carries a `Galley-Publish` trailer). */
  viaGalley: boolean;
}

export interface GitStatus {
  branch: string;
  detached: boolean;
  hasRemote: boolean;
  remote?: string;
  remoteUrl?: string;
  ahead: number;
  behind: number;
  /** No pending changes in the working tree. */
  clean: boolean;
  lastCommit?: { commit: string; message: string; date: string; author: string };
  /**
   * Who the next publish is recorded as, and which setting chose it: this
   * site's own author, the repository's own git settings, App settings › You,
   * the computer's git identity, or a neutral default. On a hosted install
   * it is the signed-in person ("account"), ahead of all of those.
   */
  author?: { name: string; email: string; from: "site" | "repository" | "app" | "machine" | "default" | "account" };
  /**
   * When this copy last heard from the code host (ISO 8601): a look
   * (POST …/git/check), Get latest, or a hosted editor's own round. `ahead`
   * and `behind` are as of then. null: not since this editor started.
   * Absent from answers that don't say.
   */
  checkedAt?: string | null;
  /**
   * The newest look couldn't reach the code host: one plain sentence why
   * (offline, the key was refused…). `checkedAt` is then the last look that
   * worked. Absent when the newest look worked.
   */
  checkProblem?: string;
  /**
   * Newer versions are waiting (`behind` > 0) but can't be brought in as
   * they are: files with unpublished changes here that they change too
   * (`paths`, site-relative), or published versions here the code host
   * doesn't have ("separate-ways"). `message` says what to do, in plain words.
   */
  inTheWay?: { kind: "changes" | "separate-ways"; message: string; paths: string[] };
}

/** What one look at the code host that may bring newer versions in did (SiteService.catchUp). */
export interface CatchUpResult {
  /** Versions brought in: 0 when there were none, or something was in the way, or the look failed. */
  brought: number;
  /** Files those versions changed, site-relative. */
  paths: string[];
  status: GitStatus;
}

// ─────────────────────────────────────────────────────────────── preview

export type PreviewState = "idle" | "installing" | "starting" | "ready" | "error" | "stopped";

export interface PreviewStatus {
  state: PreviewState;
  /**
   * Origin of the preview proxy (e.g. "http://127.0.0.1:4611"). The proxy
   * fronts the site's own dev server, strips frame-blocking headers and
   * injects the overlay script. null until ready.
   */
  url: string | null;
  /** Origin of the baseline proxy fronting the deployed site, when one is configured. */
  baselineUrl: string | null;
  baselineSource: "staging" | "production" | null;
  /** Plain-language status or error. */
  detail?: string;
  /** Tail of the dev server's output. */
  log: string[];
  startedAt?: number;
  /**
   * Multi-site: the preview was stopped to save the computer's memory — it
   * sat unused ("idle") or more previews were running than the limit allows
   * ("limit"). The state is "idle", so coming back starts it again.
   */
  paused?: PreviewPause;
}

export type PreviewPause = "idle" | "limit";

export interface BuildResult {
  ok: boolean;
  /** Combined stdout/stderr, tail-trimmed. */
  output: string;
  durationMs: number;
}

/**
 * Messages between the web app and the overlay script injected into previewed
 * pages (window.postMessage). Every message carries `galley: 1` so unrelated
 * postMessage traffic is ignored.
 */
export interface OverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One section of the page as the host knows it from the entry, so the overlay
 * can find it on the page (Arrange mode). `texts` and `images` are evidence
 * for pages without `data-galley-block` markers: strings (markdown stripped,
 * whitespace collapsed) and image addresses that only this section holds.
 */
export interface OverlaySection {
  /** Position in its blocks field. */
  index: number;
  /** The discriminator value, e.g. "hero". */
  type: string;
  /** The section type's label, e.g. "Hero". */
  label: string;
  texts: string[];
  images: string[];
}

/** The sections of one blocks field of the entry, in content order. */
export interface OverlaySectionList {
  /** The blocks field's key, e.g. "sections" (markers read `<field>.<index>`). */
  field: string;
  sections: OverlaySection[];
}

/**
 * Why Arrange was declined (`arrange-status`), so the host can say the true
 * reason: `unmarked` — the page drew, carries no section markers, and its
 * sections can't be told apart by their words; `mismatch` — the page marks
 * sections but they don't match the content (or only some are marked);
 * `page-failed` — the preview answered this page with an error, so there are
 * no sections to find; `page-missing` — the preview has no page at this
 * address; `preview-unavailable` — the preview itself didn't answer (it is
 * starting or restarting). Absent from older overlays.
 */
export type ArrangeDeclineCause = "unmarked" | "mismatch" | "page-failed" | "page-missing" | "preview-unavailable";

/**
 * Whether a page in the preview was drawn (`page-state`). `failed`: the dev
 * server answered with an error (`status` 500 or more) or the framework's
 * error overlay is showing; `message` is the framework's own first line about
 * why, for Technical details. `missing`: the dev server has no page here
 * (`status` 404). `unavailable`: the preview proxy answered because the dev
 * server didn't. `drawn`: none of these.
 */
export interface PageDrawState {
  state: "drawn" | "failed" | "missing" | "unavailable";
  /** The HTTP status the page came with, when the proxy passed it on. */
  status: number | null;
  /** One line, at most 300 characters. */
  message: string | null;
}

/** What the person asked to do to a section on the page, in Arrange mode. */
export type ArrangeRequest =
  /** Dragged on the page: `to` is the section's final position. */
  | { action: "move"; field: string; index: number; to: number }
  /** One place up or down from the keyboard (Alt+↑/↓ or the toolbar), relative to the host's selection. */
  | { action: "step"; field: string; index: number; delta: -1 | 1 }
  /** `add`: the ＋ at gap `index` (0 = before the first section). `undo`: the last arrange action. */
  | { action: "duplicate" | "remove" | "edit" | "options" | "add" | "undo"; field: string; index: number };

export type OverlayToHost =
  | { galley: 1; type: "ready"; path: string; title: string }
  | { galley: 1; type: "navigate"; path: string; title: string }
  | {
      galley: 1;
      type: "select";
      text: string;
      tag: string;
      occurrence: number;
      total: number;
      rect: OverlayRect;
    }
  | { galley: 1; type: "select-image"; src: string; alt: string; rect: OverlayRect }
  /** The user retyped an element in place and confirmed. */
  | { galley: 1; type: "edit"; text: string; newText: string; occurrence: number; total: number }
  /**
   * The user left an in-place edit without keeping it (Escape, or nothing
   * changed). Hosts should also treat an `edit` whose `newText` equals
   * `text` as a cancel, which older overlays sent instead.
   */
  | { galley: 1; type: "edit-cancelled"; text: string; occurrence: number }
  | { galley: 1; type: "scroll"; y: number }
  /**
   * Arrange mode: whether the page's sections were found. `mapped` — every
   * section resolved to its own element (by markers or by evidence);
   * `waiting` — the page doesn't match the content yet (it is reloading);
   * `declined` — they can't be told apart, so arranging on the page isn't
   * offered. `revision` echoes the `arrange` message it answers.
   */
  | { galley: 1; type: "arrange-status"; status: "mapped" | "waiting" | "declined"; how: "markers" | "evidence" | null; reason: string | null; revision: number; cause?: ArrangeDeclineCause }
  /**
   * Whether the page in the frame could be drawn (PageDrawState). Sent after
   * `ready` whenever the page isn't simply drawn, and again when the
   * framework's own message about it arrives or its error clears. Hosts that
   * don't know it ignore it; a host that never hears it can take the page as
   * drawn.
   */
  | ({ galley: 1; type: "page-state" } & PageDrawState)
  /** Arrange mode: the person selected a section on the page (`<field>.<index>`), or none. */
  | { galley: 1; type: "arrange-select"; key: string | null }
  | ({ galley: 1; type: "arrange-action" } & ArrangeRequest)
  /** While the host is placing a new section: the gap under the pointer, or null when there is none. */
  | { galley: 1; type: "placing-at"; field: string | null; index: number | null }
  /** Put the section being placed at gap `index` of `field` (a drop, or a click on an insertion line). */
  | { galley: 1; type: "place"; field: string; index: number }
  /** The answer to `measure`: what the current page really uses (packages/overlay/src/measure.ts). `id` echoes the request. */
  | { galley: 1; type: "measure-result"; id: string; summary: import("./sitebrand/types").MeasureSummary };

/**
 * Not from the overlay: the page a hosted install's preview address shows in
 * place of the site when the frame's browser isn't let in (no viewer cookie,
 * or its sign-in ended). Sent to the editor's origin only; the editor answers
 * by loading the frame through a fresh entry address.
 */
export interface PreviewSignInNeeded {
  galley: 1;
  type: "sign-in-needed";
}

export type HostToOverlay =
  | { galley: 1; type: "mode"; edit: boolean }
  /** Let the element identified by a prior `select` be retyped in place (resolution was unique and plain). */
  | { galley: 1; type: "begin-edit"; text: string; occurrence: number }
  | { galley: 1; type: "cancel-edit" }
  | { galley: 1; type: "scroll"; y: number }
  | { galley: 1; type: "highlight"; text: string; occurrence?: number }
  | { galley: 1; type: "reload" }
  /**
   * A save of an in-place edit was refused: put back the text the element
   * showed before it was retyped (`text`), where it now shows `newText`.
   * Overlays that don't know this message ignore it; hosts may follow with
   * `reload` for them.
   */
  | { galley: 1; type: "restore-text"; text: string; newText: string; occurrence: number }
  /**
   * The app's look, so outlines and the "Click to edit" tag match a
   * re-branded deployment: `accent` is a hex colour, `theme` the app's
   * resolved light or dark mode. Sent after `ready` and whenever it changes.
   */
  | { galley: 1; type: "appearance"; accent: string; theme: "light" | "dark" }
  /**
   * Arrange mode on or off, and everything it needs: the entry's sections,
   * whether they may be changed (`editable` false hides the handles), the
   * selected section (`<field>.<index>`, the host's truth), and `settling`
   * while an edit is on its way to the page (the chrome waits). `revision`
   * grows whenever `lists` change. `reveal` scrolls the selection into view.
   */
  | {
      galley: 1;
      type: "arrange";
      on: boolean;
      lists: OverlaySectionList[];
      editable: boolean;
      selected: string | null;
      settling: boolean;
      revision: number;
      reveal: boolean;
    }
  /**
   * The host is placing a new section (picked in the palette): the overlay
   * lights up the insertion lines of `field`; `label` names what is placed.
   * `label: null` ends it.
   */
  | { galley: 1; type: "placing"; field: string | null; label: string | null }
  /**
   * The host is dragging a palette card over the frame: the pointer in the
   * frame's own coordinates (CSS pixels from its top-left), or null when it
   * left the frame. The overlay answers with `placing-at`.
   */
  | { galley: 1; type: "placing-pointer"; point: { x: number; y: number } | null }
  /** The drag ended over the frame: the overlay answers with `place` for the gap it showed, or nothing. */
  | { galley: 1; type: "placing-drop" }
  /**
   * Read-only: sample the current page's computed styles and answer with
   * `measure-result` (same `id`). Edit role only. Overlays that don't know it
   * stay silent, so hosts time out rather than wait.
   */
  | { galley: 1; type: "measure"; id: string };

// ─────────────────────────────────────────────────────────────── media

export interface MediaItem {
  /** Repo-relative path. */
  path: string;
  /** Site URL, e.g. "/images/team/ana.webp". */
  url: string;
  name: string;
  size: number;
  /** MIME type. */
  type: string;
  width?: number;
  height?: number;
  modifiedAt: number;
  status: ChangeStatus;
}

export type ImageAspect = "1:1" | "16:9" | "4:3" | "3:2" | "9:16" | "3:4" | "2:3";

export interface ImageGenRequest {
  prompt: string;
  provider?: string;
  model?: string;
  aspect?: ImageAspect;
  /** 1–4. */
  count?: number;
  /** A style direction appended to the prompt ("flat editorial illustration"). */
  style?: string;
  /** Repo paths of images to use as visual references, when the provider supports it. */
  referencePaths?: string[];
  transparent?: boolean;
  /**
   * The site's imagery direction and palette from its brand (galley/brand),
   * appended to the prompt as a brief: "Light: soft daylight. Palette: …".
   */
  brandDirection?: string;
}

/** A generated image held in temporary storage until it is saved or discarded. */
export interface ImageCandidate {
  id: string;
  mime: string;
  width?: number;
  height?: number;
  /** API URL that serves the bytes. */
  previewUrl: string;
  prompt: string;
  provider: string;
  model: string;
}

export interface ImageSaveRequest {
  candidateId: string;
  /** Repo-relative directory inside a media root; defaults to the media dir. */
  directory?: string;
  /** Without extension; derived from the prompt when absent. */
  filename?: string;
}

export interface ImageProviderInfo {
  id: string;
  label: string;
  /** Whether a key is available. The "mock" provider is always configured. */
  configured: boolean;
  /** A model's own `supports…` overrides the provider's; `price` is a plain line when the service publishes one. */
  models: Array<{ id: string; label: string; supportsReferences?: boolean; supportsTransparency?: boolean; price?: string }>;
  defaultModel: string;
  supportsReferences: boolean;
  supportsTransparency: boolean;
  /** The built-in placeholder generator — what is used while no image service is chosen. */
  placeholder?: boolean;
}

export type VideoAspect = "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9";

export interface VideoGenRequest {
  prompt: string;
  provider?: string;
  model?: string;
  aspect?: VideoAspect;
  durationSeconds?: number;
  resolution?: string;
  /** Repo path of a picture the video starts from, when the model takes one. */
  firstFramePath?: string;
  audio?: boolean;
  /** The site's imagery direction from its brand, appended to the prompt as a brief (as for images). */
  brandDirection?: string;
}

/** A generated video held in temporary storage until it is saved or discarded. */
export interface VideoCandidate {
  id: string;
  mime: string;
  size: number;
  /** API URL that serves the bytes. */
  previewUrl: string;
  prompt: string;
  provider: string;
  model: string;
  /** What the service reported it cost, in US dollars, when it says. */
  cost?: number;
}

export interface VideoSaveRequest {
  candidateId: string;
  /** Repo-relative directory inside a media root; defaults to the media dir. */
  directory?: string;
  /** Without extension; derived from the prompt when absent. */
  filename?: string;
}

export interface VideoProviderInfo {
  id: string;
  label: string;
  /** Whether a key is available. */
  configured: boolean;
  models: Array<{ id: string; label: string; durations?: number[]; resolutions?: string[]; aspects?: string[]; supportsFirstFrame?: boolean; audio?: boolean; price?: string }>;
  defaultModel: string;
}

/** A video generation as the app follows it: the job, and the candidates once it is done. */
export interface VideoJobStatus {
  job: Job;
  candidates: VideoCandidate[];
}

// ─────────────────────────────────────────────────────────────── assistant

/**
 * "content": the assistant may change content files and media only.
 * "build":   it may also change source — components, layouts, styles, config —
 *            and run the site's build to check its work.
 */
export type AgentMode = "content" | "build";

export interface ChatAttachment {
  name: string;
  mime: string;
  /** Inbound only: the pasted/dropped file as a data: URL. Never stored on a message. */
  dataUrl?: string;
  /** Where the file was saved in the repo, once staged. */
  path?: string;
  /** Site URL of the saved file. */
  url?: string;
}

/** What the user is looking at when they send a message. */
export interface ChatContext {
  entryPath?: string;
  urlPath?: string;
  /** Text the user selected on the page before asking. */
  selection?: { text: string; sourcePath?: string };
}

export interface ChatOption {
  label: string;
  detail?: string;
}

export interface ToolActivity {
  id: string;
  /** Tool name, e.g. "update_entry". */
  name: string;
  /** Plain-language narration: "Updating the About page". */
  label: string;
  status: "running" | "done" | "error";
  detail?: string;
}

export interface TurnUsage {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Estimated USD at list price; null when the model has no known price. */
  cost: number | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  /** The turn this message belongs to (one user message + the assistant's reply). */
  turnId: string;
  attachments?: ChatAttachment[];
  /** Assistant asked a question: render these as quick replies. */
  options?: ChatOption[];
  tools?: ToolActivity[];
  /** Files this turn changed — drives "Review changes" and "Undo". */
  changedPaths?: string[];
  /** True once the turn's file changes were rolled back. */
  undone?: boolean;
  /**
   * Files the undo left as they are, because someone else changed them after
   * this turn did: they still hold this turn's changes. Absent when
   * everything was put back.
   */
  undoLeft?: string[];
  /** Still streaming. */
  pending?: boolean;
  error?: string;
  usage?: TurnUsage;
}

export interface ChatThreadSummary {
  id: string;
  title: string;
  mode: AgentMode;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  /** A turn is running. */
  busy: boolean;
}

export interface ChatThread extends ChatThreadSummary {
  messages: ChatMessage[];
}

export interface SendMessageRequest {
  text: string;
  mode?: AgentMode;
  context?: ChatContext;
  attachments?: ChatAttachment[];
  /**
   * New-site wizard only: the brief to build the site from. The assistant
   * expands it into its first build-mode task; `text` is what the chat shows.
   */
  brief?: SiteBrief;
}

// ─────────────────────────────────────────────────────────────── events

/** Server → client push, over one Server-Sent Events stream (`GET /api/events`). */
export type ServerEvent =
  | { type: "hello"; version: string }
  /** Streaming assistant text for a pending message. */
  | { type: "chat.delta"; siteId: string; threadId: string; messageId: string; text: string }
  | { type: "chat.tool"; siteId: string; threadId: string; messageId: string; tool: ToolActivity }
  /** A message was added or finalized — replace by id. */
  | { type: "chat.message"; siteId: string; threadId: string; message: ChatMessage }
  | { type: "chat.done"; siteId: string; threadId: string; turnId: string }
  | { type: "chat.error"; siteId: string; threadId: string; turnId: string; message: string }
  | { type: "changes.updated"; siteId: string; paths: string[]; origin: ChangeOrigin }
  | { type: "preview.status"; siteId: string; status: PreviewStatus }
  | { type: "site.updated"; siteId: string }
  /**
   * A look at the code host found something different from the last one, or
   * a hosted editor's own round brought `brought` newer versions in: read
   * GET …/git again. The files that changed also go out as `changes.updated`.
   */
  | { type: "repository.checked"; siteId: string; brought: number }
  | { type: "sites.updated" }
  | { type: "job"; job: Job }
  /** A plugin was enabled, disabled, saved or failed: read GET /api/plugins again. */
  | { type: "plugins.updated" }
  /** A theme was saved for everyone or deleted, or the install's default theme changed: read GET /api/themes and /api/meta again. */
  | { type: "themes.updated" }
  /**
   * The form inbox changed: a submission arrived ("added", with the
   * submission), was marked read/spam or got a forwarding result ("updated"),
   * or was deleted ("deleted").
   */
  | {
      type: "forms.submission";
      siteId: string;
      form: string;
      change: "added" | "updated" | "deleted";
      ids: string[];
      submission?: import("./kit").FormSubmission;
    };

/** A long-running operation: cloning a repo, creating a site, installing dependencies. */
export interface Job {
  id: string;
  kind: "clone" | "create" | "install" | "build" | "publish" | "deploy" | "video" | "visibility" | "redirects" | "brand" | "kit-setup" | "import" | "domain" | "setup" | "restore" | "editor-host";
  label: string;
  state: "running" | "done" | "error";
  /** 0–1 when measurable. */
  progress?: number;
  detail?: string;
  siteId?: string;
  startedAt: number;
  finishedAt?: number;
  /** Where the finished work can be seen — a deploy's address. */
  url?: string;
  /** Technical detail behind an error, e.g. the last lines of a failed build. Never secrets. */
  output?: string;
}

// ─────────────────────────────────────────────────────────────── sites

export interface SiteSummary {
  id: string;
  name: string;
  /** Absolute path of the checkout. */
  root: string;
  framework: FrameworkInfo;
  branch?: string;
  remoteUrl?: string;
  lastOpenedAt: number;
  pendingChanges: number;
  /** The folder no longer exists. */
  missing?: boolean;
  /** Multi-site: the group (a client) the site is filed under — a SiteGroup id. */
  group?: string;
  /** Shown before the rest in the list and the switcher. */
  pinned?: boolean;
  /** A short note kept about the site ("launch 12 March"). */
  note?: string;
  /**
   * What the list knows about the site without opening it, as last read in
   * the background — never on the request that lists. Absent until first read.
   */
  facts?: SiteFacts;
  /** The open site's preview, when it has one. Absent while the site is closed. */
  previewState?: PreviewState;
  /** API URL of a small picture of the site: its own share image. */
  thumbnailUrl?: string;
}

export interface SiteDetail extends SiteSummary {
  model: SiteModel;
  git: GitStatus;
  /** Whether a galley.config.json exists in the repo. */
  hasConfig: boolean;
  preview: PreviewStatus;
}

/** A closed site's state, as the Sites screen shows it. */
export interface SiteFacts {
  /** When these were read from the site's folder (ms since the epoch). */
  checkedAt: number;
  /** Files with changes that aren't published. */
  pendingChanges: number;
  /** Versions published on this computer that haven't reached the site's host yet. */
  unsent: number;
  /** The live address, when known (the site's settings, or its last deploy from this app). */
  liveUrl?: string;
  /** Published versions that aren't live yet at that address. null: unknown (nothing put online from this app). */
  notLive: number | null;
  /** Form submissions not read yet. */
  unread: number;
}

export type SiteGroupColor = "ink" | "pencil" | "green" | "ochre" | "rose" | "sky" | "plum";

/** A group of sites — usually one client's. */
export interface SiteGroup {
  id: string;
  name: string;
  color: SiteGroupColor;
  /** Shown folded on the Sites screen. */
  collapsed: boolean;
}

export interface SiteGroupInput {
  name?: string;
  color?: SiteGroupColor;
  collapsed?: boolean;
}

/** How a site is filed. `null` clears. */
export interface SitePatch {
  group?: string | null;
  pinned?: boolean;
  note?: string | null;
}

/** "Add sites from a folder": what to look in. */
export interface ScanSitesRequest {
  /** Absolute path of the folder holding the sites. */
  path: string;
  /** How many levels below it to look: 1 or 2 (default 2). */
  depth?: number;
  /** Chosen by the caller, so the scan can be cancelled with POST /api/sites/scan/cancel. */
  id?: string;
}

export interface ScannedSite {
  /** Absolute real path. */
  path: string;
  name: string;
  framework: FrameworkInfo;
  /** The id it has (or would have) in the list. */
  siteId: string;
  /** Already in the list. */
  known: boolean;
}

export interface ScanSitesResult {
  path: string;
  sites: ScannedSite[];
  /** Folders looked at. */
  visited: number;
  /** The scan stopped at its limit; there may be more sites further in. */
  truncated: boolean;
  cancelled: boolean;
  /** Links to folders that were not followed. */
  skippedLinks: number;
}

export interface AddSitesRequest {
  /** Absolute paths, each checked exactly as "Open a folder" checks one. */
  paths: string[];
  /** File them all under this group. */
  group?: string;
}

export interface AddSitesResult {
  added: SiteSummary[];
  skipped: Array<{ path: string; reason: string }>;
}

/** Where a key or the author in use for a site comes from. "env": the environment the app was started from. */
export type ConnectionSource = "site" | "env" | "shared";

export interface SiteSecretConnection {
  name: SecretName;
  /** Which key is used for this site; null when none is set anywhere. */
  inUse: ConnectionSource | null;
  /** Last four characters of the key in use — never the key. */
  hint?: string;
  /** This site's own key. */
  site: { configured: boolean; hint?: string };
  /** The key every site without its own uses. */
  shared: { configured: boolean; source: "env" | "stored" | null; hint?: string };
}

export interface SiteConnections {
  siteId: string;
  secrets: SiteSecretConnection[];
  author: {
    /** What publishing from this site records as the author. */
    name: string;
    email: string;
    inUse: "site" | "shared";
    /** This site's own author, when set. */
    site: { name: string; email: string } | null;
  };
}

/** What a site has cost in assistant use. */
export interface SiteUsageTotals {
  siteId: string;
  /** The last 30 days, today included (the same window as App settings › Usage). */
  last30: UsageTotals;
  allTime: UsageTotals;
}

/** How many previews may run at once, and when an unused one is stopped. */
export interface PreviewPolicySettings {
  /** At most this many previews run at the same time (1–12). */
  maxRunning: number;
  /** A preview nobody has used for this many minutes is stopped (5–240). */
  idleMinutes: number;
}

/** One visual treatment of a starter: an alternative theme-tokens file. */
export interface StarterLook {
  id: string;
  label: string;
  /** A few representative colours (hex), for the picker's swatches. */
  swatches?: string[];
  /** API URL of a preview image of this look. */
  previewUrl?: string;
}

export interface StarterInfo {
  id: string;
  name: string;
  description: string;
  framework: FrameworkId;
  /** What kind of site it is for: "business", "saas", "publication", "portfolio"… */
  tags?: string[];
  /** API URL of a preview image, when the starter ships one. */
  previewUrl?: string;
  /** Alternative looks the starter ships; the first is its default. */
  looks?: StarterLook[];
}

/** What the new-site wizard collects; becomes the assistant's first build prompt. */
export interface SiteBrief {
  /** What the organisation is and does. */
  description: string;
  audience?: string;
  tone?: string;
  /** Pages to create, e.g. ["Home", "About", "Services", "Contact"]. */
  pages?: string[];
  /** Hex colour to theme the site around. */
  brandColor?: string;
  notes?: string;
}

export interface CreateSiteRequest {
  name: string;
  /** Parent directory; defaults to the server's sites directory. */
  directory?: string;
  starter: string;
  /** Id of one of the starter's looks; default is its first. */
  look?: string;
  brief?: SiteBrief;
}

export interface OpenSiteRequest {
  /** Absolute path of an existing checkout. */
  path: string;
}

export interface CloneSiteRequest {
  /** Git URL (https or ssh). */
  url: string;
  branch?: string;
  directory?: string;
}

// ─────────────────────────────────────────────────────────────── settings

export type Effort = "low" | "medium" | "high" | "xhigh";

export interface ModelInfo {
  id: string;
  label: string;
  blurb: string;
  /** USD per million tokens. */
  inputPrice: number;
  outputPrice: number;
}

export type SecretName = "anthropic" | "openai" | "google" | "cloudflare" | "vercel" | "fly" | "gcp";

export interface SecretStatus {
  name: SecretName;
  configured: boolean;
  /** "env" secrets cannot be changed from the app. */
  source: "env" | "stored" | null;
  /** Last four characters — never the secret. */
  hint?: string;
}

export interface Settings {
  ai: { model: string; effort: Effort; models: ModelInfo[] };
  /**
   * `provider: null` means none has been chosen: the built-in placeholder
   * generator ("mock") is used, and the UI says so rather than showing an
   * unconfigured service as selected.
   */
  images: { provider: string | null; model: string | null; providers: ImageProviderInfo[] };
  /**
   * The video service (a plugin's) and model chosen for making videos when
   * more than one is set up. `provider: null`: none chosen — the first
   * service set up is used. Absent from servers without video.
   */
  videos?: { provider: string | null; model: string | null };
  /** Commit author identity. Falls back to the machine's git config. */
  author: { name: string; email: string };
  /**
   * Whether `author` was saved in App settings › You. False: it is the
   * computer's git identity, shown for reference — publishing places the
   * repository's own git settings before it (workspace/author.ts).
   */
  authorSaved?: boolean;
  /**
   * `theme` is the appearance (light, dark or the system's; its name is
   * older than themes). `look` is the id of the install's default theme
   * (docs/themes.md); absent means the brand's, else Quiet.
   */
  appearance: { theme: "system" | "light" | "dark"; look?: string };
  secrets: SecretStatus[];
  /** Multi-site: the preview limits. Absent from servers that don't manage previews. */
  previews?: PreviewPolicySettings;
}

export interface SettingsPatch {
  ai?: { model?: string; effort?: Effort };
  images?: { provider?: string | null; model?: string | null };
  videos?: { provider?: string | null; model?: string | null };
  author?: { name?: string; email?: string };
  appearance?: { theme?: "system" | "light" | "dark"; look?: string };
  previews?: { maxRunning?: number; idleMinutes?: number };
}

export interface UsageTotals {
  turns: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  images: number;
  /**
   * Everything spent: the assistant at list prices plus what image and video
   * services reported for their work. Null when an assistant model has no
   * known price (the total would be quietly low).
   */
  cost: number | null;
  /** Videos made. */
  videos?: number;
  /**
   * The image and video part of `cost`, as the services reported it, so it
   * can be labelled. `unpriced` counts generations whose service didn't say
   * what they cost (left out of `cost`).
   */
  media?: { images: number; videos: number; unpriced: number };
}

export interface UsageSummary {
  today: UsageTotals;
  last7: UsageTotals;
  last30: UsageTotals;
  allTime: UsageTotals;
  byModel: Array<UsageTotals & { model: string }>;
  /** Last 14 local days, oldest first. */
  days: Array<{ date: string; requests: number; cost: number | null }>;
}

/**
 * White-label surface. The product ships as Galley; a deployment may rename
 * and recolour it without touching code (GALLEY_BRAND_FILE or env overrides).
 */
export interface BrandConfig {
  productName: string;
  /** Shown beside the product name, e.g. "by Fiction Tribe". Empty hides it. */
  byline: string;
  /** URL or data: URL of a logo mark; absent uses the built-in mark. */
  logoUrl?: string;
  /** Accent colour override (hex): the built-in themes' pencil on this install (docs/themes.md). */
  accent?: string;
  /** The theme this install starts with until App settings names another (a built-in, saved or plugin theme's id). */
  theme?: string;
  supportUrl?: string;
  docsUrl?: string;
}

export interface MetaInfo {
  version: string;
  brand: BrandConfig;
  /** "local": single user on loopback, any number of sites. "hosted": people sign in with their own accounts, exactly one site (see `install`). */
  mode: "local" | "hosted";
  /** Whether the caller is authenticated (hosted mode). */
  authenticated: boolean;
  /** Whether the host can show a native folder picker (desktop shell). */
  desktop: boolean;
  platform: string;
  /** Hosted mode: the install this server is — one site, and whether first run is finished. Absent in local mode. */
  install?: import("./install/types").InstallMeta;
  /** Hosted mode, signed in: who this is and what they may do. Absent in local mode and when signed out. */
  account?: import("./install/accounts").AccountSession;
  /**
   * The install's default theme, as it is put on the page (colours and
   * switches, no words), so the sign-in screen and anyone who hasn't chosen
   * see it. Absent from servers from before themes: Quiet.
   */
  look?: import("./themes").AppliedTheme;
}

// ─────────────────────────────────────────────────────────────── deploy

/** A host a site can be put online with. Cloudflare and Vercel are built in. */
export type DeployTargetId = "cloudflare" | "vercel" | (string & {});

/**
 * "production": what has been published, at the site's live address.
 * "preview": the working tree as it is, pending changes included, at an address of its own.
 */
export type DeployKind = "production" | "preview";

/** galley.config.json `deploy`: where the site goes. Ids only, never secrets. */
export interface DeployConfig {
  target: DeployTargetId;
  /** The host's account (Cloudflare) or team (Vercel) id. */
  account: string;
  /** The host's project (Cloudflare Worker / Vercel project) name. */
  project: string;
  /**
   * The site's live address — the person's choice: the host's own address
   * until they use their own domain, then that. A deploy never replaces a
   * custom address with the host's default.
   */
  productionUrl?: string;
  /** The host's own address for the project (`…workers.dev`, `….vercel.app`), whatever the live address is. */
  defaultUrl?: string;
  /** The site's own domain, when one is in use. */
  domain?: DeployDomainConfig;
  /** Put published versions live by themselves after each publish. */
  autoDeploy?: boolean;
  /** Proof's "Share a preview link" is offered. Default true. */
  previewOnShare?: boolean;
}

/** One thing the person must provide to connect a host (the setup form). */
export interface DeployCredentialInfo {
  secret: SecretName;
  label: string;
  /** One or two sentences: what it is and why it is needed. */
  help: string;
  /** The host's own page about it. */
  docsUrl: string;
}

/** A host as the setup screen presents it. */
export interface DeployTargetInfo {
  id: DeployTargetId;
  name: string;
  /** One sentence: who it suits. */
  blurb: string;
  recommended: boolean;
  credentials: DeployCredentialInfo[];
  /** Whether each credential is present (status only — never the value). */
  secrets: SecretStatus[];
  /** Numbered steps for creating the access key on the host, from its current docs. */
  keySteps: string[];
  /** Deep link to the host page where the key is created — pre-filled when the host documents a way. */
  keyUrl: string;
  /** The same key made entirely by hand, for when the pre-filled page isn't wanted. */
  keyStepsByHand?: string[];
  /** The host's plain key page, for the by-hand steps. */
  keyUrlByHand?: string;
  /** What the key lets this app do — and nothing more. */
  keyGrants: string;
  /**
   * When the key can reach more than one account: how to limit it to one on
   * the host, and the page to do it on. Shown quietly after connecting.
   */
  narrowKey?: { text: string; url: string };
  /** What "account" means on this host ("account", "team"). */
  accountNoun: string;
  /** Where to find the account id when it can't be listed. */
  accountHelp: string;
  /** Who can open a preview link and how long it lasts, per the host's docs. */
  previewNote: string;
  /** The host's documented limits, enforced before anything is uploaded. */
  limits: { maxFiles: number; maxFileBytes: number | null; maxTotalBytes: number | null };
  /** Pricing page, for the docs and the setup step. */
  pricingUrl: string;
  /** Where custom domains are added on the host. */
  domainsUrl: string;
}

export interface DeployAccount {
  id: string;
  name: string;
}

/** Whether a project name can be used, checked with the host. */
export interface DeployProjectCheck {
  name: string;
  /** The name is well-formed and usable now (free, or already this site's). */
  available: boolean;
  /** A project of that name already exists in the account. Putting the site there replaces what it serves. */
  existing: boolean;
  /** Plain sentence when the name can't be used, or a caution when it exists. */
  message?: string;
  /** The address it will have, when the host can say before the first deploy. */
  productionUrl?: string;
}

/** One upload to a host, as recorded on this computer. */
export interface Deployment {
  id: string;
  kind: DeployKind;
  target: DeployTargetId;
  project: string;
  /** The address of this deployment. */
  url: string;
  /** The published version it was built from (production), or the version the pending changes sit on (preview). */
  commit: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** Who started it: the author name from Settings, when set. */
  who?: string;
  /** A note given with a preview ("For Sam"). */
  label?: string;
  files: number;
  bytes: number;
}

/** What the UI needs to show a site's deploy state. */
/** A domain the site answers on. */
export interface DeployDomainConfig {
  /** "www.example.com" — no scheme, no path. */
  hostname: string;
  /** Galley attached it to the host's project, so "Stop using this address" may detach it. False: it was there already. */
  attached: boolean;
  /** Attached, but not answering yet (DNS or certificate still on its way). */
  pending?: boolean;
}

/** A DNS record the person creates at their DNS provider. */
export interface DomainRecord {
  type: string;
  name: string;
  value: string;
}

/** What using an address would do, worked out without changing anything. */
export interface DomainPlan {
  hostname: string;
  /**
   * "ready": the host can answer it and set up the certificate itself.
   * "needs-dns": it can, once the person creates `records`.
   * "already": it already shows this site.
   * "taken": it shows something else.
   * "dns-conflict": a DNS record for it exists, and Galley never replaces records.
   * "not-in-account": the domain isn't one this account can use.
   * "not-online": the site has to be online first.
   */
  status: "ready" | "needs-dns" | "already" | "taken" | "dns-conflict" | "not-in-account" | "not-online";
  /** Plain sentences: what will happen, or why not and what to do. */
  summary: string;
  /** Records the person must create (Vercel, or a domain outside the host). */
  records?: DomainRecord[];
  canAttach: boolean;
  /** A page on the host that helps (adding a domain, DNS records). */
  helpUrl?: string;
}

export interface DeployStatus {
  config: DeployConfig | null;
  /** The newest production deployment recorded here. */
  production: Deployment | null;
  /** The newest preview recorded here. */
  preview: Deployment | null;
  /** The running deploy job, or the most recent one while it is still kept. */
  job: Job | null;
  /** Published versions newer than what is live. null when unknown (nothing deployed yet, or no history). */
  behind: number | null;
  /** The live address is `urls.production` already. */
  liveAddressSet: boolean;
  /** A project name made from the site's name, for the setup form. */
  suggestedProject: string;
  /** The running (or last) "domain" job: attaching an address and waiting for it to answer. */
  domainJob?: Job | null;
  /** DNS records the person still has to create for the site's own address, when the host said so. */
  domainRecords?: DomainRecord[];
}

// ─────────────────────────────────────────────────────────────── engine facade

/** Thrown across the engine. `code` is stable; `message` is safe to show a user. */
export interface GalleyErrorShape {
  code:
    | "not-found"
    | "unauthorized" // no session, or the session ended — sign in again
    | "conflict" // baseHash mismatch — the file changed underneath the edit
    | "forbidden" // path not writable in this mode
    | "invalid" // bad input / validation failed
    | "git" // a git command failed
    | "preview" // dev server failure
    | "ai" // model call failed
    | "unconfigured" // missing key / missing setting
    | "busy"
    | "internal";
  message: string;
  /** Extra detail for logs and expandable UI — never secrets. */
  detail?: string;
  status?: number;
}

export interface WriteOptions {
  origin: ChangeOrigin;
  mode: AgentMode;
  /** Refuse when the file's current hash differs. */
  baseHash?: string;
}

/**
 * Records the pre-image of every file written while it is open, so one AI turn
 * can be undone as a unit without touching the user's other pending changes.
 */
/**
 * What an undo did: the files put back, and the files left as they are
 * because someone else changed them after the work being undone did.
 */
export interface UndoResult {
  restored: string[];
  left: string[];
}

export interface Checkpoint {
  readonly id: string;
  /** Paths its own work has written. */
  paths(): string[];
  /**
   * Does `work` as this checkpoint's own: what it writes, and what anything
   * it starts writes, is recorded. A write made outside it is not, whoever
   * makes it and whichever file it is.
   */
  run<T>(work: () => T): T;
  /** Stop recording. Idempotent. */
  close(): void;
  /**
   * Put back every recorded file that is still as this checkpoint's own work
   * left it. A file someone else has changed since stays as it is. Returns
   * the restored paths.
   */
  restore(): Promise<string[]>;
  /** After `restore()`: the paths it left as they are, because someone else changed them after this checkpoint's own work did. */
  left(): string[];
}

export interface PreviewController {
  status(): PreviewStatus;
  /** Starts the dev server and proxies if needed. Resolves once ready or failed. */
  start(): Promise<PreviewStatus>;
  stop(): Promise<void>;
  restart(): Promise<PreviewStatus>;
}

/**
 * One open site. This is the whole engine surface the server and the
 * assistant's tools build on — nothing else reaches into the checkout.
 *
 * Paths are always repo-relative with POSIX separators. Every method that
 * writes refuses paths outside the site root and outside the mode's writable
 * globs, and emits `changes.updated`.
 */
export interface SiteService {
  readonly id: string;
  readonly root: string;

  summary(): Promise<SiteSummary>;
  detail(): Promise<SiteDetail>;
  /** The cached site model. */
  model(): Promise<SiteModel>;
  /** Re-run detection (after config or structure changes). */
  refresh(): Promise<SiteModel>;
  /**
   * What detection finds on its own, before galley.config.json is applied —
   * the settings screen shows these as the values an override replaces.
   */
  detected(): Promise<SiteModel>;
  readConfig(): Promise<GalleyConfig | null>;
  /**
   * Writes galley.config.json (changing only the lines that differ) and
   * refreshes the model. `mode` is set when an assistant or another AI tool
   * asks: that needs build mode, and build mode allowed by the site. The
   * settings screen passes no mode.
   */
  saveConfig(config: GalleyConfig, options?: { mode?: AgentMode }): Promise<SiteModel>;

  // content
  listEntries(collectionId: string, query?: EntryQuery): Promise<EntryList>;
  readEntry(path: string): Promise<Entry>;
  updateEntry(
    path: string,
    ops: EditOp[],
    options?: { baseHash?: string; origin?: ChangeOrigin; mode?: AgentMode }
  ): Promise<EditResult>;
  /**
   * `mode` is the assistant's or an AI tool's mode. Without one, a change by
   * "agent" counts as content mode and anyone else as the person in the app.
   * It matters for what only build mode may write — a form's custom code.
   */
  createEntry(input: CreateEntryInput, options?: { origin?: ChangeOrigin; mode?: AgentMode }): Promise<Entry>;
  deleteEntry(path: string, options?: { origin?: ChangeOrigin }): Promise<void>;
  search(query: string, options?: { collection?: string; limit?: number }): Promise<SearchHit[]>;
  /** `mode` defaults to "content", where matches in source files are not editable. */
  resolveText(request: ResolveRequest, options?: { mode?: AgentMode }): Promise<ResolveResult>;
  entryForUrl(urlPath: string): Promise<EntrySummary | null>;
  /** Validate the given paths, or everything pending when absent. */
  validate(paths?: string[]): Promise<ValidationIssue[]>;

  // files (source view, build mode)
  listFiles(options?: { glob?: string; limit?: number }): Promise<string[]>;
  readFile(path: string): Promise<{ path: string; content: string; hash: string; binary: boolean }>;
  writeFile(path: string, content: string | Uint8Array, options: WriteOptions): Promise<void>;
  deleteFile(path: string, options: WriteOptions): Promise<void>;

  // media
  listMedia(): Promise<MediaItem[]>;
  saveMedia(
    input: { filename: string; directory?: string; data: Uint8Array },
    options?: { origin?: ChangeOrigin }
  ): Promise<MediaItem>;
  /** Absolute path for a repo-relative file, after the containment check. */
  resolvePath(path: string): string;

  // proof & publish
  changes(): Promise<ChangeSet>;
  /**
   * Repo paths with pending changes, from the status the site keeps up to
   * date as files change: no git call, no change summaries. For callers that
   * only need to know which files are pending. Optional so other
   * implementations (test fakes) needn't provide it; `changes()` is the fallback.
   */
  pendingPaths?(): string[];
  diff(path: string): Promise<FileDiff>;
  /** The base-commit bytes of a file (for before/after image previews). */
  readBase(path: string): Promise<Uint8Array | null>;
  discard(paths?: string[]): Promise<ChangeSet>;
  publish(request?: PublishRequest): Promise<PublishResult>;
  /**
   * Send versions that were published on this computer but have not reached
   * the remote yet (a publish whose push failed). `ok: true, pushed: false`
   * with `pushError` when it still cannot be sent; `pushed: true` with an
   * empty `files` list when there was nothing left to send.
   */
  send(): Promise<PublishResult>;
  history(limit?: number): Promise<HistoryEntry[]>;
  /** Undo a published commit with a new revert commit (never rewrites history). */
  revert(commit: string): Promise<PublishResult>;
  gitStatus(): Promise<GitStatus>;
  /**
   * Ask the code host what is new without changing any file: fetch the
   * site's branch, then the status as of now. A look that can't reach the
   * code host doesn't throw: the status says so (`checkProblem`).
   */
  checkGit(): Promise<GitStatus>;
  /** Fetch and fast-forward from the remote. Refuses when it cannot fast-forward. */
  pull(): Promise<GitStatus>;
  /**
   * A hosted editor's own round: look, and when the code host has newer
   * versions and nothing here is in the way, bring them in forward only, as
   * pull does. Never throws for git's reasons (the status says them). null
   * when other git work is in progress: it never waits behind it.
   */
  catchUp(): Promise<CatchUpResult | null>;

  // undo
  checkpoint(label: string): Checkpoint;

  // preview & build
  preview(): PreviewController;
  /** `mode: "build"` (an assistant or AI tool checking its work) is refused when the site doesn't allow build mode. */
  build(options?: { mode?: AgentMode }): Promise<BuildResult>;

  dispose(): Promise<void>;
}

export interface SiteRegistry {
  list(): Promise<SiteSummary[]>;
  get(id: string): Promise<SiteService | null>;
  open(request: OpenSiteRequest): Promise<SiteService>;
  /** Starts a clone job; the site is registered when the job finishes. */
  clone(request: CloneSiteRequest): Promise<Job>;
  /** Copies a starter, initialises git, installs dependencies. */
  create(request: CreateSiteRequest): Promise<Job>;
  /** Forget a site. Never deletes files. */
  remove(id: string): Promise<void>;
  starters(): Promise<StarterInfo[]>;
  /**
   * A preview image a starter's starter.json declares (its own, or one
   * look's) — the only files of the starters folder that are ever served.
   */
  starterPreview(starterId: string, lookId?: string): Promise<{ path: string; type: string } | null>;
  /** A running or recently finished job, by id. */
  job(id: string): Job | null;
  dispose(): Promise<void>;

  // ── multi-site. Optional so test doubles and embedders keep compiling; the
  // real registry has every one. None of them opens a site.

  /** File a site: its group, pin and note. */
  update?(id: string, patch: SitePatch): Promise<SiteSummary>;
  /** The groups, in the order the person arranged them. */
  groups?(): Promise<SiteGroup[]>;
  createGroup?(input: SiteGroupInput): Promise<SiteGroup>;
  updateGroup?(id: string, input: SiteGroupInput): Promise<SiteGroup>;
  /** Removes the group; its sites stay in the list, ungrouped. */
  removeGroup?(id: string): Promise<void>;
  orderGroups?(ids: string[]): Promise<SiteGroup[]>;
  /** Looks for sites inside a folder (one or two levels), without opening or detecting any of them in depth. */
  scan?(request: ScanSitesRequest, signal?: AbortSignal): Promise<ScanSitesResult>;
  /** Adds several folders at once, each checked as `open` checks one, none of them opened. */
  addMany?(request: AddSitesRequest): Promise<AddSitesResult>;
  /** The site's own share image, for the list's thumbnail. */
  thumbnail?(id: string): Promise<{ path: string; type: string } | null>;
  /** Someone is looking at the site (an editor is open on it): keeps its preview from being stopped as unused. */
  touch?(id: string): void;
}

/** Fan-out for ServerEvents. The server exposes it as SSE. */
export interface EventBus {
  emit(event: ServerEvent): void;
  subscribe(listener: (event: ServerEvent) => void): () => void;
}

/** The assistant. One instance serves every site. */
export interface AgentRuntime {
  listThreads(siteId: string): Promise<ChatThreadSummary[]>;
  getThread(siteId: string, threadId: string): Promise<ChatThread | null>;
  createThread(
    siteId: string,
    input?: { title?: string; mode?: AgentMode }
  ): Promise<ChatThread>;
  deleteThread(siteId: string, threadId: string): Promise<void>;
  renameThread(siteId: string, threadId: string, title: string): Promise<ChatThreadSummary>;
  /**
   * Accepts a user message and starts the turn. Resolves as soon as the turn is
   * accepted; the reply streams as chat.* events and ends with chat.done.
   */
  send(siteId: string, threadId: string, request: SendMessageRequest): Promise<{ turnId: string }>;
  cancel(siteId: string, threadId: string): Promise<void>;
  /** Roll back the files one turn changed. Returns the restored paths. */
  undoTurn(siteId: string, threadId: string, turnId: string): Promise<UndoResult>;
  /**
   * One plain sentence describing a set of pending changes, for the publish
   * message. Falls back to a deterministic summary when no model is available;
   * never throws for a missing key.
   */
  describeChanges(siteId: string, changes: ChangeSet): Promise<string>;
}

export interface ImageService {
  providers(): Promise<ImageProviderInfo[]>;
  generate(request: ImageGenRequest): Promise<ImageCandidate[]>;
  /** Bytes of a held candidate. */
  read(candidateId: string): Promise<{ data: Uint8Array; mime: string } | null>;
  /** Writes the candidate into the site's media directory. */
  save(site: SiteService, request: ImageSaveRequest, origin?: ChangeOrigin): Promise<MediaItem>;
  discard(candidateId: string): Promise<void>;
}

export interface SettingsService {
  /**
   * `siteId` (or, when absent, the site whose request is being served — see
   * site/scope.ts) resolves the keys' status and the author for that site:
   * its own, else the shared ones.
   */
  get(options?: { siteId?: string }): Promise<Settings>;
  /**
   * The authors that were saved on purpose — this site's own and the app's
   * (App settings › You) — never filled in from the computer's git identity.
   * Publishing places the repository's own git settings between the two.
   */
  authorLayers?(options?: { siteId?: string }): Promise<{ site: { name: string; email: string } | null; app: { name: string; email: string } | null }>;
  update(patch: SettingsPatch): Promise<Settings>;
  setSecret(name: SecretName, value: string | null): Promise<SecretStatus>;
  /**
   * Engine-internal: the secret itself. Never crosses the HTTP boundary.
   * Order: the site's own key → the environment → the shared stored key.
   */
  readSecret(name: SecretName, options?: { siteId?: string }): Promise<string | null>;
  /** `siteId`: that site's use only. */
  usage(options?: { siteId?: string }): Promise<UsageSummary>;
  recordUsage(entry: TurnUsage & { siteId: string; at: number; images?: number; videos?: number }): Promise<void>;

  // ── per-site connections. Optional so test doubles keep compiling.

  /** Which key and author each connection uses for this site. Status and last four characters only. */
  siteConnections?(siteId: string): Promise<SiteConnections>;
  /** This site's own key; null removes it (the shared key is used again). */
  setSiteSecret?(siteId: string, name: SecretName, value: string | null): Promise<SiteConnections>;
  /** This site's own author; null removes it. */
  setSiteAuthor?(siteId: string, author: { name: string; email: string } | null): Promise<SiteConnections>;
  /** Removes everything stored for the site (its own keys and author), when it leaves the list. */
  forgetSite?(siteId: string): Promise<void>;
  /** Every site's assistant use this month and in all. */
  usageBySite?(): Promise<SiteUsageTotals[]>;
}

// ─────────────────────────────────────────────────────────────── videos

export interface VideoService {
  providers(): Promise<VideoProviderInfo[]>;
  /** Starts a generation as a `Job` (kind "video"); progress arrives as job events. */
  generate(site: SiteService, request: VideoGenRequest): Promise<Job>;
  /** The job and, once it is done, its candidates. Null when the job isn't known. */
  status(jobId: string): Promise<VideoJobStatus | null>;
  /** Bytes of a held candidate. */
  read(candidateId: string): Promise<{ data: Uint8Array; mime: string } | null>;
  /** Writes the candidate into the site's media directory. */
  save(site: SiteService, request: VideoSaveRequest, origin?: ChangeOrigin): Promise<MediaItem>;
  discard(candidateId: string): Promise<void>;
}

// ─────────────────────────────────────────────────────────────── plugins

/** Where a plugin came from: shipped with the app, installed for this user or server, or named by a site's config. */
export type PluginSource = "builtin" | "user" | "site";

/** One setting of a plugin, as the app may see it: a secret's value never appears, only whether it is set. */
export interface PluginSettingInfo {
  key: string;
  label: string;
  help?: string;
  placeholder?: string;
  pattern?: string;
  /** How to ask for it; absent means a text box. A toggle's value is "on" or "off". */
  type?: "text" | "toggle" | "select";
  /** For a select: the choices. */
  options?: Array<{ value: string; label: string }>;
  /** For a toggle or select: what the plugin reads while nothing is saved. */
  default?: string;
  /** For a toggle: what switching it on does, in one sentence. */
  consequence?: string;
  /** Titles of the assistant tools this setting switches on (their `enabledBy`): the switch lets the assistant act outside the app. */
  switchesOn?: string[];
  secret: boolean;
  required: boolean;
  configured: boolean;
  /** "env": set by the environment the server started from — it can't be changed in the app. */
  source: "env" | "stored" | null;
  /** Plain settings only. */
  value?: string;
  /** Secrets: the last four characters. */
  hint?: string;
}

/** What a plugin adds, by the names people read. */
export interface PluginContributions {
  adapters: string[];
  imageProviders: string[];
  videoProviders: string[];
  formProviders: string[];
  scriptIntegrations: string[];
  importers: string[];
  deployTargets: string[];
  /** Names of the places it can host the editor itself (left out when none). */
  editorHosts?: string[];
  tools: Array<{ name: string; title: string; mode: "content" | "build"; readOnly: boolean }>;
  /** Labels of the data sources it offers to fields (left out when none). */
  dataSources?: string[];
  /** Names of the themes it adds to the editing app (left out when none). */
  themes?: string[];
  hooks: string[];
}

export interface PluginInfo {
  name: string;
  displayName: string;
  description?: string;
  version: string | null;
  source: PluginSource;
  /** The site it came from, for site plugins. */
  siteId?: string;
  /** How it was named: the config entry for a site plugin, the install spec for an installed one. */
  location?: string;
  /** The person's choice. */
  enabled: boolean;
  /** Enabled, loaded and set up without problems — its contributions are in use. */
  active: boolean;
  /** The engine's own built-ins can't be turned off. */
  canDisable: boolean;
  contributes: PluginContributions;
  /** Why it isn't in use, in plain words. */
  problems: string[];
  warnings: string[];
  settings: PluginSettingInfo[];
  /** Its most recent log lines (secrets cut out), newest last. */
  log: string[];
}

/** Two plugins offered the same thing; one was used. */
export interface PluginConflict {
  kind: "adapter" | "imageProvider" | "videoProvider" | "formProvider" | "scriptIntegration" | "importer" | "deployTarget" | "editorHost" | "tool" | "dataSource" | "theme";
  id: string;
  /** The plugin whose contribution is used. */
  used: string;
  ignored: string[];
}

// ─────────────────────────────────────────────────────────────── bringing a site over (import)

/**
 * Where an import reads from: a live site's address, or an export file
 * uploaded first. An application password travels in the request that needs
 * it and is held in memory for that job only — never stored, logged or sent
 * in an event.
 */
export type ImportSource =
  | { kind: "address"; address: string; user?: string; password?: string }
  | { kind: "file"; uploadId: string };

/** An uploaded export file, kept in the site's state folder (never in the site). */
export interface ImportUpload {
  id: string;
  name: string;
  size: number;
}

export interface ImportProblem {
  reason: "blocked" | "not-wordpress" | "unreachable" | "auth" | "file" | "refused" | "busy";
  /** What happened, in plain words. */
  message: string;
  /** The way forward to offer: sign in with an application password, upload an export file, check the address. */
  offer: Array<"password" | "file" | "address">;
  detail?: string;
}

/** The quick look while an address is typed: is it WordPress, can its content be read, how much is there. */
export interface ImportInspection {
  ok: boolean;
  kind: "address" | "file";
  title: string;
  siteUrl: string;
  /** null where the site doesn't say. */
  counts: { posts: number | null; pages: number | null; media: number | null; comments: number | null };
  /** Pages made with a page builder, when that can be told this early (export files). */
  builderPages?: number;
  signedIn: boolean;
  /** Plain sentences worth knowing ("This address is on this computer…"). */
  notes: string[];
  problem?: ImportProblem;
}

export interface ImportQuestion {
  /** "posts-collection", "pages-collection", "default:<collection>.<field>". */
  id: string;
  question: string;
  options: Array<{ value: string; label: string }>;
  default?: string;
  /** The answer the plan was made with: the person's, else the default. */
  answer: string;
}

/** What will come across, where it goes, and what won't. */
export interface ImportPlanView {
  source: { title: string; siteUrl: string; kind: "address" | "file" };
  siteName: string;
  counts: { posts: number; pages: number; images: number; authors: number; categories: number; tags: number };
  destinations: Array<{ kind: "posts" | "pages"; collection: string; label: string; count: number; fields: Array<{ label: string; from: string }>; unmapped: string[] }>;
  /** Page-builder pages: their words and images come across; their layouts are rebuilt from this site's sections. */
  builders: Array<{ name: string; count: number; titles: string[] }>;
  skipped: Array<{ title: string; kind: string; reason: string }>;
  notComing: Array<{ what: string; why: string }>;
  features: Array<{ title: string; advice: string; where: string[] }>;
  questions: ImportQuestion[];
  redirects: number;
  seo: { descriptions: number; titles: number; canonicals: number };
  notes: string[];
}

export interface ImportStep {
  id: "read" | "media" | "posts" | "pages" | "finish";
  label: string;
  state: "waiting" | "running" | "done" | "stopped" | "skipped";
  done?: number;
  total?: number;
}

export interface ImportReportItem {
  title: string;
  /** The entry, when it is in the site. */
  path?: string;
  note: string;
}

/** The import as it ended: what arrived, what needs a look, redirects, SEO and what to do next. */
export interface ImportReportView {
  runId: string;
  finishedAt: number;
  stopped: boolean;
  source: { title: string; siteUrl: string; kind: "address" | "file" };
  arrived: { posts: number; pages: number; images: number; updated: number; unchanged: number; embeds: number };
  entries: Array<{ title: string; kind: "post" | "page"; path: string; newUrl: string | null; oldUrl: string; action: "created" | "updated" | "unchanged" }>;
  needsLook: Array<{ id: string; title: string; advice?: string; items: ImportReportItem[] }>;
  notImported: ImportReportItem[];
  leftBehind: Array<{ what: string; why: string }>;
  rebuilds: Array<{ title: string; path: string; url: string | null; originalUrl: string; builder: string; sections: number; matched: number; threadId?: string }>;
  redirects: { count: number; file: string | null; list: Array<{ from: string; to: string; title: string }> };
  seo: { descriptions: number; descriptionsWritten: number; titlesKept: number; titlesNotKept: number; canonicals: number };
  /** Files written besides content and media (the import record, the redirect hand-off). */
  files: string[];
  /**
   * Where the entries it wrote stand now, worked out each time the report is
   * read: still waiting in Proof, published since, or discarded. Absent on
   * the report a run hands back as it ends (everything is waiting then).
   */
  standing?: { pending: number; published: number; discarded: number };
}

export interface ImportRunStatus {
  id: string;
  job: Job;
  state: "running" | "done" | "stopped" | "error";
  steps: ImportStep[];
  /** Where it is now, or how it ended, in one sentence. */
  message: string;
  problem?: ImportProblem;
  report?: ImportReportView;
}

/** "Rebuild all": what it would do and roughly what it would cost, before anything starts. */
export interface ImportRebuildPlan {
  pages: Array<{ path: string; title: string; rebuilt: boolean }>;
  model: string;
  /** Estimated US dollars at list prices for the whole queue; null when the model has no known price. */
  estimate: { low: number; high: number } | null;
  connected: boolean;
  note: string;
}

export interface ImportRebuildStatus {
  job: Job;
  pages: Array<{ path: string; title: string; state: "waiting" | "working" | "done" | "failed" | "stopped"; threadId?: string; reason?: string }>;
}

