/**
 * Starters that are downloaded the first time they are used, instead of
 * travelling inside galley-cms (RELEASING.md, "How the starters travel").
 *
 * The bundle keeps what shows such a starter (its package.json,
 * starter.json, galley.config.json and preview pictures) and a record,
 * `starter-download.json`: the release asset's name, its size and its
 * SHA-256. Making a site from it downloads the asset into a fresh temporary
 * folder, refuses anything that isn't exactly that size and hash, unpacks
 * it there, and removes the folder once the site is made. Nothing is kept
 * between uses, so nothing another program put somewhere is ever used.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRODUCT, REPOSITORY_URL, VERSION } from "../brand";
import { GalleyError } from "../errors";

export const STARTER_DOWNLOAD = "starter-download.json";
/** How long a download may take before it is given up. */
const DOWNLOAD_TIMEOUT_MS = 120_000;

export interface StarterDownload {
  /** The release asset's file name, `starters-<id>.tgz`. */
  asset: string;
  bytes: number;
  /** Lowercase hex. */
  sha256: string;
  /** What `galley starters` shows of it: its section pictures and page templates. */
  sections: number;
  templates: number;
}

/** The record of a starter that is downloaded when used, or null for one whose files are all here. */
export async function readStarterDownload(starterDir: string): Promise<StarterDownload | null> {
  let raw: unknown;

  try {
    raw = JSON.parse(await readFile(join(starterDir, STARTER_DOWNLOAD), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new GalleyError("internal", "This starter's download record can't be read, so it can't be used.", (error as Error).message);
  }
  const record = raw as Partial<StarterDownload> | null;

  if (
    !record ||
    typeof record.asset !== "string" ||
    !/^starters-[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/.test(record.asset) ||
    typeof record.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(record.sha256) ||
    !Number.isSafeInteger(record.bytes) ||
    (record.bytes as number) <= 0
  ) {
    throw new GalleyError("internal", "This starter's download record isn't valid, so it can't be used.", JSON.stringify(raw).slice(0, 300));
  }
  return {
    asset: record.asset,
    bytes: record.bytes as number,
    sha256: record.sha256,
    sections: Number.isSafeInteger(record.sections) ? (record.sections as number) : 0,
    templates: Number.isSafeInteger(record.templates) ? (record.templates as number) : 0,
  };
}

/**
 * Where a starter's archive is downloaded from: GALLEY_STARTER_DOWNLOADS (a folder address, for a mirror or a test),
 * or the release of this version's starters, `starters-v<version>` — a release of its own, published by release.yml
 * before the packages, because the version's own release stays a draft until a person publishes it.
 */
export function starterDownloadUrl(asset: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = env.GALLEY_STARTER_DOWNLOADS?.trim().replace(/\/+$/, "") || `${REPOSITORY_URL}/releases/download/starters-v${VERSION}`;

  return `${base}/${encodeURIComponent(asset)}`;
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function download(url: string, record: StarterDownload, name: string): Promise<Buffer> {
  const unreachable = (detail: string) =>
    new GalleyError("busy", `The ${name} starter is downloaded the first time it is used, and it couldn't be downloaded just now. Check that this computer is online, then try again, or choose another starter.`, detail, 503);
  let response: Response;

  try {
    response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (error) {
    throw unreachable(`${url}: ${(error as Error).message}`);
  }
  if (response.status === 404 || response.status === 410) {
    throw new GalleyError("not-found", `The ${name} starter isn't available to download yet. Try again later, or choose another starter.`, `${url}: ${response.status}`);
  }
  if (!response.ok || !response.body) throw unreachable(`${url}: ${response.status}`);
  const wrong = (detail: string) =>
    new GalleyError("internal", `The ${name} starter that was downloaded isn't the one this version of ${PRODUCT.name} expects, so it wasn't used and nothing was made. Try again later, or choose another starter.`, detail);
  const chunks: Buffer[] = [];
  let size = 0;

  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > record.bytes) throw wrong(`${url}: more than the ${record.bytes} bytes recorded`);
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) {
    if (error instanceof GalleyError) throw error;
    throw unreachable(`${url}: ${(error as Error).message}`);
  }
  const bytes = Buffer.concat(chunks);
  const hash = createHash("sha256").update(bytes).digest("hex");

  if (bytes.length !== record.bytes || hash !== record.sha256) throw wrong(`${url}: ${bytes.length} bytes, sha256 ${hash}; recorded ${record.bytes} bytes, sha256 ${record.sha256}`);
  return bytes;
}

/** Unpacks a checked archive with the system's tar (GNU tar, bsdtar, or Windows' own), names relative to `cwd`. */
function unpack(cwd: string, archive: string, into: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", ["-xzf", archive, "-C", into], { cwd, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, LC_ALL: "C" } });
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 2000) stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => reject(new GalleyError("unconfigured", `Unpacking a downloaded starter needs the tar program, which isn't on this computer.`, error.message)));
    child.once("close", (code) => (code === 0 ? resolve() : reject(new GalleyError("internal", "The downloaded starter couldn't be unpacked.", `tar exited ${code}: ${stderr.trim()}`))));
  });
}

export interface FullStarterOptions {
  /** The starter's name, for the sentences a person reads. */
  name: string;
  env?: NodeJS.ProcessEnv;
  /** Told before a download starts, with its size ("3.5 MB"). */
  onDownload?: (size: string) => void;
}

/**
 * Runs `use` with a folder that holds the whole starter: `starterDir` itself, or — for a starter that is downloaded
 * when used — a fresh temporary folder with its checked archive unpacked, removed again afterwards.
 */
export async function withFullStarter<T>(starterDir: string, options: FullStarterOptions, use: (dir: string) => Promise<T>): Promise<T> {
  const record = await readStarterDownload(starterDir);

  if (!record) return use(starterDir);
  options.onDownload?.(megabytes(record.bytes));
  const bytes = await download(starterDownloadUrl(record.asset, options.env), record, options.name);
  const work = await mkdtemp(join(tmpdir(), `${PRODUCT.slug}-starter-`));

  try {
    await writeFile(join(work, "starter.tgz"), bytes, { mode: 0o600 });
    await mkdir(join(work, "starter"));
    await unpack(work, "starter.tgz", "starter");
    const dir = join(work, "starter");

    if (!existsSync(join(dir, "package.json"))) throw new GalleyError("internal", "The downloaded starter is missing its package.json, so it can't be used.", record.asset);
    return await use(dir);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
