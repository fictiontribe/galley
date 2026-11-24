/**
 * Every theme this app can show, and where each comes from:
 *   builtin    Quiet, Plate and Desk (with a white-label brand's accent as their pencil)
 *   community  the repository's themes/ folder, bundled when the app was built (no network)
 *   saved      saved for everyone here, on the server
 *   plugin     added by a plugin
 *   mine       saved for me only, in this browser (a hosted install)
 * Every one is checked before it is listed; one that fails is left out.
 */
import { checkTheme, knownThemes, type PluginTheme, type ThemeFile } from "@galley/core/themes";

export type ThemeOrigin = "builtin" | "community" | "saved" | "plugin" | "mine";

export interface ListedTheme {
  theme: ThemeFile;
  origin: ThemeOrigin;
  plugin?: string;
}

/** The community folder, read when the app is built. */
const COMMUNITY_FILES = import.meta.glob<ThemeFile>("../../../../../themes/*.json", { eager: true, import: "default" });

export const COMMUNITY_THEMES: ThemeFile[] = Object.values(COMMUNITY_FILES)
  .map((file) => checkTheme(file))
  .filter((check) => check.ok && check.theme)
  .map((check) => check.theme!)
  .sort((a, b) => a.name.localeCompare(b.name));

export const ORIGIN_WORDS: Record<ThemeOrigin, string> = {
  builtin: "Comes with the app",
  community: "From the community",
  saved: "Saved for everyone here",
  plugin: "From a plugin",
  mine: "Saved for me",
};

/**
 * The list in the order the picker shows it: the built-ins, then saved for
 * everyone, plugins', mine, and the community's last. An id appears once:
 * the first source wins, so nothing can stand in for a built-in or for what
 * was saved here.
 */
export function listThemes(input: { brandAccent?: string | null; saved: ThemeFile[]; plugins: PluginTheme[]; mine: ThemeFile[]; community?: ThemeFile[] }): ListedTheme[] {
  const known = knownThemes({ brand: { accent: input.brandAccent ?? null }, saved: input.saved, plugins: input.plugins });
  const out: ListedTheme[] = known.map((entry) => ({ theme: entry.theme, origin: entry.source, ...(entry.plugin ? { plugin: entry.plugin } : {}) }));
  const taken = new Set(out.map((entry) => entry.theme.id));

  for (const [origin, themes] of [["mine", input.mine], ["community", input.community ?? COMMUNITY_THEMES]] as const) {
    for (const theme of themes) {
      if (taken.has(theme.id)) continue;
      taken.add(theme.id);
      out.push({ theme, origin });
    }
  }
  return out;
}
