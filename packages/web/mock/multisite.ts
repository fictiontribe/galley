/**
 * Multi-site in the mock: groups, filing, the folder scan and bulk add, a
 * site's own connections and usage — answered from memory like the rest.
 *
 * Sample groups are invented and neutral. The pretend disk has a "Clients"
 * folder of a few sites the scan finds; adding them makes small handbook
 * sites, the same kind POST /api/sites/open makes for an unknown folder.
 */
import type { RouteResponse } from "@galley/core/api";
import type { SecretName, SiteConnections, SiteFacts, SiteGroup, SiteSummary, UsageSummary, UsageTotals } from "@galley/core/types";
import type { Handlers, MockBackend } from "./backend.ts";
import { HOME } from "./fixtures.ts";
import { newSiteFrom } from "./fixtures.ts";
import { MockError } from "./site.ts";

type MultiSiteKey =
  | "GET /api/groups"
  | "POST /api/groups"
  | "PATCH /api/groups/:groupId"
  | "DELETE /api/groups/:groupId"
  | "PUT /api/groups/order"
  | "PATCH /api/sites/:siteId/listing"
  | "POST /api/sites/scan"
  | "POST /api/sites/scan/cancel"
  | "POST /api/sites/add"
  | "GET /api/sites/:siteId/thumbnail"
  | "POST /api/sites/:siteId/presence"
  | "GET /api/sites/:siteId/connections"
  | "PUT /api/sites/:siteId/secrets/:name"
  | "PUT /api/sites/:siteId/author"
  | "GET /api/sites/:siteId/usage"
  | "GET /api/usage/sites";

const COLORS: SiteGroup["color"][] = ["ink", "pencil", "green", "ochre", "rose", "sky", "plum"];
const NAMES: SecretName[] = ["anthropic", "openai", "google", "search_data", "cloudflare", "vercel"];
const CLIENTS = `${HOME}/Clients`;
const SCANNABLE = ["bakery-site", "clinic-site", "studio-site", "museum-site"];

interface Listing {
  group?: string;
  pinned?: boolean;
  note?: string;
}

const empty = (): UsageTotals => ({ turns: 0, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, images: 0, cost: 0 });

export function createMultiSite(mock: MockBackend) {
  const groups: SiteGroup[] = [
    { id: "g-retainers", name: "Retainers", color: "green", collapsed: false },
    { id: "g-launches", name: "Launching this quarter", color: "ochre", collapsed: false },
  ];
  const listing = new Map<string, Listing>();
  const ownKeys = new Map<string, Partial<Record<SecretName, string>>>();
  const ownAuthor = new Map<string, { name: string; email: string }>();
  let seeded = false;

  /** Files the fixture sites under the sample groups the first time anything asks. */
  function seed(): void {
    if (seeded) return;
    seeded = true;
    const [first, second] = [...mock.sites.values()];
    if (first) listing.set(first.id, { group: "g-retainers", pinned: true, note: "Monthly update due on the 1st." });
    if (second) listing.set(second.id, { group: "g-launches" });
  }

  function group(id: string): SiteGroup {
    const found = groups.find((candidate) => candidate.id === id);
    if (!found) throw new MockError("not-found", "That group doesn’t exist any more.");
    return found;
  }

  function facts(summary: SiteSummary): SiteFacts {
    const model = summary.missing ? null : mock.sites.get(summary.id)?.model();
    return {
      checkedAt: Date.now(),
      pendingChanges: summary.pendingChanges,
      unsent: 0,
      ...(model?.urls.production ? { liveUrl: model.urls.production } : {}),
      notLive: null,
      unread: summary.missing ? 0 : 2,
    };
  }

  /** A summary with how it is filed and what the list shows about it. */
  function withListing(summary: SiteSummary): SiteSummary {
    seed();
    const entry = listing.get(summary.id) ?? {};
    const state = mock.previews.get(summary.id)?.status.state;
    return {
      ...summary,
      ...(entry.group ? { group: entry.group } : {}),
      ...(entry.pinned ? { pinned: true } : {}),
      ...(entry.note ? { note: entry.note } : {}),
      facts: facts(summary),
      ...(state && state !== "idle" && state !== "stopped" ? { previewState: state } : {}),
    };
  }

  function connections(siteId: string): SiteConnections {
    const own = ownKeys.get(siteId) ?? {};
    const author = ownAuthor.get(siteId);
    return {
      siteId,
      secrets: NAMES.map((name) => {
        const shared = mock.secrets[name];
        const mine = own[name];
        return {
          name,
          inUse: mine ? "site" : shared.configured ? (shared.source === "env" ? "env" : "shared") : null,
          ...(mine ? { hint: mine.slice(-4) } : shared.hint ? { hint: shared.hint } : {}),
          site: mine ? { configured: true, hint: mine.slice(-4) } : { configured: false },
          shared: { configured: shared.configured, source: shared.source, ...(shared.hint ? { hint: shared.hint } : {}) },
        };
      }),
      author: author ? { ...author, inUse: "site", site: author } : { ...mock.settings.author, inUse: "shared", site: null },
    };
  }

  function siteUsage(siteId: string): UsageSummary {
    const scale = [...mock.sites.keys()].indexOf(siteId) + 1;
    const totals = (factor: number): UsageTotals => ({ ...empty(), turns: Math.round(3 * factor), requests: Math.round(9 * factor), inputTokens: 21_000 * factor, outputTokens: 2_600 * factor, cost: Math.round(0.19 * factor * 100) / 100 });
    return {
      today: totals(scale * 0.3),
      last7: totals(scale * 2),
      last30: totals(scale * 7),
      allTime: totals(scale * 15),
      byModel: [{ ...totals(scale * 15), model: "claude-opus-5-5" }],
      days: Array.from({ length: 14 }, (_, index) => ({ date: new Date(Date.now() - (13 - index) * 86_400_000).toISOString().slice(0, 10), requests: index % 3, cost: index % 3 ? 0.04 : null })),
    };
  }

  const handlers: Pick<Handlers, MultiSiteKey> = {
    "GET /api/groups": () => groups.map((entry) => ({ ...entry })),
    "POST /api/groups": ({ body }) => {
      const name = body.name?.trim();
      if (!name) throw new MockError("invalid", "Give the group a name.");
      const used = new Set(groups.map((entry) => entry.color));
      const created: SiteGroup = { id: `g-${Math.random().toString(16).slice(2, 10)}`, name, color: body.color ?? COLORS.find((color) => !used.has(color)) ?? "ink", collapsed: false };
      groups.push(created);
      mock.emit({ type: "sites.updated" });
      return created;
    },
    "PATCH /api/groups/:groupId": ({ params, body }) => {
      const current = group(params.groupId);
      if (body.name !== undefined && !body.name.trim()) throw new MockError("invalid", "Give the group a name.");
      Object.assign(current, { ...(body.name !== undefined ? { name: body.name.trim() } : {}), ...(body.color ? { color: body.color } : {}), ...(body.collapsed !== undefined ? { collapsed: body.collapsed } : {}) });
      mock.emit({ type: "sites.updated" });
      return { ...current };
    },
    "DELETE /api/groups/:groupId": ({ params }) => {
      group(params.groupId);
      groups.splice(groups.findIndex((entry) => entry.id === params.groupId), 1);
      for (const entry of listing.values()) if (entry.group === params.groupId) delete entry.group;
      mock.emit({ type: "sites.updated" });
      return { ok: true };
    },
    "PUT /api/groups/order": ({ body }) => {
      const next = body.ids.map((id) => group(id));
      if (next.length !== groups.length) throw new MockError("invalid", "The groups changed while you were arranging them. Try again.");
      groups.splice(0, groups.length, ...next);
      mock.emit({ type: "sites.updated" });
      return groups.map((entry) => ({ ...entry }));
    },
    "PATCH /api/sites/:siteId/listing": ({ params, body }) => {
      const site = mock.sites.get(params.siteId);
      if (!site) throw new MockError("not-found", "That site isn’t in the list any more.");
      seed();
      const entry = listing.get(site.id) ?? {};
      if (body.group !== undefined) {
        if (body.group) entry.group = group(body.group).id;
        else delete entry.group;
      }
      if (body.pinned !== undefined) entry.pinned = body.pinned;
      if (body.note !== undefined) {
        if (body.note && body.note.length > 500) throw new MockError("invalid", "Keep the note under 500 characters.");
        if (body.note?.trim()) entry.note = body.note.trim();
        else delete entry.note;
      }
      listing.set(site.id, entry);
      mock.emit({ type: "sites.updated" });
      return withListing(site.summaryInfo());
    },
    "POST /api/sites/scan": ({ body }): RouteResponse<"POST /api/sites/scan"> => {
      const path = body.path.replace(/\/+$/, "");
      const found = path === CLIENTS || path === HOME ? SCANNABLE : [];
      const known = new Set([...mock.sites.values()].map((site) => site.root));
      return {
        path,
        sites: found.map((name) => {
          const sitePath = `${CLIENTS}/${name}`;
          return { path: sitePath, name: name.replace(/-site$/, "").replace(/^./, (c) => c.toUpperCase()), framework: { id: "eleventy", name: "Eleventy" }, siteId: `scan-${name}`, known: known.has(sitePath) };
        }),
        visited: found.length + 3,
        truncated: false,
        cancelled: false,
        skippedLinks: 0,
      };
    },
    "POST /api/sites/scan/cancel": () => ({ ok: true }),
    "POST /api/sites/add": ({ body }) => {
      const result: RouteResponse<"POST /api/sites/add"> = { added: [], skipped: [] };
      for (const path of body.paths) {
        if ([...mock.sites.values()].some((site) => site.root === path)) {
          result.skipped.push({ path, reason: "It’s already in the list." });
          continue;
        }
        const name = path.slice(path.lastIndexOf("/") + 1).replace(/-site$/, "");
        const site = newSiteFrom("docs", name.replace(/^./, (c) => c.toUpperCase()), path);
        site.lastOpenedAt = 0;
        mock.sites.set(site.id, site);
        mock.previews.set(site.id, { status: { state: "idle", url: null, baselineUrl: null, baselineSource: null, log: [] } });
        mock.threads.set(site.id, []);
        if (body.group) listing.set(site.id, { group: group(body.group).id });
        result.added.push(withListing(site.summaryInfo()));
      }
      mock.emit({ type: "sites.updated" });
      return result;
    },
    "GET /api/sites/:siteId/thumbnail": () => {
      throw new MockError("not-found", "This site has no picture to show.");
    },
    "POST /api/sites/:siteId/presence": () => ({ ok: true }),
    "GET /api/sites/:siteId/connections": ({ params }) => connections(params.siteId),
    "PUT /api/sites/:siteId/secrets/:name": ({ params, body }) => {
      const name = params.name as SecretName;
      if (!NAMES.includes(name)) throw new MockError("invalid", `“${params.name}” isn’t a key this app stores.`);
      const own = ownKeys.get(params.siteId) ?? {};
      if (body.value) own[name] = body.value.trim();
      else delete own[name];
      ownKeys.set(params.siteId, own);
      return connections(params.siteId);
    },
    "PUT /api/sites/:siteId/author": ({ params, body }) => {
      if (body.author) {
        if (!/^[^\s@]+@[^\s@]+$/.test(body.author.email)) throw new MockError("invalid", "That email address doesn’t look right. It should look like name@example.com.");
        ownAuthor.set(params.siteId, { name: body.author.name.trim(), email: body.author.email.trim() });
      } else ownAuthor.delete(params.siteId);
      return connections(params.siteId);
    },
    "GET /api/sites/:siteId/usage": ({ params }) => siteUsage(params.siteId),
    "GET /api/usage/sites": () => ({ sites: [...mock.sites.keys()].map((siteId) => ({ siteId, last30: siteUsage(siteId).last30, allTime: siteUsage(siteId).allTime })) }),
  };

  return { handlers, withListing };
}
