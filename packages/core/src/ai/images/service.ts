/**
 * ImageService: generate with the chosen provider, hold the results as
 * candidates in `<home>/tmp/candidates/` (swept after two hours), and save
 * the one the person picks into the site's media.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { imageSize } from "image-size";
import { GalleyError } from "../../errors";
import type {
  ChangeOrigin,
  ImageAspect,
  ImageCandidate,
  ImageGenRequest,
  ImageProviderInfo,
  ImageSaveRequest,
  ImageService,
  MediaItem,
  SettingsService,
  SiteService,
} from "../../types";
import { isProviderError } from "../../plugins/define";
import { builtinImageHandles } from "../../plugins/defaults";
import { safeDetail } from "../errors";
import { PLACEHOLDER_PROVIDER } from "./catalog";
import type { GeneratedImage } from "./provider";
import { capability, keyConfigured, providerInfo, readKey, type ImageProviderSource } from "./providers";

export const CANDIDATE_TTL_MS = 2 * 60 * 60 * 1000;
const ASPECTS: ImageAspect[] = ["1:1", "16:9", "4:3", "3:2", "9:16", "3:4", "2:3"];
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};
const REFERENCE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

export interface ImageServiceOptions {
  home: string;
  settings: SettingsService;
  fetch?: typeof fetch;
  /** The providers to choose from — the plugin registry's. Default: the built-in ones. */
  providers?: ImageProviderSource;
  /** Test seam: the clock used for the candidate TTL. */
  now?: () => number;
}

export interface GenerateOptions {
  /** Needed to read `referencePaths`, which are repo paths in that site. */
  site?: SiteService;
  signal?: AbortSignal;
  /** Recorded with the usage line. */
  siteId?: string;
}

/** ImageService plus the extras the assistant uses (reference images need the site). */
export interface GalleyImageService extends ImageService {
  generate(request: ImageGenRequest, options?: GenerateOptions): Promise<ImageCandidate[]>;
  /** Remove expired candidates now. Runs on its own before every generate/read. */
  sweep(): Promise<number>;
}

interface CandidateMeta {
  id: string;
  mime: string;
  width?: number;
  height?: number;
  prompt: string;
  provider: string;
  model: string;
  createdAt: number;
}

/** "A lighthouse at dusk, flat illustration" → "lighthouse-at-dusk-flat-illustration" (≤ 60 chars, whole words). */
export function filenameFromPrompt(prompt: string): string {
  const words = prompt
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word && !["a", "an", "the", "of", "with", "and", "in", "on", "for"].includes(word));
  let name = "";

  for (const word of words) {
    const next = name ? `${name}-${word}` : word;

    if (next.length > 60) break;
    name = next;
  }
  return name || (words[0] ?? "image").slice(0, 60) || "image";
}

function sanitizeFilename(name: string): string {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, "");

  return filenameFromPrompt(base) || "image";
}

const CANDIDATE_ID = /^[a-f0-9-]{36}$/;

export function createImageService(options: ImageServiceOptions): GalleyImageService {
  const dir = join(options.home, "tmp", "candidates");
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const handles = options.providers ?? builtinImageHandles;

  let sweeping: Promise<number> = Promise.resolve(0);
  let lastSweep = Number.NEGATIVE_INFINITY;

  async function sweepOnce(): Promise<number> {
    let names: string[];

    try {
      names = await readdir(dir);
    } catch {
      return 0;
    }
    let removed = 0;

    for (const name of names) {
      const path = join(dir, name);

      try {
        const info = await stat(path);

        if (now() - info.mtimeMs > CANDIDATE_TTL_MS) {
          await rm(path, { force: true });
          removed += 1;
        }
      } catch {
        // Already gone.
      }
    }
    return removed;
  }

  /** Sweeps run one at a time, so two never race over the same files. */
  function sweep(): Promise<number> {
    lastSweep = now();
    sweeping = sweeping.then(sweepOnce, sweepOnce);
    return sweeping;
  }

  /** Housekeeping on the way through: at most once a minute, never awaited. */
  function maybeSweep(): void {
    if (now() - lastSweep > 60_000) void sweep();
  }

  async function meta(id: string): Promise<CandidateMeta | null> {
    if (!CANDIDATE_ID.test(id)) return null;
    try {
      const value = JSON.parse(await readFile(join(dir, `${id}.json`), "utf8")) as CandidateMeta;

      if (now() - value.createdAt > CANDIDATE_TTL_MS) return null;
      return value;
    } catch {
      return null;
    }
  }

  async function bytesOf(id: string, value: CandidateMeta): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(join(dir, `${id}.${EXTENSIONS[value.mime] ?? "bin"}`)));
    } catch {
      return null;
    }
  }

  async function references(paths: string[] | undefined, site: SiteService | undefined, supported: boolean) {
    if (!paths?.length) return [];
    if (!supported) {
      throw new GalleyError("invalid", "This image provider can't work from reference images. Choose another provider, or leave the references out.");
    }
    if (!site) throw new GalleyError("invalid", "Reference images need a site to read them from.");
    const refs: Array<{ data: Uint8Array; mime: string }> = [];

    for (const path of paths.slice(0, 4)) {
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      const mime = REFERENCE_MIME[ext];

      if (!mime) throw new GalleyError("invalid", "Reference images must be PNG, JPG, WebP or GIF files.", path);
      try {
        refs.push({ data: new Uint8Array(await readFile(site.resolvePath(path))), mime });
      } catch (error) {
        if (error instanceof GalleyError) throw error;
        throw new GalleyError("not-found", "One of the reference images couldn't be found in the site's media.", path);
      }
    }
    return refs;
  }

  async function providers(): Promise<ImageProviderInfo[]> {
    const settings = await options.settings.get();
    const configured = new Set(settings.secrets.filter((s) => s.configured).map((s) => s.name));

    return Promise.all(handles().map(async (handle) => providerInfo(handle, await keyConfigured(handle, (secret) => configured.has(secret)))));
  }

  return {
    providers,
    sweep,

    async generate(request, generateOptions = {}) {
      maybeSweep();
      const prompt = request.prompt?.trim() ?? "";

      if (prompt.length < 3) throw new GalleyError("invalid", "Describe the image you want in a few words.");
      if (prompt.length > 4000) throw new GalleyError("invalid", "That description is too long. Keep it under 4,000 characters.");
      const settings = await options.settings.get();
      // Nothing chosen (or the chosen service lost its key): the placeholder generator, never a refusal.
      const providerId = request.provider ?? settings.images.provider ?? PLACEHOLDER_PROVIDER;
      const handle = handles().find((candidate) => candidate.id === providerId);

      if (!handle) throw new GalleyError("invalid", "That image provider isn't available.", providerId);
      const aspect = request.aspect ?? "1:1";

      if (!ASPECTS.includes(aspect)) throw new GalleyError("invalid", "Choose one of the listed image shapes.", String(aspect));
      const model = request.model ?? (providerId === settings.images.provider ? settings.images.model : null) ?? handle.defaultModel;
      const key = await readKey(handle, (secret) => options.settings.readSecret(secret));

      if (handle.key && !key) {
        throw new GalleyError("unconfigured", `Add ${handle.key.phrase} in Settings to generate images with ${handle.label}.`);
      }
      // A model may say more than its provider does (one OpenRouter model takes references, another doesn't).
      const modelInfo = request.transparent || request.referencePaths?.length ? (await handle.models()).find((item) => item.id === model) : undefined;

      if (request.transparent && !capability(handle, modelInfo, "supportsTransparency")) {
        throw new GalleyError(
          "invalid",
          modelInfo?.supportsTransparency === false
            ? `${modelInfo.label} can't make transparent backgrounds. Turn that off, or choose another model.`
            : `${handle.label} can't make transparent backgrounds. Turn that off, or choose another provider.`
        );
      }
      const refs = await references(request.referencePaths, generateOptions.site, capability(handle, modelInfo, "supportsReferences"));
      const count = Math.min(4, Math.max(1, Math.floor(request.count ?? 1)));
      const style = request.style?.trim();
      // The site's imagery direction and palette, from its brand, as a brief after the request itself.
      const brand = request.brandDirection?.trim().slice(0, 800);
      let images: Array<GeneratedImage & { cost?: number }>;

      try {
        images = await handle.generate(
          {
            prompt: `${style ? `${prompt}\n\nStyle: ${style}` : prompt}${brand ? `\n\nBrand direction: ${brand}` : ""}`,
            aspect,
            count,
            model,
            transparent: Boolean(request.transparent),
            references: refs,
            signal: generateOptions.signal,
          },
          key,
          fetchImpl
        );
      } catch (error) {
        if (isProviderError(error)) {
          throw new GalleyError(error.kind === "auth" || error.kind === "quota" ? "unconfigured" : "ai", error.plain, safeDetail(error.detail ?? ""));
        }
        if (error instanceof GalleyError) throw error;
        throw new GalleyError("ai", `${handle.label} couldn't make the image. Try again.`, safeDetail(error));
      }
      await mkdir(dir, { recursive: true });
      const candidates: ImageCandidate[] = [];

      for (const image of images) {
        const id = randomUUID();
        let { width, height } = image;

        if (width === undefined || height === undefined) {
          try {
            const size = imageSize(image.data);

            width = size.width;
            height = size.height;
          } catch {
            // Unknown dimensions are allowed; the library measures again on save.
          }
        }
        const record: CandidateMeta = { id, mime: image.mime, width, height, prompt, provider: providerId, model, createdAt: now() };

        await writeFile(join(dir, `${id}.${EXTENSIONS[image.mime] ?? "bin"}`), image.data);
        await writeFile(join(dir, `${id}.json`), JSON.stringify(record));
        candidates.push({ id, mime: image.mime, width, height, previewUrl: `/api/images/candidates/${id}`, prompt, provider: providerId, model });
      }
      await options.settings.recordUsage({
        siteId: generateOptions.siteId ?? generateOptions.site?.id ?? "",
        at: now(),
        model: `${providerId}:${model}`,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        // The service's own figure when it reports one (OpenRouter does); never an estimate. Placeholders are made here, for nothing.
        cost: providerId === PLACEHOLDER_PROVIDER ? 0 : images.some((image) => typeof image.cost === "number") ? images.reduce((sum, image) => sum + (image.cost ?? 0), 0) : null,
        images: candidates.length,
      });
      return candidates;
    },

    async read(candidateId) {
      maybeSweep();
      const value = await meta(candidateId);

      if (!value) return null;
      const data = await bytesOf(candidateId, value);

      return data ? { data, mime: value.mime } : null;
    },

    async save(site: SiteService, request: ImageSaveRequest, origin: ChangeOrigin = "user"): Promise<MediaItem> {
      const value = await meta(request.candidateId);
      const data = value ? await bytesOf(request.candidateId, value) : null;

      if (!value || !data) {
        throw new GalleyError("not-found", "That generated image has expired. Generate it again.", request.candidateId);
      }
      const base = request.filename?.trim() ? sanitizeFilename(request.filename) : filenameFromPrompt(value.prompt);
      const ext = EXTENSIONS[value.mime] ?? "png";
      const item = await site.saveMedia(
        { filename: `${base}.${ext}`, ...(request.directory ? { directory: request.directory } : {}), data },
        { origin }
      );

      await rm(join(dir, `${request.candidateId}.json`), { force: true });
      await rm(join(dir, `${request.candidateId}.${ext}`), { force: true });
      return item;
    },

    async discard(candidateId) {
      const value = await meta(candidateId);

      if (!CANDIDATE_ID.test(candidateId)) return;
      await rm(join(dir, `${candidateId}.json`), { force: true });
      if (value) await rm(join(dir, `${candidateId}.${EXTENSIONS[value.mime] ?? "bin"}`), { force: true });
    },
  };
}
