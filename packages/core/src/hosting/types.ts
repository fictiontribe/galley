/**
 * "Host the editor online": creating a hosted install of this app for one
 * site, on the person's own account with a host, from the desktop app or the
 * command line. The sibling of deploy/ ("Put this site online"), and built
 * the same way: a small host interface, built-in hosts, and plugins that can
 * add more.
 *
 * Two halves live here:
 *  - what crosses the HTTP boundary (the app's screens and `galley host`);
 *  - the `EditorHost` interface a host implements.
 *
 * Rules every host keeps:
 *  - `inspect` and `plan` create nothing;
 *  - `create` makes exactly what the plan listed, names and tags each thing,
 *    and records each one the moment it exists, so a failure half-way can
 *    still be removed;
 *  - `remove` deletes what was recorded and nothing else — a resource whose
 *    name or tag no longer matches is left alone and reported;
 *  - the host's access key never appears in a message, a detail, a job, a
 *    record or a log.
 */
import type { Job, SecretName, SecretStatus } from "../types";

/** A place an editor can run. "own-server" needs no account: it writes the files to run one anywhere. */
export type EditorHostId = "fly" | "cloudflare" | "own-server" | (string & {});

/** One thing the person must provide to use a host. */
export interface EditorHostCredential {
  secret: SecretName;
  label: string;
  help: string;
  /** Where the key is made. */
  docsUrl: string;
  /** The permissions the key needs, as the host's own screens name them, in the order to tick them. */
  permissions: string[];
  /** False: the host works without it and does more with it (Cloudflare's key, for creating the DNS names). */
  required: boolean;
}

/** A cost with where it came from, so the number can be checked and is never mistaken for a quote. */
export interface CostEstimate {
  /** A month of one install, in `currency`. */
  monthly: number;
  currency: "USD" | "EUR";
  lines: Array<{ label: string; amount: number }>;
  /** What the estimate assumes ("running all day; less when it sleeps while unused"). */
  note: string;
  /** The host's pricing page. */
  source: string;
  /** The day the prices were read, YYYY-MM-DD. */
  checked: string;
}

/** A choice the host offers (how much memory, whether it sleeps while unused), for the setup form. Sent back in `HostedEditorRequest.options` by `key`. */
export interface EditorHostOption {
  key: string;
  label: string;
  help?: string;
  choices: Array<{ value: string; label: string; note?: string }>;
  default: string;
}

/** A host as the first screen shows it, before any key is checked. */
export interface EditorHostInfo {
  id: EditorHostId;
  name: string;
  /** One plain sentence: what it is and what gets created there. */
  summary: string;
  /**
   * managed: everything is created through the host's API.
   * self-run: this app writes the files and the steps; the person starts them on a computer of their own.
   */
  kind: "managed" | "self-run";
  credentials: EditorHostCredential[];
  /** Whether each credential is stored, and its last four characters. */
  secrets: SecretStatus[];
  /** What one install costs there, roughly, before anything is known about the account. */
  cost: CostEstimate;
  /** The host's own choices, in the order to ask them. The place it runs is chosen from `EditorHostAccount.regions` and sent as options.region. */
  options: EditorHostOption[];
  docsUrl: string;
}

/** A host the person may have expected that can't run an editor, and the one sentence that says why. */
export interface EditorHostAbsent {
  name: string;
  reason: string;
}

/** Something missing on the account, said exactly: which permission or plan, and where to add it. */
export interface EditorHostGap {
  what: string;
  where: string;
  url?: string;
  /** Stops the install (true) or only means a step is done by hand (false). */
  blocking: boolean;
}

/** What a stored key can do on its account — looked up, never guessed. */
export interface EditorHostAccount {
  /** The accounts or organisations the key can create things in. */
  accounts: Array<{ id: string; name: string }>;
  /** Places the install can run, when the host has a choice. */
  regions: Array<{ id: string; name: string }>;
  /** Domains whose names this app can create by itself (the person's zones on Cloudflare). */
  domains: Array<{ id: string; name: string }>;
  gaps: EditorHostGap[];
}

/** Which of this site's things the new install is handed. Nothing else leaves this computer. */
export interface HandoverChoice {
  /** The repository's address (never a credential for it: the install makes its own deploy key). */
  repository: boolean;
  /** The publishing name and e-mail. */
  identity: boolean;
  /** The site's live address. */
  liveAddress: boolean;
  /** Keys to copy, each one chosen on purpose. Default none. */
  keys: SecretName[];
}

export interface HostedEditorRequest {
  host: EditorHostId;
  /** The account or organisation on the host. Empty for own-server. */
  account: string;
  /** The short name everything created carries: "acme-editor". */
  name: string;
  /** The editor's address without a scheme: "cms.example.com". */
  address: string;
  /** Default: derived from `address` (see hosting/addresses.ts). */
  previewAddress?: string;
  liveAddress?: string;
  /** Host-specific choices: region, size. */
  options?: Record<string, string>;
  handover: HandoverChoice;
}

/** The three addresses of one install. Hostnames only. */
export interface EditorAddresses {
  editor: string;
  preview: string;
  live: string;
}

/** One thing that will be (or was) created on the host. */
export interface HostedResource {
  /** The host's word for it: "app", "volume", "machine", "certificate", "dns-record", "tunnel". */
  kind: string;
  /** The host's id, once it exists. Empty in a plan. */
  id: string;
  name: string;
  /** Plain words: "1 shared CPU, 2 GB memory, in Amsterdam". */
  detail?: string;
}

/** One thing the new install will be handed, for the person to read before saying yes. */
export interface HandoverLine {
  label: string;
  /** What is sent, shown in full when it isn't a secret; a key shows its last four characters only. */
  value: string;
  secret: boolean;
}

/** A step only the person can do (add a DNS record at their registrar, add the deploy key to the repository). */
export interface ManualStep {
  title: string;
  detail: string;
  /** Text to copy as it is. */
  copy?: string;
  url?: string;
}

/** A file this app writes for the person to run (own-server). */
export interface RecipeFile {
  name: string;
  content: string;
  /** May hold a one-time code: show it, never log it. */
  sensitive?: boolean;
}

/** Everything that would happen, before anything does. */
export interface HostedEditorPlan {
  /** Passed back to create. A plan is good for fifteen minutes and for one use. */
  id: string;
  host: EditorHostId;
  hostName: string;
  account: string;
  name: string;
  addresses: EditorAddresses;
  /** The image the install runs, with its version. */
  image: string;
  /** Everything that will be created, in order. */
  resources: HostedResource[];
  cost: CostEstimate;
  handover: HandoverLine[];
  /** What the person does by hand, before or after. Empty when the host does everything. */
  steps: ManualStep[];
  /** Files the person runs (own-server). */
  files: RecipeFile[];
  /** Reasons this plan can't go ahead. Create refuses while there is one. */
  problems: Array<{ message: string; fix?: string }>;
}

/** What this computer remembers about the install it created. Kept in the app's state folder, never in the site. */
export interface HostedEditorRecord {
  host: EditorHostId;
  account: string;
  name: string;
  addresses: EditorAddresses;
  image: string;
  /** The product version the install was created or last upgraded with. */
  version: string;
  createdAt: string;
  /** Exactly what was created. Removing deletes these and nothing else. */
  resources: HostedResource[];
  /** pending: first run on the install isn't finished yet. */
  setup: "pending" | "done";
  /**
   * The environment the install was started with. Holds no secret (the setup
   * code is only there as its SHA-256), so self-run files can be written again.
   */
  environment?: Record<string, string>;
  /** The host's choices it was made with (`HostedEditorRequest.options`: region, size, proxy). */
  options?: Record<string, string>;
  /** What the person agreed to hand over, kept until it has been sent. */
  handover?: HandoverRecord;
  /** When the site was handed over (ISO time). Absent: not yet — `check` does it once the install answers. */
  handedOver?: string;
}

/**
 * The handover the person agreed to, as a record keeps it: the values that
 * aren't secret, exactly as the plan showed them, and only the names of the
 * keys — their values are read again at the moment they are sent.
 */
export interface HandoverRecord {
  /** `folder`: where the site is inside the repository, when it isn't at the top ("apps/site"). */
  site?: { repository: string; branch?: string; folder?: string };
  author?: { name: string; email: string };
  liveUrl?: string;
  keys: SecretName[];
}

/** The site's own note of where its editor lives (galley.config.json › editor). No secrets, safe to publish. */
export interface EditorConfig {
  /** https://cms.example.com */
  url: string;
  host?: EditorHostId;
}

export type HostedEditorHealth = "healthy" | "setup" | "starting" | "unreachable" | "unknown";

export interface HostedEditorStatus {
  /** What the site's settings say. Null: this site has no editor online. */
  config: EditorConfig | null;
  /** Null on a computer that didn't create the install: it can open the editor, but not upgrade or remove it. */
  record: HostedEditorRecord | null;
  health: HostedEditorHealth;
  /** The version the install reports, when it could be asked. */
  runningVersion: string | null;
  /** The version this app would install. */
  currentVersion: string;
  upgradeAvailable: boolean;
  /** The create, upgrade or remove running now, or the last one. */
  job: Job | null;
  /** Files and steps still to be run (own-server, until the install answers). */
  pending: { steps: ManualStep[]; files: RecipeFile[] } | null;
  /** A short default for `name`, from the site's name. */
  suggestedName: string;
}

/** What "Back up" did or where it sends the person. */
export interface HostedEditorBackup {
  /** snapshot: the host copied the install's disk. page: backups are downloaded from the install's own Install page. */
  kind: "snapshot" | "page";
  /** For "page": the address to open. */
  url?: string;
  /** For "snapshot": the host's name for it. */
  snapshot?: string;
  message: string;
}

/** What removing would delete, shown before it does. */
export interface HostedEditorRemoval {
  /** Deleted, exactly these. */
  resources: HostedResource[];
  /** Found changed or missing since they were created, so they are left alone. */
  skipped: Array<{ resource: HostedResource; reason: string }>;
  /** What stays: the site, its repository, its live address. */
  kept: string[];
  /** Said plainly: changes on the install that were never published go with it. */
  warning: string;
}

// ─────────────────────────────────────────────────────────────── the host interface

/** What every call to a host gets. */
export interface EditorHostContext {
  /** A stored key, read just before the call. Null when it isn't set. */
  secret(name: SecretName): Promise<string | null>;
  /** `fetch`, swappable in tests. */
  fetch: typeof fetch;
  /**
   * The origin of one of the host's APIs by name ("fly", "cloudflare"). Tests
   * and the rehearsal point these at fake hosts (GALLEY_HOSTING_<NAME>_API).
   */
  api(name: string): string;
  signal?: AbortSignal;
}

/** What `create` is given besides the plan. */
export interface EditorHostCreateInput {
  plan: HostedEditorPlan;
  request: HostedEditorRequest;
  /**
   * The environment the install starts with. Holds no secret: the setup code
   * is given as its SHA-256 (GALLEY_SETUP_TOKEN_SHA256), so the host's own
   * dashboard never shows anything that opens the install.
   */
  environment: Record<string, string>;
  /** Called the moment each resource exists, so a failure half-way leaves a record to remove. */
  onResource(resource: HostedResource): Promise<void>;
  onProgress(progress: { detail: string; progress?: number }): void;
}

export interface EditorHost {
  id: EditorHostId;
  name: string;
  /** Everything the first screen shows, except secret status (the engine adds it). */
  info: Omit<EditorHostInfo, "secrets">;
  /** Default origins of the APIs this host talks to, by name. */
  apis: Record<string, string>;
  /** Look up what the stored key can do. Creates nothing. */
  inspect(ctx: EditorHostContext): Promise<EditorHostAccount>;
  /**
   * Everything that would be created and what it costs. Creates nothing.
   * `environment` is what the install will start with (no secret in it), for
   * hosts whose plan shows the files the person runs.
   */
  plan(ctx: EditorHostContext, request: HostedEditorRequest, input: { image: string; addresses: EditorAddresses; environment?: Record<string, string> }): Promise<Pick<HostedEditorPlan, "resources" | "cost" | "steps" | "files" | "problems">>;
  /** Create the install. Resolves when everything exists; the engine then waits for it to answer. */
  create(ctx: EditorHostContext, input: EditorHostCreateInput): Promise<void>;
  /** Move the install to another image, keeping its disk. */
  upgrade?(ctx: EditorHostContext, record: HostedEditorRecord, input: { image: string; onProgress(progress: { detail: string; progress?: number }): void }): Promise<void>;
  /**
   * What the person still has to do before the install answers: the files to
   * run (self-run hosts) and the DNS names to add by hand. Anything secret in
   * the files (a connector's key) is fetched fresh here and never stored.
   */
  pending?(ctx: EditorHostContext, record: HostedEditorRecord): Promise<{ steps: ManualStep[]; files: RecipeFile[] }>;
  /** Copy the install's disk on the host, when the host can. */
  backup?(ctx: EditorHostContext, record: HostedEditorRecord): Promise<HostedEditorBackup>;
  /** Check each recorded resource still is what was created (name and tag). Deletes nothing. */
  removal(ctx: EditorHostContext, record: HostedEditorRecord): Promise<Pick<HostedEditorRemoval, "resources" | "skipped">>;
  /** Delete the recorded resources that `removal` confirmed, newest first. */
  remove(ctx: EditorHostContext, record: HostedEditorRecord, input: { onRemoved(resource: HostedResource): Promise<void>; onProgress(progress: { detail: string; progress?: number }): void }): Promise<void>;
}
