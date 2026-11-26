/**
 * The deploy service: putting a site online with one host, as a `Job`.
 *
 *   build  → the site's own build (published version for production, the
 *            working tree for a preview — see source.ts)
 *   check  → walk the output folder, refuse what the host won't take
 *   upload → the host's own protocol (cloudflare.ts, vercel.ts)
 *   record → `<home>/state/<siteId>/deployments.jsonl`, and the live address
 *            into galley.config.json after a production deploy
 *
 * One deploy runs per site at a time. A production deploy asked for while one
 * is running (an auto-deploy after a quick second publish) waits and runs once
 * after it, so the live site ends on the newest published version.
 *
 * The host's access key is read from the settings service at the moment it is
 * needed and never leaves this module: every message, detail, job event and
 * record is scrubbed of it.
 */
import { GalleyError } from "../errors";
import { changeSettings, recordSettings } from "../site/settings-records";
import type {
  DeployAccount,
  DeployConfig,
  DeployDomainConfig,
  DeployKind,
  DeployProjectCheck,
  DeployStatus,
  DeployTargetId,
  DeployTargetInfo,
  Deployment,
  DomainPlan,
  DomainRecord,
  EventBus,
  GalleyConfig,
  Job,
  PublishResult,
  SettingsService,
  SiteService,
} from "../types";
import { createJobTracker, type JobHandle } from "../site/jobs";
import { DeployError, scrubError } from "./errors";
import { collectFiles, formatBytes } from "./files";
import { appendDeployment, readDeployments } from "./history";
import { defaultProjectName, projectNameProblem } from "./names";
import { builtInTargets } from "./registry";
import { buildForDeploy, publishedCommit, versionsBetween } from "./source";
import { requireHostname } from "./domains";
import { currentAccountAuthor } from "../workspace/author";
import type { DeployContext, DeployTarget, DomainInput } from "./types";

export interface DeployServiceOptions {
  /** Galley home: deployment records live in `<home>/state/<siteId>/`. */
  home: string;
  settings: Pick<SettingsService, "readSecret" | "get" | "setSecret">;
  events: EventBus;
  /** Defaults to the built-in hosts plus registered ones. */
  targets?: DeployTarget[];
  /** Test seam. */
  fetch?: typeof fetch;
  /**
   * Whether `hostname` answers over HTTPS. Default: a HEAD request to
   * `https://<hostname>/`. Tests and the rehearsal (GALLEY_DEPLOY_PROBE, a URL
   * with `{host}`) point it at a fake.
   */
  probe?: (hostname: string) => Promise<boolean>;
  /** How long attaching waits for the address to answer (default 10 min), and how often it looks (default 5 s). */
  domainWaitMs?: number;
  domainPollMs?: number;
  /**
   * Point a host's API somewhere else, by target id. Only tests and the
   * end-to-end rehearsal use this (with a fake host); see also `env`.
   */
  apiBase?: Partial<Record<string, string>>;
  /** GALLEY_DEPLOY_<TARGET>_API (rehearsal only) and CLOUDFLARE_ACCOUNT_ID are read from here. Default process.env. */
  env?: NodeJS.ProcessEnv;
}

export interface StartOptions {
  kind: DeployKind;
  /** A note to keep with the deployment ("For Sam"). */
  label?: string;
  /** Started by publishing (auto-deploy) rather than by a person pressing a button. */
  auto?: boolean;
}

export interface DeployService {
  /** The hosts, with what setting each up needs and whether its key is present. */
  targets(): Promise<DeployTargetInfo[]>;
  /** Check the stored key for a host works; list the accounts or teams it can put sites in. */
  /**
   * With `key`: check that key with the host first and store it only when the
   * host accepts it — a refused key never replaces one that works.
   */
  connect(target: DeployTargetId, options?: { key?: string }): Promise<{ accounts: DeployAccount[] }>;
  /** Whether a project name can be used in an account. Creates nothing. */
  /**
   * `site`: the site asking. A project of that name already holding something
   * is only usable when it is the one this site's settings name.
   */
  checkProject(input: { target: DeployTargetId; account: string; name: string; site?: SiteService }): Promise<DeployProjectCheck>;
  /** The site's deploy settings, latest deployments, running job, and how far behind the live site is. */
  status(site: SiteService): Promise<DeployStatus>;
  /** Change the site's deploy settings (galley.config.json `deploy`). */
  configure(site: SiteService, patch: Partial<DeployConfig>): Promise<DeployStatus>;
  /** Make the live address the site's `urls.production`, so Proof compares against the real live site. */
  useLiveAddress(site: SiteService): Promise<DeployStatus>;
  /** Start a deploy job. Returns at once; progress arrives as `job` events. */
  start(site: SiteService, options: StartOptions): Promise<Job>;
  /** Start a deploy and wait for it: the deployment, or the scrubbed DeployError. (CLI.) */
  run(site: SiteService, options: StartOptions, onJob?: (job: Job) => void): Promise<Deployment>;
  deployments(site: SiteService, limit?: number): Promise<Deployment[]>;
  /** Make a previous deployment live again (rollback / promote). */
  promote(site: SiteService, deploymentId: string): Promise<Deployment>;
  /** The publish hook: start a production deploy when the site has auto-deploy on. Never throws. */
  afterPublish(site: SiteService, result: PublishResult): void;
  job(id: string): Job | null;
  /** What using `hostname` as the site's address would do. Read-only. */
  planDomain(site: SiteService, hostname: string): Promise<DomainPlan>;
  /** Attach `hostname` (after the person said yes to the plan) and wait until it answers over HTTPS. A "domain" job. */
  attachDomain(site: SiteService, hostname: string): Promise<Job>;
  /** Look again at an address that isn't answering yet (DNS or certificate on its way). A "domain" job. */
  checkDomain(site: SiteService, hostname?: string): Promise<Job>;
  /** Stop using a custom domain (primary when `hostname` is omitted): detach it if Galley attached it, and update the live address if needed. */
  detachDomain(site: SiteService, hostname?: string): Promise<DeployStatus>;
  /** The default project name for a site. */
  suggestName(site: SiteService): Promise<string>;
  dispose(): void;
}

const SECRET_ENV_HINT: Record<string, string> = { cloudflare: "CLOUDFLARE_API_TOKEN", vercel: "VERCEL_TOKEN" };

/** A progress update every person must see, however fast the next one follows (see JobHandle.update). */
const STEP = { immediate: true } as const;

/** The hosts' own addresses; anything else as a live address is one the person chose. */
const HOST_ADDRESS = /^https?:\/\/[^/]+\.(workers\.dev|pages\.dev|vercel\.app)\/?$/i;

/** Allowed deployment id characters (no control chars, whitespace or path traversal). */
const DEPLOYMENT_ID = /^[A-Za-z0-9._:@-]{1,200}$/;

/** All custom domains configured on a site (`domains`, falling back to legacy `domain`), deduplicated in order. */
export function configuredDomains(config: DeployConfig | null | undefined): DeployDomainConfig[] {
  if (!config) return [];
  const raw = [...(config.domains ?? []), ...(config.domain ? [config.domain] : [])];
  const seen = new Set<string>();
  const out: DeployDomainConfig[] = [];

  for (const item of raw) {
    if (!item?.hostname || seen.has(item.hostname)) continue;
    seen.add(item.hostname);
    out.push(item);
  }
  return out;
}

/** Keeps `domain` synced as primary (`domains[0]`) and drops both when empty. */
function withDomains(config: DeployConfig, list: DeployDomainConfig[]): DeployConfig {
  const seen = new Set<string>();
  const nextList: DeployDomainConfig[] = [];

  for (const item of list) {
    if (!item?.hostname || seen.has(item.hostname)) continue;
    seen.add(item.hostname);
    nextList.push(item);
  }
  const { domain: _oldDomain, domains: _oldDomains, ...rest } = config;

  if (nextList.length === 0) return rest;
  return { ...rest, domain: nextList[0], domains: nextList };
}

/** Whether the saved live address is the person's own (a domain), which a deploy must never replace. */
export function hasCustomAddress(config: DeployConfig): boolean {
  if (configuredDomains(config).some((entry) => !entry.pending)) return true;
  return Boolean(config.productionUrl) && config.productionUrl !== config.defaultUrl && !HOST_ADDRESS.test(config.productionUrl!);
}

function normalizeUrl(url: string | undefined): string {
  return (url ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * Merges host-reported deployments with locally recorded ones, newest first,
 * deduplicated by id while preserving richer local metadata (file counts,
 * author, custom live url) when the same id appears in both.
 */
function mergeDeployments(local: Deployment[], remote: Deployment[] | null, limit: number): Deployment[] {
  const dedupe = (items: Deployment[]): Deployment[] => {
    const seen = new Set<string>();
    const out: Deployment[] = [];

    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  };
  const uniqueLocal = dedupe(local);

  if (!remote) return uniqueLocal.slice(0, limit);
  const localById = new Map(uniqueLocal.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const out: Deployment[] = [];

  for (const item of remote) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const locally = localById.get(item.id);

    if (locally) {
      out.push(locally.kind === item.kind ? locally : { ...locally, kind: item.kind });
    } else {
      out.push(item);
    }
  }
  for (const locally of uniqueLocal) {
    if (seen.has(locally.id)) continue;
    seen.add(locally.id);
    out.push(locally);
  }
  return out.slice(0, limit);
}

export function createDeployService(options: DeployServiceOptions): DeployService {
  const env = options.env ?? process.env;
  const targets = options.targets ?? builtInTargets();
  const jobs = createJobTracker(options.events);
  const doFetch = options.fetch ?? fetch;
  /** Per site: the deploy running now, and whether a production deploy is waiting behind it. */
  const running = new Map<string, { kind: DeployKind; job: JobHandle; done: Promise<Deployment>; again: StartOptions | null; listeners: Set<(job: Job) => void> }>();
  const lastJob = new Map<string, string>();
  const lastDomainJob = new Map<string, string>();
  const domainRecords = new Map<string, Map<string, DomainRecord[]>>();
  const probeTemplate = env.GALLEY_DEPLOY_PROBE?.trim();
  const probe =
    options.probe ??
    (async (hostname: string) => {
      const url = probeTemplate ? probeTemplate.replace("{host}", encodeURIComponent(hostname)) : `https://${hostname}/`;

      try {
        const response = await doFetch(url, { method: probeTemplate ? "GET" : "HEAD", redirect: "manual", signal: AbortSignal.timeout(10_000) });

        // Any answer over HTTPS means DNS and the certificate work; the fake for rehearsals answers 200 only when ready.
        return probeTemplate ? response.ok : true;
      } catch {
        return false;
      }
    });
  const waitMs = options.domainWaitMs ?? 10 * 60_000;
  const pollMs = options.domainPollMs ?? 5_000;

  function recordsMapFor(siteId: string): Map<string, DomainRecord[]> {
    let map = domainRecords.get(siteId);

    if (!map) {
      map = new Map();
      domainRecords.set(siteId, map);
    }
    return map;
  }

  function setRecordsFor(siteId: string, hostname: string, records: DomainRecord[]): void {
    const map = recordsMapFor(siteId);

    if (records.length > 0) map.set(hostname, records);
    else map.delete(hostname);
    if (map.size === 0) domainRecords.delete(siteId);
  }

  function clearRecordsFor(siteId: string, hostname: string): void {
    const map = domainRecords.get(siteId);

    if (!map) return;
    map.delete(hostname);
    if (map.size === 0) domainRecords.delete(siteId);
  }

  function targetFor(id: DeployTargetId | undefined): DeployTarget {
    const target = targets.find((candidate) => candidate.id === id);

    if (!target) throw new DeployError("not-set-up", "That host isn't one this app can put sites on.", String(id));
    return target;
  }

  function apiBaseFor(target: DeployTarget): string {
    const fromEnv = env[`GALLEY_DEPLOY_${target.id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API`];

    return options.apiBase?.[target.id] ?? (fromEnv?.trim() || target.apiBase);
  }

  async function contextFor(target: DeployTarget, signal?: AbortSignal): Promise<DeployContext> {
    const secret = target.credentials[0]?.secret;

    if (!secret) {
      return { token: "", fetch: doFetch, apiBase: apiBaseFor(target), ...(signal ? { signal } : {}) };
    }
    const token = await options.settings.readSecret(secret);

    if (!token) {
      const variable = SECRET_ENV_HINT[target.id];

      throw new DeployError(
        "no-key",
        `Add a ${target.name} access key first. Paste it in the setup${variable ? `, or start the app with ${variable} set` : ""}.`
      );
    }
    return { token, fetch: doFetch, apiBase: apiBaseFor(target), ...(signal ? { signal } : {}) };
  }

  /** Runs a host call with the key cut out of anything it throws. */
  async function withHost<T>(target: DeployTarget, call: (ctx: DeployContext) => Promise<T>): Promise<T> {
    let ctx: DeployContext | null = null;

    try {
      ctx = await contextFor(target);
      return await call(ctx);
    } catch (error) {
      throw scrubError(error, [ctx?.token]);
    }
  }

  async function fetchRemoteDeployments(config: DeployConfig, target: DeployTarget, limit: number): Promise<Deployment[] | null> {
    if (!target.list) return null;
    try {
      const listed = await withHost(target, (ctx) => target.list!(ctx, { account: config.account, project: config.project }));

      return Array.isArray(listed) ? listed.slice(0, limit) : null;
    } catch {
      return null;
    }
  }

  async function readDeployConfig(site: SiteService): Promise<DeployConfig | null> {
    return (await site.model()).deploy ?? null;
  }

  async function writeDeployConfig(site: SiteService, next: DeployConfig | null, extra: (config: GalleyConfig) => GalleyConfig = (config) => config): Promise<void> {
    // On top of the settings as they are, and only over the version that was read.
    await changeSettings(site, (current) => {
      const { deploy: _old, ...rest } = current;

      return extra(next ? { ...rest, deploy: next } : rest);
    });
  }

  /**
   * Who put this online. On an install with accounts it is the signed-in
   * person (their e-mail address until they have chosen a name), never the
   * app's publishing name, which is someone else's. Outside a person's request
   * (local mode, a script's token, publishing that goes live by itself for
   * nobody in particular) it is the app's publishing name, as before.
   */
  async function who(): Promise<string | undefined> {
    const person = currentAccountAuthor()?.name.trim();

    if (person) return person;
    try {
      const name = (await options.settings.get()).author.name.trim();

      return name || undefined;
    } catch {
      return undefined;
    }
  }

  async function execute(site: SiteService, config: DeployConfig, start: StartOptions, job: JobHandle): Promise<Deployment> {
    const target = targetFor(config.target);
    let ctx: DeployContext | null = null;
    let built: Awaited<ReturnType<typeof buildForDeploy>> | null = null;

    try {
      ctx = await contextFor(target);
      // A read-only look first: a refused key, a missing permission or a name in use is reported in seconds, not after a long build.
      job.update({ detail: `Connecting to ${target.name}…`, progress: 0.02 }, STEP);
      const check = await target.checkProject(ctx, { account: config.account, name: config.project, ours: true });

      if (!check.available) throw new DeployError("taken", check.message ?? `The name “${config.project}” can't be used. Choose a different one in the site's Online settings.`);
      let project: { project: string; productionUrl: string };
      let outcome: Awaited<ReturnType<DeployTarget["deploy"]>>;
      let commit: string | null;
      let fileCount = 0;
      let byteCount = 0;

      if (target.deployFromSource) {
        const model = await site.model();

        if (start.kind === "production") {
          commit = await publishedCommit(site.root, model);
          if (!commit) {
            throw new DeployError("unpublished", "Nothing has been published yet, so there's nothing to put live. Publish your changes first — what's live is what you've published.");
          }
        } else {
          const gitState = await site.gitStatus().catch(() => null);

          commit = gitState?.lastCommit?.commit ?? (await publishedCommit(site.root, model).catch(() => null));
        }
        const branch = model.publish.branch?.trim() || undefined;

        project = await target.ensureProject(ctx, { account: config.account, name: config.project, ours: true });
        job.update({ detail: start.kind === "production" ? `Putting the published version live on ${target.name}…` : `Making a preview on ${target.name}…`, progress: 0.4 }, STEP);
        outcome = await target.deployFromSource(ctx, {
          account: config.account,
          project: project.project,
          kind: start.kind,
          commit,
          ...(branch ? { branch } : {}),
          label: start.label ?? (start.kind === "production" ? `Published version ${commit?.slice(0, 7) ?? ""}`.trim() : "Preview of unpublished changes"),
          onProgress: ({ detail, progress }) =>
            job.update({ detail, ...(progress !== undefined ? { progress: 0.4 + progress * 0.55 } : {}) }, progress === undefined || progress === 0 || progress === 1 ? STEP : {}),
        });
        if (outcome.commit !== undefined) commit = outcome.commit;
        fileCount = outcome.files ?? 0;
        byteCount = outcome.bytes ?? 0;
      } else {
        job.update({ detail: start.kind === "production" ? "Building the published version…" : "Building the site with your changes…", progress: 0.05 }, STEP);
        built = await buildForDeploy(site, start.kind, (detail) => job.update({ detail }, STEP));
        job.update({ detail: "Checking the files…", progress: 0.35 }, STEP);
        const files = await collectFiles(built.dir, target.info.limits, target.name, built.outDir);

        fileCount = files.length;
        byteCount = files.reduce((sum, file) => sum + file.size, 0);
        commit = built.commit;
        // Only now that there is something to upload is anything created on the host.
        project = await target.ensureProject(ctx, { account: config.account, name: config.project, ours: true });
        job.update({ detail: `Sending ${fileCount.toLocaleString("en-US")} ${fileCount === 1 ? "file" : "files"} (${formatBytes(byteCount)}) to ${target.name}…`, progress: 0.4 }, STEP);
        outcome = await target.deploy(ctx, {
          project: project.project,
          account: config.account,
          dir: built.dir,
          files,
          kind: start.kind,
          commit: built.commit,
          siteRoot: built.root,
          label: start.label ?? (start.kind === "production" ? `Published version ${built.commit?.slice(0, 7) ?? ""}`.trim() : "Preview of unpublished changes"),
          // The first and last words of an upload are steps; the counts in between may be coalesced.
          onProgress: ({ detail, progress }) =>
            job.update({ detail, ...(progress !== undefined ? { progress: 0.4 + progress * 0.55 } : {}) }, progress === undefined || progress === 0 || progress === 1 ? STEP : {}),
        });
      }
      const author = await who();
      // The live address is the person's choice: a custom one is kept, the host's own is recorded beside it.
      const latest = start.kind === "production" ? await readDeployConfig(site) : null;
      const hostDefault = outcome.productionUrl ?? (start.kind === "production" ? project.productionUrl : undefined);
      const custom = latest ? hasCustomAddress(latest) : false;
      const record: Deployment = {
        id: outcome.id,
        kind: start.kind,
        target: target.id,
        project: project.project,
        url: custom && latest?.productionUrl ? latest.productionUrl : outcome.url,
        commit,
        createdAt: outcome.createdAt,
        ...(author ? { who: author } : {}),
        ...(start.label ?? outcome.label ? { label: start.label ?? outcome.label } : {}),
        files: fileCount,
        bytes: byteCount,
      };

      await appendDeployment(options.home, site.id, record);
      if (latest && hostDefault) {
        // The settings file records where the site lives, so the next session (and the CLI) knows its address.
        const next: DeployConfig = { ...latest, defaultUrl: hostDefault, ...(custom ? {} : { productionUrl: hostDefault }) };

        // The engine's own bookkeeping, at the deploy's level: the two addresses, and nothing else in the file.
        if (next.defaultUrl !== latest.defaultUrl || next.productionUrl !== latest.productionUrl) {
          await recordSettings(site, { kind: "deploy-address", defaultUrl: hostDefault, ...(custom ? {} : { productionUrl: hostDefault }) });
        }
      }
      return record;
    } catch (error) {
      throw scrubError(error, [ctx?.token]);
    } finally {
      await built?.cleanup().catch(() => undefined);
    }
  }

  function launch(site: SiteService, config: DeployConfig, start: StartOptions): { job: JobHandle; done: Promise<Deployment>; listeners: Set<(job: Job) => void> } {
    const tracked = jobs.start("deploy", start.kind === "production" ? (start.auto ? "Putting the published version live" : "Putting the site online") : "Making a preview link");
    // Job events are rate-limited for the UI; a waiting caller (the CLI) hears every step.
    const listeners = new Set<(job: Job) => void>();
    const job: JobHandle = {
      id: tracked.id,
      snapshot: tracked.snapshot,
      update(patch, updateOptions) {
        const current = tracked.snapshot();

        // A step said twice (the service and the build both announce building) is reported once.
        if ((Object.keys(patch) as Array<keyof typeof patch>).every((key) => patch[key] === current[key])) return;
        tracked.update(patch, updateOptions);
        for (const listener of listeners) listener(tracked.snapshot());
      },
      finish(state, patch) {
        tracked.finish(state, patch);
        for (const listener of listeners) listener(tracked.snapshot());
      },
    };

    job.update({ siteId: site.id, detail: "Getting ready…", progress: 0 }, STEP);
    lastJob.set(site.id, job.id);
    const done = execute(site, config, start, job).then(
      (record) => {
        job.finish("done", { progress: 1, url: record.url, detail: record.kind === "production" ? "Live" : "Preview ready" });
        return record;
      },
      (error: DeployError) => {
        job.finish("error", { detail: error.message, ...(error.detail ? { output: error.detail } : {}) });
        throw error;
      }
    );
    const entry = { kind: start.kind, job, done, again: null as StartOptions | null, listeners };

    running.set(site.id, entry);
    void done
      .catch(() => undefined)
      .finally(() => {
        if (running.get(site.id) !== entry) return;
        running.delete(site.id);
        if (entry.again) {
          const next = entry.again;

          void readDeployConfig(site).then((latest) => (latest ? launch(site, latest, next) : undefined), () => undefined);
        }
      });
    return { job, done, listeners };
  }

  async function begin(site: SiteService, start: StartOptions): Promise<{ job: JobHandle; done: Promise<Deployment>; listeners: Set<(job: Job) => void> }> {
    if (start.kind !== "production" && start.kind !== "preview") throw new DeployError("not-set-up", "Choose whether to put the site live or make a preview.");
    const config = await readDeployConfig(site);

    if (!config) throw new DeployError("not-set-up", "This site isn't set up to go online yet. Choose a host first.");
    targetFor(config.target);
    const active = running.get(site.id);

    if (active) {
      if (active.kind === start.kind && start.kind === "production") {
        // A newer published version may have arrived: run once more after this one.
        active.again = start;
        return active;
      }
      if (active.kind === start.kind) return active;
      throw new DeployError("busy", active.kind === "production" ? "The site is being put online right now. Wait for that to finish, then try again." : "A preview is being made right now. Wait for it to finish, then try again.");
    }
    return launch(site, config, start);
  }

  async function domainContext(site: SiteService, input: string) {
    const config = await readDeployConfig(site);

    if (!config) throw new DeployError("not-set-up", "Put the site online first; then it can answer on your own address.");
    const target = targetFor(config.target);

    if (!target.planDomain || !target.attachDomain) throw new DeployError("domain", `Using your own address isn't available for ${target.name} here.`);
    return { config, target, hostname: requireHostname(input) };
  }

  /** Waits until the host is done and the address answers over HTTPS; then it becomes ready (and the live address when primary). */
  async function waitForDomain(site: SiteService, target: DeployTarget, ctx: DeployContext, input: DomainInput, job: JobHandle, records: DomainRecord[]): Promise<void> {
    const { hostname } = input;
    const started = Date.now();
    let said = false;

    for (;;) {
      const status = target.domainStatus ? await target.domainStatus(ctx, input) : { ready: true };
      const needs = status.records ?? records;

      if (!status.ready && needs.length > 0) {
        setRecordsFor(site.id, hostname, needs);
        // Nothing to wait for until the person creates the record: say so and stop.
        job.finish("done", { progress: 1, detail: `Create the DNS record for ${hostname}, then check again.` });
        return;
      }
      if (status.ready && (await probe(hostname))) break;
      if (!said) {
        job.update({ detail: `Waiting for ${hostname} to answer — ${target.name} is setting up its certificate…`, progress: 0.5 }, STEP);
        said = true;
      }
      if (Date.now() - started >= waitMs) {
        throw new DeployError("domain", `${hostname} is attached but isn't answering over HTTPS yet — certificates can take a while. Check again in a few minutes; the site's address stays as it was until then.`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    clearRecordsFor(site.id, hostname);
    const latest = await readDeployConfig(site);

    if (latest) {
      const existing = configuredDomains(latest);
      const found = existing.find((entry) => entry.hostname === hostname);
      const entry: DeployDomainConfig = { hostname, attached: found?.attached ?? false };
      const nextDomains = found ? existing.map((item) => (item.hostname === hostname ? entry : item)) : [...existing, entry];
      const keepPrimary = hasCustomAddress(latest) && nextDomains[0]?.hostname !== hostname;
      const updated = withDomains(latest, nextDomains);

      await writeDeployConfig(site, { ...updated, ...(keepPrimary ? {} : { productionUrl: `https://${hostname}` }) });
    }
    job.finish("done", { progress: 1, url: `https://${hostname}`, detail: `${hostname} answers` });
  }

  const service: DeployService = {
    async targets() {
      const statuses = await Promise.all(
        targets.map(async (target) => {
          const secret = target.credentials[0]?.secret;
          const value = secret ? await options.settings.readSecret(secret).catch(() => null) : null;
          const fromEnv = secret && SECRET_ENV_HINT[target.id] ? Boolean(env[SECRET_ENV_HINT[target.id]!]?.trim()) : false;

          return secret ? [{ name: secret, configured: Boolean(value), source: value ? (fromEnv ? ("env" as const) : ("stored" as const)) : null, ...(value ? { hint: value.slice(-4) } : {}) }] : [];
        })
      );

      return targets.map((target, index) => ({ ...target.info, id: target.id, name: target.name, credentials: target.credentials, secrets: statuses[index] ?? [] }));
    },

    async connect(targetId, connectOptions = {}) {
      const target = targetFor(targetId);
      const key = connectOptions.key?.trim().replace(/^["']|["']$/g, "");
      let result: { accounts: DeployAccount[] };

      if (key) {
        const secret = target.credentials[0]?.secret;
        const previous = secret ? await options.settings.readSecret(secret).catch(() => null) : null;

        try {
          result = await target.connect({ token: key, fetch: doFetch, apiBase: apiBaseFor(target) });
        } catch (error) {
          const clean = scrubError(error, [key]);
          const kept = previous ? " The key saved before is still the one in use." : "";

          throw new DeployError(clean.reason, `${clean.message}${kept}`, clean.detail);
        }
        // Accepted by the host: now it may replace the stored one (setSecret checks its shape and refuses when the environment sets it).
        if (secret) await options.settings.setSecret(secret, key);
      } else {
        result = await withHost(target, (ctx) => target.connect(ctx));
      }
      const fromEnv = target.id === "cloudflare" ? env.CLOUDFLARE_ACCOUNT_ID?.trim() : target.id === "vercel" ? env.VERCEL_TEAM_ID?.trim() || env.VERCEL_ORG_ID?.trim() : undefined;

      if (fromEnv && !result.accounts.some((account) => account.id === fromEnv)) return { accounts: [{ id: fromEnv, name: fromEnv }, ...result.accounts] };
      return result;
    },

    async checkProject({ target: targetId, account, name, site }) {
      const target = targetFor(targetId);
      const problem = projectNameProblem(name);

      if (problem) return { name, available: false, existing: false, message: problem };
      if (!account?.trim()) return { name, available: false, existing: false, message: `Choose the ${target.info.accountNoun} first.` };
      const config = site ? await readDeployConfig(site).catch(() => null) : null;
      const ours = Boolean(config && config.target === target.id && config.account === account.trim() && config.project === name);

      return withHost(target, (ctx) => target.checkProject(ctx, { account: account.trim(), name, ours }));
    },

    async status(site) {
      const [model, records] = await Promise.all([site.model(), readDeployments(options.home, site.id, 50)]);
      const config = model.deploy ?? null;
      const target = config ? (targets.find((candidate) => candidate.id === config.target) ?? null) : null;
      const remote = config && target?.list ? await fetchRemoteDeployments(config, target, 20) : null;
      const merged = mergeDeployments(records, remote, 20);
      const production = merged.find((record) => record.kind === "production" && (!config || (record.target === config.target && record.project === config.project))) ?? null;
      const preview = merged.find((record) => record.kind === "preview") ?? null;
      let behind: number | null = null;

      if (production?.commit) {
        const tip = await publishedCommit(site.root, model).catch(() => null);

        behind = tip ? await versionsBetween(site.root, production.commit, tip).catch(() => null) : null;
      }
      const active = running.get(site.id)?.job.snapshot() ?? null;
      const last = lastJob.get(site.id);
      const hostRecords = domainRecords.get(site.id);
      const recordsByHost = hostRecords && hostRecords.size > 0 ? Object.fromEntries(hostRecords.entries()) : null;
      const firstPendingHost = configuredDomains(config).find((entry) => entry.pending && hostRecords?.has(entry.hostname))?.hostname;
      const primaryRecords = (firstPendingHost ? hostRecords?.get(firstPendingHost) : undefined) ?? (hostRecords ? [...hostRecords.values()][0] : undefined);

      return {
        config,
        // Shown at the live address the person chose, whatever the host called it at the time.
        production: production && config?.productionUrl ? { ...production, url: config.productionUrl } : production,
        preview,
        job: active ?? (last ? jobs.get(last) : null),
        behind,
        liveAddressSet: Boolean(config?.productionUrl) && normalizeUrl(model.urls.production) === normalizeUrl(config?.productionUrl),
        suggestedProject: defaultProjectName(model.name),
        domainJob: lastDomainJob.get(site.id) ? jobs.get(lastDomainJob.get(site.id)!) : null,
        ...(primaryRecords?.length ? { domainRecords: primaryRecords } : {}),
        ...(recordsByHost ? { domainRecordsByHost: recordsByHost } : {}),
        deployments: merged,
        canPromote: Boolean(target?.promote),
      };
    },

    async configure(site, patch) {
      const current = await readDeployConfig(site);
      const next = { ...(current ?? {}), ...patch } as Partial<DeployConfig>;
      const target = targetFor(next.target);

      if (!next.account?.trim()) throw new DeployError("not-set-up", `Choose the ${target.info.accountNoun} the site should live in.`);
      const problem = projectNameProblem(next.project ?? "");

      if (problem) throw new DeployError("taken", problem);
      // A different host or project means a different live address, learned again on the next deploy.
      const moved = current && (current.target !== next.target || current.account !== next.account || current.project !== next.project);
      const keptDomains = !moved ? configuredDomains(next as DeployConfig) : [];
      const base: DeployConfig = {
        target: target.id,
        account: next.account.trim(),
        project: next.project!,
        ...(next.productionUrl && !moved ? { productionUrl: next.productionUrl } : {}),
        ...(next.defaultUrl && !moved ? { defaultUrl: next.defaultUrl } : {}),
        ...(next.autoDeploy !== undefined ? { autoDeploy: Boolean(next.autoDeploy) } : {}),
        ...(next.previewOnShare !== undefined ? { previewOnShare: Boolean(next.previewOnShare) } : {}),
      };
      const config = keptDomains.length ? withDomains(base, keptDomains) : base;

      await writeDeployConfig(site, config);
      return service.status(site);
    },

    async useLiveAddress(site) {
      const config = await readDeployConfig(site);
      const address = config?.productionUrl ?? (await readDeployments(options.home, site.id, 50)).find((record) => record.kind === "production")?.url;

      if (!config || !address) throw new DeployError("not-set-up", "The site isn't online yet, so there's no live address to use.");
      await writeDeployConfig(site, config, (next) => ({ ...next, urls: { ...next.urls, production: address } }));
      return service.status(site);
    },

    async start(site, start) {
      return (await begin(site, start)).job.snapshot();
    },

    async run(site, start, onJob) {
      const { job, done, listeners } = await begin(site, start);

      if (onJob) {
        listeners.add(onJob);
        onJob(job.snapshot());
        try {
          return await done;
        } finally {
          listeners.delete(onJob);
        }
      }
      return done;
    },

    async deployments(site, limit = 50) {
      const [config, local] = await Promise.all([readDeployConfig(site).catch(() => null), readDeployments(options.home, site.id, limit)]);
      const target = config ? (targets.find((candidate) => candidate.id === config.target) ?? null) : null;
      const remote = config && target?.list ? await fetchRemoteDeployments(config, target, limit) : null;

      return mergeDeployments(local, remote, limit);
    },

    async promote(site, deploymentId) {
      const cleanId = deploymentId.trim();

      if (!DEPLOYMENT_ID.test(cleanId)) {
        throw new GalleyError("invalid", "That doesn't look like a deployment id.");
      }
      const config = await readDeployConfig(site);

      if (!config) throw new DeployError("not-set-up", "This site isn't set up to go online yet. Choose a host first.");
      const target = targetFor(config.target);

      if (!target.promote) {
        throw new DeployError("not-set-up", `${target.name} doesn't support making a previous version live from here.`);
      }
      if (running.get(site.id)) {
        throw new DeployError("busy", "The site is being put online right now. Wait for that to finish, then try again.");
      }
      const prior = (await readDeployments(options.home, site.id, 100)).find((entry) => entry.id === cleanId) ?? null;
      const outcome = await withHost(target, (ctx) => target.promote!(ctx, { account: config.account, project: config.project, id: cleanId }));
      const author = await who();
      const latest = await readDeployConfig(site);
      const custom = latest ? hasCustomAddress(latest) : false;
      const hostDefault = outcome.productionUrl ?? latest?.defaultUrl;
      const label = outcome.label ?? prior?.label;
      const record: Deployment = {
        id: outcome.id,
        kind: "production",
        target: target.id,
        project: config.project,
        url: custom && latest?.productionUrl ? latest.productionUrl : outcome.url,
        commit: outcome.commit !== undefined ? outcome.commit : (prior?.commit ?? null),
        createdAt: outcome.createdAt,
        ...(author ? { who: author } : {}),
        ...(label ? { label } : {}),
        files: outcome.files ?? prior?.files ?? 0,
        bytes: outcome.bytes ?? prior?.bytes ?? 0,
      };

      await appendDeployment(options.home, site.id, record);
      if (latest && hostDefault) {
        const next: DeployConfig = { ...latest, defaultUrl: hostDefault, ...(custom ? {} : { productionUrl: hostDefault }) };

        if (next.defaultUrl !== latest.defaultUrl || next.productionUrl !== latest.productionUrl) {
          await recordSettings(site, { kind: "deploy-address", defaultUrl: hostDefault, ...(custom ? {} : { productionUrl: hostDefault }) });
        }
      }
      options.events.emit({ type: "site.updated", siteId: site.id });
      return record;
    },

    afterPublish(site, result) {
      // Pull-request mode hasn't published anything yet: a person approves it on the code host first.
      if (!result.ok || !result.commit || result.pullRequestUrl) return;
      void (async () => {
        const config = await readDeployConfig(site);

        if (config?.autoDeploy) await begin(site, { kind: "production", auto: true });
      })().catch(() => undefined);
    },

    job(id) {
      return jobs.get(id);
    },

    async planDomain(site, input) {
      const { config, target, hostname } = await domainContext(site, input);

      return withHost(target, (ctx) => target.planDomain!(ctx, { account: config.account, project: config.project, hostname }));
    },

    async attachDomain(site, input) {
      const { config, target, hostname } = await domainContext(site, input);
      const runningJob = lastDomainJob.get(site.id) ? jobs.get(lastDomainJob.get(site.id)!) : null;

      if (runningJob?.state === "running") throw new DeployError("busy", "An address is being set up right now. Wait for it to finish.");
      const job = jobs.start("domain", `Using ${hostname}`);

      job.update({ siteId: site.id, detail: `Checking ${hostname}…`, progress: 0 }, STEP);
      lastDomainJob.set(site.id, job.id);
      void (async () => {
        let ctx: DeployContext | null = null;

        try {
          ctx = await contextFor(target);
          const domainInput = { account: config.account, project: config.project, hostname };
          const plan = await target.planDomain!(ctx, domainInput);

          if (!plan.canAttach && plan.status !== "already") throw new DeployError("domain", plan.summary, plan.status);
          let records: DomainRecord[] = [];

          if (plan.status !== "already") {
            job.update({ detail: `Asking ${target.name} to answer ${hostname}…`, progress: 0.2 }, STEP);
            records = (await target.attachDomain!(ctx, domainInput)).records ?? [];
          }
          // Recorded before waiting, so it can be stopped even if it never answers. `attached`: only what Galley attached is ever detached.
          const latest = (await readDeployConfig(site)) ?? config;
          const existing = configuredDomains(latest);
          const found = existing.find((entry) => entry.hostname === hostname);
          const attached = plan.status !== "already" || Boolean(found?.attached);
          const entry: DeployDomainConfig = { hostname, attached, pending: true };
          const nextDomains = found ? existing.map((item) => (item.hostname === hostname ? entry : item)) : [...existing, entry];

          await writeDeployConfig(site, withDomains(latest, nextDomains));
          await waitForDomain(site, target, ctx, domainInput, job, records);
        } catch (error) {
          const clean = scrubError(error, [ctx?.token]);

          job.finish("error", { detail: clean.message, ...(clean.detail ? { output: clean.detail } : {}) });
        }
      })();
      return job.snapshot();
    },

    async checkDomain(site, inputHostname) {
      const config = await readDeployConfig(site);
      const domains = configuredDomains(config);

      if (!config || domains.length === 0) throw new DeployError("domain", "This site isn't using an address of its own.");
      const target = targetFor(config.target);
      const entry = inputHostname
        ? domains.find((item) => item.hostname === requireHostname(inputHostname))
        : (domains.find((item) => item.pending) ?? domains[0]);

      if (!entry) throw new DeployError("domain", `${inputHostname} isn't configured on this site.`);
      const hostname = entry.hostname;
      const job = jobs.start("domain", `Using ${hostname}`);

      job.update({ siteId: site.id, detail: `Checking ${hostname}…`, progress: 0.2 }, STEP);
      lastDomainJob.set(site.id, job.id);
      void (async () => {
        let ctx: DeployContext | null = null;

        try {
          ctx = await contextFor(target);
          await waitForDomain(site, target, ctx, { account: config.account, project: config.project, hostname }, job, domainRecords.get(site.id)?.get(hostname) ?? []);
        } catch (error) {
          const clean = scrubError(error, [ctx?.token]);

          job.finish("error", { detail: clean.message, ...(clean.detail ? { output: clean.detail } : {}) });
        }
      })();
      return job.snapshot();
    },

    async detachDomain(site, inputHostname) {
      const config = await readDeployConfig(site);
      const domains = configuredDomains(config);

      if (!config || domains.length === 0) return service.status(site);
      const entry = inputHostname ? domains.find((item) => item.hostname === requireHostname(inputHostname)) : domains[0];

      if (!entry) return service.status(site);
      const target = targetFor(config.target);
      const { hostname, attached } = entry;

      if (attached && target.detachDomain) {
        await withHost(target, (ctx) => target.detachDomain!(ctx, { account: config.account, project: config.project, hostname }));
      }
      clearRecordsFor(site.id, hostname);
      const custom = `https://${hostname}`;
      const remaining = domains.filter((item) => item.hostname !== hostname);
      const updated = withDomains(config, remaining);
      const wasPrimaryUrl = normalizeUrl(config.productionUrl) === normalizeUrl(custom);
      const nextReady = remaining.find((item) => !item.pending);
      const fallbackUrl = nextReady ? `https://${nextReady.hostname}` : config.defaultUrl;
      const { productionUrl: _was, ...withoutProd } = updated;
      const next: DeployConfig = wasPrimaryUrl
        ? { ...withoutProd, ...(fallbackUrl ? { productionUrl: fallbackUrl } : {}) }
        : updated;

      // The comparison address goes back too, when it was this one.
      await writeDeployConfig(site, next, (file) => {
        if (!wasPrimaryUrl || normalizeUrl(file.urls?.production) !== normalizeUrl(custom)) return file;
        const { production: _old, ...urls } = file.urls ?? {};

        return { ...file, urls: fallbackUrl ? { ...urls, production: fallbackUrl } : urls };
      });
      return service.status(site);
    },

    async suggestName(site) {
      return defaultProjectName((await site.model()).name);
    },

    dispose() {
      jobs.dispose();
    },
  };

  return service;
}

/** A DeployError's message, or GalleyError's, for one-line output (CLI). */
export function deployMessage(error: unknown): string {
  return error instanceof GalleyError ? error.message : error instanceof Error ? error.message : String(error);
}
