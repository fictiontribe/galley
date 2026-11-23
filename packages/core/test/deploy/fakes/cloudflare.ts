/**
 * Fake Cloudflare: the Workers static-assets Direct Upload protocol, the
 * script and versions uploads, the Workers API create call, accounts and
 * workers.dev subdomains — strict about every documented step.
 */
import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import { startFake, type FakeReply, type FakeServer } from "./common";

export interface CfDeployment {
  kind: "production" | "preview";
  script: string;
  id: string;
  /** path → bytes, for every file the version serves. */
  files: Map<string, Buffer>;
  metadata: any;
  moduleType: string | null;
  /** The assets config the version was given (html_handling, not_found_handling, _redirects, _headers). */
  config: Record<string, unknown>;
}

export interface FakeCloudflare extends FakeServer {
  /** The API base to give the engine: `${url}/client/v4`. */
  api: string;
  token: string;
  scripts: Map<string, { subdomain: boolean; previews: boolean }>;
  deployments: CfDeployment[];
  /** Hashes whose bytes the fake holds. */
  stored: Map<string, Buffer>;
  /** How many file parts were uploaded in total. */
  uploadedParts: number;
}

export interface FakeCloudflareOptions {
  token?: string;
  accounts?: Array<{ id: string; name: string }>;
  subdomain?: string | null;
  /** The key works but can't touch Workers (403, code 10000). */
  noWorkersPermission?: boolean;
  /** GET /accounts answers 403 (the key has no Account Settings › Read). */
  hideAccounts?: boolean;
  bucketSize?: number;
  /** Echo the Authorization header back in error bodies, like a careless host. */
  echoAuth?: boolean;
  port?: number;
}

const ok = (result: unknown, status = 200): FakeReply => ({ status, body: { success: true, errors: [], messages: [], result } });
const fail = (status: number, code: number, message: string): FakeReply => ({ status, body: { success: false, errors: [{ code, message }], messages: [], result: null } });

export function cfHashOf(base64: string, path: string): string {
  return createHash("sha256").update(base64 + extname(path).slice(1)).digest("hex").slice(0, 32);
}

export async function startFakeCloudflare(options: FakeCloudflareOptions = {}): Promise<FakeCloudflare> {
  const token = options.token ?? "cf-test-token-0123456789abcdefghijklmnop";
  const accounts = options.accounts ?? [{ id: "acc0123456789abcdef0123456789abc", name: "Studio account" }];
  const subdomain = options.subdomain === undefined ? "studio" : options.subdomain;
  const bucketSize = options.bucketSize ?? 4;
  const stored = new Map<string, Buffer>();
  const scripts = new Map<string, { subdomain: boolean; previews: boolean }>();
  const sessions = new Map<string, { account: string; script: string; manifest: Record<string, { hash: string; size: number }>; needed: Set<string> }>();
  const completions = new Map<string, { script: string; manifest: Record<string, { hash: string; size: number }> }>();
  const deployments: CfDeployment[] = [];
  let uploadedParts = 0;

  const accountOk = (id: string | undefined) => accounts.some((account) => account.id === id);

  const server = await startFake(
    async (request) => {
      const path = request.url.pathname.replace(/^\/client\/v4/, "");
      const parts = path.split("/").filter(Boolean);
      const echo = options.echoAuth ? ` (sent: ${request.headers.authorization ?? ""})` : "";

      // ── the upload endpoint authenticates with the session jwt, nothing else
      if (request.method === "POST" && parts[0] === "accounts" && parts[2] === "workers" && parts[3] === "assets" && parts[4] === "upload") {
        const session = request.bearer ? sessions.get(request.bearer) : undefined;

        if (!session) return fail(401, 10000, `Authentication error: the upload needs the upload session's jwt${echo}`);
        if (session.account !== parts[1]) return fail(403, 10000, "wrong account for this upload session");
        if (request.url.searchParams.get("base64") !== "true") return fail(400, 10001, "base64=true is required");
        if (!String(request.headers["content-type"] ?? "").startsWith("multipart/form-data")) return fail(400, 10001, "multipart/form-data required");
        const form = await request.form();

        for (const [hash, value] of form.entries()) {
          if (!session.needed.has(hash)) return fail(400, 10001, `hash ${hash} wasn't asked for`);
          if (typeof value === "string") return fail(400, 10001, `part ${hash} must be a file part`);
          const base64 = await value.text();
          const paths = Object.entries(session.manifest).filter(([, entry]) => entry.hash === hash).map(([at]) => at);

          if (!paths.some((at) => cfHashOf(base64, at) === hash)) return fail(400, 10001, `hash mismatch for ${hash}`);
          const bytes = Buffer.from(base64, "base64");

          if (Buffer.from(bytes).toString("base64") !== base64) return fail(400, 10001, `part ${hash} isn't base64`);
          if (paths.some((at) => session.manifest[at]!.size !== bytes.byteLength)) return fail(400, 10001, `size mismatch for ${hash}`);
          stored.set(hash, bytes);
          session.needed.delete(hash);
          uploadedParts += 1;
        }
        if (session.needed.size === 0) {
          const jwt = `completion-${randomUUID()}`;

          completions.set(jwt, { script: session.script, manifest: session.manifest });
          sessions.delete(request.bearer!);
          return ok({ jwt }, 201);
        }
        return ok({});
      }

      // ── everything else authenticates with the account key
      if (request.bearer !== token) return fail(400, 9109, `Invalid access token${echo}`);
      if (parts[0] !== "accounts") return fail(404, 7003, "No route for that URI");
      if (parts.length === 1 && request.method === "GET") {
        return options.hideAccounts ? fail(403, 10000, "Authentication error") : ok(accounts);
      }
      const account = parts[1];

      if (!accountOk(account)) return fail(403, 10000, "Authentication error");
      if (options.noWorkersPermission && parts[2] === "workers") return fail(403, 10000, `Authentication error${echo}`);
      const rest = parts.slice(2).join("/");

      if (request.method === "GET" && rest === "workers/subdomain") return subdomain ? ok({ subdomain }) : fail(404, 10007, "This account doesn't have a workers.dev subdomain");
      if (request.method === "GET" && rest === "workers/scripts") return ok([...scripts.keys()].map((id) => ({ id })));
      if (request.method === "POST" && rest === "workers/workers") {
        const body = request.json<{ name?: string; subdomain?: { enabled?: boolean; previews_enabled?: boolean } }>();

        if (!body?.name) return fail(400, 10021, "name is required");
        if (scripts.has(body.name)) return fail(409, 10014, "A Worker with that name already exists");
        scripts.set(body.name, { subdomain: Boolean(body.subdomain?.enabled), previews: Boolean(body.subdomain?.previews_enabled) });
        return ok({ id: `w-${body.name}`, name: body.name });
      }
      const script = parts[4];

      if (parts[2] === "workers" && parts[3] === "scripts" && script) {
        const tail = parts.slice(5).join("/");

        if (request.method === "POST" && tail === "assets-upload-session") {
          if (!String(request.headers["content-type"] ?? "").startsWith("application/json")) return fail(400, 10001, "content-type must be application/json");
          const body = request.json<{ manifest?: Record<string, { hash: string; size: number }> }>();

          if (!body?.manifest || typeof body.manifest !== "object" || Object.keys(body.manifest).length === 0) return fail(400, 10001, "manifest is required");
          for (const [at, entry] of Object.entries(body.manifest)) {
            if (!at.startsWith("/")) return fail(400, 10001, `manifest path ${at} must start with /`);
            // Served as a plain file, a routing file would apply no rule: it belongs in assets.config.
            if (at === "/_redirects" || at === "/_headers") return fail(400, 10001, `${at.slice(1)} must be passed in assets.config, not uploaded as an asset`);
            if (!/^[0-9a-f]{32}$/.test(entry?.hash ?? "") || typeof entry.size !== "number") return fail(400, 10001, `bad manifest entry for ${at}`);
          }
          const missing = [...new Set(Object.values(body.manifest).map((entry) => entry.hash))].filter((hash) => !stored.has(hash));
          const buckets: string[][] = [];

          for (let at = 0; at < missing.length; at += bucketSize) buckets.push(missing.slice(at, at + bucketSize));
          const jwt = `session-${randomUUID()}`;

          if (missing.length === 0) completions.set(jwt, { script, manifest: body.manifest });
          else sessions.set(jwt, { account: account!, script, manifest: body.manifest, needed: new Set(missing) });
          return ok({ jwt, buckets });
        }
        if (request.method === "POST" && tail === "subdomain") {
          const body = request.json<{ enabled?: boolean; previews_enabled?: boolean }>();
          const known = scripts.get(script);

          if (!known) return fail(404, 10007, "Worker not found");
          known.subdomain = Boolean(body?.enabled);
          known.previews = Boolean(body?.previews_enabled);
          return ok({ enabled: known.subdomain, previews_enabled: known.previews });
        }
        const production = request.method === "PUT" && tail === "";
        const preview = request.method === "POST" && tail === "versions";

        if (production || preview) {
          if (preview && !scripts.has(script)) return fail(404, 10007, "Worker not found");
          const form = await request.form();
          const metadataPart = form.get("metadata");

          if (!metadataPart) return fail(400, 10021, "metadata part is required");
          const metadata = JSON.parse(typeof metadataPart === "string" ? metadataPart : await metadataPart.text());

          if (!metadata.main_module) return fail(400, 10021, "main_module is required");
          const module = form.get(metadata.main_module);

          if (!module || typeof module === "string") return fail(400, 10021, `the main module ${metadata.main_module} is missing`);
          if (module.type !== "application/javascript+module") return fail(400, 10021, "module parts must be application/javascript+module");
          for (const key of ["_redirects", "_headers"]) {
            const value = metadata.assets?.config?.[key];

            if (value !== undefined && typeof value !== "string") return fail(400, 10021, `assets.config.${key} must be the file's text`);
          }
          const completion = completions.get(metadata.assets?.jwt ?? "");

          if (!completion || completion.script !== script) return fail(400, 10021, "assets.jwt isn't a completion token for this Worker");
          const files = new Map<string, Buffer>();

          for (const [at, entry] of Object.entries(completion.manifest)) {
            const bytes = stored.get(entry.hash);

            if (!bytes) return fail(400, 10021, `asset ${at} was never uploaded`);
            files.set(at.slice(1), bytes);
          }
          if (!scripts.has(script)) scripts.set(script, { subdomain: false, previews: false });
          const id = randomUUID();

          deployments.push({ kind: production ? "production" : "preview", script, id, files, metadata, moduleType: module.type, config: { ...(metadata.assets?.config ?? {}) } });
          return production ? ok({ id: script, etag: `etag-${id}`, deployment_id: id, has_assets: true }) : ok({ id, number: deployments.length, metadata: { hasPreview: true } });
        }
      }
      return fail(404, 7003, `No route for ${request.method} ${path}`);
    },
    (bearer) => (bearer === null ? "none" : bearer === token ? "account" : bearer.startsWith("session-") ? "upload" : "other"),
    options.port
  );

  return {
    ...server,
    api: `${server.url}/client/v4`,
    token,
    scripts,
    deployments,
    stored,
    get uploadedParts() {
      return uploadedParts;
    },
  };
}
