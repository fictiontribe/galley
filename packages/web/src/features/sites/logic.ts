/**
 * The Sites screen's and the switcher's pure logic: what needs attention, the
 * order sites are shown in, search and filters, grouping, switcher ranking,
 * the ⌘1…⌘9 sites, and each site's remembered place. No React, no fetching —
 * everything here is unit-tested.
 */
import type { SiteGroup, SiteSummary } from "@galley/core/types";
import { plural } from "@/lib/format";

// ── sites that share a name ──────────────────────────────────────────────

const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const segmentsOf = (root: string) => root.split(/[\\/]+/).filter(Boolean);

/**
 * The second line that tells apart sites whose names are the same (case and
 * spacing aside): the folder each lives in, and its group when it has one —
 * "marketing-site · Harbour Bakery". Sites with a name of their own get
 * nothing, so the list stays quiet. When the folders share a name too, the
 * folder above is added ("acme/site", "bloom/site").
 */
export function twinLines(sites: readonly SiteSummary[], groups: readonly SiteGroup[] = []): Map<string, string> {
  const byName = new Map<string, SiteSummary[]>();
  for (const site of sites) {
    const key = nameKey(site.name);
    byName.set(key, [...(byName.get(key) ?? []), site]);
  }
  const out = new Map<string, string>();
  for (const twins of byName.values()) {
    if (twins.length < 2) continue;
    // As few folder levels as tell them apart (two at most), so the line stays short.
    const depth = new Set(twins.map((site) => segmentsOf(site.root).at(-1) ?? site.root)).size === twins.length ? 1 : 2;
    for (const site of twins) {
      const folder = segmentsOf(site.root).slice(-depth).join("/") || site.root;
      const group = groups.find((candidate) => candidate.id === site.group)?.name;
      out.set(site.id, group ? `${folder} · ${group}` : folder);
    }
  }
  return out;
}

// ── attention ────────────────────────────────────────────────────────────

export type ChipKind = "missing" | "unsent" | "notLive" | "unread" | "changes" | "preview";
export type ChipTone = "warning" | "change" | "info" | "accent" | "neutral" | "success";

export interface AttentionChip {
  kind: ChipKind;
  /** Short, for the chip: "3 changes". */
  label: string;
  /** The sentence behind it, for a tooltip and screen readers. */
  title: string;
  tone: ChipTone;
  /** Counts as "needs attention" (a running preview is a fact, not a task). */
  attention: boolean;
}

/** "1 change", "3 changes" — the voice guide's plurals. */
export function counted(value: number, one: string, many = plural(one)): string {
  return `${value.toLocaleString()} ${value === 1 ? one : many}`;
}

/** What the site is waiting on, most urgent first. */
export function attentionChips(site: SiteSummary): AttentionChip[] {
  const chips: AttentionChip[] = [];
  const facts = site.facts;

  if (site.missing) {
    chips.push({ kind: "missing", label: "Folder missing", title: "The site’s folder was moved or renamed. Nothing was deleted.", tone: "warning", attention: true });
    return chips;
  }
  if (facts && facts.unsent > 0) {
    chips.push({ kind: "unsent", label: counted(facts.unsent, "version") + " not sent", title: `${counted(facts.unsent, "version")} published here but not sent to the site’s host yet.`, tone: "warning", attention: true });
  }
  if (facts && facts.notLive !== null && facts.notLive > 0) {
    chips.push({ kind: "notLive", label: `${counted(facts.notLive, "version")} not live`, title: `${counted(facts.notLive, "published version")} not put online yet.`, tone: "info", attention: true });
  }
  if (facts && facts.unread > 0) {
    chips.push({ kind: "unread", label: `${facts.unread.toLocaleString()} unread`, title: `${counted(facts.unread, "form submission")} not read yet.`, tone: "accent", attention: true });
  }
  if (site.pendingChanges > 0) {
    chips.push({ kind: "changes", label: counted(site.pendingChanges, "change"), title: `${counted(site.pendingChanges, "change")} waiting to be published.`, tone: "change", attention: true });
  }
  if (site.previewState === "ready" || site.previewState === "starting" || site.previewState === "installing") {
    chips.push({ kind: "preview", label: site.previewState === "ready" ? "Preview running" : "Preview starting", title: "This site’s preview is running on this computer.", tone: "neutral", attention: false });
  }
  return chips;
}

const WEIGHT: Record<ChipKind, number> = { missing: 2000, unsent: 400, notLive: 300, unread: 200, changes: 100, preview: 0 };

/** Higher is more urgent; 0 means nothing is waiting. */
export function attentionScore(site: SiteSummary): number {
  return attentionChips(site).reduce((score, chip) => score + WEIGHT[chip.kind], 0);
}

export function needsAttention(site: SiteSummary): boolean {
  return attentionScore(site) > 0;
}

/** Pinned first, then what needs attention, then recently used, then by name. */
export function sortSites(sites: SiteSummary[]): SiteSummary[] {
  return [...sites].sort(
    (a, b) =>
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
      attentionScore(b) - attentionScore(a) ||
      b.lastOpenedAt - a.lastOpenedAt ||
      a.name.localeCompare(b.name),
  );
}

// ── search, filters, groups ──────────────────────────────────────────────

export interface SiteFilter {
  query: string;
  /** A group id, "all", or "none" (sites in no group). */
  group: string;
  attention: boolean;
  /** A framework id or "all". */
  framework: string;
}

export const NO_FILTER: SiteFilter = { query: "", group: "all", attention: false, framework: "all" };

function host(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Every word of the query appears somewhere in what a person would search the site by. */
export function matchesQuery(site: SiteSummary, query: string, groups: SiteGroup[] = []): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const group = groups.find((candidate) => candidate.id === site.group)?.name ?? "";
  const haystack = [site.name, site.root, site.note ?? "", group, host(site.facts?.liveUrl), site.framework.name].join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function filterSites(sites: SiteSummary[], filter: SiteFilter, groups: SiteGroup[] = []): SiteSummary[] {
  return sites.filter(
    (site) =>
      matchesQuery(site, filter.query, groups) &&
      (filter.group === "all" || (filter.group === "none" ? !site.group || !groups.some((group) => group.id === site.group) : site.group === filter.group)) &&
      (!filter.attention || needsAttention(site)) &&
      (filter.framework === "all" || site.framework.id === filter.framework),
  );
}

export function isFiltered(filter: SiteFilter): boolean {
  return filter.query.trim() !== "" || filter.group !== "all" || filter.attention || filter.framework !== "all";
}

export function frameworksOf(sites: SiteSummary[]): Array<{ id: string; name: string; count: number }> {
  const seen = new Map<string, { id: string; name: string; count: number }>();
  for (const site of sites) {
    const entry = seen.get(site.framework.id) ?? { id: site.framework.id, name: site.framework.name, count: 0 };
    entry.count += 1;
    seen.set(site.framework.id, entry);
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export interface SiteSection {
  /** null: the sites in no group. */
  group: SiteGroup | null;
  sites: SiteSummary[];
  /** How many of them need attention. */
  attention: number;
}

/** Sites by group in the person's group order, sorted inside each; sites in no group last. Empty groups are kept (they can be dropped onto). */
export function groupSites(sites: SiteSummary[], groups: SiteGroup[]): SiteSection[] {
  const known = new Set(groups.map((group) => group.id));
  const sections: SiteSection[] = groups.map((group) => {
    const inGroup = sortSites(sites.filter((site) => site.group === group.id));
    return { group, sites: inGroup, attention: inGroup.filter(needsAttention).length };
  });
  const loose = sortSites(sites.filter((site) => !site.group || !known.has(site.group)));
  if (loose.length > 0 || groups.length === 0) sections.push({ group: null, sites: loose, attention: loose.filter(needsAttention).length });
  return sections;
}

// ── the switcher ─────────────────────────────────────────────────────────

/** How well one site matches what was typed: 0 is no match. */
export function matchScore(site: SiteSummary, query: string, groupName = ""): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const name = site.name.toLowerCase();
  if (name === q) return 100;
  if (name.startsWith(q)) return 80;
  if (name.split(/[\s\-_.]+/).some((word) => word.startsWith(q))) return 60;
  if (name.includes(q)) return 40;
  // Initials: "nb" for "North bakery".
  const initials = name.split(/[\s\-_.]+/).filter(Boolean).map((word) => word[0]).join("");
  if (q.length >= 2 && initials.startsWith(q)) return 35;
  if (groupName.toLowerCase().includes(q)) return 20;
  if ((site.note ?? "").toLowerCase().includes(q)) return 10;
  if (site.root.toLowerCase().includes(q) || host(site.facts?.liveUrl).toLowerCase().includes(q)) return 5;
  return 0;
}

/** Sites for a typed query, best first; ties go to pinned, then the most recently used. Missing folders never match. */
export function rankSites(sites: SiteSummary[], query: string, groups: SiteGroup[] = []): SiteSummary[] {
  const nameOf = (site: SiteSummary) => groups.find((group) => group.id === site.group)?.name ?? "";
  return sites
    .filter((site) => !site.missing)
    .map((site) => ({ site, score: matchScore(site, query, nameOf(site)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || Number(Boolean(b.site.pinned)) - Number(Boolean(a.site.pinned)) || b.site.lastOpenedAt - a.site.lastOpenedAt || a.site.name.localeCompare(b.site.name))
    .map((entry) => entry.site);
}

export interface SwitcherSection {
  label: string;
  sites: SiteSummary[];
}

/**
 * What the switcher shows before anything is typed: pinned, then recent
 * (never opened ones aren't "recent"), then the rest by group. Each site once.
 */
export function switcherSections(sites: SiteSummary[], groups: SiteGroup[], recentCount = 5): SwitcherSection[] {
  const usable = sites.filter((site) => !site.missing);
  const pinned = usable.filter((site) => site.pinned).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt || a.name.localeCompare(b.name));
  const taken = new Set(pinned.map((site) => site.id));
  const recent = usable
    .filter((site) => !taken.has(site.id) && site.lastOpenedAt > 0)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(0, recentCount);
  for (const site of recent) taken.add(site.id);
  const sections: SwitcherSection[] = [];
  if (pinned.length) sections.push({ label: "Pinned", sites: pinned });
  if (recent.length) sections.push({ label: "Recent", sites: recent });
  for (const section of groupSites(usable.filter((site) => !taken.has(site.id)), groups)) {
    if (section.sites.length) sections.push({ label: section.group?.name ?? (groups.length ? "Not in a group" : "Other sites"), sites: section.sites });
  }
  return sections;
}

/** The sites ⌘1…⌘9 open: pinned (in the switcher's order), then the most recently used. */
export function shortcutSites(sites: SiteSummary[]): SiteSummary[] {
  const usable = sites.filter((site) => !site.missing);
  const pinned = usable.filter((site) => site.pinned).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt || a.name.localeCompare(b.name));
  const rest = usable.filter((site) => !site.pinned && site.lastOpenedAt > 0).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  return [...pinned, ...rest].slice(0, 9);
}

/** The digit of a ⌘/Ctrl shortcut, 1–9, or null (⌘ on a Mac, Ctrl elsewhere; never with Alt or Shift). */
export function shortcutDigit(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, mac: boolean): number | null {
  if (event.altKey || event.shiftKey) return null;
  if (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return null;
  return /^[1-9]$/.test(event.key) ? Number(event.key) : null;
}

// ── each site's place ────────────────────────────────────────────────────

export interface UiSnapshot {
  paneSizes: Record<string, number>;
  collapsed: Record<string, boolean>;
  previewMode: "proposed" | "live" | "split";
}

export interface SitePlace {
  /** Path and query inside the site, e.g. "/sites/abc/edit?path=…". */
  path: string;
  at: number;
  ui?: UiSnapshot;
}

export type PlaceMemory = Record<string, SitePlace>;

/** How many sites' places are kept: the oldest go first. */
export const MAX_PLACES = 60;

export function siteBase(siteId: string): string {
  return `/sites/${encodeURIComponent(siteId)}`;
}

/** Where to take someone switching to `siteId`: where they left it, or its home. Never a path outside that site. */
export function placeFor(memory: PlaceMemory, siteId: string): string {
  const base = siteBase(siteId);
  const path = memory[siteId]?.path;
  if (path && (path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}?`))) return path;
  return base;
}

/** Records the place inside a site. Paths of other sites, and anything outside a site, are ignored. */
export function rememberPlace(memory: PlaceMemory, siteId: string, path: string, now = Date.now()): PlaceMemory {
  const base = siteBase(siteId);
  if (!(path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}?`))) return memory;
  const next: PlaceMemory = { ...memory, [siteId]: { ...memory[siteId], path, at: now } };
  const ids = Object.keys(next);
  if (ids.length <= MAX_PLACES) return next;
  const oldest = ids.sort((a, b) => (next[a]?.at ?? 0) - (next[b]?.at ?? 0)).slice(0, ids.length - MAX_PLACES);
  for (const id of oldest) delete next[id];
  return next;
}

export function rememberUi(memory: PlaceMemory, siteId: string, ui: UiSnapshot, now = Date.now()): PlaceMemory {
  return { ...memory, [siteId]: { path: memory[siteId]?.path ?? siteBase(siteId), at: memory[siteId]?.at ?? now, ui } };
}
