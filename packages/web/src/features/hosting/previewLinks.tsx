/**
 * Links to the running preview outside the preview pane — Site home's "Open
 * in a new tab", a collection's "Open on the site", the agent-readable
 * versions on Visibility, a data-source picker's pictures and the Brand
 * screen's measuring frame.
 *
 * On this computer they use the preview's address as they always have. On a
 * hosted install the preview answers only a browser let in through the entry
 * route (features/preview/entry.ts), so each one goes through it: a link the
 * person clicks opens the entered address in a new tab; a picture or a frame
 * loads an entered address. The decisions are pure, one per place, so they
 * can be tested without a browser.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { MetaInfo } from "@galley/core/types";
import { entryAddress, needsEntry, requestEntry } from "@/features/preview/entry";
import { openInNewTab } from "./useHosting";

/** Where a preview link goes: the address itself, or (hosted) a path to enter at. */
export type PreviewTarget = { kind: "direct"; href: string } | { kind: "entry"; path: string };

/** Site home: "Open in a new tab" on the running preview. */
export function siteHomePreviewTarget(meta: MetaInfo | null | undefined, previewUrl: string): PreviewTarget {
  return needsEntry(meta) ? { kind: "entry", path: "/" } : { kind: "direct", href: previewUrl };
}

/**
 * A collection's "Open on the site": the preview while it runs, else the
 * live address. Only the preview needs the entry; the live site is anyone's.
 */
export function collectionSiteTarget(meta: MetaInfo | null | undefined, previewUrl: string | null, production: string | null, path: string): PreviewTarget | null {
  if (previewUrl) return needsEntry(meta) ? { kind: "entry", path } : { kind: "direct", href: new URL(path, previewUrl).toString() };
  return production ? { kind: "direct", href: new URL(path, production).toString() } : null;
}

/** Visibility › "What an AI agent reads": llms.txt and a page's markdown twin, on the preview. */
export function agentFileTarget(meta: MetaInfo | null | undefined, previewUrl: string, path: string): PreviewTarget {
  return needsEntry(meta) ? { kind: "entry", path } : { kind: "direct", href: `${previewUrl}${path}` };
}

/**
 * A data-source picker's picture served by the preview: the preview's own
 * address on this computer; on a hosted install, the path to load through a
 * fresh entry (each entry address works once).
 */
export function thumbPreviewTarget(meta: MetaInfo | null | undefined, previewUrl: string | null, image: string | undefined): PreviewTarget | null {
  if (!previewUrl || !image || !image.startsWith("/") || image.startsWith("//")) return null;
  return needsEntry(meta) ? { kind: "entry", path: image } : { kind: "direct", href: `${previewUrl.replace(/\/+$/, "")}${image}` };
}

/**
 * The Brand screen measures pages in a hidden frame at the preview's origin.
 * On a hosted install that frame must first be let in, so measuring starts
 * from the entry's own origin and loads `enter` once before the pages.
 */
export function measureTarget(meta: MetaInfo | null | undefined, previewUrl: string, entry: string | null): { origin: string; enter: string | null } | null {
  if (!needsEntry(meta)) return { origin: previewUrl, enter: null };
  if (!entry) return null;
  return { origin: new URL(entry).origin, enter: entryAddress(entry, "/") };
}

/** A fresh entered address on the preview for `path`, or null when the server has none. */
export async function enteredPreviewAddress(siteId: string, path: string): Promise<string | null> {
  const entry = await requestEntry(siteId);
  return entry.preview ? entryAddress(entry.preview, path) : null;
}

/** Follow a target: open the address, or (hosted) a new tab sent to a fresh entered address. */
export function openPreviewTarget(siteId: string, target: PreviewTarget): void {
  if (target.kind === "direct") {
    window.open(target.href, "_blank", "noopener");
    return;
  }
  openInNewTab(() => enteredPreviewAddress(siteId, target.path), { title: "Couldn’t open the preview" });
}

/** A fresh entered address on the preview for `path` while it is given; null meanwhile, on failure, and without a path. */
export function useEnteredPreviewAddress(siteId: string, path: string | null): string | null {
  const [entered, setEntered] = useState<{ path: string; address: string | null } | null>(null);
  useEffect(() => {
    if (!path) return;
    let current = true;
    enteredPreviewAddress(siteId, path).then(
      (address) => current && setEntered({ path, address }),
      // A picture that can't be shown keeps its placeholder; signing in again is the app's own business.
      () => current && setEntered({ path, address: null }),
    );
    return () => {
      current = false;
    };
  }, [siteId, path]);
  return entered && entered.path === path ? entered.address : null;
}

/**
 * Let this browser into the preview by loading an entry address in a hidden
 * frame, for a frame that loads the preview's own addresses next (the Brand
 * screen's measuring). Resolves when it has loaded, or after `timeoutMs`.
 */
export function enterInFrame(address: string, signal?: AbortSignal, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.title = "Opening the preview";
    Object.assign(frame.style, { position: "fixed", left: "-10000px", top: "0", width: "10px", height: "10px", border: "0", visibility: "hidden" });
    const finish = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      frame.remove();
      resolve();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    signal?.addEventListener("abort", finish);
    frame.addEventListener("load", finish);
    frame.src = address;
    document.body.appendChild(frame);
  });
}

/** A link on the preview: a plain new-tab link on this computer, a button that enters first on a hosted install. */
export function PreviewTabLink({ siteId, target, className, entryClassName, children }: { siteId: string; target: PreviewTarget; className: string; entryClassName?: string; children: ReactNode }) {
  if (target.kind === "direct") {
    return (
      <a className={className} href={target.href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={entryClassName ?? className} onClick={() => openPreviewTarget(siteId, target)}>
      {children}
    </button>
  );
}
