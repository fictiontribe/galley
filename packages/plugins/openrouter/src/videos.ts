/**
 * Video through OpenRouter's Video API, as documented on 2026-11-23:
 *
 *   POST /api/v1/videos                  { model, prompt, aspect_ratio?, duration?, resolution?,
 *                                          generate_audio?, frame_images? } → 202 { id, polling_url, status }
 *   GET  /api/v1/videos/{id}             { status: pending | in_progress | completed | failed | cancelled | expired,
 *                                          progress?, unsigned_urls?, usage: { cost }, error? }
 *   GET  /api/v1/videos/{id}/content     the video bytes (?index= for several outputs)
 *   GET  /api/v1/videos/models           supported_durations / _resolutions / _aspect_ratios,
 *                                          supported_frame_images, generate_audio, pricing_skus
 *
 *   https://openrouter.ai/docs/guides/overview/multimodal/video-generation
 *   https://openrouter.ai/docs/api/api-reference/video-generation/create-videos
 *   https://openrouter.ai/docs/api/api-reference/video-generation/list-all-video-generation-models
 *
 * Polling cadence and backoff belong to the engine (VideoService); this file
 * only answers "where is it now".
 */
import { ProviderError, type ProviderCallContext, type VideoGenerationRequest, type VideoJobState, type VideoModelInfo, type VideoProviderPlugin } from "@galley/plugin-kit";
import { call, classify, dataUrl, headers, money, readBody, resolveBaseUrl, scrub, type BaseUrlOption } from "./client";

interface CatalogueVideoModel {
  id?: string;
  name?: string;
  supported_durations?: number[] | null;
  supported_resolutions?: string[] | null;
  supported_aspect_ratios?: string[] | null;
  supported_frame_images?: string[] | null;
  generate_audio?: boolean | null;
  pricing_skus?: Record<string, string> | null;
}

/**
 * Used when the catalogue can't be read. From OpenRouter's comparison of
 * image-to-video models, published 2026-09-29 (updated 2026-10-15):
 * https://openrouter.ai/blog/insights/image-to-video-models-compared/
 */
export const FALLBACK_VIDEO_MODELS: VideoModelInfo[] = [
  { id: "google/veo-3.1-lite", label: "Veo 3.1 Lite", durations: [4, 6, 8], resolutions: ["720p", "1080p"], supportsFirstFrame: true, audio: true, price: "$0.03–$0.08 per second" },
  { id: "google/veo-3.1-fast", label: "Veo 3.1 Fast", durations: [4, 6, 8], resolutions: ["720p", "1080p", "4K"], supportsFirstFrame: true, audio: true, price: "$0.08–$0.30 per second" },
  { id: "google/veo-3.1", label: "Veo 3.1", durations: [4, 6, 8], resolutions: ["720p", "1080p", "4K"], supportsFirstFrame: true, audio: true, price: "$0.20–$0.60 per second" },
  { id: "bytedance/seedance-2.0-fast", label: "Seedance 2.0 Fast", resolutions: ["480p", "720p"], supportsFirstFrame: true, audio: true },
  { id: "kwaivgi/kling-v3.0-std", label: "Kling 3.0 Standard", resolutions: ["720p"], supportsFirstFrame: true, audio: true, price: "$0.084 per second" },
  { id: "alibaba/wan-3.0", label: "Wan 3.0", resolutions: ["480p", "720p", "1080p"], supportsFirstFrame: true, audio: true },
];

export const DEFAULT_VIDEO_MODEL = "google/veo-3.1-lite";

/** pricing_skus → words. SKU names say their unit ("per-video-second", "per-video-second-1080p"); others are shown as named. */
export function videoPrice(skus: Record<string, string> | null | undefined): string | undefined {
  const entries = Object.entries(skus ?? {})
    .map(([sku, value]) => [sku, Number(value)] as const)
    .filter(([, value]) => Number.isFinite(value));

  if (entries.length === 0) return undefined;
  const perSecond = entries.filter(([sku]) => /second/.test(sku));

  if (perSecond.length) {
    const values = perSecond.map(([, value]) => value);
    const low = Math.min(...values);
    const high = Math.max(...values);

    return low === high ? `${money(low)} per second` : `${money(low)}–${money(high)} per second`;
  }
  const [sku, value] = entries[0]!;

  return `${money(value)} (${sku.replace(/[-_]/g, " ")})`;
}

export function videoRecordFrom(model: CatalogueVideoModel): VideoModelInfo | null {
  if (typeof model.id !== "string") return null;
  const durations = (model.supported_durations ?? []).filter((value) => Number.isInteger(value) && value > 0);
  const price = videoPrice(model.pricing_skus);

  return {
    id: model.id,
    label: typeof model.name === "string" && model.name.trim() ? model.name.replace(/^[^:]+:\s*/, "") : model.id,
    ...(durations.length ? { durations } : {}),
    ...(model.supported_resolutions?.length ? { resolutions: model.supported_resolutions } : {}),
    ...(model.supported_aspect_ratios?.length ? { aspects: model.supported_aspect_ratios } : {}),
    supportsFirstFrame: Boolean(model.supported_frame_images?.includes("first_frame")),
    audio: model.generate_audio === true,
    ...(price ? { price } : {}),
  };
}

export function createVideoCatalogue(options: { baseUrl: BaseUrlOption; cacheMs: number; now: () => number }) {
  let cache: { at: number; base: string; models: VideoModelInfo[] } | null = null;

  return {
    async models(ctx: ProviderCallContext): Promise<VideoModelInfo[]> {
      const base = resolveBaseUrl(options.baseUrl);

      if (cache && cache.base === base && options.now() - cache.at < options.cacheMs) return cache.models;
      if (!ctx.key) return cache?.models ?? FALLBACK_VIDEO_MODELS;
      try {
        const response = await call(ctx, `${base}/videos/models`, { method: "GET", headers: headers(ctx, false) }, "video");
        const body = await readBody(response);

        if (!response.ok) throw classify(response.status, body, ctx.key, "video");
        const models = ((body as { data?: CatalogueVideoModel[] }).data ?? []).map(videoRecordFrom).filter((model): model is VideoModelInfo => model !== null);

        if (models.length) cache = { at: options.now(), base, models: models.sort((a, b) => a.label.localeCompare(b.label)) };
      } catch (error) {
        ctx.log.warn(`couldn't read the video model list, so the built-in list is used: ${error instanceof ProviderError ? error.detail : String(error)}`);
      }
      return cache?.models ?? FALLBACK_VIDEO_MODELS;
    },
    known(id: string): VideoModelInfo | undefined {
      return (cache?.models ?? FALLBACK_VIDEO_MODELS).find((model) => model.id === id);
    },
  };
}

type Catalogue = ReturnType<typeof createVideoCatalogue>;

interface JobBody {
  id?: string;
  status?: string;
  progress?: number;
  error?: string;
  unsigned_urls?: string[];
  urls?: string[];
  usage?: { cost?: number | null };
}

const JOB_ID = /^[A-Za-z0-9._:-]{4,200}$/;

function jobUrl(baseUrl: string, jobId: string, suffix = ""): string {
  if (!JOB_ID.test(jobId)) throw new ProviderError("invalid", "That video job isn't one OpenRouter gave out.", `bad job id`);
  return `${baseUrl}/videos/${encodeURIComponent(jobId)}${suffix}`;
}

export function videoProvider(catalogue: Catalogue, options: { baseUrl: BaseUrlOption }): VideoProviderPlugin {
  return {
    id: "openrouter",
    label: "OpenRouter",
    keySetting: "apiKey",
    defaultModel: DEFAULT_VIDEO_MODEL,
    models: (ctx) => catalogue.models(ctx),

    async start(request: VideoGenerationRequest, ctx: ProviderCallContext) {
      if (!ctx.key) throw new ProviderError("auth", "Add an OpenRouter API key in Settings to make videos with OpenRouter.", "no key");
      const model = catalogue.known(request.model);

      if (request.firstFrame && model && model.supportsFirstFrame === false) {
        throw new ProviderError("invalid", `${model.label} can't start from a picture. Choose another model, or leave the picture out.`, `model=${request.model}`);
      }
      if (request.durationSeconds && model?.durations?.length && !model.durations.includes(request.durationSeconds)) {
        throw new ProviderError("invalid", `${model.label} makes videos of ${model.durations.join(", ")} seconds. Choose one of those lengths.`, `duration=${request.durationSeconds}`);
      }
      const body: Record<string, unknown> = {
        model: request.model,
        prompt: request.prompt,
        ...(request.aspect ? { aspect_ratio: request.aspect } : {}),
        ...(request.durationSeconds ? { duration: request.durationSeconds } : {}),
        ...(request.resolution ? { resolution: request.resolution } : {}),
        ...(request.audio !== undefined ? { generate_audio: request.audio } : {}),
        ...(request.firstFrame ? { frame_images: [{ type: "image_url", image_url: { url: dataUrl(request.firstFrame.data, request.firstFrame.mime) }, frame_type: "first_frame" }] } : {}),
      };
      const response = await call(ctx, `${resolveBaseUrl(options.baseUrl)}/videos`, { method: "POST", headers: headers(ctx), body: JSON.stringify(body) }, "video");
      const json = (await readBody(response)) as JobBody;

      if (!response.ok) throw classify(response.status, json, ctx.key, "video");
      if (typeof json.id !== "string" || !JOB_ID.test(json.id)) throw new ProviderError("empty", "OpenRouter didn't say which job it started. Try again.", scrub(JSON.stringify(json).slice(0, 300), ctx.key));
      return { jobId: json.id };
    },

    async poll(jobId, ctx): Promise<VideoJobState> {
      const response = await call(ctx, jobUrl(resolveBaseUrl(options.baseUrl), jobId), { method: "GET", headers: headers(ctx, false) }, "video");
      const json = (await readBody(response)) as JobBody;

      if (!response.ok) throw classify(response.status, json, ctx.key, "video");
      const detail = scrub(`status=${json.status ?? "unknown"} ${json.error ?? ""}`, ctx.key);

      switch (json.status) {
        case "completed": {
          const outputs = Math.max(json.unsigned_urls?.length ?? 0, json.urls?.length ?? 0, 1);

          return { state: "done", outputs, ...(typeof json.usage?.cost === "number" ? { cost: json.usage.cost } : {}) };
        }
        case "failed":
          // The reason is the provider's own prose: it goes in the detail, the person reads a plain sentence.
          return { state: "failed", kind: "unavailable", message: "The video couldn't be made. Try a different description or another model.", detail };
        case "cancelled":
          return { state: "failed", kind: "unavailable", message: "The video was cancelled before it finished.", detail };
        case "expired":
          return { state: "failed", kind: "unavailable", message: "The video expired on OpenRouter before it could be downloaded. Make it again.", detail };
        case "pending":
          return { state: "running", detail: "Waiting for its turn…", ...(typeof json.progress === "number" ? { progress: json.progress / 100 } : {}) };
        default:
          return { state: "running", detail: "Making the video…", ...(typeof json.progress === "number" ? { progress: json.progress / 100 } : {}) };
      }
    },

    async download(jobId, index, ctx) {
      const response = await call(ctx, jobUrl(resolveBaseUrl(options.baseUrl), jobId, `/content?index=${Math.max(0, Math.floor(index))}`), { method: "GET", headers: headers(ctx, false) }, "video");

      if (!response.ok) throw classify(response.status, await readBody(response), ctx.key, "video");
      const data = new Uint8Array(await response.arrayBuffer());

      if (data.byteLength === 0) throw new ProviderError("empty", "OpenRouter sent an empty video back. Make it again.", "empty content");
      return { data, mime: response.headers.get("content-type")?.split(";")[0]?.trim() || "video/mp4" };
    },
  };
}
