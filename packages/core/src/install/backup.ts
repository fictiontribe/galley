/**
 * Backing up and restoring a hosted install's data folder.
 *
 * What a backup holds: everything in the data folder a fresh install could
 * not rebuild — the state file, settings, the key store and `keys/`, the
 * session key, the per-site state (inbox, history of going online, brand
 * material, assistant conversations, plugin state) and the site's checkout
 * with its version history and unpublished changes. Not: installed packages
 * (`node_modules` anywhere), package caches, the container's `home/`, the
 * site's build output (`dist`, `.astro` at the site's top, unless tracked),
 * temporary and staging folders. Those are rebuilt.
 *
 * The file:
 *
 *   magic (8)  89 42 41 4B 0D 0A 1A 0A          "\x89BAK\r\n\x1a\n"
 *   format (1) 01
 *   header length (4, big-endian) · header (JSON) · SHA-256 of everything before it (32)
 *   frames, each: length (4, big-endian: the top bit set on the final frame, the rest
 *   the ciphertext's length, ≤ chunkBytes) · ciphertext · GCM tag (16)
 *
 * The header says how the key is made and checked:
 *   { "kdf": { "name": "scrypt", "N": 65536, "r": 8, "p": 1, "salt": <16 bytes, base64> },
 *     "cipher": "aes-256-gcm", "chunkBytes": 1048576, "nonce": <7 bytes, base64>,
 *     "verifier": <SHA-256 of the second half of the derived key, base64> }
 * scrypt gives 64 bytes from the passphrase (NFC): the first 32 are the
 * AES-256-GCM key, the second 32 only ever feed the verifier — so a wrong
 * passphrase is told apart from a damaged file without decrypting anything.
 * Frame i is sealed with the nonce `nonce ‖ i (4 bytes, big-endian) ‖ last
 * (1 byte: 1 on the final frame, else 0)` and the header's hash as additional
 * data: a frame that is altered, moved, taken from another file, or a file
 * that stops before its final frame, never opens.
 *
 * Inside the frames: a 4-byte big-endian length and the manifest (JSON:
 * product, version, data folder schema, time), then the gzipped tar the
 * system's `tar` made (GNU tar and bsdtar both, given argument arrays).
 * A restore opens and checks the whole file into a staging folder inside the
 * data folder first, reads every entry of the archive (paths, links) before
 * extracting it with the tool's own protections, and only then swaps the
 * restored state in, keeping the old one aside until it is committed.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, readdir, readlink, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { PassThrough, Transform, type Readable, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { PRODUCT, VERSION } from "../brand";
import { GalleyError } from "../errors";
import { INSTALL_SCHEMA_VERSION } from "./types";

export const BACKUP_MAGIC = Buffer.from([0x89, 0x42, 0x41, 0x4b, 0x0d, 0x0a, 0x1a, 0x0a]);
export const BACKUP_FORMAT_VERSION = 1;
/** scrypt's cost: 64 MiB and a fraction of a second, once per backup or restore. */
export const BACKUP_SCRYPT: { readonly N: number; readonly r: number; readonly p: number } = { N: 1 << 16, r: 8, p: 1 };
/** Plaintext bytes per frame. */
export const BACKUP_CHUNK_BYTES = 1 << 20;
/** Staging folders inside the data folder: never backed up, never swapped. */
export const RESTORE_STAGING_PREFIX = ".restore-";
export const BACKUP_STAGING_PREFIX = ".backup-";
/** Where uploaded backups wait for their passphrase. */
export const RESTORE_UPLOADS = ".restore-uploads";
/** Written while a server holds the data folder (lock.ts). */
export const SERVER_LOCK_FILE = "server.lock";

const HEADER_HASH_BYTES = 32;
const TAG_BYTES = 16;
const NONCE_PREFIX_BYTES = 7;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
/** Limits on a header's own parameters, so a hostile file can't ask for a gigabyte of memory. */
const MAX_SCRYPT_N = 1 << 20;
const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
const FINAL_FLAG = 0x80000000;

/**
 * Where an operator keeps backups inside the data folder (`galley backup
 * create --out /data/backups/…` in a container whose only volume is /data):
 * never in a backup, or each would carry all the ones before it, and never
 * replaced by a restore, which would otherwise throw away the very file
 * being restored and every other backup beside it.
 */
export const BACKUPS_FOLDER = "backups";
/** Top-level names in the data folder that are never in a backup and never replaced by a restore. */
const TOP_LEVEL_SKIPPED = new Set(["home", "tmp", BACKUPS_FOLDER, RESTORE_UPLOADS, SERVER_LOCK_FILE]);
/** Folder names skipped wherever they are: installed packages and package caches. */
const SKIPPED_ANYWHERE = new Set(["node_modules", ".pnpm-store", ".npm", ".cache", ".yarn-cache"]);
/** At the top of the site's folder: build output, skipped unless the repository tracks it. */
const SITE_BUILD_OUTPUT = ["dist", ".astro"];

export interface BackupManifest {
  format: number;
  product: string;
  version: string;
  /** INSTALL_SCHEMA_VERSION of the install that made it. */
  schema: number;
  createdAt: string;
  /** The server's hostname, for the operator's own records. */
  madeOn: string;
}

export type BackupProblem = "not-a-backup" | "newer-format" | "wrong-passphrase" | "damaged" | "newer-schema" | "unsafe";

/** A backup that can't be opened, and which way: the message says what to do. */
export class BackupError extends GalleyError {
  constructor(
    readonly problem: BackupProblem,
    message: string
  ) {
    // Never "unauthorized": a wrong passphrase isn't a sign-in that ended, and a 401 would send the app to its sign-in screen.
    super("invalid", message);
    this.name = "BackupError";
  }
}

const NOTHING_CHANGED = "Nothing was changed.";
const problems: Record<Exclude<BackupProblem, "newer-schema">, string> = {
  "not-a-backup": `That file isn't a backup made by ${PRODUCT.name}. ${NOTHING_CHANGED}`,
  "newer-format": `That backup was made by a newer version of ${PRODUCT.name}. Update this editor, then restore it. ${NOTHING_CHANGED}`,
  "wrong-passphrase": `That passphrase doesn't open this backup. Check it (capitals count) and try again. ${NOTHING_CHANGED}`,
  damaged: `That backup file is damaged or incomplete, so it can't be restored. Download it again or use another backup. ${NOTHING_CHANGED}`,
  unsafe: `That backup holds something that would be written outside the data folder, so it was refused. ${NOTHING_CHANGED}`,
};

function fail(problem: Exclude<BackupProblem, "newer-schema">): never {
  throw new BackupError(problem, problems[problem]);
}

// ─────────────────────────────────────────────────────────────── the sealed format

interface Header {
  kdf: { name: "scrypt"; N: number; r: number; p: number; salt: string };
  cipher: "aes-256-gcm";
  chunkBytes: number;
  nonce: string;
  verifier: string;
}

function scrypt(passphrase: string, salt: Buffer, params: { N: number; r: number; p: number }): Promise<Buffer> {
  const options: ScryptOptions = { ...params, maxmem: 256 * params.N * params.r + 16 * 1024 * 1024 };

  return new Promise((resolveKey, reject) => scryptCallback(passphrase.normalize("NFC"), salt, 64, options, (error, key) => (error ? reject(error) : resolveKey(key))));
}

function verifierOf(derived: Buffer): Buffer {
  return createHash("sha256").update(derived.subarray(32, 64)).digest();
}

function nonceFor(prefix: Buffer, index: number, last: boolean): Buffer {
  const nonce = Buffer.alloc(12);

  prefix.copy(nonce, 0);
  nonce.writeUInt32BE(index, NONCE_PREFIX_BYTES);
  nonce[11] = last ? 1 : 0;
  return nonce;
}

/** A Transform from plaintext to the sealed file. `beforeFinal` must resolve before the final frame is written: a source that failed never yields a file that opens. */
async function sealer(passphrase: string, beforeFinal: () => Promise<void>, params = BACKUP_SCRYPT): Promise<Transform> {
  const salt = randomBytes(16);
  const prefix = randomBytes(NONCE_PREFIX_BYTES);
  const derived = await scrypt(passphrase, salt, params);
  const key = derived.subarray(0, 32);
  const header: Header = {
    kdf: { name: "scrypt", N: params.N, r: params.r, p: params.p, salt: salt.toString("base64") },
    cipher: "aes-256-gcm",
    chunkBytes: BACKUP_CHUNK_BYTES,
    nonce: prefix.toString("base64"),
    verifier: verifierOf(derived).toString("base64"),
  };
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const length = Buffer.alloc(4);

  length.writeUInt32BE(json.length);
  const lead = Buffer.concat([BACKUP_MAGIC, Buffer.from([BACKUP_FORMAT_VERSION]), length, json]);
  const headerHash = createHash("sha256").update(lead).digest();
  let index = 0;
  let pending: Buffer[] = [];
  let pendingBytes = 0;

  const frame = (plain: Buffer, last: boolean): Buffer => {
    const cipher = createCipheriv("aes-256-gcm", key, nonceFor(prefix, index, last));

    cipher.setAAD(headerHash);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    const size = Buffer.alloc(4);

    index += 1;
    // The top bit says "last" so the reader knows which nonce to use; the nonce itself carries it, so flipping it never opens.
    size.writeUInt32BE((body.length | (last ? FINAL_FLAG : 0)) >>> 0);
    return Buffer.concat([size, body, cipher.getAuthTag()]);
  };

  return new Transform({
    construct(callback) {
      this.push(Buffer.concat([lead, headerHash]));
      callback();
    },
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      pending.push(chunk);
      pendingBytes += chunk.length;
      // Strictly more than a frame: the final frame is only known at the end, and may be empty.
      while (pendingBytes > BACKUP_CHUNK_BYTES) {
        const all = Buffer.concat(pending);

        this.push(frame(all.subarray(0, BACKUP_CHUNK_BYTES), false));
        pending = [all.subarray(BACKUP_CHUNK_BYTES)];
        pendingBytes = pending[0]!.length;
      }
      callback();
    },
    flush(callback: TransformCallback) {
      beforeFinal().then(
        () => callback(null, frame(Buffer.concat(pending), true)),
        (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)))
      );
    },
  });
}

/** Reads exact byte counts from a stream. */
class ByteReader {
  private buffered: Buffer[] = [];
  private size = 0;
  private done = false;
  private readonly iterator: AsyncIterator<Buffer>;

  constructor(source: Readable) {
    this.iterator = source[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  }

  /** Exactly `n` bytes, or fewer when the stream ended first. */
  async read(n: number): Promise<Buffer> {
    while (this.size < n && !this.done) {
      const next = await this.iterator.next();

      if (next.done) this.done = true;
      else {
        const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);

        this.buffered.push(chunk);
        this.size += chunk.length;
      }
    }
    const all = Buffer.concat(this.buffered);
    const out = all.subarray(0, n);

    this.buffered = [all.subarray(out.length)];
    this.size = this.buffered[0]!.length;
    return out;
  }

  async atEnd(): Promise<boolean> {
    return (await this.read(1)).length === 0;
  }

  close(): void {
    void this.iterator.return?.();
  }
}

function parseHeader(json: Buffer): Header {
  let header: Header;

  try {
    header = JSON.parse(json.toString("utf8")) as Header;
  } catch {
    fail("damaged");
  }
  const { kdf } = header ?? {};
  const salt = typeof kdf?.salt === "string" ? Buffer.from(kdf.salt, "base64") : Buffer.alloc(0);
  const ok =
    kdf?.name === "scrypt" &&
    Number.isInteger(kdf.N) && kdf.N >= 1024 && kdf.N <= MAX_SCRYPT_N && (kdf.N & (kdf.N - 1)) === 0 &&
    Number.isInteger(kdf.r) && kdf.r >= 1 && kdf.r <= 32 &&
    Number.isInteger(kdf.p) && kdf.p >= 1 && kdf.p <= 16 &&
    salt.length >= 16 &&
    header.cipher === "aes-256-gcm" &&
    Number.isInteger(header.chunkBytes) && header.chunkBytes >= 1024 && header.chunkBytes <= MAX_CHUNK_BYTES &&
    typeof header.nonce === "string" && Buffer.from(header.nonce, "base64").length === NONCE_PREFIX_BYTES &&
    typeof header.verifier === "string" && Buffer.from(header.verifier, "base64").length === 32;

  if (!ok) fail("damaged");
  return header;
}

/**
 * Opens a sealed backup: checks the passphrase, then decrypts every frame
 * into `onPlain`, in order. Throws a BackupError — "wrong-passphrase" before
 * anything is decrypted, "damaged" on the first frame that doesn't open or a
 * file that stops before its final frame.
 */
async function unseal(source: Readable, passphrase: string, onPlain: (chunk: Buffer) => Promise<void>): Promise<void> {
  const reader = new ByteReader(source);

  try {
    const magic = await reader.read(BACKUP_MAGIC.length + 1);

    if (magic.length < BACKUP_MAGIC.length + 1 || !magic.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) fail("not-a-backup");
    if (magic[BACKUP_MAGIC.length]! > BACKUP_FORMAT_VERSION) fail("newer-format");
    if (magic[BACKUP_MAGIC.length] !== BACKUP_FORMAT_VERSION) fail("damaged");
    const lengthBytes = await reader.read(4);

    if (lengthBytes.length < 4) fail("damaged");
    const length = lengthBytes.readUInt32BE(0);

    if (length === 0 || length > MAX_HEADER_BYTES) fail("damaged");
    const json = await reader.read(length);
    const hash = await reader.read(HEADER_HASH_BYTES);

    if (json.length < length || hash.length < HEADER_HASH_BYTES) fail("damaged");
    const headerHash = createHash("sha256").update(Buffer.concat([magic, lengthBytes, json])).digest();

    if (!timingSafeEqual(headerHash, hash)) fail("damaged");
    const header = parseHeader(json);
    const derived = await scrypt(passphrase, Buffer.from(header.kdf.salt, "base64"), header.kdf);

    if (!timingSafeEqual(verifierOf(derived), Buffer.from(header.verifier, "base64"))) fail("wrong-passphrase");
    const key = derived.subarray(0, 32);
    const prefix = Buffer.from(header.nonce, "base64");

    for (let index = 0; ; index += 1) {
      const sizeBytes = await reader.read(4);

      if (sizeBytes.length < 4) fail("damaged");
      const word = sizeBytes.readUInt32BE(0);
      const last = (word & FINAL_FLAG) !== 0;
      const size = word & ~FINAL_FLAG;

      if (size > header.chunkBytes) fail("damaged");
      const body = await reader.read(size);
      const tag = await reader.read(TAG_BYTES);

      if (body.length < size || tag.length < TAG_BYTES) fail("damaged");
      let plain: Buffer;

      try {
        const decipher = createDecipheriv("aes-256-gcm", key, nonceFor(prefix, index, last));

        decipher.setAAD(headerHash);
        decipher.setAuthTag(tag);
        plain = Buffer.concat([decipher.update(body), decipher.final()]);
      } catch {
        fail("damaged");
      }
      if (!last && plain.length !== header.chunkBytes) fail("damaged");
      await onPlain(plain);
      if (last) {
        if (!(await reader.atEnd())) fail("damaged");
        return;
      }
    }
  } finally {
    reader.close();
  }
}

// ─────────────────────────────────────────────────────────────── tar

type TarFlavour = "gnu" | "bsd";
let flavour: Promise<TarFlavour> | null = null;

/** Which tar this server has: GNU tar (the image) or bsdtar (macOS). Asked once. */
export function tarFlavour(): Promise<TarFlavour> {
  flavour ??= new Promise((resolveFlavour, reject) => {
    const child = spawn("tar", ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";

    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
    child.once("error", () => reject(new GalleyError("unconfigured", "Backups need the tar program, which isn't installed on this server. Install it (the tar package), then try again.")));
    child.once("close", () => resolveFlavour(/GNU tar/i.test(out) ? "gnu" : "bsd"));
  });
  flavour.catch(() => {
    flavour = null;
  });
  return flavour;
}

function runTar(args: string[], options: { cwd: string; stdout?: "pipe" | "ignore" }): { child: ReturnType<typeof spawn>; exited: Promise<void> } {
  // COPYFILE_DISABLE: macOS's tar would otherwise add "._" files holding extended attributes.
  const child = spawn("tar", args, { cwd: options.cwd, stdio: ["ignore", options.stdout ?? "ignore", "pipe"], env: { ...process.env, COPYFILE_DISABLE: "1", LC_ALL: "C" } });
  let stderr = "";

  child.stderr?.on("data", (chunk: Buffer) => {
    if (stderr.length < 4000) stderr += chunk.toString("utf8");
  });
  const exited = new Promise<void>((resolveExit, reject) => {
    child.once("error", (error) => reject(new GalleyError("unconfigured", "Backups need the tar program, which isn't installed on this server. Install it (the tar package), then try again.", error.message)));
    child.once("close", (code, signal) => (code === 0 ? resolveExit() : reject(new GalleyError("internal", "The backup couldn't be read or written by tar.", `tar ${signal ?? `exited ${code}`}: ${stderr.trim().slice(-1000)}`))));
  });

  return { child, exited };
}

// ─────────────────────────────────────────────────────────────── what goes in

export interface BackupEntriesOptions {
  /** The repository's copy, relative to the data folder (POSIX). Default "site". */
  checkout?: string;
  /** The site's folder inside the data folder (POSIX), whose build output is skipped. Default: the checkout. */
  siteFolder?: string;
  /** Paths (relative to the data folder) the repository tracks under the build-output folders: those are kept. */
  tracked?: (dir: string) => Promise<boolean>;
}

/** The top-level folder of the data folder a relative POSIX path is in: its first segment ("site", "keys", "state", ...). */
function areaOf(relPath: string): string {
  return relPath.split("/")[0] ?? "";
}

/**
 * Whether a link at `linkPath` to `targetPath` (both relative to the data folder, POSIX, normalised) stays in the
 * top-level folder the link is in. Inside the data folder is not enough: a link in the site's checkout that points at
 * the keys, the state or the install's own files beside it would hand them to whatever reads the checkout. Galley
 * keeps no links at the very top of the data folder, so none is accepted there.
 */
function staysInArea(linkPath: string, targetPath: string): boolean {
  if (!linkPath.includes("/")) return false;
  if (targetPath === ".." || targetPath.startsWith("../") || posix.isAbsolute(targetPath)) return false;
  return areaOf(targetPath) === areaOf(linkPath);
}

/** Whether a symbolic link's target stays in its top-level folder (see staysInArea). A backup with one that doesn't could never be restored. */
function linkStaysInside(relPath: string, target: string): boolean {
  if (isAbsolute(target) || target.startsWith("/")) return false;
  return staysInArea(relPath, posix.normalize(posix.join(posix.dirname(relPath), target)));
}

/**
 * Every path in the data folder a backup carries, relative and in POSIX
 * form, folders before what's in them. A symbolic link is kept as a link
 * (never followed), and only when it stays in its top-level folder. A file
 * with several names (hard links) in more than one top-level folder is
 * carried under the names in one of them only, never the site's when
 * another holds it: tar stores a second name as a link to the first, and a
 * restore refuses a link from one top-level folder to another.
 */
export async function backupEntries(home: string, options: BackupEntriesOptions = {}): Promise<string[]> {
  const out: string[] = [];
  const siteFolder = options.siteFolder ?? options.checkout ?? "site";
  /** Files with more than one name, by device and inode: every name of each that is carried. */
  const linked = new Map<string, string[]>();
  const skippedOutput = new Set<string>();

  for (const name of SITE_BUILD_OUTPUT) {
    const dir = posix.join(siteFolder, name);

    if (!(await options.tracked?.(dir).catch(() => false))) skippedOutput.add(dir);
  }

  async function walk(dirRel: string): Promise<void> {
    let names: string[];

    try {
      names = (await readdir(join(home, ...dirRel.split("/").filter(Boolean)))).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const rel = dirRel ? `${dirRel}/${name}` : name;

      if (!dirRel && (TOP_LEVEL_SKIPPED.has(name) || name.startsWith(RESTORE_STAGING_PREFIX) || name.startsWith(BACKUP_STAGING_PREFIX) || name.endsWith(".tmp"))) continue;
      if (SKIPPED_ANYWHERE.has(name) || skippedOutput.has(rel)) continue;
      const info = await lstat(join(home, ...rel.split("/"))).catch(() => null);

      if (!info) continue;
      if (info.isSymbolicLink()) {
        const target = await readlink(join(home, ...rel.split("/"))).catch(() => null);

        if (target !== null && linkStaysInside(rel, target)) out.push(rel);
      } else if (info.isDirectory()) {
        out.push(rel);
        await walk(rel);
      } else if (info.isFile()) {
        out.push(rel);
        if (info.nlink > 1) {
          const key = `${info.dev}:${info.ino}`;

          linked.set(key, [...(linked.get(key) ?? []), rel]);
        }
      }
    }
  }

  await walk("");
  const siteArea = areaOf(siteFolder);
  const leftOut = new Set<string>();

  for (const names of linked.values()) {
    const areas = [...new Set(names.map(areaOf))];

    if (areas.length < 2) continue;
    const kept = areas.find((area) => area !== siteArea) ?? areas[0];

    for (const name of names) if (areaOf(name) !== kept) leftOut.add(name);
  }
  return leftOut.size === 0 ? out : out.filter((rel) => !leftOut.has(rel));
}

export interface CreateBackupOptions extends BackupEntriesOptions {
  home: string;
  passphrase: string;
  /** Test seam: cheaper scrypt parameters. */
  scrypt?: { N: number; r: number; p: number };
}

export interface BackupStream {
  /** The sealed file's bytes. Errors (and never writes the final frame) when anything went wrong. */
  stream: Readable;
  /** Resolves when every byte was produced; rejects when the backup failed. */
  done: Promise<void>;
  manifest: BackupManifest;
}

/**
 * Seals a gzipped tar (and its manifest) into the backup format. `archiveDone`
 * must resolve before the final frame is written: an archive whose maker
 * failed never yields a file that opens.
 */
export async function sealArchive(options: {
  archive: Readable;
  manifest: BackupManifest;
  passphrase: string;
  archiveDone?: Promise<void>;
  scrypt?: { N: number; r: number; p: number };
}): Promise<{ stream: Readable; done: Promise<void> }> {
  const archiveDone = options.archiveDone ?? Promise.resolve();

  archiveDone.catch(() => undefined);
  const seal = await sealer(options.passphrase, () => archiveDone, options.scrypt);
  const manifestJson = Buffer.from(JSON.stringify(options.manifest), "utf8");
  const manifestLength = Buffer.alloc(4);

  manifestLength.writeUInt32BE(manifestJson.length);
  seal.write(Buffer.concat([manifestLength, manifestJson]));
  const out = new PassThrough();
  const done = pipeline(options.archive, seal, out).then(() => archiveDone);

  // Whoever reads `stream` sees a failure as a stream error; `done` reports it too.
  done.catch((error: unknown) => out.destroy(error instanceof Error ? error : new Error(String(error))));
  return { stream: out, done };
}

/** Starts a backup of `home`: tar → gzip → sealed frames, streamed, never held whole in memory. */
export async function createBackupStream(options: CreateBackupOptions): Promise<BackupStream> {
  const { home } = options;
  const kind = await tarFlavour();
  const entries = await backupEntries(home, options);
  const list = join(home, `${BACKUP_STAGING_PREFIX}${randomBytes(6).toString("hex")}.list`);
  const manifest: BackupManifest = { format: BACKUP_FORMAT_VERSION, product: PRODUCT.slug, version: VERSION, schema: INSTALL_SCHEMA_VERSION, createdAt: new Date().toISOString(), madeOn: hostname() };

  await writeFile(list, entries.map((entry) => `${entry}\0`).join(""), { mode: 0o600 });
  const args = ["-c", "-f", "-", ...(kind === "bsd" ? ["--no-mac-metadata", "--format", "pax"] : ["--format=pax"]), "--no-recursion", "--null", "-T", list];
  const tar = runTar(args, { cwd: home, stdout: "pipe" });
  const tarDone = tar.exited.finally(() => rm(list, { force: true }));
  const gzip = createGzip({ level: 6 });

  (tar.child.stdout as Readable).pipe(gzip);
  (tar.child.stdout as Readable).once("error", (error) => gzip.destroy(error));
  tarDone.catch((error: unknown) => gzip.destroy(error instanceof Error ? error : new Error(String(error))));
  try {
    const sealed = await sealArchive({ archive: gzip, manifest, passphrase: options.passphrase, archiveDone: tarDone, ...(options.scrypt ? { scrypt: options.scrypt } : {}) });

    sealed.done.catch(() => tar.child.kill("SIGKILL"));
    return { stream: sealed.stream, done: sealed.done, manifest };
  } catch (error) {
    tar.child.kill("SIGKILL");
    throw error;
  }
}

/** Writes a backup of `home` to `file` (the command line's `backup create`). The file appears only when it is complete. */
export async function writeBackupFile(options: CreateBackupOptions & { file: string }): Promise<BackupManifest> {
  const temp = `${options.file}.${randomBytes(4).toString("hex")}.partial`;
  const backup = await createBackupStream(options);

  try {
    await pipeline(backup.stream, createWriteStream(temp, { mode: 0o600 }));
    await backup.done;
    await rename(temp, options.file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return backup.manifest;
}

// ─────────────────────────────────────────────────────────────── reading an archive

/** One entry as the archive describes it. */
export interface ArchiveEntry {
  path: string;
  type: "file" | "directory" | "symlink" | "hardlink" | "other";
  link: string | null;
}

function field(block: Buffer, offset: number, length: number): string {
  const raw = block.subarray(offset, offset + length);
  const end = raw.indexOf(0);

  return raw.subarray(0, end < 0 ? raw.length : end).toString("utf8");
}

function octal(block: Buffer, offset: number, length: number): number {
  // GNU base-256 for large sizes: the first byte's top bit is set.
  if (block[offset]! & 0x80) {
    let value = 0;

    for (let i = offset + 1; i < offset + length; i += 1) value = value * 256 + block[i]!;
    return value;
  }
  const text = field(block, offset, length).trim();

  return text ? parseInt(text, 8) : 0;
}

function paxRecords(data: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let at = 0;

  while (at < data.length) {
    const space = data.indexOf(0x20, at);

    if (space < 0) break;
    const length = Number(data.subarray(at, space).toString("utf8"));

    if (!Number.isInteger(length) || length <= 0 || at + length > data.length) fail("damaged");
    const record = data.subarray(space + 1, at + length - 1).toString("utf8");
    const eq = record.indexOf("=");

    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    at += length;
  }
  return out;
}

/** Every entry of a gzipped tar, read by this process itself — not by the tool that will extract it. */
export async function listArchive(archive: string): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [];
  const reader = new ByteReader(createReadStream(archive).pipe(createGunzip()));
  let longName: string | null = null;
  let longLink: string | null = null;
  let pax: Record<string, string> = {};

  try {
    for (;;) {
      const block = await reader.read(512);

      if (block.length === 0) break;
      if (block.length < 512) fail("damaged");
      if (block.every((byte) => byte === 0)) break;
      let sum = 0;

      for (let i = 0; i < 512; i += 1) sum += i >= 148 && i < 156 ? 32 : block[i]!;
      if (sum !== octal(block, 148, 8)) fail("damaged");
      const size = octal(block, 124, 12);
      const type = String.fromCharCode(block[156]!);
      const padded = Math.ceil(size / 512) * 512;
      const meta = type === "x" || type === "g" || type === "L" || type === "K";

      if (meta && size > 1024 * 1024) fail("damaged");
      const data = meta ? await reader.read(padded) : null;

      if (meta) {
        if (data!.length < padded) fail("damaged");
        const body = data!.subarray(0, size);

        if (type === "x") pax = { ...pax, ...paxRecords(body) };
        else if (type === "L") longName = field(body, 0, body.length);
        else if (type === "K") longLink = field(body, 0, body.length);
        continue;
      }
      const prefix = block.subarray(257, 263).toString("latin1").startsWith("ustar") ? field(block, 345, 155) : "";
      const name = pax.path ?? longName ?? (prefix ? `${prefix}/${field(block, 0, 100)}` : field(block, 0, 100));
      const link = pax.linkpath ?? longLink ?? field(block, 157, 100);
      const kind: ArchiveEntry["type"] =
        type === "0" || type === "\0" || type === "7" ? "file" : type === "5" ? "directory" : type === "2" ? "symlink" : type === "1" ? "hardlink" : "other";

      entries.push({ path: name, type: kind, link: kind === "symlink" || kind === "hardlink" ? link : null });
      pax = {};
      longName = null;
      longLink = null;
      // Skip the entry's data without holding it.
      for (let left = padded; left > 0; ) {
        const skipped = await reader.read(Math.min(left, 1 << 20));

        if (skipped.length === 0) fail("damaged");
        left -= skipped.length;
      }
    }
  } catch (error) {
    if (error instanceof BackupError) throw error;
    fail("damaged");
  } finally {
    reader.close();
  }
  return entries;
}

/** Whether an archive path stays inside the folder it is extracted into. */
export function safeArchivePath(path: string): boolean {
  if (!path || path.includes("\0") || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false;
  const parts = path.replace(/\/+$/, "").split("/");

  if (parts.some((part) => part === "..")) return false;
  const normal = posix.normalize(path);

  return normal !== ".." && !normal.startsWith("../") && !posix.isAbsolute(normal);
}

/** Refuses an archive with anything that would land outside the folder it is extracted into. */
export function checkEntries(entries: ArchiveEntry[]): void {
  for (const entry of entries) {
    if (entry.type === "other" || !safeArchivePath(entry.path)) fail("unsafe");
    if (entry.type === "symlink" && (entry.link === null || !linkStaysInside(entry.path.replace(/\/+$/, ""), entry.link))) fail("unsafe");
    // A hard link names another entry of the archive: it too stays in the top-level folder it is in.
    if (entry.type === "hardlink" && (entry.link === null || !safeArchivePath(entry.link) || !staysInArea(entry.path.replace(/\/+$/, ""), posix.normalize(entry.link)))) fail("unsafe");
  }
}

/** Extracts a checked archive into an empty folder with tar's own protections on. */
async function extractArchive(archive: string, into: string): Promise<void> {
  const kind = await tarFlavour();
  const args =
    kind === "gnu"
      ? ["-x", "-z", "-f", archive, "-C", into, "--no-same-owner", "--no-overwrite-dir", "--delay-directory-restore"]
      : ["-x", "-z", "-f", archive, "-C", into, "--no-same-owner", "--no-mac-metadata"];

  await runTar(args, { cwd: into }).exited;
}

// ─────────────────────────────────────────────────────────────── restoring

export interface OpenedBackup {
  manifest: BackupManifest;
  /** The gzipped tar, checked: inside `staging`. */
  archive: string;
}

/**
 * Opens and checks a whole backup into `staging` (a new folder): the
 * passphrase, every frame, the manifest, the schema, every archive entry.
 * Throws a BackupError that says which problem it was; nothing outside
 * `staging` is touched.
 */
export async function openBackup(source: Readable, passphrase: string, staging: string): Promise<OpenedBackup> {
  await mkdir(staging, { recursive: true, mode: 0o700 });
  const archive = join(staging, "archive.tar.gz");
  const out = createWriteStream(archive, { mode: 0o600 });
  let head: Buffer = Buffer.alloc(0);
  let manifest: BackupManifest | null = null;
  const write = (chunk: Buffer) =>
    new Promise<void>((resolveWrite, reject) => {
      out.write(chunk, (error) => (error ? reject(error) : resolveWrite()));
    });

  try {
    await unseal(source, passphrase, async (plain) => {
      if (manifest) return write(plain);
      head = Buffer.concat([head, plain]);
      if (head.length < 4) return;
      const length = head.readUInt32BE(0);

      if (length === 0 || length > MAX_MANIFEST_BYTES) fail("damaged");
      if (head.length < 4 + length) return;
      try {
        manifest = JSON.parse(head.subarray(4, 4 + length).toString("utf8")) as BackupManifest;
      } catch {
        fail("damaged");
      }
      if (typeof manifest?.schema !== "number" || typeof manifest.createdAt !== "string") fail("damaged");
      if (manifest.schema > INSTALL_SCHEMA_VERSION) {
        throw new BackupError(
          "newer-schema",
          `That backup was made by a newer version of ${PRODUCT.name} (data version ${manifest.schema}; this editor reads up to ${INSTALL_SCHEMA_VERSION}). Update this editor, then restore it. ${NOTHING_CHANGED}`
        );
      }
      const rest = head.subarray(4 + length);

      head = Buffer.alloc(0);
      if (rest.length > 0) await write(rest);
    });
  } finally {
    await new Promise<void>((resolveEnd) => out.end(() => resolveEnd()));
  }
  if (!manifest) fail("damaged");
  checkEntries(await listArchive(archive));
  return { manifest, archive };
}

/** The top-level names in `home` a restore replaces: everything a backup would carry. */
async function swappable(home: string): Promise<string[]> {
  const names = await readdir(home).catch(() => [] as string[]);

  return names.filter((name) => !(TOP_LEVEL_SKIPPED.has(name) || name.startsWith(RESTORE_STAGING_PREFIX) || name.startsWith(BACKUP_STAGING_PREFIX) || name.endsWith(".tmp")));
}

export interface StagedRestore {
  manifest: BackupManifest;
  /** The staging folder, inside the data folder. */
  staging: string;
  /**
   * Moves the current state aside and the restored state in. Its result puts
   * the previous state back (`rollback`) or forgets it (`commit`).
   */
  apply(): Promise<AppliedRestore>;
  /** Removes the staging folder (and anything still in it). */
  discard(): Promise<void>;
}

export interface AppliedRestore {
  rollback(): Promise<void>;
  commit(): Promise<void>;
}

/**
 * The first half of a restore: the backup opened, checked and extracted into
 * a staging folder inside `home`. Nothing in `home` itself has changed yet;
 * `apply` does the swap.
 */
export async function stageRestore(options: { home: string; source: Readable; passphrase: string }): Promise<StagedRestore> {
  const home = resolve(options.home);
  const staging = join(home, `${RESTORE_STAGING_PREFIX}${randomBytes(6).toString("hex")}`);
  const data = join(staging, "data");
  const aside = join(staging, "previous");
  const discard = () => rm(staging, { recursive: true, force: true });

  try {
    const opened = await openBackup(options.source, options.passphrase, staging);

    await mkdir(data, { mode: 0o700 });
    await extractArchive(opened.archive, data);
    await rm(opened.archive, { force: true });
    // tar's own protections are on; this checks what actually landed, links included.
    await assertInside(data);
    return {
      manifest: opened.manifest,
      staging,
      discard,
      async apply() {
        await mkdir(aside, { mode: 0o700 });
        const names = [...new Set([...(await swappable(home)), ...(await swappable(data))])];
        const moved: Array<{ name: string; current: boolean; restored: boolean }> = [];
        const exists = (path: string) => lstat(path).then(() => true, () => false);

        const rollback = async () => {
          for (const step of moved.reverse()) {
            if (step.restored) await rename(join(home, step.name), join(data, step.name)).catch(() => undefined);
            if (step.current) await rename(join(aside, step.name), join(home, step.name));
          }
          moved.length = 0;
        };

        try {
          for (const name of names) {
            const step = { name, current: false, restored: false };

            moved.push(step);
            if (await exists(join(home, name))) {
              await rename(join(home, name), join(aside, name));
              step.current = true;
            }
            if (await exists(join(data, name))) {
              await rename(join(data, name), join(home, name));
              step.restored = true;
            }
          }
        } catch (error) {
          await rollback();
          throw error;
        }
        return {
          rollback,
          commit: discard,
        };
      },
    };
  } catch (error) {
    await discard();
    throw error;
  }
}

/** After extraction: every link in `root` points inside the top-level folder it is in (see staysInArea). */
async function assertInside(root: string): Promise<void> {
  const posixOf = (path: string) => path.split(sep).join("/");

  async function walk(dir: string): Promise<void> {
    for (const name of await readdir(dir)) {
      const path = join(dir, name);
      const info = await lstat(path);

      if (info.isSymbolicLink()) {
        const target = await readlink(path);

        if (isAbsolute(target) || !staysInArea(posixOf(relative(root, path)), posixOf(relative(root, resolve(dir, target))))) fail("unsafe");
      } else if (info.isDirectory()) await walk(path);
    }
  }

  await walk(root);
}

/** A sealed backup file as a stream (the command line's `backup restore`, an upload waiting for its passphrase). */
export function backupFileStream(file: string): Readable {
  return createReadStream(file);
}

