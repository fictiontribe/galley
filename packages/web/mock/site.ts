/**
 * One site held in memory: every file with its last-published ("base") and
 * working ("current") bytes. Entries, changes, diffs, search and publishing
 * are all computed from those two snapshots, so mutations behave the way the
 * real engine's do (a pending change is simply base ≠ current).
 */
import { randomBytes } from "node:crypto";
import YAML from "yaml";
import type {
  GalleyErrorShape,
  ChangeKind,
  ChangeSet,
  Collection,
  CreateEntryInput,
  EditOp,
  EditRefusal,
  EditResult,
  Entry,
  EntryFormat,
  EntryList,
  EntryQuery,
  EntrySummary,
  FieldChange,
  FieldPath,
  FileChange,
  FileDiff,
  FrameworkInfo,
  GalleyConfig,
  GitStatus,
  HistoryEntry,
  JsonValue,
  MediaItem,
  PackageManager,
  PublishRequest,
  PublishResult,
  ResolveRequest,
  ResolveResult,
  SearchHit,
  SiteModel,
  SiteSummary,
  SourceMatch,
} from "@galley/core/types";
import { commitName } from "./describe.ts";
import { hunks, planList, tally } from "./diff.ts";
import { humanize, inferFields } from "./infer.ts";

export type CollectionDef = Omit<Collection, "fields" | "count" | "source"> & { source?: Collection["source"] };

export interface SiteSeed {
  id: string;
  name: string;
  root: string;
  framework: FrameworkInfo;
  packageManager: PackageManager | null;
  files: Map<string, Buffer>;
  collections: CollectionDef[];
  notes: string[];
  mediaDir: string;
  mediaPublicPath: string;
  urls: { production?: string; staging?: string };
  dev: { command: string; port: number | null } | null;
  build: { command: string; outDir: string } | null;
  history: HistoryEntry[];
  branch: string;
  remoteUrl?: string;
  behind?: number;
  missing?: boolean;
}

interface FileRecord {
  base: Buffer | null;
  current: Buffer | null;
  modifiedAt: number;
}

export class MockError extends Error {
  constructor(
    readonly code: GalleyErrorShape["code"],
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

/** Too many tries: the real server's 429, code "busy" (server/src/errors.ts RateLimitError). */
export class MockTooManyError extends MockError {
  constructor(message: string) {
    super("busy", message);
  }
}

// MP4 too: generated videos are saved into media like images.
const IMAGE_EXT = /\.(svg|png|jpe?g|webp|gif|avif|mp4)$/i;
const MIME: Record<string, string> = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", mp4: "video/mp4" };

export function mimeOf(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? (path.endsWith(".md") ? "text/markdown" : path.endsWith(".json") ? "application/json" : "text/plain");
}

export function imageSize(path: string, bytes: Buffer): { width?: number; height?: number } {
  if (path.endsWith(".svg")) {
    const text = bytes.toString("utf8");
    const width = /\bwidth="(\d+(?:\.\d+)?)"/.exec(text)?.[1];
    const height = /\bheight="(\d+(?:\.\d+)?)"/.exec(text)?.[1];
    if (width && height) return { width: Math.round(Number(width)), height: Math.round(Number(height)) };
    const box = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/.exec(text);
    return box ? { width: Math.round(Number(box[1])), height: Math.round(Number(box[2])) } : {};
  }
  if (path.endsWith(".png") && bytes.length > 24) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  return {};
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

interface ParsedDoc {
  data: { [key: string]: JsonValue };
  body: string | null;
  frontMatter: string;
}

function parseDoc(text: string, format: EntryFormat): ParsedDoc {
  if (format === "json") return { data: JSON.parse(text) as ParsedDoc["data"], body: null, frontMatter: text };
  if (format === "yaml") return { data: (YAML.parse(text) ?? {}) as ParsedDoc["data"], body: null, frontMatter: text };
  const match = FRONT_MATTER.exec(text);
  if (!match) return { data: {}, body: text, frontMatter: "" };
  return { data: (YAML.parse(match[1] ?? "") ?? {}) as ParsedDoc["data"], body: (match[2] ?? "").replace(/^\r?\n/, ""), frontMatter: match[1] ?? "" };
}

function serialize(data: ParsedDoc["data"], body: string | null, format: EntryFormat): string {
  if (format === "json") return `${JSON.stringify(data, null, 2)}\n`;
  if (format === "yaml") return YAML.stringify(data, { lineWidth: 0 });
  return `---\n${YAML.stringify(data, { lineWidth: 0 })}---\n\n${body ?? ""}`;
}

/** A string that can replace another plain YAML scalar in place without changing its meaning. */
function safePlain(value: string): boolean {
  return !/[\n\r]|: | #|\s$/.test(value) && !/^[-?:,[\]{}#&*!|>'"%@`\s]/.test(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function getIn(data: JsonValue, path: FieldPath): JsonValue | undefined {
  let node: JsonValue | undefined = data;
  for (const part of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = Array.isArray(node) ? node[Number(part)] : node[String(part)];
  }
  return node;
}

function parentOf(data: JsonValue, path: FieldPath): { parent: JsonValue; key: string | number } | null {
  if (path.length === 0) return null;
  const parent = getIn(data, path.slice(0, -1));
  if (parent === null || typeof parent !== "object" || parent === undefined) return null;
  return { parent, key: path[path.length - 1] as string | number };
}

function titleOf(collection: Collection, data: ParsedDoc["data"], body: string | null, slug: string): { title: string; source: EntrySummary["titleSource"] } {
  const key = collection.titleField ?? ["title", "name", "heading"].find((k) => typeof data[k] === "string");
  if (key && typeof data[key] === "string") return { title: data[key] as string, source: "field" };
  const heading = body ? /^#\s+(.+)$/m.exec(body)?.[1] : undefined;
  if (heading) return { title: heading, source: "heading" };
  return { title: slug === "index" ? "Home" : humanize(slug.split("/").pop() ?? slug), source: "filename" };
}

function stripInline(text: string): string {
  return text.replace(/[*_`]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function newCommit(): { commit: string; shortCommit: string } {
  const commit = randomBytes(20).toString("hex");
  return { commit, shortCommit: commit.slice(0, 7) };
}

export class MockSite {
  readonly id: string;
  name: string;
  readonly root: string;
  readonly seed: SiteSeed;
  private files = new Map<string, FileRecord>();
  config: GalleyConfig | null = null;
  history: HistoryEntry[];
  behind: number;
  /** Versions published here that haven't reached the host yet. */
  unsent = 0;
  lastOpenedAt = Date.now();
  /** Paths written by each assistant turn, with their pre-images, for "Undo". */
  readonly checkpoints = new Map<string, Map<string, Buffer | null>>();

  constructor(seed: SiteSeed) {
    this.seed = seed;
    this.id = seed.id;
    this.name = seed.name;
    this.root = seed.root;
    this.history = seed.history;
    this.behind = seed.behind ?? 0;
    const now = Date.now();
    for (const [path, bytes] of seed.files) this.files.set(path, { base: bytes, current: bytes, modifiedAt: now - 86_400_000 * 3 });
    const configFile = seed.files.get("galley.config.json");
    if (configFile) this.config = JSON.parse(configFile.toString("utf8")) as GalleyConfig;
  }

  // ── files ──────────────────────────────────────────────────────────────

  /** Every path the site has a record of (current or base). */
  allPaths(): string[] {
    return [...this.files.keys()];
  }

  read(path: string, rev?: "base"): Buffer | null {
    const record = this.files.get(path);
    if (!record) return null;
    return rev === "base" ? record.base : record.current;
  }

  write(path: string, bytes: Buffer | null, checkpoint?: string): void {
    const record = this.files.get(path) ?? { base: null, current: null, modifiedAt: Date.now() };
    if (checkpoint) {
      const cp = this.checkpoints.get(checkpoint) ?? new Map<string, Buffer | null>();
      if (!cp.has(path)) cp.set(path, record.current);
      this.checkpoints.set(checkpoint, cp);
    }
    record.current = bytes;
    record.modifiedAt = Date.now();
    if (record.base === null && record.current === null) this.files.delete(path);
    else this.files.set(path, record);
  }

  listFiles(glob?: string, limit = 500): string[] {
    const all = [...this.files.entries()].filter(([, r]) => r.current !== null).map(([p]) => p).sort();
    const needle = glob?.replace(/\*+/g, "").replace(/[{}]/g, "") ?? "";
    return (needle ? all.filter((p) => p.includes(needle)) : all).slice(0, limit);
  }

  // ── model ──────────────────────────────────────────────────────────────

  private entryPathsOf(def: CollectionDef): string[] {
    if (def.kind === "data") return this.files.get(def.path)?.current ? [def.path] : [];
    const base = `${def.path.replace(/\/$/, "")}/`;
    return [...this.files.entries()]
      .filter(([path, record]) => record.current !== null && path.startsWith(base) && /\.(md|mdx|json|ya?ml)$/.test(path))
      .map(([path]) => path)
      .sort();
  }

  private collections(): Collection[] {
    return this.seed.collections.map((def) => {
      const paths = this.entryPathsOf(def);
      const records = paths.map((path) => parseDoc(this.read(path)?.toString("utf8") ?? "", def.format).data);
      return { ...def, source: def.source ?? "schema", fields: inferFields(records), count: def.kind === "data" ? 1 : paths.length };
    });
  }

  /** The model before galley.config.json is applied (GET …/config `detected`). */
  detectedModel(): SiteModel {
    const config = this.config;
    this.config = null;
    try {
      return this.model();
    } finally {
      this.config = config;
    }
  }

  model(): SiteModel {
    const collections = this.collections();
    const overrides = this.config;
    const mediaDir = overrides?.media?.dir ?? this.seed.mediaDir;
    const publicPath = overrides?.media?.publicPath ?? this.seed.mediaPublicPath;
    return {
      name: this.name,
      framework: this.seed.framework,
      packageManager: this.seed.packageManager,
      installed: true,
      dev: this.seed.dev ? { command: overrides?.dev?.command ?? this.seed.dev.command, port: overrides?.dev?.port ?? this.seed.dev.port } : null,
      build: this.seed.build,
      collections,
      media: { dir: mediaDir, publicPath, roots: [{ dir: mediaDir, publicPath }] },
      urls: { ...this.seed.urls, ...overrides?.urls },
      publish: {
        branch: this.seed.branch,
        mode: overrides?.publish?.mode ?? "commit",
        remote: this.seed.remoteUrl ? "origin" : null,
        push: Boolean(this.seed.remoteUrl),
      },
      ai: { instructions: overrides?.ai?.instructions ?? [], allowBuild: overrides?.ai?.allowBuild ?? false },
      writable: { content: ["src/content/**", "src/data/**", `${mediaDir}/**`], build: ["src/**", "public/**"] },
      notes: this.seed.notes,
    };
  }

  collectionOf(path: string): Collection | null {
    return this.collections().find((c) => (c.kind === "data" ? c.path === path : path.startsWith(`${c.path.replace(/\/$/, "")}/`))) ?? null;
  }

  private urlFor(collection: Collection, slug: string): string | null {
    if (!collection.url) return null;
    if (slug === "index") return "/";
    return collection.url.replace("{slug}", slug);
  }

  // ── entries ────────────────────────────────────────────────────────────

  private statusOf(path: string): EntrySummary["status"] {
    const record = this.files.get(path);
    if (!record) return "clean";
    if (record.base === null) return "added";
    if (record.current === null) return "deleted";
    return record.base.equals(record.current) ? "clean" : "modified";
  }

  summary(path: string, collection = this.collectionOf(path)): EntrySummary {
    if (!collection) throw new MockError("not-found", "That page isn’t part of any collection.");
    const text = this.read(path)?.toString("utf8") ?? this.read(path, "base")?.toString("utf8") ?? "";
    const doc = parseDoc(text, collection.format);
    const slug = collection.kind === "data" ? collection.id : path.slice(collection.path.replace(/\/$/, "").length + 1).replace(/\.[^.]+$/, "");
    const { title, source } = collection.kind === "data" ? { title: collection.label, source: "field" as const } : titleOf(collection, doc.data, doc.body, slug);
    const date = collection.dateField ? doc.data[collection.dateField] : undefined;
    const image = collection.imageField ? doc.data[collection.imageField] : undefined;
    const draft = collection.draftField ? doc.data[collection.draftField] : undefined;
    const authorValue = doc.data.author;
    const authorText = typeof authorValue === "string" ? authorValue : authorValue && typeof authorValue === "object" && !Array.isArray(authorValue) && typeof authorValue.name === "string" ? authorValue.name : undefined;
    // A reference to another entry (a team member's slug) reads as that entry's title.
    const referenced = authorText && /^[a-z0-9-]+$/.test(authorText) ? this.referencedTitle(authorText, collection) : null;
    const author = referenced ?? authorText;
    return {
      path,
      collection: collection.id,
      slug,
      title,
      titleSource: source,
      date: typeof date === "string" ? date : undefined,
      author,
      image: typeof image === "string" ? image : undefined,
      draft: typeof draft === "boolean" ? draft : undefined,
      url: this.urlFor(collection, slug),
      status: this.statusOf(path),
      modifiedAt: this.files.get(path)?.modifiedAt ?? Date.now(),
    };
  }

  private referencedTitle(slug: string, from: Collection): string | null {
    for (const other of this.collections()) {
      if (other.id === from.id || other.kind !== "entries") continue;
      const path = `${other.path.replace(/\/$/, "")}/${slug}.md`;
      const text = this.read(path)?.toString("utf8");
      if (!text) continue;
      const doc = parseDoc(text, other.format);
      return titleOf(other, doc.data, doc.body, slug).title;
    }
    return null;
  }

  readEntry(path: string): Entry {
    const collection = this.collectionOf(path);
    const bytes = this.read(path);
    if (!collection || !bytes) throw new MockError("not-found", "This page no longer exists. It may have been deleted or renamed.", path);
    const raw = bytes.toString("utf8");
    const doc = parseDoc(raw, collection.format);
    const known = new Set(collection.fields.map((f) => f.key));
    const extra = inferFields([doc.data]).filter((f) => !known.has(f.key));
    return {
      ...this.summary(path, collection),
      format: collection.format,
      data: doc.data,
      body: collection.body ? doc.body : null,
      raw,
      hash: Buffer.from(raw).toString("base64").slice(-16),
      fields: [...collection.fields, ...extra],
      issues: [],
    };
  }

  listEntries(collectionId: string, query: EntryQuery = {}): EntryList {
    const collection = this.collections().find((c) => c.id === collectionId);
    if (!collection) throw new MockError("not-found", `There’s no collection called “${collectionId}” on this site.`);
    let items = this.entryPathsOf(collection).map((path) => this.summary(path, collection));
    if (query.search) {
      const q = query.search.toLowerCase();
      items = items.filter((item) => item.title.toLowerCase().includes(q) || item.slug.includes(q));
    }
    if (query.status) items = items.filter((item) => item.status === query.status);
    const sort = query.sort ?? (collection.dateField ? "date" : "title");
    const dir = (query.order ?? (sort === "title" ? "asc" : "desc")) === "asc" ? 1 : -1;
    items.sort((a, b) => {
      const av = sort === "date" ? (a.date ?? "") : sort === "modified" ? a.modifiedAt : a.title.toLowerCase();
      const bv = sort === "date" ? (b.date ?? "") : sort === "modified" ? b.modifiedAt : b.title.toLowerCase();
      return av < bv ? -dir : av > bv ? dir : 0;
    });
    const offset = query.offset ?? 0;
    return { collection: collectionId, total: items.length, items: items.slice(offset, offset + (query.limit ?? 100)) };
  }

  updateEntry(path: string, ops: EditOp[], checkpoint?: string): EditResult {
    const collection = this.collectionOf(path);
    const bytes = this.read(path);
    if (!collection || !bytes) throw new MockError("not-found", "This page no longer exists. It may have been deleted or renamed.", path);
    let raw = bytes.toString("utf8");
    let doc = parseDoc(raw, collection.format);
    const refused: EditRefusal[] = [];
    let applied = 0;

    ops.forEach((op, index) => {
      const refuse = (reason: string) => refused.push({ index, op, reason });
      if (op.op === "raw") {
        raw = op.value;
        doc = parseDoc(raw, collection.format);
        applied++;
        return;
      }
      if (op.op === "body" || op.op === "body-replace") {
        if (doc.body === null || !collection.body) return refuse("This entry has no body text.");
        if (op.op === "body") doc.body = op.value;
        else {
          const count = doc.body.split(op.find).length - 1;
          if (count === 0) return refuse(`The text “${op.find}” isn’t in the body.`);
          if (count > 1 && !op.all) return refuse(`“${op.find}” appears ${count} times; say which, or replace all.`);
          doc.body = op.all ? doc.body.split(op.find).join(op.replace) : doc.body.replace(op.find, op.replace);
        }
        raw = serializeKeepingFrontMatter(raw, doc, collection.format);
        applied++;
        return;
      }
      const data = doc.data as JsonValue;
      if (op.op === "set") {
        const before = getIn(data, op.path);
        const spliceable = collection.format !== "json" && typeof before === "string" && typeof op.value === "string" && safePlain(before) && safePlain(op.value) && doc.frontMatter.split(before).length === 2;
        const target = parentOf(data, op.path);
        if (!target) return refuse("That field doesn’t exist.");
        (target.parent as Record<string, JsonValue>)[target.key as string] = clone(op.value);
        if (spliceable) raw = raw.replace(before as string, op.value as string);
        else raw = serialize(doc.data, doc.body, collection.format);
        applied++;
        return;
      }
      const list = op.op === "unset" ? undefined : getIn(data, op.path);
      if (op.op === "unset") {
        const target = parentOf(data, op.path);
        if (!target) return refuse("That field doesn’t exist.");
        if (Array.isArray(target.parent)) target.parent.splice(Number(target.key), 1);
        else delete (target.parent as Record<string, JsonValue>)[String(target.key)];
      } else if (!Array.isArray(list)) {
        return refuse("That field isn’t a list.");
      } else if (op.op === "insert") {
        if (op.index < 0 || op.index > list.length) return refuse("That position is outside the list.");
        list.splice(op.index, 0, clone(op.value));
      } else if (op.op === "remove") {
        if (op.index < 0 || op.index >= list.length) return refuse("That item isn’t in the list.");
        list.splice(op.index, 1);
      } else if (op.op === "move") {
        if ([op.from, op.to].some((i) => i < 0 || i >= list.length)) return refuse("That position is outside the list.");
        const [item] = list.splice(op.from, 1);
        list.splice(op.to, 0, item as JsonValue);
      }
      raw = serialize(doc.data, doc.body, collection.format);
      applied++;
    });

    if (applied > 0) this.write(path, Buffer.from(raw), checkpoint);
    return { entry: this.readEntry(path), applied, refused };
  }

  createEntry(input: CreateEntryInput, checkpoint?: string): Entry {
    const collection = this.collections().find((c) => c.id === input.collection);
    if (!collection) throw new MockError("not-found", `There’s no collection called “${input.collection}”.`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(input.slug)) {
      throw new MockError("invalid", "Use lowercase words joined by hyphens for the address, like “spring-open-day”.");
    }
    const ext = collection.format === "json" ? "json" : collection.format === "mdx" ? "mdx" : "md";
    const path = `${collection.path.replace(/\/$/, "")}/${input.slug}.${ext}`;
    if (this.read(path)) throw new MockError("conflict", `A ${collection.singular} with the address “${input.slug}” already exists.`);
    this.write(path, Buffer.from(serialize(input.data, input.body ?? "", collection.format)), checkpoint);
    return this.readEntry(path);
  }

  deleteEntry(path: string): void {
    if (!this.read(path)) throw new MockError("not-found", "This page no longer exists.");
    this.write(path, null);
  }

  // ── changes ────────────────────────────────────────────────────────────

  private kindOf(path: string): ChangeKind {
    if (this.collectionOf(path)) return "content";
    if (IMAGE_EXT.test(path)) return "media";
    if (/(^|\/)(galley\.config\.json|package\.json|astro\.config\.\w+|tsconfig\.json)$/.test(path)) return "config";
    if (/\.(astro|tsx?|jsx?|css|scss|html)$/.test(path)) return "code";
    return "other";
  }

  changes(): ChangeSet {
    const files: FileChange[] = [];
    for (const [path, record] of this.files) {
      if (record.base && record.current && record.base.equals(record.current)) continue;
      const status = record.base === null ? "added" : record.current === null ? "deleted" : "modified";
      const kind = this.kindOf(path);
      const binary = IMAGE_EXT.test(path);
      const before = record.base?.toString("utf8") ?? "";
      const after = record.current?.toString("utf8") ?? "";
      const counts = binary ? { additions: 0, deletions: 0 } : tally(before, after);
      const change: FileChange = { path, status, kind, binary, ...counts, summary: "" };
      const collection = this.collectionOf(path);
      if (collection) {
        const summary = this.summary(path, collection);
        change.collection = collection.id;
        change.title = summary.title;
        change.url = summary.url;
        if (status === "modified") {
          const a = parseDoc(before, collection.format);
          const b = parseDoc(after, collection.format);
          change.fieldChanges = fieldChanges(a.data, b.data, collection);
          change.bodyChanged = (a.body ?? "") !== (b.body ?? "");
        }
      }
      if (kind === "media" && record.current) {
        change.media = { type: mimeOf(path), size: record.current.length, ...imageSize(path, record.current) };
      }
      change.summary = summarize(change, collection);
      files.push(change);
    }
    files.sort((a, b) => (this.files.get(b.path)?.modifiedAt ?? 0) - (this.files.get(a.path)?.modifiedAt ?? 0));
    return {
      branch: this.seed.branch,
      baseCommit: this.history[0]?.commit ?? null,
      files,
      totals: {
        files: files.length,
        additions: files.reduce((sum, f) => sum + f.additions, 0),
        deletions: files.reduce((sum, f) => sum + f.deletions, 0),
      },
    };
  }

  diff(path: string, siteUrl: (rev?: "base") => string): FileDiff {
    const record = this.files.get(path);
    if (!record || (record.base && record.current && record.base.equals(record.current))) throw new MockError("not-found", "That file has no unpublished changes.");
    const status = record.base === null ? "added" : record.current === null ? "deleted" : "modified";
    const binary = IMAGE_EXT.test(path);
    const before = record.base?.toString("utf8") ?? null;
    const after = record.current?.toString("utf8") ?? null;
    return {
      path,
      status,
      binary,
      before: binary ? null : before,
      after: binary ? null : after,
      hunks: binary ? [] : hunks(before ?? "", after ?? ""),
      beforeMediaUrl: binary && record.base ? siteUrl("base") : undefined,
      afterMediaUrl: binary && record.current ? siteUrl() : undefined,
    };
  }

  discard(paths?: string[]): void {
    const targets = paths ?? [...this.files.keys()];
    for (const path of targets) {
      const record = this.files.get(path);
      if (!record) continue;
      if (record.base === null) this.files.delete(path);
      else this.files.set(path, { ...record, current: record.base });
    }
  }

  publish(request: PublishRequest, author: { name: string; email: string }): PublishResult {
    const pending = this.changes().files.map((f) => f.path);
    const paths = request.paths ?? pending;
    if (paths.length === 0) return { ok: false, files: [], pushed: false, error: "Nothing to publish. Everything here already matches the live site." };
    for (const path of paths) {
      const record = this.files.get(path);
      if (!record) continue;
      if (record.current === null) this.files.delete(path);
      else this.files.set(path, { ...record, base: record.current });
    }
    const message = request.message ?? describeChanges(this.changesFor(paths, pending));
    const { commit, shortCommit } = newCommit();
    this.history.unshift({ commit, shortCommit, message, author: author.name, email: author.email, date: new Date().toISOString(), files: paths, viaGalley: true });
    const mode = request.mode ?? this.model().publish.mode;
    const push = this.push(false);
    return {
      ok: true,
      commit,
      branch: mode === "pull-request" ? `galley/${message.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}` : this.seed.branch,
      files: paths,
      ...push,
      pullRequestUrl: mode === "pull-request" && push.pushed ? "https://github.com/example/site/pull/new" : undefined,
    };
  }

  /**
   * Sending to the host. GALLEY_MOCK_PUSH=fail makes every send fail;
   * "flaky" fails the send that publishing does and lets "Send now" through.
   */
  private push(retry: boolean): Pick<PublishResult, "pushed" | "pushError" | "detail"> {
    if (!this.seed.remoteUrl) return { pushed: false };
    const mode = process.env.GALLEY_MOCK_PUSH ?? "ok";
    if (mode === "ok" || (mode === "flaky" && retry)) {
      this.unsent = 0;
      return { pushed: true };
    }
    this.unsent += retry ? 0 : 1;
    return { pushed: false, pushError: "The site’s host didn’t answer.", detail: "ssh: connect to host github.com port 22: Operation timed out\nfatal: Could not read from remote repository." };
  }

  /** POST …/send: versions published here that didn't reach the host. */
  send(): PublishResult {
    if (!this.seed.remoteUrl) return { ok: false, files: [], pushed: false, error: "This site isn’t connected to a host, so there’s nowhere to send versions." };
    const files = this.history.slice(0, this.unsent).flatMap((entry) => entry.files);
    if (this.unsent === 0) return { ok: true, files: [], pushed: true };
    const push = this.push(true);
    return { ok: push.pushed, files, ...push, ...(push.pushed ? {} : { error: push.pushError }) };
  }

  private changesFor(paths: string[], pending: string[]): string[] {
    // As the engine names a page in a commit: "Home page", not the home page's title.
    return paths.filter((p) => pending.includes(p)).map((p) => (this.collectionOf(p) ? commitName(this.summary(p)) : (p.split("/").pop() ?? p)));
  }

  revert(commit: string, author: { name: string; email: string }): PublishResult {
    const target = this.history.find((h) => h.commit === commit);
    if (!target) throw new MockError("not-found", "That version isn’t in the history any more.");
    const next = newCommit();
    this.history.unshift({ ...next, message: `Undo “${target.message}”`, author: author.name, email: author.email, date: new Date().toISOString(), files: target.files, viaGalley: true });
    return { ok: true, commit: next.commit, branch: this.seed.branch, files: target.files, ...this.push(false) };
  }

  git(): GitStatus {
    const last = this.history[0];
    return {
      branch: this.seed.branch,
      detached: false,
      hasRemote: Boolean(this.seed.remoteUrl),
      remote: this.seed.remoteUrl ? "origin" : undefined,
      remoteUrl: this.seed.remoteUrl,
      ahead: this.unsent,
      behind: this.behind,
      clean: this.changes().files.length === 0,
      lastCommit: last ? { commit: last.commit, message: last.message, date: last.date, author: last.author } : undefined,
      // The fixture sites publish as their last author would, chosen in App settings › You.
      author: { name: last?.author ?? "You", email: last?.email ?? "you@example.com", from: "app" },
    };
  }

  pull(): GitStatus {
    for (let i = 0; i < this.behind; i++) {
      const next = newCommit();
      this.history.unshift({ ...next, message: i === 0 ? "Update the footer links" : "Tidy image sizes", author: "A developer", email: "dev@example.com", date: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(), files: ["src/data/navigation.json"], viaGalley: false });
    }
    this.behind = 0;
    return this.git();
  }

  // ── media ──────────────────────────────────────────────────────────────

  media(): MediaItem[] {
    const { dir, publicPath } = this.model().media;
    const prefix = `${dir.replace(/\/$/, "")}/`;
    return [...this.files.entries()]
      .filter(([path, record]) => record.current !== null && path.startsWith(prefix) && IMAGE_EXT.test(path))
      .map(([path, record]) => ({
        path,
        url: `${publicPath.replace(/\/$/, "")}/${path.slice(prefix.length)}`,
        name: path.split("/").pop() ?? path,
        size: record.current?.length ?? 0,
        type: mimeOf(path),
        ...imageSize(path, record.current as Buffer),
        modifiedAt: record.modifiedAt,
        status: this.statusOf(path),
      }))
      .sort((a, b) => b.modifiedAt - a.modifiedAt);
  }

  saveMedia(filename: string, directory: string | undefined, bytes: Buffer): MediaItem {
    const dir = (directory ?? this.model().media.dir).replace(/\/$/, "");
    const clean = filename.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
    let path = `${dir}/${clean}`;
    for (let n = 2; this.read(path); n++) path = `${dir}/${clean.replace(/(\.[^.]+)$/, `-${n}$1`)}`;
    this.write(path, bytes);
    return this.media().find((item) => item.path === path) as MediaItem;
  }

  // ── search & resolve ───────────────────────────────────────────────────

  private strings(): Array<{ path: string; collection: Collection; field?: FieldPath; label: string; value: string; body?: boolean }> {
    const out: Array<{ path: string; collection: Collection; field?: FieldPath; label: string; value: string; body?: boolean }> = [];
    for (const collection of this.collections()) {
      for (const path of this.entryPathsOf(collection)) {
        const doc = parseDoc(this.read(path)?.toString("utf8") ?? "", collection.format);
        walkStrings(doc.data, [], (field, value) => out.push({ path, collection, field, value, label: labelFor(field, doc.data, collection) }));
        if (doc.body) for (const block of doc.body.split(/\n{2,}/)) if (block.trim()) out.push({ path, collection, label: "Body", value: block.trim(), body: true });
      }
    }
    return out;
  }

  search(q: string, collectionId?: string, limit = 20): SearchHit[] {
    const needle = q.toLowerCase();
    const hits: SearchHit[] = [];
    const seen = new Set<string>();
    for (const item of this.strings()) {
      if (collectionId && item.collection.id !== collectionId) continue;
      const at = item.value.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      const key = `${item.path}:${item.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const summary = this.summary(item.path, item.collection);
      const start = Math.max(0, at - 40);
      const excerpt = `${start > 0 ? "…" : ""}${stripInline(item.value.slice(start, at + needle.length + 60))}${at + needle.length + 60 < item.value.length ? "…" : ""}`;
      hits.push({
        path: item.path,
        collection: item.collection.id,
        title: summary.title,
        url: summary.url,
        location: item.body ? { kind: "body", start: 0, end: item.value.length, block: "paragraph" } : { kind: "field", field: item.field ?? [], label: item.label },
        excerpt,
      });
    }
    hits.sort((a, b) => Number(b.title.toLowerCase().includes(needle)) - Number(a.title.toLowerCase().includes(needle)));
    return hits.slice(0, limit);
  }

  resolve(request: ResolveRequest): ResolveResult {
    const wanted = stripInline(request.text).toLowerCase();
    const all = this.strings().filter((item) => stripInline(item.value).toLowerCase() === wanted);
    const onPage = all.filter((item) => this.summary(item.path, item.collection).url === request.urlPath);
    const pool = onPage.length > 0 ? onPage : all;
    const matches: SourceMatch[] = pool.map((item) => ({
      path: item.path,
      collection: item.collection.id,
      title: this.summary(item.path, item.collection).title,
      location: item.field ? { kind: "field", field: item.field, label: item.label } : { kind: "body", start: 0, end: item.value.length, block: "paragraph" },
      value: item.value,
      plain: item.value === request.text,
      editable: true,
    }));
    if (matches.length === 1) return { status: "unique", matches };
    if (matches.length > 1 && request.total === matches.length && request.occurrence !== undefined) {
      const match = matches[request.occurrence];
      if (match) return { status: "unique", matches: [match] };
    }
    if (matches.length > 1) return { status: "ambiguous", matches, reason: `That text appears ${matches.length} times.` };
    return { status: "none", matches: [], reason: "That text isn’t in any page’s content. It may be part of the site’s design." };
  }

  entryForUrl(url: string): EntrySummary | null {
    const normalized = url === "/" ? "/" : `/${url.replace(/^\/+|\/+$/g, "")}/`;
    for (const collection of this.collections()) {
      if (!collection.url) continue;
      for (const path of this.entryPathsOf(collection)) {
        const summary = this.summary(path, collection);
        if (summary.url === normalized) return summary;
      }
    }
    return null;
  }

  summaryInfo(): SiteSummary {
    return {
      id: this.id,
      name: this.name,
      root: this.root,
      framework: this.seed.framework,
      branch: this.seed.branch,
      remoteUrl: this.seed.remoteUrl,
      lastOpenedAt: this.lastOpenedAt,
      pendingChanges: this.seed.missing ? 0 : this.changes().files.length,
      missing: this.seed.missing,
    };
  }
}

function serializeKeepingFrontMatter(raw: string, doc: ParsedDoc, format: EntryFormat): string {
  if (format !== "markdown" && format !== "mdx") return serialize(doc.data, doc.body, format);
  const match = FRONT_MATTER.exec(raw);
  return match ? `---\n${match[1]}\n---\n\n${doc.body ?? ""}` : (doc.body ?? "");
}

function walkStrings(value: JsonValue, path: FieldPath, visit: (path: FieldPath, value: string) => void): void {
  if (typeof value === "string") visit(path, value);
  else if (Array.isArray(value)) value.forEach((item, index) => walkStrings(item, [...path, index], visit));
  else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) walkStrings(child, [...path, key], visit);
}

/** "Hero › Heading" for ["sections", 0, "heading"] — sections are named by their type. */
function labelFor(path: FieldPath, data: JsonValue, collection: Collection): string {
  const parts: string[] = [];
  let node: JsonValue | undefined = data;
  path.forEach((part, index) => {
    const next: JsonValue | undefined = node && typeof node === "object" ? (Array.isArray(node) ? node[Number(part)] : node[String(part)]) : undefined;
    if (typeof part === "number") {
      const type = next && typeof next === "object" && !Array.isArray(next) ? next.type : undefined;
      if (typeof type === "string") {
        parts.pop();
        parts.push(humanize(type));
      } else parts.push(`${parts.pop() ?? "Item"} ${part + 1}`);
    } else {
      const field = index === 0 ? collection.fields.find((f) => f.key === part) : undefined;
      parts.push(field?.label ?? humanize(part));
    }
    node = next;
  });
  return parts.join(" › ");
}

function fieldChanges(before: { [key: string]: JsonValue }, after: { [key: string]: JsonValue }, collection: Collection): FieldChange[] {
  const out: FieldChange[] = [];
  const walk = (a: JsonValue | undefined, b: JsonValue | undefined, path: FieldPath) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    const isObj = (v: JsonValue | undefined) => v !== null && typeof v === "object" && !Array.isArray(v);
    if (isObj(a) && isObj(b)) {
      const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
      for (const key of keys) walk((a as Record<string, JsonValue>)[key], (b as Record<string, JsonValue>)[key], [...path, key]);
      return;
    }
    if (Array.isArray(a) && Array.isArray(b) && [...a, ...b].some((item) => isObj(item))) {
      // Item by item, as the engine does: a moved section is one "moved" row, not an edit to every field it passed.
      const plan = planList(a, b);
      const rows: Array<{ at: number; rows: FieldChange[] }> = [];
      for (const pair of plan.pairs) {
        if (pair.exact && !pair.moved) continue;
        const itemPath = [...path, pair.to];
        const sub: FieldChange[] = [];
        if (pair.moved) sub.push({ field: itemPath, label: labelFor(itemPath, after, collection), kind: "moved", from: pair.from, to: pair.to });
        if (!pair.exact) {
          // Its own field changes, at its place now.
          const mark = out.length;
          walk(a[pair.from], b[pair.to], itemPath);
          sub.push(...out.splice(mark));
        }
        rows.push({ at: pair.to, rows: sub });
      }
      for (const to of plan.added) rows.push({ at: to, rows: [{ field: [...path, to], label: labelFor([...path, to], after, collection), kind: "added", after: b[to] }] });
      for (const from of plan.removed) rows.push({ at: from - 0.5, rows: [{ field: [...path, from], label: labelFor([...path, from], before, collection), kind: "removed", before: a[from] }] });
      for (const group of rows.sort((x, y) => x.at - y.at)) out.push(...group.rows);
      return;
    }
    const label = labelFor(path, b === undefined ? before : after, collection);
    out.push({ field: path, label, kind: a === undefined ? "added" : b === undefined ? "removed" : "changed", before: a, after: b });
  };
  walk(before, after, []);
  return out;
}

function summarize(change: FileChange, collection: Collection | null): string {
  if (change.status === "added") return change.kind === "media" ? "New image" : collection ? `New ${collection.singular}` : "New file";
  if (change.status === "deleted") return change.kind === "media" ? "Image removed" : collection ? `${humanize(collection.singular)} deleted` : "File deleted";
  const fields = change.fieldChanges ?? [];
  // Whole sections moved, added or removed are named; the rest are counted (as the engine's summary does).
  const items = fields.filter((field) => field.kind !== "changed" && typeof field.field[field.field.length - 1] === "number");
  if (items.length) {
    const phrases: string[] = [];
    for (const [kind, verb] of [["moved", "moved"], ["added", "added"], ["removed", "removed"]] as const) {
      const rows = items.filter((item) => item.kind === kind);
      if (rows.length === 1) phrases.push(`${verb} ${kind === "added" ? "a" : "the"} ${rows[0]!.label.split(" › ").pop()!.toLowerCase()}`);
      else if (rows.length > 1) phrases.push(`${verb} ${rows.length} sections`);
    }
    const others = fields.length - items.length;
    if (others > 0) phrases.push(`changed ${others} other ${others === 1 ? "field" : "fields"}`);
    if (change.bodyChanged) phrases.push("edited the text");
    const sentence = phrases.length > 1 ? `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}` : phrases[0]!;
    return sentence.charAt(0).toUpperCase() + sentence.slice(1);
  }
  const first = fields[0]?.label.split(" › ").pop()?.toLowerCase();
  if (first) {
    const rest = fields.length - 1 + (change.bodyChanged ? 1 : 0);
    return rest > 0 ? `Changed the ${first} and ${rest} other ${rest === 1 ? "field" : "fields"}` : `Changed the ${first}`;
  }
  if (change.bodyChanged) return "Edited the text";
  return change.kind === "media" ? "Image replaced" : "Edited";
}

export function describeChanges(titles: string[]): string {
  if (titles.length === 0) return "Publish changes";
  if (titles.length === 1) return `Update ${titles[0]}`;
  if (titles.length === 2) return `Update ${titles[0]} and ${titles[1]}`;
  return `Update ${titles[0]}, ${titles[1]} and ${titles.length - 2} more`;
}
