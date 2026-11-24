/**
 * "Host the editor online" failures: one sentence that says what happened and
 * what to do, a stable `reason`, and nothing secret — every message and detail
 * is scrubbed of the hosts' keys and of the setup code with the deploy
 * module's scrubbing (a host can echo the Authorization header back).
 */
import { scrub } from "../deploy/errors";
import { GalleyError } from "../errors";
import type { GalleyErrorShape } from "../types";

export type HostingReason =
  /** The host refused the key outright. */
  | "unauthorized"
  /** The key works but lacks a permission. */
  | "permission"
  /** No key stored or in the environment. */
  | "no-key"
  /** Something typed can't be used (an address, a name, a plan that expired). */
  | "invalid"
  /** The name is taken on the host. */
  | "taken"
  /** Nothing recorded to act on. */
  | "not-found"
  /** Another create, upgrade or removal is running for this site. */
  | "busy"
  /** This computer can't reach the host. */
  | "offline"
  | "rate-limited"
  /** The host has no room for it right now (Fly.io: a region out of capacity). */
  | "capacity"
  /** The install was created but doesn't answer at its address yet. */
  | "unanswered"
  /** The host or the install answered with something else. */
  | "host";

const CODE: Record<HostingReason, GalleyErrorShape["code"]> = {
  unauthorized: "unauthorized",
  permission: "forbidden",
  "no-key": "unconfigured",
  invalid: "invalid",
  taken: "conflict",
  "not-found": "not-found",
  busy: "busy",
  offline: "internal",
  "rate-limited": "busy",
  capacity: "busy",
  unanswered: "internal",
  host: "internal",
};

export class HostingError extends GalleyError {
  readonly reason: HostingReason;

  constructor(reason: HostingReason, message: string, detail?: string) {
    super(CODE[reason], message, detail);
    this.name = "HostingError";
    this.reason = reason;
  }
}

/**
 * A 401 means "sign in again" to the UI; a host refusing a key must not look
 * like that, so the routes send it as a 400.
 */
export function shapeForHttp(error: HostingError): GalleyError {
  return error.code === "unauthorized" ? new GalleyError("unconfigured", error.message, error.detail) : error;
}

/**
 * Every value to cut out of text: each secret whole, and each part of one
 * (a Fly.io key is "FlyV1 " and comma-joined parts, any of which may be
 * echoed alone).
 */
export function secretParts(values: Iterable<string | null | undefined>): string[] {
  const out = new Set<string>();

  for (const value of values) {
    if (!value) continue;
    out.add(value);
    for (const part of value.split(/[\s,]+/)) if (part.length >= 8) out.add(part);
  }
  // Longest first, so a whole key is cut before any part of it.
  return [...out].sort((a, b) => b.length - a.length);
}

export function scrubText(text: string, secrets: Iterable<string | null | undefined>): string {
  return scrub(text, secretParts(secrets));
}

/** The same error with every secret cut out of its message and detail. */
export function scrubHostingError(error: unknown, secrets: Iterable<string | null | undefined>, fallback = "Putting the editor online stopped unexpectedly. Try again."): HostingError {
  const list = secretParts(secrets);
  const clean = (text: string | undefined) => (text === undefined ? undefined : scrub(text, list));

  if (error instanceof HostingError) return new HostingError(error.reason, clean(error.message)!, clean(error.detail));
  if (error instanceof GalleyError) {
    const reason: HostingReason = error.code === "busy" ? "busy" : error.code === "unconfigured" ? "no-key" : error.code === "invalid" ? "invalid" : error.code === "not-found" ? "not-found" : "host";

    return new HostingError(reason, clean(error.message)!, clean(error.detail));
  }
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  return new HostingError("host", fallback, clean(detail)!.slice(0, 4000));
}
