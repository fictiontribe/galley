/**
 * The hosted install's contract: one hosted server, one site, one data folder.
 *
 * Everything here crosses the HTTP boundary, so nothing in it may carry a
 * secret: a key is a status and its last four characters, a repository is its
 * address with credentials removed, a deploy key is its public half.
 *
 * The desktop app and the local command line never see these types in use —
 * they stay multi-site. See docs/cloud-install.md.
 */
import type { Job, SecretName } from "../types";

/**
 * The version of the data folder's layout. Bumped with every change a new
 * image has to migrate; `install.json` records the one the folder is at.
 */
export const INSTALL_SCHEMA_VERSION = 3;

/** Fewest characters a sign-in password may have. */
export const MIN_INSTALL_PASSWORD_LENGTH = 12;

/** How the install reaches the site's repository. */
export type SiteAccess = "deploy-key" | "token" | "none";

/** The public half of the install's own deploy key. The private half never leaves the data folder. */
export interface DeployKeyInfo {
  /** One line, ready to paste: "ssh-ed25519 AAAA… galley-editor". */
  publicKey: string;
  /** "SHA256:…", as code hosts list it. */
  fingerprint: string;
  /** The page on the code host where the key is added, when the address makes it plain (GitHub, GitLab, Bitbucket). */
  addUrl?: string;
}

/** The one site of this install, as far as it is connected. */
export interface InstallSite {
  /**
   * none: nothing connected yet.
   * waiting: the repository is known but can't be reached yet (the deploy key hasn't been added).
   * connecting: being copied (or the starter is being pushed) right now — see `job`.
   * connected: the checkout is in the data folder and open.
   * failed: the last attempt didn't work — see `problem`.
   */
  state: "none" | "waiting" | "connecting" | "connected" | "failed";
  /** The id the site's routes use (/sites/:siteId), once connected. */
  id: string | null;
  name: string | null;
  /** The repository's address with any credentials cut out. */
  repository: string | null;
  branch: string | null;
  /** The folder inside the repository that holds the site, when it isn't the top ("apps/site"). Absent or null: the top. */
  folder?: string | null;
  access: SiteAccess;
  deployKey: DeployKeyInfo | null;
  /** The running or last connect job. */
  job: Job | null;
  /** Why the last attempt failed, in plain words. */
  problem: string | null;
}

/** A thing the operator set through the environment or the install file, which the app therefore can't change. */
export type InstallFixed = "address" | "password" | "site" | "author" | "liveUrl" | "assistantKey";

/** First run, as the setup screens need it. */
export interface SetupStatus {
  /**
   * The screen first run is at:
   *  password — there is no owner yet (the setup link is still good);
   *  site     — the owner's account exists, the site isn't connected;
   *  details  — the site is connected; name, e-mail, live address and the assistant's key are offered;
   *  done     — first run is over. The setup link is dead.
   */
  step: "password" | "site" | "details" | "done";
  passwordSet: boolean;
  site: InstallSite;
  /** The name and e-mail every publish is recorded with. */
  author: { name: string; email: string } | null;
  /** The site's live address (what Proof compares against). */
  liveUrl: string | null;
  /** Whether the assistant has a key. */
  assistantKey: boolean;
  fixed: InstallFixed[];
}

/** Connecting the install's one site. */
export interface SiteConnectRequest {
  /** The repository's address: git@host:owner/name.git or https://host/owner/name(.git). */
  repository: string;
  /** Default: the repository's own default branch. */
  branch?: string;
  /**
   * The folder inside the repository that holds the site, when the
   * repository holds more than the site ("apps/site"). Repository-relative,
   * forward slashes, no "..". Default: the top of the repository.
   */
  folder?: string;
  access: "deploy-key" | "token";
  /** Only with access "token". Stored in the data folder's key store; never written into the checkout or the repository address. */
  token?: string;
  /**
   * Start from a starter instead of what the repository holds: the starter is
   * copied, recorded as the first version and sent to the repository, which
   * must be empty.
   */
  starter?: { id: string; look?: string; name?: string };
}

/** What checking a repository found, without changing anything. */
export interface SiteAccessCheck {
  /** The repository answered. */
  reachable: boolean;
  /** It will accept changes from this install (a deploy key with write access, a token that may push). Null: can't be told without sending something. */
  writable: boolean | null;
  /** It holds no versions yet (what a starter needs). */
  empty: boolean;
  defaultBranch: string | null;
  /** What to do, in plain words, when something is missing. */
  message: string | null;
}

/**
 * Everything the app that created an install hands it, in one request: the
 * unattended half of first run. Each part is optional; whatever is absent is
 * asked on the setup screens. Keys are only ever sent after the person said
 * yes to each one.
 */
export interface SetupHandover {
  site?: { repository: string; branch?: string; folder?: string; access?: "deploy-key" | "token"; token?: string };
  author?: { name: string; email: string };
  liveUrl?: string;
  keys?: Partial<Record<SecretName, string>>;
}

/** One line of "what is stored where". */
export interface InstallStorageLine {
  id: "site" | "settings" | "keys" | "inbox" | "history" | "brand" | "plugins" | "sessions" | "assistant" | "cache";
  /** What it is, in plain words. */
  label: string;
  /** Where it is, relative to the data folder. */
  path: string;
  /** Size on disk, when it was quick to measure. */
  bytes: number | null;
  /** Whether a backup carries it (caches and installed packages are rebuilt instead). */
  inBackup: boolean;
}

/** The Install page. */
export interface InstallInfo {
  /** The product version running. */
  version: string;
  /** The data folder's layout version (INSTALL_SCHEMA_VERSION once migrated). */
  schema: number;
  createdAt: string;
  /** The address people use. */
  address: string;
  /** Where the preview and the live comparison are served. Null: no address was set for them, so the preview pane stays empty. */
  previewAddress: string | null;
  liveAddress: string | null;
  site: InstallSite;
  author: { name: string; email: string } | null;
  /** The data folder, as the server sees it ("/data"). */
  dataFolder: string;
  storage: InstallStorageLine[];
  passwordChangedAt: string | null;
  lastBackupAt: string | null;
  fixed: InstallFixed[];
}

/** A backup that was uploaded and is waiting for its passphrase. */
export interface RestoreUpload {
  id: string;
  bytes: number;
}

/** What a stranger may know about an install (part of GET /api/meta). */
export interface InstallMeta {
  /** A hosted server manages exactly one site. */
  singleSite: true;
  /** First run isn't finished: /setup is where to go (with the setup link until an owner exists). */
  setupNeeded: boolean;
  /**
   * The owner's account exists. With `setupNeeded` still true, first run was
   * left half-way: the owner signs in and carries on, and the setup link is
   * no longer what they need.
   */
  passwordSet?: boolean;
  /** The site's id, told only to someone signed in. */
  siteId: string | null;
  /**
   * What the sign-in page asks for: an e-mail and a password, or — on an
   * install set up before accounts existed, until its owner adds an e-mail —
   * the password alone. Absent from servers without accounts.
   */
  signInWith?: "email" | "password";
  /**
   * The identity provider people may sign in through, beside the usual form:
   * what its button says ("Sign in with …"). Absent: none is set up.
   */
  provider?: { name: string };
  /** This server can e-mail a new-password link, so "Forgot your password?" works without an owner. */
  passwordEmail?: boolean;
}

/** GET /readyz. Nothing here identifies the install. */
export interface ReadyStatus {
  ready: boolean;
  /** starting: still loading or migrating. setup: up, waiting for first run. ready: serving the site. restoring: a backup is being put back. */
  state: "starting" | "setup" | "ready" | "restoring";
}
