/**
 * Rendering values as YAML source text that will be spliced into a file.
 *
 * Scalars keep the style of the value they replace whenever that style can
 * hold the new value (a plain value stays plain, a single-quoted one stays
 * single-quoted, a folded block stays folded). Fresh structures are rendered
 * by the `yaml` package itself, so their syntax is correct by construction,
 * and then indented to the column they are inserted at.
 */
import { stringify } from "yaml";

import type { JsonValue } from "../../../types";
import { isObject } from "../../util/json";

export type ScalarStyle = "PLAIN" | "QUOTE_SINGLE" | "QUOTE_DOUBLE" | "BLOCK_LITERAL" | "BLOCK_FOLDED";

export interface Layout {
  /** Spaces per nesting level, as the file already uses. */
  unit: number;
  /** Whether block sequences under a key are indented ("key:\n  - a") or not ("key:\n- a"). */
  seqIndented: boolean;
  eol: "\n" | "\r\n";
}

const FLOW_INDICATORS = /[,[\]{}]/;
// Control characters other than tab cannot appear raw in quoted or plain scalars.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f\u0085\u2028\u2029]/;

/**
 * Words and numbers that YAML 1.1 parsers (still common in site tooling)
 * read as booleans, nulls, numbers or timestamps even though YAML 1.2 reads
 * them as strings. Written plain, a string field could silently change type.
 */
const YAML11_SPECIAL = /^(y|n|yes|no|on|off|true|false|null|~|[-+]?(\d[\d_]*(\.[\d_]*)?|\.\d+)([eE][-+]?\d+)?|[-+]?\d+(:[0-5]?\d)+(\.\d*)?|0x[0-9a-f_]+|0b[01_]+|0o?[0-7_]+|\d{4}-\d{1,2}-\d{1,2}([Tt ].*)?|[-+]?\.(inf|nan))$/i;

export const DATE_LIKE = /^\d{4}-\d{2}-\d{2}([Tt ][\d:.]+(Z|[-+]\d{2}(:?\d{2})?)?)?$/;

/** A plain rendering of `value`, or null when it would not read back as the same string. */
export function plainString(value: string, inFlow: boolean): string | null {
  if (value === "" || CONTROL.test(value) || /[\n\r\t]/.test(value)) return null;
  if (inFlow && FLOW_INDICATORS.test(value)) return null;
  if (YAML11_SPECIAL.test(value)) return null;
  // The yaml package already knows every rule for when a plain scalar is
  // safe (indicators, ": ", " #", values that would resolve to a number,
  // boolean or null). If it chooses to emit the value unquoted, it is safe.
  return stringify(value, { lineWidth: 0, minContentWidth: 0 }) === `${value}\n` ? value : null;
}

export function singleQuoted(value: string): string | null {
  if (CONTROL.test(value) || /[\n\r]/.test(value)) return null;
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * JSON's string escapes are a subset of YAML's double-quoted escapes. When
 * the value being replaced used YAML-only escapes (`\_` for a no-break
 * space, `\uXXXX` for non-ASCII), the new text follows the same convention
 * so an unchanged character keeps its unchanged spelling.
 */
export function doubleQuoted(value: string, original = ""): string {
  let out = JSON.stringify(value).replace(/[\u0085\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

  if (original.includes("\\_")) out = out.replace(/\u00a0/g, "\\_");
  if (/\\u[0-9a-fA-F]{4}/.test(original)) out = out.replace(/[^\u0000-\u007f\u00a0]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
  if (original.includes("\\/")) out = out.replace(/\//g, "\\/");
  return out;
}

export function renderNonString(value: number | boolean | null): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  return Number.isFinite(value) ? String(value) : value > 0 ? ".inf" : value < 0 ? "-.inf" : ".nan";
}

/** One-line rendering of a scalar in (or close to) the given style. */
export function renderInline(value: string | number | boolean | null, style: ScalarStyle, inFlow: boolean, original = ""): string {
  if (typeof value !== "string") return renderNonString(value);
  if (style === "QUOTE_DOUBLE") return doubleQuoted(value, original);
  if (style === "QUOTE_SINGLE") return singleQuoted(value) ?? doubleQuoted(value);
  return plainString(value, inFlow) ?? singleQuoted(value) ?? doubleQuoted(value);
}

export function renderKey(key: string, inFlow: boolean): string {
  const plain = plainString(key, inFlow);

  return plain !== null && !key.includes(":") ? plain : doubleQuoted(key);
}

/** A flow rendering ({ a: 1, b: [x, y] }) for values that sit inside flow collections. */
export function renderFlow(value: JsonValue, padded: boolean): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const inner = value.map((item) => renderFlow(item, padded)).join(", ");

    return padded ? `[ ${inner} ]` : `[${inner}]`;
  }
  if (isObject(value)) {
    const entries = Object.entries(value);

    if (entries.length === 0) return "{}";
    const inner = entries.map(([key, item]) => `${renderKey(key, true)}: ${renderFlow(item, padded)}`).join(", ");

    return padded ? `{ ${inner} }` : `{${inner}}`;
  }
  if (typeof value === "string") {
    if (/[\n\r]/.test(value)) return doubleQuoted(value);
    return renderInline(value, "PLAIN", true);
  }
  return renderNonString(value);
}

/**
 * Renders a value as standalone YAML lines (first line unindented), then
 * indents every following line by `column` spaces so the block can start at
 * that column of an existing line.
 */
export function renderBlock(value: JsonValue, column: number, layout: Layout): string {
  const text = stringify(value, {
    lineWidth: 0,
    minContentWidth: 0,
    indent: layout.unit,
    indentSeq: layout.seqIndented,
  }).replace(/\n$/, "");
  const pad = " ".repeat(column);

  return text
    .split("\n")
    .map((line, index) => (index === 0 || line === "" ? line : pad + line))
    .join(layout.eol);
}

export function isEmptyCollection(value: JsonValue): boolean {
  return (Array.isArray(value) && value.length === 0) || (isObject(value) && Object.keys(value).length === 0);
}

export function isCollection(value: JsonValue): value is JsonValue[] | { [key: string]: JsonValue } {
  return Array.isArray(value) || isObject(value);
}

/**
 * What follows a key's colon for a value: " value" on the same line, or a
 * line break and an indented block for a non-empty collection.
 */
export function renderAfterKey(value: JsonValue, keyColumn: number, layout: Layout, inFlow: boolean): string {
  if (inFlow) return ` ${renderFlow(value, true)}`;
  if (!isCollection(value) || isEmptyCollection(value)) {
    if (typeof value === "string" && /\n/.test(value)) return ` ${renderMultiline(value, keyColumn + layout.unit, layout)}`;
    return ` ${isCollection(value) ? renderFlow(value, false) : renderInline(value, "PLAIN", false)}`;
  }
  const column = Array.isArray(value) && !layout.seqIndented ? keyColumn : keyColumn + layout.unit;

  return `${layout.eol}${" ".repeat(column)}${renderBlock(value, column, layout)}`;
}

/** A multi-line string as a literal block (`|-`), falling back to a quoted line. */
export function renderMultiline(value: string, contentColumn: number, layout: Layout): string {
  const literal = literalBlock("|", "", value, " ".repeat(contentColumn), layout.eol);

  return literal ?? doubleQuoted(value);
}

interface BlockHeader {
  style: "|" | ">";
  /** Indentation indicator digit, when the original had one. */
  digit: string;
  /** Whether the original wrote the chomping indicator before the digit. */
  chompFirst: boolean;
  /** Anything after the indicators on the header line (a comment). */
  rest: string;
}

export function parseBlockHeader(header: string): BlockHeader | null {
  const match = /^([|>])([1-9]?)([+-]?)([1-9]?)(.*)$/.exec(header);

  if (!match) return null;
  return {
    style: match[1] as "|" | ">",
    digit: match[2] || match[4] || "",
    chompFirst: match[4] !== "" && match[2] === "",
    rest: match[5] ?? "",
  };
}

function chompFor(value: string): string | null {
  const trailing = /\n*$/.exec(value)![0].length;

  if (trailing === 0) return "-";
  if (trailing === 1) return "";
  // "Keep" chomping would make blank lines after the block part of the value;
  // a quoted string says the same thing without that hazard.
  return null;
}

function headerText(header: BlockHeader, chomp: string): string {
  const indicators = header.chompFirst ? chomp + header.digit : header.digit + chomp;

  return `${header.style}${indicators}${header.rest}`;
}

function literalBlock(style: "|", digit: string, value: string, indent: string, eol: string, rest = ""): string | null {
  const chomp = chompFor(value);
  const core = value.replace(/\n+$/, "");

  if (chomp === null || core === "" || /\r/.test(core) || CONTROL.test(core)) return null;
  const lines = core.split("\n");

  // A first line that starts with a space would be read as deeper indentation.
  if (/^[ \t]/.test(lines[0]!) && digit === "") return null;
  const body = lines.map((line) => (line === "" ? "" : indent + line)).join(eol);

  return `${style}${digit}${chomp}${rest}${eol}${body}`;
}

/**
 * Greedy word wrap at single spaces. Folded scalars join wrapped lines with a
 * single space, so this is lossless as long as no run of spaces is split.
 */
function wrap(paragraph: string, width: number): string[] {
  if (width <= 0 || paragraph.length <= width || /  /.test(paragraph)) return [paragraph];
  const lines: string[] = [];
  let line = "";

  for (const word of paragraph.split(" ")) {
    if (line === "") line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

/** One folded paragraph (no line breaks inside), wrapped at `width` when it is set. */
function foldedParagraph(paragraph: string, indent: string, eol: string, width: number): string | null {
  // Leading or trailing whitespace changes meaning under folding.
  if (/^[ \t]|[ \t]$/.test(paragraph)) return null;
  return wrap(paragraph, width).map((piece) => indent + piece).join(eol);
}

export interface BlockOriginal {
  header: string;
  /** Indentation of the original content lines. */
  indent: string;
  /** Wrap width the original used for folded text, or 0 to keep paragraphs on one line. */
  wrapWidth: number;
}

/** Re-renders a block scalar in its original style (literal or folded). */
export function renderBlockScalar(value: string, original: BlockOriginal, eol: string): string | null {
  const header = parseBlockHeader(original.header);

  if (!header) return null;
  const chomp = chompFor(value);
  const core = value.replace(/\n+$/, "");

  if (chomp === null || core === "" || /\r/.test(core) || CONTROL.test(core)) return null;
  if (header.style === "|") {
    const lines = core.split("\n");

    if (/^[ \t]/.test(lines[0]!) && header.digit === "") return null;
    return `${headerText(header, chomp)}${eol}${lines.map((line) => (line === "" ? "" : original.indent + line)).join(eol)}`;
  }
  // The folded blank-line rule above means "\n" in the value becomes one
  // blank line; the first line break of a pair separates the paragraphs.
  const body = foldedBodyExact(core, original.indent, eol, original.wrapWidth);

  return body === null ? null : `${headerText(header, chomp)}${eol}${body}`;
}

/**
 * Folded body where k consecutive line breaks in the value are written as k
 * blank lines between paragraphs.
 */
function foldedBodyExact(core: string, indent: string, eol: string, width: number): string | null {
  const parts = core.split(/(\n+)/);
  const out: string[] = [];

  for (const part of parts) {
    if (part.startsWith("\n")) {
      for (let i = 0; i < part.length; i += 1) out.push("");
      continue;
    }
    const body = foldedParagraph(part, indent, eol, width);

    if (body === null) return null;
    out.push(body);
  }
  return out.join(eol);
}

/**
 * Re-renders an edited folded block keeping every original source line that
 * still says the same thing: the unchanged lines before and after the edit
 * stay byte-identical and only the lines covering the changed words are
 * re-wrapped. `decode` reads a run of the original lines back as a value.
 */
export function preserveFolded(
  lines: string[],
  oldValue: string,
  newValue: string,
  indent: string,
  width: number,
  eol: string,
  decode: (lines: string[]) => string | null
): string | null {
  const n = lines.length;

  if (n < 2 || oldValue === newValue) return null;
  let prefixLines = 0;
  let prefixLength = 0;

  for (let i = n - 1; i >= 1; i -= 1) {
    const value = decode(lines.slice(0, i));

    if (value === null || !oldValue.startsWith(value) || !newValue.startsWith(value)) continue;
    const separator = /^( |\n+)/.exec(oldValue.slice(value.length))?.[0];

    if (!separator || !newValue.slice(value.length).startsWith(separator)) continue;
    prefixLines = i;
    prefixLength = value.length + separator.length;
    break;
  }
  let suffixLines = 0;
  let suffixLength = 0;

  for (let j = Math.max(prefixLines, 1); j < n; j += 1) {
    const value = decode(lines.slice(j));

    if (value === null || !oldValue.endsWith(value) || !newValue.endsWith(value)) continue;
    const separator = /( |\n+)$/.exec(oldValue.slice(0, oldValue.length - value.length))?.[0];

    if (!separator || !newValue.slice(0, newValue.length - value.length).endsWith(separator)) continue;
    if (prefixLength > newValue.length - value.length - separator.length) continue;
    suffixLines = n - j;
    suffixLength = value.length + separator.length;
    break;
  }
  if (prefixLines === 0 && suffixLines === 0) return null;
  const middle = newValue.slice(prefixLength, newValue.length - suffixLength);
  const breaksBefore = prefixLines > 0 ? (/\n+$/.exec(oldValue.slice(0, prefixLength))?.[0].length ?? 0) : 0;
  const breaksAfter = suffixLines > 0 ? (/^\n+/.exec(oldValue.slice(oldValue.length - suffixLength))?.[0].length ?? 0) : 0;

  if (middle === "" || /^\s|\s$/.test(middle)) return null;
  const rendered = foldedBodyExact(middle, indent, eol, width);

  if (rendered === null) return null;
  const out = [
    ...lines.slice(0, prefixLines),
    ...Array.from({ length: breaksBefore }, () => ""),
    rendered,
    ...Array.from({ length: breaksAfter }, () => ""),
    ...lines.slice(n - suffixLines),
  ];

  return out.join(eol);
}
