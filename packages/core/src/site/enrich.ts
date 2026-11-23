/**
 * Turning raw file changes into the human proof: which page changed, which
 * fields, in the form's own words — and the default publish message built
 * from the same facts.
 */
import { buildEntry, collectionForPath, diffFields, formatForPath, parseDocument, summarizeChange } from "../content/index";
import type { ChangeEnricher } from "../workspace/index";
import { isMediaFile } from "../workspace/index";
import type { ChangeKind, ChangeSet, Collection, FileChange, SiteModel } from "../types";
import { joinWords, plural } from "./util";

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|heic)$/i;
const VIDEO = /\.(mp4|webm|mov|m4v)$/i;

function mediaNoun(path: string): string {
  if (IMAGE.test(path)) return "image";
  if (VIDEO.test(path)) return "video";
  if (/\.pdf$/i.test(path)) return "PDF";
  return "file";
}

function leaf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

/** The media root a path sits under, if any. "" roots (the whole site) never count. */
export function mediaRootOf(model: SiteModel, path: string): { dir: string; publicPath: string } | null {
  for (const root of model.media.roots) {
    const dir = root.dir.replace(/^\.?\/+|\/+$/g, "");

    if (dir !== "" && path.startsWith(`${dir}/`)) return root;
  }
  return null;
}

function mediaSummary(status: FileChange["status"], path: string): string {
  const verb = status === "added" ? "Added" : status === "deleted" ? "Removed" : "Replaced";

  return `${verb} the ${mediaNoun(path)} ${leaf(path)}`;
}

function contentChange(model: SiteModel, collection: Collection, file: FileChange, before: string | null, after: string | null): Partial<FileChange> {
  const format = formatForPath(file.path) ?? collection.format;
  const beforeDoc = before !== null ? parseDocument(before, format) : null;
  const afterDoc = after !== null ? parseDocument(after, format) : null;
  // The title comes from the version that exists: the new one, or the old one when deleted.
  const shown = after ?? before;
  const entry = shown !== null ? buildEntry(model, file.path, shown, { mtimeMs: 0 }) : null;
  const fieldChanges = diffFields(collection, beforeDoc?.data ?? null, afterDoc?.data ?? null);
  const bodyChanged =
    file.status === "modified" ? (beforeDoc?.body ?? null) !== (afterDoc?.body ?? null) : Boolean((afterDoc ?? beforeDoc)?.body?.trim());
  const out: Partial<FileChange> = {
    kind: "content",
    collection: collection.id,
    fieldChanges,
    bodyChanged,
    url: entry?.url ?? null,
    summary: summarizeChange({
      status: file.status,
      ...(entry ? { title: entry.title } : {}),
      singular: collection.singular,
      fieldChanges,
      bodyChanged,
    }),
  };

  if (entry) out.title = entry.title;
  return out;
}

export function createEnricher(model: () => SiteModel): ChangeEnricher {
  return (file, before, after) => {
    const current = model();
    const collection = collectionForPath(current, file.path);

    if (collection && formatForPath(file.path) !== null) return contentChange(current, collection, file, before, after);
    if (mediaRootOf(current, file.path) && isMediaFile(file.path)) return { kind: "media", summary: mediaSummary(file.status, file.path) };
    return {};
  };
}

const KIND_ORDER: Record<ChangeKind, number> = { content: 0, media: 1, code: 2, config: 3, other: 4 };

/** Content first (by title), then media, then code and config — the order a person reads a proof in. */
export function sortChanges(set: ChangeSet): ChangeSet {
  const files = [...set.files].sort((a, b) => {
    const kind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];

    if (kind !== 0) return kind;
    if (a.kind === "content") {
      return (a.title ?? a.path).localeCompare(b.title ?? b.path, undefined, { sensitivity: "base", numeric: true }) || a.path.localeCompare(b.path);
    }
    return a.path.localeCompare(b.path);
  });

  return { ...set, files };
}

/**
 * A short name for a page in a publish message. Entry titles are often long
 * SEO titles ("Lowfield Studio — architecture for…"); a commit subject wants
 * "Home" or "Pricing".
 */
function shortName(file: FileChange): string {
  const slug = file.path.replace(/\.[^./]+$/, "").split("/");
  const last = slug[slug.length - 1] === "index" || slug[slug.length - 1] === "_index" ? slug[slug.length - 2] : slug[slug.length - 1];

  if (file.url === "/") return "Home";
  if (file.title && file.title.length <= 40) return file.title;
  const words = (last ?? leaf(file.path)).replace(/[-_]+/g, " ").trim();

  return words ? words.charAt(0).toUpperCase() + words.slice(1) : leaf(file.path);
}

function names(files: FileChange[]): string {
  const shown = files.slice(0, 3).map(shortName);

  return files.length > 3 ? `${shown.join(", ")} and ${files.length - 3} more` : joinWords(shown);
}

/** "Update Home and Pricing; add 2 images" — the default publish message. */
export function describeChanges(files: FileChange[]): string {
  const content = files.filter((file) => file.kind === "content");
  const media = files.filter((file) => file.kind === "media");
  const rest = files.filter((file) => file.kind !== "content" && file.kind !== "media");
  const clauses: string[] = [];
  const byStatus = (list: FileChange[], status: FileChange["status"]) => list.filter((file) => file.status === status);

  if (byStatus(content, "modified").length) clauses.push(`update ${names(byStatus(content, "modified"))}`);
  if (byStatus(content, "added").length) clauses.push(`add ${names(byStatus(content, "added"))}`);
  if (byStatus(content, "deleted").length) clauses.push(`remove ${names(byStatus(content, "deleted"))}`);
  for (const [status, verb] of [["added", "add"], ["modified", "replace"], ["deleted", "remove"]] as const) {
    const list = byStatus(media, status);

    if (list.length === 0) continue;
    const nouns = new Set(list.map((file) => mediaNoun(file.path)));
    const noun = nouns.size === 1 ? [...nouns][0]! : "file";

    clauses.push(`${verb} ${plural(list.length, noun)}`);
  }
  if (rest.length) clauses.push(`change ${plural(rest.length, "site file")}`);
  if (clauses.length === 0) return "";
  const sentence = clauses.join("; ");

  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
