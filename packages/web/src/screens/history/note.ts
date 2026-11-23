/** Pure helpers for Version history. */

/**
 * A version's note as people read it: the first line as the title, any
 * further lines under it — and the lines version control writes for its own
 * use ("This reverts commit 3f2a…") kept for a Technical details disclosure.
 */
export function versionNote(message: string): { title: string; body: string; technical: string[] } {
  const [title = "", ...rest] = message.split("\n");
  const technical: string[] = [];
  const body = rest
    .filter((line) => {
      const internal = /^\s*This reverts commit [0-9a-f]{7,64}\.?\s*$/i.test(line);
      if (internal) technical.push(line.trim());
      return !internal;
    })
    .join("\n")
    .trim();
  return { title: title.trim(), body, technical };
}
