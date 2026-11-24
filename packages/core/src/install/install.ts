/**
 * The hosted install as one engine object: its state (state.ts), its one
 * site (single-site.ts), how it reaches the site's repository (access.ts)
 * and first run — the setup code, connecting the site, the details, the
 * starting values given up front.
 *
 * Created once per server. Everything an install keeps is under its data
 * folder (`home`) and nowhere else.
 */
import { existsSync } from "node:fs";
import { realpath, rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { PRODUCT } from "../brand";
import { GalleyError } from "../errors";
import { createJobTracker } from "../site/jobs";
import { checkLook, scaffoldSite } from "../site/scaffold-site";
import { listStarters } from "../site/starters";
import type { EventBus, Job, SecretName, SettingsService, SiteRegistry } from "../types";
import { cloneRepository, detectPackageManager, installDependencies } from "../workspace/index";
import { currentAccountAuthor } from "../workspace/author";
import { GIT_NETWORK_TIMEOUT_MS, registerGitAccess, runGit } from "../workspace/git";
import { parseRemoteUrl, redactRemoteUrl } from "../workspace/remote";
import { loadSiteModel } from "../content/index";
import { normalizeRepository, redactAddress, type RepositoryAddress } from "./address";
import { accessEnv, ensureDeployKey, forgetAccessToken, hasAccessToken, readDeployKey, storeAccessToken, trialAccess, type RepositoryAccess } from "./access";
import { createPeople, type PeopleService } from "./people";
import { createSingleSiteRegistry, type SingleSiteRegistry } from "./single-site";
import { hasOwner, mintSetupCode, SITE_FOLDER, type InstallStore } from "./state";
import type { StartingValues } from "./starting";
import type { DeployKeyInfo, InstallFixed, InstallMeta, InstallSite, SetupHandover, SetupStatus, SiteAccessCheck, SiteConnectRequest } from "./types";

const SECRET_NAMES: SecretName[] = ["anthropic", "openai", "google", "cloudflare", "vercel"];
const CONNECTED_ALREADY = "This editor already looks after a site. Each site gets an editor of its own.";
const MAX_BRANCH = 255;

export interface InstallOptions {
  store: InstallStore;
  /** The install's registry: made with `createInstallRegistry` over the engine's full one. */
  registry: SingleSiteRegistry;
  settings: SettingsService;
  events: EventBus;
  startersDir: string;
  /** Local folders and file:// addresses as repositories (GALLEY_ALLOW_LOCAL_REPOSITORIES). Off: they'd let the editor read any repository on the server's disk. */
  allowLocalRepositories?: boolean;
  /** What the operator pinned (the address; the assistant's key from the environment). */
  fixed?: InstallFixed[];
  /** Test seam: replaces installing a starter's dependencies before its first version. */
  installDependencies?: (root: string, onLog: (line: string) => void) => Promise<void>;
  /** Plain-language notices for the operator. */
  notice?: (line: string) => void;
}

export interface StartOptions {
  /**
   * `--reset-password`: the operator's way back in. With an owner: a
   * one-time new-password link for the only owner (or the owner with
   * `resetPasswordEmail`), nobody else's account touched. Without one: a
   * fresh setup link, as always.
   */
  resetPassword?: boolean;
  /** Which owner `resetPassword` is for, when there are several. */
  resetPasswordEmail?: string;
}

export interface StartResult {
  /** The one-time setup code to print, when first run waits for it and the operator didn't supply only its hash. */
  setupCode: string | null;
  /** `resetPassword` with an owner: the new-password link's code (it goes after LINK_PATHS.password and a "#"), when it stops working, and for whom. */
  passwordLink: { code: string; expiresAt: string; name: string } | null;
  notices: string[];
}

export interface Install {
  readonly home: string;
  readonly store: InstallStore;
  readonly registry: SingleSiteRegistry;
  /** The people who may sign in (people.ts). */
  readonly people: PeopleService;
  /** The site's folder (absolute). */
  siteFolder(): string;
  /** The connected site's id, else null. */
  siteId(): string | null;
  setupNeeded(): boolean;
  meta(signedIn: boolean): InstallMeta;
  site(): Promise<InstallSite>;
  status(): Promise<SetupStatus>;
  /** Applies the starting values and prepares the setup code. Call once, at start-up. */
  start(values: StartingValues, options?: StartOptions): Promise<StartResult>;
  deployKey(options?: { rotate?: boolean }): Promise<DeployKeyInfo>;
  check(request: SiteConnectRequest): Promise<SiteAccessCheck>;
  connect(request: SiteConnectRequest): Promise<Job>;
  setDetails(input: { author?: { name: string; email: string }; liveUrl?: string | null }): Promise<SetupStatus>;
  handover(input: SetupHandover): Promise<SetupStatus>;
  finish(): Promise<SetupStatus>;
  job(id: string): Job | null;
  /** Resolves when no connect is running (tests, shutdown). */
  idle(): Promise<void>;
  /** Stops the site's preview (and its processes) and closes the site; its files stay. Before a restore puts other files in their place. */
  closeSite(): Promise<void>;
  /** After a restore replaced the data folder's state: stop the preview, read the state again and reopen the site. */
  reload(): Promise<void>;
  dispose(): Promise<void>;
}

/** The registry a hosted server hands everything: the engine's own, narrowed to the install's one site. */
export function createInstallRegistry(inner: SiteRegistry, store: InstallStore, jobs: () => ((id: string) => Job | null) | null = () => null): SingleSiteRegistry {
  return createSingleSiteRegistry(inner, { root: () => store.connectedSiteFolder(), jobs: (id) => jobs()?.(id) ?? null });
}

function validBranch(branch: unknown): string | undefined {
  if (branch === undefined || branch === null || branch === "") return undefined;
  if (typeof branch !== "string" || branch.length > MAX_BRANCH || branch.startsWith("-") || /[\0\s~^:?*[\\]|\.\.|@\{|\/\/|^\/|\/$|\.lock$|\.$/.test(branch)) {
    throw new GalleyError("invalid", "That branch name isn't valid. Leave it empty to use the repository's own default.");
  }
  return branch;
}

/**
 * The folder inside the repository that holds the site, as given: relative
 * to the repository's top, forward slashes, no empty, "." or ".." parts.
 * Null for the top. Whether it exists is checked after the copy.
 */
export function validFolder(folder: unknown): string | null {
  if (folder === undefined || folder === null) return null;
  const raw = typeof folder === "string" ? folder.trim().replace(/\/+$/, "") : "";

  if (typeof folder === "string" && raw === "") return null;
  const shown = typeof folder === "string" ? folder.slice(0, 100) : String(folder).slice(0, 100);

  if (!raw || raw.length > 1024 || raw.startsWith("/") || /^[A-Za-z]:/.test(raw) || raw.includes("\\") || /[\0\r\n]/.test(raw)) {
    throw new GalleyError("invalid", `The folder “${shown}” can't be used. Give it from the top of the repository with forward slashes, like apps/site.`);
  }
  if (raw.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new GalleyError("invalid", `The folder “${shown}” can't be used. Give it from the top of the repository, like apps/site, without “..”.`);
  }
  if (raw.split("/").includes(".git")) throw new GalleyError("invalid", `The folder “${shown}” is version history, not a site.`);
  return raw;
}

/** After the copy: the folder exists in it, is a folder, and (links followed) stays inside it. */
async function checkFolderInside(checkout: string, folder: string): Promise<void> {
  const top = await realpath(checkout);
  let real: string;

  try {
    real = await realpath(join(checkout, ...folder.split("/")));
  } catch {
    throw new GalleyError("not-found", `The repository has no folder “${folder}”. Check its name (capitals count), or leave it empty if the site is at the top.`);
  }
  const rel = relative(top, real);

  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new GalleyError("invalid", `The folder “${folder}” leads outside the repository, so it can't be used.`);
  if (!(await stat(real)).isDirectory()) throw new GalleyError("invalid", `“${folder}” is a file in the repository, not a folder.`);
}

function validLiveUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new GalleyError("invalid", "The live address should be a full address, like https://www.example.com.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new GalleyError("invalid", "The live address should start with https://.");
  if (url.username || url.password) throw new GalleyError("invalid", "The live address can't include a user name or password.");
  return url.toString().replace(/\/$/, "");
}

function validAuthor(author: { name: string; email: string }): { name: string; email: string } {
  const name = typeof author?.name === "string" ? author.name.trim() : "";
  const email = typeof author?.email === "string" ? author.email.trim() : "";

  if (!name || name.length > 200) throw new GalleyError("invalid", "Give the publishing name, up to 200 characters.");
  if (!/^[^\s@<>]+@[^\s@<>]+$/.test(email) || email.length > 320) throw new GalleyError("invalid", "That e-mail address doesn't look right. It should look like name@example.com.");
  return { name, email };
}

/** What git said, turned into what to do — for this editor, which reaches the repository with its own key or an access key. */
function accessProblem(stderr: string, access: RepositoryAccess, timedOut = false): string {
  if (timedOut) return "The code host took too long to answer. Check the address, then try again.";
  if (/Could not resolve host|Name or service not known|nodename nor servname|Network is unreachable|Connection refused|Connection timed out|Operation timed out/i.test(stderr)) {
    return "The code host couldn't be reached from this server. Check the address and the server's internet connection, then try again.";
  }
  if (/read.?only|not allowed to push|does not have write access|write access .* denied/i.test(stderr)) {
    return access === "deploy-key"
      ? "This editor's key can read the repository but not change it. Give the key write access on the code host, then try again."
      : "The access key can read the repository but not change it. Use a key that may change the repository's contents.";
  }
  const denied = /Permission denied|publickey|Authentication failed|could not read Username|could not read Password|terminal prompts disabled|returned error: 40[13]|HTTP 40[13]|Invalid username or password|access denied|denied to/i.test(stderr);
  const missing = /repository not found|not found|does not exist|does not appear to be a git repository|No such file or directory/i.test(stderr);

  if (access === "deploy-key" && (denied || missing)) {
    // Code hosts answer "not found" to a key they don't know, so as not to tell a stranger the repository exists.
    return "The repository didn't let this editor in. Add this editor's key to the repository on the code host (with write access), then try again.";
  }
  if (access === "token" && (denied || missing)) {
    return "The repository didn't accept the access key, or there's no repository at that address. Check both, then try again.";
  }
  if (missing) return "There's no repository at that address. Check it, then try again.";
  if (denied) return "The repository didn't let this editor in. Check its address and how this server reaches it, then try again.";
  return "The repository couldn't be reached. Check its address, then try again.";
}

interface Remote {
  reachable: boolean;
  refs: number;
  defaultBranch: string | null;
  stderr: string;
  timedOut: boolean;
}

async function lsRemote(cwd: string, url: string, env: Record<string, string>, extra: string[] = []): Promise<Remote> {
  const result = await runGit(cwd, ["ls-remote", ...extra, "--symref", "--", url], { env, allowFailure: true, readOnly: true, timeoutMs: GIT_NETWORK_TIMEOUT_MS });
  const lines = result.text.split("\n").filter(Boolean);
  const head = lines.map((line) => /^ref: refs\/heads\/(\S+)\s+HEAD$/.exec(line)?.[1]).find(Boolean) ?? null;

  return {
    reachable: result.code === 0,
    refs: lines.filter((line) => /^[0-9a-f]{40,64}\s+refs\//.test(line)).length,
    defaultBranch: head,
    stderr: redactRemoteUrl(result.stderr),
    timedOut: result.timedOut,
  };
}

export function createInstall(options: InstallOptions): Install {
  const { store, registry, settings } = options;
  const home = store.home;
  const jobs = createJobTracker(options.events);
  const fixed = [...new Set(options.fixed ?? [])];
  let running: { id: string; done: Promise<void> } | null = null;
  let claimed = false;
  let lastJob: string | null = null;
  let problem: { message: string; waiting: boolean } | null = null;
  let unregister: (() => void) | null = null;
  let autoFinish = false;
  let disposed = false;
  const notice = options.notice ?? (() => {});
  const people = createPeople(store);

  const hostOf = (repository: string | null) => (repository ? (parseRemoteUrl(repository)?.kind ?? null) : null);

  /** git calls in the site's folder get the stored access; nothing else does. */
  async function registerAccess(): Promise<void> {
    unregister?.();
    unregister = null;
    const site = store.read().site;

    if (!site || site.access === "none") return;
    // The checkout (git's root), so the copy itself and every git call in the site's folder inside it get it.
    unregister = registerGitAccess(store.checkoutFolder(), await accessEnv(home, site.access, hostOf(site.repository)));
  }

  function siteId(): string | null {
    return registry.siteId();
  }

  function step(): SetupStatus["step"] {
    const state = store.read();

    if (!hasOwner(state)) return "password";
    if (!state.site?.connectedAt) return "site";
    if (!state.setup.finishedAt) return "details";
    return "done";
  }

  async function savedAuthor(): Promise<{ name: string; email: string } | null> {
    const layers = await settings.authorLayers?.().catch(() => null);

    if (layers) return layers.app ?? null;
    const current = await settings.get().catch(() => null);

    return current?.authorSaved ? current.author : null;
  }

  async function connectedSite() {
    const id = siteId();

    return id ? registry.get(id) : null;
  }

  /** The live address the site's own settings file names, when the site is connected and the file names one. It always wins. */
  async function liveUrlInFile(): Promise<string | null> {
    const site = await connectedSite().catch(() => null);
    const config = site ? await site.readConfig().catch(() => null) : null;

    return config?.urls?.production ?? null;
  }

  /** The live address in use: the site's model has it (its own file first, then this install's); before the site is connected, the one given. */
  async function currentLiveUrl(): Promise<string | null> {
    const site = await connectedSite().catch(() => null);

    if (!site) return store.read().liveUrl;
    const model = await site.model().catch(() => null);

    return model?.urls.production ?? store.read().liveUrl;
  }

  /**
   * Keeps the live address in the install's own state — never in the site's
   * files, where it would be a change nobody made, waiting to be published —
   * and has the open site read it again. The site's own settings file, when
   * it names one, still wins (the registry's `liveUrl`, site/service.ts).
   */
  async function applyLiveUrl(url: string | null): Promise<void> {
    if (store.read().liveUrl === url) return;
    await store.update((draft) => {
      draft.liveUrl = url;
    });
    const site = await connectedSite().catch(() => null);

    await site?.refresh();
  }

  async function afterConnected(): Promise<void> {
    if (autoFinish && store.hasOwner() && !store.read().setup.finishedAt) {
      await store.update((draft) => {
        draft.setup.finishedAt = new Date().toISOString();
        draft.setup.tokenSha256 = null;
      });
    }
  }

  async function site(): Promise<InstallSite> {
    const state = store.read();
    const record = state.site;
    const job = (running ? jobs.get(running.id) : null) ?? (lastJob ? jobs.get(lastJob) : null);
    const deployKey = await readDeployKey(home, record?.repository ?? null).catch(() => null);

    if (!record) {
      return { state: running ? "connecting" : "none", id: null, name: null, repository: null, folder: null, branch: null, access: "none", deployKey, job, problem: problem?.message ?? null };
    }
    let current: InstallSite["state"];
    let name: string | null = null;
    let branch = record.branch;
    let why = problem?.message ?? null;

    if (running) current = "connecting";
    else if (record.connectedAt) {
      if (existsSync(store.siteFolder())) {
        current = "connected";
        const summary = (await registry.list().catch(() => []))[0];

        name = summary?.name ?? null;
        branch = summary?.branch ?? branch;
        why = null;
      } else {
        current = "failed";
        why = "The site's folder is missing from this editor's data folder. Restore a backup, or connect the site again.";
      }
    } else current = problem && !problem.waiting ? "failed" : "waiting";

    return {
      state: current,
      id: current === "connected" ? siteId() : null,
      name,
      repository: record.repository,
      folder: record.folder,
      branch,
      access: record.access,
      deployKey,
      job,
      problem: why,
    };
  }

  async function status(): Promise<SetupStatus> {
    const [installSite, author, liveUrl, inFile, assistant] = await Promise.all([
      site(),
      savedAuthor(),
      currentLiveUrl(),
      liveUrlInFile(),
      settings.get().then((current) => current.secrets.some((secret) => secret.name === "anthropic" && secret.configured), () => false),
    ]);

    return { step: step(), passwordSet: store.hasOwner(), site: installSite, author, liveUrl, assistantKey: assistant, fixed: inFile ? [...new Set([...fixed, "liveUrl" as const])] : [...fixed] };
  }

  /** The repository address, access and access key for a request, checked — nothing stored yet. */
  async function prepare(request: SiteConnectRequest): Promise<{ address: RepositoryAddress; access: "deploy-key" | "token"; token: string | null; branch: string | undefined; folder: string | null }> {
    const access = request?.access;

    if (access !== "deploy-key" && access !== "token") throw new GalleyError("invalid", "Choose how this editor reaches the repository: its own key, or an access key.");
    const address = normalizeRepository(request.repository, access, { allowLocal: options.allowLocalRepositories === true });
    const branch = validBranch(request.branch);
    const folder = validFolder(request.folder);

    if (folder && request.starter) throw new GalleyError("invalid", "A starter is always sent to the top of an empty repository, so choose a starter or a folder, not both.");
    let token: string | null = null;

    if (access === "token") {
      const given = typeof request.token === "string" ? request.token.trim() : "";

      token = given || address.embeddedSecret;
      if (token !== null && (token.length > 4096 || /\s/.test(token))) throw new GalleyError("invalid", "That access key doesn't look right: it's one word, with no spaces.");
      // A restart retrying a waiting site uses the key already stored for the same repository.
      if (!token && !(store.read().site?.repository === address.url && (await hasAccessToken(home)))) {
        throw new GalleyError("invalid", "Paste the access key this editor should use for the repository.");
      }
    }
    return { address, access, token, branch, folder };
  }

  async function check(request: SiteConnectRequest): Promise<SiteAccessCheck> {
    const { address, access, token } = await prepare(request);

    if (access === "deploy-key") await ensureDeployKey(home, address.url);
    // An access key not given again is the one already stored (prepare checked it's for this repository).
    const trial = token !== null ? await trialAccess(home, access, address.host, token) : { env: await accessEnv(home, access, address.host), dispose: async () => {} };

    try {
      const remote = await lsRemote(home, address.url, trial.env);

      if (!remote.reachable) {
        return { reachable: false, writable: null, empty: false, defaultBranch: null, message: accessProblem(remote.stderr, access, remote.timedOut) };
      }
      let writable: boolean | null = null;

      // Over SSH, asking for the receiving side tells whether the key may write — code hosts refuse it to a read-only key at once — and sends nothing.
      if (address.kind === "ssh") {
        const probe = await lsRemote(home, address.url, trial.env, ["--upload-pack=git-receive-pack"]);

        writable = probe.reachable ? true : /read.?only|not allowed|does not have write access|denied/i.test(probe.stderr) ? false : null;
      }
      const empty = remote.refs === 0;
      const message =
        writable === false
          ? accessProblem("read only", access)
          : request.starter && !empty
            ? "That repository already has versions in it. A starter needs an empty repository: create a new one, or connect this one as it is."
            : null;

      return { reachable: true, writable, empty, defaultBranch: remote.defaultBranch, message };
    } finally {
      await trial.dispose();
    }
  }

  async function starterDir(starter: NonNullable<SiteConnectRequest["starter"]>): Promise<string> {
    const found = (await listStarters(options.startersDir)).find((candidate) => candidate.id === starter.id);

    if (!found) throw new GalleyError("not-found", "That starter couldn't be found.", String(starter.id).slice(0, 100));
    const dir = join(options.startersDir, found.id);

    await checkLook(dir, starter.look);
    return dir;
  }

  async function installStarterDependencies(root: string, onLog: (line: string) => void): Promise<void> {
    if (options.installDependencies) return options.installDependencies(root, onLog);
    if (!existsSync(join(root, "package.json"))) return;
    const model = await loadSiteModel(root).catch(() => null);

    await installDependencies(root, model?.packageManager ?? detectPackageManager(root), onLog, model?.environment);
  }

  /** The site's folder for a new connection: always `<home>/site`, and never anything outside it. */
  function freshTarget(): string {
    const target = join(home, SITE_FOLDER);

    if (relative(resolve(home), resolve(target)) !== SITE_FOLDER) throw new GalleyError("internal", "The site's folder isn't where it should be.");
    return target;
  }

  async function sendStarter(target: string, url: string, access: RepositoryAccess, starter: NonNullable<SiteConnectRequest["starter"]>, requestedBranch: string | undefined, update: (detail: string, progress?: number) => void): Promise<void> {
    const dir = await starterDir(starter);

    update("Checking the repository is empty", 0.05);
    // Registered for `target` already, so the folder's access applies here too.
    const remote = await lsRemote(home, url, await accessEnv(home, access, hostOf(url)));

    if (!remote.reachable) throw new GalleyError("git", accessProblem(remote.stderr, access, remote.timedOut));
    if (remote.refs > 0) throw new GalleyError("conflict", "That repository already has versions in it, so a starter can't be sent to it. Use an empty repository, or connect this one as it is.");
    const name = starter.name?.trim() || (parseRemoteUrl(url)?.path.split("/").pop() ?? "Site");

    update("Copying the starter", 0.15);
    await scaffoldSite({
      starterDir: dir,
      targetDir: target,
      name,
      ...(starter.look ? { look: starter.look } : {}),
      // The owner who sent it from first run, like every other version a person records; started unattended, the install's own name.
      author: currentAccountAuthor() ?? (await savedAuthor()),
      beforeFirstVersion: async (root) => {
        update("Installing the site's dependencies", 0.3);
        try {
          await installStarterDependencies(root, () => undefined);
        } catch (error) {
          // The preview installs on its first start, so the site still works.
          notice(`The starter's dependencies couldn't be installed before its first version: ${error instanceof GalleyError ? error.message : "an unexpected problem"}. The preview will try again when it starts.`);
        }
      },
    });
    const branch = requestedBranch ?? "main";

    if (branch !== "main") await runGit(target, ["branch", "-m", "main", branch]);
    await runGit(target, ["remote", "add", "origin", url]);
    update("Sending the first version", 0.8);
    const pushed = await runGit(target, ["push", "-u", "origin", `${branch}:refs/heads/${branch}`], { allowFailure: true, timeoutMs: GIT_NETWORK_TIMEOUT_MS });

    if (pushed.code !== 0) throw new GalleyError("git", accessProblem(pushed.stderr, access, pushed.timedOut));
  }

  async function connect(request: SiteConnectRequest): Promise<Job> {
    if (disposed) throw new GalleyError("busy", "This editor is shutting down.");
    if (store.read().site?.connectedAt) throw new GalleyError("conflict", CONNECTED_ALREADY);
    if (running || claimed) throw new GalleyError("busy", "The site is being connected right now. Wait for that to finish.");
    // Claimed before the first await, so two requests at once can't both start.
    claimed = true;
    try {
      return await startConnect(request);
    } finally {
      claimed = false;
    }
  }

  async function startConnect(request: SiteConnectRequest): Promise<Job> {
    const { address, access, token, branch, folder } = await prepare(request);
    const starter = request.starter
      ? { id: String(request.starter.id ?? ""), ...(request.starter.look ? { look: String(request.starter.look) } : {}), ...(request.starter.name ? { name: String(request.starter.name).slice(0, 100) } : {}) }
      : null;

    if (starter) await starterDir(starter);
    if (access === "deploy-key") {
      await ensureDeployKey(home, address.url);
      await forgetAccessToken(home);
    } else if (token !== null) {
      await storeAccessToken(home, token);
    }
    await store.update((draft) => {
      draft.site = { root: SITE_FOLDER, folder, repository: redactAddress(address.url), branch: branch ?? null, access, connectedAt: null, starter };
    });
    await registerAccess();
    problem = null;
    const target = freshTarget();
    const job = jobs.start("setup", starter ? "Sending the starter to the repository" : "Copying the site from its repository");
    const update = (detail: string, progress?: number) => job.update({ detail, ...(progress !== undefined ? { progress } : {}) });

    lastJob = job.id;
    const done = (async () => {
      try {
        // Whatever a failed attempt left behind — only ever this folder.
        await rm(target, { recursive: true, force: true });
        if (starter) await sendStarter(target, address.url, access, starter, branch, update);
        else await cloneRepository({ url: address.url, directory: target, ...(branch ? { branch } : {}) }, (detail, progress) => update(detail, progress));
        // The whole repository is copied; the site is the folder inside it.
        if (folder) await checkFolderInside(target, folder);
        update("Opening the site", 0.95);
        const opened = await registry.admit(folder ? join(target, ...folder.split("/")) : target);
        const current = (await runGit(target, ["symbolic-ref", "-q", "--short", "HEAD"], { allowFailure: true, readOnly: true })).text.trim();

        await store.update((draft) => {
          if (!draft.site) return;
          draft.site.connectedAt = new Date().toISOString();
          draft.site.starter = null;
          draft.site.branch = current || draft.site.branch;
        });
        await afterConnected().catch((error: unknown) => notice(`The site is connected, but first run couldn't be finished by itself: ${error instanceof GalleyError ? error.message : "an unexpected problem"}.`));
        job.finish("done", { siteId: opened.id, progress: 1, detail: "The site is connected." });
      } catch (error) {
        await rm(target, { recursive: true, force: true }).catch(() => undefined);
        // git's own words (the download's) are read again for this editor's way in; other refusals are already plain.
        const message =
          error instanceof GalleyError && error.code === "git" && error.detail
            ? accessProblem(error.detail, access)
            : error instanceof GalleyError && error.code !== "internal"
              ? error.message
              : "The site couldn't be connected because of an unexpected problem. Try again.";
        // A key the code host doesn't know yet is a step still to take, not a failure.
        const waiting = access === "deploy-key" && message === accessProblem("Permission denied", "deploy-key");

        problem = { message, waiting };
        job.finish("error", { detail: problem.message });
      } finally {
        running = null;
      }
    })();

    running = { id: job.id, done };
    return job.snapshot();
  }

  async function setDetails(input: { author?: { name: string; email: string }; liveUrl?: string | null }): Promise<SetupStatus> {
    if (input.author !== undefined) await settings.update({ author: validAuthor(input.author) });
    if (input.liveUrl !== undefined) await applyLiveUrl(input.liveUrl === null || input.liveUrl.trim() === "" ? null : validLiveUrl(input.liveUrl));
    return status();
  }

  async function setKeys(keys: Partial<Record<SecretName, string>>): Promise<void> {
    for (const name of SECRET_NAMES) {
      const value = keys[name];

      if (typeof value !== "string" || !value.trim()) continue;
      const current = await settings.get().catch(() => null);

      // A key the environment pins can't be replaced from the app; the pinned one stays in use.
      if (current?.secrets.some((secret) => secret.name === name && secret.source === "env")) continue;
      await settings.setSecret(name, value);
    }
  }

  async function handover(input: SetupHandover): Promise<SetupStatus> {
    const secrets = [input.site?.token, ...Object.values(input.keys ?? {})].filter((value): value is string => typeof value === "string" && value.length > 0);

    try {
      if (input.author) await settings.update({ author: validAuthor(input.author) });
      if (input.keys) await setKeys(input.keys);
      if (input.liveUrl !== undefined) await applyLiveUrl(input.liveUrl ? validLiveUrl(input.liveUrl) : null);
      if (input.site) {
        const recorded = store.read().site;

        if (recorded?.connectedAt) {
          // Handing over the site this editor already has changes nothing; any other is a second site.
          const given = normalizeRepository(input.site.repository, recorded.access, { allowLocal: options.allowLocalRepositories === true });

          if (redactAddress(given.url) !== recorded.repository) throw new GalleyError("conflict", CONNECTED_ALREADY);
        } else if (!running) {
          const access = input.site.access ?? (input.site.token ? "token" : "deploy-key");

          await connect({ repository: input.site.repository, access, ...(input.site.branch ? { branch: input.site.branch } : {}), ...(input.site.folder ? { folder: input.site.folder } : {}), ...(input.site.token ? { token: input.site.token } : {}) });
        }
      }
    } catch (error) {
      throw scrubbed(error, secrets);
    }
    return status();
  }

  async function finish(): Promise<SetupStatus> {
    if (!store.hasOwner()) throw new GalleyError("conflict", "Create the owner's account first.");
    if (!store.read().site?.connectedAt) throw new GalleyError("conflict", "Connect the site first.");
    if (!store.read().setup.finishedAt) {
      await store.update((draft) => {
        draft.setup.finishedAt = new Date().toISOString();
        draft.setup.tokenSha256 = null;
      });
    }
    return status();
  }

  async function start(values: StartingValues, startOptions: StartOptions = {}): Promise<StartResult> {
    const notices: string[] = [];
    let passwordLink: StartResult["passwordLink"] = null;

    if (startOptions.resetPassword) {
      // A first owner is chosen through the setup link, never put straight back from GALLEY_PASSWORD.
      await store.markSeeded(["password"]);
      const rescued = await people.rescue(startOptions.resetPasswordEmail);

      if (rescued) passwordLink = { code: rescued.link.code, expiresAt: rescued.link.expiresAt, name: rescued.account.name };
    }
    // The first owner's password: a starting value, used once, only while there's no owner.
    if (values.password) {
      if (!store.hasOwner() && !store.isSeeded("password")) {
        await people.createOwner({ password: values.password, ...(values.owner ?? {}) });
        await store.markSeeded(["password", ...(values.owner ? ["owner"] : [])]);
      } else if (store.hasOwner() && !(await people.ownerPasswordIs(values.password))) {
        notices.push(`GALLEY_PASSWORD no longer matches the password chosen in the app, so it's ignored. Everyone signs in with their own password; an owner who can't gets back in with \`${PRODUCT.slug} serve --reset-password\`.`);
      } else if (!store.hasOwner()) {
        notices.push("GALLEY_PASSWORD is ignored: it set this install's first password once already. Choose the owner's password through the setup link.");
      }
    }
    // The owner's name and e-mail: filled in once, while the owner (carried over from a single password) has none.
    if (values.owner && !store.isSeeded("owner")) {
      if (store.hasOwner()) {
        await people.completeOwner(values.owner);
        await store.markSeeded(["owner"]);
      } else {
        notices.push("GALLEY_OWNER_NAME and GALLEY_OWNER_EMAIL are used with GALLEY_PASSWORD only; without it, the owner chooses them through the setup link.");
      }
    }
    let setupCode: string | null = null;

    if (!store.hasOwner()) {
      // A code that was used once stays dead: after a password reset the operator's environment may
      // still carry it (or its hash), and arming it again would let an old link choose the new password.
      const supplied = values.setupToken ? { plain: values.setupToken } : values.setupTokenSha256 ? { sha256: values.setupTokenSha256 } : null;
      const spent = supplied !== null && store.setupCodeSpent(supplied);

      if (spent) notices.push("The setup code this server was started with has been used already, so it is ignored and a new one-time setup link was made.");
      if (values.setupToken && !spent) {
        await store.setSetupCode({ plain: values.setupToken });
        setupCode = values.setupToken;
      } else if (values.setupTokenSha256 && !spent) {
        await store.setSetupCode({ sha256: values.setupTokenSha256 });
      } else {
        setupCode = mintSetupCode();
        await store.setSetupCode({ plain: setupCode });
      }
    }
    if (values.author && !store.isSeeded("author")) {
      if (!(await savedAuthor())) await settings.update({ author: validAuthor(values.author) });
      await store.markSeeded(["author"]);
    }
    if (values.keys) {
      for (const name of SECRET_NAMES) {
        const value = values.keys[name];
        const seed = `key:${name}`;

        if (!value || store.isSeeded(seed)) continue;
        const current = await settings.get();

        if (!current.secrets.some((secret) => secret.name === name && secret.configured)) {
          try {
            await settings.setSecret(name, value);
          } catch (error) {
            throw scrubbed(error, [value]);
          }
        }
        await store.markSeeded([seed]);
      }
    }
    await registerAccess();
    const recorded = store.read().site;

    autoFinish = Boolean(values.password && values.site && values.author);
    if (values.site && !store.isSeeded("site") && !recorded) {
      const { site: given } = values;

      await connect({ repository: given.repository, access: given.access, ...(given.branch ? { branch: given.branch } : {}), ...(given.folder ? { folder: given.folder } : {}), ...(given.token ? { token: given.token } : {}), ...(given.starter ? { starter: given.starter } : {}) });
      await store.markSeeded(["site"]);
    } else if (recorded && !recorded.connectedAt && recorded.repository && recorded.access !== "none") {
      // Waiting from an earlier start (the key wasn't on the code host yet): try again.
      await connect({ repository: recorded.repository, access: recorded.access, ...(recorded.branch ? { branch: recorded.branch } : {}), ...(recorded.folder ? { folder: recorded.folder } : {}), ...(recorded.starter ? { starter: recorded.starter } : {}) }).catch((error: unknown) => {
        notices.push(`The site couldn't be connected yet: ${error instanceof GalleyError ? error.message : "an unexpected problem"}`);
      });
    } else if (recorded?.connectedAt) {
      // An adopted site whose record the old list kept under another id (or lost) is put back in the list.
      const id = siteId();

      if (id && existsSync(store.siteFolder()) && (await registry.list()).length === 0) await registry.get(id);
      await afterConnected();
    }
    if (values.site && recorded?.repository && store.isSeeded("site")) {
      const given = (() => {
        try {
          return redactAddress(normalizeRepository(values.site!.repository, values.site!.access, { allowLocal: options.allowLocalRepositories === true }).url);
        } catch {
          return values.site!.repository;
        }
      })();

      if (given !== recorded.repository) notices.push(`GALLEY_SITE_REPOSITORY is ignored: this install already looks after ${recorded.repository}. Each site gets an editor of its own.`);
    }
    if (values.liveUrl && !store.isSeeded("liveUrl")) {
      await applyLiveUrl(validLiveUrl(values.liveUrl));
      await store.markSeeded(["liveUrl"]);
    }
    return { setupCode, passwordLink, notices };
  }

  const install: Install = {
    home,
    store,
    registry,
    people,
    siteFolder: () => store.siteFolder(),
    siteId,
    setupNeeded: () => step() !== "done",
    meta: (signedIn) => ({ singleSite: true, setupNeeded: step() !== "done", passwordSet: store.hasOwner(), siteId: signedIn ? siteId() : null, signInWith: people.signInWith() }),
    site,
    status,
    start,
    async deployKey(keyOptions = {}) {
      return ensureDeployKey(home, store.read().site?.repository ?? null, keyOptions);
    },
    check,
    connect,
    setDetails,
    handover,
    finish,
    job: (id) => jobs.get(id),
    async idle() {
      while (running) await running.done;
    },
    async closeSite() {
      const id = siteId();
      const open = id ? await registry.get(id).catch(() => null) : null;

      // The preview first: its dev server runs from the site's folder, and its last status should still reach the editor.
      await open?.preview().stop().catch(() => undefined);
      await registry.release().catch(() => undefined);
    },
    async reload() {
      await install.idle();
      await install.closeSite();
      await store.reload();
      problem = null;
      await registerAccess();
      const folder = store.connectedSiteFolder();

      if (folder && (await stat(folder).then((info) => info.isDirectory(), () => false))) await registry.admit(folder);
    },
    async dispose() {
      disposed = true;
      await install.idle().catch(() => undefined);
      unregister?.();
      unregister = null;
      jobs.dispose();
    },
  };

  return install;
}

/** An error with every given secret cut out of its message and detail. */
function scrubbed(error: unknown, secrets: string[]): unknown {
  if (secrets.length === 0) return error;
  const scrub = (text: string | undefined) => secrets.reduce((out, secret) => out?.split(secret).join("[redacted]"), text);

  if (error instanceof GalleyError) return new GalleyError(error.code, scrub(error.message)!, scrub(error.detail));
  return new Error(scrub(error instanceof Error ? error.message : String(error)));
}
