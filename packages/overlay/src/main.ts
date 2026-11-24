/**
 * The script the preview proxies inject into every page:
 *   <script src="/__galley/overlay.js" defer></script>                          (the proposed page)
 *   <script src="/__galley/overlay.js" data-galley-role="follow" defer></script> (the deployed page)
 * and, on a page the dev server answered with an error, the status it came
 * with (`data-galley-status="500"`; see page.ts).
 *
 * It does nothing at all unless the page is framed. Running it twice (a hot
 * reload that re-executes scripts) keeps the first instance and re-announces it.
 */
import { createOverlay, type Overlay } from "./overlay";
import { readArrival } from "./page";

type OverlayWindow = Window & { __galleyOverlay?: Overlay };

function boot(): void {
  const win = window as OverlayWindow;
  if (win.parent === win) return;
  if (win.__galleyOverlay) {
    win.__galleyOverlay.announce();
    return;
  }
  const script = document.currentScript;
  const role = script?.getAttribute("data-galley-role") === "follow" ? "follow" : "edit";
  const ancestors = win.location.ancestorOrigins;
  const ancestorOrigin = ancestors && ancestors.length > 0 ? (ancestors[0] ?? null) : null;
  win.__galleyOverlay = createOverlay({ win, parent: win.parent, ancestorOrigin: ancestorOrigin === "null" ? null : ancestorOrigin, role, arrival: readArrival(script) });
}

boot();
