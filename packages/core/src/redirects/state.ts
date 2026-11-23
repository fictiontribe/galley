/**
 * What this computer did with a site's redirects, kept beside the site's
 * other state in `<home>/state/<siteId>/redirects.json` (never in the site:
 * it records actions taken from here, like the deploy history): the last
 * vercel.json redirects it wrote, and what it last set on Cloudflare.
 * Written atomically; an unreadable file starts empty.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CloudflareRecord } from "./types";

export interface RedirectsState {
  /** Derived file path → hash of what was last written there. */
  written: Record<string, string>;
  cloudflare: CloudflareRecord | null;
}

function fileFor(home: string, siteId: string): string {
  // Site ids are hex digests (siteIdFor); anything else can't name a folder here.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(siteId)) throw new Error(`Not a site id: ${siteId}`);
  return join(home, "state", siteId, "redirects.json");
}

export async function readState(home: string, siteId: string): Promise<RedirectsState> {
  try {
    const parsed = JSON.parse(await readFile(fileFor(home, siteId), "utf8")) as Partial<RedirectsState>;

    return { written: typeof parsed.written === "object" && parsed.written ? parsed.written : {}, cloudflare: parsed.cloudflare && typeof parsed.cloudflare === "object" ? parsed.cloudflare : null };
  } catch {
    return { written: {}, cloudflare: null };
  }
}

export async function writeState(home: string, siteId: string, state: RedirectsState): Promise<void> {
  const file = fileFor(home, siteId);
  const temp = `${file}.${randomBytes(4).toString("hex")}.tmp`;

  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, file);
}

export async function updateState(home: string, siteId: string, change: (state: RedirectsState) => RedirectsState): Promise<RedirectsState> {
  const next = change(await readState(home, siteId));

  await writeState(home, siteId, next);
  return next;
}
