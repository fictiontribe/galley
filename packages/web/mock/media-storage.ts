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
import { IMAGES_INFO, imagesSettingsProblems, normalizeImagesConfig } from "@galley/core/media-storage/images-info";
import { randomUUID } from "node:crypto";
import type { MediaCreatedRecord, MediaCheckResult, MediaCheckStep, MediaCheckStepId, MediaConnectRequest, MediaImagesConnectRequest, MediaKeyStatus, MediaMovePlan, MediaMoveRequest, MediaMoveResult, MediaStorageStatus, MediaStoreDeleteResult, MediaUsage } from "@galley/core/media-storage/contract";
import type { Job, MediaImagesConfig, MediaItem, MediaStorageConfig } from "@galley/core/types";
import type { Handlers, MockBackend } from "./backend.ts";
import { MockError } from "./site.ts";

type MediaStorageKey =
  | "GET /api/media-storage/connectors"
  | "GET /api/sites/:siteId/media/storage"
  | "POST /api/sites/:siteId/media/storage/check"
  | "PUT /api/sites/:siteId/media/storage"
  | "DELETE /api/sites/:siteId/media/storage"
  | "POST /api/sites/:siteId/media/images/check"
  | "PUT /api/sites/:siteId/media/images"
  | "DELETE /api/sites/:siteId/media/images"
  | "GET /api/sites/:siteId/media/usage"
  | "POST /api/sites/:siteId/media/storage/delete"
  | "POST /api/sites/:siteId/media/storage/make-bucket"
  | "DELETE /api/sites/:siteId/media/storage/made-bucket"
  | "POST /api/sites/:siteId/media/storage/move/plan"
  | "POST /api/sites/:siteId/media/storage/move";

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
  images: MediaImagesConfig | null;
  created: MediaCreatedRecord | null;
  imagesToken: string | null;
  imagesUseDeployKey: boolean;
  /** The pretend move running now, and how the last one ended. */
  moving?: Job;
  lastMove?: MediaMoveResult;
}

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", avif: "image/avif", gif: "image/gif", svg: "image/svg+xml", pdf: "application/pdf", mp4: "video/mp4" };

export function createMockMediaStorage(mock: MockBackend) {
  const sites = new Map<string, MockSiteStorage>();

  function of(siteId: string): MockSiteStorage {
    let state = sites.get(siteId);

    if (!state) {
      state = { config: null, keys: { accessKeyId: null, secretAccessKey: null }, bucket: [], images: null, created: null, imagesToken: null, imagesUseDeployKey: false };
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
        created: state.created,
        ...(state.config && isTrialAddress(state.config.publicUrl) ? { trialAddress: true } : {}),
      },
      images: {
        connected: Boolean(state.images && (state.imagesToken || state.imagesUseDeployKey)),
        config: state.images,
        token: state.imagesUseDeployKey ? { configured: true, source: "site", use: "deploy" } : state.imagesToken ? { configured: true, source: "site", hint: state.imagesToken.slice(-4), use: "own" } : { configured: false, source: null, use: null },
      },
      cloudflare: { keyStored: true },
      ...(state.moving?.state === "running" ? { moving: { ...state.moving } } : {}),
      ...(state.lastMove ? { lastMove: state.lastMove } : {}),
    };
  }

  /**
   * The Images check, with the engine's sentences for the usual mistakes:
   * a token ending in "0000" isn't accepted; the site's Cloudflare key lacks
   * Images: Edit unless it was "fixed" (the account ID starts with "c");
   * a hash "free…" is an account without the Paid plan.
   */
  async function checkImages(siteId: string, request: Partial<MediaImagesConnectRequest>): Promise<MediaCheckResult> {
    const state = of(siteId);
    const config = request.config ? normalizeImagesConfig(request.config) : state.images;

    await sleep(700);
    if (!config) return result("settings", "The site isn't connected to Cloudflare Images yet.", "account");
    const problems = imagesSettingsProblems(config);

    if (problems.length) return result("settings", problems.map((p) => p.message).join(" "), problems[0]!.field);
    const deploy = request.config ? Boolean(request.useDeployKey) : state.imagesUseDeployKey;
    const token = request.token?.trim() || (deploy ? "deploy" : state.imagesToken);

    if (!token) return result("settings", "Paste an API token with Account › Cloudflare Images › Edit.", "token");
    if (deploy && !config.account.startsWith("c")) {
      return result("reach", "The site's Cloudflare key (the one for putting it online) doesn't have Cloudflare Images: Edit. On Cloudflare, edit that token (My Profile › API Tokens), add Account › Cloudflare Images › Edit, and check again — or paste a token of its own.", "token");
    }
    if (token.endsWith("0000")) return result("reach", "Cloudflare doesn't accept that API token for Cloudflare Images in this account. Check it has Account › Cloudflare Images › Edit for this account, and that it was copied whole.", "token");
    if (config.accountHash.toLowerCase().startsWith("free")) return result("reach", "Cloudflare Images storage isn't turned on for this account. Keeping pictures in Images needs the Images Paid plan: turn it on under Images in the Cloudflare dashboard, then check again.");
    return result(null);
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

  const connected = (siteId: string) => Boolean((of(siteId).config && of(siteId).keys.accessKeyId) || of(siteId).images);

  /** Files of the site's working copy (or published version) whose text has `url` in it. */
  function filesUsing(siteId: string, url: string, rev?: "base"): string[] {
    const site = mock.site(siteId);

    return site
      .allPaths()
      .filter((path) => /\.(md|mdx|json|ya?ml|astro|html)$/.test(path) && (site.read(path, rev)?.toString("utf8") ?? "").includes(url))
      .sort();
  }

  /** An upload, when the site keeps media in its bucket: every kind of file goes there. */
  function save(siteId: string, filename: string, bytes: Buffer): MediaItem | null {
    const state = of(siteId);
    const ext = (filename.split(".").pop() ?? "").toLowerCase();
    const picture = ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext) && bytes.byteLength <= 10 * 1024 * 1024;

    if (state.images && picture) {
      const id = randomUUID();
      const item: MediaItem & { published: boolean } = {
        path: `images:${id}`,
        url: `${state.images.deliveryUrl ? `${state.images.deliveryUrl}/cdn-cgi/imagedelivery` : "https://imagedelivery.net"}/${state.images.accountHash}/${id}/${state.images.variant ?? "public"}`,
        name: filename.toLowerCase().replace(/[^a-z0-9.]+/g, "-"),
        size: bytes.byteLength,
        type: TYPES[ext] ?? "image/png",
        width: 1600,
        height: 1067,
        modifiedAt: Date.now(),
        status: "added",
        location: "images",
        key: id,
        published: false,
      };

      state.bucket.unshift(item);
      const { published: _published, ...out } = item;
      return out;
    }
    const why = state.images ? (picture ? "" : "Cloudflare Images takes only pictures (PNG, JPG, GIF, WebP or SVG).") : "";
    if (!state.config || !state.keys.accessKeyId) return null;
    const config = state.config;
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

    return why ? { ...out, placement: `Kept in the bucket: ${why}` } : out;
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

  /** A pretend plan: the repository's files to the bucket (all of them; a bucket takes any kind), or the bucket's back. */
  function plan(siteId: string, request: MediaMoveRequest): MediaMovePlan {
    const state = of(siteId);

    if (!state.config) throw new MockError("unconfigured", "The site isn't connected to a bucket.");
    if (request.kind === "address") return { kind: "address", store: request.store, files: 0, bytes: 0, removes: 0, references: 6, pages: 4, done: 0, problems: [], keepCopies: true, publicUrl: request.publicUrl.replace(/\/+$/, "") };
    const files = request.from === "repository" ? mock.site(siteId).media() : state.bucket;

    return { kind: "move", from: request.from, to: request.to, files: files.length, bytes: files.reduce((sum, item) => sum + item.size, 0), removes: request.from === "repository" && !request.keepCopies ? files.length : 0, references: files.length * 2, pages: Math.max(1, Math.round(files.length / 2)), done: 0, problems: [], keepCopies: request.kind === "move" && request.from === "repository" ? Boolean(request.keepCopies) : true };
  }

  function start(siteId: string, request: MediaMoveRequest): Job {
    const steps = plan(siteId, request);
    const job: Job = { id: randomUUID(), kind: "media", label: request.kind === "address" ? "Changing the files' address" : request.to === "repository" ? "Moving media to the repository" : request.to === "images" ? "Moving pictures to Cloudflare Images" : "Moving media to the bucket", state: "running", progress: 0, detail: "Getting ready…", siteId, startedAt: Date.now() };

    mock.jobs.set(job.id, job);
    of(siteId).moving = job;
    mock.emit({ type: "job", job: { ...job } });
    void (async () => {
      for (let n = 1; n <= Math.max(1, steps.files); n += Math.max(1, Math.ceil(steps.files / 4))) {
        await sleep(450);
        Object.assign(job, { detail: request.kind === "address" ? `Updating pages: ${Math.min(n, steps.pages)} of ${steps.pages}` : `Copying ${n} of ${steps.files}`, progress: n / Math.max(1, steps.files) });
        mock.emit({ type: "job", job: { ...job } });
      }
      if (request.kind === "address") {
        const state = of(siteId);
        if (state.config) state.config = { ...state.config, publicUrl: request.publicUrl.replace(/\/+$/, "") };
      }
      Object.assign(job, { state: "done", progress: 1, finishedAt: Date.now(), detail: request.kind === "address" ? `${steps.pages} pages updated; new files are loaded from ${steps.publicUrl}. Publish to make it live.` : `${steps.files} files copied, ${steps.pages} pages updated. Publish to make it live.` });
      // Kept before the job says it ended, as the engine does: the status read on that event already has it.
      of(siteId).lastMove = { at: Date.now(), request, state: "done", summary: job.detail ?? "", copied: request.kind === "address" ? 0 : steps.files, pages: steps.pages, removed: 0, stayed: [], stayedFiles: 0, problems: [] };
      mock.emit({ type: "job", job: { ...job } });
    })();
    return { ...job };
  }

  const handlers: Pick<Handlers, MediaStorageKey> = {
    "POST /api/sites/:siteId/media/storage/make-bucket": async ({ params, body }) => {
      await sleep(900);
      const problems = settingsProblems({ connector: "r2", account: body.account.trim().toLowerCase(), bucket: body.name.trim(), publicUrl: "https://example.com" });
      if (problems.length) throw new MockError("invalid", problems.map((p) => p.message).join(" "));
      if (body.name.startsWith("taken")) throw new MockError("invalid", `A bucket called “${body.name}” already exists. Choose another name.`);
      const created: MediaCreatedRecord = { provider: "cloudflare", account: body.account.trim().toLowerCase(), bucket: body.name.trim(), publicUrl: `https://pub-${randomUUID().replace(/-/g, "").slice(0, 32)}.r2.dev`, createdAt: new Date().toISOString() };
      of(params.siteId).created = created;
      return { created, config: { connector: "r2", account: created.account, bucket: created.bucket, publicUrl: created.publicUrl } };
    },
    "DELETE /api/sites/:siteId/media/storage/made-bucket": ({ params }) => {
      const state = of(params.siteId);
      if (!state.created) throw new MockError("not-found", "Galley hasn't made a bucket for this site.");
      if (state.config?.bucket === state.created.bucket) throw new MockError("conflict", `The site still keeps new files in “${state.created.bucket}”. Stop using the bucket first.`);
      state.created = null;
      return status(params.siteId);
    },
    "POST /api/sites/:siteId/media/images/check": ({ params, body }) => checkImages(params.siteId, body ?? {}),
    "PUT /api/sites/:siteId/media/images": async ({ params, body }) => {
      const verdict = await checkImages(params.siteId, body);

      if (!verdict.ok) return { check: verdict };
      const state = of(params.siteId);

      state.images = normalizeImagesConfig(body.config);
      if (body.token) state.imagesToken = body.token.trim();
      state.imagesUseDeployKey = Boolean(body.useDeployKey && !body.token);
      return { check: verdict, status: status(params.siteId) };
    },
    "DELETE /api/sites/:siteId/media/images": ({ params, query }) => {
      const state = of(params.siteId);

      state.images = null;
      if (String(query.forgetKeys) === "true") {
        state.imagesToken = null;
        state.imagesUseDeployKey = false;
      }
      return status(params.siteId);
    },
    "POST /api/sites/:siteId/media/storage/move/plan": ({ params, body }) => plan(params.siteId, body),
    "POST /api/sites/:siteId/media/storage/move": ({ params, body }) => start(params.siteId, body),
    "GET /api/sites/:siteId/media/usage": ({ params, query }) => usage(params.siteId, query.url ?? ""),
    "POST /api/sites/:siteId/media/storage/delete": ({ params, body }) => {
      const result = deleteStored(params.siteId, body.paths);

      if (result.deleted.length) mock.changed(params.siteId, result.deleted, "user");
      return result;
    },
    "GET /api/media-storage/connectors": () => ({ connectors: [...BUCKET_CONNECTORS, IMAGES_INFO] }),
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
