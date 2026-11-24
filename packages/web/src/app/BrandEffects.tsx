import { useEffect } from "react";
import faviconUrl from "@brand/logo/favicon.svg?url";
import { api } from "@/lib/api";
import { setQueryData } from "@/lib/query";
import { useMeta } from "@/lib/stores/meta";
import { keys } from "@/lib/sync";
import { UI_STORAGE_KEY, useUi } from "@/lib/stores/ui";
import { useDocumentTitle } from "./title";
import { followSettingsTheme, usePrintOnPaper, useThemeFromOtherWindows } from "./theme";
import { useLookOnPage } from "./look";

/**
 * Applies the appearance (data-theme: light, dark or the system's), the
 * theme (app/look.ts), the favicon and the title to the document. A
 * white-label brand's accent is not set here on its own: it is the
 * built-in themes' pencil (core themes/builtin.ts), so it arrives with the
 * theme and the two never fight over the same properties.
 */
export function BrandEffects() {
  const logoUrl = useMeta((s) => s.meta?.brand.logoUrl);
  const theme = useUi((s) => s.theme);
  useDocumentTitle();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Where the theme lives depends on the app (lib/theme.ts): in local mode
  // and the desktop app it is the server's setting, and the copy in this
  // browser only avoids a flash at start-up; on a hosted install the copy is
  // the person's own theme and the server's setting only where they start.
  // Another window in this browser is followed at once; coming back to the
  // window picks up a change the server holds.
  useThemeFromOtherWindows(UI_STORAGE_KEY);
  usePrintOnPaper();
  const authenticated = useMeta((s) => Boolean(s.meta?.authenticated));
  useEffect(() => {
    if (!authenticated) return;
    let inflight = false;
    const pull = () => {
      if (inflight || document.visibilityState === "hidden") return;
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
  }, [authenticated]);

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
