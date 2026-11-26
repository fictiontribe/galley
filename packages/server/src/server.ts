/**
 * startServer — resolve options (explicit values first, then GALLEY_*
 * environment variables, then defaults), refuse unsafe configurations, bind,
 * compose the engine and serve the app. Signal handling belongs to the CLI.
 */
import { randomBytes } from "node:crypto";
import { chmod, chown, lstat, mkdir, readFile, readlink, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { homedir } from "node:os";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { GalleyError, isGalleyError } from "@galley/core";
import { PRODUCT, VERSION } from "@galley/core/brand";
import { hideFromSiteCommands, limitSiteCommandMemory, parsePortRange, type PortRange, type PreviewGateway } from "@galley/core/workspace";
import { setHostedMode } from "@galley/core/plugins";
import { createSmtpTransport, mailConfigFromEnv, type MailTransport } from "@galley/core/forms";
import {
  APP_SECRET_ENV_NAMES,
  createInstall,
  requireCallerForGuardedWork,
  createInstallRegistry,
  holdDataFolder,
  isSingleSiteRegistry,
  LINK_PATHS,
  openInstallState,
  readStartingValues,
  SITE_FOLDER,
  type DataFolderHold,
  type Install,
  type InstallFixed,
  type InstallStore,
  type ReadyStatus,
  type StartingValues,
} from "@galley/core/install";
import type { BrandConfig, Job } from "@galley/core/types";
import { createApp, installRevocations } from "./app";
import { isLoopbackHost, markArrivedOnSocket, mintToken } from "./auth";
import { brandWarnings, loadBrand } from "./brand";
import { createGatewayTickets, type GatewayTickets } from "./gateway-auth";
import { createPreviewGateway, defaultGatewayOrigins, hostnameOf, withGateway, type ServerGateway } from "./gateway";
import { answerHealth, HEALTH_PATH, READY_PATH } from "./health";
import { createServerLog, type ServerLog } from "./log";
import { createMcpMount } from "./mcp";
import { createStreamRegistry } from "./events";
import { createInstallOps, type InstallOps, type ServerPhase } from "./ops";
import { createKeepUp, DEFAULT_SYNC_MINUTES, type KeepUp } from "./keep-up";
import { checkExtensions, declaredSecrets, ExtensionError } from "./extensions/declare";
import { createPeopleDesk, type PeopleDesk } from "./extensions/people";
import { startExtensions, type StartedExtensions } from "./extensions/run";
import { undoEach, type UndoStep } from "./teardown";
import { defaultHome, defaultStartersDir, defaultWebDir } from "./paths";
import type { RunningServer, ServerMode, ServerOptions, Services } from "./types";

export const DEFAULT_PORT = 4400;
export const MIN_PASSWORD_LENGTH = 12;
const PORT_ATTEMPTS = 20;
/** How long a shutdown lets a publish or a connect in progress finish (GALLEY_SHUTDOWN_GRACE_MS). */
export const DEFAULT_SHUTDOWN_GRACE_MS = 20_000;
/** The largest backup the restore upload takes (GALLEY_RESTORE_MAX_MB). */
export const DEFAULT_RESTORE_MAX_MB = 2048;
/** Jobs a shutdown waits for (within its grace): what would leave the repository or the data folder half-done. */
const JOBS_WORTH_WAITING_FOR: ReadonlySet<Job["kind"]> = new Set(["publish", "setup", "restore", "clone", "create"]);

/**
 * What the preview says on a hosted install that has no address for it. It
 * never falls back to opening ports: a hosted install opens exactly one.
 */
export const NO_PREVIEW_ADDRESS =
  "This editor has no address for the preview, so it can't be shown. Whoever runs the server gives it one: an address with a hostname (GALLEY_PUBLIC_URL), or the preview's own two addresses (GALLEY_PREVIEW_URL and GALLEY_LIVE_VIEW_URL).";

/** A configuration the server refuses to start with. The message is meant to be printed as is. */
export class StartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StartupError";
  }
}

export interface ResolvedConfig {
  mode: ServerMode;
  host: string;
  port: number;
  findFreePort: boolean;
  publicUrl: URL | null;
  password: string | null;
  token: string | null;
  home: string;
  sitesDir: string;
  startersDir: string;
  webDir: string;
  brand: BrandConfig;
  trustProxy: boolean;
  /** A Unix socket to listen on as well (GALLEY_SOCKET): forwarded headers are believed for requests on it alone. Null: none. */
  socket: string | null;
  /** The socket's mode: 0o600 (the server's user alone), or 0o660 (its group too) by the operator's choice. See `socketModeOf`. */
  socketMode: number;
  desktop: boolean;
  /** The MCP endpoint at /mcp. */
  mcp: { enabled: boolean; build: boolean; publish: boolean };
  /** The operator's fixed range for preview proxies, or null for any free port. */
  previewPorts: PortRange | null;
  /** Things worth telling the operator that don't stop start-up. */
  warnings: string[];
  /** Hosted: everything first run asks, given up front (environment, then GALLEY_INSTALL_CONFIG). Null in local mode. */
  starting: StartingValues | null;
  /** Hosted: what the operator pinned, so the app shows it as not changeable there. */
  fixed: InstallFixed[];
  /** Hosted: GALLEY_SITE_DIR — which of several old sites to keep on the first upgrade of an old data folder. */
  keepSite: string | null;
  /** Hosted: GALLEY_ALLOW_LOCAL_REPOSITORIES — a folder on this server may be the site's repository. */
  allowLocalRepositories: boolean;
  /** Hosted: where the preview and the live comparison are served through the one port, by hostname. Null: no address could be worked out. */
  gateway: { preview: string; live: string } | null;
  /** How long a shutdown lets work in progress finish. */
  shutdownGraceMs: number;
  /** Hosted: the largest backup the restore upload takes. */
  restoreMaxBytes: number;
  /** One log line per request. */
  logRequests: boolean;
  /** Hosted: the memory ceiling for the site's own commands (MB), or null. */
  previewMemoryMb: number | null;
  /** Hosted: minutes between the editor's own looks at the repository (0: none). Null in local mode, which never looks by itself. */
  syncMinutes: number | null;
}

function wholeNumber(raw: string | number | undefined, name: string, min: number, max: number): number | null {
  if (raw === undefined || raw === "") return null;
  const value = typeof raw === "number" ? raw : Number(raw.trim());

  if (!Number.isInteger(value) || value < min || value > max) throw new StartupError(`${name} must be a whole number from ${min} to ${max}, not “${raw}”.`);
  return value;
}

/** A preview or live address as the operator gave it: a full http(s) address, nothing after the host. */
function gatewayAddress(raw: string, name: string): URL {
  let url: URL;
  const example = name === "GALLEY_LIVE_VIEW_URL" ? "https://cms-live.example.com" : "https://cms-preview.example.com";

  try {
    url = new URL(raw);
  } catch {
    throw new StartupError(`${name} must be a full address like ${example}, not “${raw}”.`);
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new StartupError(`${name} must be a full address like ${example} — https:// (or http://) and a hostname, nothing after it — not “${raw}”.`);
  }
  return url;
}

/**
 * Hosted: where the preview and the live comparison are served. Given, or
 * worked out from the public address (gateway.ts defaultGatewayOrigins).
 * Refuses, in plain words, an address that isn't a full http(s) address, a
 * scheme other than the public address's, and two of the three sharing a
 * hostname. Null when none can be worked out (with a warning).
 */
function resolveGateway(publicUrl: URL | null, rawPreview: string | undefined, rawLive: string | undefined, warnings: string[]): { preview: string; live: string } | null {
  const given = {
    preview: rawPreview ? gatewayAddress(rawPreview, "GALLEY_PREVIEW_URL") : null,
    live: rawLive ? gatewayAddress(rawLive, "GALLEY_LIVE_VIEW_URL") : null,
  };

  if (!publicUrl) {
    if (given.preview || given.live) warnings.push("GALLEY_PREVIEW_URL and GALLEY_LIVE_VIEW_URL are only used together with GALLEY_PUBLIC_URL, which isn't set, so they are ignored.");
    return null;
  }
  const worked = defaultGatewayOrigins(publicUrl);
  const preview = given.preview ?? (worked ? new URL(worked.preview) : null);
  const live = given.live ?? (worked ? new URL(worked.live) : null);

  if (!preview || !live) {
    warnings.push(
      `GALLEY_PUBLIC_URL (${publicUrl.host}) has no hostname the preview's addresses can be worked out from, so the preview won't be shown. Set GALLEY_PREVIEW_URL and GALLEY_LIVE_VIEW_URL to two more hostnames that reach this server, e.g. https://cms-preview.example.com and https://cms-live.example.com.`
    );
    return null;
  }
  for (const [name, url] of [["GALLEY_PREVIEW_URL", preview], ["GALLEY_LIVE_VIEW_URL", live]] as const) {
    if (url.protocol !== publicUrl.protocol) {
      throw new StartupError(`${name} (${url.origin}) must start with ${publicUrl.protocol}// like GALLEY_PUBLIC_URL: a frame on another scheme is blocked by the browser.`);
    }
  }
  const names = [hostnameOf(publicUrl.host), hostnameOf(preview.host), hostnameOf(live.host)];

  if (new Set(names).size !== 3) {
    throw new StartupError(
      "GALLEY_PUBLIC_URL, GALLEY_PREVIEW_URL and GALLEY_LIVE_VIEW_URL each need a hostname of their own: the preview runs the site's code, and on the editor's hostname it could act as the person signed in."
    );
  }
  return { preview: preview.origin, live: live.origin };
}

function flag(value: string | undefined): boolean {
  return value !== undefined && /^(1|true|yes|on)$/i.test(value.trim());
}

/** Unset means the default; only an explicit off/0/false/no turns a switch off. */
function off(value: string | undefined): boolean {
  return value !== undefined && /^(0|false|no|off)$/i.test(value.trim());
}

function parsePort(value: number | string | undefined, source: string): number {
  if (value === undefined || value === "") return DEFAULT_PORT;
  const port = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new StartupError(`${source} must be a port number between 1 and 65535, not “${value}”.`);
  }
  return port;
}

function isWildcard(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "[::]";
}

export function formatHost(host: string): string {
  const bare = host.replace(/^\[|\]$/g, "");

  return bare.includes(":") ? `[${bare}]` : bare;
}

export function resolveConfig(options: ServerOptions = {}): ResolvedConfig {
  const env = options.env ?? process.env;
  const warnings: string[] = [];
  const host = (options.host ?? env.GALLEY_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
  const port = parsePort(options.port ?? env.GALLEY_PORT, options.port !== undefined ? "The port" : "GALLEY_PORT");
  const loopback = isLoopbackHost(host);
  const mode: ServerMode = options.mode ?? (loopback ? "local" : "hosted");
  const name = PRODUCT.name;
  const brand = loadBrand(env, options.brandFile ?? env.GALLEY_BRAND_FILE);

  // A brand accent that can't be the app's pencil is said at start-up, not silently dropped.
  warnings.push(...brandWarnings(brand));

  if (mode === "local" && !loopback) {
    throw new StartupError(`Local mode only listens on this computer (127.0.0.1), not on ${host}. To serve other computers, use \`${PRODUCT.slug} serve\`.`);
  }

  // A hosted install's starting values: the environment, then the one file GALLEY_INSTALL_CONFIG names.
  let starting: StartingValues | null = null;

  if (mode === "hosted") {
    try {
      const read = readStartingValues(env);

      starting = read.values;
      warnings.push(...read.warnings);
    } catch (error) {
      throw new StartupError(isGalleyError(error) ? error.message : String(error));
    }
  }

  let publicUrl: URL | null = null;
  const rawPublic = (options.publicUrl ?? env.GALLEY_PUBLIC_URL ?? starting?.address)?.trim();

  if (rawPublic) {
    try {
      publicUrl = new URL(rawPublic);
    } catch {
      throw new StartupError(`GALLEY_PUBLIC_URL must be a full address like https://cms.example.com, not “${rawPublic}”.`);
    }
    if (publicUrl.protocol !== "http:" && publicUrl.protocol !== "https:") {
      throw new StartupError(`GALLEY_PUBLIC_URL must start with https:// (or http://), not “${publicUrl.protocol}”.`);
    }
  }

  // Hosted mode needs no password to start: without one it starts in first run, behind a one-time setup link.
  // One that is given is a starting value — it sets the password only while the install has none.
  const password = (options.password ?? env.GALLEY_PASSWORD ?? starting?.password) || null;

  if (mode === "hosted") {
    if (password && password.length < MIN_PASSWORD_LENGTH) {
      throw new StartupError(
        `GALLEY_PASSWORD is too short. It needs at least ${MIN_PASSWORD_LENGTH} characters, because ${host} can be reached from other computers.`
      );
    }
    if (starting && password) starting.password = password;
    if (options.sitesDir !== undefined || env.GALLEY_SITES_DIR?.trim()) {
      warnings.push(`--sites-dir and GALLEY_SITES_DIR are ignored: a hosted ${name} looks after one site, kept in its data folder.`);
    }
    if (!publicUrl) {
      warnings.push(
        "GALLEY_PUBLIC_URL isn't set, so the server answers to any hostname and the preview has no address to be shown on. Set it to the address people use, e.g. https://cms.example.com (the preview is then served at GALLEY_PREVIEW_URL and GALLEY_LIVE_VIEW_URL, or at hostnames worked out from it)."
      );
    } else if (publicUrl.protocol === "http:" && !isLoopbackHost(publicUrl.hostname)) {
      warnings.push("GALLEY_PUBLIC_URL uses http://, so the password and sign-in cookie cross the network unencrypted. Put the server behind HTTPS.");
    }
  }

  const tokenInput = (options.token ?? env.GALLEY_TOKEN)?.trim() || null;

  if (tokenInput !== null && tokenInput.length < 16) throw new StartupError("GALLEY_TOKEN must be at least 16 characters long.");
  const token = tokenInput ?? (mode === "local" ? mintToken() : null);
  const home = resolve(options.home ?? defaultHome(env));
  const rawPreviewPorts = (options.previewPorts ?? env.GALLEY_PREVIEW_PORTS)?.trim();
  let previewPorts: PortRange | null = null;

  // Ports are how an app on this computer previews; a hosted install opens exactly one and serves its previews by hostname.
  if (rawPreviewPorts && mode === "hosted") warnings.push("GALLEY_PREVIEW_PORTS is ignored: a hosted install serves the preview through its one port, by hostname.");
  else if (rawPreviewPorts) {
    try {
      previewPorts = parsePortRange(rawPreviewPorts, options.previewPorts !== undefined ? "The preview port range" : "GALLEY_PREVIEW_PORTS");
    } catch (error) {
      throw new StartupError((error as Error).message);
    }
    if (previewPorts.from <= port && port <= previewPorts.to) {
      throw new StartupError(`GALLEY_PREVIEW_PORTS (${previewPorts.from}–${previewPorts.to}) includes the server's own port, ${port}. Choose a range that leaves it out.`);
    }
  }

  const gateway = mode === "hosted" ? resolveGateway(publicUrl, (options.previewUrl ?? env.GALLEY_PREVIEW_URL)?.trim() || undefined, (options.liveViewUrl ?? env.GALLEY_LIVE_VIEW_URL)?.trim() || undefined, warnings) : null;
  const shutdownGraceMs = wholeNumber(options.shutdownGraceMs ?? env.GALLEY_SHUTDOWN_GRACE_MS, "GALLEY_SHUTDOWN_GRACE_MS", 0, 600_000) ?? DEFAULT_SHUTDOWN_GRACE_MS;
  const restoreMaxMb = mode === "hosted" ? (wholeNumber(env.GALLEY_RESTORE_MAX_MB, "GALLEY_RESTORE_MAX_MB", 1, 1_048_576) ?? DEFAULT_RESTORE_MAX_MB) : DEFAULT_RESTORE_MAX_MB;
  const previewMemoryMb = mode === "hosted" ? wholeNumber(env.GALLEY_PREVIEW_MEMORY_MB, "GALLEY_PREVIEW_MEMORY_MB", 64, 1_048_576) : null;
  const syncMinutes = mode === "hosted" ? (wholeNumber(env.GALLEY_SYNC_MINUTES, "GALLEY_SYNC_MINUTES", 0, 1440) ?? DEFAULT_SYNC_MINUTES) : null;
  const socketPath = (options.socket ?? env.GALLEY_SOCKET)?.trim() || null;

  // A socket is for the proxy in front of a hosted editor. A local editor has none, so it ignores the setting (and says so once).
  if (socketPath && mode !== "hosted") warnings.push("GALLEY_SOCKET is set, but only a hosted editor (`galley serve`) listens on a socket: this one ignores it.");
  if (socketPath && mode === "hosted" && process.platform === "win32") {
    throw new StartupError("GALLEY_SOCKET isn't available on Windows. Leave it unset, and put the proxy in front of the port with GALLEY_TRUST_PROXY=1.");
  }
  const socket = socketPath && mode === "hosted" ? resolve(socketPath) : null;
  const socketMode = socket ? socketModeOf(env.GALLEY_SOCKET_MODE, warnings) : 0o600;

  if (socket && (options.trustProxy ?? flag(env.GALLEY_TRUST_PROXY))) {
    warnings.push("GALLEY_TRUST_PROXY is set as well as GALLEY_SOCKET: forwarded headers are believed only for requests that come in on the socket, never for those on the port.");
  }
  const fixed: InstallFixed[] = [];

  if (mode === "hosted" && publicUrl) fixed.push("address");
  if (mode === "hosted" && (env.ANTHROPIC_API_KEY?.trim() ?? "") !== "") fixed.push("assistantKey");

  return {
    mode,
    host,
    port,
    findFreePort: options.findFreePort ?? mode === "local",
    publicUrl,
    password: mode === "hosted" ? password : null,
    token,
    home,
    // Hosted: the one site's folder, inside the data folder; nothing else is ever opened, cloned into or created.
    sitesDir: mode === "hosted" ? join(home, SITE_FOLDER) : resolve(options.sitesDir ?? env.GALLEY_SITES_DIR?.trim() ?? join(home, "sites")),
    startersDir: resolve(options.startersDir ?? env.GALLEY_STARTERS_DIR?.trim() ?? defaultStartersDir()),
    webDir: resolve(options.webDir ?? env.GALLEY_WEB_DIR?.trim() ?? defaultWebDir()),
    brand,
    trustProxy: options.trustProxy ?? flag(env.GALLEY_TRUST_PROXY),
    socket,
    socketMode,
    desktop: options.desktop ?? flag(env.GALLEY_DESKTOP),
    mcp: {
      enabled: options.mcp?.enabled ?? !off(env.GALLEY_MCP),
      build: options.mcp?.build ?? flag(env.GALLEY_MCP_BUILD),
      publish: options.mcp?.publish ?? !off(env.GALLEY_MCP_PUBLISH),
    },
    previewPorts,
    warnings,
    starting,
    fixed,
    keepSite: mode === "hosted" ? env.GALLEY_SITE_DIR?.trim() || null : null,
    allowLocalRepositories: mode === "hosted" && flag(env.GALLEY_ALLOW_LOCAL_REPOSITORIES),
    gateway,
    shutdownGraceMs,
    restoreMaxBytes: restoreMaxMb * 1024 * 1024,
    logRequests: options.logRequests ?? (mode === "hosted" && !off(env.GALLEY_LOG_REQUESTS)),
    previewMemoryMb,
    syncMinutes,
  };
}

/**
 * The HMAC key session cookies are signed with, kept in the home so a
 * restart doesn't sign out the open UI — in local mode too, where adding a
 * plugin means restarting the app. Readable by the owner only; a key file
 * found with looser permissions is tightened before use.
 */
/**
 * Servers running in this process. Hosted mode, "guarded work needs someone"
 * and the names hidden from a site's commands are the process's, not a
 * server's: a second server started beside one would switch them under it.
 * A server that carries extensions therefore has the process to itself.
 */
const inProcess = { servers: 0, withExtensions: false };
const ALONE = "Extensions need the process to themselves: another server is running in it, and the two would change each other's settings. Run each in a process of its own.";

export async function sessionKey(home: string): Promise<Uint8Array> {
  const file = join(home, "session.key");
  const read = async () => {
    const existing = await readFile(file, "utf8").catch(() => null);

    if (!existing || !/^[0-9a-f]{64}$/.test(existing.trim())) return null;
    await chmod(file, 0o600);
    return Buffer.from(existing.trim(), "hex");
  };
  const found = await read();

  if (found) return found;
  const key = randomBytes(32);

  try {
    // "wx": two servers starting on one home at once keep the first key written, not each their own.
    await writeFile(file, `${key.toString("hex")}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const other = await read();

    if (other) return other;
    // An unreadable leftover (not a key): replace it.
    await writeFile(file, `${key.toString("hex")}\n`, { mode: 0o600 });
  }
  await chmod(file, 0o600);
  return key;
}

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();

      resolvePort(typeof address === "object" && address ? address.port : port);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

async function bind(server: Server, config: ResolvedConfig, notice: (line: string) => void): Promise<number> {
  const attempts = config.findFreePort && config.port !== 0 ? PORT_ATTEMPTS : 1;

  for (let i = 0; i < attempts; i += 1) {
    const port = config.port === 0 ? 0 : config.port + i;

    try {
      const bound = await listen(server, port, config.host);

      if (i > 0) notice(`Port ${config.port} is in use, so ${PRODUCT.name} is using ${bound} instead.`);
      return bound;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code === "EADDRINUSE" && i < attempts - 1) continue;
      if (code === "EADDRINUSE") {
        throw new StartupError(
          attempts > 1
            ? `Ports ${config.port}–${config.port + attempts - 1} are all in use. Choose another with --port or GALLEY_PORT.`
            : `Port ${config.port} is already in use on ${config.host}. Stop whatever is using it, or choose another with --port or GALLEY_PORT.`
        );
      }
      if (code === "EACCES") throw new StartupError(`This user isn't allowed to listen on port ${port}. Choose a port above 1024.`);
      if (code === "EADDRNOTAVAIL") throw new StartupError(`This computer has no network address ${config.host} to listen on.`);
      throw error;
    }
  }
  throw new StartupError("No free port was found.");
}

/** What a request is told once this server has stopped because another server took its data folder. */
export const DISPLACED_MESSAGE = "This editor has stopped: another server is running on its data folder. Ask whoever runs this editor to start it again.";

/** Takes the data folder for this server. Another server running on it, or a folder the hold can't be written to, stops the start in plain words. */
async function takeDataFolder(config: ResolvedConfig, notice: (line: string) => void, beatMs: number | undefined, onLost: (by: string) => void): Promise<DataFolderHold> {
  try {
    return await holdDataFolder(config.home, null, { log: notice, onLost, ...(beatMs !== undefined ? { beatMs } : {}) });
  } catch (error) {
    if (isGalleyError(error)) throw new StartupError(error.message);
    throw error;
  }
}

/** Opens (and, for an older data folder, upgrades) the install's state. A folder it can't use stops the start in one plain sentence. */
async function openState(config: ResolvedConfig, notice: (line: string) => void): Promise<InstallStore> {
  try {
    return await openInstallState(config.home, { keepSite: config.keepSite, log: notice });
  } catch (error) {
    if (isGalleyError(error)) throw new StartupError(error.message);
    throw error;
  }
}

type FetchHandler = (request: Request, env: unknown) => Response | Promise<Response>;

/**
 * The one place the HTTP listener is made. Requests whose Host is a preview
 * gateway hostname go to the gateway (gateway.ts) and NEVER reach the app;
 * `front` answers what must answer before the app (health, a shutdown in
 * progress) and returns true when it did; everything else goes to `fetch()`,
 * read per request so whatever sits in front of the app can replace it.
 */
/**
 * A request line in absolute form (`GET http://other.example/path HTTP/1.1`) made origin form (`/path?query`), before
 * anything reads it. The gateway routes by the Host header; Hono would build the app's URL from the request line's
 * address instead, so the app's allowed-hosts check (and the app's own origin, and its protocol) could go by a host
 * the gateway never saw. Made origin form, every part goes by the one Host header. False for a target that can't be
 * made so — another scheme (`ws://…`), or not an address at all — which the listener answers with 400 before anything
 * reads it; `*` (OPTIONS for the whole server) is left for the app.
 */
function toOriginForm(req: IncomingMessage): boolean {
  const target = req.url ?? "";

  // `*` is OPTIONS asking about the server as a whole: left for the app to answer.
  if (target.startsWith("/") || target === "*") return true;
  if (!/^https?:\/\//i.test(target)) return false;
  try {
    const url = new URL(target);

    req.url = `${url.pathname}${url.search}`;
    return true;
  } catch {
    return false;
  }
}

/** What a request whose target can't be put in origin form gets (another scheme, `ws://…`; not an address at all): nothing reads it. */
const BAD_TARGET = "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 12\r\n\r\nBad request\n";

function refuseTarget(res: ServerResponse): void {
  res.writeHead(400, { "content-type": "text/plain; charset=utf-8", connection: "close" });
  res.end("Bad request\n");
}

function createListener(options: {
  host: string;
  gateway: ServerGateway | null;
  fetch: () => FetchHandler;
  front: (req: IncomingMessage, res: ServerResponse) => boolean;
  /** Told of every request and upgrade that comes in on the socket, once it is marked. */
  onSocketRequest?: (req: IncomingMessage) => void;
}): { server: Server; upgraded: Set<Duplex>; forSocket: () => Server } {
  const app = getRequestListener((request, env) => options.fetch()(request, env), { hostname: options.host });
  const listener = withGateway((req, res) => {
    if (!options.front(req, res)) void app(req, res);
  }, options.gateway);
  // An upgraded socket (the preview's hot reload) is no longer the HTTP server's to close, yet keeps it from closing: tracked here.
  const upgraded = new Set<Duplex>();
  // One server for the port and, when GALLEY_SOCKET is set, one for the Unix socket: the same handlers behind both
  // (health, the gateway, the app, upgrades), with every request and upgrade on the socket marked as having come that way.
  const make = (onSocket: boolean): Server => {
    const server = createServer(
      onSocket
        ? (req, res) => {
            if (!toOriginForm(req)) return refuseTarget(res);
            markArrivedOnSocket(req);
            options.onSocketRequest?.(req);
            listener.request(req, res);
          }
        : (req, res) => {
            if (!toOriginForm(req)) return refuseTarget(res);
            listener.request(req, res);
          }
    );

    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!toOriginForm(req)) {
        socket.end(BAD_TARGET);
        return;
      }
      if (onSocket) {
        markArrivedOnSocket(req);
        options.onSocketRequest?.(req);
      }
      upgraded.add(socket);
      socket.once("close", () => upgraded.delete(socket));
      listener.upgrade(req, socket, head);
    });
    return server;
  };

  return { server: make(false), upgraded, forSocket: () => make(true) };
}

/**
 * What is at the Unix socket at `path`: a server still answering there ("live"), a file one left behind ("left",
 * connection refused), or something that can't be told apart ("unknown" — another user's socket, a full queue), which
 * is never taken for a leftover.
 */
function socketStanding(path: string): Promise<"live" | "left" | "unknown"> {
  return new Promise((resolve) => {
    const probe = connect({ path });

    probe.once("connect", () => {
      probe.destroy();
      resolve("live");
    });
    probe.once("error", (error: NodeJS.ErrnoException) => resolve(error.code === "ECONNREFUSED" || error.code === "ENOENT" ? "left" : "unknown"));
  });
}

/**
 * The socket's mode (GALLEY_SOCKET_MODE): 0600, the server's user alone, unless the operator chooses 0660 — the
 * server's group too, how a proxy that runs as another user gets in, and every other account in that group with it.
 * No guess at whether the group is the server's own: groups may come from a directory (LDAP, SSSD, NIS), not only
 * /etc/group, so only the operator can say. Unset, the start says how to let a proxy in.
 */
function socketModeOf(setting: string | undefined, warnings: string[]): number {
  const value = setting?.trim() ?? "";

  if (/^0?660$/.test(value)) return 0o660;
  if (/^0?600$/.test(value)) return 0o600;
  if (value !== "") {
    throw new StartupError(`GALLEY_SOCKET_MODE must be 0660 (the server's user and group may connect) or 0600 (its user alone), not “${value}”.`);
  }
  warnings.push(
    "GALLEY_SOCKET is made for this server's user alone (0600). A proxy that runs as another user can't connect to it: set GALLEY_SOCKET_MODE=0660 to let the server's group in as well — every account in that group, so give the server a group of its own for it."
  );
  return 0o600;
}

/**
 * Every part of the path to the socket's folder, links included, the way the system follows it: each must be the
 * server's user's or root's, and a folder must not be open to others' writing unless only owners may remove what is in
 * it (the sticky bit). Whoever could change any of them could put a socket of their own in this one's place.
 */
async function checkSocketFolder(folder: string): Promise<void> {
  const uid = process.getuid!();
  const parts = folder.split("/").filter(Boolean);
  const otherUser = (part: string) => new StartupError(`The way to the folder for GALLEY_SOCKET (${folder}) goes through ${part}, which belongs to another user. Every folder and link on the way must be this server's user's (or root's).`);
  const open = (part: string) => new StartupError(`The way to the folder for GALLEY_SOCKET (${folder}) goes through ${part}, which other users can write to, so one of them could put a socket of their own there. Use a folder that only this server's user can change, all the way down.`);
  const missing = () => new StartupError(`The folder for GALLEY_SOCKET (${folder}) doesn't exist. Create it, or choose another path.`);
  const check = (part: string, info: { uid: number; mode: number }) => {
    if (info.uid !== uid && info.uid !== 0) throw otherUser(part);
  };
  const root = await lstat("/");

  check("/", root);
  if ((root.mode & 0o022) !== 0 && (root.mode & 0o1000) === 0) throw open("/");
  let at = "/";
  let links = 0;

  while (parts.length > 0) {
    const part = parts.shift()!;

    if (part === ".") continue;
    if (part === "..") {
      at = dirname(at);
      continue;
    }
    const next = join(at, part);
    const info = await lstat(next).catch(() => null);

    if (!info) throw missing();
    check(next, info);
    if (info.isSymbolicLink()) {
      if (++links > 40) throw new StartupError(`The path to the folder for GALLEY_SOCKET (${folder}) goes through too many links. Choose a plainer path.`);
      const target = await readlink(next);

      parts.unshift(...target.split("/").filter(Boolean));
      if (target.startsWith("/")) at = "/";
      continue;
    }
    if (!info.isDirectory()) throw missing();
    if ((info.mode & 0o022) !== 0 && (info.mode & 0o1000) === 0) throw open(next);
    at = next;
  }
}

/** The longest path the system takes for a Unix socket, in bytes (its sun_path, less the end byte). Node cuts a longer one short without saying so. */
const SOCKET_PATH_LIMIT = process.platform === "linux" ? 107 : 103;

/**
 * Listens on the Unix socket at `path` (GALLEY_SOCKET). A socket file a server that stopped without cleaning up left
 * behind is removed first; anything else at that path, or a server still answering on it, stops the start in plain
 * words. Who may open the socket is the folder's to say: the operator puts it in one only the front can reach.
 */
async function bindSocket(server: Server, path: string, mode: number): Promise<void> {
  const bytes = Buffer.byteLength(path);

  if (bytes > SOCKET_PATH_LIMIT) {
    throw new StartupError(`GALLEY_SOCKET's path is ${bytes} bytes long, and this system takes at most ${SOCKET_PATH_LIMIT} for a socket. Choose a shorter one.`);
  }
  // Asked first, as well: systems disagree on the error for a socket in a folder that isn't there (macOS says EACCES).
  await checkSocketFolder(dirname(path));
  const there = await lstat(path).catch(() => null);

  if (there) {
    if (!there.isSocket()) throw new StartupError(`GALLEY_SOCKET names ${path}, which is something other than a socket. Move it out of the way, or choose another path.`);
    const standing = await socketStanding(path);

    if (standing === "live") throw new StartupError(`Another server is already listening on ${path} (GALLEY_SOCKET). Stop it, or choose another path.`);
    if (standing === "unknown") throw new StartupError(`A socket is at ${path} (GALLEY_SOCKET) that may still be in use by another program. Remove it if nothing uses it, or choose another path.`);
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      // Gone already (another start cleared it): what was wanted.
      if (error.code === "ENOENT") return;
      throw new StartupError(`A socket a stopped server left at ${path} (GALLEY_SOCKET) can't be removed by this user (${error.code}). Remove it, or choose another path.`);
    });
  }
  await new Promise<void>((done, fail) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      fail(error);
    };
    const onListening = () => {
      server.off("error", onError);
      done();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    // The socket is made in the listen call itself: with this mask it is never open to others, not even for a moment.
    // A worker thread (an embedder's) can't set the mask: there the mode is set just after, below.
    let mask: number | null = null;

    try {
      mask = process.umask(0o777 & ~mode);
    } catch {
      mask = null;
    }
    try {
      server.listen(path);
    } finally {
      if (mask !== null) process.umask(mask);
    }
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") throw new StartupError(`Another program made a socket at ${path} (GALLEY_SOCKET) just as this server started. Try again, or choose another path.`);
    if (error.code === "EPERM") throw new StartupError(`This user isn't allowed to make a socket at ${path} (GALLEY_SOCKET). Choose a folder it can write to.`);
    if (error.code === "EACCES") throw new StartupError(`This user can't make a socket at ${path} (GALLEY_SOCKET). Choose a folder it can write to.`);
    throw error;
  });
  // Readable and writable by this server's user, and with 0660 its group (a proxy that runs as another user is put in
  // that group); no one else's.
  await chown(path, process.getuid!(), process.getgid!());
  await chmod(path, mode);
}

/** A preview gateway that has nowhere to show anything: a hosted install without an address for the preview never opens a port instead. */
function noAddressGateway(): PreviewGateway {
  return {
    mount() {
      throw new GalleyError("unconfigured", NO_PREVIEW_ADDRESS);
    },
  };
}

const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms).unref?.());

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const config = resolveConfig(options);
  const hosted = config.mode === "hosted";
  const env = options.env ?? process.env;
  const withExtensions = Boolean(options.extensions?.length);

  // What an embedding program added is checked before anything is read, taken or changed (extensions/declare.ts).
  try {
    checkExtensions(options.extensions ?? []);
  } catch (error) {
    throw error instanceof ExtensionError ? new StartupError(error.message) : error;
  }
  if (inProcess.withExtensions || (withExtensions && inProcess.servers > 0)) throw new StartupError(ALONE);
  /** The environment variables the extensions named as secret: known from the start, so nothing started later is handed them. */
  const extensionSecretEnv = declaredSecrets(options.extensions ?? []);
  /** Secrets the environment and the starting values hold: cut out of every line the server writes. */
  const pluginSecretEnv = new Set<string>();
  const startingSecrets = [config.password, config.token, config.starting?.setupToken, config.starting?.site?.token, ...Object.values(config.starting?.keys ?? {})];
  const out: ServerLog = createServerLog({
    ...(options.notice ? { notice: options.notice } : {}),
    ...(options.log ? { log: options.log } : {}),
    home: config.home,
    requests: config.logRequests,
    secrets: () => [
      ...startingSecrets.filter((value): value is string => typeof value === "string"),
      ...[...APP_SECRET_ENV_NAMES, ...pluginSecretEnv].filter((name) => name !== "GALLEY_INSTALL_CONFIG").map((name) => env[name]?.trim() ?? ""),
      // An extension reads the process's own environment, whatever this server was handed as its own.
      ...extensionSecretEnv.flatMap((name) => [env[name]?.trim() ?? "", process.env[name]?.trim() ?? ""]),
    ],
  });
  const notice = out.notice;

  for (const warning of config.warnings) notice(warning);
  await mkdir(config.home, { recursive: true, mode: 0o700 });
  // Hosted: one server to a data folder. It is taken before anything in it is read or changed, and a start that can't take it stops here.
  // Set once another server is found to hold the folder (`displacedBy`: that server, in words). From then on this one writes nothing more to it.
  let displacedBy: string | null = null;
  let stopDisplaced: () => void = () => undefined;
  let tellDisplaced: () => void = () => undefined;
  const displaced = new Promise<void>((resolve) => (tellDisplaced = resolve));
  const hold = hosted
    ? await takeDataFolder(config, notice, options.holdBeatMs, (by) => {
        displacedBy = by;
        stopDisplaced();
      })
    : null;
  // A server with extensions has the process to itself (see `inProcess`). Refused above before anything was touched;
  // counted here, once the data folder is this server's (another start may have got in between).
  if (inProcess.withExtensions || (withExtensions && inProcess.servers > 0)) {
    await hold?.release();
    throw new StartupError(ALONE);
  }
  inProcess.servers += 1;
  if (withExtensions) inProcess.withExtensions = true;
  let inside = true;
  const leaveProcess = () => {
    if (!inside) return;
    inside = false;
    inProcess.servers -= 1;
    if (withExtensions) inProcess.withExtensions = false;
  };
  const release = async () => {
    try {
      await hold?.release();
    } finally {
      // Whether or not that worked, this is no longer one of the servers in this process: the next start must not be refused for it.
      leaveProcess();
    }
  };
  /**
   * Lets go of the data folder for a start that failed before anything but the hold was taken. Through the same
   * undo as a start that failed later: a failure to let go is said in the log, and never replaces the error the
   * start failed with.
   */
  const letGo = () => undoEach([{ what: "letting go of the data folder", run: release }], out.log, options.undoStepMs);
  // Hosted: the install's state, migrated before anything else reads the data folder.
  const store = hosted
    ? await openState(config, notice).catch(async (error) => {
        await letGo();
        throw error;
      })
    : null;

  if (!hosted) await mkdir(config.sitesDir, { recursive: true });

  const cookieKey = await sessionKey(config.home).catch(async (error) => {
    await letGo();
    throw error;
  });
  // GALLEY_SOCKET isn't a secret, but the site's own commands have no business knowing where the proxy's way in is.
  const hideSecrets = () => hideFromSiteCommands([...APP_SECRET_ENV_NAMES, ...pluginSecretEnv, ...extensionSecretEnv, "GALLEY_SOCKET"]);

  // A shared server only runs a site's own plugins when the operator allows it (GALLEY_ALLOW_SITE_PLUGINS=1).
  setHostedMode(hosted);
  // Hosted: guarded work (publishing, the site's settings, build mode) needs a person, the operator or the engine (core install/caller.ts).
  if (hosted) requireCallerForGuardedWork(true);
  // The site's own commands never inherit this app's password, setup code, access key, provider keys or plugin secrets.
  if (hosted) hideSecrets();
  if (hosted) limitSiteCommandMemory(config.previewMemoryMb);
  const revocations = store ? installRevocations(store, out.log) : undefined;
  let tickets: GatewayTickets | null = null;
  let gateway: ServerGateway | null = null;

  if (hosted && store && config.gateway && config.publicUrl) {
    tickets = createGatewayTickets({ key: cookieKey, store, ...(revocations ? { revoked: revocations } : {}) });
    gateway = createPreviewGateway({ previewOrigin: config.gateway.preview, liveOrigin: config.gateway.live, editorOrigin: config.publicUrl.origin, auth: tickets, log: out.log });
  }
  let phase: ServerPhase = "starting";
  let ops: InstallOps | null = null;
  /** The editor's own rounds, once made (below): a restore waits for one in progress. */
  let rounds: KeepUp | null = null;
  let draining = false;
  let inflight = 0;
  const readiness = (): ReadyStatus => (ops ? ops.readiness() : phase === "starting" ? { ready: false, state: "starting" } : { ready: true, state: "ready" });
  let handler: FetchHandler = () =>
    new Response(JSON.stringify({ error: { code: "busy", message: "Still starting. Try again in a moment." } }), {
      status: 503,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  let toldNoForwardedFor = false;
  const { server, upgraded, forSocket } = createListener({
    host: config.host,
    // A request on the socket without X-Forwarded-For has no client address: everyone through the socket would share
    // one sign-in limit, and the log would say "unknown". Said once (health checks, which carry none, aside).
    onSocketRequest(req) {
      if (toldNoForwardedFor || req.headers["x-forwarded-for"]) return;
      const path = (req.url ?? "").split("?")[0];

      if (path === HEALTH_PATH || path === READY_PATH) return;
      toldNoForwardedFor = true;
      notice("A request came in on GALLEY_SOCKET without X-Forwarded-For, so it has no client address: everyone coming through the socket shares one sign-in limit, and the log says \"unknown\". Have the proxy in front set or append X-Forwarded-For.");
    },
    gateway,
    fetch: () => handler,
    front(req, res) {
      if (answerHealth(req, res, readiness)) return true;
      if (draining) {
        res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store", connection: "close" });
        res.end(JSON.stringify({ error: { code: "busy", message: displacedBy === null ? "This editor is stopping. Try again in a moment." : DISPLACED_MESSAGE } }));
        return true;
      }
      const started = performance.now();

      inflight += 1;
      res.once("close", () => {
        inflight -= 1;
        out.request(req.method ?? "GET", req.url ?? "/", res.statusCode, performance.now() - started);
      });
      return false;
    },
  });
  let port: number;
  const undo = () => {
    leaveProcess();
    tickets?.dispose();
    gateway?.close();
    // Switched on above, before the port is asked for: off again on every way a start is undone, a port already taken included.
    setHostedMode(false);
    if (hosted) {
      hideFromSiteCommands([]);
      limitSiteCommandMemory(null);
      requireCallerForGuardedWork(false);
    }
  };

  /** The server on the Unix socket (GALLEY_SOCKET), when one is set. */
  let socketServer: Server | null = null;

  try {
    port = await bind(server, config, notice);
    if (config.socket) {
      socketServer = forSocket();
      await bindSocket(socketServer, config.socket, config.socketMode);
    }
  } catch (error) {
    // The commonest way a start fails (the port is taken). The port's error is the one reported, whatever letting go does.
    // A socket that couldn't be had lets go of the port it was taken with.
    if (server.listening) await new Promise<void>((done) => server.close(() => done()));
    if (socketServer?.listening) await new Promise<void>((done) => socketServer!.close(() => done()));
    await letGo();
    undo();
    throw error;
  }
  // The hold says where this server listens: `backup create` and `backup restore` on the command line name it when they refuse this folder.
  await hold?.setPort(port);
  const url = hosted && config.publicUrl ? config.publicUrl.origin : `http://${formatHost(isWildcard(config.host) ? "127.0.0.1" : config.host)}:${port}`;
  let services: Services;
  let install: Install | null = null;
  let setupCode: string | null = null;
  let passwordLink: RunningServer["passwordLink"] = null;
  const notices: string[] = [];
  // The install's own jobs (connecting the site, a restore), found through the registry like every other job.
  const installJobs = () => (install ? (id: string) => install!.job(id) ?? ops?.job(id) ?? null : null);
  let extensions: StartedExtensions | null = null;
  /** What else a failed start must end, added as each is started (the jobs subscription, MCP, the install's own operations). */
  const alsoStarted: UndoStep[] = [];
  /**
   * Undoes a start that failed, wherever it failed: the same things a stop
   * ends, in the same order, while the data folder is still this server's.
   * Each step is tried whatever the one before did, and none of their
   * failures replaces the error the start failed with.
   */
  const stop = async () => {
    await undoEach(
      [
        { what: "stopping what was added to the server", run: () => extensions?.stop() },
        ...alsoStarted.reverse(),
        { what: "ending the install", run: () => install?.dispose() },
        // The site the install opened, its watcher, a preview a setup started. A registry the server was handed
        // (`options.services`) is its owner's to close: the start never got as far as being theirs to stop.
        { what: "closing the site", run: () => (options.services ? undefined : (services as Services | undefined)?.registry.dispose()) },
        { what: "closing the port", run: () => new Promise<void>((done) => server.close(() => done())) },
        // Closing a Unix socket's server removes its file too.
        { what: "closing the socket", run: () => (socketServer?.listening ? new Promise<void>((done) => socketServer!.close(() => done())) : undefined) },
        { what: "letting go of the data folder", run: release },
      ],
      out.log,
      options.undoStepMs
    );
    undo();
  };

  try {
    if (options.services) {
      services = hosted && store && !isSingleSiteRegistry(options.services.registry)
        ? { ...options.services, registry: createInstallRegistry(options.services.registry, store, installJobs) }
        : options.services;
    } else {
      services = await (await import("./compose")).createServices({
        home: config.home,
        sitesDir: config.sitesDir,
        startersDir: config.startersDir,
        // Hosted: the preview and the live comparison are mounted on the gateway, reached by hostname through this server's
        // one port — or, without an address for them, on nothing at all. Never ports of their own.
        ...(hosted
          ? { previewGateway: gateway ?? noAddressGateway() }
          : { host: "127.0.0.1", ...(config.previewPorts ? { previewPorts: config.previewPorts } : {}) }),
        env,
        mode: config.mode,
        appUrl: () => url,
        onPluginSecretEnv: (names) => {
          const before = pluginSecretEnv.size;

          for (const name of names) pluginSecretEnv.add(name);
          if (hosted && pluginSecretEnv.size !== before) hideSecrets();
        },
        ...(store
          ? {
              installSite: () => store.siteFolder(),
              wrapRegistry: (inner: import("@galley/core/types").SiteRegistry) => createInstallRegistry(inner, store, installJobs),
              // The live address first run was given stays in the install's state, never in the site's files.
              liveUrl: () => store.read().liveUrl,
              // The preview's package install leaves no lockfile the site doesn't have: it would be published as a change nobody made.
              addLockfile: false,
            }
          : {}),
      });
    }
    if (store) {
      if (!isSingleSiteRegistry(services.registry)) throw new Error("A hosted install needs its one-site registry.");
      install = createInstall({
        store,
        registry: services.registry,
        settings: services.settings,
        events: services.events,
        startersDir: config.startersDir,
        allowLocalRepositories: config.allowLocalRepositories,
        fixed: config.fixed,
        notice,
        ...(options.siteInstall ? { installDependencies: options.siteInstall } : {}),
      });
      try {
        const started = await install.start(config.starting ?? {}, {
          resetPassword: options.resetPassword === true,
          ...(options.resetPasswordEmail !== undefined ? { resetPasswordEmail: options.resetPasswordEmail } : {}),
        });

        setupCode = started.setupCode;
        out.remember(setupCode);
        if (started.passwordLink) {
          // A link this server made, printed once to whoever runs it — and never written to the log.
          out.remember(started.passwordLink.code);
          passwordLink = { url: `${url}${LINK_PATHS.password}#${started.passwordLink.code}`, expiresAt: started.passwordLink.expiresAt, name: started.passwordLink.name };
          out.event(`A new-password link was made for ${started.passwordLink.name || "the owner with no name yet"} (Owner) by whoever runs the server (--reset-password).`);
        }
        notices.push(...started.notices);
      } catch (error) {
        if (isGalleyError(error)) throw new StartupError(error.message);
        throw error;
      }
      for (const line of notices) notice(line);
    }
  } catch (error) {
    await stop();
    throw error;
  }

  const streams = createStreamRegistry();
  const mcp = config.mcp.enabled
    ? createMcpMount(services, {
        mode: config.mcp.build ? "build" : "content",
        allowPublish: config.mcp.publish,
        home: config.home,
        productName: config.brand.productName,
        version: VERSION,
        log: out.log,
      })
    : null;

  alsoStarted.push({ what: "closing the MCP endpoint", run: () => mcp?.close() });
  // On an https:// address the cookie is a __Host- cookie: Secure, Path=/, no Domain, so a page on a
  // sibling hostname (the preview's) can neither set nor shadow it. One install, one address: no port in the name.
  const hostCookie = hosted && config.publicUrl?.protocol === "https:";
  /** Running jobs a shutdown waits for, by id (hosted: the server is the whole app there; locally the shell decides). */
  const busyJobs = new Map<string, Job["kind"]>();
  const unsubscribeJobs = !hosted ? () => undefined : services.events.subscribe((event) => {
    if (event.type !== "job") return;
    if (event.job.state === "running" && JOBS_WORTH_WAITING_FOR.has(event.job.kind)) busyJobs.set(event.job.id, event.job.kind);
    else {
      if (busyJobs.has(event.job.id) && event.job.state === "done" && event.job.kind === "setup") out.event("The site was connected.");
      busyJobs.delete(event.job.id);
    }
  });

  alsoStarted.push({ what: "letting go of the jobs", run: unsubscribeJobs });
  // Hosted: invitations and new-password links are also e-mailed when the server has outgoing mail.
  let mailer: MailTransport | null = null;

  if (hosted) {
    if (options.mailer !== undefined) mailer = options.mailer;
    else {
      const { config: mail, problem } = mailConfigFromEnv(env);

      if (problem) notice(`${problem} Invitations and new-password links are shown to the owner who makes them, but not e-mailed.`);
      mailer = mail ? createSmtpTransport(mail) : null;
    }
  }
  if (install) {
    ops = createInstallOps({
      install,
      events: services.events,
      version: VERSION,
      address: url,
      previews: gateway ? gateway.origins : null,
      cookieKey,
      readCookieKey: () => sessionKey(config.home),
      log: out,
      restoreMaxBytes: config.restoreMaxBytes,
      phase: { get: () => phase, set: (next) => (phase = next) },
      // Made further down, once the app is: asked only when a restore runs.
      roundIdle: () => rounds?.idle() ?? Promise.resolve(),
      // What an embedding program added keeps files of its own in the data folder: stopped before it is replaced, started again after.
      aroundRestore: {
        before: async () => void (await extensions?.stopForNow()),
        after: async () => void (await extensions?.restart()),
        // The job has said how it ended, on every stream that was open: now the windows that told an extension they were there say so again.
        letIn: () => void extensions?.endStreams(),
      },
    });
  }
  // What the program starting this server added to it (extensions/): started before the app answers anything.
  let desk: PeopleDesk | null = null;

  if (options.extensions?.length) {
    try {
      if (hosted && !install) throw new ExtensionError("Extensions need accounts in hosted mode: without them every signed-in browser would have every level.");
      desk = install ? createPeopleDesk(install, revocations ?? { has: () => false }) : null;
      extensions = await startExtensions(options.extensions, {
        home: config.home,
        mode: config.mode,
        env,
        log: out.log,
        desk,
        site: (siteId) => services.registry.get(siteId),
        emit: (event) => services.events.emit(event),
        siteId: () => install?.siteId() ?? null,
        ...(options.extensionTimes ?? {}),
      });
      notice(`Extensions: ${extensions.list.map((extension) => `${extension.id} (${extension.routes.length} ${extension.routes.length === 1 ? "route" : "routes"})`).join(", ")}`);
    } catch (error) {
      // By now the install has started: its site may be open, its jobs subscribed to. All of it is undone, as a stop undoes it.
      alsoStarted.push({ what: "ending the install's own operations", run: () => ops?.dispose() });
      await stop();
      throw error instanceof ExtensionError ? new StartupError(error.message) : error;
    }
  }
  const app = createApp(services, {
    ...(extensions ? { extensions: { runtime: extensions, desk } } : {}),
    mode: config.mode,
    token: config.token,
    // Hosted: the install checks the stored hash; the plain value never reaches the app.
    password: hosted ? undefined : (config.password ?? undefined),
    cookieKey,
    cookieName: hostCookie ? `__Host-${PRODUCT.slug}_session` : `${PRODUCT.slug}_session_${port}`,
    install,
    secureCookie: hostCookie,
    ...(hosted && options.identityProvider ? { identityProvider: options.identityProvider } : {}),
    allowedHosts:
      config.mode === "local"
        ? [config.host]
        : config.publicUrl
          ? [config.publicUrl.hostname, ...(isWildcard(config.host) ? [] : [config.host])]
          : null,
    publicOrigin: config.publicUrl?.origin,
    // With a socket set, forwarded headers are believed only for requests that come in on it (see auth.ts).
    trustProxy: config.trustProxy && config.socket === null,
    webDir: config.webDir,
    brand: config.brand,
    version: VERSION,
    desktop: config.desktop,
    fsRoot: store ? store.siteFolder() : homedir(),
    confineSitesTo: store ? store.siteFolder() : undefined,
    frameSources:
      config.mode === "local"
        ? // No "[::1]": browsers reject an IPv6 literal with a port wildcard as
          // a CSP source, and the preview proxies bind 127.0.0.1 anyway.
          ["http://127.0.0.1:*", "http://localhost:*"]
        : // Hosted: exactly the gateway's two origins, or nothing at all.
          gateway
          ? [gateway.origins.preview, gateway.origins.live]
          : [],
    ...(hosted ? { previewEntry: gateway && tickets ? { origins: gateway.origins, issue: (session) => tickets!.issue(session) } : null, previewUnavailable: gateway ? null : NO_PREVIEW_ADDRESS } : {}),
    ...(revocations ? { revocations } : {}),
    ops,
    mailer,
    heartbeatMs: options.heartbeatMs,
    log: out.log,
    streams,
    mcp,
  });

  handler = (request, env) => app.fetch(request, env as never);
  phase = "running";
  // Hosted: the editor keeps up with its repository by itself (keep-up.ts). A round needs the connected site and an install with nothing else under way.
  const keepUp: KeepUp | null = (rounds =
    install && config.syncMinutes !== null
      ? createKeepUp({
          minutes: config.syncMinutes,
          site: async () => {
            const id = install!.store.connectedSiteFolder() ? install!.siteId() : null;

            return id ? services.registry.get(id) : null;
          },
          busy: () => {
            const jobs = new Set(busyJobs.values());

            if (phase !== "running") return phase === "restoring" ? "a backup is being put back" : "the editor is still starting";
            if (draining) return "the editor is stopping";
            if (ops?.restoring() || jobs.has("restore")) return "a backup is being put back";
            if (jobs.has("publish")) return "a publish is in progress";
            return jobs.size > 0 ? "the site is being connected" : null;
          },
          // An assistant's turn counts as work in progress: it writes from what it read, and versions must not come in under it.
          working: () => {
            const siteId = install!.siteId();

            return siteId !== null && (services.agent.working?.(siteId) ?? false) ? "the assistant is working on the site" : null;
          },
          log: (line) => out.event(line),
          ...(options.syncTimer ? { timer: options.syncTimer } : {}),
        })
      : null);

  let closing: Promise<void> | null = null;

  /** Waits for requests and jobs in progress, for at most `ms`. Event streams don't count: they are ended first. */
  async function settle(ms: number): Promise<void> {
    const deadline = Date.now() + ms;
    const busy = () => inflight > 0 || busyJobs.size > 0;

    while (busy() && Date.now() < deadline) await delay(50);
    if (busy()) notice(`Stopping without waiting any longer: ${busyJobs.size > 0 ? [...new Set(busyJobs.values())].join(", ") : "a request"} still in progress after ${Math.round(ms / 1000)} s.`);
  }

  const running: RunningServer = {
    url,
    port,
    host: config.host,
    socket: config.socket,
    mode: config.mode,
    token: config.token,
    services,
    home: config.home,
    install,
    displaced,
    setupUrl: setupCode ? `${url}/setup?token=${encodeURIComponent(setupCode)}` : null,
    passwordLink,
    notices,
    previews: gateway ? gateway.origins : null,
    syncMinutes: config.syncMinutes,
    ...(keepUp ? { keepUp } : {}),
    readiness,
    openUrl(path = "/") {
      const target = `${url}${path.startsWith("/") ? path : `/${path}`}`;

      if (config.mode !== "local" || !config.token) return target;
      return `${target}${target.includes("?") ? "&" : "?"}token=${encodeURIComponent(config.token)}`;
    },
    close(closeOptions = {}) {
      closing ??= (async () => {
        // Displaced: nothing is waited for. Whatever is still in progress would write to a folder that is another server's now.
        const grace = displacedBy === null ? (closeOptions.graceMs ?? config.shutdownGraceMs) : 0;
        const deadline = Date.now() + grace;

        // No new connections, and new requests on open ones are told the editor is stopping.
        draining = true;
        // A measurement of the data folder for the Install page is let go of at once: nothing waits for it.
        void ops?.stopMeasuring();
        // No new round; one in progress gets the grace like a request does.
        const keptUp = keepUp?.stop() ?? Promise.resolve();
        const stopped = Promise.all([
          new Promise<void>((done) => server.close(() => done())),
          socketServer ? new Promise<void>((done) => socketServer!.close(() => done())) : Promise.resolve(),
        ]);

        streams.closeAll();
        await mcp?.close();
        await settle(grace);
        await Promise.race([keptUp, delay(Math.max(0, deadline - Date.now()))]);
        // A connect in progress (copying the site) gets what is left of the grace, then is left behind.
        await Promise.race([install?.idle() ?? Promise.resolve(), delay(Math.max(0, deadline - Date.now()))]);
        // Ended streams leave keep-alive sockets idle a moment later; sweep until they are gone.
        const sweep = setInterval(() => {
          server.closeIdleConnections?.();
          socketServer?.closeIdleConnections?.();
        }, 25);
        const force = setTimeout(() => {
          server.closeAllConnections?.();
          socketServer?.closeAllConnections?.();
        }, 2000);

        server.closeIdleConnections?.();
        socketServer?.closeIdleConnections?.();
        for (const socket of upgraded) socket.destroy();
        // (Closing the socket's server removed its file. Nothing is unlinked after the drain: by then the path may be
        // another server's.)
        await stopped;
        clearInterval(sweep);
        clearTimeout(force);
        unsubscribeJobs();
        let notLetGo: unknown;

        try {
          await Promise.race([install?.dispose() ?? Promise.resolve(), delay(Math.max(1000, deadline - Date.now()))]);
          ops?.dispose();
          tickets?.dispose();
          gateway?.close();
          // What an embedding program added stops while the data folder is still this server's.
          await extensions?.stop();
          // The preview and its whole process group go with the sites.
          await services.registry.dispose();
          // Anything still being written to the state file is written before the process lets go of the folder.
          if (displacedBy === null) await store?.update(() => undefined).catch(() => undefined);
        } finally {
          // Whatever failed above, the folder is let go and this is no longer one of the process's servers: the next start must not be refused for it.
          try {
            await release();
          } catch (error) {
            notLetGo = error;
            out.log(`The data folder couldn't be let go of cleanly: ${error instanceof Error ? error.message : String(error)}`);
          }
          setHostedMode(false);
          if (hosted) {
            hideFromSiteCommands([]);
            limitSiteCommandMemory(null);
            requireCallerForGuardedWork(false);
          }
        }
        // As before: a stop that couldn't let the folder go has not finished cleanly, and says so to whoever asked for it.
        if (notLetGo !== undefined) throw notLetGo;
      })();
      return closing;
    },
  };

  /**
   * Another server has taken the data folder (the hold's refresh found its
   * hold there): two servers on one folder write over each other, so this
   * one stops serving at once and says so. Whoever started it hears through
   * `displaced` and ends the process.
   */
  stopDisplaced = () => {
    draining = true;
    notice(`This server has stopped: the data folder ${config.home} is another server's now${displacedBy ?? ""}, and two servers on one data folder write over each other. Stop the other one, or give this one a data folder of its own (GALLEY_HOME), then start it again.`);
    void running
      .close({ graceMs: 0 })
      .catch(() => undefined)
      .then(() => tellDisplaced());
  };
  // Lost while this server was still starting: stopped now that there is something to stop.
  if (displacedBy !== null) stopDisplaced();
  return running;
}
