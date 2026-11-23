/**
 * Redirects, answered from memory for `dev:mock`: a short list with one
 * chain and one live page in it, a host to choose, an "Add many" review
 * that reads simple two-column lines (the real parser lives in the engine,
 * which this file must not load), "try an address", and a pretend
 * Cloudflare that plans and applies as a job.
 */
import { randomUUID } from "node:crypto";
// Only the dependency-free host data (and types): this file is loaded by Node directly, not bundled.
import { CLOUDFLARE_BULK_PERMISSIONS, HOST_INFO } from "@galley/core/redirects-info";
import type { CloudflarePlan, ImportProblem, ImportReview, Redirect, RedirectHostId, RedirectIssue, RedirectsOverview } from "@galley/core/redirects-info";
import type { Job, ServerEvent } from "@galley/core/types";
import type { Handlers } from "./backend.ts";
import { MockError } from "./site.ts";

type RedirectsKey =
  | "GET /api/sites/:siteId/redirects"
  | "PUT /api/sites/:siteId/redirects"
  | "POST /api/sites/:siteId/redirects/review"
  | "POST /api/sites/:siteId/redirects/import"
  | "POST /api/sites/:siteId/redirects/try"
  | "PUT /api/sites/:siteId/redirects/settings"
  | "POST /api/sites/:siteId/redirects/derived/replace"
  | "POST /api/sites/:siteId/redirects/leftover/remove"
  | "GET /api/sites/:siteId/redirects/export"
  | "GET /api/sites/:siteId/redirects/health"
  | "POST /api/sites/:siteId/redirects/cloudflare/plan"
  | "POST /api/sites/:siteId/redirects/cloudflare/apply"
  | "POST /api/sites/:siteId/redirects/cloudflare/check"
  | "POST /api/sites/:siteId/redirects/cloudflare/remove";

const PAGES: Record<string, string> = { "/": "Home", "/about/": "About", "/services/": "Services", "/contact/": "Contact", "/blog/": "Journal", "/blog/measured-survey/": "A measured survey" };
const SEED: Redirect[] = [
  { from: "/2019/05/survey-notes/", to: "/blog/measured-survey/", status: 301, source: "import:wordpress" },
  { from: "/about-us/", to: "/team/", status: 301, note: "Old team page" },
  { from: "/team/", to: "/about/", status: 301 },
  { from: "/services/", to: "/contact/", status: 302 },
  { from: "/news/*", to: "/blog/:splat", status: 301, source: "import:wordpress" },
];

interface State {
  list: Redirect[];
  host: RedirectHostId | null;
  version: number;
  applied: { at: string; items: number; hostnames: string[] } | null;
  appliedVersion: number;
  jobId: string | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function issuesOf(list: Redirect[]): RedirectIssue[] {
  const out: RedirectIssue[] = [];
  const index = new Map(list.map((redirect, at) => [redirect.from, at]));

  list.forEach((redirect, at) => {
    const next = index.get(redirect.to);

    if (next !== undefined && list[next]!.to === redirect.from) out.push({ code: "loop", severity: "error", indices: [at, next], message: `${redirect.from} → ${redirect.to} → ${redirect.from} goes round in a circle. Visitors would never arrive anywhere.` });
    else if (next !== undefined) out.push({ code: "chain", severity: "warning", indices: [at, next], suggestion: list[next]!.to, message: `${redirect.from} → ${redirect.to} → ${list[next]!.to} takes 2 steps. Pointing it straight at ${list[next]!.to} is faster and keeps search rankings.` });
    if (PAGES[redirect.from]) out.push({ code: "live-page", severity: "warning", indices: [at], detail: PAGES[redirect.from], message: `${redirect.from} is the live page “${PAGES[redirect.from]}”. Visitors would never see it again.` });
    if (redirect.to.startsWith("/") && !redirect.to.includes(":splat") && !PAGES[redirect.to] && next === undefined) out.push({ code: "broken-target", severity: "warning", indices: [at], message: `Nothing on this site is at ${redirect.to}, so visitors would land on a missing page.` });
  });
  return out;
}

export function createMockRedirects(emit: (event: ServerEvent) => void, upsertJob: (job: Job) => void) {
  const states = new Map<string, State>();
  const state = (siteId: string): State => {
    if (!states.has(siteId)) states.set(siteId, { list: [...SEED], host: null, version: 1, applied: null, appliedVersion: 0, jobId: null });
    return states.get(siteId)!;
  };

  function overview(siteId: string): RedirectsOverview {
    const current = state(siteId);
    const info = current.host ? HOST_INFO[current.host] : null;
    const exact = current.list.filter((redirect) => !redirect.from.endsWith("*")).length;

    return {
      file: "src/data/redirects.json",
      exists: true,
      hash: `mock-${current.version}`,
      redirects: current.list,
      issues: issuesOf(current.list),
      host: { id: current.host, from: current.host ? "config" : null, ...(current.host ? {} : { suggestion: { id: "netlify" as const, reason: "This site has a netlify.toml file, so it looks like it's on Netlify." } }) },
      hostInfo: info ? { ...info, file: current.host === "vercel" ? "vercel.json" : current.host === "other" ? null : "public/_redirects" } : null,
      usage: current.host ? { static: exact, dynamic: current.list.length - exact, total: current.list.length, leftOut: [], over: false } : null,
      derived: current.host && current.host !== "other" ? { path: current.host === "vercel" ? "vercel.json" : "public/_redirects", state: "in-step" } : null,
      leftovers: [],
      imports: [{ path: "wordpress-import/redirects.mjs", label: "The WordPress import's redirects", count: 2 }],
      cloudflare:
        current.host === "cloudflare"
          ? {
              relevant: true,
              keyConfigured: true,
              account: "4f1c0a9e2b7d4c18a3e5f60718293a4b",
              accountFrom: "config",
              hostnames: ["www.lowfield.example"],
              recommended: false,
              reason: "The file that travels with the site already covers this list. Setting them on Cloudflare as well makes them work at your domain even before a page is published, and for any site on it.",
              permissions: CLOUDFLARE_BULK_PERMISSIONS,
              last: current.applied ? { account: "4f1c0a9e2b7d4c18a3e5f60718293a4b", hostnames: current.applied.hostnames, listId: "list", listName: "galley_redirects_mock", rulesetId: "rs", ruleId: "rule", items: current.applied.items, itemsHash: "x", appliedAt: current.applied.at, who: "You" } : null,
              outOfDate: Boolean(current.applied && current.appliedVersion !== current.version),
              jobId: current.jobId,
            }
          : null,
      siteHosts: ["www.lowfield.example"],
      trailingSlash: "always",
    };
  }

  function changed(siteId: string) {
    state(siteId).version += 1;
    emit({ type: "changes.updated", siteId, paths: ["src/data/redirects.json", "public/_redirects"], origin: "user" });
  }

  function review(siteId: string, body: { text?: string; path?: string; mode?: "add" | "replace" }): { review: ImportReview; result: Redirect[] } {
    const text = body.path ? '"/2019/05/survey-notes/": "/blog/measured-survey/"\n"/sample-page/": "/about/"' : (body.text ?? "");
    const lines = text.split("\n");
    const parsed: Array<Redirect & { line: number }> = [];
    const rejected: ImportReview["rejected"] = [];

    lines.forEach((raw, at) => {
      const line = raw.trim().replace(/^"|"$/g, "");

      if (!line || line.startsWith("#")) return;
      const [from, to, code] = line.split(/"?\s*[\s,;:\t]\s*"?|\s+/).filter(Boolean);

      if (!from?.startsWith("/") || !to || !(to.startsWith("/") || to.startsWith("http"))) rejected.push({ line: at + 1, text: raw, kind: "malformed", reason: "Two addresses — the old one and the new one — weren't found on this line." });
      else parsed.push({ from, to, status: code === "302" ? 302 : 301, source: body.path ? "import:wordpress" : "import:list", line: at + 1 });
    });
    const existing = body.mode === "replace" ? [] : state(siteId).list;
    const seen = new Set(existing.map((redirect) => redirect.from));
    const fresh = parsed.filter((redirect) => !seen.has(redirect.from) && (seen.add(redirect.from), true));
    const duplicates = parsed.length - fresh.length;
    const problems: ImportProblem[] = [];

    if (duplicates) problems.push({ code: "duplicate", severity: "info", count: duplicates, title: `${duplicates} duplicates`, body: "The same old address appears more than once. Only one is kept.", resolution: { key: "duplicates", value: "keep-first", options: [{ value: "keep-first", label: "Keep the first" }] }, examples: [] });
    if (rejected.length) problems.push({ code: "malformed", severity: "warning", count: rejected.length, title: `${rejected.length} lines not understood`, body: "These lines weren't read as redirects and won't be added. Each says why.", examples: rejected.slice(0, 20).map((line) => ({ from: line.text, line: line.line, detail: line.reason })) });
    const result = [...existing, ...fresh.map(({ line: _line, ...redirect }) => redirect)];

    return {
      result,
      review: {
        format: body.path ? "wordpress" : "columns",
        formatLabel: body.path ? "The WordPress import's redirects" : "A list of old and new addresses",
        understood: parsed.length,
        rejected,
        ignored: 0,
        unknownHosts: [],
        preview: fresh.map((redirect) => ({ ...redirect, state: "new" as const })),
        counts: { add: fresh.length, change: 0, same: duplicates, leftOut: rejected.length, total: result.length },
        problems,
        resolutions: { duplicates: "keep-first", conflicts: "keep-first", chains: "flatten", livePages: "leave-out", missingStatus: 301, brokenTargets: "keep", loops: "refuse" },
        blocking: 0,
        mode: body.mode ?? "add",
      },
    };
  }

  function plan(siteId: string): CloudflarePlan {
    const current = state(siteId);
    const total = current.list.length;
    const before = current.applied?.items ?? 0;

    return {
      id: `plan-${current.version}`,
      account: "4f1c0a9e2b7d4c18a3e5f60718293a4b",
      hostnames: ["www.lowfield.example"],
      listName: "galley_redirects_mock",
      list: current.applied ? (current.appliedVersion === current.version ? "none" : "update") : "create",
      rule: current.applied ? "none" : "create",
      add: Math.max(0, total - before),
      change: current.applied && current.appliedVersion !== current.version ? 1 : 0,
      remove: 0,
      unchanged: current.applied ? Math.min(before, total) : 0,
      total,
      examples: {
        add: current.list.slice(0, 5).map((redirect) => ({ source_url: `www.lowfield.example${redirect.from.replace(/\*$/, "")}`, target_url: `https://www.lowfield.example${redirect.to.replace(/:splat$/, "")}`, status_code: redirect.status, preserve_query_string: true, include_subdomains: false, subpath_matching: redirect.from.endsWith("*"), preserve_path_suffix: redirect.to.endsWith(":splat") })),
        change: [],
        remove: [],
      },
      skipped: [],
      notes: ["These apply once visitors reach the site through its own domain in this Cloudflare account, with its traffic proxied by Cloudflare (the orange cloud). They don't apply on workers.dev addresses."],
    };
  }

  const handlers: Pick<Handlers, RedirectsKey> = {
    "GET /api/sites/:siteId/redirects": ({ params }) => overview(params.siteId),
    "PUT /api/sites/:siteId/redirects": ({ params, body }) => {
      const current = state(params.siteId);

      if (body.baseHash !== undefined && body.baseHash !== `mock-${current.version}`) throw new MockError("conflict", "The redirects changed while you were working. Look at the list again, then repeat your change. Nothing was changed.");
      current.list = body.redirects;
      changed(params.siteId);
      return overview(params.siteId);
    },
    "POST /api/sites/:siteId/redirects/review": async ({ params, body }) => {
      await sleep(150);
      return review(params.siteId, body).review;
    },
    "POST /api/sites/:siteId/redirects/import": ({ params, body }) => {
      const outcome = review(params.siteId, body);

      state(params.siteId).list = outcome.result;
      changed(params.siteId);
      return { overview: overview(params.siteId), review: outcome.review };
    },
    "POST /api/sites/:siteId/redirects/try": ({ params, body }) => {
      const list = state(params.siteId).list;
      const path = body.address.replace(/^https?:\/\/[^/]+/, "") || "/";
      const hops: Array<{ from: string; to: string; status: Redirect["status"]; index: number; rule: string }> = [];
      let current = path;

      for (let step = 0; step < 5; step += 1) {
        const index = list.findIndex((redirect) => redirect.from === current || (redirect.from.endsWith("*") && current.startsWith(redirect.from.slice(0, -1))));

        if (index === -1) break;
        const redirect = list[index]!;
        const to = redirect.to.replace(":splat", redirect.from.endsWith("*") ? current.slice(redirect.from.length - 1) : "");

        hops.push({ from: current, to, status: redirect.status, index, rule: redirect.from });
        current = to;
      }
      const title = PAGES[current];

      return { input: body.address, path, hops, final: current, finalKind: current.startsWith("http") ? "external" : title ? "page" : hops.length ? "missing" : "unchanged", loop: false, ...(title ? { finalTitle: title } : {}) };
    },
    "PUT /api/sites/:siteId/redirects/settings": ({ params, body }) => {
      if (body.host !== undefined) state(params.siteId).host = body.host;
      emit({ type: "site.updated", siteId: params.siteId });
      return overview(params.siteId);
    },
    "POST /api/sites/:siteId/redirects/derived/replace": ({ params }) => overview(params.siteId),
    "POST /api/sites/:siteId/redirects/leftover/remove": ({ params }) => overview(params.siteId),
    "GET /api/sites/:siteId/redirects/export": ({ params }) => ({
      kind: "bytes",
      type: "text/csv; charset=utf-8",
      body: Buffer.from(`from,to,status,note,source\n${state(params.siteId).list.map((redirect) => `${redirect.from},${redirect.to},${redirect.status},${redirect.note ?? ""},${redirect.source ?? ""}`).join("\n")}\n`),
    }),
    "GET /api/sites/:siteId/redirects/health": ({ params }) => ({
      brokenTargets: issuesOf(state(params.siteId).list)
        .filter((issue) => issue.code === "broken-target")
        .map((issue) => ({ index: issue.indices[0]!, from: state(params.siteId).list[issue.indices[0]!]!.from, to: state(params.siteId).list[issue.indices[0]!]!.to })),
      linkedOldAddresses: [{ from: "/about-us/", to: "/team/", pages: [{ path: "src/content/pages/index.md", title: "Home", url: "/" }] }],
    }),
    "POST /api/sites/:siteId/redirects/cloudflare/plan": async ({ params }) => {
      await sleep(400);
      return plan(params.siteId);
    },
    "POST /api/sites/:siteId/redirects/cloudflare/apply": ({ params, body }) => {
      const current = state(params.siteId);

      if (body.planId !== `plan-${current.version}`) throw new MockError("conflict", "Something changed since the plan was made. Look at the new plan and apply again. Nothing was changed.");
      const job: Job = { id: randomUUID(), kind: "redirects", label: "Setting the redirects on Cloudflare", state: "running", progress: 0.05, detail: "Checking Cloudflare…", siteId: params.siteId, startedAt: Date.now() };
      const steps: Array<[string, number]> = [
        ["Creating the redirect list…", 0.1],
        [`Sending ${current.list.length} redirects…`, 0.25],
        ["Cloudflare is updating the list…", 0.6],
        ["Turning the redirects on…", 0.85],
      ];

      current.jobId = job.id;
      upsertJob(job);
      emit({ type: "job", job });
      void (async () => {
        for (const [detail, progress] of steps) {
          await sleep(700);
          const next = { ...job, detail, progress };

          upsertJob(next);
          emit({ type: "job", job: next });
        }
        await sleep(600);
        current.applied = { at: new Date().toISOString(), items: current.list.length, hostnames: ["www.lowfield.example"] };
        current.appliedVersion = current.version;
        const done: Job = { ...job, state: "done", progress: 1, finishedAt: Date.now(), detail: `Cloudflare now has ${current.list.length} redirects for www.lowfield.example.` };

        upsertJob(done);
        emit({ type: "job", job: done });
      })();
      return job;
    },
    "POST /api/sites/:siteId/redirects/cloudflare/check": async ({ params }) => {
      await sleep(300);
      const current = state(params.siteId);
      const matches = Boolean(current.applied && current.appliedVersion === current.version);

      return { matches, differences: matches ? [] : ["1 redirect is missing on Cloudflare."], checkedAt: new Date().toISOString(), plan: plan(params.siteId) };
    },
    "POST /api/sites/:siteId/redirects/cloudflare/remove": ({ params }) => {
      state(params.siteId).applied = null;
      return overview(params.siteId);
    },
  };

  return { handlers };
}
