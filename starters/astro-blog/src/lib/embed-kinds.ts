/**
 * The embed kinds: the languages a fenced block in a post can name to become
 * a component instead of code. Read by astro.config.ts (to leave these blocks
 * out of syntax highlighting) and by src/lib/embeds.ts (to render them).
 * Their fields are in src/content.config.ts, under "Embeds".
 */
export const EMBED_KINDS = [
  "chart",
  "compare",
  "stats",
  "verdict",
  "proscons",
  "timeline",
  "steps",
  "faq",
  "gallery",
  "pullquote",
  "video",
  "takeaways",
] as const;

export type EmbedKind = (typeof EMBED_KINDS)[number];
