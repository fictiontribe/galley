/**
 * The three calls this app makes to an install it created, and nothing else:
 *   GET  /healthz              200 when the process is up, on any hostname
 *   GET  /readyz               ReadyStatus
 *   POST /api/setup/handover   Authorization: Bearer <setup code>, a SetupHandover
 *
 * Always addressed to the editor's own hostname: the install refuses other
 * hostnames. Tests and the rehearsal point the connection somewhere else
 * (GALLEY_HOSTING_INSTALL_API) while still naming the editor's hostname, which
 * `fetch` can't do (it sets Host itself) — so this uses node:http(s).
 */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { ReadyStatus, SetupHandover } from "../install/types";

export interface InstallTarget {
  /** The editor's hostname. */
  editor: string;
  /** Where to connect instead of https://<editor> (tests, the rehearsal). */
  origin?: string;
}

export interface InstallAnswer<T = unknown> {
  /** 0: no answer at all (refused, timed out, no such name). */
  status: number;
  body: T | null;
  /** Why there was no answer, for details. */
  error?: string;
}

const TIMEOUT_MS = 10_000;

export function installCall<T>(target: InstallTarget, method: string, path: string, init: { bearer?: string; json?: unknown; timeoutMs?: number } = {}): Promise<InstallAnswer<T>> {
  const base = new URL(target.origin || `https://${target.editor}`);
  const url = new URL(path, base);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  const body = init.json === undefined ? undefined : Buffer.from(JSON.stringify(init.json));

  return new Promise((resolve) => {
    const req = send(
      url,
      {
        method,
        headers: {
          host: target.editor,
          accept: "application/json",
          ...(init.bearer ? { authorization: `Bearer ${init.bearer}` } : {}),
          ...(body ? { "content-type": "application/json", "content-length": String(body.length) } : {}),
        },
        // The certificate is the editor's, whichever address the connection goes to.
        ...(url.protocol === "https:" ? { servername: target.editor } : {}),
        timeout: init.timeoutMs ?? TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;

        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size <= 256 * 1024) chunks.push(chunk);
        });
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: T | null = null;

          try {
            parsed = text ? (JSON.parse(text) as T) : null;
          } catch {
            parsed = null;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
        res.on("error", (error) => resolve({ status: 0, body: null, error: error.message }));
      }
    );

    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", (error) => resolve({ status: 0, body: null, error: `${error.name}: ${error.message}` }));
    if (body) req.write(body);
    req.end();
  });
}

export async function healthz(target: InstallTarget): Promise<boolean> {
  return (await installCall(target, "GET", "/healthz", { timeoutMs: 5000 })).status === 200;
}

export async function readyz(target: InstallTarget): Promise<ReadyStatus | null> {
  const answer = await installCall<ReadyStatus>(target, "GET", "/readyz", { timeoutMs: 5000 });

  // 503 carries the state too while the install is starting.
  return answer.body && typeof answer.body.state === "string" ? answer.body : null;
}

export function handover(target: InstallTarget, code: string, payload: SetupHandover): Promise<InstallAnswer<{ error?: { message?: string } }>> {
  return installCall(target, "POST", "/api/setup/handover", { bearer: code, json: payload, timeoutMs: 60_000 });
}
