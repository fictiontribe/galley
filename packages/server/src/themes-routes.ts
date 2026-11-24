/**
 * Themes for the app (docs/themes.md): the ones saved for everyone here, the
 * ones plugins add, and the install's default. Each person's own choice is
 * not here: on a hosted install it lives in their browser, and in local mode
 * and the desktop app it is the default itself (App settings).
 *
 * Also the start-up script (`/theme.js`), which carries the default theme so
 * the sign-in screen and a browser that has never opened the app show it
 * before their first paint.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { checkTheme, defaultTheme, type AppliedTheme, type PluginTheme, type ThemeSources } from "@galley/core/themes";
import type { ThemeStore } from "@galley/core/themes/store";
import type { SettingsPatch } from "@galley/core/types";
import { invalid, notFound } from "./errors";
import type { RouteContext, RouteTable } from "./routes";
import * as v from "./validate";

type ThemeRouteKey = "GET /api/themes" | "PUT /api/themes/:themeId" | "DELETE /api/themes/:themeId";

const themeBody = z.object({ theme: z.unknown() }).strict();

function storeOf(ctx: RouteContext): ThemeStore | null {
  return ctx.services.themes ?? null;
}

/** The themes enabled plugins add, already checked by the registry. */
export function pluginThemes(ctx: Pick<RouteContext, "services">): PluginTheme[] {
  const plugins = ctx.services.plugins as { themes?: () => PluginTheme[] } | undefined;

  try {
    return typeof plugins?.themes === "function" ? plugins.themes() : [];
  } catch {
    return [];
  }
}

export async function themeSources(ctx: Pick<RouteContext, "services" | "options">): Promise<ThemeSources> {
  const saved = (await ctx.services.themes?.list().catch(() => [])) ?? [];

  return { brand: { accent: ctx.options.brand.accent ?? null, theme: ctx.options.brand.theme ?? null }, saved, plugins: pluginThemes(ctx) };
}

/** The install's default theme as it is put on the page (colours and switches only: safe to show before sign-in). */
export async function defaultLook(ctx: Pick<RouteContext, "services" | "options">): Promise<AppliedTheme | null> {
  const [sources, settings] = await Promise.all([themeSources(ctx), ctx.services.settings.get().catch(() => null)]);

  return checkTheme(defaultTheme(settings?.appearance.look, sources).theme).applied;
}

/** PATCH /api/settings names a default theme: it must be one this install has. */
export async function checkLookPatch(ctx: RouteContext, patch: SettingsPatch): Promise<void> {
  const look = patch.appearance?.look;

  if (look === undefined) return;
  const sources = await themeSources(ctx);
  const known = defaultTheme(look, sources);

  if (known.theme.id !== look) throw invalid("That theme isn’t one this editor has. Save it for everyone here first.");
}

export const themeRoutes: Pick<RouteTable, ThemeRouteKey> = {
  "GET /api/themes": async (_c, ctx) => {
    const [sources, settings, scanned] = await Promise.all([themeSources(ctx), ctx.services.settings.get(), ctx.services.themes?.scan().catch(() => null)]);
    const skipped = scanned?.skipped ?? [];

    return { saved: sources.saved, plugins: sources.plugins ?? [], defaultId: defaultTheme(settings.appearance.look, sources).theme.id, ...(skipped.length ? { skipped } : {}) };
  },

  "PUT /api/themes/:themeId": async (c, ctx) => {
    const store = storeOf(ctx);

    if (!store) throw notFound("Saving themes isn’t available on this server.");
    const { theme } = await v.body(c, themeBody);
    const check = await store.save(theme, { id: c.req.param("themeId") ?? "" });

    ctx.services.events.emit({ type: "themes.updated" });
    return { theme: check.theme!, adjusted: check.adjusted, warnings: check.warnings };
  },

  "DELETE /api/themes/:themeId": async (c, ctx) => {
    const store = storeOf(ctx);

    if (!store) throw notFound("Saving themes isn’t available on this server.");
    const removed = await store.remove(c.req.param("themeId") ?? "");

    if (!removed) throw notFound("That theme isn’t saved here.");
    ctx.services.events.emit({ type: "themes.updated" });
    return { ok: true };
  },
};

/**
 * `/theme.js` with the install's default theme in front of it, so a browser
 * with nothing saved yet (the sign-in screen, a first visit) paints the
 * default from the start. Only the applied theme goes out: colours that are
 * exactly #RRGGBB and switches from their lists, written as JSON (with `<`
 * escaped), never anyone's words.
 */
export async function themeScript(webDir: string, ctx: Pick<RouteContext, "services" | "options">): Promise<string | null> {
  let script: string;

  try {
    script = await readFile(join(webDir, "theme.js"), "utf8");
  } catch {
    return null;
  }
  const look = await defaultLook(ctx).catch(() => null);
  const keeper = ctx.options.mode === "hosted" ? "browser" : "server";
  const start = JSON.stringify({ keeper, look }).replace(/</g, "\\u003c");

  return `self.galleyStart=${start};\n${script}`;
}
