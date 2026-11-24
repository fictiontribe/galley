/**
 * Per-site connections: a site's own keys and its own publishing author,
 * kept beside the site's other state in `<home>/state/<siteId>/` —
 * `secrets.json` (0600 in a 0700 folder, written atomically, exactly like the
 * shared `<home>/secrets.json`) and `settings.json` (the author).
 *
 * Resolution, for any key name (the app's own and whatever names hosts or
 * plugins add later — nothing here lists them):
 *
 *   1. this site's own key,
 *   2. the environment the app was started from,
 *   3. the shared key stored in Settings.
 *
 * The environment sits between the two on purpose. It is how an operator pins
 * the one key a whole installation uses, and the app has never been able to
 * override it from Settings — that stays true for the shared key. A site's own
 * key is different: someone set it for that one site, on purpose, knowing the
 * site belongs to a client who pays for their own use, so it is the most
 * specific choice there is and it wins.
 *
 * None of this ever crosses HTTP: callers get `SiteConnections` — whether each
 * key is set, where the one in use comes from, and its last four characters.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { GalleyError } from "../errors";
import type { SecretName, SiteConnections, SiteSecretConnection } from "../types";
import { isSiteId } from "../site/scope";
import { rememberSecret } from "./errors";
import { createFileSecretStore, envSecret, secretHint, type SecretStore } from "./secrets";

export interface SiteAuthor {
  name: string;
  email: string;
}

function stateDir(home: string, siteId: string): string {
  if (!isSiteId(siteId)) throw new GalleyError("not-found", "That site isn't in the list.", siteId);
  return join(home, "state", siteId);
}

export function createSiteSettingsStore(home: string) {
  const stores = new Map<string, SecretStore>();
  let writes: Promise<unknown> = Promise.resolve();

  const secretsFor = (siteId: string): SecretStore => {
    let store = stores.get(siteId);

    if (!store) {
      store = createFileSecretStore(stateDir(home, siteId));
      stores.set(siteId, store);
    }
    return store;
  };

  async function readAuthor(siteId: string): Promise<SiteAuthor | null> {
    try {
      const parsed = JSON.parse(await readFile(join(stateDir(home, siteId), "settings.json"), "utf8")) as { author?: Partial<SiteAuthor> };
      const name = typeof parsed.author?.name === "string" ? parsed.author.name.trim() : "";
      const email = typeof parsed.author?.email === "string" ? parsed.author.email.trim() : "";

      return name && email ? { name, email } : null;
    } catch {
      return null;
    }
  }

  function writeAuthor(siteId: string, author: SiteAuthor | null): Promise<void> {
    const task = async () => {
      const dir = stateDir(home, siteId);
      const file = join(dir, "settings.json");

      if (!author) {
        await rm(file, { force: true });
        return;
      }
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const temp = join(dir, `.settings-${randomUUID()}.tmp`);

      await writeFile(temp, `${JSON.stringify({ author }, null, 2)}\n`, { mode: 0o600 });
      await rename(temp, file);
    };
    const run = writes.then(task, task);

    writes = run.catch(() => undefined);
    return run;
  }

  async function forget(siteId: string): Promise<void> {
    if (!isSiteId(siteId)) return;
    const dir = stateDir(home, siteId);

    stores.delete(siteId);
    // Only what this file owns: the site's deploy records and form submissions in the same folder stay.
    await Promise.all([rm(join(dir, "secrets.json"), { force: true }), rm(join(dir, "settings.json"), { force: true })]);
  }

  return { secretsFor, readAuthor, writeAuthor, forget };
}

export type SiteSettingsStore = ReturnType<typeof createSiteSettingsStore>;

/** The value in use for `name` on `siteId`, and where it came from — site → environment → shared. */
export async function resolveSecret(
  name: SecretName,
  siteId: string | null,
  deps: { env: NodeJS.ProcessEnv; shared: SecretStore; sites: SiteSettingsStore }
): Promise<{ value: string | null; source: "site" | "env" | "shared" | null }> {
  if (siteId && isSiteId(siteId)) {
    const own = await deps.sites.secretsFor(siteId).get(name);

    if (own) {
      rememberSecret(own);
      return { value: own, source: "site" };
    }
  }
  const fromEnv = envSecret(deps.env, name);

  if (fromEnv) {
    rememberSecret(fromEnv);
    return { value: fromEnv, source: "env" };
  }
  const stored = await deps.shared.get(name);

  if (stored) rememberSecret(stored);
  return { value: stored, source: stored ? "shared" : null };
}

export async function describeConnections(
  siteId: string,
  names: SecretName[],
  deps: { env: NodeJS.ProcessEnv; shared: SecretStore; sites: SiteSettingsStore; sharedAuthor: () => Promise<SiteAuthor> }
): Promise<SiteConnections> {
  if (!isSiteId(siteId)) throw new GalleyError("not-found", "That site isn't in the list.", siteId);
  const secrets = await Promise.all(
    names.map(async (name): Promise<SiteSecretConnection> => {
      const own = await deps.sites.secretsFor(siteId).get(name);
      const fromEnv = envSecret(deps.env, name);
      const stored = fromEnv ? null : await deps.shared.get(name);
      const shared = fromEnv ?? stored;
      const inUse = own ? "site" : fromEnv ? "env" : stored ? "shared" : null;
      const value = own ?? shared;

      return {
        name,
        inUse,
        ...(value ? { hint: secretHint(name, value) } : {}),
        site: own ? { configured: true, hint: secretHint(name, own) } : { configured: false },
        shared: shared ? { configured: true, source: fromEnv ? "env" : "stored", hint: secretHint(name, shared) } : { configured: false, source: null },
      };
    })
  );
  const own = await deps.sites.readAuthor(siteId);
  const shared = await deps.sharedAuthor();

  return {
    siteId,
    secrets,
    author: own ? { name: own.name, email: own.email, inUse: "site", site: own } : { name: shared.name, email: shared.email, inUse: "shared", site: null },
  };
}
