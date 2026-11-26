/**
 * Google Nano Banana image generation over plain fetch, on the Interactions API:
 *
 *   POST https://generativelanguage.googleapis.com/v1beta/interactions
 *   headers: x-goog-api-key, Api-Revision: 2026-05-20
 *   body:    { model, input: [{type:"text"}, {type:"image", mime_type, data}…],
 *              response_format: { type: "image", aspect_ratio, image_size } }
 *
 * The response lists `steps`; images are `{ type: "image", mime_type, data }`
 * blocks inside `model_output` steps (thought steps hold interim drafts and are
 * skipped). One image per request, so `count` means several requests. Shapes
 * per the docs listed in catalog.ts (verified 2026-11-23); not exercised
 * against the live service.
 */
import { extractProxyError, scrubSecrets } from "../errors";
import { GOOGLE_ASPECTS } from "./catalog";
import {
  ImageProviderError,
  base64ToBytes,
  bytesToBase64,
  readJson,
  type GeneratedImage,
  type ImageProvider,
  type ProviderRequest,
} from "./provider";

export const GOOGLE_BASE = "https://generativelanguage.googleapis.com";
export const GOOGLE_INTERACTIONS_PATH = "/v1beta/interactions";
export const GOOGLE_INTERACTIONS_URL = `${GOOGLE_BASE}${GOOGLE_INTERACTIONS_PATH}`;
export const GOOGLE_API_REVISION = "2026-05-20";

/** Reads `GALLEY_GOOGLE_BASE_URL` dynamically (per-call) without duplicating `/v1beta/interactions`. */
export function googleInteractionsUrl(env?: NodeJS.ProcessEnv): string {
  const raw = env?.GALLEY_GOOGLE_BASE_URL?.trim() || process.env.GALLEY_GOOGLE_BASE_URL?.trim();

  if (!raw) return GOOGLE_INTERACTIONS_URL;
  const clean = raw.replace(/\/+$/, "");

  return clean.endsWith(GOOGLE_INTERACTIONS_PATH) ? clean : `${clean}${GOOGLE_INTERACTIONS_PATH}`;
}

interface ContentBlock {
  type?: string;
  mime_type?: string;
  data?: string;
}

interface Interaction {
  status?: string;
  steps?: Array<{ type?: string; content?: ContentBlock[] }>;
  output_image?: ContentBlock;
  error?: { code?: number | string; message?: string; status?: string; details?: Array<{ reason?: string; error_code?: string }> | { error_code?: string } };
  errors?: Array<{ code?: string; message?: string }>;
}

function classify(status: number, body: Interaction): ImageProviderError {
  const details = body.error?.details;
  const reason = Array.isArray(details) ? details.map((d) => d.reason ?? "").join(",") : "";
  const kind = body.error?.status ?? "";
  const detail = scrubSecrets(`google ${status} status=${kind} reason=${reason} ${body.error?.message ?? ""}`).slice(0, 600);
  const proxy = extractProxyError(body);

  if (proxy) return new ImageProviderError(proxy.code === "galley_ai_switched_off" ? "auth" : "quota", proxy.message, detail);
  if (status === 401 || status === 403 || reason.includes("API_KEY_INVALID") || kind === "UNAUTHENTICATED" || kind === "PERMISSION_DENIED") {
    return new ImageProviderError("auth", "Google didn't accept the API key in Settings. Add a fresh key and try again.", detail);
  }
  if (status === 429 || kind === "RESOURCE_EXHAUSTED") {
    return new ImageProviderError("quota", "The Google AI account has used up its image allowance for now. Wait, or raise the limit, then try again.", detail);
  }
  if (status >= 500) return new ImageProviderError("unavailable", "Google's image service had a problem. Try again in a minute.", detail);
  return new ImageProviderError("invalid", "Google couldn't make that image. Try a simpler description.", detail);
}

function imageFrom(body: Interaction): ContentBlock | null {
  let found: ContentBlock | null = null;

  for (const step of body.steps ?? []) {
    if (step.type !== "model_output") continue;
    for (const block of step.content ?? []) if (block.type === "image" && block.data) found = block;
  }
  return found ?? (body.output_image?.data ? body.output_image : null);
}

export function createGoogleProvider(env?: NodeJS.ProcessEnv): ImageProvider {
  return {
    id: "google",
    async generate(request: ProviderRequest, key: string | null, fetchImpl: typeof fetch): Promise<GeneratedImage[]> {
      if (!key) throw new ImageProviderError("auth", "Add a Google AI API key in Settings to generate images with Google.", "no key");
      const input = [
        { type: "text", text: request.prompt },
        ...request.references.slice(0, 14).map((ref) => ({ type: "image", mime_type: ref.mime, data: bytesToBase64(ref.data) })),
      ];
      const body = JSON.stringify({
        model: request.model,
        input,
        response_format: { type: "image", aspect_ratio: GOOGLE_ASPECTS[request.aspect], image_size: "1K" },
      });
      const images: GeneratedImage[] = [];

      for (let i = 0; i < request.count; i += 1) {
        let response: Response;

        try {
          response = await fetchImpl(googleInteractionsUrl(env), {
            method: "POST",
            headers: { "x-goog-api-key": key, "content-type": "application/json", "api-revision": GOOGLE_API_REVISION },
            body,
            signal: request.signal ?? null,
          });
        } catch (error) {
          throw new ImageProviderError("unavailable", "Couldn't reach Google. Check the internet connection, then try again.", scrubSecrets(String(error)));
        }
        const json = (await readJson(response)) as Interaction;

        if (!response.ok) throw classify(response.status, json);
        const block = imageFrom(json);

        if (!block?.data) {
          // A completed interaction with no image is how a declined prompt shows up.
          const detail = scrubSecrets(`google status=${json.status ?? "?"} errors=${JSON.stringify(json.errors ?? [])}`).slice(0, 600);

          throw new ImageProviderError("policy", "Google didn't make that image — it may have declined the description. Try describing it differently.", detail);
        }
        images.push({ data: base64ToBytes(block.data), mime: block.mime_type ?? "image/jpeg" });
      }
      return images;
    },
  };
}

export const googleProvider: ImageProvider = createGoogleProvider();
