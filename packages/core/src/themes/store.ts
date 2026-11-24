/**
 * Themes saved "for everyone here": one file each in the install's data
 * folder (`<home>/themes/<id>.json`), never in a site's repository. Every
 * theme is checked on the way in and stored with its adjusted colours, and
 * checked again whenever it is read: a file edited by hand that no longer
 * passes is left out, never shown.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GalleyError } from "../errors";
import { isBuiltinTheme } from "./builtin";
import { checkTheme, type ThemeCheck } from "./check";
import { THEME_MAX_BYTES, isThemeId, printable, themeFileText, type ThemeFile } from "./contract";

/** Enough for any install; a bound so a folder can't fill a menu or a disk. */
export const MAX_SAVED_THEMES = 100;

/** A file in the themes folder that was left out, and why, in words (printable: no control characters). */
export interface SkippedTheme {
  file: string;
  reason: string;
}

export interface ThemeStore {
  list(): Promise<ThemeFile[]>;
  /** The themes, and every file that was left out with the reason (one bad file never hides the others). */
  scan(): Promise<{ themes: ThemeFile[]; skipped: SkippedTheme[] }>;
  get(id: string): Promise<ThemeFile | null>;
  /** Check and save (adding or replacing). Refused themes throw `invalid` with the check's words; the check is returned. */
  save(input: unknown, options?: { id?: string }): Promise<ThemeCheck>;
  /** False when there was nothing to delete. */
  remove(id: string): Promise<boolean>;
}

export function createThemeStore(options: { home: string }): ThemeStore {
  const folder = join(options.home, "themes");
  let writes: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const result = writes.then(task, task);

    writes = result.catch(() => undefined);
    return result;
  };

  /** One file, checked; never throws. The size is looked at before anything is read. */
  async function inspect(id: string): Promise<{ theme: ThemeFile } | { reason: string }> {
    if (!isThemeId(id)) return { reason: "its name isn’t a theme’s id." };
    const file = join(folder, `${id}.json`);

    try {
      const info = await stat(file);

      if (!info.isFile()) return { reason: "it isn’t a file." };
      if (info.size > THEME_MAX_BYTES) return { reason: `it is over ${THEME_MAX_BYTES / 1024} KB, so it isn’t a theme.` };
      const check = checkTheme(await readFile(file, "utf8"));

      if (!check.ok || !check.theme) return { reason: printable(check.refused.join(" ")) || "it can’t be used." };
      if (check.theme.id !== id) return { reason: `its id (${check.theme.id}) isn’t its file name.` };
      return { theme: check.theme };
    } catch (error) {
      return { reason: (error as NodeJS.ErrnoException).code === "ENOENT" ? "it isn’t there." : "it can’t be read." };
    }
  }

  async function read(id: string): Promise<ThemeFile | null> {
    const found = await inspect(id);

    return "theme" in found ? found.theme : null;
  }

  async function scan(): Promise<{ themes: ThemeFile[]; skipped: SkippedTheme[] }> {
    const themes: ThemeFile[] = [];
    const skipped: SkippedTheme[] = [];

    for (const id of await ids()) {
      const found = await inspect(id);

      if ("theme" in found) themes.push(found.theme);
      else skipped.push({ file: `${id}.json`, reason: found.reason });
    }
    return { themes, skipped };
  }

  async function ids(): Promise<string[]> {
    try {
      return (await readdir(folder))
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -5))
        .filter((id) => isThemeId(id))
        .sort();
    } catch {
      return [];
    }
  }

  return {
    async list() {
      return (await scan()).themes;
    },

    scan,

    get: read,

    save(input, saveOptions) {
      return serial(async () => {
        const check = checkTheme(input);

        if (!check.ok || !check.theme) throw new GalleyError("invalid", check.refused.join(" ") || "This theme can’t be used.");
        const id = check.theme.id;

        if (saveOptions?.id !== undefined && saveOptions.id !== id) throw new GalleyError("invalid", "The theme’s id doesn’t match where it was saved.");
        if (isBuiltinTheme(id)) throw new GalleyError("conflict", `“${check.theme.name}” has the id of a theme that comes with the app. Give it another name.`);
        const existing = await ids();

        if (!existing.includes(id) && existing.length >= MAX_SAVED_THEMES) throw new GalleyError("invalid", `This editor already keeps ${MAX_SAVED_THEMES} themes. Delete one first.`);
        await mkdir(folder, { recursive: true });
        const temp = join(folder, `.${id}-${randomUUID()}.tmp`);

        await writeFile(temp, themeFileText(check.theme));
        await rename(temp, join(folder, `${id}.json`));
        return check;
      });
    },

    remove(id) {
      return serial(async () => {
        if (!isThemeId(id)) return false;
        const file = join(folder, `${id}.json`);
        const existed = (await ids()).includes(id);

        await rm(file, { force: true });
        return existed;
      });
    },
  };
}
