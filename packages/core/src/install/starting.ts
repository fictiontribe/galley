/**
 * Starting values: everything first run asks, given up front so an install
 * can be created unattended. From the environment first, then the one file
 * GALLEY_INSTALL_CONFIG names:
 *
 *   { "address": "https://cms.example.com", "password": "…", "setupToken": "…",
 *     "site": { "repository": "git@github.com:you/site.git", "branch": "main", "folder": "apps/site",
 *               "access": "deploy-key", "token": "…", "starter": "astro-starter" },
 *     "owner": { "name": "Sam", "email": "sam@example.com" },
 *     "author": { "name": "Sam", "email": "sam@example.com" },
 *     "liveUrl": "https://www.example.com",
 *     "keys": { "anthropic": "sk-ant-…" } }
 *
 * They are starting values, not settings: each is applied only while the
 * install doesn't have that thing yet, and only once (install.ts), so what a
 * person later changes in the app sticks across restarts.
 */
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { GalleyError } from "../errors";
import type { SecretName } from "../types";
import { SECRET_ENV } from "../ai/secrets";

export interface StartingSite {
  repository: string;
  branch?: string;
  /** The folder inside the repository that holds the site. */
  folder?: string;
  access: "deploy-key" | "token";
  token?: string;
  starter?: { id: string; look?: string; name?: string };
}

export interface StartingValues {
  address?: string;
  password?: string;
  /** The operator's one-time setup code (24+ characters). */
  setupToken?: string;
  /** Or only its SHA-256, so the code itself never reaches the server. */
  setupTokenSha256?: string;
  site?: StartingSite;
  /** The first owner's name and e-mail (with `password`), so an unattended install's owner is complete. */
  owner?: { name?: string; email?: string };
  author?: { name: string; email: string };
  liveUrl?: string;
  /** Keys to store, from the file. Keys in the environment (ANTHROPIC_API_KEY…) are used from there directly. */
  keys?: Partial<Record<SecretName, string>>;
}

export interface StartingValuesResult {
  values: StartingValues;
  /** The file, when one was named. */
  file: string | null;
  /** Things the operator should hear about that don't stop the start. */
  warnings: string[];
}

/**
 * Names of this app's own variables that hold secrets — hidden from the
 * site's own commands on a hosted install (workspace/command.ts).
 */
export const APP_SECRET_ENV_NAMES: readonly string[] = [
  "GALLEY_PASSWORD",
  "GALLEY_TOKEN",
  "GALLEY_SETUP_TOKEN",
  "GALLEY_SETUP_TOKEN_SHA256",
  "GALLEY_SITE_TOKEN",
  "GALLEY_INSTALL_CONFIG",
  ...Object.values(SECRET_ENV).flat(),
];

export const MIN_SETUP_TOKEN_LENGTH = 24;

const text = z.string().trim().min(1).max(4096);
const StarterSchema = z.union([text.transform((id) => ({ id })), z.object({ id: text, look: text.optional(), name: text.optional() })]);
const FileSchema = z
  .object({
    address: text.optional(),
    password: z.string().min(1).max(1024).optional(),
    setupToken: z.string().trim().min(1).max(1024).optional(),
    setupTokenSha256: z.string().trim().optional(),
    site: z
      .object({
        repository: text,
        branch: text.optional(),
        folder: text.optional(),
        access: z.enum(["deploy-key", "token"]).optional(),
        token: text.optional(),
        starter: StarterSchema.optional(),
      })
      .optional(),
    owner: z.object({ name: text.optional(), email: text.optional() }).strict().optional(),
    author: z.object({ name: text, email: text }).optional(),
    liveUrl: text.optional(),
    keys: z.record(z.string(), text).optional(),
  })
  .strict();

const SECRET_NAMES = Object.keys(SECRET_ENV) as SecretName[];

function value(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name]?.trim();

  return raw ? raw : undefined;
}

function readFileValues(path: string, warnings: string[]): z.infer<typeof FileSchema> {
  let info;

  try {
    info = statSync(path);
  } catch {
    throw new GalleyError("invalid", `GALLEY_INSTALL_CONFIG names ${path}, which doesn't exist.`);
  }
  if (!info.isFile()) throw new GalleyError("invalid", `GALLEY_INSTALL_CONFIG names ${path}, which isn't a file.`);
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    warnings.push(`${path} can be read by other users on this server, and it may hold the password and keys. Make it readable by this user only (chmod 600).`);
  }
  let raw: unknown;

  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new GalleyError("invalid", `${path} (GALLEY_INSTALL_CONFIG) isn't valid JSON.`);
  }
  const parsed = FileSchema.safeParse(raw);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".") || (issue?.code === "unrecognized_keys" ? issue.keys.join(", ") : "");

    // The issue's own message may quote the value; only where it is goes into the sentence.
    throw new GalleyError("invalid", `${path} (GALLEY_INSTALL_CONFIG) has something it can't use${where ? ` at “${where}”` : ""}. Check it against the operator guide.`);
  }
  return parsed.data;
}

/** The starting values in `env` and the file it names. Throws a plain GalleyError for a file that can't be used. */
export function readStartingValues(env: NodeJS.ProcessEnv, cwd = process.cwd()): StartingValuesResult {
  const warnings: string[] = [];
  const configPath = value(env, "GALLEY_INSTALL_CONFIG");
  const file = configPath ? resolve(cwd, configPath) : null;
  const fromFile = file ? readFileValues(file, warnings) : {};
  const values: StartingValues = {};

  const address = value(env, "GALLEY_PUBLIC_URL") ?? fromFile.address;
  const password = env.GALLEY_PASSWORD || fromFile.password;
  const setupToken = value(env, "GALLEY_SETUP_TOKEN") ?? fromFile.setupToken;
  const setupTokenSha256 = value(env, "GALLEY_SETUP_TOKEN_SHA256") ?? fromFile.setupTokenSha256;

  if (address) values.address = address;
  if (password) values.password = password;
  if (setupToken) {
    if (setupToken.length < MIN_SETUP_TOKEN_LENGTH) {
      throw new GalleyError("invalid", `GALLEY_SETUP_TOKEN must be at least ${MIN_SETUP_TOKEN_LENGTH} characters long, so nobody can guess the setup link.`);
    }
    values.setupToken = setupToken;
  } else if (setupTokenSha256) {
    if (!/^[0-9a-fA-F]{64}$/.test(setupTokenSha256)) throw new GalleyError("invalid", "GALLEY_SETUP_TOKEN_SHA256 must be the SHA-256 of the setup code: 64 hexadecimal characters.");
    values.setupTokenSha256 = setupTokenSha256.toLowerCase();
  }

  const repository = value(env, "GALLEY_SITE_REPOSITORY") ?? fromFile.site?.repository;

  if (repository) {
    const token = value(env, "GALLEY_SITE_TOKEN") ?? fromFile.site?.token;
    const accessRaw = value(env, "GALLEY_SITE_ACCESS") ?? fromFile.site?.access;

    if (accessRaw !== undefined && accessRaw !== "deploy-key" && accessRaw !== "token") {
      throw new GalleyError("invalid", `GALLEY_SITE_ACCESS must be “deploy-key” or “token”, not “${accessRaw.slice(0, 40)}”.`);
    }
    const access = accessRaw ?? (token ? "token" : "deploy-key");

    if (access === "token" && !token) throw new GalleyError("invalid", "GALLEY_SITE_ACCESS is “token”, but no access key was given. Set GALLEY_SITE_TOKEN too.");
    const branch = value(env, "GALLEY_SITE_BRANCH") ?? fromFile.site?.branch;
    const folder = value(env, "GALLEY_SITE_FOLDER") ?? fromFile.site?.folder;
    const starterId = value(env, "GALLEY_SITE_STARTER");
    const starter = starterId ? { id: starterId } : fromFile.site?.starter;

    values.site = {
      repository,
      access,
      ...(branch ? { branch } : {}),
      ...(folder ? { folder } : {}),
      ...(access === "token" && token ? { token } : {}),
      ...(starter ? { starter } : {}),
    };
  }

  const ownerName = value(env, "GALLEY_OWNER_NAME") ?? fromFile.owner?.name;
  const ownerEmail = value(env, "GALLEY_OWNER_EMAIL") ?? fromFile.owner?.email;

  if (ownerName || ownerEmail) values.owner = { ...(ownerName ? { name: ownerName } : {}), ...(ownerEmail ? { email: ownerEmail } : {}) };

  const authorName = value(env, "GALLEY_AUTHOR_NAME") ?? fromFile.author?.name;
  const authorEmail = value(env, "GALLEY_AUTHOR_EMAIL") ?? fromFile.author?.email;

  if (authorName && authorEmail) values.author = { name: authorName, email: authorEmail };
  else if (authorName || authorEmail) warnings.push("The publishing name and e-mail are only used together: set both GALLEY_AUTHOR_NAME and GALLEY_AUTHOR_EMAIL.");

  const liveUrl = value(env, "GALLEY_SITE_LIVE_URL") ?? fromFile.liveUrl;

  if (liveUrl) values.liveUrl = liveUrl;

  if (fromFile.keys) {
    const keys: Partial<Record<SecretName, string>> = {};

    for (const [name, key] of Object.entries(fromFile.keys)) {
      if (SECRET_NAMES.includes(name as SecretName)) keys[name as SecretName] = key;
      else warnings.push(`${file} names a key “${name.slice(0, 40)}” this app doesn't use; it was left out.`);
    }
    if (Object.keys(keys).length > 0) values.keys = keys;
  }
  return { values, file, warnings };
}
