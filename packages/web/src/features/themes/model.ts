/**
 * The theme editor's decisions, kept pure so they can be tested without a
 * browser: the words for each colour and switch, starting a theme from
 * another one, ids that don't collide, what an edit changes, and reading a
 * colour someone typed.
 */
import { normalizeColor } from "@galley/core/sitebrand/color";
import { SWITCHES, darkFromLight, themeIdFrom, type SeedName, type SwitchName, type ThemeFile, type ThemeMode, type ThemeSeeds } from "@galley/core/themes";

/** Each colour, in plain words, with one line on what it colours. */
export const SEED_WORDS: Record<SeedName, { label: string; what: string }> = {
  paper: { label: "Paper", what: "The ground everything sits on; sheets, wells and lines are drawn from it" },
  ink: { label: "Ink", what: "Text, and every quieter text, line and edge drawn from it" },
  pencil: { label: "Pencil", what: "The one action, where you are, focus and the assistant’s hand" },
  plate: { label: "Plate", what: "The dark sidebar and status line, when the sidebar is a plate" },
  table: { label: "Table", what: "The ground under a page while you proof it" },
};

export const SWITCH_WORDS: Record<SwitchName, { label: string; choices: Record<string, { label: string; hint: string }> }> = {
  sidebar: {
    label: "Sidebar",
    choices: {
      sheet: { label: "Paper", hint: "On the page’s edge; where you are is a sheet" },
      desk: { label: "Desk", hint: "A toned desk, a step darker than the page" },
      plate: { label: "Plate", hint: "An inked plate with light words" },
    },
  },
  assist: {
    label: "Assistant",
    choices: {
      ruled: { label: "Ruled", hint: "Its fields edged in pencil" },
      washed: { label: "Washed", hint: "Its fields, pane and suggestions washed in pencil" },
    },
  },
  icons: {
    label: "Icons",
    choices: {
      "one-tone": { label: "One tone", hint: "One ink at rest" },
      duotone: { label: "Two tone", hint: "A pencil tint at rest in lists of places" },
    },
  },
  depth: {
    label: "Depth",
    choices: {
      soft: { label: "Soft", hint: "Hairlines and a whisper of shadow" },
      lit: { label: "Lit", hint: "A crisp edge and a layered fall" },
    },
  },
};

export const SWITCH_ORDER = Object.keys(SWITCHES) as SwitchName[];

/** A colour someone typed or picked, as `#RRGGBB`, or null when it can't be read as a colour. */
export function readColour(input: string): string | null {
  const text = input.trim();
  if (!text || text.length > 64) return null;
  const hex = normalizeColor(/^[0-9a-f]{6}$/i.test(text) ? `#${text}` : text);
  // Translucent colours aren't theme colours: a theme's paper can't be see-through.
  return hex && hex.length === 7 ? hex : null;
}

/** An id like the name's that no listed theme has yet: "harbour", "harbour-2", … */
export function freeId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = themeIdFrom(name);
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base.slice(0, 32 - String(n).length - 1)}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base.slice(0, 24)}-${Date.now().toString(36).slice(-7)}`;
}

/** A name like `name` that no listed theme has: "Plate copy", "Plate copy 2", … (within 40 characters). */
export function freeName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  const base = `${name.slice(0, 35)} copy`;
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${name.slice(0, 33)} copy ${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return base;
}

/** "Make a theme from this one": the same colours and switches, a new name and id, no author or description. */
export function themeFrom(source: ThemeFile, taken: { ids: Iterable<string>; names: Iterable<string> }): ThemeFile {
  const name = freeName(source.name, taken.names);
  const copy: ThemeFile = { contract: 1, id: freeId(name, taken.ids), name, light: { ...source.light }, switches: { ...source.switches } };
  if (source.dark) copy.dark = { ...source.dark };
  return copy;
}

/**
 * One colour changed. A theme's dark pencil is "the same pencil" unless
 * someone set it apart, so changing the pencil changes a dark pencil that
 * was the same as it.
 */
export function withSeed(theme: ThemeFile, mode: ThemeMode, seed: SeedName, value: string): ThemeFile {
  if (mode === "light") {
    const next: ThemeFile = { ...theme, light: { ...theme.light, [seed]: value } };
    if (seed === "pencil" && theme.dark && theme.dark.pencil === theme.light.pencil) next.dark = { ...theme.dark, pencil: value };
    return next;
  }
  const dark: ThemeSeeds = { ...(theme.dark ?? darkFromLight(theme.light)), [seed]: value };
  return { ...theme, dark };
}

/** "Set dark colors myself" on (the derived ones become the start) or off (dark is made from light again). */
export function withOwnDark(theme: ThemeFile, own: boolean): ThemeFile {
  if (own) return theme.dark ? theme : { ...theme, dark: darkFromLight(theme.light) };
  const { dark: _dark, ...rest } = theme;
  return rest;
}

export function withSwitch(theme: ThemeFile, name: SwitchName, value: string): ThemeFile {
  return { ...theme, switches: { ...theme.switches, [name]: value } };
}

export function sameTheme(a: ThemeFile | null, b: ThemeFile | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
