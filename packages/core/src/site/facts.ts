/**
 * What the Sites screen shows about a site that isn't open: pending changes,
 * versions not sent to the host, the live address and whether it is behind,
 * unread form submissions, and a share image for the thumbnail.
 *
 * Read in the background, never on the request that lists sites, a site or
 * two at a time: two read-only git commands, a small JSON file and the
 * site's state folder in the Galley home. Nothing here opens the site,
 * detects anything or runs the site's own code.
 */
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { PRODUCT } from "../brand";
import { readDeployments } from "../deploy/history";
import { SubmissionStore } from "../forms/store";
import type { SiteFacts } from "../types";
import { runGit } from "../workspace/git";
import type { SiteRecord } from "./store";

/** Conventional places a site keeps the picture it shares on social sites — tried in order. */
const SHARE_IMAGES = [
  "public/images/share",
  "public/share",
  "public/og-image",
  "public/og",
  "public/images/og",
  "public/social",
  "public/opengraph-image",
  "static/images/share",
  "static/share",
  "static/og",
  "static/og-image",
  "src/assets/share",
  "app/opengraph-image",
];
const SHARE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "avif", "svg"];
export const THUMBNAIL_MAX_BYTES = 8 * 1024 * 1024;

export const THUMBNAIL_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
};

export interface FactsResult {
  facts: SiteFacts;
  /** Repo-relative share image, when one was found. */
  thumbnail?: string;
}

/** Counts entries of `git status --porcelain=v1 -z` (a rename or copy carries a second path). */
export function countPorcelain(output: string): number {
  const parts = output.split("\0");
  let count = 0;

  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index]!;

    if (entry.length < 4) continue;
    count += 1;
    if (entry[0] === "R" || entry[0] === "C") index += 1;
  }
  return count;
}

export async function findShareImage(root: string): Promise<string | undefined> {
  for (const base of SHARE_IMAGES) {
    for (const extension of SHARE_EXTENSIONS) {
      const path = `${base}.${extension}`;
      const info = await stat(join(root, ...path.split("/"))).catch(() => null);

      if (info?.isFile() && info.size > 0 && info.size <= THUMBNAIL_MAX_BYTES) return path;
    }
  }
  return undefined;
}

async function liveAddressFromConfig(root: string): Promise<string | undefined> {
  try {
    const config = JSON.parse(await readFile(join(root, PRODUCT.configFile), "utf8")) as {
      urls?: { production?: unknown };
      deploy?: { productionUrl?: unknown };
    };
    const value = config.deploy?.productionUrl ?? config.urls?.production;

    return typeof value === "string" && /^https?:\/\//.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function unreadSubmissions(home: string, siteId: string): Promise<number> {
  const store = new SubmissionStore(home);
  let unread = 0;

  try {
    for (const form of await store.formIds(siteId)) {
      unread += (await store.list(siteId, form)).filter((item) => !item.read && !item.spam).length;
    }
  } catch {
    // A site id the inbox can't use, or an unreadable file: no unread count rather than no facts.
  }
  return unread;
}

const readOnly = { allowFailure: true, readOnly: true, timeoutMs: 15_000 } as const;

/** Reads a site's facts from its folder and its state in the Galley home. null when the folder is gone. */
export async function readSiteFacts(record: SiteRecord, home: string, now = Date.now()): Promise<FactsResult | null> {
  const { root } = record;

  if (!existsSync(root)) return null;
  const [status, ahead, configured, deployments, unread, thumbnail] = await Promise.all([
    runGit(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], readOnly),
    runGit(root, ["rev-list", "--count", "@{upstream}..HEAD"], readOnly),
    liveAddressFromConfig(root),
    readDeployments(home, record.id, 20).catch(() => []),
    unreadSubmissions(home, record.id),
    findShareImage(root),
  ]);
  const production = deployments.find((deployment) => deployment.kind === "production");
  let notLive: number | null = null;

  if (production?.commit) {
    const behind = await runGit(root, ["rev-list", "--count", `${production.commit}..HEAD`], readOnly);
    const value = Number(behind.text.trim());

    notLive = behind.code === 0 && Number.isInteger(value) ? value : null;
  }
  const unsent = Number(ahead.text.trim());
  const liveUrl = configured ?? record.liveUrl ?? production?.url;

  return {
    facts: {
      checkedAt: now,
      pendingChanges: status.code === 0 ? countPorcelain(status.text) : 0,
      unsent: ahead.code === 0 && Number.isInteger(unsent) ? unsent : 0,
      ...(liveUrl ? { liveUrl } : {}),
      notLive,
      unread,
    },
    ...(thumbnail ? { thumbnail } : {}),
  };
}
