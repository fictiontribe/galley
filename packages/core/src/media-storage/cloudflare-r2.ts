/**
 * "Make the bucket for me" on Cloudflare: an R2 bucket and its r2.dev
 * address, made with the site's Cloudflare key for putting it online — which
 * needs Account › Workers R2 Storage › Edit (the API calls it "Workers R2
 * Storage Write"). From Cloudflare's API reference as read on 24 November 2026:
 *
 *   create   POST   /accounts/{account}/r2/buckets                     { name }
 *   r2.dev   PUT    /accounts/{account}/r2/buckets/{name}/domains/managed  { enabled: true } → { domain, enabled }
 *   remove   DELETE /accounts/{account}/r2/buckets/{name}
 *
 * The key for reading and writing files (an R2 API token's Access Key ID and
 * Secret) is still made by hand: making one through the API needs the power
 * to create API tokens, which a key for putting a site online shouldn't have.
 *
 * Not in the reference, so read by status and words (the rehearsal settles
 * them): a name already taken (409), R2 not yet turned on for the account,
 * a bucket that isn't empty when removing it.
 */
import { StoreError } from "./store";
import { CLOUDFLARE_API } from "./cloudflare-images";

interface Envelope<T> {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: T;
}

export interface R2Context {
  account: string;
  token: string;
  fetch?: typeof fetch;
  apiBase?: string;
}

async function call<T>(context: R2Context, method: string, path: string, body?: unknown): Promise<{ status: number; data: Envelope<T> | null }> {
  const doFetch = context.fetch ?? fetch;
  let response: Response;

  try {
    response = await doFetch(`${(context.apiBase ?? CLOUDFLARE_API).replace(/\/+$/, "")}/accounts/${context.account}/r2/buckets${path}`, {
      method,
      headers: { authorization: `Bearer ${context.token}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new StoreError("Couldn't reach Cloudflare. Check this computer's internet connection and try again.", { detail: error instanceof Error ? error.message : String(error), transient: true });
  }
  return { status: response.status, data: (await response.json().catch(() => null)) as Envelope<T> | null };
}

function explain(status: number, data: Envelope<unknown> | null, name: string): StoreError {
  const first = data?.errors?.[0];
  const said = first?.message ?? "";
  const detail = `${status}${first ? ` ${first.code}: ${said}` : ""}`;

  if (/not enabled|subscri|purchase|checkout|enable r2/i.test(said)) return new StoreError("R2 isn't turned on for this Cloudflare account yet. Open R2 in the dashboard and finish Cloudflare's checkout (it has a free monthly allowance), then try again.", { detail });
  if (first?.code === 10000 || status === 401 || status === 403) {
    return new StoreError("The site's Cloudflare key (the one for putting it online) can't make buckets. On Cloudflare, edit that token (My Profile › API Tokens), add Account › Workers R2 Storage › Edit, and try again — or make the bucket by hand.", { field: "account", detail });
  }
  if (/not empty/i.test(said)) return new StoreError(`“${name}” still has files in it, so it wasn't removed. Move or delete them first.`, { detail });
  if (status === 409 || /already exists/i.test(said)) return new StoreError(`A bucket called “${name}” already exists. Choose another name.`, { field: "bucket", detail });
  if (status === 404 && /account|route|identifier/i.test(said)) return new StoreError("Cloudflare doesn't know that account ID.", { field: "account", detail });
  if (status >= 500) return new StoreError("Cloudflare had a problem on its side. Try again in a minute.", { detail, transient: true });
  return new StoreError(`Cloudflare refused (${detail}).`, { detail });
}

/** Makes the bucket and turns on its r2.dev address. Returns that address. */
export async function makeR2Bucket(context: R2Context, name: string): Promise<{ publicUrl: string }> {
  const created = await call(context, "POST", "", { name });

  if (!created.data?.success) throw explain(created.status, created.data, name);
  const managed = await call<{ domain?: string; enabled?: boolean }>(context, "PUT", `/${encodeURIComponent(name)}/domains/managed`, { enabled: true });

  if (!managed.data?.success || !managed.data.result?.domain) throw explain(managed.status, managed.data, name);
  return { publicUrl: `https://${managed.data.result.domain}` };
}

/** Removes a bucket Galley made. Cloudflare refuses one with files in it. */
export async function removeR2Bucket(context: R2Context, name: string): Promise<void> {
  const removed = await call(context, "DELETE", `/${encodeURIComponent(name)}`);

  if (removed.status === 404) return;
  if (!removed.data?.success) throw explain(removed.status, removed.data, name);
}
