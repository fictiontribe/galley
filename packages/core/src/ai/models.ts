/**
 * The models the person can pick, what they cost, and what each one accepts.
 *
 * Prices and capabilities come from the claude-api skill's model table
 * (cached 2026-11-03) and its migration guide. They are list prices, used for
 * an estimate in Settings — never presented as a bill.
 */
import type { ModelInfo } from "../types";

export const DEFAULT_MODEL = "claude-opus-5-5";
/** The small, fast model used for one-line summaries (publish messages). */
export const SUMMARY_MODEL = "claude-haiku-5-5";

/** The picker list, in the order it is shown. */
export const MODELS: ModelInfo[] = [
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    blurb: "The default. Careful with wording and structure; the right choice for most sites.",
    inputPrice: 4,
    outputPrice: 20,
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    blurb: "Faster and about half the price. Good for everyday edits and writing.",
    inputPrice: 2,
    outputPrice: 10,
  },
  {
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    blurb: "The quickest and cheapest. Fine for small, specific changes; weaker on whole pages.",
    inputPrice: 0.1,
    outputPrice: 0.5,
  },
  {
    id: "claude-fable-5-2",
    label: "Claude Fable 5.2",
    blurb: "The most capable and the most expensive. For building whole sites or large rewrites.",
    inputPrice: 8,
    outputPrice: 40,
  },
];

interface PriceCard {
  input: number;
  output: number;
  /** 5-minute cache write, per MTok. */
  cacheWrite: number;
  cacheRead: number;
}

interface ModelPricing {
  standard: PriceCard;
  /** A second rate card for prompts over `longAbove` input tokens (Haiku 5.5). */
  long?: PriceCard & { above: number };
}

/**
 * USD per million tokens. Cache writes are the 5-minute TTL (1.25x input) — the
 * only TTL this module uses. Cache reads differ by model: 0.05x on Opus 5.5 and
 * Sonnet 5.5, 0.025x on Fable 5.2, 0.1x on Haiku 5.5.
 */
const PRICES: Record<string, ModelPricing> = {
  "claude-opus-5-5": { standard: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 } },
  "claude-sonnet-5-5": { standard: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 } },
  "claude-fable-5-2": { standard: { input: 8, output: 40, cacheWrite: 10, cacheRead: 0.2 } },
  "claude-haiku-5-5": {
    standard: { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
    long: { above: 100_000, input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05 },
  },
  // Fallback targets the server may route a refused request to.
  "claude-opus-5": { standard: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 } },
  "claude-opus-4-8": { standard: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 } },
  "claude-sonnet-5": { standard: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 } },
};

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Estimated USD for one request, or null when the model has no known price. */
export function costFor(model: string, tokens: TokenCounts): number | null {
  const pricing = PRICES[model];

  if (!pricing) return null;
  const prompt = tokens.inputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens;
  const card = pricing.long && prompt > pricing.long.above ? pricing.long : pricing.standard;

  return (
    (tokens.inputTokens * card.input +
      tokens.outputTokens * card.output +
      tokens.cacheWriteTokens * card.cacheWrite +
      tokens.cacheReadTokens * card.cacheRead) /
    1_000_000
  );
}

export function isKnownModel(id: string): boolean {
  return MODELS.some((model) => model.id === id);
}

/**
 * Server-side refusal fallback (`fallbacks: "default"`, beta
 * server-side-fallback-2026-07-01). Haiku 5.5 has none — a fallbacks list is a
 * 400 there and "default" does nothing — so it is left off.
 */
export function supportsServerFallback(model: string): boolean {
  return model === "claude-opus-5-5" || model === "claude-sonnet-5-5" || model === "claude-fable-5-2";
}
