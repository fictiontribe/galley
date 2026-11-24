/**
 * The media store contract: a place outside the repository that keeps a
 * site's media and serves it at public addresses — a bucket (R2, S3, any
 * S3-compatible store), Cloudflare Images, or one a plugin adds.
 *
 * Stores differ in what they take and how they name and serve things, so a
 * store describes itself (`MediaStoreAbilities`) and the engine routes by
 * that description, never by which service it is:
 *
 *   - a bucket takes any file the library takes, Galley picks the name (the
 *     object key), the address is the public address plus the key, it lists,
 *     and it doesn't know pictures' sizes (the engine's cache does);
 *   - Cloudflare Images takes pictures only, up to its own limits, gives each
 *     an image id (Galley may suggest one), serves it at an address ending in
 *     a variant, lists, and knows nothing of sizes either.
 *
 * Every store keeps the same promises: a stored name is never overwritten
 * (`put` refuses with `StoreNameTaken`, and the engine tries the next name),
 * nothing secret appears in an answer, an error or a log, and an address read
 * back out of a page is recognised in every form the service serves it in.
 */
import type { MediaLocation } from "../types";
import type { MediaCheckStepId, MediaStoreFieldId, MediaStoreLocation } from "./contract";

export interface MediaStoreAbilities {
  /** Which files it takes. `types`: MIME types, or "any" for whatever the library takes. */
  accepts: { types: string[] | "any"; maxBytes: number; maxPixels?: number; maxSide?: number };
  /**
   * Who names a stored item: "galley" (the name is exactly what Galley asks
   * for) or "service" (the service gives an id back; Galley's name is a
   * suggestion it may keep).
   */
  naming: "galley" | "service";
  /**
   * How a public address is formed: "key" — the public address and the name;
   * "variant" — the name followed by a variant the service resizes to.
   */
  address: "key" | "variant";
  /** Whether it can list what it holds. */
  canList: boolean;
  /** Whether listing or `head` tells a picture's width and height without downloading it. */
  knowsDimensions: boolean;
}

/** One thing kept in a store. */
export interface StoredItem {
  /** The store's name for it: an object key, or an image id. */
  key: string;
  /** Its public address (for a variant store, with the default variant). */
  url: string;
  size: number | null;
  type: string | null;
  width?: number;
  height?: number;
  /** ms. */
  uploadedAt: number;
  /** The file's own name, when the store's name for it is an id ("coat.webp"). */
  name?: string;
}

export interface StorePutInput {
  /** The name Galley wants ("lowfield/coat.webp"): the key, or the suggested id. */
  name: string;
  data: Uint8Array;
  type: string;
  width?: number;
  height?: number;
}

/** Something else already has that name. The engine tries the next one ("coat-2.webp"). */
export class StoreNameTaken extends Error {
  constructor(name: string) {
    super(`Something is already stored as “${name}”.`);
    this.name = "StoreNameTaken";
  }
}

/**
 * The service refused or failed, in words a person can act on. `step` and
 * `field` say where, `detail` the service's own code and message (never a
 * secret).
 */
export class StoreError extends Error {
  readonly step: MediaCheckStepId | null;
  readonly field: MediaStoreFieldId | null;
  readonly detail: string | null;
  /** Retrying later may work (network, rate limit). */
  readonly transient: boolean;

  constructor(message: string, options: { step?: MediaCheckStepId | null; field?: MediaStoreFieldId | null; detail?: string | null; transient?: boolean } = {}) {
    super(message);
    this.name = "StoreError";
    this.step = options.step ?? null;
    this.field = options.field ?? null;
    this.detail = options.detail ?? null;
    this.transient = options.transient ?? false;
  }
}

export interface MediaStore {
  readonly location: MediaStoreLocation;
  /** "r2", "s3", "s3-compatible", "cloudflare-images", or a plugin's. */
  readonly connector: string;
  /** "Cloudflare R2". */
  readonly name: string;
  readonly abilities: MediaStoreAbilities;
  /** The service answers, and the key may at least look (the check's "reach" step). */
  reach(): Promise<void>;
  /** Stores bytes under a new name; never replaces anything (StoreNameTaken). */
  put(input: StorePutInput): Promise<StoredItem>;
  /** What is stored under a name, without the bytes; null when nothing is. */
  head(key: string): Promise<StoredItem | null>;
  /** The bytes (the original, not a variant); null when nothing is stored under the name. */
  get(key: string): Promise<Uint8Array | null>;
  /** Removes one item. Removing what isn't there succeeds. */
  delete(key: string): Promise<void>;
  /** One page of what the store holds for this site. Only when `abilities.canList`. */
  list?(cursor?: string): Promise<{ items: StoredItem[]; next: string | null }>;
  /** The public address of a name. */
  urlOf(key: string): string;
  /**
   * Whether a name is one of this site's: inside its folder, with no empty,
   * "." or ".." part. Every read, delete and move back asks first.
   */
  ownsKey(key: string): boolean;
  /** The name a file asked for at `relative` ("team/ana.webp") is stored under: the bucket adds the site's folder. */
  keyFor(relative: string): string;
  /**
   * An extended regular expression (POSIX ERE and JavaScript alike) matching
   * this store's addresses in any form it serves them, for finding where
   * pages use them. Matches may carry trailing punctuation; `keyOf` decides.
   */
  addressPattern(): string;
  /**
   * The name behind an address found in a page, in any form the service
   * serves it (another variant, a resizing option, a custom domain); null
   * when the address isn't one of this store's.
   */
  keyOf(url: string): string | null;
  /** The address with a different public address in front (changing a bucket's address). Only for "key" stores. */
  rebase?(url: string, publicUrl: string): string | null;
  /**
   * Other addresses that reach the same files, which pages might use: a
   * bucket's own S3 address. Used only to find references, never to write them.
   */
  otherBases?(): string[];
  /** What to tell the person when the public address doesn't serve a stored file the way it should. */
  publicProblem?(kind: PublicProblem, url: string): string;
}

/** missing: 404; refused: 401/403; different: other bytes (or not a picture); unreachable: no answer. */
export type PublicProblem = "missing" | "refused" | "different" | "unreachable";

/** What a file is, for routing: its type, size and (for pictures) pixel size. */
export interface FileFacts {
  type: string;
  size: number;
  width?: number;
  height?: number;
}

/** Why a store won't take a file, in one sentence; null when it will. */
export function refusal(store: Pick<MediaStore, "abilities" | "name">, file: FileFacts): string | null {
  const { accepts } = store.abilities;

  if (accepts.types !== "any" && !accepts.types.includes(file.type)) return `${store.name} takes only pictures (${describeTypes(accepts.types)}).`;
  if (file.size > accepts.maxBytes) return `${store.name} takes files up to ${megabytes(accepts.maxBytes)}.`;
  if (file.width && file.height) {
    if (accepts.maxSide && Math.max(file.width, file.height) > accepts.maxSide) return `${store.name} takes pictures up to ${accepts.maxSide.toLocaleString("en")} pixels on a side.`;
    if (accepts.maxPixels && file.width * file.height > accepts.maxPixels) return `${store.name} takes pictures up to ${Math.round(accepts.maxPixels / 1_000_000)} megapixels.`;
  }
  return null;
}

const TYPE_NAMES: Record<string, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPG",
  "image/webp": "WebP",
  "image/avif": "AVIF",
  "image/gif": "GIF",
  "image/svg+xml": "SVG",
  "image/heic": "HEIC",
  "application/pdf": "PDF",
  "video/mp4": "MP4",
};

function describeTypes(types: string[]): string {
  const names = types.map((type) => TYPE_NAMES[type] ?? type);

  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : (names[0] ?? "");
}

function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/** Where one file goes, and why it didn't go to a store that was tried first. */
export interface Placement {
  location: MediaLocation;
  store: MediaStore | null;
  /** Each store that was tried first and why it didn't take the file. */
  passedOver: Array<{ location: MediaStoreLocation; reason: string }>;
}

/**
 * The store a new file goes to: the first of `stores` (most specific first:
 * Cloudflare Images for pictures, then the bucket) that takes it, else the
 * repository.
 */
export function placeFile(stores: MediaStore[], file: FileFacts): Placement {
  const passedOver: Placement["passedOver"] = [];

  for (const store of stores) {
    const reason = refusal(store, file);

    if (!reason) return { location: store.location, store, passedOver };
    passedOver.push({ location: store.location, reason });
  }
  return { location: "repository", store: null, passedOver };
}

/** A name's parts are all real names: none empty, none "." or "..", no backslash. */
export function cleanKey(key: string): boolean {
  return key.length > 0 && key.length <= 1024 && !key.includes("\\") && !key.includes("\0") && key.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/** "bucket:lowfield/coat.webp" → { location: "bucket", key: "lowfield/coat.webp" }; a repository path → null. */
export function parseStorePath(path: string): { location: MediaStoreLocation; key: string } | null {
  const match = /^(bucket|images):(.+)$/.exec(path);

  return match ? { location: match[1] as MediaStoreLocation, key: match[2]! } : null;
}

export function storePath(location: MediaStoreLocation, key: string): string {
  return `${location}:${key}`;
}

/** Characters an address found in a page can't contain: quotes, brackets, spaces and the like. Valid in ERE and JS alike. */
export const ADDRESS_TAIL = "[^\"'()<>{}|` ]+";

/** `text` with every regular expression character escaped (ERE and JS alike). */
export function escapePattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** An address as found in a page, without the punctuation that may follow it in prose or markup. */
export function trimFound(match: string): string {
  return match.replace(/[.,;:!\]]+$/, "");
}
