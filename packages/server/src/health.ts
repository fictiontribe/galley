/**
 * GET /healthz and GET /readyz, answered in front of everything else — the
 * Host check, the sign-in, the app itself — so they answer while the engine
 * is still being composed, and to a host's health prober that doesn't send
 * the public name. Nothing in them identifies the install: no version, no
 * name, no address.
 *
 *   /healthz  200 { ok: true } whenever the process serves.
 *   /readyz   ReadyStatus: 200 for "setup" and "ready", 503 for "starting" and "restoring".
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ReadyStatus } from "@galley/core/install";

export const HEALTH_PATH = "/healthz";
export const READY_PATH = "/readyz";

/** Answers a health request and returns true; returns false for anything else. */
export function answerHealth(req: IncomingMessage, res: ServerResponse, readiness: () => ReadyStatus): boolean {
  const path = (req.url ?? "/").split("?")[0];

  if (path !== HEALTH_PATH && path !== READY_PATH) return false;
  const headers = { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" };

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { ...headers, allow: "GET, HEAD" });
    res.end(JSON.stringify({ ok: false }));
    return true;
  }
  let status = 200;
  let body: unknown = { ok: true };

  if (path === READY_PATH) {
    const ready = readiness();

    status = ready.state === "setup" || ready.state === "ready" ? 200 : 503;
    body = { ready: status === 200, state: ready.state } satisfies ReadyStatus;
  }
  const text = JSON.stringify(body);

  res.writeHead(status, { ...headers, "content-length": Buffer.byteLength(text) });
  res.end(req.method === "HEAD" ? undefined : text);
  return true;
}
