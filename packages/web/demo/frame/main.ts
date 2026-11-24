/**
 * The script every page of the demo's sample site carries (added when the
 * snapshot is built; see demo/scripts/snapshot.mjs). In the app's preview it
 * stands in for what the site's own dev server and Galley's preview proxy
 * would do:
 *
 * - loads the real overlay (click to edit, Arrange, following the other frame),
 *   in the role the frame's name gives: the live frame only follows;
 * - in the proposed frame, draws the working copy onto the page and redraws
 *   whenever it changes (demo/frame/apply.ts);
 * - sends the site's forms to the demo's inbox, as Galley's preview does;
 * - keeps links to other sites from leaving the demo.
 *
 * Opened on its own (outside the app), the page is the sample site as last
 * published, with a line saying so.
 */
import type { DemoBridge } from "../bridge";
import { createDrawing, type Drawn } from "./apply";

const script = document.currentScript as HTMLScriptElement | null;
// …/site/__demo/frame.js → …/site
const siteBase = new URL("..", script?.src ?? window.location.href).pathname.replace(/\/+$/, "");
const framed = window.parent !== window;
const live = /-live$/.test(window.name);

function bridgeOf(): DemoBridge | undefined {
  try {
    return framed ? window.parent.__galleyDemo : undefined;
  } catch {
    return undefined;
  }
}

/** The page's path on the site itself: /demo/site/atelier/ → /atelier/. */
export function sitePath(pathname: string, base: string): string {
  if (!pathname.startsWith(base)) return pathname;
  const rest = pathname.slice(base.length) || "/";
  return rest.replace(/index\.html$/, "");
}

function loadOverlay(): void {
  const overlay = document.createElement("script");
  overlay.src = `${siteBase}/__galley/overlay.js`;
  overlay.defer = true;
  if (live) overlay.setAttribute("data-galley-role", "follow");
  document.head.append(overlay);
}

const NOTE_STYLE =
  "position:fixed;z-index:2147483000;left:12px;bottom:12px;max-width:min(420px,calc(100% - 24px));padding:8px 12px;border-radius:8px;background:rgba(17,15,13,.9);color:#f7f6f3;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.25)";

function note(id: string, text: string | null): void {
  let element = document.getElementById(id);
  if (!text) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement("div");
    element.id = id;
    element.setAttribute("data-demo-note", "");
    element.setAttribute("role", "status");
    element.setAttribute("style", NOTE_STYLE);
    document.body.append(element);
  }
  element.textContent = text;
}

function describe(drawn: Drawn): string | null {
  const parts: string[] = [];
  if (drawn.missing.length === 1) parts.push("1 change to this page isn’t drawn here in the demo, which only redraws words and pictures. It’s listed in Proof.");
  else if (drawn.missing.length > 1) parts.push(`${drawn.missing.length} changes to this page aren’t drawn here in the demo, which only redraws words and pictures. They’re listed in Proof.`);
  return parts.length ? parts.join(" ") : null;
}

function drawWorkingCopy(bridge: DemoBridge): void {
  const drawing = createDrawing(document, siteBase);
  const path = sitePath(window.location.pathname, siteBase);
  const redraw = () => {
    const drawn = drawing.draw(bridge.state(path));
    if (drawn.needsFreshPage) {
      // The sections moved: start again from the built page, which then draws them in their new order.
      window.location.reload();
      return;
    }
    note("galley-demo-note", describe(drawn));
  };
  redraw();
  const stop = bridge.subscribe(redraw);
  window.addEventListener("pagehide", stop, { once: true });
}

function keepLinksInside(): void {
  document.addEventListener(
    "click",
    (event) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || event.defaultPrevented) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.protocol === "mailto:" || url.protocol === "tel:") return;
      const inside = url.origin === window.location.origin && url.pathname.startsWith(`${siteBase}/`);
      if (inside) return;
      event.preventDefault();
      note("galley-demo-link", "Links that leave the sample site don’t open in the demo.");
      setTimeout(() => note("galley-demo-link", null), 3500);
    },
    true,
  );
}

/** The site's forms send to the inbox: the address Galley's preview gives them, answered by the demo. */
function sendFormsToTheInbox(bridge: DemoBridge): void {
  const endpoint = `${siteBase}/__demo/capture`;
  document.documentElement.dataset.galleyEndpoint = endpoint;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (url.pathname !== endpoint) return original(input, init);
    const body = JSON.parse(String(init?.body ?? "{}")) as { form?: string; values?: Record<string, string>; page?: { url: string; title: string } };
    const id = bridge.submit(body.form ?? "", body.values ?? {}, body.page ?? { url: window.location.href, title: document.title });
    const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    return id ? json(200, { ok: true, id }) : json(404, { ok: false, message: "In the demo only the contact form sends to the inbox." });
  };
}

function start(): void {
  if (!framed) {
    note("galley-demo-note", "This is the demo’s sample site as last published. Your changes show in the demo’s preview.");
    return;
  }
  loadOverlay();
  keepLinksInside();
  const bridge = bridgeOf();
  if (!bridge) return;
  sendFormsToTheInbox(bridge);
  if (live) return;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => drawWorkingCopy(bridge), { once: true });
  else drawWorkingCopy(bridge);
}

start();
