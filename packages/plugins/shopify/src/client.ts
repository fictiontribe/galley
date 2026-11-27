/**
 * Talking to a store: where its two GraphQL APIs are, which token goes in
 * which header, and how every failure becomes one plain sentence.
 *
 * From Shopify's documentation (API version 2026-10, read 2026-11-23):
 * - Storefront API: POST https://{store}.myshopify.com/api/{version}/graphql.json.
 *   Tokenless (no header) reads products, collections, search and carts,
 *   with a query complexity limit of 1,000 (MAX_COMPLEXITY_EXCEEDED). A
 *   public token goes in X-Shopify-Storefront-Access-Token, a private one
 *   (server side only) in Shopify-Storefront-Private-Token.
 * - Admin GraphQL API: POST https://{store}.myshopify.com/admin/api/{version}/graphql.json
 *   with X-Shopify-Access-Token. Calculated query cost, a 1,000-point bucket
 *   restoring 50 points a second; THROTTLED in errors[].extensions.code;
 *   ACCESS_DENIED for a missing scope.
 * - Versions are named YYYY-MM, released quarterly; a retired version
 *   "falls forward", and X-Shopify-API-Version says which one answered.
 * - A Dev Dashboard app gets a 24-hour Admin token by POSTing
 *   grant_type=client_credentials to /admin/oauth/access_token.
 *
 * Errors are classified by HTTP status and documented error codes, never
 * by the wording of a message.
 */
import type { PluginContext } from "@galleycms/plugin-kit";

export const DEFAULT_API_VERSION = "2026-10";
const VERSION = /^\d{4}-(01|04|07|10)$/;

/** An error whose message is a sentence for the person; `detail` (scrubbed) is for the log. */
export class ShopifyError extends Error {
  constructor(
    readonly kind: "unconfigured" | "auth" | "scope" | "rate" | "unavailable" | "invalid" | "not-found",
    message: string,
    readonly detail = ""
  ) {
    super(message);
    this.name = "ShopifyError";
  }
}

export interface StoreConnection {
  /** "https://caddow.myshopify.com", or a local http address (a test store on this computer). */
  origin: string;
  /** What to call the store in messages: its host. */
  host: string;
  version: string;
  storefront: { kind: "private" | "public" | "tokenless"; token: string | null };
  admin: { token: string | null; clientId: string | null; clientSecret: string | null };
  allowEdits: boolean;
}

/**
 * The store address as people type it — "caddow", "caddow.myshopify.com",
 * "https://caddow.myshopify.com/admin" — as an origin. Plain http only for
 * this computer (a local test store); anything else must be https.
 */
export function storeOrigin(input: string): string {
  const raw = input.trim();

  if (!raw) throw new ShopifyError("unconfigured", "Add the store's address in the Shopify plugin's settings.");
  if (/^[a-z0-9][a-z0-9-]*$/i.test(raw)) return `https://${raw.toLowerCase()}.myshopify.com`;
  let url: URL;

  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new ShopifyError("invalid", `“${raw.slice(0, 80)}” isn't a store address. It looks like your-store.myshopify.com.`);
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";

  if (url.protocol === "http:" && !local) throw new ShopifyError("invalid", "The store's address has to start with https://.");
  if (url.username || url.password) throw new ShopifyError("invalid", "The store's address can't contain a user name or password.");
  return `${url.protocol}//${url.host}`;
}

/** The connection the settings describe. Throws when there isn't a store address yet. */
export function connectionFrom(settings: Readonly<Record<string, string | undefined>>): StoreConnection {
  const origin = storeOrigin(settings.storeDomain ?? "");
  const version = settings.apiVersion?.trim() || DEFAULT_API_VERSION;

  if (!VERSION.test(version)) throw new ShopifyError("invalid", `“${version}” isn't an API version. Versions look like ${DEFAULT_API_VERSION}.`);
  const privateToken = settings.storefrontPrivateToken?.trim() || null;
  const publicToken = settings.storefrontPublicToken?.trim() || null;

  return {
    origin,
    host: new URL(origin).host,
    version,
    storefront: privateToken ? { kind: "private", token: privateToken } : publicToken ? { kind: "public", token: publicToken } : { kind: "tokenless", token: null },
    admin: {
      token: settings.adminToken?.trim() || null,
      clientId: settings.adminClientId?.trim() || null,
      clientSecret: settings.adminClientSecret?.trim() || null,
    },
    allowEdits: /^(on|yes|true|1)$/i.test(settings.allowProductEdits?.trim() ?? ""),
  };
}

/** Cut every token out of text that could reach a message or a log. */
export function scrub(text: string, connection: StoreConnection | null): string {
  let out = text;
  const secrets = connection ? [connection.storefront.token, connection.admin.token, connection.admin.clientSecret] : [];

  for (const secret of secrets) if (secret && secret.length >= 4) out = out.split(secret).join("[redacted]");
  return out.replace(/shp(at|ss|ca|pa)_[A-Za-z0-9_]{8,}/g, "[redacted]").slice(0, 600);
}

export interface GraphQLResult<T> {
  data: T;
  /** The version that actually answered (X-Shopify-API-Version). */
  version: string | null;
  cost?: { requestedQueryCost?: number; actualQueryCost?: number | null; throttleStatus?: { maximumAvailable: number; currentlyAvailable: number; restoreRate: number } };
}

interface GraphQLBody<T> {
  data?: T;
  errors?: Array<{ message?: string; extensions?: { code?: string; requiredAccess?: string } }> | string;
  extensions?: GraphQLResult<T>["cost"] extends infer C ? { cost?: C } : never;
}

type Api = "storefront" | "admin";

function classify(api: Api, status: number, body: GraphQLBody<unknown> | null, connection: StoreConnection): ShopifyError {
  const errors = Array.isArray(body?.errors) ? body!.errors : [];
  const codes = errors.map((error) => error.extensions?.code ?? "");
  const detail = scrub(`${api} ${status} ${codes.join(",")} ${errors.map((error) => error.message ?? "").join(" | ")} ${typeof body?.errors === "string" ? body.errors : ""}`, connection);
  const fail = (kind: ShopifyError["kind"], message: string) => new ShopifyError(kind, message, detail);

  if (status === 401) {
    return api === "admin"
      ? fail("auth", `${connection.host} didn't accept the Admin API token in the Shopify plugin's settings. Add a fresh one (or the app's client ID and secret) and try again.`)
      : fail("auth", `${connection.host} didn't accept the Storefront API token in the Shopify plugin's settings. Check it, or leave it empty to read the store without one.`);
  }
  if (status === 402) return fail("unavailable", `${connection.host} is frozen: the store's bill needs paying before it answers again.`);
  if (status === 403) return fail("unavailable", `${connection.host} refused to answer (the store is marked as unavailable).`);
  if (status === 404) return fail("not-found", `There's no store at ${connection.host}. Check the address in the Shopify plugin's settings.`);
  if (status === 423) return fail("unavailable", `${connection.host} is locked and isn't answering right now.`);
  if (status === 429 || codes.includes("THROTTLED")) return fail("rate", `${connection.host} is limiting requests right now. Wait a minute, then try again.`);
  if (status === 430) return fail("unavailable", `${connection.host} turned the request away as suspicious. Try again later.`);
  if (status >= 500) return fail("unavailable", `${connection.host} had a problem answering. Try again in a minute.`);
  if (codes.includes("ACCESS_DENIED")) {
    const needed = errors.map((error) => error.extensions?.requiredAccess?.match(/`([a-z_]+)`/)?.[1]).find(Boolean);

    return needed
      ? fail("scope", `The app connected to ${connection.host} doesn't have the ${needed} permission. Add it to the app's access scopes, release the version, approve it on the store, then try again.`)
      : fail("scope", api === "admin" ? `The Admin API token for ${connection.host} doesn't allow this.` : `${connection.host} doesn't allow this without a Storefront API token: reading without one can't see it.`);
  }
  if (codes.includes("MAX_COMPLEXITY_EXCEEDED") || codes.includes("MAX_COST_EXCEEDED")) return fail("invalid", `That asked ${connection.host} for too much at once. Ask for fewer items.`);
  if (codes.includes("SHOP_INACTIVE")) return fail("unavailable", `${connection.host} isn't active.`);
  return fail("invalid", `${connection.host} couldn't answer that request.`);
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);

    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new ShopifyError("unavailable", "Stopped."));
      },
      { once: true }
    );
  });

/** How long to wait before trying a THROTTLED Admin request again: until the bucket refills enough, at most 4 seconds. */
export function throttleWait(cost: GraphQLResult<unknown>["cost"]): number {
  const status = cost?.throttleStatus;
  const wanted = cost?.requestedQueryCost ?? 50;

  if (!status || status.restoreRate <= 0) return 1000;
  return Math.min(4000, Math.max(250, Math.ceil(((wanted - status.currentlyAvailable) / status.restoreRate) * 1000)));
}

export interface CallOptions {
  signal?: AbortSignal;
  /** Admin: the access token to send (resolved by admin.ts). */
  adminToken?: string;
  /** Attempts for a THROTTLED answer (Admin). */
  attempts?: number;
}

/** One GraphQL request to one of the store's APIs. Returns `data`, or throws a ShopifyError. */
export async function graphql<T>(ctx: Pick<PluginContext, "fetch">, connection: StoreConnection, api: Api, query: string, variables: Record<string, unknown> = {}, options: CallOptions = {}): Promise<GraphQLResult<T>> {
  const url = api === "admin" ? `${connection.origin}/admin/api/${connection.version}/graphql.json` : `${connection.origin}/api/${connection.version}/graphql.json`;
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };

  if (api === "admin") headers["x-shopify-access-token"] = options.adminToken ?? "";
  else if (connection.storefront.kind === "private") headers["shopify-storefront-private-token"] = connection.storefront.token!;
  else if (connection.storefront.kind === "public") headers["x-shopify-storefront-access-token"] = connection.storefront.token!;
  // No Shopify-Storefront-Buyer-IP: these requests come from the app, not from a shopper's visit.

  const attempts = options.attempts ?? 3;

  for (let attempt = 1; ; attempt++) {
    let response: Response;

    try {
      response = await ctx.fetch(url, { method: "POST", headers, body: JSON.stringify({ query, variables }), ...(options.signal ? { signal: options.signal } : {}) });
    } catch (error) {
      if (options.signal?.aborted) throw new ShopifyError("unavailable", "Stopped.");
      throw new ShopifyError("unavailable", `Couldn't reach ${connection.host}. Check the address and the internet connection, then try again.`, scrub(String(error), connection));
    }
    const text = await response.text();
    let body: GraphQLBody<T> | null = null;

    try {
      body = JSON.parse(text) as GraphQLBody<T>;
    } catch {
      body = null;
    }
    const version = response.headers.get("x-shopify-api-version");
    const throttled = Array.isArray(body?.errors) && body!.errors.some((error) => error.extensions?.code === "THROTTLED");

    if (throttled && attempt < attempts) {
      await sleep(throttleWait(body?.extensions?.cost), options.signal);
      continue;
    }
    if (!response.ok || !body || (Array.isArray(body.errors) && body.errors.length) || typeof body.errors === "string" || body.data === undefined) {
      if (response.ok && !body) throw new ShopifyError("invalid", `${connection.host} answered with something that isn't GraphQL. Check the store's address.`, scrub(text.slice(0, 200), connection));
      throw classify(api, response.status, body, connection);
    }
    return { data: body.data, version, ...(body.extensions?.cost ? { cost: body.extensions.cost } : {}) };
  }
}
