/**
 * A media store's keys, kept per site beside the site's other state in
 * `<home>/state/<siteId>/media/secrets.json` (0600 in a 0700 folder, written
 * atomically, like every key file of the app) — never in the site's files,
 * never in an answer or a log. A file of its own, so it never races the
 * site's other keys being saved.
 *
 * Resolution: the site's own key, then the environment the app was started
 * from (an operator pinning one bucket for a hosted install):
 *   GALLEY_MEDIA_ACCESS_KEY_ID, GALLEY_MEDIA_SECRET_ACCESS_KEY.
 */
import { GalleyError } from "../errors";
import { rememberSecret, scrubSecrets } from "../ai/errors";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createFileSecretStore, type SecretStore } from "../ai/secrets";
import { isSiteId } from "../site/scope";
import type { MediaKeyStatus } from "./contract";

export type MediaKeyName = "accessKeyId" | "secretAccessKey";

const STORED: Record<MediaKeyName, string> = {
  accessKeyId: "media:bucket:accessKeyId",
  secretAccessKey: "media:bucket:secretAccessKey",
};

export const MEDIA_KEY_ENV: Record<MediaKeyName, string> = {
  accessKeyId: "GALLEY_MEDIA_ACCESS_KEY_ID",
  secretAccessKey: "GALLEY_MEDIA_SECRET_ACCESS_KEY",
};

const SHAPES: Record<MediaKeyName, { test: RegExp; message: string }> = {
  accessKeyId: { test: /^[A-Za-z0-9]{16,128}$/, message: "That doesn't look like an Access Key ID: one word of letters and digits, like the one shown next to the secret." },
  secretAccessKey: { test: /^[A-Za-z0-9/+=_-]{20,256}$/, message: "That doesn't look like a Secret Access Key: one long word, shown once when the key was made." },
};

/** Trims a pasted key and refuses obvious mistakes. Never echoes it. */
export function normalizeMediaKey(name: MediaKeyName, value: string): string {
  const trimmed = value.trim().replace(/^["']|["']$/g, "");

  if (!SHAPES[name].test.test(trimmed)) throw new GalleyError("invalid", SHAPES[name].message);
  return trimmed;
}

export interface MediaKeys {
  get(siteId: string, name: MediaKeyName): Promise<{ value: string | null; source: "site" | "env" | null }>;
  set(siteId: string, name: MediaKeyName, value: string | null): Promise<void>;
  status(siteId: string, name: MediaKeyName): Promise<MediaKeyStatus>;
  /** Removes every media key of the site (it left the list). */
  forget(siteId: string): Promise<void>;
}

function mediaStateDir(home: string, siteId: string): string {
  if (!isSiteId(siteId)) throw new GalleyError("not-found", "That site isn't in the list.", siteId);
  return join(home, "state", siteId, "media");
}

export function createMediaKeys(options: { home: string; env?: NodeJS.ProcessEnv; storeFor?: (siteId: string) => SecretStore }): MediaKeys {
  const env = options.env ?? process.env;
  const stores = new Map<string, SecretStore>();
  const storeFor =
    options.storeFor ??
    ((siteId: string) => {
      let store = stores.get(siteId);

      if (!store) {
        store = createFileSecretStore(mediaStateDir(options.home, siteId));
        stores.set(siteId, store);
      }
      return store;
    });

  const keys: MediaKeys = {
    async get(siteId, name) {
      const own = await storeFor(siteId).get(STORED[name]);

      if (own) {
        rememberSecret(own);
        return { value: own, source: "site" };
      }
      const fromEnv = env[MEDIA_KEY_ENV[name]]?.trim();

      if (fromEnv) {
        rememberSecret(fromEnv);
        return { value: fromEnv, source: "env" };
      }
      return { value: null, source: null };
    },
    async set(siteId, name, value) {
      if (value === null) {
        await storeFor(siteId).set(STORED[name], null);
        return;
      }
      const normalized = normalizeMediaKey(name, value);

      rememberSecret(normalized);
      await storeFor(siteId).set(STORED[name], normalized);
    },
    async status(siteId, name) {
      const { value, source } = await keys.get(siteId, name);

      // An Access Key ID isn't secret on its own, but the hint is the same four characters either way.
      return value ? { configured: true, source, hint: value.slice(-4) } : { configured: false, source: null };
    },
    async forget(siteId) {
      if (!isSiteId(siteId)) return;
      stores.delete(siteId);
      await rm(join(mediaStateDir(options.home, siteId), "secrets.json"), { force: true });
    },
  };
  return keys;
}

/** Any text about to leave the engine: known keys and key-shaped words removed. */
export function scrub(text: string): string {
  return scrubSecrets(text);
}
