/**
 * The install's sign-in password, stored only as an scrypt hash.
 *
 * The hash string carries its own parameters —
 * `scrypt$<N>$<r>$<p>$<salt>$<hash>` (salt and hash base64url) — so the cost
 * can be raised in a later version without locking anyone out: old hashes
 * keep verifying with the parameters they were made with. scrypt comes from
 * node:crypto, so there is no dependency to trust.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { GalleyError } from "../errors";
import { MIN_INSTALL_PASSWORD_LENGTH } from "./types";

/** About 50–100 ms on a small server: slow for a guesser, unnoticeable at sign-in. */
export const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;
const SALT_BYTES = 16;
/** Longest password accepted: scrypt is fine with more, but nobody types a novel. */
export const MAX_INSTALL_PASSWORD_LENGTH = 1024;

function scrypt(password: string, salt: Buffer, length: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password.normalize("NFC"), salt, length, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** 128·N·r bytes, with room to spare. */
function maxmem(N: number, r: number): number {
  return 256 * N * r;
}

/** A plain refusal for a password that can't be used, or null when it can. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length === 0) return "Choose a password.";
  if ([...password].length < MIN_INSTALL_PASSWORD_LENGTH) {
    return `The password needs at least ${MIN_INSTALL_PASSWORD_LENGTH} characters, because this editor can be reached from the internet.`;
  }
  if (password.length > MAX_INSTALL_PASSWORD_LENGTH) return `Keep the password under ${MAX_INSTALL_PASSWORD_LENGTH} characters.`;
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const problem = passwordProblem(password);

  if (problem) throw new GalleyError("invalid", problem);
  const { N, r, p } = SCRYPT_PARAMS;
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEY_LENGTH, { N, r, p, maxmem: maxmem(N, r) });

  return ["scrypt", N, r, p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** Whether `password` matches `stored`. A malformed stored hash matches nothing. Constant time in the comparison. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0 || password.length > MAX_INSTALL_PASSWORD_LENGTH) return false;
  const parts = stored.split("$");

  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];

  // Bounds keep a tampered file from making one sign-in cost minutes of CPU or gigabytes of memory.
  if (![N, r, p].every(Number.isInteger) || N < 2 ** 10 || N > 2 ** 20 || (N & (N - 1)) !== 0 || r < 1 || r > 32 || p < 1 || p > 16) return false;
  const salt = Buffer.from(parts[4]!, "base64url");
  const expected = Buffer.from(parts[5]!, "base64url");

  if (salt.length < 8 || expected.length < 16 || expected.length > 128) return false;
  const actual = await scrypt(password, salt, expected.length, { N, r, p, maxmem: maxmem(N, r) });

  return timingSafeEqual(actual, expected);
}
