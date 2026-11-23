/**
 * The stable access token for harness configurations.
 *
 * The server's own session token changes on every start, which is useless in
 * a config file. This one is made once (`galley mcp token`), lives in the
 * home directory as a SHA-256 hash only (0600), and is accepted by the HTTP
 * mount as `Authorization: Bearer <token>` until it is rotated. Because only
 * the hash is kept, the token can be shown once — when it is made — and
 * never again; a lost token is replaced with `--rotate`.
 *
 * A plain hash (not a slow password hash) is right here: the token is 32
 * random bytes, so there is nothing to brute-force.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PRODUCT } from "@galley/core/brand";

export const TOKEN_FILE = "mcp-token.json";

interface TokenRecord {
  version: 1;
  sha256: string;
  /** Last four characters, so a person can tell which token a config holds. */
  hint: string;
  createdAt: string;
}

export interface TokenInfo {
  /** The token itself — only when it was just created. */
  token: string | null;
  created: boolean;
  hint: string;
  createdAt: string;
  file: string;
}

function digest(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

async function load(file: string): Promise<TokenRecord | null> {
  try {
    const record = JSON.parse(await readFile(file, "utf8")) as Partial<TokenRecord>;

    return record.version === 1 && typeof record.sha256 === "string" && /^[0-9a-f]{64}$/.test(record.sha256) ? (record as TokenRecord) : null;
  } catch {
    return null;
  }
}

/** Returns the existing token's details, or makes one (always, with `rotate`). */
export async function ensureMcpToken(home: string, options: { rotate?: boolean } = {}): Promise<TokenInfo> {
  const file = join(home, TOKEN_FILE);
  const existing = options.rotate ? null : await load(file);

  if (existing) return { token: null, created: false, hint: existing.hint, createdAt: existing.createdAt, file };
  const token = `${PRODUCT.slug}_mcp_${randomBytes(32).toString("base64url")}`;
  const record: TokenRecord = { version: 1, sha256: digest(token).toString("hex"), hint: token.slice(-4), createdAt: new Date().toISOString() };
  const temp = `${file}.${process.pid}.tmp`;

  await mkdir(home, { recursive: true, mode: 0o700 });
  await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, file);
  return { token, created: true, hint: record.hint, createdAt: record.createdAt, file };
}

/**
 * A checker for presented tokens. It re-reads the file when it changes, so a
 * rotation takes effect without restarting the server.
 */
export function mcpTokenVerifier(home: string): (presented: string) => Promise<boolean> {
  const file = join(home, TOKEN_FILE);
  let cached: { mtimeMs: number; hash: Buffer | null } | null = null;

  return async (presented) => {
    let mtimeMs: number;

    try {
      mtimeMs = (await stat(file)).mtimeMs;
    } catch {
      cached = null;
      return false;
    }
    if (!cached || cached.mtimeMs !== mtimeMs) {
      const record = await load(file);

      cached = { mtimeMs, hash: record ? Buffer.from(record.sha256, "hex") : null };
    }
    return cached.hash !== null && timingSafeEqual(digest(presented), cached.hash);
  };
}
