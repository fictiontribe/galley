import type { GalleyErrorShape } from "./types";

const STATUS: Record<GalleyErrorShape["code"], number> = {
  "not-found": 404,
  unauthorized: 401,
  conflict: 409,
  forbidden: 403,
  invalid: 400,
  git: 500,
  preview: 500,
  ai: 502,
  unconfigured: 400,
  busy: 409,
  internal: 500,
};

/**
 * The one error class the engine throws on purpose. `message` is written for
 * the person using the app — plain words, no stack traces, no git jargon;
 * `detail` carries the technical cause for logs.
 */
export class GalleyError extends Error {
  readonly code: GalleyErrorShape["code"];
  readonly detail?: string;
  readonly status: number;

  constructor(code: GalleyErrorShape["code"], message: string, detail?: string) {
    super(message);
    this.name = "GalleyError";
    this.code = code;
    this.detail = detail;
    this.status = STATUS[code];
  }

  toJSON(): GalleyErrorShape {
    return { code: this.code, message: this.message, detail: this.detail, status: this.status };
  }
}

export function isGalleyError(value: unknown): value is GalleyError {
  return value instanceof GalleyError;
}

/** Wraps anything thrown into a GalleyError without losing a deliberate one. */
export function toGalleyError(value: unknown, fallback = "Something went wrong."): GalleyError {
  if (isGalleyError(value)) return value;
  const detail = value instanceof Error ? (value.stack ?? value.message) : String(value);

  return new GalleyError("internal", fallback, detail);
}
