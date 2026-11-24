/**
 * Google Cloud's REST APIs with no SDK, for the `gcp` host: the service
 * account's JSON key, a signed JWT exchanged for an access token, Compute
 * Engine calls and the waiting on their operations, and Google's answers
 * turned into plain sentences. Facts and their sources:
 * /docs/cloud-install.md › Google Cloud, and the research note it cites.
 *
 *  - Sign-in (developers.google.com/identity/protocols/oauth2/service-account,
 *    read 2026-11-24): an RS256 JWT { iss: the account's e-mail, scope,
 *    aud: https://oauth2.googleapis.com/token, iat, exp ≤ iat + 1 hour },
 *    `kid` the key's id, POSTed form-encoded with grant_type
 *    urn:ietf:params:oauth:grant-type:jwt-bearer; the answer's access token
 *    lasts `expires_in` (3600) seconds.
 *  - What the key may do: Cloud Resource Manager's projects.testIamPermissions,
 *    which needs no permission itself.
 *  - Compute Engine answers a change with an Operation; the change is done
 *    when the operation's status is DONE (…/operations/:op/wait returns within
 *    about two minutes, best effort, so it is called again until then).
 *
 * The private key and every access token stay inside this module: nothing
 * here puts them in a message, and `gcpSecrets()` lists them for scrubbing
 * whatever a caller shows.
 */
import { createPrivateKey, createSign, type KeyObject } from "node:crypto";
import { HostingError } from "./errors";
import { apiRequest, apiUrl, describe, REQUEST_TIMEOUT_MS, type ApiResponse } from "./http";
import type { EditorHostContext } from "./types";

/** API origins by name; tests and the rehearsal point them at a fake (GALLEY_HOSTING_<NAME>_API). */
export const GCP_APIS = {
  "gcp-compute": "https://compute.googleapis.com/compute/v1",
  "gcp-oauth": "https://oauth2.googleapis.com",
  "gcp-resource-manager": "https://cloudresourcemanager.googleapis.com/v1",
} as const;
/** The JWT's audience is always this, wherever the token is fetched from. */
export const GCP_TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";
/** One token for Compute Engine and the permission check: both accept it. */
export const GCP_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const NAME = "Google Cloud";
const KEY_LIFETIME_S = 3600;
const MAX_KEY_LENGTH = 16_384;

export interface ServiceAccountKey {
  type: "service_account";
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
}

/** Everything secret this module has seen (private keys, their lines, access tokens), for scrubbing. */
const sensitive = new Set<string>();

export function gcpSecrets(): string[] {
  return [...sensitive];
}

function remember(value: string): void {
  if (value.length >= 8) sensitive.add(value);
}

const KEY_FILE_WORDS = "a key file from Google Cloud (a service account's JSON key)";

/**
 * The key file, parsed. A key pasted into a one-line field has lost its line
 * breaks — harmless, because they only ever sit between JSON's own tokens;
 * the private key's own line breaks are `\n` escapes inside its string.
 * Null when it isn't a service account's key.
 */
export function parseServiceAccountKey(text: string): ServiceAccountKey | null {
  const trimmed = text.trim();

  if (!trimmed.startsWith("{") || trimmed.length > MAX_KEY_LENGTH) return null;
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const field = (name: string) => (typeof parsed[name] === "string" ? (parsed[name] as string).trim() : "");
  const key: ServiceAccountKey = {
    type: "service_account",
    project_id: field("project_id"),
    private_key_id: field("private_key_id"),
    private_key: typeof parsed.private_key === "string" ? parsed.private_key : "",
    client_email: field("client_email"),
  };

  if (parsed.type !== "service_account" || !key.project_id || !key.private_key_id || !key.client_email.includes("@") || !/-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(key.private_key)) return null;
  return key;
}

/** The shape check for saving the key: the whole file, compact, or null when it isn't one. */
export function normalizeServiceAccountKey(text: string): string | null {
  const key = parseServiceAccountKey(text);

  return key ? JSON.stringify(JSON.parse(text.trim())) : null;
}

/** The last four characters of the key's id — never of the private key. */
export function serviceAccountKeyHint(text: string): string | undefined {
  return parseServiceAccountKey(text)?.private_key_id.slice(-4);
}

/**
 * The private key, whatever happened to its line breaks on the way: real
 * ones, `\n` escapes left as text, or spaces. Only the base64 between the
 * PEM lines matters.
 */
function privateKeyOf(key: ServiceAccountKey): KeyObject {
  const rsa = /BEGIN RSA PRIVATE KEY/.test(key.private_key);
  const body = key.private_key
    .replace(/-----(BEGIN|END) (?:RSA )?PRIVATE KEY-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");

  remember(key.private_key);
  remember(body);
  for (const line of key.private_key.split(/\\n|\s+/)) remember(line);
  try {
    return createPrivateKey({ key: Buffer.from(body, "base64"), format: "der", type: rsa ? "pkcs1" : "pkcs8" });
  } catch {
    throw new HostingError("invalid", `The private key in ${KEY_FILE_WORDS} can't be read. Download a new key for the service account and paste the whole file.`);
  }
}

const base64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

/** The signed assertion the token endpoint takes. */
export function signedAssertion(key: ServiceAccountKey, now = Math.floor(Date.now() / 1000)): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: key.private_key_id }));
  const claims = base64url(JSON.stringify({ iss: key.client_email, scope: GCP_SCOPE, aud: GCP_TOKEN_AUDIENCE, iat: now, exp: now + KEY_LIFETIME_S }));
  const signer = createSign("RSA-SHA256");

  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${base64url(signer.sign(privateKeyOf(key)))}`;
}

const tokens = new Map<string, { token: string; expires: number }>();

/** A signed-in client for one key. */
export interface GcpClient {
  key: ServiceAccountKey;
  project: string;
  /** One call; a refused token is fetched again once. */
  call<T>(api: "gcp-compute" | "gcp-resource-manager", method: string, path: string, init?: { json?: unknown; query?: Record<string, string | undefined> }): Promise<ApiResponse<T & GoogleError>>;
}

export interface GoogleError {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: Array<{ reason?: string; message?: string; domain?: string }>;
    details?: Array<{ "@type"?: string; reason?: string; metadata?: Record<string, string> }>;
  };
}

async function fetchToken(ctx: EditorHostContext, key: ServiceAccountKey): Promise<string> {
  const origin = ctx.api("gcp-oauth");
  const cacheKey = `${origin}|${key.client_email}|${key.private_key_id}`;
  const cached = tokens.get(cacheKey);

  if (cached && cached.expires > Date.now() + 5 * 60_000) return cached.token;
  const assertion = signedAssertion(key);
  const url = apiUrl(origin, "token");
  let response: Response;

  try {
    response = await ctx.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
      signal: ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new HostingError("offline", "This computer can't reach Google Cloud. Check your internet connection and try again.", `POST ${new URL(url).host}/token: ${error instanceof Error ? error.name : "failed"}`);
  }
  const text = (await response.text().catch(() => "")).slice(0, 4096);
  let body: { access_token?: string; expires_in?: number; error?: string; error_description?: string } = {};

  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    body = {};
  }
  if (!response.ok || !body.access_token) {
    // Only Google's own words about the refusal go into the details: never the assertion.
    const detail = `POST token → ${response.status}${body.error ? `\n${body.error}${body.error_description ? `: ${body.error_description.slice(0, 300)}` : ""}` : ""}`;

    if (response.status === 429) throw new HostingError("rate-limited", "Google Cloud is asking for a pause. Wait a minute, then try again.", detail);
    if (response.status >= 500) throw new HostingError("host", "Google Cloud's sign-in didn't answer properly. Try again in a moment.", detail);
    throw new HostingError(
      "unauthorized",
      `Google Cloud didn't accept the key. It may have been deleted or disabled, or the service account removed. Create a new key for the service account (IAM & Admin › Service accounts › Keys › Add key) and paste the whole file here.`,
      detail
    );
  }
  remember(body.access_token);
  tokens.set(cacheKey, { token: body.access_token, expires: Date.now() + Math.max(60, Math.min(body.expires_in ?? KEY_LIFETIME_S, KEY_LIFETIME_S)) * 1000 });
  return body.access_token;
}

/** Reads the stored key, signs in and returns a client. Throws a plain sentence when there is no key or it isn't one. */
export async function gcpClient(ctx: EditorHostContext, raw?: string | null): Promise<GcpClient> {
  const text = raw ?? (await ctx.secret("gcp"));

  if (!text) throw new HostingError("no-key", `Add ${KEY_FILE_WORDS} first. Paste it in the setup, or start the app with GOOGLE_APPLICATION_CREDENTIALS_JSON set.`);
  remember(text);
  const key = parseServiceAccountKey(text);

  if (!key) throw new HostingError("invalid", `That isn't ${KEY_FILE_WORDS}. In the Google Cloud console, open IAM & Admin › Service accounts, choose the account, then Keys › Add key › Create new key › JSON, and paste the whole file.`);
  privateKeyOf(key);
  let token = await fetchToken(ctx, key);

  return {
    key,
    project: key.project_id,
    async call<T>(api: "gcp-compute" | "gcp-resource-manager", method: string, path: string, init: { json?: unknown; query?: Record<string, string | undefined> } = {}) {
      for (let attempt = 0; ; attempt += 1) {
        const response = await apiRequest<T & GoogleError>(ctx, api, NAME, { method, path, key: token, ...init });

        if (response.status !== 401 || attempt > 0) return response;
        // A token that expired or was revoked meanwhile: sign in again, once.
        tokens.clear();
        token = await fetchToken(ctx, key);
      }
    },
  };
}

/** Whether Google knows the key: it signs in. Creates nothing. */
export async function checkGcpKey(ctx: EditorHostContext, raw: string): Promise<void> {
  await gcpClient(ctx, raw);
}

// ─────────────────────────────────────────────────────────────── Google's answers

const reasonsOf = (body: GoogleError | null) => [...(body?.error?.errors ?? []).map((entry) => entry.reason ?? ""), ...(body?.error?.details ?? []).map((entry) => entry.reason ?? "")].filter(Boolean);

/** The place to turn an API on, when Google says it is off; null when it isn't that. */
export function disabledApi(response: ApiResponse<GoogleError>, api: string, project: string): string | null {
  if (response.status !== 403) return null;
  const reasons = reasonsOf(response.body);
  const message = response.body?.error?.message ?? "";

  if (!reasons.includes("SERVICE_DISABLED") && !reasons.includes("accessNotConfigured") && !/has not been used in project .* or it is disabled/i.test(message)) return null;
  const given = response.body?.error?.details?.find((entry) => entry.reason === "SERVICE_DISABLED")?.metadata?.activationUrl;

  return given && /^https:\/\/console\.(cloud|developers)\.google\.com\//.test(given) ? given : `https://console.cloud.google.com/apis/library/${api}?project=${encodeURIComponent(project)}`;
}

/**
 * The role that holds a permission, as the console names it (compute/docs/access/iam,
 * read 2026-11-24). The three together are the narrowest predefined set that
 * covers everything this host does; Compute Admin covers it too, but far more.
 */
export const GCP_ROLES = {
  instance: "Compute Instance Admin (v1)",
  network: "Compute Network Admin",
  security: "Compute Security Admin",
} as const;

/** Every permission create, upgrade, back up and remove use, with the role that has it and what it is for. */
export const GCP_PERMISSIONS: Array<{ permission: string; role: keyof typeof GCP_ROLES; does: string }> = [
  { permission: "compute.networks.create", role: "network", does: "make the editor's network" },
  { permission: "compute.networks.delete", role: "network", does: "remove the editor's network" },
  { permission: "compute.subnetworks.create", role: "network", does: "make the editor's network" },
  { permission: "compute.subnetworks.delete", role: "network", does: "remove the editor's network" },
  { permission: "compute.addresses.create", role: "network", does: "reserve the editor's fixed address" },
  { permission: "compute.addresses.delete", role: "network", does: "give back the editor's fixed address" },
  { permission: "compute.addresses.setLabels", role: "network", does: "label the editor's fixed address" },
  { permission: "compute.firewalls.create", role: "security", does: "open the web ports to the editor" },
  { permission: "compute.firewalls.delete", role: "security", does: "close the web ports again" },
  { permission: "compute.instances.create", role: "instance", does: "make the virtual machine" },
  { permission: "compute.instances.delete", role: "instance", does: "remove the virtual machine" },
  { permission: "compute.instances.setMetadata", role: "instance", does: "move the editor to a new version" },
  { permission: "compute.instances.stop", role: "instance", does: "restart the virtual machine for an upgrade" },
  { permission: "compute.instances.start", role: "instance", does: "restart the virtual machine for an upgrade" },
  { permission: "compute.subnetworks.use", role: "instance", does: "put the virtual machine in its network" },
  { permission: "compute.subnetworks.useExternalIp", role: "instance", does: "give the virtual machine its public address" },
  { permission: "compute.addresses.use", role: "instance", does: "give the virtual machine its fixed address" },
  { permission: "compute.disks.createSnapshot", role: "instance", does: "copy the editor's disk (Back up)" },
  { permission: "compute.snapshots.create", role: "instance", does: "copy the editor's disk (Back up)" },
  { permission: "compute.snapshots.setLabels", role: "instance", does: "label a copy of the editor's disk" },
];

export function iamPage(project: string): string {
  return `https://console.cloud.google.com/iam-admin/iam?project=${encodeURIComponent(project)}`;
}

/** Where to add a role, in the console's own words. */
export function grantSteps(project: string, email: string, roles: string[]): string {
  const list = roles.map((role) => `“${role}”`).join(roles.length === 2 ? " and " : ", ");

  return `In the Google Cloud console, open IAM & Admin › IAM for the project “${project}”, find ${email} (choose Grant access and type it if it isn't listed), choose Edit, then Add another role: ${list}. Save, wait a minute, then check again.`;
}

/** Turns one of Google's refusals into a sentence with the next step. */
export function gcpFailure(response: ApiResponse<GoogleError>, method: string, path: string, doing: string, context: { project: string; email?: string; name?: string; what?: string }): HostingError {
  const detail = describe(method, path, response);
  const reasons = reasonsOf(response.body);
  const message = response.body?.error?.message ?? "";
  const off = disabledApi(response, "compute.googleapis.com", context.project);

  if (response.status === 401) return new HostingError("unauthorized", "Google Cloud didn't accept the key's sign-in. Paste the key file again, or create a new key for the service account.", detail);
  if (off) return new HostingError("permission", `The Compute Engine API is off in the project “${context.project}”. Turn it on at ${off}, wait a minute, then try again.`, detail);
  if (response.status === 403 && (reasons.includes("QUOTA_EXCEEDED") || reasons.includes("quotaExceeded") || /quota/i.test(message))) {
    return new HostingError("capacity", `Google Cloud says the project “${context.project}” has reached a limit (a quota) and couldn't ${doing}. Ask for more on the Quotas page (IAM & Admin › Quotas), or choose another region.`, detail);
  }
  if (response.status === 403) {
    const permission = /'(compute\.[a-zA-Z]+\.[a-zA-Z]+)'/.exec(message)?.[1];
    const role = GCP_PERMISSIONS.find((entry) => entry.permission === permission)?.role;
    const steps = role ? ` ${grantSteps(context.project, context.email ?? "the service account", [GCP_ROLES[role]])}` : ` Give the service account the roles ${Object.values(GCP_ROLES).map((entry) => `“${entry}”`).join(", ")} (IAM & Admin › IAM), then try again.`;

    return new HostingError("permission", `Google Cloud didn't let the key ${doing}${permission ? ` (it needs ${permission})` : ""}.${steps}`, detail);
  }
  if (response.status === 409) return new HostingError("taken", `There's already ${context.what ?? "something"} called “${context.name ?? ""}” in the project “${context.project}”. Choose another name, or delete it in the Google Cloud console first.`, detail);
  if (response.status === 429) return new HostingError("rate-limited", "Google Cloud is asking for a pause. Wait a minute, then try again.", detail);
  if (reasons.includes("ZONE_RESOURCE_POOL_EXHAUSTED") || reasons.includes("ZONE_RESOURCE_POOL_EXHAUSTED_WITH_DETAILS")) {
    return new HostingError("capacity", "Google Cloud has no room for this virtual machine in that region right now. Remove what was made here, then try again with another region.", detail);
  }
  return new HostingError("host", `Google Cloud couldn't ${doing}${message ? `: “${message.slice(0, 200)}”` : ""}. Try again in a moment.`, detail);
}

// ─────────────────────────────────────────────────────────────── operations

export interface GcpOperation {
  name?: string;
  status?: "PENDING" | "RUNNING" | "DONE";
  zone?: string;
  region?: string;
  targetLink?: string;
  httpErrorStatusCode?: number;
  error?: { errors?: Array<{ code?: string; message?: string }> };
}

/** The last part of a URL ("…/zones/us-central1-a" → "us-central1-a"). */
export const lastPart = (value: string | undefined) => (value ?? "").split("/").filter(Boolean).pop() ?? "";

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);

    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** How long to keep waiting on one operation before saying so. */
const OPERATION_PATIENCE_MS = 30 * 60_000;

/** Waits until the operation is DONE; throws its error, in plain words, when it failed. */
export async function waitOperation(ctx: EditorHostContext, client: GcpClient, operation: GcpOperation, doing: string, context: { name?: string; what?: string }): Promise<GcpOperation> {
  const scope = operation.zone ? `zones/${lastPart(operation.zone)}` : operation.region ? `regions/${lastPart(operation.region)}` : "global";
  const path = `projects/${encodeURIComponent(client.project)}/${scope}/operations/${encodeURIComponent(operation.name ?? "")}/wait`;
  const started = Date.now();
  let current = operation;
  let delay = 50;

  if (!operation.name) throw new HostingError("host", `Google Cloud didn't say how to follow the step to ${doing}. Remove what was made here and try again.`, "an operation without a name");
  while (current.status !== "DONE") {
    if (Date.now() - started > OPERATION_PATIENCE_MS) throw new HostingError("host", `Google Cloud took more than half an hour to ${doing}. Look in the Google Cloud console; remove what was made here and try again.`);
    if (ctx.signal?.aborted) throw new HostingError("host", "It was stopped before it finished.");
    const asked = Date.now();
    const response = await client.call<GcpOperation>("gcp-compute", "POST", path);

    if (!response.ok) throw gcpFailure(response, "POST", path, doing, { project: client.project, ...context });
    current = response.body ?? {};
    // `wait` is best effort: when it came back at once without being done, pause a little before asking again.
    if (current.status !== "DONE" && Date.now() - asked < 1000) {
      await pause(delay, ctx.signal);
      delay = Math.min(delay * 2, 5000);
    }
  }
  const failure = current.error?.errors?.[0];

  if (failure) {
    const code = failure.code ?? "";
    const synthetic: ApiResponse<GoogleError> = {
      status: current.httpErrorStatusCode ?? 400,
      ok: false,
      body: { error: { code: current.httpErrorStatusCode ?? 400, message: failure.message ?? code, errors: [{ reason: code, message: failure.message ?? "" }] } },
      text: JSON.stringify(current.error).slice(0, 2000),
      headers: new Headers(),
    };

    throw gcpFailure(synthetic, "operation", lastPart(current.targetLink) || operation.name, doing, { project: client.project, ...context });
  }
  return current;
}
