/**
 * Format-preserving JSON edits. A small position-tracking parser finds every
 * value's byte range, so a change splices only the affected member or item;
 * the file's indentation, key order and trailing newline stay as they were.
 */
import type { JsonValue } from "../../types";
import { lineBreakOf } from "../document/front-matter";
import { ROOT_LIST_KEY } from "../document/parse";
import { deepEqual, isObject } from "../util/json";
import { expectedAfter, type DataOp } from "./expected";
import type { OpOutcome } from "./yaml/index";

interface JNode {
  kind: "object" | "array" | "scalar";
  start: number;
  end: number;
  members?: Array<{ key: string; keyStart: number; node: JNode }>;
  items?: JNode[];
}

class JsonScanError extends Error {}

function scan(text: string): JNode {
  let i = 0;
  const ws = () => {
    while (i < text.length && /[ \t\r\n]/.test(text[i]!)) i += 1;
  };
  const string = (): void => {
    i += 1;
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    if (text[i] !== '"') throw new JsonScanError("unterminated string");
    i += 1;
  };
  const value = (): JNode => {
    ws();
    const start = i;
    const char = text[i];

    if (char === "{") {
      i += 1;
      const members: NonNullable<JNode["members"]> = [];

      ws();
      if (text[i] === "}") {
        i += 1;
        return { kind: "object", start, end: i, members };
      }
      for (;;) {
        ws();
        const keyStart = i;

        if (text[i] !== '"') throw new JsonScanError("expected key");
        string();
        const key = JSON.parse(text.slice(keyStart, i)) as string;

        ws();
        if (text[i] !== ":") throw new JsonScanError("expected colon");
        i += 1;
        members.push({ key, keyStart, node: value() });
        ws();
        if (text[i] === ",") {
          i += 1;
          continue;
        }
        if (text[i] === "}") {
          i += 1;
          return { kind: "object", start, end: i, members };
        }
        throw new JsonScanError("expected , or }");
      }
    }
    if (char === "[") {
      i += 1;
      const items: JNode[] = [];

      ws();
      if (text[i] === "]") {
        i += 1;
        return { kind: "array", start, end: i, items };
      }
      for (;;) {
        items.push(value());
        ws();
        if (text[i] === ",") {
          i += 1;
          continue;
        }
        if (text[i] === "]") {
          i += 1;
          return { kind: "array", start, end: i, items };
        }
        throw new JsonScanError("expected , or ]");
      }
    }
    if (char === '"') {
      string();
      return { kind: "scalar", start, end: i };
    }
    const literal = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));

    if (!literal) throw new JsonScanError("unexpected character");
    i += literal[0].length;
    return { kind: "scalar", start, end: i };
  };
  const root = value();

  ws();
  if (i !== text.length) throw new JsonScanError("trailing content");
  return root;
}

interface Style {
  /** One level of indentation ("  ", "    " or "\t"); "" for single-line files. */
  unit: string;
  eol: string;
}

function detectStyle(text: string): Style {
  const eol = lineBreakOf(text);

  if (!/\n/.test(text.trim())) return { unit: "", eol };
  const indents = [...text.matchAll(/\n([ \t]+)["{[\]}\d\-tfn]/g)].map((match) => match[1]!);
  const tab = indents.find((indent) => indent.startsWith("\t"));

  if (tab) return { unit: "\t", eol };
  const smallest = indents.reduce((min, indent) => Math.min(min, indent.length), Number.POSITIVE_INFINITY);

  return { unit: Number.isFinite(smallest) ? " ".repeat(smallest) : "  ", eol };
}

function indentAt(text: string, offset: number): string {
  const start = text.lastIndexOf("\n", offset - 1) + 1;

  return /^[ \t]*/.exec(text.slice(start))![0];
}

function render(value: JsonValue, style: Style, base: string): string {
  if (style.unit === "") return JSON.stringify(value);
  const indent = style.unit === "\t" ? "\t" : style.unit.length;

  return JSON.stringify(value, null, indent)
    .split("\n")
    .map((line, index) => (index === 0 ? line : base + line))
    .join(style.eol);
}

function childAt(node: JNode, segment: string | number): JNode | undefined {
  if (node.kind === "object") return node.members!.find((member) => member.key === String(segment))?.node;
  if (node.kind === "array" && typeof segment === "number") return node.items![segment];
  return undefined;
}

const splice = (text: string, from: number, to: number, insert: string): string =>
  text.slice(0, from) + insert + text.slice(to);

function separator(text: string, container: JNode, style: Style, firstStart: number): string {
  const children = container.kind === "object" ? container.members!.map((member) => ({ start: member.keyStart, end: member.node.end })) : container.items!;

  if (children.length >= 2) return text.slice(children[0]!.end, children[1]!.start);
  if (style.unit === "" || !text.slice(container.start, container.end).includes("\n")) return ", ";
  return `,${style.eol}${indentAt(text, firstStart)}`;
}

function emptyContainer(text: string, container: JNode, inner: string, style: Style): string {
  const open = container.kind === "object" ? "{" : "[";
  const close = container.kind === "object" ? "}" : "]";

  if (style.unit === "") return `${open}${inner}${close}`;
  const base = indentAt(text, container.start);

  return `${open}${style.eol}${base}${style.unit}${inner}${style.eol}${base}${close}`;
}

function surgical(text: string, root: JNode, op: DataOp, style: Style): string | null {
  const path = op.path;
  let node: JNode | undefined = root;
  const chain: JNode[] = [root];

  for (const segment of path) {
    node = childAt(node, segment);
    if (!node) break;
    chain.push(node);
  }
  const exists = chain.length === path.length + 1;

  if (op.op === "set") {
    if (exists) {
      const target = chain[chain.length - 1]!;

      return splice(text, target.start, target.end, render(op.value, style, indentAt(text, target.start)));
    }
    // The deepest existing container gets the first missing key, holding the
    // rest of the path as nested objects.
    const container = chain[chain.length - 1]!;
    const depth = chain.length - 1;
    const last = path[depth]!;
    const value = path.slice(depth + 1).reduceRight<JsonValue>((inner, segment) => ({ [String(segment)]: inner }), op.value);

    if (container.kind === "scalar") {
      // A null placeholder ("seo": null) becomes the new object.
      return splice(text, container.start, container.end, render({ [String(last)]: value }, style, indentAt(text, container.start)));
    }

    if (container.kind === "object") {
      const members = container.members!;
      const childIndent = members.length > 0 ? indentAt(text, members[0]!.keyStart) : indentAt(text, container.start) + style.unit;
      const member = `${JSON.stringify(String(last))}: ${render(value, style, childIndent)}`;

      if (members.length === 0) return splice(text, container.start, container.end, emptyContainer(text, container, member, style));
      const lastMember = members[members.length - 1]!;

      return splice(text, lastMember.node.end, lastMember.node.end, `${separator(text, container, style, members[0]!.keyStart)}${member}`);
    }
    if (container.kind === "array" && last === container.items!.length && depth === path.length - 1) {
      return insert(text, container, container.items!.length, value, style);
    }
    return null;
  }
  if (op.op === "unset") {
    if (!exists || chain.length < 2) return null;
    const container = chain[chain.length - 2]!;

    if (container.kind !== "object") return null;
    const members = container.members!;
    const index = members.findIndex((member) => member.key === String(path[path.length - 1]));

    if (members.length === 1) return splice(text, container.start, container.end, "{}");
    if (index < members.length - 1) return splice(text, members[index]!.keyStart, members[index + 1]!.keyStart, "");
    return splice(text, members[index - 1]!.node.end, members[index]!.node.end, "");
  }
  if (!exists) return null;
  const list = chain[chain.length - 1]!;

  if (list.kind !== "array") return null;
  if (op.op === "insert") return insert(text, list, op.index, op.value, style);
  if (op.op === "remove") return removeAt(text, list, op.index);
  // move: lift the item's exact text out and put it back at the new index.
  const item = list.items![op.from]!;
  const itemText = text.slice(item.start, item.end);
  const without = removeAt(text, list, op.from);

  if (without === null) return null;
  const reparsed = scan(without);
  let again: JNode | undefined = reparsed;

  for (const segment of path) again = again ? childAt(again, segment) : undefined;
  if (!again || again.kind !== "array") return null;
  return insertRaw(without, again, op.to, itemText, style);
}

function insert(text: string, list: JNode, index: number, value: JsonValue, style: Style): string {
  const items = list.items!;
  const base = items.length > 0 ? indentAt(text, items[0]!.start) : indentAt(text, list.start) + style.unit;

  return insertRaw(text, list, index, render(value, style, base), style);
}

function insertRaw(text: string, list: JNode, index: number, rendered: string, style: Style): string {
  const items = list.items!;

  if (items.length === 0) return splice(text, list.start, list.end, emptyContainer(text, list, rendered, style));
  const sep = separator(text, list, style, items[0]!.start);

  if (index < items.length) return splice(text, items[index]!.start, items[index]!.start, `${rendered}${sep}`);
  const last = items[items.length - 1]!;

  return splice(text, last.end, last.end, `${sep}${rendered}`);
}

function removeAt(text: string, list: JNode, index: number): string | null {
  const items = list.items!;

  if (index < 0 || index >= items.length) return null;
  if (items.length === 1) return splice(text, list.start, list.end, "[]");
  if (index < items.length - 1) return splice(text, items[index]!.start, items[index + 1]!.start, "");
  return splice(text, items[index - 1]!.end, items[index]!.end, "");
}

/** Applies one data op to JSON text. */
export function applyJsonOp(text: string, op: DataOp, rootList: boolean): OpOutcome {
  let before: JsonValue;
  let root: JNode;

  try {
    before = JSON.parse(text.trim() === "" ? "{}" : text) as JsonValue;
    root = text.trim() === "" ? { kind: "object", start: 0, end: 0, members: [] } : scan(text);
  } catch {
    return { ok: false, reason: "This file has a formatting mistake, so it can't be changed safely. Fix it in the source view first." };
  }
  let path = op.path;

  if (rootList && Array.isArray(before)) {
    if (path[0] !== ROOT_LIST_KEY) return { ok: false, reason: `This file is a list; edit paths start with “${ROOT_LIST_KEY}”.` };
    path = path.slice(1);
  } else if (!isObject(before)) {
    return { ok: false, reason: "This file does not hold a set of fields, so its fields can't be edited one by one." };
  }
  const localOp = { ...op, path } as DataOp;
  const expected = expectedAfter(before, localOp);

  if (!expected.ok) return expected;
  if (!expected.changed) return { ok: true, text, changed: false };
  const style = detectStyle(text);
  let candidate: string | null = null;

  try {
    candidate = text.trim() === "" ? null : surgical(text, root, localOp, style);
  } catch {
    candidate = null;
  }
  if (candidate !== null) {
    try {
      if (deepEqual(JSON.parse(candidate) as JsonValue, expected.value)) return { ok: true, text: candidate, changed: true };
    } catch {
      // fall through to a full re-render
    }
  }
  // Nested creation (or an empty file): re-render the whole value in the file's own style.
  const trailing = /\r?\n$/.exec(text)?.[0] ?? (text.trim() === "" ? style.eol : "");
  const full = render(expected.value, style.unit === "" && text.trim() === "" ? { unit: "  ", eol: style.eol } : style, "") + trailing;

  return { ok: true, text: full, changed: true };
}
