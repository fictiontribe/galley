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
import { randomBytes } from "node:crypto";
import { GalleyError } from "../errors";
import type { EventBus, GalleyConfig, Job, MediaImagesConfig, MediaItem, MediaStorageConfig, SettingsService, SiteService } from "../types";
import { createImagesStore, deliveryBase } from "./cloudflare-images";
import { createMediaFetch, MEDIA_ANSWER_LIMIT } from "./net";
import { makeR2Bucket, removeR2Bucket } from "./cloudflare-r2";
import { IMAGES_INFO, imagesSettingsProblems, normalizeImagesConfig } from "./images-info";
import { createJobTracker } from "../site/jobs";
import { changeSettings } from "../site/settings-records";
import { requireLevel } from "../install/caller";
import { levelFor } from "../install/route-access";
import type { ApiRouteKey } from "../api";
import { planMove, runMove, type MoveContext, type MoveOutcome } from "./move";
import { checkUpload, mediaSubfolder } from "../workspace/media";
import { createBucketStore } from "./bucket-store";
import { runCheck, settingsFailure, testNameFor } from "./check";
import type { MediaCreatedRecord, MediaCheckResult, MediaConnectRequest, MediaConnectResult, MediaImagesConnectRequest, MediaImagesConnectResult, MediaImagesStatus, MediaMovePlan, MediaMoveRequest, MediaMoveResult, MediaStorageStatus, MediaStoreDeleteResult, MediaStoreInfo, MediaStoreLocation, MediaUsage } from "./contract";
import { createMediaLibrary, type LibraryItem, type MediaLibrary } from "./library";
import { BUCKET_CONNECTORS, isTrialAddress, normalizePrefix, normalizeStorageConfig, settingsProblems } from "./info";
import { createMediaKeys, normalizeMediaKey, scrub, type MediaKeys } from "./keys";
import { createReadLine } from "./read-line";
import type { Credentials } from "./sigv4";
import { ADDRESS_TAIL, escapePattern, parseStorePath, placeFile, StoreError, StoreNameTaken, storePath, trimFound, type MediaStore, type StoredItem } from "./store";
import { keyUnder } from "./bucket-store";

/** A kind of bucket the site can connect: what the person is told, and how its store is made. */
export interface BucketConnector {
  info: MediaStoreInfo;
  create(input: { config: MediaStorageConfig; credentials: Credentials; fetch?: typeof fetch; now?: () => number }): MediaStore;
}

const extra: BucketConnector[] = [];

/**
 * Adds a bucket connector to this process, for a program that embeds the
 * engine. Plugins can't contribute one: that isn't part of the plugin API.
 * A taken id is refused, so a built-in can't be quietly replaced.
 */
export function registerBucketConnector(connector: BucketConnector): void {
  if (builtInConnectors().some((known) => known.info.id === connector.info.id) || extra.some((known) => known.info.id === connector.info.id)) {
    throw new Error(`A media storage connector called “${connector.info.id}” is already registered.`);
  }
  extra.push(connector);
}

function builtInConnectors(): BucketConnector[] {
  return BUCKET_CONNECTORS.map((info) => ({ info, create: (input) => createBucketStore(input) }));
}

/** The most the app shows of a stored file through the server: the library's own upload limit. */
export const RAW_LIMIT = 25 * 1024 * 1024;
/** How many stored files one site may have read through the server at once: each read may hold a whole file in memory. */
export const RAW_AT_ONCE = 4;
/**
 * How many more reads may wait their turn for a site before one is refused.
 * Waiting holds no file, only an open request, so the line is long: five
 * browsers' worth at the hundred requests HTTP/2 usually lets one browser
 * keep open (over plain HTTP a browser keeps six). It isn't longer because at
 * a tenth to a third of a second a read, the last of this many is served in
 * about a quarter to three quarters of a minute, which is as long as a proxy
 * usually waits for an answer: a longer line would only fail later.
 */
export const RAW_WAITING = 512;
/** The most of each list kept with how a move ended: plenty to read, and the record never grows without end. */
const MOVE_LIST_KEPT = 300;
const TOO_LARGE_TO_SHOW = "That file is larger than 25 MB, so the app doesn't show it. Open it at its address instead.";

export interface MediaStorageServiceOptions {
  home: string;
  /** For "does the site have a Cloudflare key" (Make the bucket for me, Cloudflare Images). */
  settings?: Pick<SettingsService, "readSecret">;
  env?: NodeJS.ProcessEnv;
  /** fetch for the stores' APIs. Test seam. */
  fetch?: typeof fetch;
  /** fetch for public addresses (no key is ever sent there). Test seam. */
  publicFetch?: typeof fetch;
  /**
   * A hosted install: every request goes only to https and public addresses,
   * checked before connecting. Locally, this computer's own addresses (a
   * stand-in, MinIO) may be used.
   */
  hosted?: boolean;
  now?: () => number;
  keys?: MediaKeys;
  library?: MediaLibrary;
  connectors?: BucketConnector[];
  /** How long a store's listing is trusted before it is listed again (ms). Default one minute. */
  listTtlMs?: number;
  /** For the "media" jobs moving files. Absent: moves run without job events (the CLI waits on them). */
  events?: EventBus;
  /** Cloudflare's API origin for Cloudflare Images. Tests and the rehearsal point it at a stand-in. Default GALLEY_MEDIA_IMAGES_API, else Cloudflare's. */
  imagesApi?: string;
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

  // ── Cloudflare Images, for pictures

  /** Runs the check on the request's settings (nothing saved), or the saved ones. */
  checkImages(site: SiteService, request?: MediaImagesConnectRequest): Promise<MediaCheckResult>;
  /** Checks, and only when that passes saves `media.images` and the token (or the choice of the site's Cloudflare key). */
  connectImages(site: SiteService, request: MediaImagesConnectRequest): Promise<MediaImagesConnectResult>;
  /** Pictures go where other files go again. Pictures already in Images stay, and pages using them keep working. */
  disconnectImages(site: SiteService, options?: { forgetKeys?: boolean }): Promise<MediaStorageStatus>;

  // ── "Make the bucket for me" on Cloudflare, with the site's Cloudflare key

  /** Makes an R2 bucket and its r2.dev address. Saves nothing else: the key for its files is still made by hand. */
  makeBucket(site: SiteService, request: { account: string; name: string }): Promise<{ created: MediaCreatedRecord; config: MediaStorageConfig }>;
  /** Removes the bucket Galley made (only that one, and only when nothing uses it and it is empty). */
  removeMadeBucket(site: SiteService): Promise<MediaStorageStatus>;

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
  readStored(site: SiteService, path: string, options?: { signal?: AbortSignal }): Promise<Uint8Array | null>;

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
  // Every outbound request goes through the guard unless a test hands its own fetch in.
  const guarded = createMediaFetch({ hosted: Boolean(options.hosted), maxBytes: MEDIA_ANSWER_LIMIT });
  const apiFetch = options.fetch ?? guarded;
  const publicFetch = options.publicFetch ?? guarded;
  const keys = options.keys ?? createMediaKeys({ home: options.home, ...(options.env ? { env: options.env } : {}) });
  const library = options.library ?? createMediaLibrary(options.home);
  const listTtl = options.listTtlMs ?? 60_000;
  const clock = options.now ?? Date.now;
  const listProblems = new Map<string, Partial<Record<MediaStoreLocation, string>>>();
  const jobs = createJobTracker(options.events ?? { emit: () => undefined, subscribe: () => () => undefined });
  const moving = new Map<string, string>();
  /** Sites whose move has been asked for and hasn't become a job yet (or runs without one). */
  const starting = new Set<string>();
  const rawReads = createReadLine(RAW_AT_ONCE, RAW_WAITING);
  const claimMove = (siteId: string) => {
    const running = moving.get(siteId);

    if (starting.has(siteId) || (running && jobs.get(running)?.state === "running")) throw new GalleyError("busy", "Files are already being moved for this site. Wait for that to finish.");
    starting.add(siteId);
  };
  const all = () => options.connectors ?? [...builtInConnectors(), ...extra];
  const connectorFor = (id: string) => all().find((connector) => connector.info.id === id) ?? null;

  async function savedConfig(site: SiteService): Promise<MediaStorageConfig | null> {
    return (await site.model()).media.storage ?? null;
  }

  /** The saved settings, only when they pass the same checks as on connect (the file may have been edited by hand). */
  async function usableConfig(site: SiteService): Promise<MediaStorageConfig | null> {
    const config = await savedConfig(site);

    return config && !settingsProblems(config, { hosted: Boolean(options.hosted) }).length ? config : null;
  }

  /** Whether two settings name the same bucket at the same address: a saved key is only ever sent where it was saved for. */
  function sameBucket(a: MediaStorageConfig | null, b: MediaStorageConfig): boolean {
    if (!a) return false;
    return a.connector === b.connector && a.bucket === b.bucket && (a.account ?? "") === (b.account ?? "") && (a.region ?? "") === (b.region ?? "") && (a.endpoint ?? "") === (b.endpoint ?? "") && Boolean(a.pathStyle) === Boolean(b.pathStyle);
  }

  async function credentialsFor(site: SiteService, request?: MediaConnectRequest): Promise<{ credentials: Credentials | null; missing: "accessKeyId" | "secretAccessKey" | null }> {
    // The site's saved key goes only to the bucket it was saved for; other settings need the key typed again.
    // (A key from the environment is the operator's choice, for whatever the site names.)
    const stored = async (name: "accessKeyId" | "secretAccessKey") => {
      const found = await keys.get(site.id, name);

      if (found.source === "site" && request?.config && !sameBucket(await savedConfig(site), normalizeStorageConfig(request.config))) return null;
      return found.value;
    };
    const accessKeyId = request?.accessKeyId ? normalizeMediaKey("accessKeyId", request.accessKeyId) : await stored("accessKeyId");
    const secretAccessKey = request?.secretAccessKey ? normalizeMediaKey("secretAccessKey", request.secretAccessKey) : await stored("secretAccessKey");

    if (!accessKeyId) return { credentials: null, missing: "accessKeyId" };
    if (!secretAccessKey) return { credentials: null, missing: "secretAccessKey" };
    return { credentials: { accessKeyId, secretAccessKey }, missing: null };
  }

  function makeStore(config: MediaStorageConfig, credentials: Credentials): MediaStore {
    const connector = connectorFor(config.connector);

    if (!connector) throw new GalleyError("invalid", `Galley doesn't know a storage service called “${config.connector}”.`);
    return connector.create({ config, credentials, fetch: apiFetch, ...(options.now ? { now: options.now } : {}) });
  }

  async function checkWith(site: SiteService, config: MediaStorageConfig, request?: MediaConnectRequest): Promise<MediaCheckResult> {
    if (!connectorFor(config.connector)) {
      return settingsFailure([{ field: undefined, message: `Galley doesn't know a storage service called “${config.connector}”.` }]);
    }
    const problems = settingsProblems(config, { hosted: Boolean(options.hosted) });

    if (problems.length) return settingsFailure(problems);
    let resolved: Awaited<ReturnType<typeof credentialsFor>>;

    try {
      resolved = await credentialsFor(site, request);
    } catch (error) {
      const field = error instanceof GalleyError && /Secret/.test(error.message) ? "secretAccessKey" : "accessKeyId";

      return settingsFailure([{ field, message: error instanceof Error ? error.message : String(error) }]);
    }
    if (!resolved.credentials) {
      const moved = request?.config && (await keys.get(site.id, resolved.missing!)).source === "site";

      return settingsFailure([
        {
          field: resolved.missing!,
          message: moved
            ? "These settings name a different bucket or address from the saved ones, so the saved key isn't sent there. Paste the key for this bucket."
            : resolved.missing === "accessKeyId"
              ? "Paste the key's Access Key ID."
              : "Paste the key's Secret Access Key.",
        },
      ]);
    }
    const store = makeStore(config, resolved.credentials);
    const result = await runCheck(store, { testName: testNameFor(normalizePrefix(config.prefix)), fetch: publicFetch });

    // Whatever a service said back, no key leaves in it.
    return {
      ...result,
      steps: result.steps.map((step) => (step.message ? { ...step, message: scrub(step.message) } : step)),
      ...(result.message ? { message: scrub(result.message) } : {}),
      ...(result.detail ? { detail: scrub(result.detail) } : {}),
    };
  }

  /**
   * Saves where the site's media goes, over the settings file as it is: the
   * file is read with its version and saved only over that version, so a key
   * somebody else saved meanwhile is not set back (site/settings-records.ts).
   */
  async function writeStorage(site: SiteService, next: MediaStorageConfig | null): Promise<void> {
    await changeSettings(site, (current: GalleyConfig) => {
      const { storage: _old, ...media } = current.media ?? {};
      const nextMedia = next ? { ...media, storage: next } : media;
      const { media: _media, ...rest } = current;

      return Object.keys(nextMedia).length ? { ...rest, media: nextMedia } : rest;
    });
  }

  const service: MediaStorageService = {
    // The buckets, then Cloudflare Images (pictures only, alongside a bucket or the repository).
    connectors: () => [...all().map((connector) => connector.info), IMAGES_INFO],

    async status(site) {
      const config = await savedConfig(site);
      const usable = await usableConfig(site);
      const [accessKeyId, secretAccessKey, cloudflareKey] = await Promise.all([
        keys.status(site.id, "accessKeyId"),
        keys.status(site.id, "secretAccessKey"),
        options.settings?.readSecret("cloudflare", { siteId: site.id }).catch(() => null) ?? Promise.resolve(null),
      ]);
      const connector = config ? connectorFor(config.connector) : null;

      return {
        bucket: {
          connected: Boolean(usable && accessKeyId.configured && secretAccessKey.configured),
          config,
          store: connector ? { id: connector.info.id, name: connector.info.name } : null,
          keys: { accessKeyId, secretAccessKey },
          created: await madeRecord(site.id),
          ...(config && isTrialAddress(config.publicUrl) ? { trialAddress: true } : {}),
        },
        images: await imagesStatus(site),
        cloudflare: { keyStored: Boolean(cloudflareKey) },
        ...(await moveStatus(site.id)),
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
      if (request.config.connector === IMAGES_INFO.id) throw new GalleyError("invalid", "Cloudflare Images is connected on its own, beside a bucket: use Keep pictures in Cloudflare Images.");
      const config = normalizeStorageConfig(request.config);
      const check = await checkWith(site, config, request);

      if (!check.ok) return { check };
      const before = await savedConfig(site);

      if (before && before.publicUrl !== config.publicUrl && before.bucket === config.bucket) await library.rememberAddress(site.id, "bucket", before.publicUrl);
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
      const config = await usableConfig(site);

      if (!config || !connectorFor(config.connector)) return null;
      const { credentials } = await credentialsFor(site);

      return credentials ? makeStore(config, credentials) : null;
    },

    async stores(site) {
      const [images, bucket] = await Promise.all([imagesStore(site), service.bucket(site)]);

      // Most specific first: pictures to Images, everything else (and what Images won't take) to the bucket.
      return [...(images ? [images] : []), ...(bucket ? [bucket] : [])];
    },

    async checkImages(site, request) {
      guard("POST /api/sites/:siteId/media/images/check");
      const config = request?.config ? normalizeImagesConfig(request.config) : ((await site.model()).media.images ?? null);

      if (!config) return settingsFailure([{ field: "account", message: "The site isn't connected to Cloudflare Images yet." }]);
      return checkImagesWith(site, config, request);
    },

    async connectImages(site, request) {
      guard("PUT /api/sites/:siteId/media/images");
      const saved = (await site.model()).media.images;
      // The site keeps its mark on its pictures; a new connection gets one of its own.
      const scope = request.config.scope ?? (saved && saved.account === request.config.account.trim().toLowerCase() ? saved.scope : undefined) ?? randomBytes(6).toString("hex");
      const config = normalizeImagesConfig({ ...request.config, scope });
      const check = await checkImagesWith(site, config, request);

      if (!check.ok) return { check };
      if (request.token) await keys.set(site.id, "imagesToken", request.token);
      await useDeployKey.set(site.id, request.useDeployKey ? !request.token : false);
      await writeImages(site, config);
      return { check, status: await service.status(site) };
    },

    async makeBucket(site, request) {
      guard("POST /api/sites/:siteId/media/storage/make-bucket");
      const token = (await options.settings?.readSecret("cloudflare", { siteId: site.id }).catch(() => null)) ?? null;

      if (!token) throw new GalleyError("unconfigured", "The site has no Cloudflare key for putting it online yet. Make the bucket by hand, or set up Online first.");
      const earlier = await madeRecord(site.id);

      // One bucket made per site at a time, so none is ever forgotten while still public.
      if (earlier) throw new GalleyError("conflict", `Galley already made “${earlier.bucket}” for this site. Use it, or remove it first (it must be empty).`);
      const account = request.account.trim().toLowerCase();
      const name = request.name.trim();
      const probe = settingsProblems({ connector: "r2", account, bucket: name, publicUrl: "https://example.com" });

      if (probe.length) throw new GalleyError("invalid", probe.map((problem) => problem.message).join(" "));
      let publicUrl: string;

      try {
        ({ publicUrl } = await makeR2Bucket({ account, token, ...r2Api() }, name));
      } catch (error) {
        if (error instanceof StoreError) throw new GalleyError(error.transient ? "busy" : "invalid", scrub(error.message), error.detail ? scrub(error.detail) : undefined);
        throw error;
      }
      const created: MediaCreatedRecord = { provider: "cloudflare", account, bucket: name, publicUrl, createdAt: new Date(clock()).toISOString() };

      await keys.setRaw(site.id, "media:created", JSON.stringify(created));
      return { created, config: { connector: "r2", account, bucket: name, publicUrl } };
    },

    async removeMadeBucket(site) {
      guard("DELETE /api/sites/:siteId/media/storage/made-bucket");
      const created = await madeRecord(site.id);

      if (!created) throw new GalleyError("not-found", "Galley hasn't made a bucket for this site.");
      if ((await savedConfig(site))?.bucket === created.bucket) throw new GalleyError("conflict", `The site still keeps new files in “${created.bucket}”. Stop using the bucket first.`);
      const token = (await options.settings?.readSecret("cloudflare", { siteId: site.id }).catch(() => null)) ?? null;

      if (!token) throw new GalleyError("unconfigured", "The site's Cloudflare key is gone, so the bucket can't be removed from here. Remove it in R2 on Cloudflare.");
      try {
        await removeR2Bucket({ account: created.account, token, ...r2Api() }, created.bucket);
      } catch (error) {
        if (error instanceof StoreError) throw new GalleyError(error.transient ? "busy" : "conflict", scrub(error.message), error.detail ? scrub(error.detail) : undefined);
        throw error;
      }
      await keys.setRaw(site.id, "media:created", null);
      return service.status(site);
    },

    async disconnectImages(site, disconnect = {}) {
      guard("DELETE /api/sites/:siteId/media/images");
      await writeImages(site, null);
      if (disconnect.forgetKeys) {
        await keys.set(site.id, "imagesToken", null);
        await useDeployKey.set(site.id, false);
      }
      return service.status(site);
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

        if (store.abilities.naming === "galley" && known.has(wanted)) continue;
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
          name: stored.name ?? stored.key.split("/").pop() ?? stored.key,
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
        if (!store.abilities.canList || !store.list || !(await mayList(site, store))) continue;
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
      // Without a search, nothing is shown as unused (the filter would offer it for deletion).
      const searched = kept.length ? await Promise.all([usedKeys(site, stores, "working"), usedKeys(site, stores, "base")]).catch(() => null) : [new Set<string>(), new Set<string>()];
      const working: Set<string> = searched?.[0] ?? new Set(kept.map((item) => storePath(item.location, item.key)));
      const published: Set<string> = searched?.[1] ?? new Set<string>();

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

    readStored(site, path, read) {
      // A few at a time per site: each read is bounded, and so is how many run at once. The rest wait their turn.
      return rawReads.run(site.id, () => readOwn(site, path), read?.signal);
    },

    async planMove(site, request) {
      guard("POST /api/sites/:siteId/media/storage/move/plan");
      return planMove(await moveContext(site), request);
    },

    async move(site, request, onProgress) {
      guard("POST /api/sites/:siteId/media/storage/move");
      claimMove(site.id);
      try {
        const outcome = await runMove(await moveContext(site, onProgress), request);

        // A move that was refused or stopped here is told to whoever asked, at once; only one that ran is kept.
        await rememberMove(site.id, request, outcome);
        return outcome;
      } finally {
        starting.delete(site.id);
      }
    },

    async startMove(site, request) {
      guard("POST /api/sites/:siteId/media/storage/move");
      // Claimed before anything is awaited, so two starts at once can't both run.
      claimMove(site.id);
      try {
        // Read-only first, so a wrong request is refused before a job starts.
        await service.planMove(site, request);
      } catch (error) {
        starting.delete(site.id);
        throw error;
      }
      const job = jobs.start("media", request.kind === "address" ? "Changing the files' address" : request.to === "repository" ? "Moving media to the repository" : request.to === "images" ? "Moving pictures to Cloudflare Images" : "Moving media to the bucket");

      job.update({ siteId: site.id, detail: "Getting ready…", progress: 0 });
      moving.set(site.id, job.id);
      starting.delete(site.id);
      // How it ended is kept before the job says so: whoever hears the job end can read the whole of it at once.
      void runMove(await moveContext(site, (detail, progress) => job.update({ detail, progress })), request).then(
        async (outcome) => {
          await rememberMove(site.id, request, outcome);
          // Done unless something went wrong. A file that stays because code or a template uses it is the move working as meant.
          job.finish(outcome.problems.length ? "error" : "done", { progress: 1, detail: outcome.summary, ...(outcome.problems.length ? { output: outcome.problems.map((p) => `${p.path}: ${p.reason}`).join("\n") } : {}) });
        },
        async (error: unknown) => {
          await rememberMove(site.id, request, error);
          job.finish("error", { detail: error instanceof Error ? scrub(error.message) : String(error) });
        }
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
        await assertOwnKey(site, store, parsed.key);
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

  /** Reads a stored file of the site's own, refusing anything over RAW_LIMIT. */
  /** Keeps how a move ended (its outcome, or the error that stopped it) for the site's status. Failing to keep it never fails the move. */
  async function rememberMove(siteId: string, request: MediaMoveRequest, ended: unknown): Promise<void> {
    const outcome = ended && typeof ended === "object" && "summary" in ended && "problems" in ended ? (ended as MoveOutcome) : null;
    const stayed = outcome?.stillMentioned ?? [];
    const result: MediaMoveResult = outcome
      ? {
          at: clock(),
          request,
          state: outcome.problems.length ? "error" : "done",
          summary: outcome.summary,
          copied: outcome.copied,
          pages: outcome.rewrittenPages,
          ...(outcome.rewrittenTemplates ? { templates: outcome.rewrittenTemplates } : {}),
          removed: outcome.removed,
          ...(outcome.alsoMentioned?.length ? { alsoMentioned: outcome.alsoMentioned.slice(0, MOVE_LIST_KEPT) } : {}),
          stayed: stayed.slice(0, MOVE_LIST_KEPT).map((item) => ({ path: item.path, pages: item.pages.slice(0, 20) })),
          stayedFiles: stayed.length,
          problems: outcome.problems.slice(0, MOVE_LIST_KEPT).map((problem) => ({ path: problem.path, reason: scrub(problem.reason) })),
        }
      : { at: clock(), request, state: "error", summary: ended instanceof Error ? scrub(ended.message) : String(ended), copied: 0, pages: 0, removed: 0, stayed: [], stayedFiles: 0, problems: [] };

    await library.rememberMove(siteId, result).catch(() => undefined);
  }

  /** The move running now and how the last one ended, for the site's status. */
  async function moveStatus(siteId: string): Promise<Pick<MediaStorageStatus, "moving" | "lastMove">> {
    const running = moving.get(siteId);
    const job = running ? jobs.get(running) : null;
    const lastMove = await library.lastMove(siteId).catch(() => null);

    return { ...(job?.state === "running" ? { moving: job } : {}), ...(lastMove ? { lastMove } : {}) };
  }

  async function readOwn(site: SiteService, path: string): Promise<Uint8Array | null> {
    const parsed = parseStorePath(path);
    const store = parsed ? (await service.stores(site)).find((candidate) => candidate.location === parsed.location) : null;

    if (!parsed || !store) return null;
    await assertOwnKey(site, store, parsed.key);
    try {
      const head = await store.head(parsed.key);

      if (!head) return null;
      if (head.size !== null && head.size > RAW_LIMIT) throw new GalleyError("invalid", TOO_LARGE_TO_SHOW);
      const bytes = await store.get(parsed.key);

      if (bytes && bytes.byteLength > RAW_LIMIT) throw new GalleyError("invalid", TOO_LARGE_TO_SHOW);
      return bytes;
    } catch (error) {
      if (error instanceof StoreError) throw new GalleyError(error.transient ? "busy" : "unconfigured", scrub(error.message));
      throw error;
    }
  }

  /**
   * Cloudflare Images without the site's mark (a connection from before marks,
   * or one removed by hand) would list the whole account: then only the
   * pictures already in the site's record are used, until it is reconnected.
   */
  async function mayList(site: SiteService, store: MediaStore): Promise<boolean> {
    return store.location !== "images" || Boolean((await site.model()).media.images?.scope);
  }

  /**
   * A stored file's name must be the site's own before anything reads or
   * deletes it: inside its folder, with no empty, "." or ".." part — and for a
   * store that names things itself, one the site's record says it holds.
   */
  async function assertOwnKey(site: SiteService, store: MediaStore, key: string): Promise<void> {
    const refused = () => new GalleyError("forbidden", "That file isn't one of this site's.", `${store.location}:${key.slice(0, 200)}`);

    if (!store.ownsKey(key)) throw refused();
    if (store.abilities.naming === "service" && !(await library.all(site.id)).some((item) => item.location === store.location && item.key === key)) throw refused();
  }

  async function madeRecord(siteId: string): Promise<MediaCreatedRecord | null> {
    try {
      const raw = await keys.raw(siteId, "media:created");

      return raw ? (JSON.parse(raw) as MediaCreatedRecord) : null;
    } catch {
      return null;
    }
  }

  function r2Api(): { apiBase?: string; fetch?: typeof fetch } {
    const apiBase = options.imagesApi ?? options.env?.GALLEY_MEDIA_IMAGES_API;

    return { ...(apiBase ? { apiBase } : {}), fetch: apiFetch };
  }

  /** Whether the site uses its Cloudflare key for putting it online as the Images token (a flag in its media key file). */
  const useDeployKey = {
    async get(siteId: string): Promise<boolean> {
      return (await keys.raw(siteId, "media:images:useDeployKey")) === "yes";
    },
    async set(siteId: string, on: boolean): Promise<void> {
      await keys.setRaw(siteId, "media:images:useDeployKey", on ? "yes" : null);
    },
  };

  async function imagesToken(site: SiteService, request?: MediaImagesConnectRequest): Promise<{ token: string | null; use: "own" | "deploy" | null; source: "site" | "env" | null }> {
    if (request?.token) return { token: normalizeMediaKey("imagesToken", request.token), use: "own", source: "site" };
    const wantsDeploy = request ? Boolean(request.useDeployKey) : await useDeployKey.get(site.id);

    if (wantsDeploy) {
      const deploy = (await options.settings?.readSecret("cloudflare", { siteId: site.id }).catch(() => null)) ?? null;

      return { token: deploy, use: deploy ? "deploy" : null, source: deploy ? "site" : null };
    }
    const own = await keys.get(site.id, "imagesToken");

    return { token: own.value, use: own.value ? "own" : null, source: own.source };
  }

  async function imagesStatus(site: SiteService): Promise<MediaImagesStatus> {
    const config = (await site.model()).media.images ?? null;
    const { token, use, source } = await imagesToken(site);

    // The site's Cloudflare key for putting it online is the install's business: none of it is shown here.
    return { connected: Boolean(config && token), config, ...(config && !config.scope ? { needsReconnect: true } : {}), token: token ? { configured: true, source, ...(use === "deploy" ? {} : { hint: token.slice(-4) }), use } : { configured: false, source: null, use: null } };
  }

  function makeImagesStore(config: MediaImagesConfig, token: string, use: "own" | "deploy" | null): MediaStore {
    const apiBase = options.imagesApi ?? options.env?.GALLEY_MEDIA_IMAGES_API;

    return createImagesStore({ config, token, tokenSource: use === "deploy" ? "deploy" : "images", fetch: apiFetch, ...(apiBase ? { apiBase } : {}), ...(options.now ? { now: options.now } : {}) });
  }

  async function imagesStore(site: SiteService): Promise<MediaStore | null> {
    const config = (await site.model()).media.images;

    // Settings that don't pass the checks (edited by hand) are not used.
    if (!config || imagesSettingsProblems(config, { hosted: Boolean(options.hosted) }).length) return null;
    const { token, use } = await imagesToken(site);

    return token ? makeImagesStore(config, token, use) : null;
  }

  async function checkImagesWith(site: SiteService, config: MediaImagesConfig, request?: MediaImagesConnectRequest): Promise<MediaCheckResult> {
    const problems = imagesSettingsProblems(config, { hosted: Boolean(options.hosted) });

    if (problems.length) return settingsFailure(problems);
    let resolved: Awaited<ReturnType<typeof imagesToken>>;

    try {
      resolved = await imagesToken(site, request);
    } catch (error) {
      return settingsFailure([{ field: "token", message: error instanceof Error ? error.message : String(error) }]);
    }
    if (!resolved.token) {
      return settingsFailure([
        {
          field: "token",
          message: request?.useDeployKey ? "The site has no Cloudflare key for putting it online yet. Paste an API token for Images instead." : "Paste an API token with Account › Cloudflare Images › Edit.",
        },
      ]);
    }
    const store = makeImagesStore(config, resolved.token, resolved.use);
    const result = await runCheck(store, { testName: "galley-check.png", fetch: publicFetch });

    return {
      ...result,
      steps: result.steps.map((step) => (step.message ? { ...step, message: scrub(step.message) } : step)),
      ...(result.message ? { message: scrub(result.message) } : {}),
      ...(result.detail ? { detail: scrub(result.detail) } : {}),
    };
  }

  /** The same for where its pictures go. */
  async function writeImages(site: SiteService, next: MediaImagesConfig | null): Promise<void> {
    await changeSettings(site, (current: GalleyConfig) => {
      const { images: _old, ...media } = current.media ?? {};
      const nextMedia = next ? { ...media, images: next } : media;
      const { media: _media, ...rest } = current;

      return Object.keys(nextMedia).length ? { ...rest, media: nextMedia } : rest;
    });
  }

  async function moveContext(site: SiteService, onProgress?: (detail: string, progress: number) => void): Promise<MoveContext> {
    const stores = await service.stores(site);

    return {
      site,
      stores,
      fetch: publicFetch,
      hosted: Boolean(options.hosted),
      ...(onProgress ? { onProgress } : {}),
      async recordStored(item) {
        await library.update(site.id, (items) => [
          ...items.filter((known) => !(known.location === item.location && known.key === item.key)),
          // A file that was published in the repository isn't a pending upload; one that wasn't stays in Proof until a page using it is published.
          { ...item, uploadedAt: clock(), published: !item.draft, ...(item.draft ? { uploaded: true } : {}) },
        ]);
      },
      async storedItems(location) {
        const store = stores.find((candidate) => candidate.location === location);

        if (store?.list && (await mayList(site, store))) await relist(site, store);
        // Only names that are the site's own, whatever a listing returned.
        return (await library.all(site.id)).filter((item) => item.location === location && (!store || store.ownsKey(item.key)));
      },
      async saveAddress(location, publicUrl) {
        if (location === "images") {
          const images = (await site.model()).media.images;

          if (!images) throw new GalleyError("unconfigured", "The site isn't connected to Cloudflare Images.");
          const origin = publicUrl.replace(/\/+$/, "");
          const { deliveryUrl: _old, ...rest } = images;

          await library.rememberAddress(site.id, "images", `${images.deliveryUrl ? `${images.deliveryUrl}/cdn-cgi/imagedelivery` : "https://imagedelivery.net"}/${images.accountHash}`);

          await writeImages(site, origin === "https://imagedelivery.net" ? rest : { ...rest, deliveryUrl: origin });
          const store = stores.find((candidate) => candidate.location === "images");

          await library.update(site.id, (items) => items.map((item) => (item.location === "images" ? { ...item, url: store?.rebase?.(item.url, origin) ?? item.url } : item)));
          return;
        }
        const config = await savedConfig(site);

        if (!config) throw new GalleyError("unconfigured", "The site isn't connected to a bucket.");
        await library.rememberAddress(site.id, "bucket", config.publicUrl);
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
    const startedAt = clock();
    const found: StoredItem[] = [];
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
      // Merged into the record as it is now: an upload that landed while the store was being listed is kept as it is.
      const current = new Map(items.filter((item) => item.location === store.location).map((item) => [item.key, item]));
      const listedKeys = new Set(found.map((item) => item.key));
      const landed = [...current.values()].filter((item) => !listedKeys.has(item.key) && item.uploaded && item.uploadedAt >= startedAt);
      const listed: LibraryItem[] = found.map((item) => {
        const known = current.get(item.key) ?? before.get(item.key);
        const size = measured.get(item.key);

        return known
          ? { ...known, size: item.size ?? known.size, url: item.url }
          : {
              location: store.location,
              key: item.key,
              url: item.url,
              name: item.name ?? item.key.split("/").pop() ?? item.key,
              size: item.size,
              type: item.type,
              ...(item.width && item.height ? { width: item.width, height: item.height } : size ? size : {}),
              uploadedAt: item.uploadedAt,
              // Found there rather than uploaded from here: it isn't a pending change.
              published: true,
            };
      });

      listedAt[store.location] = clock();
      return [...others, ...listed, ...landed];
    });
  }

  /** Store paths ("bucket:key") that the working copy or the published version uses. */
  /**
   * Every address form a page might use for a store's files: the current
   * public address, the ones it had before, and the store's own address.
   */
  async function referenceForms(site: SiteService, store: MediaStore): Promise<{ pattern: string; keyOf: (match: string) => string | null }> {
    const prefix = store.location === "bucket" ? normalizePrefix((await site.model()).media.storage?.prefix) : "";
    const bases = [...(await library.earlierAddresses(site.id, store.location)), ...(store.otherBases?.() ?? [])];
    const pattern = bases.length ? `(${[store.addressPattern(), ...bases.map((base) => `${escapePattern(base.replace(/\/+$/, ""))}/${ADDRESS_TAIL}`)].join("|")})` : store.addressPattern();
    const keyOf = (match: string) => {
      const trimmed = trimFound(match);
      const direct = store.keyOf(trimmed);

      if (direct !== null || store.location !== "bucket") return direct;
      for (const base of bases) {
        const key = keyUnder(base, prefix, trimmed);

        if (key !== null) return key;
      }
      return null;
    };

    return { pattern, keyOf };
  }

  /** Searching is what keeps a used file from being deleted: without it, nothing is deleted. */
  function requireSearch(site: SiteService): NonNullable<SiteService["grepText"]> {
    if (!site.grepText) throw new GalleyError("internal", "This site's files can't be searched, so Galley can't tell which pages use a file. Nothing was deleted.");
    return site.grepText.bind(site);
  }

  async function usedKeys(site: SiteService, stores: MediaStore[], rev: "working" | "base"): Promise<Set<string>> {
    const used = new Set<string>();
    const grep = requireSearch(site);

    for (const store of stores) {
      const forms = await referenceForms(site, store);

      for (const { match } of await grep(forms.pattern, { rev })) {
        const key = forms.keyOf(match);

        if (key !== null) used.add(storePath(store.location, key));
      }
    }
    return used;
  }

  async function filesUsing(site: SiteService, store: MediaStore, key: string, rev: "working" | "base"): Promise<string[]> {
    const grep = requireSearch(site);
    const forms = await referenceForms(site, store);
    const files = new Set<string>();

    for (const { path, match } of await grep(forms.pattern, { rev })) {
      if (forms.keyOf(match) === key) files.add(path);
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
