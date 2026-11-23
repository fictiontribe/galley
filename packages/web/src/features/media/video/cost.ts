/**
 * What a video will cost, said before it is started. Providers publish
 * prices as plain lines ("$0.03–$0.08 per second", "$0.084 per second",
 * "$0.40 per video"); the line here multiplies by the chosen length and
 * names who charges. Nothing is guessed: no published price, no number.
 */
import type { ImageProviderInfo, VideoProviderInfo } from "@galley/core/types";

export type VideoModel = VideoProviderInfo["models"][number];

/** The media library keeps MP4 videos up to this size (the engine's limit, workspace/media.ts). */
export const VIDEO_SIZE_LIMIT = 25 * 1024 * 1024;

/** How long the engine keeps a made video before it is thrown away unsaved. */
export const CANDIDATE_HOURS = 2;

export interface ParsedPrice {
  low: number;
  high: number;
  unit: "second" | "video" | null;
}

/** "$0.03–$0.08 per second" → 0.03, 0.08, per second. A line it can't read is null. */
export function parsePrice(price: string | undefined): ParsedPrice | null {
  if (!price) return null;
  const amounts = [...price.matchAll(/\$\s?(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  if (amounts.length === 0 || amounts.some((value) => !Number.isFinite(value))) return null;
  const unit = /per\s+(video\s+)?second|\/\s?s(ec)?\b/i.test(price) ? "second" : /per\s+(video|clip|generation)\b/i.test(price) ? "video" : null;
  return { low: Math.min(...amounts), high: Math.max(...amounts), unit };
}

function dollars(value: number): string {
  if (value > 0 && value < 0.01) return "under $0.01";
  return `$${value.toFixed(2)}`;
}

function range(low: number, high: number): string {
  if (Math.abs(high - low) < 0.005) return dollars(low);
  return `${dollars(low)}–${dollars(high)}`;
}

/**
 * The one line under the form: "About $0.40 for 5 seconds — charged by
 * OpenRouter". With a price range it says what moves it.
 */
export function costLine(model: VideoModel | undefined, seconds: number | undefined, provider: string): string {
  const parsed = parsePrice(model?.price);
  const who = `charged by ${provider}`;
  if (!model || !parsed) return `${provider} doesn’t publish a price for this model. It’s charged to your ${provider} account when the video is made.`;
  const ranged = parsed.high - parsed.low >= 0.005;
  const why = ranged && (model.resolutions?.length ?? 0) > 1 ? ", depending on the resolution" : "";
  if (parsed.unit === "second") {
    if (!seconds) return `About ${range(parsed.low, parsed.high)} a second${why}; this model chooses the length — ${who}`;
    return `About ${range(parsed.low * seconds, parsed.high * seconds)} for ${seconds} ${seconds === 1 ? "second" : "seconds"}${why} — ${who}`;
  }
  if (parsed.unit === "video") return `About ${range(parsed.low, parsed.high)} for this video${why} — ${who}`;
  return `${provider} lists this model at ${model.price} — ${who}`;
}

/** The length to start with: 5 seconds where the model offers it, else its shortest. */
export function defaultDuration(model: VideoModel | undefined): number | undefined {
  const durations = model?.durations ?? [];
  if (durations.length === 0) return undefined;
  return durations.includes(5) ? 5 : Math.min(...durations);
}

/** A model's option list kept only when it offers a choice the person can make. */
export function choices<T>(list: readonly T[] | undefined): T[] {
  return list && list.length > 0 ? [...list] : [];
}

/** One line about a model under its picker: lengths, resolutions, first frame, sound. The price is in the option itself. */
export function modelFacts(model: VideoModel): string {
  const parts: string[] = [];
  if (model.durations?.length) parts.push(`${model.durations.join(", ")} s`);
  if (model.resolutions?.length) parts.push(model.resolutions.join(" / "));
  if (model.supportsFirstFrame) parts.push("can start from a picture");
  if (model.audio) parts.push("with sound");
  return parts.join(" · ");
}

/** The same line for an image model (App settings and the image dialog): what it can do; its price is in the option. A model's own `supports…` wins over its provider's. */
export function imageModelFacts(provider: Pick<ImageProviderInfo, "supportsReferences" | "supportsTransparency">, model: ImageProviderInfo["models"][number] | undefined): string {
  if (!model) return "";
  const parts: string[] = [];
  if (model.supportsReferences ?? provider.supportsReferences) parts.push("takes reference pictures");
  if (model.supportsTransparency ?? provider.supportsTransparency) parts.push("transparent backgrounds");
  return parts.join(" · ");
}

/** "FLUX.2 Pro — $0.03 per megapixel": a model's name with its price, for a picker. */
export function modelOptionLabel(model: { label: string; price?: string }): string {
  return model.price ? `${model.label} — ${model.price}` : model.label;
}
