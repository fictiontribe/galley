/**
 * The host's own file, derived from the list and never edited by hand:
 * `_redirects` in the site's public folder (Cloudflare, Netlify) or the
 * `redirects` array of vercel.json (a surgical JSON edit: every other byte of
 * the file stays as it was).
 *
 * Before replacing it, this decides whether that is safe. A `_redirects`
 * file this app wrote carries a checksum of its own body; when the body no
 * longer matches, someone edited it by hand, and it is never overwritten
 * without asking. vercel.json can't carry a comment, so the last array this
 * computer wrote is remembered in the site's state folder instead.
 */
import { createHash } from "node:crypto";
import type { DataOp } from "../content/edit/expected";
import { applyJsonOp } from "../content/edit/json";
import { deepEqual } from "../content/util/json";
import type { JsonValue } from "../types";
import { checksum, readGeneratedHeader, renderRedirectsFile, renderVercelRedirects } from "./generate";
import type { GeneratedHost } from "./locate";
import type { DerivedState, Redirect } from "./types";

export { derivedPath, isGeneratedHost, publicDir } from "./locate";

export const VERCEL_SCHEMA = "https://openapi.vercel.sh/vercel.json";

export function vercelHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? [])).digest("hex").slice(0, 16);
}

export interface DerivedInput {
  host: GeneratedHost;
  path: string;
  /** The file's text now, or null when it doesn't exist. */
  current: string | null;
  list: Redirect[];
  listFile: string;
  /** Netlify: old addresses that are live pages are forced. */
  force?: (from: string) => boolean;
  /** vercel.json: the hash of the last redirects array this computer wrote. */
  lastWritten?: string | null;
}

export interface DerivedPlan {
  host: GeneratedHost;
  path: string;
  state: DerivedState;
  current: string | null;
  /** The file as the list would make it. null: nothing to write (an empty list and no file). */
  next: string | null;
  /** A short reason when the file can't be edited safely at all (vercel.json that isn't valid JSON). */
  problem?: string;
  /** vercel.json: hash of the array `next` holds, to remember once written. */
  writtenHash?: string;
}

export function planDerived(input: DerivedInput): DerivedPlan {
  return input.host === "vercel" ? planVercel(input) : planRedirectsFile(input);
}

function planRedirectsFile(input: DerivedInput): DerivedPlan {
  const host = input.host as "cloudflare" | "netlify";
  const next = input.current === null && input.list.length === 0 ? null : renderRedirectsFile(input.list, host, { listFile: input.listFile, ...(input.force ? { force: input.force } : {}) });
  const base = { host: input.host, path: input.path, current: input.current, next };

  if (input.current === null) return { ...base, state: "missing" };
  if (next !== null && input.current === next) return { ...base, state: "in-step" };
  const header = readGeneratedHeader(input.current);

  if (!header) return { ...base, state: input.current.trim() === "" ? "stale" : "foreign" };
  return { ...base, state: checksum(header.body) === header.checksum ? "stale" : "hand-edited" };
}

function planVercel(input: DerivedInput): DerivedPlan {
  const generated = renderVercelRedirects(input.list) as unknown as JsonValue;
  const writtenHash = vercelHash(generated);
  const base = { host: input.host, path: input.path, current: input.current, writtenHash };

  if (input.current === null) {
    if (input.list.length === 0) return { ...base, state: "missing", next: null };
    const seed = `{\n  "$schema": "${VERCEL_SCHEMA}"\n}\n`;
    const outcome = applyJsonOp(seed, { op: "set", path: ["redirects"], value: generated }, false);

    return { ...base, state: "missing", next: outcome.ok ? outcome.text : null };
  }
  let parsed: unknown;

  try {
    parsed = JSON.parse(input.current);
  } catch {
    return { ...base, state: "foreign", next: null, problem: "vercel.json has a formatting mistake, so its redirects can't be updated safely. Fix the file first." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ...base, state: "foreign", next: null, problem: "vercel.json doesn't hold a set of settings, so its redirects can't be updated safely." };
  const existing = (parsed as Record<string, unknown>).redirects;
  const empty = existing === undefined || (Array.isArray(existing) && existing.length === 0);
  const op: DataOp | null = input.list.length === 0 ? (existing === undefined ? null : { op: "unset", path: ["redirects"] }) : { op: "set", path: ["redirects"], value: generated };
  const outcome = op ? applyJsonOp(input.current, op, false) : { ok: true as const, text: input.current, changed: false };
  const next = outcome.ok ? outcome.text : null;

  if (input.list.length === 0 ? existing === undefined : deepEqual(existing as JsonValue, generated)) return { ...base, state: "in-step", next };
  if (empty) return { ...base, state: "stale", next };
  if (input.lastWritten && vercelHash(existing) === input.lastWritten) return { ...base, state: "stale", next };
  return { ...base, state: input.lastWritten ? "hand-edited" : "foreign", next };
}

/** Whether the plan may be written without asking. */
export function safeToWrite(plan: DerivedPlan): boolean {
  return plan.next !== null && (plan.state === "missing" || plan.state === "stale");
}
