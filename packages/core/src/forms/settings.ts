/**
 * Per-site capture settings, kept in the app's own state folder (never in the
 * site's files, so nothing here is published with the site):
 *
 *   <home>/state/<siteId>/capture.json          extra origins, notification
 *                                               addresses, rate limits, the
 *                                               capture key's hash
 *   <home>/state/<siteId>/capture.secrets.json  the Turnstile secret and named
 *                                               forwarding secrets
 *
 * Both files are readable by this user only. The capture key itself is never
 * stored: only its SHA-256, so the key can be shown once when it is made.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GalleyError } from "../errors";
import { createKeyedLock } from "../site/util";
import { DEFAULT_RATE_LIMITS, type RateLimits } from "./spam";
import { checkSiteId, FORM_ID_PATTERN } from "./store";

export interface StoredCaptureSettings {
  version: 1;
  /** Origins allowed to post besides the site's own addresses, e.g. "https://landing.example.com". */
  extraOrigins: string[];
  /** For posts without an Origin (server-to-server): SHA-256 of the key, hex. */
  captureKey: { hash: string; hint: string; createdAt: string } | null;
  /** Form id → addresses told about each new submission. */
  notify: { [formId: string]: string[] };
  rateLimits: RateLimits;
}

interface StoredSecrets {
  turnstile?: string;
  forward?: { [name: string]: string };
}

export const MAX_EXTRA_ORIGINS = 20;
export const MAX_NOTIFY_ADDRESSES = 10;
export const SECRET_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const EMAIL = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/;

export function defaultCaptureSettings(): StoredCaptureSettings {
  return { version: 1, extraOrigins: [], captureKey: null, notify: {}, rateLimits: { ...DEFAULT_RATE_LIMITS } };
}

/** "https://Example.com/path" → "https://example.com". Null when it isn't an http(s) origin. */
export function normaliseOrigin(raw: string): string | null {
  try {
    const url = new URL(raw.trim());

    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export interface CaptureSettingsPatchInput {
  extraOrigins?: string[];
  notify?: { [formId: string]: string[] };
  rateLimits?: Partial<RateLimits>;
  turnstileSecret?: string | null;
  forwardSecrets?: { [name: string]: string | null };
}

export class CaptureSettingsStore {
  private readonly lock = createKeyedLock();

  constructor(private readonly home: string) {}

  private dir(siteId: string): string {
    return join(this.home, "state", checkSiteId(siteId));
  }

  async read(siteId: string): Promise<StoredCaptureSettings> {
    const raw = await readJson(join(this.dir(siteId), "capture.json"));
    const base = defaultCaptureSettings();

    if (!raw || typeof raw !== "object") return base;
    const input = raw as Partial<StoredCaptureSettings>;

    return {
      version: 1,
      extraOrigins: Array.isArray(input.extraOrigins) ? input.extraOrigins.filter((item): item is string => typeof item === "string") : [],
      captureKey: input.captureKey && typeof input.captureKey.hash === "string" ? input.captureKey : null,
      notify: input.notify && typeof input.notify === "object" ? input.notify : {},
      rateLimits: { ...base.rateLimits, ...(input.rateLimits ?? {}) },
    };
  }

  async secrets(siteId: string): Promise<{ turnstile: string | null; forward: { [name: string]: string } }> {
    const raw = (await readJson(join(this.dir(siteId), "capture.secrets.json"))) as StoredSecrets | null;

    return {
      turnstile: typeof raw?.turnstile === "string" && raw.turnstile ? raw.turnstile : null,
      forward: raw?.forward && typeof raw.forward === "object" ? raw.forward : {},
    };
  }

  /** Checks a posted capture key against the stored hash, in constant time. */
  async keyMatches(siteId: string, key: string): Promise<boolean> {
    const stored = (await this.read(siteId)).captureKey;

    if (!stored || !key) return false;
    const given = Buffer.from(hashKey(key), "hex");
    const expected = Buffer.from(stored.hash, "hex");

    return expected.length === 32 && given.length === expected.length && timingSafeEqual(given, expected);
  }

  async patch(siteId: string, patch: CaptureSettingsPatchInput): Promise<StoredCaptureSettings> {
    return this.lock(siteId, async () => {
      const current = await this.read(siteId);
      const next: StoredCaptureSettings = { ...current };

      if (patch.extraOrigins) {
        const origins: string[] = [];

        for (const raw of patch.extraOrigins) {
          const origin = normaliseOrigin(raw);

          if (!origin) throw new GalleyError("invalid", `“${raw.slice(0, 80)}” isn't a web address. Use the full address, like https://www.example.com.`);
          if (!origins.includes(origin)) origins.push(origin);
        }
        if (origins.length > MAX_EXTRA_ORIGINS) throw new GalleyError("invalid", `Up to ${MAX_EXTRA_ORIGINS} other addresses can be allowed.`);
        next.extraOrigins = origins;
      }
      if (patch.notify) {
        const notify = { ...current.notify };

        for (const [formId, list] of Object.entries(patch.notify)) {
          if (!FORM_ID_PATTERN.test(formId)) throw new GalleyError("invalid", "There's no such form on this site.", formId);
          const addresses = [...new Set(list.map((item) => item.trim().toLowerCase()).filter(Boolean))];

          for (const address of addresses) {
            if (!EMAIL.test(address)) throw new GalleyError("invalid", `“${address.slice(0, 80)}” isn't an e-mail address.`);
          }
          if (addresses.length > MAX_NOTIFY_ADDRESSES) throw new GalleyError("invalid", `Up to ${MAX_NOTIFY_ADDRESSES} addresses can be told about each form.`);
          if (addresses.length) notify[formId] = addresses;
          else delete notify[formId];
        }
        next.notify = notify;
      }
      if (patch.rateLimits) {
        const limits = { ...current.rateLimits };

        for (const key of ["perIpPerMinute", "perFormPerMinute"] as const) {
          const value = patch.rateLimits[key];

          if (value === undefined) continue;
          if (!Number.isInteger(value) || value < 1 || value > 10_000) throw new GalleyError("invalid", "Rate limits are whole numbers from 1 to 10,000.");
          limits[key] = value;
        }
        next.rateLimits = limits;
      }
      if (patch.turnstileSecret !== undefined || patch.forwardSecrets !== undefined) await this.patchSecrets(siteId, patch);
      await this.write(siteId, "capture.json", next);
      return next;
    });
  }

  /** Makes a new capture key (replacing any old one) and returns it — the only time it is ever shown. */
  async rotateKey(siteId: string): Promise<string> {
    return this.lock(siteId, async () => {
      const key = `ck_${randomBytes(24).toString("base64url")}`;
      const current = await this.read(siteId);

      await this.write(siteId, "capture.json", { ...current, captureKey: { hash: hashKey(key), hint: key.slice(-4), createdAt: new Date().toISOString() } });
      return key;
    });
  }

  async removeKey(siteId: string): Promise<void> {
    await this.lock(siteId, async () => {
      await this.write(siteId, "capture.json", { ...(await this.read(siteId)), captureKey: null });
    });
  }

  private async patchSecrets(siteId: string, patch: CaptureSettingsPatchInput): Promise<void> {
    const file = join(this.dir(siteId), "capture.secrets.json");
    const current = ((await readJson(file)) as StoredSecrets | null) ?? {};
    const next: StoredSecrets = { ...current, forward: { ...(current.forward ?? {}) } };

    if (patch.turnstileSecret !== undefined) {
      const value = patch.turnstileSecret?.trim() ?? "";

      if (value && (/\s/.test(value) || value.length > 256)) throw new GalleyError("invalid", "That doesn't look like a Turnstile secret key. Copy it again from the Cloudflare dashboard.");
      if (value) next.turnstile = value;
      else delete next.turnstile;
    }
    for (const [name, value] of Object.entries(patch.forwardSecrets ?? {})) {
      if (!SECRET_NAME_PATTERN.test(name)) throw new GalleyError("invalid", "Secret names use lowercase letters, digits, hyphens and underscores.");
      if (value === null || value.trim() === "") delete next.forward![name];
      else if (value.length > 4096) throw new GalleyError("invalid", "That secret is too long.");
      else next.forward![name] = value.trim();
    }
    await this.write(siteId, "capture.secrets.json", next);
  }

  private async write(siteId: string, name: string, data: unknown): Promise<void> {
    const dir = this.dir(siteId);

    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = join(dir, `.${name}.${randomBytes(6).toString("hex")}.tmp`);

    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, join(dir, name));
  }
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}
