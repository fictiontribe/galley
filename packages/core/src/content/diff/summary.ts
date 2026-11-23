/**
 * One plain sentence describing a file's change, for the Proof list:
 * "Changed the heading and 2 other fields.", "Moved the logo row, added an
 * FAQ section and changed 1 other field." No file, YAML or git words.
 */
import type { FieldChange } from "../../types";

export interface ChangeSummaryInput {
  status: "added" | "modified" | "deleted";
  title?: string;
  singular?: string;
  fieldChanges: FieldChange[];
  bodyChanged: boolean;
}

function lowerFirst(text: string): string {
  // Keep acronyms ("SEO title") and proper-looking words as written.
  if (/^[A-Z]{2,}\b/.test(text)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** "Hero › Heading" → "the heading"; "Sections › 2 (Feature grid)" → "the feature grid in sections". */
function nameOf(change: FieldChange): string {
  const parts = change.label.split(" › ");
  const last = parts[parts.length - 1] ?? change.label;
  const parent = parts.length > 1 ? parts[parts.length - 2]!.replace(/ \(.+\)$/, "") : null;
  const typed = /^(\d+) \((.+)\)$/.exec(last);

  if (typed) return `the ${lowerFirst(typed[2]!)}${parent ? ` in ${lowerFirst(parent)}` : ""}`;
  if (/^\d+$/.test(last)) return `item ${last}${parent ? ` of ${lowerFirst(parent)}` : ""}`;
  return `the ${lowerFirst(last)}`;
}

function quote(title: string): string {
  return `“${title}”`;
}

/** A row about a whole list item (moved, added or removed), as opposed to a field. */
function isItemRow(change: FieldChange): boolean {
  return change.kind !== "changed" && typeof change.field[change.field.length - 1] === "number";
}

const typedItem = (part: string) => /^\d+ \((.+)\)$/.exec(part)?.[1] ?? null;

/** "Sections" → "section", "Testimonials" → "testimonial", "Case studies" → "case study". */
function singular(list: string | null): string {
  if (!list) return "item";
  const word = lowerFirst(list);

  if (/ies$/.test(word)) return word.replace(/ies$/, "y");
  if (/[^s]s$/.test(word)) return word.slice(0, -1);
  return word;
}

/** "a" or "an" by sound, letters of an acronym read one by one (“an FAQ”). */
function article(phrase: string): "a" | "an" {
  if (/^[A-Z]{2,}\b/.test(phrase)) return /^[AEFHILMNORSX]/.test(phrase) ? "an" : "a";
  return /^[aeio]/i.test(phrase) ? "an" : "a";
}

/**
 * The item a row is about, the way an editor would say it: "the logo row",
 * "an FAQ section", "an item in the feature tabs". New items take "a/an" and
 * the list's own noun (an acronym or a plural type name doesn't read as a
 * thing on its own: "a metrics section"); items that existed take "the".
 */
function itemPhrase(change: FieldChange): string {
  const parts = change.label.split(" › ");
  const type = typedItem(parts[parts.length - 1] ?? "");
  const list = parts.length > 1 ? parts[parts.length - 2]! : null;
  const ownerPart = parts.length > 2 ? parts[parts.length - 3]! : null;
  const owner = ownerPart ? (typedItem(ownerPart) ?? ownerPart) : null;
  const noun = singular(list);

  if (type) {
    const name = lowerFirst(type);

    if (change.kind !== "added") return `the ${name}`;
    const phrase = name.endsWith(noun) ? name : `${name} ${noun}`;

    return `${article(phrase)} ${phrase}`;
  }
  const where = owner ? ` ${({ added: "to", removed: "from", moved: "in", changed: "in" } as const)[change.kind]} the ${lowerFirst(owner)}` : "";

  return `${article(noun)} ${noun}${where}`;
}

/** "2 sections" when every row is in the same list, "2 items" otherwise. */
function itemsPhrase(changes: FieldChange[]): string {
  const lists = new Set(changes.map((change) => change.label.split(" › ").slice(-2, -1)[0] ?? ""));
  const list = lists.size === 1 ? [...lists][0]! : "";

  return `${changes.length} ${list ? lowerFirst(list.replace(/^\d+ \((.+)\)$/, "$1")) : "items"}`;
}

/** "a, b and c" */
function listOf(phrases: string[]): string {
  if (phrases.length <= 1) return phrases.join("");
  return `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
}

export function summarizeChange(input: ChangeSummaryInput): string {
  const thing = input.singular ? `${input.singular} ` : "";

  if (input.status === "added") return input.title ? `Added the ${thing}${quote(input.title)}.` : `Added a new ${input.singular ?? "item"}.`;
  if (input.status === "deleted") return input.title ? `Deleted the ${thing}${quote(input.title)}.` : `Deleted a ${input.singular ?? "file"}.`;
  const changes = input.fieldChanges;

  if (changes.length === 0) return input.bodyChanged ? "Edited the main text." : "Made formatting changes only.";
  const items = changes.filter(isItemRow);

  if (items.length > 0) {
    // Whole sections moved, added or removed are named; the rest are counted.
    const phrases: string[] = [];

    for (const [kind, verb] of [
      ["moved", "moved"],
      ["added", "added"],
      ["removed", "removed"],
    ] as const) {
      const rows = items.filter((change) => change.kind === kind);

      if (rows.length === 1) phrases.push(`${verb} ${itemPhrase(rows[0]!)}`);
      else if (rows.length > 1) phrases.push(`${verb} ${itemsPhrase(rows)}`);
    }
    const others = changes.length - items.length;

    if (others > 0) phrases.push(`changed ${others} other ${others === 1 ? "field" : "fields"}`);
    if (input.bodyChanged) phrases.push("edited the main text");
    const sentence = listOf(phrases);

    return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
  }
  const kinds = new Set(changes.map((change) => change.kind));
  const verb = kinds.size === 1 ? ({ added: "Added", removed: "Removed", changed: "Changed", moved: "Moved" } as const)[changes[0]!.kind] : "Changed";
  const others = changes.length - 1;
  let sentence = `${verb} ${nameOf(changes[0]!)}`;

  if (others > 0) sentence += ` and ${others} other ${others === 1 ? "field" : "fields"}`;
  if (input.bodyChanged) sentence += `${others > 0 ? "," : ""} and edited the main text`;
  return `${sentence}.`;
}
