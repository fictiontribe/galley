/**
 * The media storage service: connecting a site to a bucket (and, for
 * pictures, Cloudflare Images), checking it, and handing the engine the
 * stores new media goes to.
 *
 *   settings  galley.config.json `media.storage` — ids and addresses only
 *   keys      `<home>/state/<siteId>/media/secrets.json` (keys.ts)
 *
 * A connection is only saved after the check passes for real, and a pasted
 * key only replaces the stored one then: a key that doesn't work never
 * replaces one that does. Nothing here returns, throws or logs a key.
 */
import { GalleyError } from "../errors";
import type { EventBus, GalleyConfig, Job, MediaItem, MediaStorageConfig, SettingsService, SiteService } from "../types";
import { createJobTracker } from "../site/jobs";
import { requireLevel } from "../install/caller";
import { levelFor } from "../install/route-access";
import type { ApiRouteKey } from "../api";
import { planMove, runMove, type MoveContext, type MoveOutcome } from "./move";
import { checkUpload, mediaSubfolder } from "../workspace/media";
import { createBucketStore } from "./bucket-store";
import { runCheck, settingsFailure, testNameFor } from "./check";
import type { MediaCheckResult, MediaConnectRequest, MediaConnectResult, MediaMovePlan, MediaMoveRequest, MediaStorageStatus, MediaStoreDeleteResult, MediaStoreInfo, MediaStoreLocation, MediaUsage } from "./contract";
import { createMediaLibrary, type LibraryItem, type MediaLibrary } from "./library";
import { BUCKET_CONNECTORS, isTrialAddress, normalizePrefix, normalizeStorageConfig, settingsProblems } from "./info";
import { createMediaKeys, normalizeMediaKey, scrub, type MediaKeys } from "./keys";
import type { Credentials } from "./sigv4";
import { parseStorePath, placeFile, StoreError, StoreNameTaken, storePath, trimFound, type MediaStore } from "./store";

/** A kind of bucket the site can connect: what the person is told, and how its store is made. */
export interface BucketConnector {
  info: MediaStoreInfo;
  create(input: { config: MediaStorageConfig; credentials: Credentials; fetch?: typeof fetch; now?: () => number }): MediaStore;
}

const extra: BucketConnector[] = [];

/** Adds a plugin's bucket connector. A taken id is refused, so a plugin can't quietly replace a built-in. */
export function registerBucketConnector(connector: BucketConnector): void {
  if (builtInConnectors().some((known) => known.info.id === connector.info.id) || extra.some((known) => known.info.id === connector.info.id)) {
    throw new Error(`A media storage connector called “${connector.info.id}” is already registered.`);
  }
  extra.push(connector);
}

function builtInConnectors(): BucketConnector[] {
  return BUCKET_CONNECTORS.map((info) => ({ info, create: (input) => createBucketStore(input) }));
}

export interface MediaStorageServiceOptions {
  home: string;
  /** For "does the site have a Cloudflare key" (Make the bucket for me, Cloudflare Images). */
  settings?: Pick<SettingsService, "readSecret">;
  env?: NodeJS.ProcessEnv;
  /** fetch for the stores' APIs. Test seam. */
  fetch?: typeof fetch;
  /** fetch for public addresses (no key is ever sent there). Test seam. */
  publicFetch?: typeof fetch;
  now?: () => number;
  keys?: MediaKeys;
  library?: MediaLibrary;
  connectors?: BucketConnector[];
  /** How long a store's listing is trusted before it is listed again (ms). Default one minute. */
  listTtlMs?: number;
  /** For the "media" jobs moving files. Absent: moves run without job events (the CLI waits on them). */
  events?: EventBus;
}

export type MediaUpload = { filename: string; directory?: string; data: Uint8Array };

export interface MediaStorageService {
  connectors(): MediaStoreInfo[];
  status(site: SiteService): Promise<MediaStorageStatus>;
  /** Runs the check: on the request's settings (nothing is saved), or on the saved ones. */
  check(site: SiteService, request?: MediaConnectRequest): Promise<MediaCheckResult>;
  /** Checks, and only when that passes saves the settings and any pasted keys. */
  connect(site: SiteService, request: MediaConnectRequest): Promise<MediaConnectResult>;
  /** Stops putting new media in the bucket. Files already there stay, and pages using them keep working. */
  disconnect(site: SiteService, options?: { forgetKeys?: boolean }): Promise<MediaStorageStatus>;
  /** The stores new media goes to, most specific first. Empty: everything stays in the repository. */
  stores(site: SiteService): Promise<MediaStore[]>;
  /** The bucket store of saved settings and keys; null when not connected (or its keys are missing). */
  bucket(site: SiteService): Promise<MediaStore | null>;
  /** Removes the site's media keys (it left the list). */
  forgetSite(siteId: string): Promise<void>;

  // ── the library, for the site service (SiteDeps.media)

  /**
   * Saves an upload where the site keeps new media: the first store that
   * takes it, else the repository (`toRepository`). A store never overwrites:
   * a taken name becomes "-2", "-3"… as in the repository.
   */
  save(site: SiteService, upload: MediaUpload, toRepository: () => Promise<MediaItem>): Promise<MediaItem>;
  /** The library: the repository's items and every store's. A store that can't be listed shows what was known. */
  list(site: SiteService, repository: MediaItem[]): Promise<MediaItem[]>;
  /** Why a store couldn't be listed just now, by store. */
  problems(siteId: string): Partial<Record<MediaStoreLocation, string>>;
  /** Files put in a store since the last publish, each saying whether the working copy uses it. */
  pending(site: SiteService): Promise<MediaItem[]>;
  /** After a publish: the uploads the published version now uses are published. */
  afterPublish(site: SiteService): Promise<void>;
  /** Where an address is used: pages and data files of the working copy, files of the published version. */
  usage(site: SiteService, url: string): Promise<MediaUsage>;
  /** Deletes from a store for good — anything used by the working copy or the published version is refused. */
  deleteStored(site: SiteService, paths: string[]): Promise<MediaStoreDeleteResult>;
  /** The bytes of a stored file ("bucket:lowfield/coat.webp"), for the app's own previews; null when it isn't there. */
  readStored(site: SiteService, path: string): Promise<Uint8Array | null>;

  // ── moving files, and changing a store's address

  /** What a move (or an address change) would do. Changes nothing. */
  planMove(site: SiteService, request: MediaMoveRequest): Promise<MediaMovePlan>;
  /** Starts it as a "media" job; progress arrives as job events. One per site at a time. */
  startMove(site: SiteService, request: MediaMoveRequest): Promise<Job>;
  /** Runs it and waits (the CLI). */
  move(site: SiteService, request: MediaMoveRequest, onProgress?: (detail: string, progress: number) => void): Promise<MoveOutcome>;
  job(id: string): Job | null;
}

/**
 * The engine checks the level itself, whoever calls (a route, the assistant,
 * an MCP tool, a plugin), against the route that reaches the same work — so
 * the two can't disagree (install/route-access.ts).
 */
function guard(route: ApiRouteKey): void {
  const level = levelFor(route);

  if (level) requireLevel(level);
}

export function createMediaStorageService(options: MediaStorageServiceOptions): MediaStorageService {
  const keys = options.keys ?? createMediaKeys({ home: options.home, ...(options.env ? { env: options.env } : {}) });
  const library = options.library ?? createMediaLibrary(options.home);
  const listTtl = options.listTtlMs ?? 60_000;
  const clock = options.now ?? Date.now;
  const listProblems = new Map<string, Partial<Record<MediaStoreLocation, string>>>();
  const jobs = createJobTracker(options.events ?? { emit: () => undefined, subscribe: () => () => undefined });
  const moving = new Map<string, string>();
  const all = () => options.connectors ?? [...builtInConnectors(), ...extra];
  const connectorFor = (id: string) => all().find((connector) => connector.info.id === id) ?? null;

  async function savedConfig(site: SiteService): Promise<MediaStorageConfig | null> {
    return (await site.model()).media.storage ?? null;
  }

  async function credentialsFor(site: SiteService, request?: MediaConnectRequest): Promise<{ credentials: Credentials | null; missing: "accessKeyId" | "secretAccessKey" | null }> {
    const accessKeyId = request?.accessKeyId ? normalizeMediaKey("accessKeyId", request.accessKeyId) : (await keys.get(site.id, "accessKeyId")).value;
    const secretAccessKey = request?.secretAccessKey ? normalizeMediaKey("secretAccessKey", request.secretAccessKey) : (await keys.get(site.id, "secretAccessKey")).value;

    if (!accessKeyId) return { credentials: null, missing: "accessKeyId" };
    if (!secretAccessKey) return { credentials: null, missing: "secretAccessKey" };
    return { credentials: { accessKeyId, secretAccessKey }, missing: null };
  }

  function makeStore(config: MediaStorageConfig, credentials: Credentials): MediaStore {
    const connector = connectorFor(config.connector);

    if (!connector) throw new GalleyError("invalid", `Galley doesn't know a storage service called “${config.connector}”.`);
    return connector.create({ config, credentials, ...(options.fetch ? { fetch: options.fetch } : {}), ...(options.now ? { now: options.now } : {}) });
  }

  async function checkWith(site: SiteService, config: MediaStorageConfig, request?: MediaConnectRequest): Promise<MediaCheckResult> {
    if (!connectorFor(config.connector)) {
      return settingsFailure([{ field: undefined, message: `Galley doesn't know a storage service called “${config.connector}”.` }]);
    }
    const problems = settingsProblems(config);

    if (problems.length) return settingsFailure(problems);
    let resolved: Awaited<ReturnType<typeof credentialsFor>>;

    try {
      resolved = await credentialsFor(site, request);
    } catch (error) {
      const field = error instanceof GalleyError && /Secret/.test(error.message) ? "secretAccessKey" : "accessKeyId";

      return settingsFailure([{ field, message: error instanceof Error ? error.message : String(error) }]);
    }
    if (!resolved.credentials) {
      return settingsFailure([
        { field: resolved.missing!, message: resolved.missing === "accessKeyId" ? "Paste the key's Access Key ID." : "Paste the key's Secret Access Key." },
      ]);
    }
    const store = makeStore(config, resolved.credentials);
    const result = await runCheck(store, { testName: testNameFor(normalizePrefix(config.prefix)), ...(options.publicFetch ? { fetch: options.publicFetch } : {}) });

    // Whatever a service said back, no key leaves in it.
    return {
      ...result,
      steps: result.steps.map((step) => (step.message ? { ...step, message: scrub(step.message) } : step)),
      ...(result.message ? { message: scrub(result.message) } : {}),
      ...(result.detail ? { detail: scrub(result.detail) } : {}),
    };
  }

  async function writeStorage(site: SiteService, next: MediaStorageConfig | null): Promise<void> {
    const current: GalleyConfig = (await site.readConfig()) ?? {};
    const { storage: _old, ...media } = current.media ?? {};
    const nextMedia = next ? { ...media, storage: next } : media;
    const { media: _media, ...rest } = current;

    await site.saveConfig(Object.keys(nextMedia).length ? { ...rest, media: nextMedia } : rest);
  }

  const service: MediaStorageService = {
    connectors: () => all().map((connector) => connector.info),

    async status(site) {
      const config = await savedConfig(site);
      const [accessKeyId, secretAccessKey, cloudflareKey] = await Promise.all([
        keys.status(site.id, "accessKeyId"),
        keys.status(site.id, "secretAccessKey"),
        options.settings?.readSecret("cloudflare", { siteId: site.id }).catch(() => null) ?? Promise.resolve(null),
      ]);
      const connector = config ? connectorFor(config.connector) : null;

      return {
        bucket: {
          connected: Boolean(config && accessKeyId.configured && secretAccessKey.configured),
          config,
          store: connector ? { id: connector.info.id, name: connector.info.name } : null,
          keys: { accessKeyId, secretAccessKey },
          created: null,
          ...(config && isTrialAddress(config.publicUrl) ? { trialAddress: true } : {}),
        },
        cloudflare: { keyStored: Boolean(cloudflareKey) },
      };
    },

    async check(site, request) {
      guard("POST /api/sites/:siteId/media/storage/check");
      const config = request?.config ? normalizeStorageConfig(request.config) : await savedConfig(site);

      if (!config) return settingsFailure([{ field: "bucket", message: "The site isn't connected to a bucket yet." }]);
      return checkWith(site, config, request);
    },

    async connect(site, request) {
      guard("PUT /api/sites/:siteId/media/storage");
      const config = normalizeStorageConfig(request.config);
      const check = await checkWith(site, config, request);

      if (!check.ok) return { check };
      if (request.accessKeyId) await keys.set(site.id, "accessKeyId", request.accessKeyId);
      if (request.secretAccessKey) await keys.set(site.id, "secretAccessKey", request.secretAccessKey);
      await writeStorage(site, config);
      return { check, status: await service.status(site) };
    },

    async disconnect(site, disconnect = {}) {
      guard("DELETE /api/sites/:siteId/media/storage");
      await writeStorage(site, null);
      if (disconnect.forgetKeys) {
        await keys.set(site.id, "accessKeyId", null);
        await keys.set(site.id, "secretAccessKey", null);
      }
      return service.status(site);
    },

    async bucket(site) {
      const config = await savedConfig(site);

      if (!config || !connectorFor(config.connector)) return null;
      const { credentials } = await credentialsFor(site);

      return credentials ? makeStore(config, credentials) : null;
    },

    async stores(site) {
      const bucket = await service.bucket(site);

      return bucket ? [bucket] : [];
    },

    forgetSite: (siteId) => keys.forget(siteId),

    async save(site, upload, toRepository) {
      const stores = await service.stores(site);

      if (!stores.length) return toRepository();
      const checked = checkUpload(upload);
      const placement = placeFile(stores, { type: checked.type, size: upload.data.byteLength, ...(checked.width && checked.height ? { width: checked.width, height: checked.height } : {}) });
      const why = placement.passedOver.map((passed) => passed.reason).join(" ");

      if (!placement.store) {
        const item = await toRepository();

        return why ? { ...item, placement: `Kept in the repository: ${why}` } : item;
      }
      const store = placement.store;
      const { subfolder } = mediaSubfolder((await site.model()).media, upload.directory);
      const known = new Set((await library.all(site.id)).filter((item) => item.location === store.location).map((item) => item.key));

      for (let attempt = 1; attempt < 1000; attempt += 1) {
        const name = `${checked.base}${attempt === 1 ? "" : `-${attempt}`}.${checked.ext}`;
        const wanted = store.keyFor(`${subfolder}${name}`);

        if (known.has(wanted)) continue;
        let stored;

        try {
          stored = await store.put({ name: wanted, data: upload.data, type: checked.type, ...(checked.width && checked.height ? { width: checked.width, height: checked.height } : {}) });
        } catch (error) {
          if (error instanceof StoreNameTaken) continue;
          if (error instanceof StoreError) throw new GalleyError(error.transient ? "busy" : "unconfigured", `The file wasn't saved: ${scrub(error.message)}`, error.detail ? scrub(error.detail) : undefined);
          throw error;
        }
        const entry: LibraryItem = {
          location: store.location,
          key: stored.key,
          url: stored.url,
          name: stored.key.split("/").pop() ?? stored.key,
          size: upload.data.byteLength,
          type: checked.type,
          ...(checked.width && checked.height ? { width: checked.width, height: checked.height } : {}),
          uploadedAt: stored.uploadedAt,
          published: false,
          uploaded: true,
        };

        await library.update(site.id, (items) => [...items.filter((item) => !(item.location === entry.location && item.key === entry.key)), entry]);
        return { ...itemOf(entry), ...(why ? { placement: `Kept in ${placeName(store)}: ${why}` } : {}) };
      }
      throw new GalleyError("conflict", "Too many files already use that name. Pick a different name.", checked.base);
    },

    async list(site, repository) {
      const stores = await service.stores(site);
      const problems: Partial<Record<MediaStoreLocation, string>> = {};

      for (const store of stores) {
        if (!store.abilities.canList || !store.list) continue;
        const listedAt = await library.listedAt(site.id, store.location);

        if (listedAt !== null && clock() - listedAt < listTtl) continue;
        try {
          await relist(site, store);
        } catch (error) {
          problems[store.location] = `${store.name} couldn't be listed just now, so this shows what was there last time. ${error instanceof Error ? scrub(error.message) : ""}`.trim();
        }
      }
      listProblems.set(site.id, problems);
      const locations = new Set(stores.map((store) => store.location));
      const kept = (await library.all(site.id)).filter((item) => locations.has(item.location));
      // Whether any page uses each stored file, for the library's "not used yet" filter.
      const [working, published] = kept.length ? await Promise.all([usedKeys(site, stores, "working"), usedKeys(site, stores, "base")]) : [new Set<string>(), new Set<string>()];

      return [
        ...repository,
        ...kept
          .sort((a, b) => b.uploadedAt - a.uploadedAt)
          .map((item) => {
            const path = storePath(item.location, item.key);

            return { ...itemOf(item), used: working.has(path) || published.has(path) };
          }),
      ];
    },

    problems: (siteId) => listProblems.get(siteId) ?? {},

    async pending(site) {
      const stores = await service.stores(site);

      if (!stores.length) return [];
      const unpublished = (await library.all(site.id)).filter((item) => !item.published && stores.some((store) => store.location === item.location));

      if (!unpublished.length) return [];
      const used = await usedKeys(site, stores, "working");

      return unpublished.map((item) => ({ ...itemOf(item), used: used.has(storePath(item.location, item.key)) }));
    },

    async afterPublish(site) {
      const stores = await service.stores(site);

      if (!stores.length) return;
      const items = await library.all(site.id);

      if (!items.some((item) => !item.published)) return;
      const used = await usedKeys(site, stores, "base");

      await library.update(site.id, (current) => current.map((item) => (!item.published && used.has(storePath(item.location, item.key)) ? { ...item, published: true } : item)));
    },

    async usage(site, url) {
      const stores = await service.stores(site);
      const store = stores.find((candidate) => candidate.keyOf(url) !== null);

      if (!store) return { url, working: [], published: [] };
      const key = store.keyOf(url)!;
      const [working, published] = await Promise.all([filesUsing(site, store, key, "working"), filesUsing(site, store, key, "base")]);
      const titled = await Promise.all(working.map(async (path) => ({ path, title: await titleOf(site, path) })));

      return { url, working: titled, published };
    },

    async readStored(site, path) {
      const parsed = parseStorePath(path);
      const store = parsed ? (await service.stores(site)).find((candidate) => candidate.location === parsed.location) : null;

      if (!parsed || !store) return null;
      try {
        return await store.get(parsed.key);
      } catch (error) {
        if (error instanceof StoreError) throw new GalleyError(error.transient ? "busy" : "unconfigured", scrub(error.message));
        throw error;
      }
    },

    async planMove(site, request) {
      guard("POST /api/sites/:siteId/media/storage/move/plan");
      return planMove(await moveContext(site), request);
    },

    async move(site, request, onProgress) {
      guard("POST /api/sites/:siteId/media/storage/move");
      if (moving.has(site.id) && jobs.get(moving.get(site.id)!)?.state === "running") throw new GalleyError("busy", "Files are already being moved for this site. Wait for that to finish.");
      return runMove(await moveContext(site, onProgress), request);
    },

    async startMove(site, request) {
      guard("POST /api/sites/:siteId/media/storage/move");
      const running = moving.get(site.id);

      if (running && jobs.get(running)?.state === "running") throw new GalleyError("busy", "Files are already being moved for this site. Wait for that to finish.");
      // Read-only first, so a wrong request is refused before a job starts.
      await service.planMove(site, request);
      const job = jobs.start("media", request.kind === "address" ? "Changing the files' address" : request.to === "repository" ? "Moving media to the repository" : "Moving media to the bucket");

      job.update({ siteId: site.id, detail: "Getting ready…", progress: 0 });
      moving.set(site.id, job.id);
      void runMove(await moveContext(site, (detail, progress) => job.update({ detail, progress })), request).then(
        (outcome) => job.finish(outcome.problems.length ? "error" : "done", { progress: 1, detail: outcome.summary, ...(outcome.problems.length ? { output: outcome.problems.map((p) => `${p.path}: ${p.reason}`).join("\n") } : {}) }),
        (error: unknown) => job.finish("error", { detail: error instanceof Error ? scrub(error.message) : String(error) })
      );
      return job.snapshot();
    },

    job: (id) => jobs.get(id),

    async deleteStored(site, paths) {
      guard("POST /api/sites/:siteId/media/storage/delete");
      const stores = await service.stores(site);
      const result: MediaStoreDeleteResult = { deleted: [], refused: [] };

      for (const path of paths) {
        const parsed = parseStorePath(path);
        const store = parsed ? stores.find((candidate) => candidate.location === parsed.location) : null;

        if (!parsed || !store) throw new GalleyError("invalid", "That file isn't in one of the site's media stores.", path);
        const [working, published] = await Promise.all([filesUsing(site, store, parsed.key, "working"), filesUsing(site, store, parsed.key, "base")]);
        const name = parsed.key.split("/").pop() ?? parsed.key;

        if (working.length || published.length) {
          result.refused.push({ path, name, working, published });
          continue;
        }
        try {
          await store.delete(parsed.key);
        } catch (error) {
          if (error instanceof StoreError) throw new GalleyError(error.transient ? "busy" : "unconfigured", `“${name}” wasn't deleted: ${scrub(error.message)}`);
          throw error;
        }
        await library.update(site.id, (items) => items.filter((item) => !(item.location === parsed.location && item.key === parsed.key)));
        result.deleted.push(path);
      }
      return result;
    },
  };

  async function moveContext(site: SiteService, onProgress?: (detail: string, progress: number) => void): Promise<MoveContext> {
    const stores = await service.stores(site);

    return {
      site,
      stores,
      fetch: options.publicFetch ?? fetch,
      ...(onProgress ? { onProgress } : {}),
      async recordStored(item) {
        await library.update(site.id, (items) => [
          ...items.filter((known) => !(known.location === item.location && known.key === item.key)),
          // Moved, not newly uploaded: the pages that use it show in Proof; the file itself isn't a pending upload.
          { ...item, uploadedAt: clock(), published: true },
        ]);
      },
      async storedItems(location) {
        const store = stores.find((candidate) => candidate.location === location);

        if (store?.list) await relist(site, store);
        return (await library.all(site.id)).filter((item) => item.location === location);
      },
      async saveAddress(location, publicUrl) {
        if (location !== "bucket") throw new GalleyError("invalid", "Only a bucket's address can be changed here.");
        const config = await savedConfig(site);

        if (!config) throw new GalleyError("unconfigured", "The site isn't connected to a bucket.");
        await writeStorage(site, { ...config, publicUrl: publicUrl.replace(/\/+$/, "") });
        await library.update(site.id, (items) =>
          items.map((item) => {
            if (item.location !== "bucket") return item;
            const store = stores.find((candidate) => candidate.location === "bucket");
            const next = store?.rebase?.(item.url, publicUrl);

            return next ? { ...item, url: next } : item;
          })
        );
      },
    };
  }

  /** Lists a store in full and brings the record up to date: new names are added (measured when the store keeps sizes), gone ones dropped. */
  async function relist(site: SiteService, store: MediaStore): Promise<void> {
    const found: Array<{ key: string; url: string; size: number | null; type: string | null; uploadedAt: number; width?: number; height?: number }> = [];
    let cursor: string | undefined;

    do {
      const page = await store.list!(cursor);

      found.push(...page.items);
      cursor = page.next ?? undefined;
    } while (cursor && found.length < 20_000);
    const before = new Map((await library.all(site.id)).filter((item) => item.location === store.location).map((item) => [item.key, item]));
    const unmeasured = found.filter((item) => !before.has(item.key) && !item.width && item.type?.startsWith("image/") && item.type !== "image/svg+xml").slice(0, 25);
    const measured = new Map<string, { width: number; height: number }>();

    // A few at a time, from what the store keeps about each (never the bytes).
    for (const item of unmeasured) {
      const head = await store.head(item.key).catch(() => null);

      if (head?.width && head.height) measured.set(item.key, { width: head.width, height: head.height });
    }
    await library.update(site.id, (items, listedAt) => {
      const others = items.filter((item) => item.location !== store.location);
      const listed: LibraryItem[] = found.map((item) => {
        const known = before.get(item.key);
        const size = measured.get(item.key);

        return known
          ? { ...known, size: item.size ?? known.size, url: item.url }
          : {
              location: store.location,
              key: item.key,
              url: item.url,
              name: item.key.split("/").pop() ?? item.key,
              size: item.size,
              type: item.type,
              ...(item.width && item.height ? { width: item.width, height: item.height } : size ? size : {}),
              uploadedAt: item.uploadedAt,
              // Found there rather than uploaded from here: it isn't a pending change.
              published: true,
            };
      });

      listedAt[store.location] = clock();
      return [...others, ...listed];
    });
  }

  /** Store paths ("bucket:key") that the working copy or the published version uses. */
  async function usedKeys(site: SiteService, stores: MediaStore[], rev: "working" | "base"): Promise<Set<string>> {
    const used = new Set<string>();

    if (!site.grepText) return used;
    for (const store of stores) {
      for (const { match } of await site.grepText(store.addressPattern(), { rev })) {
        const key = store.keyOf(trimFound(match));

        if (key !== null) used.add(storePath(store.location, key));
      }
    }
    return used;
  }

  async function filesUsing(site: SiteService, store: MediaStore, key: string, rev: "working" | "base"): Promise<string[]> {
    if (!site.grepText) return [];
    const files = new Set<string>();

    for (const { path, match } of await site.grepText(store.addressPattern(), { rev })) {
      if (store.keyOf(trimFound(match)) === key) files.add(path);
    }
    return [...files].sort();
  }

  async function titleOf(site: SiteService, path: string): Promise<string> {
    try {
      return (await site.readEntry(path)).title || path;
    } catch {
      return path.split("/").pop() ?? path;
    }
  }

  return service;
}

function placeName(store: MediaStore): string {
  return store.location === "bucket" ? "the bucket" : store.name;
}

/** A store's file as the library shows it. */
function itemOf(item: LibraryItem): MediaItem {
  return {
    path: storePath(item.location, item.key),
    url: item.url,
    name: item.name,
    size: item.size ?? 0,
    type: item.type ?? "application/octet-stream",
    ...(item.width && item.height ? { width: item.width, height: item.height } : {}),
    modifiedAt: item.uploadedAt,
    status: item.published ? "clean" : "added",
    location: item.location,
    key: item.key,
  };
}
