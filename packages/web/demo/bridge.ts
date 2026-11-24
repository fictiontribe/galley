/**
 * What the preview frames read the working copy through. The frames are the
 * sample site's built pages, on this page's own origin, so the script in them
 * (demo/frame) can reach `parent.__galleyDemo`: for the page it shows, the
 * entry as last published and as it is now, and the changes in every other
 * file (a renamed menu item shows in every page's header). It is told when
 * anything changes, and redraws.
 */
import type { FieldChange, JsonValue, ServerEvent } from "@galley/core/types";
import type { MockServer } from "../mock/server.ts";
import YAML from "yaml";

export type Data = { [key: string]: JsonValue };

export interface PageState {
  /** The entry behind the page, published and now (null: the file doesn't exist in that version). */
  entry: { path: string; base: Data | null; current: Data | null } | null;
  /** Field changes in every other changed file. */
  others: Array<{ path: string; changes: FieldChange[] }>;
}

export interface DemoBridge {
  state(urlPath: string): PageState;
  /** Called after every change to the working copy. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** A form on the sample site was sent: it goes to the inbox, as Galley's preview sends it. The new submission's id, or null when the inbox doesn't take this form. */
  submit(form: string, values: Record<string, string>, page: { url: string; title: string }): string | null;
}

declare global {
  interface Window {
    __galleyDemo?: DemoBridge;
  }
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

/** An entry file's data: front matter for markdown, the whole file for JSON. */
export function parseData(path: string, text: string | null | undefined): Data | null {
  if (text === null || text === undefined) return null;
  try {
    if (path.endsWith(".json")) return JSON.parse(text) as Data;
    const match = FRONT_MATTER.exec(text);
    return match ? ((YAML.parse(match[1] ?? "") ?? {}) as Data) : {};
  } catch {
    return null;
  }
}

/** A deep copy in this window's own objects, so nothing the frame holds ties it to the app's state. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function installBridge(win: Window, server: MockServer): DemoBridge {
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const notify = () => {
    if (timer) return;
    // Several events arrive together (an edit, then the site's refresh): redraw once.
    timer = setTimeout(() => {
      timer = null;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          // The frame that registered it has gone (navigated or closed).
          listeners.delete(listener);
        }
      }
    }, 30);
  };
  server.onEvent((event: ServerEvent) => {
    if (event.type === "changes.updated" || event.type === "site.updated") notify();
  });

  const site = () => [...server.backend.sites.values()][0];

  const bridge: DemoBridge = {
    state(urlPath) {
      const current = site();
      if (!current) return { entry: null, others: [] };
      const summary = current.entryForUrl(urlPath);
      const entry = summary ? { path: summary.path, base: parseData(summary.path, current.read(summary.path, "base")?.toString("utf8")), current: parseData(summary.path, current.read(summary.path)?.toString("utf8")) } : null;
      const others = current
        .changes()
        .files.filter((file) => file.path !== summary?.path && file.fieldChanges?.length)
        .map((file) => ({ path: file.path, changes: file.fieldChanges ?? [] }));
      return plain({ entry, others });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    submit(form, values, page) {
      const current = site();
      // The mock's inbox keeps one form, the contact form; it takes a new submission the way it takes a restored one.
      if (!current || form !== "contact") return null;
      const id = `01KZ${Date.now().toString(36).toUpperCase().padStart(10, "0")}`;
      const submission = { id, siteId: current.id, form, at: new Date().toISOString(), values, page, read: false };
      void server.handle({ method: "POST", url: `/api/sites/${encodeURIComponent(current.id)}/inbox/contact/restore`, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ submissions: [submission] })) });
      return id;
    },
  };
  (win as Window).__galleyDemo = bridge;
  return bridge;
}
