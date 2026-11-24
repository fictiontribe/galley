/**
 * The HTTP contract for keeping a site's media in a bucket: what the app is
 * told about each connector, the site's bucket status, the check, moving
 * media and deleting from the bucket. Types only, so the web app and its
 * fixture backend import it freely.
 */
import type { MediaItem, MediaStorageConfig } from "../types";

/** A value the person types in the "Connect a bucket" form. */
export type MediaStoreFieldId = "account" | "bucket" | "region" | "endpoint" | "prefix" | "publicUrl" | "accessKeyId" | "secretAccessKey";

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

export interface MediaStorageStatus {
  connected: boolean;
  config: MediaStorageConfig | null;
  store: { id: string; name: string } | null;
  keys: { accessKeyId: MediaKeyStatus; secretAccessKey: MediaKeyStatus };
  created: MediaCreatedRecord | null;
  /** How many files are kept where, when known. */
  counts?: { bucket: number; repository: number };
  /** The public address is an r2.dev one: rate-limited, for trying out only. */
  trialAddress?: boolean;
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

export interface MediaBucketDeleteResult {
  deleted: string[];
  /** Not deleted, because something uses them; where. */
  refused: Array<{ key: string; name: string; working: string[]; published: string[] }>;
}

export type MediaMoveDirection = "to-bucket" | "to-repository" | "address";

export interface MediaMoveRequest {
  direction: MediaMoveDirection;
  /** to-bucket: keep the files in the repository too (they are not removed). */
  keepCopies?: boolean;
  /** address: the new public address. */
  publicUrl?: string;
}

export interface MediaMovePlan {
  direction: MediaMoveDirection;
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
  keepCopies: boolean;
  /** address: the address it changes to. */
  publicUrl?: string;
}

export interface MediaLibraryAnswer {
  items: MediaItem[];
  /** Set when the bucket couldn't be listed just now: one sentence. The items are the last ones known. */
  bucketProblem?: string;
}
