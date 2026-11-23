import { describe, expect, it } from "vitest";
import type { SiteFacts, SiteGroup, SiteSummary } from "@galley/core/types";
import {
  MAX_PLACES,
  NO_FILTER,
  attentionChips,
  attentionScore,
  filterSites,
  frameworksOf,
  groupSites,
  isFiltered,
  matchScore,
  needsAttention,
  placeFor,
  rankSites,
  rememberPlace,
  rememberUi,
  shortcutDigit,
  shortcutSites,
  sortSites,
  switcherSections,
  twinLines,
} from "../../src/features/sites/logic";

const facts = (patch: Partial<SiteFacts> = {}): SiteFacts => ({ checkedAt: 1, pendingChanges: 0, unsent: 0, notLive: null, unread: 0, ...patch });

function site(id: string, patch: Partial<SiteSummary> = {}): SiteSummary {
  return { id, name: `Site ${id}`, root: `/work/${id}`, framework: { id: "astro", name: "Astro" }, lastOpenedAt: 0, pendingChanges: 0, facts: facts(), ...patch };
}

const groups: SiteGroup[] = [
  { id: "g1", name: "Harbour clients", color: "sky", collapsed: false },
  { id: "g2", name: "Retainers", color: "green", collapsed: true },
];

describe("what needs attention", () => {
  it("lists chips most urgent first, with plain words and correct plurals", () => {
    const busy = site("a", { pendingChanges: 1, facts: facts({ unsent: 2, notLive: 1, unread: 4, pendingChanges: 1 }), previewState: "ready" });

    expect(attentionChips(busy).map((chip) => chip.label)).toEqual(["2 versions not sent", "1 version not live", "4 unread", "1 change", "Preview running"]);
    expect(attentionChips(busy).find((chip) => chip.kind === "preview")?.attention).toBe(false);
    expect(attentionChips(site("b", { missing: true, pendingChanges: 3 })).map((chip) => chip.label)).toEqual(["Folder missing"]);
    expect(attentionChips(site("c"))).toEqual([]);
    expect(needsAttention(site("d", { previewState: "ready" }))).toBe(false);
    expect(needsAttention(site("e", { pendingChanges: 2 }))).toBe(true);
    expect(attentionScore(site("f", { missing: true }))).toBeGreaterThan(attentionScore(busy));
  });

  it("sorts pinned first, then by what's waiting, then by recent use, then by name", () => {
    const sorted = sortSites([
      site("quiet-old", { lastOpenedAt: 1 }),
      site("quiet-new", { lastOpenedAt: 9 }),
      site("changes", { pendingChanges: 1, lastOpenedAt: 2 }),
      site("unsent", { facts: facts({ unsent: 1 }), lastOpenedAt: 3 }),
      site("pinned-quiet", { pinned: true }),
      site("missing", { missing: true }),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(["pinned-quiet", "missing", "unsent", "changes", "quiet-new", "quiet-old"]);
  });
});

describe("search, filters and groups", () => {
  const sites = [
    site("a", { name: "North bakery", group: "g1", note: "Dana is the contact", facts: facts({ liveUrl: "https://www.northbakery.example" }) }),
    site("b", { name: "Clinic", group: "g2", pendingChanges: 2, framework: { id: "eleventy", name: "Eleventy" } }),
    site("c", { name: "Studio", group: "gone" }),
    site("d", { name: "Museum" }),
  ];

  it("searches name, note, group, live address and folder, every word", () => {
    expect(filterSites(sites, { ...NO_FILTER, query: "dana" }, groups).map((entry) => entry.id)).toEqual(["a"]);
    expect(filterSites(sites, { ...NO_FILTER, query: "harbour bakery" }, groups).map((entry) => entry.id)).toEqual(["a"]);
    expect(filterSites(sites, { ...NO_FILTER, query: "northbakery.example" }, groups).map((entry) => entry.id)).toEqual(["a"]);
    expect(filterSites(sites, { ...NO_FILTER, query: "/work/d" }, groups).map((entry) => entry.id)).toEqual(["d"]);
    expect(filterSites(sites, { ...NO_FILTER, query: "nothing like it" }, groups)).toEqual([]);
  });

  it("filters by group (a group that no longer exists counts as none), attention and framework", () => {
    expect(filterSites(sites, { ...NO_FILTER, group: "g2" }, groups).map((entry) => entry.id)).toEqual(["b"]);
    expect(filterSites(sites, { ...NO_FILTER, group: "none" }, groups).map((entry) => entry.id)).toEqual(["c", "d"]);
    expect(filterSites(sites, { ...NO_FILTER, attention: true }, groups).map((entry) => entry.id)).toEqual(["b"]);
    expect(filterSites(sites, { ...NO_FILTER, framework: "eleventy" }, groups).map((entry) => entry.id)).toEqual(["b"]);
    expect(isFiltered(NO_FILTER)).toBe(false);
    expect(isFiltered({ ...NO_FILTER, query: "  " })).toBe(false);
    expect(isFiltered({ ...NO_FILTER, attention: true })).toBe(true);
    expect(frameworksOf(sites)).toEqual([
      { id: "astro", name: "Astro", count: 3 },
      { id: "eleventy", name: "Eleventy", count: 1 },
    ]);
  });

  it("groups in the person's order, keeps empty groups to drop onto, and puts the rest last", () => {
    const sections = groupSites(sites, [...groups, { id: "g3", name: "Empty", color: "ink", collapsed: false }]);

    expect(sections.map((section) => [section.group?.name ?? null, section.sites.map((entry) => entry.id), section.attention])).toEqual([
      ["Harbour clients", ["a"], 0],
      ["Retainers", ["b"], 1],
      ["Empty", [], 0],
      [null, ["d", "c"], 0],
    ]);
    expect(groupSites([], [])).toEqual([{ group: null, sites: [], attention: 0 }]);
  });
});

describe("the switcher", () => {
  const sites = [
    site("nb", { name: "North bakery", lastOpenedAt: 5 }),
    site("nm", { name: "Northfield museum", lastOpenedAt: 9, pinned: true }),
    site("hc", { name: "Harbour clinic", lastOpenedAt: 7, group: "g1" }),
    site("st", { name: "Studio", lastOpenedAt: 0, note: "launch north wing" }),
    site("gone", { name: "North gone", missing: true, lastOpenedAt: 99 }),
  ];

  it("ranks exact and prefix matches above word, initials, group and note matches", () => {
    expect(matchScore(sites[0]!, "north bakery")).toBe(100);
    expect(matchScore(sites[0]!, "nor")).toBe(80);
    expect(matchScore(sites[0]!, "bak")).toBe(60);
    expect(matchScore(sites[0]!, "akery")).toBe(40);
    expect(matchScore(sites[0]!, "nb")).toBe(35);
    expect(matchScore(sites[2]!, "harb", "Harbour clients")).toBe(80);
    expect(matchScore(sites[3]!, "wing")).toBe(10);
    expect(matchScore(sites[0]!, "zzz")).toBe(0);
    // Same score: pinned first, then the most recently used. A missing folder never matches.
    expect(rankSites(sites, "north").map((entry) => entry.id)).toEqual(["nm", "nb", "st"]);
    expect(rankSites(sites, "clients", groups).map((entry) => entry.id)).toEqual(["hc"]);
  });

  it("shows pinned, then recent (never-opened sites aren't recent), then the rest by group", () => {
    const sections = switcherSections(sites, groups, 1);

    expect(sections.map((section) => [section.label, section.sites.map((entry) => entry.id)])).toEqual([
      ["Pinned", ["nm"]],
      ["Recent", ["hc"]],
      ["Not in a group", ["nb", "st"]],
    ]);
  });

  it("gives ⌘1…⌘9 to the pinned sites, then the most recently used, never a missing one", () => {
    const many = Array.from({ length: 12 }, (_, index) => site(`s${index}`, { lastOpenedAt: index + 1 }));

    expect(shortcutSites([...many, site("pin", { pinned: true }), site("gone", { missing: true, pinned: true })]).map((entry) => entry.id)).toEqual(["pin", "s11", "s10", "s9", "s8", "s7", "s6", "s5", "s4"]);
    expect(shortcutDigit({ key: "3", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }, true)).toBe(3);
    expect(shortcutDigit({ key: "3", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }, true)).toBeNull();
    expect(shortcutDigit({ key: "3", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }, false)).toBe(3);
    expect(shortcutDigit({ key: "0", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }, true)).toBeNull();
    expect(shortcutDigit({ key: "2", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true }, true)).toBeNull();
  });
});

describe("each site's place", () => {
  it("returns you where you left a site, and never to another site's page", () => {
    let memory = rememberPlace({}, "abc", "/sites/abc/edit?path=src%2Fcontent%2Fpages%2Fabout.md", 10);

    memory = rememberPlace(memory, "xyz", "/sites/xyz/proof", 11);
    expect(placeFor(memory, "abc")).toBe("/sites/abc/edit?path=src%2Fcontent%2Fpages%2Fabout.md");
    expect(placeFor(memory, "xyz")).toBe("/sites/xyz/proof");
    expect(placeFor(memory, "new")).toBe("/sites/new");
    // A path from another site, or from outside every site, is ignored.
    expect(rememberPlace(memory, "abc", "/sites/xyz/media")).toBe(memory);
    expect(rememberPlace(memory, "abc", "/settings")).toBe(memory);
    expect(placeFor({ abc: { path: "/sites/abcdef/edit", at: 1 } }, "abc")).toBe("/sites/abc");
  });

  it("keeps pane sizes and preview mode per site, and forgets the oldest places past the limit", () => {
    const ui = { paneSizes: { "editor.form": 420 }, collapsed: { "editor.chat": true }, previewMode: "split" as const };
    let memory = rememberUi(rememberPlace({}, "abc", "/sites/abc/media", 5), "abc", ui);

    expect(memory.abc).toEqual({ path: "/sites/abc/media", at: 5, ui });
    for (let index = 0; index < MAX_PLACES + 5; index += 1) memory = rememberPlace(memory, `s${index}`, `/sites/s${index}`, 100 + index);
    expect(Object.keys(memory)).toHaveLength(MAX_PLACES);
    expect(memory.abc).toBeUndefined();
    expect(memory[`s${MAX_PLACES + 4}`]).toBeDefined();
  });
});

describe("sites that share a name", () => {
  it("gives each the folder it lives in, and its group, and says nothing for a name of its own", () => {
    const lines = twinLines(
      [site("a", { name: "Marketing site", root: "/work/harbour-bakery", group: "g1" }), site("b", { name: "marketing  SITE ", root: "/work/lowfield" }), site("c", { name: "Shop", root: "/work/shop" })],
      groups,
    );

    expect(lines).toEqual(new Map([["a", "harbour-bakery · Harbour clients"], ["b", "lowfield"]]));
  });

  it("adds the folder above when the folders share a name too", () => {
    const lines = twinLines([site("a", { name: "Site", root: "/clients/acme/site/" }), site("b", { name: "Site", root: "C:\\clients\\bloom\\site" })]);

    expect(lines.get("a")).toBe("acme/site");
    expect(lines.get("b")).toBe("bloom/site");
  });
});
