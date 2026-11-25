/**
 * The preview controller: runs the site's own dev server and fronts it (and
 * the deployed site) with proxies the app can frame.
 *
 * Lessons this encodes:
 *  - dev servers move to another port when theirs is busy, so the real port is
 *    read from their output, not assumed — and when the adapter says how to
 *    pass a port, the server is started on one checked to be free;
 *  - a server already answering on the site's port is adopted only when it
 *    provably runs from this site's folder (two sites made from one starter
 *    share a port, and adopting the other one shows the wrong site);
 *  - the first answer can come just before the dev server restarts itself
 *    (Astro restarts Vite after its first content sync), so "ready" needs two
 *    good answers a moment apart, neither of them an error page;
 *  - "localhost" may be IPv6-only (Vite on macOS), so both loopbacks are tried;
 *  - npm/pnpm leave the actual server as a grandchild, so the whole process
 *    group is killed, and a last-chance exit hook kills it even if the host
 *    process dies without calling stop();
 *  - a dev server the user is already running is adopted, never killed;
 *  - stop() always wins over a start in progress, however late it lands.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { join } from "node:path";
import { GalleyError } from "../../errors";
import type { PackageManager, PreviewController, PreviewPause, PreviewState, PreviewStatus } from "../../types";
import { installDependencies } from "../build";
import { resolveCommand } from "../command";
import { IS_WINDOWS, killTree, stripAnsi } from "../exec";
import { listenerStartedHere, portOwnership, type Ownership, type PortStanding } from "./owner";
import { freePort, portIsFree, type PortPool } from "./ports";
import { probe, startBaselineProxy, startPreviewProxy, type PreviewGateway, type ProxyHandle, type ProxyPorts } from "./proxy";

export interface PreviewSettings {
  dev: { command: string; port: number | null; portArgs?: string[]; trustPort?: boolean } | null;
  packageManager: PackageManager | null;
  installed: boolean;
  urls: { staging?: string; production?: string };
  /** The adapter's variables for the site's own commands (SiteModel.environment). */
  environment?: Record<string, string>;
}

export interface PreviewOptions {
  root: string;
  /** Read at start time, so config changes apply on restart. */
  settings: () => PreviewSettings;
  /** JS served at OVERLAY_SCRIPT_PATH on both proxies (the baseline's pages load it in the follow role). */
  overlayScript: () => string | Promise<string>;
  /** Attributes the preview proxy adds to every page's `<html>` (not the live site's): the preview mark, the inbox address. */
  pageAttributes?: () => Record<string, string>;
  /** Interface the proxies bind. Default "127.0.0.1". */
  host?: string;
  /** Hostname browsers should use in the returned URLs. Default = host (127.0.0.1 when host is a wildcard). */
  publicHost?: string;
  /** Scheme browsers should use: "https" when a reverse proxy terminates TLS for the preview ports. Default "http". */
  publicProtocol?: "http" | "https";
  /** The operator's port range for the proxies (GALLEY_PREVIEW_PORTS). Default: any free port. */
  ports?: PortPool;
  /**
   * Mount both proxies on the server's one address instead of giving them
   * ports (a hosted install). `host`, `publicHost`, `publicProtocol` and
   * `ports` are then unused, and the status's URLs are the gateway's.
   */
  gateway?: PreviewGateway;
  onStatus?: (status: PreviewStatus) => void;
  /** How long to wait for the dev server to answer. Default 120 s. */
  readyTimeoutMs?: number;
  /** Test seam: how long another program may hold the dev server's port before the preview gives up. Default 20 s. */
  portHeldMs?: number;
  /** Test seam: least time between re-checks that the ready preview's port is still its dev server's. Default 15 s. */
  recheckMs?: number;
  /** Test seam: who listens on a port. Default: the listening process's working directory. */
  ownership?: (port: number, root: string) => Promise<Ownership>;
  /** Test seam: how a port stands to a dev server this preview started in process group `group` (`self`: this process). Default: asked of the system. */
  startedHere?: (port: number, group: number, root: string, self: number) => Promise<PortStanding>;
  /** A request or upgrade reached the preview proxy (the multi-site preview policy measures "unused" with it). */
  onActivity?: () => void;
  /** False: installing the site's dependencies never adds a lockfile the site doesn't have (see InstallDependenciesOptions). Default true. */
  addLockfile?: boolean;
  /**
   * Runs in every start (a restart's too), once the status says "starting"
   * and before the dev server is spawned: the site uses it to forget what the dev server
   * saved under older versions (site/service.ts). What it throws is ignored.
   */
  beforeStart?: () => Promise<void> | void;
  /**
   * Asked at the very beginning of every start: a promise while the site's
   * files are changing under it (newer versions coming in, site/service.ts),
   * else null. The start waits for it before it reads the settings, installs
   * or runs anything, saying why; stop() still ends a start that is waiting.
   */
  holdStart?: () => Promise<void> | null;
}

/** What the status says after a pause, and while the preview wakes again. */
export const PAUSE_DETAIL: Record<PreviewPause, string> = {
  idle: "Stopped after a while unused, to save memory. It starts again when you come back.",
  limit: "Stopped to make room for another site's preview. It starts again when you come back.",
};
export const WAKING_DETAIL = "Waking the preview…";
/** What the status says while a start waits for newer versions to finish coming in. */
export const HELD_DETAIL = "Newer versions are coming in. The preview starts as soon as they are in.";
/** How often a start that is waiting looks whether it was stopped meanwhile. */
const HELD_POLL_MS = 100;

export interface PreviewControllerHandle extends PreviewController {
  /** Stop everything; identical to stop(), named for symmetry with Workspace. */
  dispose(): Promise<void>;
  /** pid of the dev server we will stop: the child we spawned, or the pid a backgrounding server announced. Undefined when adopted, externally owned or not running. */
  readonly pid: number | undefined;
  /**
   * Stops a ready preview to save memory and leaves it "idle" with `paused`
   * set, so the next start says it is waking. Does nothing to a preview that
   * isn't ready — one that is installing or starting is never interrupted.
   */
  pause(reason: PreviewPause): Promise<void>;
  /** When the proxy last carried a request (or the preview became ready); null when it isn't running. */
  readonly lastActivityAt: number | null;
}

const LOG_LINES = 200;
const DEFAULT_READY_TIMEOUT_MS = 120_000;
const LOOPBACKS = ["127.0.0.1", "::1"];
/** How many times a dev server is started again on another port because the one chosen for it was taken meanwhile. */
const PORT_RESTARTS = 2;
/** How long another program may hold the dev server's port, with the dev server neither stopping nor moving, before the preview gives up. */
const PORT_HELD_MS = 20_000;
/** Least time between re-checks, while a preview is in use, that the port it settled on is still its dev server's. */
const RECHECK_MS = 15_000;
/** How many re-checks in a row may fail to tell before a confirmed preview is torn down anyway. */
const RECHECK_UNKNOWN_LIMIT = 3;
/** Shown when a program takes a ready preview's port and it is stopped. */
const TAKEOVER_DETAIL = "Another program took the preview's port while it was running, so the preview was stopped. Start it again.";

/** Thrown out of the wait for a dev server: the port it was given is shared with another program, so move off it. */
class PortTaken extends Error {
  constructor(readonly port: number) {
    super(`port ${port} was taken`);
  }
}

/** Thrown out of the wait: another program has held the dev server's port the whole time, and it hasn't stopped or moved. */
class ForeignHeld extends Error {
  constructor(readonly port: number) {
    super(`port ${port} held by another program`);
  }
}

/** Two good answers this far apart mean the dev server has settled. */
export const STABLE_MS = 300;
/** How often a dev server that isn't listening yet is looked at. */
const POLL_MS = 100;
/** A first render can be slow (a cold Astro page takes about a second); the check waits for it rather than retrying it. */
const PAGE_CHECK_TIMEOUT_MS = 15_000;
/** Enough of a page to see whether it is the framework's error page. */
const PAGE_SAMPLE_BYTES = 64 * 1024;

/**
 * Ports chosen for dev servers of this process that may not be listening yet.
 * Choosing is serialised, so two previews starting at the same moment never
 * pick the same free port.
 */
const reservedPorts = new Set<number>();
let portChoice: Promise<unknown> = Promise.resolve();

function reservePort(preferred: number | null, avoid: number[]): Promise<number> {
  const choose = async () => {
    const port = await freePort(preferred, new Set([...reservedPorts, ...avoid]));

    reservedPorts.add(port);
    return port;
  };
  const result = portChoice.then(choose, choose);

  portChoice = result.catch(() => undefined);
  return result;
}

/** Dev-server children alive in this process, killed on exit as a last resort. */
const liveChildren = new Set<ChildProcess>();
/** Servers that backgrounded themselves but told us their pid — ours to stop too. */
const liveDetached = new Set<number>();
let exitHookInstalled = false;

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", () => {
    for (const child of liveChildren) killTree(child, "SIGKILL");
    for (const pid of liveDetached) killPid(pid, "SIGKILL");
  });
}

/** Signal a pid's process group when it leads one, else the pid alone. */
function killPid(pid: number, signal: NodeJS.Signals): void {
  if (IS_WINDOWS) {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => undefined);
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Some tools print structured log lines — Astro's background notice is one
 * JSON object whose `message` holds several lines ("\n" escaped). Unwrap
 * those so the log reads normally and the URL/pid inside are found.
 */
export function expandOutputLine(line: string): string[] {
  const trimmed = stripAnsi(line).trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed) as { message?: unknown };

      if (typeof parsed.message === "string") return parsed.message.split(/\r?\n/);
    } catch {
      // Not JSON after all; treat as text.
    }
  }
  return [line];
}

/** "Dev server running at http://localhost:4321 (pid 26439)" → 26439. */
export function detectPid(line: string): number | null {
  const match = /\(pid[:\s]+(\d+)\)/i.exec(line);
  const pid = match ? Number(match[1]) : NaN;

  return Number.isInteger(pid) && pid > 1 ? pid : null;
}

/** Finds the port a dev server says it is listening on. */
export function detectPort(line: string): number | null {
  const match = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|[a-z0-9.-]+):(\d{2,5})/i.exec(stripAnsi(line));

  if (!match) return null;
  const port = Number(match[1]);

  return port > 0 && port < 65536 ? port : null;
}

/** ["--port", "{port}"] → ["--port", "4322"]. */
export function portArguments(template: string[], port: number): string[] {
  return template.map((arg) => arg.split("{port}").join(String(port)));
}

const bracket = (host: string) => (host.includes(":") ? `[${host}]` : host);

/** First loopback address on which something answers HTTP on `port`, or null. */
async function answeringHost(port: number, timeoutMs = 1500): Promise<string | null> {
  const results = await Promise.all(LOOPBACKS.map(async (host) => ((await probe(`http://${bracket(host)}:${port}/`, timeoutMs)) !== null ? host : null)));

  return results.find((host) => host !== null) ?? null;
}

/** First loopback address that accepts a TCP connection on `port`, or null. Cheap: no request is made. */
async function connectableHost(port: number, timeoutMs = 500): Promise<string | null> {
  const results = await Promise.all(
    LOOPBACKS.map(
      (host) =>
        new Promise<string | null>((resolve) => {
          const socket = net.connect({ host, port });
          const done = (value: string | null) => {
            socket.destroy();
            resolve(value);
          };

          socket.setTimeout(timeoutMs, () => done(null));
          socket.once("connect", () => done(host));
          socket.once("error", () => done(null));
        })
    )
  );

  return results.find((host) => host !== null) ?? null;
}

/**
 * Whether the home page answers like a working site: any status below 500
 * (a site without a home page answers 404, and that is still a working
 * server), and not the framework's error page — Astro's is a 500 that loads
 * Vite's client; Vite's own overlay element is matched too.
 */
export function isWorkingPage(status: number, sample: string): boolean {
  return status > 0 && status < 500 && !/<vite-error-overlay\b/i.test(sample);
}

function checkPage(host: string, port: number, timeoutMs = PAGE_CHECK_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { host, port, path: "/", method: "GET", headers: { host: `localhost:${port}`, accept: "text/html", "user-agent": "Mozilla/5.0 (preview check)" }, timeout: timeoutMs, agent: false },
      (res) => {
        const status = res.statusCode ?? 0;
        let sample = "";
        const finish = () => {
          res.destroy();
          resolve(isWorkingPage(status, sample));
        };

        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          sample += chunk;
          if (sample.length >= PAGE_SAMPLE_BYTES) finish();
        });
        res.once("end", finish);
        res.once("error", () => resolve(false));
      }
    );

    req.once("timeout", () => req.destroy());
    req.once("error", () => resolve(false));
    req.end();
  });
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createPreviewController(options: PreviewOptions): PreviewControllerHandle {
  const host = options.host ?? "127.0.0.1";
  const publicHost = options.publicHost ?? (host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host);
  const ownership = options.ownership ?? portOwnership;
  const startedHere = options.startedHere ?? listenerStartedHere;
  /** Ports it has already been said of, in the log, that their listener couldn't be checked. */
  const uncheckable = new Set<number>();
  /** This preview's claim on the operator's port range: its two proxies share it. */
  const ports: ProxyPorts | undefined = options.ports ? { pool: options.ports, owner: {} } : undefined;
  let status: PreviewStatus = { state: "idle", url: null, baselineUrl: null, baselineSource: null, log: [] };
  const log: string[] = [];
  let child: ChildProcess | null = null;
  let childExited: Promise<void> = Promise.resolve();
  let childExitCode: number | null = null;
  /** A server the command backgrounded and named by pid: stopped with the preview. */
  let detached: { pid: number; port: number } | null = null;
  let preview: ProxyHandle | null = null;
  let baseline: ProxyHandle | null = null;
  let starting: Promise<PreviewStatus> | null = null;
  /** The bare start attempt, which stop() waits for (it must not wait on `starting`, which waits on stop). */
  let inner: Promise<PreviewStatus> | null = null;
  let stopped: Promise<void> = Promise.resolve();
  /** Bumped by start() and stop(); an attempt that sees a different generation gives up. */
  let generation = 0;
  /** The port this preview reserved for its dev server, released when it stops. */
  let reserved: number | null = null;
  /** Why the last stop happened, when it was a pause: the next start "wakes" the preview. */
  let pausedBy: PreviewPause | null = null;
  let lastActivityAt: number | null = null;

  const snapshot = (): PreviewStatus => ({ ...status, log: [...log] });

  const set = (state: PreviewState, patch: Partial<PreviewStatus> = {}) => {
    status = { ...status, ...patch, state };
    options.onStatus?.(snapshot());
  };

  const pushLog = (line: string) => {
    const clean = stripAnsi(line).replace(/\s+$/, "");

    if (!clean) return;
    log.push(clean);
    if (log.length > LOG_LINES) log.splice(0, log.length - LOG_LINES);
  };

  /** Stops the dev server this preview started, and whatever it started, and waits until it is gone. */
  async function stopChild() {
    if (!child) return;
    const current = child;

    child = null;
    killTree(current, "SIGTERM");
    const exited = childExited;
    const forced = delay(3000).then(() => killTree(current, "SIGKILL"));

    await Promise.race([exited, forced]);
    await exited.catch(() => undefined);
  }

  async function teardown() {
    const closing: Array<Promise<void>> = [];

    if (reserved !== null) reservedPorts.delete(reserved);
    reserved = null;
    if (preview) closing.push(preview.close());
    if (baseline) closing.push(baseline.close());
    preview = null;
    baseline = null;
    await stopChild();
    if (detached) {
      const { pid, port } = detached;

      detached = null;
      killPid(pid, "SIGTERM");
      // Done when the pid is gone and the port has stopped answering.
      const deadline = Date.now() + 5000;

      while (Date.now() < deadline && (pidAlive(pid) || (await answeringHost(port, 300)) !== null)) await delay(100);
      if (pidAlive(pid)) killPid(pid, "SIGKILL");
      liveDetached.delete(pid);
    }
    await Promise.all(closing);
  }

  function spawnDevServer(
    command: string,
    env: NodeJS.ProcessEnv,
    extraArgs: string[],
    onPort: (port: number) => void,
    onPid: (pid: number) => void
  ) {
    const resolved = resolveCommand(options.root, command, env, extraArgs);
    const spawned = spawn(resolved.file, resolved.args, {
      cwd: options.root,
      env: resolved.env,
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group: stop() kills npm *and* the server it started.
      detached: !IS_WINDOWS,
      windowsHide: true,
      shell: resolved.shell,
    });

    child = spawned;
    childExitCode = null;
    liveChildren.add(spawned);
    installExitHook();
    childExited = new Promise<void>((resolve) => {
      spawned.once("exit", (code, signal) => {
        liveChildren.delete(spawned);
        childExitCode = code;
        pushLog(`The preview command exited (${signal ?? `code ${code ?? "?"}`}).`);
        resolve();
      });
      spawned.once("error", (error) => {
        liveChildren.delete(spawned);
        pushLog(`The preview command couldn't start: ${error.message}`);
        resolve();
      });
    });
    let partial = { stdout: "", stderr: "" };
    const onData = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
      const parts = (partial[stream] + chunk.toString("utf8")).split(/\r\n|\r|\n/);

      partial = { ...partial, [stream]: parts.pop() ?? "" };
      for (const raw of parts) {
        for (const line of expandOutputLine(raw)) {
          pushLog(line);
          const detectedPort = detectPort(line);
          const detectedPid = detectPid(line);

          if (detectedPort) onPort(detectedPort);
          if (detectedPid) onPid(detectedPid);
        }
      }
    };

    spawned.stdout?.on("data", onData("stdout"));
    spawned.stderr?.on("data", onData("stderr"));
    return spawned;
  }

  /**
   * Waits for a dev server on one of `candidates()` to answer like a working
   * site twice, STABLE_MS apart. Returns where, or null when the attempt went
   * stale. `failed()` is checked each round so a dev server that dies is
   * reported at once rather than at the timeout. `ours(host, port)`, when
   * given, is asked before the address that answered is taken for the dev
   * server's: it may say no, or throw to end the wait.
   */
  async function waitUntilSettled(
    candidates: () => number[],
    stale: () => boolean,
    failed: () => void,
    deadline: number,
    ours?: (host: string, port: number) => Promise<boolean>
  ): Promise<{ host: string; port: number } | null> {
    let firstGood: { host: string; port: number; at: number } | null = null;

    while (!stale()) {
      failed();
      let good: { host: string; port: number } | null = null;

      for (const port of [...new Set(candidates())]) {
        const reachable = await connectableHost(port);

        if (stale()) return null;
        if (reachable && (await checkPage(reachable, port)) && (!ours || (await ours(reachable, port)))) {
          good = { host: reachable, port };
          break;
        }
        if (stale()) return null;
      }
      if (good && firstGood && firstGood.port === good.port && Date.now() - firstGood.at >= STABLE_MS) return good;
      if (good && (!firstGood || firstGood.port !== good.port)) firstGood = { ...good, at: Date.now() };
      if (!good) firstGood = null;
      if (Date.now() > deadline) {
        throw new GalleyError("preview", "The preview didn't start in time. The log below may say why.", log.slice(-20).join("\n"));
      }
      // Not listening yet is checked often (a TCP connect is cheap); a first
      // good answer waits out the settle gap before the second look.
      await delay(firstGood ? STABLE_MS : POLL_MS);
    }
    return null;
  }

  async function doStart(myGeneration: number): Promise<PreviewStatus> {
    const stale = () => generation !== myGeneration;

    // Before the settings are read: whether an install is needed is only known once the files are still.
    for (let held = options.holdStart?.() ?? null; held && !stale(); held = options.holdStart?.() ?? null) {
      if (status.detail !== HELD_DETAIL) set("starting", { url: null, baselineUrl: null, baselineSource: null, detail: HELD_DETAIL, startedAt: Date.now() });
      await Promise.race([held.catch(() => undefined), delay(HELD_POLL_MS)]);
    }
    if (stale()) return snapshot();
    const settings = options.settings();
    const waking = pausedBy !== null;

    pausedBy = null;
    log.length = 0;
    uncheckable.clear();
    status = { state: "idle", url: null, baselineUrl: null, baselineSource: null, log: [] };
    if (!settings.dev) {
      set("error", { detail: "This site has no preview command yet. Add one in the site settings (for example “npm run dev”)." });
      return snapshot();
    }
    const startedAt = Date.now();

    try {
      if (!settings.installed && existsSync(join(options.root, "package.json"))) {
        set("installing", { detail: "Installing the site's dependencies. The first time can take a few minutes.", startedAt });
        await installDependencies(options.root, settings.packageManager, pushLog, settings.environment, options.addLockfile === false ? { addLockfile: false } : {});
        if (stale()) return snapshot();
      }
      set("starting", { detail: waking ? WAKING_DETAIL : "Starting the preview.", startedAt });
      // After the status says it is starting (the preview policy counts it from then), before the dev server runs.
      if (options.beforeStart) {
        await Promise.resolve()
          .then(options.beforeStart)
          .catch(() => undefined);
        if (stale()) return snapshot();
      }
      const configuredPort = settings.dev.port;
      let upstream: { host: string; port: number } | null = null;
      let adopted = false;
      let externallyOwned = false;
      /** When set, the port the preview settled on is re-confirmed as the dev server's before serving, at most once a window. Null: adopted, trusted, or accepted without a check that could be repeated. */
      let recheck: { group: number } | null = null;
      /** The configured port was taken by something that isn't provably this site's server. */
      let configuredTaken = false;
      /** Whether it already was before any dev server was started: such a port is no restart. */
      let startedWithTaken = 0;

      if (configuredPort) {
        const answering = await answeringHost(configuredPort, 800);

        if (stale()) return snapshot();
        if (answering) {
          const owner = await ownership(configuredPort, options.root);

          if (stale()) return snapshot();
          if (owner === "own") {
            adopted = true;
            upstream = { host: answering, port: configuredPort };
            pushLog(`Using the preview that's already running on port ${configuredPort}.`);
          } else {
            configuredTaken = true;
            pushLog(
              owner === "foreign"
                ? `Port ${configuredPort} is already used by another program (not this site's preview), so this site gets a preview of its own.`
                : `Something is already answering on port ${configuredPort}, and it couldn't be confirmed to be this site's preview, so this site gets a preview of its own.`
            );
          }
        }
      }
      startedWithTaken = configuredTaken ? 1 : 0;
      // On a hosted install the preview is passed on to signed-in people, so what else listens on the server is the
      // operator's, not theirs to stop: its messages name no port and point to the operator.
      const hosted = options.gateway !== undefined;
      const portGivenUpMessage = (port: number): string =>
        hosted
          ? "The preview couldn't get a port of its own: another program on the server keeps taking it. Whoever runs the server should check what else is listening, or set dev.trustPort in the site settings if the dev command runs its server in a container."
          : `Port ${port} keeps being taken by another program before the preview can use it. Stop whatever is using the ports around ${configuredPort ?? port}, set another port for the preview in the site settings, or — if the dev command runs its server in a container or elsewhere this computer can't see it as the dev server's own — set dev.trustPort there. Then start it again.`;
      if (!adopted) {
        /** Ports this start chose for the dev server and then found to be another program's: not chosen again. */
        const lost: number[] = [];

        // Usually once. Again, on another port, when the port the dev server was given was taken by another
        // program before the dev server could have it: there is a moment between choosing a free port and the
        // dev server asking for it, and what then answers there is not this site.
        for (;;) {
          // Choose a free port when the adapter can pass one, or when the
          // configured port is already taken (so PORT steers servers without
          // portArgs away from the foreign listener); the server's own announced
          // port still wins if it differs.
          const explicitPort =
            settings.dev.portArgs || (configuredTaken && configuredPort) || lost.length
              ? await reservePort(configuredPort, [...(configuredTaken && configuredPort ? [configuredPort] : []), ...lost])
              : null;

          if (explicitPort !== null) {
            // Recorded before the stale check, so a stop() that landed meanwhile still releases it.
            if (reserved !== null) reservedPorts.delete(reserved);
            reserved = explicitPort;
          }
          if (stale()) {
            if (explicitPort !== null && reserved === explicitPort) {
              reservedPorts.delete(explicitPort);
              reserved = null;
            }
            return snapshot();
          }
          let announced: number | null = null;
          let announcedPid: number | null = null;
          // PORT too, for dev servers that read it. The adapter's variables come
          // last: they are set on purpose and may name a port of their own.
          const portEnv: NodeJS.ProcessEnv = explicitPort
            ? { PORT: String(explicitPort) }
            : configuredPort && !configuredTaken
              ? { PORT: process.env.PORT ?? String(configuredPort) }
              : {};
          const env: NodeJS.ProcessEnv = { ...portEnv, ...settings.environment };
          const spawned = spawnDevServer(
            settings.dev.command,
            env,
            explicitPort && settings.dev.portArgs ? portArguments(settings.dev.portArgs, explicitPort) : [],
            (port) => {
              if ((configuredTaken && port === configuredPort) || lost.includes(port)) return;
              // The latest, not the first: a dev server that moved on (it restarted, or the port it was told was
              // taken) says its new port after its old one, and that is the one the preview should follow.
              announced = port;
            },
            (pid) => {
              announcedPid ??= pid;
            }
          );
          let exited = false;
          let backgrounded = false;
          /** Set when the dev server stopped before it was ready: the error that says so, unless the stop turns out to be for its port. */
          let stoppedEarly: GalleyError | null = null;

          void childExited.then(() => {
            exited = true;
          });
          const failed = () => {
            if (!exited || backgrounded) return;
            // Some dev servers detach and exit 0 after announcing where they
            // run. That is a start, not a failure: follow the announced URL.
            if (childExitCode === 0 && announced !== null) {
              backgrounded = true;
              // The launcher is gone; its process group is not ours to signal any more.
              child = null;
              if (announcedPid !== null && announcedPid !== spawned.pid && pidAlive(announcedPid)) {
                detached = { pid: announcedPid, port: announced };
                liveDetached.add(announcedPid);
                installExitHook();
                pushLog(`The preview server moved to the background (process ${announcedPid}); stopping the preview will stop it.`);
              } else {
                externallyOwned = true;
                pushLog("The preview server moved to the background without saying which process it is, so it will be left running when the preview stops.");
              }
              return;
            }
            stoppedEarly = new GalleyError("preview", "The preview stopped before it was ready. The log below says why.", log.slice(-20).join("\n"));
            throw stoppedEarly;
          };
          // Only ports this server is known to use: the one it announced, the one
          // it was told to use, or the configured one when nothing else held it.
          const candidates = () =>
            [announced, explicitPort, configuredTaken || explicitPort ? null : configuredPort].filter(
              (port): port is number => port !== null && !(configuredTaken && port === configuredPort)
            );
          /** The port the dev server was given, by argument or by PORT: the one another program can take in the meantime. */
          const given = explicitPort ?? (configuredPort && !configuredTaken ? configuredPort : null);
          /** When the dev server's own port was first found to answer for someone else, with the dev server neither stopping nor moving. */
          let heldByOtherSince: number | null = null;
          /**
           * Addresses (`host:port`) found to carry nothing but this dev server, so not checked again. Keyed by the
           * address that answered, not the port number: the only way another program's listener is ever reached is
           * at an address the probe prefers over the dev server's, and that is a different address, so it is a key
           * that hasn't been confirmed and is checked. A program taking the confirmed address itself afterwards is
           * the "ready" takeover, out of this change.
           */
          const confirmed = new Set<string>();
          /**
           * Whether the address that answered is this dev server's, asked the first time that address answers and
           * each time after until it is found to carry nothing but the dev server: a program can take the port, or
           * one of its addresses, at any moment before then. The site's settings can turn the check off
           * (`dev.trustPort`) for a dev command that runs its server where the system can't show it as its own.
           */
          const ours = async (host: string, port: number): Promise<boolean> => {
            if (spawned.pid === undefined || settings.dev!.trustPort || confirmed.has(`${host}:${port}`)) return true;
            if (backgrounded && port === announced) {
              // A dev server that detached: don't take its announced port on any address on trust — a program on
              // the port's other address would be served as the preview. Check it the same way as the rest, by the
              // pid it announced, or (when it named none) by its running in the site's folder. A port something
              // foreign shares is not served; a backgrounded server isn't started again, so the wait ends by timing
              // out rather than restarting.
              const standing = await startedHere(port, announcedPid ?? spawned.pid, options.root, process.pid);

              if (standing === "foreign" || standing === "shared") return false;
              if (standing === "own") confirmed.add(`${host}:${port}`);
              else if (!uncheckable.has(port)) {
                // "unknown": nothing here can say whose the listeners are. Said once, as the foreground check does.
                uncheckable.add(port);
                pushLog(hosted ? `Port ${port} is answering, and the server can't check which program has it, so it is taken to be the preview's own.` : `Port ${port} is answering, and it couldn't be checked here that it is this site's own preview answering (this system can't say which program has a port), so it is taken to be.`);
              }
              return true;
            }
            const standing = await startedHere(port, spawned.pid, options.root, process.pid);

            if (standing === "shared") throw new PortTaken(port);
            if (standing === "foreign") {
              // Not this dev server. It hasn't taken the port: it will stop (the port stays taken, and a restart
              // follows below), or move to one of its own (announced, and followed). Given a while to do neither.
              if (port === given) {
                heldByOtherSince ??= Date.now();
                if (Date.now() - heldByOtherSince >= (options.portHeldMs ?? PORT_HELD_MS)) throw new ForeignHeld(port);
              }
              return false;
            }
            heldByOtherSince = null;
            if (standing === "own") confirmed.add(`${host}:${port}`);
            else if (!uncheckable.has(port)) {
              // "unknown": nothing here can say whose the listeners are. Not remembered, so it is said once and no more.
              uncheckable.add(port);
              pushLog(hosted ? `Port ${port} is answering, and the server can't check which program has it, so it is taken to be the preview's own.` : `Port ${port} is answering, and it couldn't be checked here that it is this site's own preview answering (this system can't say which program has a port), so it is taken to be.`);
            }
            return true;
          };

          try {
            upstream = await waitUntilSettled(candidates, stale, failed, Date.now() + (options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS), ours);
          } catch (error) {
            // A listener no part of which is this preview's held the dev server's port for the whole wait, and the
            // dev server neither stopped nor moved: another port would be as invisible. End, naming the setting.
            if (error instanceof ForeignHeld) {
              await stopChild();
              throw new GalleyError("preview", portGivenUpMessage(error.port), log.slice(-20).join("\n"));
            }
            // A port the dev server was given turned out to be another program's: it answered there alongside this
            // dev server (`PortTaken`), or the dev server stopped and left the port held by a program that isn't
            // its own. A dev server that stopped with its port free, or still held by its own child, stopped for a
            // reason of its own, and is not started again.
            let taken: number | null = error instanceof PortTaken ? error.port : null;

            if (taken === null && error === stoppedEarly && given !== null && !stale() && !(await portIsFree(given)) && (await startedHere(given, spawned.pid ?? -1, options.root, process.pid)) !== "own") {
              taken = given;
            }
            if (taken === null || lost.length + (configuredTaken ? 1 : 0) - startedWithTaken >= PORT_RESTARTS || stale()) {
              if (error instanceof PortTaken) {
                throw new GalleyError("preview", portGivenUpMessage(error.port), log.slice(-20).join("\n"));
              }
              throw error;
            }
            pushLog(hosted ? "The preview's port was taken by another program on the server before the preview could use it, so the preview is starting again on another port." : `Port ${taken} was taken by another program before the preview could use it, so the preview is starting again on another port.`);
            await stopChild();
            if (taken === configuredPort) configuredTaken = true;
            else lost.push(taken);
            continue;
          }
          if (stale() || !upstream) return snapshot();
          // A dev server that dies after becoming ready takes the preview down
          // with it. (A backgrounded one has already "exited"; it is not watched.)
          if (!backgrounded) {
            void childExited.then(() => {
              if (child === spawned && !stale()) {
                child = null;
                void teardown().then(() => {
                  if (!stale()) set("error", { url: null, baselineUrl: null, baselineSource: null, detail: "The preview stopped unexpectedly. Restart it to try again." });
                });
              }
            });
          }
          // Re-check the settled port as the preview is used, but only where it was confirmed by a real check: a
          // trusted port (dev.trustPort), or one accepted because nothing here could say whose it is, is not re-checked.
          // (A preview adopted from a server someone was already running — only when `!adopted` is this reached — is
          // left as it is: that server is theirs to vouch for, and adoption doesn't happen in a container.)
          recheck =
            settings.dev!.trustPort || spawned.pid === undefined || !confirmed.has(`${upstream.host}:${upstream.port}`)
              ? null
              : { group: backgrounded ? (announcedPid ?? spawned.pid) : spawned.pid };
          break;
        }
      }
      if (!upstream) return snapshot();
      // Re-check, on use, that the port is still the dev server's: one a program took after the preview was ready is
      // not served. At most once a window; the request that starts a re-check waits for it, others go on the last
      // answer. A check that can't tell keeps serving, until too many in a row can't, then it is torn down too.
      const settled = upstream;
      let confirmedAt = Date.now();
      let rechecking: Promise<"serve" | "stop"> | null = null;
      let cannotTell = 0;
      let takenOver = false;
      /** Set the moment a re-check says stop: from then on nothing is forwarded, so none of the window between the verdict and the proxy being gone reaches the program that took the port. */
      let givingUp = false;
      // Torn down after the request that found the takeover has been answered (on the proxy's side), so that answer —
      // the error, not the other program's page — reaches the browser before the proxy's sockets close.
      const tearDownForTakeover = () => {
        if (takenOver || stale()) return;
        takenOver = true;
        void teardown().then(() => {
          if (!stale()) set("error", { url: null, baselineUrl: null, baselineSource: null, detail: TAKEOVER_DETAIL });
        });
      };
      const verifyUpstream = recheck
        ? async (): Promise<boolean> => {
            if (givingUp) return false;
            if (stale() || status.state !== "ready") return true;
            // A re-check already running: wait for its verdict rather than serve on an older answer.
            if (rechecking) return (await rechecking) !== "stop";
            if (Date.now() - confirmedAt < (options.recheckMs ?? RECHECK_MS)) return true;
            rechecking = (async (): Promise<"serve" | "stop"> => {
              const standing = await startedHere(settled.port, recheck!.group, options.root, process.pid);

              confirmedAt = Date.now();
              if (standing === "foreign" || standing === "shared") return "stop";
              if (standing === "own") {
                cannotTell = 0;
                return "serve";
              }
              cannotTell += 1; // "unknown": the check couldn't tell this time; it is not confirmed again.
              return cannotTell >= RECHECK_UNKNOWN_LIMIT ? "stop" : "serve";
            })();
            let verdict: "serve" | "stop";

            try {
              verdict = await rechecking;
            } finally {
              rechecking = null;
            }
            if (verdict === "stop") givingUp = true;
            return verdict !== "stop";
          }
        : undefined;

      preview = await startPreviewProxy({
        upstreamHost: upstream.host,
        upstreamPort: upstream.port,
        host,
        publicHost,
        overlayScript: options.overlayScript,
        ...(options.pageAttributes ? { pageAttributes: options.pageAttributes } : {}),
        ...(ports ? { ports } : {}),
        ...(options.publicProtocol ? { publicProtocol: options.publicProtocol } : {}),
        ...(options.gateway ? { gateway: options.gateway } : {}),
        ...(verifyUpstream ? { verifyUpstream, onTakenOver: tearDownForTakeover } : {}),
        onActivity: () => {
          lastActivityAt = Date.now();
          options.onActivity?.();
        },
      });
      if (stale()) {
        await teardown();
        return snapshot();
      }
      const baselineSource = settings.urls.staging ? "staging" : settings.urls.production ? "production" : null;
      const baselineTarget = settings.urls.staging ?? settings.urls.production;
      let detail = adopted
        ? `Using the preview that's already running on port ${upstream.port}.`
        : externallyOwned
          ? `The preview is ready. Its server runs in the background on port ${upstream.port} and keeps running after the preview stops.`
          : "The preview is ready.";

      if (baselineTarget && baselineSource) {
        baseline = await startBaselineProxy({
          url: baselineTarget,
          host,
          publicHost,
          overlayScript: options.overlayScript,
          ...(ports ? { ports } : {}),
          ...(options.publicProtocol ? { publicProtocol: options.publicProtocol } : {}),
          ...(options.gateway ? { gateway: options.gateway } : {}),
        });
        if (stale()) {
          await teardown();
          return snapshot();
        }
        // A gateway lets only signed-in browsers through (and its public
        // address may not even resolve from here), so the deployed site is asked directly.
        const answer = await probe(options.gateway ? new URL("/", baselineTarget).href : baseline.url + "/", 8000);

        if (answer === 401 || answer === 403) {
          detail += " The deployed site asks for a password, so you may need to sign in to see it side by side.";
        } else if (answer === null || answer >= 500) {
          detail += " The deployed site isn't answering right now, so the side-by-side view may be empty.";
        }
      }
      // Nothing is awaited between this check and "ready", so a stop() that
      // has landed by now is seen, and one that lands later finds a ready preview to stop.
      if (stale()) {
        await teardown();
        return snapshot();
      }
      lastActivityAt = Date.now();
      set("ready", {
        url: preview.url,
        baselineUrl: baseline?.url ?? null,
        baselineSource: baseline ? baselineSource : null,
        detail,
        startedAt,
      });
      return snapshot();
    } catch (error) {
      if (stale()) return snapshot();
      await teardown();
      if (stale()) return snapshot();
      const message = error instanceof GalleyError ? error.message : "The preview couldn't start.";
      const extra = error instanceof GalleyError ? error.detail : error instanceof Error ? error.message : String(error);

      // Preview errors carry the log tail as detail, which is already in the log.
      if (extra && !(error instanceof GalleyError && error.code === "preview")) pushLog(extra);
      set("error", { url: null, baselineUrl: null, baselineSource: null, detail: message });
      return snapshot();
    }
  }

  const controller: PreviewControllerHandle = {
    get pid() {
      return detached?.pid ?? child?.pid;
    },
    get lastActivityAt() {
      return status.state === "ready" ? lastActivityAt : null;
    },
    status: snapshot,
    start() {
      if (status.state === "ready") return Promise.resolve(snapshot());
      if (starting) return starting;
      const mine = ++generation;
      // The attempt begins on the next tick so that `inner` is already set when
      // its first status event goes out: a listener that calls stop() from the
      // "starting" event must find the attempt to wait for.
      const attempt = Promise.resolve().then(() => doStart(mine));
      const result: Promise<PreviewStatus> = attempt
        .then(async (outcome) => {
          if (generation === mine) return outcome;
          // Cancelled by stop(): answer with the state stop() settles on.
          await stopped;
          return snapshot();
        })
        .finally(() => {
          if (starting === result) starting = null;
          if (inner === attempt) inner = null;
        });

      inner = attempt;
      starting = result;
      return result;
    },
    stop() {
      generation += 1;
      const pending = inner;
      const wasActive = status.state !== "idle" && status.state !== "stopped";

      // A start() after this stop() begins afresh instead of joining the cancelled attempt.
      starting = null;
      stopped = (async () => {
        await teardown();
        if (pending) await pending.catch(() => undefined);
        // Anything the cancelled attempt created after the first teardown goes too.
        await teardown();
        pausedBy = null;
        lastActivityAt = null;
        if (wasActive || pending || status.state !== "stopped") {
          set("stopped", { url: null, baselineUrl: null, baselineSource: null, detail: "The preview is stopped.", paused: undefined });
        }
      })();
      return stopped;
    },
    async restart() {
      await controller.stop();
      return controller.start();
    },
    pause(reason) {
      if (status.state !== "ready") return stopped;
      generation += 1;
      starting = null;
      stopped = (async () => {
        await teardown();
        pausedBy = reason;
        lastActivityAt = null;
        set("idle", { url: null, baselineUrl: null, baselineSource: null, detail: PAUSE_DETAIL[reason], paused: reason });
      })();
      return stopped;
    },
    dispose() {
      return controller.stop();
    },
  };

  return controller;
}
