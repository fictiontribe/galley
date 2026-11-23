/**
 * Surgical YAML edits. Each function returns the new text with exactly one
 * region changed, or null when the shape is one it does not handle (the
 * caller then tries the Document API under a locality check, or refuses).
 *
 * The principle (Architecture, Principle 3): a scalar change rewrites that
 * scalar's bytes and nothing else; adding, removing or moving an item touches
 * only that item's lines.
 */
import { isMap, isScalar, isSeq, type Node, type Pair, type Scalar, type YAMLMap, type YAMLSeq } from "yaml";

import type { JsonValue } from "../../../types";
import { isScalarValue } from "../../util/json";
import { colonAfterKey, column, dashOf, endOf, inFlow, lineEnd, lineStart, nextLineStart, parseYaml, startOf, type Step } from "./locate";
import {
  doubleQuoted,
  isCollection,
  isEmptyCollection,
  renderAfterKey,
  renderBlock,
  renderBlockScalar,
  renderFlow,
  renderInline,
  renderKey,
  renderMultiline,
  preserveFolded,
  DATE_LIKE,
  type Layout,
  type ScalarStyle,
} from "./render";

const splice = (text: string, from: number, to: number, insert: string): string =>
  text.slice(0, from) + insert + text.slice(to);

/** The column a value's own content is laid out from: its key's, or its dash's. */
function ownerColumn(text: string, step: Step): number {
  if (step.pair?.key) return column(text, startOf(step.pair.key as Node));
  if (step.node && (step.node as { range?: unknown }).range) {
    const start = startOf(step.node);
    const before = text.slice(lineStart(text, start), start);
    const dash = before.lastIndexOf("-");

    return dash === -1 ? column(text, start) : dash;
  }
  return 0;
}

function isFlowNode(node: Node | null): boolean {
  return Boolean(node && (isMap(node) || isSeq(node)) && node.flow);
}

function flowPadded(text: string, node: Node): boolean {
  const start = startOf(node);

  return /^[[{] /.test(text.slice(start, start + 2));
}

/**
 * The quoting the other text values beside this one use: the most common
 * style among the string scalars sharing its map or list (plain wins ties
 * and is the answer when there are none). An emptied value had to be quoted
 * (`heading: ''`), so its own style says nothing about how the file is
 * written — this does.
 */
function siblingStyle(step: Step): ScalarStyle {
  const parent = step.parent;
  const children: unknown[] = parent ? (isMap(parent) ? parent.items.map((pair) => (pair as Pair).value) : isSeq(parent) ? parent.items : []) : [];
  const counts = new Map<ScalarStyle, number>();

  for (const child of children) {
    if (child === step.node || !isScalar(child) || typeof child.value !== "string" || child.value === "") continue;
    const style = (child.type ?? "PLAIN") as ScalarStyle;

    if (style === "PLAIN" || style === "QUOTE_SINGLE" || style === "QUOTE_DOUBLE") counts.set(style, (counts.get(style) ?? 0) + 1);
  }
  let best: ScalarStyle = "PLAIN";

  for (const [style, count] of counts) if (count > (counts.get(best) ?? 0)) best = style;
  return best;
}

/** Candidate renderings for a scalar replacing a scalar, best first. */
export function scalarCandidates(
  text: string,
  node: Scalar,
  value: string | number | boolean | null,
  step: Step,
  layout: Layout,
  flow: boolean
): string[] {
  const style = (node.type ?? "PLAIN") as ScalarStyle;
  const out: string[] = [];

  if (typeof value !== "string") return [renderInline(value, "PLAIN", flow)];
  // Restoring an emptied value: write it the way its neighbours are written
  // (plain when that is safe), not in the quotes the empty value needed.
  if ((style === "QUOTE_SINGLE" || style === "QUOTE_DOUBLE") && node.value === "" && value !== "") {
    out.push(renderInline(value, siblingStyle(step), flow));
  }
  // A plain date stays a plain date: date-aware parsers read it as a date,
  // and quoting it would quietly turn it into text.
  if (style === "PLAIN" && typeof node.value === "string" && DATE_LIKE.test(node.value) && DATE_LIKE.test(value)) out.push(value);
  if ((style === "BLOCK_LITERAL" || style === "BLOCK_FOLDED") && !flow) {
    const start = startOf(node);
    const headerEnd = lineEnd(text, start);
    const header = text.slice(start, headerEnd);
    const end = endOf(text, node)!;
    const sourceLines = text.slice(nextLineStart(text, start), end).split(/\r?\n/);
    const contentLines = sourceLines.filter((line) => line.trim() !== "");
    const indent =
      contentLines.length > 0
        ? /^ */.exec(contentLines[0]!)![0]
        : " ".repeat(ownerColumn(text, step) + layout.unit);
    const paragraphs = String(node.value ?? "").split(/\n+/).filter((line) => line !== "").length;
    // Re-wrap only when the original itself was wrapped.
    const wrapWidth =
      style === "BLOCK_FOLDED" && contentLines.length > paragraphs
        ? Math.max(40, ...contentLines.map((line) => line.trim().length))
        : 0;

    if (style === "BLOCK_FOLDED" && typeof node.value === "string" && /^>-/.test(header) && !/\n$/.test(value)) {
      const decode = (lines: string[]): string | null => {
        const doc = parseYaml(`v: >-\n${lines.join("\n")}\n`);
        const decoded = doc.errors.length === 0 ? (doc.toJS() as { v?: unknown }).v : null;

        return typeof decoded === "string" ? decoded : null;
      };
      const kept = preserveFolded(sourceLines, node.value, value, indent, wrapWidth, layout.eol, decode);

      if (kept !== null) out.push(`${header}${layout.eol}${kept}`);
    }
    const block = renderBlockScalar(value, { header, indent, wrapWidth }, layout.eol);

    if (block !== null) out.push(block);
  }
  const originalText = text.slice(startOf(node), endOf(text, node)!);

  if (style === "QUOTE_DOUBLE") out.push(doubleQuoted(value, originalText));
  if (/\n/.test(value) && !flow) {
    out.push(renderMultiline(value, ownerColumn(text, step) + layout.unit, layout));
  }
  if (style === "BLOCK_LITERAL" || style === "BLOCK_FOLDED") {
    out.push(renderInline(value, /\n/.test(value) ? "QUOTE_DOUBLE" : "PLAIN", flow));
  } else {
    out.push(renderInline(value, style, flow, originalText));
  }
  out.push(doubleQuoted(value));
  return [...new Set(out)];
}

/** Replaces one scalar's text. `rendered` comes from scalarCandidates. */
export function spliceScalar(text: string, node: Scalar, rendered: string): string {
  const start = startOf(node);
  const end = endOf(text, node)!;

  // An empty value ("key:") has an empty range right after the colon.
  if (start === end) return splice(text, start, end, text[start - 1] === ":" ? ` ${rendered}` : rendered);
  return splice(text, start, end, rendered);
}

/**
 * Replaces any node with any value: a collection with a scalar, a scalar
 * with a collection, one collection with another.
 */
export function replaceNode(text: string, steps: Step[], value: JsonValue, layout: Layout): string | null {
  const step = steps[steps.length - 1]!;
  const node = step.node;
  const flow = inFlow(steps, steps.length - 2) || (isFlowNode(node) && isCollection(value));

  if (!node || !(node as { range?: unknown }).range) return null;
  if (steps.length === 1) return null;
  const start = startOf(node);
  const end = endOf(text, node)!;

  if (flow) {
    const padded = isFlowNode(node) ? flowPadded(text, node) : true;
    const rendered = renderFlow(value, padded);

    return start === end && text[start - 1] === ":" ? splice(text, start, end, ` ${rendered}`) : splice(text, start, end, rendered);
  }
  const blockValue = isCollection(value) && !isEmptyCollection(value);
  const nodeIsBlockCollection = (isMap(node) || isSeq(node)) && !node.flow && node.items.length > 0;

  if (step.pair) {
    const colon = colonAfterKey(text, step.pair);

    if (colon === null) return null;
    const keyColumn = column(text, startOf(step.pair.key as Node));

    if (blockValue && nodeIsBlockCollection && isMap(node) === !Array.isArray(value)) {
      // Same kind of block collection: lay the new one out where the old one sat.
      return splice(text, start, end, renderBlock(value, column(text, start), layout));
    }
    if (!isCollection(value) && typeof value === "string" && /\n/.test(value)) {
      return splice(text, colon + 1, end, ` ${renderMultiline(value, keyColumn + layout.unit, layout)}`);
    }
    return splice(text, colon + 1, end, renderAfterKey(value, keyColumn, layout, false));
  }
  // A sequence item: "- value" or the compact "- key: value" form.
  const itemColumn = column(text, start);

  if (!isCollection(value) || isEmptyCollection(value)) {
    const rendered =
      typeof value === "string" && /\n/.test(value)
        ? renderMultiline(value, itemColumn, layout)
        : isCollection(value)
          ? renderFlow(value, false)
          : renderInline(value as string | number | boolean | null, "PLAIN", false);

    return splice(text, start, end, rendered);
  }
  return splice(text, start, end, renderBlock(value, itemColumn, layout));
}

/** Adds `key: value` to an existing mapping. */
export function addKey(text: string, steps: Step[], map: YAMLMap | null, key: string, value: JsonValue, layout: Layout): string | null {
  if (map === null || !(map as { range?: unknown }).range) {
    // Empty document (front matter "---\n---"): the new key is the whole map.
    if (text.trim() !== "" && !/^(\s*#.*\r?\n?)*\s*$/.test(text)) return null;
    const lead = text === "" || /\n$/.test(text) ? "" : layout.eol;

    return `${text}${lead}${renderKey(key, false)}:${renderAfterKey(value, 0, layout, false)}${layout.eol}`;
  }
  if (map.flow) {
    const items = map.items as Pair[];
    const last = items[items.length - 1];
    const pairText = `${renderKey(key, true)}: ${renderFlow(value, flowPadded(text, map as unknown as Node))}`;

    if (!last) {
      const open = startOf(map as unknown as Node);

      return splice(text, open + 1, open + 1, pairText);
    }
    const lastEnd = endOf(text, (last.value as Node | null) ?? (last.key as Node))!;

    return splice(text, lastEnd, lastEnd, `, ${pairText}`);
  }
  const items = map.items as Pair[];
  const first = items[0];

  if (!first?.key) return null;
  const keyColumn = column(text, startOf(first.key as Node));
  const end = endOf(text, map as unknown as Node);

  if (end === null) return null;
  const at = lineEnd(text, end);
  const line = `${layout.eol}${" ".repeat(keyColumn)}${renderKey(key, false)}:${renderAfterKey(value, keyColumn, layout, inFlow(steps, steps.length - 1))}`;

  return splice(text, at, at, line);
}

/** Removes one key (and its value) from a mapping. */
export function removeKey(text: string, steps: Step[], layout: Layout): string | null {
  const step = steps[steps.length - 1]!;
  const pair = step.pair;
  const map = step.parent;

  if (!pair || !map || !isMap(map)) return null;
  const items = map.items as Pair[];
  const index = items.indexOf(pair);
  const keyStart = startOf(pair.key as Node);
  const pairEnd = endOf(text, (pair.value as Node | null) ?? (pair.key as Node))!;

  if (map.flow) {
    if (items.length === 1) return splice(text, keyStart, pairEnd, "");
    if (index < items.length - 1) return splice(text, keyStart, startOf(items[index + 1]!.key as Node), "");
    const previous = items[index - 1]!;
    const previousEnd = endOf(text, (previous.value as Node | null) ?? (previous.key as Node))!;

    return splice(text, previousEnd, pairEnd, "");
  }
  const prefix = text.slice(lineStart(text, keyStart), keyStart);

  if (/^[ \t]*$/.test(prefix)) {
    if (items.length === 1 && steps.length > 2) {
      // The last key of a nested map: leave an explicit empty map behind.
      return replaceNode(text, steps.slice(0, -1), {}, layout);
    }
    const from = lineStart(text, keyStart);
    let to = nextLineStart(text, pairEnd);

    // Keep blank-line spacing even: don't leave two blank lines where one was.
    if ((from === 0 || /^\r?\n$/.test(text.slice(lineStart(text, from - 1), from))) && /^\r?\n/.test(text.slice(to))) {
      to = nextLineStart(text, to);
    }
    return splice(text, from, to, "");
  }
  // Compact sequence item ("- key: value"): the next key moves up beside the dash.
  if (index < items.length - 1) return splice(text, keyStart, startOf(items[index + 1]!.key as Node), "");
  if (items.length === 1) return splice(text, keyStart, pairEnd, "{}");
  return null;
}

/** Inserts `value` at `index` of a sequence. */
export function insertItem(text: string, seq: YAMLSeq, index: number, value: JsonValue, layout: Layout): string | null {
  const items = seq.items as Array<Node | null>;

  if (seq.flow) {
    const rendered = renderFlow(value, flowPadded(text, seq as unknown as Node));

    if (items.length === 0) {
      const open = startOf(seq as unknown as Node);

      return splice(text, open + 1, open + 1, rendered);
    }
    if (index < items.length) {
      const at = startOf(items[index]!);

      return splice(text, at, at, `${rendered}, `);
    }
    const lastEnd = endOf(text, items[items.length - 1])!;

    return splice(text, lastEnd, lastEnd, `, ${rendered}`);
  }
  if (items.length === 0) return null;
  const seqColumn = column(text, startOf(seq as unknown as Node));
  const content = isScalarValue(value)
    ? typeof value === "string" && /\n/.test(value)
      ? renderMultiline(value, seqColumn + 2, layout)
      : renderInline(value, "PLAIN", false)
    : isEmptyCollection(value)
      ? renderFlow(value, false)
      : renderBlock(value, seqColumn + 2, layout);
  const itemText = `${" ".repeat(seqColumn)}- ${content}`;

  if (index < items.length) {
    const dash = dashOf(text, seq, index);

    if (dash === null || !/^[ \t]*$/.test(text.slice(lineStart(text, dash), dash))) return null;
    const at = lineStart(text, dash);

    return splice(text, at, at, `${itemText}${layout.eol}`);
  }
  const lastEnd = endOf(text, items[items.length - 1]);

  if (lastEnd === null) return null;
  const at = lineEnd(text, lastEnd);

  return splice(text, at, at, `${layout.eol}${itemText}`);
}

/** The exact lines an item occupies: from its dash's line start to past its last line break. */
export function itemLines(text: string, seq: YAMLSeq, index: number): { from: number; to: number } | null {
  const dash = dashOf(text, seq, index);

  if (dash === null || !/^[ \t]*$/.test(text.slice(lineStart(text, dash), dash))) return null;
  const end = endOf(text, seq.items[index] as Node | null) ?? dash + 1;

  return { from: lineStart(text, dash), to: nextLineStart(text, end) };
}

/** Removes item `index` of a sequence. */
export function removeItem(text: string, steps: Step[], seq: YAMLSeq, index: number, layout: Layout): string | null {
  const items = seq.items as Array<Node | null>;

  if (items.length === 1) return replaceNode(text, steps, [], layout);
  if (seq.flow) {
    const start = startOf(items[index]!);

    if (index < items.length - 1) return splice(text, start, startOf(items[index + 1]!), "");
    const previousEnd = endOf(text, items[index - 1])!;

    return splice(text, previousEnd, endOf(text, items[index])!, "");
  }
  const lines = itemLines(text, seq, index);

  if (!lines) return null;
  if (index === items.length - 1 && lines.to >= text.length && !/\n$/.test(text)) {
    // Last item at the very end of the text: take the line break before it instead.
    const before = text.lastIndexOf("\n", lines.from - 1);
    const from = before > 0 && text[before - 1] === "\r" ? before - 1 : before;

    return splice(text, Math.max(from, 0), lines.to, "");
  }
  let to = lines.to;

  if ((lines.from === 0 || /^\r?\n$/.test(text.slice(lineStart(text, lines.from - 1), lines.from))) && /^\r?\n/.test(text.slice(to))) {
    to = nextLineStart(text, to);
  }
  return splice(text, lines.from, to, "");
}

/** Moves an item's exact lines to a new position; the item's bytes are untouched. */
export function moveItem(
  text: string,
  path: Array<string | number>,
  seq: YAMLSeq,
  from: number,
  to: number,
  layout: Layout
): string | null {
  if (seq.flow) return null;
  const lines = itemLines(text, seq, from);

  if (!lines) return null;
  let chunk = text.slice(lines.from, lines.to);

  if (!/\n$/.test(chunk)) chunk += layout.eol;
  // Removing the item and re-reading tells us where the target position is now.
  const without = text.slice(0, lines.from) + text.slice(lines.to);
  const fresh = parseYaml(without);
  const target = path.length === 0 ? fresh.contents : fresh.getIn(path, true);

  if (fresh.errors.length > 0 || !target || !isSeq(target) || target.flow) return null;
  if (to < target.items.length) {
    const lineSpan = itemLines(without, target, to);

    if (!lineSpan) return null;
    return splice(without, lineSpan.from, lineSpan.from, chunk);
  }
  const lastEnd = endOf(without, target.items[target.items.length - 1] as Node | null);

  if (lastEnd === null) return null;
  const at = nextLineStart(without, lastEnd);

  if (at >= without.length && !/\n$/.test(without)) {
    return `${without}${layout.eol}${chunk.replace(/\r?\n$/, "")}`;
  }
  return splice(without, at, at, chunk);
}
