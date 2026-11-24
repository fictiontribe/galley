/**
 * startServer — resolve options (explicit values first, then GALLEY_*
 * environment variables, then defaults), refuse unsafe configurations, bind,
 * compose the engine and serve the app. Signal handling belongs to the CLI.
 */
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { GalleyError, isGalleyError } from "@galley/core";
import { PRODUCT, VERSION } from "@galley/core/brand";
import { hideFromSiteCommands, limitSiteCommandMemory, parsePortRange, type PortRange, type PreviewGateway } from "@galley/core/workspace";
import { setHostedMode } from "@galley/core/plugins";
import { createSmtpTransport, mailConfigFromEnv, type MailTransport } from "@galley/core/forms";
import {
  APP_SECRET_ENV_NAMES,
  createInstall,
  createInstallRegistry,
  holdDataFolder,
  isSingleSiteRegistry,
  LINK_PATHS,
  openInstallState,
  readStartingValues,
  SITE_FOLDER,
  type Install,
  type InstallFixed,
  type InstallStore,
  type ReadyStatus,
  type StartingValues,
} from "@galley/core/install";
import type { BrandConfig, Job } from "@galley/core/types";
import { createApp, installRevocations } from "./app";
import { isLoopbackHost, mintToken } from "./auth";
import { loadBrand } from "./brand";
import { createGatewayTickets, type GatewayTickets } from "./gateway-auth";
import { createPreviewGateway, defaultGatewayOrigins, hostnameOf, withGateway, type ServerGateway } from "./gateway";
import { answerHealth } from "./health";
import { createServerLog, type ServerLog } from "./log";
import { createMcpMount } from "./mcp";
import { createStreamRegistry } from "./events";
import { createInstallOps, type InstallOps, type ServerPhase } from "./ops";
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
    brand: loadBrand(env, options.brandFile ?? env.GALLEY_BRAND_FILE),
    trustProxy: options.trustProxy ?? flag(env.GALLEY_TRUST_PROXY),
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
  };
}

/**
 * The HMAC key session cookies are signed with, kept in the home so a
 * restart doesn't sign out the open UI — in local mode too, where adding a
 * plugin means restarting the app. Readable by the owner only; a key file
 * found with looser permissions is tightened before use.
 */
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

/** Opens (and, for an older data folder, upgrades) the install's state. A folder it can't use stops the start in one plain sentence. */
async function openState(config: ResolvedConfig): Promise<InstallStore> {
  try {
    return await openInstallState(config.home, { keepSite: config.keepSite });
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
function createListener(options: { host: string; gateway: ServerGateway | null; fetch: () => FetchHandler; front: (req: IncomingMessage, res: ServerResponse) => boolean }): { server: Server; upgraded: Set<Duplex> } {
  const app = getRequestListener((request, env) => options.fetch()(request, env), { hostname: options.host });
  const listener = withGateway((req, res) => {
    if (!options.front(req, res)) void app(req, res);
  }, options.gateway);
  const server = createServer(listener.request);
  // An upgraded socket (the preview's hot reload) is no longer the HTTP server's to close, yet keeps it from closing: tracked here.
  const upgraded = new Set<Duplex>();

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    upgraded.add(socket);
    socket.once("close", () => upgraded.delete(socket));
    listener.upgrade(req, socket, head);
  });
  return { server, upgraded };
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
    ],
  });
  const notice = out.notice;

  for (const warning of config.warnings) notice(warning);
  await mkdir(config.home, { recursive: true, mode: 0o700 });
  // Hosted: the install's state, migrated before anything else reads the data folder.
  const store = hosted ? await openState(config) : null;

  if (!hosted) await mkdir(config.sitesDir, { recursive: true });

  const cookieKey = await sessionKey(config.home);
  const hideSecrets = () => hideFromSiteCommands([...APP_SECRET_ENV_NAMES, ...pluginSecretEnv]);

  // A shared server only runs a site's own plugins when the operator allows it (GALLEY_ALLOW_SITE_PLUGINS=1).
  setHostedMode(hosted);
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
  let draining = false;
  let inflight = 0;
  const readiness = (): ReadyStatus => (ops ? ops.readiness() : phase === "starting" ? { ready: false, state: "starting" } : { ready: true, state: "ready" });
  let handler: FetchHandler = () =>
    new Response(JSON.stringify({ error: { code: "busy", message: "Still starting. Try again in a moment." } }), {
      status: 503,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  const { server, upgraded } = createListener({
    host: config.host,
    gateway,
    fetch: () => handler,
    front(req, res) {
      if (answerHealth(req, res, readiness)) return true;
      if (draining) {
        res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store", connection: "close" });
        res.end(JSON.stringify({ error: { code: "busy", message: "This editor is stopping. Try again in a moment." } }));
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
    tickets?.dispose();
    gateway?.close();
    if (hosted) {
      hideFromSiteCommands([]);
      limitSiteCommandMemory(null);
    }
  };

  try {
    port = await bind(server, config, notice);
  } catch (error) {
    undo();
    throw error;
  }
  // Hosted: while this server runs, `backup create` and `backup restore` on the command line refuse this folder.
  const release = hosted ? await holdDataFolder(config.home, port).catch(() => async () => undefined) : async () => undefined;
  const url = hosted && config.publicUrl ? config.publicUrl.origin : `http://${formatHost(isWildcard(config.host) ? "127.0.0.1" : config.host)}:${port}`;
  let services: Services;
  let install: Install | null = null;
  let setupCode: string | null = null;
  let passwordLink: RunningServer["passwordLink"] = null;
  const notices: string[] = [];
  // The install's own jobs (connecting the site, a restore), found through the registry like every other job.
  const installJobs = () => (install ? (id: string) => install!.job(id) ?? ops?.job(id) ?? null : null);
  const stop = async () => {
    await install?.dispose().catch(() => undefined);
    await new Promise<void>((done) => server.close(() => done()));
    await release();
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
    });
  }
  const app = createApp(services, {
    mode: config.mode,
    token: config.token,
    // Hosted: the install checks the stored hash; the plain value never reaches the app.
    password: hosted ? undefined : (config.password ?? undefined),
    cookieKey,
    cookieName: hostCookie ? `__Host-${PRODUCT.slug}_session` : `${PRODUCT.slug}_session_${port}`,
    install,
    secureCookie: hostCookie,
    allowedHosts:
      config.mode === "local"
        ? [config.host]
        : config.publicUrl
          ? [config.publicUrl.hostname, ...(isWildcard(config.host) ? [] : [config.host])]
          : null,
    publicOrigin: config.publicUrl?.origin,
    trustProxy: config.trustProxy,
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

  let closing: Promise<void> | null = null;

  /** Waits for requests and jobs in progress, for at most `ms`. Event streams don't count: they are ended first. */
  async function settle(ms: number): Promise<void> {
    const deadline = Date.now() + ms;
    const busy = () => inflight > 0 || busyJobs.size > 0;

    while (busy() && Date.now() < deadline) await delay(50);
    if (busy()) notice(`Stopping without waiting any longer: ${busyJobs.size > 0 ? [...new Set(busyJobs.values())].join(", ") : "a request"} still in progress after ${Math.round(ms / 1000)} s.`);
  }

  return {
    url,
    port,
    host: config.host,
    mode: config.mode,
    token: config.token,
    services,
    home: config.home,
    install,
    setupUrl: setupCode ? `${url}/setup?token=${encodeURIComponent(setupCode)}` : null,
    passwordLink,
    notices,
    previews: gateway ? gateway.origins : null,
    readiness,
    openUrl(path = "/") {
      const target = `${url}${path.startsWith("/") ? path : `/${path}`}`;

      if (config.mode !== "local" || !config.token) return target;
      return `${target}${target.includes("?") ? "&" : "?"}token=${encodeURIComponent(config.token)}`;
    },
    close(closeOptions = {}) {
      closing ??= (async () => {
        const grace = closeOptions.graceMs ?? config.shutdownGraceMs;
        const deadline = Date.now() + grace;

        // No new connections, and new requests on open ones are told the editor is stopping.
        draining = true;
        // A measurement of the data folder for the Install page is let go of at once: nothing waits for it.
        void ops?.stopMeasuring();
        const stopped = new Promise<void>((done) => server.close(() => done()));

        streams.closeAll();
        await mcp?.close();
        await settle(grace);
        // A connect in progress (copying the site) gets what is left of the grace, then is left behind.
        await Promise.race([install?.idle() ?? Promise.resolve(), delay(Math.max(0, deadline - Date.now()))]);
        // Ended streams leave keep-alive sockets idle a moment later; sweep until they are gone.
        const sweep = setInterval(() => server.closeIdleConnections?.(), 25);
        const force = setTimeout(() => server.closeAllConnections?.(), 2000);

        server.closeIdleConnections?.();
        for (const socket of upgraded) socket.destroy();
        await stopped;
        clearInterval(sweep);
        clearTimeout(force);
        unsubscribeJobs();
        await Promise.race([install?.dispose() ?? Promise.resolve(), delay(Math.max(1000, deadline - Date.now()))]);
        ops?.dispose();
        tickets?.dispose();
        gateway?.close();
        // The preview and its whole process group go with the sites.
        await services.registry.dispose();
        // Anything still being written to the state file is written before the process lets go of the folder.
        await store?.update(() => undefined).catch(() => undefined);
        await release();
        setHostedMode(false);
        if (hosted) {
          hideFromSiteCommands([]);
          limitSiteCommandMemory(null);
        }
      })();
      return closing;
    },
  };
}
