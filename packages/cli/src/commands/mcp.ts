/**
 * `galley mcp` — the site's tools for any AI tool that speaks the Model
 * Context Protocol.
 *
 *   galley mcp [path]          serve one site on stdin/stdout (what goes in a harness's config)
 *   galley mcp token           the stable token for the HTTP endpoint (/mcp on a running server)
 *   galley mcp config [path]   print the ready-to-paste configuration for a client
 *
 * On stdio, standard output carries protocol messages and nothing else:
 * every notice from this command goes to stderr, and @galley/mcp points any
 * other stdout write at stderr before the session starts.
 */
import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { PRODUCT, VERSION } from "@galley/core/brand";
import type { AgentMode } from "@galley/core/types";
import { clientConfig, CLIENT_TITLES, createMcpServer, ensureMcpToken, MCP_CLIENTS, serveStdio, singleSite, type ConfigRequest, type McpClient } from "@galley/mcp";
import { defaultHome, loadBrand, looksLikeSite, openSingleSite } from "@galley/server";
import { parse, UsageError } from "../args";
import type { Io } from "../io";
import { NOT_A_SITE_MARKERS } from "./open";

/** The name the package will be published under, for the `npx` form. */
export const PACKAGE_NAME = `${PRODUCT.slug}-cms`;
export const TOKEN_ENV = `${PRODUCT.slug.toUpperCase()}_MCP_TOKEN`;

export const MCP_HELP = `Usage: ${PRODUCT.slug} mcp [path] [options]
       ${PRODUCT.slug} mcp config [path] --client <name> [--http]
       ${PRODUCT.slug} mcp token [--rotate]

Let an AI tool — Claude, Cursor, VS Code, anything that speaks the Model
Context Protocol — read, edit, proof and publish the site in [path] (default:
this folder), with the same tools ${PRODUCT.name}'s own assistant uses. The tool
starts this command itself; \`${PRODUCT.slug} mcp config\` prints what to paste into
its settings. Nothing else needs to be running.

Options
      --build         Build mode: also read and change the site's source files
                      (components, layouts, styles) and run its build
      --no-publish    Don't offer publishing; changes wait in ${PRODUCT.name} for a person
      --read-only     Only look: list, read, search and show pending changes
      --no-watch      Don't watch the folder for changes made elsewhere
  -h, --help          Show this help

${PRODUCT.slug} mcp config [path]
      --client <name> ${MCP_CLIENTS.join(", ")}
      --http          Connect to a running ${PRODUCT.name} at /mcp instead of starting one
      --url <address> The HTTP endpoint (default http://127.0.0.1:4400/mcp, or GALLEY_PUBLIC_URL/mcp)
                      --build, --no-publish and --read-only are passed on (stdio only)

${PRODUCT.slug} mcp token
      Prints a long-lived access token for the HTTP endpoint, made on first use.
      Only a fingerprint is kept, so it is shown once.
      --rotate        Replace it; the old one stops working at once`;

function homeOf(io: Io): string {
  return defaultHome(io.env);
}

function checkSite(io: Io, root: string): boolean {
  const info = statSync(root, { throwIfNoEntry: false });

  if (!info) io.err(`There's no folder at ${root}.`);
  else if (!info.isDirectory()) io.err(`${root} is a file, not a folder. Point ${PRODUCT.slug} mcp at the folder your site lives in.`);
  else if (!looksLikeSite(root)) io.err(`${root} doesn't look like a site. Looked for ${NOT_A_SITE_MARKERS}.`);
  else return true;
  return false;
}

async function tokenCommand(argv: string[], io: Io): Promise<number> {
  const { values } = parse("mcp token", argv, { rotate: { type: "boolean" } }, 0);

  if (values.help) {
    io.out(MCP_HELP);
    return 0;
  }
  const info = await ensureMcpToken(homeOf(io), { rotate: Boolean(values.rotate) });

  if (info.token) {
    // The token alone on stdout, so `export ${TOKEN_ENV}=$(galley mcp token)` works.
    io.out(info.token);
    io.err(
      `${values.rotate ? "A new token was made; the old one no longer works." : "This is your token."} It is shown this once: only a fingerprint is kept (in ${info.file}). ` +
        `Use it as Authorization: Bearer <token> for /mcp on any ${PRODUCT.name} server that uses this home folder.`
    );
    return 0;
  }
  io.err(
    `A token already exists (made ${info.createdAt.slice(0, 10)}, ending in …${info.hint}). Only its fingerprint is kept, so it can't be shown again. ` +
      `Run \`${PRODUCT.slug} mcp token --rotate\` for a new one (the old one stops working).`
  );
  return 0;
}

function launcherOf(io: Io): { command: string; args: string[] } {
  if (io.launcher) return io.launcher;
  const script = process.argv[1] ? realpathSync(process.argv[1]) : resolve(io.cwd, "galley");

  return { command: process.execPath, args: [script] };
}

function printConfig(io: Io, config: ReturnType<typeof clientConfig>): void {
  io.out(config.where);
  io.out();
  io.out(config.text);
  for (const note of config.notes) {
    io.out();
    io.out(note);
  }
}

async function configCommand(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parse(
    "mcp config",
    argv,
    {
      client: { type: "string" },
      http: { type: "boolean" },
      url: { type: "string" },
      build: { type: "boolean" },
      "no-publish": { type: "boolean" },
      "read-only": { type: "boolean" },
    },
    1
  );

  if (values.help) {
    io.out(MCP_HELP);
    return 0;
  }
  const client = values.client as McpClient | undefined;

  if (!client || !MCP_CLIENTS.includes(client)) {
    throw new UsageError(`Choose a client with --client: ${MCP_CLIENTS.join(", ")}.`);
  }
  const transport = values.http ? "http" : "stdio";
  const root = resolve(io.cwd, positionals[0] ?? ".");

  if (transport === "stdio" && !checkSite(io, root)) return 1;
  if (transport === "http" && positionals[0]) throw new UsageError("Over HTTP the server already knows its sites, so leave out the path.");
  const publicUrl = io.env.GALLEY_PUBLIC_URL?.trim();
  const url = values.url ?? (publicUrl ? `${publicUrl.replace(/\/+$/, "")}/mcp` : `http://127.0.0.1:${io.env.GALLEY_PORT?.trim() || "4400"}/mcp`);
  const flags = [...(values.build ? ["--build"] : []), ...(values["no-publish"] ? ["--no-publish"] : []), ...(values["read-only"] ? ["--read-only"] : [])];
  const base: ConfigRequest = {
    client,
    transport,
    serverName: PRODUCT.slug,
    productName: PRODUCT.name,
    cliName: PRODUCT.slug,
    launcher: launcherOf(io),
    sitePath: transport === "stdio" ? realpathSync(root) : root,
    flags,
    url,
    tokenEnv: TOKEN_ENV,
  };

  io.out(`${CLIENT_TITLES[client]} — ${transport === "stdio" ? "runs this site on this computer (stdio)" : `connects to ${url}`}`);
  io.out();
  printConfig(io, clientConfig(base));
  if (transport === "stdio") {
    io.out();
    io.out(`Once ${PACKAGE_NAME} is published to npm, the same works without this checkout:`);
    io.out();
    io.out(clientConfig({ ...base, launcher: { command: "npx", args: ["-y", PACKAGE_NAME] } }).text);
  }
  return 0;
}

async function serveCommand(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parse("mcp", argv, {
    build: { type: "boolean" },
    "no-publish": { type: "boolean" },
    "read-only": { type: "boolean" },
    "no-watch": { type: "boolean" },
  });

  if (values.help) {
    io.out(MCP_HELP);
    return 0;
  }
  const root = resolve(io.cwd, positionals[0] ?? ".");

  if (!checkSite(io, root)) return 1;
  const mode: AgentMode = values.build ? "build" : "content";
  const readOnly = Boolean(values["read-only"]);
  const allowPublish = !values["no-publish"] && !readOnly;
  const brand = loadBrand(io.env, io.env.GALLEY_BRAND_FILE);
  const engine = await (io.openSite ?? openSingleSite)({ root, home: homeOf(io), env: io.env, watch: !values["no-watch"] });
  // While serving, a signal ends the session cleanly; once shutting down, a
  // second one means "now" (the engine's exit hook still stops the preview).
  const force = () => process.exit(0);
  let stop: () => void = force;
  const onSignal = () => stop();

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    const model = await engine.site.model();
    const settings = await engine.settings.get().catch(() => null);
    const server = createMcpServer({
      sites: singleSite(engine.site),
      mode,
      allowPublish,
      readOnly,
      ...(settings?.images.provider ? { images: engine.images } : {}),
      transport: "stdio",
      brand: { name: brand.productName, version: VERSION },
      siteRoot: engine.site.root,
    });

    if (mode === "build" && !model.ai.allowBuild) io.err("! Build mode is turned off in this site's settings, so only its content can be changed.");
    const session = await serveStdio(server, io.stdio ?? {});

    stop = () => {
      stop = force;
      void session.close();
    };
    io.err(
      `${brand.productName} is serving “${model.name}” (${engine.site.root}) over MCP — ${readOnly ? "read-only" : `${mode} mode, publishing ${allowPublish ? "allowed" : "off"}`}. ` +
        "It stops when the AI tool disconnects."
    );
    await session.closed;
    stop = force;
  } finally {
    stop = force;
    await engine.dispose();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
  return 0;
}

export async function mcpCommand(argv: string[], io: Io): Promise<number> {
  const [first, ...rest] = argv;

  if (first === "token") return tokenCommand(rest, io);
  if (first === "config") return configCommand(rest, io);
  return serveCommand(argv, io);
}
