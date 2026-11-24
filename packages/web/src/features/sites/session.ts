/**
 * What being inside a site does in the background:
 *  - remembers where you are in it (screen, open entry) and puts back its
 *    pane sizes and preview mode when you return (`useSitesView.enter`);
 *  - tells the server an editor is open on it every 30 s while the window is
 *    visible, so its preview isn't stopped as unused;
 *  - when you come back to a window whose preview was paused to save memory,
 *    starts it again — the preview shows "Waking the preview…", not an error.
 * And, everywhere: ⌘1…⌘9 (Ctrl elsewhere) jump to the pinned and most
 * recently used sites.
 */
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { usePreview } from "@/lib/stores/preview";
import { useSites } from "@/lib/stores/sites";
import { goToSite } from "./actions";
import { shortcutDigit, shortcutSites } from "./logic";
import { useSitesView } from "./store";

const PRESENCE_MS = 30_000;
/** Set by the Sites screen's "open in a new window"; the desktop shell reads it, the page drops it. */
export const NEW_WINDOW_PARAM = "galley-window";

function wantsPreview(pathname: string): boolean {
  return /\/(edit|proof)(\/|$)/.test(pathname);
}

export function useSiteSession(siteId: string): void {
  const location = useLocation();
  const navigate = useNavigate();
  const enter = useSitesView((s) => s.enter);
  const remember = useSitesView((s) => s.remember);

  useEffect(() => {
    if (siteId) enter(siteId);
  }, [siteId, enter]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.has(NEW_WINDOW_PARAM)) {
      params.delete(NEW_WINDOW_PARAM);
      const search = params.toString();
      navigate(`${location.pathname}${search ? `?${search}` : ""}`, { replace: true });
      return;
    }
    if (siteId) remember(siteId, `${location.pathname}${location.search}`);
  }, [siteId, location.pathname, location.search, remember, navigate]);

  useEffect(() => {
    if (!siteId) return;
    let stopped = false;
    const beat = () => {
      if (stopped || document.visibilityState !== "visible") return;
      void api("POST /api/sites/:siteId/presence", { params: { siteId } }).catch(() => undefined);
    };
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      beat();
      const status = usePreview.getState().bySite[siteId];
      if (status?.state === "idle" && status.paused && wantsPreview(window.location.pathname)) {
        void usePreview.getState().run(siteId, "start").catch(() => undefined);
      }
    };
    beat();
    const timer = window.setInterval(beat, PRESENCE_MS);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [siteId]);
}

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** ⌘1…⌘9 to the pinned and recent sites; off where there are no other sites (a hosted install). */
export function useSiteShortcuts(enabled = true): void {
  const navigate = useNavigate();
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const digit = shortcutDigit(event, isMac());
      if (digit === null) return;
      const site = shortcutSites(useSites.getState().sites ?? [])[digit - 1];
      if (!site) return;
      event.preventDefault();
      goToSite(navigate, site.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, enabled]);
}
