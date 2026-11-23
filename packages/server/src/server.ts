/**
 * startServer — resolve options (explicit values first, then GALLEY_*
 * environment variables, then defaults), refuse unsafe configurations, bind,
 * compose the engine and serve the app. Signal handling belongs to the CLI.
 */
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createAdaptorServer } from "@hono/node-server";
import { PRODUCT, VERSION } from "@galley/core/brand";
import { parsePortRange, type PortRange } from "@galley/core/workspace";
import { setHostedMode } from "@galley/core/plugins";
import type { BrandConfig } from "@galley/core/types";
import { createApp } from "./app";
import { isLoopbackHost, mintToken, normalizeHostname } from "./auth";
import { loadBrand } from "./brand";
import { createMcpMount } from "./mcp";
import { createStreamRegistry } from "./events";
import { defaultHome, defaultStartersDir, defaultWebDir } from "./paths";
import type { RunningServer, ServerMode, ServerOptions, Services } from "./types";

export const DEFAULT_PORT = 4400;
export const MIN_PASSWORD_LENGTH = 12;
const PORT_ATTEMPTS = 20;

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
    throw new StartupError(`Local mode only listens on this computer (127.0.0.1), not on ${host}. To serve other computers, use \`${PRODUCT.slug} serve\` with GALLEY_PASSWORD set.`);
  }

  let publicUrl: URL | null = null;
  const rawPublic = (options.publicUrl ?? env.GALLEY_PUBLIC_URL)?.trim();

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

  const password = (options.password ?? env.GALLEY_PASSWORD) || null;

  if (mode === "hosted") {
    if (!password) {
      throw new StartupError(
        `${name} won't start on ${host} without a password: anyone who can reach that address could edit and publish your sites. ` +
          `Set GALLEY_PASSWORD to ${MIN_PASSWORD_LENGTH} characters or more, then start it again.`
      );
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new StartupError(
        `GALLEY_PASSWORD is too short. It needs at least ${MIN_PASSWORD_LENGTH} characters, because ${host} can be reached from other computers.`
      );
    }
    if (!publicUrl) {
      warnings.push(
        "GALLEY_PUBLIC_URL isn't set, so the server answers to any hostname and previews are offered on the listening address. Set it to the address people use, e.g. https://cms.example.com."
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

  if (rawPreviewPorts) {
    try {
      previewPorts = parsePortRange(rawPreviewPorts, options.previewPorts !== undefined ? "The preview port range" : "GALLEY_PREVIEW_PORTS");
    } catch (error) {
      throw new StartupError((error as Error).message);
    }
    if (previewPorts.from <= port && port <= previewPorts.to) {
      throw new StartupError(`GALLEY_PREVIEW_PORTS (${previewPorts.from}–${previewPorts.to}) includes the server's own port, ${port}. Choose a range that leaves it out.`);
    }
  }

  return {
    mode,
    host,
    port,
    findFreePort: options.findFreePort ?? mode === "local",
    publicUrl,
    password: mode === "hosted" ? password : null,
    token,
    home,
    sitesDir: resolve(options.sitesDir ?? env.GALLEY_SITES_DIR?.trim() ?? join(home, "sites")),
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

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const config = resolveConfig(options);
  const notice = options.notice ?? ((line: string) => process.stderr.write(`${line}\n`));

  for (const warning of config.warnings) notice(warning);
  await mkdir(config.home, { recursive: true, mode: 0o700 });
  await mkdir(config.sitesDir, { recursive: true });

  const cookieKey = await sessionKey(config.home);

  // A shared server only runs a site's own plugins when the operator allows it (GALLEY_ALLOW_SITE_PLUGINS=1).
  setHostedMode(config.mode === "hosted");
  let handler: (request: Request, env: unknown) => Response | Promise<Response> = () =>
    new Response(JSON.stringify({ error: { code: "busy", message: "Still starting. Try again in a moment." } }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  const server = createAdaptorServer({ fetch: (request, env) => handler(request, env), hostname: config.host }) as Server;
  const port = await bind(server, config, notice);
  const publicHost = config.publicUrl?.hostname ?? (isWildcard(config.host) ? undefined : config.host);
  let services: Services;

  try {
    services =
      options.services ??
      (await (await import("./compose")).createServices({
        home: config.home,
        sitesDir: config.sitesDir,
        startersDir: config.startersDir,
        host: config.mode === "hosted" ? config.host : "127.0.0.1",
        publicHost: config.mode === "hosted" ? publicHost : undefined,
        ...(config.previewPorts ? { previewPorts: config.previewPorts } : {}),
        // Behind HTTPS, previews framed over plain HTTP are blocked as mixed content: they are offered with the public URL's scheme.
        ...(config.mode === "hosted" && config.publicUrl?.protocol === "https:" ? { publicProtocol: "https" as const } : {}),
        env: options.env ?? process.env,
        mode: config.mode,
        // `url` is assigned below, before the server takes requests; the capture service reads it per request.
        appUrl: () => url,
      }));
  } catch (error) {
    await new Promise<void>((done) => server.close(() => done()));
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
        ...(options.log ? { log: options.log } : {}),
      })
    : null;
  const frameHost = publicHost ? formatHost(normalizeHostname(publicHost)) : null;
  const app = createApp(services, {
    mode: config.mode,
    token: config.token,
    password: config.password ?? undefined,
    cookieKey,
    cookieName: `${PRODUCT.slug}_session_${port}`,
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
    fsRoot: config.mode === "local" ? homedir() : config.sitesDir,
    confineSitesTo: config.mode === "hosted" ? config.sitesDir : undefined,
    frameSources:
      config.mode === "local"
        ? // No "[::1]": browsers reject an IPv6 literal with a port wildcard as
          // a CSP source, and the preview proxies bind 127.0.0.1 anyway.
          ["http://127.0.0.1:*", "http://localhost:*"]
        : frameHost
          ? [`http://${frameHost}:*`, `https://${frameHost}:*`]
          : [],
    heartbeatMs: options.heartbeatMs,
    log: options.log,
    streams,
    mcp,
  });

  handler = (request, env) => app.fetch(request, env as never);

  const url =
    config.mode === "hosted" && config.publicUrl ? config.publicUrl.origin : `http://${formatHost(isWildcard(config.host) ? "127.0.0.1" : config.host)}:${port}`;
  let closing: Promise<void> | null = null;

  return {
    url,
    port,
    host: config.host,
    mode: config.mode,
    token: config.token,
    services,
    openUrl(path = "/") {
      const target = `${url}${path.startsWith("/") ? path : `/${path}`}`;

      if (config.mode !== "local" || !config.token) return target;
      return `${target}${target.includes("?") ? "&" : "?"}token=${encodeURIComponent(config.token)}`;
    },
    close() {
      closing ??= (async () => {
        const stopped = new Promise<void>((done) => server.close(() => done()));

        streams.closeAll();
        await mcp?.close();
        // Ended streams leave keep-alive sockets idle a moment later; sweep until they are gone.
        const sweep = setInterval(() => server.closeIdleConnections?.(), 25);
        const force = setTimeout(() => server.closeAllConnections?.(), 2000);

        server.closeIdleConnections?.();
        await stopped;
        clearInterval(sweep);
        clearTimeout(force);
        await services.registry.dispose();
        setHostedMode(false);
      })();
      return closing;
    },
  };
}
