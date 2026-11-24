/**
 * Whether the page in the frame was drawn at all.
 *
 * A dev server that can't render a page answers with an error page instead —
 * Astro's is a `<title>` and the Vite client, which then shows the error in a
 * `<vite-error-overlay>` — and the overlay is injected into that page like
 * any other. Without this, the app would take the error page for a page whose
 * sections aren't marked. The proxy hands the overlay the status the page
 * came with on its own script tag (`data-galley-status`, and
 * `data-galley-unavailable` on the proxy's own "not answering" page); the
 * framework's own words come from its error overlay, which can also appear
 * later on a page that drew (an edit that broke it while it was open).
 */
import type { PageDrawState } from "@galley/core/types";

/** What the proxy said about this page, read from the overlay's script tag. */
export interface PageArrival {
  status: number | null;
  unavailable: boolean;
}

export interface PageWatch {
  current(): PageDrawState;
  dispose(): void;
}

/** Framework error overlays: Vite's (and Astro's, which uses the same element). */
const ERROR_OVERLAYS = "vite-error-overlay";
/** Where those overlays keep the message itself, in their (open) shadow roots. */
const MESSAGE_PARTS = "#message-content, .message-body, .message";
/** How long to wait for the framework's message before using the page's own words. */
const MESSAGE_WAIT_MS = 3000;
const MAX_MESSAGE = 300;
/** Titles that say nothing a developer can act on. */
const EMPTY_TITLES = /^(error|internal server error|500|server error|astroerror)$/i;

/** The first line that says something: not blank, not just punctuation, not a stack frame. */
export function firstMeaningfulLine(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line || !/[\p{L}\p{N}]/u.test(line)) continue;
    if (/^at\s+\S/.test(line) || /^(error|stack trace):?$/i.test(line)) continue;
    return line.length > MAX_MESSAGE ? `${line.slice(0, MAX_MESSAGE - 1)}…` : line;
  }
  return null;
}

/** The framework's error overlay on the page, when one is showing. */
function errorOverlay(doc: Document): Element | null {
  return doc.querySelector(ERROR_OVERLAYS);
}

function overlayMessage(element: Element): string | null {
  const root = element.shadowRoot;
  const part = root?.querySelector(MESSAGE_PARTS) ?? element.querySelector(MESSAGE_PARTS);
  return firstMeaningfulLine(part?.textContent ?? root?.textContent ?? element.textContent);
}

/** The page's own words about the error when no framework overlay says more: a telling title, else its first line of text. */
function pageMessage(doc: Document): string | null {
  const title = doc.title.trim();
  if (title && !EMPTY_TITLES.test(title)) return firstMeaningfulLine(title);
  const body = doc.body;
  if (!body) return null;
  const clone = body.cloneNode(true) as HTMLElement;
  for (const element of Array.from(clone.querySelectorAll("script,style,template,noscript,[data-galley-arrange],[data-galley-tag]"))) element.remove();
  return firstMeaningfulLine(clone.innerText ?? clone.textContent);
}

/** How the page arrived, before any framework overlay is considered. */
function arrivalState(arrival: PageArrival): PageDrawState["state"] {
  if (arrival.unavailable) return "unavailable";
  if (arrival.status !== null && arrival.status >= 500) return "failed";
  if (arrival.status === 404 || arrival.status === 410) return "missing";
  return "drawn";
}

/**
 * Watches the page: `onChange` hears every change of state (and the
 * framework's message arriving), never the same state twice.
 */
export function watchPage(win: Window, arrival: PageArrival, onChange: (state: PageDrawState) => void): PageWatch {
  const doc = win.document;
  const base = arrivalState(arrival);
  let waited = false;
  let state: PageDrawState = read();
  // The first state goes out with `ready` (the overlay's announce); this only says changes.
  let said = JSON.stringify(state);

  function read(): PageDrawState {
    const shown = errorOverlay(doc);
    if (shown) return { state: "failed", status: arrival.status, message: overlayMessage(shown) };
    return { state: base, status: arrival.status, message: base === "failed" && waited ? pageMessage(doc) : null };
  }
  const check = () => {
    state = read();
    const signature = JSON.stringify(state);
    if (signature === said) return;
    said = signature;
    onChange(state);
  };

  // The framework adds its overlay to <body> (there is one by the time this deferred script runs), its shadow root already filled.
  const observer = typeof MutationObserver === "function" ? new MutationObserver(check) : null;
  if (doc.body) observer?.observe(doc.body, { childList: true });
  const timer =
    base === "failed"
      ? setTimeout(() => {
          waited = true;
          check();
        }, MESSAGE_WAIT_MS)
      : null;

  return {
    current: () => state,
    dispose() {
      observer?.disconnect();
      if (timer) clearTimeout(timer);
    },
  };
}

/** The proxy's word on this page, from the overlay's own script tag. */
export function readArrival(script: Element | null): PageArrival {
  const raw = script?.getAttribute("data-galley-status");
  const status = raw && /^\d{3}$/.test(raw) ? Number(raw) : null;
  return { status, unavailable: script?.hasAttribute("data-galley-unavailable") ?? false };
}
