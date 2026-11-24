/**
 * What each built-in bucket connector tells the person setting it up — the
 * steps on the provider's side with the provider's own button and permission
 * names, the fields to fill in, what the key allows — plus the two policies
 * the S3 steps ask them to paste, and the settings checks. Data and pure
 * functions only, with type-only imports, so the web app's fixture backend
 * can load this file on its own.
 *
 * Read from the providers' docs on 24 November 2026 (docs/media-storage.md
 * lists the pages).
 */
import type { MediaStorageConfig } from "../types";
import type { MediaStoreField, MediaStoreFieldId, MediaStoreInfo } from "./contract";

// ─────────────────────────────────────────────────────────────── fields

const FIELD = {
  account: {
    id: "account",
    label: "Account ID",
    help: "On Cloudflare's R2 Overview page, under “Account Details”. 32 letters and digits.",
    placeholder: "4f0c…",
    required: true,
  },
  bucketR2: {
    id: "bucket",
    label: "Bucket name",
    help: "The name you gave the bucket on Cloudflare.",
    placeholder: "lowfield-media",
    required: true,
  },
  bucketS3: {
    id: "bucket",
    label: "Bucket name",
    help: "The name you gave the bucket in the S3 console.",
    placeholder: "lowfield-media",
    required: true,
  },
  region: {
    id: "region",
    label: "Region",
    help: "The bucket's AWS Region code, shown next to it in the S3 console's list of buckets (“eu-west-1”, not “Europe (Ireland)”).",
    placeholder: "eu-west-1",
    required: true,
  },
  endpointR2: {
    id: "endpoint",
    label: "S3 address of a jurisdiction bucket",
    help: "Leave empty unless the bucket was made in a jurisdiction such as the EU: then copy its S3 API address from the bucket's Settings.",
    placeholder: "https://<account>.eu.r2.cloudflarestorage.com",
    required: false,
  },
  prefix: {
    id: "prefix",
    label: "Folder in the bucket",
    help: "Keeps this site's files together when several sites share a bucket. Letters, digits and dashes; Galley adds the slash.",
    placeholder: "lowfield",
    required: false,
  },
  publicUrlR2: {
    id: "publicUrl",
    label: "Public address",
    help: "The custom domain you connected to the bucket (https://media.example.com), or its r2.dev address for trying it out.",
    placeholder: "https://media.example.com",
    required: true,
  },
  publicUrlS3: {
    id: "publicUrl",
    label: "Public address",
    help: "Where visitors load the files from: your CloudFront or custom address, or the bucket's own (https://<bucket>.s3.<region>.amazonaws.com).",
    placeholder: "https://lowfield-media.s3.eu-west-1.amazonaws.com",
    required: true,
  },
  accessKeyId: {
    id: "accessKeyId",
    label: "Access Key ID",
    help: "Shown when the key is made. It isn't secret on its own.",
    required: true,
  },
  secretAccessKey: {
    id: "secretAccessKey",
    label: "Secret Access Key",
    help: "Shown once, when the key is made. Kept in this site's key store, never in the site's files, and never shown again.",
    required: true,
    secret: true,
  },
} satisfies Record<string, MediaStoreField>;

// ─────────────────────────────────────────────────────────────── connectors

export const R2_INFO: MediaStoreInfo = {
  id: "r2",
  name: "Cloudflare R2",
  blurb: "Files of any kind, served from your own address. No charge for visitors downloading them.",
  why: "R2 charges for what you store, not for visitors loading it, and it has a free monthly allowance — the cheapest place for a site's pictures, PDFs and video.",
  recommended: true,
  steps: [
    {
      title: "Make the bucket",
      text: [
        "In the Cloudflare dashboard, open Storage & databases › R2 › Overview. If Cloudflare asks, finish its checkout to add R2 to the account (it has a free monthly allowance).",
        "Select “Create bucket”. Name it with lowercase letters, digits and dashes (3 to 63 characters, not starting or ending with a dash), then create it.",
      ],
      url: "https://dash.cloudflare.com/?to=/:account/r2/overview",
      linkLabel: "Open R2 on Cloudflare",
    },
    {
      title: "Give it a public address",
      text: [
        "Open the bucket and select “Settings”. Under “Custom Domains”, select “Add”, type an address on a domain that is already in this Cloudflare account (media.example.com), select “Continue”, then “Connect Domain”.",
        "It changes from “Initializing” to “Active” within a few minutes. That address is what you paste below as the public address.",
        "Only trying it out? Under “Public Development URL” select “Enable”, type allow and select “Allow”. That r2.dev address is rate-limited and meant for development, so move to a custom domain before the site goes live.",
      ],
    },
    {
      title: "Make a key for this site only",
      text: [
        "Back on R2's Overview page, under “Account Details”, select “Manage” next to “API Tokens”, then “Create Account API token”.",
        "Under “Permissions”, choose “Object Read & Write”, and limit it to this one bucket rather than every bucket in the account.",
        "Select “Create Account API token”. Cloudflare shows an Access Key ID and a Secret Access Key: copy both now, the secret is shown only once.",
        "The Account ID is on the same Overview page, under “Account Details”.",
      ],
    },
  ],
  fields: [FIELD.account, FIELD.bucketR2, FIELD.publicUrlR2, FIELD.prefix, FIELD.endpointR2, FIELD.accessKeyId, FIELD.secretAccessKey],
  keyGrants:
    "With “Object Read & Write” on one bucket, the key can add, read, list and delete files in that bucket and nothing else: not your other buckets, domains, DNS or billing. Galley only ever writes new names and only deletes files nobody uses.",
  publicNote: "Visitors load the files from this address, so it goes into your pages as it is. Anyone with an address can open that file: keep private documents out of the bucket.",
  pricingUrl: "https://developers.cloudflare.com/r2/pricing/",
  docsUrl: "https://developers.cloudflare.com/r2/",
};

export const S3_INFO: MediaStoreInfo = {
  id: "s3",
  name: "Amazon S3",
  blurb: "For sites already on AWS. Files of any kind; AWS charges for storage and for what visitors download.",
  recommended: false,
  steps: [
    {
      title: "Make the bucket",
      text: [
        "In the S3 console, select “Create bucket”. Pick its AWS Region and a name of lowercase letters, digits and dashes (3 to 63 characters). Avoid dots in the name: a bucket with dots can't be reached over https at its own address.",
        "Leave “Object Ownership” as “Bucket owner enforced” (ACLs off), and create the bucket.",
      ],
      url: "https://console.aws.amazon.com/s3/",
      linkLabel: "Open the S3 console",
    },
    {
      title: "Let visitors read the files",
      text: [
        "Skip this if you put CloudFront in front of the bucket: use the CloudFront address as the public address instead.",
        "Open the bucket, choose “Permissions”. Under “Block public access (bucket settings)”, choose “Edit”, clear “Block all public access”, and choose “Save changes”. If the account's own Block Public Access settings are on, AWS says so there, and they need the same change.",
        "Still under “Permissions”, under “Bucket policy”, choose “Edit”, paste the policy below and choose “Save changes”. It lets anyone read files in this site's folder, and nothing else.",
      ],
      copy: "public-policy",
    },
    {
      title: "Make a user for this site",
      text: [
        "In the IAM console, choose “Users”, then “Create user”. Name it after the site (“lowfield-media”), leave console access off, choose “Next”, skip the permissions page with “Next”, then “Create user”.",
        "Open the new user. On the “Permissions” tab choose “Add permissions”, then “Create inline policy”. Choose “JSON”, replace what is there with the policy below, choose “Next”, give it a name and choose “Create policy”.",
      ],
      url: "https://console.aws.amazon.com/iam/home#/users",
      linkLabel: "Open IAM users",
      copy: "key-policy",
    },
    {
      title: "Make its access key",
      text: [
        "On the user's “Security credentials” tab, under “Access keys”, choose “Create access key”.",
        "AWS asks what it is for: choose “Other”, then “Next”, then “Create access key”.",
        "Choose “Show” and copy the Access key and the Secret access key now (or “Download .csv file”): the secret is shown only once.",
      ],
    },
  ],
  fields: [FIELD.bucketS3, FIELD.region, FIELD.publicUrlS3, FIELD.prefix, FIELD.accessKeyId, FIELD.secretAccessKey],
  keyGrants:
    "The policy lets the key list, add, read and delete files in this site's folder of this one bucket, and nothing else in your AWS account. Galley only ever writes new names and only deletes files nobody uses.",
  publicNote: "Visitors load the files from this address, so it goes into your pages as it is. Anyone with an address can open that file: keep private documents out of the bucket.",
  pricingUrl: "https://aws.amazon.com/s3/pricing/",
  docsUrl: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/",
};

export const S3_COMPATIBLE_INFO: MediaStoreInfo = {
  id: "s3-compatible",
  name: "Another S3-compatible store",
  blurb: "Backblaze B2, DigitalOcean Spaces, Wasabi, MinIO or any store that speaks the S3 API.",
  recommended: false,
  steps: [
    {
      title: "Make the bucket",
      text: [
        "In the store's console, make a bucket for the site. Note its exact name, the store's S3 address (its “endpoint”, starting with https://) and its region name, as the store shows them.",
      ],
    },
    {
      title: "Let visitors read the files",
      text: [
        "Make the bucket (or the site's folder in it) readable by anyone, or put a CDN in front of it. The address visitors load files from is the public address below.",
      ],
    },
    {
      title: "Make a key for this site only",
      text: [
        "Make an access key that can list, add, read and delete files in this one bucket, and nothing else. Copy its key ID and its secret: stores show the secret only once.",
      ],
    },
  ],
  fields: [
    { id: "endpoint", label: "S3 address", help: "The store's S3 API address for this bucket's region, starting with https:// (“https://s3.eu-central-003.backblazeb2.com”).", placeholder: "https://s3.eu-central-003.backblazeb2.com", required: true },
    { id: "region", label: "Region", help: "The region name the store gives with the address (“eu-central-003”, “nyc3”). If it gives none, “us-east-1” usually works.", placeholder: "us-east-1", required: true },
    { id: "bucket", label: "Bucket name", help: "The bucket's exact name.", placeholder: "lowfield-media", required: true },
    { id: "publicUrl", label: "Public address", help: "Where visitors load the files from: the bucket's public address, or the CDN in front of it.", placeholder: "https://media.example.com", required: true },
    FIELD.prefix,
    FIELD.accessKeyId,
    FIELD.secretAccessKey,
  ],
  keyGrants: "Give the key only this bucket, and only listing, adding, reading and deleting files. Galley only ever writes new names and only deletes files nobody uses.",
  publicNote: "Visitors load the files from this address, so it goes into your pages as it is. Anyone with an address can open that file: keep private documents out of the bucket.",
};

export const BUCKET_CONNECTORS: MediaStoreInfo[] = [R2_INFO, S3_INFO, S3_COMPATIBLE_INFO];

export function connectorInfo(id: string): MediaStoreInfo | null {
  return BUCKET_CONNECTORS.find((info) => info.id === id) ?? null;
}

// ─────────────────────────────────────────────────────────────── addresses

/** "lowfield", "/lowfield/", "lowfield/" → "lowfield/"; "" → "". */
export function normalizePrefix(prefix: string | undefined): string {
  const trimmed = (prefix ?? "").trim().replace(/^\/+|\/+$/g, "");

  return trimmed ? `${trimmed}/` : "";
}

/** The S3 API address the connector talks to. */
export function endpointFor(config: MediaStorageConfig): string {
  if (config.endpoint) return config.endpoint.replace(/\/+$/, "");
  if (config.connector === "r2") return `https://${config.account ?? ""}.r2.cloudflarestorage.com`;
  if (config.connector === "s3") return `https://s3.${config.region ?? "us-east-1"}.amazonaws.com`;
  return "";
}

export function regionFor(config: MediaStorageConfig): string {
  if (config.connector === "r2") return "auto";
  return config.region || "us-east-1";
}

/** R2 and S3-compatible stores: endpoint/bucket/key unless the settings say otherwise. Amazon S3: bucket.s3.region…/key. */
export function pathStyleFor(config: MediaStorageConfig): boolean {
  if (config.pathStyle !== undefined) return config.pathStyle;
  return config.connector !== "s3";
}

/** The public address of a key: the public address, then the key with each segment encoded. */
export function publicUrlOf(publicUrl: string, key: string): string {
  return `${publicUrl.replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

// ─────────────────────────────────────────────────────────────── policies

/**
 * The S3 key's inline policy. Listing carries a prefix condition, so even
 * listing is limited to the site's folder — which is why Galley's reach check
 * is a one-item listing of that folder, not HeadBucket (HeadBucket needs
 * s3:ListBucket with no condition). With no folder, the key covers the bucket.
 */
export function keyPolicy(config: Pick<MediaStorageConfig, "bucket" | "prefix">): string {
  const prefix = normalizePrefix(config.prefix);
  const list: Record<string, unknown> = {
    Sid: "ListTheSiteFolder",
    Effect: "Allow",
    Action: "s3:ListBucket",
    Resource: `arn:aws:s3:::${config.bucket}`,
  };

  if (prefix) list.Condition = { StringLike: { "s3:prefix": [`${prefix}*`] } };
  return JSON.stringify(
    {
      Version: "2012-10-17",
      Statement: [
        list,
        {
          Sid: "ReadWriteTheSiteFolder",
          Effect: "Allow",
          Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
          Resource: `arn:aws:s3:::${config.bucket}/${prefix}*`,
        },
      ],
    },
    null,
    2
  );
}

/** The bucket policy that lets anyone read the site's folder (AWS's "PublicReadGetObject", narrowed to the folder). */
export function publicPolicy(config: Pick<MediaStorageConfig, "bucket" | "prefix">): string {
  const prefix = normalizePrefix(config.prefix);

  return JSON.stringify(
    {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "PublicReadGetObject",
          Effect: "Allow",
          Principal: "*",
          Action: ["s3:GetObject"],
          Resource: [`arn:aws:s3:::${config.bucket}/${prefix}*`],
        },
      ],
    },
    null,
    2
  );
}

// ─────────────────────────────────────────────────────────────── checks

export interface SettingsProblem {
  field: MediaStoreFieldId;
  message: string;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** https:// only; http:// only for this computer (tests and the stand-ins). Null when fine. */
export function addressProblem(value: string, what: string): string | null {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return `The ${what} should be a full address starting with https://.`;
  }
  if (url.protocol === "http:" && !LOOPBACK.has(url.hostname)) return `The ${what} has to start with https://, so visitors' browsers load it.`;
  if (url.protocol !== "https:" && url.protocol !== "http:") return `The ${what} has to start with https://.`;
  if (url.username || url.password) return `The ${what} can't carry a name or password.`;
  if (url.search || url.hash) return `The ${what} can't have a ? or # part.`;
  return null;
}

const R2_BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const S3_BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const REGION = /^[a-z]{2}(?:-[a-z]+)+-\d{1,2}$/;
const ACCOUNT = /^[0-9a-f]{32}$/;
const PREFIX = /^[A-Za-z0-9!_.*'()-]+(?:\/[A-Za-z0-9!_.*'()-]+)*\/$/;

/**
 * Everything that can be said about the settings without asking the
 * provider. Empty when they are fine.
 */
export function settingsProblems(config: MediaStorageConfig): SettingsProblem[] {
  const problems: SettingsProblem[] = [];
  const bucket = config.bucket ?? "";

  if (config.connector === "r2") {
    if (!ACCOUNT.test(config.account ?? "")) problems.push({ field: "account", message: "The Account ID is 32 letters and digits, on R2's Overview page under “Account Details”." });
    if (!R2_BUCKET.test(bucket)) problems.push({ field: "bucket", message: "R2 bucket names are 3 to 63 lowercase letters, digits and dashes, not starting or ending with a dash." });
  } else if (config.connector === "s3") {
    if (!REGION.test(config.region ?? "")) problems.push({ field: "region", message: "Use the Region's code, like “eu-west-1”, as the S3 console shows it next to the bucket." });
    if (!S3_BUCKET.test(bucket) || bucket.includes("..") || /^\d+\.\d+\.\d+\.\d+$/.test(bucket)) {
      problems.push({ field: "bucket", message: "S3 bucket names are 3 to 63 lowercase letters, digits, dots and dashes, starting and ending with a letter or digit." });
    } else if (bucket.includes(".") && !config.endpoint) {
      problems.push({ field: "bucket", message: "A bucket name with dots can't be reached over https at its own address. Make a bucket without dots." });
    }
  } else {
    if (!config.endpoint) problems.push({ field: "endpoint", message: "Give the store's S3 address." });
    if (!config.region?.trim()) problems.push({ field: "region", message: "Give the store's region name (“us-east-1” if it gives none)." });
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) problems.push({ field: "bucket", message: "Bucket names are 3 to 63 lowercase letters, digits, dots and dashes." });
  }
  if (config.endpoint) {
    const problem = addressProblem(config.endpoint, "S3 address");

    if (problem) problems.push({ field: "endpoint", message: problem });
  }
  const prefix = normalizePrefix(config.prefix);

  if (prefix && (!PREFIX.test(prefix) || prefix.split("/").some((part) => part === "." || part === ".."))) {
    problems.push({ field: "prefix", message: "Use letters, digits and dashes for the folder (slashes between parts are fine)." });
  }
  if (!config.publicUrl) problems.push({ field: "publicUrl", message: "Give the public address visitors load the files from." });
  else {
    const problem = addressProblem(config.publicUrl, "public address");

    if (problem) problems.push({ field: "publicUrl", message: problem });
  }
  return problems;
}

/** The settings as they are saved: folder normalised, address without a trailing slash, empty optionals dropped. */
export function normalizeStorageConfig(config: MediaStorageConfig): MediaStorageConfig {
  const out: MediaStorageConfig = {
    connector: config.connector.trim(),
    bucket: config.bucket.trim(),
    publicUrl: config.publicUrl.trim().replace(/\/+$/, ""),
  };
  const prefix = normalizePrefix(config.prefix);

  if (config.account?.trim()) out.account = config.account.trim().toLowerCase();
  if (config.region?.trim()) out.region = config.region.trim();
  if (config.endpoint?.trim()) out.endpoint = config.endpoint.trim().replace(/\/+$/, "");
  if (config.pathStyle !== undefined) out.pathStyle = config.pathStyle;
  if (prefix) out.prefix = prefix;
  return out;
}

/** An r2.dev address: rate-limited, for trying out only. */
export function isTrialAddress(publicUrl: string): boolean {
  try {
    return new URL(publicUrl).hostname.endsWith(".r2.dev");
  } catch {
    return false;
  }
}
