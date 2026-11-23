/**
 * Markdown formatting on plain text + a selection, shared by the small
 * markdown textarea and its keyboard shortcuts. Pure, so it's tested alone.
 */

export interface TextEdit {
  text: string;
  start: number;
  end: number;
}

/** Wrap the selection in `before`/`after`, or unwrap it when it is already wrapped. */
export function toggleWrap(text: string, start: number, end: number, before: string, after: string = before): TextEdit {
  const selected = text.slice(start, end);
  const outerBefore = text.slice(start - before.length, start);
  const outerAfter = text.slice(end, end + after.length);
  if (outerBefore === before && outerAfter === after) {
    return { text: text.slice(0, start - before.length) + selected + text.slice(end + after.length), start: start - before.length, end: end - before.length };
  }
  if (selected.startsWith(before) && selected.endsWith(after) && selected.length >= before.length + after.length) {
    const inner = selected.slice(before.length, selected.length - after.length);
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
  }
  return { text: text.slice(0, start) + before + selected + after + text.slice(end), start: start + before.length, end: end + before.length };
}

/** Put `prefix` at the start of every selected line (or take it off when all have it). */
export function toggleLinePrefix(text: string, start: number, end: number, prefix: string): TextEdit {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = text.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const all = lines.every((line) => line.startsWith(prefix));
  const changed = lines.map((line) => (all ? line.slice(prefix.length) : prefix + line));
  const block = changed.join("\n");
  const delta = all ? -prefix.length : prefix.length;
  return {
    text: text.slice(0, lineStart) + block + text.slice(lineEnd),
    start: Math.max(lineStart, start + delta),
    end: end + delta * lines.length,
  };
}

/** A link around the selection: [text](url), with the url selected for typing. */
export function insertLink(text: string, start: number, end: number, url = "https://"): TextEdit {
  const label = text.slice(start, end) || "link text";
  const inserted = `[${label}](${url})`;
  const urlStart = start + label.length + 3;
  return { text: text.slice(0, start) + inserted + text.slice(end), start: urlStart, end: urlStart + url.length };
}

/** Words in a piece of markdown, ignoring the markup. */
export function wordCount(markdown: string): number {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_`~|-]+/g, " ");
  const words = plain.match(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu);
  return words ? words.length : 0;
}
