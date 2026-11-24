/**
 * The themes the /themes/ page lists: the built-ins (brand/themes) and the
 * community's (themes/), read from the same files the app bundles, each run
 * through the app's own check so the page shows what the app shows.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkTheme, fullSwitches, themeFileText, type ThemeCheck, type ThemeFile } from "../../../../packages/core/src/themes/index.ts";
import { repoRoot as root } from "./site";

const repoRoot = root ?? process.cwd();

export interface SiteTheme {
  theme: ThemeFile;
  check: ThemeCheck;
  source: "builtin" | "community";
  /** The file as the app exports it (adjusted, with its $schema). */
  text: string;
}

function read(folder: string, source: SiteTheme["source"], order: string[] = []): SiteTheme[] {
  const files = readdirSync(join(repoRoot, folder)).filter((name) => name.endsWith(".json") && name !== "theme.schema.json");
  return files
    .map((name) => checkTheme(readFileSync(join(repoRoot, folder, name), "utf8")))
    .filter((check) => check.ok && check.theme)
    .map((check) => ({ theme: check.theme!, check, source, text: themeFileText(check.theme!) }))
    .sort((a, b) => (order.indexOf(a.theme.id) + 1 || 99) - (order.indexOf(b.theme.id) + 1 || 99) || a.theme.name.localeCompare(b.theme.name));
}

export const siteThemes: SiteTheme[] = [...read("brand/themes", "builtin", ["quiet", "plate", "desk"]), ...read("themes", "community")];

export { fullSwitches };
