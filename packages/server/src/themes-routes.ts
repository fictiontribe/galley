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

/** The id the default theme goes out under to anyone not signed in: its own id is a slug of its name. */
export const PUBLIC_LOOK_ID = "default";

/** How long a worked-out default is kept even with no event (a file edited by hand in the themes folder). */
const LOOK_CACHE_MS = 30_000;
const lookCache = new WeakMap<object, { at: number; value: Promise<AppliedTheme | null> }>();
const watched = new WeakSet<object>();

async function workOutDefault(ctx: Pick<RouteContext, "services" | "options">): Promise<AppliedTheme | null> {
  const settings = ctx.services.settings;
  // Only the one field: no secrets, providers or authors are looked at for a visitor.
  const chosen = settings.look ? await settings.look().catch(() => undefined) : (await settings.get().catch(() => null))?.appearance.look;

  return checkTheme(defaultTheme(chosen, await themeSources(ctx)).theme).applied;
}

/**
 * The install's default theme as it is put on the page (colours and
 * switches only: safe to show before sign-in). Worked out once and kept
 * until the themes, the default or the plugins change (their events), or
 * for 30 seconds at most.
 */
export function defaultLook(ctx: Pick<RouteContext, "services" | "options">): Promise<AppliedTheme | null> {
  const key = ctx.services;

  if (!watched.has(key)) {
    watched.add(key);
    ctx.services.events.subscribe((event) => {
      if (event.type === "themes.updated" || event.type === "plugins.updated") lookCache.delete(key);
    });
  }
  const cached = lookCache.get(key);

  if (cached && Date.now() - cached.at < LOOK_CACHE_MS) return cached.value;
  const value = workOutDefault(ctx).catch(() => null);

  lookCache.set(key, { at: Date.now(), value });
  return value;
}

/** The default as a visitor who isn't signed in receives it: the same colours and switches under a constant id. */
export async function publicLook(ctx: Pick<RouteContext, "services" | "options">): Promise<AppliedTheme | null> {
  const look = await defaultLook(ctx);

  return look ? { ...look, id: PUBLIC_LOOK_ID } : null;
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
  // The same for every visitor, signed in or not: the constant id, never the theme's own.
  const look = await publicLook(ctx).catch(() => null);
  const keeper = ctx.options.mode === "hosted" ? "browser" : "server";
  const start = JSON.stringify({ keeper, look }).replace(/</g, "\\u003c");

  return `self.galleyStart=${start};\n${script}`;
}
