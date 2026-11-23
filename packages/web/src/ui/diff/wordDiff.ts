/**
 * Word-level proofing: what was inserted, what was struck, what stayed —
 * computed in the browser from the before and after text, then shaped for
 * reading (long unchanged stretches folded, line pairs matched up).
 */
import { diffWords } from "diff";
import type { DiffHunk, DiffLine } from "@galley/core/types";

export type ProofPart =
  | { kind: "same"; text: string }
  | { kind: "ins"; text: string }
  | { kind: "del"; text: string }
  /** A folded stretch of unchanged text (`text` is what it hides, for renderers that need positions). */
  | { kind: "gap"; words: number; text?: string };

/** Inserted, deleted and unchanged runs from `before` to `after`, in reading order. */
export function wordDiff(before: string, after: string): ProofPart[] {
  if (before === after) return before ? [{ kind: "same", text: before }] : [];
  const parts: ProofPart[] = [];
  for (const change of diffWords(before, after)) {
    const kind = change.added ? "ins" : change.removed ? "del" : "same";
    const last = parts[parts.length - 1];
    if (last && last.kind !== "gap" && last.kind === kind) last.text += change.value;
    else parts.push({ kind, text: change.value });
  }
  return parts;
}

const textOf = (parts: ProofPart[], kinds: Array<ProofPart["kind"]>): string =>
  parts.map((part) => (part.kind !== "gap" && kinds.includes(part.kind) ? part.text : "")).join("");

/**
 * 0–1: how much of the text survived. Above about a half, one line with
 * inline marks reads best; below it, a struck "before" over a new "after".
 */
export function similarity(parts: ProofPart[]): number {
  const kept = textOf(parts, ["same"]).replace(/\s+/g, "").length;
  const before = textOf(parts, ["same", "del"]).replace(/\s+/g, "").length;
  const after = textOf(parts, ["same", "ins"]).replace(/\s+/g, "").length;
  const longest = Math.max(before, after);
  return longest === 0 ? 1 : kept / longest;
}

/** Whether anything was inserted or deleted. */
export function hasChanges(parts: ProofPart[]): boolean {
  return parts.some((part) => part.kind === "ins" || part.kind === "del");
}

const WORD = /\S+\s*|\s+/g;
const words = (text: string): string[] => text.match(WORD) ?? [];
const wordCount = (text: string): number => (text.match(/\S+/g) ?? []).length;

/**
 * Folds unchanged stretches longer than `2 × context` words, keeping
 * `context` words either side of every change (only the side that touches a
 * change at the start and end). Short texts come back untouched.
 */
export function foldUnchanged(parts: ProofPart[], context = 8, minimumWords = 60): ProofPart[] {
  const total = parts.reduce((sum, part) => sum + (part.kind === "gap" ? part.words : wordCount(part.text)), 0);
  if (total < minimumWords) return parts;
  const out: ProofPart[] = [];
  parts.forEach((part, index) => {
    if (part.kind !== "same") {
      out.push(part);
      return;
    }
    const tokens = words(part.text);
    const count = wordCount(part.text);
    const first = index === 0;
    const last = index === parts.length - 1;
    const keepHead = first ? 0 : context;
    const keepTail = last ? 0 : context;
    if (count <= keepHead + keepTail + 2) {
      out.push(part);
      return;
    }
    let seen = 0;
    let head = "";
    let cut = 0;
    for (; cut < tokens.length && seen < keepHead; cut++) {
      head += tokens[cut];
      if (/\S/.test(tokens[cut] ?? "")) seen++;
    }
    let tail = "";
    let tailSeen = 0;
    let from = tokens.length;
    while (from > cut && tailSeen < keepTail) {
      from--;
      tail = (tokens[from] ?? "") + tail;
      if (/\S/.test(tokens[from] ?? "")) tailSeen++;
    }
    const hiddenText = tokens.slice(cut, from).join("");
    const hidden = wordCount(hiddenText);
    if (head) out.push({ kind: "same", text: head });
    if (hidden > 0) out.push({ kind: "gap", words: hidden, text: hiddenText });
    else if (hiddenText) out.push({ kind: "same", text: hiddenText });
    if (tail) out.push({ kind: "same", text: tail });
  });
  return out;
}

/** One rendered row of a file diff: a plain line, or a changed line with its word marks. */
export interface SourceRow {
  line: DiffLine;
  /** For a deleted line replaced by an added one (or the other way round): the words that differ. */
  parts?: ProofPart[];
}

/**
 * Lines of a hunk ready to proof. A run of deleted lines followed by a run of
 * added lines of the same length is read as "these lines were edited": each
 * pair gets word marks instead of two whole-line marks.
 */
export function proofHunk(hunk: DiffHunk): SourceRow[] {
  const rows: SourceRow[] = [];
  const lines = hunk.lines;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line) break;
    if (line.type !== "del") {
      rows.push({ line });
      index++;
      continue;
    }
    let delEnd = index;
    while (lines[delEnd]?.type === "del") delEnd++;
    let addEnd = delEnd;
    while (lines[addEnd]?.type === "add") addEnd++;
    const dels = lines.slice(index, delEnd);
    const adds = lines.slice(delEnd, addEnd);
    if (dels.length === adds.length) {
      const pairs = dels.map((del, at) => {
        const add = adds[at] as DiffLine;
        return { del, add, parts: wordDiff(del.text, add.text) };
      });
      if (pairs.every((pair) => similarity(pair.parts) >= 0.3)) {
        for (const pair of pairs) rows.push({ line: pair.del, parts: pair.parts.filter((part) => part.kind !== "ins") });
        for (const pair of pairs) rows.push({ line: pair.add, parts: pair.parts.filter((part) => part.kind !== "del") });
        index = addEnd;
        continue;
      }
    }
    for (const del of dels) rows.push({ line: del });
    for (const add of adds) rows.push({ line: add });
    index = addEnd;
  }
  return rows;
}
