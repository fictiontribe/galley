/**
 * OpenAI GPT Image, over plain fetch (no vendor SDK — keeps the bundle small).
 *
 *   POST https://api.openai.com/v1/images/generations   text → image
 *   POST https://api.openai.com/v1/images/edits         with reference images
 *
 * Both take JSON; edits take `images: [{ image_url }]` where a base64 data URL
 * is accepted. Responses carry `data[].b64_json`. Shapes per the docs listed in
 * catalog.ts (verified 2026-11-23); not exercised against the live service.
 */
import { scrubSecrets } from "../errors";
import { OPENAI_SIZES } from "./catalog";
import {
  ImageProviderError,
  base64ToBytes,
  bytesToBase64,
  readJson,
  type GeneratedImage,
  type ImageProvider,
  type ProviderRequest,
} from "./provider";

export const OPENAI_BASE = "https://api.openai.com/v1";

interface OpenAiError {
  error?: { message?: string; type?: string; code?: string | null };
}

interface OpenAiImages {
  data?: Array<{ b64_json?: string | null }>;
  output_format?: string;
}

function classify(status: number, body: OpenAiError): ImageProviderError {
  const code = body.error?.code ?? "";
  const type = body.error?.type ?? "";
  const detail = scrubSecrets(`openai ${status} type=${type} code=${code} ${body.error?.message ?? ""}`).slice(0, 600);

  if (status === 401) return new ImageProviderError("auth", "OpenAI didn't accept the API key in Settings. Add a fresh key and try again.", detail);
  if (status === 403) {
    return new ImageProviderError("auth", "This OpenAI account isn't allowed to use that image model yet. OpenAI may ask the organization to verify itself first.", detail);
  }
  if (code === "moderation_blocked" || type === "image_generation_user_error") {
    return new ImageProviderError("policy", "OpenAI declined to make that image. Try describing it differently.", detail);
  }
  if (status === 429 && (code === "insufficient_quota" || code === "billing_hard_limit_reached")) {
    return new ImageProviderError("quota", "The OpenAI account is out of credit. Add credit, then try again.", detail);
  }
  if (status === 429) return new ImageProviderError("rate", "OpenAI is limiting requests right now. Wait a minute, then try again.", detail);
  if (status >= 500) return new ImageProviderError("unavailable", "OpenAI's image service had a problem. Try again in a minute.", detail);
  return new ImageProviderError("invalid", "OpenAI couldn't make that image. Try a simpler description.", detail);
}

export const openaiProvider: ImageProvider = {
  id: "openai",
  async generate(request: ProviderRequest, key: string | null, fetchImpl: typeof fetch): Promise<GeneratedImage[]> {
    if (!key) throw new ImageProviderError("auth", "Add an OpenAI API key in Settings to generate images with OpenAI.", "no key");
    const size = OPENAI_SIZES[request.aspect];
    const body: Record<string, unknown> = {
      model: request.model,
      prompt: request.prompt,
      n: request.count,
      size: `${size.width}x${size.height}`,
      output_format: "png",
      ...(request.transparent ? { background: "transparent" } : {}),
    };
    const editing = request.references.length > 0;

    if (editing) {
      body.images = request.references.slice(0, 16).map((ref) => ({ image_url: `data:${ref.mime};base64,${bytesToBase64(ref.data)}` }));
    }
    let response: Response;

    try {
      response = await fetchImpl(`${OPENAI_BASE}/images/${editing ? "edits" : "generations"}`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: request.signal ?? null,
      });
    } catch (error) {
      throw new ImageProviderError("unavailable", "Couldn't reach OpenAI. Check the internet connection, then try again.", scrubSecrets(String(error)));
    }
    const json = (await readJson(response)) as OpenAiImages & OpenAiError;

    if (!response.ok) throw classify(response.status, json);
    const images = (json.data ?? [])
      .map((item) => item.b64_json)
      .filter((data): data is string => typeof data === "string" && data.length > 0)
      .map((data) => ({ data: base64ToBytes(data), mime: "image/png", width: size.width, height: size.height }));

    if (images.length === 0) throw new ImageProviderError("empty", "OpenAI didn't send an image back. Try again.", "openai: empty data[]");
    return images;
  },
};
