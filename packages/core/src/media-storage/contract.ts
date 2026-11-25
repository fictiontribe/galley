/**
 * The HTTP contract for keeping a site's media outside the repository — in a
 * bucket, and pictures optionally in Cloudflare Images: what the app is told
 * about each connector, the site's media storage status, the check, moving
 * media and deleting from a store. Types only, so the web app and its
 * fixture backend import it freely.
 */
import type { Job, MediaImagesConfig, MediaItem, MediaLocation, MediaStorageConfig } from "../types";

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
  /** Connected before pictures were marked as this site's: only the pictures already known are shown until it is connected again. */
  needsReconnect?: boolean;
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
  /** The move of files running now: a "media" job, whose progress arrives as job events. */
  moving?: Job;
  /** How the last move ended. Kept until the next one, so it can still be read on coming back. */
  lastMove?: MediaMoveResult;
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

/**
 * How a move of files (or a change of address) ended. A file that stays in
 * the repository because something the site is built from still uses it is
 * how a move is meant to go, so it is told in `stayed`, not as a problem.
 */
export interface MediaMoveResult {
  /** When it ended, ms. */
  at: number;
  /** What was asked for. */
  request: MediaMoveRequest;
  /** "done": it worked. "error": something in `problems` went wrong, or it stopped and `summary` says why. */
  state: "done" | "error";
  /** What happened, in a few sentences: how many files were copied, pages updated, files removed, and what stayed where. */
  summary: string;
  copied: number;
  pages: number;
  /** Galley's page templates the move updated. */
  templates?: number;
  removed: number;
  /** Files beside the site as built that name a moved file: not changed (the first few hundred). */
  alsoMentioned?: string[];
  /** As in the plan: for a file in `stayed` that is outside what the site says it is built from, the files that read it. */
  readBy?: Record<string, string[]>;
  /** Repository files that stayed because something still uses them, each with the files that do (the first few hundred). */
  stayed: Array<{ path: string; pages: string[] }>;
  /** How many stayed in all. */
  stayedFiles: number;
  /** What couldn't be copied, updated or removed, and why (the first few hundred). */
  problems: Array<{ path: string; reason: string }>;
}

export interface MediaMovePlan {
  kind: "move" | "address";
  from?: MediaLocation;
  to?: MediaLocation;
  /** address: whose address changes. */
  store?: MediaStoreLocation;
  /** Files to copy. */
  files: number;
  bytes: number;
  /** Places that will be rewritten, and in how many pages. Only what the move updates is counted. */
  references: number;
  pages: number;
  /**
   * Of Galley's own page templates (the files the site's settings name),
   * how many the move updates too, so a page made from one later doesn't
   * carry an address that is gone. They are written in build mode, so only
   * when the site allows it and the person whose move this is may use it;
   * otherwise they are left and listed in `leftAlone`.
   */
  templates?: number;
  /** Files already there from an earlier run (skipped, not copied again). */
  done: number;
  /** Files that can't be moved and why. */
  problems: Array<{ path: string; reason: string }>;
  /**
   * Repository files that stay even though the copies aren't kept, each with
   * every file that would still use it: something the site is built from
   * that a move doesn't change (its code, a data file content mode may not
   * write, a page template when build mode isn't allowed), or a page that
   * holds the address in a form Galley doesn't change. Worked out by the
   * move's own steps, so the result names the same.
   */
  stillMentioned?: Array<{ path: string; pages: string[] }>;
  /** Of the files that keep one, those a move doesn't change. */
  leftAlone?: string[];
  /**
   * Why a file outside what the site says it is built from keeps one all the
   * same: the files inside it that read it, by a relative path written out
   * in them (an import, a file the code opens, a glob). Keyed by the file in
   * `leftAlone`. An alias, a path put together at run time or a file reached
   * through a second file outside the list isn't followed: `build.sources`
   * in the settings is where a site says so.
   */
  readBy?: Record<string, string[]>;
  /**
   * Files that name something being moved but are no part of the site as
   * built (a README, a record kept beside the site, a script outside its
   * source): not changed, and they keep no file. What a site is built from
   * is its adapter's to say, with `build.sources` in the settings adding to it.
   */
  alsoMentioned?: string[];
  /** How many of the repository's copies the move removes: the files to copy, less those that stay. 0 when the copies are kept. */
  removes: number;
  /** Of the files to copy, how many aren't published yet: copied to a store, they are public at their addresses at once. */
  unpublished?: number;
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
