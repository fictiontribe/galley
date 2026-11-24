/**
 * Which themes an install knows, and which one is its default. Pure: the
 * server, the mock and the command line pass in what they hold.
 *
 * Ids are one namespace. A built-in's id can't be taken by a saved theme
 * (the store refuses it); a saved theme comes before a plugin's theme of the
 * same id, so a plugin can never replace what someone saved here.
 */
import { DEFAULT_THEME_ID, builtinThemes } from "./builtin";
import type { ThemeFile } from "./contract";

export interface PluginTheme {
  /** The plugin's package name. */
  plugin: string;
  theme: ThemeFile;
}

export interface ThemeSources {
  /** A white-label brand's accent (the built-ins' pencil) and the theme it names. */
  brand?: { accent?: string | null; theme?: string | null };
  saved: ThemeFile[];
  plugins?: PluginTheme[];
}

export type ThemeSource = "builtin" | "saved" | "plugin";

export interface KnownTheme {
  theme: ThemeFile;
  source: ThemeSource;
  plugin?: string;
}

export function knownThemes(sources: ThemeSources): KnownTheme[] {
  const out: KnownTheme[] = builtinThemes(sources.brand?.accent).map((theme) => ({ theme, source: "builtin" }));
  const taken = new Set(out.map((entry) => entry.theme.id));

  for (const theme of sources.saved) {
    if (taken.has(theme.id)) continue;
    taken.add(theme.id);
    out.push({ theme, source: "saved" });
  }
  for (const entry of sources.plugins ?? []) {
    if (taken.has(entry.theme.id)) continue;
    taken.add(entry.theme.id);
    out.push({ theme: entry.theme, source: "plugin", plugin: entry.plugin });
  }
  return out;
}

export function findTheme(id: string | null | undefined, sources: ThemeSources): KnownTheme | null {
  if (!id) return null;
  return knownThemes(sources).find((entry) => entry.theme.id === id) ?? null;
}

/**
 * The install's default theme: the one chosen in App settings, else the one
 * a white-label brand names, else Quiet. A choice that no longer exists (a
 * saved theme deleted, a plugin turned off) falls through to the next.
 */
export function defaultTheme(chosen: string | null | undefined, sources: ThemeSources): KnownTheme {
  return findTheme(chosen, sources) ?? findTheme(sources.brand?.theme, sources) ?? findTheme(DEFAULT_THEME_ID, sources)!;
}
