/**
 * The parts of Cloudflare's API "Host the editor online" uses, shared by the
 * Cloudflare host (a tunnel and its DNS names) and by Fly.io (the three DNS
 * names, when the stored Cloudflare key may make them).
 *
 * From Cloudflare's docs, read 2026-11-23:
 *  - a key checks itself with GET /user/tokens/verify (status only, no
 *    permissions); an account-owned key with GET /accounts/:a/tokens/verify;
 *  - GET /accounts lists the accounts the key reaches; GET /zones the
 *    domains (needs Zone Read);
 *  - what a key may do is found by harmless reads (GET …/cfd_tunnel,
 *    GET /zones/:z/dns_records): a refused read is a missing permission. A
 *    read that works doesn't prove the matching write, and there is no
 *    harmless way to test a write — so a refused write at create time is
 *    turned into the very sentence a refused read gives;
 *  - DNS records take a `comment`, which is how this app tags the records
 *    it makes.
 * Permission names are the dashboard's: Account › Cloudflare Tunnel › Edit,
 * Zone › DNS › Edit, Zone › Zone › Read.
 */
import { HostingError } from "./errors";
import { apiRequest, describe, type ApiResponse } from "./http";
import type { EditorHostContext, EditorHostGap } from "./types";

export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const NAME = "Cloudflare";
const TOKENS_PAGE = "https://dash.cloudflare.com/profile/api-tokens";

interface Envelope<T> {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: T;
}

export interface CfZone {
  id: string;
  name: string;
  account?: { id?: string; name?: string };
}

export interface CfRecord {
  id: string;
  type?: string;
  name?: string;
  content?: string;
  proxied?: boolean;
  comment?: string | null;
}

export function zoneListGap(blocking: boolean): EditorHostGap {
  return {
    what: "The Cloudflare key can't list your domains: it needs Zone › Zone › Read.",
    where: "On Cloudflare, open My Profile › API Tokens, edit the key and add Zone › Zone › Read under Permissions.",
    url: TOKENS_PAGE,
    blocking,
  };
}

export function dnsGap(zone: string, blocking: boolean): EditorHostGap {
  return {
    what: `The Cloudflare key can't change the DNS of ${zone}: it needs Zone › DNS › Edit.`,
    where: `On Cloudflare, open My Profile › API Tokens, edit the key, add Zone › DNS › Edit under Permissions and include ${zone} under Zone Resources.`,
    url: TOKENS_PAGE,
    blocking,
  };
}

export function tunnelGap(account: string): EditorHostGap {
  return {
    what: `The Cloudflare key can't make tunnels in the account “${account}”: it needs Account › Cloudflare Tunnel › Edit.`,
    where: "On Cloudflare, open My Profile › API Tokens, edit the key, add Account › Cloudflare Tunnel › Edit under Permissions and include that account under Account Resources.",
    url: TOKENS_PAGE,
    blocking: true,
  };
}

/** A gap as the one sentence an error says. */
export function gapSentence(gap: EditorHostGap): string {
  return `${gap.what} ${gap.where} Then try again.`;
}

const KEY_REFUSED = "Cloudflare didn't accept the access key. It may have been deleted or have expired. Create a new one and paste it here.";

const codesOf = (response: ApiResponse<Envelope<unknown>>) => (response.body?.errors ?? []).map((error) => error.code);

/** 401, or Cloudflare's "invalid token" codes: a key Cloudflare doesn't know. */
export function isRefusedKey(response: ApiResponse<Envelope<unknown>>): boolean {
  const codes = codesOf(response);

  return response.status === 401 || codes.includes(9109) || codes.includes(6003) || codes.includes(6111);
}

export function cfFailure(response: ApiResponse<Envelope<unknown>>, method: string, path: string, doing: string, permission?: EditorHostGap): HostingError {
  const detail = describe(method, path, response);

  if (isRefusedKey(response)) return new HostingError("unauthorized", KEY_REFUSED, detail);
  if (response.status === 403) {
    return new HostingError("permission", permission ? gapSentence(permission) : `Cloudflare didn't let the access key ${doing}. Check the key's permissions on Cloudflare (My Profile › API Tokens), then try again.`, detail);
  }
  if (response.status === 429) return new HostingError("rate-limited", "Cloudflare is asking for a pause. Wait a minute, then try again.", detail);
  const message = response.body?.errors?.[0]?.message;

  return new HostingError("host", `Cloudflare couldn't ${doing}${message ? `: “${message.slice(0, 200)}”` : ""}. Try again in a moment.`, detail);
}

export function cfRaw<T>(ctx: EditorHostContext, key: string, method: string, path: string, init: { json?: unknown; query?: Record<string, string | undefined> } = {}): Promise<ApiResponse<Envelope<T>>> {
  return apiRequest<Envelope<T>>(ctx, "cloudflare", NAME, { method, path, key, ...(init.json !== undefined ? { json: init.json } : {}), ...(init.query ? { query: init.query } : {}) });
}

export async function cf<T>(ctx: EditorHostContext, key: string, method: string, path: string, doing: string, init: { json?: unknown; query?: Record<string, string | undefined>; permission?: EditorHostGap } = {}): Promise<T> {
  const response = await cfRaw<T>(ctx, key, method, path, init);

  if (!response.ok || response.body?.success === false) throw cfFailure(response, method, path, doing, init.permission);
  return (response.body?.result ?? (null as T)) as T;
}

/**
 * Whether Cloudflare knows the key: a user key verifies itself; an
 * account-owned key doesn't verify there, so it counts when it can list an
 * account and verifies against that account. Throws "unauthorized" otherwise.
 */
export async function checkCloudflareKey(ctx: EditorHostContext, key: string): Promise<void> {
  const verify = await cfRaw<{ status?: string }>(ctx, key, "GET", "user/tokens/verify");

  if (verify.ok && verify.body?.success !== false) {
    const status = verify.body?.result?.status;

    if (status && status !== "active") throw new HostingError("unauthorized", `Cloudflare says this access key is ${status}. Create a new one and paste it here.`, describe("GET", "user/tokens/verify", verify));
    return;
  }
  if (!isRefusedKey(verify) && verify.status !== 403 && verify.status !== 404) throw cfFailure(verify, "GET", "user/tokens/verify", "check the access key");
  const accounts = await cfRaw<Array<{ id?: string }>>(ctx, key, "GET", "accounts", { query: { per_page: "50" } });
  const first = accounts.ok ? accounts.body?.result?.find((account) => account.id)?.id : undefined;

  if (first) {
    const owned = await cfRaw<{ status?: string }>(ctx, key, "GET", `accounts/${encodeURIComponent(first)}/tokens/verify`);

    if (owned.ok && (owned.body?.result?.status ?? "active") === "active") return;
  }
  throw new HostingError("unauthorized", KEY_REFUSED, describe("GET", "user/tokens/verify", verify));
}

export async function listAccounts(ctx: EditorHostContext, key: string): Promise<Array<{ id: string; name: string }> | null> {
  const response = await cfRaw<Array<{ id?: string; name?: string }>>(ctx, key, "GET", "accounts", { query: { per_page: "50" } });

  // 403: a key without Account Settings › Read; the zones still name their accounts.
  if (response.status === 403) return null;
  if (!response.ok || response.body?.success === false) throw cfFailure(response, "GET", "accounts", "list your accounts");
  return (response.body?.result ?? []).filter((account) => account.id).map((account) => ({ id: account.id!, name: account.name?.trim() || account.id! }));
}

/** The domains the key can see, or null when it may not list them. */
export async function listZones(ctx: EditorHostContext, key: string): Promise<CfZone[] | null> {
  const response = await cfRaw<CfZone[]>(ctx, key, "GET", "zones", { query: { per_page: "50" } });

  if (response.status === 403) return null;
  if (!response.ok || response.body?.success === false) throw cfFailure(response, "GET", "zones", "list your domains");
  return (response.body?.result ?? []).filter((zone) => zone.id && zone.name).map((zone) => ({ ...zone, name: zone.name.toLowerCase() }));
}

/** The domain an address belongs to: the longest zone name it ends with. */
export function zoneFor(zones: CfZone[], host: string): CfZone | null {
  return zones.filter((zone) => host === zone.name || host.endsWith(`.${zone.name}`)).sort((a, b) => b.name.length - a.name.length)[0] ?? null;
}

/** Whether the key may read the zone's DNS records (harmless; a refusal means no Zone › DNS permission). */
export async function canReadDns(ctx: EditorHostContext, key: string, zoneId: string): Promise<boolean> {
  const path = `zones/${encodeURIComponent(zoneId)}/dns_records`;
  const response = await cfRaw<unknown[]>(ctx, key, "GET", path, { query: { per_page: "1" } });

  if (response.status === 403) return false;
  if (!response.ok || response.body?.success === false) throw cfFailure(response, "GET", path, "read the domain's DNS records");
  return true;
}

/** Records already called `name` in a zone. */
export async function recordsNamed(ctx: EditorHostContext, key: string, zoneId: string, name: string): Promise<CfRecord[]> {
  return (await cf<CfRecord[]>(ctx, key, "GET", `zones/${encodeURIComponent(zoneId)}/dns_records`, "read the domain's DNS records", { query: { name, per_page: "50" } })) ?? [];
}

/** A CNAME unless `type` says otherwise (an A record to a fixed address, for Google Cloud). */
export async function createRecord(ctx: EditorHostContext, key: string, zone: CfZone, record: { name: string; content: string; proxied: boolean; comment: string; type?: "CNAME" | "A" }): Promise<CfRecord> {
  const created = await cf<CfRecord>(ctx, key, "POST", `zones/${encodeURIComponent(zone.id)}/dns_records`, `add the DNS record for ${record.name}`, {
    json: { type: record.type ?? "CNAME", name: record.name, content: record.content, proxied: record.proxied, ttl: 1, comment: record.comment },
    permission: dnsGap(zone.name, true),
  });

  if (!created?.id) throw new HostingError("host", `Cloudflare didn't say which DNS record it made for ${record.name}. Try again.`, "POST dns_records returned no id");
  return created;
}

/** The record, or null when it is gone. */
export async function readRecord(ctx: EditorHostContext, key: string, zoneId: string, recordId: string): Promise<CfRecord | null> {
  const path = `zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`;
  const response = await cfRaw<CfRecord>(ctx, key, "GET", path);

  if (response.status === 404) return null;
  if (!response.ok || response.body?.success === false) throw cfFailure(response, "GET", path, "read a DNS record");
  return response.body?.result ?? null;
}

export async function deleteRecord(ctx: EditorHostContext, key: string, zoneId: string, recordId: string, name: string): Promise<void> {
  const path = `zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`;
  const response = await cfRaw<unknown>(ctx, key, "DELETE", path);

  // Already gone is what removing wanted.
  if (response.status === 404) return;
  if (!response.ok || response.body?.success === false) throw cfFailure(response, "DELETE", path, `delete the DNS record for ${name}`);
}

/** A DNS record's resource id carries its zone, so removing needs nothing else: "<zone id>/<record id>". */
export function recordResourceId(zoneId: string, recordId: string): string {
  return `${zoneId}/${recordId}`;
}

export function splitRecordId(id: string): { zoneId: string; recordId: string } | null {
  const [zoneId, recordId, ...rest] = id.split("/");

  return zoneId && recordId && rest.length === 0 ? { zoneId, recordId } : null;
}
