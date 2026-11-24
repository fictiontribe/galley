/**
 * The theme contract (brand/themes/README.md, theme.schema.json), as types
 * and one strict reader. A theme is data: an id, a name, five colours per
 * mode and four switches with fixed choices. Nothing in a theme file ever
 * reaches a style except a colour that is exactly `#RRGGBB` and a switch
 * value from its fixed list, so no file can carry CSS, a URL or a selector.
 */
import { isHex } from "./colour";

export const THEME_CONTRACT = 1;
/** Where the theme schema is published (the `$schema` an exported file names). */
export const THEME_SCHEMA_URL = "https://galley.fictiontribe.com/schema/theme.schema.json";
/** A theme file is a few hundred bytes; anything over this is not a theme. */
export const THEME_MAX_BYTES = 8 * 1024;
export const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const THEME_NAME_MAX = 40;
export const THEME_DESCRIPTION_MAX = 240;
export const THEME_AUTHOR_MAX = 80;

export const SEED_NAMES = ["paper", "ink", "pencil", "plate", "table"] as const;
export type SeedName = (typeof SEED_NAMES)[number];
export type ThemeSeeds = Record<SeedName, string>;
export type ThemeMode = "light" | "dark";
export const THEME_MODES: readonly ThemeMode[] = ["light", "dark"];

/** Each switch's choices; the first is Quiet's, and what an absent switch means. */
export const SWITCHES = {
  sidebar: ["sheet", "desk", "plate"],
  assist: ["ruled", "washed"],
  icons: ["one-tone", "duotone"],
  depth: ["soft", "lit"],
} as const;
export type SwitchName = keyof typeof SWITCHES;
export const SWITCH_NAMES = Object.keys(SWITCHES) as SwitchName[];
export type ThemeSwitches = { [K in SwitchName]: (typeof SWITCHES)[K][number] };

export interface ThemeFile {
  $schema?: string;
  contract: 1;
  id: string;
  name: string;
  description?: string;
  author?: string;
  light: ThemeSeeds;
  /** Absent: derived from `light` (README → Dark from light). */
  dark?: ThemeSeeds;
  switches: Partial<ThemeSwitches>;
}

/** The proof and status inks a check may tune (in lightness only). */
export const PROOF_INKS = ["insert", "delete", "change", "success", "warning", "danger", "info"] as const;
export type ProofInk = (typeof PROOF_INKS)[number];

/** The custom property each tuned ink is set on (tokens.css §1 and §3). */
export const PROOF_INK_PROPERTY: Record<ProofInk, string> = {
  insert: "--proof-insert",
  delete: "--proof-delete",
  change: "--proof-change",
  success: "--success",
  warning: "--warning",
  danger: "--danger",
  info: "--info",
};

/** Their values as tokens.css sets them for the app (§1, §3). */
export const PROOF_INK_VALUES: Record<ThemeMode, Record<ProofInk, string>> = {
  light: { insert: "#0B6E55", delete: "#B8361A", change: "#8E3A7A", success: "#2D6A2E", warning: "#8A5800", danger: "#A8233A", info: "#2E5A8C" },
  dark: { insert: "#5FD0AE", delete: "#FF8A6B", change: "#E58BD0", success: "#8BCF7A", warning: "#E7B44C", danger: "#FF7D8F", info: "#8DB8F0" },
};

/**
 * The twelve people colours (tokens.css §8): who is here. Fixed in every
 * theme and the same in light and dark; the check may tune a lightness so
 * each still shows as an outline on the theme's sheets.
 */
export const PEOPLE_COLOURS: ReadonlyArray<{ name: string; value: string }> = [
  { name: "rose", value: "#C7446F" },
  { name: "coral", value: "#E05B4D" },
  { name: "rust", value: "#B35E00" },
  { name: "mustard", value: "#B08500" },
  { name: "olive", value: "#748C00" },
  { name: "jade", value: "#00A45D" },
  { name: "teal", value: "#00927E" },
  { name: "lagoon", value: "#009DB7" },
  { name: "harbour", value: "#007EB2" },
  { name: "cornflower", value: "#5886F2" },
  { name: "violet", value: "#9758C6" },
  { name: "orchid", value: "#C360BD" },
];
/** `--person-1` … `--person-12`. */
export const personProperty = (index: number) => `--person-${index + 1}`;

/**
 * A theme as it is put on the page: both modes' colours after the check,
 * every switch, and any ink the check had to tune. Carries no words (no
 * name, description or author), so it can be shown before anyone signs in.
 */
export interface AppliedTheme {
  id: string;
  light: ThemeSeeds;
  dark: ThemeSeeds;
  switches: ThemeSwitches;
  tuned: Record<ThemeMode, Partial<Record<ProofInk, string>>>;
  /** People colours the check tuned, by number ("1" … "12"); the same in light and dark. */
  people?: Record<string, string>;
}

export const DEFAULT_SWITCHES: ThemeSwitches = { sidebar: "sheet", assist: "ruled", icons: "one-tone", depth: "soft" };

export type ParsedTheme = { ok: true; theme: ThemeFile } | { ok: false; problems: string[] };

const TOP_KEYS = new Set(["$schema", "contract", "id", "name", "description", "author", "light", "dark", "switches"]);

/** Control characters, and the marks that reorder text, never belong in a name. */
const UNPRINTABLE = /[\u0000-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function text(value: unknown, field: string, max: number, problems: string[], required: boolean): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string") {
    problems.push(`The ${field} must be text.`);
    return undefined;
  }
  const trimmed = value.trim();

  if (required && !trimmed) problems.push(`The theme needs a ${field}.`);
  else if (trimmed.length > max) problems.push(`The ${field} can be up to ${max} characters long.`);
  else if (UNPRINTABLE.test(trimmed)) problems.push(`The ${field} has characters that can’t be shown.`);
  else return trimmed;
  return undefined;
}

function seeds(value: unknown, mode: ThemeMode, problems: string[]): ThemeSeeds | undefined {
  const where = mode === "light" ? "light colors" : "dark colors";

  if (!isPlainObject(value)) {
    problems.push(`The ${where} must list paper, ink, pencil, plate and table.`);
    return undefined;
  }
  const out: Partial<ThemeSeeds> = {};

  for (const key of Object.keys(value)) {
    if (!(SEED_NAMES as readonly string[]).includes(key)) problems.push(`The ${where} have something a theme can’t hold (“${clipped(key)}”).`);
  }
  for (const name of SEED_NAMES) {
    const color = value[name];

    if (color === undefined) problems.push(`The ${where} need a ${name} color.`);
    else if (!isHex(color)) problems.push(`The ${mode} ${name} must be a color written like #F6F4F0.`);
    else out[name] = color.toUpperCase();
  }
  return Object.keys(out).length === SEED_NAMES.length ? (out as ThemeSeeds) : undefined;
}

function clipped(value: string): string {
  const shown = value.replace(UNPRINTABLE, "").slice(0, 32);

  return shown.length < value.length ? `${shown}…` : shown;
}

/**
 * Read a theme file strictly: exactly the contract's keys, colours that are
 * exactly `#RRGGBB`, switches from their lists, a slug id, a bounded name.
 * Text (a file's contents) is size-checked before it is parsed.
 */
export function parseTheme(input: unknown): ParsedTheme {
  let value = input;

  if (typeof input === "string") {
    if (new TextEncoder().encode(input).length > THEME_MAX_BYTES) return { ok: false, problems: [`A theme file is a few hundred bytes; this one is over ${THEME_MAX_BYTES / 1024} KB, so it isn’t a theme.`] };
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      return { ok: false, problems: ["This file isn’t a theme: it can’t be read."] };
    }
  } else if (input !== null && typeof input === "object") {
    let size: number;

    try {
      size = new TextEncoder().encode(JSON.stringify(input)).length;
    } catch {
      return { ok: false, problems: ["This isn’t a theme."] };
    }
    if (size > THEME_MAX_BYTES) return { ok: false, problems: [`A theme is a few hundred bytes; this one is over ${THEME_MAX_BYTES / 1024} KB, so it isn’t a theme.`] };
  }
  if (!isPlainObject(value)) return { ok: false, problems: ["This isn’t a theme."] };
  const problems: string[] = [];

  for (const key of Object.keys(value)) {
    if (!TOP_KEYS.has(key)) problems.push(`The theme has something a theme can’t hold (“${clipped(key)}”).`);
  }
  if (value.contract !== THEME_CONTRACT) problems.push("This theme was written for a different version of themes (it needs “contract”: 1).");
  const id = value.id;

  if (typeof id !== "string" || !THEME_ID_PATTERN.test(id)) problems.push("The theme’s id must be 1 to 32 lower-case letters, digits and dashes, starting with a letter or digit.");
  if (value.$schema !== undefined && (typeof value.$schema !== "string" || value.$schema.length > 200)) problems.push("This file isn’t a theme: its first line names something else.");
  const name = text(value.name, "name", THEME_NAME_MAX, problems, true);
  const description = text(value.description, "description", THEME_DESCRIPTION_MAX, problems, false);
  const author = text(value.author, "author", THEME_AUTHOR_MAX, problems, false);
  const light = value.light === undefined ? (problems.push("The theme needs its light colors."), undefined) : seeds(value.light, "light", problems);
  const dark = value.dark === undefined ? undefined : seeds(value.dark, "dark", problems);
  const switches: Partial<ThemeSwitches> = {};

  if (!isPlainObject(value.switches)) problems.push("The theme needs its switches (they may be empty: {}).");
  else {
    for (const [key, choice] of Object.entries(value.switches)) {
      const choices = (SWITCHES as Record<string, readonly string[]>)[key];

      if (!choices) problems.push(`The switches have one a theme can’t hold (“${clipped(key)}”).`);
      else if (typeof choice !== "string" || !choices.includes(choice)) problems.push(`The ${key} switch must be ${choices.map((c) => `“${c}”`).join(" or ")}.`);
      else (switches as Record<string, string>)[key] = choice;
    }
  }
  if (problems.length || !light || typeof id !== "string" || name === undefined) return { ok: false, problems };
  const theme: ThemeFile = { contract: 1, id, name, light, switches };

  if (description) theme.description = description;
  if (author) theme.author = author;
  if (dark) theme.dark = dark;
  return { ok: true, theme };
}

/** Every switch, with Quiet's choice where the theme leaves one out. */
export function fullSwitches(switches: Partial<ThemeSwitches>): ThemeSwitches {
  return { ...DEFAULT_SWITCHES, ...switches };
}

/** The file as it is written out: the schema's address first, keys in the contract's order. */
export function themeFileText(theme: ThemeFile): string {
  const ordered: Record<string, unknown> = { $schema: THEME_SCHEMA_URL, contract: 1, id: theme.id, name: theme.name };

  if (theme.description) ordered.description = theme.description;
  if (theme.author) ordered.author = theme.author;
  ordered.light = { ...theme.light };
  if (theme.dark) ordered.dark = { ...theme.dark };
  ordered.switches = { ...theme.switches };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** A slug for an id, from a name: "Harbour at dusk" → "harbour-at-dusk". */
export function themeIdFrom(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");

  return slug || "theme";
}
