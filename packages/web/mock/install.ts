/**
 * The hosted install in the mock: one site, first run and the Install page,
 * answered from memory the way a hosted server answers them.
 *
 * Local mode keeps `installHandlers()` — every install route answers "not
 * here", as the real server does. A hosted mock wraps the whole handler
 * table with `withInstall()`: /api/meta says which first-run state it is in,
 * sign-in uses the password chosen at setup, the multi-site routes are
 * refused (403) like the real server refuses them, and only one site exists.
 *
 * Start it in any first-run state with GALLEY_MOCK_SETUP (see plugin.ts):
 *   password  nothing set; open /setup?token=<MOCK_SETUP_CODE>
 *   site      the owner made (password "proof"), no site yet
 *   details   site connected, name and email still to give
 *   done      first run over (the default): sign in with "proof"
 * Who signs in, and as what, is accounts.ts (`withAccounts`, laid over this
 * table); without it (`accounts: false`) sign-in is the one password, as on a
 * server from before accounts.
 * Repository addresses steer the pretend code host: "missing" doesn't
 * answer, "readonly" refuses changes, "empty" holds nothing, "fail" breaks
 * part-way through copying; an access token "bad" is refused; the editor's
 * own key is "not added yet" the first time it is tried. A folder on the
 * server's disk (/repos/site.git, file://…) is refused, in the real
 * server's words, unless the mock is told it allows them (a server started
 * for a trial does); an allowed one answers at once, with no key to add.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { ApiRouteKey, CaptureSettings, SiteKitStatus } from "@galley/core/api";
import type { Job, MetaInfo } from "@galley/core/types";
import { PRODUCT, VERSION } from "@galley/core/brand";
import {
  INSTALL_SCHEMA_VERSION,
  MIN_INSTALL_PASSWORD_LENGTH,
  type DeployKeyInfo,
  type InstallFixed,
  type InstallInfo,
  type InstallSite,
  type SetupStatus,
  type SiteAccessCheck,
  type SiteConnectRequest,
} from "@galley/core/install/types";
import type { Handlers, MockBackend, MockRequest } from "./backend.ts";
import { newSiteFrom } from "./fixtures.ts";
import { MockError } from "./site.ts";

type InstallRouteKey = Extract<
  ApiRouteKey,
  | "GET /api/setup"
  | "POST /api/setup/password"
  | "POST /api/setup/deploy-key"
  | "POST /api/setup/site/check"
  | "POST /api/setup/site"
  | "PUT /api/setup/details"
  | "POST /api/setup/handover"
  | "POST /api/setup/finish"
  | "GET /api/install"
  | "POST /api/install/password"
  | "POST /api/auth/logout-all"
  | "POST /api/install/backup"
  | "POST /api/install/restore/upload"
  | "POST /api/install/restore"
>;

function notHere(): never {
  throw new MockError("not-found", "This app isn't a hosted install, so there's nothing to set up here.");
}

/** Local mode: there is no install, so every install route answers "not here". */
export function installHandlers(): Pick<Handlers, InstallRouteKey> {
  return {
    "GET /api/setup": () => notHere(),
    "POST /api/setup/password": () => notHere(),
    "POST /api/setup/deploy-key": () => notHere(),
    "POST /api/setup/site/check": () => notHere(),
    "POST /api/setup/site": () => notHere(),
    "PUT /api/setup/details": () => notHere(),
    "POST /api/setup/handover": () => notHere(),
    "POST /api/setup/finish": () => notHere(),
    "GET /api/install": () => notHere(),
    "POST /api/install/password": () => notHere(),
    "POST /api/auth/logout-all": () => notHere(),
    "POST /api/install/backup": () => notHere(),
    "POST /api/install/restore/upload": () => notHere(),
    "POST /api/install/restore": () => notHere(),
  };
}

// ── the hosted install ────────────────────────────────────────────────────

export type MockSetupStep = "password" | "site" | "details" | "done";

/** The setup code the mock's setup link carries. Obviously not a secret. */
export const MOCK_SETUP_CODE = "mock-setup-code-not-a-secret";
/** The password of a mock install started past the password step, and of the one a restored backup brings. */
export const MOCK_PASSWORD = "proof";

export interface MockInstallOptions {
  setup: MockSetupStep;
  /** What the pretend operator set up front. */
  fixed?: InstallFixed[];
  /** ms between a job's steps (tests make it short). */
  stepMs?: number;
  /** Whether a folder on the server's disk may be connected, as a server started for a trial allows. */
  allowLocalRepositories?: boolean;
  /** The editor's own address (default https://cms.example.com). A private name such as https://cms.localhost is one visitors' browsers can't reach, so neither can the inbox. */
  address?: string;
}

/** What the dev server adds to a request for the install routes: the headers and, for uploads, the raw body. */
export interface MockTransport {
  headers?: Record<string, string | undefined>;
  raw?: Buffer;
}

/** Routes a hosted server refuses: a hosted install has exactly one site. */
export const MULTI_SITE_ROUTES = [
  "GET /api/groups",
  "POST /api/groups",
  "PATCH /api/groups/:groupId",
  "DELETE /api/groups/:groupId",
  "PUT /api/groups/order",
  "POST /api/sites/scan",
  "POST /api/sites/scan/cancel",
  "POST /api/sites/add",
  "POST /api/sites/open",
  "POST /api/sites/clone",
  "POST /api/sites/create",
  "GET /api/fs/list",
  "GET /api/open",
  "PATCH /api/sites/:siteId/listing",
  "DELETE /api/sites/:siteId",
] as const satisfies readonly ApiRouteKey[];

/** Routes that answer without a session: they check the setup code themselves. */
export const SETUP_OPEN_ROUTES: readonly ApiRouteKey[] = [
  "GET /api/setup",
  "POST /api/setup/password",
  "POST /api/setup/deploy-key",
  "POST /api/setup/site/check",
  "POST /api/setup/handover",
  "POST /api/install/restore/upload",
  "POST /api/install/restore",
  "GET /api/jobs/:jobId",
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** "https://name:secret@host/x" → "https://host/x": an address never carries credentials back out. */
function withoutCredentials(address: string): string {
  return address.trim().replace(/^(https?:\/\/)[^@/]+@/, "$1");
}

/** A folder on the server's own disk, as the real server tells one apart (`normalizeRepository` in core). */
function isLocalAddress(address: string): boolean {
  return /^file:\/\//i.test(address) || address.startsWith("/");
}

function keyPage(repository: string | null): string | undefined {
  const match = repository ? /github\.com[:/]([^/]+)\/([^/.]+)/.exec(repository) : null;
  return match ? `https://github.com/${match[1]}/${match[2]}/settings/keys/new` : undefined;
}

function newKey(repository: string | null): DeployKeyInfo {
  const body = randomBytes(24).toString("base64").replace(/[^A-Za-z0-9]/g, "");
  return {
    publicKey: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${body} ${PRODUCT.slug}-editor`,
    fingerprint: `SHA256:${randomBytes(24).toString("base64").replace(/=+$/, "")}`,
    addUrl: keyPage(repository),
  };
}

function emptySite(): InstallSite {
  return { state: "none", id: null, name: null, repository: null, branch: null, access: "none", deployKey: null, job: null, problem: null };
}

export class MockInstall {
  /** The setup link's code; good until a password is chosen. */
  code: string | null = MOCK_SETUP_CODE;
  password: string | null = null;
  finished = false;
  site: InstallSite = emptySite();
  /** Whether the pretend code host has the editor's key yet (the person "adds" it after the first refusal). */
  keyAccepted = false;
  author: { name: string; email: string } | null = null;
  liveUrl: string | null = null;
  readonly fixed: InstallFixed[];
  readonly createdAt = new Date(Date.now() - 12 * 86_400_000).toISOString();
  passwordChangedAt: string | null = null;
  lastBackupAt: string | null = null;
  readonly uploads = new Map<string, Buffer>();
  readonly stepMs: number;
  readonly allowLocalRepositories: boolean;
  readonly address: string;

  constructor(
    readonly mock: MockBackend,
    options: MockInstallOptions,
  ) {
    this.fixed = options.fixed ?? [];
    this.stepMs = options.stepMs ?? 700;
    this.allowLocalRepositories = options.allowLocalRepositories ?? false;
    this.address = (options.address ?? "https://cms.example.com").replace(/\/+$/, "");
    // A new install has no assistant key unless the operator gave one (then it's theirs, and fixed).
    if (options.setup !== "done") mock.secrets.anthropic = this.fixed.includes("assistantKey") ? { name: "anthropic", configured: true, source: "env", hint: "t3st" } : { name: "anthropic", configured: false, source: null };
    const [first] = [...mock.sites.values()].filter((site) => !site.seed.missing);
    // One install, one site: the fixtures' other sites don't exist here.
    for (const id of [...mock.sites.keys()]) if (id !== first?.id) this.forget(id);
    if (options.setup === "password") {
      if (first) this.forget(first.id);
      return;
    }
    this.password = MOCK_PASSWORD;
    this.code = null;
    this.passwordChangedAt = this.createdAt;
    if (options.setup === "site" || !first) {
      if (first) this.forget(first.id);
      return;
    }
    this.connected(first.id, first.name, "git@github.com:example/site.git");
    if (options.setup === "done") {
      this.author = { ...mock.settings.author };
      this.liveUrl = "https://www.example.com";
      this.finished = true;
    }
  }

  private forget(siteId: string): void {
    this.mock.sites.delete(siteId);
    this.mock.previews.delete(siteId);
    this.mock.threads.delete(siteId);
  }

  private connected(id: string, name: string, repository: string): void {
    this.keyAccepted = true;
    this.site = { state: "connected", id, name, repository, branch: "main", access: "deploy-key", deployKey: this.site.deployKey ?? newKey(repository), job: this.site.job, problem: null };
  }

  step(): SetupStatus["step"] {
    if (!this.password) return "password";
    if (this.site.state !== "connected") return "site";
    return this.finished ? "done" : "details";
  }

  status(): SetupStatus {
    return {
      step: this.step(),
      passwordSet: Boolean(this.password),
      site: { ...this.site },
      author: this.author,
      liveUrl: this.liveUrl,
      assistantKey: this.mock.secrets.anthropic.configured,
      fixed: [...this.fixed],
    };
  }

  meta(): NonNullable<MetaInfo["install"]> {
    return { singleSite: true, setupNeeded: this.step() !== "done", passwordSet: Boolean(this.password), siteId: this.mock.authenticated ? this.site.id : null };
  }

  /** A signed-in session, or — while no password exists — the setup code as `Authorization: Bearer`. */
  authorize(req: MockTransport, codeAllowed: boolean): void {
    if (this.mock.authenticated) return;
    const header = req.headers?.authorization ?? "";
    const bearer = /^Bearer (.+)$/.exec(header)?.[1] ?? null;
    if (codeAllowed && bearer && this.code && !this.password && bearer === this.code) return;
    if (bearer) throw new MockError("unauthorized", "This setup link has been used already, or it isn’t this editor’s.");
    throw new MockError("unauthorized", "Sign in to continue.");
  }

  private refuseFixed(what: InstallFixed): void {
    if (this.fixed.includes(what)) throw new MockError("forbidden", "Whoever runs the server set this, so it can’t be changed here.");
  }

  choosePassword(password: string): SetupStatus {
    if (this.password) throw new MockError("conflict", "The password has been chosen already. Sign in with it.");
    if (password.length < MIN_INSTALL_PASSWORD_LENGTH) throw new MockError("invalid", `Use at least ${MIN_INSTALL_PASSWORD_LENGTH} characters.`);
    this.password = password;
    this.code = null;
    this.passwordChangedAt = new Date().toISOString();
    this.mock.authenticated = true;
    return this.status();
  }

  deployKey(rotate: boolean): DeployKeyInfo {
    if (!this.site.deployKey || rotate) this.site.deployKey = newKey(this.site.repository);
    if (rotate) this.keyAccepted = false;
    return { ...this.site.deployKey, addUrl: this.site.deployKey.addUrl ?? keyPage(this.site.repository) };
  }

  /** The real server's refusal of a folder on its disk, unless this one allows them. */
  private refuseLocal(repository: string): void {
    if (isLocalAddress(repository) && !this.allowLocalRepositories) {
      throw new MockError("invalid", "Use the repository’s address on the code host (it starts with git@ or https://). Folders on this server can’t be used.");
    }
  }

  check(body: SiteConnectRequest): SiteAccessCheck {
    const repository = withoutCredentials(body.repository);
    if (!repository) throw new MockError("invalid", "Paste the repository’s address.");
    this.refuseLocal(repository);
    if (isLocalAddress(repository)) return { reachable: true, writable: true, empty: /empty/.test(repository), defaultBranch: /empty/.test(repository) ? null : "main", message: null };
    if (/missing|nowhere/.test(repository)) return { reachable: false, writable: null, empty: false, defaultBranch: null, message: "No repository answers at that address. Check it on your code host." };
    if (body.access === "token" && (!body.token || /bad/.test(body.token))) return { reachable: false, writable: null, empty: false, defaultBranch: null, message: "The code host refused the access token. Check that it can read and write this repository." };
    if (body.access === "deploy-key" && !this.keyAccepted) {
      // The person adds the key while reading the answer; the next try finds it.
      this.keyAccepted = true;
      return { reachable: false, writable: null, empty: false, defaultBranch: null, message: null };
    }
    const empty = /empty/.test(repository);
    return { reachable: true, writable: !/readonly/.test(repository), empty, defaultBranch: empty ? null : "main", message: null };
  }

  connect(body: SiteConnectRequest): Job {
    if (this.site.state === "connected") throw new MockError("conflict", "This editor already has its site. A hosted editor works on one site.");
    if (this.site.state === "connecting") throw new MockError("busy", "The site is being connected right now.");
    this.refuseFixed("site");
    const repository = withoutCredentials(body.repository);
    if (!repository) throw new MockError("invalid", "Paste the repository’s address.");
    this.refuseLocal(repository);
    if (body.access === "token" && !body.token) throw new MockError("invalid", "Paste the access token.");
    if (body.starter && !/empty/.test(repository)) throw new MockError("invalid", "This repository already holds a site. A starter needs an empty repository.");
    const job: Job = {
      id: randomUUID(),
      kind: "setup",
      label: body.starter ? "Starting the site from a starter" : "Copying the site",
      state: "running",
      progress: 0,
      detail: "Contacting the repository…",
      startedAt: Date.now(),
    };
    this.mock.jobs.set(job.id, job);
    this.site = { ...this.site, state: "connecting", repository, branch: body.branch ?? null, access: body.access, job: { ...job }, problem: null, deployKey: body.access === "deploy-key" ? (this.site.deployKey ?? newKey(repository)) : null };
    void this.runConnect(job, body, repository);
    return { ...job };
  }

  private update(job: Job, patch: Partial<Job>): void {
    Object.assign(job, patch);
    this.site.job = { ...job };
    this.mock.emit({ type: "job", job: { ...job } });
  }

  private async runConnect(job: Job, body: SiteConnectRequest, repository: string): Promise<void> {
    await sleep(this.stepMs);
    // A folder on the server's disk needs no key: nothing stands between the editor and it.
    const refused = isLocalAddress(repository) ? false : body.access === "deploy-key" ? !this.keyAccepted : body.access === "token" && /bad/.test(body.token ?? "");
    if (refused || /missing|nowhere/.test(repository)) {
      const waiting = body.access === "deploy-key" && !/missing|nowhere/.test(repository);
      if (waiting) this.keyAccepted = true;
      this.site = { ...this.site, state: waiting ? "waiting" : "failed", problem: waiting ? null : "The repository couldn’t be reached. Check the address, and that the access token can read and write it." };
      this.update(job, { state: "error", detail: waiting ? "The repository hasn’t accepted this editor’s key yet." : "The repository couldn’t be reached.", finishedAt: Date.now() });
      return;
    }
    const steps = body.starter ? ["Copying the starter…", "Recording the first version…", "Sending it to the repository…", "Installing the site’s tools…"] : ["Copying the site…", "Copying the site…", "Installing the site’s tools…", "Reading the site…"];
    for (let index = 0; index < steps.length; index++) {
      this.update(job, { progress: (index + 1) / (steps.length + 1), detail: steps[index] });
      await sleep(this.stepMs);
      if (/fail/.test(repository) && index === 1) {
        this.site = { ...this.site, state: "failed", problem: "The site couldn’t be copied: the code host stopped answering part-way. Check that the address is right, then try again." };
        this.update(job, { state: "error", detail: "The code host stopped answering.", output: "fatal: the remote end hung up unexpectedly\nfatal: early EOF", finishedAt: Date.now() });
        return;
      }
    }
    const name = body.starter?.name?.trim() || repository.replace(/\.git$/, "").split(/[/:]/).pop()?.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase()) || "Site";
    const site = newSiteFrom(body.starter ? "starter" : "docs", name, "site");
    this.mock.sites.set(site.id, site);
    this.mock.previews.set(site.id, { status: { state: "idle", url: null, baselineUrl: null, baselineSource: null, log: [] } });
    this.mock.threads.set(site.id, []);
    this.connected(site.id, site.name, repository);
    this.site.access = body.access;
    if (body.access !== "deploy-key") this.site.deployKey = null;
    this.update(job, { state: "done", progress: 1, detail: `${site.name} is ready to edit.`, siteId: site.id, finishedAt: Date.now() });
    this.mock.emit({ type: "sites.updated" });
  }

  details(body: { author?: { name: string; email: string }; liveUrl?: string | null }): SetupStatus {
    if (body.author) {
      this.refuseFixed("author");
      const name = body.author.name.trim();
      const email = body.author.email.trim();
      if (!name || !/^\S+@\S+\.\S+$/.test(email)) throw new MockError("invalid", "Give a name and an email that looks like name@example.com.");
      this.author = { name, email };
      this.mock.settings.author = { name, email };
    }
    if (body.liveUrl !== undefined) {
      this.refuseFixed("liveUrl");
      this.liveUrl = body.liveUrl?.trim() || null;
    }
    return this.status();
  }

  finish(): SetupStatus {
    if (this.site.state !== "connected") throw new MockError("invalid", "Connect the site first.");
    if (!this.author) throw new MockError("invalid", "Give the name and email to publish under first.");
    this.finished = true;
    return this.status();
  }

  info(): InstallInfo {
    const lines: InstallInfo["storage"] = [
      { id: "site", label: "The site, with its unpublished changes", path: "site/", bytes: 18_400_000, inBackup: true },
      { id: "settings", label: "Settings", path: "settings.json", bytes: 2_300, inBackup: true },
      { id: "keys", label: "Stored keys, sealed", path: "keys/", bytes: 1_100, inBackup: true },
      { id: "inbox", label: "Form submissions", path: "inbox/", bytes: 96_000, inBackup: true },
      { id: "history", label: "Times the site was put online", path: "history/", bytes: 12_000, inBackup: true },
      { id: "brand", label: "Brand material", path: "brand/", bytes: 3_400_000, inBackup: true },
      { id: "plugins", label: "Plugins and their settings", path: "plugins/", bytes: 640_000, inBackup: true },
      { id: "sessions", label: "Sign-ins", path: "sessions/", bytes: 800, inBackup: false },
      { id: "assistant", label: "Conversations with the assistant", path: "assistant/", bytes: 210_000, inBackup: true },
      { id: "cache", label: "Installed packages and caches", path: "cache/", bytes: null, inBackup: false },
    ];
    return {
      version: VERSION,
      schema: INSTALL_SCHEMA_VERSION,
      createdAt: this.createdAt,
      address: this.address,
      previewAddress: `https://preview.${new URL(this.address).host}`,
      liveAddress: this.liveUrl,
      site: { ...this.site },
      author: this.author,
      dataFolder: "/data",
      storage: lines,
      passwordChangedAt: this.passwordChangedAt,
      lastBackupAt: this.lastBackupAt,
      fixed: [...this.fixed],
    };
  }

  changePassword(current: string, next: string): void {
    this.refuseFixed("password");
    if (current !== this.password) throw new MockError("invalid", "That isn’t the current password. Your password hasn’t changed.");
    if (next.length < MIN_INSTALL_PASSWORD_LENGTH) throw new MockError("invalid", `Use at least ${MIN_INSTALL_PASSWORD_LENGTH} characters.`);
    this.password = next;
    this.passwordChangedAt = new Date().toISOString();
  }

  backup(passphrase: string): Buffer {
    if (passphrase.length < MIN_INSTALL_PASSWORD_LENGTH) throw new MockError("invalid", `Use a passphrase of at least ${MIN_INSTALL_PASSWORD_LENGTH} characters.`);
    this.lastBackupAt = new Date().toISOString();
    return Buffer.concat([Buffer.from(`${PRODUCT.slug}-backup v1\n`), randomBytes(512)]);
  }

  upload(raw: Buffer | undefined): { id: string; bytes: number } {
    if (!raw || raw.length === 0) throw new MockError("invalid", "That file is empty. Choose a backup file.");
    const id = randomUUID();
    this.uploads.set(id, raw);
    return { id, bytes: raw.length };
  }

  restore(upload: string, passphrase: string): Job {
    if (!this.uploads.has(upload)) throw new MockError("not-found", "That upload has expired. Choose the file again.");
    const job: Job = { id: randomUUID(), kind: "restore", label: "Restoring a backup", state: "running", progress: 0, detail: "Opening the backup…", startedAt: Date.now() };
    this.mock.jobs.set(job.id, job);
    void (async () => {
      await sleep(this.stepMs);
      if (/wrong/.test(passphrase)) {
        Object.assign(job, { state: "error", detail: "The passphrase doesn’t open this backup. Check it, and that this is the right file.", finishedAt: Date.now() });
        this.mock.emit({ type: "job", job: { ...job } });
        return;
      }
      for (const [index, detail] of ["Putting the site back…", "Putting settings and keys back…"].entries()) {
        Object.assign(job, { progress: (index + 1) / 3, detail });
        this.mock.emit({ type: "job", job: { ...job } });
        await sleep(this.stepMs);
      }
      this.uploads.delete(upload);
      if (this.site.state !== "connected") {
        const site = newSiteFrom("docs", "Restored site", "site");
        this.mock.sites.set(site.id, site);
        this.mock.previews.set(site.id, { status: { state: "idle", url: null, baselineUrl: null, baselineSource: null, log: [] } });
        this.mock.threads.set(site.id, []);
        this.connected(site.id, site.name, "git@github.com:example/site.git");
      }
      this.author = this.author ?? { ...this.mock.settings.author };
      this.password = MOCK_PASSWORD;
      this.code = null;
      this.finished = true;
      // The backup's state replaces this one, sign-ins included; the job's ending stays readable for whoever started it.
      this.restoredJobs.add(job.id);
      this.mock.authenticated = false;
      this.onRestored?.();
      Object.assign(job, { state: "done", progress: 1, detail: "The backup is back in place.", finishedAt: Date.now() });
      this.mock.emit({ type: "job", job: { ...job } });
    })();
    return { ...job };
  }

  /** Whether visitors' browsers can reach this editor's address, judged as the real server judges it (`CaptureService.reachable` in core). */
  reachable(): boolean {
    const host = new URL(this.address).hostname;
    return host.includes(".") && !/^(localhost|127\.|\[?::1)/.test(host) && !/\.(local|localhost|internal|lan|home\.arpa)$/i.test(host);
  }

  /** Restore jobs, readable without a session: the restore signed everyone out as it finished. */
  readonly restoredJobs = new Set<string>();

  /** Told when a restore has put the backup's state in place (accounts.ts brings the backup's people back). */
  onRestored: (() => void) | null = null;
}

type Request<K extends ApiRouteKey> = MockRequest<K> & MockTransport;

function wrap<K extends ApiRouteKey>(handlers: Handlers, key: K, handler: (req: Request<K>, base: Handlers[K]) => unknown): void {
  const base = handlers[key];
  (handlers as Record<ApiRouteKey, unknown>)[key] = (req: Request<K>) => handler(req, base);
}

/**
 * The handler table of a hosted install: `handlers` (the local one) with
 * first run, the Install page, single-site meta and sign-in, and every
 * multi-site route refused.
 */
export function withInstall(mock: MockBackend, base: Handlers, install: MockInstall): Handlers {
  const handlers = { ...base };
  const ok = { ok: true as const };

  wrap(handlers, "GET /api/meta", async (req, original) => ({ ...((await original(req)) as MetaInfo), install: install.meta() }));
  wrap(handlers, "POST /api/auth/login", (req) => {
    if (!install.password) throw new MockError("unauthorized", "This editor isn’t set up yet. Open the setup link to create the owner’s account.");
    if (req.body.password !== install.password) throw new MockError("unauthorized", "That password isn’t right.");
    mock.authenticated = true;
    return ok;
  });
  wrap(handlers, "GET /api/jobs/:jobId", (req, original) => {
    // Before a password exists, the setup code follows the restore it started.
    if (!mock.authenticated) {
      const job = mock.jobs.get(req.params.jobId);
      const mayRead = job?.kind === "restore" && (install.restoredJobs.has(job.id) || (!install.password && install.code !== null));
      if (!mayRead) install.authorize(req, true);
      if (!job) throw new MockError("not-found", "That job has finished and been forgotten.");
      return job;
    }
    return original(req);
  });

  for (const key of MULTI_SITE_ROUTES) {
    wrap(handlers, key, () => {
      throw new MockError("forbidden", "This editor works on one site, so it can’t add, remove or switch sites.");
    });
  }

  // The inbox lives at the editor's own address; whether visitors reach it follows from that address.
  // `reachability` is the real server's sentence today, written for a computer of one's own — a hosted screen says its own.
  const hostedCapture = (settings: CaptureSettings, siteId: string): CaptureSettings => {
    const reachable = install.reachable();
    return {
      ...settings,
      captureAddress: `${install.address}/f/${encodeURIComponent(siteId)}`,
      captureReachable: reachable,
      captureReach: { kind: reachable ? "public" : "private-address", host: new URL(install.address).hostname },
      reachability: reachable ? "Visitors' browsers send submissions to this server's public address." : "Submissions can only arrive when this app runs on a server visitors can reach. On this computer it works for testing.",
      origins: { ...settings.origins, loopback: false },
    };
  };
  wrap(handlers, "GET /api/sites/:siteId/capture", async (req, original) => hostedCapture((await original(req)) as CaptureSettings, req.params.siteId));
  wrap(handlers, "PATCH /api/sites/:siteId/capture", async (req, original) => hostedCapture((await original(req)) as CaptureSettings, req.params.siteId));
  wrap(handlers, "GET /api/sites/:siteId/kit", async (req, original) => {
    const status = (await original(req)) as SiteKitStatus;
    return { ...status, inbox: { ...status.inbox, address: `${install.address}/f/${encodeURIComponent(req.params.siteId)}`, reachable: install.reachable() } };
  });

  wrap(handlers, "GET /api/setup", (req) => {
    install.authorize(req, true);
    return install.status();
  });
  wrap(handlers, "POST /api/setup/password", (req) => {
    install.authorize(req, true);
    return install.choosePassword(req.body.password);
  });
  wrap(handlers, "POST /api/setup/deploy-key", (req) => {
    install.authorize(req, true);
    return install.deployKey(Boolean(req.body?.rotate));
  });
  wrap(handlers, "POST /api/setup/site/check", (req) => {
    install.authorize(req, false);
    return install.check(req.body);
  });
  wrap(handlers, "POST /api/setup/site", (req) => {
    install.authorize(req, false);
    return install.connect(req.body);
  });
  wrap(handlers, "PUT /api/setup/details", (req) => {
    install.authorize(req, false);
    return install.details(req.body);
  });
  wrap(handlers, "POST /api/setup/handover", (req) => {
    install.authorize(req, true);
    if (req.body.author || req.body.liveUrl !== undefined) install.details({ author: req.body.author, liveUrl: req.body.liveUrl });
    for (const [name, value] of Object.entries(req.body.keys ?? {})) {
      const secret = mock.secrets[name as keyof typeof mock.secrets];
      if (secret && value) mock.secrets[secret.name] = { name: secret.name, configured: true, source: "stored", hint: value.slice(-4) };
    }
    if (req.body.site && install.site.state !== "connected") install.connect({ repository: req.body.site.repository, branch: req.body.site.branch, access: req.body.site.access ?? "deploy-key", token: req.body.site.token });
    return install.status();
  });
  wrap(handlers, "POST /api/setup/finish", (req) => {
    install.authorize(req, false);
    return install.finish();
  });
  wrap(handlers, "GET /api/install", (req) => {
    install.authorize(req, false);
    return install.info();
  });
  wrap(handlers, "POST /api/install/password", (req) => {
    install.authorize(req, false);
    install.changePassword(req.body.current, req.body.next);
    return ok;
  });
  wrap(handlers, "POST /api/auth/logout-all", (req) => {
    install.authorize(req, false);
    mock.authenticated = false;
    return ok;
  });
  wrap(handlers, "POST /api/install/backup", (req) => {
    install.authorize(req, false);
    return { kind: "bytes", type: "application/octet-stream", body: install.backup(req.body?.passphrase ?? "") };
  });
  wrap(handlers, "POST /api/install/restore/upload", (req) => {
    install.authorize(req, true);
    return install.upload(req.raw);
  });
  wrap(handlers, "POST /api/install/restore", (req) => {
    install.authorize(req, true);
    return install.restore(req.body.upload, req.body.passphrase);
  });
  return handlers;
}
