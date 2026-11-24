/**
 * The HTTP contract for keeping a site's media outside the repository — in a
 * bucket, and pictures optionally in Cloudflare Images: what the app is told
 * about each connector, the site's media storage status, the check, moving
 * media and deleting from a store. Types only, so the web app and its
 * fixture backend import it freely.
 */
import type { MediaImagesConfig, MediaItem, MediaLocation, MediaStorageConfig } from "../types";

/** A place media can be kept other than the repository. */
export type MediaStoreLocation = Exclude<MediaLocation, "repository">;

/** A value the person types in the "Connect a bucket" form. */
export type MediaStoreFieldId = "account" | "bucket" | "region" | "endpoint" | "prefix" | "publicUrl" | "accessKeyId" | "secretAccessKey" | "accountHash" | "variant" | "deliveryUrl" | "token";

export interface MediaStoreField {
  id: MediaStoreFieldId;
  label: string;
  /** One sentence: where to find it on the provider's side. */
  help: string;
  placeholder?: string;
  required: boolean;
  /** Kept in the site's key store, never in the site's files, never shown again. */
  secret?: boolean;
}

/** One numbered thing to do on the provider's side, with the provider's own button names. */
export interface MediaStoreStep {
  title: string;
  /** Sentences, in order. */
  text: string[];
  /** A direct link to the page the step happens on. */
  url?: string;
  linkLabel?: string;
  /** A block to copy, with the bucket name filled in by the app: the key's policy or the public-read policy. */
  copy?: "key-policy" | "public-policy";
}

export interface MediaStoreInfo {
  id: string;
  name: string;
  /** One line under the name. */
  blurb: string;
  /** Why it is recommended, when it is. */
  why?: string;
  recommended: boolean;
  /** Numbered, in the order they are done. */
  steps: MediaStoreStep[];
  fields: MediaStoreField[];
  /** What the key lets this app do, plainly. */
  keyGrants: string;
  /** Said once next to the public address: what the address is for and what it isn't. */
  publicNote: string;
  pricingUrl?: string;
  docsUrl?: string;
  /** A plugin's connector: the plugin's name. */
  plugin?: string;
}

/** Whether one key of the site is set, and where the one in use comes from. Never the value. */
export interface MediaKeyStatus {
  configured: boolean;
  source: "site" | "env" | null;
  /** Last four characters. */
  hint?: string;
}

/** What "Make the bucket for me" made on Cloudflare, so removing it removes that and nothing else. */
export interface MediaCreatedRecord {
  provider: "cloudflare";
  account: string;
  bucket: string;
  /** The public address it turned on ("pub-….r2.dev"). */
  publicUrl: string;
  createdAt: string;
}

/** The site's bucket connection (at most one). */
export interface MediaBucketStatus {
  connected: boolean;
  config: MediaStorageConfig | null;
  store: { id: string; name: string } | null;
  keys: { accessKeyId: MediaKeyStatus; secretAccessKey: MediaKeyStatus };
  created: MediaCreatedRecord | null;
  /** The public address is an r2.dev one: rate-limited, for trying out only. */
  trialAddress?: boolean;
}

/** Cloudflare Images for pictures (at most one). */
export interface MediaImagesStatus {
  connected: boolean;
  config: MediaImagesConfig | null;
  /** The token in use: the site's own (or the environment's), or the site's Cloudflare key for putting it online. */
  token: MediaKeyStatus & { use: "own" | "deploy" | null };
}

/** Connecting Cloudflare Images. `token` only when pasted; `useDeployKey`: use the site's Cloudflare key for putting it online. */
export interface MediaImagesConnectRequest {
  config: MediaImagesConfig;
  token?: string;
  useDeployKey?: boolean;
}

export interface MediaImagesConnectResult {
  check: MediaCheckResult;
  status?: MediaStorageStatus;
}

export interface MediaStorageStatus {
  bucket: MediaBucketStatus;
  images: MediaImagesStatus;
  /** How many files are kept where, when known. */
  counts?: Partial<Record<MediaLocation, number>>;
  /** "Make the bucket for me" on Cloudflare: possible with the site's Cloudflare key, or why not. */
  cloudflare: { keyStored: boolean };
}

export type MediaCheckStepId = "settings" | "reach" | "write" | "read" | "list" | "public" | "delete";

export interface MediaCheckStep {
  id: MediaCheckStepId;
  label: string;
  state: "ok" | "failed" | "skipped";
  /** What happened, one or two sentences, for a failed step. */
  message?: string;
  /** Which field to change, when the fix is one of them. */
  field?: MediaStoreFieldId;
}

export interface MediaCheckResult {
  ok: boolean;
  steps: MediaCheckStep[];
  /** The failed step's message. */
  message?: string;
  /** Technical detail behind a failure (the service's code and message). Never a secret. */
  detail?: string;
}

/** The form's values. Keys are sent only when the person pasted them; absent: the stored ones. */
export interface MediaConnectRequest {
  config: MediaStorageConfig;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface MediaConnectResult {
  check: MediaCheckResult;
  /** Present when the check passed and the settings and keys were saved. */
  status?: MediaStorageStatus;
}

export interface MediaUsage {
  url: string;
  /** Pages and data files of the working copy (published or not) that use it. */
  working: Array<{ path: string; title: string }>;
  /** Files of the last published version that use it. */
  published: string[];
}

/** Deleting from a store is for good and can't be discarded, so anything a page uses is refused. */
export interface MediaStoreDeleteResult {
  /** Library paths ("bucket:lowfield/coat.webp") that were deleted. */
  deleted: string[];
  /** Not deleted, because a page uses them (the working copy or the published version), and where. */
  refused: Array<{ path: string; name: string; working: string[]; published: string[] }>;
}

/**
 * Moving files between where they can be kept, or changing a store's public
 * address. `from`/`to` name places; Cloudflare Images takes pictures only, so
 * a move to it leaves everything else where it is (the plan says what).
 */
export type MediaMoveRequest =
  | {
      kind: "move";
      from: MediaLocation;
      to: MediaLocation;
      /** From the repository: keep the files there too (they are not removed). */
      keepCopies?: boolean;
    }
  | {
      kind: "address";
      store: MediaStoreLocation;
      /** The new public address. */
      publicUrl: string;
    };

export interface MediaMovePlan {
  kind: "move" | "address";
  from?: MediaLocation;
  to?: MediaLocation;
  /** address: whose address changes. */
  store?: MediaStoreLocation;
  /** Files to copy. */
  files: number;
  bytes: number;
  /** Places in the content that will be rewritten, and in how many files. */
  references: number;
  pages: number;
  /** Files already there from an earlier run (skipped, not copied again). */
  done: number;
  /** Files that can't be moved and why. */
  problems: Array<{ path: string; reason: string }>;
  /** Files the destination doesn't take (Cloudflare Images: anything but pictures within its limits), left where they are. */
  staying?: { files: number; reason: string };
  keepCopies: boolean;
  /** address: the address it changes to. */
  publicUrl?: string;
}

export interface MediaLibraryAnswer {
  items: MediaItem[];
  /** A store that couldn't be listed just now: one sentence each. Its items are the last ones known. */
  storeProblems?: Partial<Record<MediaStoreLocation, string>>;
}
