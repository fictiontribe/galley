/**
 * `galley theme …` — the editing app's themes from the command line: list
 * them, check a theme file (the same check the app runs), add one for
 * everyone who uses this computer or server, choose the default, export one.
 * Saved themes live in `<home>/themes`; a running app shows a change the next
 * time it is opened or refreshed.
 */
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PRODUCT } from "@galley/core/brand";
import { createSettingsService } from "@galley/core/ai";
import { THEME_MAX_BYTES, checkTheme, defaultTheme, knownThemes, themeFileText, type ThemeCheck } from "@galley/core/themes";
import { createThemeStore } from "@galley/core/themes/store";
import { defaultHome } from "@galley/server";
import { parse, UsageError } from "../args";
import type { Io } from "../io";

export const THEME_HELP = `Usage: ${PRODUCT.slug} theme <command> [options]

The editing app's themes: its paper, ink and pencil colors and a few
materials. Light or dark is separate, chosen in the app.

  ${PRODUCT.slug} theme list               The built-in themes and the ones saved here
  ${PRODUCT.slug} theme check <file>       Check a theme file the way the app does (exit 1 when it would be refused)
  ${PRODUCT.slug} theme add <file>         Save it for everyone who uses ${PRODUCT.name} here (checked first, kept adjusted)
  ${PRODUCT.slug} theme use <id>           Make it the theme ${PRODUCT.name} opens with here
  ${PRODUCT.slug} theme export <id>        Print a theme as a file (--out <file> to write it)
  ${PRODUCT.slug} theme remove <id>        Delete a theme saved here

Options
      --out <file>   export: write the file instead of printing it
      --json         Print the result as JSON
  -h, --help         Show this help

Saved themes are kept in this computer's (or server's) ${PRODUCT.name} folder, never
in a site. On a hosted editor, each person can still choose their own theme
in the app; \`use\` sets the one someone starts with.`;

/** The check, said as lines a person reads: what can't be used, what was changed, what to know. */
export function reportLines(check: ThemeCheck): string[] {
  return [...check.refused.map((line) => `✗ ${line}`), ...check.adjusted.map((adjustment) => `~ ${adjustment.reason}`), ...check.warnings.map((warning) => `! ${warning.message}`)];
}

async function readThemeFile(io: Io, file: string): Promise<{ text: string; path: string }> {
  const path = resolve(io.cwd, file);
  const info = await stat(path).catch(() => null);

  if (!info?.isFile()) throw new UsageError(`There's no file at ${file}.`);
  if (info.size > THEME_MAX_BYTES) return { text: " ".repeat(THEME_MAX_BYTES + 1), path };
  return { text: await readFile(path, "utf8"), path };
}

export async function themeCommand(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parse("theme", argv, { json: { type: "boolean" }, out: { type: "string" } }, 2);
  const [action, target] = positionals;

  if (values.help || action === undefined) {
    io.out(THEME_HELP);
    return action === undefined && !values.help ? 2 : 0;
  }
  const home = defaultHome(io.env);
  const json = Boolean(values.json);
  const store = createThemeStore({ home });
  const settings = createSettingsService({ home, env: io.env });
  const sources = async () => ({ saved: await store.list() });

  switch (action) {
    case "list": {
      if (target !== undefined) throw new UsageError(`\`${PRODUCT.slug} theme list\` takes no name. Run \`${PRODUCT.slug} theme --help\`.`);
      const known = knownThemes(await sources());
      const current = defaultTheme((await settings.get()).appearance.look, await sources()).theme.id;

      if (json) {
        io.out(JSON.stringify({ default: current, themes: known.map((entry) => ({ id: entry.theme.id, name: entry.theme.name, source: entry.source })) }, null, 2));
        return 0;
      }
      for (const entry of known) io.out(`${entry.theme.id === current ? "•" : " "} ${entry.theme.id.padEnd(16)} ${entry.theme.name}${entry.source === "builtin" ? " (built in)" : ""}`);
      io.out("");
      io.out(`• the theme ${PRODUCT.name} opens with here. Change it with \`${PRODUCT.slug} theme use <id>\`.`);
      return 0;
    }
    case "check":
    case "add": {
      if (!target) throw new UsageError(`Say which file: \`${PRODUCT.slug} theme ${action} harbour.json\`.`);
      const { text } = await readThemeFile(io, target);
      const check = checkTheme(text);

      if (!check.ok || !check.theme) {
        if (json) io.out(JSON.stringify({ ok: false, refused: check.refused, adjusted: check.adjusted, warnings: check.warnings }, null, 2));
        else {
          io.err(`${target} can't be used as a theme:`);
          for (const line of reportLines(check)) io.err(`  ${line}`);
        }
        return 1;
      }
      if (action === "add") {
        const existing = knownThemes(await sources()).find((entry) => entry.theme.id === check.theme!.id);

        if (existing?.source === "builtin") {
          io.err(`“${check.theme.name}” has the id of a theme that comes with ${PRODUCT.name} (${check.theme.id}). Change its id and add it again.`);
          return 1;
        }
        await store.save(check.theme);
      }
      if (json) io.out(JSON.stringify({ ok: true, theme: check.theme, adjusted: check.adjusted, warnings: check.warnings, ...(action === "add" ? { added: check.theme.id } : {}) }, null, 2));
      else {
        io.out(action === "add" ? `✓ Added ${check.theme.name} (${check.theme.id}) for everyone who uses ${PRODUCT.name} here.` : `✓ ${check.theme.name} can be used.`);
        const lines = reportLines(check);

        for (const line of lines) io.out(`  ${line}`);
        if (action === "check" && check.adjusted.some((adjustment) => adjustment.kind !== "tuned")) io.out(`  Adding it keeps the adjusted colors. \`${PRODUCT.slug} theme export\` prints them once it's added.`);
      }
      return 0;
    }
    case "use": {
      if (!target) throw new UsageError(`Say which theme, by id. \`${PRODUCT.slug} theme list\` shows them.`);
      const known = knownThemes(await sources()).find((entry) => entry.theme.id === target);

      if (!known) {
        io.err(`There's no theme called ${target} here. \`${PRODUCT.slug} theme list\` shows them; \`${PRODUCT.slug} theme add <file>\` adds one.`);
        return 1;
      }
      await settings.update({ appearance: { look: target } });
      io.out(json ? JSON.stringify({ default: target }, null, 2) : `✓ ${PRODUCT.name} opens with ${known.theme.name} here. An open app shows it when it's refreshed.`);
      return 0;
    }
    case "export": {
      if (!target) throw new UsageError(`Say which theme, by id. \`${PRODUCT.slug} theme list\` shows them.`);
      const known = knownThemes(await sources()).find((entry) => entry.theme.id === target);

      if (!known) {
        io.err(`There's no theme called ${target} here. \`${PRODUCT.slug} theme list\` shows them.`);
        return 1;
      }
      const text = themeFileText(checkTheme(known.theme).theme!);

      if (values.out) {
        await writeFile(resolve(io.cwd, values.out), text);
        io.out(json ? JSON.stringify({ written: values.out }, null, 2) : `✓ Wrote ${values.out}.`);
      } else io.out(text.trimEnd());
      return 0;
    }
    case "remove": {
      if (!target) throw new UsageError(`Say which theme, by id. \`${PRODUCT.slug} theme list\` shows them.`);
      if (!(await store.remove(target))) {
        io.err(`${target} isn't saved here. Built-in themes can't be removed.`);
        return 1;
      }
      io.out(json ? JSON.stringify({ removed: target }, null, 2) : `✓ Removed ${target}.`);
      return 0;
    }
    default:
      throw new UsageError(`${action} isn't a theme command. Run \`${PRODUCT.slug} theme --help\`.`);
  }
}
