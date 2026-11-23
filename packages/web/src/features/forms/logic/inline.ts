/**
 * The inline formatting a form's texts allow — **bold**, *italic*, and
 * [links](/privacy/) — split into parts the preview draws as elements (never
 * as HTML). Line breaks separate paragraphs.
 */

export type InlinePart = { kind: "text" | "bold" | "italic"; text: string } | { kind: "link"; text: string; href: string };

const TOKEN = /\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function inlineParts(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ kind: "text", text: text.slice(last, at) });
    if (match[1] !== undefined) parts.push({ kind: "bold", text: match[1] });
    else if (match[2] !== undefined) parts.push({ kind: "italic", text: match[2] });
    else if (match[3] !== undefined) parts.push({ kind: "italic", text: match[3] });
    else parts.push({ kind: "link", text: match[4] ?? "", href: match[5] ?? "" });
    last = at + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

/** Links a preview may follow: site paths and web or mail addresses. */
export function safeLink(href: string): string | null {
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Wrap the selected range of `text` in a marker (`**`, `*`), or insert it at the caret with a word to replace. */
export function wrapSelection(text: string, start: number, end: number, before: string, after = before, filler = "text"): { text: string; start: number; end: number } {
  const chosen = text.slice(start, end) || filler;
  const next = `${text.slice(0, start)}${before}${chosen}${after}${text.slice(end)}`;
  return { text: next, start: start + before.length, end: start + before.length + chosen.length };
}
