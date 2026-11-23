/**
 * Deploy failures: one sentence that says what happened and what to do, a
 * stable `reason` the UI can choose its next step from, and nothing secret —
 * every message and detail is scrubbed of the host's access key, wherever it
 * came from (a host can echo the Authorization header back in an error body).
 */
import { scrubSecrets } from "../ai/errors";
import { GalleyError } from "../errors";
import type { GalleyErrorShape } from "../types";

export type DeployReason =
  /** The key was refused outright. */
  | "unauthorized"
  /** The key works but lacks a permission. */
  | "permission"
  /** No key stored or in the environment. */
  | "no-key"
  /** The project name belongs to someone else, or is malformed. */
  | "taken"
  /** The site's own build failed. */
  | "build"
  /** The build left no output folder, or an empty one. */
  | "no-output"
  /** Over the host's file-count or size limits. */
  | "too-large"
  /** A file of the site the host reads (vercel.json) can't be read. */
  | "site-file"
  /** An address for the site's own domain can't be used as asked. */
  | "domain"
  /** This computer can't reach the host. */
  | "offline"
  | "rate-limited"
  /** Nothing has been published yet, so there is nothing to put live. */
  | "unpublished"
  /** The host account needs a one-time step in its dashboard. */
  | "account-setup"
  /** The site isn't set up to go online yet. */
  | "not-set-up"
  | "busy"
  /** The host answered with something else. */
  | "host";

const CODE: Record<DeployReason, GalleyErrorShape["code"]> = {
  unauthorized: "unauthorized",
  permission: "forbidden",
  "no-key": "unconfigured",
  taken: "conflict",
  build: "invalid",
  "no-output": "invalid",
  "too-large": "invalid",
  "site-file": "invalid",
  domain: "invalid",
  offline: "internal",
  "rate-limited": "busy",
  unpublished: "invalid",
  "account-setup": "unconfigured",
  "not-set-up": "unconfigured",
  busy: "busy",
  host: "internal",
};

export class DeployError extends GalleyError {
  readonly reason: DeployReason;

  constructor(reason: DeployReason, message: string, detail?: string) {
    super(CODE[reason], message, detail);
    this.name = "DeployError";
    this.reason = reason;
  }
}

/**
 * A 401 from the session check means "sign in again" to the UI; a host
 * refusing the key must not look like that. The route layer sends `unauthorized`
 * deploy errors as 400 by turning them into this code.
 */
export function shapeForHttp(error: DeployError): GalleyError {
  return error.code === "unauthorized" ? new GalleyError("unconfigured", error.message, error.detail) : error;
}

/** Cuts every known secret, plus `extra` values, out of a piece of text. */
export function scrub(text: string, extra: Array<string | null | undefined> = []): string {
  let out = text;

  for (const value of extra) if (value && value.length >= 8) out = out.split(value).join("[redacted]");
  // Bearer headers echoed back, whatever the value looks like.
  out = out.replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"',}]+/gi, "$1[redacted]");
  out = out.replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, "$1[redacted]");
  return scrubSecrets(out);
}

/** The same error with every secret cut out of its message and detail. */
export function scrubError(error: unknown, extra: Array<string | null | undefined> = []): DeployError {
  if (error instanceof DeployError) {
    return new DeployError(error.reason, scrub(error.message, extra), error.detail === undefined ? undefined : scrub(error.detail, extra));
  }
  if (error instanceof GalleyError) {
    const reason: DeployReason = error.code === "busy" ? "busy" : error.code === "unconfigured" ? "not-set-up" : "host";

    return new DeployError(reason, scrub(error.message, extra), error.detail === undefined ? undefined : scrub(error.detail, extra));
  }
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  return new DeployError("host", "Putting the site online stopped unexpectedly. Nothing on the live site changed. Try again.", scrub(detail, extra).slice(0, 4000));
}
