import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { GalleyError, isGalleyError } from "@galley/core";
import type { GalleyErrorShape } from "@galley/core/types";

/** Per brand/voice.md: what didn't happen and what to do — no "we", no "something went wrong". */
export const INTERNAL_MESSAGE = "That couldn't be done because of an unexpected problem. Try again.";

export function invalid(message: string, detail?: string): GalleyError {
  return new GalleyError("invalid", message, detail);
}

export function notFound(message: string): GalleyError {
  return new GalleyError("not-found", message);
}

export function forbidden(message: string): GalleyError {
  return new GalleyError("forbidden", message);
}

/** Thrown for 401: no session, a session that ended, or a sign-in that didn't work. Travels as `unauthorized`. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** Thrown for 429. */
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

export function errorBody(code: GalleyErrorShape["code"], message: string, detail?: string): { error: GalleyErrorShape } {
  return { error: detail ? { code, message, detail } : { code, message } };
}

/**
 * Details are shown behind "Technical details" in the UI, so they may carry
 * a git message or a validation list — but never a stack trace.
 */
function safeDetail(error: GalleyError): string | undefined {
  if (!error.detail || error.code === "internal") return undefined;
  if (/\n\s+at\s/.test(error.detail)) return undefined;
  return error.detail;
}

export function errorResponse(c: Context, error: unknown, log: (line: string) => void): Response {
  if (isGalleyError(error)) {
    // A failure of the server's own, not something the person did: one line, with its technical cause, for whoever runs it.
    if (error.code === "internal") {
      const cause = error.detail ? (error.detail.includes("\n") ? `\n${error.detail}` : ` (${error.detail})`) : "";

      log(`${c.req.method} ${new URL(c.req.url).pathname} failed: ${error.message}${cause}`);
    }
    return c.json(errorBody(error.code, error.message, safeDetail(error)), error.status as ContentfulStatusCode);
  }
  if (error instanceof AuthError) return c.json(errorBody("unauthorized", error.message), 401);
  if (error instanceof RateLimitError) return c.json(errorBody("busy", error.message), 429);
  if (error instanceof HTTPException) {
    if (error.status === 413) return c.json(errorBody("invalid", "That's too much to send in one go. The limit is 40 MB."), 413);
    if (error.status < 500) return c.json(errorBody("invalid", "That request couldn't be read. Check it and try again."), error.status as ContentfulStatusCode);
  }
  const stack = error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);

  // The time is added where the line is written (log.ts), like every other line's.
  // The system's own code for it (ENOSPC, EMFILE, …), when it has one, says more than the stack does.
  const code = typeof (error as NodeJS.ErrnoException | null)?.code === "string" ? ` (${(error as NodeJS.ErrnoException).code})` : "";

  log(`${c.req.method} ${new URL(c.req.url).pathname} failed${code}:\n${stack}`);
  return c.json(errorBody("internal", INTERNAL_MESSAGE), 500);
}
