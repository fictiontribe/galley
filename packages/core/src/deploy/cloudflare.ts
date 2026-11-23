/**
 * Cloudflare, through Workers static assets — what Cloudflare's docs now
 * recommend for new projects ("Start new projects with Workers"), and the one
 * Cloudflare static host with a documented REST upload that needs no git and
 * no wrangler. Plain `fetch`, no SDK.
 *
 * Protocol (developers.cloudflare.com/workers/static-assets/direct-upload/,
 * read 2026-11-23):
 *   1. POST /accounts/:a/workers/scripts/:name/assets-upload-session
 *      { manifest: { "/path": { hash, size } } } → { jwt, buckets }
 *      Every path the version needs, unchanged ones included. `hash` is 32 hex
 *      characters; we compute it the way the guide's sample does.
 *   2. Per bucket: POST /accounts/:a/workers/assets/upload?base64=true,
 *      `Authorization: Bearer <session jwt>` (not the account key),
 *      multipart/form-data with one part per hash holding the base64 bytes and
 *      the type the file is served with. The last upload answers 201 with the
 *      completion jwt; with no buckets the session jwt is the completion jwt.
 *   3. Production: PUT /accounts/:a/workers/scripts/:name (creates and
 *      deploys). Preview: POST …/scripts/:name/versions (uploads a version
 *      without deploying it; its preview address is
 *      <first 8 of version id>-<name>.<subdomain>.workers.dev). Both are
 *      multipart with a `metadata` part — `main_module` is required — whose
 *      `assets.jwt` is the completion jwt, plus the module itself.
 *      `_redirects` and `_headers` at the root of the output are left out of
 *      the manifest and sent as text in `assets.config` (see routing.ts).
 *
 * A Worker is created ahead of the first upload with the Workers API
 * (POST /accounts/:a/workers/workers, workers.dev and preview addresses on),
 * so a preview can be the very first thing shared. Addresses come from
 * GET /accounts/:a/workers/subdomain.
 */
import { readFile } from "node:fs/promises";
import { DeployError } from "./errors";
import { eachLimited, type DeployFile } from "./files";
import { describeResponse, hostRequest, type HostResponse, type RequestBody } from "./http";
import { CLOUDFLARE_CREDENTIALS, CLOUDFLARE_INFO, projectNameProblem } from "./info";
import { checkCloudflareHeaders, checkCloudflareRedirects } from "./routing";
import type { DeployContext, DeployTarget } from "./types";

export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const NAME = "Cloudflare";
/** The Worker module: everything is a static file, so it only hands misses to the asset handler (which serves 404.html). */
export const CLOUDFLARE_MODULE_NAME = "site.mjs";
export const CLOUDFLARE_MODULE = `// Serves the site's files. Requests for files are answered before this runs;
// anything else goes to the asset handler, which serves the site's 404 page.
export default {
  fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
`;
/** A fixed, past date: the runtime behaviour the module was written against. */
export const CLOUDFLARE_COMPATIBILITY_DATE = "2025-09-01";
const UPLOAD_PARALLEL = 3;
/** Files per upload request when the host's bucket is large: keeps each request well under body limits. */
const UPLOAD_CHUNK = 50;

interface CfEnvelope<T> {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: T;
}

const PERMISSION = "Edit the key on Cloudflare (My Profile › API Tokens): under Permissions add Account › Workers Scripts › Edit, and under Account Resources include this account. Then try again.";

function failure(response: HostResponse<CfEnvelope<unknown>>, method: string, path: string, doing: string): DeployError {
  const detail = describeResponse(method, path, response);
  const codes = (response.body?.errors ?? []).map((error) => error.code);

  // 403 (code 10000, "Authentication error") is a working key without this permission;
  // 401, or 9109/6003 ("Invalid access token"), is a key Cloudflare doesn't know.
  if (response.status === 401 || codes.includes(9109) || codes.includes(6003)) {
    return new DeployError("unauthorized", "Cloudflare didn't accept the access key. It may have been deleted or have expired. Create a new one and paste it here.", detail);
  }
  if (response.status === 403 || codes.includes(10000)) return new DeployError("permission", `Cloudflare didn't let the access key ${doing}. ${PERMISSION}`, detail);
  if (response.status === 429) return new DeployError("rate-limited", "Cloudflare is asking for a pause. Wait a minute, then try again. Nothing on the live site changed.", detail);
  const message = response.body?.errors?.[0]?.message;

  return new DeployError("host", `Cloudflare couldn't ${doing}${message ? `: “${message.slice(0, 200)}”` : ""}. Nothing on the live site changed. Try again in a moment.`, detail);
}

async function cf<T>(ctx: DeployContext, method: string, path: string, doing: string, init: { body?: RequestBody; json?: unknown; bearer?: string; query?: Record<string, string>; accept?: number[] } = {}): Promise<T> {
  const response = await hostRequest<CfEnvelope<T>>(ctx, NAME, {
    method,
    path,
    ...(init.query ? { query: init.query } : {}),
    ...(init.bearer ? { bearer: init.bearer } : {}),
    ...(init.json !== undefined ? { body: JSON.stringify(init.json), headers: { "content-type": "application/json" } } : init.body !== undefined ? { body: init.body } : {}),
  });

  if (!response.ok || response.body?.success === false) throw failure(response, method, path, doing);
  return (response.body?.result ?? (null as T)) as T;
}

async function cfStatus(ctx: DeployContext, method: string, path: string, init: { json?: unknown } = {}): Promise<HostResponse<CfEnvelope<unknown>>> {
  return hostRequest<CfEnvelope<unknown>>(ctx, NAME, {
    method,
    path,
    ...(init.json !== undefined ? { body: JSON.stringify(init.json), headers: { "content-type": "application/json" } } : {}),
  });
}

const scriptPath = (account: string, name: string) => `accounts/${encodeURIComponent(account)}/workers/scripts/${encodeURIComponent(name)}`;

async function accountSubdomain(ctx: DeployContext, account: string): Promise<string> {
  const path = `accounts/${encodeURIComponent(account)}/workers/subdomain`;
  const response = await cfStatus(ctx, "GET", path);
  const subdomain = (response.body?.result as { subdomain?: string } | undefined)?.subdomain;

  if (response.ok && subdomain) return subdomain;
  if (response.ok || response.status === 404) {
    throw new DeployError(
      "account-setup",
      "This Cloudflare account doesn't have a workers.dev address yet. Open Workers & Pages in the Cloudflare dashboard once — it asks you to choose one — then try again.",
      describeResponse("GET", path, response)
    );
  }
  throw failure(response, "GET", path, "read the account's workers.dev address");
}

async function scriptNames(ctx: DeployContext, account: string): Promise<Set<string>> {
  const scripts = await cf<Array<{ id?: string }>>(ctx, "GET", `accounts/${encodeURIComponent(account)}/workers/scripts`, "list the Workers in this account");

  return new Set((scripts ?? []).map((script) => script.id ?? "").filter(Boolean));
}

function productionAddress(name: string, subdomain: string): string {
  return `https://${name}.${subdomain}.workers.dev`;
}

function workerForm(metadata: Record<string, unknown>): FormData {
  const form = new FormData();

  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata.json");
  form.append(CLOUDFLARE_MODULE_NAME, new Blob([CLOUDFLARE_MODULE], { type: "application/javascript+module" }), CLOUDFLARE_MODULE_NAME);
  return form;
}

export function createCloudflareTarget(): DeployTarget {
  return {
    id: "cloudflare",
    name: NAME,
    apiBase: CLOUDFLARE_API,
    credentials: CLOUDFLARE_CREDENTIALS,
    info: CLOUDFLARE_INFO,

    async connect(ctx) {
      const response = await hostRequest<CfEnvelope<Array<{ id?: string; name?: string }>>>(ctx, NAME, { path: "accounts", query: { per_page: "50" } });

      // 403: a working key without Account Settings › Read. It can still deploy;
      // the account ID is typed instead of picked (checkProject proves the key then).
      if (response.status === 403) return { accounts: [] };
      if (!response.ok || response.body?.success === false) throw failure(response, "GET", "accounts", "list your accounts");
      return { accounts: (response.body?.result ?? []).filter((account) => account.id).map((account) => ({ id: account.id!, name: account.name?.trim() || account.id! })) };
    },

    async checkProject(ctx, { account, name }) {
      const problem = projectNameProblem(name);

      if (problem) return { name, available: false, existing: false, message: problem };
      const [names, subdomain] = await Promise.all([scriptNames(ctx, account), accountSubdomain(ctx, account)]);
      const existing = names.has(name);

      return {
        name,
        available: true,
        existing,
        productionUrl: productionAddress(name, subdomain),
        ...(existing ? { message: `There's already a Worker called “${name}” in this account. Putting the site there replaces what it serves.` } : {}),
      };
    },

    async ensureProject(ctx, { account, name }) {
      const problem = projectNameProblem(name);

      if (problem) throw new DeployError("taken", problem, name);
      const [names, subdomain] = await Promise.all([scriptNames(ctx, account), accountSubdomain(ctx, account)]);

      if (!names.has(name)) {
        // Created empty, with its workers.dev and preview addresses on, so a
        // preview can be uploaded before anything is live.
        await cf(ctx, "POST", `accounts/${encodeURIComponent(account)}/workers/workers`, "create the Worker", {
          json: { name, subdomain: { enabled: true, previews_enabled: true } },
        });
      }
      return { project: name, productionUrl: productionAddress(name, subdomain) };
    },

    async deploy(ctx, input) {
      const { account, project, kind } = input;
      // `_redirects` and `_headers` at the root are rules, not pages: they go in the metadata, never in the manifest.
      const routing: { _redirects?: string; _headers?: string } = {};

      for (const file of input.files) {
        if (file.path !== "_redirects" && file.path !== "_headers") continue;
        const text = Buffer.from(file.bytes ?? (await readFile(file.absolute))).toString("utf8");

        if (file.path === "_redirects") checkCloudflareRedirects(text);
        else checkCloudflareHeaders(text);
        routing[file.path] = text;
      }
      const files = input.files.filter((file) => file.path !== "_redirects" && file.path !== "_headers");
      const subdomain = await accountSubdomain(ctx, account);
      const byHash = new Map<string, DeployFile>();
      const manifest: Record<string, { hash: string; size: number }> = {};

      for (const file of files) {
        manifest[`/${file.path}`] = { hash: file.cfHash, size: file.size };
        if (!byHash.has(file.cfHash)) byHash.set(file.cfHash, file);
      }
      input.onProgress({ detail: `Checking which of ${files.length.toLocaleString("en-US")} files Cloudflare already has…`, progress: 0 });
      const session = await cf<{ jwt?: string; buckets?: string[][] }>(ctx, "POST", `${scriptPath(account, project)}/assets-upload-session`, "start the upload", { json: { manifest } });

      if (!session?.jwt) throw new DeployError("host", "Cloudflare didn't start the upload. Nothing on the live site changed. Try again.", "assets-upload-session returned no jwt");
      const buckets = (session.buckets ?? []).flatMap((bucket) => {
        const chunks: string[][] = [];

        for (let at = 0; at < bucket.length; at += UPLOAD_CHUNK) chunks.push(bucket.slice(at, at + UPLOAD_CHUNK));
        return chunks;
      });
      const needed = buckets.reduce((sum, bucket) => sum + bucket.length, 0);
      let completion = needed === 0 ? session.jwt : "";
      let sent = 0;

      if (needed > 0) input.onProgress({ detail: `Uploading ${needed.toLocaleString("en-US")} ${needed === 1 ? "file" : "files"}…`, progress: 0 });
      await eachLimited(buckets, UPLOAD_PARALLEL, async (bucket) => {
        const form = new FormData();

        for (const hash of bucket) {
          const file = byHash.get(hash);

          if (!file) throw new DeployError("host", "Cloudflare asked for a file that isn't in the site. Nothing on the live site changed. Try again.", `unknown hash ${hash}`);
          form.append(hash, new Blob([(await readFile(file.absolute)).toString("base64")], { type: file.type }), hash);
        }
        const response = await hostRequest<CfEnvelope<{ jwt?: string }>>(ctx, NAME, {
          method: "POST",
          path: `accounts/${encodeURIComponent(account)}/workers/assets/upload`,
          query: { base64: "true" },
          bearer: session.jwt!,
          body: form,
          retry: true,
        });

        if (!response.ok || response.body?.success === false) throw failure(response, "POST", "workers/assets/upload", "take the site's files");
        if (response.body?.result?.jwt) completion = response.body.result.jwt;
        sent += bucket.length;
        input.onProgress({ detail: `Uploading ${sent.toLocaleString("en-US")} of ${needed.toLocaleString("en-US")} files…`, progress: sent / needed });
      });
      if (!completion) throw new DeployError("host", "Cloudflare didn't confirm it received every file. Nothing on the live site changed. Try again.", "no completion jwt after uploads");
      input.onProgress({ detail: kind === "production" ? "Cloudflare is putting it live…" : "Cloudflare is preparing the preview…", progress: 1 });
      const message = (input.label ?? (kind === "production" ? "Published version" : "Preview")).slice(0, 900);
      const metadata = {
        main_module: CLOUDFLARE_MODULE_NAME,
        compatibility_date: CLOUDFLARE_COMPATIBILITY_DATE,
        bindings: [{ type: "assets", name: "ASSETS" }],
        assets: { jwt: completion, config: { html_handling: "auto-trailing-slash", not_found_handling: "404-page", ...routing } },
        annotations: { "workers/message": message, ...(input.commit ? { "workers/tag": input.commit.slice(0, 12) } : {}) },
      };
      const createdAt = new Date().toISOString();

      if (kind === "production") {
        const result = await cf<{ id?: string; etag?: string; deployment_id?: string }>(ctx, "PUT", scriptPath(account, project), "put the site live", { body: workerForm(metadata) });
        const url = productionAddress(project, subdomain);

        return { id: result?.deployment_id ?? result?.etag ?? result?.id ?? createdAt, url, kind, createdAt, productionUrl: url };
      }
      const version = await cf<{ id?: string }>(ctx, "POST", `${scriptPath(account, project)}/versions`, "make the preview", { body: workerForm(metadata) });

      if (!version?.id) throw new DeployError("host", "Cloudflare didn't say where the preview is. Try again.", "versions upload returned no id");
      return { id: version.id, url: `https://${version.id.slice(0, 8)}-${project}.${subdomain}.workers.dev`, kind, createdAt };
    },
  };
}
