/**
 * API keys. The environment wins (a deployment or a developer's shell decides,
 * and the app can't override it); otherwise keys live in a SecretStore — by
 * default `<home>/secrets.json`, readable by this user only. The desktop shell
 * can swap in the OS keychain by passing its own store.
 */
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { GalleyError } from "../errors";
import type { SecretName, SecretStatus } from "../types";
import { rememberSecret } from "./errors";

/**
 * Names are the app's own keys (SecretName) or a plugin's secrets
 * ("plugin:<plugin>:<key>", or a built-in plugin's shared name such as
 * "openrouter") — see plugins/settings.ts.
 */
export interface SecretStore {
  get(name: string): Promise<string | null>;
  set(name: string, value: string | null): Promise<void>;
}

export const SECRET_ENV: Record<SecretName, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  // The names each host's own CLI reads, so a shell set up for wrangler or vercel just works.
  cloudflare: ["CLOUDFLARE_API_TOKEN"],
  vercel: ["VERCEL_TOKEN"],
};

const LABELS: Record<SecretName, string> = {
  anthropic: "an Anthropic API key",
  openai: "an OpenAI API key",
  google: "a Google AI API key",
  cloudflare: "a Cloudflare access key (API token)",
  vercel: "a Vercel access key (access token)",
};

/** Rough shapes — enough to catch a pasted sentence or the wrong service's key. */
const SHAPES: Record<SecretName, { test: RegExp; hint: string }> = {
  anthropic: { test: /^sk-ant-[A-Za-z0-9_-]{16,}$/, hint: "They start with “sk-ant-”." },
  openai: { test: /^sk-[A-Za-z0-9_-]{16,}$/, hint: "They start with “sk-”." },
  google: { test: /^[A-Za-z0-9_-]{20,}$/, hint: "They are a single word of letters and numbers, usually starting with “AIza”." },
  cloudflare: { test: /^[A-Za-z0-9_-]{30,}$/, hint: "Copy it from the page Cloudflare shows right after you create it: one long word of letters and numbers." },
  vercel: { test: /^[A-Za-z0-9_-]{20,}$/, hint: "Copy it from the page Vercel shows right after you create it: one long word of letters and numbers." },
};

export function envSecret(env: NodeJS.ProcessEnv, name: SecretName): string | null {
  for (const variable of SECRET_ENV[name]) {
    const value = env[variable]?.trim();

    if (value) return value;
  }
  return null;
}

/** Trims a pasted key and rejects obviously wrong shapes. Never echoes the value. */
export function normalizeSecret(name: SecretName, value: string): string {
  const trimmed = value.trim().replace(/^["']|["']$/g, "");

  if (trimmed === "") throw new GalleyError("invalid", `Paste ${LABELS[name]} to save it.`);
  if (/\s/.test(trimmed) || trimmed.length > 512 || !SHAPES[name].test.test(trimmed)) {
    throw new GalleyError("invalid", `That doesn't look like ${LABELS[name]}. ${SHAPES[name].hint}`);
  }
  if (name === "openai" && trimmed.startsWith("sk-ant-")) {
    throw new GalleyError("invalid", "That's an Anthropic key. Paste it under the assistant's key instead.");
  }
  return trimmed;
}

export function statusFor(name: SecretName, value: string | null, source: SecretStatus["source"]): SecretStatus {
  if (!value) return { name, configured: false, source: null };
  return { name, configured: true, source, hint: value.slice(-4) };
}

type SecretFile = Partial<Record<string, string>>;

/** `<home>/secrets.json`, mode 0600 inside a 0700 directory, written atomically. */
export function createFileSecretStore(home: string): SecretStore {
  const file = join(home, "secrets.json");
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<SecretFile> {
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;

      return parsed && typeof parsed === "object" ? (parsed as SecretFile) : {};
    } catch {
      return {};
    }
  }

  return {
    async get(name) {
      const value = (await load())[name];

      if (typeof value !== "string" || value === "") return null;
      rememberSecret(value);
      return value;
    },
    set(name, value) {
      const task = async () => {
        await mkdir(home, { recursive: true, mode: 0o700 });
        // An existing home may have been created with the default umask.
        await chmod(home, 0o700);
        const data = await load();

        if (value === null) delete data[name];
        else data[name] = value;
        const temp = join(home, `.secrets-${randomUUID()}.tmp`);

        await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
        await chmod(temp, 0o600);
        await rename(temp, file);
      };
      const run = queue.then(task, task);

      queue = run.catch(() => undefined);
      return run;
    },
  };
}
