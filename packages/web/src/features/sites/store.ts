import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SiteGroup, SiteSummary } from "@galley/core/types";
import { api } from "@/lib/api";
import { useSites } from "@/lib/stores/sites";
import { useUi } from "@/lib/stores/ui";
import { rememberPlace, rememberUi, twinLines, type PlaceMemory } from "./logic";

export type SitesView = "cards" | "list";

interface SitesViewStore {
  view: SitesView;
  /** Where each site was left: screen, open entry, pane sizes, preview mode. */
  places: PlaceMemory;
  /** The site the app was last inside, so its look can be put away when another one opens. */
  current: string | null;
  setView: (view: SitesView) => void;
  /** Records the screen inside a site. */
  remember: (siteId: string, path: string) => void;
  /**
   * Entering `siteId`: the previous site's pane sizes and preview mode are put
   * away with its place, and this site's (if it has any) are put back.
   */
  enter: (siteId: string) => void;
  /** Leaving every site (the Sites screen): put the current one's look away. */
  leave: () => void;
}

function snapshot() {
  const { paneSizes, collapsed, previewMode } = useUi.getState();
  return { paneSizes, collapsed, previewMode };
}

/** The Sites screen's view and each site's place, kept in this browser. */
export const useSitesView = create<SitesViewStore>()(
  persist(
    (set, get) => ({
      view: "cards",
      places: {},
      current: null,
      setView: (view) => set({ view }),
      remember: (siteId, path) => set({ places: rememberPlace(get().places, siteId, path) }),
      enter(siteId) {
        const { current } = get();
        if (current === siteId) return;
        let places = get().places;
        if (current) places = rememberUi(places, current, snapshot());
        const saved = places[siteId]?.ui;
        if (saved) useUi.setState({ paneSizes: saved.paneSizes, collapsed: saved.collapsed, previewMode: saved.previewMode });
        set({ places, current: siteId });
      },
      leave() {
        const { current } = get();
        if (!current) return;
        set({ places: rememberUi(get().places, current, snapshot()), current: null });
      },
    }),
    { name: "galley.sites", version: 1 },
  ),
);

interface GroupsStore {
  groups: SiteGroup[] | null;
  error: unknown;
  load: () => Promise<void>;
  /** Replace one group after a change the server answered with. */
  put: (group: SiteGroup) => void;
}

/** The person's groups (clients), in their order. Reloaded with the list on `sites.updated`. */
export const useGroups = create<GroupsStore>((set, get) => ({
  groups: null,
  error: undefined,
  async load() {
    try {
      set({ groups: await api("GET /api/groups"), error: undefined });
    } catch (error) {
      set({ error, groups: get().groups ?? [] });
    }
  },
  put(group) {
    const groups = get().groups ?? [];
    set({ groups: groups.some((g) => g.id === group.id) ? groups.map((g) => (g.id === group.id ? group : g)) : [...groups, group] });
  },
}));

const twinCache = new WeakMap<SiteSummary[], { groups: SiteGroup[] | null; lines: Map<string, string> }>();

/** The line that tells this site apart from others with the same name (folder · group), or null when its name is its own. */
export function useTwinLine(siteId: string): string | null {
  const sites = useSites((s) => s.sites);
  const groups = useGroups((s) => s.groups);
  if (!sites) return null;
  // One pass over the list per change of it, shared by every row and card that asks.
  let cached = twinCache.get(sites);
  if (!cached || cached.groups !== groups) {
    cached = { groups, lines: twinLines(sites, groups ?? []) };
    twinCache.set(sites, cached);
  }
  return cached.lines.get(siteId) ?? null;
}
