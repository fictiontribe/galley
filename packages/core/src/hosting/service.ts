/**
 * The hosting service: "Host the editor online" for one site, as `Job`s,
 * the sibling of deploy/service.ts.
 *
 *   plan    → checks the request, derives the addresses, asks the host what it
 *             would create and what it costs, lists what the install will be
 *             handed; creates nothing. Kept fifteen minutes, for one use.
 *   create  → only with a plan this service made and the person's yes. Makes
 *             the setup code (the host gets only its SHA-256), records every
 *             resource the moment it exists in <home>/state/<siteId>/editor.json,
 *             then — when nothing is left for the person to do — waits for the
 *             install to answer at its real address, hands the site over, and
 *             writes `editor` into the site's settings.
 *   check   → for self-run hosts and DNS added by hand: looks again, hands the
 *             site over once the install answers.
 *   upgrade, backup, removal, remove — the same place, later.
 *
 * Keys are read from the settings service at the moment they are needed and
 * never leave this module: every message, detail, job and record is scrubbed
 * of every key it read and of the setup code.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SECRET_NAMES } from "../api";
import { VERSION } from "../brand";
import { SECRET_ENV } from "../ai/secrets";
import { git } from "../workspace/git";
import { createJobTracker, type JobHandle } from "../site/jobs";
import type { EventBus, GalleyConfig, Job, SecretName, SecretStatus, SettingsService, SiteService } from "../types";
import type { SetupHandover } from "../install/types";
import { editorNameProblem, defaultEditorName, resolveAddresses } from "./addresses";
import { checkCloudflareKey, CLOUDFLARE_API } from "./cloudflare-api";
import { HostingError, scrubHostingError, scrubText } from "./errors";
import { checkFlyKey, FLY_API } from "./fly";
import { handover as sendHandover, healthz, readyz, type InstallTarget } from "./install-client";
import { defaultImage, installEnvironment } from "./recipe";
import { deleteRecord, forgetSetupCode, readRecord, readSetupCode, writeRecord, writeSetupCode } from "./record";
import { builtInEditorHosts, EDITOR_HOSTS_ABSENT } from "./registry";
import type {
  EditorConfig,
  EditorHost,
  EditorHostAbsent,
  EditorHostAccount,
  EditorHostContext,
  EditorHostId,
  EditorHostInfo,
  HandoverChoice,
  HandoverLine,
  HandoverRecord,
  HostedEditorBackup,
  HostedEditorHealth,
  HostedEditorPlan,
  HostedEditorRecord,
  HostedEditorRemoval,
  HostedEditorRequest,
  HostedEditorStatus,
  HostedResource,
  ManualStep,
} from "./types";

export const PLAN_TTL_MS = 15 * 60_000;
const DEFAULT_APIS: Record<string, string> = { fly: FLY_API, cloudflare: CLOUDFLARE_API };

export interface HostingServiceOptions {
  /** Galley home: records live in `<home>/state/<siteId>/`. */
  home: string;
  settings: Pick<SettingsService, "readSecret" | "setSecret" | "get">;
  events: EventBus;
  /** Default: the built-in hosts plus registered ones. */
  hosts?: EditorHost[];
  /** Test seam. */
  fetch?: typeof fetch;
  /**
   * API origins by name ("fly", "cloudflare"; "install" is where a new
   * install is reached instead of https://<editor>). Only tests and the
   * rehearsal use this; see also GALLEY_HOSTING_<NAME>_API in `env`.
   */
  api?: Partial<Record<string, string>>;
  /** GALLEY_HOSTING_<NAME>_API, GALLEY_HOSTING_IMAGE and the key variables are read from here. Default process.env. */
  env?: NodeJS.ProcessEnv;
  /** How patiently a new install is waited for. Default: up to ten minutes, every 2 s growing to 15 s. */
  wait?: { timeoutMs?: number; intervalMs?: number; maxIntervalMs?: number };
  /** Test seam for plan expiry. */
  now?: () => number;
}

export interface HostingService {
  /** The hosts, with what each needs and whether its keys are stored. */
  hosts(): Promise<EditorHostInfo[]>;
  /** Hosts people may expect that can't run an editor, and why. */
  absent(): EditorHostAbsent[];
  /**
   * What the stored keys can do on a host. With `key`: that key (for
   * `secret`, default the host's first) is checked with the host first and
   * stored only when accepted — a refused key never replaces one that works.
   */
  connect(hostId: EditorHostId, input?: { key?: string; secret?: SecretName }): Promise<EditorHostAccount>;
  status(site: SiteService): Promise<HostedEditorStatus>;
  /** Everything that would be created, what it costs and what is handed over. Creates nothing. */
  plan(site: SiteService, request: HostedEditorRequest): Promise<HostedEditorPlan>;
  /** Create what a plan described. Refused unless `confirm` is true and the plan is this service's, unused and unexpired. */
  create(site: SiteService, planId: string, confirm: boolean): Promise<Job>;
  /** Look again (self-run hosts, DNS added by hand) and hand the site over once the install answers. */
  check(site: SiteService): Promise<HostedEditorStatus>;
  /** The first-run link, while first run isn't finished. */
  setupLink(site: SiteService): Promise<{ url: string }>;
  upgrade(site: SiteService): Promise<Job>;
  backup(site: SiteService): Promise<HostedEditorBackup>;
  /** What removing would delete. Deletes nothing. */
  removal(site: SiteService): Promise<HostedEditorRemoval>;
  remove(site: SiteService, confirm: boolean): Promise<Job>;
  job(id: string): Job | null;
  /** Resolves with the job's last state when it ends; `onJob` hears every step. (CLI.) */
  wait(jobId: string, onJob?: (job: Job) => void): Promise<Job>;
  suggestName(site: SiteService): Promise<string>;
  dispose(): void;
}

interface StoredPlan {
  plan: HostedEditorPlan;
  request: HostedEditorRequest;
  siteId: string;
  code: string;
  environment: Record<string, string>;
  handover: HandoverRecord;
  expires: number;
}

const KEY_LABEL: Record<SecretName, string> = {
  anthropic: "the assistant's key (Anthropic)",
  openai: "the OpenAI key",
  google: "the Google AI key",
  cloudflare: "the Cloudflare key",
  vercel: "the Vercel key",
  fly: "the Fly.io key",
};

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** The repository's address with any password or token cut out; null for one the install can't reach (a folder on this computer). */
export function repositoryAddress(remote: string | undefined | null): string | null {
  const value = remote?.trim();

  if (!value) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.protocol === "file:") return null;
    if (url.protocol === "https:" || url.protocol === "http:") url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  }
  // scp-like "git@host:owner/name.git": the user is the SSH account, not a credential.
  return /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/.test(value) ? value : null;
}

export function createHostingService(options: HostingServiceOptions): HostingService {
  const env = options.env ?? process.env;
  const hosts = options.hosts ?? builtInEditorHosts();
  const jobs = createJobTracker(options.events);
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const plans = new Map<string, StoredPlan>();
  const running = new Map<string, { kind: "create" | "upgrade" | "remove"; job: JobHandle }>();
  const lastJob = new Map<string, string>();
  const ended = new Map<string, Promise<Job>>();
  const listeners = new Map<string, Set<(job: Job) => void>>();
  /** Every key read and every setup code made: cut out of everything shown. */
  const known = new Set<string>();
  const timing = { timeoutMs: options.wait?.timeoutMs ?? 10 * 60_000, intervalMs: options.wait?.intervalMs ?? 2000, maxIntervalMs: options.wait?.maxIntervalMs ?? 15_000 };

  const clean = (error: unknown) => scrubHostingError(error, known);
  const say = (text: string) => scrubText(text, known);

  function hostFor(id: EditorHostId | undefined): EditorHost {
    const host = hosts.find((candidate) => candidate.id === id);

    if (!host) throw new HostingError("invalid", "That isn't a place this app can put an editor.", String(id));
    return host;
  }

  function apiFor(host: EditorHost | null, name: string): string {
    const fromEnv = env[`GALLEY_HOSTING_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API`]?.trim();

    return options.api?.[name] ?? (fromEnv || host?.apis[name] || DEFAULT_APIS[name] || "");
  }

  function target(editor: string): InstallTarget {
    const origin = apiFor(null, "install");

    return { editor, ...(origin ? { origin } : {}) };
  }

  async function readKey(name: SecretName, siteId?: string): Promise<string | null> {
    const value = await options.settings.readSecret(name, siteId ? { siteId } : undefined).catch(() => null);

    if (value) known.add(value);
    return value;
  }

  function contextFor(host: EditorHost, overrides: Partial<Record<SecretName, string>> = {}): EditorHostContext {
    return {
      secret: async (name) => overrides[name] ?? readKey(name),
      fetch: doFetch,
      api: (name) => apiFor(host, name),
    };
  }

  /** Runs a host call with every secret cut out of anything it throws. */
  async function withHost<T>(host: EditorHost, call: (ctx: EditorHostContext) => Promise<T>): Promise<T> {
    try {
      return await call(contextFor(host));
    } catch (error) {
      throw clean(error);
    }
  }

  async function secretStatus(name: SecretName): Promise<SecretStatus> {
    const value = await readKey(name);
    const fromEnv = SECRET_ENV[name]?.some((variable) => Boolean(env[variable]?.trim())) ?? false;

    return value ? { name, configured: true, source: fromEnv ? "env" : "stored", hint: value.slice(-4) } : { name, configured: false, source: null };
  }

  async function requireKeys(host: EditorHost): Promise<void> {
    for (const credential of host.info.credentials.filter((entry) => entry.required)) {
      if (await readKey(credential.secret)) continue;
      const variable = SECRET_ENV[credential.secret]?.[0];

      throw new HostingError("no-key", `Add a ${credential.label.replace(/ \(optional\)$/, "")} first. Paste it in the setup${variable ? `, or start the app with ${variable} set` : ""}.`);
    }
  }

  async function checkKey(host: EditorHost, name: SecretName, key: string): Promise<void> {
    const ctx = contextFor(host, { [name]: key });

    // The built-in keys are checked by what they are, whichever host asks; a plugin's host checks its own.
    if (name === "fly") await checkFlyKey(ctx, key);
    else if (name === "cloudflare") await checkCloudflareKey(ctx, key);
    else await host.inspect(ctx);
  }

  async function readEditorConfig(site: SiteService): Promise<EditorConfig | null> {
    return ((await site.readConfig().catch(() => null)) as GalleyConfig | null)?.editor ?? null;
  }

  async function writeEditorConfig(site: SiteService, editor: EditorConfig | null): Promise<void> {
    const current = (await site.readConfig()) ?? {};
    const { editor: _old, ...rest } = current;

    if (!editor && !_old) return;
    await site.saveConfig(editor ? { ...rest, editor } : rest);
  }

  async function needRecord(site: SiteService): Promise<HostedEditorRecord> {
    const record = await readRecord(options.home, site.id);

    if (!record) {
      const config = await readEditorConfig(site);

      throw new HostingError(
        "not-found",
        config ? `This site's editor at ${config.url} was put online from another computer, so it is managed from there (or from its own Install page).` : "This site has no editor online yet."
      );
    }
    return record;
  }

  function notBusy(site: SiteService): void {
    const active = running.get(site.id);

    if (active) {
      const doing = active.kind === "create" ? "being put online" : active.kind === "upgrade" ? "being upgraded" : "being removed";

      throw new HostingError("busy", `The editor is ${doing} right now. Wait for that to finish, then try again.`);
    }
  }

  function prunePlans(): void {
    for (const [id, entry] of plans) if (entry.expires <= now()) plans.delete(id);
  }

  async function handoverFor(site: SiteService, choice: HandoverChoice): Promise<{ record: HandoverRecord; lines: HandoverLine[]; steps: ManualStep[]; problems: Array<{ message: string; fix?: string }> }> {
    const record: HandoverRecord = { keys: [] };
    const lines: HandoverLine[] = [];
    const steps: ManualStep[] = [];
    const problems: Array<{ message: string; fix?: string }> = [];

    if (choice.repository) {
      const [summary, model] = await Promise.all([site.summary(), site.model()]);
      const repository = repositoryAddress(summary.remoteUrl);
      const branch = model.publish?.branch?.trim() || summary.branch;
      // A site inside a larger repository ("apps/site"): the install needs to know where.
      const folder = ((await git(site.root).info().catch(() => null))?.prefix ?? "").replace(/\/+$/, "");

      if (repository) {
        record.site = { repository, ...(branch ? { branch } : {}), ...(folder ? { folder } : {}) };
        lines.push({ label: "Repository", value: repository, secret: false });
        if (branch) lines.push({ label: "Branch it publishes to", value: branch, secret: false });
        if (folder) lines.push({ label: "The site's folder in the repository", value: folder, secret: false });
      } else {
        steps.push({ title: "Connect the repository on the editor", detail: "This site has no repository address the editor could reach, so its setup screen asks for one." });
      }
    }
    if (choice.identity) {
      const author = (await options.settings.get({ siteId: site.id }).catch(() => null))?.author;

      if (author?.name?.trim() && author.email?.trim()) {
        record.author = { name: author.name.trim(), email: author.email.trim() };
        lines.push({ label: "Publishing name and e-mail", value: `${record.author.name} <${record.author.email}>`, secret: false });
      } else {
        steps.push({ title: "Give the publishing name and e-mail on the editor", detail: "None is set for this site here, so the editor's setup screen asks for them." });
      }
    }
    if (choice.liveAddress) {
      const model = await site.model();
      const live = model.urls?.production || model.deploy?.productionUrl;

      if (live) {
        record.liveUrl = live;
        lines.push({ label: "Live address", value: live, secret: false });
      } else {
        steps.push({ title: "Give the live address on the editor", detail: "This site has no live address yet, so the editor's setup screen asks for it." });
      }
    }
    for (const name of [...new Set(choice.keys)]) {
      if (!SECRET_NAMES.includes(name)) {
        problems.push({ message: `“${String(name)}” isn't a key this app knows.` });
        continue;
      }
      const value = await readKey(name, site.id);

      if (!value) {
        problems.push({ message: `There's no ${KEY_LABEL[name].replace(/^the /, "")} on this computer to hand over.`, fix: "Leave it out, or add it first." });
        continue;
      }
      record.keys.push(name);
      lines.push({ label: `Key: ${KEY_LABEL[name]}`, value: `…${value.slice(-4)}`, secret: true });
    }
    return { record, lines, steps, problems };
  }

  function launch(site: SiteService, kind: "create" | "upgrade" | "remove", label: string, work: (job: JobHandle) => Promise<{ detail: string; url?: string; output?: string }>): Job {
    const tracked = jobs.start("editor-host", label);
    const heard = new Set<(job: Job) => void>();
    const job: JobHandle = {
      id: tracked.id,
      snapshot: tracked.snapshot,
      update(patch) {
        tracked.update({ ...patch, ...(patch.detail ? { detail: say(patch.detail) } : {}) });
        for (const listener of heard) listener(tracked.snapshot());
      },
      finish(state, patch) {
        tracked.finish(state, patch);
        for (const listener of heard) listener(tracked.snapshot());
      },
    };

    listeners.set(job.id, heard);
    job.update({ siteId: site.id, detail: "Getting ready…", progress: 0 });
    running.set(site.id, { kind, job });
    lastJob.set(site.id, job.id);
    const done = work(job).then(
      (result) => {
        job.finish("done", { progress: 1, detail: say(result.detail), ...(result.url ? { url: result.url } : {}), ...(result.output ? { output: say(result.output) } : {}) });
        return job.snapshot();
      },
      (error: unknown) => {
        const failure = clean(error);

        job.finish("error", { detail: failure.message, ...(failure.detail ? { output: failure.detail } : {}) });
        return job.snapshot();
      }
    );

    ended.set(job.id, done);
    void done.finally(() => {
      if (running.get(site.id)?.job === job) running.delete(site.id);
      listeners.delete(job.id);
    });
    return job.snapshot();
  }

  /** Waits, patiently and boundedly, for the install to be up and ready for first run. */
  async function waitForInstall(editor: string, job: JobHandle, from: number, to: number): Promise<void> {
    const started = Date.now();
    let interval = timing.intervalMs;
    let up = false;

    for (;;) {
      if (!up) up = await healthz(target(editor));
      if (up) {
        const ready = await readyz(target(editor));

        if (ready && (ready.state === "setup" || ready.state === "ready")) return;
      }
      const elapsed = Date.now() - started;

      if (elapsed >= timing.timeoutMs) {
        throw new HostingError(
          "unanswered",
          `The editor was created, but it hasn't answered at https://${editor} yet. Its address and certificate can take a few more minutes: choose Check in a while. Nothing needs creating again.`
        );
      }
      job.update({
        detail: up ? `The editor is starting at https://${editor}…` : `Waiting for https://${editor} to answer (a new address and its certificate can take a few minutes)…`,
        progress: from + (to - from) * Math.min(1, elapsed / timing.timeoutMs),
      });
      await new Promise((resolve) => setTimeout(resolve, interval));
      interval = Math.min(timing.maxIntervalMs, Math.round(interval * 1.5));
    }
  }

  /** Sends exactly what the person agreed to, with the keys read at this moment. */
  async function handOver(site: SiteService, record: HostedEditorRecord): Promise<void> {
    const code = await readSetupCode(options.home, site.id);

    if (!code) throw new HostingError("not-found", "This computer no longer has the editor's setup code, so it can't hand the site over. Open the editor and finish its first run there.");
    known.add(code);
    const chosen = record.handover ?? { keys: [] };
    const payload: SetupHandover = {
      ...(chosen.site
        ? { site: { repository: chosen.site.repository, ...(chosen.site.branch ? { branch: chosen.site.branch } : {}), ...(chosen.site.folder ? { folder: chosen.site.folder } : {}), access: "deploy-key" as const } }
        : {}),
      ...(chosen.author ? { author: chosen.author } : {}),
      ...(chosen.liveUrl ? { liveUrl: chosen.liveUrl } : {}),
    };
    const keys: Partial<Record<SecretName, string>> = {};

    for (const name of chosen.keys) {
      const value = await readKey(name, site.id);

      if (value) keys[name] = value;
    }
    if (Object.keys(keys).length > 0) payload.keys = keys;
    const answer = await sendHandover(target(record.addresses.editor), code, payload);

    if (answer.status === 0) throw new HostingError("unanswered", `The editor at https://${record.addresses.editor} stopped answering while the site was being handed over. Choose Check to try again.`, say(answer.error ?? ""));
    if (answer.status === 401 || answer.status === 403) {
      throw new HostingError("host", "The editor didn't accept this computer's setup code: its first run may already be finished. Open it and sign in.", `POST /api/setup/handover → ${answer.status}`);
    }
    if (answer.status < 200 || answer.status >= 300) {
      throw new HostingError("host", `The editor couldn't take the site${answer.body?.error?.message ? `: “${say(answer.body.error.message).slice(0, 200)}”` : ""}. Choose Check to try again.`, `POST /api/setup/handover → ${answer.status}`);
    }
    record.handedOver = new Date().toISOString();
    delete record.handover;
    await writeRecord(options.home, site.id, record);
    await writeEditorConfig(site, { url: `https://${record.addresses.editor}`, host: record.host });
  }

  async function pendingOf(host: EditorHost, record: HostedEditorRecord): Promise<HostedEditorStatus["pending"]> {
    if (record.handedOver || !host.pending) return null;
    try {
      const pending = await host.pending(contextFor(host), record);

      return pending.steps.length || pending.files.length ? pending : null;
    } catch (error) {
      return { steps: [{ title: "What's left to do couldn't be read just now", detail: clean(error).message }], files: [] };
    }
  }

  const service: HostingService = {
    async hosts() {
      return Promise.all(
        hosts.map(async (host) => {
          const names = [...new Set(host.info.credentials.map((credential) => credential.secret))];

          return { ...host.info, id: host.id, name: host.info.name || host.name, secrets: await Promise.all(names.map(secretStatus)) };
        })
      );
    },

    absent() {
      return EDITOR_HOSTS_ABSENT.map((entry) => ({ ...entry }));
    },

    async connect(hostId, input = {}) {
      const host = hostFor(hostId);
      const key = input.key?.trim().replace(/^["']|["']$/g, "");

      if (key) {
        const name = input.secret ?? host.info.credentials[0]?.secret;

        if (!name || !host.info.credentials.some((credential) => credential.secret === name)) throw new HostingError("invalid", `${host.info.name} doesn't use that key.`);
        known.add(key);
        const previous = await readKey(name);

        try {
          await checkKey(host, name, key);
        } catch (error) {
          const failure = clean(error);

          throw new HostingError(failure.reason, `${failure.message}${previous ? " The key saved before is still the one in use." : ""}`, failure.detail);
        }
        // Accepted by the host: now it may replace the stored one (setSecret checks its shape and refuses when the environment sets it).
        await options.settings.setSecret(name, key);
      }
      return withHost(host, (ctx) => host.inspect(ctx));
    },

    async status(site) {
      const [config, record, model] = await Promise.all([readEditorConfig(site), readRecord(options.home, site.id), site.model()]);
      const active = running.get(site.id);
      const last = lastJob.get(site.id);
      const editor = record?.addresses.editor ?? (config ? hostnameOf(config.url) : null);
      let health: HostedEditorHealth = "unknown";

      if (active?.kind === "create" || active?.kind === "upgrade") health = "starting";
      else if (editor) {
        const ready = await readyz(target(editor));

        health = ready ? (ready.state === "ready" ? "healthy" : ready.state === "setup" ? "setup" : "starting") : (await healthz(target(editor))) ? "starting" : "unreachable";
        if (record && ready?.state === "ready" && record.setup === "pending") {
          // First run is finished there: the setup link is dead, so this computer forgets it.
          record.setup = "done";
          await writeRecord(options.home, site.id, record);
          await forgetSetupCode(options.home, site.id);
        }
      }
      const host = record ? hosts.find((candidate) => candidate.id === record.host) ?? null : null;
      const image = defaultImage(env);

      return {
        config,
        record,
        health,
        // The install's own answers name no version; this is the one it was created or last upgraded with.
        runningVersion: record && (health === "healthy" || health === "setup") ? record.version : null,
        currentVersion: VERSION,
        upgradeAvailable: Boolean(record && host?.upgrade && (record.image !== image || record.version !== VERSION)),
        job: active?.job.snapshot() ?? (last ? jobs.get(last) : null),
        pending: record && host ? await pendingOf(host, record) : null,
        suggestedName: defaultEditorName(model.name),
      };
    },

    async plan(site, request) {
      prunePlans();
      const host = hostFor(request.host);
      const name = request.name?.trim() ?? "";
      const nameProblem = editorNameProblem(name);

      if (nameProblem) throw new HostingError("invalid", nameProblem);
      const resolved = resolveAddresses(request);

      if ("problem" in resolved) throw new HostingError("invalid", resolved.problem);
      const { addresses } = resolved;

      await requireKeys(host);
      const handover = await handoverFor(site, request.handover ?? { repository: true, identity: true, liveAddress: true, keys: [] });
      const code = randomBytes(32).toString("base64url");

      known.add(code);
      const environment = installEnvironment(addresses, sha256(code));
      const image = defaultImage(env);
      const normalized: HostedEditorRequest = { ...request, name, address: addresses.editor, previewAddress: addresses.preview, liveAddress: addresses.live, account: request.account?.trim() ?? "" };
      const part = await withHost(host, (ctx) => host.plan(ctx, normalized, { image, addresses, environment }));
      const problems = [...handover.problems, ...part.problems];
      const [existing, config] = await Promise.all([readRecord(options.home, site.id), readEditorConfig(site)]);

      if (existing) problems.unshift({ message: `This site already has an editor online at https://${existing.addresses.editor}.`, fix: "Remove it first, then put a new one online." });
      else if (config) problems.unshift({ message: `This site's settings say its editor is at ${config.url} already.`, fix: "Remove it from the computer that put it online (or take “editor” out of the site's settings) first." });
      const plan: HostedEditorPlan = {
        id: randomUUID(),
        host: host.id,
        hostName: host.info.name,
        account: normalized.account,
        name,
        addresses,
        image,
        resources: part.resources,
        cost: part.cost,
        handover: handover.lines,
        steps: [...part.steps, ...handover.steps],
        files: part.files,
        problems,
      };

      plans.set(plan.id, { plan, request: normalized, siteId: site.id, code, environment, handover: handover.record, expires: now() + PLAN_TTL_MS });
      return plan;
    },

    async create(site, planId, confirm) {
      if (confirm !== true) throw new HostingError("invalid", "Nothing was created: the plan needs a yes first.");
      prunePlans();
      const entry = plans.get(planId);

      if (!entry || entry.siteId !== site.id) {
        throw new HostingError("invalid", "That plan isn't one this app made for this site, or it was already used or is more than fifteen minutes old. Make the plan again.");
      }
      if (entry.plan.problems.length > 0) throw new HostingError("invalid", `Nothing was created: ${entry.plan.problems[0]!.message}`);
      notBusy(site);
      if (await readRecord(options.home, site.id)) throw new HostingError("invalid", "This site already has an editor online. Remove it first, then put a new one online.");
      plans.delete(planId);
      const { plan, request, environment } = entry;
      const host = hostFor(plan.host);
      const record: HostedEditorRecord = {
        host: host.id,
        account: plan.account,
        name: plan.name,
        addresses: plan.addresses,
        image: plan.image,
        version: VERSION,
        createdAt: new Date().toISOString(),
        resources: [],
        setup: "pending",
        environment,
        options: { ...(request.options ?? {}) },
        handover: entry.handover,
      };

      known.add(entry.code);
      await writeRecord(options.home, site.id, record);
      await writeSetupCode(options.home, site.id, entry.code);
      return launch(site, "create", "Putting the editor online", async (job) => {
        const ctx = contextFor(host);

        job.update({ detail: `Connecting to ${host.info.name}…`, progress: 0.02 });
        try {
          await host.create(ctx, {
            plan,
            request,
            environment,
            onResource: async (resource) => {
              record.resources.push(resource);
              await writeRecord(options.home, site.id, record);
            },
            onProgress: ({ detail, progress }) => job.update({ detail, ...(progress !== undefined ? { progress: 0.05 + progress * 0.55 } : {}) }),
          });
        } catch (error) {
          // Nothing was made: nothing to remove later, so nothing to remember.
          if (record.resources.length === 0) await deleteRecord(options.home, site.id);
          throw error;
        }
        const pending = await pendingOf(host, record);

        if (pending) {
          return {
            detail: host.info.kind === "self-run" ? `Ready to start: ${pending.steps[0]?.title ?? "start the files"}.` : `Created. Still to do: ${pending.steps[0]?.title ?? "the steps listed"}.`,
          };
        }
        await waitForInstall(record.addresses.editor, job, 0.6, 0.9);
        job.update({ detail: "Handing the site over…", progress: 0.92 });
        await handOver(site, record);
        return { detail: "The editor is online. Open its first-run link to create the owner's account.", url: `https://${record.addresses.editor}` };
      });
    },

    async check(site) {
      const record = await needRecord(site);

      notBusy(site);
      if (!record.handedOver) {
        const editor = record.addresses.editor;
        const ready = await readyz(target(editor));

        if (ready?.state === "setup") {
          try {
            await handOver(site, record);
          } catch (error) {
            throw clean(error);
          }
        } else if (ready?.state === "ready") {
          // First run was finished there without this computer: nothing to hand over any more.
          record.handedOver = new Date().toISOString();
          record.setup = "done";
          delete record.handover;
          await writeRecord(options.home, site.id, record);
          await forgetSetupCode(options.home, site.id);
          await writeEditorConfig(site, { url: `https://${editor}`, host: record.host });
        }
      }
      return service.status(site);
    },

    async setupLink(site) {
      const record = await needRecord(site);
      const finished = "First run on the editor is finished, so its setup link no longer works. Open it and sign in.";

      if (record.setup === "done") throw new HostingError("invalid", finished);
      if ((await readyz(target(record.addresses.editor)))?.state === "ready") {
        record.setup = "done";
        await writeRecord(options.home, site.id, record);
        await forgetSetupCode(options.home, site.id);
        throw new HostingError("invalid", finished);
      }
      const code = await readSetupCode(options.home, site.id);

      if (!code) throw new HostingError("not-found", "This computer doesn't have the editor's setup link.");
      return { url: `https://${record.addresses.editor}/setup?token=${encodeURIComponent(code)}` };
    },

    async upgrade(site) {
      const record = await needRecord(site);
      const host = hostFor(record.host);
      const image = defaultImage(env);

      notBusy(site);
      if (!host.upgrade) {
        throw new HostingError(
          "invalid",
          `This editor runs on a computer of yours, so it is upgraded there: in its folder, set the image in compose.yaml to ${image}, then run “docker compose pull && docker compose up -d”.`
        );
      }
      const upgrade = host.upgrade.bind(host);

      return launch(site, "upgrade", "Upgrading the editor", async (job) => {
        await upgrade(contextFor(host), record, { image, onProgress: ({ detail, progress }) => job.update({ detail, ...(progress !== undefined ? { progress: progress * 0.7 } : {}) }) });
        record.image = image;
        record.version = VERSION;
        await writeRecord(options.home, site.id, record);
        await waitForInstall(record.addresses.editor, job, 0.7, 0.95);
        return { detail: `The editor runs version ${VERSION} now.`, url: `https://${record.addresses.editor}` };
      });
    },

    async backup(site) {
      const record = await needRecord(site);
      const host = hostFor(record.host);

      if (host.backup) {
        const backup = host.backup.bind(host);

        return withHost(host, (ctx) => backup(ctx, record));
      }
      return { kind: "page", url: `https://${record.addresses.editor}/install`, message: "Backups are downloaded from the editor's own Install page." };
    },

    async removal(site) {
      const record = await needRecord(site);
      const host = hostFor(record.host);
      const part = await withHost(host, (ctx) => host.removal(ctx, record));
      const model = await site.model();
      const live = model.urls?.production || model.deploy?.productionUrl;

      return {
        ...part,
        kept: [
          "The site, its repository and every version published from it",
          live ? `The live site at ${live}` : "The live site",
          ...(host.info.kind === "self-run" ? ["The editor on your computer and its disk: stop it there with “docker compose down” (add -v to delete its disk too)"] : []),
        ],
        warning: "Changes made on the hosted editor that were never published are deleted with it. Publish them first, or download a backup from its Install page.",
      };
    },

    async remove(site, confirm) {
      if (confirm !== true) throw new HostingError("invalid", "Nothing was removed: removing needs a yes first.");
      const record = await needRecord(site);
      const host = hostFor(record.host);

      notBusy(site);
      return launch(site, "remove", "Removing the editor", async (job) => {
        const ctx = contextFor(host);

        job.update({ detail: "Checking what was created…", progress: 0.05 });
        const removal = await host.removal(ctx, record);

        await host.remove(
          ctx,
          { ...record, resources: removal.resources },
          {
            onRemoved: async (resource: HostedResource) => {
              record.resources = record.resources.filter((kept) => !(kept.kind === resource.kind && kept.id === resource.id && kept.name === resource.name));
              await writeRecord(options.home, site.id, record);
            },
            onProgress: ({ detail, progress }) => job.update({ detail, ...(progress !== undefined ? { progress: 0.1 + progress * 0.8 } : {}) }),
          }
        );
        const config = await readEditorConfig(site);

        if (config && hostnameOf(config.url) === record.addresses.editor) await writeEditorConfig(site, null);
        await deleteRecord(options.home, site.id);
        const skipped = removal.skipped.map(({ resource, reason }) => `${resource.kind} “${resource.name}”: ${reason}`);

        return {
          detail: skipped.length ? `Removed. ${skipped.length === 1 ? "One thing was" : `${skipped.length} things were`} left alone because ${skipped.length === 1 ? "it" : "they"} changed or had already gone.` : "Removed.",
          ...(skipped.length ? { output: skipped.join("\n") } : {}),
        };
      });
    },

    job(id) {
      return jobs.get(id);
    },

    async wait(jobId, onJob) {
      const done = ended.get(jobId);
      const current = jobs.get(jobId);

      if (!done || !current) {
        if (current) return current;
        throw new HostingError("not-found", "That job isn't known here.");
      }
      if (onJob) {
        listeners.get(jobId)?.add(onJob);
        onJob(current);
      }
      return done;
    },

    async suggestName(site) {
      return defaultEditorName((await site.model()).name);
    },

    dispose() {
      jobs.dispose();
    },
  };

  return service;
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
