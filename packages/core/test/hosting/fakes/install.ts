/**
 * A small fake hosted install, as the app that creates one sees it — the
 * three calls and nothing else:
 *   GET  /healthz              200 once it is up, on any hostname
 *   GET  /readyz               { ready, state }, only for the editor's hostname
 *   POST /api/setup/handover   only for the editor's hostname, with
 *                              `Authorization: Bearer <code>` whose SHA-256 is
 *                              the one it was started with; strict about the
 *                              SetupHandover shape
 * Every handover it accepted is kept, so a test can see exactly what was sent.
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeInstall {
  url: string;
  port: number;
  /** Every handover accepted, as sent. */
  handovers: any[];
  /** Every request, as "METHOD /path host". */
  log: string[];
  /** Answer at all (false: every call is a 503, like a machine still booting). */
  up: boolean;
  /** "setup" until first run is finished, then "ready". */
  state: "starting" | "setup" | "ready";
  close(): Promise<void>;
}

const KNOWN = new Set(["site", "author", "liveUrl", "keys"]);

export async function startFakeInstall(options: { editor: string; hash: () => string | null | undefined; up?: boolean; port?: number }): Promise<FakeInstall> {
  const install: Omit<FakeInstall, "url" | "port" | "close"> = { handovers: [], log: [], up: options.up ?? true, state: "setup" };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const host = String(req.headers.host ?? "").replace(/:\d+$/, "");
      const path = new URL(req.url ?? "/", "http://install.local").pathname;
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };

      install.log.push(`${req.method} ${path} ${host}`);
      if (!install.up) return send(503, { error: { message: "starting" } });
      if (path === "/healthz" && req.method === "GET") return send(200, { ok: true });
      // The DNS-rebinding guard: anything else only for the editor's own name.
      if (host !== options.editor) return send(421, { error: { code: "forbidden", message: "This server doesn't answer to that address." } });
      if (path === "/readyz" && req.method === "GET") return send(install.state === "starting" ? 503 : 200, { ready: install.state === "ready", state: install.state });
      if (path === "/api/setup/handover" && req.method === "POST") {
        const code = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ""))?.[1];
        const expected = options.hash();

        if (!code || !expected || createHash("sha256").update(code).digest("hex") !== expected) return send(401, { error: { code: "unauthorized", message: "That setup link isn't right." } });
        if (install.state !== "setup") return send(409, { error: { code: "conflict", message: "First run is already finished." } });
        let body: any;

        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return send(400, { error: { code: "invalid", message: "The request couldn't be read." } });
        }
        const unknown = Object.keys(body ?? {}).filter((key) => !KNOWN.has(key));

        if (unknown.length) return send(400, { error: { code: "invalid", message: `“${unknown.join("”, “")}” isn't expected here.` } });
        if (body.site && (typeof body.site.repository !== "string" || (body.site.access && !["deploy-key", "token"].includes(body.site.access)))) return send(400, { error: { code: "invalid", message: "site.repository is missing." } });
        if (body.site && Object.keys(body.site).some((key) => !["repository", "branch", "access", "token", "folder"].includes(key))) return send(400, { error: { code: "invalid", message: "site has something unexpected." } });
        if (body.site?.folder !== undefined && (typeof body.site.folder !== "string" || body.site.folder.startsWith("/") || body.site.folder.endsWith("/") || body.site.folder.includes(".."))) {
          return send(400, { error: { code: "invalid", message: "site.folder must be a folder inside the repository." } });
        }
        install.handovers.push(body);
        return send(200, { step: "password" });
      }
      return send(404, { error: { code: "not-found", message: "Not found." } });
    });
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return Object.assign(install, {
    url: `http://127.0.0.1:${port}`,
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }) as FakeInstall;
}
