/**
 * Finding nodes and byte positions in a parsed YAML document. Everything here
 * reads; nothing writes.
 */
import { isAlias, isMap, isPair, isScalar, isSeq, parseDocument, type Document, type Node, type Pair, type YAMLMap, type YAMLSeq } from "yaml";

import type { FieldPath } from "../../../types";
import type { Layout } from "./render";

type AnyNode = Node;

/** One parse configuration for every read the editor makes, so offsets always agree. */
export function parseYaml(text: string): Document {
  return parseDocument(text, { keepSourceTokens: false });
}

export function lineStart(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

/** Offset of the line break ending the line that contains `offset` (before any "\r"). */
export function lineEnd(text: string, offset: number): number {
  const newline = text.indexOf("\n", offset);

  if (newline === -1) return text.length;
  return text[newline - 1] === "\r" ? newline - 1 : newline;
}

/** Offset just past the line break ending the line that contains `offset`. */
export function nextLineStart(text: string, offset: number): number {
  const newline = text.indexOf("\n", offset);

  return newline === -1 ? text.length : newline + 1;
}

export function column(text: string, offset: number): number {
  return offset - lineStart(text, offset);
}

function trimEnd(text: string, from: number, to: number): number {
  let end = to;

  while (end > from && /\s/.test(text[end - 1]!)) end -= 1;
  return end;
}

function rangeOf(node: AnyNode): [number, number, number] | null {
  const range = (node as { range?: [number, number, number] | null }).range;

  return Array.isArray(range) ? range : null;
}

export function startOf(node: AnyNode): number {
  return rangeOf(node)![0];
}

/**
 * Where a node's own text ends — the last non-space character of its value.
 * Collections end where their last child ends, so trailing comments and blank
 * lines after a block are never treated as part of it.
 */
export function endOf(text: string, node: AnyNode | null | undefined): number | null {
  if (!node) return null;
  const range = rangeOf(node);

  if (!range) return null;
  if (isScalar(node) || isAlias(node)) return trimEnd(text, range[0], range[1]);
  if ((isMap(node) || isSeq(node)) && !node.flow) {
    const items = node.items as Array<Pair | AnyNode>;
    const last = items[items.length - 1];

    if (last === undefined) return trimEnd(text, range[0], range[1]);
    if (isPair(last)) {
      const valueEnd = endOf(text, last.value as AnyNode | null);

      return valueEnd ?? endOf(text, last.key as AnyNode);
    }
    return endOf(text, last as AnyNode) ?? trimEnd(text, range[0], range[1]);
  }
  return trimEnd(text, range[0], range[1]);
}

export interface Step {
  /** The node reached at this depth (null when the path goes past what exists). */
  node: AnyNode | null;
  /** For map children: the pair that holds it. */
  pair?: Pair;
  /** The collection the node sits in. */
  parent: YAMLMap | YAMLSeq | null;
  segment: string | number | null;
}

export type Walk =
  | { ok: true; steps: Step[]; missingFrom: number | null }
  | { ok: false; reason: string };

const ALIAS_REASON =
  "This value is shared with another part of the file (it is written once and reused), so changing it here would change it there too. Edit the file's source instead.";

/**
 * Follows a path through the document. `missingFrom` is the index of the
 * first segment that does not exist (null when the whole path exists).
 */
export function walk(doc: Document, path: FieldPath): Walk {
  const steps: Step[] = [{ node: (doc.contents as AnyNode | null) ?? null, parent: null, segment: null }];

  for (let i = 0; i < path.length; i += 1) {
    const current = steps[steps.length - 1]!.node;
    const segment = path[i]!;

    if (current && isAlias(current)) return { ok: false, reason: ALIAS_REASON };
    if (current && (current as { anchor?: string }).anchor) return { ok: false, reason: ALIAS_REASON };
    if (current && isMap(current)) {
      const pair = (current.items as Pair[]).find((item) => {
        const key = item.key as AnyNode | null;

        return key && isScalar(key) ? String(key.value) === String(segment) : false;
      });

      if (!pair) return { ok: true, steps, missingFrom: i };
      steps.push({ node: (pair.value as AnyNode | null) ?? null, pair, parent: current, segment });
      continue;
    }
    if (current && isSeq(current) && typeof segment === "number") {
      const item = current.items[segment] as AnyNode | undefined;

      if (item === undefined) return { ok: true, steps, missingFrom: i };
      steps.push({ node: item ?? null, parent: current, segment });
      continue;
    }
    return { ok: true, steps, missingFrom: i };
  }
  const target = steps[steps.length - 1]!.node;

  if (target && (isAlias(target) || (target as { anchor?: string }).anchor)) {
    return { ok: false, reason: ALIAS_REASON };
  }
  return { ok: true, steps, missingFrom: null };
}

/** Whether any collection on the way down is a flow collection ({…} or […]). */
export function inFlow(steps: Step[], upTo: number): boolean {
  for (let i = 0; i <= upTo && i < steps.length; i += 1) {
    const node = steps[i]!.node;

    if (node && (isMap(node) || isSeq(node)) && node.flow) return true;
  }
  return false;
}

/** Whether a subtree holds an anchor that something else may point at. */
export function hasAnchor(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  if ((node as { anchor?: string }).anchor) return true;
  if (isAlias(node)) return true;
  if (isPair(node)) return hasAnchor(node.key) || hasAnchor(node.value);
  if (isMap(node) || isSeq(node)) return (node.items as unknown[]).some(hasAnchor);
  return false;
}

/** The layout conventions a file already follows (indent unit, sequence style). */
export function detectLayout(doc: Document, text: string, eol: "\n" | "\r\n"): Layout {
  let unit: number | null = null;
  let seqIndented: boolean | null = null;

  const visit = (node: unknown): void => {
    if (unit !== null && seqIndented !== null) return;
    if (isMap(node) && !node.flow) {
      for (const pair of node.items as Pair[]) {
        const key = pair.key as AnyNode | null;
        const value = pair.value as AnyNode | null;

        if (!key || !value || !rangeOf(key) || !rangeOf(value)) continue;
        const keyColumn = column(text, startOf(key));

        if (unit === null && isMap(value) && !value.flow && value.items.length > 0) {
          const delta = column(text, startOf(value)) - keyColumn;

          if (delta > 0 && lineStart(text, startOf(value)) !== lineStart(text, startOf(key))) unit = delta;
        }
        if (seqIndented === null && isSeq(value) && !value.flow && value.items.length > 0) {
          seqIndented = column(text, startOf(value)) > keyColumn;
        }
        visit(value);
      }
    } else if (isSeq(node) && !node.flow) {
      for (const item of node.items) visit(item);
    }
  };

  visit(doc.contents);
  return { unit: unit ?? 2, seqIndented: seqIndented ?? true, eol };
}

/** Offset of the "-" that introduces item `index` of a block sequence. */
export function dashOf(text: string, seq: YAMLSeq, index: number): number | null {
  const item = seq.items[index] as AnyNode | null | undefined;
  const seqStart = rangeOf(seq as unknown as AnyNode)?.[0];

  if (seqStart === undefined) return null;
  const seqColumn = column(text, seqStart);

  if (index === 0) return text[seqStart] === "-" ? seqStart : null;
  // Search backwards from the item's content for a "-" at the sequence's column.
  const anchor = item && rangeOf(item) ? startOf(item) : null;
  const previousEnd = endOf(text, seq.items[index - 1] as AnyNode | null);

  if (anchor === null && previousEnd === null) return null;
  let line = lineStart(text, anchor ?? nextLineStart(text, previousEnd!));

  for (let guard = 0; guard < 1000; guard += 1) {
    const candidate = line + seqColumn;

    if (text[candidate] === "-" && /^\s*$/.test(text.slice(line, candidate)) && /[\s]|$/.test(text[candidate + 1] ?? "")) {
      return candidate;
    }
    if (line === 0) return null;
    line = lineStart(text, line - 1);
  }
  return null;
}

/** Offset of the ":" that ends a block mapping key. */
export function colonAfterKey(text: string, pair: Pair): number | null {
  const key = pair.key as AnyNode | null;

  if (!key || !rangeOf(key)) return null;
  const keyEnd = endOf(text, key)!;
  const colon = text.indexOf(":", keyEnd);

  return colon === -1 ? null : colon;
}
