/**
 * SiteRegistry: the sites this installation knows about, and getting new ones
 * onto the machine (open a folder, clone a repository, copy a starter).
 *
 * Listing never opens or detects a site — it reads the stored records — so the
 * Sites screen stays instant however many sites there are. A site is opened
 * (its SiteService created, its watcher started) on first `open` or `get`.
 *
 * Multi-site: the records also carry how the person files a site (group, pin,
 * note) and what the list shows about a closed site (its facts, read in the
 * background after a list has been answered — never during it). An open site
 * nobody has used for a long while is closed again (its watcher and index
 * released) and reopens on the next `get`. Previews follow the preview policy.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { mkdir, realpath, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { GalleyError } from "../errors";
import type {
  AddSitesResult,
  CloneSiteRequest,
  CreateSiteRequest,
  EventBus,
  Job,
  PublishResult,
  ScanSitesResult,
  SettingsService,
  SiteGroup,
  SiteRegistry,
  SiteService,
  SiteSummary,
} from "../types";
import { loadSiteModel } from "../content/index";
import { cloneRepository, detectPackageManager, installDependencies, packageName } from "../workspace/index";
import type { PortPool } from "../workspace/preview/ports";
import type { PreviewGateway } from "../workspace/preview/proxy";
import { createJobTracker } from "./jobs";
import { checkLook, scaffoldSite } from "./scaffold-site";
import { openSiteService, type OpenSite } from "./service";
import { listStarters, starterPreviewFile } from "./starters";
import { readSiteFacts, THUMBNAIL_MAX_BYTES, THUMBNAIL_TYPES, type FactsResult } from "./facts";
import { createPreviewPolicy, DEFAULT_PREVIEW_POLICY, type PreviewPolicy, type PreviewPolicyOptions } from "./preview-policy";
import { probeSite, scanForSites, type ScanLimits } from "./scan";
import { createSiteStore, GROUP_COLORS, MAX_GROUP_NAME, MAX_NOTE, type SiteRecord } from "./store";
import { folderName, siteIdFor } from "./util";

export interface SiteRegistryOptions {
  /** Galley home dir: registry file and per-site state live here. */
  home: string;
  /** Where cloned and newly created sites are put. */
  sitesDir: string;
  /** Directory of starter templates (each a folder). */
  startersDir: string;
  events: EventBus;
  overlayScript: () => string | Promise<string>;
  /** Author identity = (await settings.get()).author when name and email are set. */
  settings: Pick<SettingsService, "get" | "authorLayers">;
  host?: string;
  publicHost?: string;
  /** The operator's port range for every site's preview proxies (GALLEY_PREVIEW_PORTS). */
  previewPorts?: PortPool;
  /** A hosted install's one address: every site's preview proxies are mounted there instead of given ports. */
  previewGateway?: PreviewGateway;
  /** Scheme browsers reach the preview proxies with: the public URL's. */
  publicProtocol?: "http" | "https";
  /** Test seam: replaces dependency installation in create/clone. */
  install?: (root: string, onLog: (line: string) => void) => Promise<void>;
  /** After a publish on any open site recorded a version (see SiteDeps.onPublished). */
  onPublished?: (site: SiteService, result: PublishResult) => void;
  /** A site's capture address, handed to its previewed pages (see SiteDeps.captureAddress). */
  captureAddress?: (siteId: string) => string | null;
  /** A site's live address kept outside its files, used when its settings file names none (see SiteDeps.liveUrl). */
  liveUrl?: (siteId: string) => string | null;
  /** False: a site whose checkout has no lockfile isn't given one by the preview's package install (see SiteDeps.addLockfile). Default true. */
  addLockfile?: boolean;
  /** The preview policy's timing (tests); false turns the policy off. Limits come from Settings. */
  previewPolicy?: false | Pick<PreviewPolicyOptions, "sweepMs" | "presenceMs" | "now" | "onPause">;
  /** An open site unused this long is closed again (watcher and index released). Default 60 min; 0 never. */
  releaseAfterMs?: number;
  /** A closed site's facts are read again when older than this. Default 5 min. */
  factsMaxAgeMs?: number;
  /** Test seam: replaces reading a site's facts from its folder. */
  readFacts?: (record: SiteRecord) => Promise<FactsResult | null>;
  /** Test seam: the folder scan's limits. */
  scanLimits?: Partial<ScanLimits>;
  /**
   * A hosted install's one site folder (`<home>/site`). It sits inside the
   * app's own folder on purpose — one install keeps everything in one data
   * folder — so it, and only it, is exempt from the "that folder holds this
   * app's own settings" refusal.
   */
  installSite?: string | (() => string | null);
}

/** The registry as the engine composes it: the contract, plus what tests and the server's shutdown use. */
export interface GalleySiteRegistry extends SiteRegistry {
  /** Reads facts for every site whose facts are older than the limit (`force`: all of them). Resolves when done. */
  refreshFacts(force?: boolean): Promise<void>;
  /** Closes open sites unused for longer than the release time; returns their ids. */
  releaseIdle(now?: number): Promise<string[]>;
  readonly previewPolicy: PreviewPolicy | null;
  /** Ids of the sites open now. */
  openSites(): string[];
}

/** How many sites' facts are read at the same time. */
const FACTS_CONCURRENCY = 2;
const MAX_BULK_ADD = 500;

const INSTALL_FAILED_NOTE =
  "The site was created, but installing its dependencies didn't work. The preview will try again when it starts.";

/** realpath of the deepest existing ancestor, plus the rest — for paths that may not exist yet. */
function realish(path: string): string {
  let probe = resolve(path);
  const rest: string[] = [];

  for (;;) {
    try {
      return join(realpathSync(probe), ...rest.reverse());
    } catch {
      const parent = dirname(probe);

      if (parent === probe) return resolve(path);
      rest.push(basename(probe));
      probe = parent;
    }
  }
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);

  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel) && rel.split(sep)[0] !== "..");
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof GalleyError ? error.message : fallback;
}

/** "https://host/acme/marketing-site.git" → "marketing-site". */
export function repositoryName(url: string): string {
  const trimmed = url.trim().replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/\.git$/i, "");
  const last = trimmed.split(/[/:\\]/).pop() ?? "";
  const clean = last.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "");

  return clean || "site";
}

/** `<parent>/<base>`, or `<base>-2`, `<base>-3`… when that is taken by anything non-empty. */
function freeDirectory(parent: string, base: string): string {
  const taken = (path: string) => {
    try {
      return !statSync(path).isDirectory() || readdirSync(path).length > 0;
    } catch {
      return false;
    }
  };
  let candidate = join(parent, base);

  for (let n = 2; taken(candidate); n += 1) candidate = join(parent, `${base}-${n}`);
  return candidate;
}

export async function createSiteRegistry(options: SiteRegistryOptions): Promise<GalleySiteRegistry> {
  const store = await createSiteStore(options.home);
  const homeReal = realish(options.home);
  const sitesReal = realish(options.sitesDir);
  const userHome = realish(homedir());
  const installSiteReal = (): string | null => {
    const folder = typeof options.installSite === "function" ? options.installSite() : options.installSite;

    return folder ? realish(folder) : null;
  };
  const services = new Map<string, OpenSite>();
  const opening = new Map<string, Promise<OpenSite>>();
  const jobs = createJobTracker(options.events);
  let disposed = false;
  /** When each open site was last asked for (a route, a tool) or did anything (its events). */
  const lastUsed = new Map<string, number>();
  /** Running jobs per site, so a site isn't closed in the middle of one. */
  const runningJobs = new Map<string, string>();
  const releaseAfterMs = options.releaseAfterMs ?? 60 * 60_000;
  const factsMaxAgeMs = options.factsMaxAgeMs ?? 5 * 60_000;
  const readFacts = options.readFacts ?? ((record: SiteRecord) => readSiteFacts(record, options.home));
  let refreshing: Promise<void> | null = null;
  const policy: PreviewPolicy | null =
    options.previewPolicy === false
      ? null
      : createPreviewPolicy({
          events: options.events,
          limits: async () => (await options.settings.get().catch(() => null))?.previews ?? DEFAULT_PREVIEW_POLICY,
          controller: (siteId) => services.get(siteId)?.previewHandle() ?? null,
          ...(options.previewPolicy ?? {}),
        });

  /** The site's own author when it has one, else the shared one; null falls back to git config. */
  const authorFor = (siteId: string | null) => async () => {
    try {
      const identity = (await options.settings.get(siteId ? { siteId } : undefined)).author;

      return identity?.name?.trim() && identity.email?.trim() ? { name: identity.name.trim(), email: identity.email.trim() } : null;
    } catch {
      return null;
    }
  };
  const author = authorFor(null);
  const install =
    options.install ??
    (async (root: string, onLog: (line: string) => void) => {
      // The adapter's environment applies to installation too (SiteModel.environment).
      const model = await loadSiteModel(root).catch(() => null);

      await installDependencies(root, model?.packageManager ?? detectPackageManager(root), onLog, model?.environment);
    });

  /** The app's own folder is never a site — unless it is the configured sites folder inside it. */
  function refuseAppFolder(real: string): void {
    if (options.installSite !== undefined && real === installSiteReal()) return;
    if (isWithin(homeReal, real) && !(isWithin(sitesReal, real) && real !== sitesReal)) {
      throw new GalleyError("forbidden", "That folder holds this app's own settings, so it can't be opened as a site.", real);
    }
  }

  function checkOpenable(path: unknown): string {
    if (typeof path !== "string" || path.trim() === "") throw new GalleyError("invalid", "Choose a folder to open.");
    if (!isAbsolute(path)) throw new GalleyError("invalid", "Use the folder's full location, starting from the top of the disk.", path);
    let isDirectory: boolean;

    try {
      isDirectory = statSync(path).isDirectory();
    } catch {
      throw new GalleyError("not-found", "That folder doesn't exist. Check the location and try again.", path);
    }
    if (!isDirectory) throw new GalleyError("invalid", "That's a file, not a folder. Choose the folder the site is in.", path);
    const real = realpathSync(path);

    if (dirname(real) === real) {
      throw new GalleyError("forbidden", "The whole disk can't be opened as a site. Choose the site's own folder.", real);
    }
    if (real === userHome) {
      throw new GalleyError("forbidden", "Your home folder can't be opened as a site. Choose the site's own folder inside it.", real);
    }
    refuseAppFolder(real);
    return real;
  }

  function recordFor(service: OpenSite, lastOpenedAt: number): SiteRecord {
    const snap = service.snapshot();
    // How the person filed the site and its last facts are kept; what the open site knows better replaces the rest.
    const { branch: _branch, remoteUrl: _remote, liveUrl: _live, ...kept } = store.get(service.id) ?? ({} as Partial<SiteRecord>);
    const liveUrl = service.liveUrl();

    return {
      ...kept,
      id: service.id,
      root: service.root,
      name: snap.name,
      framework: snap.framework,
      lastOpenedAt,
      ...(snap.branch ? { branch: snap.branch } : {}),
      ...(snap.remoteUrl ? { remoteUrl: snap.remoteUrl } : {}),
      ...(liveUrl ? { liveUrl } : {}),
    };
  }

  // Keep the stored name, framework and branch in step with the live site, so
  // the list is right the next time the app starts.
  const unsubscribe = options.events.subscribe((event) => {
    if (disposed) return;
    // Anything a site does counts as use: an assistant turn streaming, a file changing, a preview answering.
    if ("siteId" in event && typeof event.siteId === "string" && services.has(event.siteId)) lastUsed.set(event.siteId, Date.now());
    if (event.type === "job" && event.job.siteId) {
      if (event.job.state === "running") runningJobs.set(event.job.id, event.job.siteId);
      else runningJobs.delete(event.job.id);
    }
    if (event.type !== "site.updated") return;
    const service = services.get(event.siteId);
    const stored = store.get(event.siteId);

    if (!service || !stored) return;
    const next = recordFor(service, stored.lastOpenedAt);

    if (JSON.stringify(next) !== JSON.stringify(stored)) {
      void store.put(next).then(() => options.events.emit({ type: "sites.updated" }), () => undefined);
    }
  });

  async function openAt(id: string, root: string): Promise<OpenSite> {
    if (disposed) throw new GalleyError("busy", "The app is shutting down.");
    const live = services.get(id);

    if (live) {
      await store.put(recordFor(live, Date.now()));
      options.events.emit({ type: "sites.updated" });
      return live;
    }
    const pending = opening.get(id);

    if (pending) return pending;
    const promise = (async () => {
      const service = await openSiteService(root, {
        id,
        events: options.events,
        overlayScript: options.overlayScript,
        author: authorFor(id),
        ...(options.settings.authorLayers ? { authorLayers: () => options.settings.authorLayers!({ siteId: id }) } : {}),
        ...(options.host ? { host: options.host } : {}),
        ...(options.publicHost ? { publicHost: options.publicHost } : {}),
        ...(options.previewPorts ? { previewPorts: options.previewPorts } : {}),
        ...(options.previewGateway ? { previewGateway: options.previewGateway } : {}),
        ...(options.publicProtocol ? { publicProtocol: options.publicProtocol } : {}),
        ...(options.onPublished ? { onPublished: (result: PublishResult) => options.onPublished?.(service, result) } : {}),
        ...(options.captureAddress ? { captureAddress: () => options.captureAddress?.(id) ?? null } : {}),
        ...(options.liveUrl ? { liveUrl: () => options.liveUrl?.(id) ?? null } : {}),
        ...(options.addLockfile === false ? { addLockfile: false } : {}),
      });

      services.set(id, service);
      lastUsed.set(id, Date.now());
      await store.put(recordFor(service, Date.now()));
      options.events.emit({ type: "sites.updated" });
      return service;
    })().finally(() => opening.delete(id));

    opening.set(id, promise);
    return promise;
  }

  /** One record as the list shows it: stored facts, with what an open site knows live laid over them. */
  function summaryOf(record: SiteRecord): SiteSummary {
    const live = services.get(record.id);
    const snap = live?.snapshot();
    const branch = snap?.branch ?? record.branch;
    const remoteUrl = snap?.remoteUrl ?? record.remoteUrl;
    const previewState = live?.previewHandle()?.status().state;
    const liveUrl = live?.liveUrl() ?? record.liveUrl ?? record.facts?.liveUrl;
    const facts = record.facts
      ? { ...record.facts, ...(snap ? { pendingChanges: snap.pendingChanges } : {}), ...(liveUrl ? { liveUrl } : {}) }
      : undefined;

    return {
      id: record.id,
      name: snap?.name ?? record.name,
      root: record.root,
      framework: snap?.framework ?? record.framework,
      ...(branch ? { branch } : {}),
      ...(remoteUrl ? { remoteUrl } : {}),
      lastOpenedAt: record.lastOpenedAt,
      pendingChanges: snap?.pendingChanges ?? record.facts?.pendingChanges ?? 0,
      ...(existsSync(record.root) ? {} : { missing: true }),
      ...(record.group ? { group: record.group } : {}),
      ...(record.pinned ? { pinned: true } : {}),
      ...(record.note ? { note: record.note } : {}),
      ...(facts ? { facts } : {}),
      ...(previewState ? { previewState } : {}),
      ...(record.thumbnail ? { thumbnailUrl: `/api/sites/${encodeURIComponent(record.id)}/thumbnail?v=${encodeURIComponent(record.thumbnail)}` } : {}),
    };
  }

  /**
   * Reads the facts of every site whose facts are stale, two at a time, after
   * the current request has been answered; one write and one `sites.updated`
   * at the end, and only when something a person would see changed.
   */
  function refreshFacts(force = false): Promise<void> {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      await new Promise((resolve) => setImmediate(resolve));
      const now = Date.now();
      const due = store
        .all()
        .filter((record) => force || !record.facts || now - record.facts.checkedAt > factsMaxAgeMs)
        .sort((a, b) => (a.facts?.checkedAt ?? 0) - (b.facts?.checkedAt ?? 0));
      const updated: SiteRecord[] = [];
      let visible = false;
      let next = 0;

      const worker = async () => {
        while (!disposed && next < due.length) {
          const record = due[next++]!;
          const result = await readFacts(record).catch(() => null);
          const current = store.get(record.id);

          if (!result || !current) continue;
          const { thumbnail: _old, ...rest } = current;
          const fresh: SiteRecord = { ...rest, facts: result.facts, ...(result.thumbnail ? { thumbnail: result.thumbnail } : {}) };
          const seen = (r: SiteRecord) => JSON.stringify([{ ...r.facts, checkedAt: 0 }, r.thumbnail ?? null]);

          if (seen(fresh) !== seen(current)) visible = true;
          updated.push(fresh);
        }
      };

      await Promise.all(Array.from({ length: FACTS_CONCURRENCY }, worker));
      if (disposed || updated.length === 0) return;
      // Records may have been filed or removed meanwhile: only the facts are written back.
      const merged = updated.flatMap((record) => {
        const current = store.get(record.id);

        return current ? [{ ...current, facts: record.facts, ...(record.thumbnail ? { thumbnail: record.thumbnail } : {}) }] : [];
      });

      await store.putMany(merged);
      if (visible) options.events.emit({ type: "sites.updated" });
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function releaseIdle(now = Date.now()): Promise<string[]> {
    if (releaseAfterMs <= 0) return [];
    const released: string[] = [];
    const busySites = new Set(runningJobs.values());

    for (const [id, service] of [...services]) {
      const state = service.previewHandle()?.status().state;

      if (state === "ready" || state === "starting" || state === "installing") continue;
      if (busySites.has(id) || opening.has(id)) continue;
      if (now - Math.max(lastUsed.get(id) ?? 0, policy?.lastUsed(id) ?? 0) < releaseAfterMs) continue;
      services.delete(id);
      lastUsed.delete(id);
      const record = store.get(id);
      const snap = service.snapshot();

      // What the list showed while it was open stays true once it is closed.
      if (record?.facts) await store.put({ ...record, facts: { ...record.facts, pendingChanges: snap.pendingChanges } }).catch(() => undefined);
      await service.dispose().catch(() => undefined);
      released.push(id);
    }
    return released;
  }
  const releaseTimer = releaseAfterMs > 0 ? setInterval(() => void releaseIdle().catch(() => undefined), Math.min(5 * 60_000, releaseAfterMs)) : null;

  releaseTimer?.unref?.();

  function requireRecord(id: string): SiteRecord {
    const record = store.get(id);

    if (!record) throw new GalleyError("not-found", "That site isn't in the list any more.", id);
    return record;
  }

  function requireGroup(id: string): SiteGroup {
    const group = store.groups().find((candidate) => candidate.id === id);

    if (!group) throw new GalleyError("not-found", "That group doesn't exist any more.", id);
    return group;
  }

  function groupName(raw: unknown): string {
    const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";

    if (!name) throw new GalleyError("invalid", "Give the group a name.");
    if (name.length > MAX_GROUP_NAME) throw new GalleyError("invalid", `Keep the group's name under ${MAX_GROUP_NAME} characters.`);
    return name;
  }

  function groupColor(raw: unknown): SiteGroup["color"] {
    if (GROUP_COLORS.includes(raw as SiteGroup["color"])) return raw as SiteGroup["color"];
    throw new GalleyError("invalid", "Choose one of the group colours.", String(raw));
  }

  const sitesChanged = () => options.events.emit({ type: "sites.updated" });

  const registry: GalleySiteRegistry = {
    async list(): Promise<SiteSummary[]> {
      const list = store
        .all()
        .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
        .map(summaryOf);

      // Never awaited here: the list is answered from what is stored.
      if (!disposed) void refreshFacts();
      return list;
    },

    async get(id): Promise<SiteService | null> {
      const live = services.get(id) ?? (await opening.get(id));

      if (live) {
        lastUsed.set(id, Date.now());
        return live;
      }
      const record = store.get(id);

      return record ? openAt(record.id, record.root) : null;
    },

    async open(request) {
      const real = checkOpenable(request?.path);

      return openAt(siteIdFor(real), real);
    },

    async clone(request: CloneSiteRequest): Promise<Job> {
      const url = typeof request?.url === "string" ? request.url.trim() : "";

      if (!url) throw new GalleyError("invalid", "Paste the address of the repository to download.");
      const name = repositoryName(url);
      const target = request.directory ? resolve(request.directory) : freeDirectory(options.sitesDir, name);

      refuseAppFolder(realish(target));
      const existed = existsSync(target);
      const job = jobs.start("clone", `Downloading ${name}`);

      void (async () => {
        try {
          await mkdir(dirname(target), { recursive: true });
          await cloneRepository({ url, directory: target, ...(request.branch ? { branch: request.branch } : {}) }, (detail, progress) =>
            job.update({ detail, ...(progress !== undefined ? { progress } : {}) })
          );
          job.update({ detail: "Opening the site", progress: 1 });
          const service = await openAt(siteIdFor(target), realpathSync(target));

          job.finish("done", { siteId: service.id, progress: 1, detail: "The site is ready." });
        } catch (error) {
          // cloneRepository cleans up after itself; this covers a failure after
          // the download (opening the site), so no unlisted copy is left behind.
          if (!existed) await rm(target, { recursive: true, force: true }).catch(() => undefined);
          job.finish("error", { detail: messageOf(error, "The site couldn't be downloaded.") });
        }
      })();
      return job.snapshot();
    },

    async create(request: CreateSiteRequest): Promise<Job> {
      const name = typeof request?.name === "string" ? request.name.trim() : "";

      if (!name || !/[\p{L}\p{N}]/u.test(name)) throw new GalleyError("invalid", "Give the site a name with at least one letter or number.");
      if (name.length > 100) throw new GalleyError("invalid", "That name is too long. Keep it under 100 characters.");
      const starter = (await listStarters(options.startersDir)).find((candidate) => candidate.id === request.starter);

      if (!starter) throw new GalleyError("not-found", "That starter couldn't be found.", String(request.starter));
      const starterDir = join(options.startersDir, starter.id);

      await checkLook(starterDir, request.look);
      const target = freeDirectory(request.directory ? resolve(request.directory) : options.sitesDir, packageName(name));

      refuseAppFolder(realish(target));
      const existed = existsSync(target);
      const job = jobs.start("create", `Creating ${name}`);

      void (async () => {
        try {
          job.update({ detail: "Copying the starter", progress: 0.1 });
          let note: string | undefined;

          await scaffoldSite({
            starterDir,
            targetDir: target,
            name,
            ...(request.look ? { look: request.look } : {}),
            author: await author(),
            // Installed before the first version is recorded, so the lock file
            // it writes is in that version and the site starts with no changes.
            beforeFirstVersion: async (root) => {
              job.update({ detail: "Installing the site's dependencies", progress: 0.3 });
              try {
                await install(root, (line) => {
                  const text = line.trim();

                  if (text) job.update({ detail: text.slice(0, 200) });
                });
              } catch {
                // The preview installs on first start, so the site is still usable.
                note = INSTALL_FAILED_NOTE;
              }
            },
          });
          const service = await openAt(siteIdFor(target), realpathSync(target));

          job.finish("done", { siteId: service.id, progress: 1, detail: note ?? "The site is ready." });
        } catch (error) {
          if (!existed) await rm(target, { recursive: true, force: true }).catch(() => undefined);
          job.finish("error", { detail: messageOf(error, "The site couldn't be created.") });
        }
      })();
      return job.snapshot();
    },

    async remove(id) {
      const service = services.get(id) ?? (await opening.get(id)?.catch(() => undefined));

      services.delete(id);
      lastUsed.delete(id);
      await service?.dispose();
      if (!store.get(id)) return;
      await store.remove(id);
      options.events.emit({ type: "sites.updated" });
    },

    async update(id, patch) {
      const record = requireRecord(id);
      const next: SiteRecord = { ...record };

      if (patch?.group !== undefined) {
        if (patch.group === null || patch.group === "") delete next.group;
        else next.group = requireGroup(String(patch.group)).id;
      }
      if (patch?.pinned !== undefined) {
        if (patch.pinned === true) next.pinned = true;
        else delete next.pinned;
      }
      if (patch?.note !== undefined) {
        const note = typeof patch.note === "string" ? patch.note.trim() : "";

        if (note.length > MAX_NOTE) throw new GalleyError("invalid", `Keep the note under ${MAX_NOTE} characters.`);
        if (note) next.note = note;
        else delete next.note;
      }
      await store.put(next);
      sitesChanged();
      return summaryOf(next);
    },

    async groups() {
      return store.groups();
    },

    async createGroup(input) {
      const groups = store.groups();
      const used = new Set(groups.map((group) => group.color));
      const group: SiteGroup = {
        id: `g-${randomBytes(5).toString("hex")}`,
        name: groupName(input?.name),
        // A colour no other group has yet, while there are some left.
        color: input?.color !== undefined ? groupColor(input.color) : (GROUP_COLORS.find((color) => !used.has(color)) ?? GROUP_COLORS[groups.length % GROUP_COLORS.length]!),
        collapsed: input?.collapsed === true,
      };

      await store.setGroups([...groups, group]);
      sitesChanged();
      return group;
    },

    async updateGroup(id, input) {
      const current = requireGroup(id);
      const next: SiteGroup = {
        ...current,
        ...(input?.name !== undefined ? { name: groupName(input.name) } : {}),
        ...(input?.color !== undefined ? { color: groupColor(input.color) } : {}),
        ...(input?.collapsed !== undefined ? { collapsed: input.collapsed === true } : {}),
      };

      await store.setGroups(store.groups().map((group) => (group.id === id ? next : group)));
      sitesChanged();
      return next;
    },

    async removeGroup(id) {
      requireGroup(id);
      await store.setGroups(store.groups().filter((group) => group.id !== id));
      sitesChanged();
    },

    async orderGroups(ids) {
      const groups = store.groups();
      const wanted = Array.isArray(ids) ? ids.map(String) : [];

      if (wanted.length !== groups.length || new Set(wanted).size !== wanted.length || !groups.every((group) => wanted.includes(group.id))) {
        throw new GalleyError("invalid", "The groups changed while you were arranging them. Try again.");
      }
      await store.setGroups(wanted.map((id) => groups.find((group) => group.id === id)!));
      sitesChanged();
      return store.groups();
    },

    async scan(request, signal) {
      const path = typeof request?.path === "string" ? request.path.trim() : "";

      if (!path) throw new GalleyError("invalid", "Choose the folder your sites are in.");
      if (!isAbsolute(path)) throw new GalleyError("invalid", "Use the folder's full location, starting from the top of the disk.", path);
      let real: string;

      try {
        real = await realpath(path);
        if (!(await stat(real)).isDirectory()) throw new Error("not a folder");
      } catch {
        throw new GalleyError("not-found", "That folder doesn't exist. Check the location and try again.", path);
      }
      if (dirname(real) === real) throw new GalleyError("forbidden", "The whole disk can't be searched. Choose the folder your sites are in.", real);
      const outcome = await scanForSites(real, {
        ...(request.depth !== undefined ? { depth: request.depth } : {}),
        ...(signal ? { signal } : {}),
        ...(options.scanLimits ? { limits: options.scanLimits } : {}),
      });
      const result: ScanSitesResult = {
        path: real,
        sites: outcome.sites
          // The app's own folder and the home folder are never sites (open() refuses them too).
          .filter((site) => site.path !== userHome && !(isWithin(homeReal, site.path) && !(isWithin(sitesReal, site.path) && site.path !== sitesReal)))
          .map((site) => {
            const siteId = siteIdFor(site.path);

            return { path: site.path, name: site.name, framework: site.framework, siteId, known: store.get(siteId) !== null };
          }),
        visited: outcome.visited,
        truncated: outcome.truncated,
        cancelled: outcome.cancelled,
        skippedLinks: outcome.skippedLinks,
      };

      return result;
    },

    async addMany(request) {
      const paths = Array.isArray(request?.paths) ? [...new Set(request.paths.filter((path): path is string => typeof path === "string"))] : [];

      if (paths.length === 0) throw new GalleyError("invalid", "Choose at least one site to add.");
      if (paths.length > MAX_BULK_ADD) throw new GalleyError("invalid", `Add at most ${MAX_BULK_ADD} sites at a time.`);
      const group = request.group ? requireGroup(request.group).id : undefined;
      const result: AddSitesResult = { added: [], skipped: [] };
      const records: SiteRecord[] = [];
      const now = Date.now();

      for (const path of paths) {
        let real: string;

        try {
          // Exactly the checks "Open a folder" makes.
          real = checkOpenable(path);
        } catch (error) {
          result.skipped.push({ path, reason: messageOf(error, "That folder can't be added.") });
          continue;
        }
        const id = siteIdFor(real);

        if (store.get(id) || records.some((record) => record.id === id)) {
          result.skipped.push({ path, reason: "It's already in the list." });
          continue;
        }
        const probe = await probeSite(real).catch(() => null);

        records.push({
          id,
          root: real,
          name: probe?.name ?? folderName(real),
          framework: probe?.framework ?? { id: "generic", name: "Site" },
          // Never opened: it sorts after the sites in use, and says so.
          lastOpenedAt: 0,
          addedAt: now,
          ...(group ? { group } : {}),
        });
      }
      if (records.length > 0) {
        await store.putMany(records);
        sitesChanged();
        void refreshFacts();
      }
      result.added = records.map(summaryOf);
      return result;
    },

    async thumbnail(id) {
      const record = store.get(id);

      if (!record?.thumbnail) return null;
      const extension = record.thumbnail.split(".").pop()?.toLowerCase() ?? "";
      const type = THUMBNAIL_TYPES[extension];

      if (!type || record.thumbnail.split("/").includes("..")) return null;
      try {
        const rootReal = await realpath(record.root);
        const real = await realpath(join(rootReal, ...record.thumbnail.split("/")));
        const info = await stat(real);

        // Inside the site (a link can't take it elsewhere), a file, and a sensible size.
        if (!isWithin(rootReal, real) || !info.isFile() || info.size > THUMBNAIL_MAX_BYTES) return null;
        return { path: real, type };
      } catch {
        return null;
      }
    },

    touch(id) {
      if (!store.get(id)) return;
      if (services.has(id)) lastUsed.set(id, Date.now());
      policy?.touch(id);
    },

    refreshFacts,
    releaseIdle,
    get previewPolicy() {
      return policy;
    },
    openSites: () => [...services.keys()],

    starters() {
      return listStarters(options.startersDir);
    },

    starterPreview(starterId, lookId) {
      return starterPreviewFile(options.startersDir, starterId, lookId);
    },

    job(id) {
      return jobs.get(id);
    },

    async dispose() {
      disposed = true;
      unsubscribe();
      policy?.dispose();
      if (releaseTimer) clearInterval(releaseTimer);
      await refreshing?.catch(() => undefined);
      await Promise.allSettled([...opening.values()]);
      const open = [...services.values()];

      services.clear();
      await Promise.all(open.map((service) => service.dispose()));
      jobs.dispose();
      await store.flush();
    },
  };

  return registry;
}
