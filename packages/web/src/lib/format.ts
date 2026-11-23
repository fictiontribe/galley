/**
 * Formatting for people: times, sizes, counts and paths, per voice.md
 * ("2 min ago", "yesterday", "12 Mar, 14:05"; digits; correct plurals).
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function toMs(value: number | string | Date): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return new Date(value).getTime();
  return value;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "12 Mar, 14:05" in the viewer's locale and clock; the year is added when it isn't this year. */
export function absoluteTime(value: number | string | Date, locale?: string, now: number = Date.now()): string {
  const date = new Date(toMs(value));
  const thisYear = date.getFullYear() === new Date(now).getFullYear();
  const day = date.toLocaleDateString(locale, { day: "numeric", month: "short", ...(thisYear ? {} : { year: "numeric" }) });
  const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}

/** "just now", "2 min ago", "3 h ago", "yesterday", "4 days ago", then absolute after a week. */
export function relativeTime(value: number | string | Date, now: number = Date.now(), locale?: string): string {
  const ms = toMs(value);
  if (Number.isNaN(ms)) return "";
  const diff = now - ms;
  if (diff < 0) return absoluteTime(ms, locale, now);
  if (diff < 45_000) return "just now";
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MINUTE))} min ago`;
  const date = new Date(ms);
  const today = new Date(now);
  if (diff < DAY && sameDay(date, today)) return `${Math.round(diff / HOUR)} h ago`;
  const yesterday = new Date(now - DAY);
  if (sameDay(date, yesterday)) return "yesterday";
  if (diff < 7 * DAY) return `${Math.max(2, Math.round(diff / DAY))} days ago`;
  return absoluteTime(ms, locale, now);
}

/** "214 KB", "1.6 MB". Uses 1024 steps, like file browsers. */
export function bytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/** Image facts as the specimen shows them: "1600 × 900 · 214 KB" (size alone when dimensions are unknown). */
export function mediaFacts(media: { size: number; width?: number; height?: number } | undefined | null): string {
  if (!media) return "";
  const parts: string[] = [];
  if (media.width && media.height) parts.push(`${media.width} × ${media.height}`);
  const size = bytes(media.size);
  if (size) parts.push(size);
  return parts.join(" · ");
}

/** Plurals English doesn't make by rule, for the last word of a noun. */
const IRREGULAR: Record<string, string> = {
  person: "people",
  child: "children",
  man: "men",
  woman: "women",
  foot: "feet",
  tooth: "teeth",
  mouse: "mice",
  goose: "geese",
  leaf: "leaves",
  life: "lives",
  half: "halves",
  shelf: "shelves",
  analysis: "analyses",
  criterion: "criteria",
  datum: "data",
};
/** Words that are the same in the plural, or are plural already. */
const SAME = new Set(["news", "series", "species", "sheep", "fish", "data", "media", "settings", "people", "equipment", "information", "feedback", "staff"]);

/**
 * The plural of a noun by English rules — "story" → "stories", "box" →
 * "boxes", "person" → "people" — changing only its last word ("team member"
 * → "team members") and keeping that word's capital.
 */
export function plural(noun: string): string {
  const match = /^(.*?)([A-Za-z]+)([^A-Za-z]*)$/.exec(noun);
  if (!match) return noun;
  const [, lead = "", word = "", tail = ""] = match;
  // An abbreviation takes a lowercase "s": "FAQs", "URLs".
  if (word.length > 1 && word === word.toUpperCase()) return `${lead}${word}s${tail}`;
  const lower = word.toLowerCase();
  const capital = (text: string) => (word[0] === word[0]?.toUpperCase() ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text);
  let out: string;
  if (SAME.has(lower)) out = lower;
  else if (IRREGULAR[lower]) out = IRREGULAR[lower]!;
  else if (/[^aeiou]y$/.test(lower)) out = `${lower.slice(0, -1)}ies`;
  else if (/(s|x|z|ch|sh)$/.test(lower)) out = `${lower}es`;
  else out = `${lower}s`;
  return `${lead}${capital(out)}${tail}`;
}

/** "1 change", "3 changes", "4 stories", "0 changes". Pass the plural when English rules can't know it. */
export function count(n: number, singular: string, pluralForm: string = plural(singular)): string {
  return `${n.toLocaleString()} ${n === 1 ? singular : pluralForm}`;
}

/**
 * What one and many of a collection's entries are called. The collection's
 * own label is its plural when it is one ("Stories" for "story", "People"
 * for "person"); a label that names the collection otherwise ("Journal" for
 * "post") leaves the plural to English rules.
 */
export function collectionNouns(collection: { label: string; singular: string }): { one: string; many: string } {
  const one = collection.singular;
  const label = collection.label.trim().toLowerCase();
  const ruled = plural(one).toLowerCase();
  const last = (text: string) => text.split(/\s+/).at(-1) ?? text;
  const labelIsPlural = label === ruled || (label !== one.toLowerCase() && last(label) === last(ruled)) || (IRREGULAR[last(one.toLowerCase())] === last(label));
  return { one, many: labelIsPlural ? label : plural(one) };
}

/** "Home page, About page and one image" — a list joined the way people say it. */
export function joinWords(items: string[], conjunction = "and"): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${conjunction} ${items[items.length - 1]}`;
}

/** US dollars for usage: "$0.42", "$12.30", "<$0.01". */
export function money(value: number | null): string {
  if (value === null) return "—";
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

/** "12,400" or "1.2 M" for token counts. */
export function compactNumber(value: number): string {
  if (value < 10_000) return value.toLocaleString();
  if (value < 1_000_000) return `${Math.round(value / 100) / 10} k`;
  return `${Math.round(value / 100_000) / 10} M`;
}

/** The last segment of a path: "src/content/pages/index.md" → "index.md". */
export function fileName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/** Everything before the last segment, with its trailing slash: "src/content/pages/". */
export function dirName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const at = trimmed.lastIndexOf("/");
  return at === -1 ? "" : trimmed.slice(0, at + 1);
}

/**
 * A human label from a path or slug: "src/content/blog/living-through-a-renovation.md"
 * → "Living through a renovation"; "index" → "Home".
 */
export function friendlyLabel(path: string): string {
  const name = fileName(path).replace(/\.[^.]+$/, "");
  if (name === "index" || name === "") return "Home";
  const words = name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
