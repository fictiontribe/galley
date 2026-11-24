/**
 * What a theme puts on <html>, and nothing else (README → What the app
 * reads): five custom properties per mode, the four switch attributes, the
 * informational `data-look`, and the proof or status inks the check tuned.
 * Tuned inks are set for the mode on screen only (tokens.css has no
 * per-mode hook for them; see docs/themes.md), so the caller passes it.
 */
import { isHex } from "./colour";
import { PEOPLE_COLOURS, PROOF_INKS, PROOF_INK_PROPERTY, SEED_NAMES, personProperty, SWITCHES, SWITCH_NAMES, isThemeId, type AppliedTheme, type ThemeMode, type ThemeSwitches } from "./contract";
import { QUIET } from "./builtin";

export const THEME_ATTRIBUTES = ["data-look", ...SWITCH_NAMES.map((name) => `data-look-${name}`)] as const;
export const THEME_PROPERTIES = [
  ...SEED_NAMES.map((seed) => `--theme-${seed}`),
  ...SEED_NAMES.map((seed) => `--theme-dark-${seed}`),
  ...PROOF_INKS.map((ink) => PROOF_INK_PROPERTY[ink]),
  ...PEOPLE_COLOURS.map((_, index) => personProperty(index)),
] as const;

export interface ThemeOnPage {
  attributes: Record<string, string>;
  properties: Record<string, string>;
}

/** Quiet exactly as it ships: nothing to set (the CSS's fallbacks are Quiet). */
export function isPlainQuiet(applied: AppliedTheme): boolean {
  const dark = QUIET.dark!;

  return (
    applied.id === QUIET.id &&
    SEED_NAMES.every((seed) => applied.light[seed] === QUIET.light[seed] && applied.dark[seed] === dark[seed]) &&
    SWITCH_NAMES.every((name) => applied.switches[name] === SWITCHES[name][0]) &&
    !Object.keys(applied.tuned.light).length &&
    !Object.keys(applied.tuned.dark).length &&
    !Object.keys(applied.people ?? {}).length
  );
}

export function themeOnPage(applied: AppliedTheme | null, shown: ThemeMode): ThemeOnPage {
  if (!applied || isPlainQuiet(applied)) return { attributes: {}, properties: {} };
  const attributes: Record<string, string> = { "data-look": applied.id };
  const properties: Record<string, string> = {};

  for (const name of SWITCH_NAMES) attributes[`data-look-${name}`] = applied.switches[name];
  for (const seed of SEED_NAMES) {
    properties[`--theme-${seed}`] = applied.light[seed];
    properties[`--theme-dark-${seed}`] = applied.dark[seed];
  }
  for (const ink of PROOF_INKS) {
    const value = applied.tuned[shown][ink];

    if (value) properties[PROOF_INK_PROPERTY[ink]] = value;
  }
  for (const [number, value] of Object.entries(applied.people ?? {})) properties[`--person-${number}`] = value;
  return { attributes, properties };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a value read back from storage (this browser's copy, the server's
 * start-up script) is an applied theme and nothing more: colours exactly
 * `#RRGGBB`, switches from their lists. What fails is never put on a page.
 */
export function isAppliedTheme(value: unknown): value is AppliedTheme {
  if (!isObject(value) || !isThemeId(value.id)) return false;
  for (const mode of ["light", "dark"] as const) {
    const seeds = value[mode];

    if (!isObject(seeds) || !SEED_NAMES.every((seed) => isHex(seeds[seed]))) return false;
  }
  const switches = value.switches;

  if (!isObject(switches) || !SWITCH_NAMES.every((name) => (SWITCHES[name] as readonly string[]).includes(switches[name] as string))) return false;
  const tuned = value.tuned;

  if (!isObject(tuned)) return false;
  for (const mode of ["light", "dark"] as const) {
    const inks = tuned[mode];

    if (!isObject(inks)) return false;
    for (const [ink, hex] of Object.entries(inks)) if (!(PROOF_INKS as readonly string[]).includes(ink) || !isHex(hex)) return false;
  }
  const people = value.people;

  if (people !== undefined) {
    if (!isObject(people)) return false;
    for (const [number, hex] of Object.entries(people)) if (!/^(?:[1-9]|1[0-2])$/.test(number) || !isHex(hex)) return false;
  }
  return true;
}

export type { ThemeSwitches };
