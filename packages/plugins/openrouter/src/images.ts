/**
 * Images through OpenRouter's Image API, as documented on 2026-11-23:
 *
 *   POST /api/v1/images                       { model, prompt, n?, aspect_ratio?, resolution?,
 *                                               background?, output_format?, input_references? }
 *                                             → { data: [{ b64_json | url, media_type }], usage: { cost } }
 *   GET  /api/v1/images/models                every image model: architecture.input_modalities /
 *                                             output_modalities, supported_parameters (enum | range | boolean)
 *   GET  /api/v1/images/models/{id}/endpoints per endpoint: pricing [{ billable, unit, cost_usd }]
 *
 *   https://openrouter.ai/docs/guides/overview/multimodal/image-generation
 *   https://openrouter.ai/docs/api/api-reference/images/generate-an-image
 *   https://openrouter.ai/docs/api/api-reference/images/list-image-generation-models
 *   https://openrouter.ai/docs/api/api-reference/images/list-endpoints-for-an-image-model
 *
 * A model's supported_parameters decide what is sent: the aspect ratio when
 * it takes one (else the nearest it does), the smallest "1K"-ish resolution,
 * `n` only up to its range (else one request per picture), a transparent
 * background only where `background` offers it, and reference pictures only
 * where the model takes image input.
 */
import { ProviderError, type GeneratedImageResult, type ImageAspect, type ImageGenerationRequest, type ImageModelInfo, type ImageProviderPlugin, type ProviderCallContext } from "@galley/plugin-kit";
import { base64ToBytes, call, classify, dataUrl, headers, money, OPENROUTER_API, readBody, resolveBaseUrl, scrub, type BaseUrlOption } from "./client";

/** What a model accepts, per its catalogue entry. */
export interface ImageModelRecord extends ImageModelInfo {
  aspects: string[] | null;
  resolutions: string[] | null;
  maxN: number;
  background: string[] | null;
}

interface CatalogueParameter {
  type?: string;
  values?: unknown[];
  min?: number;
  max?: number;
}

interface CatalogueModel {
  id?: string;
  name?: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: Record<string, CatalogueParameter>;
}

/**
 * Used when the catalogue can't be read (no key yet, no network). From
 * OpenRouter's own comparison of image models, published 2026-09-18 (prices
 * measured 2026-09-11): https://openrouter.ai/blog/insights/image-generation-models-compared/
 * — check it again before relying on it; the live catalogue wins whenever it answers.
 */
export const FALLBACK_IMAGE_MODELS: ImageModelRecord[] = [
  { id: "bytedance-seed/seedream-5-0-lite", label: "Seedream 5.0 Lite", supportsReferences: true, supportsTransparency: false, price: "$0.035 per image" },
  { id: "black-forest-labs/flux.2-klein-4b", label: "FLUX.2 Klein 4B", supportsReferences: true, supportsTransparency: false, price: "$0.014 per megapixel" },
  { id: "black-forest-labs/flux.2-pro", label: "FLUX.2 Pro", supportsReferences: true, supportsTransparency: false, price: "$0.03 per megapixel" },
  { id: "openai/gpt-image-2", label: "GPT Image 2", supportsReferences: true, supportsTransparency: false },
  { id: "google/gemini-3.1-flash-image", label: "Gemini 3.1 Flash Image", supportsReferences: true, supportsTransparency: false },
  { id: "qwen/qwen-image-3", label: "Qwen Image 3", supportsReferences: true, supportsTransparency: false, price: "$0.03 per image" },
  { id: "recraft/recraft-v4.1", label: "Recraft V4.1", supportsReferences: true, supportsTransparency: false, price: "$0.035 per image" },
].map((model) => ({ ...model, aspects: null, resolutions: null, maxN: 1, background: null }));

export const DEFAULT_IMAGE_MODEL = "bytedance-seed/seedream-5-0-lite";

const enumOf = (parameter: CatalogueParameter | undefined) =>
  parameter?.type === "enum" && Array.isArray(parameter.values) ? parameter.values.filter((value): value is string => typeof value === "string") : null;

export function recordFrom(model: CatalogueModel): ImageModelRecord | null {
  if (typeof model.id !== "string" || !(model.architecture?.output_modalities ?? []).includes("image")) return null;
  const params = model.supported_parameters ?? {};
  const background = enumOf(params.background);
  const n = params.n;

  return {
    id: model.id,
    label: typeof model.name === "string" && model.name.trim() ? model.name.replace(/^[^:]+:\s*/, "") : model.id,
    supportsReferences: (model.architecture?.input_modalities ?? []).includes("image"),
    supportsTransparency: Boolean(background?.includes("transparent")),
    aspects: enumOf(params.aspect_ratio),
    resolutions: enumOf(params.resolution),
    maxN: n?.type === "range" && typeof n.max === "number" ? Math.max(1, Math.floor(n.max)) : n?.type === "boolean" ? 4 : 1,
    background,
  };
}

interface PricingLine {
  billable?: string;
  unit?: string;
  cost_usd?: number;
  variant?: string;
}

/** The cheapest endpoint's price for one generated picture, in words: "$0.04 per image". */
export function priceFrom(endpoints: Array<{ pricing?: PricingLine[] }>): string | undefined {
  const lines = endpoints.flatMap((endpoint) => endpoint.pricing ?? []).filter((line) => line.billable === "output_image" && typeof line.cost_usd === "number" && !line.variant);

  if (lines.length === 0) return undefined;
  const cheapest = lines.reduce((best, line) => (line.cost_usd! < best.cost_usd! ? line : best));

  switch (cheapest.unit) {
    case "image":
      return `${money(cheapest.cost_usd!)} per image`;
    case "megapixel":
      return `${money(cheapest.cost_usd!)} per megapixel`;
    case "request":
      return `${money(cheapest.cost_usd!)} per request`;
    case "token":
      return `${money(cheapest.cost_usd! * 1_000_000)} per million output tokens`;
    default:
      return undefined;
  }
}

const RATIO = (aspect: string) => {
  const [w, h] = aspect.split(":").map(Number);

  return w && h ? w / h : NaN;
};

/** The aspect ratio to send: the one asked for when the model lists it (or lists nothing), else its nearest. */
export function aspectFor(aspect: ImageAspect, model: ImageModelRecord | undefined): string | undefined {
  const offered = model?.aspects?.filter((value) => value !== "auto");

  if (!offered || offered.length === 0 || offered.includes(aspect)) return aspect;
  const target = RATIO(aspect);

  return offered.reduce((best, value) => (Math.abs(Math.log(RATIO(value) / target)) < Math.abs(Math.log(RATIO(best) / target)) ? value : best));
}

const RESOLUTION_ORDER = ["1K", "1.5K", "768", "2K", "512", "4K", "8K"];

/** Web pictures: about a megapixel. The smallest tier at or above 1K the model offers, else nothing (its default). */
export function resolutionFor(model: ImageModelRecord | undefined, wanted?: string): string | undefined {
  const offered = model?.resolutions;

  if (!offered?.length) return undefined;
  if (wanted && offered.includes(wanted)) return wanted;
  return RESOLUTION_ORDER.find((tier) => offered.includes(tier)) ?? offered[0];
}

export interface ImageCatalogueOptions {
  baseUrl: BaseUrlOption;
  /** How long a fetched catalogue is kept. */
  cacheMs: number;
  now: () => number;
}

/** The live model list (with prices), cached; the fallback list when it can't be read. */
export function createImageCatalogue(options: ImageCatalogueOptions) {
  let cache: { at: number; base: string; models: ImageModelRecord[] } | null = null;
  let loading: Promise<ImageModelRecord[]> | null = null;

  async function fetchAll(ctx: ProviderCallContext, base: string): Promise<ImageModelRecord[]> {
    const response = await call(ctx, `${base}/images/models`, { method: "GET", headers: headers(ctx, false) }, "image");
    const body = await readBody(response);

    if (!response.ok) throw classify(response.status, body, ctx.key, "image");
    const models = ((body as { data?: CatalogueModel[] }).data ?? []).map(recordFrom).filter((model): model is ImageModelRecord => model !== null);

    // Prices are per endpoint; fetched a few at a time, and a model whose price can't be read is still offered.
    const queue = [...models];
    const worker = async () => {
      for (let model = queue.shift(); model; model = queue.shift()) {
        try {
          const priced = await call(ctx, `${base}/images/models/${model.id.split("/").map(encodeURIComponent).join("/")}/endpoints`, { method: "GET", headers: headers(ctx, false) }, "image");

          if (priced.ok) {
            const price = priceFrom(((await readBody(priced)) as { endpoints?: Array<{ pricing?: PricingLine[] }> }).endpoints ?? []);

            if (price) model.price = price;
          }
        } catch {
          // Unpriced, not unlisted.
        }
      }
    };

    await Promise.all(Array.from({ length: 6 }, worker));
    return models.sort((a, b) => a.label.localeCompare(b.label));
  }

  return {
    async models(ctx: ProviderCallContext): Promise<ImageModelRecord[]> {
      const base = resolveBaseUrl(options.baseUrl);

      if (cache && cache.base === base && options.now() - cache.at < options.cacheMs) return cache.models;
      // The catalogue is only listed to a signed-in caller.
      if (!ctx.key) return cache?.models ?? FALLBACK_IMAGE_MODELS;
      loading ??= fetchAll(ctx, base)
        .then((models) => {
          if (models.length) cache = { at: options.now(), base, models };
          return cache?.models ?? FALLBACK_IMAGE_MODELS;
        })
        .catch((error: unknown) => {
          ctx.log.warn(`couldn't read the image model list, so the built-in list is used: ${error instanceof ProviderError ? error.detail : String(error)}`);
          return cache?.models ?? FALLBACK_IMAGE_MODELS;
        })
        .finally(() => {
          loading = null;
        });
      return loading;
    },
    /** A model's record, from the cache or the fallback list — without fetching. */
    known(id: string): ImageModelRecord | undefined {
      return (cache?.models ?? FALLBACK_IMAGE_MODELS).find((model) => model.id === id);
    },
    clear() {
      cache = null;
    },
  };
}

type Catalogue = ReturnType<typeof createImageCatalogue>;

interface ImageItem {
  b64_json?: string | null;
  url?: string | null;
  media_type?: string | null;
}

async function imagesFrom(items: ImageItem[], ctx: ProviderCallContext): Promise<Array<{ data: Uint8Array; mime: string }>> {
  const out: Array<{ data: Uint8Array; mime: string }> = [];

  for (const item of items) {
    const mime = typeof item.media_type === "string" && item.media_type.startsWith("image/") ? item.media_type : "image/png";

    if (typeof item.b64_json === "string" && item.b64_json.length > 0) {
      out.push({ data: base64ToBytes(item.b64_json.replace(/^data:[^,]+,/, "")), mime });
    } else if (typeof item.url === "string" && /^https:\/\//.test(item.url)) {
      // Only when a URL was sent back instead of bytes: fetch it now, the link expires.
      const response = await call(ctx, item.url, { method: "GET" }, "image");

      if (response.ok) out.push({ data: new Uint8Array(await response.arrayBuffer()), mime: response.headers.get("content-type")?.split(";")[0] ?? mime });
    }
  }
  return out;
}

export function imageProvider(catalogue: Catalogue, options: { baseUrl: BaseUrlOption }): ImageProviderPlugin {
  return {
    id: "openrouter",
    label: "OpenRouter",
    keySetting: "apiKey",
    defaultModel: DEFAULT_IMAGE_MODEL,
    // Per model: the catalogue says which take reference pictures and transparent backgrounds.
    supportsReferences: true,
    supportsTransparency: false,
    models: (ctx) => catalogue.models(ctx),

    async generate(request: ImageGenerationRequest, ctx: ProviderCallContext): Promise<GeneratedImageResult[]> {
      if (!ctx.key) throw new ProviderError("auth", "Add an OpenRouter API key in Settings to generate images with OpenRouter.", "no key");
      const model = catalogue.known(request.model) ?? (await catalogue.models(ctx)).find((item) => item.id === request.model);

      if (request.references.length && model && model.supportsReferences === false) {
        throw new ProviderError("invalid", `${model.label} can't work from reference pictures. Choose another model, or leave the references out.`, `model=${request.model}`);
      }
      if (request.transparent && model && !model.supportsTransparency) {
        throw new ProviderError("invalid", `${model.label} can't make transparent backgrounds. Turn that off, or choose another model.`, `model=${request.model}`);
      }
      const perRequest = Math.max(1, Math.min(request.count, model?.maxN ?? 1));
      const requests = Math.ceil(request.count / perRequest);
      const aspect = aspectFor(request.aspect, model);
      const resolution = resolutionFor(model);
      const results: GeneratedImageResult[] = [];

      for (let index = 0; index < requests; index += 1) {
        const n = Math.min(perRequest, request.count - results.length);
        const body: Record<string, unknown> = {
          model: request.model,
          prompt: request.prompt,
          ...(n > 1 ? { n } : {}),
          ...(aspect ? { aspect_ratio: aspect } : {}),
          ...(resolution ? { resolution } : {}),
          ...(request.transparent ? { background: "transparent", output_format: "png" } : {}),
          ...(request.references.length
            ? { input_references: request.references.slice(0, 16).map((ref) => ({ type: "image_url", image_url: { url: dataUrl(ref.data, ref.mime) } })) }
            : {}),
        };
        const response = await call(ctx, `${resolveBaseUrl(options.baseUrl)}/images`, { method: "POST", headers: headers(ctx), body: JSON.stringify(body) }, "image");
        const json = (await readBody(response)) as { data?: ImageItem[]; usage?: { cost?: number | null } };

        if (!response.ok) throw classify(response.status, json, ctx.key, "image");
        const images = await imagesFrom(json.data ?? [], ctx);

        if (images.length === 0) throw new ProviderError("empty", "OpenRouter didn't send an image back. Try again.", scrub(`openrouter: empty data[] for ${request.model}`, ctx.key));
        const cost = typeof json.usage?.cost === "number" ? json.usage.cost : undefined;

        // The response's cost covers all of its pictures; it is carried on the first.
        images.forEach((image, at) => results.push({ ...image, ...(at === 0 && cost !== undefined ? { cost } : {}) }));
      }
      return results;
    },
  };
}

export { OPENROUTER_API };
