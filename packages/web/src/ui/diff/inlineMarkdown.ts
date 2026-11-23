/**
 * Proof marks over stored text, shown the way the text reads on the page.
 *
 * Stored values often carry inline Markdown (`*home you already have*`,
 * `[our studio](/about/)`). The proof compares the stored characters word by
 * word — that stays exact — and this module decides how each character is
 * shown: emphasis markers and link brackets are hidden and their text styled,
 * a link's address is kept, quietly, beside its words. A change that touched
 * only markers (emphasis added or removed) shows those markers as stored, so
 * no change ever disappears from the proof.
 */
import type { ProofPart } from "./wordDiff";

export interface InlineStyle {
  strong?: boolean;
  em?: boolean;
  code?: boolean;
  /** Link text. */
  link?: boolean;
  /** A link's address, shown quietly beside its text. */
  address?: boolean;
}

export interface CharInfo {
  /** A Markdown marker (`*`, `[`, `](`, a backslash before an escaped character). */
  hidden: boolean;
  style: InlineStyle;
}

const MASK = "\u0001";

/** Whether a text uses any inline Markdown worth rendering. */
export function hasInlineMarkdown(text: string): boolean {
  const info = scanInline(text);
  return info.some((char) => char.hidden);
}

/** How each character of `text` shows when its inline Markdown is rendered. */
export function scanInline(text: string): CharInfo[] {
  const info: CharInfo[] = Array.from(text, () => ({ hidden: false, style: {} }));
  // Work on UTF-16 indices throughout; Array.from splits by code point, so rebuild per index.
  if (info.length !== text.length) {
    info.length = 0;
    for (let index = 0; index < text.length; index++) info.push({ hidden: false, style: {} });
  }
  const masked = text.split("");
  const hide = (from: number, to: number) => {
    for (let index = from; index < to; index++) {
      const char = info[index];
      if (char) char.hidden = true;
      masked[index] = MASK;
    }
  };
  const style = (from: number, to: number, patch: InlineStyle, mask = false) => {
    for (let index = from; index < to; index++) {
      const char = info[index];
      if (char) char.style = { ...char.style, ...patch };
      if (mask) masked[index] = MASK;
    }
  };

  // Escapes: the backslash is hidden and the next character is plain text.
  for (let index = 0; index < text.length - 1; index++) {
    if (text[index] === "\\" && /[\\`*_[\]()#+\-.!]/.test(text[index + 1] ?? "")) {
      hide(index, index + 1);
      masked[index + 1] = MASK;
      index++;
    }
  }

  // Code spans: contents are literal.
  for (const match of matchAll(/`([^`\n]+)`/g, masked.join(""))) {
    const start = match.index;
    const end = start + match[0].length;
    hide(start, start + 1);
    hide(end - 1, end);
    style(start + 1, end - 1, { code: true }, true);
  }

  // Links and images-as-links: [text](address "title").
  for (const match of matchAll(/!?\[([^\]\n]+)\]\(([^)\s]+)((?:\s+"[^"\n]*")?)\)/g, masked.join(""))) {
    const start = match.index;
    const textStart = start + match[0].indexOf("[") + 1;
    const textEnd = textStart + (match[1]?.length ?? 0);
    const addressStart = textEnd + 2;
    const addressEnd = addressStart + (match[2]?.length ?? 0);
    const end = start + match[0].length;
    hide(start, textStart);
    style(textStart, textEnd, { link: true });
    hide(textEnd, addressStart);
    style(addressStart, addressEnd, { address: true }, true);
    hide(addressEnd, end);
  }

  // Strong, then emphasis. Underscores only at word boundaries (snake_case stays as it is).
  const pairs: Array<{ pattern: RegExp; patch: InlineStyle; width: number }> = [
    { pattern: /(\*\*)(?=[^\s*])([^\n]*?[^\s*])\*\*/g, patch: { strong: true }, width: 2 },
    { pattern: /(?<![\p{L}\p{N}_])(__)(?=[^\s_])([^\n]*?[^\s_])__(?![\p{L}\p{N}_])/gu, patch: { strong: true }, width: 2 },
    { pattern: /(\*)(?=[^\s*])([^\n*]*?[^\s*])\*/g, patch: { em: true }, width: 1 },
    { pattern: /(?<![\p{L}\p{N}_])(_)(?=[^\s_])([^\n_]*?[^\s_])_(?![\p{L}\p{N}_])/gu, patch: { em: true }, width: 1 },
  ];
  for (const { pattern, patch, width } of pairs) {
    for (const match of matchAll(pattern, masked.join(""))) {
      const start = match.index;
      const end = start + match[0].length;
      hide(start, start + width);
      hide(end - width, end);
      style(start + width, end - width, patch);
    }
  }
  return info;
}

function matchAll(pattern: RegExp, text: string): Array<RegExpExecArray & { index: number }> {
  const out: Array<RegExpExecArray & { index: number }> = [];
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    out.push(match as RegExpExecArray & { index: number });
    if (match[0].length === 0) pattern.lastIndex++;
  }
  return out;
}

/** One run of proofed text with a single look. */
export type RichPart =
  | { kind: "same" | "ins" | "del"; text: string; style: InlineStyle; /** Markers shown as stored, because the change was only to them. */ stored?: boolean }
  | { kind: "gap"; words: number };

const styleKey = (style: InlineStyle) => `${style.strong ? "b" : ""}${style.em ? "i" : ""}${style.code ? "c" : ""}${style.link ? "l" : ""}${style.address ? "a" : ""}`;

/**
 * Proof parts (computed over the stored characters) → runs to render, with
 * Markdown markers hidden and styles applied. Insertions take their look from
 * the new text, deletions from the old, unchanged text from the new.
 * Folded gaps must carry the text they hide (`foldUnchanged` keeps it).
 */
export function richParts(parts: ProofPart[]): RichPart[] {
  const before = parts.map((part) => (part.kind === "same" || part.kind === "del" ? part.text : part.kind === "gap" ? (part.text ?? "") : "")).join("");
  const after = parts.map((part) => (part.kind === "same" || part.kind === "ins" ? part.text : part.kind === "gap" ? (part.text ?? "") : "")).join("");
  const oldInfo = scanInline(before);
  const newInfo = scanInline(after);
  let b = 0;
  let a = 0;
  const out: RichPart[] = [];
  const push = (kind: "same" | "ins" | "del", char: string, style: InlineStyle, stored: boolean) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind && styleKey(last.style) === styleKey(style) && Boolean(last.stored) === stored) last.text += char;
    else out.push(stored ? { kind, text: char, style, stored } : { kind, text: char, style });
  };

  for (const part of parts) {
    if (part.kind === "gap") {
      const length = part.text?.length ?? 0;
      b += length;
      a += length;
      out.push({ kind: "gap", words: part.words });
      continue;
    }
    if (part.kind === "same") {
      for (let index = 0; index < part.text.length; index++) {
        const mine = newInfo[a + index];
        const theirs = oldInfo[b + index];
        // A marker in either version stays hidden only when it is a marker in both.
        const hidden = Boolean(mine?.hidden && theirs?.hidden);
        if (!hidden) push("same", part.text[index] ?? "", mine?.hidden ? {} : (mine?.style ?? {}), false);
      }
      a += part.text.length;
      b += part.text.length;
      continue;
    }
    const info = part.kind === "ins" ? newInfo : oldInfo;
    const offset = part.kind === "ins" ? a : b;
    // A change made only of markers (emphasis added or taken away) is shown as stored.
    let visible = false;
    for (let index = 0; index < part.text.length; index++) {
      if (!info[offset + index]?.hidden && /\S/.test(part.text[index] ?? "")) visible = true;
    }
    const markersOnly = !visible && /\S/.test(part.text);
    for (let index = 0; index < part.text.length; index++) {
      const char = info[offset + index];
      if (markersOnly) push(part.kind, part.text[index] ?? "", {}, true);
      else if (!char?.hidden) push(part.kind, part.text[index] ?? "", char?.style ?? {}, false);
    }
    if (part.kind === "ins") a += part.text.length;
    else b += part.text.length;
  }
  return out;
}
