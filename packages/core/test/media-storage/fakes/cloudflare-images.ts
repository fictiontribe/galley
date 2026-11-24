/**
 * A strict stand-in for Cloudflare Images: the API (as Cloudflare's docs
 * describe it on 24 November 2026) and the delivery origin.
 *
 * From the docs:
 *  - POST   /client/v4/accounts/:account/images/v1           multipart `file` + `metadata` (JSON, ≤ 1024 bytes)
 *  - GET    /client/v4/accounts/:account/images/v1/:id       the id fully URL-encoded
 *  - GET    /client/v4/accounts/:account/images/v1/:id/blob  the original bytes
 *  - DELETE /client/v4/accounts/:account/images/v1/:id
 *  - GET    /client/v4/accounts/:account/images/v2           per_page 10–10,000, continuation_token
 *  - every answer is { success, errors: [{ code, message }], messages, result };
 *  - uploads: PNG, JPEG, GIF, WebP, SVG; at most 10 MB;
 *  - permissions: Images Write to upload or delete; Images Read (or Write) to read and list;
 *  - delivery: /<hash>/<id>/<variant> on imagedelivery.net, /cdn-cgi/imagedelivery/<hash>/<id>/<variant>
 *    on a domain of the account; flexible variants ("w=400,sharpen=3") only when turned on.
 *
 * Not in the docs, so shaped after Cloudflare's API as a whole and marked
 * "assumed" below — the rehearsal against the real service settles them:
 *  - a bad or under-permitted token: 403 with code 10000 "Authentication error";
 *  - an unknown account: 404 with code 7003 "Could not route to …";
 *  - storage not on the Paid plan: 403 with a sentence naming the plan;
 *  - a missing image: 404 with code 5404 "Image not found";
 *  - too large: 413.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeImage {
  id: string;
  filename: string;
  meta: Record<string, unknown>;
  uploaded: string;
  body: Buffer;
  type: string;
}

export interface FakeImagesAccount {
  id: string;
  hash: string;
  /** Storage is on the Images Paid plan. */
  paid: boolean;
  flexibleVariants: boolean;
  variants: Set<string>;
  images: Map<string, FakeImage>;
}

export interface FakeImagesToken {
  value: string;
  /** account id → "read" | "write". */
  accounts: Record<string, "read" | "write">;
}

export interface FakeImagesLog {
  method: string;
  path: string;
  status: number;
  code?: number;
  authorization: string | null;
}

export interface FakeImages {
  apiBase: string;
  /** "http://127.0.0.1:<port>" standing in for https://imagedelivery.net (paths /<hash>/…) and any proxied domain (/cdn-cgi/imagedelivery/…). */
  deliveryOrigin: string;
  accounts: Map<string, FakeImagesAccount>;
  tokens: Map<string, FakeImagesToken>;
  log: FakeImagesLog[];
  addAccount(id: string, options?: Partial<Pick<FakeImagesAccount, "hash" | "paid" | "flexibleVariants">>): FakeImagesAccount;
  addToken(token: FakeImagesToken): void;
  /** Rewrites a real delivery address onto the stand-in's origin (for `fetch` in tests). */
  local(url: string): string;
  close(): Promise<void>;
}

const MAX_BYTES = 10 * 1024 * 1024;

function sniff(body: Buffer): string | null {
  if (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (body[0] === 0xff && body[1] === 0xd8) return "image/jpeg";
  if (body.subarray(0, 6).toString("latin1") === "GIF89a" || body.subarray(0, 6).toString("latin1") === "GIF87a") return "image/gif";
  if (body.subarray(0, 4).toString("latin1") === "RIFF" && body.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(body.subarray(0, 512).toString("utf8"))) return "image/svg+xml";
  return null;
}

/** A minimal multipart/form-data reader: name → { filename?, type?, data }. */
function parseMultipart(body: Buffer, contentType: string): Map<string, { filename?: string; type?: string; data: Buffer }> {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const parts = new Map<string, { filename?: string; type?: string; data: Buffer }>();

  if (!boundary) return parts;
  const marker = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let at = body.indexOf(marker);

  while (at !== -1) {
    const start = at + marker.length;

    if (body.subarray(start, start + 2).toString() === "--") break;
    const next = body.indexOf(marker, start);
    const chunk = body.subarray(start + 2, next === -1 ? body.length : next - 2);
    const split = chunk.indexOf("\r\n\r\n");
    const head = chunk.subarray(0, split).toString("utf8");
    const data = chunk.subarray(split + 4);
    const name = /name="([^"]*)"/.exec(head)?.[1];

    if (name) parts.set(name, { data, ...(/filename="([^"]*)"/.exec(head) ? { filename: /filename="([^"]*)"/.exec(head)![1] } : {}), ...(/content-type:\s*([^\r\n]+)/i.exec(head) ? { type: /content-type:\s*([^\r\n]+)/i.exec(head)![1]!.trim() } : {}) });
    at = next;
  }
  return parts;
}

export async function startFakeImages(): Promise<FakeImages> {
  const accounts = new Map<string, FakeImagesAccount>();
  const tokens = new Map<string, FakeImagesToken>();
  const log: FakeImagesLog[] = [];

  function envelope(res: ServerResponse, status: number, result: unknown, error?: { code: number; message: string }): { status: number; code?: number } {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ success: !error, errors: error ? [error] : [], messages: [], result: error ? null : result }));
    return { status, ...(error ? { code: error.code } : {}) };
  }

  const record = (image: FakeImage, base: string, account: FakeImagesAccount) => ({
    id: image.id,
    filename: image.filename,
    meta: image.meta,
    uploaded: image.uploaded,
    requireSignedURLs: false,
    variants: [...account.variants].map((variant) => `${base}/${account.hash}/${image.id}/${variant}`),
  });

  function read(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  let deliveryOrigin = "";

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<{ status: number; code?: number }> {
    const url = new URL(req.url ?? "/", "http://fake");
    const match = /^\/client\/v4\/accounts\/([^/]+)\/images\/(v1|v2)(?:\/(.*))?$/.exec(url.pathname);

    if (!match) return envelope(res, 404, null, { code: 7000, message: "No route for that URI" });
    const [, accountId, version, rest = ""] = match;
    const account = accounts.get(accountId!);
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
    const token = tokens.get(bearer);

    // Assumed shapes (see the header): unknown account, then authentication.
    if (!account) return envelope(res, 404, null, { code: 7003, message: `Could not route to /accounts/${accountId}/images/${version}, perhaps your object identifier is invalid?` });
    const grant = token?.accounts[account.id];

    if (!token || !grant) return envelope(res, 403, null, { code: 10000, message: "Authentication error" });
    const writes = req.method === "POST" || req.method === "DELETE";

    if (writes && grant !== "write") return envelope(res, 403, null, { code: 10000, message: "Authentication error" });
    if (!account.paid) return envelope(res, 403, null, { code: 5403, message: "Cloudflare Images storage is available only with an Images Paid plan." });

    if (version === "v2" && req.method === "GET" && !rest) {
      const perPage = Number(url.searchParams.get("per_page") ?? 1000);

      if (!Number.isInteger(perPage) || perPage < 10 || perPage > 10_000) return envelope(res, 400, null, { code: 5400, message: "per_page must be between 10 and 10000" });
      const all = [...account.images.values()].sort((a, b) => a.uploaded.localeCompare(b.uploaded) || a.id.localeCompare(b.id));
      const after = url.searchParams.get("continuation_token");
      const start = after ? all.findIndex((image) => image.id === Buffer.from(after, "base64url").toString()) + 1 : 0;
      const page = all.slice(start, start + perPage);
      const more = start + perPage < all.length;

      return envelope(res, 200, { images: page.map((image) => record(image, "https://imagedelivery.net", account)), continuation_token: more ? Buffer.from(page[page.length - 1]!.id).toString("base64url") : null });
    }
    if (version !== "v1") return envelope(res, 404, null, { code: 7000, message: "No route for that URI" });
    if (req.method === "POST" && !rest) {
      const body = await read(req);

      if (body.byteLength > MAX_BYTES + 64 * 1024) return envelope(res, 413, null, { code: 5413, message: "Image file too large" });
      const parts = parseMultipart(body, req.headers["content-type"] ?? "");
      const file = parts.get("file");

      if (!file) return envelope(res, 400, null, { code: 5400, message: "Bad request: no file or url" });
      if (file.data.byteLength > MAX_BYTES) return envelope(res, 413, null, { code: 5413, message: "Image file too large" });
      const type = sniff(file.data);

      if (!type) return envelope(res, 415, null, { code: 5415, message: "Images must be uploaded as JPEG, PNG, GIF, WebP or SVG" });
      const metaText = parts.get("metadata")?.data.toString("utf8") ?? "{}";

      if (Buffer.byteLength(metaText) > 1024) return envelope(res, 400, null, { code: 5400, message: "Metadata must be at most 1024 bytes" });
      let meta: Record<string, unknown>;

      try {
        meta = JSON.parse(metaText) as Record<string, unknown>;
      } catch {
        return envelope(res, 400, null, { code: 5400, message: "Metadata must be JSON" });
      }
      const custom = parts.get("id")?.data.toString("utf8");
      const id = custom || randomUUID();

      if (custom && account.images.has(custom)) return envelope(res, 409, null, { code: 5409, message: "Resource already exists" });
      const image: FakeImage = { id, filename: file.filename ?? "image", meta, uploaded: new Date(Date.now() + account.images.size).toISOString(), body: file.data, type };

      account.images.set(id, image);
      return envelope(res, 200, record(image, "https://imagedelivery.net", account));
    }
    // The id is fully URL-encoded in the path.
    const blob = rest.endsWith("/blob");
    const id = decodeURIComponent(blob ? rest.slice(0, -"/blob".length) : rest);
    const image = account.images.get(id);

    if (!image) return envelope(res, 404, null, { code: 5404, message: "Image not found" });
    if (req.method === "GET" && blob) {
      res.writeHead(200, { "content-type": image.type });
      res.end(image.body);
      return { status: 200 };
    }
    if (req.method === "GET") return envelope(res, 200, record(image, "https://imagedelivery.net", account));
    if (req.method === "DELETE") {
      account.images.delete(id);
      return envelope(res, 200, {});
    }
    return envelope(res, 405, null, { code: 10405, message: "Method not allowed" });
  }

  const api: Server = createServer((req, res) => {
    void handle(req, res).then(
      (outcome) => log.push({ method: req.method ?? "GET", path: (req.url ?? "").split("?")[0]!, status: outcome.status, ...(outcome.code ? { code: outcome.code } : {}), authorization: req.headers.authorization ? "Bearer …" : null }),
      (error: unknown) => {
        res.writeHead(500);
        res.end(String(error));
      }
    );
  });

  /** Delivery: /<hash>/<id>/<variant> (imagedelivery.net) or /cdn-cgi/imagedelivery/<hash>/<id>/<variant> (a domain of the account). */
  const delivery: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0]!.replace(/^\/cdn-cgi\/imagedelivery/, "");
    const parts = path.split("/").slice(1);
    const account = [...accounts.values()].find((candidate) => candidate.hash === parts[0]);
    const variant = parts[parts.length - 1] ?? "";
    const id = decodeURIComponent(parts.slice(1, -1).join("/"));
    const image = account?.images.get(id);

    if (!account || !image) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("ERROR 9404: not found");
      return;
    }
    const flexible = /^[a-z]+=/.test(variant);

    if (!(account.variants.has(variant) || (flexible && account.flexibleVariants))) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("ERROR 9404: variant not found");
      return;
    }
    // Cloudflare picks the format from the browser's Accept header; the stand-in serves WebP to anyone who asks for it.
    const accept = String(req.headers.accept ?? "");
    const type = image.type === "image/svg+xml" ? image.type : accept.includes("image/webp") ? "image/webp" : image.type;

    res.writeHead(200, { "content-type": type, "cache-control": "public, max-age=172800" });
    res.end(image.body);
  });

  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => delivery.listen(0, "127.0.0.1", resolve));
  deliveryOrigin = `http://127.0.0.1:${(delivery.address() as AddressInfo).port}`;

  return {
    apiBase: `http://127.0.0.1:${(api.address() as AddressInfo).port}/client/v4`,
    deliveryOrigin,
    accounts,
    tokens,
    log,
    addAccount(id, options = {}) {
      const account: FakeImagesAccount = { id, hash: options.hash ?? `hash${id.slice(0, 8)}`, paid: options.paid ?? true, flexibleVariants: options.flexibleVariants ?? false, variants: new Set(["public"]), images: new Map() };

      accounts.set(id, account);
      return account;
    },
    addToken(token) {
      tokens.set(token.value, token);
    },
    local(url) {
      return url.replace(/^https:\/\/imagedelivery\.net/, deliveryOrigin).replace(/^https:\/\/[^/]+\/cdn-cgi\/imagedelivery/, `${deliveryOrigin}/cdn-cgi/imagedelivery`);
    },
    close: () => Promise.all([new Promise<void>((resolve) => api.close(() => resolve())), new Promise<void>((resolve) => delivery.close(() => resolve()))]).then(() => undefined),
  };
}
