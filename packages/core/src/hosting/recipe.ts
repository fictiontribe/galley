/**
 * The files to run one install on any computer with Docker — written for
 * "Any server with Docker", for "Cloudflare in front of a computer of yours",
 * and by `galley host recipe` for an operator. Pure and deterministic: the
 * same input gives byte-identical files.
 *
 * Three ways in front of the editor:
 *  - caddy:        the editor and Caddy in one project; Caddy gets and renews
 *                  the HTTPS certificates for the three names by itself;
 *  - shared-proxy: the editor alone, on a network one Caddy shared by several
 *                  installs on the same server joins; each install is its own
 *                  project with its own volume, plus a one-site block for
 *                  that Caddy (and, once per server, the Caddy itself);
 *  - tunnel:       the editor and Cloudflare's connector; nothing is opened
 *                  to the internet, the connector dials out.
 *
 * In every one the editor publishes no port: only the proxy or the connector
 * reaches it, by name. It runs hardened (an ordinary user, a read-only root
 * filesystem, a tmpfs for /tmp, every capability dropped, no privilege
 * escalation, memory and process limits) with one named volume at /data.
 * Nothing secret is written except the connector's key, in a file of its own
 * marked `sensitive`; the setup code appears only as its SHA-256.
 */
import { IMAGE_REPOSITORY, PRODUCT, VERSION } from "../brand";
import type { EditorAddresses, RecipeFile } from "./types";

export type RecipeProxy = "caddy" | "shared-proxy" | "tunnel";
export const RECIPE_PROXIES: RecipeProxy[] = ["caddy", "shared-proxy", "tunnel"];

/** The port the install listens on inside its container. */
export const INSTALL_PORT = 4400;
/** Caddy's official image, the 2.11 line (the docs' reverse_proxy options need 2.11). */
export const CADDY_IMAGE = "caddy:2.11";
/** Cloudflare's connector, as Cloudflare's own instructions run it. */
export const CLOUDFLARED_IMAGE = "cloudflare/cloudflared:latest";
/** The network one shared Caddy and every install on the server join (shared-proxy). */
export const SHARED_PROXY_NETWORK = `${PRODUCT.slug}-proxy`;
/** The shared Caddy's compose project. */
export const SHARED_PROXY_PROJECT = `${PRODUCT.slug}-proxy`;
/** The site's own preview and build commands stay under this, inside the editor's 2g limit, so a runaway build ends itself. */
export const PREVIEW_MEMORY_MB = 1024;

/** An install's compose project: the product's slug first, so it is recognisable on a shared server. */
export function composeProject(name: string): string {
  return `${PRODUCT.slug}-${name}`;
}

/** The image this version of the app installs, unless GALLEY_HOSTING_IMAGE names another. */
export function defaultImage(env: NodeJS.ProcessEnv = process.env): string {
  return env.GALLEY_HOSTING_IMAGE?.trim() || `${IMAGE_REPOSITORY}:${VERSION}`;
}

/** An image reference: registry/path:tag or @digest, nothing that could break out of a YAML line. */
export const IMAGE_REFERENCE = /^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9._-]{1,128})?(?:@sha256:[a-f0-9]{64})?$/;

export interface RecipeInput {
  /** The install's short name: the compose project, and (shared-proxy) its name on the proxy's network. */
  name: string;
  addresses: EditorAddresses;
  image: string;
  proxy: RecipeProxy;
  /** The SHA-256 of the one-time setup code. Absent: the line is left out. */
  setupTokenSha256?: string;
  /** The site's repository, for an install set up from its files alone (`galley host recipe --repository`). */
  repository?: string;
  /** Where the site is inside that repository, when it isn't at the top ("apps/site"). */
  folder?: string;
  /** tunnel: the connector's key. Absent: the file says where it goes. */
  tunnelToken?: string;
  /** The editor's memory limit, as Docker writes it. Default 2g. */
  memory?: string;
}

const isLocal = (host: string) => host === "localhost" || host.endsWith(".localhost");

/**
 * The environment the install starts with: its three addresses, that a proxy
 * is in front, and the setup code's SHA-256. Nothing secret.
 */
export function installEnvironment(addresses: EditorAddresses, setupTokenSha256?: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    GALLEY_PUBLIC_URL: `https://${addresses.editor}`,
    GALLEY_PREVIEW_URL: `https://${addresses.preview}`,
    GALLEY_LIVE_VIEW_URL: `https://${addresses.live}`,
    GALLEY_TRUST_PROXY: "1",
    ...(setupTokenSha256 ? { GALLEY_SETUP_TOKEN_SHA256: setupTokenSha256 } : {}),
    ...extra,
  };
}

function envFile(input: RecipeInput): RecipeFile {
  const environment = installEnvironment(input.addresses, input.setupTokenSha256, {
    ...(input.repository ? { GALLEY_SITE_REPOSITORY: input.repository } : {}),
    ...(input.repository && input.folder ? { GALLEY_SITE_FOLDER: input.folder } : {}),
  });
  const lines = [
    `# The editor's settings. Nothing here is secret: the setup code is only its SHA-256.`,
    ...Object.entries(environment).map(([key, value]) => `${key}=${value}`),
    "# The site's own preview and build stop at this, so a runaway build ends itself instead of the whole editor.",
    `GALLEY_PREVIEW_MEMORY_MB=${PREVIEW_MEMORY_MB}`,
  ];

  if (!input.setupTokenSha256) {
    lines.push(
      "# No setup code was given, and none is needed: on its first start the editor makes a one-time setup link by itself",
      "# and prints it in its log (docker compose logs editor). Optional, before the first start: GALLEY_SETUP_TOKEN_SHA256",
      "# (the SHA-256 of a code of your own) to use your code instead, or GALLEY_PASSWORD to set the password up front."
    );
  }
  return { name: ".env", content: `${lines.join("\n")}\n` };
}

/** The editor service, hardened. `extra` is indented service lines (networks). */
function editorService(input: RecipeInput, extra: string[] = []): string[] {
  return [
    "  editor:",
    `    image: ${JSON.stringify(input.image)}`,
    "    restart: unless-stopped",
    "    env_file: .env",
    "    # Hardened: an ordinary user, nothing written outside /data and /tmp, no extra powers.",
    "    user: node",
    "    read_only: true",
    "    tmpfs:",
    "      - /tmp",
    "    cap_drop:",
    "      - ALL",
    "    security_opt:",
    "      - no-new-privileges",
    `    mem_limit: ${input.memory ?? "2g"}`,
    "    pids_limit: 512",
    "    # Time to finish a publish in progress and stop the preview (up to 20 s) before Docker kills it.",
    "    stop_grace_period: 30s",
    "    # Everything the editor keeps: the site, its settings and keys, its history.",
    "    volumes:",
    "      - data:/data",
    "    healthcheck:",
    `      test: ["CMD", "node", "-e", ${JSON.stringify(`fetch('http://127.0.0.1:${INSTALL_PORT}/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))`)}]`,
    "      interval: 30s",
    "      timeout: 5s",
    "      start_period: 30s",
    "      retries: 3",
    "    # No ports: only what is in front of it reaches it, by name.",
    ...extra,
  ];
}

function siteBlock(input: RecipeInput, upstream: string): string[] {
  const { editor, preview, live } = input.addresses;
  const local = [editor, preview, live].every(isLocal);

  return [
    `${editor}, ${preview}, ${live} {`,
    ...(local ? ["\t# Names on this computer only: Caddy's own certificate authority signs them.", "\ttls internal"] : []),
    `\treverse_proxy ${upstream}:${INSTALL_PORT} {`,
    "\t\t# Keep open connections (the editor's live updates) through a reload of this file.",
    "\t\tstream_close_delay 5m",
    "\t}",
    "}",
  ];
}

function header(input: RecipeInput, what: string): string[] {
  return [
    `# ${PRODUCT.name}: the editor “${input.name}” at https://${input.addresses.editor}, ${what}.`,
    `# Written by \`${PRODUCT.slug} host recipe\`. Start it in this folder with: docker compose up -d (project “${composeProject(input.name)}”)`,
  ];
}

const text = (lines: string[]) => `${lines.join("\n")}\n`;

function caddyFiles(input: RecipeInput): RecipeFile[] {
  const compose = [
    ...header(input, "with Caddy in front for HTTPS"),
    `name: ${composeProject(input.name)}`,
    "services:",
    ...editorService(input),
    "  caddy:",
    `    image: ${CADDY_IMAGE}`,
    "    restart: unless-stopped",
    "    ports:",
    '      - "80:80"',
    '      - "443:443"',
    '      - "443:443/udp"',
    "    volumes:",
    "      - ./Caddyfile:/etc/caddy/Caddyfile:ro",
    "      - caddy-data:/data",
    "      - caddy-config:/config",
    "    depends_on:",
    "      - editor",
    "volumes:",
    "  data:",
    "  caddy-data:",
    "  caddy-config:",
  ];
  const caddyfile = ["# HTTPS for the editor, its preview and its live comparison: Caddy gets and renews the certificates by itself.", ...siteBlock(input, "editor")];

  return [{ name: "compose.yaml", content: text(compose) }, { name: "Caddyfile", content: text(caddyfile) }, envFile(input)];
}

function sharedProxyFiles(input: RecipeInput): RecipeFile[] {
  const compose = [
    ...header(input, `behind the Caddy shared by this server's editors (network “${SHARED_PROXY_NETWORK}”)`),
    `name: ${composeProject(input.name)}`,
    "services:",
    ...editorService(input, ["    networks:", "      proxy:", "        aliases:", `          - ${input.name}`]),
    "networks:",
    "  proxy:",
    "    external: true",
    `    name: ${SHARED_PROXY_NETWORK}`,
    "volumes:",
    "  data:",
  ];
  const block = [`# The editor “${input.name}”: put this file in the shared Caddy's sites/ folder, then reload Caddy.`, ...siteBlock(input, input.name)];
  // Once per server: the Caddy every editor on it shares.
  const proxyCompose = [
    `# The Caddy shared by every ${PRODUCT.name} editor on this server. Once per server:`,
    `#   docker network create ${SHARED_PROXY_NETWORK} && docker compose up -d`,
    "# Each editor adds its own file to sites/; reload with: docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile",
    `name: ${SHARED_PROXY_PROJECT}`,
    "services:",
    "  caddy:",
    `    image: ${CADDY_IMAGE}`,
    "    restart: unless-stopped",
    "    ports:",
    '      - "80:80"',
    '      - "443:443"',
    '      - "443:443/udp"',
    "    volumes:",
    "      - ./Caddyfile:/etc/caddy/Caddyfile:ro",
    "      - ./sites:/etc/caddy/sites:ro",
    "      - caddy-data:/data",
    "      - caddy-config:/config",
    "    networks:",
    "      - proxy",
    "networks:",
    "  proxy:",
    "    external: true",
    `    name: ${SHARED_PROXY_NETWORK}`,
    "volumes:",
    "  caddy-data:",
    "  caddy-config:",
  ];

  return [
    { name: "compose.yaml", content: text(compose) },
    envFile(input),
    { name: `${input.name}.caddy`, content: text(block) },
    { name: "proxy/compose.yaml", content: text(proxyCompose) },
    { name: "proxy/Caddyfile", content: text(["# Every editor's own file in sites/.", "import sites/*.caddy"]) },
  ];
}

function tunnelFiles(input: RecipeInput): RecipeFile[] {
  const compose = [
    ...header(input, "reached through Cloudflare; nothing is opened to the internet"),
    `name: ${composeProject(input.name)}`,
    "services:",
    ...editorService(input),
    "  connector:",
    `    image: ${CLOUDFLARED_IMAGE}`,
    "    restart: unless-stopped",
    '    command: ["tunnel", "--no-autoupdate", "run"]',
    "    # Its key, in a file of its own: TUNNEL_TOKEN.",
    "    env_file: tunnel.env",
    "    cap_drop:",
    "      - ALL",
    "    security_opt:",
    "      - no-new-privileges",
    "    depends_on:",
    "      - editor",
    "volumes:",
    "  data:",
  ];
  const tunnel = input.tunnelToken
    ? ["# The key Cloudflare's connector signs in with. Keep it like a password: anyone with it can serve these addresses.", `TUNNEL_TOKEN=${input.tunnelToken}`]
    : ["# The key Cloudflare's connector signs in with goes here once the tunnel exists:", "# TUNNEL_TOKEN=…"];

  return [{ name: "compose.yaml", content: text(compose) }, envFile(input), { name: "tunnel.env", content: text(tunnel), sensitive: true }];
}

/** The files for one install, in the order to show them. */
export function recipeFiles(input: RecipeInput): RecipeFile[] {
  return input.proxy === "tunnel" ? tunnelFiles(input) : input.proxy === "shared-proxy" ? sharedProxyFiles(input) : caddyFiles(input);
}
