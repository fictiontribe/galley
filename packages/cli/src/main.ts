/**
 * The `galley` command line. Zero dependencies beyond the engine and the
 * server: arguments are parsed with node:util parseArgs.
 */
import { isGalleyError } from "@galley/core";
import { PRODUCT, VERSION } from "@galley/core/brand";
import { StartupError } from "@galley/server";
import { UsageError } from "./args";
import { backupCommand } from "./commands/backup";
import { deployCommand } from "./commands/deploy";
import { domainCommand } from "./commands/domain";
import { desktopCommand } from "./commands/desktop";
import { doctorCommand } from "./commands/doctor";
import { hostCommand } from "./commands/host";
import { importCommand } from "./commands/import";
import { initCommand } from "./commands/init";
import { mcpCommand } from "./commands/mcp";
import { newCommand } from "./commands/new";
import { openCommand } from "./commands/open";
import { pluginCommand } from "./commands/plugin";
import { schemaCommand } from "./commands/schema";
import { serveCommand } from "./commands/serve";
import { startersCommand } from "./commands/starters";
import { processIo, type Io } from "./io";

export const HELP = `${PRODUCT.name} — ${PRODUCT.descriptor}. ${PRODUCT.tagline}

Usage
  ${PRODUCT.slug} [path]          Open the site in [path] (default: this folder) in the browser
  ${PRODUCT.slug} serve           Run for other computers, behind a password
  ${PRODUCT.slug} backup …        Back up a hosted install's data folder, or put a backup back
  ${PRODUCT.slug} init [path]     Write ${PRODUCT.configFile} from what detection finds
  ${PRODUCT.slug} doctor [path]   Check that a site and this computer are ready
  ${PRODUCT.slug} deploy [path]   Put the site online with Cloudflare or Vercel (--preview: unpublished changes)
  ${PRODUCT.slug} domain [path]   Use your own domain for a site that is online
  ${PRODUCT.slug} host [path]     Host the editor online for the site, on your own account (Fly.io, Cloudflare, a server)
  ${PRODUCT.slug} new <name>      Start a new site from a starter
  ${PRODUCT.slug} import …        Bring a WordPress site (or another importer's) into a site
  ${PRODUCT.slug} starters        List the starters and their looks
  ${PRODUCT.slug} mcp [path]      Let an AI tool (Claude, Cursor, VS Code…) edit the site over MCP
  ${PRODUCT.slug} plugin …        Add plugins, list them, turn them on or off
  ${PRODUCT.slug} schema          Print the JSON Schema of ${PRODUCT.configFile} (--out <folder>: write every schema)
  ${PRODUCT.slug} version         Print the version

Run \`${PRODUCT.slug} <command> --help\` for a command's options.`;

type Command = (argv: string[], io: Io) => Promise<number>;

const VERSION_HELP = `Usage: ${PRODUCT.slug} version [--json]

Print the version.`;

const versionCommand: Command = async (argv, io) => {
  if (argv.includes("--help") || argv.includes("-h")) {
    io.out(VERSION_HELP);
    return 0;
  }
  const extra = argv.filter((arg) => arg !== "--json");

  if (extra.length) throw new UsageError(`${extra[0]} isn't an option here. Run \`${PRODUCT.slug} version --help\`.`);
  io.out(argv.includes("--json") ? JSON.stringify({ name: PRODUCT.slug, version: VERSION, node: process.versions.node }) : `${PRODUCT.slug} ${VERSION}`);
  return 0;
};

export const COMMANDS: Record<string, Command> = {
  serve: serveCommand,
  backup: backupCommand,
  init: initCommand,
  doctor: doctorCommand,
  new: newCommand,
  starters: startersCommand,
  mcp: mcpCommand,
  plugin: pluginCommand,
  import: importCommand,
  deploy: deployCommand,
  domain: domainCommand,
  host: hostCommand,
  schema: schemaCommand,
  version: versionCommand,
  // Started by the desktop app, not typed by people, so it isn't in HELP.
  desktop: desktopCommand,
};

/** Which command argv names, and the arguments left for it. A first argument that isn't a command is the path to open. */
export function route(argv: string[]): { name: string; args: string[] } {
  const [first, ...rest] = argv;

  if (first === undefined) return { name: "open", args: [] };
  if (first === "help" || ((first === "--help" || first === "-h") && rest.length === 0)) return { name: "help", args: [] };
  if (first === "--version" || first === "-v") return { name: "version", args: rest };
  if (first in COMMANDS) return { name: first, args: rest };
  return { name: "open", args: argv };
}

export async function main(argv: string[], io: Io = processIo()): Promise<number> {
  const { name, args } = route(argv);

  try {
    if (name === "help") {
      io.out(HELP);
      return 0;
    }
    if (name === "open") {
      // `galley --help` alone is the main help; `galley ./site --help` is open's.
      return await openCommand(args, io);
    }
    return await COMMANDS[name]!(args, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(error.message);
      return 2;
    }
    // A configuration the operator got wrong (a brand file, a port range, a
    // refused start-up) is one plain line, never a stack trace.
    if (error instanceof StartupError || isGalleyError(error)) {
      io.err(error.message);
      return 1;
    }
    io.err(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return 1;
  }
}
