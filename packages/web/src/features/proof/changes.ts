/**
 * Pending changes said in content terms: grouped the way an editor thinks of
 * them, values described in words, and the questions a discard asks.
 */
import type { Collection, Field, FieldChange, FileChange, JsonValue } from "@galley/core/types";
import { entryName, plainFieldLabel } from "@/features/preview/clickToEdit";
import { count, fileName, friendlyLabel } from "@/lib/format";

export type ChangeGroupId = "content" | "media" | "code";

export interface ChangeGroup {
  id: ChangeGroupId;
  label: string;
  files: FileChange[];
}

const GROUP_LABELS: Record<ChangeGroupId, string> = { content: "Content", media: "Media", code: "Code & settings" };

/** Site-wide data (settings, navigation) counts as settings, not as a page. */
const isSettings = (change: FileChange, collections: Collection[]) => collections.some((collection) => collection.id === change.collection && collection.kind === "data");

export function groupOf(change: FileChange, collections: Collection[] = []): ChangeGroupId {
  if (change.kind === "content") return isSettings(change, collections) ? "code" : "content";
  if (change.kind === "media") return "media";
  return "code";
}

/** Content, then media, then code & settings; empty groups left out; titles A–Z within a group. */
export function groupChanges(files: FileChange[], collections: Collection[] = []): ChangeGroup[] {
  const order: ChangeGroupId[] = ["content", "media", "code"];
  return order
    .map((id) => ({
      id,
      label: GROUP_LABELS[id],
      files: files.filter((file) => groupOf(file, collections) === id).sort((a, b) => titleOf(a, collections).localeCompare(titleOf(b, collections)) || a.path.localeCompare(b.path)),
    }))
    .filter((group) => group.files.length > 0);
}

/**
 * The name a person knows the file by: "Home page", a page's title (short
 * form), the settings' own name ("Site", "Navigation"), an image's file name.
 */
export function titleOf(change: FileChange, collections: Collection[] = []): string {
  const data = collections.find((collection) => collection.id === change.collection && collection.kind === "data");
  if (data) return data.label;
  if (change.title) return entryName(change.path, change.title);
  if (change.kind === "media" || change.kind === "code" || change.kind === "config" || change.kind === "other") return fileName(change.path);
  return friendlyLabel(change.path);
}

/** The order the list shows, flattened — for keyboard movement and the default selection. */
export function orderedPaths(groups: ChangeGroup[]): string[] {
  return groups.flatMap((group) => group.files.map((file) => file.path));
}

const NAME_KEYS = ["heading", "title", "name", "label", "question", "text", "quote", "caption"];

/** Every section type's label on the site, by its type ("faq" → "FAQ"), from the collections' fields. */
export function sectionLabels(collections: readonly Collection[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (fields: readonly Field[] | undefined) => {
    for (const field of fields ?? []) {
      for (const block of field.blocks ?? []) {
        if (!out.has(block.type)) out.set(block.type, block.label);
        walk(block.fields);
      }
      walk(field.fields);
      if (field.of) walk([field.of]);
    }
  };
  for (const collection of collections) walk(collection.fields);
  return out;
}

/**
 * One value in words: "Yes", "3 items", "Hero · “Make more of the home…”".
 * A section is named by its type's label when the site gives one ("FAQ"),
 * else by its type made readable.
 */
export function describeValue(value: JsonValue | undefined, typeLabels?: ReadonlyMap<string, string>): string {
  if (value === undefined || value === null || value === "") return "Empty";
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    if (value.length === 0) return "None";
    if (value.every((item) => typeof item === "string" || typeof item === "number")) return value.join(", ");
    return value.length === 1 ? "1 item" : `${value.length} items`;
  }
  const type = typeof value.type === "string" ? value.type : typeof value._type === "string" ? value._type : null;
  const nameKey = NAME_KEYS.find((key) => typeof value[key] === "string" && value[key] !== "");
  const name = nameKey ? String(value[nameKey]) : null;
  const short = name && name.length > 60 ? `${name.slice(0, 57).trimEnd()}…` : name;
  const kind = type ? (typeLabels?.get(type) ?? `${type.charAt(0).toUpperCase()}${type.slice(1).replace(/[-_]/g, " ")}`) : null;
  if (kind && short) return `${kind} · “${short}”`;
  if (kind) return kind;
  if (short) return `“${short}”`;
  const keys = Object.keys(value).length;
  return keys === 1 ? "1 detail" : `${keys} details`;
}

/** Whether a value is text the word diff can proof (as opposed to a list or section). */
export function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

/** The markdown body of an entry file: everything after the front matter. */
export function bodyOf(text: string | null): string {
  if (!text) return "";
  const match = /^(?:﻿)?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return (match ? text.slice(match[0].length) : text).replace(/^\s*\n/, "");
}

const OPENERS: Array<{ open: RegExp; close: RegExp }> = [
  { open: /^---[ \t]*(?:yaml|yml)?[ \t]*\r?\n/, close: /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m },
  { open: /^---[ \t]*(?:toml|json)[ \t]*\r?\n/, close: /^---[ \t]*(?:\r?\n|$)/m },
  { open: /^\+\+\+[ \t]*\r?\n/, close: /^\+\+\+[ \t]*(?:\r?\n|$)/m },
];

/**
 * An entry file split exactly where its main text starts — the same
 * boundary the engine uses — so `head + body` is the file, byte for byte.
 * Null when the file's layout isn't one this can split safely.
 */
export function splitBody(text: string): { head: string; body: string } | null {
  const bom = text.startsWith("\uFEFF") ? 1 : 0;
  const rest = text.slice(bom);
  for (const { open, close } of OPENERS) {
    const opened = open.exec(rest);
    if (!opened) continue;
    const start = bom + opened[0].length;
    const closed = close.exec(text.slice(start));
    if (!closed) return null;
    const bodyStart = start + closed.index + closed[0].length;
    return { head: text.slice(0, bodyStart), body: text.slice(bodyStart) };
  }
  // Bare JSON front matter is left to the source view.
  if (rest.startsWith("{")) return null;
  return { head: text.slice(0, bom), body: rest };
}

/**
 * The whole file with its main text put back to the published one, keeping
 * every field as it is now. Null when there's nothing to put back or the
 * files can't be split safely.
 */
export function withPublishedBody(current: string, published: string): string | null {
  const now = splitBody(current);
  const then = splitBody(published);
  if (!now || !then || now.body === then.body) return null;
  return now.head + then.body;
}

/** Visible text of a stored value: Markdown emphasis and links reduced to their words. */
export function visibleOf(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_)(\S(?:[^*_]*\S)?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** The new text of the first changed field, as it shows on the page — to find it there. */
export function firstChangedText(change: FileChange): string | null {
  for (const field of change.fieldChanges ?? []) {
    if (field.kind !== "removed" && typeof field.after === "string" && field.after.trim()) return visibleOf(field.after);
  }
  return null;
}

export interface DiscardCopy {
  title: string;
  body: string;
  confirmLabel: string;
  busyLabel: string;
}

/** The confirmation for discarding one file's changes, per voice.md (a deleted file is put back). */
export function discardCopy(change: FileChange, collections: Collection[] = []): DiscardCopy {
  const title = titleOf(change, collections);
  if (change.status === "deleted") {
    return {
      title: `Put back ${title}?`,
      body: `${title} comes back as it was when it was last published.`,
      confirmLabel: "Put back",
      busyLabel: "Putting back…",
    };
  }
  if (change.status === "added") {
    return {
      title: `Discard ${title}?`,
      body: `${title} hasn’t been published, so it will be removed. Everything else stays as it is.`,
      confirmLabel: "Discard",
      busyLabel: "Discarding…",
    };
  }
  return {
    title: `Discard the changes to ${title}?`,
    body: `This removes your unpublished edits to ${title}. What’s already published stays as it is.`,
    confirmLabel: "Discard changes",
    busyLabel: "Discarding…",
  };
}

/** The label of a field change with its section part emphasised, per the specimen: <b>Hero</b> › Heading. */
export function labelParts(label: string): { lead: string; rest: string } {
  const plain = plainFieldLabel(label);
  const parts = plain.split(" › ");
  // A whole section reads by its name ("Logo row"), not its place in the list.
  if (parts.length < 2) return { lead: "", rest: plain };
  return { lead: parts.slice(0, -1).join(" › "), rest: parts[parts.length - 1] ?? "" };
}

/** Whether a change is about a whole list item (a section, a card) rather than one field. */
const isItem = (change: FieldChange) => change.kind !== "changed" && typeof change.field[change.field.length - 1] === "number";

/**
 * The note beside a change's name: "Added at 5", "Removed from 4", "Moved",
 * "Added"/"Removed" for a field; nothing for an edited field. Positions count
 * from 1, the way the form numbers sections.
 */
export function changeBadge(change: FieldChange): string | null {
  if (change.kind === "changed") return null;
  if (change.kind === "moved") return "Moved";
  const at = change.field[change.field.length - 1];
  if (!isItem(change) || typeof at !== "number") return change.kind === "added" ? "Added" : "Removed";
  return change.kind === "added" ? `Added at ${at + 1}` : `Removed from ${at + 1}`;
}

/**
 * What a move did, in positions counted from 1: "Moved from 2 to 3". When
 * something before it came or went, the number can stay the same while the
 * order around it changed — then it says so instead of "from 3 to 3".
 */
export function movedText(change: FieldChange): string {
  if (change.from === undefined || change.to === undefined) return "Moved";
  if (change.from === change.to) return `Changed order, still at ${change.to + 1}`;
  return `Moved from ${change.from + 1} to ${change.to + 1}`;
}

/**
 * What is waiting, in content terms rather than lines: "4 fields edited,
 * 1 new page, 1 image". Empty when there is nothing to add to the count.
 */
export function pendingSummary(files: readonly FileChange[]): string {
  const changesOf = (file: FileChange) => (file.status === "modified" ? (file.fieldChanges ?? []) : []);
  const moved = files.reduce((sum, file) => sum + changesOf(file).filter((change) => change.kind === "moved").length, 0);
  const fields = files.reduce((sum, file) => sum + changesOf(file).filter((change) => change.kind !== "moved").length, 0);
  const texts = files.filter((file) => file.status === "modified" && file.bodyChanged).length;
  const added = files.filter((file) => file.status === "added").length;
  const removed = files.filter((file) => file.status === "deleted").length;
  const parts: string[] = [];
  if (fields > 0) parts.push(`${count(fields, "field")} edited`);
  // A moved section isn't an edited field; say it as what it is.
  if (moved > 0) parts.push(`${count(moved, "item")} moved`);
  if (texts > 0) parts.push(`the text of ${count(texts, "page")} edited`);
  if (added > 0) parts.push(`${added.toLocaleString()} new`);
  if (removed > 0) parts.push(`${removed.toLocaleString()} removed`);
  return parts.join(", ");
}
