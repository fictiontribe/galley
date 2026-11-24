/**
 * Themes in the mock: the ones saved "for everyone here" kept in memory, the
 * default named in the mock's settings, and the default theme on /api/meta,
 * as the real server answers (server/src/themes-routes.ts).
 *
 * The check itself is core's (`@galley/core/themes`), loaded on first use
 * like the role table: the dev server hands over a copy loaded through Vite
 * (plugin.ts), because Node's own loader can't follow core's extension-less
 * imports; tests and the demo import it here.
 */
import type { AppliedTheme, PluginTheme, ThemeFile, ThemeSources } from "@galley/core/themes";
import type { Handlers, MockBackend } from "./backend.ts";
import { MockError } from "./site.ts";

export type ThemesEngine = typeof import("@galley/core/themes");

type ThemeRouteKey = "GET /api/themes" | "PUT /api/themes/:themeId" | "DELETE /api/themes/:themeId";

export function loadThemesEngine(): Promise<ThemesEngine> {
  return import("@galley/core/themes");
}

export interface MockThemes {
  handlers: Pick<Handlers, ThemeRouteKey>;
  /** The install's default theme as it is put on the page (for /theme.js), worked out now. */
  look(): Promise<AppliedTheme | null>;
  /**
   * The same, as last worked out: /api/meta answers at once (callers such as
   * the demo wrap it without waiting), so it reads this, kept current after
   * every change to the themes or the default.
   */
  current(): AppliedTheme | null;
  /** The default changed (settings): work it out again. */
  refresh(): Promise<void>;
  /** Refuses a default that isn't one of the install's themes. */
  checkLook(look: string | undefined): Promise<void>;
  saved: Map<string, ThemeFile>;
}

export function createMockThemes(mock: MockBackend, engine: () => Promise<ThemesEngine>, plugins: () => PluginTheme[] = () => []): MockThemes {
  const saved = new Map<string, ThemeFile>();
  const sources = (): ThemeSources => ({ saved: [...saved.values()], plugins: plugins() });
  let cached: AppliedTheme | null = null;
  const look = async () => {
    const themes = await engine();
    return themes.checkTheme(themes.defaultTheme(mock.settings.appearance.look, sources()).theme).applied;
  };
  const refresh = async () => {
    cached = await look().catch(() => cached);
  };
  void refresh();

  return {
    saved,
    look,
    current: () => cached,
    refresh,
    async checkLook(look) {
      if (look === undefined) return;
      const themes = await engine();
      if (themes.defaultTheme(look, sources()).theme.id !== look) throw new MockError("invalid", "That theme isn’t one this editor has. Save it for everyone here first.");
    },
    handlers: {
      "GET /api/themes": async () => {
        const themes = await engine();
        return { saved: [...saved.values()], plugins: plugins(), defaultId: themes.defaultTheme(mock.settings.appearance.look, sources()).theme.id };
      },
      "PUT /api/themes/:themeId": async ({ params, body }) => {
        const themes = await engine();
        const check = themes.checkTheme(body?.theme);
        if (!check.ok || !check.theme) throw new MockError("invalid", check.refused.join(" ") || "This theme can’t be used.");
        if (check.theme.id !== params.themeId) throw new MockError("invalid", "The theme’s id doesn’t match where it was saved.");
        if (themes.isBuiltinTheme(check.theme.id)) throw new MockError("conflict", `“${check.theme.name}” has the id of a theme that comes with the app. Give it another name.`);
        saved.set(check.theme.id, check.theme);
        await refresh();
        mock.emit({ type: "themes.updated" });
        return { theme: check.theme, adjusted: check.adjusted, warnings: check.warnings };
      },
      "DELETE /api/themes/:themeId": async ({ params }) => {
        if (!saved.delete(params.themeId)) throw new MockError("not-found", "That theme isn’t saved here.");
        await refresh();
        mock.emit({ type: "themes.updated" });
        return { ok: true };
      },
    },
  };
}
