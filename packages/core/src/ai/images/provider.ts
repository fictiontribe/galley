/** The one interface every image provider implements. */
import type { ImageAspect } from "../../types";

export interface ProviderRequest {
  /** The prompt with any style direction already appended. */
  prompt: string;
  aspect: ImageAspect;
  /** 1–4. */
  count: number;
  model: string;
  transparent: boolean;
  references: Array<{ data: Uint8Array; mime: string }>;
  signal?: AbortSignal;
}

export interface GeneratedImage {
  data: Uint8Array;
  mime: string;
  width?: number;
  height?: number;
}

export interface ImageProvider {
  readonly id: string;
  generate(request: ProviderRequest, key: string | null, fetchImpl: typeof fetch): Promise<GeneratedImage[]>;
}

export class ImageProviderError extends Error {
  constructor(
    readonly kind: "auth" | "policy" | "quota" | "rate" | "unavailable" | "invalid" | "empty",
    /** Plain sentence for the person. */
    readonly plain: string,
    /** Scrubbed technical detail. */
    readonly detail: string
  ) {
    super(plain);
    this.name = "ImageProviderError";
  }
}

export function base64ToBytes(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, "base64"));
}

export function bytesToBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

/** Reads a JSON body without throwing; providers sometimes answer with HTML. */
export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text.slice(0, 500) };
  }
}
