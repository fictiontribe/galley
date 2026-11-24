/**
 * Search & AI visibility in the mock. A few of the engine's content checks
 * are repeated here over the mock site's entries (the mock can import engine
 * types only); what would need a rendered page — structured data, the
 * agent-readable version — is a fixed sample, labelled as coming from the
 * preview. Fixes edit the in-memory site like any other change; "Write it
 * for me" fills fields with the page's own first sentence, the way the real
 * batch only ever uses what the page says.
 */
import type { RouteResponse } from "@galley/core/api";
import type { AgentView, CrawlerChoice, CrawlerReport, CrawlerStatus, Finding, FindingGroup, SeverityCounts, SiteAudit, WriteBatchStatus, WriteItemResult, WriteKind } from "@galley/core/seo/types";
import type { Entry, Job, SiteModel } from "@galley/core/types";
import type { Handlers, MockBackend } from "./backend.ts";
import { MockError } from "./site.ts";

// The mock runs under Node's own type stripping, which can't load the engine's
// modules, so it carries a small copy of the catalogue for the checks it shows.
const CHECKED = "2026-11-23";
const GOOGLE_TITLES = { label: "Google Search Central — title links", url: "https://developers.google.com/search/docs/appearance/title-link", checked: CHECKED };
const GOOGLE_SNIPPETS = { label: "Google Search Central — snippets and meta descriptions", url: "https://developers.google.com/search/docs/appearance/snippet", checked: CHECKED };
const GOOGLE_IMAGES = { label: "Google Search Central — image SEO", url: "https://developers.google.com/search/docs/appearance/google-images", checked: CHECKED };
const GOOGLE_CANONICAL = { label: "Google Search Central — consolidating duplicate URLs", url: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls", checked: CHECKED };
const GOOGLE_ARTICLE = { label: "Google Search Central — Article structured data", url: "https://developers.google.com/search/docs/appearance/structured-data/article", checked: CHECKED };
const GOOGLE_SITE = { label: "Google Search Central — site names (WebSite structured data)", url: "https://developers.google.com/search/docs/appearance/site-names", checked: CHECKED };
const LLMS = { label: "llms.txt proposal (Jeremy Howard, v2)", url: "https://llmstxt.org/", checked: CHECKED };
const OPENAI = { label: "OpenAI — overview of OpenAI crawlers", url: "https://developers.openai.com/api/docs/bots", checked: CHECKED };
const ANTHROPIC = { label: "Anthropic — how site owners can block Anthropic's crawlers", url: "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler", checked: CHECKED };
const PERPLEXITY = { label: "Perplexity — Perplexity crawlers", url: "https://docs.perplexity.ai/guides/bots", checked: CHECKED };
const GROUP_ORDER: FindingGroup[] = ["titles", "content", "images", "links", "indexing", "structured", "ai"];

type Base = Pick<Finding, "code" | "group" | "severity" | "kind" | "title" | "why"> & { source?: Finding["source"] };

const CHECKS: Record<string, Base> = {
  "description-missing": { code: "description-missing", group: "titles", severity: "should", kind: "documented", title: "No description shown in results", why: "Google uses a page's description for the snippet when it describes the page better than the page's own text; each page should have its own.", source: GOOGLE_SNIPPETS },
  "title-duplicate": { code: "title-duplicate", group: "titles", severity: "should", kind: "documented", title: "Same title as other pages", why: "Google asks for a distinct title on each page: identical titles make pages hard to tell apart in results.", source: GOOGLE_TITLES },
  "title-long": { code: "title-long", group: "titles", severity: "idea", kind: "documented", title: "Title likely cut short in results", why: "Google sets no length limit but cuts titles to fit the screen, so the end of a long title may not be seen.", source: GOOGLE_TITLES },
  "image-alt-missing": { code: "image-alt-missing", group: "images", severity: "should", kind: "documented", title: "Image has no alt text", why: "Alt text is how screen readers, Google Images and AI systems learn what an image shows. Leave it empty only for purely decorative images.", source: GOOGLE_IMAGES },
  "canonical-missing": { code: "canonical-missing", group: "indexing", severity: "idea", kind: "documented", title: "No preferred address declared", why: "Google recommends each page name its own preferred address, so copies of the page add up to one address.", source: GOOGLE_CANONICAL },
  "jsonld-suggest-article": { code: "jsonld-suggest-article", group: "structured", severity: "idea", kind: "documented", title: "Posts could describe their author and date", why: "Google reads article details (headline, author, dates) to understand a post; none of it is required, all of it is recommended.", source: GOOGLE_ARTICLE },
  "jsonld-suggest-site": { code: "jsonld-suggest-site", group: "structured", severity: "idea", kind: "documented", title: "Home page doesn't name the site and organisation", why: "Google reads the site's name from structured data on the home page, and the organisation's logo and details from it too.", source: GOOGLE_SITE },
  "agent-readable-missing": { code: "agent-readable-missing", group: "ai", severity: "idea", kind: "judgement", title: "No agent-readable version", why: "An llms.txt file and markdown copies of pages make the site easy for AI agents to read. Google says its search doesn't use them; evidence that other AI systems read them is thin.", source: LLMS },
  "ai-search-blocked": { code: "ai-search-blocked", group: "ai", severity: "idea", kind: "documented", title: "An AI assistant's search crawler is blocked", why: "Its provider says blocked sites aren't shown in that assistant's search answers. This is the owner's choice; it's listed so the choice is a deliberate one." },
  "ai-intro-unclear": { code: "ai-intro-unclear", group: "ai", severity: "idea", kind: "judgement", title: "The first screen doesn't say who this is", why: "People and AI assistants that read only the opening may not learn whose site this is. Plausible, not proven." },
};

function finding(code: string, input: Partial<Finding> & { key?: string }): Finding {
  const base = CHECKS[code]!;
  const { key, ...rest } = input;

  return { ...base, id: `${code}:${input.path ?? input.url ?? "site"}${key ? `:${key}` : ""}`, scope: input.path || input.url ? "page" : "site", evidence: {}, rendered: false, ...rest };
}

const CRAWLERS: Array<Omit<CrawlerStatus, "allowed" | "decidedBy">> = [
  { token: "OAI-SearchBot", vendor: "OpenAI", label: "ChatGPT's search crawler", purpose: "search", crawls: true, what: "Finds pages to show and link in ChatGPT's search answers.", ifBlocked: "OpenAI says the site isn't shown in ChatGPT search answers (it may still appear as a plain link).", source: OPENAI },
  { token: "GPTBot", vendor: "OpenAI", label: "OpenAI's training crawler", purpose: "training", crawls: true, what: "Collects pages that may be used to train OpenAI's models.", ifBlocked: "OpenAI says the site's content shouldn't be used to train its models.", source: OPENAI },
  { token: "Claude-SearchBot", vendor: "Anthropic", label: "Claude's search crawler", purpose: "search", crawls: true, what: "Reads pages to improve the search results Claude gives.", ifBlocked: "Anthropic says the site isn't indexed for Claude's search, which may reduce its visibility there.", source: ANTHROPIC },
  { token: "ClaudeBot", vendor: "Anthropic", label: "Anthropic's training crawler", purpose: "training", crawls: true, what: "Collects pages that may be used to train Anthropic's models.", ifBlocked: "Anthropic says the site's future pages are left out of its training data.", source: ANTHROPIC },
  { token: "PerplexityBot", vendor: "Perplexity", label: "Perplexity's search crawler", purpose: "search", crawls: true, what: "Finds pages to show and link in Perplexity's answers. Perplexity says it isn't used to train models.", ifBlocked: "The site isn't surfaced in Perplexity's search results.", source: PERPLEXITY },
  { token: "Perplexity-User", vendor: "Perplexity", label: "Perplexity fetching a page for someone", purpose: "user", crawls: true, what: "Visits a page when a person asks Perplexity something that needs it.", ifBlocked: "Usually nothing: Perplexity says this fetcher generally ignores robots.txt.", caveat: "Perplexity says it generally ignores robots.txt, because a person started the visit.", source: PERPLEXITY },
];

function crawlerReport(blocked: Set<string>): CrawlerReport {
  const crawlers: CrawlerStatus[] = CRAWLERS.map((c) => ({ ...c, allowed: !blocked.has(c.token), decidedBy: blocked.has(c.token) ? "rule" : "wildcard" }));
  const vendors = [...new Set(crawlers.map((c) => c.vendor))];

  return {
    where: { kind: "kit", path: "src/data/visibility.json" },
    readable: true,
    readFrom: "kit",
    policy: blocked.size ? `Blocks AI training (${[...blocked].join(", ")}).` : "No AI crawler is named, so every crawler follows the site-wide rules.",
    blocksEverything: false,
    crawlers,
    summary: vendors.map((vendor) => `${vendor}: ${crawlers.filter((c) => c.vendor === vendor).map((c) => `${c.label} is ${c.allowed ? "allowed" : "blocked"}`).join("; ")}.`),
    editable: true,
    sitemaps: [],
  };
}

function addressFor(model: SiteModel, url: string | null): string {
  return ["your-site", ...(url ?? "/").split("/").filter(Boolean)].join(" › ");
}

type VisibilityKey = Extract<keyof Handlers, `${string} /api/sites/:siteId/visibility${string}`>;


function counts(list: Finding[]): SeverityCounts {
  return { must: list.filter((f) => f.severity === "must").length, should: list.filter((f) => f.severity === "should").length, idea: list.filter((f) => f.severity === "idea").length };
}

export function createMockVisibility(mock: MockBackend) {
  const robots = new Map<string, Set<string>>();
  const undo = new Map<string, Array<{ path: string; raw: Buffer | null }>>();
  const batches = new Map<string, WriteBatchStatus>();
  const last = new Map<string, Map<string, Finding>>();

  const entries = (siteId: string): Entry[] => {
    const site = mock.site(siteId);

    return site
      .model()
      .collections.flatMap((collection) => site.listEntries(collection.id).items.map((item) => item.path))
      .map((path) => site.readEntry(path));
  };
  const crawlers = (siteId: string): CrawlerReport => crawlerReport(robots.get(siteId) ?? new Set(["GPTBot"]));
  /** A few of the engine's content checks, done the same way over the mock's entries. */
  const contentFindings = (all: Entry[]): Finding[] => {
    const out: Finding[] = [];
    const pages = all.filter((entry) => entry.url && entry.data.noindex !== true && !entry.path.endsWith("404.md"));
    const byTitle = new Map<string, Entry[]>();

    for (const entry of pages) {
      const ref = { path: entry.path, url: entry.url, pageTitle: entry.title };

      if (entry.data.description === "" ) out.push(finding("description-missing", { ...ref, field: ["description"], fieldLabel: "Description", write: "description", evidence: { note: "The description field is empty, so results show text Google picks from the page." } }));
      if (entry.title.length > 64) out.push(finding("title-long", { ...ref, field: ["title"], write: "title", evidence: { value: entry.title, measure: { label: "Estimated width in a desktop result", value: Math.round(entry.title.length * 9.4), limit: 600, unit: "px", reasoning: "Measured at 20 px Arial against a 600 px line, a common observation of desktop results. Google publishes no limit: it cuts titles to fit the screen." } } }));
      byTitle.set(entry.title.toLowerCase(), [...(byTitle.get(entry.title.toLowerCase()) ?? []), entry]);
      const sections = Array.isArray(entry.data.sections) ? entry.data.sections : [];

      sections.forEach((section, index) => {
        if (section && typeof section === "object" && !Array.isArray(section) && typeof section.image === "string" && section.imageAlt === "") {
          out.push(finding("image-alt-missing", { ...ref, key: `sections.${index}.image:${section.image}`, field: ["sections", index, "imageAlt"], write: "alt", evidence: { value: section.image, note: "Leave it empty only if the image is purely decorative." } }));
        }
      });
    }
    for (const group of byTitle.values()) {
      if (group.length < 2) continue;
      for (const entry of group) out.push(finding("title-duplicate", { path: entry.path, url: entry.url, pageTitle: entry.title, field: ["title"], write: "title", evidence: { value: entry.title, pages: group.filter((other) => other !== entry).map((other) => ({ path: other.path, url: other.url, title: other.title })) } }));
    }
    return out;
  };
  const audit = (siteId: string): SiteAudit => {
    const site = mock.site(siteId);
    const model = site.model();
    // The mock site uses the kit, which publishes structured data and the agent-readable version: nothing to add here.
    const sample: Finding[] = [];
    const report = crawlers(siteId);
    const blocked = report.crawlers.filter((c) => c.purpose === "search" && !c.allowed).map((c) => ({ ...finding("ai-search-blocked", { key: c.token, title: `${c.label} is blocked`, evidence: { value: c.token, note: c.ifBlocked } }), source: c.source }));
    const order = { must: 0, should: 1, idea: 2 };
    const findings = [...contentFindings(entries(siteId)), ...sample, ...blocked].sort((a, b) => order[a.severity] - order[b.severity]);
    const byGroup = Object.fromEntries(GROUP_ORDER.map((group) => [group, counts(findings.filter((f) => f.group === group))])) as Record<FindingGroup, SeverityCounts>;
    const total = counts(findings);

    last.set(siteId, new Map(findings.map((f) => [f.id, f])));
    return {
      generatedAt: new Date().toISOString(),
      durationMs: 180,
      pages: { checked: entries(siteId).length, reused: 0 },
      rendering: { source: "preview", detail: "Rendered checks used the running preview (your unpublished changes included).", sampled: 12, total: 12, cap: 60 },
      counts: total,
      byGroup,
      summary: `Checked ${entries(siteId).length} entries in the content and 12 rendered pages. ${[total.must ? `${total.must} must fix` : null, total.should ? `${total.should} should fix` : null, total.idea ? `${total.idea} ideas` : null].filter(Boolean).join(", ")}.`,
      findings,
      skipped: [{ code: "link-external-dead", reason: "Off unless asked for: it makes requests to other sites." }],
      crawlers: report,
      agentReadable: {
        llmsTxt: { present: true, url: "/llms.txt", valid: true, links: 12 },
        markdownTwins: { checked: 12, advertised: 12, reachable: 10 },
        known: true,
        agentPage: true,
        fullText: true,
        kit: { file: "src/data/visibility.json", llmsTxt: true, llmsFullTxt: true, markdownTwins: true, agentPage: true },
        summary: "The site kit publishes a markdown version of each page, llms.txt, llms-full.txt and agent.md, set in src/data/visibility.json. Served: llms.txt, llms-full.txt and agent.md; 12 of 12 pages checked have a markdown version.",
      },
      checks: Object.values(CHECKS).map((check) => ({ ...check, needsRender: false })),
    };
  };
  const firstSentence = (entry: Entry) => {
    const text = JSON.stringify(entry.data).replace(/[{}[\]"]/g, " ") + (entry.body ?? "");
    const sentence = /[A-Z][^.!?]{40,150}[.!?]/.exec(text.replace(/\s+/g, " "))?.[0];

    return sentence ?? null;
  };

  const handlers: Pick<Handlers, VisibilityKey> = {
    "GET /api/sites/:siteId/visibility": ({ params }) => audit(params.siteId),
    "GET /api/sites/:siteId/visibility/entry": ({ params, query }) => {
      const site = mock.site(params.siteId);
      const path = query.path ?? "";
      const entry = site.readEntry(path);
      const all = audit(params.siteId);
      const mine = all.findings.filter((f) => f.path === path);
      const model = site.model();
      const collection = model.collections.find((c) => c.id === entry.collection)!;
      const title = typeof entry.data.title === "string" ? entry.data.title : entry.title;
      const description = typeof entry.data.description === "string" ? entry.data.description : "";
      const preview = { title, titleFrom: "content" as const, shownTitle: title, titleWidth: Math.round(title.length * 9.4), titleLimit: 600, address: addressFor(model, entry.url), description, descriptionFrom: description ? ("content" as const) : ("none" as const), shownDescription: description, titleField: ["title"], ...(collection.fields.some((f) => f.key === "description") ? { descriptionField: ["description"] } : {}) };
      const response: RouteResponse<"GET /api/sites/:siteId/visibility/entry"> = { path, url: entry.url, title: entry.title, findings: mine, preview, structuredData: [], rendering: all.rendering, counts: counts(mine) };

      return response;
    },
    "POST /api/sites/:siteId/visibility/fix": ({ params, body }) => {
      const site = mock.site(params.siteId);
      const known = last.get(params.siteId) ?? new Map(audit(params.siteId).findings.map((f) => [f.id, f]));
      const before: Array<{ path: string; raw: Buffer | null }> = [];
      const applied: Array<{ id: string; path: string }> = [];
      const refused: Array<{ id: string; reason: string }> = [];

      for (const id of body.ids) {
        const fix = known.get(id)?.fix;

        if (!fix) {
          refused.push({ id, reason: "This one needs a person (or the assistant) to decide what to write." });
          continue;
        }
        for (const edit of fix.edits) {
          if (!before.some((b) => b.path === edit.path)) before.push({ path: edit.path, raw: site.read(edit.path) });
          site.updateEntry(edit.path, edit.ops);
        }
        applied.push({ id, path: fix.edits[0]!.path });
      }
      if (applied.length) mock.changed(site.id, applied.map((a) => a.path), "user");
      const undoId = applied.length ? `undo-${Date.now()}` : null;

      if (undoId) undo.set(undoId, before);
      return { applied, refused, undoId };
    },
    "POST /api/sites/:siteId/visibility/undo": ({ params, body }) => {
      const site = mock.site(params.siteId);
      const held = undo.get(body.undoId);

      if (!held) throw new MockError("not-found", "Those fixes can't be undone from here any more. You can still discard them in Proof.");
      for (const item of held) site.write(item.path, item.raw);
      undo.delete(body.undoId);
      mock.changed(site.id, held.map((h) => h.path), "undo");
      return { restored: held.map((h) => h.path), left: [] };
    },
    "GET /api/sites/:siteId/visibility/crawlers": ({ params }) => crawlers(params.siteId),
    "PUT /api/sites/:siteId/visibility/crawlers": ({ params, body }) => {
      const blocked = new Set(robots.get(params.siteId) ?? ["GPTBot"]);

      for (const [token, choice] of Object.entries(body.choices as Record<string, CrawlerChoice>)) {
        if (choice === "block") blocked.add(token);
        else blocked.delete(token);
      }
      robots.set(params.siteId, blocked);
      return crawlers(params.siteId);
    },
    "GET /api/sites/:siteId/visibility/agent-view": ({ params, query }) => {
      const site = mock.site(params.siteId);
      const summary = site.entryForUrl(query.url ?? "/");
      const entry = summary ? site.readEntry(summary.path) : null;
      const text = entry ? `${entry.title}\n\n${JSON.stringify(entry.data, null, 1).replace(/[{}[\]",]/g, "").replace(/^\s*\w+:\s*/gm, "").replace(/\n{2,}/g, "\n")}\n${entry.body ?? ""}` : "";
      const view: AgentView = { url: query.url ?? "/", kind: "text", from: "the page's text with scripts off, from the running preview", text: text.slice(0, 4000), truncated: text.length > 4000 };

      return view;
    },
    "POST /api/sites/:siteId/visibility/write/plan": ({ params, body }) => {
      const findings = audit(params.siteId).findings.filter((f) => f.write === body.kind && f.path && (!body.paths || body.paths.includes(f.path)));
      const items = findings.map((f) => ({ path: f.path!, title: f.pageTitle ?? f.path!, url: f.url ?? null, field: f.field ?? [], fieldLabel: f.fieldLabel ?? String(f.field?.[f.field.length - 1] ?? "Text").replace(/^./, (c) => c.toUpperCase()) }));

      return { kind: body.kind, items, requests: items.length, model: "claude-opus-5-5", connected: true, note: "One request per page. The assistant uses only what the page already says; anything it can't write from the page is left as it is and the reason is listed. Everything lands in Proof for review; nothing is published." };
    },
    "POST /api/sites/:siteId/visibility/write": ({ params, body }) => {
      const site = mock.site(params.siteId);
      const plan = handlers["POST /api/sites/:siteId/visibility/write/plan"]({ params, body: { kind: body.kind, ...(body.paths ? { paths: body.paths } : {}) }, query: {}, search: new URLSearchParams() } as never) as RouteResponse<"POST /api/sites/:siteId/visibility/write/plan">;
      const items: WriteItemResult[] = plan.items.slice(0, body.limit ?? plan.items.length).map((item) => ({ ...item, state: "pending" }));
      const job: Job = { id: `visibility-${Date.now()}`, kind: "visibility", label: `${labelFor(body.kind)} · ${items.length} ${items.length === 1 ? "page" : "pages"}`, state: "running", progress: 0, siteId: site.id, startedAt: Date.now(), detail: `0 of ${items.length}` };
      const status: WriteBatchStatus = { job, kind: body.kind, items, requests: items.length };

      batches.set(job.id, status);
      mock.emit({ type: "job", job });
      let index = 0;
      const step = () => {
        const item = items[index];

        if (!item) {
          status.job = { ...status.job, state: "done", progress: 1, finishedAt: Date.now(), detail: `${items.filter((i) => i.state === "written").length} of ${items.length} written. They're waiting in Proof.` };
          mock.emit({ type: "job", job: status.job });
          return;
        }
        const entry = site.readEntry(item.path);
        // A title is the page's own words, shortened at a word; anything else its first sentence.
        const value = body.kind === "title" ? entry.title.split(/\s+/).reduce((out, word) => (`${out} ${word}`.trim().length <= 48 ? `${out} ${word}`.trim() : out), "") : firstSentence(entry);

        if (value && item.field.length) {
          site.updateEntry(item.path, [{ op: "set", path: item.field, value }]);
          mock.changed(site.id, [item.path], "agent");
          item.state = "written";
          item.value = value;
        } else {
          item.state = "skipped";
          item.reason = "The page doesn't say enough to write this from.";
        }
        index += 1;
        status.job = { ...status.job, progress: index / items.length, detail: `${index} of ${items.length}` };
        mock.emit({ type: "job", job: status.job });
        setTimeout(step, 700);
      };
      setTimeout(step, 700);
      return status;
    },
    "GET /api/sites/:siteId/visibility/write/:jobId": ({ params }) => {
      const status = batches.get(params.jobId);

      if (!status) throw new MockError("not-found", "That batch isn't known here.");
      return { ...status, items: status.items.map((item) => ({ ...item })) };
    },
    "POST /api/sites/:siteId/visibility/write/:jobId/cancel": () => ({ ok: true }),
    "POST /api/sites/:siteId/visibility/external-links": () => ({ checked: 0, total: 0, findings: [] }),
  };
  return { handlers };
}

function labelFor(kind: WriteKind): string {
  return { description: "Writing descriptions", alt: "Writing alt text", title: "Proposing clearer titles", intro: "Rewriting the opening", faq: "Drafting questions and answers" }[kind];
}
