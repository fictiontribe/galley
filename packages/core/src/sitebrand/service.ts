/**
 * The site-brand service: one instance for the whole app. Everything it does
 * to a site goes through SiteService; what isn't the site's yet (added
 * material, the proposal under review, the analysis in progress) lives in
 * the app's own folder for the site, `<home>/state/<siteId>/brand/`.
 *
 * Reading a brand is a `Job` (kind "brand") with plain steps, cancellable,
 * whose model spend is recorded in the site's usage like an assistant turn.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { GalleyError } from "../errors";
import { createApiClient } from "../ai/runtime";
import { createGuardedFetch, type GuardedFetch } from "../forms/net";
import { createJobTracker } from "../site/jobs";
import type { EventBus, Job, SettingsService, SiteRegistry, SiteService, TurnUsage } from "../types";
import { planApply } from "./apply";
import { checkChanges, drift, type ChangedFile } from "./check";
import { deltaE, normalizeColor } from "./color";
import { scanDeclared, type DeclaredScan, type FontPackageReader, type SiteFile } from "./declared";
import { exportBundle, exportDesignTokens, proposalFromBundle, readBundle, type BrandBundle } from "./export";
import { brandJson, brandLocation, BRAND_SCHEMA_URL, readSavedBrand, writeBrandFiles, type BrandLocation } from "./files";
import { brandDigest, imageryBrief, renderGuide } from "./guide";
import { readInventory, type Inventory } from "./inventory";
import { mergeMeasurements, parseMeasurements, type MergedMeasurements } from "./measured";
import { PDF_LIMITS, readPdfContent, readPictureContent, readSource, readTextContent, revise, sumUsage, synthesise, usageOf, type CallOptions } from "./model";
import { buildCandidates, buildProposal, evidencePack, refresh, roleWords, type Candidates, type SourceInput } from "./proposal";
import { inertSvg } from "./svg";
import { createSourceStore, factsOf, safeSourceName, SOURCE_LIMITS, type SourceStore, type StoredSource, type UploadChunk } from "./sources";
import type { Reading, Synthesis } from "./schema";
import { siteBrandFileSchema } from "./schema";
import type { ApplyPlan, BrandCheckItem, BrandProposal, BrandSource, BrandStep, DriftReport, MeasureSummary, SiteBrandFile, SiteBrandState, SourceManifest } from "./types";
import { mayBeShown } from "../workspace/policy";

export interface SiteBrandServiceOptions {
  home: string;
  registry: SiteRegistry;
  settings: SettingsService;
  events: EventBus;
  env?: NodeJS.ProcessEnv;
  /** Test seam: a pre-built client (scripted fetch). */
  client?: Anthropic;
  /** Test seam: the guarded fetch used for a website's address. */
  fetch?: GuardedFetch;
  now?: () => Date;
  logger?: (line: string) => void;
}

interface Analysis {
  jobId: string;
  steps: BrandStep[];
  partial: SiteBrandState["analysis"] extends infer A ? (A extends { partial: infer P } ? P : null) : null;
  state: "running" | "done" | "error" | "cancelled";
  error?: string;
  controller: AbortController;
}

export interface AnalyseRequest {
  /** "site": read the site; "material": the added files (with the site too when measurements are given). */
  from: "site" | "material";
  /** What the app measured in the preview (overlay `measure` answers). */
  measurements?: unknown;
  /** Only these sources: reads them and adds what they say to the current proposal. */
  sources?: string[];
}

export interface WebFont {
  id: string;
  family: string;
  weight: string;
  style: string;
  path: string;
  type: string;
}

const STYLE_GLOB = "**/*.{css,scss,sass,less,pcss,astro,vue,svelte}";
/**
 * How long the Brand screen's first read waits for the scan of the site's
 * styles (its web fonts and tokens file). The scan lists every file and
 * reads up to 300; on a big or busy site that is seconds, and the brand
 * itself doesn't need it. Past this, the state goes back without the fonts,
 * says `scanning`, and the screen asks again.
 */
const SCAN_WAIT_MS = 800;
const FONT_TYPES: Record<string, string> = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" };

/** Reads a font package's stylesheet from the site's own node_modules — only @fontsource packages, only .css. */
export function fontPackageReader(root: string): FontPackageReader {
  return (specifier) => {
    const match = /^(@fontsource(?:-variable)?\/[a-z0-9-]+)(?:\/([a-z0-9._-]+\.css))?$/.exec(specifier);

    if (!match) return null;
    const dir = packageDir(root, match[1]!);

    if (!dir) return null;
    const file = join(dir, match[2] ?? "index.css");

    try {
      if (!realpathSync(file).startsWith(dir + sep) || statSync(file).size > 400_000) return null;
      return [{ file: `pkg:${match[1]}/${match[2] ?? "index.css"}`, content: readFileSync(file, "utf8") }];
    } catch {
      return null;
    }
  };
}

function packageDir(root: string, pkg: string): string | null {
  const candidate = join(root, "node_modules", ...pkg.split("/"));

  try {
    const real = realpathSync(candidate);

    // A link is fine (workspaces link their packages), as long as it lands in a package folder of that name.
    return real.endsWith(`${sep}node_modules${sep}${pkg.split("/").join(sep)}`) || existsSync(join(real, "package.json")) ? real : null;
  } catch {
    return null;
  }
}

export function createSiteBrandService(options: SiteBrandServiceOptions) {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const log = options.logger ?? ((line: string) => process.stderr.write(`[brand] ${line}\n`));
  const jobs = createJobTracker(options.events);
  const store: SourceStore = createSourceStore(options.home);
  const analyses = new Map<string, Analysis>();
  const fonts = new Map<string, WebFont[]>();
  /** The tokens file the last scan of each site found. */
  const scannedTokens = new Map<string, string | null>();
  /** The scan in progress per site, so concurrent reads share one. */
  const scans = new Map<string, Promise<void>>();
  const guarded = options.fetch ?? createGuardedFetch();
  const stateDir = (siteId: string) => join(options.home, "state", siteId, "brand");

  async function siteFor(siteId: string): Promise<SiteService> {
    const site = await options.registry.get(siteId);

    if (!site) throw new GalleyError("not-found", "That site isn't open here. Open it again from the Sites screen.");
    return site;
  }

  async function where(site: SiteService): Promise<BrandLocation> {
    return brandLocation(await site.readConfig().catch(() => null));
  }

  async function readJson<T>(path: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch {
      return null;
    }
  }

  async function writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(join(path, ".."), { recursive: true });
    const temp = `${path}.${randomBytes(4).toString("hex")}.tmp`;

    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temp, path);
  }

  const proposalFile = (siteId: string) => join(stateDir(siteId), "proposal.json");
  const measuredFile = (siteId: string) => join(stateDir(siteId), "measured.json");
  const readingFile = (siteId: string, sha: string) => join(stateDir(siteId), "readings", `${sha}.json`);

  const loadProposal = (siteId: string) => readJson<BrandProposal>(proposalFile(siteId));
  const saveProposal = (siteId: string, proposal: BrandProposal | null) => (proposal ? writeJson(proposalFile(siteId), proposal) : writeJson(proposalFile(siteId), null));

  async function client(siteId: string): Promise<Anthropic | null> {
    if (options.client) return options.client;
    const key = await options.settings.readSecret("anthropic", { siteId }).catch(() => null);

    return key ? createApiClient(key, env, 2) : null;
  }

  // ── reading the site's code

  async function declaredOf(site: SiteService, location: BrandLocation): Promise<{ scan: DeclaredScan; files: string[] }> {
    const files = await site.listFiles({ limit: 20_000 }).catch(() => [] as string[]);
    const styles = files.filter((file) => /\.(css|scss|sass|less|pcss)$/.test(file) && !/(^|\/)(dist|build|\.astro|public\/build)\//.test(file)).slice(0, 120);
    const components = files.filter((file) => /\.(astro|vue|svelte)$/.test(file)).slice(0, 150);
    const configs = files.filter((file) => /(^|\/)tailwind\.config\.(c|m)?(j|t)s$/.test(file) || /^src\/(layouts|pages)\/.*\.(astro|tsx|jsx)$/.test(file)).slice(0, 30);
    const read: SiteFile[] = [];

    for (const path of [...styles, ...components, ...configs]) {
      const file = await site.readFile(path).catch(() => null);

      if (file && !file.binary && file.content.length <= 400_000) read.push({ path, content: file.content });
    }
    const pkg = await site.readFile("package.json").catch(() => null);
    let dependencies: string[] = [];

    try {
      const parsed = pkg ? (JSON.parse(pkg.content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }) : {};

      dependencies = [...Object.keys(parsed.dependencies ?? {}), ...Object.keys(parsed.devDependencies ?? {})];
    } catch {
      // No readable package.json: no packages to name.
    }
    const starter = await site.readFile("starter.json").catch(() => null);
    let starterTokens: string | null = null;

    try {
      starterTokens = starter ? ((JSON.parse(starter.content) as { tokens?: string }).tokens ?? null) : null;
    } catch {
      starterTokens = null;
    }
    const scan = scanDeclared(read, fontPackageReader(site.root), { tokensFile: location.tokensFile ?? starterTokens, dependencies });

    fonts.set(site.id, webFontsOf(site, scan));
    scannedTokens.set(site.id, scan.tokensFile);
    return { scan, files };
  }

  /** One file per family (Latin, upright, regular or variable) the Brand screen can load to set the specimen. */
  function webFontsOf(site: SiteService, scan: DeclaredScan): WebFont[] {
    const out: WebFont[] = [];
    const latin = (range?: string) => !range || /U\+0000-00FF|U\+0-FF|U\+0000-007F/i.test(range);

    for (const face of scan.fontFaces) {
      if (!latin(face.unicodeRange) || face.style !== "normal" || out.some((f) => f.family === face.family)) continue;
      const ext = face.file.split(".").pop()?.toLowerCase() ?? "";

      // Named by the site's stylesheets, and served as it is.
      if (!Object.hasOwn(FONT_TYPES, ext) || !mayBeShown(face.file)) continue;
      let path: string | null = null;

      if (face.file.startsWith("pkg:")) {
        const rest = face.file.slice(4);
        const pkg = rest.split("/").slice(0, 2).join("/");
        const dir = packageDir(site.root, pkg);
        const candidate = dir ? join(dir, ...rest.split("/").slice(2)) : null;

        try {
          if (candidate && dir && realpathSync(candidate).startsWith(dir + sep)) path = candidate;
        } catch {
          path = null;
        }
      } else {
        try {
          path = site.resolvePath(face.file);
          if (!existsSync(path)) path = null;
        } catch {
          path = null;
        }
      }
      if (!path) continue;
      out.push({ id: createHash("sha1").update(`${face.family}|${face.file}`).digest("hex").slice(0, 12), family: face.family, weight: face.weight, style: face.style, path, type: FONT_TYPES[ext]! });
    }
    return out;
  }

  // ── sources as SourceInput

  async function allSources(site: SiteService, location: BrandLocation): Promise<StoredSource[]> {
    const staged = await store.list(site.id);
    const saved = (await readSavedBrand(site, location)).manifest.sources;
    const out = [...staged];

    for (const source of saved) {
      if (out.some((s) => s.id === source.id)) continue;
      // Saved earlier (maybe on another computer): its bytes are in the site, or nowhere here.
      let bytesPath: string | null = null;

      // The saved list is a file of the site, and whoever may change it names the path. What it names is served, packed
      // into an export and read for the assistant: never a secrets file or one of the version history's own.
      if (source.file && mayBeShown(source.file)) {
        try {
          bytesPath = site.resolvePath(source.file);
        } catch {
          bytesPath = null;
        }
      }
      out.push({ ...source, bytesPath, analysisPath: null, facts: {}, staged: false });
    }
    return out;
  }

  function publicSource(source: StoredSource): BrandSource {
    const { bytesPath: _b, analysisPath: _a, facts: _f, staged: _s, unread: _u, ...rest } = source;

    return rest;
  }

  // ── state

  /** Scans the site's styles once per site at a time; a scan that fails leaves no fonts rather than asking forever. */
  function scanOnce(site: SiteService, location: BrandLocation): Promise<void> {
    let running = scans.get(site.id);

    if (!running) {
      running = declaredOf(site, location)
        .then(() => undefined, () => void (fonts.has(site.id) || fonts.set(site.id, [])))
        .finally(() => scans.delete(site.id));
      scans.set(site.id, running);
    }
    return running;
  }

  /** The brand's files with unpublished changes: from the cached file status when the site keeps one, not a full change set. */
  async function pendingIn(site: SiteService, dir: string): Promise<string[]> {
    const paths = site.pendingPaths ? site.pendingPaths() : ((await site.changes().catch(() => null))?.files ?? []).map((f) => f.path);

    return paths.filter((path) => path.startsWith(`${dir}/`));
  }

  async function state(siteId: string): Promise<SiteBrandState> {
    const site = await siteFor(siteId);
    const location = await where(site);
    // Started first so it runs beside the reads below instead of after them.
    const scan = fonts.has(siteId) ? null : scanOnce(site, location);
    const [saved, proposal, sources, model, key, pending] = await Promise.all([
      readSavedBrand(site, location),
      loadProposal(siteId),
      allSources(site, location),
      site.model(),
      options.client ? Promise.resolve("test") : options.settings.readSecret("anthropic", { siteId }).catch(() => null),
      pendingIn(site, location.dir),
    ]);
    const analysis = analyses.get(siteId);

    if (scan) {
      let timer: NodeJS.Timeout | undefined;

      await Promise.race([scan, new Promise<void>((resolve) => (timer = setTimeout(resolve, SCAN_WAIT_MS)))]);
      clearTimeout(timer);
    }
    // Unread material, with or without a proposal; ids a proposal recorded before the flag existed count too.
    const unread = sources.filter((s) => !s.ignored && (s.unread || proposal?.pendingSources.includes(s.id))).map((s) => s.id);
    // A brand set up from material doesn't know the site's tokens file; the site's own styles do.
    const tokensFile = saved.brand?.tokensFile ?? proposal?.brand.tokensFile ?? location.tokensFile ?? scannedTokens.get(siteId) ?? null;

    return {
      brand: saved.brand,
      guide: saved.guide,
      problem: saved.problem,
      sources: sources.map(publicSource),
      staged: sources.filter((s) => s.staged).map((s) => s.id),
      proposal,
      analysis: analysis ? { jobId: analysis.jobId, steps: analysis.steps, partial: analysis.partial, state: analysis.state, ...(analysis.error ? { error: analysis.error } : {}) } : null,
      settings: { dir: location.dir, largeFileBytes: location.largeFileBytes, tokensFile },
      hasPages: model.collections.some((c) => c.url !== null && c.count > 0) || Boolean(model.routesDir),
      assistant: Boolean(key),
      digest: saved.brand ? brandDigest(saved.brand, saved.guide) : null,
      imagery: saved.brand ? imageryBrief(saved.brand) : null,
      pending,
      unread,
      ...(fonts.has(siteId) ? {} : { scanning: true }),
      webFonts: (fonts.get(siteId) ?? []).map((font) => ({ family: font.family, weight: font.weight, style: font.style, url: `/api/sites/${encodeURIComponent(siteId)}/brand/fonts/${font.id}` })),
    };
  }

  // ── analysis

  function setStep(analysis: Analysis, index: number, patch: Partial<BrandStep>, job: { update(p: Partial<Job>): void }): void {
    const step = analysis.steps[index];

    if (!step) return;
    Object.assign(step, patch);
    const done = analysis.steps.filter((s) => s.state === "done" || s.state === "skipped").length;
    const running = analysis.steps.find((s) => s.state === "running");

    job.update({ progress: done / analysis.steps.length, detail: running ? `${running.label}${running.detail ? ` — ${running.detail}` : ""}` : step.label });
  }

  async function cachedReading(siteId: string, source: StoredSource): Promise<Reading | null> {
    return readJson<Reading>(readingFile(siteId, source.sha256));
  }

  async function sourceBytes(source: StoredSource): Promise<Uint8Array | null> {
    if (source.bytesPath) return new Uint8Array(await readFile(source.bytesPath).catch(() => Buffer.alloc(0)));
    return null;
  }

  /** Reads one source with the model. Returns null (with `limited` set) when it can't be sent. */
  async function readOne(call: CallOptions, siteId: string, source: StoredSource, usage: TurnUsage): Promise<Reading | null> {
    const cached = await cachedReading(siteId, source);

    if (cached) return cached;
    let content: Parameters<typeof readSource>[1] | null = null;

    if (source.type === "pdf") {
      const bytes = await sourceBytes(source);

      if (!bytes?.length) return null;
      if (Object.keys(source.facts).length === 0) Object.assign(source, { facts: factsOf("pdf", bytes).facts });
      const pages = source.facts.pdf?.pages ?? source.pages ?? 0;

      if (bytes.length > PDF_LIMITS.maxBytes || pages > PDF_LIMITS.maxPages) {
        source.limited = `Too long to read in full (${pages ? `${pages} pages, ` : ""}${Math.round(bytes.length / 1048576)} MB); only its colours and fonts were taken. Export the pages that matter as a smaller PDF and add that.`;
        return null;
      }
      if (source.facts.pdf?.encrypted) {
        source.limited = "It is protected, so it couldn't be read. Add a copy without a password.";
        return null;
      }
      content = readPdfContent(source.name, source.note, Buffer.from(bytes).toString("base64"));
    } else if (source.type === "image") {
      const picture = source.analysisPath ? await readFile(source.analysisPath).catch(() => null) : null;

      if (!picture) {
        source.limited = "This picture can only be read once the app has made a copy of it; add it again from the Brand screen.";
        return null;
      }
      const facts = (source.facts.palette ?? []).map((p) => `${p.color} ${Math.round(p.share * 100)}%`).join(", ") || "no clear colours";

      content = readPictureContent(source.name, source.note, picture.toString("base64"), facts);
    } else if (source.type === "svg") {
      const bytes = await sourceBytes(source);

      if (!bytes?.length) return null;
      content = readTextContent(source.name, source.note, inertSvg(Buffer.from(bytes).toString("utf8")), "svg");
    } else if (source.type === "text") {
      const bytes = await sourceBytes(source);

      if (!bytes?.length) return null;
      content = readTextContent(source.name, source.note, Buffer.from(bytes).toString("utf8").slice(0, SOURCE_LIMITS.textChars), "note");
    } else if (source.type === "website") {
      const snapshot = source.bytesPath ? await readJson<{ text: string }>(source.bytesPath) : null;

      if (!snapshot) return null;
      content = readTextContent(source.name, source.note, snapshot.text.slice(0, SOURCE_LIMITS.textChars), "website");
    }
    if (!content) return null;
    try {
      const { data, usage: spent } = await readSource(call, content);

      sumUsage(usage, spent);
      await writeJson(readingFile(siteId, source.sha256), data);
      return data;
    } catch (error) {
      sumUsage(usage, usageOf(error));
      throw error;
    }
  }

  function learnedFrom(reading: Reading): string[] {
    const lines: string[] = [];

    if (reading.summary.trim()) lines.push(reading.summary.trim().slice(0, 300));
    const stated = reading.colors.filter((c) => c.how === "stated");

    if (stated.length) lines.push(`States ${stated.length === 1 ? "1 colour" : `${stated.length} colours`}: ${stated.slice(0, 6).map((c) => `${c.name ? `${c.name} ` : ""}${c.hex}${c.page ? ` (p. ${c.page})` : ""}`).join(", ")}.`);
    if (reading.fonts.length) lines.push(`Fonts: ${[...new Set(reading.fonts.map((f) => f.family))].join(", ")}.`);
    const rules = reading.logo.length + reading.voice.length + reading.imagery.length + reading.layout.length + reading.vocabulary.length;

    if (rules) lines.push(`${rules === 1 ? "1 rule" : `${rules} rules`} for the logo, voice, pictures or layout.`);
    return lines;
  }

  /** The proposal without the model: roles from names and use, no voice. Used when no assistant key is set. */
  function plainSynthesis(candidates: Candidates): Synthesis {
    const taken = new Set<string>();

    return {
      colors: candidates.colors
        .filter((c) => c.hint && (c.onPages || c.declared) && !taken.has(c.hint) && (taken.add(c.hint), true))
        .map((c) => ({ candidate: c.id, role: c.hint!, name: c.names[0] ?? roleWords(c.hint!).replace(/^./, (x) => x.toUpperCase()), usage: "" })),
      fonts: candidates.fonts.filter((f) => f.hint && (f.onPages || f.declared)).map((f) => ({ candidate: f.id, role: f.hint! })),
      voice: { summary: "", tone: [], rules: [], vocabulary: [], formatting: { headlineCase: "mixed", punctuation: "", numbers: "", cta: "" } },
      layout: { do: [], dont: [] },
      imagery: { direction: "", subjects: [], light: "", palette: [], avoid: [] },
      components: [],
      logos: candidates.logos.filter((l) => l.onPages).slice(0, 1).map((l) => ({ candidate: l.id, variant: "primary", background: "light", clearSpace: "", minSize: "", notes: "" })),
      flags: [],
      questions: [],
    };
  }

  async function websiteParts(sources: StoredSource[]): Promise<{ website: { url: string; declared: DeclaredScan } | null; copy: Array<{ text: string; where: string }> }> {
    const site = sources.find((s) => s.type === "website" && !s.ignored && s.bytesPath);

    if (!site?.bytesPath) return { website: null, copy: [] };
    const snapshot = await readJson<{ url: string; css: Array<{ url: string; content: string }>; copy: string[] }>(site.bytesPath);

    if (!snapshot) return { website: null, copy: [] };
    const declared = scanDeclared(snapshot.css.map((c, i) => ({ path: `website-${i}.css`, content: c.content })), () => null);

    return { website: { url: snapshot.url, declared }, copy: snapshot.copy.slice(0, 40).map((text) => ({ text, where: snapshot.url })) };
  }

  async function run(siteId: string, request: AnalyseRequest, analysis: Analysis, job: ReturnType<typeof jobs.start>): Promise<void> {
    const site = await siteFor(siteId);
    const location = await where(site);
    const model = await site.model();
    const settings = await options.settings.get({ siteId });
    const anthropic = await client(siteId);
    const call: CallOptions = { client: anthropic as Anthropic, model: settings.ai.model, effort: settings.ai.effort, signal: analysis.controller.signal, log };
    const usage: TurnUsage = { model: settings.ai.model, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 };
    const abort = () => {
      if (analysis.controller.signal.aborted) throw new GalleyError("busy", "Stopped.");
    };
    let measured: MergedMeasurements | null = null;
    let measurements: MeasureSummary[] = [];

    try {
      if (request.measurements !== undefined) {
        try {
          measurements = parseMeasurements(request.measurements);
        } catch {
          throw new GalleyError("invalid", "What the preview measured couldn't be read, so it wasn't used. Try again.");
        }
      }
      const all = (await allSources(site, location)).filter((s) => !s.ignored);
      const extending = request.sources?.length ? all.filter((s) => request.sources!.includes(s.id)) : null;
      const readSite = request.from === "site" || measurements.length > 0;
      const sources = request.from === "material" ? (extending ?? all) : [];
      let index = 0;
      const steps = analysis.steps;

      // Step 1: the site's code.
      let declared: DeclaredScan | null = null;
      let files: string[] = [];
      let inventory: Inventory | null = null;

      if (readSite && !extending) {
        setStep(analysis, index, { state: "running" }, job);
        const result = await declaredOf(site, location);

        declared = result.scan;
        files = result.files;
        const colours = declared.variables.filter((v) => v.kind === "color").length;

        setStep(analysis, index, { state: "done", detail: declared.tokensFile ? `${colours} colours and ${declared.fonts.length} fonts in ${declared.tokensFile}` : `${colours} colours, ${declared.fonts.length} fonts` }, job);
        index += 1;
        abort();
        // Step 2: the measurements.
        setStep(analysis, index, { state: "running" }, job);
        if (measurements.length) {
          measured = mergeMeasurements(measurements);
          await writeJson(measuredFile(siteId), measurements);
          setStep(analysis, index, { state: "done", detail: measurements.length === 1 ? `1 page: ${measurements[0]!.path}` : `${measurements.length} pages: ${measurements.map((m) => m.path).join(", ")}` }, job);
        } else {
          setStep(analysis, index, { state: "skipped", detail: "The preview wasn't measured, so only the code was read." }, job);
        }
        index += 1;
        // Step 3: sections and copy.
        setStep(analysis, index, { state: "running" }, job);
        inventory = await readInventory(site, model, files);
        setStep(analysis, index, { state: "done", detail: `${inventory.components.length} section types, ${inventory.pages.length} pages` }, job);
        index += 1;
        const early = buildCandidates({ declared, measured, sources: [], website: null });

        analysis.partial = {
          colors: early.colors.filter((c) => c.hint).slice(0, 12).map((c) => ({ id: c.id, role: c.hint!, name: roleWords(c.hint!), value: c.hex, confidence: c.onPages ? "measured" : "declared", evidence: c.evidence.slice(0, 2), ...(c.tokens[0] ? { token: c.tokens[0] } : {}) })),
          typography: { fonts: early.fonts.filter((f) => f.hint).map((f) => ({ id: f.id, role: f.hint!, family: f.family, fallbacks: f.fallbacks, source: f.source, weights: [...f.weights], confidence: f.onPages ? "measured" : "declared", evidence: f.evidence.slice(0, 2) })), scale: [] },
        };
        job.update({ detail: steps[index]?.label ?? "" });
      }
      abort();
      // Material: one step per source.
      const inputs: SourceInput[] = [];

      for (const [n, source] of sources.entries()) {
        setStep(analysis, index, { state: "running", detail: `${n + 1} of ${sources.length}` }, job);
        let reading: Reading | null = null;

        if (anthropic) {
          reading = await readOne(call, siteId, source, usage);
        } else {
          source.limited = "No assistant key is set, so only its colours and fonts were read.";
        }
        if (source.bytesPath && Object.keys(source.facts).length === 0 && source.type !== "website") {
          const bytes = await sourceBytes(source);

          if (bytes?.length) source.facts = factsOf(source.type, bytes).facts;
        }
        inputs.push({ source, reading });
        const learned = reading ? learnedFrom(reading) : [];

        await store.update(siteId, source.id, (stored) => {
          stored.learned = [...new Set([...stored.learned.filter((l) => !learned.includes(l)), ...learned])].slice(0, 12);
          if (source.limited) stored.limited = source.limited;
          else delete stored.limited;
        });
        setStep(analysis, index, { state: source.limited ? "skipped" : "done", detail: source.limited ?? (learned[0] ? learned[0].slice(0, 120) : "Read") }, job);
        index += 1;
        abort();
      }
      const web = await websiteParts(sources);

      if (extending) {
        // Adding to a proposal under review: new values become additions or questions, nothing is overwritten.
        // No proposal open: start one from the saved brand, so new material adds to it and nothing is overwritten.
        const open = await loadProposal(siteId);
        const saved = open ? null : (await readSavedBrand(site, location)).brand;
        const proposal: BrandProposal | null = open ?? (saved ? { id: now().getTime().toString(36), createdAt: now().toISOString(), from: "both", brand: structuredClone(saved), questions: [], findings: [], pendingSources: [], cost: null, model: null } : null);

        if (!proposal) throw new GalleyError("not-found", "There's no brand to add to. Set the brand up first.");
        const candidates = buildCandidates({ declared: null, measured: null, sources: inputs, website: web.website });
        let added = 0;

        for (const candidate of candidates.colors) {
          for (const stated of candidate.statedRoles) {
            const current = proposal.brand.colors.find((c) => c.role === stated.role);

            if (!current) {
              proposal.brand.colors.push({ id: `${stated.role}-${proposal.brand.colors.length + 1}`, role: stated.role, name: candidate.names[0] ?? roleWords(stated.role), value: candidate.hex, confidence: "declared", evidence: [stated.evidence] });
              proposal.findings.push({ id: `new-${candidate.hex}`, kind: "note", text: `${stated.evidence.sourceName} adds ${candidate.hex} as the ${roleWords(stated.role)}.`, about: [candidate.hex] });
              added += 1;
            } else if (deltaE(current.value, candidate.hex) >= 2.5 && !proposal.questions.some((q) => q.target === `colors.${stated.role}`)) {
              proposal.questions.push({
                id: `q-${stated.role}-${proposal.questions.length + 1}`,
                target: `colors.${stated.role}`,
                text: `${stated.evidence.sourceName} says ${candidate.hex} for ${roleWords(stated.role)}; the proposal has ${current.value} — which is right?`,
                options: [
                  { label: candidate.hex, value: candidate.hex, evidence: [stated.evidence] },
                  { label: current.value, value: current.value, evidence: current.evidence.slice(0, 2) },
                ],
              });
              added += 1;
            }
          }
        }
        for (const input of inputs) {
          for (const rule of input.reading ? [...input.reading.voice, ...input.reading.imagery, ...input.reading.layout, ...input.reading.logo] : []) {
            proposal.findings.push({ id: `new-${proposal.findings.length + 1}`, kind: "note", text: `${input.source.name}${rule.page ? ` (p. ${rule.page})` : ""}: ${rule.rule}`.slice(0, 300) });
            added += 1;
          }
        }
        proposal.pendingSources = proposal.pendingSources.filter((id) => !inputs.some((i) => i.source.id === id));
        proposal.brand = refresh(proposal.brand);
        proposal.cost = (proposal.cost ?? 0) + (usage.cost ?? 0);
        await saveProposal(siteId, proposal);
        await markRead(siteId, inputs);
        setStep(analysis, index, { state: "done", detail: added === 1 ? "1 new finding to review" : `${added} new findings to review` }, job);
      } else {
        // Put it together.
        setStep(analysis, index, { state: "running" }, job);
        const candidates = buildCandidates({ declared, measured, sources: inputs, website: web.website });
        const code: Array<{ file: string; excerpt: string }> = [];

        if (declared?.tokensFile) {
          const tokens = await site.readFile(declared.tokensFile).catch(() => null);

          if (tokens) code.push({ file: declared.tokensFile, excerpt: tokens.content.slice(0, 8000) });
        }
        for (const component of (inventory?.components ?? []).filter((c) => c.file).slice(0, 3)) {
          const file = await site.readFile(component.file!).catch(() => null);

          if (file) code.push({ file: component.file!, excerpt: file.content.slice(0, 2500) });
        }
        const pack = { ...(evidencePack({ siteName: model.name, candidates, measured, inventory, sources: inputs, websiteCopy: web.copy, notes: declared?.notes ?? [] }) as object), code };
        let synthesis: Synthesis;

        if (anthropic) {
          try {
            const result = await synthesise(call, pack);

            sumUsage(usage, result.usage);
            synthesis = result.data;
          } catch (error) {
            sumUsage(usage, usageOf(error));
            throw error;
          }
        } else {
          synthesis = plainSynthesis(candidates);
        }
        setStep(analysis, index, { state: "done", detail: anthropic ? "Roles, voice and guide written" : "Colours, fonts and sizes read; no assistant key, so no voice or guide" }, job);
        index += 1;
        setStep(analysis, index, { state: "running" }, job);
        const previous = (await readSavedBrand(site, location)).brand;
        const proposal = buildProposal({
          from: readSite && sources.length ? "both" : readSite ? "site" : "material",
          siteName: model.name,
          candidates,
          measured,
          inventory,
          sources: inputs,
          websiteCopy: web.copy,
          notes: declared?.notes ?? [],
          synthesis,
          declared,
          previous,
          now,
          cost: anthropic ? usage.cost : null,
          model: anthropic ? settings.ai.model : null,
        });

        if (!anthropic) proposal.findings.unshift({ id: "no-assistant", kind: "note", text: "No assistant key is set, so the voice and guide weren't written. Add a key in Settings and read it again." });
        await saveProposal(siteId, proposal);
        await markRead(siteId, inputs);
        const fails = proposal.brand.contrast.filter((p) => p.result === "fail").length;

        setStep(analysis, index, { state: "done", detail: fails ? `${fails} pair${fails === 1 ? "" : "s"} hard to read` : "Every pair is easy to read" }, job);
      }
      analysis.state = "done";
      job.finish("done", { progress: 1, detail: "Ready to review" });
    } finally {
      if (usage.requests > 0) await options.settings.recordUsage({ ...usage, siteId, at: now().getTime() }).catch((error) => log(`couldn't record the analysis's usage: ${String(error)}`));
    }
  }

  function stepsFor(request: AnalyseRequest, sources: StoredSource[], readSite: boolean): BrandStep[] {
    const steps: BrandStep[] = [];

    if (readSite && !request.sources?.length) {
      steps.push({ label: "Reading the site's styles", state: "waiting" }, { label: "Measuring the pages", state: "waiting" }, { label: "Listing the sections", state: "waiting" });
    }
    for (const source of sources) steps.push({ label: `Reading ${source.name}`, state: "waiting" });
    if (request.sources?.length) steps.push({ label: "Adding what they say", state: "waiting" });
    else steps.push({ label: "Putting it together", state: "waiting" }, { label: "Checking contrast", state: "waiting" });
    return steps;
  }

  async function analyse(siteId: string, request: AnalyseRequest): Promise<Job> {
    const current = analyses.get(siteId);

    if (current?.state === "running") throw new GalleyError("busy", "The brand is already being read. Wait for it to finish, or stop it.");
    const site = await siteFor(siteId);
    const location = await where(site);
    const sources = request.from === "material" ? (await allSources(site, location)).filter((s) => !s.ignored && (!request.sources?.length || request.sources.includes(s.id))) : [];

    if (request.from === "material" && sources.length === 0) throw new GalleyError("invalid", "Add some material first: guidelines, logos, screenshots or a note.");
    const readSite = request.from === "site" || request.measurements !== undefined;
    const job = jobs.start("brand", request.from === "site" ? "Reading the brand from the site" : "Setting up the brand from your material");
    const analysis: Analysis = { jobId: job.id, steps: stepsFor(request, sources, readSite), partial: null, state: "running", controller: new AbortController() };

    analyses.set(siteId, analysis);
    job.update({ siteId });
    void run(siteId, request, analysis, job).catch((error: unknown) => {
      const stopped = analysis.controller.signal.aborted;
      const message = stopped ? "Stopped. Nothing was saved." : error instanceof GalleyError ? error.message : "Reading the brand stopped unexpectedly. Nothing was saved.";

      if (!stopped && !(error instanceof GalleyError)) log(`analysis failed: ${error instanceof Error ? error.message : String(error)}`);
      analysis.state = stopped ? "cancelled" : "error";
      analysis.error = message;
      for (const step of analysis.steps) if (step.state === "running") step.state = stopped ? "skipped" : "error";
      job.finish("error", { detail: message, ...(error instanceof GalleyError && error.detail ? { output: error.detail.slice(0, 500) } : {}) });
    });
    return job.snapshot();
  }

  // ── proposal edits

  async function editable(siteId: string): Promise<BrandProposal> {
    const existing = await loadProposal(siteId);

    if (existing) return existing;
    const site = await siteFor(siteId);
    const saved = await readSavedBrand(site, await where(site));

    if (!saved.brand) throw new GalleyError("not-found", "There's no brand to change yet. Set one up first.");
    return { id: now().getTime().toString(36), createdAt: now().toISOString(), from: "site", brand: saved.brand, questions: [], findings: [], pendingSources: [], cost: null, model: null };
  }

  async function updateProposal(siteId: string, patch: { brand?: unknown; answers?: Record<string, string> }): Promise<BrandProposal> {
    const proposal = await editable(siteId);

    if (patch.brand !== undefined) {
      const parsed = siteBrandFileSchema.safeParse(patch.brand);

      if (!parsed.success) {
        const issue = parsed.error.issues[0];

        throw new GalleyError("invalid", `That change can't be kept: ${issue ? `${issue.path.join(".")} ${issue.message}` : "it isn't a brand"}.`);
      }
      proposal.brand = parsed.data as SiteBrandFile;
    }
    for (const [id, value] of Object.entries(patch.answers ?? {})) {
      const question = proposal.questions.find((q) => q.id === id);

      if (!question || !question.options.some((o) => o.value === value)) continue;
      question.answer = value;
      const role = /^colors\.(.+)$/.exec(question.target)?.[1];
      const hex = normalizeColor(value);
      const chosen = question.options.find((o) => o.value === value);

      if (role && hex) {
        const color = proposal.brand.colors.find((c) => c.role === role);

        if (color) Object.assign(color, { value: hex.slice(0, 7), evidence: chosen?.evidence.length ? chosen.evidence : color.evidence, confidence: chosen?.evidence.some((e) => e.kind === "page") ? "measured" : "declared" });
      }
    }
    proposal.brand = refresh(proposal.brand, await measuredFor(siteId));
    await saveProposal(siteId, proposal);
    return proposal;
  }

  async function measuredFor(siteId: string): Promise<MergedMeasurements | null> {
    const raw = await readJson<unknown>(measuredFile(siteId));

    try {
      return raw ? mergeMeasurements(parseMeasurements(raw)) : null;
    } catch {
      return null;
    }
  }

  async function ask(siteId: string, text: string): Promise<{ proposal: BrandProposal; reply: string }> {
    const request = text.trim();

    if (!request) throw new GalleyError("invalid", "Say what to change first.");
    if (request.length > 2000) throw new GalleyError("invalid", "That's too long. Keep it under 2,000 characters.");
    const anthropic = await client(siteId);

    if (!anthropic) throw new GalleyError("unconfigured", "Add an assistant key in Settings to ask for changes in words. You can still change everything by hand.");
    const proposal = await editable(siteId);
    const settings = await options.settings.get({ siteId });
    const compact = { colors: proposal.brand.colors.map(({ id, role, name, value }) => ({ id, role, name, value })), fonts: proposal.brand.typography.fonts.map(({ id, role, family }) => ({ id, role, family })), voice: proposal.brand.voice ? { summary: proposal.brand.voice.summary, tone: proposal.brand.voice.tone } : null, imagery: proposal.brand.imagery?.direction ?? null, layout: proposal.brand.layout };
    const usage: TurnUsage = { model: settings.ai.model, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 };

    try {
      const result = await revise({ client: anthropic, model: settings.ai.model, effort: settings.ai.effort, log }, compact, request);

      sumUsage(usage, result.usage);
      const brand = proposal.brand;
      const changed: string[] = [];

      for (const change of result.data.changes.slice(0, 20)) {
        const color = brand.colors.find((c) => c.id === change.id);
        const font = brand.typography.fonts.find((f) => f.id === change.id);
        const value = change.value.trim();

        if (change.target === "color.value" && color && normalizeColor(value)) {
          color.value = normalizeColor(value)!.slice(0, 7);
          color.confidence = "inferred";
          color.evidence = [{ kind: "source", sourceName: "Asked for in words", note: request.slice(0, 200) }];
          changed.push(color.name);
        } else if (change.target === "color.name" && color && value) color.name = value.slice(0, 80);
        else if (change.target === "font.family" && font && value) {
          font.family = value.slice(0, 120);
          font.confidence = "inferred";
        } else if (change.target === "voice.summary" && brand.voice && value) brand.voice.summary = value.slice(0, 700);
        else if (change.target === "voice.tone" && brand.voice && value) brand.voice.tone = value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 8);
        else if (change.target === "imagery.direction" && brand.imagery && value) brand.imagery.direction = value.slice(0, 500);
        else if (change.target === "layout.do" && value) brand.layout.do.push(value.slice(0, 240));
        else if (change.target === "layout.dont" && value) brand.layout.dont.push(value.slice(0, 240));
        else if (change.target === "vocabulary.add" && brand.voice && value.includes("|")) {
          const [say, not] = value.split("|").map((part) => part.trim());

          if (say && not) brand.voice.vocabulary.push({ say: say.slice(0, 100), insteadOf: not.split(",").map((w) => w.trim()).filter(Boolean).slice(0, 8) });
        }
      }
      proposal.brand = refresh(brand, await measuredFor(siteId));
      proposal.cost = (proposal.cost ?? 0) + (usage.cost ?? 0);
      await saveProposal(siteId, proposal);
      // The contrast is measured here, not claimed by the model.
      const affected = proposal.brand.contrast.filter((p) => changed.length && proposal.brand.colors.some((c) => (c.id === p.text || c.id === p.background) && changed.includes(c.name)));
      const verdict = affected.length ? (affected.every((p) => p.result !== "fail") ? ` Contrast checked: ${affected.map((p) => `${p.ratio}:1`).join(", ")} — still easy to read.` : ` Contrast checked: ${affected.filter((p) => p.result === "fail").length} pair${affected.filter((p) => p.result === "fail").length === 1 ? " is" : "s are"} now hard to read.`) : "";

      return { proposal, reply: `${result.data.reply.trim().slice(0, 400)}${verdict}` };
    } catch (error) {
      sumUsage(usage, usageOf(error));
      throw error;
    } finally {
      if (usage.requests > 0) await options.settings.recordUsage({ ...usage, siteId, at: now().getTime() }).catch(() => undefined);
    }
  }

  // ── save

  async function save(siteId: string): Promise<{ paths: string[] }> {
    const site = await siteFor(siteId);
    const location = await where(site);
    const proposal = await loadProposal(siteId);

    if (!proposal) throw new GalleyError("not-found", "There's nothing to save yet.");
    const open = proposal.questions.filter((q) => !q.answer);

    if (open.length) throw new GalleyError("invalid", open.length === 1 ? "Answer the question first: it decides which value the brand keeps." : `Answer the ${open.length} questions first: they decide which values the brand keeps.`);
    const sources = await allSources(site, location);
    const saved = await readSavedBrand(site, location);
    const files: Array<{ path: string; content: string | Uint8Array }> = [];
    const manifest: SourceManifest = { version: 1, sources: [] };
    const fileOf = new Map<string, string>();
    const names = new Set(saved.manifest.sources.map((s) => s.file).filter(Boolean));

    for (const source of sources) {
      const record = publicSource(source);

      if (source.staged && source.type !== "website" && source.bytes <= location.largeFileBytes && source.bytesPath) {
        let name = safeSourceName(source.name, source.type, source.mime);

        for (let i = 2; names.has(`${location.sourcesDir}/${name}`); i += 1) name = name.replace(/(\.[a-z0-9]+)$/, `-${i}$1`);
        const path = `${location.sourcesDir}/${name}`;

        names.add(path);
        files.push({ path, content: new Uint8Array(await readFile(source.bytesPath)) });
        record.stored = "site";
        record.file = path;
        fileOf.set(source.id, path);
      } else if (!source.staged && source.file) fileOf.set(source.id, source.file);
      manifest.sources.push(record);
    }
    const brand: SiteBrandFile = {
      ...proposal.brand,
      $schema: BRAND_SCHEMA_URL,
      updatedAt: now().toISOString(),
      logos: proposal.brand.logos.map((logo) => {
        const id = /^source:(.+)$/.exec(logo.file)?.[1];

        return id && fileOf.has(id) ? { ...logo, file: fileOf.get(id)! } : logo;
      }),
    };
    const ordered: SiteBrandFile = { $schema: brand.$schema, ...brand };

    files.push({ path: location.brandFile, content: brandJson(ordered) }, { path: location.guideFile, content: renderGuide(brand) }, { path: location.manifestFile, content: brandJson(manifest) });
    const paths = await writeBrandFiles(site, files);

    await store.save(
      siteId,
      (await store.list(siteId)).map((s) => (fileOf.has(s.id) ? { ...s, staged: false, stored: "site" as const, file: fileOf.get(s.id)! } : { ...s, staged: false }))
    );
    await saveProposal(siteId, null);
    analyses.delete(siteId);
    return { paths };
  }

  // ── apply

  async function applyInputs(siteId: string): Promise<{ site: SiteService; brand: SiteBrandFile; file: string; content: string; hash: string; installed: Set<string> }> {
    const site = await siteFor(siteId);
    const location = await where(site);
    const saved = await readSavedBrand(site, location);
    const brand = saved.brand ?? (await loadProposal(siteId))?.brand ?? null;

    if (!brand) throw new GalleyError("not-found", "There's no brand to apply yet. Set one up first.");
    const { scan } = await declaredOf(site, location);
    const file = brand.tokensFile ?? location.tokensFile ?? scan.tokensFile;

    if (!file) throw new GalleyError("invalid", "This site has no single file of colours and fonts to apply the brand to. The brand describes the site; changing its styles is a build-mode job for the assistant.");
    // Named by the brand or the settings: read like any file a setting names, never a secrets file or one of the version history's own.
    const text = mayBeShown(file) ? await site.readFile(file).catch(() => null) : null;

    if (!text || text.binary) throw new GalleyError("not-found", `The site's colours file (${file}) can't be read.`);
    const installed = new Set(scan.fontFaces.map((face) => face.family));

    return { site, brand, file, content: text.content, hash: text.hash, installed };
  }

  async function applyPlan(siteId: string): Promise<ApplyPlan> {
    const input = await applyInputs(siteId);

    return planApply(input.brand, input.file, input.content, input.installed).plan;
  }

  async function apply(siteId: string): Promise<{ plan: ApplyPlan; paths: string[] }> {
    // The stylesheet's new text is the file as it was read with the brand's edits made in it: written only over that
    // reading. When the file changed in between, it is read and the edits are planned again.
    for (let attempt = 1; ; attempt += 1) {
      const input = await applyInputs(siteId);
      const result = planApply(input.brand, input.file, input.content, input.installed);

      if (!result.plan.edits.length) return { plan: result.plan, paths: [] };
      try {
        return { plan: result.plan, paths: await writeBrandFiles(input.site, [{ path: input.file, content: result.content, baseHash: input.hash }]) };
      } catch (error) {
        if (!(error instanceof GalleyError && error.code === "conflict") || attempt >= 3) throw error;
      }
    }
  }

  // ── check and drift

  async function brandFor(site: SiteService, siteId: string): Promise<SiteBrandFile> {
    const saved = await readSavedBrand(site, await where(site));
    const brand = saved.brand ?? (await loadProposal(siteId))?.brand ?? null;

    if (!brand) throw new GalleyError("not-found", "This site has no brand yet, so there's nothing to check against.");
    return brand;
  }

  async function check(siteId: string, paths?: string[]): Promise<BrandCheckItem[]> {
    const site = await siteFor(siteId);
    const location = await where(site);
    const brand = (await readSavedBrand(site, location)).brand ?? (await loadProposal(siteId))?.brand ?? null;

    // Proof asks after every change; a site without a brand simply has nothing to check against.
    if (!brand) return [];
    const changes = await site.changes();
    const files: ChangedFile[] = [];

    // A waiting secrets file is among the changes; its lines are read for nobody.
    for (const change of changes.files.filter((f) => !f.binary && f.status !== "deleted" && mayBeShown(f.path) && (!paths || paths.includes(f.path))).slice(0, 40)) {
      const diff = await site.diff(change.path).catch(() => null);

      if (!diff) continue;
      files.push({ path: change.path, after: diff.after, added: diff.hunks.flatMap((h) => h.lines.filter((l) => l.type === "add").map((l) => ({ line: l.newNumber ?? 0, text: l.text }))) });
    }
    return checkChanges(brand, files, { brandDir: location.dir });
  }

  async function driftOf(siteId: string, raw: unknown): Promise<DriftReport> {
    const site = await siteFor(siteId);
    const brand = await brandFor(site, siteId);
    let measurements: MeasureSummary[];

    try {
      measurements = parseMeasurements(raw);
    } catch {
      throw new GalleyError("invalid", "What the preview measured couldn't be read. Try again.");
    }
    if (!measurements.length) throw new GalleyError("invalid", "The preview has to be running to check the site against its brand.");
    const { scan } = await declaredOf(site, await where(site));
    const referenced = new Set<string>();

    for (const variable of scan.variables) for (const match of variable.raw.matchAll(/var\(\s*(--[\w-]+)/g)) referenced.add(match[1]!);
    const files = await site.listFiles({ glob: STYLE_GLOB, limit: 300 }).catch(() => [] as string[]);

    for (const path of files.slice(0, 200)) {
      const file = await site.readFile(path).catch(() => null);

      for (const match of file?.content.matchAll(/var\(\s*(--[\w-]+)/g) ?? []) referenced.add(match[1]!);
    }
    return drift(brand, mergeMeasurements(measurements), now(), referenced);
  }

  // ── sources

  async function addWebsite(siteId: string, address: string): Promise<BrandSource> {
    await siteFor(siteId);
    let url: URL;

    try {
      url = new URL(address.trim());
    } catch {
      throw new GalleyError("invalid", "That isn't a web address. Use the full address, starting with https://.");
    }
    const page = await guarded(url.href, { headers: { accept: "text/html" } }, { timeoutMs: 8000, maxBytes: 2 * 1024 * 1024, maxRedirects: 2 });

    if (page.status >= 400) throw new GalleyError("invalid", `That address answered with an error (${page.status}), so nothing was read.`);
    const html = page.body;
    const css: Array<{ url: string; content: string }> = [];

    for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) css.push({ url: url.href, content: match[1]!.slice(0, 200_000) });
    const links = [...html.matchAll(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi)].map((m) => /href=["']([^"']+)["']/i.exec(m[0])?.[1]).filter((h): h is string => Boolean(h));

    for (const href of links.slice(0, 6)) {
      try {
        const target = new URL(href, url);

        if (target.hostname !== url.hostname) continue;
        const sheet = await guarded(target.href, { headers: { accept: "text/css" } }, { timeoutMs: 8000, maxBytes: 1024 * 1024, maxRedirects: 1 });

        if (sheet.status < 400) css.push({ url: target.href, content: sheet.body });
      } catch {
        // One stylesheet that can't be fetched doesn't stop the rest.
      }
    }
    const body = html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ");
    const decode = (text: string) => text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "’").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const copy = [...body.matchAll(/<(h[1-3]|p|li|button|a)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
      .map((m) => decode(m[2]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
      .filter((t) => t.split(" ").length >= 2 && t.length <= 400);
    const title = decode(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? url.hostname).slice(0, 200);
    const text = `${title}\n\n${[...new Set(copy)].slice(0, 120).join("\n")}\n\n${css.map((c) => c.content).join("\n").slice(0, 40_000)}`;
    const id = randomBytes(8).toString("hex");
    const path = join(stateDir(siteId), "files", `${id}.website.json`);

    await writeJson(path, { url: url.href, title, css, copy: [...new Set(copy)].slice(0, 120), text });
    const source: StoredSource = {
      id,
      name: `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`.slice(0, 200),
      type: "website",
      mime: "text/html",
      bytes: Buffer.byteLength(html),
      sha256: createHash("sha256").update(text).digest("hex"),
      addedAt: now().toISOString(),
      stored: "outside",
      learned: [`Read the page “${title}”${css.length ? ` and ${css.length === 1 ? "1 stylesheet" : `${css.length} stylesheets`}` : ""}.`],
      bytesPath: path,
      analysisPath: null,
      facts: { website: { url: url.href, title, css: css.length, textChars: text.length } },
      staged: true,
    };

    await store.add(siteId, source);
    await markPending(siteId, source.id);
    return publicSource(source);
  }

  /** Only once what they said is in a saved proposal: a reading that stops part-way leaves them unread. */
  async function markRead(siteId: string, inputs: SourceInput[]): Promise<void> {
    for (const input of inputs) await store.update(siteId, input.source.id, (stored) => void delete stored.unread);
  }

  async function markPending(siteId: string, id: string): Promise<void> {
    await store.update(siteId, id, (stored) => void (stored.unread = true));
    const proposal = await loadProposal(siteId);

    if (proposal && !proposal.pendingSources.includes(id)) {
      proposal.pendingSources.push(id);
      await saveProposal(siteId, proposal);
    }
  }

  async function upload(siteId: string, chunk: UploadChunk): Promise<{ uploadId: string; received: number; source: BrandSource | null }> {
    await siteFor(siteId);
    void store.sweep();
    const result = await store.receive(siteId, chunk);

    if (result.source) await markPending(siteId, result.source.id);
    return { uploadId: result.uploadId, received: result.received, source: result.source ? publicSource(result.source) : null };
  }

  async function updateSource(siteId: string, id: string, patch: { note?: string | null; ignored?: boolean }): Promise<BrandSource> {
    const updated = await store.update(siteId, id, (source) => {
      if (patch.note !== undefined) {
        if (patch.note?.trim()) source.note = patch.note.trim().slice(0, 300);
        else delete source.note;
      }
      if (patch.ignored !== undefined) source.ignored = patch.ignored;
    });

    if (!updated) throw new GalleyError("not-found", "That file isn't in the brand's material. It may have been saved or removed.");
    return publicSource(updated);
  }

  async function removeSource(siteId: string, id: string): Promise<void> {
    const removed = await store.remove(siteId, id);

    if (removed) {
      const proposal = await loadProposal(siteId);

      if (proposal) {
        proposal.pendingSources = proposal.pendingSources.filter((p) => p !== id);
        await saveProposal(siteId, proposal);
      }
      return;
    }
    const site = await siteFor(siteId);
    const location = await where(site);
    const saved = await readSavedBrand(site, location);
    const source = saved.manifest.sources.find((s) => s.id === id);

    if (!source) throw new GalleyError("not-found", "That file isn't in the brand's material.");
    const manifest = { version: 1 as const, sources: saved.manifest.sources.filter((s) => s.id !== id) };

    if (source.file) await site.deleteFile(source.file, { origin: "user", mode: (await site.model()).ai.allowBuild ? "build" : "content" }).catch(() => undefined);
    await writeBrandFiles(site, [{ path: location.manifestFile, content: brandJson(manifest) }]);
  }

  async function sourceFile(siteId: string, id: string, kind: "original" | "picture"): Promise<{ data: Uint8Array; type: string } | null> {
    const site = await siteFor(siteId);
    const source = (await allSources(site, await where(site))).find((s) => s.id === id);

    if (!source) return null;
    if (kind === "picture" && source.analysisPath) {
      const data = await readFile(source.analysisPath).catch(() => null);

      return data ? { data: new Uint8Array(data), type: "image/png" } : null;
    }
    if (source.type === "website" || !source.bytesPath) return null;
    const data = await readFile(source.bytesPath).catch(() => null);

    return data ? { data: new Uint8Array(data), type: source.mime } : null;
  }

  return {
    state,
    analyse,
    cancel: async (siteId: string) => {
      analyses.get(siteId)?.controller.abort();
    },
    job: (id: string) => jobs.get(id),
    upload,
    addWebsite,
    updateSource,
    removeSource,
    sourceFile,
    updateProposal,
    discardProposal: async (siteId: string) => {
      await saveProposal(siteId, null);
      analyses.delete(siteId);
    },
    ask,
    save,
    applyPlan,
    apply,
    check,
    drift: driftOf,
    exportBundle: async (siteId: string): Promise<BrandBundle> => {
      const site = await siteFor(siteId);
      const location = await where(site);
      const saved = await readSavedBrand(site, location);
      const brand = saved.brand ?? (await loadProposal(siteId))?.brand;

      if (!brand) throw new GalleyError("not-found", "There's no brand to export yet.");
      return exportBundle(brand, saved.guide ?? renderGuide(brand), saved.manifest, now());
    },
    exportTokens: async (siteId: string): Promise<Record<string, unknown>> => {
      const site = await siteFor(siteId);

      return exportDesignTokens(await brandFor(site, siteId));
    },
    importBundle: async (siteId: string, value: unknown): Promise<BrandProposal> => {
      const site = await siteFor(siteId);
      const bundle = readBundle(value);
      const proposal = proposalFromBundle(bundle, (await site.model()).name, now());

      proposal.brand = refresh(proposal.brand);
      await saveProposal(siteId, proposal);
      return proposal;
    },
    fontFile: async (siteId: string, id: string): Promise<{ path: string; type: string } | null> => {
      if (!fonts.has(siteId)) {
        const site = await siteFor(siteId);

        await scanOnce(site, await where(site));
      }
      const font = fonts.get(siteId)?.find((f) => f.id === id);

      return font ? { path: font.path, type: font.type } : null;
    },
    dispose: () => jobs.dispose(),
  };
}

export type SiteBrandService = ReturnType<typeof createSiteBrandService>;
