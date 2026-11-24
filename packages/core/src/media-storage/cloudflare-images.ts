/**
 * Cloudflare Images as a media store: pictures only, resized and converted
 * to modern formats by Cloudflare, each served at an address that ends in a
 * variant. From Cloudflare's docs as read on 24 November 2026
 * (docs/media-storage.md lists the pages):
 *
 *   upload   POST   /accounts/{account}/images/v1          multipart: file, metadata (≤ 1024 bytes)
 *   details  GET    /accounts/{account}/images/v1/{id}     id fully URL-encoded
 *   original GET    /accounts/{account}/images/v1/{id}/blob
 *   delete   DELETE /accounts/{account}/images/v1/{id}
 *   list     GET    /accounts/{account}/images/v2          per_page 10–10,000, continuation_token
 *   delivery https://imagedelivery.net/<hash>/<id>/<variant>, or on a domain of the
 *            same account: https://<domain>/cdn-cgi/imagedelivery/<hash>/<id>/<variant>;
 *            with flexible variants on, the last part may be options ("w=400,sharpen=3").
 *
 * Every answer is Cloudflare's envelope: { success, errors: [{ code, message }], result }.
 *
 * Galley lets Cloudflare name each picture (its id): custom ids are allowed,
 * but the docs don't say what happens when one is already taken, and a name
 * that is never overwritten is the one promise every store keeps. The file's
 * own name and its pixel size travel in the picture's metadata, which every
 * listing returns — so sizes are known without downloading.
 *
 * Hosted storage needs the Images Paid plan; formats PNG, JPEG, GIF, WebP,
 * SVG (AVIF only on Enterprise); at most 10 MB, 12,000 px a side, 100 MP.
 */
import type { MediaImagesConfig } from "../types";
import type { MediaCheckStepId } from "./contract";
import { ADDRESS_TAIL, cleanKey, escapePattern, StoreError, type MediaStore, type StoredItem } from "./store";

export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
export const IMAGEDELIVERY = "https://imagedelivery.net";
export const IMAGES_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
export const IMAGES_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGES_MAX_SIDE = 12_000;
export const IMAGES_MAX_PIXELS = 100_000_000;
const TIMEOUT_MS = 60_000;

interface Envelope<T> {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: T;
}

interface ImageRecord {
  id: string;
  filename?: string;
  meta?: Record<string, unknown> | null;
  uploaded?: string;
  variants?: string[];
}

/** What Cloudflare answered, in its own words. */
export class ImagesApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
    message: string
  ) {
    super(message);
    this.name = "ImagesApiError";
  }
}

export interface ImagesStoreOptions {
  config: MediaImagesConfig;
  token: string;
  /** Where the token came from, for the sentences: the site's Cloudflare key for putting it online, or its own. */
  tokenSource?: "images" | "deploy";
  fetch?: typeof fetch;
  apiBase?: string;
  now?: () => number;
}

export function deliveryBase(config: Pick<MediaImagesConfig, "accountHash" | "deliveryUrl">): string {
  const origin = config.deliveryUrl ? `${config.deliveryUrl.replace(/\/+$/, "")}/cdn-cgi/imagedelivery` : IMAGEDELIVERY;

  return `${origin}/${config.accountHash}`;
}

/**
 * The image id behind a delivery address — imagedelivery.net or any domain's
 * /cdn-cgi/imagedelivery/ path, any variant or options — when it belongs to
 * this account hash; null otherwise.
 */
export function imageIdOf(accountHash: string, url: string): string | null {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const path = parsed.pathname;
  const prefix = parsed.origin === IMAGEDELIVERY ? `/${accountHash}/` : `/cdn-cgi/imagedelivery/${accountHash}/`;

  if (!path.startsWith(prefix)) return null;
  const parts = path.slice(prefix.length).split("/");

  if (parts.length < 2 || !parts[parts.length - 1]) return null;
  try {
    return parts.slice(0, -1).map(decodeURIComponent).join("/") || null;
  } catch {
    return null;
  }
}

export function createImagesStore(options: ImagesStoreOptions): MediaStore {
  const { config } = options;
  const doFetch = options.fetch ?? fetch;
  const api = `${(options.apiBase ?? CLOUDFLARE_API).replace(/\/+$/, "")}/accounts/${config.account}/images`;
  const variant = config.variant || "public";
  const base = deliveryBase(config);
  const now = options.now ?? Date.now;
  const tokenWords = options.tokenSource === "deploy" ? "The site's Cloudflare key (the one for putting it online)" : "The API token";

  async function call<T>(method: string, path: string, body?: FormData): Promise<{ status: number; data: Envelope<T> | null; raw: Response }> {
    let response: Response;

    try {
      response = await doFetch(`${api}${path}`, { method, headers: { authorization: `Bearer ${options.token}` }, ...(body ? { body } : {}), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw new StoreError("Couldn't reach Cloudflare. Check this computer's internet connection and try again.", { detail: error instanceof Error ? error.message : String(error), transient: true });
    }
    const type = response.headers.get("content-type") ?? "";

    if (!type.includes("json")) return { status: response.status, data: null, raw: response };
    return { status: response.status, data: (await response.json().catch(() => null)) as Envelope<T> | null, raw: response };
  }

  function explain(status: number, data: Envelope<unknown> | null, step: MediaCheckStepId): StoreError {
    const first = data?.errors?.[0];
    const code = first?.code ?? null;
    const said = first?.message ?? "";
    const detail = `${status}${code !== null ? ` ${code}` : ""}${said ? `: ${said}` : ""}`;

    if (code === 10000 || status === 401 || (status === 403 && /auth/i.test(said))) {
      return new StoreError(
        options.tokenSource === "deploy"
          ? "The site's Cloudflare key (the one for putting it online) doesn't have Cloudflare Images: Edit. On Cloudflare, edit that token (My Profile › API Tokens), add Account › Cloudflare Images › Edit, and check again — or paste a token of its own."
          : "Cloudflare doesn't accept that API token for Cloudflare Images in this account. Check it has Account › Cloudflare Images › Edit for this account, and that it was copied whole.",
        { step, field: "token", detail }
      );
    }
    if (code === 7003 || code === 7000 || (status === 404 && step === "reach")) {
      return new StoreError("Cloudflare doesn't know that Account ID. Copy it again from the account's home page in the dashboard (32 letters and digits).", { step, field: "account", detail });
    }
    // The docs say storage needs the Images Paid plan; they don't say how the API answers without it, so this reads its words.
    if (/paid|plan|subscri|entitle|not (enabled|available)|upgrade/i.test(said)) {
      return new StoreError("Cloudflare Images storage isn't turned on for this account. Keeping pictures in Images needs the Images Paid plan: turn it on under Images in the Cloudflare dashboard, then check again.", { step, detail });
    }
    if (status === 413 || /too large|size/i.test(said)) return new StoreError("Cloudflare Images takes pictures up to 10 MB.", { step, detail });
    if (status === 429) return new StoreError("Cloudflare is limiting requests just now. Try again in a minute.", { step, detail, transient: true });
    if (status >= 500) return new StoreError("Cloudflare had a problem on its side. Try again in a minute.", { step, detail, transient: true });
    return new StoreError(`Cloudflare Images refused (${detail}).`, { step, detail });
  }

  function itemOf(record: ImageRecord): StoredItem {
    const meta = (record.meta ?? {}) as Record<string, unknown>;
    const width = Number(meta.width);
    const height = Number(meta.height);
    const name = typeof meta.name === "string" && meta.name ? meta.name : (record.filename ?? record.id);

    return {
      key: record.id,
      url: `${base}/${encodeURIComponent(record.id)}/${variant}`,
      size: typeof meta.size === "number" ? meta.size : Number(meta.size) || null,
      type: typeof meta.type === "string" ? meta.type : typeFromName(name),
      ...(width > 0 && height > 0 ? { width, height } : {}),
      uploadedAt: Date.parse(record.uploaded ?? "") || now(),
      name,
    };
  }

  const store: MediaStore = {
    location: "images",
    connector: "cloudflare-images",
    name: "Cloudflare Images",
    abilities: {
      accepts: { types: IMAGES_TYPES, maxBytes: IMAGES_MAX_BYTES, maxSide: IMAGES_MAX_SIDE, maxPixels: IMAGES_MAX_PIXELS },
      naming: "service",
      address: "variant",
      canList: true,
      knowsDimensions: true,
    },

    async reach() {
      const { status, data } = await call("GET", "/v2?per_page=10");

      if (!data?.success) throw explain(status, data, "reach");
    },

    async put(input) {
      const form = new FormData();
      const name = input.name.split("/").pop() ?? input.name;
      const meta = { name, type: input.type, size: input.data.byteLength, ...(input.width && input.height ? { width: input.width, height: input.height } : {}), source: "galley" };

      form.append("file", new Blob([Buffer.from(input.data)], { type: input.type }), name);
      form.append("metadata", JSON.stringify(meta));
      const { status, data } = await call<ImageRecord>("POST", "/v1", form);

      if (!data?.success || !data.result?.id) throw explain(status, data, "write");
      return { ...itemOf({ ...data.result, meta: { ...meta, ...(data.result.meta ?? {}) } }) };
    },

    async head(key) {
      const { status, data } = await call<ImageRecord>("GET", `/v1/${encodeURIComponent(key)}`);

      if (status === 404) return null;
      if (!data?.success || !data.result) throw explain(status, data, "read");
      return itemOf(data.result);
    },

    async get(key) {
      const { status, data, raw } = await call("GET", `/v1/${encodeURIComponent(key)}/blob`);

      if (status === 404) return null;
      if (!raw.ok || data) throw explain(status, data, "read");
      return new Uint8Array(await raw.arrayBuffer());
    },

    async delete(key) {
      const { status, data } = await call("DELETE", `/v1/${encodeURIComponent(key)}`);

      if (status === 404) return;
      if (!data?.success) throw explain(status, data, "delete");
    },

    async list(cursor) {
      const { status, data } = await call<{ images?: ImageRecord[]; continuation_token?: string | null }>("GET", `/v2?per_page=1000${cursor ? `&continuation_token=${encodeURIComponent(cursor)}` : ""}`);

      if (!data?.success) throw explain(status, data, "list");
      return { items: (data.result?.images ?? []).map(itemOf), next: data.result?.continuation_token || null };
    },

    urlOf(key) {
      return `${base}/${encodeURIComponent(key)}/${variant}`;
    },

    ownsKey(key) {
      // The shape only: whether this site uploaded it is the site's record's to say (the service asks it too).
      return cleanKey(key);
    },

    keyFor(relative) {
      // A suggestion only: Cloudflare names the picture.
      return relative;
    },

    addressPattern() {
      const origins = [IMAGEDELIVERY, ...(config.deliveryUrl ? [`${config.deliveryUrl.replace(/\/+$/, "")}/cdn-cgi/imagedelivery`] : [])];

      return `(${origins.map(escapePattern).join("|")})/${escapePattern(config.accountHash)}/${ADDRESS_TAIL}`;
    },

    keyOf(url) {
      return imageIdOf(config.accountHash, url);
    },

    rebase(url, deliveryUrl) {
      const id = imageIdOf(config.accountHash, url);

      if (id === null) return null;
      const parsed = new URL(url);
      const last = parsed.pathname.split("/").pop() ?? variant;

      return `${deliveryBase({ accountHash: config.accountHash, ...(deliveryUrl && deliveryUrl.replace(/\/+$/, "") !== IMAGEDELIVERY ? { deliveryUrl } : {}) })}/${encodeURIComponent(id)}/${last}`;
    },

    publicProblem(kind) {
      switch (kind) {
        case "unreachable":
          return config.deliveryUrl ? `${new URL(config.deliveryUrl).host} doesn't answer. It has to be a domain proxied by Cloudflare in the same account as Images.` : "imagedelivery.net doesn't answer just now. Try again in a minute.";
        case "missing":
          return config.deliveryUrl
            ? `${new URL(config.deliveryUrl).host} doesn't deliver this account's pictures. It has to be a domain proxied by Cloudflare in the same account; check the account hash too.`
            : "The picture isn't delivered at its address. Check the account hash (Hosted Images › Developer Resources) and that the variant exists.";
        case "refused":
          return `The variant “${variant}” turns visitors away: it may require signed addresses. Choose a variant anyone can load (“public” is, unless it was changed).`;
        case "different":
          return "The delivery address answered with something that isn't a picture. Check the account hash and the variant name.";
      }
    },
  };
  return store;
}

function typeFromName(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" } as Record<string, string>)[ext] ?? null;
}
