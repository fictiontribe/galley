/**
 * Themes in the running app: the list every control shows, choosing one,
 * and keeping the page, the server and the other windows in step. The
 * decisions are lib/themes/choice.ts; this is where they meet the stores,
 * the server and the document. (Light and dark — the appearance — are
 * app/theme.ts.)
 */
import { useEffect, useLayoutEffect, useMemo } from "react";
import type { ThemesInfo } from "@galley/core/api";
import { isAppliedTheme, type AppliedTheme, type ThemeFile } from "@galley/core/themes";
import { api, errorShape } from "@/lib/api";
import { invalidate, setQueryData, useQuery } from "@/lib/query";
import { useMeta } from "@/lib/stores/meta";
import { useMyThemes, useThemeEdit } from "@/lib/stores/themes";
import { notify } from "@/lib/stores/toasts";
import { useUi } from "@/lib/stores/ui";
import { keys } from "@/lib/sync";
import { shownTheme, themeKeeper } from "@/lib/theme";
import { listThemes, type ListedTheme } from "@/lib/themes/catalog";
import { chosenLookId, lookFromServer, lookSavesToServer, shownLook } from "@/lib/themes/choice";
import { putLookOnPage, rememberLook } from "@/lib/themes/apply";
import { useSystemDark } from "./theme";

/** What the server sent as the default, only if it is an applied theme and nothing more (checked again here before anything reaches the page). */
function serverLook(value: unknown): AppliedTheme | null {
  return isAppliedTheme(value) ? value : null;
}

const EMPTY: ThemesInfo = { saved: [], plugins: [], defaultId: "quiet" };

/** The themes saved here and the plugins' (signed in only: the sign-in screen has the default from /api/meta). */
export function useServerThemes(): { data: ThemesInfo; loading: boolean; refetch: () => Promise<ThemesInfo | undefined> } {
  const authenticated = useMeta((s) => Boolean(s.meta?.authenticated));
  const query = useQuery(keys.themes(), () => api("GET /api/themes"), { enabled: authenticated });
  return { data: query.data ?? EMPTY, loading: query.loading, refetch: query.refetch };
}

/**
 * Every theme this app can show, checked, in the picker's order. Before
 * signing in the saved themes aren't listed (they are the install's), but
 * the default is: from /api/meta, colours and switches only, so it is named
 * for what it is.
 */
export function useThemeList(): ListedTheme[] {
  const accent = useMeta((s) => s.meta?.brand.accent ?? null);
  const server = useServerThemes().data;
  const mine = useMyThemes((s) => s.mine);
  const hosted = useMeta((s) => themeKeeper(s.meta) === "browser");
  const fallback = useMeta((s) => serverLook(s.meta?.look));
  return useMemo(() => {
    const listed = listThemes({ brandAccent: accent, saved: server.saved, plugins: server.plugins, mine: hosted ? mine : [] });
    if (!fallback || listed.some((entry) => entry.theme.id === fallback.id)) return listed;
    const theme: ThemeFile = { contract: 1, id: fallback.id, name: "The default", light: fallback.light, dark: fallback.dark, switches: fallback.switches };
    return [...listed.filter((entry) => entry.origin !== "community"), { theme, origin: "saved" as const }, ...listed.filter((entry) => entry.origin === "community")];
  }, [accent, server, mine, hosted, fallback]);
}

/** The theme on screen now (an edit in progress included). */
export function useShownLook(): AppliedTheme | null {
  const keeper = useMeta((s) => themeKeeper(s.meta));
  const fallback = useMeta((s) => serverLook(s.meta?.look));
  const preview = useThemeEdit((s) => s.preview);
  const look = useUi((s) => s.look);
  const chosen = useUi((s) => s.lookChosen);
  const themes = useThemeList();
  return useMemo(() => shownLook({ keeper, preview, local: { look, chosen }, fallback, themes }), [keeper, preview, look, chosen, fallback, themes]);
}

/** The id of the theme the person has (not an edit in progress): what the picker marks as current. */
export function useCurrentLookId(): string {
  const keeper = useMeta((s) => themeKeeper(s.meta));
  const fallback = useMeta((s) => serverLook(s.meta?.look)?.id ?? "quiet");
  const look = useUi((s) => s.look);
  const chosen = useUi((s) => s.lookChosen);
  const themes = useThemeList();
  const id = keeper === "browser" ? (chosen ? look : null) : look;
  return id && themes.some((entry) => entry.theme.id === id) ? id : fallback;
}

/**
 * Puts the theme on <html> whenever it, or light and dark, changes, and
 * keeps this browser's copy for the next start. Where the server keeps the
 * theme, its default (from /api/meta) is followed as it changes.
 */
export function useLookOnPage(): void {
  const look = useShownLook();
  const appearance = useUi((s) => s.theme);
  const systemDark = useSystemDark();
  const editing = useThemeEdit((s) => s.preview !== null);
  const metaLoaded = useMeta((s) => s.meta !== null);
  const authenticated = useMeta((s) => Boolean(s.meta?.authenticated));
  const keeper = useMeta((s) => themeKeeper(s.meta));
  const serverId = useMeta((s) => serverLook(s.meta?.look)?.id ?? null);
  const localLook = useUi((s) => s.look);
  const chosen = useUi((s) => s.lookChosen);
  const shown = shownTheme(appearance, systemDark);
  const serverThemes = useServerThemes();
  const themes = useThemeList();
  const targetId = editing ? null : chosenLookId(keeper, { look: localLook, chosen });
  const waitingForServerThemes =
    authenticated &&
    serverThemes.loading &&
    targetId !== null &&
    targetId !== serverId &&
    !themes.some((entry) => entry.theme.id === targetId);

  useLayoutEffect(() => {
    if (!metaLoaded || waitingForServerThemes) return;
    putLookOnPage(look, shown);
    if (!editing) rememberLook(look, keeper === "browser" && chosen);
  }, [metaLoaded, waitingForServerThemes, look, shown, editing, keeper, chosen]);

  // Printing is on paper whatever the appearance (app/theme.ts usePrintOnPaper): the light colours, with light's tuned inks.
  useEffect(() => {
    if (!metaLoaded || waitingForServerThemes) return;
    const before = () => putLookOnPage(look, "light");
    const after = () => putLookOnPage(look, shown);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, [metaLoaded, waitingForServerThemes, look, shown]);

  // A hosted account's own themes: another person signing in on this browser starts from the default, with none of them.
  const account = useMeta((s) => s.meta?.account?.id ?? null);
  useEffect(() => {
    if (!account) return;
    const before = useMyThemes.getState().account;
    if (before !== null && before !== account) useUi.getState().setLook(null);
    useMyThemes.getState().adopt(account);
  }, [account]);

  useEffect(() => {
    if (!metaLoaded) return;
    const ui = useUi.getState();
    const next = lookFromServer(keeper, serverId, { look: ui.look, chosen: ui.lookChosen });
    if (next !== undefined) ui.followLook(next);
  }, [metaLoaded, keeper, serverId]);
}

let latest = 0;

/**
 * The person chose a theme. It shows at once. Where the server keeps the
 * theme (local mode, the desktop app), it becomes the app's theme there, so
 * every window agrees: a theme the server doesn't have yet (a community
 * theme) is saved there first. On a hosted install it stays in this browser
 * and nothing is sent: anyone may choose their own, Contributors included.
 */
export function chooseLook(id: string, theme?: ThemeFile): void {
  const ui = useUi.getState();
  const before = { look: ui.look, chosen: ui.lookChosen };
  const meta = useMeta.getState().meta;
  const keeper = themeKeeper(meta);
  ui.setLook(id);
  if (!lookSavesToServer(keeper, Boolean(meta?.authenticated))) return;
  const ticket = ++latest;
  void (async () => {
    try {
      if (theme) await api("PUT /api/themes/:themeId", { params: { themeId: theme.id }, body: { theme } });
      const settings = await api("PATCH /api/settings", { body: { appearance: { look: id } } });
      setQueryData(keys.settings(), settings);
      await useMeta.getState().load();
    } catch (caught) {
      if (ticket === latest && useUi.getState().look === id) useUi.setState(before);
      notify({ tone: "danger", title: "Couldn’t use that theme", body: errorShape(caught).message });
    }
  })();
}

/** A theme was saved, deleted or made the default somewhere: read the lists and the default again. */
export function refreshThemes(): void {
  invalidate(keys.themes());
  invalidate(keys.settings());
  void useMeta.getState().load();
}
