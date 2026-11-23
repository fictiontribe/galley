/**
 * The audit: content checks over every entry (re-reading only entries whose
 * content hash changed since the last run), then — when a preview is running
 * or a build exists — rendered checks over a stated sample of pages, the
 * sitemap, robots rules and the agent-readable files.
 *
 * Nothing here writes, starts a process, or reaches beyond the site's own
 * preview. The result is counts and findings with evidence, never a score.
 */
import { entryUrl, slugForPath } from "../content/entries/paths";
import { parseDocument } from "../content/document/parse";
import type { Collection, EditOp, Entry, JsonValue, MediaItem, SiteModel, SiteService } from "../types";
import { checkCatalogue, GROUP_ORDER, spec, type CheckCode } from "./catalog";
import { readContentPage, type ContentPage } from "./content";
import {
  aiContentChecks,
  bylineChecks,
  contentInbound,
  descriptionChecks,
  duplicateChecks,
  headingContentChecks,
  imageChecks,
  linkChecks,
  navTargets,
  noindexChecks,
  orphanChecks,
  placeholderChecks,
  qualityChecks,
  exampleAddressChecks,
  slashChecks,
  titleChecks,
  upcomingChecks,
  type ContentContext,
} from "./content-checks";
import { finding, sortFindings } from "./finding";
import { parseLlmsTxt, parseRedirects, parseSitemap, pathKey, type Redirect } from "./files";
import { localizeFacts, parsePage, stripBase } from "./html";
import { crawlerReport, readRobots, ROBOTS_GLOB } from "./policy";
import { detectKit, KIT_GLOB, type KitInfo } from "./kit";
import { findRenderSource, type RenderSource } from "./render";
import {
  brandOf,
  canonicalChecks,
  headingChecks,
  imageRenderChecks,
  isNoindex,
  jsOnlyCheck,
  linkRenderChecks,
  noindexRenderedCheck,
  PLACEHOLDER_HOST,
  renderedDescriptionChecks,
  renderedTitleChecks,
  shareImageRenderChecks,
  structuredDataChecks,
  type RenderedPage,
} from "./rendered-checks";
import { isAllowed } from "./robots";
import { shingles, jaccard, plainText, DISPLAY, fitWidth, textWidth, collapse, wordCount } from "./text";
import type { AgentReadableReport, AuditOptions, CrawlerReport, EntryAudit, Finding, FindingGroup, FixProposal, RenderInfo, ResultPreview, SeverityCounts, SiteAudit } from "./types";

const DEFAULT_RENDER_CAP = 60;
const READ_CONCURRENCY = 24;
const RENDER_CONCURRENCY = 6;
const SITEMAP_CHECK_CAP = 200;
/** Rendered results win over content ones for these: the rendered title is the one results show. */
const RENDER_WINS = new Set(["title-long", "title-short", "title-brand-repeated"]);
const ASSET_PATHS = ["/_astro/app.css", "/_astro/app.js", "/assets/app.css", "/assets/app.js", "/_next/static/app.js", "/css/site.css", "/js/site.js", "/images/photo.jpg"];

interface Cached {
  hash: string;
  /** The file's modification time when it was read: an unchanged mtime skips even the read. */
  modifiedAt: number;
  page: ContentPage;
}

interface SiteState {
  pages: Map<string, Cached>;
  urls: Set<string>;
  /** Findings of the last full audit, for applying fixes and planning batches. */
  last: { at: number; findings: Map<string, Finding>; hashes: Map<string, string> } | null;
}

const STATES = new Map<string, SiteState>();

function stateFor(site: SiteService): SiteState {
  let state = STATES.get(site.root);

  if (!state) {
    state = { pages: new Map(), urls: new Set(), last: null };
    STATES.set(site.root, state);
  }
  return state;
}

/** Forget what was read for a site (tests; a site removed from the app). */
export function forgetAudit(root: string): void {
  STATES.delete(root);
}

async function mapLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;

        out[index] = await run(items[index]!);
      }
    })
  );
  return out;
}

interface Collected {
  pages: ContentPage[];
  reused: number;
  newest: number;
}

/**
 * Every entry as a ContentPage. A page is re-parsed only when its bytes
 * changed — except that pages whose links point at an address that appeared
 * or disappeared are re-read too, so the engine's broken-link verdicts stay
 * true when other pages are added, moved or removed.
 */
async function collect(site: SiteService, model: SiteModel, state: SiteState, only?: string): Promise<Collected> {
  const listed: Array<{ path: string; collection: Collection; modifiedAt: number }> = [];

  if (only && state.pages.size > 0) {
    const collection = model.collections.find((c) => only.startsWith(c.path.replace(/\/?$/, "/")) || c.path === only);

    if (collection) listed.push({ path: only, collection, modifiedAt: Date.now() });
    for (const [path, cached] of state.pages) if (path !== only) listed.push({ path, collection: model.collections.find((c) => c.id === cached.page.collection)!, modifiedAt: 0 });
  } else {
    for (const collection of model.collections) {
      const list = await site.listEntries(collection.id).catch(() => null);

      for (const item of list?.items ?? []) listed.push({ path: item.path, collection, modifiedAt: item.modifiedAt });
    }
  }
  let reused = 0;
  const reread = async (path: string, collection: Collection): Promise<ContentPage | null> => {
    try {
      const entry = await site.readEntry(path);

      return readContentPage(entry, collection);
    } catch {
      return null;
    }
  };
  const results = await mapLimit(listed, READ_CONCURRENCY, async ({ path, collection, modifiedAt }) => {
    const cached = state.pages.get(path);

    if (cached && ((only && path !== only) || (!only && modifiedAt > 0 && cached.modifiedAt === modifiedAt))) {
      reused += 1;
      return cached.page;
    }
    const file = await site.readFile(path).catch(() => null);

    if (!file) return null;
    if (cached && cached.hash === file.hash) {
      reused += 1;
      cached.modifiedAt = modifiedAt;
      return cached.page;
    }
    const page = await reread(path, collection);

    if (page) state.pages.set(path, { hash: file.hash, modifiedAt, page });
    else if (cached) state.pages.delete(path);
    return page;
  });
  const pages = results.filter((page): page is ContentPage => page !== null);
  const present = new Set(pages.map((page) => page.path));

  for (const path of [...state.pages.keys()]) if (!present.has(path) && !only) state.pages.delete(path);
  const urls = new Set(pages.filter((page) => page.url).map((page) => pathKey(page.url!)));
  const changed = new Set([...urls].filter((url) => !state.urls.has(url)).concat([...state.urls].filter((url) => !urls.has(url))));

  if (state.urls.size > 0 && (changed.size > 0 || !only)) {
    const affected = pages.filter((page) => page.issues.some((issue) => issue.code === "broken-image") || (changed.size > 0 && page.links.some((link) => changed.has(pathKey(link.href)))));

    await mapLimit(affected, READ_CONCURRENCY, async (page) => {
      const collection = model.collections.find((c) => c.id === page.collection);
      const fresh = collection ? await reread(page.path, collection) : null;

      if (fresh) {
        const known = state.pages.get(page.path);

        state.pages.set(page.path, { hash: known?.hash ?? fresh.hash, modifiedAt: known?.modifiedAt ?? 0, page: fresh });
        pages[pages.indexOf(page)] = fresh;
      }
    });
  }
  state.urls = urls;
  return { pages, reused, newest: Math.max(0, ...listed.map((item) => item.modifiedAt)) };
}

/** Site files that tell the engine where moved pages went. */
const REDIRECT_FILES = new Set(["_redirects", "public/_redirects", "static/_redirects", "netlify.toml", "vercel.json"]);

async function readRedirects(site: SiteService, files: string[]): Promise<Redirect[]> {
  const out: Redirect[] = [];

  for (const file of files.filter((path) => REDIRECT_FILES.has(path))) {
    const text = (await site.readFile(file).catch(() => null))?.content;

    if (text) out.push(...parseRedirects(file, text));
  }
  return out;
}

/**
 * Pages renamed in the pending changes: one entry deleted and one added in
 * the same collection, whose text is clearly the same page (git's own rename
 * test, on content). Anything less certain isn't treated as a move.
 */
async function pendingMoves(site: SiteService, model: SiteModel, pages: ContentPage[]): Promise<Map<string, string>> {
  const moves = new Map<string, string>();
  const changes = await site.changes().catch(() => null);

  if (!changes) return moves;
  const deleted = changes.files.filter((file) => file.status === "deleted" && file.kind === "content");
  const added = changes.files.filter((file) => file.status === "added" && file.kind === "content");

  for (const gone of deleted) {
    const collection = model.collections.find((c) => c.id === gone.collection);

    if (!collection?.url) continue;
    const bytes = await site.readBase(gone.path).catch(() => null);

    if (!bytes) continue;
    const before = parseDocument(Buffer.from(bytes).toString("utf8"), collection.format);
    const oldText = plainText(`${JSON.stringify(before.data ?? {})} ${before.body ?? ""}`);
    const candidates = added
      .filter((file) => file.collection === collection.id)
      .map((file) => ({ file, page: pages.find((page) => page.path === file.path) }))
      .filter((item) => item.page?.url && jaccard(shingles(oldText), shingles(`${item.page.title?.value ?? ""} ${item.page.description?.value ?? ""} ${item.page.text}`)) >= 0.5);
    const oldUrl = entryUrl(model, collection, slugForPath(collection, gone.path));

    if (candidates.length === 1 && oldUrl) moves.set(pathKey(oldUrl), candidates[0]!.page!.url!);
  }
  return moves;
}

/** Address keys of pages that list other entries (a blog index): a short page there isn't thin. */
function listingKeys(model: SiteModel): Set<string> {
  const out = new Set<string>();

  for (const collection of model.collections) {
    const prefix = collection.url?.split("{")[0];

    if (prefix && prefix !== "/") out.add(pathKey(prefix));
    // A collection without pages of its own is usually listed on a page named after it (/changelog/).
    out.add(`/${collection.id.toLowerCase()}`);
  }
  return out;
}

function emptyCounts(): SeverityCounts {
  return { must: 0, should: 0, idea: 0 };
}

function countOf(findings: Finding[]): SeverityCounts {
  const counts = emptyCounts();

  for (const item of findings) counts[item.severity] += 1;
  return counts;
}

function dedupe(findings: Finding[]): Finding[] {
  const byId = new Map<string, Finding>();

  for (const item of findings) {
    const known = byId.get(item.id);

    if (!known) byId.set(item.id, item);
    else if (item.rendered && !known.rendered && RENDER_WINS.has(item.code)) byId.set(item.id, { ...item, fix: item.fix ?? known.fix, write: item.write ?? known.write, field: item.field ?? known.field });
  }
  return [...byId.values()];
}

interface RenderedSet {
  info: RenderInfo;
  pages: RenderedPage[];
  findings: Finding[];
  agent: AgentReadableReport;
  /** Every page known to the source was rendered, so the rendered link graph is complete. */
  complete: boolean;
  types: Map<string, string[]>;
}

/** What the kit is set to publish, in plain words. */
function kitSummary(kit: KitInfo): string {
  const parts = [kit.agentReadable.markdownTwins ? "a markdown version of each page" : null, kit.agentReadable.llmsTxt ? "llms.txt" : null, kit.agentReadable.llmsFullTxt ? "llms-full.txt" : null, kit.agentReadable.agentPage ? "agent.md" : null].filter((part): part is string => part !== null);

  return parts.length ? `The site kit publishes ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`}, set in ${kit.file}.` : `The site kit is set to publish no agent-readable version (${kit.file}).`;
}

function kitPublishing(kit: KitInfo | null): Pick<AgentReadableReport, "kit"> {
  return kit ? { kit: { file: kit.file, ...kit.agentReadable } } : {};
}

function noRender(total: number, cap: number, reason: string, kit: KitInfo | null = null): RenderedSet {
  return {
    info: { source: "none", detail: reason, sampled: 0, total, cap },
    pages: [],
    findings: [],
    agent: {
      llmsTxt: { present: false },
      markdownTwins: { checked: 0, advertised: 0, reachable: 0 },
      known: false,
      ...kitPublishing(kit),
      summary: kit ? `${kitSummary(kit)} Start the preview or build the site to check what is served.` : "Start the preview or build the site to check whether an agent-readable version is served.",
    },
    complete: false,
    types: new Map(),
  };
}

/** Which pages to render: the home page, the menu's pages, then the rest spread evenly — deterministic, and stated. */
function sample(urls: string[], priority: Set<string>, cap: number): string[] {
  const unique = [...new Set(urls)].filter((url) => !/(^|\/)404(\.html|\/)?$/.test(url));
  const first = unique.filter((url) => url === "/" || priority.has(pathKey(url)));
  const rest = unique.filter((url) => !first.includes(url)).sort();
  const room = Math.max(0, cap - first.length);
  const step = rest.length > room && room > 0 ? rest.length / room : 1;
  const picked = room === 0 ? [] : rest.length <= room ? rest : Array.from({ length: room }, (_, index) => rest[Math.floor(index * step)]!);

  return [...first.slice(0, cap), ...picked].slice(0, cap);
}

async function renderedAudit(site: SiteService, source: RenderSource, model: SiteModel, pages: ContentPage[], cap: number, siteName: string, kit: KitInfo | null, only?: string): Promise<RenderedSet> {
  const byKey = new Map(pages.filter((page) => page.url).map((page) => [pathKey(page.url!), page]));
  const nav = navTargets(model, pages);
  const listed = await source.pages();
  const contentUrls = pages.filter((page) => page.isPage && !page.draft && page.url).map((page) => page.url!);
  const all = only ? [only] : [...new Set([...(listed ?? []), ...contentUrls])];
  const chosen = only ? [only] : sample(all, nav, cap);
  const media = new Map<string, MediaItem>((await site.listMedia().catch(() => [] as MediaItem[])).map((item) => [item.url, item]));
  const rendered: RenderedPage[] = [];
  // Pages labelled HTML that aren't (a broken dev server, an error dump): checking them would only invent findings.
  const unreadable: string[] = [];

  await mapLimit(chosen, RENDER_CONCURRENCY, async (urlPath) => {
    const got = await source.get(urlPath);

    if (!got || !/html/.test(got.type) || got.status >= 400) return;
    if (!/<(html|head|body|!doctype|title|main|div|p)\b/i.test(got.body.slice(0, 4000))) {
      unreadable.push(urlPath);
      return;
    }
    rendered.push({ urlPath, status: got.status, facts: localizeFacts(parsePage(got.body), source.base), page: byKey.get(pathKey(urlPath)) ?? null });
  });
  rendered.sort((a, b) => a.urlPath.localeCompare(b.urlPath));
  const findings: Finding[] = [];
  const ids = new Map(rendered.map((item) => [pathKey(item.urlPath), item.facts.ids]));
  const types = new Map<string, string[]>();
  const contentAlts = new Map<string, Set<string>>();

  for (const page of pages) for (const image of page.images) if (image.altField !== null || image.inBody) contentAlts.set(image.src, (contentAlts.get(image.src) ?? new Set()).add(image.alt ?? ""));
  const exists = async (path: string) => {
    const got = await source.size(path);

    return got !== null || media.has(path);
  };

  for (const item of rendered) {
    findings.push(...renderedTitleChecks(item, siteName));
    findings.push(...renderedDescriptionChecks(item));
    findings.push(...headingChecks(item));
    findings.push(...(await imageRenderChecks(item, media, (url) => source.size(url), contentAlts)));
    findings.push(...(await shareImageRenderChecks(item, exists)));
    findings.push(...linkRenderChecks(item, (key) => ids.get(key) ?? null));
    findings.push(...canonicalChecks(item));
    findings.push(...jsOnlyCheck(item));
    findings.push(...noindexRenderedCheck(item, pathKey(item.urlPath) === "/" || nav.has(pathKey(item.urlPath))));
    const data = structuredDataChecks(item);

    findings.push(...data.findings);
    types.set(pathKey(item.urlPath), data.types);
  }
  // Duplicate titles and descriptions as sent (a site-wide fallback description shows up here).
  if (!only) {
    for (const [code, pick] of [
      ["title-duplicate", (item: RenderedPage) => item.facts.title],
      ["description-duplicate", (item: RenderedPage) => item.facts.metas.get("description") ?? null],
    ] as const) {
      const groups = new Map<string, RenderedPage[]>();

      for (const item of rendered) {
        if (isNoindex(item.facts)) continue;
        const value = pick(item);

        if (!value) continue;
        const key = collapse(value).toLowerCase();

        groups.set(key, [...(groups.get(key) ?? []), item]);
      }
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        for (const item of group) {
          findings.push(
            finding(code, {
              ...(item.page ? { path: item.page.path, url: item.page.url, pageTitle: item.page.title?.value } : { url: item.urlPath }),
              field: code === "title-duplicate" ? (item.page?.title?.field ?? null) : (item.page?.descriptionField ?? null),
              write: item.page ? (code === "title-duplicate" ? "title" : "description") : null,
              rendered: true,
              evidence: { value: pick(item) ?? "", pages: group.filter((other) => other !== item).map((other) => ({ url: other.urlPath, ...(other.facts.title ? { title: other.facts.title } : {}) })) },
            })
          );
        }
      }
    }
  }
  const agent = await agentReport(source, rendered, Boolean(only), kit);

  if (!only) {
    findings.push(...(await sitemapChecks(source, rendered, byKey)));
    findings.push(...agent.findings);
    findings.push(...structuredSuggestions(model, rendered, types, kit, source.base));
    // Placeholder hosts in what the site sends: preferred addresses and share links.
    const hosts = new Set<string>();

    for (const item of rendered) {
      for (const link of item.facts.links.filter((l) => l.rel === "canonical")) {
        try {
          const host = new URL(link.href).hostname;

          if (PLACEHOLDER_HOST.test(host)) hosts.add(host);
        } catch {
          // Relative canonicals are reported by their own check.
        }
      }
    }
    if (hosts.size) findings.push(finding("site-url-placeholder", { rendered: true, evidence: { values: [...hosts], note: "Set the site's real address in its settings (for an Astro site, `site` in its configuration)." } }));
  }
  const info: RenderInfo = {
    source: source.kind,
    detail: `Rendered checks used ${source.detail}.${unreadable.length ? ` ${unreadable.length} ${unreadable.length === 1 ? "page" : "pages"} came back as something other than HTML (${unreadable.slice(0, 3).join(", ")}) and ${unreadable.length === 1 ? "was" : "were"} skipped.` : ""}`,
    sampled: rendered.length,
    total: only ? 1 : all.length,
    cap,
    ...(source.stale ? { stale: true } : {}),
  };

  const withKit = kit ? { ...agent.report, ...kitPublishing(kit), summary: `${kitSummary(kit)} ${agent.report.summary}` } : agent.report;

  return { info, pages: rendered, findings, agent: withKit, complete: listed !== null && rendered.length >= all.length, types };
}

async function sitemapChecks(source: RenderSource, rendered: RenderedPage[], byKey: Map<string, ContentPage>): Promise<Finding[]> {
  const robots = await source.get("/robots.txt");
  const fromRobots = robots?.status === 200 ? [...robots.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]!) : [];
  const starts = [...new Set([...fromRobots.map((url) => safePath(url)).filter((p): p is string => p !== null), "/sitemap.xml", "/sitemap-index.xml"])];
  const seen = new Set<string>();
  const urls: string[] = [];
  let found = false;
  const queue = [...starts];

  while (queue.length && seen.size < 8) {
    const path = queue.shift()!;

    if (seen.has(path)) continue;
    seen.add(path);
    const got = await source.get(path);

    if (!got || got.status !== 200 || /html/.test(got.type)) continue;
    const parsed = parseSitemap(got.body);

    if (!parsed.urls.length && !parsed.sitemaps.length) continue;
    found = true;
    urls.push(...parsed.urls.map((url) => url.loc));
    for (const next of parsed.sitemaps) {
      const p = safePath(next);

      if (p) queue.push(p);
    }
  }
  if (!found) return [finding("sitemap-missing", { rendered: true, evidence: { values: starts, note: "None of these addresses serves a sitemap." } })];
  const listed = new Set(urls.map((url) => safePath(url)).filter((p): p is string => p !== null).map((p) => pathKey(stripBase(p, source.base))));
  const out: Finding[] = [];

  for (const item of rendered) {
    if (isNoindex(item.facts) || item.status !== 200) continue;
    const canonical = item.facts.links.find((link) => link.rel === "canonical")?.href;

    if (canonical && safePath(canonical) !== null && pathKey(stripBase(safePath(canonical)!, source.base)) !== pathKey(item.urlPath)) continue;
    if (listed.has(pathKey(item.urlPath))) continue;
    out.push(finding("sitemap-missing-page", { ...(item.page ? { path: item.page.path, url: item.page.url, pageTitle: item.page.title?.value } : { url: item.urlPath }), rendered: true }));
  }
  const renderedByKey = new Map(rendered.map((item) => [pathKey(item.urlPath), item]));
  const bad: string[] = [];

  for (const url of urls.slice(0, SITEMAP_CHECK_CAP)) {
    const based = safePath(url);

    if (!based) continue;
    const path = stripBase(based, source.base);
    const known = renderedByKey.get(pathKey(path));

    if (known) {
      if (isNoindex(known.facts)) bad.push(`${path} — kept out of search`);
      continue;
    }
    const content = byKey.get(pathKey(path));

    if (content?.noindex.value) {
      bad.push(`${path} — kept out of search`);
      continue;
    }
    if (content) continue;
    const got = await source.get(path);

    if (!got || got.status >= 400) bad.push(`${path} — no page there`);
    else if (pathKey(got.finalPath) !== pathKey(path)) bad.push(`${path} — redirects to ${got.finalPath}`);
  }
  if (bad.length) out.push(finding("sitemap-bad-entry", { rendered: true, evidence: { values: bad.slice(0, 20), note: `${bad.length} of the ${Math.min(urls.length, SITEMAP_CHECK_CAP)} addresses checked${urls.length > SITEMAP_CHECK_CAP ? ` (of ${urls.length})` : ""}.` } }));
  return out;
}

function hostOf(url: string): string | null {
  try {
    return /^https?:\/\//i.test(url) ? new URL(url).hostname : null;
  } catch {
    return null;
  }
}

function safePath(url: string): string | null {
  try {
    return new URL(url, "http://local.invalid").pathname;
  } catch {
    return null;
  }
}

/** A page the kit (and the llms.txt proposal) deliberately leaves out: kept out of search, a redirect, or a copy of another page. */
function excludedFromAgents(item: RenderedPage, kit: KitInfo | null): boolean {
  if (isNoindex(item.facts) || item.facts.refresh) return true;
  const canonical = item.facts.links.find((link) => link.rel === "canonical")?.href;
  const canonicalPath = canonical ? safePath(canonical) : null;

  if (canonicalPath && pathKey(canonicalPath) !== pathKey(item.urlPath)) return true;
  const excluded = kit?.data.agentReadable && typeof kit.data.agentReadable === "object" && !Array.isArray(kit.data.agentReadable) ? (kit.data.agentReadable as { exclude?: JsonValue }).exclude : undefined;

  return Array.isArray(excluded) && excluded.some((glob) => typeof glob === "string" && globMatch(glob, item.urlPath));
}

/** The kit's page globs: "*" within a segment, "**" across them. */
function globMatch(glob: string, path: string): boolean {
  const source = glob
    .split("**")
    .map((part) => part.split("*").map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*"))
    .join(".*");

  return new RegExp(`^${source}$`).test(path) || new RegExp(`^${source}$`).test(path.replace(/\/$/, ""));
}

async function agentReport(source: RenderSource, rendered: RenderedPage[], quick: boolean, kit: KitInfo | null): Promise<{ report: AgentReadableReport; findings: Finding[] }> {
  const findings: Finding[] = [];
  const llms = quick ? null : await source.get("/llms.txt");
  const llmsPresent = Boolean(llms && llms.status === 200 && !/html/.test(llms.type) && llms.body.trim());
  let llmsReport: AgentReadableReport["llmsTxt"] = { present: false };
  const served = async (path: string) => {
    const got = quick ? null : await source.get(path);

    return Boolean(got && got.status === 200 && !/html/.test(got.type) && got.body.trim());
  };
  const agentPage = await served("/agent.md");
  const fullText = await served("/llms-full.txt");

  if (llmsPresent) {
    const parsed = parseLlmsTxt(llms!.body);
    const problems = [...parsed.problems];
    const missing: string[] = [];

    const ownHosts = new Set(rendered.flatMap((item) => item.facts.links.filter((link) => link.rel === "canonical").map((link) => hostOf(link.href))).filter((host): host is string => host !== null));

    for (const link of parsed.links.slice(0, 20)) {
      const path = safePath(link.url);
      const host = hostOf(link.url);

      // Only the site's own addresses can be checked here; links to other sites are theirs.
      if (!path || (host !== null && !ownHosts.has(host) && !PLACEHOLDER_HOST.test(host))) continue;
      const got = await source.get(path);

      if (!got || got.status >= 400) missing.push(link.url);
    }
    if (missing.length) problems.push(`${missing.length} of its links lead nowhere: ${missing.slice(0, 5).join(", ")}.`);
    llmsReport = { present: true, url: "/llms.txt", valid: problems.length === 0, links: parsed.links.length, ...(problems.length ? { problem: problems.join(" ") } : {}) };
    if (problems.length) findings.push(finding("agent-readable-broken", { rendered: true, key: "llms", evidence: { value: "/llms.txt", note: problems.join(" ") } }));
  }
  const eligible = rendered.filter((item) => !excludedFromAgents(item, kit));
  let advertised = 0;
  let reachable = 0;
  const unreachable: string[] = [];
  const withoutTwin: RenderedPage[] = [];

  for (const item of eligible) {
    const twin = item.facts.links.find((link) => link.rel === "alternate" && link.type === "text/markdown");

    if (!twin) {
      withoutTwin.push(item);
      continue;
    }
    advertised += 1;
    if (advertised > 10) continue;
    const path = safePath(new URL(twin.href, `http://local.invalid${item.urlPath}`).href);
    const got = path ? await source.get(path) : null;

    if (got && got.status === 200 && !/html/.test(got.type)) reachable += 1;
    else unreachable.push(twin.href);
  }
  if (unreachable.length) findings.push(finding("agent-readable-broken", { rendered: true, key: "twins", evidence: { values: unreachable.slice(0, 5), note: "Pages advertise a markdown version that isn't served." } }));
  // The kit promises a twin for every page it doesn't leave out on purpose; one without is a gap.
  if (kit?.agentReadable.markdownTwins && advertised > 0 && withoutTwin.length) {
    findings.push(finding("agent-readable-broken", { rendered: true, key: "missing-twins", evidence: { pages: withoutTwin.slice(0, 8).map((item) => ({ url: item.urlPath, ...(item.facts.title ? { title: item.facts.title } : {}) })), note: `${withoutTwin.length} of ${eligible.length} pages checked have no markdown version, though the site kit makes one for every page it doesn't leave out on purpose.` } }));
  }
  if (!quick && !llmsPresent && advertised === 0) {
    findings.push(finding("agent-readable-missing", { rendered: true, evidence: { note: kit ? `The site kit is set not to publish it (${kit.file} → agentReadable).` : "No /llms.txt, and no page advertises a markdown version. See “Agent-readable version” in the Search & AI guide for how to turn it on." } }));
  }
  const published = [llmsPresent ? "llms.txt" : null, fullText ? "llms-full.txt" : null, agentPage ? "agent.md" : null].filter(Boolean);
  const parts = [
    quick ? null : published.length ? `served: ${published.length === 1 ? published[0] : `${published.slice(0, -1).join(", ")} and ${published[published.length - 1]}`}${llmsPresent && !llmsReport.valid ? " (llms.txt with problems)" : ""}` : "no llms.txt is served",
    advertised ? `${advertised} of ${eligible.length} pages checked have a markdown version` : `none of the ${eligible.length} pages checked has a markdown version`,
    eligible.length < rendered.length ? `${rendered.length - eligible.length} left out on purpose (kept out of search, redirects or copies)` : null,
  ].filter(Boolean);

  return {
    report: {
      llmsTxt: llmsReport,
      markdownTwins: { checked: eligible.length, advertised, reachable },
      known: true,
      ...(quick ? {} : { agentPage, fullText }),
      summary: `${parts.join("; ")}.`.replace(/^./, (c) => c.toUpperCase()),
    },
    findings,
  };
}

/**
 * On a kit site, article details come from the data file's
 * `structuredData.articles`: adding the posts' collections there is the
 * whole fix. "auto" (the default) means pages that say they are articles;
 * naming collections makes it explicit, so the fix keeps any already named.
 */
function articleFix(kit: KitInfo | null, collections: string[]): FixProposal | null {
  if (!kit || !kit.exists || !collections.length) return null;
  const named = kit.articles === false || kit.articles === "auto" ? [] : kit.articles;
  const missing = collections.filter((id) => !named.includes(id));

  if (!missing.length) return null;
  const structured = kit.data.structuredData;
  const ops: EditOp[] =
    structured && typeof structured === "object" && !Array.isArray(structured)
      ? Array.isArray(structured.articles)
        ? missing.map((id, index) => ({ op: "insert" as const, path: ["structuredData", "articles"], index: named.length + index, value: id }))
        : [{ op: "set", path: ["structuredData", "articles"], value: [...named, ...missing] }]
      : [{ op: "set", path: ["structuredData"], value: { articles: missing } }];

  return { label: `Describe ${missing.join(" and ")} as articles`, after: JSON.stringify([...named, ...missing]), edits: [{ path: kit.file, ops, summary: `Add ${missing.join(", ")} to the site kit's article collections` }] };
}

function structuredSuggestions(model: SiteModel, rendered: RenderedPage[], types: Map<string, string[]>, kit: KitInfo | null = null, base = ""): Finding[] {
  const out: Finding[] = [];
  const dated = new Set(model.collections.filter((collection) => collection.dateField && collection.url).map((collection) => collection.id));
  const articles = rendered.filter((item) => item.page && dated.has(item.page.collection) && !isNoindex(item.facts) && !(types.get(pathKey(item.urlPath)) ?? []).some((type) => !/^(BreadcrumbList|WebSite|WebPage|Organization|ImageObject|Person|ListItem)$/.test(type)));

  if (articles.length) out.push(finding("jsonld-suggest-article", { rendered: true, fix: articleFix(kit, [...new Set(articles.map((item) => item.page!.collection))]), evidence: { pages: articles.slice(0, 12).map((item) => ({ path: item.page!.path, url: item.urlPath, ...(item.page!.title ? { title: item.page!.title.value } : {}) })), note: `${articles.length} rendered post${articles.length === 1 ? "" : "s"} with a date and no article details. The content already has the headline${articles.some((item) => item.page?.author.value) ? ", author" : ""} and date.` } }));
  const home = rendered.find((item) => pathKey(item.urlPath) === "/");

  if (home) {
    const homeTypes = types.get("/") ?? [];
    // Google gives site names to a domain or subdomain only, never a sub-directory: under a base path, WebSite doesn't apply.
    const missing = (base ? ["Organization"] : ["WebSite", "Organization"]).filter((type) => !homeTypes.some((t) => t === type || (type === "Organization" && /Organization|LocalBusiness|Corporation|Store|Restaurant/.test(t))));

    if (missing.length) out.push(finding("jsonld-suggest-site", { rendered: true, url: "/", evidence: { values: missing, note: `The home page has no ${missing.join(" or ")} details.` } }));
  }
  const deep = rendered.filter((item) => item.urlPath.split("/").filter(Boolean).length >= 2 && !isNoindex(item.facts) && !(types.get(pathKey(item.urlPath)) ?? []).includes("BreadcrumbList"));

  if (deep.length) out.push(finding("jsonld-suggest-breadcrumbs", { rendered: true, evidence: { pages: deep.slice(0, 8).map((item) => ({ url: item.urlPath, ...(item.facts.title ? { title: item.facts.title } : {}) })), note: `${deep.length} nested page${deep.length === 1 ? "" : "s"} checked.` } }));
  return out;
}

function crawlerFindings(report: CrawlerReport, robotsText: string | null): Finding[] {
  if (!robotsText || !report.blocksEverything) return [];
  return [finding("robots-blocks-all", { evidence: { value: robotsText.split(/\r?\n/).filter((line) => /disallow:\s*\/\s*$/i.test(line)).slice(0, 3).join("\n") } })];
}

function assetFindings(robots: { file: import("./robots").RobotsFile | null; text: string | null }): Finding[] {
  if (!robots.file || !robots.text) return [];
  const blocked = ASSET_PATHS.filter((path) => !isAllowed(robots.file!, "googlebot", path).allowed && isAllowed(robots.file!, "googlebot", "/").allowed);

  return blocked.length ? [finding("robots-blocks-assets", { evidence: { values: blocked, note: "Paths like these are refused to Googlebot." } })] : [];
}

function aiSearchFindings(report: CrawlerReport): Finding[] {
  if (report.blocksEverything || !report.readable) return [];
  return report.crawlers
    .filter((crawler) => crawler.purpose === "search" && !crawler.allowed)
    .map((crawler) => ({ ...finding("ai-search-blocked", { key: crawler.token, title: `${crawler.label} is blocked`, evidence: { value: crawler.token, note: crawler.ifBlocked } }), source: crawler.source }));
}

/** Writing robots.txt needs build mode; the engine enforces it, this only says so up front. */
function robotsWritable(model: SiteModel): boolean {
  return model.ai.allowBuild;
}

function summarize(counts: SeverityCounts, pages: number, render: RenderInfo): string {
  const parts: string[] = [];
  const total = counts.must + counts.should + counts.idea;

  parts.push(`Checked ${pages} ${pages === 1 ? "entry" : "entries"} in the content${render.source === "none" ? "" : ` and ${render.sampled} rendered page${render.sampled === 1 ? "" : "s"}${render.sampled < render.total ? ` (a sample of ${render.total})` : ""}`}.`);
  if (total === 0) parts.push("Nothing to fix or suggest.");
  else {
    const list = [counts.must ? `${counts.must} must fix` : null, counts.should ? `${counts.should} should fix` : null, counts.idea ? `${counts.idea} idea${counts.idea === 1 ? "" : "s"}` : null].filter(Boolean);

    parts.push(`${list.join(", ")}.`.replace(/^./, (c) => c.toUpperCase()));
  }
  if (render.source === "none") parts.push("Checks of the pages as visitors get them were skipped: start the preview or build the site to run them.");
  return parts.join(" ");
}

export interface PreparedAudit {
  model: SiteModel;
  pages: ContentPage[];
  reused: number;
  newest: number;
  context: ContentContext;
  /** The site files the audit looks at (robots, redirects, code routes, the site kit). */
  files: string[];
  /** The site kit, when the site uses it. */
  kit: KitInfo | null;
  /** Words each rendered page was sent with, once rendered checks ran. */
  renderedWords?: Map<string, number>;
}

/**
 * Dynamic routes written in code ("blog/tags/[tag]/[...page].astro"), as
 * tests on an address. The engine's link check can't know which values
 * such a route makes; a "broken" link one of them could answer is said
 * with less certainty until the rendered site confirms it.
 */
function codeRoutes(model: SiteModel, files: string[]): RegExp[] {
  if (!model.routesDir) return [];
  const dir = model.routesDir.replace(/\/+$/, "");

  return files
    .filter((file) => file.startsWith(`${dir}/`) && /\.(astro|md|mdx|ts|js|html)$/.test(file) && /\[[^\]]+\]/.test(file))
    .map((file) => {
      const route = file
        .slice(dir.length)
        .replace(/\.(astro|md|mdx|ts|js|html)$/, "")
        .replace(/\/index$/, "")
        .split("/")
        .map((segment) => (/^\[\.\.\.[^\]]+\]$/.test(segment) ? "(?:.*)" : segment.replace(/\[[^\]]+\]/g, "[^/]+").replace(/[.+?^${}()|\\]/g, (c) => (c === "^" ? c : `\\${c}`))))
        .join("/");

      return new RegExp(`^${route.replace(/\/\(\?:\.\*\)/g, "(?:/.*)?")}/?$`, "i");
    });
}

/** A broken-link verdict checked against the rendered site, or made less certain when code may make the page. */
async function settleBrokenLinks(findings: Finding[], source: RenderSource | null, routes: RegExp[]): Promise<Finding[]> {
  const out: Finding[] = [];

  for (const item of findings) {
    if (item.code !== "link-broken" || !item.evidence.value || item.fix) {
      out.push(item);
      continue;
    }
    const target = item.evidence.value.split(/[?#]/)[0]!;

    if (source) {
      const got = await source.get(target);

      if (got && got.status < 400) continue;
      out.push({ ...item, rendered: true, evidence: { ...item.evidence, note: `${item.evidence.note ?? ""} The ${source.kind === "preview" ? "preview" : "build"} has no page there either.`.trim() } });
      continue;
    }
    if (routes.some((route) => route.test(target))) {
      out.push({ ...item, severity: "should", evidence: { ...item.evidence, note: "No content entry lives at this address, but a page the site's code makes might. Start the preview or build the site to confirm." } });
      continue;
    }
    out.push(item);
  }
  return out;
}

async function prepare(site: SiteService, options: AuditOptions, only?: string): Promise<PreparedAudit> {
  const model = await site.model();
  const state = stateFor(site);
  const collected = await collect(site, model, state, only);
  // One listing of the site's own files serves robots, redirects and code routes.
  const routes = model.routesDir ? `,${model.routesDir.replace(/\/+$/, "")}/**/*` : "";
  const files = await site.listFiles({ glob: `{_redirects,public/_redirects,static/_redirects,netlify.toml,vercel.json,${ROBOTS_GLOB.slice(1, -1)},${KIT_GLOB.slice(1, -1)}${routes}}` }).catch(() => [] as string[]);
  const kit = await detectKit(site, files);
  const redirects = await readRedirects(site, files);
  // Moves only matter for links that are broken; reading the pending changes is slow on big sites.
  const broken = collected.pages.some((page) => page.issues.some((issue) => issue.code === "broken-link"));
  const moves = broken ? await pendingMoves(site, model, collected.pages) : new Map<string, string>();
  const context: ContentContext = { model, pages: collected.pages, siteName: model.name, now: options.now ?? new Date(), redirects, moves };

  return { model, ...collected, context, files, kit };
}

function contentFindings(prepared: PreparedAudit): Finding[] {
  const { context: ctx, model, pages } = prepared;
  const out: Finding[] = [];
  const nav = navTargets(model, pages);

  for (const page of pages) {
    out.push(...titleChecks(ctx, page), ...descriptionChecks(page), ...imageChecks(page), ...linkChecks(ctx, page), ...noindexChecks(ctx, page, nav), ...placeholderChecks(page), ...headingContentChecks(page), ...aiContentChecks(ctx, page), ...bylineChecks(ctx, page), ...upcomingChecks(ctx, page));
  }
  out.push(...duplicateChecks(ctx), ...slashChecks(ctx), ...exampleAddressChecks(pages), ...qualityChecks(ctx, listingKeys(model), prepared.renderedWords));
  return out;
}

/**
 * The content checks alone, over entries already read — no files, no git,
 * no rendering. For callers that hold entries themselves (the app's
 * fixture backend); the real audit is auditSite.
 */
export function auditEntries(model: SiteModel, entries: Entry[], options: { now?: Date } = {}): Finding[] {
  const pages = entries
    .map((entry) => {
      const collection = model.collections.find((c) => c.id === entry.collection);

      return collection ? readContentPage(entry, collection) : null;
    })
    .filter((page): page is ContentPage => page !== null);
  const context: ContentContext = { model, pages, siteName: model.name, now: options.now ?? new Date(), redirects: [], moves: new Map() };
  const findings = contentFindings({ model, pages, reused: 0, newest: 0, context, files: [], kit: null });

  findings.push(...orphanChecks(context, contentInbound(pages), topLevel(model), "No page, menu or settings file in the content links here."));
  return sortFindings(dedupe(findings));
}

/** Pages collections whose entries sit at the top of the site: the code doesn't list them, a menu or a link must. */
function topLevel(model: SiteModel): (page: ContentPage) => boolean {
  const ids = new Set(model.collections.filter((collection) => collection.url && /^\/?\{slug\}/.test(collection.url)).map((collection) => collection.id));

  return (page) => ids.has(page.collection);
}

export async function auditSite(site: SiteService, options: AuditOptions = {}): Promise<SiteAudit> {
  const started = Date.now();
  const prepared = await prepare(site, options);
  const cap = options.renderCap ?? DEFAULT_RENDER_CAP;
  const source = options.render === "off" ? null : await findRenderSource(site, prepared.model, prepared.newest);
  const visiblePages = prepared.pages.filter((page) => page.isPage && !page.draft).length;
  const render = source ? await renderedAudit(site, source, prepared.model, prepared.pages, cap, prepared.context.siteName, prepared.kit) : noRender(visiblePages, cap, options.render === "off" ? "Rendered checks were turned off for this run." : "Neither a running preview nor a build of the site was found, so only the content files were checked.", prepared.kit);
  const robots = await readRobots(site, source, prepared.files, prepared.kit);
  const crawlers = crawlerReport(robots, robotsWritable(prepared.model));
  prepared.renderedWords = new Map(render.pages.map((item) => [pathKey(item.urlPath), wordCount(item.facts.text)]));
  let findings = await settleBrokenLinks(contentFindings(prepared), source, source ? [] : codeRoutes(prepared.model, prepared.files));
  const inbound = contentInbound(prepared.pages);

  if (render.complete) {
    for (const item of render.pages) {
      for (const anchor of item.facts.anchors) {
        if (!/^\/(?!\/)/.test(anchor.href)) continue;
        const key = pathKey(anchor.href);
        const set = inbound.get(key) ?? new Set<string>();

        set.add(item.page?.path ?? item.urlPath);
        inbound.set(key, set);
      }
    }
    findings.push(...orphanChecks(prepared.context, inbound, (page) => page.url !== null, "No page of the rendered site and no content file links here."));
  } else {
    findings.push(...orphanChecks(prepared.context, inbound, topLevel(prepared.model), "No page, menu or settings file in the content links here. (Pages written in code, such as a blog index, aren't counted without a preview or build.)"));
  }
  findings.push(...crawlerFindings(crawlers, robots.text), ...assetFindings(robots), ...aiSearchFindings(crawlers));
  // A placeholder address found in the content explains the rendered one.
  if (findings.some((item) => item.code === "placeholder-address" && /^https?:/.test(item.evidence.value ?? ""))) render.findings = render.findings.filter((item) => item.code !== "site-url-placeholder");
  findings.push(...render.findings);
  findings = sortFindings(dedupe(findings));
  if (options.groups?.length) findings = findings.filter((item) => options.groups!.includes(item.group));
  const counts = countOf(findings);
  const byGroup = Object.fromEntries(GROUP_ORDER.map((group) => [group, countOf(findings.filter((item) => item.group === group))])) as Record<FindingGroup, SeverityCounts>;
  const skipped = render.info.source === "none" ? checkCatalogue().filter((check) => check.needsRender).map((check) => ({ code: check.code, reason: render.info.detail })) : [];
  const state = stateFor(site);

  state.last = { at: Date.now(), findings: new Map(findings.map((item) => [item.id, item])), hashes: new Map(prepared.pages.map((page) => [page.path, page.hash])) };
  return {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    pages: { checked: prepared.pages.length, reused: prepared.reused },
    rendering: render.info,
    counts,
    byGroup,
    summary: summarize(counts, prepared.pages.length, render.info),
    findings,
    skipped: [...skipped, { code: "link-external-dead", reason: "Off unless asked for: it makes requests to other sites." }],
    crawlers,
    agentReadable: render.agent,
    checks: checkCatalogue(),
  };
}

function addressFor(model: SiteModel, url: string | null): string {
  let host = "your-site";

  try {
    if (model.urls.production) host = new URL(model.urls.production).host;
  } catch {
    // Keep the neutral name.
  }
  const parts = (url ?? "/").split("/").filter(Boolean);

  return [host.replace(/^www\./, ""), ...parts].join(" › ");
}

export function resultPreview(model: SiteModel, page: ContentPage | null, rendered: RenderedPage | null): ResultPreview {
  const renderedTitle = rendered?.facts.title ?? null;
  const contentTitle = page?.title?.value ?? null;
  const title = renderedTitle ?? contentTitle ?? "";
  const renderedDescription = rendered?.facts.metas.get("description") ?? null;
  const contentDescription = page?.description?.value ?? null;
  const description = renderedDescription ?? contentDescription ?? "";
  const shownTitle = fitWidth(title, DISPLAY.title.fontPx, DISPLAY.title.limit);
  const shownDescription = fitWidth(description, DISPLAY.description.fontPx, DISPLAY.description.limit);

  return {
    title,
    titleFrom: renderedTitle ? "rendered" : contentTitle ? "content" : "none",
    shownTitle: shownTitle.shown,
    titleWidth: textWidth(title, DISPLAY.title.fontPx),
    titleLimit: DISPLAY.title.limit,
    address: addressFor(model, page?.url ?? rendered?.urlPath ?? null),
    description,
    descriptionFrom: renderedDescription ? "rendered" : contentDescription ? "content" : "none",
    shownDescription: shownDescription.shown,
    ...(page?.title?.field ? { titleField: page.title.field } : {}),
    ...(page?.descriptionField ? { descriptionField: page.descriptionField } : {}),
  };
}

/**
 * One entry, fast enough for the editor: this entry is re-read, the rest of
 * the site comes from the cache (so duplicates and links are still judged
 * against the whole site), and only this page is rendered.
 */
export async function auditEntry(site: SiteService, path: string, options: AuditOptions = {}): Promise<EntryAudit> {
  const state = stateFor(site);

  if (state.pages.size === 0) await prepare(site, options);
  const prepared = await prepare(site, options, path);
  const page = prepared.pages.find((item) => item.path === path) ?? null;
  const entry = page ? null : await site.readEntry(path);
  const url = page?.url ?? entry?.url ?? null;
  const source = options.render === "off" || !url ? null : await findRenderSource(site, prepared.model, prepared.newest);
  const render = source && url ? await renderedAudit(site, source, prepared.model, prepared.pages, 1, prepared.context.siteName, prepared.kit, url) : noRender(1, 1, url ? "Neither a running preview nor a build of the site was found, so only the content was checked." : "This entry has no page of its own.", prepared.kit);
  const mine = (item: Finding) => item.path === path || (url !== null && item.url === url) || Boolean(item.evidence.pages?.some((ref) => ref.path === path) && item.scope === "site");
  const findings = sortFindings(dedupe([...contentFindings(prepared).filter(mine), ...render.findings.filter(mine)]));
  const rendered = render.pages[0] ?? null;

  return {
    path,
    url,
    title: page?.title?.value ?? entry?.title ?? path,
    findings,
    preview: resultPreview(prepared.model, page, rendered),
    structuredData: rendered ? (render.types.get(pathKey(rendered.urlPath)) ?? []) : null,
    rendering: render.info,
    counts: countOf(findings),
  };
}

/** The last full audit's finding, by id (fixes and batches act on what the person saw). */
export function lastFinding(site: SiteService, id: string): { finding: Finding; hash: string | undefined } | null {
  const last = stateFor(site).last;
  const item = last?.findings.get(id);

  return item ? { finding: item, hash: item.path ? last!.hashes.get(item.path) : undefined } : null;
}

export function lastFindings(site: SiteService): Finding[] {
  return [...(stateFor(site).last?.findings.values() ?? [])];
}

export function catalogueEntry(code: string) {
  return spec(code as CheckCode);
}
