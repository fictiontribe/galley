/**
 * Bringing a WordPress site over, as HTTP: upload an export file, take a
 * quick look at a source, plan, run (a cancellable job with plain steps and
 * real counts), the report, and rebuilding page-builder pages with the
 * assistant. The importer (@galley/import-wordpress) does the reading,
 * planning and writing through SiteService, so everything lands as pending
 * changes and nothing is published here.
 *
 * Reading a WordPress address is a request from this server to a host a
 * person typed. In hosted mode every request — the site and every image it
 * names — goes through the forms feature's public-address guard (see the
 * importer's source/guarded.ts); in local mode a WordPress on this computer
 * or the local network is allowed, and the plan says so.
 *
 * An application password arrives in the request that needs it, lives in
 * that request's (or job's) memory, and is dropped when it ends: it is never
 * written, never logged, never in an event, and an error that quoted it is
 * scrubbed before it can be shown.
 */
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { GalleyError } from "@galley/core";
import { costFor, DEFAULT_MODEL } from "@galley/core/ai";
import { isPublicAddress, systemResolver } from "@galley/core/forms";
import { isSiteId } from "@galley/core/site";
import type {
  EventBus,
  ImportInspection,
  ImportPlanView,
  ImportProblem,
  ImportQuestion,
  ImportRebuildPlan,
  ImportRebuildStatus,
  ImportReportView,
  ImportRunStatus,
  ImportSource,
  ImportStep,
  ImportUpload,
  Job,
  JsonValue,
  SiteService,
} from "@galley/core/types";
import {
  createGuardedFetch,
  defaultsFromAnswers,
  ImportError,
  inspectWordPress,
  planContext,
  planImport,
  readWordPress,
  rebuildRequest,
  runImport,
  type ImportPlan,
  type ImportReport,
  type PlanOptions,
  type RebuildBrief,
  type WordPressSite,
  type WordPressSource,
} from "@galley/import-wordpress";
import { invalid, notFound } from "./errors";
import type { RouteContext, RouteTable } from "./routes";
import type { Services } from "./types";
import * as v from "./validate";

type ImportRouteKey =
  | "POST /api/sites/:siteId/import/upload"
  | "POST /api/sites/:siteId/import/inspect"
  | "POST /api/sites/:siteId/import/plan"
  | "POST /api/sites/:siteId/import/run"
  | "GET /api/sites/:siteId/import/runs/:runId"
  | "POST /api/sites/:siteId/import/runs/:runId/cancel"
  | "GET /api/sites/:siteId/import/report"
  | "POST /api/sites/:siteId/import/rebuild"
  | "GET /api/sites/:siteId/import/rebuild-all"
  | "POST /api/sites/:siteId/import/rebuild-all"
  | "GET /api/sites/:siteId/import/rebuild-all/:jobId"
  | "POST /api/sites/:siteId/import/rebuild-all/:jobId/cancel";

/** Export files: 8 MB a chunk (base64 inflates that under the API's 40 MB body limit), 200 MB in all. */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
export const UPLOAD_MAX_BYTES = 200 * 1024 * 1024;
/** A read site is kept this long, so the plan and the run that follows it don't read it twice. */
const READ_TTL_MS = 30 * 60_000;
/** Uploads nobody used are cleared after a day. */
const UPLOAD_TTL_MS = 24 * 60 * 60_000;
const JOB_EMIT_MS = 200;

// ─────────────────────────────────────────────────────────── validation

const sourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("address"),
      address: z.string().trim().min(3, "type the site's address").max(2048),
      user: z.string().trim().min(1).max(200).optional(),
      password: z.string().min(1).max(200).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("file"), uploadId: z.string().regex(/^[a-f0-9-]{36}$/, "it must be an upload id") }).strict(),
]);
const answers = z.record(z.string().min(1).max(200), z.string().max(500)).optional();
export const inspectBody = z.object({ source: sourceSchema }).strict();
export const planBody = z.object({ source: sourceSchema, answers }).strict();
export const uploadChunkBody = z
  .object({
    uploadId: z.string().regex(/^[a-f0-9-]{36}$/).optional(),
    name: z.string().trim().min(1).max(200),
    total: z.number().int().min(1).max(UPLOAD_MAX_BYTES, `export files up to ${UPLOAD_MAX_BYTES / 1024 / 1024} MB can be uploaded`),
    offset: z.number().int().min(0),
    chunk: z.string().min(1).max(Math.ceil((UPLOAD_CHUNK_BYTES * 4) / 3) + 8),
  })
  .strict();
export const rebuildBody = z.object({ path: v.repoPath }).strict();
export const rebuildAllBody = z.object({ paths: z.array(v.repoPath).max(500).optional() }).strict().optional().transform((value) => value ?? {});

// ─────────────────────────────────────────────────────────── the service

interface Upload extends ImportUpload {
  siteId: string;
  file: string;
  received: number;
  total: number;
  done: boolean;
}

interface Read {
  wp: WordPressSite;
  at: number;
  /** Whether the address is on this computer or a private network (local mode only gets this far). */
  privateHost: boolean;
}

interface Run {
  status: ImportRunStatus;
  siteId: string;
  controller: AbortController;
}

interface Stored {
  view: ImportReportView;
  /** The full rebuild briefs: kept on the server, the screen only needs their summary. */
  briefs: RebuildBrief[];
}

interface RebuildRun {
  status: ImportRebuildStatus;
  siteId: string;
  stop: boolean;
  current: { threadId: string } | null;
}

export interface ImportService {
  home: string;
  uploads: Map<string, Upload>;
  reads: Map<string, Read>;
  runs: Map<string, Run>;
  rebuilds: Map<string, RebuildRun>;
  job(id: string): Job | null;
}

export function createImportService(options: { home: string }): ImportService {
  const service: ImportService = {
    home: options.home,
    uploads: new Map(),
    reads: new Map(),
    runs: new Map(),
    rebuilds: new Map(),
    job(id) {
      for (const run of service.runs.values()) if (run.status.job.id === id) return { ...run.status.job };
      return service.rebuilds.get(id)?.status.job ?? null;
    },
  };

  return service;
}

const fallback = new WeakMap<Services, ImportService>();

/** Servers composed without one (tests with fakes) get one on first use, in the default home. */
export function importsOf(services: Services): ImportService {
  if (services.imports) return services.imports;
  let made = fallback.get(services);

  if (!made) {
    made = createImportService({ home: process.env.GALLEY_HOME?.trim() || join(tmpdir(), "galley-import-state") });
    fallback.set(services, made);
  }
  return made;
}

/** `<home>/state/<siteId>/import`: the site's own corner of the app's state folder. Never inside the site. */
function stateDir(service: ImportService, siteId: string): string {
  if (!isSiteId(siteId)) throw notFound("That site isn't in the list.");
  return join(service.home, "state", siteId, "import");
}

async function siteOf(c: Parameters<RouteTable["GET /api/sites/:siteId"]>[0], ctx: RouteContext): Promise<SiteService> {
  const site = await ctx.services.registry.get(c.req.param("siteId") ?? "");

  if (!site) throw notFound("That site isn't open here. Open it again from the Sites screen.");
  return site;
}

// ─────────────────────────────────────────────────────────── secrets

/** An error that might quote the password, with the password cut out. */
function scrub(error: unknown, secret: string | undefined): unknown {
  if (!secret) return error;
  const clean = (text: string | undefined) => text?.split(secret).join("[hidden]");

  if (error instanceof ImportError) return new ImportError(error.reason, clean(error.message)!, clean(error.detail));
  if (error instanceof GalleyError) return new GalleyError(error.code, clean(error.message)!, clean(error.detail));
  return new Error(clean(error instanceof Error ? error.message : String(error)));
}

// ─────────────────────────────────────────────────────────── sources

async function isPrivateHost(address: string): Promise<boolean> {
  try {
    const host = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`).hostname.replace(/^\[|\]$/g, "");
    const resolved = /^[\d.]+$|:/.test(host) ? [{ address: host }] : await systemResolver(host);

    return resolved.some((entry) => !isPublicAddress(entry.address));
  } catch {
    return false;
  }
}

function sourceFor(service: ImportService, siteId: string, source: ImportSource): WordPressSource {
  if (source.kind === "file") {
    const upload = service.uploads.get(source.uploadId);

    if (!upload || upload.siteId !== siteId || !upload.done) throw invalid("That export file isn't here any more. Upload it again.");
    return { file: upload.file };
  }
  if (source.password && !source.user) throw invalid("Add the WordPress user name the application password belongs to.");
  return { url: source.address, ...(source.user && source.password ? { auth: { user: source.user, password: source.password.replace(/\s+/g, " ").trim() } } : {}) };
}

function readKey(siteId: string, source: ImportSource): string {
  return source.kind === "file" ? `${siteId}|file|${source.uploadId}` : `${siteId}|${source.address.trim().toLowerCase()}|${source.user ?? ""}|${source.password ? createHash("sha256").update(source.password).digest("hex").slice(0, 12) : ""}`;
}

function fetchFor(mode: "local" | "hosted"): typeof fetch {
  return createGuardedFetch({ allowPrivate: mode === "local" });
}

const LOCAL_NOTE = "This address is on this computer or your local network. That's fine here because the app runs on this computer; a hosted app would refuse it.";

function problemOf(error: unknown, source: ImportSource): ImportProblem | null {
  if (!(error instanceof ImportError)) return null;
  const detail = error.detail ? { detail: error.detail } : {};

  switch (error.reason) {
    case "blocked":
      return {
        reason: "blocked",
        message: `${error.message.replace(/ \(its REST API.*$/, ".").replace(/ Export a file instead.*$/, "")} Add an application password, or upload an export file instead.`.replace(/\.\./g, "."),
        offer: source.kind === "address" ? ["password", "file"] : ["file"],
        ...detail,
      };
    case "auth":
      return { reason: "auth", message: "WordPress didn't accept that user name and application password. Check both — the password is the one made under Users › Profile › Application passwords.", offer: ["password", "file"], ...detail };
    case "not-wordpress":
      return { reason: "not-wordpress", message: "That address doesn't answer the way a WordPress site does. Check it, or upload an export file if it is WordPress behind a login.", offer: ["address", "file"], ...detail };
    case "refused":
      return { reason: "refused", message: `${error.message} Use the site's public address, or upload an export file.`, offer: ["address", "file"], ...detail };
    case "file":
      return { reason: "file", message: error.message, offer: ["file"], ...detail };
    default:
      return { reason: "unreachable", message: "The site didn't answer. Check the address and that the site is up, then try again.", offer: ["address", "file"], ...detail };
  }
}

async function readSite(service: ImportService, mode: "local" | "hosted", siteId: string, source: ImportSource, signal?: AbortSignal, onProgress?: (label: string) => void): Promise<Read> {
  const key = readKey(siteId, source);
  const cached = service.reads.get(key);

  for (const [other, read] of service.reads) if (Date.now() - read.at > READ_TTL_MS) service.reads.delete(other);
  if (cached && Date.now() - cached.at < READ_TTL_MS) return cached;
  const wpSource = sourceFor(service, siteId, source);
  // Every read here starts fresh in a folder of its own, removed straight after: a signed-in read sees
  // drafts, and the plan must show what the site says now. The read itself is kept in memory for the run.
  const privateCache = "url" in wpSource ? join(tmpdir(), `galley-wp-read-${randomUUID()}`) : null;

  try {
    const wp = await readWordPress(wpSource, {
      ...("url" in wpSource ? { fetch: fetchFor(mode) } : {}),
      ...(privateCache ? { cacheDir: privateCache, fresh: true } : {}),
      ...(signal ? { signal } : {}),
      ...(onProgress ? { onProgress: (event) => onProgress(event.label) } : {}),
    });
    const read: Read = { wp, at: Date.now(), privateHost: source.kind === "address" && mode === "local" && (await isPrivateHost(source.address)) };

    service.reads.set(key, read);
    return read;
  } finally {
    if (privateCache) await rm(privateCache, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────── planning

function optionsFrom(site: SiteService, model: Awaited<ReturnType<SiteService["model"]>>, given: Record<string, string>): PlanOptions {
  const options: PlanOptions = {};
  const defaults: Array<{ collection?: string; field: string; value: JsonValue }> = [];

  for (const [id, value] of Object.entries(given)) {
    if (id === "posts-collection") options.postsCollection = value;
    else if (id === "pages-collection") options.pagesCollection = value;
    else if (id.startsWith("default:")) {
      const target = id.slice("default:".length);
      const dot = target.indexOf(".");

      if (dot > 0) defaults.push({ collection: target.slice(0, dot), field: target.slice(dot + 1), value });
    }
  }
  void site;
  const planDefaults = defaultsFromAnswers(model, defaults);

  if (Object.keys(planDefaults).length) options.defaults = planDefaults;
  return options;
}

/**
 * The plan, with every question answered: by the person where they did,
 * otherwise with its default — so the picture shows what pressing Start
 * would actually do. Answering one question can raise another (choosing the
 * blog reveals who its posts are credited to), so it settles in a few rounds.
 */
async function settledPlan(site: SiteService, wp: WordPressSite, given: Record<string, string>): Promise<{ plan: ImportPlan; questions: ImportQuestion[] }> {
  const model = await site.model();
  const context = await planContext(site, model);
  const chosen = { ...given };
  const asked = new Map<string, ImportQuestion>();
  let plan = planImport(wp, model, { ...optionsFrom(site, model, chosen), context });

  for (let round = 0; round < 4 && plan.questions.length; round += 1) {
    let changed = false;

    for (const question of plan.questions) {
      const answer = chosen[question.id] ?? question.default ?? question.options[0]?.value;

      asked.set(question.id, { id: question.id, question: question.question, options: question.options, ...(question.default ? { default: question.default } : {}), answer: answer ?? "" });
      if (answer !== undefined && chosen[question.id] !== answer) {
        chosen[question.id] = answer;
        changed = true;
      }
    }
    if (!changed) break;
    plan = planImport(wp, model, { ...optionsFrom(site, model, chosen), context });
  }
  for (const [id, question] of asked) asked.set(id, { ...question, answer: chosen[id] ?? question.answer });
  return { plan, questions: [...asked.values()] };
}

const BUILDER_NAMES: Record<string, string> = { elementor: "Elementor", divi: "Divi", wpbakery: "WPBakery", beaver: "Beaver Builder" };

function planView(read: Read, plan: ImportPlan, questions: ImportQuestion[], kind: "address" | "file"): ImportPlanView {
  const { wp } = read;
  const images = new Set(plan.items.flatMap((item) => item.media.filter((ref) => ref.role !== "link").map((ref) => ref.url)));
  const destinations: ImportPlanView["destinations"] = [];

  for (const [which, target] of [["posts", plan.posts], ["pages", plan.pages]] as const) {
    if (!target) continue;
    destinations.push({
      kind: which,
      collection: target.collection,
      label: target.label,
      count: plan.items.filter((item) => item.kind === (which === "posts" ? "post" : "page")).length,
      fields: target.fields.map((field) => ({ label: field.label, from: field.from })),
      unmapped: target.unmapped,
    });
  }
  const builders = new Map<string, string[]>();

  for (const item of plan.items) if (item.builder) builders.set(item.builder, [...(builders.get(item.builder) ?? []), item.title]);
  return {
    source: { title: wp.title, siteUrl: wp.siteUrl, kind },
    siteName: plan.siteName,
    counts: {
      posts: plan.items.filter((item) => item.kind === "post").length,
      pages: plan.items.filter((item) => item.kind === "page").length,
      images: images.size,
      authors: wp.authors.length,
      categories: wp.terms.filter((term) => term.taxonomy === "category" && term.slug !== "uncategorized").length,
      tags: wp.terms.filter((term) => term.taxonomy === "post_tag").length,
    },
    destinations,
    builders: [...builders.entries()].map(([builder, titles]) => ({ name: BUILDER_NAMES[builder] ?? builder, count: titles.length, titles })),
    skipped: plan.skipped.map((item) => ({ title: item.title, kind: item.kind, reason: item.reason })),
    // A feature the site really uses (37 comments) says it more specifically than the general line: one row, its words.
    notComing: plan.notImported.map((entry) => {
      const feature = plan.features.find((candidate) => candidate.title === entry.what);

      return feature ? { what: entry.what, why: feature.advice } : entry;
    }),
    features: plan.features.filter((feature) => !plan.notImported.some((entry) => entry.what === feature.title)).map((feature) => ({ title: feature.title, advice: feature.advice, where: feature.where })),
    questions,
    redirects: plan.redirects.length,
    seo: {
      descriptions: plan.items.filter((item) => item.seo.description === "seo").length,
      titles: plan.items.filter((item) => item.seo.title === "kept").length,
      canonicals: plan.items.filter((item) => item.seo.canonical).length,
    },
    notes: [...wp.notes, ...(read.privateHost ? [LOCAL_NOTE] : [])],
  };
}

// ─────────────────────────────────────────────────────────── jobs

function jobEmitter(events: EventBus, job: Job): { update(patch: Partial<Job>): void; finish(state: "done" | "error", patch?: Partial<Job>): void; get(): Job } {
  let last = 0;
  let timer: NodeJS.Timeout | null = null;
  const emit = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    last = Date.now();
    events.emit({ type: "job", job: { ...job } });
  };

  emit();
  return {
    update(patch) {
      if (job.state !== "running") return;
      Object.assign(job, patch);
      const wait = last + JOB_EMIT_MS - Date.now();

      if (wait <= 0) emit();
      else if (!timer) {
        timer = setTimeout(emit, wait);
        timer.unref?.();
      }
    },
    finish(state, patch = {}) {
      if (job.state !== "running") return;
      Object.assign(job, patch, { state, finishedAt: Date.now() });
      emit();
    },
    get: () => ({ ...job }),
  };
}

const STEP_LABELS: Record<ImportStep["id"], string> = {
  read: "Reading the old site",
  media: "Downloading images",
  posts: "Bringing over posts",
  pages: "Bringing over pages",
  finish: "Writing the report",
};

function stepText(step: ImportStep): string {
  return step.total ? `${step.label} — ${step.done ?? 0} of ${step.total}` : step.label;
}

// ─────────────────────────────────────────────────────────── the report

function reportView(runId: string, plan: ImportPlan, report: ImportReport, kind: "address" | "file"): ImportReportView {
  const pathOf = new Map<string, string>();

  for (const item of report.items) if (item.path && !pathOf.has(item.title)) pathOf.set(item.title, item.path);
  const at = (title: string, note: string) => ({ title, ...(pathOf.get(title) ? { path: pathOf.get(title)! } : {}), note });
  const needsLook: ImportReportView["needsLook"] = [];
  const attention = report.needsAttention;

  for (const feature of attention.features) needsLook.push({ id: `feature:${feature.feature}`, title: feature.title, advice: feature.advice, items: feature.where.map((where) => at(where.replace(/ \(\/.*\)$/, ""), where)) });
  if (attention.shortcodes.length) {
    needsLook.push({
      id: "shortcodes",
      title: "Shortcodes left in the text",
      advice: "They show as text until replaced — a contact form shortcode usually becomes this site's contact section.",
      items: attention.shortcodes.flatMap((shortcode) => shortcode.items.map((title) => at(title, `[${shortcode.name}]`))),
    });
  }
  if (attention.media.length) {
    needsLook.push({ id: "media", title: "Files that didn't come across", advice: "Their place is marked in the text; replace them by hand.", items: attention.media.flatMap((entry) => (entry.items.length ? entry.items : ["(the media library)"]).map((title) => at(title, `${entry.url} — ${entry.reason}`))) });
  }
  if (attention.links.length) {
    needsLook.push({ id: "links", title: "Links to pages that weren't brought over", advice: "They still point at the old site.", items: attention.links.flatMap((entry) => entry.items.map((title) => at(title, entry.url))) });
  }
  // Notes on single items, grouped by what they say: "Description written from the opening paragraph" once, with every post it applies to.
  const grouped = new Map<string, ImportReportView["needsLook"][number]["items"]>();

  for (const note of attention.notes) {
    const key = note.note.replace(/“[^”]*”/g, "“…”").replace(/\d+/g, "#");

    grouped.set(key, [...(grouped.get(key) ?? []), at(note.title, note.note)]);
  }
  for (const [key, items] of [...grouped.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const first = items[0]!.note;

    needsLook.push({ id: `note:${createHash("sha1").update(key).digest("hex").slice(0, 10)}`, title: first.replace(/ — check.*$/, "").replace(/\.$/, ""), items });
  }
  const oldUrl = new Map(plan.items.map((item) => [item.path, item.oldUrl]));
  const counted = (action: string) => report.items.filter((item) => item.action === action);

  return {
    runId,
    finishedAt: Date.now(),
    stopped: Boolean(report.stopped),
    source: { title: report.source.title, siteUrl: report.source.siteUrl, kind },
    arrived: {
      posts: report.counts.posts.created,
      pages: report.counts.pages.created,
      images: report.counts.media.saved,
      updated: report.counts.posts.updated + report.counts.pages.updated,
      unchanged: report.counts.posts.unchanged + report.counts.pages.unchanged,
      embeds: report.counts.embeds,
    },
    entries: [...counted("created"), ...counted("updated"), ...counted("unchanged")]
      .filter((item) => item.path)
      .map((item) => ({ title: item.title, kind: item.kind === "page" ? "page" : "post", path: item.path!, newUrl: item.newUrl, oldUrl: item.oldUrl, action: item.action as "created" | "updated" | "unchanged" })),
    needsLook,
    notImported: report.items.filter((item) => item.action === "skipped" || item.action === "held-back").map((item) => ({ title: item.title, ...(item.path ? { path: item.path } : {}), note: item.reason ?? "It wasn't brought over." })),
    leftBehind: report.notImported,
    rebuilds: report.rebuilds.map((rebuild) => ({
      title: rebuild.title,
      path: rebuild.path,
      url: rebuild.url,
      originalUrl: oldUrl.get(rebuild.path) ?? "",
      builder: BUILDER_NAMES[rebuild.builder] ?? rebuild.builder,
      sections: rebuild.outline.sections.length,
      matched: rebuild.suggestions.filter((suggestion) => suggestion.blockType).length,
    })),
    redirects: { count: report.redirects.length, file: report.files.find((file) => file.endsWith("_redirects")) ?? null, list: report.redirects },
    seo: report.seo,
    files: report.files,
  };
}

async function saveReport(service: ImportService, siteId: string, stored: Stored): Promise<void> {
  const dir = stateDir(service, siteId);

  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, "report.json"), JSON.stringify(stored), { mode: 0o600 });
}

async function loadReport(service: ImportService, siteId: string): Promise<Stored | null> {
  try {
    return JSON.parse(await readFile(join(stateDir(service, siteId), "report.json"), "utf8")) as Stored;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────── running

function startRun(ctx: RouteContext, site: SiteService, source: ImportSource, given: Record<string, string>): ImportRunStatus {
  const service = importsOf(ctx.services);
  const mode = ctx.options.mode;

  for (const run of service.runs.values()) {
    if (run.siteId === site.id && run.status.state === "running") throw new GalleyError("busy", "An import into this site is already running. Wait for it, or stop it first.");
  }
  const id = randomUUID();
  const job: Job = { id, kind: "import", label: "Bringing your WordPress site over", state: "running", startedAt: Date.now(), siteId: site.id, progress: 0 };
  const emitter = jobEmitter(ctx.services.events, job);
  const steps: ImportStep[] = (["read", "media", "posts", "pages", "finish"] as const).map((step) => ({ id: step, label: STEP_LABELS[step], state: "waiting" }));
  const status: ImportRunStatus = { id, job: emitter.get(), state: "running", steps, message: "Starting…" };
  const run: Run = { status, siteId: site.id, controller: new AbortController() };
  // The password is only in this closure, for as long as the job runs.
  let secret: string | undefined = source.kind === "address" ? source.password : undefined;
  let held: ImportSource | null = source;

  service.runs.set(id, run);
  const step = (which: ImportStep["id"], patch: Partial<ImportStep>) => {
    const current = steps.find((entry) => entry.id === which)!;

    Object.assign(current, patch);
    // Steps before the running one are done; a run can skip one that had nothing to do.
    if (patch.state === "running") for (const entry of steps) if (entry !== current && entry.state === "running") entry.state = "done";
    const weights = { read: 0.1, media: 0.45, posts: 0.3, pages: 0.1, finish: 0.05 };
    let progress = 0;

    for (const entry of steps) {
      if (entry.state === "done" || entry.state === "skipped") progress += weights[entry.id];
      else if (entry.state === "running") progress += weights[entry.id] * (entry.total ? (entry.done ?? 0) / entry.total : 0.3);
    }
    status.message = `${stepText(current)}…`.replace(/……$/, "…");
    emitter.update({ label: stepText(current), progress: Math.min(0.99, progress) });
    status.job = emitter.get();
  };

  void (async () => {
    try {
      step("read", { state: "running" });
      const read = await readSite(service, mode, site.id, held!, run.controller.signal, () => undefined);
      const { plan } = await settledPlan(site, read.wp, given);

      step("read", { state: "done" });
      // Nothing is read again from here on: the password has done its job.
      secret = undefined;
      held = null;
      const report = await runImport(site, read.wp, plan, {
        signal: run.controller.signal,
        writeRedirects: true,
        redirectFiles: "import-folder",
        ...(source.kind === "address" ? { fetch: fetchFor(mode) } : {}),
        onProgress: (event) => {
          if (event.phase === "media") step("media", { state: "running", done: event.done, total: event.total });
          else if (event.phase === "entries") step(event.kind === "pages" ? "pages" : "posts", { state: "running", done: event.done, total: event.total });
        },
      });

      // Steps a stopped run never reached stay "waiting" (not reached); a finished run's empty steps had nothing to do.
      for (const entry of steps) if (entry.state === "waiting" && entry.id !== "finish" && !report.stopped) entry.state = "skipped";
      for (const entry of steps) if (entry.state === "running") entry.state = report.stopped ? "stopped" : "done";
      step("finish", { state: "running" });
      const view = reportView(id, plan, report, source.kind);

      await saveReport(service, site.id, { view, briefs: report.rebuilds });
      step("finish", { state: "done" });
      status.report = view;
      status.state = report.stopped ? "stopped" : "done";
      const kept = view.arrived.posts + view.arrived.pages + view.arrived.updated;

      status.message = report.stopped
        ? `Stopped. ${kept} ${kept === 1 ? "entry" : "entries"} and ${view.arrived.images} ${view.arrived.images === 1 ? "image" : "images"} had arrived; they're kept as pending changes. Start again to bring the rest — nothing is duplicated.`
        : doneMessage(view);
      emitter.finish("done", { label: report.stopped ? "Import stopped — what arrived is kept" : "WordPress import finished", detail: status.message, progress: 1 });
    } catch (error) {
      const clean = scrub(error, secret);
      const aborted = clean instanceof ImportError && clean.reason === "aborted";

      for (const entry of steps) if (entry.state === "running" || entry.state === "waiting") entry.state = aborted ? "stopped" : entry.state === "running" ? "stopped" : "waiting";
      status.state = aborted ? "stopped" : "error";
      status.message = aborted ? "Stopped before anything was written." : clean instanceof GalleyError ? clean.message : "The import couldn't finish because of an unexpected problem. What arrived is kept as pending changes.";
      const problem = held ? problemOf(clean, held) : problemOf(clean, { kind: "file", uploadId: "" });

      if (problem) status.problem = problem;
      emitter.finish(aborted ? "done" : "error", { detail: status.message });
    } finally {
      secret = undefined;
      held = null;
      status.job = emitter.get();
      // A finished read isn't needed any more: the next look at the source sees what is there now.
      for (const [key] of service.reads) if (key.startsWith(`${site.id}|`)) service.reads.delete(key);
    }
  })();
  status.job = emitter.get();
  return status;
}

// ─────────────────────────────────────────────────────────── rebuilding with the assistant

function sectionTypesOf(model: Awaited<ReturnType<SiteService["model"]>>, path: string): Array<{ type: string; label?: string }> {
  const collection = model.collections.find((entry) => path.startsWith(`${entry.path.replace(/\/+$/, "")}/`)) ?? model.collections.find((entry) => entry.id === "pages");
  const blocks = collection?.fields.find((field) => field.type === "blocks")?.blocks ?? [];

  return blocks.map((block) => ({ type: block.type, ...(block.label ? { label: block.label } : {}) }));
}

async function startRebuild(ctx: RouteContext, site: SiteService, stored: Stored, path: string): Promise<{ threadId: string; turnId: string }> {
  const brief = stored.briefs.find((entry) => entry.path === path);
  const summary = stored.view.rebuilds.find((entry) => entry.path === path);

  if (!brief || !summary) throw notFound("That page wasn't flagged as a page-builder page in the last import.");
  if (!(await site.readEntry(path).catch(() => null))) throw notFound("That page isn't in the site any more.");
  const model = await site.model();
  const text = rebuildRequest(brief, sectionTypesOf(model, path), summary.originalUrl || undefined);
  const thread = await ctx.services.agent.createThread(site.id, { title: `Rebuild “${brief.title}”`, mode: "build" });
  const { turnId } = await ctx.services.agent.send(site.id, thread.id, { text, mode: "build", context: { entryPath: path, ...(summary.url ? { urlPath: summary.url } : {}) } });

  summary.threadId = thread.id;
  await saveReport(importsOf(ctx.services), site.id, stored);
  return { threadId: thread.id, turnId };
}

/**
 * A rough price for rebuilding the pages: a build-mode turn reads the page
 * and the section types, writes the sections, and checks — several model
 * requests, most of each prompt read from the cache. The range is wide on
 * purpose; it's said to be an estimate.
 */
function estimateFor(model: string, briefs: Array<{ chars: number }>): { low: number; high: number } | null {
  let low = 0;
  let high = 0;

  for (const brief of briefs) {
    const fresh = Math.ceil(brief.chars / 3.5);
    const lo = costFor(model, { inputTokens: 6 * (2_000 + fresh / 3), outputTokens: 6 * 1_200, cacheReadTokens: 6 * 14_000, cacheWriteTokens: 18_000 });
    const hi = costFor(model, { inputTokens: 14 * (4_000 + fresh / 2), outputTokens: 14 * 2_500, cacheReadTokens: 14 * 26_000, cacheWriteTokens: 40_000 });

    if (lo === null || hi === null) return null;
    low += lo;
    high += hi;
  }
  return { low: Math.round(low * 100) / 100, high: Math.round(high * 100) / 100 };
}

async function rebuildPlan(ctx: RouteContext, site: SiteService): Promise<ImportRebuildPlan> {
  const stored = await loadReport(importsOf(ctx.services), site.id);
  const settings = await ctx.services.settings.get();
  const model = settings.ai.model || DEFAULT_MODEL;
  const pages = (stored?.view.rebuilds ?? []).map((entry) => ({ path: entry.path, title: entry.title, rebuilt: Boolean(entry.threadId) }));
  const siteModel = await site.model();
  const chars = (stored?.briefs ?? []).filter((brief) => pages.some((page) => page.path === brief.path)).map((brief) => ({ chars: rebuildRequest(brief, sectionTypesOf(siteModel, brief.path)).length }));

  return {
    pages,
    model,
    estimate: estimateFor(model, chars),
    connected: settings.secrets.some((secret) => secret.name === "anthropic" && secret.configured),
    note: "Each page is rebuilt in its own conversation, one after another, and lands in Proof for you to check. The cost is an estimate at list prices; what was really spent shows in App settings › Usage.",
  };
}

function startRebuildAll(ctx: RouteContext, site: SiteService, stored: Stored, paths: string[] | undefined): ImportRebuildStatus {
  const service = importsOf(ctx.services);

  for (const queue of service.rebuilds.values()) if (queue.siteId === site.id && queue.status.job.state === "running") throw new GalleyError("busy", "The pages are already being rebuilt. Wait for that, or stop it first.");
  const chosen = stored.view.rebuilds.filter((entry) => !paths || paths.includes(entry.path));

  if (!chosen.length) throw invalid("There are no page-builder pages to rebuild.");
  const job: Job = { id: randomUUID(), kind: "import", label: `Rebuilding ${chosen.length} ${chosen.length === 1 ? "page" : "pages"} with sections`, state: "running", startedAt: Date.now(), siteId: site.id, progress: 0 };
  const emitter = jobEmitter(ctx.services.events, job);
  const status: ImportRebuildStatus = { job: emitter.get(), pages: chosen.map((entry) => ({ path: entry.path, title: entry.title, state: "waiting" })) };
  const queue: RebuildRun = { status, siteId: site.id, stop: false, current: null };

  service.rebuilds.set(job.id, queue);
  void (async () => {
    for (const [index, page] of status.pages.entries()) {
      if (queue.stop) {
        page.state = "stopped";
        continue;
      }
      page.state = "working";
      emitter.update({ label: `Rebuilding “${page.title}” — ${index + 1} of ${status.pages.length}`, progress: index / status.pages.length });
      status.job = emitter.get();
      try {
        // One turn at a time: wait for this page's turn to end before the next starts.
        let threadId = "";
        let expected = "";
        const ended = new Promise<string | null>((resolve) => {
          const off = ctx.services.events.subscribe((event) => {
            if ((event.type === "chat.done" || event.type === "chat.error") && event.siteId === site.id && event.threadId === threadId && (!expected || event.turnId === expected)) {
              off();
              resolve(event.type === "chat.error" ? event.message : null);
            }
          });
        });
        const started = await startRebuild(ctx, site, stored, page.path);

        threadId = started.threadId;
        expected = started.turnId;
        page.threadId = threadId;
        queue.current = { threadId };
        const failure = await ended;

        page.state = queue.stop ? "stopped" : failure ? "failed" : "done";
        if (failure) page.reason = failure;
      } catch (error) {
        page.state = "failed";
        page.reason = error instanceof GalleyError ? error.message : "It couldn't be started.";
        if (error instanceof GalleyError && (error.code === "unconfigured" || error.code === "busy")) queue.stop = true;
      } finally {
        queue.current = null;
      }
    }
    const done = status.pages.filter((page) => page.state === "done").length;

    emitter.finish("done", { label: queue.stop ? `Rebuilding stopped — ${done} of ${status.pages.length} done` : `Rebuilt ${done} of ${status.pages.length} pages`, progress: 1, detail: "Each page is waiting in Proof." });
    status.job = emitter.get();
  })();
  return status;
}

// ─────────────────────────────────────────────────────────── uploads

/** Whether the first bytes are a WordPress export (an RSS file in WordPress's export namespace). */
/**
 * The line a finished import ends on. When entries were left out it says so
 * and points at the report: "0 posts … are waiting in Proof" alone reads as
 * if the old site had no posts.
 */
export function doneMessage(view: Pick<ImportReportView, "arrived" | "notImported">): string {
  const { posts, pages, images } = view.arrived;
  const left = view.notImported.length;
  const arrived = `${posts} ${posts === 1 ? "post" : "posts"}, ${pages} ${pages === 1 ? "page" : "pages"} and ${images} ${images === 1 ? "image" : "images"} are waiting in Proof.`;

  return left ? `Done. ${arrived} ${left === 1 ? "1 entry was" : `${left} entries were`} left out; the report says why.` : `Done. ${arrived}`;
}

export function looksLikeWordPressExport(head: Buffer): boolean {
  const text = head.subarray(0, 64 * 1024).toString("utf8").replace(/^﻿/, "");

  return /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<rss\b/i.test(text) && /xmlns:wp="https?:\/\/wordpress\.org\/export\//i.test(text);
}

async function pruneUploads(service: ImportService, siteId: string): Promise<void> {
  const dir = join(stateDir(service, siteId), "uploads");
  const names = await readdir(dir).catch(() => [] as string[]);

  for (const name of names) {
    const file = join(dir, name);
    const info = await stat(file).catch(() => null);

    if (info && Date.now() - info.mtimeMs > UPLOAD_TTL_MS) await rm(file, { force: true });
  }
}

async function receiveChunk(service: ImportService, siteId: string, body: z.output<typeof uploadChunkBody>): Promise<{ uploadId: string; received: number; upload: ImportUpload | null }> {
  const bytes = Buffer.from(body.chunk, "base64");

  if (bytes.length === 0 || bytes.length > UPLOAD_CHUNK_BYTES) throw invalid("That part of the file arrived empty or too large. Try the upload again.");
  let upload = body.uploadId ? service.uploads.get(body.uploadId) : undefined;

  if (body.uploadId && (!upload || upload.siteId !== siteId)) throw invalid("That upload isn't here any more. Start it again.");
  if (!upload) {
    if (body.offset !== 0) throw invalid("An upload has to start at the beginning of the file.");
    if (!looksLikeWordPressExport(bytes)) {
      throw invalid("That file isn't a WordPress export. In WordPress, open Tools › Export, choose “All content”, and upload the file it downloads (it ends in .xml).");
    }
    await pruneUploads(service, siteId);
    const id = randomUUID();
    const dir = join(stateDir(service, siteId), "uploads");

    await mkdir(dir, { recursive: true, mode: 0o700 });
    upload = { id, siteId, name: body.name.replace(/[\\/]/g, "_"), size: body.total, total: body.total, file: join(dir, `${id}.xml`), received: 0, done: false };
    service.uploads.set(id, upload);
    await writeFile(upload.file, "", { mode: 0o600 });
  }
  if (body.offset !== upload.received) throw invalid("Part of the file went missing on the way. Start the upload again.");
  if (upload.received + bytes.length > upload.total) throw invalid("The file is bigger than it said it was. Start the upload again.");
  await appendFile(upload.file, bytes);
  upload.received += bytes.length;
  upload.done = upload.received === upload.total;
  return { uploadId: upload.id, received: upload.received, upload: upload.done ? { id: upload.id, name: upload.name, size: upload.size } : null };
}

// ─────────────────────────────────────────────────────────── routes

function runOf(ctx: RouteContext, siteId: string, runId: string): Run {
  const run = importsOf(ctx.services).runs.get(runId);

  if (!run || run.siteId !== siteId) throw notFound("That import isn't known here. It may have finished before the app restarted — its report is still on the import screen.");
  return run;
}

export const importRoutes: Pick<RouteTable, ImportRouteKey> = {
  "POST /api/sites/:siteId/import/upload": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return receiveChunk(importsOf(ctx.services), site.id, await v.body(c, uploadChunkBody));
  },
  "POST /api/sites/:siteId/import/inspect": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const { source } = await v.body(c, inspectBody);
    const service = importsOf(ctx.services);
    const empty = { posts: null, pages: null, media: null, comments: null };

    try {
      const wpSource = sourceFor(service, site.id, source);
      const look = await inspectWordPress(wpSource, "url" in wpSource ? { fetch: fetchFor(ctx.options.mode) } : {});
      const privateHost = source.kind === "address" && ctx.options.mode === "local" && (await isPrivateHost(source.address));

      // An export file read whole is kept, so the plan doesn't read it again.
      if (look.site) service.reads.set(readKey(site.id, source), { wp: look.site, at: Date.now(), privateHost: false });
      return {
        ok: true,
        kind: source.kind,
        title: look.title,
        siteUrl: look.siteUrl,
        counts: look.counts,
        ...(look.builderPages !== undefined ? { builderPages: look.builderPages } : {}),
        signedIn: look.signedIn,
        notes: privateHost ? [LOCAL_NOTE] : [],
      } satisfies ImportInspection;
    } catch (error) {
      const clean = scrub(error, source.kind === "address" ? source.password : undefined);
      const problem = problemOf(clean, source);

      if (!problem) throw clean;
      return { ok: false, kind: source.kind, title: "", siteUrl: "", counts: empty, signedIn: false, notes: [], problem } satisfies ImportInspection;
    }
  },
  "POST /api/sites/:siteId/import/plan": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const body = await v.body(c, planBody);
    const secret = body.source.kind === "address" ? body.source.password : undefined;

    try {
      const read = await readSite(importsOf(ctx.services), ctx.options.mode, site.id, body.source);
      const { plan, questions } = await settledPlan(site, read.wp, body.answers ?? {});

      return planView(read, plan, questions, body.source.kind);
    } catch (error) {
      const clean = scrub(error, secret);
      const problem = problemOf(clean, body.source);

      // Not a 401: that would tell the app its own session ended.
      throw problem ? new GalleyError("invalid", problem.message, problem.detail) : clean;
    }
  },
  "POST /api/sites/:siteId/import/run": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const body = await v.body(c, planBody);

    return startRun(ctx, site, body.source, body.answers ?? {});
  },
  "GET /api/sites/:siteId/import/runs/:runId": async (c, ctx) => runOf(ctx, (await siteOf(c, ctx)).id, c.req.param("runId") ?? "").status,
  "POST /api/sites/:siteId/import/runs/:runId/cancel": async (c, ctx) => {
    const run = runOf(ctx, (await siteOf(c, ctx)).id, c.req.param("runId") ?? "");

    if (run.status.state === "running") {
      run.controller.abort();
      run.status.message = "Stopping — what has arrived is kept…";
    }
    return run.status;
  },
  "GET /api/sites/:siteId/import/report": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return { report: (await loadReport(importsOf(ctx.services), site.id))?.view ?? null };
  },
  "POST /api/sites/:siteId/import/rebuild": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const { path } = await v.body(c, rebuildBody);
    const stored = await loadReport(importsOf(ctx.services), site.id);

    if (!stored) throw notFound("There's no import report for this site yet.");
    return startRebuild(ctx, site, stored, path);
  },
  "GET /api/sites/:siteId/import/rebuild-all": async (c, ctx) => rebuildPlan(ctx, await siteOf(c, ctx)),
  "POST /api/sites/:siteId/import/rebuild-all": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const { paths } = await v.body(c, rebuildAllBody);
    const stored = await loadReport(importsOf(ctx.services), site.id);

    if (!stored) throw notFound("There's no import report for this site yet.");
    const settings = await ctx.services.settings.get();

    if (!settings.secrets.some((secret) => secret.name === "anthropic" && secret.configured)) throw new GalleyError("unconfigured", "Connect the assistant in Settings first; rebuilding pages needs it.");
    return startRebuildAll(ctx, site, stored, paths);
  },
  "GET /api/sites/:siteId/import/rebuild-all/:jobId": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const queue = importsOf(ctx.services).rebuilds.get(c.req.param("jobId") ?? "");

    if (!queue || queue.siteId !== site.id) throw notFound("That rebuild isn't known here.");
    return queue.status;
  },
  "POST /api/sites/:siteId/import/rebuild-all/:jobId/cancel": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const queue = importsOf(ctx.services).rebuilds.get(c.req.param("jobId") ?? "");

    if (!queue || queue.siteId !== site.id) throw notFound("That rebuild isn't known here.");
    queue.stop = true;
    if (queue.current) await ctx.services.agent.cancel(site.id, queue.current.threadId).catch(() => undefined);
    return queue.status;
  },
};
