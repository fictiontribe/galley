import { useEffect } from "react";
import faviconUrl from "@brand/logo/favicon.svg?url";
import { api } from "@/lib/api";
import { setQueryData } from "@/lib/query";
import { useMeta } from "@/lib/stores/meta";
import { keys } from "@/lib/sync";
import { useUi } from "@/lib/stores/ui";
import { useDocumentTitle } from "./title";
import { mayCall } from "@/lib/may";

/**
 * Applies the white-label brand and the theme to the document: --accent on
 * :root (every accent shade re-derives from it in tokens.css), data-theme,
 * the favicon and the title.
 */
export function BrandEffects() {
  const accent = useMeta((s) => s.meta?.brand.accent);
  const logoUrl = useMeta((s) => s.meta?.brand.logoUrl);
  const theme = useUi((s) => s.theme);
  useDocumentTitle();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // The theme lives in the server's settings; the local copy only avoids a
  // flash at start-up (and, on a hosted install, is the theme itself for
  // people who don't look after the settings). Coming back to the window picks up a change made in
  // another one.
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
          // Someone who can't change the editor's settings keeps their own theme, in this browser (Your account).
          if (mayCall(useMeta.getState().meta, "PATCH /api/settings")) useUi.getState().setTheme(settings.appearance.theme);
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

  useEffect(() => {
    const root = document.documentElement;
    if (accent) root.style.setProperty("--accent", accent);
    else root.style.removeProperty("--accent");
  }, [accent]);

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
