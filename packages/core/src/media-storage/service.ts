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
import type { GalleyConfig, MediaStorageConfig, SettingsService, SiteService } from "../types";
import { createBucketStore } from "./bucket-store";
import { runCheck, settingsFailure, testNameFor } from "./check";
import type { MediaCheckResult, MediaConnectRequest, MediaConnectResult, MediaStorageStatus, MediaStoreInfo } from "./contract";
import { BUCKET_CONNECTORS, isTrialAddress, normalizePrefix, normalizeStorageConfig, settingsProblems } from "./info";
import { createMediaKeys, normalizeMediaKey, scrub, type MediaKeys } from "./keys";
import type { Credentials } from "./sigv4";
import type { MediaStore } from "./store";

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
  connectors?: BucketConnector[];
}

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
}

export function createMediaStorageService(options: MediaStorageServiceOptions): MediaStorageService {
  const keys = options.keys ?? createMediaKeys({ home: options.home, ...(options.env ? { env: options.env } : {}) });
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
      const config = request?.config ? normalizeStorageConfig(request.config) : await savedConfig(site);

      if (!config) return settingsFailure([{ field: "bucket", message: "The site isn't connected to a bucket yet." }]);
      return checkWith(site, config, request);
    },

    async connect(site, request) {
      const config = normalizeStorageConfig(request.config);
      const check = await checkWith(site, config, request);

      if (!check.ok) return { check };
      if (request.accessKeyId) await keys.set(site.id, "accessKeyId", request.accessKeyId);
      if (request.secretAccessKey) await keys.set(site.id, "secretAccessKey", request.secretAccessKey);
      await writeStorage(site, config);
      return { check, status: await service.status(site) };
    },

    async disconnect(site, disconnect = {}) {
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
  };
  return service;
}
