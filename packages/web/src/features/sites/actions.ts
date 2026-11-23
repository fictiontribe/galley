/**
 * What the Sites screen, the switcher and the palette do to a site, in one
 * place: file it, open it (here or in a new window), show its folder.
 */
import type { SitePatch, SiteSummary } from "@galley/core/types";
import { api, errorShape } from "@/lib/api";
import { useSites } from "@/lib/stores/sites";
import { notify } from "@/lib/stores/toasts";
import { placeFor, siteBase } from "./logic";
import { useGroups, useSitesView } from "./store";

/** What the desktop shell adds to the page (see apps/desktop/src-tauri/src/bridge.js). */
interface DesktopBridge {
  revealInFinder?: (path: string) => Promise<void>;
}

function bridge(): DesktopBridge | undefined {
  return (window as unknown as { __GALLEY_DESKTOP__?: DesktopBridge }).__GALLEY_DESKTOP__;
}

/** The desktop app hosts this page: sites can open in windows of their own and folders can be shown. */
export function inDesktop(): boolean {
  return Boolean(bridge());
}

/** Where switching to a site takes you: where you left it. */
export function siteTarget(siteId: string): string {
  return placeFor(useSitesView.getState().places, siteId);
}

/**
 * Records the place in the site being left, from the address bar. The router
 * runs navigations as transitions: a screen whose code is still loading has
 * the new address before React has it, and a quick switch would otherwise
 * remember the screen before it.
 */
export function rememberHere(): void {
  const match = /^\/sites\/([^/?#]+)/.exec(window.location.pathname);
  if (!match?.[1]) return;
  const params = new URLSearchParams(window.location.search);
  params.delete("galley-window");
  const search = params.toString();
  useSitesView.getState().remember(decodeURIComponent(match[1]), `${window.location.pathname}${search ? `?${search}` : ""}`);
}

/** Switch to a site, to where it was left. */
export function goToSite(navigate: (to: string) => void, siteId: string): void {
  rememberHere();
  navigate(siteTarget(siteId));
}

/**
 * Opens the site in a window of its own. The desktop shell turns a
 * `window.open` of one of the app's site pages carrying `galley-window=new`
 * into a new app window (and refuses every other address); in a browser it is
 * simply a new tab.
 */
export function openInNewWindow(siteId: string): void {
  const target = siteTarget(siteId);
  const url = new URL(target, window.location.origin);
  url.searchParams.set("galley-window", "new");
  window.open(url.pathname + url.search, "_blank", "noopener");
}

export async function revealInFinder(site: SiteSummary): Promise<void> {
  const reveal = bridge()?.revealInFinder;
  if (!reveal) return;
  try {
    await reveal(site.root);
  } catch (error) {
    notify({ tone: "danger", title: "Couldn’t show the folder", body: String((error as Error)?.message ?? error) });
  }
}

/** Files a site and updates the list straight away (the server's answer replaces it). */
export async function fileSite(site: SiteSummary, patch: SitePatch): Promise<SiteSummary | null> {
  const sites = useSites.getState().sites;
  try {
    const updated = await api("PATCH /api/sites/:siteId/listing", { params: { siteId: site.id }, body: patch });
    useSites.setState({ sites: (useSites.getState().sites ?? sites ?? []).map((candidate) => (candidate.id === site.id ? { ...candidate, ...updated } : candidate)) });
    return updated;
  } catch (error) {
    notify({ tone: "danger", title: "Couldn’t change that", body: errorShape(error).message, detail: errorShape(error).detail });
    return null;
  }
}

export async function reloadSitesAndGroups(): Promise<void> {
  await Promise.all([useSites.getState().load(), useGroups.getState().load()]);
}

export { siteBase };
