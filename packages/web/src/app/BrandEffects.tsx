import { useEffect, useLayoutEffect, useRef } from "react";
import faviconUrl from "@brand/logo/favicon.svg?url";
import { api } from "@/lib/api";
import { setQueryData } from "@/lib/query";
import { useMeta } from "@/lib/stores/meta";
import { keys } from "@/lib/sync";
import { UI_STORAGE_KEY, useUi } from "@/lib/stores/ui";
import { shownTheme, themeKeeper } from "@/lib/theme";
import { useDocumentTitle } from "./title";
import { followSettingsTheme, usePrintOnPaper, useSystemDark, useThemeFromOtherWindows } from "./theme";
import { useLookOnPage } from "./look";

/**
 * Applies the appearance (data-theme: light, dark or the system's), the
 * theme (app/look.ts), the favicon and the title to the document. A
 * white-label brand's accent is not set here on its own: it is the
 * built-in themes' pencil (core themes/builtin.ts), so it arrives with the
 * theme and the two never fight over the same properties.
 */
export function BrandEffects() {
  const meta = useMeta((s) => s.meta);
  const logoUrl = meta?.brand.logoUrl;
  const theme = useUi((s) => s.theme);
  const systemDark = useSystemDark();
  const syncedStart = useRef(false);
  useDocumentTitle();

  useLayoutEffect(() => {
    let activeTheme = theme;
    if (!syncedStart.current) {
      syncedStart.current = true;
      const start = (globalThis as { galleyStart?: { keeper?: unknown; theme?: unknown } }).galleyStart;
      const startTheme = start?.theme === "light" || start?.theme === "dark" || start?.theme === "system" ? start.theme : null;
      const ui = useUi.getState();
      if (startTheme && (start?.keeper === "server" || !ui.themeChosen) && ui.theme !== startTheme) {
        activeTheme = startTheme;
        ui.followTheme(startTheme);
      }
    }
    document.documentElement.dataset.theme = activeTheme;
    document.documentElement.style.colorScheme = shownTheme(activeTheme, systemDark);
  }, [theme, systemDark]);

  // Where the theme lives depends on the app (lib/theme.ts): in local mode
  // and the desktop app it is the server's setting, and the copy in this
  // browser only avoids a flash at start-up; on a hosted install the copy is
  // the person's own theme and the server's setting only where they start.
  // Another window in this browser is followed at once; coming back to the
  // window picks up a change the server holds when this browser follows it.
  useThemeFromOtherWindows(UI_STORAGE_KEY);
  usePrintOnPaper();
  const authenticated = Boolean(meta?.authenticated);
  useEffect(() => {
    if (!authenticated || !meta) return;
    let inflight = false;
    const pull = () => {
      if (inflight || document.visibilityState === "hidden") return;
      const currentMeta = useMeta.getState().meta;
      if (!currentMeta) return;
      if (themeKeeper(currentMeta) !== "server" && useUi.getState().themeChosen) return;
      inflight = true;
      api("GET /api/settings")
        .then((settings) => {
          setQueryData(keys.settings(), settings);
          followSettingsTheme(settings);
        })
        .catch(() => undefined)
        .finally(() => (inflight = false));
    };
    window.addEventListener("focus", pull);
    document.addEventListener("visibilitychange", pull);
    return () => {
      window.removeEventListener("focus", pull);
      document.removeEventListener("visibilitychange", pull);
    };
  }, [authenticated, meta]);

  useLookOnPage();

  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>("link[rel=icon]");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.append(link);
    }
    link.type = "image/svg+xml";
    link.href = logoUrl ?? faviconUrl;
  }, [logoUrl]);

  return null;
}
