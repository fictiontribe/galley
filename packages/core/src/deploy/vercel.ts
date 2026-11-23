/**
 * Vercel, through its REST API with plain `fetch` — no CLI, no SDK.
 *
 * Protocol (vercel.com/docs/rest-api, the "Upload Deployment Files",
 * "Create a new deployment" and "Create a new project" pages, read
 * 2026-11-23):
 *   - POST /v2/files, body = the file's bytes (application/octet-stream),
 *     `x-vercel-digest: <sha1>` and its size. 200 whether or not Vercel already
 *     had it.
 *   - POST /v13/deployments { name, project, target?, files: [{ file, sha,
 *     size }], projectSettings } — `target: "production"` for the live
 *     address, absent for a preview. `projectSettings` is required on a
 *     project's first deployment; `framework: null` with no build command
 *     makes Vercel serve the uploaded files as they are.
 *     `skipAutoDetectionConfirmation=1` keeps Vercel from stopping to ask
 *     about a framework it thinks it sees.
 *   - The deployment then moves QUEUED → … → READY (or ERROR); we poll
 *     GET /v13/deployments/:id. Its `url` is the deployment's own address.
 *   - Projects: GET /v9/projects/:name, POST /v11/projects { name, framework }.
 *   - Accounts: GET /v2/teams (and GET /v2/user for the default team).
 * Every call carries `teamId` when the site lives in a team.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DeployError } from "./errors";
import { cloudflareHash, eachLimited, sha1, type DeployFile } from "./files";
import { describeResponse, hostRequest, type HostResponse } from "./http";
import { VERCEL_CREDENTIALS, VERCEL_INFO, projectNameProblem } from "./info";
import { apexOf } from "./domains";
import { hasMarkdown, vercelRoutingMembers, withVercelMarkdownHeader } from "./routing";
import type { DomainRecord } from "../types";
import type { DeployContext, DeployTarget } from "./types";

export const VERCEL_API = "https://api.vercel.com";
const NAME = "Vercel";
/** A personal Vercel account, which takes no teamId. */
export const VERCEL_PERSONAL = "personal";
const UPLOAD_PARALLEL = 8;
const READY_TIMEOUT_MS = 10 * 60_000;
const POLL_MS = 1500;

interface VercelError {
  error?: { code?: string; message?: string; missing?: string[]; invalidToken?: boolean };
}

const STATIC_SETTINGS = { framework: null, buildCommand: null, installCommand: null, devCommand: null, outputDirectory: null };

function team(account: string): Record<string, string | undefined> {
  return account && account !== VERCEL_PERSONAL ? { teamId: account } : {};
}

function failure(response: HostResponse<VercelError>, method: string, path: string, doing: string): DeployError {
  const detail = describeResponse(method, path, response);
  const code = response.body?.error?.code ?? "";
  const message = response.body?.error?.message;

  // Vercel refuses an unknown key with 403 and `invalidToken: true`; a known key without access is a plain 403.
  if (response.status === 401 || code === "invalidToken" || code === "not_authorized" || response.body?.error?.invalidToken) {
    return new DeployError("unauthorized", "Vercel didn't accept the access key. It may have been deleted or have expired. Create a new one and paste it here.", detail);
  }
  if (response.status === 403) {
    return new DeployError(
      "permission",
      `Vercel didn't let the access key ${doing}. Create a key whose scope is the team the site should live in (not a single project), paste it here, and try again.`,
      detail
    );
  }
  if (response.status === 429) return new DeployError("rate-limited", "Vercel is asking for a pause — accounts can only upload so much each day. Wait a while, then try again. Nothing on the live site changed.", detail);
  if (response.status === 402) return new DeployError("host", "Vercel says the account needs its payment details updated before it can take new uploads. Nothing on the live site changed.", detail);
  return new DeployError("host", `Vercel couldn't ${doing}${message ? `: “${message.slice(0, 200)}”` : ""}. Nothing on the live site changed. Try again in a moment.`, detail);
}

async function vercel<T>(ctx: DeployContext, method: string, path: string, doing: string, init: { json?: unknown; query?: Record<string, string | undefined>; allow?: number[] } = {}): Promise<{ status: number; body: T | null }> {
  const response = await hostRequest<T & VercelError>(ctx, NAME, {
    method,
    path,
    ...(init.query ? { query: init.query } : {}),
    ...(init.json !== undefined ? { body: JSON.stringify(init.json), headers: { "content-type": "application/json" } } : {}),
  });

  // An allowed status never covers a key Vercel doesn't know.
  if (!response.ok && (!(init.allow ?? []).includes(response.status) || response.body?.error?.invalidToken)) throw failure(response, method, path, doing);
  return { status: response.status, body: response.body };
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);

    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function https(host: string): string {
  return /^https?:\/\//.test(host) ? host : `https://${host}`;
}

/**
 * Vercel reads vercel.json (redirects, rewrites, headers…) from the root of a
 * deployment's files. The site keeps it at its own root, not in the build
 * output, so it is added to the upload — as a routing-only copy (see
 * routing.ts) — in place of any vercel.json the build happened to copy.
 */
async function withVercelConfig(files: DeployFile[], siteRoot: string | undefined): Promise<DeployFile[]> {
  const text = siteRoot ? await readFile(join(siteRoot, "vercel.json"), "utf8").catch(() => null) : null;
  const markdown = hasMarkdown(files.map((file) => file.path));

  if (text === null && !markdown) return files;
  let routing = text === null ? null : vercelRoutingMembers(text);

  // Markdown copies of pages are served as text, unless the site's own headers say otherwise.
  if (markdown) routing = withVercelMarkdownHeader(routing);
  const rest = files.filter((file) => file.path !== "vercel.json");

  if (!routing || Object.keys(routing).length === 0) return text === null ? files : rest;
  const bytes = Buffer.from(`${JSON.stringify(routing, null, 2)}\n`, "utf8");

  return [...rest, { path: "vercel.json", absolute: join(siteRoot ?? ".", "vercel.json"), size: bytes.byteLength, sha1: sha1(bytes), cfHash: cloudflareHash(bytes, "vercel.json"), type: "application/json; charset=utf-8", bytes }];
}

// ─────────────────────────────────────────────────────────────── own domain

interface VercelDomainConfig {
  misconfigured?: boolean;
  recommendedIPv4?: Array<{ rank?: number; value?: string[] }>;
  recommendedCNAME?: Array<{ rank?: number; value?: string }>;
}

interface VercelProjectDomain {
  name?: string;
  verified?: boolean;
  verification?: Array<{ type?: string; domain?: string; value?: string }>;
}

const first = <T extends { rank?: number }>(items: T[] | undefined): T | undefined => [...(items ?? [])].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0];

/** The record Vercel recommends for `hostname` (GET /v6/domains/:d/config): an A record at the apex, a CNAME below it. */
function recordsFrom(hostname: string, config: VercelDomainConfig | null, verification: VercelProjectDomain["verification"] = []): DomainRecord[] {
  const records: DomainRecord[] = [];
  const apex = hostname.split(".").length === 2;
  const ipv4 = first(config?.recommendedIPv4)?.value?.[0];
  const cname = first(config?.recommendedCNAME)?.value;

  if (apex && ipv4) records.push({ type: "A", name: hostname, value: ipv4 });
  else if (!apex && cname) records.push({ type: "CNAME", name: hostname, value: cname.replace(/\.$/, "") });
  for (const challenge of verification ?? []) {
    if (challenge.type && challenge.domain && challenge.value) records.push({ type: challenge.type, name: challenge.domain, value: challenge.value });
  }
  return records;
}

export function createVercelTarget(): DeployTarget {
  async function upload(ctx: DeployContext, account: string, files: DeployFile[], onSent: (sent: number) => void): Promise<void> {
    let sent = 0;

    await eachLimited(files, UPLOAD_PARALLEL, async (file) => {
      const bytes = file.bytes ?? (await readFile(file.absolute));
      const response = await hostRequest<VercelError>(ctx, NAME, {
        method: "POST",
        path: "v2/files",
        query: team(account),
        headers: { "content-type": "application/octet-stream", "x-vercel-digest": file.sha1, "x-now-size": String(bytes.byteLength) },
        body: bytes,
        retry: true,
      });

      if (!response.ok) throw failure(response, "POST", "v2/files", "take the site's files");
      sent += 1;
      onSent(sent);
    });
  }

  return {
    id: "vercel",
    name: NAME,
    apiBase: VERCEL_API,
    credentials: VERCEL_CREDENTIALS,
    info: VERCEL_INFO,

    async connect(ctx) {
      const [user, teams] = await Promise.all([
        vercel<{ user?: { id?: string; username?: string; name?: string; defaultTeamId?: string | null } }>(ctx, "GET", "v2/user", "read your account", { allow: [403] }),
        vercel<{ teams?: Array<{ id?: string; slug?: string; name?: string | null }> }>(ctx, "GET", "v2/teams", "list your teams", { allow: [403] }),
      ]);
      const accounts = (teams.body?.teams ?? []).filter((entry) => entry.id).map((entry) => ({ id: entry.id!, name: entry.name?.trim() || entry.slug || entry.id! }));
      const defaultTeam = user.body?.user?.defaultTeamId;

      // The default team first: it is where Vercel puts things unless told otherwise.
      accounts.sort((a, b) => (a.id === defaultTeam ? -1 : b.id === defaultTeam ? 1 : 0));
      if (accounts.length === 0 && user.status === 200 && user.body?.user) {
        accounts.push({ id: VERCEL_PERSONAL, name: user.body.user.name?.trim() || user.body.user.username || "Your account" });
      }
      if (accounts.length === 0) {
        throw new DeployError(
          "permission",
          "Vercel accepted the access key but it can't see any team. Create a key whose scope is the team the site should live in (not a single project), and paste it here.",
          `v2/user → ${user.status}, v2/teams → ${teams.status}`
        );
      }
      return { accounts };
    },

    async checkProject(ctx, { account, name }) {
      const problem = projectNameProblem(name);

      if (problem) return { name, available: false, existing: false, message: problem };
      const found = await vercel<{ id?: string }>(ctx, "GET", `v9/projects/${encodeURIComponent(name)}`, "look up the project", { query: team(account), allow: [404] });
      const existing = found.status === 200;

      return {
        name,
        available: true,
        existing,
        ...(existing ? { message: `There's already a project called “${name}” in this team. Putting the site there replaces what it serves.` } : {}),
      };
    },

    async ensureProject(ctx, { account, name }) {
      const problem = projectNameProblem(name);

      if (problem) throw new DeployError("taken", problem, name);
      const found = await vercel<{ name?: string }>(ctx, "GET", `v9/projects/${encodeURIComponent(name)}`, "look up the project", { query: team(account), allow: [404] });

      if (found.status === 404) {
        const created = await vercel<VercelError>(ctx, "POST", "v11/projects", "create the project", { query: team(account), json: { name, ...STATIC_SETTINGS }, allow: [409] });

        if (created.status === 409) {
          throw new DeployError("taken", `Vercel says the name “${name}” can't be used. Choose a different name.`, JSON.stringify(created.body).slice(0, 500));
        }
      }
      // Vercel settles the live address on the first production upload (it may add a suffix); until then this is the likely one.
      return { project: name, productionUrl: `https://${name}.vercel.app` };
    },

    async planDomain(ctx, { account, project, hostname }) {
      const apex = apexOf(hostname);
      const found = await vercel(ctx, "GET", `v9/projects/${encodeURIComponent(project)}`, "look up the project", { query: team(account), allow: [404] });

      if (found.status === 404) return { hostname, status: "not-online", summary: "Put the site online first; then it can answer on your own address.", canAttach: false };
      const existing = await vercel<VercelProjectDomain>(ctx, "GET", `v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(hostname)}`, "look up the address", { query: team(account), allow: [404] });

      if (existing.status === 200) return { hostname, status: "already", summary: `${hostname} is already one of this site's addresses on Vercel.`, canAttach: false };
      const config = await vercel<VercelDomainConfig>(ctx, "GET", `v6/domains/${encodeURIComponent(hostname)}/config`, "read the address's DNS", { query: { ...team(account), projectIdOrName: project } });

      if (config.body && config.body.misconfigured === false) {
        return { hostname, status: "ready", summary: `Vercel will answer ${hostname} with this site and set up its certificate. Its DNS already points at Vercel; nothing else on ${apex} changes.`, canAttach: true };
      }
      return {
        hostname,
        status: "needs-dns",
        summary: `Vercel will answer ${hostname} with this site once the DNS record below exists. This app adds the address to the project now; you create the record where ${apex}'s DNS is managed, then check again. Nothing else on ${apex} changes.`,
        records: recordsFrom(hostname, config.body),
        canAttach: true,
        helpUrl: "https://vercel.com/docs/domains/working-with-domains/add-a-domain",
      };
    },

    async attachDomain(ctx, { account, project, hostname }) {
      const added = await vercel<VercelProjectDomain & VercelError>(ctx, "POST", `v10/projects/${encodeURIComponent(project)}/domains`, "add the address", { query: team(account), json: { name: hostname }, allow: [409] });

      if (added.status === 409) {
        throw new DeployError("domain", `${hostname} is already used by another Vercel project. Remove it there, or choose another address. Nothing was changed.`, added.body?.error?.message);
      }
      const config = await vercel<VercelDomainConfig>(ctx, "GET", `v6/domains/${encodeURIComponent(hostname)}/config`, "read the address's DNS", { query: { ...team(account), projectIdOrName: project } });

      return { records: config.body?.misconfigured === false && added.body?.verified !== false ? [] : recordsFrom(hostname, config.body, added.body?.verification) };
    },

    async domainStatus(ctx, { account, project, hostname }) {
      const path = `v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(hostname)}`;
      let domain = (await vercel<VercelProjectDomain>(ctx, "GET", path, "look up the address", { query: team(account) })).body;

      if (domain && domain.verified === false) {
        // Documented: POST …/domains/:domain/verify after the challenge record exists.
        domain = (await vercel<VercelProjectDomain>(ctx, "POST", `${path}/verify`, "verify the address", { query: team(account), allow: [400] })).body ?? domain;
      }
      const config = await vercel<VercelDomainConfig>(ctx, "GET", `v6/domains/${encodeURIComponent(hostname)}/config`, "read the address's DNS", { query: { ...team(account), projectIdOrName: project } });
      const ready = domain?.verified !== false && config.body?.misconfigured === false;

      return ready ? { ready } : { ready, records: recordsFrom(hostname, config.body, domain?.verified === false ? domain.verification : []) };
    },

    async detachDomain(ctx, { account, project, hostname }) {
      await vercel(ctx, "DELETE", `v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(hostname)}`, "stop using the address", { query: team(account), allow: [404] });
    },

    async deploy(ctx, input) {
      const { account, project, kind } = input;
      const files = await withVercelConfig(input.files, input.siteRoot);
      const unique = [...new Map(files.map((file) => [file.sha1, file])).values()];

      input.onProgress({ detail: `Uploading ${files.length.toLocaleString("en-US")} ${files.length === 1 ? "file" : "files"}…`, progress: 0 });
      await upload(ctx, account, unique, (sent) =>
        input.onProgress({ detail: `Uploading ${sent.toLocaleString("en-US")} of ${unique.length.toLocaleString("en-US")} files…`, progress: sent / unique.length })
      );
      const body = {
        name: project,
        project,
        ...(kind === "production" ? { target: "production" } : {}),
        files: files.map((file) => ({ file: file.path, sha: file.sha1, size: file.size })),
        projectSettings: STATIC_SETTINGS,
        meta: { source: "site-editor", kind, ...(input.commit ? { commit: input.commit.slice(0, 40) } : {}), ...(input.label ? { label: input.label.slice(0, 200) } : {}) },
      };
      const query = { ...team(account), skipAutoDetectionConfirmation: "1" };
      let created = await hostRequest<{ id?: string; url?: string; readyState?: string; alias?: string[] } & VercelError>(ctx, NAME, {
        method: "POST",
        path: "v13/deployments",
        query,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      // Vercel names files it doesn't have after all (one expired between upload and use): send those and ask again, once.
      if (created.status === 400 && created.body?.error?.code === "missing_files" && created.body.error.missing?.length) {
        const missing = new Set(created.body.error.missing);

        await upload(ctx, account, unique.filter((file) => missing.has(file.sha1)), () => undefined);
        created = await hostRequest(ctx, NAME, { method: "POST", path: "v13/deployments", query, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      }
      if (!created.ok || !created.body?.id) throw failure(created, "POST", "v13/deployments", kind === "production" ? "put the site live" : "make the preview");
      const id = created.body.id;
      let deployment = created.body;
      const started = Date.now();

      input.onProgress({ detail: kind === "production" ? "Vercel is putting it live…" : "Vercel is preparing the preview…", progress: 1 });
      while (deployment.readyState !== "READY") {
        if (deployment.readyState === "ERROR" || deployment.readyState === "CANCELED") {
          throw new DeployError("host", "Vercel couldn't finish putting the files up. Nothing on the live site changed. Open the deployment on Vercel to see why.", JSON.stringify(deployment).slice(0, 2000));
        }
        if (Date.now() - started > READY_TIMEOUT_MS) {
          throw new DeployError("host", "Vercel is taking unusually long to finish. Check the project on Vercel; the upload may still complete there.", `deployment ${id} still ${deployment.readyState}`);
        }
        // Static uploads are usually ready within a second or two: look soon, then settle into a steady pace.
        await wait(Date.now() - started < 5_000 ? 400 : POLL_MS, ctx.signal);
        const polled = await vercel<{ id?: string; url?: string; readyState?: string; alias?: string[] }>(ctx, "GET", `v13/deployments/${encodeURIComponent(id)}`, "say how the upload is going", { query: team(account) });

        deployment = { ...deployment, ...polled.body };
      }
      const aliases = (deployment.alias ?? []).filter((alias) => typeof alias === "string");
      const production = kind === "production" ? (aliases.find((alias) => alias.endsWith(".vercel.app")) ?? aliases[0]) : undefined;

      return {
        id,
        url: https(kind === "production" && production ? production : (deployment.url ?? "")),
        kind,
        createdAt: new Date().toISOString(),
        ...(production ? { productionUrl: https(production) } : {}),
      };
    },
  };
}
