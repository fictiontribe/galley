/**
 * The change set: what differs between the working tree and the last commit
 * (Principle 2 — the working tree is the draft).
 */
import { structuredPatch } from "diff";
import { join } from "node:path";
import { GalleyError } from "../errors";
import type { ChangeKind, ChangeSet, ChangeStatus, DiffHunk, DiffLine, FileChange, FileDiff } from "../types";
import { countLines, isBinary, readIfExists } from "./files";
import { runGit, splitNul, type Git, type RepoInfo } from "./git";
import { imageFacts } from "./media";

export type PendingStatus = Exclude<ChangeStatus, "clean">;

/** Lets the caller add content knowledge to a raw file change. Receives both versions as text (null when absent or binary). */
export type ChangeEnricher = (
  file: FileChange,
  before: string | null,
  after: string | null
) => Promise<Partial<FileChange>> | Partial<FileChange>;

/** Hunks are not computed above this size; the diff reports `binary: true` with no text. */
export const MAX_DIFF_BYTES = 400 * 1024;
/** Text handed to an enricher is capped here; larger files are passed as null. */
const MAX_ENRICH_BYTES = 2 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────── status

/**
 * Parses `git status --porcelain=v1 -z`. Paths arrive relative to the repo's
 * top level; `prefix` (the site's position in the repo) is stripped and
 * anything outside it dropped.
 *
 * Relative to HEAD, which is the only comparison the product shows:
 *   untracked or newly staged           → added
 *   deleted in the index or the tree     → deleted
 *   a rename                             → the old path deleted + the new one added
 *   staged as new and then deleted again → nothing (it never existed at HEAD)
 *   anything else, conflicts included    → modified
 */
export function parsePorcelain(text: string, prefix: string): Map<string, PendingStatus> {
  const records = splitNul(text);
  const out = new Map<string, PendingStatus>();

  const put = (rawPath: string, status: PendingStatus) => {
    if (prefix && !rawPath.startsWith(prefix)) return;
    const path = rawPath.slice(prefix.length);

    if (!path) return;
    const previous = out.get(path);

    // `D ` and `?? ` for the same path: deleted from the index but present on
    // disk — the file exists at HEAD and now, so it is a modification.
    if (previous && previous !== status) out.set(path, "modified");
    else out.set(path, status);
  };

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i] ?? "";

    if (record.length < 4) continue;
    const x = record[0] ?? " ";
    const y = record[1] ?? " ";
    const path = record.slice(3);

    if (x === "!" && y === "!") continue;
    if (x === "?" && y === "?") {
      put(path, "added");
      continue;
    }
    if (x === "R" || x === "C") {
      const original = records[i + 1] ?? "";

      i += 1;
      put(path, y === "D" ? "deleted" : "added");
      if (x === "R" && original) put(original, "deleted");
      continue;
    }
    const unmerged = x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D");

    if (unmerged) put(path, "modified");
    else if (x === "A" && y === "D") continue;
    else if (x === "A") put(path, "added");
    else if (x === "D" || y === "D") put(path, "deleted");
    else put(path, "modified");
  }
  return out;
}

export async function readStatus(
  repo: Git,
  info: RepoInfo,
  paths?: string[]
): Promise<Map<string, PendingStatus>> {
  const args = ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"];
  const result = await repo.run(
    paths && paths.length > 0 ? [...args, "--", ...paths] : [...args, "--", "."],
    { readOnly: true, timeoutMs: 60_000 }
  );

  return parsePorcelain(result.text, info.prefix);
}

// ─────────────────────────────────────────────────────────────── classification

const MEDIA_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp", "tif", "tiff", "heic",
  "mp4", "webm", "mov", "m4v", "mp3", "wav", "ogg", "m4a",
  "woff", "woff2", "ttf", "otf", "eot",
  "pdf",
]);
const MARKDOWN_EXTENSIONS = new Set(["md", "mdx", "markdown", "mdoc"]);
const DATA_EXTENSIONS = new Set(["json", "yaml", "yml", "toml", "csv"]);
const CODE_EXTENSIONS = new Set([
  "js", "mjs", "cjs", "ts", "mts", "cts", "jsx", "tsx", "astro", "vue", "svelte",
  "css", "scss", "sass", "less", "styl", "pcss",
  "html", "htm", "njk", "liquid", "hbs", "handlebars", "ejs", "pug", "webc", "erb", "tmpl", "gohtml",
  "go", "rs", "py", "rb", "php", "sh", "lua",
]);
/** Directory names that conventionally hold content or data across frameworks. */
const CONTENT_DIRS = new Set([
  "content", "data", "_data", "_posts", "_drafts", "posts", "blog", "docs", "collections", "i18n", "locales",
]);
const ROOT_DOCS = /^(readme|changelog|contributing|license|licence|code_of_conduct|security)(\.|$)/i;

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function isConfigFile(path: string): boolean {
  const name = (path.slice(path.lastIndexOf("/") + 1) || path).toLowerCase();
  const atRoot = !path.includes("/");

  if (name === "package.json" || name === "galley.config.json") return true;
  if (/^[tj]sconfig(\..+)?\.json$/.test(name)) return true;
  if (/\.config\.[a-z0-9]+$/.test(name) || /^\.[\w-]+rc(\.[a-z]+)?$/.test(name)) return true;
  if (name === ".eleventy.js" || name === "_config.yml" || name === "_config.toml") return true;
  if (atRoot && /^(hugo|config|netlify|wrangler)\.(toml|ya?ml|json)$/.test(name)) return true;
  if (atRoot && /^(vercel\.json|\.gitignore|\.gitattributes|\.editorconfig|\.nvmrc|\.node-version|\.tool-versions)$/.test(name)) return true;
  return path.startsWith(".github/");
}

/**
 * Classifies by path and extension only. The facade refines this through the
 * enricher once it knows the site's collections.
 */
export function classifyKind(path: string): ChangeKind {
  const ext = extensionOf(path);
  const segments = path.split("/");
  const inContentDir = segments.slice(0, -1).some((segment) => CONTENT_DIRS.has(segment.toLowerCase()));

  if (MEDIA_EXTENSIONS.has(ext)) return "media";
  if (isConfigFile(path)) return "config";
  if (MARKDOWN_EXTENSIONS.has(ext)) return segments.length === 1 && ROOT_DOCS.test(path) ? "other" : "content";
  if (DATA_EXTENSIONS.has(ext)) return inContentDir ? "content" : "config";
  if (CODE_EXTENSIONS.has(ext)) return "code";
  return "other";
}

export function defaultSummary(status: PendingStatus, path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1) || path;

  return `${status === "added" ? "Added" : status === "deleted" ? "Removed" : "Changed"} ${name}`;
}

// ─────────────────────────────────────────────────────────────── base versions

/** Repo object name for a site path at HEAD, independent of the process cwd. */
function headSpec(info: RepoInfo, path: string): string {
  return `HEAD:${info.prefix}${path}`;
}

/** File bytes at HEAD; null when the file did not exist there (or there is no HEAD). */
export async function readBaseBlob(repo: Git, info: RepoInfo, path: string): Promise<Buffer | null> {
  const result = await repo.run(["cat-file", "blob", headSpec(info, path)], { allowFailure: true, readOnly: true });

  return result.code === 0 ? result.stdout : null;
}

/**
 * Many HEAD blobs through one `git cat-file --batch`, instead of one process
 * per file. Paths containing a newline cannot be expressed in batch input and
 * are fetched one at a time.
 */
export async function readBaseBlobs(repo: Git, info: RepoInfo, paths: string[]): Promise<Map<string, Buffer | null>> {
  const out = new Map<string, Buffer | null>();
  const batchable = paths.filter((p) => !p.includes("\n"));

  for (const path of paths.filter((p) => p.includes("\n"))) out.set(path, await readBaseBlob(repo, info, path));
  if (batchable.length === 0) return out;
  const result = await runGit(repo.root, ["cat-file", "--batch"], {
    input: batchable.map((p) => `${headSpec(info, p)}\n`).join(""),
    readOnly: true,
    timeoutMs: 120_000,
  });
  const buffer = result.stdout;
  let offset = 0;

  for (const path of batchable) {
    const newline = buffer.indexOf(10, offset);

    if (newline < 0) {
      out.set(path, null);
      continue;
    }
    const header = buffer.subarray(offset, newline).toString("utf8");
    const match = / blob (\d+)$/.exec(header);

    offset = newline + 1;
    if (!match) {
      // "<name> missing" (not in HEAD) or a non-blob such as a submodule.
      out.set(path, null);
      continue;
    }
    const size = Number(match[1]);

    out.set(path, Buffer.from(buffer.subarray(offset, offset + size)));
    offset += size + 1;
  }
  return out;
}

interface NumstatEntry {
  additions: number;
  deletions: number;
  binary: boolean;
}

async function readNumstat(repo: Git): Promise<Map<string, NumstatEntry>> {
  const result = await repo.run(
    ["diff", "HEAD", "--numstat", "-z", "--no-renames", "--no-ext-diff", "--no-textconv", "--relative", "--", "."],
    { readOnly: true, timeoutMs: 120_000 }
  );
  const out = new Map<string, NumstatEntry>();

  for (const record of splitNul(result.text)) {
    const match = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(record);

    if (!match) continue;
    const binary = match[1] === "-";

    out.set(match[3] ?? "", {
      additions: binary ? 0 : Number(match[1]),
      deletions: binary ? 0 : Number(match[2]),
      binary,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────── change set

export interface ChangeContext {
  root: string;
  repo: Git;
  info: RepoInfo;
  branch: string;
  head: string | null;
}

function textOrNull(bytes: Buffer | null): string | null {
  if (!bytes || bytes.length > MAX_ENRICH_BYTES || isBinary(bytes)) return null;
  return bytes.toString("utf8");
}

export async function buildChangeSet(
  context: ChangeContext,
  statuses: Map<string, PendingStatus>,
  enrich?: ChangeEnricher
): Promise<ChangeSet> {
  const paths = [...statuses.keys()].sort();
  const numstat = context.head && paths.length > 0 ? await readNumstat(context.repo) : new Map<string, NumstatEntry>();
  // Base versions are only needed to tell an enricher what was there before.
  const bases =
    enrich && context.head
      ? await readBaseBlobs(context.repo, context.info, paths.filter((p) => statuses.get(p) !== "added"))
      : new Map<string, Buffer | null>();
  const files: FileChange[] = [];

  for (const path of paths) {
    const status = statuses.get(path) as PendingStatus;
    const after = status === "deleted" ? null : await readIfExists(join(context.root, ...path.split("/"))).catch(() => null);
    const before = bases.get(path) ?? null;
    const counted = numstat.get(path);
    let additions = counted?.additions ?? 0;
    let deletions = counted?.deletions ?? 0;
    let binary = counted?.binary ?? false;

    if (!counted && after) {
      // Untracked files are not in `git diff HEAD`, and a repo with no
      // commits has no HEAD to diff against: count the lines ourselves.
      binary = isBinary(after);
      additions = binary ? 0 : countLines(after);
    } else if (after && !binary) {
      binary = isBinary(after);
    }
    let change: FileChange = {
      path,
      status,
      kind: classifyKind(path),
      binary,
      additions,
      deletions,
      summary: defaultSummary(status, path),
    };
    // What an image is now (a deleted one has nothing to describe).
    const media = after ? imageFacts(path, after) : null;

    if (media) change.media = media;

    if (enrich) {
      const extra = await enrich(change, binary ? null : textOrNull(before), binary ? null : textOrNull(after));

      change = { ...change, ...extra, path, status };
    }
    files.push(change);
  }
  return {
    branch: context.branch,
    baseCommit: context.head,
    files,
    totals: {
      files: files.length,
      additions: files.reduce((sum, f) => sum + f.additions, 0),
      deletions: files.reduce((sum, f) => sum + f.deletions, 0),
    },
  };
}

// ─────────────────────────────────────────────────────────────── diff

/**
 * jsdiff hunks → DiffHunk with line numbers on every line. Starts are
 * 1-based; an empty side reports start 1 with 0 lines.
 */
export function computeHunks(before: string, after: string): DiffHunk[] {
  const patch = structuredPatch("before", "after", before, after, undefined, undefined, { context: 3 });

  return patch.hunks.map((hunk) => {
    let oldNumber = hunk.oldStart;
    let newNumber = hunk.newStart;
    const lines: DiffLine[] = [];

    for (const raw of hunk.lines) {
      const marker = raw[0];
      // CRLF files: the \r is the line ending, not part of the text.
      const text = raw.slice(1).replace(/\r$/, "");

      if (marker === "\\") continue; // "\ No newline at end of file"
      if (marker === "+") lines.push({ type: "add", text, newNumber: newNumber++ });
      else if (marker === "-") lines.push({ type: "del", text, oldNumber: oldNumber++ });
      else lines.push({ type: "context", text, oldNumber: oldNumber++, newNumber: newNumber++ });
    }
    return {
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      lines,
    };
  });
}

/**
 * Before (HEAD) and after (working tree) of one file, with hunks.
 *
 * Binary files and files over MAX_DIFF_BYTES come back with `binary: true`,
 * `before`/`after` null and no hunks — the UI shows them as "can't be shown
 * as text" (and the server adds media URLs for images).
 */
export async function buildDiff(context: ChangeContext, path: string): Promise<FileDiff> {
  const before = context.head ? await readBaseBlob(context.repo, context.info, path) : null;
  const after = await readIfExists(join(context.root, ...path.split("/")));

  if (!before && !after) {
    throw new GalleyError("not-found", "That file doesn't exist, so there's nothing to compare.", path);
  }
  const status: PendingStatus = !before ? "added" : !after ? "deleted" : "modified";
  const tooLarge = (before?.length ?? 0) > MAX_DIFF_BYTES || (after?.length ?? 0) > MAX_DIFF_BYTES;
  const binary = (before ? isBinary(before) : false) || (after ? isBinary(after) : false);

  if (binary || tooLarge) return { path, status, binary: true, before: null, after: null, hunks: [] };
  const beforeText = before ? before.toString("utf8") : null;
  const afterText = after ? after.toString("utf8") : null;

  return {
    path,
    status,
    binary: false,
    before: beforeText,
    after: afterText,
    hunks: beforeText === afterText ? [] : computeHunks(beforeText ?? "", afterText ?? ""),
  };
}
