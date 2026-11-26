/**
 * Managed AI credits helpers for the web UI: converting USD list prices and
 * usage figures into whole Galley AI credits when `meta.ai.managed` is enabled.
 */
import { useMeta } from "./stores/meta";

export const DEFAULT_CREDIT_MILLICENTS = 250;

export interface ManagedAiState {
  managed: boolean;
  creditMillicents: number;
  disabled: boolean;
  manageUrl?: string;
}

/** Reads managed AI credits metadata from `GET /api/meta`. */
export function useManagedAi(): ManagedAiState {
  const ai = useMeta((s) => s.meta?.ai);

  return {
    managed: Boolean(ai?.managed),
    creditMillicents: ai?.creditMillicents && ai.creditMillicents > 0 ? ai.creditMillicents : DEFAULT_CREDIT_MILLICENTS,
    disabled: Boolean(ai?.managed && ai?.disabled),
    ...(ai?.manageUrl ? { manageUrl: ai.manageUrl } : {}),
  };
}

/** Converts a USD amount to whole AI credits (rounded up; 0 for non-positive values). */
export function usdToCredits(usd: number, creditMillicents = DEFAULT_CREDIT_MILLICENTS): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  const unit = Number.isInteger(creditMillicents) && creditMillicents > 0 ? creditMillicents : DEFAULT_CREDIT_MILLICENTS;
  const millicents = Math.round(usd * 100_000);

  if (millicents <= 0) return 1;
  return Math.ceil(millicents / unit);
}

/** "42 credits", "1 credit", "1,250 credits". */
export function formatCredits(credits: number): string {
  const value = Number.isFinite(credits) ? Math.max(0, Math.round(credits)) : 0;

  return `${value.toLocaleString()} ${value === 1 ? "credit" : "credits"}`;
}

/** Formats a USD total as Galley AI credits, or "—" when unknown. */
export function formatUsdAsCredits(usd: number | null | undefined, creditMillicents = DEFAULT_CREDIT_MILLICENTS): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return "—";
  if (usd <= 0) return "0 credits";
  return formatCredits(usdToCredits(usd, creditMillicents));
}

/**
 * Converts a dollar price string into credit equivalents:
 *   "$3"                     → "1,200 credits"
 *   "$0.03 per megapixel"    → "12 credits per megapixel"
 *   "$0.03–$0.08 per second" → "12–32 credits per second"
 *   "$0.04 per image"        → "16 credits per image"
 * Falls back to `priceText` unchanged when no dollar figure can be parsed.
 */
export function formatPriceStringAsCredits(priceText: string, creditMillicents = DEFAULT_CREDIT_MILLICENTS): string {
  if (!priceText) return priceText;
  const rangePattern = /\$\s?(\d+(?:\.\d+)?)\s*([–—-])\s*\$\s?(\d+(?:\.\d+)?)/;
  const rangeMatch = rangePattern.exec(priceText);

  if (rangeMatch) {
    const low = usdToCredits(Number(rangeMatch[1]), creditMillicents);
    const high = usdToCredits(Number(rangeMatch[3]), creditMillicents);
    const dash = rangeMatch[2] === "-" ? "–" : rangeMatch[2];
    const replacement = low === high ? formatCredits(low) : `${low.toLocaleString()}${dash}${high.toLocaleString()} credits`;

    return priceText.replace(rangePattern, replacement);
  }
  const singlePattern = /\$\s?(\d+(?:\.\d+)?)/;
  const singleMatch = singlePattern.exec(priceText);

  if (singleMatch) {
    const credits = usdToCredits(Number(singleMatch[1]), creditMillicents);

    return priceText.replace(singlePattern, formatCredits(credits));
  }
  return priceText;
}
