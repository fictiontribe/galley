/**
 * Locating front matter. Offsets are always into the raw file text (a leading
 * byte-order mark included), so every edit can splice at an exact position.
 */
import type { FrontMatterRegion } from "../model";

export interface FrontMatterLocation extends FrontMatterRegion {
  /** Where the body starts: just past the closing fence and its line break. */
  bodyStart: number;
}

export const BOM = "﻿";

export function bomLength(raw: string): number {
  return raw.startsWith(BOM) ? 1 : 0;
}

/** The line break style a file uses, so inserted lines match their neighbours. */
export function lineBreakOf(text: string): "\n" | "\r\n" {
  const crlf = text.indexOf("\r\n");
  const lf = text.indexOf("\n");

  return crlf !== -1 && crlf === lf - 1 ? "\r\n" : "\n";
}

const OPENERS: Array<{ re: RegExp; syntax: FrontMatterRegion["syntax"]; close: RegExp }> = [
  { re: /^---[ \t]*(?:yaml|yml)?[ \t]*\r?\n/, syntax: "yaml", close: /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m },
  { re: /^---[ \t]*toml[ \t]*\r?\n/, syntax: "toml", close: /^---[ \t]*(?:\r?\n|$)/m },
  { re: /^---[ \t]*json[ \t]*\r?\n/, syntax: "json", close: /^---[ \t]*(?:\r?\n|$)/m },
  { re: /^\+\+\+[ \t]*\r?\n/, syntax: "toml", close: /^\+\+\+[ \t]*(?:\r?\n|$)/m },
];

/**
 * Hugo allows a bare JSON object as front matter. Its end is the brace that
 * balances the first one, found with a string-aware scan.
 */
function jsonObjectEnd(raw: string, from: number): number | null {
  let depth = 0;
  let inString = false;

  for (let i = from; i < raw.length; i += 1) {
    const char = raw[i];

    if (inString) {
      if (char === "\\") i += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return null;
}

export function findFrontMatter(raw: string): FrontMatterLocation | null {
  const offset = bomLength(raw);
  const head = raw.slice(offset);

  for (const opener of OPENERS) {
    const open = opener.re.exec(head);

    if (!open) continue;
    const start = offset + open[0].length;
    const close = opener.close.exec(raw.slice(start));

    if (!close) return null;
    const end = start + close.index;

    return {
      syntax: opener.syntax,
      start,
      end,
      text: raw.slice(start, end),
      bodyStart: end + close[0].length,
    };
  }

  if (head.startsWith("{")) {
    const end = jsonObjectEnd(raw, offset);

    if (end === null) return null;
    const after = /^[ \t]*(?:\r?\n|$)/.exec(raw.slice(end));

    if (!after) return null;
    return {
      syntax: "json",
      start: offset,
      end,
      text: raw.slice(offset, end),
      bodyStart: end + after[0].length,
    };
  }
  return null;
}
