import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { ChatContext, Collection, Entry } from "@galley/core/types";
import type { FormStore } from "@/features/content/form/store";
import { api } from "@/lib/api";
import { collectionForPath } from "@/lib/collections";
import { useQuery, type QueryStatus } from "@/lib/query";
import { useSite } from "@/lib/stores/site";
import { useUi, type PreviewMode } from "@/lib/stores/ui";
import { keys } from "@/lib/sync";

/** Text picked on the page (or in the form) that the assistant should know about. */
export interface EditorSelection {
  text: string;
  sourcePath?: string;
}

/** What the three editor panes share. Read it with `useEditor()`. */
export interface EditorContextValue {
  siteId: string;
  /** Repo path of the entry being edited (`?path=`), or null when the page has none. */
  path: string | null;
  /** Switch the entry (updates `?path=`). The preview follows the entry's page. */
  setPath: (path: string | null) => void;
  /** The entry, from GET …/entry. Null while loading or without a path. */
  entry: Entry | null;
  entryStatus: QueryStatus;
  entryError: unknown;
  /** First load in progress — show skeletons. */
  entryLoading: boolean;
  /** Refetch the entry (after an edit that didn't come with the new entry). */
  refresh: () => Promise<Entry | undefined>;
  /** The collection the entry belongs to. */
  collection: Collection | null;
  /** URL path shown in the preview, e.g. "/about/". */
  urlPath: string;
  /** The preview's address when no entry's content lives there (opened by address, or navigated to). */
  unmatchedUrl: string | null;
  /**
   * The preview navigated (or should navigate) to `urlPath`. The entry
   * behind that page becomes the current entry when there is one.
   */
  navigate: (urlPath: string) => void;
  selection: EditorSelection | null;
  setSelection: (selection: EditorSelection | null) => void;
  previewMode: PreviewMode;
  setPreviewMode: (mode: PreviewMode) => void;
  /** Ready-made context for the assistant: entry, page and selection. */
  chatContext: ChatContext;
  /**
   * The current entry's edit queue (the form's store), once the form has
   * opened it. The page builder edits through it, so the form, the page and
   * the assistant never race. Null while the entry loads.
   */
  formStore: FormStore | null;
  /** The form registers its store for `path` (and null when it closes). */
  registerFormStore: (path: string, store: FormStore | null) => void;
}

/** "/about" or "about/" → "/about"; absent or unsafe → "/". Only paths on the site itself. */
export function normalizeUrl(value: string | null): string {
  if (!value) return "/";
  const trimmed = value.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//")) {
    try {
      const url = new URL(trimmed);
      return url.pathname + url.search;
    } catch {
      return "/";
    }
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

const EditorCtx = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const value = useContext(EditorCtx);
  if (!value) throw new Error("useEditor() must be used inside <EditorProvider>");
  return value;
}

export function EditorProvider({ siteId, children }: { siteId: string; children: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const path = params.get("path");
  const model = useSite((s) => s.detail?.model);
  const previewMode = useUi((s) => s.previewMode);
  const setPreviewMode = useUi((s) => s.setPreviewMode);
  // ?url=/some/page/ opens the editor by address (the dev-toolbar link and /open use it).
  const [urlPath, setUrlPath] = useState<string>(() => normalizeUrl(params.get("url")));
  const [unmatchedUrl, setUnmatchedUrl] = useState<string | null>(null);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [registered, setRegistered] = useState<{ path: string; store: FormStore } | null>(null);
  const registerFormStore = useCallback((at: string, store: FormStore | null) => {
    setRegistered((current) => (store ? { path: at, store } : current?.path === at ? null : current));
  }, []);
  const formStore = registered && registered.path === path ? registered.store : null;

  const query = useQuery(keys.entry(siteId, path ?? ""), () => api("GET /api/sites/:siteId/entry", { params: { siteId }, query: { path: path ?? "" } }), {
    enabled: Boolean(path),
  });
  const entry = path ? (query.data ?? null) : null;

  const setPath = useCallback(
    (next: string | null) => {
      setParams(
        (current) => {
          const updated = new URLSearchParams(current);
          if (next) updated.set("path", next);
          else updated.delete("path");
          updated.delete("url");
          return updated;
        },
        { replace: true },
      );
      setSelection(null);
    },
    [setParams],
  );

  // With neither an entry nor a page in the URL, open the home page's entry.
  const resolvedStart = useRef(false);
  useEffect(() => {
    if (resolvedStart.current || path) return;
    resolvedStart.current = true;
    api("GET /api/sites/:siteId/route", { params: { siteId }, query: { url: urlPath } })
      .then(({ entry: found }) => {
        if (found) setPath(found.path);
        else setUnmatchedUrl(urlPath);
      })
      .catch(() => undefined);
  }, [path, siteId, urlPath, setPath]);
  useEffect(() => {
    if (path) setUnmatchedUrl(null);
  }, [path]);

  // When the entry changes, the preview follows to its page.
  const entryUrl = entry?.url ?? null;
  useEffect(() => {
    if (entryUrl) setUrlPath(entryUrl);
  }, [entry?.path, entryUrl]);

  const navigate = useCallback(
    (next: string) => {
      setUrlPath(next);
      api("GET /api/sites/:siteId/route", { params: { siteId }, query: { url: next } })
        .then(({ entry: found }) => {
          if (found?.path !== path) setPath(found?.path ?? null);
          setUnmatchedUrl(found ? null : next);
        })
        .catch(() => undefined);
    },
    [siteId, path, setPath],
  );

  const value = useMemo<EditorContextValue>(
    () => ({
      siteId,
      path,
      setPath,
      entry,
      entryStatus: query.status,
      entryError: query.error,
      entryLoading: Boolean(path) && query.loading,
      refresh: query.refetch,
      collection: path ? collectionForPath(model, path) : null,
      urlPath,
      unmatchedUrl,
      navigate,
      selection,
      setSelection,
      previewMode,
      setPreviewMode,
      chatContext: {
        entryPath: path ?? undefined,
        urlPath,
        selection: selection ?? undefined,
      },
      formStore,
      registerFormStore,
    }),
    [siteId, path, setPath, entry, query.status, query.error, query.loading, query.refetch, model, urlPath, unmatchedUrl, navigate, selection, previewMode, setPreviewMode, formStore, registerFormStore],
  );

  return <EditorCtx.Provider value={value}>{children}</EditorCtx.Provider>;
}
