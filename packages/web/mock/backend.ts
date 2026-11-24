/**
 * In-memory state for the mock server and one handler per route in
 * `ApiRoutes`. The handler table is a mapped type over every route key, so a
 * route added to or changed in api.ts is a compile error here until the mock
 * answers it.
 */
import { randomUUID } from "node:crypto";
import type { ApiRouteKey, RouteBody, RouteParams, RouteQuery, RouteResponse } from "@galley/core/api";
import type {
  ChatThread,
  EntryQuery,
  ImageCandidate,
  ImageProviderInfo,
  Job,
  MetaInfo,
  PreviewStatus,
  SecretName,
  SecretStatus,
  ServerEvent,
  Settings,
  UsageSummary,
  UsageTotals,
} from "@galley/core/types";
import { DEFAULT_BRAND, VERSION } from "@galley/core/brand";
import { runTurn, seedThread, undoTurn } from "./chat.ts";
import { HOME, SITES_DIR, createSites, newSiteFrom, starterDescription } from "./fixtures.ts";
import { startPreviewServers, type PreviewServers } from "./preview.ts";
import { MockError, MockSite, imageSize } from "./site.ts";
import { inboxHandlers } from "./inbox.ts";
import { siteKitHandlers } from "./sitekit.ts";
import { createMockDeploy } from "./deploy.ts";
import { createMockRedirects } from "./redirects.ts";
import { createMultiSite } from "./multisite.ts";
import { createMockVisibility } from "./visibility.ts";
import { createMockBrand } from "./brand.ts";
import { createMockImport } from "./import.ts";
import { createMockPlugins } from "./plugins.ts";
import { installHandlers } from "./install.ts";
import { accountsHandlers } from "./accounts.ts";
import { hostingHandlers } from "./hosting.ts";

// ── handler types ─────────────────────────────────────────────────────────

export type RawReply = { kind: "bytes"; type: string; body: Buffer } | { kind: "sse" };

type QueryStrings<K extends ApiRouteKey> = [RouteQuery<K>] extends [undefined] ? Record<string, never> : { [P in keyof NonNullable<RouteQuery<K>>]?: string };

export interface MockRequest<K extends ApiRouteKey> {
  params: RouteParams<K>;
  query: QueryStrings<K>;
  body: RouteBody<K>;
  /** Raw query string values, for the session hand-off (`?token=`). */
  search: URLSearchParams;
}

type Reply<K extends ApiRouteKey> = [RouteResponse<K>] extends [never] ? RawReply : RouteResponse<K>;
type Handler<K extends ApiRouteKey> = (req: MockRequest<K>) => Reply<K> | Promise<Reply<K>>;
export type Handlers = { [K in ApiRouteKey]: Handler<K> };

// ── state ─────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function totals(scale: number, images = 0): UsageTotals {
  const turns = Math.round(6 * scale);
  return {
    turns,
    requests: turns * 3,
    inputTokens: Math.round(41_000 * scale),
    outputTokens: Math.round(5_200 * scale),
    cacheReadTokens: Math.round(120_000 * scale),
    cacheWriteTokens: Math.round(18_000 * scale),
    images,
    cost: Math.round(0.37 * scale * 100) / 100,
  };
}

function usage(): UsageSummary {
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(Date.now() - (13 - index) * 86_400_000);
    const requests = [4, 0, 9, 12, 3, 0, 0, 15, 22, 8, 11, 0, 6, 18][index] ?? 0;
    return { date: date.toISOString().slice(0, 10), requests, cost: requests ? Math.round(requests * 0.061 * 100) / 100 : null };
  });
  return {
    today: totals(1, 2),
    last7: totals(7.4, 6),
    last30: totals(26, 19),
    allTime: totals(61, 44),
    byModel: [
      { ...totals(48, 0), model: "claude-opus-5-5" },
      { ...totals(13, 0), model: "claude-haiku-4-5" },
    ],
    days,
  };
}

const PROVIDERS: ImageProviderInfo[] = [
  { id: "mock", label: "Placeholders (offline)", configured: true, models: [{ id: "labelled", label: "Labelled placeholder" }], defaultModel: "labelled", supportsReferences: false, supportsTransparency: true },
  { id: "openai", label: "OpenAI", configured: true, models: [{ id: "gpt-image-1", label: "GPT Image" }], defaultModel: "gpt-image-1", supportsReferences: true, supportsTransparency: true },
  { id: "google", label: "Google", configured: false, models: [{ id: "imagen", label: "Imagen" }], defaultModel: "imagen", supportsReferences: true, supportsTransparency: false },
];

export interface MockOptions {
  /** "hosted" requires signing in with the password "proof". */
  mode: "local" | "hosted";
  emit: (event: ServerEvent) => void;
}

export class MockBackend {
  readonly sites = new Map<string, MockSite>();
  readonly threads = new Map<string, ChatThread[]>();
  readonly previews = new Map<string, { status: PreviewStatus; servers?: PreviewServers }>();
  readonly jobs = new Map<string, Job>();
  readonly candidates = new Map<string, { bytes: Buffer; mime: string }>();
  authenticated: boolean;
  secrets: Record<SecretName, SecretStatus> = {
    anthropic: { name: "anthropic", configured: true, source: "env", hint: "9f3a" },
    openai: { name: "openai", configured: true, source: "stored", hint: "x2Lk" },
    google: { name: "google", configured: false, source: null },
    cloudflare: { name: "cloudflare", configured: false, source: null },
    vercel: { name: "vercel", configured: false, source: null },
    fly: { name: "fly", configured: false, source: null },
    gcp: { name: "gcp", configured: false, source: null },
  };
  settings: Omit<Settings, "secrets">;
  /** Image providers the enabled plugins add (OpenRouter); set by the plugin handlers (plugins.ts). */
  pluginImageProviders: () => ImageProviderInfo[] = () => [];

  constructor(readonly options: MockOptions) {
    this.authenticated = options.mode === "local";
    for (const site of createSites()) {
      this.sites.set(site.id, site);
      this.previews.set(site.id, { status: { state: "idle", url: null, baselineUrl: null, baselineSource: null, log: [] } });
      this.threads.set(site.id, site.seed.missing ? [] : [seedThread(site)]);
    }
    const author = [...this.sites.values()][0]?.history[0];
    this.settings = {
      ai: {
        model: "claude-opus-5-5",
        effort: "medium",
        models: [
          { id: "claude-opus-5-5", label: "Claude Opus 5.5", blurb: "Most careful. Best for big or tricky changes and new sites.", inputPrice: 5, outputPrice: 25 },
          { id: "claude-sonnet-5", label: "Claude Sonnet 5", blurb: "Fast and capable. A good everyday choice.", inputPrice: 3, outputPrice: 15 },
          { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", blurb: "Quickest and cheapest. Fine for small text edits.", inputPrice: 1, outputPrice: 5 },
        ],
      },
      // No provider chosen: the built-in placeholder generator is used.
      images: { provider: null, model: null, providers: PROVIDERS },
      // No video service chosen: the first one set up is used.
      videos: { provider: null, model: null },
      author: { name: author?.author ?? "You", email: author?.email ?? "you@example.com" },
      appearance: { theme: "system" },
    };
  }

  emit(event: ServerEvent): void {
    this.options.emit(event);
  }

  site(siteId: string): MockSite {
    const site = this.sites.get(siteId);
    if (!site) throw new MockError("not-found", "This site isn’t in your list. It may have been forgotten.");
    if (site.seed.missing) throw new MockError("not-found", "This site’s folder is missing. It may have been moved or renamed.");
    return site;
  }

  changed(siteId: string, paths: string[], origin: Extract<ServerEvent, { type: "changes.updated" }>["origin"]): void {
    this.emit({ type: "changes.updated", siteId, paths, origin });
  }

  fullSettings(): Settings {
    const providers = PROVIDERS.map((p) => (p.id === "openai" ? { ...p, configured: this.secrets.openai.configured } : p.id === "google" ? { ...p, configured: this.secrets.google.configured } : p));
    return { ...this.settings, images: { ...this.settings.images, providers: [...providers, ...this.pluginImageProviders()] }, secrets: Object.values(this.secrets) };
  }

  setPreview(siteId: string, status: PreviewStatus): PreviewStatus {
    const entry = this.previews.get(siteId) ?? { status };
    entry.status = status;
    this.previews.set(siteId, entry);
    this.emit({ type: "preview.status", siteId, status });
    return status;
  }

  async startPreview(siteId: string): Promise<PreviewStatus> {
    const site = this.site(siteId);
    const current = this.previews.get(siteId);
    if (current?.status.state === "ready" || current?.status.state === "starting") return current.status;
    const command = site.model().dev?.command ?? "npm run dev";
    this.setPreview(siteId, { state: "starting", url: null, baselineUrl: null, baselineSource: null, detail: "Starting the site’s own dev server…", log: [`$ ${command}`], startedAt: Date.now() });
    await sleep(1200);
    const servers = await startPreviewServers(site);
    const urls = site.model().urls;
    const baselineSource = urls.staging ? "staging" : urls.production ? "production" : null;
    const status: PreviewStatus = {
      state: "ready",
      url: servers.url,
      baselineUrl: baselineSource ? servers.baselineUrl : null,
      baselineSource,
      detail: "Preview running",
      log: [`$ ${command}`, "  ready in 812 ms", `  Local: ${servers.url}/`],
      startedAt: Date.now(),
    };
    const entry = this.previews.get(siteId);
    entry?.servers?.close();
    this.previews.set(siteId, { status, servers });
    return this.setPreview(siteId, status);
  }

  stopPreview(siteId: string): PreviewStatus {
    this.previews.get(siteId)?.servers?.close();
    this.previews.set(siteId, { status: { state: "stopped", url: null, baselineUrl: null, baselineSource: null, log: [] } });
    return this.setPreview(siteId, { state: "stopped", url: null, baselineUrl: null, baselineSource: null, detail: "Preview off", log: [] });
  }

  /** Clone and create: a job with progress events, then a new site. */
  runJob(kind: "clone" | "create", label: string, make: () => MockSite, fail?: string): Job {
    const job: Job = { id: randomUUID(), kind, label, state: "running", progress: 0, detail: "Starting…", startedAt: Date.now() };
    this.jobs.set(job.id, job);
    const steps = kind === "clone" ? ["Contacting the host…", "Copying files…", "Copying files…", "Reading the site…"] : ["Copying the starter…", "Setting up versions…", "Installing the site’s tools…", "Reading the site…"];
    void (async () => {
      for (let i = 0; i < steps.length; i++) {
        await sleep(700);
        Object.assign(job, { progress: (i + 1) / (steps.length + 1), detail: steps[i] });
        this.emit({ type: "job", job: { ...job } });
        if (fail && i === 0) {
          Object.assign(job, { state: "error", detail: fail, finishedAt: Date.now() });
          this.emit({ type: "job", job: { ...job } });
          return;
        }
      }
      const site = make();
      this.sites.set(site.id, site);
      this.previews.set(site.id, { status: { state: "idle", url: null, baselineUrl: null, baselineSource: null, log: [] } });
      this.threads.set(site.id, []);
      Object.assign(job, { state: "done", progress: 1, detail: `${site.name} is ready to edit.`, siteId: site.id, finishedAt: Date.now() });
      this.emit({ type: "job", job: { ...job } });
      this.emit({ type: "sites.updated" });
    })();
    return { ...job };
  }

  /** The pretend disk for GET /api/fs/list. */
  listDir(path: string): RouteResponse<"GET /api/fs/list"> {
    const normalized = path.replace(/\/+$/, "") || "/";
    const siteFolders = [...this.sites.values()].filter((site) => !site.seed.missing).map((site) => site.root);
    const tree: Record<string, Array<{ name: string; isSite: boolean }>> = {
      "/": [{ name: "Users", isSite: false }],
      "/Users": [{ name: "you", isSite: false }],
      [HOME]: ["Desktop", "Documents", "Downloads", "Sites"].map((name) => ({ name, isSite: false })),
      [`${HOME}/Documents`]: [{ name: "Notes", isSite: false }, { name: "portfolio-site", isSite: true }],
      [`${HOME}/Desktop`]: [],
      [`${HOME}/Downloads`]: [],
      [SITES_DIR]: [{ name: "archive", isSite: false }, { name: "sketches", isSite: false }],
      [`${SITES_DIR}/archive`]: [],
      [`${SITES_DIR}/sketches`]: [],
    };
    for (const root of siteFolders) {
      const parent = root.slice(0, root.lastIndexOf("/"));
      const name = root.slice(root.lastIndexOf("/") + 1);
      tree[parent] = [...(tree[parent] ?? []).filter((e) => e.name !== name), { name, isSite: true }];
      tree[root] = ["public", "src"].map((n) => ({ name: n, isSite: false }));
    }
    const entries = tree[normalized];
    if (!entries) throw new MockError("not-found", `There’s no folder at ${normalized}.`);
    return {
      path: normalized,
      parent: normalized === "/" ? null : normalized.slice(0, normalized.lastIndexOf("/")) || "/",
      entries: entries
        .map((entry) => ({ name: entry.name, path: `${normalized === "/" ? "" : normalized}/${entry.name}`, isSite: entry.isSite }))
        .sort((a, b) => Number(b.isSite) - Number(a.isSite) || a.name.localeCompare(b.name)),
    };
  }
}

function candidateSvg(prompt: string, index: number, aspect = "16:9"): Buffer {
  const [w, h] = aspect.split(":").map(Number) as [number, number];
  const width = 1200;
  const height = Math.round((width * h) / w);
  const fills = ["#D9CBB8", "#C9D3DA", "#D3DBD6", "#E2D4C6"];
  const words = prompt.length > 60 ? `${prompt.slice(0, 57)}…` : prompt;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${fills[index % fills.length]}"/><text x="50%" y="50%" text-anchor="middle" font-family="sans-serif" font-size="34" fill="#3a3a32">${words.replace(/[<&]/g, "")}</text><text x="50%" y="58%" text-anchor="middle" font-family="monospace" font-size="20" fill="#6b6356">placeholder ${index + 1}</text></svg>`,
  );
}

const ok = { ok: true } as const;

/**
 * "Import fields from the provider's form": a believable field list for the
 * providers that offer it, refused when the settings that name the form are
 * missing — the shape the real server will answer with.
 */
function introspectForm(provider: string, settings: { [key: string]: unknown }): RouteResponse<"POST /api/sites/:siteId/forms/introspect"> {
  const sizes = [
    { value: "1-10", label: "1–10" },
    { value: "11-50", label: "11–50" },
    { value: "51-200", label: "51–200" },
    { value: "201-1000", label: "201–1,000" },
    { value: "1001+", label: "More than 1,000" },
  ];
  if (provider === "hubspot") {
    if (!settings.portalId || !settings.formId) throw new MockError("invalid", "Add the Hub ID and the form ID, then try again.");
    return {
      fields: [
        { name: "email", label: "Email", type: "email", required: true },
        { name: "firstname", label: "First name", type: "text" },
        { name: "lastname", label: "Last name", type: "text" },
        { name: "company", label: "Company name", type: "text" },
        { name: "numemployees", label: "Number of employees", type: "select", options: sizes },
        { name: "phone", label: "Phone number", type: "phonenumber" },
      ],
    };
  }
  if (provider === "marketo") {
    if (!settings.munchkinId || !settings.formId) throw new MockError("invalid", "Add the Munchkin ID and the form ID, then try again.");
    return {
      fields: [
        { name: "Email", label: "Email address", type: "email", required: true },
        { name: "FirstName", label: "First name", type: "string" },
        { name: "LastName", label: "Last name", type: "string", required: true },
        { name: "Company", label: "Company", type: "string" },
        { name: "Country", label: "Country", type: "select", options: [{ value: "US", label: "United States" }, { value: "GB", label: "United Kingdom" }, { value: "DE", label: "Germany" }] },
      ],
    };
  }
  throw new MockError("invalid", "This destination can’t share its fields. Add them by hand.");
}
const num = (value: string | undefined) => (value === undefined || value === "" ? undefined : Number(value));

/** Every route in ApiRoutes, answered from memory. */
export function createHandlers(mock: MockBackend): Handlers {
  const author = () => mock.settings.author;
  const deploy = createMockDeploy(mock);
  const redirects = createMockRedirects((event) => mock.emit(event), (job) => mock.jobs.set(job.id, job));
  const multiSite = createMultiSite(mock);
  const visibility = createMockVisibility(mock);
  const plugins = createMockPlugins(mock);
  const siteBrand = createMockBrand(mock);
  const wordpress = createMockImport(mock);
  mock.pluginImageProviders = plugins.imageProviders;
  return {
    ...inboxHandlers((event) => mock.emit(event)),
    ...siteKitHandlers(mock),
    ...deploy.handlers,
    ...redirects.handlers,
    ...multiSite.handlers,
    ...visibility.handlers,
    ...plugins.handlers,
    ...siteBrand.handlers,
    ...wordpress.handlers,
    ...installHandlers(),
    ...accountsHandlers(),
    ...hostingHandlers(mock),
    "GET /api/meta": ({ search }) => {
      if (search.get("token")) mock.authenticated = true;
      const meta: MetaInfo = { version: VERSION, brand: DEFAULT_BRAND, mode: mock.options.mode, authenticated: mock.authenticated, desktop: false, platform: process.platform };
      return meta;
    },
    "POST /api/auth/login": ({ body }) => {
      if (body.password !== "proof") throw new MockError("unauthorized", "That password isn’t right.");
      mock.authenticated = true;
      return ok;
    },
    "POST /api/auth/logout": () => {
      mock.authenticated = false;
      return ok;
    },
    "GET /api/events": () => ({ kind: "sse" }),

    "GET /api/settings": () => mock.fullSettings(),
    "PATCH /api/settings": ({ body }) => {
      const s = mock.settings;
      if (body.ai) s.ai = { ...s.ai, ...body.ai };
      if (body.images) s.images = { ...s.images, ...body.images };
      if (body.videos) {
        const current = s.videos ?? { provider: null, model: null };
        // Another service forgets the model chosen for the previous one, as the engine does.
        s.videos = { ...current, ...(body.videos.provider !== undefined && body.videos.provider !== current.provider && body.videos.model === undefined ? { model: null } : {}), ...body.videos };
      }
      if (body.author) s.author = { ...s.author, ...body.author };
      if (body.appearance) s.appearance = { ...s.appearance, ...body.appearance };
      return mock.fullSettings();
    },
    "PUT /api/secrets/:name": ({ params, body }) => {
      const name = params.name as SecretName;
      const current = mock.secrets[name];
      if (!current) throw new MockError("invalid", `There’s no key called “${params.name}”.`);
      if (current.source === "env") throw new MockError("forbidden", "This key comes from the environment the app was started in, so it can’t be changed here.");
      mock.secrets[name] = body.value ? { name, configured: true, source: "stored", hint: body.value.slice(-4) } : { name, configured: false, source: null };
      return mock.secrets[name];
    },
    "GET /api/usage": () => usage(),

    "GET /api/sites": () => [...mock.sites.values()].map((site) => multiSite.withListing(site.summaryInfo())),
    "POST /api/sites/open": ({ body }) => {
      const path = body.path.replace(/\/+$/, "");
      let site = [...mock.sites.values()].find((candidate) => candidate.root === path && !candidate.seed.missing);
      if (!site) {
        const listing = (() => {
          try {
            return mock.listDir(path.slice(0, path.lastIndexOf("/")) || "/");
          } catch {
            return null;
          }
        })();
        const entry = listing?.entries.find((e) => e.path === path);
        if (!entry?.isSite) throw new MockError("invalid", "This folder doesn’t look like a site — there’s no package.json or content in it. Choose the folder that holds the whole site.", path);
        // The folder that was chosen, wherever it is.
        site = newSiteFrom("docs", entry.name.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()), path);
        mock.sites.set(site.id, site);
        mock.previews.set(site.id, { status: { state: "idle", url: null, baselineUrl: null, baselineSource: null, log: [] } });
        mock.threads.set(site.id, []);
        mock.emit({ type: "sites.updated" });
      }
      site.lastOpenedAt = Date.now();
      return { ...site.summaryInfo(), model: site.model(), git: site.git(), hasConfig: Boolean(site.config), preview: mock.previews.get(site.id)?.status ?? { state: "idle", url: null, baselineUrl: null, baselineSource: null, log: [] } };
    },
    "POST /api/sites/clone": ({ body }) => {
      const name = body.url.replace(/\.git$/, "").split(/[/:]/).pop() ?? "site";
      const fail = /fail|private/.test(body.url) ? "The host refused access. Check the address, and that your account can see this site." : undefined;
      return mock.runJob("clone", `Cloning ${name}`, () => newSiteFrom("docs", name.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()), name), fail);
    },
    "POST /api/sites/create": ({ body }) => {
      const folder = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      return mock.runJob("create", `Creating ${body.name}`, () => newSiteFrom("starter", body.name, folder));
    },
    "GET /api/starters": () => [{ id: "astro-starter", name: "Marketing site (Astro)", description: starterDescription(), framework: "astro" }],
    "GET /api/starters/:starterId/preview": ({ params, query }) => ({ kind: "bytes", type: "image/svg+xml", body: candidateSvg(`${params.starterId}${query.look ? ` · ${query.look}` : ""}`, 0, "3:2") }),
    "GET /api/jobs/:jobId": ({ params }) => {
      const job = mock.jobs.get(params.jobId);
      if (!job) throw new MockError("not-found", "That job has finished and been forgotten.");
      return job;
    },
    "GET /api/fs/list": ({ query }) => mock.listDir(query.path ?? SITES_DIR),
    "GET /api/open": ({ query }) => {
      const root = (query.root ?? "").replace(/\/+$/, "");
      if (!root.startsWith("/")) throw new MockError("invalid", "That link isn’t one this app can open.");
      const site = [...mock.sites.values()].find((candidate) => candidate.root === root && !candidate.seed.missing);
      if (site) return { state: "ready", siteId: site.id, entry: query.url ? site.entryForUrl(query.url) : null };
      const parent = (() => {
        try {
          return mock.listDir(root.slice(0, root.lastIndexOf("/")) || "/");
        } catch {
          return null;
        }
      })();
      const folder = parent?.entries.find((entry) => entry.path === root);
      if (!folder?.isSite) throw new MockError("invalid", "That link isn’t one this app can open.", `No site at ${root}`);
      return { state: "unregistered", name: folder.name, root };
    },

    "GET /api/sites/:siteId": ({ params }) => {
      const site = mock.sites.get(params.siteId);
      if (!site) throw new MockError("not-found", "This site isn’t in your list. It may have been forgotten.");
      site.lastOpenedAt = Date.now();
      const preview = mock.previews.get(site.id)?.status ?? { state: "idle", url: null, baselineUrl: null, baselineSource: null, log: [] };
      return { ...site.summaryInfo(), model: site.model(), git: site.git(), hasConfig: Boolean(site.config), preview };
    },
    "DELETE /api/sites/:siteId": ({ params }) => {
      mock.previews.get(params.siteId)?.servers?.close();
      mock.sites.delete(params.siteId);
      mock.emit({ type: "sites.updated" });
      return ok;
    },
    "POST /api/sites/:siteId/refresh": ({ params }) => {
      const model = mock.site(params.siteId).model();
      mock.emit({ type: "site.updated", siteId: params.siteId });
      return model;
    },
    "GET /api/sites/:siteId/config": ({ params }) => {
      const site = mock.site(params.siteId);
      return { config: site.config, detected: site.detectedModel() };
    },
    "PUT /api/sites/:siteId/config": ({ params, body }) => {
      const site = mock.site(params.siteId);
      site.config = body.config;
      site.write("galley.config.json", Buffer.from(`${JSON.stringify(body.config, null, 2)}\n`));
      mock.emit({ type: "site.updated", siteId: site.id });
      mock.changed(site.id, ["galley.config.json"], "user");
      return site.model();
    },

    "GET /api/sites/:siteId/entries": ({ params, query }) => {
      const entryQuery: EntryQuery = {
        search: query.search,
        status: query.status as EntryQuery["status"],
        sort: query.sort as EntryQuery["sort"],
        order: query.order as EntryQuery["order"],
        offset: num(query.offset),
        limit: num(query.limit),
      };
      return mock.site(params.siteId).listEntries(query.collection ?? "", entryQuery);
    },
    "GET /api/sites/:siteId/entry": ({ params, query }) => mock.site(params.siteId).readEntry(query.path ?? ""),
    "PATCH /api/sites/:siteId/entry": ({ params, query, body }) => {
      const site = mock.site(params.siteId);
      const path = query.path ?? "";
      if (body.baseHash && site.readEntry(path).hash !== body.baseHash) throw new MockError("conflict", "This page changed while you were editing it. Your edit wasn’t applied; reload to see the latest.");
      const result = site.updateEntry(path, body.ops);
      if (result.applied > 0) mock.changed(site.id, [path], "user");
      return result;
    },
    "POST /api/sites/:siteId/entries": ({ params, body }) => {
      const entry = mock.site(params.siteId).createEntry(body);
      mock.changed(params.siteId, [entry.path], "user");
      mock.emit({ type: "site.updated", siteId: params.siteId });
      return entry;
    },
    "DELETE /api/sites/:siteId/entry": ({ params, query }) => {
      mock.site(params.siteId).deleteEntry(query.path ?? "");
      mock.changed(params.siteId, [query.path ?? ""], "user");
      mock.emit({ type: "site.updated", siteId: params.siteId });
      return ok;
    },
    "POST /api/sites/:siteId/forms/introspect": ({ params, body }) => {
      mock.site(params.siteId);
      return introspectForm(body.provider, body.settings);
    },
    "GET /api/sites/:siteId/search": ({ params, query }) => mock.site(params.siteId).search(query.q ?? "", query.collection, num(query.limit)),
    "POST /api/sites/:siteId/resolve": ({ params, body }) => mock.site(params.siteId).resolve(body),
    "GET /api/sites/:siteId/route": ({ params, query }) => ({ entry: mock.site(params.siteId).entryForUrl(query.url ?? "/") }),
    "POST /api/sites/:siteId/validate": ({ params, body }) => {
      const site = mock.site(params.siteId);
      const media = new Set(site.media().map((item) => item.url));
      const paths = body.paths ?? site.changes().files.map((f) => f.path);
      const issues = paths.flatMap((path) => {
        if (!site.collectionOf(path) || !site.read(path)) return [];
        const entry = site.readEntry(path);
        return Object.entries(entry.data)
          .filter(([key, value]) => /image|photo/i.test(key) && typeof value === "string" && value.startsWith("/") && !media.has(value))
          .map(([key, value]) => ({ severity: "error" as const, code: "broken-image", message: `The image “${String(value).split("/").pop()}” is missing.`, path, field: [key] }));
      });
      return { issues };
    },

    "GET /api/sites/:siteId/files": ({ params, query }) => ({ files: mock.site(params.siteId).listFiles(query.glob, num(query.limit)) }),
    "GET /api/sites/:siteId/file": ({ params, query }) => {
      const path = query.path ?? "";
      const bytes = mock.site(params.siteId).read(path);
      if (!bytes) throw new MockError("not-found", `There’s no file at ${path}.`);
      const binary = /\.(png|jpe?g|webp|gif|avif)$/i.test(path);
      return { path, content: binary ? bytes.toString("base64") : bytes.toString("utf8"), hash: bytes.toString("base64").slice(-16), binary };
    },
    "PUT /api/sites/:siteId/file": ({ params, query, body }) => {
      const site = mock.site(params.siteId);
      const path = query.path ?? "";
      if ((body.mode ?? "content") === "content" && !site.collectionOf(path) && !path.startsWith(site.model().media.dir)) {
        throw new MockError("forbidden", "That file can’t be edited here. In content mode only pages and images can change.");
      }
      site.write(path, Buffer.from(body.content));
      mock.changed(site.id, [path], "user");
      return ok;
    },

    "GET /api/sites/:siteId/media": ({ params }) => ({ items: mock.site(params.siteId).media() }),
    "POST /api/sites/:siteId/media": ({ params, body }) => {
      const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(body.data);
      if (!match) throw new MockError("invalid", "That file couldn’t be read. Try uploading it again.");
      const bytes = match[2] ? Buffer.from(match[3] ?? "", "base64") : Buffer.from(decodeURIComponent(match[3] ?? ""));
      const item = mock.site(params.siteId).saveMedia(body.filename, body.directory, bytes);
      mock.changed(params.siteId, [item.path], "user");
      return item;
    },
    "DELETE /api/sites/:siteId/media": ({ params, query }) => {
      mock.site(params.siteId).write(query.path ?? "", null);
      mock.changed(params.siteId, [query.path ?? ""], "user");
      return ok;
    },
    "GET /api/sites/:siteId/raw": ({ params, query }) => {
      const path = query.path ?? "";
      const bytes = mock.site(params.siteId).read(path, query.rev === "base" ? "base" : undefined);
      if (!bytes) throw new MockError("not-found", `There’s no file at ${path}.`);
      const type = path.endsWith(".svg") ? "image/svg+xml" : path.endsWith(".png") ? "image/png" : /\.jpe?g$/.test(path) ? "image/jpeg" : path.endsWith(".webp") ? "image/webp" : path.endsWith(".mp4") ? "video/mp4" : "text/plain; charset=utf-8";
      return { kind: "bytes", type, body: bytes };
    },

    "GET /api/images/providers": () => ({ providers: mock.fullSettings().images.providers }),
    "POST /api/sites/:siteId/images/generate": async ({ params, body }) => {
      mock.site(params.siteId);
      await sleep(900);
      const count = Math.min(4, Math.max(1, body.count ?? 2));
      const candidates: ImageCandidate[] = Array.from({ length: count }, (_, index) => {
        const id = randomUUID();
        const bytes = candidateSvg(body.prompt, index, body.aspect);
        mock.candidates.set(id, { bytes, mime: "image/svg+xml" });
        return { id, mime: "image/svg+xml", ...imageSize("x.svg", bytes), previewUrl: `/api/images/candidates/${id}`, prompt: body.prompt, provider: body.provider ?? "mock", model: body.model ?? "labelled" };
      });
      return { candidates };
    },
    "GET /api/images/candidates/:candidateId": ({ params }) => {
      const candidate = mock.candidates.get(params.candidateId);
      if (!candidate) throw new MockError("not-found", "That image was discarded.");
      return { kind: "bytes", type: candidate.mime, body: candidate.bytes };
    },
    "POST /api/sites/:siteId/images/save": ({ params, body }) => {
      const candidate = mock.candidates.get(body.candidateId);
      if (!candidate) throw new MockError("not-found", "That image was discarded. Generate it again.");
      const item = mock.site(params.siteId).saveMedia(`${body.filename ?? "generated-image"}.svg`, body.directory, candidate.bytes);
      mock.candidates.delete(body.candidateId);
      mock.changed(params.siteId, [item.path], "user");
      return item;
    },
    "DELETE /api/images/candidates/:candidateId": ({ params }) => {
      mock.candidates.delete(params.candidateId);
      return ok;
    },

    "GET /api/sites/:siteId/changes": ({ params }) => mock.site(params.siteId).changes(),
    "GET /api/sites/:siteId/diff": ({ params, query }) => {
      const path = query.path ?? "";
      return mock.site(params.siteId).diff(path, (rev) => `/api/sites/${encodeURIComponent(params.siteId)}/raw?path=${encodeURIComponent(path)}${rev ? `&rev=${rev}` : ""}`);
    },
    "POST /api/sites/:siteId/discard": ({ params, body }) => {
      const site = mock.site(params.siteId);
      const paths = body.paths ?? site.changes().files.map((f) => f.path);
      site.discard(body.paths);
      mock.changed(site.id, paths, "discard");
      return site.changes();
    },
    "POST /api/sites/:siteId/publish": async ({ params, body }) => {
      const site = mock.site(params.siteId);
      await sleep(900);
      const result = site.publish(body, author());
      if (result.ok) {
        mock.changed(site.id, result.files, "publish");
        mock.emit({ type: "site.updated", siteId: site.id });
        deploy.afterPublish(site.id);
      }
      return result;
    },
    "GET /api/sites/:siteId/history": ({ params, query }) => ({ items: mock.site(params.siteId).history.slice(0, num(query.limit) ?? 50) }),
    "POST /api/sites/:siteId/revert": async ({ params, body }) => {
      await sleep(600);
      const result = mock.site(params.siteId).revert(body.commit, author());
      mock.changed(params.siteId, result.files, "undo");
      return result;
    },
    "POST /api/sites/:siteId/send": async ({ params }) => {
      const site = mock.site(params.siteId);
      await sleep(700);
      const result = site.send();
      if (result.pushed) mock.emit({ type: "site.updated", siteId: site.id });
      return result;
    },
    "GET /api/sites/:siteId/git": ({ params }) => mock.site(params.siteId).git(),
    "POST /api/sites/:siteId/git/check": async ({ params }) => {
      await sleep(250);
      return mock.site(params.siteId).check();
    },
    "POST /api/sites/:siteId/pull": async ({ params }) => {
      await sleep(700);
      const status = mock.site(params.siteId).pull();
      mock.changed(params.siteId, [], "external");
      return status;
    },
    "POST /api/sites/:siteId/publish/message": ({ params, body }) => {
      const site = mock.site(params.siteId);
      const files = site.changes().files.filter((f) => !body.paths || body.paths.includes(f.path));
      const titles = files.map((f) => f.title ?? f.path.split("/").pop() ?? f.path);
      return { message: titles.length === 0 ? "Publish changes" : titles.length === 1 ? `Update ${titles[0]}` : `Update ${titles[0]} and ${titles.length - 1} more` };
    },
    "POST /api/sites/:siteId/publish/check": ({ params, body }) => {
      const site = mock.site(params.siteId);
      const files = site.changes().files.filter((f) => !body.paths || body.paths.includes(f.path));
      // The first site's own plugin (mock/plugins.ts) has a publish check: a new post shows what its warning looks like.
      const namesThePlugin = [...mock.sites.values()][0]?.id === params.siteId;
      const added = namesThePlugin ? files.filter((f) => f.status === "added" && f.kind === "content") : [];
      return {
        warnings: added.map((f) => ({ plugin: "Harbour tools", message: `“${f.title ?? f.path}” is new: its opening hours line hasn’t been checked against the shop’s hours.` })),
        refusal: null,
      };
    },

    "GET /api/sites/:siteId/preview": ({ params }) => {
      mock.site(params.siteId);
      return mock.previews.get(params.siteId)?.status ?? { state: "idle", url: null, baselineUrl: null, baselineSource: null, log: [] };
    },
    "POST /api/sites/:siteId/preview/start": ({ params }) => {
      void mock.startPreview(params.siteId);
      return mock.previews.get(params.siteId)?.status ?? { state: "starting", url: null, baselineUrl: null, baselineSource: null, log: [] };
    },
    "POST /api/sites/:siteId/preview/stop": ({ params }) => mock.stopPreview(params.siteId),
    "POST /api/sites/:siteId/preview/restart": ({ params }) => {
      mock.stopPreview(params.siteId);
      void mock.startPreview(params.siteId);
      return mock.previews.get(params.siteId)?.status ?? { state: "starting", url: null, baselineUrl: null, baselineSource: null, log: [] };
    },
    "POST /api/sites/:siteId/preview/entry": ({ params }) => {
      const status = mock.previews.get(params.siteId)?.status;

      return { preview: status?.url ?? null, baseline: status?.baselineUrl ?? null };
    },
    "POST /api/sites/:siteId/build": async ({ params }) => {
      const site = mock.site(params.siteId);
      await sleep(1500);
      const pages = site.model().collections.reduce((sum, c) => sum + (c.url ? c.count : 0), 0);
      return { ok: true, output: `$ ${site.model().build?.command ?? "npm run build"}\n  building ${pages} pages…\n  done in 1.42 s`, durationMs: 1420 };
    },

    "GET /api/sites/:siteId/threads": ({ params }) => {
      mock.site(params.siteId);
      return { threads: (mock.threads.get(params.siteId) ?? []).map(({ messages: _messages, ...summary }) => summary).sort((a, b) => b.updatedAt - a.updatedAt) };
    },
    "POST /api/sites/:siteId/threads": ({ params, body }) => {
      mock.site(params.siteId);
      const thread: ChatThread = { id: randomUUID(), title: body.title ?? "New conversation", mode: body.mode ?? "content", createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0, busy: false, messages: [] };
      mock.threads.set(params.siteId, [thread, ...(mock.threads.get(params.siteId) ?? [])]);
      return thread;
    },
    "GET /api/sites/:siteId/threads/:threadId": ({ params }) => {
      const thread = mock.threads.get(params.siteId)?.find((t) => t.id === params.threadId);
      if (!thread) throw new MockError("not-found", "That conversation was deleted.");
      return thread;
    },
    "PATCH /api/sites/:siteId/threads/:threadId": ({ params, body }) => {
      const thread = mock.threads.get(params.siteId)?.find((t) => t.id === params.threadId);
      if (!thread) throw new MockError("not-found", "That conversation was deleted.");
      const title = body.title.trim().replace(/\s+/g, " ").slice(0, 120);
      if (!title) throw new MockError("invalid", "Give the chat a name.");
      thread.title = title;
      const { messages: _messages, ...summary } = thread;
      return summary;
    },
    "DELETE /api/sites/:siteId/threads/:threadId": ({ params }) => {
      mock.threads.set(params.siteId, (mock.threads.get(params.siteId) ?? []).filter((t) => t.id !== params.threadId));
      return ok;
    },
    "POST /api/sites/:siteId/threads/:threadId/messages": ({ params, body }) => {
      const site = mock.site(params.siteId);
      const thread = mock.threads.get(params.siteId)?.find((t) => t.id === params.threadId);
      if (!thread) throw new MockError("not-found", "That conversation was deleted.");
      if (thread.busy) throw new MockError("busy", "The assistant is still answering. Wait for it to finish, or stop it.");
      return runTurn(mock, site, thread, body);
    },
    "POST /api/sites/:siteId/threads/:threadId/cancel": ({ params }) => {
      const thread = mock.threads.get(params.siteId)?.find((t) => t.id === params.threadId);
      if (thread) thread.busy = false;
      return ok;
    },
    "POST /api/sites/:siteId/threads/:threadId/undo": ({ params, body }) => {
      const site = mock.site(params.siteId);
      const thread = mock.threads.get(params.siteId)?.find((t) => t.id === params.threadId);
      if (!thread) throw new MockError("not-found", "That conversation was deleted.");
      return { restored: undoTurn(mock, site, thread, body.turnId) };
    },
  };
}
