/**
 * Managed AI credits: converting USD estimates to whole Galley AI credits and
 * reading the runtime environment flags that enable managed credits mode.
 *
 * All env lookups are dynamic (read on call) so a host platform can toggle
 * `GALLEY_AI_OFF` or proxy URLs at runtime without restarting the server.
 */
import type { AiCreditsBalance, AiCreditsInfo, AiMetaInfo } from "../types";
import type { GalleySettingsService } from "./settings";

/** Default value of one AI credit in millicents (250 = $0.0025; 400 credits = $1). */
export const DEFAULT_AI_CREDIT_MILLICENTS = 250;
const AI_CREDITS_TIMEOUT_MS = 5000;

export interface ManagedAiConfig {
  managed: boolean;
  creditMillicents: number;
  disabled: boolean;
  creditsUrl: string | null;
  manageUrl: string | null;
}

function truthy(value: string | undefined): boolean {
  if (!value) return false;
  const clean = value.trim().toLowerCase();

  return clean === "1" || clean === "true";
}

function parseCreditMillicents(value: string | undefined): number {
  if (!value) return DEFAULT_AI_CREDIT_MILLICENTS;
  const parsed = Number(value.trim());

  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_AI_CREDIT_MILLICENTS;
}

/**
 * Converts a USD cost to whole AI credits, rounding up.
 * Non-positive or non-finite values yield 0; any positive value yields at least 1.
 */
export function creditsFromUsd(usd: number, creditMillicents = DEFAULT_AI_CREDIT_MILLICENTS): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  const unit = Number.isInteger(creditMillicents) && creditMillicents > 0 ? creditMillicents : DEFAULT_AI_CREDIT_MILLICENTS;
  const millicents = Math.round(usd * 100_000);

  if (millicents <= 0) return 1;
  return Math.ceil(millicents / unit);
}

/** Plain http is taken only for this computer itself (a local or test gateway). */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * GALLEY_AI_CREDITS_URL and GALLEY_AI_MANAGE_URL as an address that is safe to use, or null: `https://`, or plain
 * `http://` to this computer itself, with no name and password in it. The credits address is sent the install's
 * assistant key, which must never cross a network unencrypted; the manage address becomes a link, which must never be
 * `javascript:` or another scheme. Anything else, or an address that doesn't parse, counts as not set.
 */
export function safeAiUrl(value: string | undefined): string | null {
  const text = value?.trim();

  if (!text) return null;
  let url: URL;

  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  // Checked, then kept as it was written (URL's own form would add a "/" to a bare address).
  if (url.protocol === "https:") return text;
  if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)) return text;
  return null;
}

/** Reads managed AI settings from `env` (default `process.env`) dynamically. */
export function readManagedAiConfig(env: NodeJS.ProcessEnv = process.env): ManagedAiConfig {
  const managed = truthy(env.GALLEY_AI_MANAGED);
  const creditMillicents = parseCreditMillicents(env.GALLEY_AI_CREDIT_MILLICENTS);
  const disabled = truthy(env.GALLEY_AI_OFF);
  const creditsUrl = safeAiUrl(env.GALLEY_AI_CREDITS_URL);
  const manageUrl = safeAiUrl(env.GALLEY_AI_MANAGE_URL);

  return { managed, creditMillicents, disabled, creditsUrl, manageUrl };
}

/** Public metadata exposed on `GET /api/meta`. Undefined when managed mode is off. */
export function aiMetaFromEnv(env: NodeJS.ProcessEnv = process.env): AiMetaInfo | undefined {
  const config = readManagedAiConfig(env);

  if (!config.managed) return undefined;
  return {
    managed: true,
    creditMillicents: config.creditMillicents,
    ...(config.disabled ? { disabled: true } : {}),
    ...(config.manageUrl ? { manageUrl: config.manageUrl } : {}),
  };
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseCreditsBalance(raw: unknown): AiCreditsBalance | null {
  if (!raw || typeof raw !== "object") return null;
  const root = raw as Record<string, unknown>;
  const source =
    root.balance && typeof root.balance === "object"
      ? (root.balance as Record<string, unknown>)
      : root.credits && typeof root.credits === "object"
        ? (root.credits as Record<string, unknown>)
        : root;
  const usedCredits = nonNegativeNumber(source.usedCredits);
  const includedCredits = nonNegativeNumber(source.includedCredits);
  const topUpCredits = nonNegativeNumber(source.topUpCredits);
  const leftCredits = nonNegativeNumber(source.leftCredits);
  const changesLeft = nonNegativeNumber(source.changesLeft);
  const state = source.state;

  if (
    usedCredits === null ||
    includedCredits === null ||
    topUpCredits === null ||
    leftCredits === null ||
    changesLeft === null ||
    (state !== "ok" && state !== "warn80" && state !== "paused")
  ) {
    return null;
  }
  const renewsAt = typeof source.renewsAt === "string" ? source.renewsAt : null;
  let siteLimit: { limitCredits: number; usedCredits: number } | null | undefined;

  if (source.siteLimit === null) siteLimit = null;
  else if (source.siteLimit && typeof source.siteLimit === "object") {
    const limit = source.siteLimit as Record<string, unknown>;
    const limitCredits = nonNegativeNumber(limit.limitCredits);
    const siteUsed = nonNegativeNumber(limit.usedCredits);

    if (limitCredits !== null && siteUsed !== null) siteLimit = { limitCredits, usedCredits: siteUsed };
  }
  return {
    usedCredits,
    includedCredits,
    topUpCredits,
    leftCredits,
    changesLeft,
    state,
    renewsAt,
    ...(siteLimit !== undefined ? { siteLimit } : {}),
  };
}

/**
 * Fetches live managed AI credits from `GALLEY_AI_CREDITS_URL` using the configured
 * assistant bearer token. Lives in `@galley/core` so HTTP routes never touch secrets directly.
 */
export async function fetchManagedAiCredits(
  settings: Pick<GalleySettingsService, "readSecret">,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AiCreditsInfo> {
  const config = readManagedAiConfig(env);
  const base = {
    managed: config.managed,
    disabled: config.disabled,
    creditMillicents: config.creditMillicents,
    ...(config.manageUrl ? { manageUrl: config.manageUrl } : {}),
  };

  if (!config.managed || config.disabled || !config.creditsUrl) return { ...base, balance: null };
  const token = await settings.readSecret("anthropic").catch(() => null);

  if (!token) return { ...base, balance: null };
  try {
    const response = await fetchImpl(config.creditsUrl, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      // The key goes to this address alone: a redirect elsewhere is refused, never followed with it.
      redirect: "error",
      signal: AbortSignal.timeout(AI_CREDITS_TIMEOUT_MS),
    });

    if (!response.ok) return { ...base, balance: null };
    const body: unknown = await response.json().catch(() => null);

    return { ...base, balance: parseCreditsBalance(body) };
  } catch {
    return { ...base, balance: null };
  }
}
