/**
 * Plugin settings: plain values in `<home>/plugin-settings.json`, secrets in
 * the same secret store the app's own keys use (environment first). A
 * plugin's secrets are kept under its own name, so one plugin never reads
 * another's — built-in plugins alone may give a secret a shared name
 * ("openrouter") so a key keeps one name however it is reached.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GalleyError } from "../errors";
import { rememberSecret, scrubSecrets } from "../ai/errors";
import { SECRET_ENV, type SecretStore } from "../ai/secrets";
import type { PluginSettingInfo, SecretName } from "../types";
import type { PluginLogger, PluginSettingField } from "./types";

const BUILTIN_SECRETS = Object.keys(SECRET_ENV) as SecretName[];
const ENGINE_ENV = new Set(Object.values(SECRET_ENV).flat());

/** One setting as the app may see it (types.ts `PluginSettingInfo`). */
export type PluginSettingStatus = PluginSettingInfo;

/** Who a settings call is for: the plugin's name, its declared fields, and whether it is built in. */
export interface SettingsOwner {
  name: string;
  fields: readonly PluginSettingField[];
  trusted: boolean;
}

export interface PluginSettingsStore {
  /** Every setting resolved, secrets included — for the plugin itself only. */
  values(owner: SettingsOwner): Promise<Record<string, string | undefined>>;
  status(owner: SettingsOwner): Promise<PluginSettingStatus[]>;
  /** `null` removes a value. Refuses unknown keys, values that don't match `pattern`, and anything the environment sets. */
  save(owner: SettingsOwner, patch: Record<string, string | null>): Promise<PluginSettingStatus[]>;
}

export interface PluginSettingsOptions {
  home: string;
  env: NodeJS.ProcessEnv;
  secrets: SecretStore;
  /** Saves one of the app's own keys (anthropic, openai, google) the way Settings does, with its checks. */
  setBuiltinSecret?(name: SecretName, value: string | null): Promise<unknown>;
}

/** What a toggle or a choice reads as while nothing is saved: a toggle is off unless it says otherwise. */
export function defaultOf(field: PluginSettingField): string | undefined {
  if (field.type === "toggle") return field.default === "on" ? "on" : "off";
  if (field.type === "select") return field.default;
  return undefined;
}

/** A switch is saved as "on" or "off" whichever word for it arrives. */
function toggleValue(field: PluginSettingField, raw: string): string {
  const value = raw.trim().toLowerCase();
  if (/^(on|yes|true|1)$/.test(value)) return "on";
  if (/^(off|no|false|0)$/.test(value)) return "off";
  throw new GalleyError("invalid", `${field.label} is a switch: it can be on or off.`);
}

/** Where a secret setting is kept in the secret store. */
export function secretNameFor(owner: Pick<SettingsOwner, "name" | "trusted">, field: PluginSettingField): string {
  return owner.trusted && field.secretName ? field.secretName : `plugin:${owner.name}:${field.key}`;
}

/** The environment variables a field may be read from: plugins that aren't built in never get the engine's own. */
export function envNamesFor(owner: Pick<SettingsOwner, "trusted">, field: PluginSettingField): string[] {
  const names = field.env ?? [];

  return owner.trusted ? names : names.filter((name) => !ENGINE_ENV.has(name) && !name.startsWith("GALLEY_"));
}

type Stored = Record<string, Record<string, string>>;

export function createPluginSettingsStore(options: PluginSettingsOptions): PluginSettingsStore {
  const file = join(options.home, "plugin-settings.json");
  let writes: Promise<unknown> = Promise.resolve();

  async function load(): Promise<Stored> {
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;

      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Stored) : {};
    } catch {
      return {};
    }
  }

  async function store(data: Stored): Promise<void> {
    await mkdir(options.home, { recursive: true });
    const temp = join(options.home, `.plugin-settings-${randomUUID()}.tmp`);

    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`);
    await rename(temp, file);
  }

  function fromEnv(owner: SettingsOwner, field: PluginSettingField): string | null {
    for (const name of envNamesFor(owner, field)) {
      const value = options.env[name]?.trim();

      if (value) return value;
    }
    return null;
  }

  async function read(owner: SettingsOwner, field: PluginSettingField, data: Stored): Promise<{ value: string | null; source: "env" | "stored" | null }> {
    const env = fromEnv(owner, field);

    if (env) {
      if (field.secret) rememberSecret(env);
      return { value: env, source: "env" };
    }
    const stored = field.secret ? await options.secrets.get(secretNameFor(owner, field)) : (data[owner.name]?.[field.key] ?? null);

    if (stored && field.secret) rememberSecret(stored);
    return { value: stored || null, source: stored ? "stored" : null };
  }

  async function status(owner: SettingsOwner): Promise<PluginSettingStatus[]> {
    const data = await load();

    return Promise.all(
      owner.fields.map(async (field) => {
        const { value, source } = await read(owner, field, data);
        const out: PluginSettingStatus = {
          key: field.key,
          label: field.label,
          secret: Boolean(field.secret),
          required: Boolean(field.required),
          configured: value !== null,
          source,
        };

        if (field.help) out.help = field.help;
        if (field.placeholder) out.placeholder = field.placeholder;
        if (field.pattern) out.pattern = field.pattern;
        if (field.type && field.type !== "text") out.type = field.type;
        if (field.type === "select" && field.options) out.options = field.options.map((option) => ({ value: option.value, label: option.label }));
        const fallback = defaultOf(field);
        if (fallback !== undefined) out.default = fallback;
        if (field.type === "toggle" && field.consequence) out.consequence = field.consequence;
        if (value !== null) {
          if (field.secret) out.hint = value.slice(-4);
          else out.value = value;
        }
        return out;
      })
    );
  }

  return {
    async values(owner) {
      const data = await load();
      const out: Record<string, string | undefined> = {};

      // A toggle or a choice nobody has set reads as its default, so the plugin never has to guess.
      for (const field of owner.fields) out[field.key] = (await read(owner, field, data)).value ?? defaultOf(field);
      return out;
    },

    status,

    save(owner, patch) {
      const task = async () => {
        const byKey = new Map(owner.fields.map((field) => [field.key, field]));

        for (const [key, raw] of Object.entries(patch)) {
          const field = byKey.get(key);

          if (!field) throw new GalleyError("invalid", `“${key.slice(0, 40)}” isn't one of this plugin's settings.`);
          if (fromEnv(owner, field)) {
            throw new GalleyError("invalid", `${field.label} is set by the environment the app was started from, so it can't be changed here. Change it there and restart the app.`);
          }
          if (raw === null) continue;
          const value = field.type === "toggle" ? toggleValue(field, raw) : raw.trim();

          if (field.type === "select" && value && !(field.options ?? []).some((option) => option.value === value)) {
            throw new GalleyError("invalid", `${field.label} can only be one of: ${(field.options ?? []).map((option) => option.label).join(", ")}.`);
          }

          if (field.secret && value) rememberSecret(value);
          if (value.length > 4000) throw new GalleyError("invalid", `${field.label} is too long.`);
          if (field.secret && /\s/.test(value)) throw new GalleyError("invalid", `${field.label} shouldn't contain spaces. Paste it again.`);
          if (field.pattern && value && !new RegExp(field.pattern).test(value)) {
            throw new GalleyError("invalid", field.placeholder ? `${field.label} doesn't look right. It should look like ${field.placeholder}.` : `${field.label} doesn't look right.`);
          }
        }
        const data = await load();
        const mine = { ...(data[owner.name] ?? {}) };

        for (const [key, raw] of Object.entries(patch)) {
          const field = byKey.get(key)!;
          const value = raw === null ? null : (field.type === "toggle" ? toggleValue(field, raw) : raw.trim()) || null;

          if (field.secret) {
            const name = secretNameFor(owner, field);

            if (owner.trusted && (BUILTIN_SECRETS as string[]).includes(name) && options.setBuiltinSecret) await options.setBuiltinSecret(name as SecretName, value);
            else await options.secrets.set(name, value);
          } else if (value === null) delete mine[key];
          else mine[key] = value;
        }
        if (Object.keys(mine).length) data[owner.name] = mine;
        else delete data[owner.name];
        await store(data);
        return status(owner);
      };
      const run = writes.then(task, task);

      writes = run.catch(() => undefined);
      return run;
    },
  };
}

/**
 * A logger for one plugin: every line has the plugin's secret values (and
 * every key the engine has seen) cut out, and is kept for the Plugins screen.
 */
export function createPluginLogger(name: string, secrets: () => readonly string[], sink: (level: "info" | "warn" | "error", line: string) => void): PluginLogger {
  const scrub = (message: unknown) => {
    let text = typeof message === "string" ? message : message instanceof Error ? message.message : String(message);

    for (const secret of secrets()) if (secret && secret.length >= 4) text = text.split(secret).join("[redacted]");
    return scrubSecrets(text).slice(0, 2000);
  };

  return {
    info: (message) => sink("info", `[${name}] ${scrub(message)}`),
    warn: (message) => sink("warn", `[${name}] ${scrub(message)}`),
    error: (message) => sink("error", `[${name}] ${scrub(message)}`),
  };
}
