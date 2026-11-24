/**
 * Addresses of /api files the browser loads by itself, not through `fetch`:
 * `<img src>` and `<video src>` for media, thumbnails and generated
 * candidates, `<a href>` to open or download a file, and the odd
 * `location.assign`. A static host has nothing at /api, so each is answered
 * in the page instead:
 *
 * - media attributes are rewritten as they are set (before the browser asks
 *   for them): to the sample site's own file when the bytes are one of its
 *   photographs, otherwise to a `blob:` address of the bytes the mock holds;
 * - clicks on links to /api, and navigations to them or to an app path
 *   outside the demo, are kept in the page (the Navigation API, where the
 *   browser has it).
 */
import { isApiUrl } from "./transport";

/** What a media address becomes: an address now, one later, or a sign that there's nothing there. */
export type AssetAnswer = { kind: "url"; url: string } | { kind: "later"; url: Promise<string> } | { kind: "missing" };

/** An image the browser fails at once without asking the network, so `onError` handlers still run. */
export const MISSING_IMAGE = "data:image/gif;base64,";
/** Shown while an answer is on its way: a transparent pixel. */
export const PENDING_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const MEDIA_ATTRIBUTES = new Set(["src", "poster"]);

function isMediaElement(element: Element): boolean {
  return element instanceof HTMLImageElement || element instanceof HTMLMediaElement || element instanceof HTMLSourceElement;
}

export interface AssetHooks {
  /** Answer a media address under /api. */
  resolve(url: URL): AssetAnswer;
  /** Open (or download, with a file name) what an /api address answers. */
  open(url: URL, download: string | null): void;
  /** An app path the page tried to navigate to (`/sites/…/proof`): show it in the app instead. */
  route(path: string): void;
}

/** Install the rewriting on this window. Returns a function that takes it out again (tests). */
export function installAssetUrls(win: Window & typeof globalThis, hooks: AssetHooks): () => void {
  const origin = win.location.origin;
  const appBase = new URL(".", win.location.href).pathname;
  const proto = win.Element.prototype;
  const setAttribute = proto.setAttribute;

  const rewrite = (element: Element, name: string, value: string, set: (value: string) => void): boolean => {
    if (!MEDIA_ATTRIBUTES.has(name.toLowerCase()) || !isMediaElement(element)) return false;
    let url: URL;
    try {
      url = new URL(value, origin);
    } catch {
      return false;
    }
    if (!isApiUrl(url, origin)) return false;
    const answer = hooks.resolve(url);
    if (answer.kind === "url") set(answer.url);
    else if (answer.kind === "missing") set(MISSING_IMAGE);
    else {
      set(PENDING_IMAGE);
      element.setAttribute("data-demo-pending", value);
      answer.url.then(
        (resolved) => {
          if (element.getAttribute("data-demo-pending") !== value) return;
          element.removeAttribute("data-demo-pending");
          set(resolved);
        },
        () => set(MISSING_IMAGE),
      );
    }
    return true;
  };

  proto.setAttribute = function setAttributeInDemo(this: Element, name: string, value: string) {
    if (rewrite(this, name, String(value), (next) => setAttribute.call(this, name, next))) return;
    setAttribute.call(this, name, value);
  };

  // `img.src = …` (rather than an attribute) goes through the property's own setter.
  const restore: Array<() => void> = [];
  for (const ctor of [win.HTMLImageElement, win.HTMLMediaElement, win.HTMLSourceElement]) {
    const descriptor = Object.getOwnPropertyDescriptor(ctor.prototype, "src");
    if (!descriptor?.set || !descriptor.get) continue;
    const { get, set } = descriptor;
    Object.defineProperty(ctor.prototype, "src", {
      configurable: true,
      enumerable: descriptor.enumerable,
      get,
      set(this: Element, value: string) {
        if (rewrite(this, "src", String(value), (next) => set.call(this, next))) return;
        set.call(this, value);
      },
    });
    restore.push(() => Object.defineProperty(ctor.prototype, "src", descriptor));
  }

  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = (event.target as Element | null)?.closest?.("a[href]");
    if (!(anchor instanceof win.HTMLAnchorElement)) return;
    const url = new URL(anchor.href, origin);
    if (!isApiUrl(url, origin)) return;
    event.preventDefault();
    hooks.open(url, anchor.hasAttribute("download") ? anchor.getAttribute("download") || url.pathname.split("/").pop() || "download" : null);
  };
  win.document.addEventListener("click", onClick, true);

  // `location.assign("/sites/…")` and `location.assign("/api/…")` would leave the demo for the marketing site.
  type NavigateEvent = Event & { destination: { url: string }; cancelable: boolean; hashChange: boolean; downloadRequest: string | null };
  const navigation = (win as unknown as { navigation?: EventTarget }).navigation;
  const onNavigate = (event: Event) => {
    const navigate = event as NavigateEvent;
    if (!navigate.cancelable || navigate.hashChange) return;
    const url = new URL(navigate.destination.url);
    if (url.origin !== origin || url.pathname.startsWith(appBase)) return;
    if (isApiUrl(url, origin)) {
      navigate.preventDefault();
      hooks.open(url, navigate.downloadRequest);
      return;
    }
    // The marketing site's own pages (the way out of the demo) are left alone; only the app's paths come back in.
    if (url.pathname.startsWith("/sites/") || url.pathname === "/settings" || url.pathname === "/plugins") {
      navigate.preventDefault();
      hooks.route(`${url.pathname}${url.search}${url.hash}`);
    }
  };
  navigation?.addEventListener("navigate", onNavigate);

  return () => {
    proto.setAttribute = setAttribute;
    for (const undo of restore) undo();
    win.document.removeEventListener("click", onClick, true);
    navigation?.removeEventListener("navigate", onNavigate);
  };
}
