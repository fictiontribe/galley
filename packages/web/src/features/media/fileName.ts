/**
 * The name offered for a generated picture or film, from its prompt. Six
 * words of the prompt cut "A wool coat on an iron hook against…" to
 * `a-wool-coat-on-an-iron`, mid-phrase. Now: whole words up to a length,
 * then no joining word left dangling at either end, so the name reads as a
 * phrase: `wool-coat-on-an-iron-hook`.
 */
import { suggestSlug } from "@/features/content/collection/slug";

/** Words that only join others: a name never starts or ends on one. */
const JOINING = new Set([
  "a", "an", "the", "and", "or", "but", "nor", "of", "on", "in", "into", "onto", "at", "to", "by", "for", "with", "without",
  "from", "over", "under", "against", "beside", "behind", "between", "near", "through", "across", "as", "its", "their", "his", "her", "our", "your", "is", "are",
]);

/** Longest a suggested name runs, in characters; it ends at a word. */
export const NAME_LENGTH = 40;

export function fileNameFromPrompt(prompt: string, max = NAME_LENGTH): string {
  const words = suggestSlug(prompt).split("-").filter(Boolean);
  const kept: string[] = [];
  let length = 0;

  for (const word of words) {
    const next = length + (kept.length ? 1 : 0) + word.length;
    if (next > max && kept.length) break;
    kept.push(word);
    length = next;
  }
  while (kept.length > 1 && JOINING.has(kept[kept.length - 1]!)) kept.pop();
  while (kept.length > 1 && JOINING.has(kept[0]!)) kept.shift();
  return kept.join("-").slice(0, max).replace(/-+$/, "") || "image";
}
