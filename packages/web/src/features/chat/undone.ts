/**
 * What the chat says under a reply once it has been undone. An undo puts
 * back only the pages still as the reply left them; a page changed again
 * since is left as it is, and named here, because putting the whole page
 * back would take the later change with it.
 */

/** "Home", "Home and Pricing", "Home, Pricing and 2 more". */
function listed(names: readonly string[]): string {
  if (names.length <= 2) return names.join(" and ");
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** `changed`: how many pages the reply changed. `left`: the names of those an undo left as they are. */
export function undoneNote(changed: number, left: readonly string[]): string {
  if (left.length === 0) return "Undone. Everything this reply changed is back to how it was.";
  const one = left.length === 1;
  const why = `${one ? "It was" : "They were"} changed again after this reply, so ${one ? "it was left as it is" : "they were left as they are"}.`;

  if (left.length >= changed) return `Nothing was put back: ${listed(left)}. ${why}`;
  return `Undone, except ${listed(left)}. ${why}`;
}
