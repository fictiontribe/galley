/**
 * Settings: `<home>/settings.json` (model, effort, image provider, author,
 * appearance and the default theme's id), secrets (a site's own key first, then the environment, then the
 * SecretStore — see site-settings.ts) and usage.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { GalleyError } from "../errors";
import type { Effort, SecretName, SecretStatus, Settings, SettingsPatch, SettingsService, UsageSummary } from "../types";
import { rememberSecret } from "./errors";
import { builtinImageHandles } from "../plugins/defaults";
import { keyConfigured, providerInfo, type ImageProviderSource } from "./images/providers";
import { DEFAULT_MODEL, MODELS, isKnownModel } from "./models";
import { createFileSecretStore, envSecret, normalizeSecret, statusFor, type SecretStore } from "./secrets";
import { appendUsage, readUsage, summarizeUsage, type UsageLine } from "./usage";
import type { PreviewPolicySettings, SiteUsageTotals } from "../types";
import { currentSiteId, isSiteId } from "../site/scope";
import { createSiteSettingsStore, describeConnections, resolveSecret } from "./site-settings";
import { DEFAULT_PREVIEW_POLICY, PREVIEW_LIMITS } from "../site/preview-policy";
import { THEME_ID_PATTERN, isThemeId } from "../themes/contract";

const run = promisify(execFile);
const SECRET_NAMES: SecretName[] = ["anthropic", "openai", "google", "cloudflare", "vercel", "fly", "gcp"];
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh"];

const StoredSettings = z.object({
  ai: z.object({ model: z.string().optional(), effort: z.enum(EFFORTS).optional() }).optional(),
  images: z.object({ provider: z.string().nullable().optional(), model: z.string().nullable().optional() }).optional(),
  videos: z.object({ provider: z.string().nullable().optional(), model: z.string().nullable().optional() }).optional(),
  author: z.object({ name: z.string().optional(), email: z.string().optional() }).optional(),
  appearance: z.object({ theme: z.enum(["system", "light", "dark"]).optional(), look: z.string().regex(THEME_ID_PATTERN).optional() }).optional(),
  previews: z.object({ maxRunning: z.number().int().optional(), idleMinutes: z.number().int().optional() }).optional(),
});
type Stored = z.infer<typeof StoredSettings>;

export interface SettingsServiceOptions {
  home: string;
  env?: NodeJS.ProcessEnv;
  secretStore?: SecretStore;
  /** The image providers Settings may choose from — the plugin registry's. Default: the built-in ones. */
  imageProviders?: ImageProviderSource;
  /** The video services Settings may choose from — the plugin registry's. Without it, any well-formed id is kept. */
  videoProviders?: () => ReadonlyArray<{ id: string; label: string }>;
  /** Test seam: the clock used to bucket usage. */
  now?: () => number;
}

export interface GalleySettingsService extends SettingsService {
  /** Where the current key for a secret comes from, without reading it. `siteId` as in `get`. */
  secretStatus(name: SecretName, options?: { siteId?: string }): Promise<SecretStatus>;
  /** The preview limits in force (defaults when unset). */
  previewPolicy(): Promise<PreviewPolicySettings>;
}

/** The machine's git identity, read once (read-only, never written). */
function gitIdentityReader(env: NodeJS.ProcessEnv): () => Promise<{ name: string; email: string }> {
  let cached: Promise<{ name: string; email: string }> | null = null;
  const read = async (key: string) => {
    try {
      const { stdout } = await run("git", ["config", "--get", key], { env, timeout: 5_000 });

      return stdout.trim();
    } catch {
      return "";
    }
  };

  return () => {
    cached ??= Promise.all([read("user.name"), read("user.email")]).then(([name, email]) => ({ name, email }));
    return cached;
  };
}

export function createSettingsService(options: SettingsServiceOptions): GalleySettingsService {
  const { home } = options;
  const env = options.env ?? process.env;
  const store = options.secretStore ?? createFileSecretStore(home);
  const now = options.now ?? Date.now;
  const imageProviders = options.imageProviders ?? builtinImageHandles;
  const file = join(home, "settings.json");
  const gitIdentity = gitIdentityReader(env);
  let writes: Promise<unknown> = Promise.resolve();

  async function load(): Promise<Stored> {
    try {
      const parsed = StoredSettings.safeParse(JSON.parse(await readFile(file, "utf8")));

      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  }

  async function save(data: Stored): Promise<void> {
    await mkdir(home, { recursive: true });
    const temp = join(home, `.settings-${randomUUID()}.tmp`);

    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`);
    await rename(temp, file);
  }

  const siteSettings = createSiteSettingsStore(home);
  /** The site a call is for: the one named, else the site whose request is being served (site/scope.ts). */
  const siteOf = (options?: { siteId?: string }): string | null => {
    const id = options?.siteId ?? currentSiteId();

    return isSiteId(id) ? id : null;
  };

  // Site's own key → environment → shared stored key (ai/site-settings.ts says why).
  async function secretValue(name: SecretName, siteId: string | null = null): Promise<{ value: string | null; source: SecretStatus["source"] }> {
    const resolved = await resolveSecret(name, siteId, { env, shared: store, sites: siteSettings });

    return { value: resolved.value, source: resolved.source === "env" ? "env" : resolved.value ? "stored" : null };
  }

  async function secretStatus(name: SecretName, options?: { siteId?: string }): Promise<SecretStatus> {
    const { value, source } = await secretValue(name, siteOf(options));

    return statusFor(name, value, source);
  }

  async function sharedAuthor(): Promise<{ name: string; email: string }> {
    const [data, identity] = await Promise.all([load(), gitIdentity()]);

    return { name: data.author?.name || identity.name, email: data.author?.email || identity.email };
  }

  async function get(options?: { siteId?: string }): Promise<Settings> {
    const data = await load();
    const siteId = siteOf(options);
    const secrets = await Promise.all(SECRET_NAMES.map((name) => secretStatus(name, siteId ? { siteId } : undefined)));
    const ownAuthor = siteId ? await siteSettings.readAuthor(siteId) : null;
    const configured = new Set(secrets.filter((status) => status.configured).map((status) => status.name));
    const identity = await gitIdentity();
    const model = data.ai?.model && isKnownModel(data.ai.model) ? data.ai.model : DEFAULT_MODEL;
    const handles = imageProviders();
    const infos = await Promise.all(handles.map(async (handle) => providerInfo(handle, await keyConfigured(handle, (secret) => configured.has(secret)))));
    // The service actually in use: the chosen one while its key is there, else none (the placeholder generator) —
    // so Settings never shows a service as selected that generation would refuse.
    const chosen = infos.find((info) => info.id === data.images?.provider);
    const provider = chosen?.configured ? chosen.id : null;

    return {
      ai: { model, effort: data.ai?.effort ?? "medium", models: MODELS },
      images: {
        provider,
        model: provider ? (data.images?.model ?? null) : null,
        providers: infos,
      },
      videos: { provider: data.videos?.provider ?? null, model: data.videos?.provider ? (data.videos.model ?? null) : null },
      author: ownAuthor ?? { name: data.author?.name || identity.name, email: data.author?.email || identity.email },
      authorSaved: Boolean(data.author?.name?.trim() && data.author.email?.trim()),
      appearance: { theme: data.appearance?.theme ?? "system", ...(data.appearance?.look ? { look: data.appearance.look } : {}) },
      secrets,
      previews: previewsFrom(data),
    };
  }

  function previewsFrom(data: Stored): PreviewPolicySettings {
    const clamp = (value: number | undefined, [min, max]: readonly [number, number], fallback: number) =>
      typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

    return {
      maxRunning: clamp(data.previews?.maxRunning, PREVIEW_LIMITS.maxRunning, DEFAULT_PREVIEW_POLICY.maxRunning),
      idleMinutes: clamp(data.previews?.idleMinutes, PREVIEW_LIMITS.idleMinutes, DEFAULT_PREVIEW_POLICY.idleMinutes),
    };
  }

  async function validatePatch(patch: SettingsPatch): Promise<void> {
    if (patch.ai?.model !== undefined && !isKnownModel(patch.ai.model)) {
      throw new GalleyError("invalid", "That model isn't one of the choices in Settings.", patch.ai.model);
    }
    if (patch.ai?.effort !== undefined && !EFFORTS.includes(patch.ai.effort)) {
      throw new GalleyError("invalid", "Choose low, medium, high or extra high effort.", String(patch.ai.effort));
    }
    const provider = patch.images?.provider;
    const handle = provider ? imageProviders().find((candidate) => candidate.id === provider) : undefined;

    if (provider !== undefined && provider !== null && !handle) {
      throw new GalleyError("invalid", "That image provider isn't available.", provider);
    }
    // Choosing a service before its key is there would show it as selected while generation is refused.
    if (handle?.key && !(await keyConfigured(handle, async (secret) => (await secretStatus(secret)).configured))) {
      throw new GalleyError("invalid", `Add ${handle.key.phrase} first, then choose ${handle.label}.`, provider!);
    }
    if (patch.images?.model !== undefined && patch.images.model !== null) {
      const models = handle ? await handle.models() : null;

      // Model ids are "vendor/name" on routing services, so a slash is allowed.
      if (models && !models.some((model) => model.id === patch.images?.model) && !/^[\w./:-]{2,120}$/.test(patch.images.model)) {
        throw new GalleyError("invalid", "That image model name doesn't look right.", patch.images.model);
      }
    }
    const video = patch.videos?.provider;

    if (video !== undefined && video !== null) {
      const known = options.videoProviders?.();

      if (known ? !known.some((candidate) => candidate.id === video) : !/^[a-z0-9][a-z0-9-]{0,63}$/.test(video)) {
        throw new GalleyError("invalid", "That video service isn't available. Turn on its plugin first.", video);
      }
    }
    // Model ids are "vendor/name" on routing services; the service itself says whether it has one when a video is made.
    if (patch.videos?.model !== undefined && patch.videos.model !== null && !/^[\w./:-]{2,120}$/.test(patch.videos.model)) {
      throw new GalleyError("invalid", "That video model name doesn't look right.", patch.videos.model);
    }
    const email = patch.author?.email?.trim();

    if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) {
      throw new GalleyError("invalid", "That email address doesn't look right. It should look like name@example.com.");
    }
    if (patch.appearance?.theme !== undefined && !["system", "light", "dark"].includes(patch.appearance.theme)) {
      throw new GalleyError("invalid", "Choose system, light or dark.");
    }
    // Whether the theme exists is the caller's to check (the server knows the saved and plugin themes); here, only its shape.
    if (patch.appearance?.look !== undefined && !isThemeId(patch.appearance.look)) {
      throw new GalleyError("invalid", "Choose one of the themes listed.");
    }
    for (const key of ["maxRunning", "idleMinutes"] as const) {
      const value = patch.previews?.[key];
      const [min, max] = PREVIEW_LIMITS[key];

      if (value !== undefined && !(Number.isInteger(value) && value >= min && value <= max)) {
        throw new GalleyError("invalid", key === "maxRunning" ? `Choose between ${min} and ${max} previews.` : `Choose between ${min} and ${max} minutes.`);
      }
    }
  }

  async function authorLayers(options?: { siteId?: string }) {
    const data = await load();
    const siteId = siteOf(options);
    const app = data.author?.name?.trim() && data.author.email?.trim() ? { name: data.author.name.trim(), email: data.author.email.trim() } : null;

    return { site: siteId ? await siteSettings.readAuthor(siteId) : null, app };
  }

  return {
    get,
    authorLayers,

    async look() {
      return (await load()).appearance?.look;
    },

    update(patch) {
      const task = async () => {
        await validatePatch(patch);
        const data = await load();
        const next: Stored = {
          ai: { ...data.ai, ...definedOnly(patch.ai) },
          images: { ...data.images, ...definedOnly(patch.images) },
          ...(patch.videos || data.videos ? { videos: { ...data.videos, ...definedOnly(patch.videos) } } : {}),
          author: {
            ...data.author,
            ...definedOnly({ name: patch.author?.name?.trim(), email: patch.author?.email?.trim() }),
          },
          appearance: { ...data.appearance, ...definedOnly(patch.appearance) },
          ...(patch.previews || data.previews ? { previews: { ...data.previews, ...definedOnly(patch.previews) } } : {}),
        };

        // Switching provider forgets a model chosen for the previous one.
        if (patch.images?.provider !== undefined && patch.images.model === undefined && patch.images.provider !== data.images?.provider) {
          next.images = { ...next.images, model: null };
        }
        if (patch.videos?.provider !== undefined && patch.videos.model === undefined && patch.videos.provider !== data.videos?.provider) {
          next.videos = { ...next.videos, model: null };
        }
        await save(next);
        return get();
      };
      const result = writes.then(task, task);

      writes = result.catch(() => undefined);
      return result;
    },

    async setSecret(name, value) {
      if (!SECRET_NAMES.includes(name)) throw new GalleyError("invalid", "That isn't a key this app uses.");
      if (envSecret(env, name)) {
        throw new GalleyError(
          "invalid",
          `This key is set by the environment the app was started from (${SECRET_ENV_HINT[name]}), so it can't be changed here. Change it there and restart the app.`
        );
      }
      if (value === null) {
        await store.set(name, null);
        return statusFor(name, null, null);
      }
      const normalized = normalizeSecret(name, value);

      rememberSecret(normalized);
      await store.set(name, normalized);
      return statusFor(name, normalized, "stored");
    },

    async readSecret(name, options) {
      return (await secretValue(name, siteOf(options))).value;
    },

    secretStatus,

    async previewPolicy() {
      return previewsFrom(await load());
    },

    async usage(options): Promise<UsageSummary> {
      const lines = await readUsage(home);
      const siteId = options?.siteId;

      return summarizeUsage(siteId ? lines.filter((line) => line.siteId === siteId) : lines, now());
    },

    async usageBySite(): Promise<SiteUsageTotals[]> {
      const bySite = new Map<string, UsageLine[]>();

      for (const line of await readUsage(home)) {
        if (typeof line.siteId !== "string") continue;
        const list = bySite.get(line.siteId) ?? [];

        list.push(line);
        bySite.set(line.siteId, list);
      }
      return [...bySite.entries()].map(([siteId, lines]) => {
        const summary = summarizeUsage(lines, now());

        return { siteId, last30: summary.last30, allTime: summary.allTime };
      });
    },

    siteConnections(siteId) {
      return describeConnections(siteId, SECRET_NAMES, { env, shared: store, sites: siteSettings, sharedAuthor });
    },

    async setSiteSecret(siteId, name, value) {
      if (!SECRET_NAMES.includes(name)) throw new GalleyError("invalid", "That isn't a key this app uses.");
      if (!isSiteId(siteId)) throw new GalleyError("not-found", "That site isn't in the list.", siteId);
      // Unlike the shared key, a site's own key may be set while the environment
      // has one: the site's own wins (site-settings.ts says why).
      if (value === null) await siteSettings.secretsFor(siteId).set(name, null);
      else {
        const normalized = normalizeSecret(name, value);

        rememberSecret(normalized);
        await siteSettings.secretsFor(siteId).set(name, normalized);
      }
      return describeConnections(siteId, SECRET_NAMES, { env, shared: store, sites: siteSettings, sharedAuthor });
    },

    async setSiteAuthor(siteId, author) {
      if (!isSiteId(siteId)) throw new GalleyError("not-found", "That site isn't in the list.", siteId);
      if (author) {
        const name = author.name.trim();
        const email = author.email.trim();

        if (!name || name.length > 200) throw new GalleyError("invalid", "Give the author a name of up to 200 characters.");
        if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 320) {
          throw new GalleyError("invalid", "That email address doesn't look right. It should look like name@example.com.");
        }
        await siteSettings.writeAuthor(siteId, { name, email });
      } else {
        await siteSettings.writeAuthor(siteId, null);
      }
      return describeConnections(siteId, SECRET_NAMES, { env, shared: store, sites: siteSettings, sharedAuthor });
    },

    forgetSite(siteId) {
      return siteSettings.forget(siteId);
    },

    async recordUsage(entry) {
      const line: UsageLine = {
        siteId: entry.siteId,
        at: entry.at,
        model: entry.model,
        requests: entry.requests,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        cacheReadTokens: entry.cacheReadTokens,
        cacheWriteTokens: entry.cacheWriteTokens,
        cost: entry.cost,
        ...(entry.images ? { images: entry.images } : {}),
        ...(entry.videos ? { videos: entry.videos } : {}),
        ...((entry as Partial<UsageLine>).kind === "summary" ? { kind: "summary" as const } : {}),
      };

      try {
        await appendUsage(home, line);
      } catch {
        // Accounting must never break a turn or an image.
      }
    },
  };
}

const SECRET_ENV_HINT: Record<SecretName, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY or GOOGLE_API_KEY",
  cloudflare: "CLOUDFLARE_API_TOKEN",
  vercel: "VERCEL_TOKEN",
  fly: "FLY_API_TOKEN",
  gcp: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
};

function definedOnly<T extends object>(value: T | undefined): Partial<T> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
