/**
 * Deployment records, one JSON line each in
 * `<home>/state/<siteId>/deployments.jsonl` — beside the site's other state,
 * outside the site itself (they say who put what online from this computer;
 * they are not part of the site). Append-only; an unreadable line is skipped,
 * never fatal.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Deployment } from "../types";

function fileFor(home: string, siteId: string): string {
  // Site ids are hex digests (siteIdFor); anything else can't name a folder here.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(siteId)) throw new Error(`Not a site id: ${siteId}`);
  return join(home, "state", siteId, "deployments.jsonl");
}

function isDeployment(value: unknown): value is Deployment {
  const record = value as Deployment;

  return (
    typeof record === "object" &&
    record !== null &&
    typeof record.id === "string" &&
    (record.kind === "production" || record.kind === "preview") &&
    typeof record.url === "string" &&
    typeof record.createdAt === "string"
  );
}

export async function appendDeployment(home: string, siteId: string, record: Deployment): Promise<void> {
  const file = fileFor(home, siteId);

  await mkdir(join(file, ".."), { recursive: true });
  await appendFile(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

/** Newest first. */
export async function readDeployments(home: string, siteId: string, limit = 50): Promise<Deployment[]> {
  let text: string;

  try {
    text = await readFile(fileFor(home, siteId), "utf8");
  } catch {
    return [];
  }
  const out: Deployment[] = [];

  for (const line of text.split("\n").reverse()) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;

      if (isDeployment(parsed)) out.push(parsed);
    } catch {
      // A torn last line (a crash mid-write) loses that one record only.
    }
    if (out.length >= limit) break;
  }
  return out;
}
