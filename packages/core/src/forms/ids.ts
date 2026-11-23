/**
 * Submission ids that sort by time: 10 characters of milliseconds in
 * Crockford base 32, then 12 random ones (the ULID layout, shortened). Two
 * ids minted in the same millisecond still sort in minting order, because the
 * random part is incremented rather than redrawn.
 */
import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 12;

function encodeTime(ms: number): string {
  let out = "";
  let rest = Math.max(0, Math.floor(ms));

  for (let i = 0; i < TIME_LENGTH; i += 1) {
    out = ALPHABET[rest % 32] + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

function randomPart(): number[] {
  return [...randomBytes(RANDOM_LENGTH)].map((byte) => byte % 32);
}

/** Adds one to a base-32 digit list; false on overflow. */
function increment(digits: number[]): boolean {
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    if (digits[i]! < 31) {
      digits[i]! += 1;
      return true;
    }
    digits[i] = 0;
  }
  return false;
}

export interface IdMinter {
  (now?: number): string;
}

export function createIdMinter(): IdMinter {
  let lastTime = -1;
  let lastRandom: number[] = [];

  return (now = Date.now()) => {
    if (now > lastTime) {
      lastTime = now;
      lastRandom = randomPart();
    } else if (!increment(lastRandom)) {
      lastTime += 1;
      lastRandom = randomPart();
    }
    return encodeTime(lastTime) + lastRandom.map((digit) => ALPHABET[digit]).join("");
  };
}

/** The shape of an id this module mints. Anything else is refused at the boundary. */
export const SUBMISSION_ID = /^[0-9A-HJKMNP-TV-Z]{22}$/;

/** The milliseconds an id was minted at. */
export function idTime(id: string): number {
  let ms = 0;

  for (const char of id.slice(0, TIME_LENGTH)) ms = ms * 32 + ALPHABET.indexOf(char);
  return ms;
}
