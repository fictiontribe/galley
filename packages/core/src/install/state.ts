/**
 * The install's own state: `<home>/install.json`, one versioned file, mode
 * 0600, written atomically (temp file + rename) and one write at a time.
 *
 * It holds what makes this install itself and nothing that could be read
 * back as a secret: the people who may sign in (each password as an scrypt
 * hash), the one-time links that let someone in (each code as its SHA-256),
 * the one-time setup code as its SHA-256, when sessions stop counting, the
 * one site's folder and how it reaches its repository (never the key itself
 * — that is in `keys/`).
 *
 * A file that can't be read stops the start: starting over would forget the
 * accounts, and an install without an owner means a fresh setup link anyone
 * with the address could race for.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { GalleyError } from "../errors";
import type { AccountRole } from "./accounts";
import { migrate, type MigrationContext } from "./migrate";
import { INSTALL_SCHEMA_VERSION, type SiteAccess } from "./types";

export const STATE_FILE = "install.json";
/** Where the one site is checked out, relative to the data folder. */
export const SITE_FOLDER = "site";
/** How long a session cookie lives (auth.ts in the server): revocations are kept as long, then pruned. */
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * The most single signed-out sessions the state keeps. A sign-out past it
 * ends that person's sessions by time instead (every browser of theirs), so
 * the list — and the file — can't grow without bound.
 */
export const REVOKED_SESSIONS_KEPT = 10_000;

export interface InstallSiteRecord {
  /** The repository's copy (the checkout), relative to the data folder (POSIX): "site", or an adopted "sites/name". */
  root: string;
  /** The folder inside the repository that holds the site ("apps/site"); null: the top of the checkout. */
  folder: string | null;
  /** The repository's address, without credentials. */
  repository: string | null;
  branch: string | null;
  access: SiteAccess;
  /** When the checkout was in place and opened. Null: known but not connected yet (waiting, or failed). */
  connectedAt: string | null;
  /** A starter waiting to be sent to the (empty) repository. */
  starter: { id: string; look?: string; name?: string } | null;
}

/** A person who may sign in, as the state file keeps them. Never sent anywhere as it is (people.ts makes the public `Account`). */
export interface StoredAccount {
  id: string;
  /** Empty only for an owner carried over from the single password, until they add it. */
  name: string;
  /** Lower-case, unique. Empty only for that same owner. */
  email: string;
  role: AccountRole;
  /** scrypt (password.ts). */
  passwordHash: string;
  passwordChangedAt: string;
  createdAt: string;
  lastSeenAt: string | null;
  disabled: boolean;
  incomplete: boolean;
  /** This person's cookies issued at or before this moment (ms) no longer count: signed out everywhere, a new password, switched off. */
  sessionsValidAfter: number;
}

/** An open one-time link: an invitation, or choosing a new password. Only the code's SHA-256 is kept. */
export interface StoredLink {
  id: string;
  kind: "invitation" | "password";
  codeSha256: string;
  /** Who it is for: the invited address, or the account's address when the link was made. */
  email: string;
  /** Invitations: the role the new account gets. */
  role: AccountRole | null;
  /** New-password links: whose password it sets. */
  accountId: string | null;
  /** The account that made it; null: whoever runs the server (`serve --reset-password`). */
  createdBy: string | null;
  /** That person's name when they made it, so an invitation still says who sent it after they've gone. */
  createdByName: string;
  createdAt: string;
  expiresAt: string;
  emailed: boolean;
}

export interface InstallStateFile {
  schema: number;
  createdAt: string;
  /** The people who may sign in. The first owner is made by first run (or by GALLEY_PASSWORD). */
  accounts: StoredAccount[];
  /** Open invitations and new-password links. A used, taken-back or expired one is removed. */
  links: StoredLink[];
  /**
   * `spent`: the SHA-256 of every setup code that has been used. A used code
   * stays dead for good — also after the install is emptied and starts over,
   * when the operator's environment may still carry the same code or its hash.
   */
  setup: { tokenSha256: string | null; finishedAt: string | null; spent?: string[] };
  /** Cookies issued at or before `validAfter` (ms) are refused; so are revoked ids until they'd have expired anyway. */
  sessions: { validAfter: number; revoked: Array<{ id: string; until: number }> };
  site: InstallSiteRecord | null;
  /**
   * The site's live address as first run, the handover or GALLEY_SITE_LIVE_URL
   * gave it. Kept here, not written into the site's files (that would be a
   * change the person never made, waiting to be published); the site's model
   * uses it when the site's own settings file names no live address.
   */
  liveUrl: string | null;
  /** Older data folders: a live address waiting for the site to be connected. Read into `liveUrl` when the state is loaded; always null after. */
  pendingLiveUrl: string | null;
  lastBackupAt: string | null;
  /** Starting values (environment, install file) already applied once: never applied again, so a person's later change sticks. */
  seeded: string[];
}

const SiteRecordSchema = z.object({
  root: z.string().min(1).max(4096),
  folder: z.string().max(1024).nullable().catch(null).default(null),
  repository: z.string().max(4096).nullable(),
  branch: z.string().max(255).nullable(),
  access: z.enum(["deploy-key", "token", "none"]),
  connectedAt: z.string().nullable(),
  starter: z.object({ id: z.string(), look: z.string().optional(), name: z.string().optional() }).nullable().catch(null),
});

/** How many used setup codes are remembered (one is used per first run or password reset). */
const SPENT_CODES_KEPT = 50;

const ROLE = z.enum(["owner", "editor", "contributor"]);
const ID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const AccountSchema = z.object({
  id: ID,
  name: z.string().max(200),
  email: z.string().max(320),
  role: ROLE,
  passwordHash: z.string().min(1),
  passwordChangedAt: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
  disabled: z.boolean(),
  incomplete: z.boolean(),
  sessionsValidAfter: z.number(),
});
const LinkSchema = z.object({
  id: ID,
  kind: z.enum(["invitation", "password"]),
  codeSha256: z.string().regex(/^[0-9a-f]{64}$/),
  email: z.string().max(320),
  role: ROLE.nullable(),
  accountId: ID.nullable(),
  createdBy: ID.nullable(),
  createdByName: z.string().max(200),
  createdAt: z.string(),
  expiresAt: z.string(),
  emailed: z.boolean(),
});

const StateSchema = z.object({
  schema: z.number().int(),
  createdAt: z.string(),
  accounts: z.array(AccountSchema).max(10_000),
  links: z.array(LinkSchema).max(10_000),
  setup: z.object({ tokenSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(), finishedAt: z.string().nullable(), spent: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(SPENT_CODES_KEPT).optional().catch(undefined) }),
  // No cap here: a long list is trimmed on load (openInstallState), never a reason not to start.
  sessions: z.object({ validAfter: z.number(), revoked: z.array(z.object({ id: z.string().max(200), until: z.number() })) }),
  site: SiteRecordSchema.nullable(),
  liveUrl: z.string().nullable().catch(null),
  pendingLiveUrl: z.string().nullable().catch(null),
  lastBackupAt: z.string().nullable(),
  seeded: z.array(z.string()).catch([]),
});

function folderOf(home: string, site: InstallSiteRecord | null): string {
  const checkout = join(home, ...(site?.root ?? SITE_FOLDER).split("/"));

  return site?.folder ? join(checkout, ...site.folder.split("/")) : checkout;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sameHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");

  return left.length === 32 && right.length === 32 && timingSafeEqual(left, right);
}

/** A one-time setup code: 32 random bytes, URL-safe. */
export function mintSetupCode(): string {
  return randomBytes(32).toString("base64url");
}

export interface SessionStamp {
  /** The cookie's nonce: the session's id. */
  id: string;
  /** When the cookie was issued (ms). */
  issuedAt: number;
  /** Whose session it is (hosted cookies carry it; the person's own sign-outs then apply). */
  accountId?: string;
}

/** Remembers the live setup code as used and disarms it: a used code is never accepted again. */
export function spendSetupCode(draft: InstallStateFile): void {
  if (draft.setup.tokenSha256) draft.setup.spent = [...(draft.setup.spent ?? []), draft.setup.tokenSha256].slice(-SPENT_CODES_KEPT);
  draft.setup.tokenSha256 = null;
}

/** Whether an owner who can sign in exists: what "the password is chosen" used to mean for first run. */
export function hasOwner(state: Pick<InstallStateFile, "accounts">): boolean {
  return state.accounts.some((account) => account.role === "owner");
}

export interface InstallStore {
  readonly home: string;
  readonly file: string;
  /** A copy of the state as it is now. */
  read(): InstallStateFile;
  /** Changes the state and writes it; changes are applied one at a time, in order. */
  update(change: (state: InstallStateFile) => void): Promise<InstallStateFile>;
  /** Reads the file again (after a restore replaced the folder), migrating it like a start does. */
  reload(): Promise<void>;
  /** The repository's copy (the git root), absolute. `<home>/site` until a site is recorded. */
  checkoutFolder(): string;
  /** The one site's folder, absolute: the checkout, or the folder inside it that holds the site. */
  siteFolder(): string;
  /** The one site's folder when it is connected, else null. */
  connectedSiteFolder(): string | null;

  /** An owner account exists: first run's first step (the owner and their password) is done. The setup code no longer works. */
  hasOwner(): boolean;
  /** One account as it is kept (a copy), without copying the whole state: read on every request and every event a person is sent. */
  account(id: string): StoredAccount | null;

  /** Whether `code` is the live setup code. Never true once an owner exists. */
  setupCodeMatches(code: string): boolean;
  /** Whether a code (or its SHA-256) was used already: such a code is never accepted again. */
  setupCodeSpent(code: { plain: string } | { sha256: string }): boolean;
  /** Keeps a setup code (by its SHA-256 only). Ignored once an owner exists. */
  setSetupCode(code: { plain: string } | { sha256: string }): Promise<void>;

  /**
   * Whether a session cookie (already checked for its signature and age)
   * still counts. With `accountId`: also only while that account exists, is
   * switched on, and hasn't been signed out everywhere since.
   */
  sessionValid(session: SessionStamp, now?: number): boolean;
  /** Whether this one session was signed out (its cookie's other checks aside). */
  isRevoked(id: string, now?: number): boolean;
  /** The issue time for a new cookie: now, or just after the last "sign out everywhere" (the install's, and this person's) so it isn't caught by it. */
  nextIssuedAt(now?: number, accountId?: string): number;
  /** Tells everything bound to a session (a viewer cookie, an open event stream) to look again: called after an account was switched off, removed or signed out. */
  sessionsChanged(): void;
  /** Ends one session, for as long as its cookie could live. */
  revokeSession(id: string, until?: number): Promise<void>;
  /**
   * Signs one browser out: only a session that still counts is written down
   * (signed and unexpired is the caller's check; this one: not ended already,
   * its account there and switched on), kept only until it would have
   * expired anyway. With the list full, that person's sessions end by time.
   */
  endSession(session: SessionStamp, now?: number): Promise<void>;
  /** Ends every session issued so far. */
  signOutEverywhere(): Promise<void>;
  /** Called after anything about sessions changed (so a viewer cookie bound to one can be dropped). */
  onSessionsChanged(listener: () => void): () => void;

  setLastBackupAt(at: string | Date): Promise<void>;
  isSeeded(name: string): boolean;
  markSeeded(names: string[]): Promise<void>;
}

export interface OpenInstallStateOptions {
  /** GALLEY_SITE_DIR, for the first upgrade of a folder with several sites. */
  keepSite?: string | null;
  now?: () => Date;
  /** Where a trim made while loading is told (one line). */
  log?: (line: string) => void;
}

async function readState(file: string): Promise<{ raw: unknown; schema: number } | null> {
  let text: string;

  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new GalleyError("conflict", `The install's state file (${file}) can't be read. Check its owner and permissions, then start again.`, (error as Error).message);
  }
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch {
    throw new GalleyError("conflict", `The install's state file (${file}) is damaged, so this install won't start. Put back a copy from a backup, then start again.`);
  }
  const schema = (raw as { schema?: unknown })?.schema;

  if (typeof schema !== "number" || !Number.isInteger(schema) || schema < 1) {
    throw new GalleyError("conflict", `The install's state file (${file}) doesn't say which version wrote it, so this install won't start. Put back a copy from a backup, then start again.`);
  }
  return { raw, schema };
}

function parseState(raw: unknown, file: string): InstallStateFile {
  const parsed = StateSchema.safeParse(raw);

  if (!parsed.success) {
    throw new GalleyError("conflict", `The install's state file (${file}) is damaged, so this install won't start. Put back a copy from a backup, then start again.`, parsed.error.message);
  }
  const state = parsed.data as InstallStateFile;

  // A live address an older version kept waiting for the site is this version's live address.
  if (state.pendingLiveUrl !== null) {
    state.liveUrl ??= state.pendingLiveUrl;
    state.pendingLiveUrl = null;
  }
  return state;
}

async function writeState(home: string, file: string, state: InstallStateFile): Promise<void> {
  const temp = join(home, `.${STATE_FILE}.${randomBytes(6).toString("hex")}.tmp`);

  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await chmod(temp, 0o600);
  try {
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/**
 * Keeps the signed-out sessions within REVOKED_SESSIONS_KEPT: the expired
 * ones go, and if that isn't enough everyone is signed out once (which
 * covers every entry), rather than the install refusing to start. Returns
 * the line to log, or null when nothing was trimmed.
 */
function trimRevoked(state: InstallStateFile, now: number): string | null {
  const live = state.sessions.revoked.filter((entry) => entry.until > now);

  // Expired ones are dropped quietly: the next write leaves them out anyway.
  if (live.length <= REVOKED_SESSIONS_KEPT) {
    state.sessions.revoked = live;
    return null;
  }
  state.sessions.validAfter = Math.max(now, state.sessions.validAfter + 1);
  state.sessions.revoked = [];
  return `The list of signed-out browsers was longer than ${REVOKED_SESSIONS_KEPT}, so everyone was signed out once to shorten it. People sign in again as usual.`;
}

/** Reads (and, when it is older, upgrades) the state of the install in `home`, creating it for a new install. */
async function loadState(home: string, options: OpenInstallStateOptions): Promise<InstallStateFile> {
  const file = join(home, STATE_FILE);
  const found = await readState(file);
  const context: MigrationContext = { home, keepSite: options.keepSite ?? null, now: (options.now ?? (() => new Date()))() };
  const from = found?.schema ?? 0;
  const migrated = await migrate(found?.raw ?? null, from, context);
  const state = parseState(migrated, file);
  const trimmed = trimRevoked(state, context.now.getTime());

  if (trimmed) options.log?.(trimmed);
  if (from !== INSTALL_SCHEMA_VERSION || !found || trimmed) {
    // The old file stays beside the new one until the next upgrade, in case the new version has to be rolled back.
    if (found) await writeFile(join(home, `${STATE_FILE}.schema-${from}.bak`), `${JSON.stringify(found.raw, null, 2)}\n`, { mode: 0o600 });
    await writeState(home, file, state);
  }
  return state;
}

export async function openInstallState(home: string, options: OpenInstallStateOptions = {}): Promise<InstallStore> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(home, 0o700);
  const file = join(home, STATE_FILE);
  let state = await loadState(home, options);
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  const copy = (): InstallStateFile => structuredClone(state);
  const sessionsChanged = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // A listener's failure is its own; the change is already saved.
      }
    }
  };

  const update = (change: (draft: InstallStateFile) => void): Promise<InstallStateFile> => {
    const task = async () => {
      const draft = copy();

      change(draft);
      const now = Date.now();

      draft.sessions.revoked = draft.sessions.revoked.filter((entry) => entry.until > now);
      await writeState(home, file, draft);
      state = draft;
      return copy();
    };
    const run = queue.then(task, task);

    queue = run.catch(() => undefined);
    return run;
  };

  const store: InstallStore = {
    home,
    file,
    read: copy,
    update,
    async reload() {
      const next = await loadState(home, options);

      await queue.catch(() => undefined);
      state = next;
      sessionsChanged();
    },
    checkoutFolder: () => join(home, ...(state.site?.root ?? SITE_FOLDER).split("/")),
    siteFolder: () => folderOf(home, state.site),
    connectedSiteFolder: () => (state.site?.connectedAt ? folderOf(home, state.site) : null),

    hasOwner: () => hasOwner(state),
    account(id) {
      const found = state.accounts.find((candidate) => candidate.id === id);

      return found ? { ...found } : null;
    },

    setupCodeSpent(code) {
      const sha = "plain" in code ? sha256Hex(code.plain) : code.sha256.toLowerCase();

      return (state.setup.spent ?? []).some((used) => sameHex(used, sha));
    },
    setupCodeMatches(code) {
      const stored = state.setup.tokenSha256;

      if (hasOwner(state) || !stored || typeof code !== "string" || code.length === 0 || code.length > 1024) return false;
      return sameHex(sha256Hex(code), stored);
    },
    async setSetupCode(code) {
      const sha = "plain" in code ? sha256Hex(code.plain) : code.sha256.toLowerCase();

      if (!/^[0-9a-f]{64}$/.test(sha)) throw new GalleyError("invalid", "A setup code's SHA-256 is 64 hexadecimal characters.");
      if (hasOwner(state)) return;
      if (state.setup.tokenSha256 === sha) return;
      await update((draft) => {
        draft.setup.tokenSha256 = sha;
      });
    },

    sessionValid(session, now = Date.now()) {
      if (session.issuedAt <= state.sessions.validAfter) return false;
      if (state.sessions.revoked.some((entry) => entry.id === session.id && entry.until > now)) return false;
      if (session.accountId === undefined) return true;
      const account = state.accounts.find((candidate) => candidate.id === session.accountId);

      return Boolean(account && !account.disabled && session.issuedAt > account.sessionsValidAfter);
    },
    isRevoked(id, now = Date.now()) {
      return state.sessions.revoked.some((entry) => entry.id === id && entry.until > now);
    },
    nextIssuedAt(now = Date.now(), accountId) {
      const account = accountId === undefined ? undefined : state.accounts.find((candidate) => candidate.id === accountId);

      return Math.max(now, state.sessions.validAfter + 1, (account?.sessionsValidAfter ?? 0) + 1);
    },
    sessionsChanged,
    async revokeSession(id, until = Date.now() + SESSION_LIFETIME_MS) {
      if (state.sessions.revoked.some((entry) => entry.id === id)) return;
      await update((draft) => {
        draft.sessions.revoked.push({ id, until });
      });
      sessionsChanged();
    },
    async endSession(session, now = Date.now()) {
      const until = session.issuedAt + SESSION_LIFETIME_MS;

      if (until <= now || !store.sessionValid(session, now)) return;
      await update((draft) => {
        draft.sessions.revoked = draft.sessions.revoked.filter((entry) => entry.until > now);
        if (draft.sessions.revoked.some((entry) => entry.id === session.id)) return;
        const account = session.accountId === undefined ? undefined : draft.accounts.find((candidate) => candidate.id === session.accountId);

        if (draft.sessions.revoked.length < REVOKED_SESSIONS_KEPT) draft.sessions.revoked.push({ id: session.id, until });
        else if (account) account.sessionsValidAfter = Math.max(now, account.sessionsValidAfter + 1);
        else draft.sessions.validAfter = Math.max(now, draft.sessions.validAfter + 1);
      });
      sessionsChanged();
    },
    async signOutEverywhere() {
      await update((draft) => {
        draft.sessions.validAfter = Math.max(Date.now(), draft.sessions.validAfter + 1);
        // Everything revoked one by one is covered now.
        draft.sessions.revoked = [];
      });
      sessionsChanged();
    },
    onSessionsChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async setLastBackupAt(at) {
      const iso = typeof at === "string" ? new Date(at).toISOString() : at.toISOString();

      await update((draft) => {
        draft.lastBackupAt = iso;
      });
    },
    isSeeded: (name) => state.seeded.includes(name),
    async markSeeded(names) {
      const fresh = names.filter((name) => !state.seeded.includes(name));

      if (fresh.length === 0) return;
      await update((draft) => {
        draft.seeded = [...new Set([...draft.seeded, ...fresh])];
      });
    },
  };

  return store;
}
