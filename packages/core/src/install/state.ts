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
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { GalleyError } from "../errors";
import type { AccountRole } from "./accounts";
import { migrate, type MigrationContext } from "./migrate";
import { tidyName } from "./names";
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
  /** scrypt (password.ts). Null for an account that signs in only through an identity provider: no password checks it. */
  passwordHash: string | null;
  passwordChangedAt: string;
  createdAt: string;
  lastSeenAt: string | null;
  disabled: boolean;
  incomplete: boolean;
  /** This person's cookies issued at or before this moment (ms) no longer count: signed out everywhere, a new password, switched off. */
  sessionsValidAfter: number;
  /** Who they are at the install's identity provider, when they sign in through one. Unique by issuer and subject. */
  identity?: { issuer: string; subject: string };
  /** The provider's time (ms) of this subject's last back-channel logout: a sign-in whose ID token is from before it is refused. */
  providerLogoutAt?: number;
}

/** A removed account that signed in through the provider: that subject's next sign-in is refused, not made into an account again. */
export interface StoredTombstone {
  id: string;
  issuer: string;
  subject: string;
  removedAt: string;
  /** The account that removed it; null: the operator's token or the server. */
  removedBy: string | null;
}

/** A back-channel logout for a subject with no account here, kept a short while so a sign-in begun before it can't finish after it. */
export interface StoredProviderLogout {
  issuer: string;
  subject: string;
  /** The provider's time of the logout (ms). */
  at: number;
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
  /** The account that made it; null: nobody in the app ("forgot my password", or `serve --reset-password`). */
  createdBy: string | null;
  /** "server": made by `serve --reset-password`, the operator's way back in. "Forgot my password" links have no mark. */
  madeBy?: "server";
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
  /** Removed accounts that signed in through the identity provider (StoredTombstone). */
  tombstones: StoredTombstone[];
  /** Recent back-channel logouts for subjects with no account here (StoredProviderLogout). */
  providerLogouts: StoredProviderLogout[];
  /** When the install first started with passwords off (ms): a session from before it, other than the provider's, is never read again. */
  oidcOnlySince: number | null;
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

/**
 * Whether this account signs in with a password of its own: it has one, and
 * no identity at a provider. The rules for an account with no e-mail (the
 * owner from before accounts) apply only to such an account.
 */
export function signsInWithPassword(account: Pick<StoredAccount, "passwordHash" | "identity">): boolean {
  return account.passwordHash !== null && account.identity === undefined;
}

/** At most this many removed provider accounts are remembered; past it, a removal that would add one is refused in a sentence. */
export const TOMBSTONES_KEPT = 10_000;
/** At most this many recent logouts for subjects with no account are kept; each is kept fifteen minutes. */
export const PROVIDER_LOGOUTS_KEPT = 10_000;
/** How long a logout for a subject with no account is kept: as long as an ID token from before it could still be taken (ten minutes, with the leeway). */
export const PROVIDER_LOGOUT_KEPT_MS = 15 * 60_000;

/** How many used setup codes are remembered (one is used per first run or password reset). */
const SPENT_CODES_KEPT = 50;

const ROLE = z.enum(["owner", "editor", "contributor"]);
const ID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const AccountSchema = z.object({
  id: ID,
  name: z.string().max(200),
  email: z.string().max(320),
  role: ROLE,
  passwordHash: z.string().min(1).nullable(),
  passwordChangedAt: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
  disabled: z.boolean(),
  incomplete: z.boolean(),
  sessionsValidAfter: z.number(),
  identity: z.object({ issuer: z.string().min(1).max(2048), subject: z.string().min(1).max(255) }).optional(),
  providerLogoutAt: z.number().optional(),
});
const LinkSchema = z.object({
  id: ID,
  kind: z.enum(["invitation", "password"]),
  codeSha256: z.string().regex(/^[0-9a-f]{64}$/),
  email: z.string().max(320),
  role: ROLE.nullable(),
  accountId: ID.nullable(),
  createdBy: ID.nullable(),
  madeBy: z.literal("server").optional(),
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
  tombstones: z
    .array(z.object({ id: ID, issuer: z.string().min(1).max(2048), subject: z.string().min(1).max(255), removedAt: z.string(), removedBy: ID.nullable() }))
    .max(TOMBSTONES_KEPT),
  providerLogouts: z.array(z.object({ issuer: z.string().min(1).max(2048), subject: z.string().min(1).max(255), at: z.number() })).max(PROVIDER_LOGOUTS_KEPT),
  oidcOnlySince: z.number().nullable(),
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
  /** When the session ends (ms), as its cookie says; without it, SESSION_LIFETIME_MS after its issue. */
  expiresAt?: number;
  /** How it was started (a hosted cookie says): password, provider or recovery. Absent: a password session. */
  kind?: string;
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
   * still counts: never at or after its own end (`expiresAt`). With
   * `accountId`: also only while that account exists, is switched on, and
   * hasn't been signed out everywhere since.
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
   * ended anyway (its own end, never later than SESSION_LIFETIME_MS after its
   * issue). With the list full, that person's sessions end by time.
   */
  endSession(session: SessionStamp, now?: number): Promise<void>;
  /** Ends every session issued so far. */
  signOutEverywhere(): Promise<void>;
  /**
   * Passwords are off (GALLEY_OIDC_ONLY) as this server starts: the first
   * time, the moment is kept (`oidcOnlySince`), and from then on a session
   * from before it that isn't the provider's never counts again. Every open
   * password link and invitation without the `serve --reset-password` mark
   * is dropped.
   */
  turnPasswordsOff(now?: number): Promise<{ dropped: number }>;
  /** Called after anything about sessions changed (so a viewer cookie bound to one can be dropped). */
  onSessionsChanged(listener: () => void): () => void;

  setLastBackupAt(at: string | Date): Promise<void>;
  isSeeded(name: string): boolean;
  markSeeded(names: string[]): Promise<void>;
}

/** The file-system calls the state is saved with. A test hands in ones that fail on purpose. */
export interface StateFiles {
  writeFile: typeof writeFile;
  chmod: typeof chmod;
  rename: typeof rename;
  rm: typeof rm;
}

export interface OpenInstallStateOptions {
  /** GALLEY_SITE_DIR, for the first upgrade of a folder with several sites. */
  keepSite?: string | null;
  now?: () => Date;
  /** Where a trim made while loading is told (one line). */
  log?: (line: string) => void;
  /** Tests only: stand-ins for the calls the state is saved with. */
  files?: Partial<StateFiles>;
  /**
   * GALLEY_OIDC_ONLY: passwords are off. Only a session started through the
   * identity provider, or a `serve --reset-password` link's recovery session,
   * counts; every other is refused when it is read.
   */
  passwordsOff?: boolean;
}

/**
 * Why the state couldn't be saved, and what to do, for the failures a
 * server really meets. Anything else stays the unexpected error it is.
 */
const SAVE_FAILURES: Record<string, [reason: string, next: string]> = {
  ENOSPC: ["the disk is full", "Whoever runs this editor needs to free some space on it; then try again."],
  EMFILE: ["too many files are open on the server", "Try again in a moment."],
  ENFILE: ["too many files are open on the server", "Try again in a moment."],
  EIO: ["the disk reported an error", "Try again. If it keeps happening, whoever runs this editor should check the disk."],
  EPERM: ["the server isn't allowed to write to its data folder", "Whoever runs this editor needs to check who owns that folder."],
  EBUSY: ["its data file is in use by something else", "Try again in a moment."],
};
/** A rename refused because something held the file for a moment (a scanner, a backup tool) is tried once more. */
const RENAME_AGAIN = new Set(["EPERM", "EBUSY"]);

const errorCode = (error: unknown): string => (typeof (error as NodeJS.ErrnoException | null)?.code === "string" ? (error as NodeJS.ErrnoException).code! : "");

/** A failed save as something to tell the person; `detail` is the system's code, for the log. */
export function saveFailure(error: unknown): unknown {
  const code = errorCode(error);
  const known = SAVE_FAILURES[code];

  if (!known) return error;
  // The state in memory is replaced only after a save, so nothing changed.
  return new GalleyError("internal", `The editor couldn't save its own state: ${known[0]}. Nothing was changed. ${known[1]}`, code);
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

  // Names kept before names were tidied (names.ts) may hold characters nobody sees: gone from here on, and from the file at its next save.
  for (const account of state.accounts) {
    const name = tidyName(account.name);

    // Nothing left to see: the person is asked for a name, like anyone who has none yet.
    if (account.name !== "" && name === "") account.incomplete = true;
    account.name = name;
  }
  for (const link of state.links) link.createdByName = tidyName(link.createdByName);

  // A live address an older version kept waiting for the site is this version's live address.
  if (state.pendingLiveUrl !== null) {
    state.liveUrl ??= state.pendingLiveUrl;
    state.pendingLiveUrl = null;
  }
  return state;
}

/** A state write's temporary file, as writeState names it. */
const STATE_TEMP = new RegExp(`^\\.${STATE_FILE.replace(/\./g, "\\.")}\\.[0-9a-f]{12}\\.tmp$`);
/** A write takes milliseconds: a temporary file this old belongs to a process that was stopped before it could finish. */
const STATE_TEMP_STALE_MS = 60_000;

/**
 * Takes away what a state write left behind when its process was stopped
 * between writing the temporary file and putting it in place (the state file
 * itself is whole either way: it is only ever replaced in one step). Anything
 * newer may be another process's write in progress and is left alone.
 */
async function sweepStateTemps(home: string, now: number): Promise<void> {
  for (const name of await readdir(home).catch(() => [])) {
    if (!STATE_TEMP.test(name)) continue;
    const path = join(home, name);
    const info = await stat(path).catch(() => null);

    if (info?.isFile() && now - info.mtimeMs > STATE_TEMP_STALE_MS) await rm(path, { force: true }).catch(() => undefined);
  }
}

async function writeState(home: string, file: string, state: InstallStateFile, stand: Partial<StateFiles> = {}): Promise<void> {
  const files: StateFiles = { writeFile, chmod, rename, rm, ...stand };
  const temp = join(home, `.${STATE_FILE}.${randomBytes(6).toString("hex")}.tmp`);

  try {
    await files.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await files.chmod(temp, 0o600);
    try {
      await files.rename(temp, file);
    } catch (error) {
      if (!RENAME_AGAIN.has(errorCode(error))) throw error;
      await files.rename(temp, file);
    }
  } catch (error) {
    await files.rm(temp, { force: true }).catch(() => undefined);
    throw saveFailure(error);
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
    // Once the new layout is written, the copy from the upgrade before goes (the one from layout 1 holds the old shared password's hash).
    if (found && from !== INSTALL_SCHEMA_VERSION) for (let older = 0; older < from; older += 1) await rm(join(home, `${STATE_FILE}.schema-${older}.bak`), { force: true });
  }
  return state;
}

export async function openInstallState(home: string, options: OpenInstallStateOptions = {}): Promise<InstallStore> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(home, 0o700);
  // By the real clock, whatever `now` a caller passes for the state itself: the files' own times are real.
  await sweepStateTemps(home, Date.now());
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
      await writeState(home, file, draft, options.files);
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
      // Past its own end, whoever asks: the cookie's reader checks it too, and nothing has to remember to.
      if (session.expiresAt !== undefined && now >= session.expiresAt) return false;
      if (session.accountId !== undefined && session.kind !== "provider") {
        // Passwords off: only the provider's sessions and a recovery link's.
        if (options.passwordsOff && session.kind !== "recovery") return false;
        // Once passwords were first off, no other session from before then counts again, whether or not they are on now.
        if (state.oidcOnlySince !== null && session.issuedAt <= state.oidcOnlySince) return false;
      }
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
      const until = Math.min(session.expiresAt ?? Infinity, session.issuedAt + SESSION_LIFETIME_MS);

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
    async turnPasswordsOff(now = Date.now()) {
      let dropped = 0;

      await update((draft) => {
        draft.oidcOnlySince ??= now;
        const kept = draft.links.filter((link) => link.madeBy === "server");

        dropped = draft.links.length - kept.length;
        draft.links = kept;
      });
      sessionsChanged();
      return { dropped };
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
