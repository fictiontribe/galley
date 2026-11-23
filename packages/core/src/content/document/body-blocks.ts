/**
 * Splits a markdown body into the leaf blocks a person edits — headings,
 * paragraphs, list items, code, quotes, tables, HTML, rules — each with its
 * exact byte range, so an edit can be spliced in without touching anything
 * around it.
 *
 * This is a line scanner, not a full CommonMark parser: it only has to find
 * block boundaries reliably, and it errs toward bigger, untouchable blocks
 * (a fenced code block is never split; MDX `import`/`export` and JSX are their
 * own non-inline blocks).
 */
import type { BodyBlock, BodyBlockKind } from "../model";
import { collapseWhitespace, decodeEntities, stripTags, visibleText } from "../util/text";

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const ATX_HEADING = /^( {0,3})(#{1,6})(?:[ \t]+|$)(.*?)(?:[ \t]+#+[ \t]*)?$/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const RULE = /^ {0,3}((\*[ \t]*){3,}|(-[ \t]*){3,}|(_[ \t]*){3,})$/;
const BULLET = /^(\s*)([-*+])([ \t]+)(.*)$/;
const ORDERED = /^(\s*)(\d{1,9}[.)])([ \t]+)(.*)$/;
const EMPTY_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])[ \t]*$/;
const HTML_OPEN = /^ {0,3}<(\/?[a-zA-Z][a-zA-Z0-9.:-]*|!--)/;
const MDX_ESM = /^(import|export)\s/;
const MDX_EXPRESSION = /^\s*\{/;
const TABLE_DIVIDER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const INDENTED_CODE = /^( {4}|\t)/;
const TASK = /^\[[ xX]\][ \t]/;

interface Line {
  text: string;
  /** Offset of the first character. */
  start: number;
  /** Offset just past the last character, excluding the line break. */
  end: number;
}

function sliceLines(body: string): Line[] {
  const lines: Line[] = [];
  let offset = 0;

  for (const piece of body.split("\n")) {
    const text = piece.endsWith("\r") ? piece.slice(0, -1) : piece;

    lines.push({ text, start: offset, end: offset + text.length });
    offset += piece.length + 1;
  }
  return lines;
}

const blank = (line: Line | undefined): boolean => line === undefined || line.text.trim() === "";
const isListLine = (text: string): boolean =>
  BULLET.test(text) || ORDERED.test(text) || EMPTY_ITEM.test(text);

function closesFence(text: string, marker: string): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(text);

  return Boolean(match && match[1]![0] === marker[0] && match[1]!.length >= marker.length);
}

const LABELS: Record<BodyBlockKind, string> = {
  heading: "Heading",
  paragraph: "Paragraph",
  "list-item": "List item",
  code: "Code block",
  quote: "Quote",
  table: "Table",
  html: "Embedded HTML",
  rule: "Divider",
};

function textFor(kind: BodyBlockKind, content: string): string {
  switch (kind) {
    case "code":
      return content;
    case "rule":
      return "";
    case "quote":
      return visibleText(content.replace(/^ {0,3}> ?/gm, ""));
    case "html":
      return collapseWhitespace(decodeEntities(stripTags(content)));
    default:
      return visibleText(content);
  }
}

interface Pending {
  kind: BodyBlockKind;
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  level?: number;
  /** Not retypable whatever the text looks like (MDX, task items). */
  locked?: boolean;
}

function makeBlock(body: string, key: string, pending: Pending): BodyBlock {
  const raw = body.slice(pending.start, pending.end);
  const content = body.slice(pending.contentStart, pending.contentEnd);
  const text = textFor(pending.kind, content);
  const retypable = pending.kind === "heading" || pending.kind === "paragraph" || pending.kind === "list-item";
  // Hard line breaks (two trailing spaces, a trailing backslash) render as a
  // break a retyped string cannot express.
  const hardBreak = /( {2,}|\\)\r?\n/.test(content);
  const block: BodyBlock = {
    key,
    kind: pending.kind,
    start: pending.start,
    end: pending.end,
    raw,
    text,
    inline: retypable && !pending.locked && !hardBreak && collapseWhitespace(content) === text,
    contentStart: pending.contentStart,
    contentEnd: pending.contentEnd,
    label: pending.kind === "heading" ? `Heading ${pending.level ?? 2}` : LABELS[pending.kind],
  };

  if (pending.level !== undefined) block.level = pending.level;
  return block;
}

/** Where a run of non-blank lines ends (exclusive line index). */
function runEnd(lines: Line[], from: number): number {
  let end = from;

  while (end < lines.length && !blank(lines[end])) end += 1;
  return end;
}

/**
 * Where a list ends: item lines, their indented continuations, and single
 * blank lines between loose items.
 */
function listEnd(lines: Line[], from: number): number {
  let index = from;
  let lastContent = from;

  while (index < lines.length) {
    const text = lines[index]!.text;

    if (text.trim() === "") {
      const next = lines[index + 1]?.text;

      if (next === undefined || !(isListLine(next) || /^\s{2,}\S/.test(next))) break;
      index += 1;
      continue;
    }
    if (index > from && !isListLine(text) && !/^\s+\S/.test(text)) {
      // A lazy continuation line only belongs to the item if no blank line
      // separated it; otherwise it starts a new paragraph.
      if (blank(lines[index - 1])) break;
      if (FENCE.test(text) || ATX_HEADING.test(text) || QUOTE.test(text) || RULE.test(text)) break;
    }
    index += 1;
    lastContent = index;
  }
  return lastContent;
}

export function enumerateBodyBlocks(body: string): BodyBlock[] {
  const lines = sliceLines(body);
  const blocks: BodyBlock[] = [];
  let blockIndex = 0;
  let i = 0;

  const emit = (pending: Pending): void => {
    blocks.push(makeBlock(body, `body.${blockIndex}`, pending));
    blockIndex += 1;
  };
  const span = (kind: BodyBlockKind, from: number, to: number, extra: Partial<Pending> = {}): Pending => {
    const start = lines[from]!.start;
    const end = lines[Math.max(from, to - 1)]!.end;

    return { kind, start, end, contentStart: start, contentEnd: end, ...extra };
  };

  while (i < lines.length) {
    const line = lines[i]!;
    const text = line.text;

    if (text.trim() === "") {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(text);

    if (fence && !(fence[2]![0] === "`" && fence[3]!.includes("`"))) {
      let end = i + 1;

      while (end < lines.length && !closesFence(lines[end]!.text, fence[2]!)) end += 1;
      if (end < lines.length) end += 1;
      emit(span("code", i, end));
      i = end;
      continue;
    }

    if (MDX_ESM.test(text)) {
      // An MDX import/export runs until a blank line (multi-line imports included).
      const end = runEnd(lines, i);

      emit(span("html", i, end, { locked: true }));
      i = end;
      continue;
    }

    const heading = ATX_HEADING.exec(text);

    if (heading) {
      const prefix = heading[1]!.length + heading[2]!.length;
      const inner = heading[3]!;
      const contentStart = inner === "" ? line.end : line.start + text.indexOf(inner, prefix);

      emit({
        kind: "heading",
        start: line.start,
        end: line.end,
        contentStart,
        contentEnd: contentStart + inner.length,
        level: heading[2]!.length,
      });
      i += 1;
      continue;
    }

    if (RULE.test(text)) {
      emit(span("rule", i, i + 1));
      i += 1;
      continue;
    }

    if (QUOTE.test(text)) {
      const end = runEnd(lines, i);

      emit(span("quote", i, end));
      i = end;
      continue;
    }

    if (isListLine(text)) {
      const end = listEnd(lines, i);
      let item = 0;
      let at = i;
      const listKey = blockIndex;

      blockIndex += 1;
      while (at < end) {
        const match = BULLET.exec(lines[at]!.text) ?? ORDERED.exec(lines[at]!.text);

        if (!match) {
          at += 1;
          continue;
        }
        const indent = match[1]!.length;
        const markerWidth = indent + match[2]!.length + match[3]!.length;
        const start = lines[at]!.start + markerWidth;
        let last = at;
        let next = at + 1;

        // Continuation: following lines until the next item at the same or a
        // shallower indent. Deeper items stay inside this item's text.
        while (next < end) {
          const candidate = lines[next]!.text;
          const sub = BULLET.exec(candidate) ?? ORDERED.exec(candidate);

          if (sub && sub[1]!.length <= indent) break;
          if (candidate.trim() !== "") last = next;
          next += 1;
        }
        const itemEnd = lines[last]!.end;
        const locked = TASK.test(match[4]!);

        blocks.push(
          makeBlock(body, `body.${listKey}.${item}`, {
            kind: "list-item",
            start,
            end: itemEnd,
            contentStart: start,
            contentEnd: itemEnd,
            locked,
          })
        );
        item += 1;
        at = next;
      }
      i = end;
      continue;
    }

    if (i + 1 < lines.length && text.includes("|") && TABLE_DIVIDER.test(lines[i + 1]!.text)) {
      const end = runEnd(lines, i);

      emit(span("table", i, end));
      i = end;
      continue;
    }

    if (HTML_OPEN.test(text) || MDX_EXPRESSION.test(text)) {
      const end = runEnd(lines, i);

      emit(span("html", i, end, { locked: true }));
      i = end;
      continue;
    }

    if (INDENTED_CODE.test(text) && (i === 0 || blank(lines[i - 1]))) {
      let end = i + 1;
      let last = i;

      while (end < lines.length && (INDENTED_CODE.test(lines[end]!.text) || blank(lines[end]))) {
        if (!blank(lines[end])) last = end;
        end += 1;
      }
      emit(span("code", i, last + 1));
      i = last + 1;
      continue;
    }

    // Paragraph: up to a blank line or a block that interrupts paragraphs.
    let end = i + 1;

    while (end < lines.length) {
      const next = lines[end]!.text;

      if (next.trim() === "") break;
      if (SETEXT_UNDERLINE.test(next)) {
        emit({
          kind: "heading",
          start: line.start,
          end: lines[end]!.end,
          contentStart: line.start + (text.length - text.trimStart().length),
          contentEnd: lines[end - 1]!.end,
          level: next.trim().startsWith("=") ? 1 : 2,
        });
        end += 1;
        break;
      }
      if (ATX_HEADING.test(next) || FENCE.test(next) || RULE.test(next) || QUOTE.test(next)) break;
      if (HTML_OPEN.test(next) && /^ {0,3}<\/?(div|section|table|figure|details|aside|iframe|pre|p|ul|ol|blockquote)\b/i.test(next)) break;
      end += 1;
    }
    const last = blocks[blocks.length - 1];

    if (!(last && last.kind === "heading" && last.start === line.start)) {
      emit(span("paragraph", i, end));
    }
    i = end;
  }
  return blocks;
}
