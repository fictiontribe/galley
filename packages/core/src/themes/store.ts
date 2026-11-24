/**
 * Themes saved "for everyone here": one file each in the install's data
 * folder (`<home>/themes/<id>.json`), never in a site's repository. Every
 * theme is checked on the way in and stored with its adjusted colours, and
 * checked again whenever it is read: a file edited by hand that no longer
 * passes is left out, never shown.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GalleyError } from "../errors";
import { isBuiltinTheme } from "./builtin";
import { checkTheme, type ThemeCheck } from "./check";
import { THEME_ID_PATTERN, THEME_MAX_BYTES, themeFileText, type ThemeFile } from "./contract";

/** Enough for any install; a bound so a folder can't fill a menu or a disk. */
export const MAX_SAVED_THEMES = 100;

export interface ThemeStore {
  list(): Promise<ThemeFile[]>;
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

  async function read(id: string): Promise<ThemeFile | null> {
    if (!THEME_ID_PATTERN.test(id)) return null;
    let text: string;

    try {
      text = await readFile(join(folder, `${id}.json`), "utf8");
    } catch {
      return null;
    }
    if (text.length > THEME_MAX_BYTES) return null;
    const check = checkTheme(text);

    return check.ok && check.theme && check.theme.id === id ? check.theme : null;
  }

  async function ids(): Promise<string[]> {
    try {
      return (await readdir(folder))
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -5))
        .filter((id) => THEME_ID_PATTERN.test(id))
        .sort();
    } catch {
      return [];
    }
  }

  return {
    async list() {
      const found = await Promise.all((await ids()).map(read));

      return found.filter((theme): theme is ThemeFile => theme !== null);
    },

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
        if (!THEME_ID_PATTERN.test(id)) return false;
        const file = join(folder, `${id}.json`);
        const existed = (await ids()).includes(id);

        await rm(file, { force: true });
        return existed;
      });
    },
  };
}
