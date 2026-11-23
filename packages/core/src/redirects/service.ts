/**
 * The redirects service: the list file in the site, the host's own file kept
 * in step with it, and the Cloudflare sync — everything through SiteService,
 * like every other feature.
 *
 * Writes:
 *   - Saving the list (the screen, an import) writes the list file and, when
 *     it is safe, the host's file, as ordinary pending changes for Proof.
 *   - The list edited any other way inside the app (the assistant's entry
 *     tools, the form editor, Undo, Discard) is followed by the same
 *     regeneration, from the `changes.updated` event.
 *   - Edits from outside the app (an editor, `git pull`) are never followed
 *     by a write: the screen shows the host's file as out of step and offers
 *     the update, because writing in reaction to a checkout or a pull would
 *     leave changes nobody asked for.
 *   - A host file edited by hand (or one the site already had) is never
 *     replaced without the person saying so.
 *
 * The Cloudflare access key is read from the settings service (secret
 * "cloudflare") at the moment of a call and never leaves this module; every
 * error is scrubbed of it.
 */
import { existsSync } from "node:fs";
import { GalleyError } from "../errors";
import { createJobTracker } from "../site/jobs";
import type { EventBus, GalleyConfig, Job, SettingsService, SiteModel, SiteRegistry, SiteService } from "../types";
import { writeRefusal } from "../workspace/policy";
import { checkRedirects, hostUsage } from "./check";
import { applyCloudflare, checkCloudflare, CLOUDFLARE_API, hostnameProblem, itemsHash, missingPermissionError, planCloudflare, probeCloudflare, removeCloudflare, desiredItems, type CloudflareApi, type CloudflareTarget } from "./cloudflare";
import { planDerived, safeToWrite, vercelHash, type DerivedPlan } from "./derived";
import { readList, serializeList, type ReadList } from "./file";
import { exportInfo, renderExport } from "./generate";
import { CLOUDFLARE_BULK_PERMISSIONS, HOST_INFO } from "./info";
import { derivedPath, hostOf, isGeneratedHost, listFileOf, slashStyleOf } from "./locate";

export { slashStyleOf } from "./locate";
import { canonicalOrder } from "./match";
import { hostOf as hostOfUrl, isAbsoluteUrl, isWildcard, lookupKey } from "./path";
import { parseRedirects } from "./parse";
import { reviewImport } from "./review";
import { siteRoutes, type SiteRoutes } from "./routes";
import { readState, updateState } from "./state";
import { traceAddress } from "./trace";
import type {
  CloudflareCheck,
  CloudflarePlan,
  CloudflareSummary,
  DerivedLeftover,
  ImportMode,
  ImportResolutions,
  ImportReview,
  Redirect,
  RedirectExportFormat,
  RedirectHealth,
  RedirectHostId,
  RedirectImportSource,
  RedirectsOverview,
  RedirectTrace,
} from "./types";

export interface RedirectsServiceOptions {
  /** Galley home: what was applied lives in `<home>/state/<siteId>/redirects.json`. */
  home: string;
  settings: Pick<SettingsService, "readSecret" | "get">;
  events: EventBus;
  /** To follow list edits made through other parts of the app. Absent: only this service's own saves regenerate. */
  registry?: Pick<SiteRegistry, "get">;
  /** Test seam. */
  fetch?: typeof fetch;
  /** Cloudflare's API origin; tests and the rehearsal point it at a fake. Default: GALLEY_REDIRECTS_CLOUDFLARE_API, then the real API. */
  cloudflareApi?: string;
  /** Between polls of Cloudflare's asynchronous list operations. */
  pollMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface ImportInput {
  /** Pasted text or an uploaded file's text. */
  text?: string;
  /** Or a file in the site to read (the WordPress import's list, an existing `_redirects`). */
  path?: string;
  filename?: string;
  mode?: ImportMode;
  resolutions?: ImportResolutions;
  /** Domains the person said are this site's, for full old addresses. */
  siteHosts?: string[];
}

export interface RedirectsService {
  overview(site: SiteService): Promise<RedirectsOverview>;
  /** Replace the list (inline edits, add one, delete, Undo). `baseHash` refuses when the file changed underneath. */
  save(site: SiteService, input: { redirects: Redirect[]; baseHash?: string | null }): Promise<RedirectsOverview>;
  review(site: SiteService, input: ImportInput): Promise<ImportReview>;
  /** Exactly what `review` showed, written as one pending change. Refused while a loop blocks it. */
  confirm(site: SiteService, input: ImportInput & { baseHash?: string | null }): Promise<{ overview: RedirectsOverview; review: ImportReview }>;
  trace(site: SiteService, address: string): Promise<RedirectTrace>;
  /** Choose the host (when deploy doesn't say) and the Cloudflare account and domains. */
  configure(site: SiteService, patch: { host?: RedirectHostId | null; cloudflare?: { account?: string | null; hostnames?: string[] | null } }): Promise<RedirectsOverview>;
  /** The person said to replace a host file that was edited by hand (or the site's own). */
  replaceDerived(site: SiteService): Promise<RedirectsOverview>;
  /** Remove a host file this app wrote for a host the site no longer uses. */
  removeLeftover(site: SiteService, path: string): Promise<RedirectsOverview>;
  exportList(site: SiteService, format: RedirectExportFormat, options?: { hostname?: string }): Promise<{ filename: string; type: string; body: string }>;
  health(site: SiteService): Promise<RedirectHealth>;
  cloudflarePlan(site: SiteService): Promise<CloudflarePlan>;
  /** Starts a `redirects` job; progress arrives as `job` events. */
  cloudflareApply(site: SiteService, input: { planId: string }): Promise<Job>;
  cloudflareCheck(site: SiteService): Promise<CloudflareCheck>;
  cloudflareRemove(site: SiteService): Promise<RedirectsOverview>;
  job(id: string): Job | null;
  dispose(): void;
}

const FOLLOWED = new Set(["user", "agent", "undo", "discard"]);

function siteHostsOf(model: SiteModel, extra: string[] = []): string[] {
  const hosts = new Set<string>();

  for (const url of [model.urls.production, model.urls.staging, model.deploy?.productionUrl]) {
    const host = url ? hostOfUrl(url) : null;

    if (host) hosts.add(host);
  }
  for (const host of [...(model.redirects?.cloudflare?.hostnames ?? []), ...extra]) if (host.trim()) hosts.add(host.trim().toLowerCase());
  return [...hosts];
}

function suggestHost(site: SiteService): { id: RedirectHostId; reason: string } | undefined {
  const has = (path: string) => existsSync(site.resolvePath(path));

  if (has("netlify.toml")) return { id: "netlify", reason: "This site has a netlify.toml file, so it looks like it's on Netlify." };
  if (has("vercel.json")) return { id: "vercel", reason: "This site has a vercel.json file, so it looks like it's on Vercel." };
  if (has("wrangler.toml") || has("wrangler.json") || has("wrangler.jsonc")) return { id: "cloudflare", reason: "This site has a Wrangler file, so it looks like it's on Cloudflare." };
  return undefined;
}

export function createRedirectsService(options: RedirectsServiceOptions): RedirectsService {
  const env = options.env ?? process.env;
  const jobs = createJobTracker(options.events);
  const lastJob = new Map<string, string>();
  const locks = new Map<string, Promise<unknown>>();
  const doFetch = options.fetch ?? fetch;

  /** One write at a time per site: a save and the regeneration it triggers never interleave. */
  function locked<T>(siteId: string, work: () => Promise<T>): Promise<T> {
    const previous = locks.get(siteId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);

    locks.set(
      siteId,
      next.catch(() => undefined)
    );
    return next;
  }

  async function readText(site: SiteService, path: string): Promise<{ content: string; hash: string } | null> {
    if (!existsSync(site.resolvePath(path))) return null;
    try {
      const file = await site.readFile(path);

      return { content: file.content, hash: file.hash };
    } catch (error) {
      if (error instanceof GalleyError && error.code === "not-found") return null;
      throw error;
    }
  }

  async function loadList(site: SiteService, model: SiteModel) {
    const file = listFileOf(model);
    const text = await readText(site, file);
    const read: ReadList = text ? readList(text.content) : { ok: true, redirects: [] };

    return { file, text, read };
  }

  async function planFor(site: SiteService, model: SiteModel, list: Redirect[], routes: SiteRoutes): Promise<DerivedPlan | null> {
    const host = hostOf(model).id;

    if (!isGeneratedHost(host)) return null;
    const path = derivedPath(host, model);
    const current = await readText(site, path);
    const state = host === "vercel" ? await readState(options.home, site.id) : null;

    return planDerived({
      host,
      path,
      current: current?.content ?? null,
      list,
      listFile: listFileOf(model),
      ...(host === "netlify" ? { force: (from: string) => !isWildcard(from) && !from.includes("?") && routes.page(from) !== null } : {}),
      lastWritten: state?.written[path] ?? null,
    });
  }

  async function writeDerived(site: SiteService, plan: DerivedPlan, origin: "user" | "agent"): Promise<void> {
    if (plan.next === null || plan.next === plan.current) return;
    await site.writeFile(plan.path, plan.next, { origin, mode: "content" });
    if (plan.host === "vercel" && plan.writtenHash) {
      const hash = plan.writtenHash;

      await updateState(options.home, site.id, (state) => ({ ...state, written: { ...state.written, [plan.path]: hash } }));
    }
  }

  /** The list file and the host's file must be writable in content mode; the config's `redirects` block is what makes them so. */
  async function ensureWritable(site: SiteService, model: SiteModel): Promise<SiteModel> {
    const file = listFileOf(model);

    if (!writeRefusal(file, model.writable, "content")) return model;
    const config = (await site.readConfig()) ?? {};

    if (!config.redirects) {
      const next: GalleyConfig = { ...config, redirects: { file } };
      const saved = await site.saveConfig(next);

      if (!writeRefusal(listFileOf(saved), saved.writable, "content")) return saved;
    }
    throw new GalleyError("forbidden", `The redirects list (${file}) isn't one of the files this site lets the app change. Add it to the writable files in the site settings.`, file);
  }

  async function write(site: SiteService, list: Redirect[], baseHash: string | null | undefined, origin: "user" | "agent"): Promise<void> {
    let model = await site.model();
    const loaded = await loadList(site, model);

    if (!loaded.read.ok) throw new GalleyError("invalid", `${loaded.read.problem} The file itself needs fixing first — a developer can do that — then try again. Nothing was changed.`);
    if (baseHash !== undefined && (loaded.text?.hash ?? null) !== baseHash) {
      throw new GalleyError("conflict", "The redirects changed while you were working (in another window, or by the assistant). Look at the list again, then repeat your change. Nothing was changed.");
    }
    validateList(list);
    model = await ensureWritable(site, model);
    const text = serializeList(list);

    if (text !== loaded.text?.content) await site.writeFile(listFileOf(model), text, { origin, mode: "content" });
    const routes = await siteRoutes(site, model);
    const plan = await planFor(site, model, canonicalOrder(list), routes);

    if (plan && safeToWrite(plan)) await writeDerived(site, plan, origin);
  }

  async function cloudflareSummary(site: SiteService, model: SiteModel, list: Redirect[], usageOver: boolean): Promise<CloudflareSummary> {
    const host = hostOf(model).id;
    const fromDeploy = model.deploy?.target === "cloudflare" ? model.deploy.account : null;
    const account = fromDeploy ?? model.redirects?.cloudflare?.account ?? null;
    const state = await readState(options.home, site.id);
    const hostnames = cloudflareHostnames(model);
    const keyConfigured = Boolean(await options.settings.readSecret("cloudflare").catch(() => null));
    const outOfDate = state.cloudflare ? itemsHash(desiredItems(canonicalOrder(list), state.cloudflare.hostnames).items) !== state.cloudflare.itemsHash : false;
    const jobId = lastJob.get(site.id) ?? null;
    let reason: string;

    if (usageOver) reason = `This list is longer than Cloudflare's file takes (${HOST_INFO.cloudflare.limits.static!.toLocaleString("en-US")} exact addresses and ${HOST_INFO.cloudflare.limits.dynamic} wildcards), so the extra ones only work if they're set on Cloudflare.`;
    else reason = "The file that travels with the site already covers this list. Setting them on Cloudflare as well makes them work at your domain even before a page is published, and for any site on it.";
    return {
      relevant: host === "cloudflare",
      keyConfigured,
      account,
      accountFrom: fromDeploy ? "deploy" : model.redirects?.cloudflare?.account ? "config" : null,
      hostnames,
      recommended: usageOver,
      reason,
      permissions: CLOUDFLARE_BULK_PERMISSIONS,
      last: state.cloudflare,
      outOfDate,
      jobId: jobId && jobs.get(jobId) ? jobId : null,
    };
  }

  function cloudflareHostnames(model: SiteModel): string[] {
    if (model.redirects?.cloudflare?.hostnames?.length) return model.redirects.cloudflare.hostnames;
    const production = model.urls.production ? hostOfUrl(model.urls.production) : null;

    return production && !hostnameProblem(production) ? [production] : [];
  }

  async function cloudflareContext(site: SiteService): Promise<{ api: CloudflareApi; target: CloudflareTarget; list: Redirect[] }> {
    const model = await site.model();
    const token = await options.settings.readSecret("cloudflare");

    if (!token) throw new GalleyError("unconfigured", "Add a Cloudflare access key first, in the site's Online settings (or start the app with CLOUDFLARE_API_TOKEN set).");
    const account = (model.deploy?.target === "cloudflare" ? model.deploy.account : null) ?? model.redirects?.cloudflare?.account;

    if (!account) throw new GalleyError("unconfigured", "Say which Cloudflare account the site's domain is in first.");
    const hostnames = cloudflareHostnames(model);

    if (hostnames.length === 0) throw new GalleyError("unconfigured", "Add the site's own domain first (like www.example.com). Bulk Redirects apply on a domain in your Cloudflare account, not on a workers.dev address.");
    for (const hostname of hostnames) {
      const problem = hostnameProblem(hostname);

      if (problem) throw new GalleyError("invalid", problem);
    }
    const loaded = await loadList(site, model);

    if (!loaded.read.ok) throw new GalleyError("invalid", `${loaded.read.problem} Fix it first; nothing was sent to Cloudflare.`);
    const apiBase = options.cloudflareApi ?? (env.GALLEY_REDIRECTS_CLOUDFLARE_API?.trim() || CLOUDFLARE_API);

    return {
      api: { token, fetch: doFetch, apiBase, ...(options.pollMs !== undefined ? { pollMs: options.pollMs } : {}) },
      target: { account, hostnames, siteId: site.id, siteName: model.name },
      list: canonicalOrder(loaded.read.redirects),
    };
  }

  async function planWithProbe(site: SiteService) {
    const context = await cloudflareContext(site);
    const probe = await probeCloudflare(context.api, context.target.account);

    if (probe.missing.length) throw missingPermissionError(probe.missing);
    return { context, outcome: await planCloudflare(context.api, context.target, context.list) };
  }

  async function importSources(site: SiteService, model: SiteModel, derived: DerivedPlan | null, list: Redirect[]): Promise<RedirectImportSource[]> {
    const out: RedirectImportSource[] = [];
    // So the offer can stay on a list that already has redirects, until these are in it.
    const inList = new Set(list.map((redirect) => lookupKey(redirect.from)));
    const candidates = [
      { path: "wordpress-import/redirects.mjs", label: "The WordPress import's redirects" },
      { path: "wordpress-import/_redirects", label: "The WordPress import's redirects" },
    ];

    if (derived && (derived.state === "foreign" || derived.state === "hand-edited") && derived.current) candidates.push({ path: derived.path, label: `The redirects already in ${derived.path}` });
    const seen = new Set<string>();

    for (const candidate of candidates) {
      const text = await readText(site, candidate.path);

      if (!text) continue;
      const parsed = parseRedirects(text.content, { siteHosts: siteHostsOf(model), trailingSlash: slashStyleOf(model), filename: candidate.path });

      // The importer writes both files with the same list; offer it once.
      if (parsed.redirects.length === 0 || (candidate.path.startsWith("wordpress-import/") && seen.has("wordpress"))) continue;
      if (candidate.path.startsWith("wordpress-import/")) seen.add("wordpress");
      out.push({ ...candidate, count: parsed.redirects.length, waiting: parsed.redirects.filter((redirect) => !inList.has(lookupKey(redirect.from))).length });
    }
    return out;
  }

  async function leftoversOf(site: SiteService, model: SiteModel): Promise<DerivedLeftover[]> {
    const host = hostOf(model).id;
    const out: DerivedLeftover[] = [];

    for (const other of ["cloudflare", "vercel"] as const) {
      const path = derivedPath(other, model);

      if (isGeneratedHost(host) && derivedPath(host, model) === path) continue;
      const text = await readText(site, path);

      if (!text) continue;
      // Only what this app wrote: its _redirects checksum line, or the vercel.json array it remembers writing.
      if (other === "cloudflare" && text.content.includes("-redirects-checksum: ")) out.push({ path, host: "cloudflare" });
      if (other === "vercel") {
        const state = await readState(options.home, site.id);

        try {
          const redirects = (JSON.parse(text.content) as { redirects?: unknown }).redirects;

          if (redirects !== undefined && state.written[path] && vercelHash(redirects) === state.written[path]) out.push({ path, host: "vercel" });
        } catch {
          // Not ours to judge.
        }
      }
    }
    return out;
  }

  async function overview(site: SiteService): Promise<RedirectsOverview> {
    const model = await site.model();
    const loaded = await loadList(site, model);
    const list = loaded.read.redirects;
    const host = hostOf(model);
    const routes = await siteRoutes(site, model);
    const issues = checkRedirects(list, { routes, host: host.id });
    const derived = await planFor(site, model, canonicalOrder(list), routes);
    const usage = host.id ? hostUsage(list, host.id) : null;
    const suggestion = host.id ? undefined : suggestHost(site);

    return {
      file: loaded.file,
      exists: loaded.text !== null,
      hash: loaded.text?.hash ?? null,
      ...(loaded.read.ok ? {} : { problem: loaded.read.problem }),
      redirects: list,
      issues,
      host: { id: host.id, from: host.from, ...(suggestion ? { suggestion } : {}) },
      hostInfo: host.id ? { ...HOST_INFO[host.id], file: isGeneratedHost(host.id) ? derivedPath(host.id, model) : null } : null,
      usage,
      derived: derived
        ? {
            path: derived.path,
            state: derived.state,
            ...(derived.state === "hand-edited" || derived.state === "foreign" ? { current: (derived.current ?? "").slice(0, 200_000), proposed: (derived.next ?? "").slice(0, 200_000) } : {}),
          }
        : null,
      leftovers: await leftoversOf(site, model),
      imports: await importSources(site, model, derived, list),
      cloudflare: host.id === "cloudflare" || model.deploy?.target === "cloudflare" ? await cloudflareSummary(site, model, list, Boolean(usage?.over)) : null,
      siteHosts: siteHostsOf(model),
      trailingSlash: slashStyleOf(model),
    };
  }

  async function reviewFor(site: SiteService, input: ImportInput) {
    const model = await site.model();
    let text = input.text;
    let filename = input.filename;

    if (input.path !== undefined) {
      const file = await readText(site, input.path);

      if (!file) throw new GalleyError("not-found", "That file isn't in the site any more.", input.path);
      text = file.content;
      filename = input.path;
    }
    if (text === undefined || text.trim() === "") throw new GalleyError("invalid", "Paste a list of redirects, or choose a file.");
    if (text.length > 20 * 1024 * 1024) throw new GalleyError("invalid", "That list is too large to read in one go. Split it into files under 20 MB.");
    const loaded = await loadList(site, model);

    if (!loaded.read.ok) throw new GalleyError("invalid", `${loaded.read.problem} Fix it first; nothing was added.`);
    const host = hostOf(model).id;
    const parsed = parseRedirects(text, {
      siteHosts: siteHostsOf(model, input.siteHosts ?? []),
      trailingSlash: slashStyleOf(model),
      ...(filename ? { filename } : {}),
      ...(input.path?.startsWith("wordpress-import/") ? { source: "import:wordpress" } : {}),
    });
    const routes = await siteRoutes(site, model);

    return { loaded, ...reviewImport(loaded.read.redirects, parsed, { mode: input.mode ?? "add", ...(input.resolutions ? { resolutions: input.resolutions } : {}), routes, host }) };
  }

  // Follow list edits made elsewhere in the app with the same regeneration.
  const unsubscribe = options.registry
    ? options.events.subscribe((event) => {
        if (event.type !== "changes.updated" || !FOLLOWED.has(event.origin)) return;
        const registry = options.registry!;

        void (async () => {
          const site = await registry.get(event.siteId);

          if (!site) return;
          const model = await site.model();

          if (!event.paths.includes(listFileOf(model))) return;
          await locked(site.id, async () => {
            const loaded = await loadList(site, model);

            if (!loaded.read.ok) return;
            const plan = await planFor(site, model, canonicalOrder(loaded.read.redirects), await siteRoutes(site, model));

            if (plan && safeToWrite(plan)) await writeDerived(site, plan, event.origin === "agent" ? "agent" : "user");
          });
        })().catch(() => undefined);
      })
    : () => undefined;

  return {
    overview,

    async save(site, input) {
      await locked(site.id, () => write(site, input.redirects, input.baseHash, "user"));
      return overview(site);
    },

    async review(site, input) {
      return (await reviewFor(site, input)).review;
    },

    async confirm(site, input) {
      const outcome = await locked(site.id, async () => {
        const { review, result, loaded } = await reviewFor(site, input);

        if (review.blocking > 0) throw new GalleyError("invalid", "Some of these redirects go round in a circle. Leave them out (or fix them) before adding the list. Nothing was added.");
        await write(site, result, input.baseHash === undefined ? (loaded.text?.hash ?? null) : input.baseHash, "user");
        return review;
      });

      return { overview: await overview(site), review: outcome };
    },

    async trace(site, address) {
      const model = await site.model();
      const loaded = await loadList(site, model);

      return traceAddress(loaded.read.redirects, address, { siteHosts: siteHostsOf(model), trailingSlash: slashStyleOf(model), routes: await siteRoutes(site, model), host: hostOf(model).id });
    },

    async configure(site, patch) {
      const config: GalleyConfig = (await site.readConfig()) ?? {};
      const model = await site.model();
      const current = config.redirects ?? {};
      const next: NonNullable<GalleyConfig["redirects"]> = { ...current };

      if (!next.file) next.file = listFileOf(model);
      if (patch.host !== undefined) {
        if (patch.host === null) delete next.host;
        else next.host = patch.host;
      }
      if (patch.cloudflare) {
        const cloudflare = { ...(current.cloudflare ?? {}) };

        if (patch.cloudflare.account !== undefined) {
          if (patch.cloudflare.account === null || patch.cloudflare.account.trim() === "") delete cloudflare.account;
          else cloudflare.account = patch.cloudflare.account.trim();
        }
        if (patch.cloudflare.hostnames !== undefined) {
          const hostnames = [...new Set((patch.cloudflare.hostnames ?? []).map((host) => host.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean))];

          for (const hostname of hostnames) {
            const problem = hostnameProblem(hostname);

            if (problem) throw new GalleyError("invalid", problem);
          }
          if (hostnames.length) cloudflare.hostnames = hostnames;
          else delete cloudflare.hostnames;
        }
        if (Object.keys(cloudflare).length) next.cloudflare = cloudflare;
        else delete next.cloudflare;
      }
      await locked(site.id, async () => {
        const saved = await site.saveConfig({ ...config, redirects: next });
        const loaded = await loadList(site, saved);

        // A new host gets its file straight away (when safe), so choosing the host is all it takes.
        if (loaded.read.ok && loaded.read.redirects.length) {
          const plan = await planFor(site, saved, canonicalOrder(loaded.read.redirects), await siteRoutes(site, saved));

          if (plan && safeToWrite(plan)) await writeDerived(site, plan, "user");
        }
      });
      return overview(site);
    },

    async replaceDerived(site) {
      await locked(site.id, async () => {
        const model = await ensureWritable(site, await site.model());
        const loaded = await loadList(site, model);

        if (!loaded.read.ok) throw new GalleyError("invalid", `${loaded.read.problem} Fix it first; nothing was changed.`);
        const plan = await planFor(site, model, canonicalOrder(loaded.read.redirects), await siteRoutes(site, model));

        if (!plan) throw new GalleyError("invalid", "This site's host doesn't read a redirect file this app writes.");
        if (plan.problem) throw new GalleyError("invalid", plan.problem);
        await writeDerived(site, plan, "user");
      });
      return overview(site);
    },

    async removeLeftover(site, path) {
      const model = await site.model();
      const leftovers = await leftoversOf(site, model);

      if (!leftovers.some((leftover) => leftover.path === path)) throw new GalleyError("invalid", "Only a redirect file this app wrote, for a host the site no longer uses, can be removed here.", path);
      await locked(site.id, async () => {
        if (path === "vercel.json") {
          const text = await readText(site, path);

          if (!text) return;
          const plan = planDerived({ host: "vercel", path, current: text.content, list: [], listFile: listFileOf(model), lastWritten: (await readState(options.home, site.id)).written[path] ?? null });

          if (plan.next !== null && plan.next !== text.content) await site.writeFile(path, plan.next, { origin: "user", mode: "build" });
        } else await site.deleteFile(path, { origin: "user", mode: writeRefusal(path, model.writable, "content") ? "build" : "content" });
      });
      return overview(site);
    },

    async exportList(site, format, exportOptions = {}) {
      const model = await site.model();
      const loaded = await loadList(site, model);
      const hostname = exportOptions.hostname ?? cloudflareHostnames(model)[0];

      if (format === "cloudflare-csv" && !hostname) throw new GalleyError("invalid", "Say which domain the redirects are for (like www.example.com): a Cloudflare list names it on every line.");
      const info = exportInfo(format);

      return { filename: info.file, type: info.type, body: renderExport(loaded.read.redirects, format, { listFile: loaded.file, ...(hostname ? { hostname } : {}) }) };
    },

    async health(site) {
      const model = await site.model();
      const loaded = await loadList(site, model);
      const list = loaded.read.redirects;
      const routes = await siteRoutes(site, model);
      const issues = checkRedirects(list, { routes, host: hostOf(model).id });
      const brokenTargets = issues
        .filter((issue) => issue.code === "broken-target")
        .map((issue) => ({ index: issue.indices[0]!, from: list[issue.indices[0]!]!.from, to: list[issue.indices[0]!]!.to, ...(issue.suggestion ? { suggestion: issue.suggestion } : {}) }));
      const linkedOldAddresses = await linkedOldAddressesOf(site, model, list);

      return { brokenTargets, linkedOldAddresses };
    },

    async cloudflarePlan(site) {
      return (await planWithProbe(site)).outcome.plan;
    },

    async cloudflareApply(site, input) {
      const running = lastJob.get(site.id);

      if (running && jobs.get(running)?.state === "running") return jobs.get(running)!;
      const context = await cloudflareContext(site);
      const probe = await probeCloudflare(context.api, context.target.account);

      if (probe.missing.length) throw missingPermissionError(probe.missing);
      const handle = jobs.start("redirects", "Setting the redirects on Cloudflare");
      const who = await options.settings
        .get()
        .then((settings) => settings.author?.name?.trim() || undefined)
        .catch(() => undefined);

      handle.update({ siteId: site.id, detail: "Checking Cloudflare…", progress: 0 });
      lastJob.set(site.id, handle.id);
      void applyCloudflare(context.api, context.target, context.list, input.planId, (progress) => handle.update({ detail: progress.detail, ...(progress.progress !== undefined ? { progress: progress.progress } : {}) }))
        .then(async (record) => {
          await updateState(options.home, site.id, (state) => ({ ...state, cloudflare: { ...record, ...(who ? { who } : {}) } }));
          handle.finish("done", { progress: 1, detail: `Cloudflare now has ${record.items.toLocaleString("en-US")} ${record.items === 1 ? "redirect" : "redirects"} for ${record.hostnames.join(", ")}.` });
        })
        .catch((error: unknown) => {
          const shaped = error instanceof GalleyError ? error : new GalleyError("internal", "Setting the redirects on Cloudflare stopped unexpectedly. Check Cloudflare and try again.", error instanceof Error ? error.message : String(error));

          handle.finish("error", { detail: shaped.message, ...(shaped.detail ? { output: shaped.detail.slice(0, 4000) } : {}) });
        });
      return handle.snapshot();
    },

    async cloudflareCheck(site) {
      const { api, target, list } = await cloudflareContext(site);
      const probe = await probeCloudflare(api, target.account);

      if (probe.missing.length) throw missingPermissionError(probe.missing);
      const result = await checkCloudflare(api, target, list);

      return { ...result, checkedAt: new Date().toISOString() };
    },

    async cloudflareRemove(site) {
      const { api, target } = await cloudflareContext(site);

      await removeCloudflare(api, target);
      await updateState(options.home, site.id, (state) => ({ ...state, cloudflare: null }));
      return overview(site);
    },

    job: (id) => jobs.get(id),

    dispose() {
      unsubscribe();
      jobs.dispose();
    },
  };
}

/** Links inside content: markdown `](/path)`, `href="/path"`, and quoted site paths in data fields. */
const LINK = /\]\((\/[^)\s#?]*)|href=["'](\/[^"'#?\s]*)|"(\/[^"#?\s]*)"/g;

/**
 * Old addresses the site's own pages still link to. One pass over the
 * content (never one search per redirect), so it stays quick with
 * thousands of redirects; pages past the first 5,000 aren't read.
 */
async function linkedOldAddressesOf(site: SiteService, model: SiteModel, list: Redirect[]): Promise<RedirectHealth["linkedOldAddresses"]> {
  const exact = new Map(list.filter((redirect) => !isWildcard(redirect.from) && redirect.from !== "/").map((redirect) => [redirect.from, redirect]));
  const found = new Map<string, { from: string; to: string; pages: Array<{ path: string; title: string; url: string | null }> }>();
  let read = 0;

  if (exact.size === 0) return [];
  for (const collection of model.collections) {
    if (collection.path === listFileOf(model)) continue;
    const entries = await site.listEntries(collection.id, { limit: 5000 }).catch(() => null);

    for (const item of entries?.items ?? []) {
      if (read >= 5000) break;
      read += 1;
      const raw = await site.readEntry(item.path).then((entry) => entry.raw).catch(() => "");

      for (const match of raw.matchAll(LINK)) {
        const target = match[1] ?? match[2] ?? match[3];
        const redirect = target ? exact.get(target) : undefined;

        if (!redirect) continue;
        const record = found.get(redirect.from) ?? { from: redirect.from, to: redirect.to, pages: [] };

        if (!record.pages.some((page) => page.path === item.path)) record.pages.push({ path: item.path, title: item.title, url: item.url });
        found.set(redirect.from, record);
      }
    }
  }
  return [...found.values()].slice(0, 50);
}

/** What a list must be to be saved: every redirect readable, nothing the file format can't hold. */
function validateList(list: Redirect[]): void {
  if (!Array.isArray(list)) throw new GalleyError("invalid", "The redirects should be a list.");
  if (list.length > 200_000) throw new GalleyError("invalid", "That's more redirects than one list can hold here (200,000).");
  list.forEach((redirect, index) => {
    const where = `Redirect ${index + 1}`;

    if (typeof redirect?.from !== "string" || !redirect.from.startsWith("/")) throw new GalleyError("invalid", `${where}: the old address must start with “/”.`);
    if (/\s/.test(redirect.from)) throw new GalleyError("invalid", `${where}: the old address has a space in it. Write spaces as %20.`);
    if (redirect.from.includes("*") && !redirect.from.endsWith("/*")) throw new GalleyError("invalid", `${where}: a wildcard must end the address, as in “/blog/*”.`);
    if (typeof redirect.to !== "string" || redirect.to.trim() === "") throw new GalleyError("invalid", `${where} (${redirect.from}) needs a new address.`);
    if (!redirect.to.startsWith("/") && !isAbsoluteUrl(redirect.to)) throw new GalleyError("invalid", `${where} (${redirect.from}): the new address must start with “/” or “https://”.`);
    if (![301, 302, 307, 308].includes(redirect.status)) throw new GalleyError("invalid", `${where} (${redirect.from}): choose permanent or temporary.`);
    if (redirect.note !== undefined && (typeof redirect.note !== "string" || redirect.note.length > 500)) throw new GalleyError("invalid", `${where} (${redirect.from}): keep the note under 500 characters.`);
  });
}
