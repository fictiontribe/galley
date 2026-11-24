/**
 * What the chat says under a reply once it has been undone. An undo puts
 * back only the pages still as the reply left them; a page changed again
 * since is left as it is, and named here, because putting the whole page
 * back would take the later change with it.
 */

import { UNDO_BUILD_REFUSAL } from "@galley/core/install/route-access";
import type { ChatMessage } from "@galley/core/types";

/** "Home", "Home and Pricing", "Home, Pricing and 2 more". */
function listed(names: readonly string[]): string {
  if (names.length <= 2) return names.join(" and ");
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** `left`: the names of the pages an undo left as they are. `putBack`: whether it put any page back. */
export function undoneNote(left: readonly string[], putBack: boolean): string {
  if (left.length === 0) return "Undone. Everything this reply changed is back to how it was.";
  const one = left.length === 1;
  const why = `${one ? "It was" : "They were"} changed again after this reply, so ${one ? "it was left as it is" : "they were left as they are"}.`;

  if (!putBack) return `Nothing was put back: ${listed(left)}. ${why}`;
  return `Undone, except ${listed(left)}. ${why}`;
}

/**
 * Why this person isn't offered Undo under a reply, in the words the server
 * would refuse it with; null when they are. A reply made in build mode
 * changed the site's code and templates, and putting those back needs the
 * level build mode needs.
 */
export function undoRefusal(message: Pick<ChatMessage, "mode">, mayBuild: boolean): string | null {
  return message.mode === "build" && !mayBuild ? UNDO_BUILD_REFUSAL : null;
}

