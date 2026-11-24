/**
 * Where media is kept, answered from memory for `dev:mock`: the real
 * connectors' setup copy (straight from the engine's info.ts), a pretend
 * bucket that takes uploads, and the check with the same steps and the same
 * sentences the engine gives for the usual mistakes:
 *
 *   an Access Key ID ending in "0000"   → the service doesn't know it
 *   a secret starting with "wrong"      → it doesn't go with the key ID
 *   a bucket called "missing"           → there's no such bucket
 *   a public address with "private"     → visitors are turned away
 */
// Only the dependency-free setup data (and types): this file is loaded by Node directly, not bundled.
import { BUCKET_CONNECTORS, connectorInfo, isTrialAddress, normalizeStorageConfig, settingsProblems } from "@galley/core/media-storage/info";
import type { MediaCheckResult, MediaCheckStep, MediaCheckStepId, MediaConnectRequest, MediaKeyStatus, MediaStorageStatus, MediaStoreDeleteResult, MediaUsage } from "@galley/core/media-storage/contract";
import type { MediaItem, MediaStorageConfig } from "@galley/core/types";
import type { Handlers, MockBackend } from "./backend.ts";

type MediaStorageKey =
  | "GET /api/media-storage/connectors"
  | "GET /api/sites/:siteId/media/storage"
  | "POST /api/sites/:siteId/media/storage/check"
  | "PUT /api/sites/:siteId/media/storage"
  | "DELETE /api/sites/:siteId/media/storage"
  | "GET /api/sites/:siteId/media/usage"
  | "POST /api/sites/:siteId/media/storage/delete";

const LABELS: Record<MediaCheckStepId, string> = {
  settings: "The settings make sense",
  reach: "Reach the service",
  write: "Store a test picture",
  read: "Read it back",
  list: "List the site's files",
  public: "Load it from the public address",
  delete: "Remove the test picture",
};
const ORDER: MediaCheckStepId[] = ["settings", "reach", "write", "read", "list", "public", "delete"];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface MockSiteStorage {
  config: MediaStorageConfig | null;
  keys: { accessKeyId: string | null; secretAccessKey: string | null };
  /** The pretend bucket's files, newest first. */
  bucket: Array<MediaItem & { published: boolean }>;
}

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", avif: "image/avif", gif: "image/gif", svg: "image/svg+xml", pdf: "application/pdf", mp4: "video/mp4" };

export function createMockMediaStorage(mock: MockBackend) {
  const sites = new Map<string, MockSiteStorage>();

  function of(siteId: string): MockSiteStorage {
    let state = sites.get(siteId);

    if (!state) {
      state = { config: null, keys: { accessKeyId: null, secretAccessKey: null }, bucket: [] };
      sites.set(siteId, state);
    }
    return state;
  }

  const keyStatus = (value: string | null): MediaKeyStatus => (value ? { configured: true, source: "site", hint: value.slice(-4) } : { configured: false, source: null });

  function status(siteId: string): MediaStorageStatus {
    mock.site(siteId);
    const state = of(siteId);
    const info = state.config ? connectorInfo(state.config.connector) : null;

    return {
      bucket: {
        connected: Boolean(state.config && state.keys.accessKeyId && state.keys.secretAccessKey),
        config: state.config,
        store: info ? { id: info.id, name: info.name } : null,
        keys: { accessKeyId: keyStatus(state.keys.accessKeyId), secretAccessKey: keyStatus(state.keys.secretAccessKey) },
        created: null,
        ...(state.config && isTrialAddress(state.config.publicUrl) ? { trialAddress: true } : {}),
      },
      cloudflare: { keyStored: true },
    };
  }

  function result(failAt: MediaCheckStepId | null, message?: string, field?: MediaCheckStep["field"]): MediaCheckResult {
    const at = failAt ? ORDER.indexOf(failAt) : ORDER.length;
    const steps: MediaCheckStep[] = ORDER.map((id, index) =>
      index < at ? { id, label: LABELS[id], state: "ok" } : index === at ? { id, label: LABELS[id], state: "failed", ...(message ? { message } : {}), ...(field ? { field } : {}) } : { id, label: LABELS[id], state: "skipped" }
    );

    return failAt ? { ok: false, steps, ...(message ? { message } : {}) } : { ok: true, steps };
  }

  async function check(siteId: string, request: Partial<MediaConnectRequest>): Promise<MediaCheckResult> {
    const state = of(siteId);
    const config = request.config ? normalizeStorageConfig(request.config) : state.config;

    await sleep(700);
    if (!config) return result("settings", "The site isn't connected to a bucket yet.", "bucket");
    const problems = settingsProblems(config);

    if (problems.length) return result("settings", problems.map((p) => p.message).join(" "), problems[0]!.field);
    const accessKeyId = request.accessKeyId?.trim() || state.keys.accessKeyId;
    const secretAccessKey = request.secretAccessKey?.trim() || state.keys.secretAccessKey;
    const name = connectorInfo(config.connector)?.name ?? "the storage service";

    if (!accessKeyId) return result("settings", "Paste the key's Access Key ID.", "accessKeyId");
    if (!secretAccessKey) return result("settings", "Paste the key's Secret Access Key.", "secretAccessKey");
    if (accessKeyId.endsWith("0000")) return result("reach", `${name} doesn't know that Access Key ID. Copy it again from where the key was made, or make a new key.`, "accessKeyId");
    if (secretAccessKey.startsWith("wrong")) return result("reach", "The Secret Access Key doesn't go with that Access Key ID. Paste the secret again: it is the longer of the two.", "secretAccessKey");
    if (config.bucket === "missing") return result("reach", `There's no bucket called “missing” ${config.connector === "s3" ? `in ${config.region}` : "in that Cloudflare account"}. Check the name: it has to match exactly.`, "bucket");
    if (config.publicUrl.includes("private")) {
      return result(
        "public",
        config.connector === "s3"
          ? "The bucket turns visitors away. In the S3 console, turn off “Block all public access” for the bucket (and for the account if AWS says so), then add the bucket policy Galley shows."
          : "The address turns visitors away. Check the custom domain is connected to this bucket and “Active”, or that the r2.dev address shows “Allowed”.",
        "publicUrl"
      );
    }
    return result(null);
  }

  const connected = (siteId: string) => Boolean(of(siteId).config && of(siteId).keys.accessKeyId);

  /** Files of the site's working copy (or published version) whose text has `url` in it. */
  function filesUsing(siteId: string, url: string, rev?: "base"): string[] {
    const site = mock.site(siteId);

    return site
      .allPaths()
      .filter((path) => /\.(md|mdx|json|ya?ml|astro|html)$/.test(path) && (site.read(path, rev)?.toString("utf8") ?? "").includes(url))
      .sort();
  }

  /** An upload, when the site keeps media in its bucket: every kind of file goes there. */
  function save(siteId: string, filename: string, bytes: Buffer): MediaItem {
    const state = of(siteId);
    const config = state.config!;
    const ext = (filename.split(".").pop() ?? "").toLowerCase();
    const stem = filename.slice(0, -(ext.length + 1)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "image";
    let key = `${config.prefix ?? ""}${stem}.${ext}`;

    for (let n = 2; state.bucket.some((item) => item.key === key); n += 1) key = `${config.prefix ?? ""}${stem}-${n}.${ext}`;
    const item: MediaItem & { published: boolean } = {
      path: `bucket:${key}`,
      url: `${config.publicUrl}/${key}`,
      name: key.split("/").pop() ?? key,
      size: bytes.byteLength,
      type: TYPES[ext] ?? "application/octet-stream",
      ...(TYPES[ext]?.startsWith("image/") ? { width: 1600, height: 1067 } : {}),
      modifiedAt: Date.now(),
      status: "added",
      location: "bucket",
      key,
      published: false,
    };

    state.bucket.unshift(item);
    const { published: _published, ...out } = item;

    return out;
  }

  const list = (siteId: string): MediaItem[] => (connected(siteId) ? of(siteId).bucket.map(({ published, ...item }) => ({ ...item, status: published ? "clean" : "added" })) : []);

  function pending(siteId: string): MediaItem[] {
    return connected(siteId)
      ? of(siteId)
          .bucket.filter((item) => !item.published)
          .map(({ published: _published, ...item }) => ({ ...item, used: filesUsing(siteId, item.url).length > 0 }))
      : [];
  }

  function afterPublish(siteId: string): void {
    for (const item of of(siteId).bucket) if (!item.published && filesUsing(siteId, item.url, "base").length) item.published = true;
  }

  function usage(siteId: string, url: string): MediaUsage {
    return { url, working: filesUsing(siteId, url).map((path) => ({ path, title: path.split("/").pop()?.replace(/\.[a-z]+$/, "") ?? path })), published: filesUsing(siteId, url, "base") };
  }

  function deleteStored(siteId: string, paths: string[]): MediaStoreDeleteResult {
    const state = of(siteId);
    const result: MediaStoreDeleteResult = { deleted: [], refused: [] };

    for (const path of paths) {
      const item = state.bucket.find((candidate) => candidate.path === path);

      if (!item) continue;
      const { working, published } = usage(siteId, item.url);

      if (working.length || published.length) result.refused.push({ path, name: item.name, working: working.map((w) => w.path), published });
      else {
        state.bucket = state.bucket.filter((candidate) => candidate.path !== path);
        result.deleted.push(path);
      }
    }
    return result;
  }

  const handlers: Pick<Handlers, MediaStorageKey> = {
    "GET /api/sites/:siteId/media/usage": ({ params, query }) => usage(params.siteId, query.url ?? ""),
    "POST /api/sites/:siteId/media/storage/delete": ({ params, body }) => {
      const result = deleteStored(params.siteId, body.paths);

      if (result.deleted.length) mock.changed(params.siteId, result.deleted, "user");
      return result;
    },
    "GET /api/media-storage/connectors": () => ({ connectors: BUCKET_CONNECTORS }),
    "GET /api/sites/:siteId/media/storage": ({ params }) => status(params.siteId),
    "POST /api/sites/:siteId/media/storage/check": ({ params, body }) => check(params.siteId, body ?? {}),
    "PUT /api/sites/:siteId/media/storage": async ({ params, body }) => {
      const verdict = await check(params.siteId, body);

      if (!verdict.ok) return { check: verdict };
      const state = of(params.siteId);

      state.config = normalizeStorageConfig(body.config);
      if (body.accessKeyId) state.keys.accessKeyId = body.accessKeyId.trim();
      if (body.secretAccessKey) state.keys.secretAccessKey = body.secretAccessKey.trim();
      return { check: verdict, status: status(params.siteId) };
    },
    "DELETE /api/sites/:siteId/media/storage": ({ params, query }) => {
      const state = of(params.siteId);

      state.config = null;
      if (String(query.forgetKeys) === "true") state.keys = { accessKeyId: null, secretAccessKey: null };
      return status(params.siteId);
    },
  };

  return { handlers, of, status, connected, save, list, pending, afterPublish };
}
