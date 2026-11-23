import type { AgentRuntime, BrandConfig, EventBus, ImageCandidate, ImageGenRequest, ImageService, SettingsService, SiteRegistry, SiteService, VideoService } from "@galley/core/types";
import type { FormCaptureService } from "@galley/core/forms";
import type { DeployService } from "@galley/core/deploy";
import type { RedirectsService } from "@galley/core/redirects";
import type { PluginRegistry } from "@galley/core/plugins";
import type { VisibilityService } from "@galley/core/seo";
import type { McpMount } from "./mcp";
import type { ImportService } from "./import";

/** The image service as the server uses it: generation knows the site, so reference pictures can be read from it. */
export interface ServerImageService extends ImageService {
  generate(request: ImageGenRequest, options?: { site?: SiteService; siteId?: string }): Promise<ImageCandidate[]>;
}

/** The engine as the server sees it. Everything is reached through these five. */
export interface Services {
  registry: SiteRegistry;
  agent: AgentRuntime;
  images: ServerImageService;
  settings: SettingsService;
  events: EventBus;
  /** Form capture: the public /f/:siteId endpoint and the inbox. Absent: the endpoint answers 404 and the inbox routes say it isn't available. */
  forms?: FormCaptureService;
  /** Putting sites online. Absent: the deploy routes say it isn't available. */
  deploy?: DeployService;
  /** The redirects list, the host's redirect file kept in step, the Cloudflare sync. Absent: the redirects routes say it isn't available. */
  redirects?: RedirectsService;
  /** Every plugin and what it contributes. Absent: the plugin routes say they aren't available and the catalogues list only the built-ins. */
  plugins?: PluginRegistry;
  /** Video generation. Absent: the video routes say it isn't available. */
  videos?: VideoService;
  /** Search & AI visibility. Absent: the routes build one from `settings` and `events` on first use. */
  visibility?: VisibilityService;
  /** Bringing a WordPress site over. Absent: the import routes keep their state in a folder of their own. */
  imports?: ImportService;
  /** The site's own brand (galley/brand). Absent: the brand routes say it isn't available. */
  siteBrand?: import("@galley/core/sitebrand").SiteBrandService;
}

export type ServerMode = "local" | "hosted";

export interface AppOptions {
  mode: ServerMode;
  /**
   * Session token. Local mode: required; exchanged for a cookie via `?token=`
   * and accepted as `Authorization: Bearer`. Hosted mode: only set when an
   * operator configured one for scripted access (Bearer only, no hand-off).
   */
  token: string | null;
  /** Hosted mode: the sign-in password. */
  password?: string;
  /** HMAC key that signs session cookies. */
  cookieKey: Uint8Array;
  /** Cookie name. Ports share cookies on one hostname, so the server includes its port. */
  cookieName?: string;
  /**
   * Hostnames (no port) the server answers to. Requests with any other Host
   * header are refused — the DNS-rebinding guard. `null` accepts any host
   * (hosted mode without a public URL; the operator was warned).
   */
  allowedHosts: string[] | null;
  /** The external origin in hosted mode (from GALLEY_PUBLIC_URL), used for the Origin check. */
  publicOrigin?: string;
  /** Honour X-Forwarded-Proto / X-Forwarded-For from a reverse proxy. */
  trustProxy?: boolean;
  /** Built web UI. null or a folder without index.html serves the "not built" page. */
  webDir: string | null;
  brand: BrandConfig;
  version: string;
  desktop: boolean;
  /** Folder picker root: the user's home (local) or the sites folder (hosted). */
  fsRoot: string;
  /** Hosted mode: sites may only be opened, cloned or created inside this folder. */
  confineSitesTo?: string;
  /** CSP frame-src sources for the preview proxies. */
  frameSources: string[];
  /** SSE heartbeat interval. Default 20 s. */
  heartbeatMs?: number;
  /** Where unexpected errors are written. Default: stderr. */
  log?: (line: string) => void;
  /** Open SSE streams, so the server can end them on close. Created when absent. */
  streams?: StreamRegistry;
  /** Serve the engine's tools over MCP at /mcp. Absent: no such route. */
  mcp?: McpMount | null;
}

/** Keeps track of open event streams so shutdown can end them. */
export interface StreamRegistry {
  add(close: () => void): () => void;
  closeAll(): void;
  readonly size: number;
}

export interface ServerOptions {
  /** Default: GALLEY_PORT, then 4400. */
  port?: number;
  /** Default: GALLEY_HOST, then 127.0.0.1. */
  host?: string;
  /** Force a mode. Default: local on a loopback host, hosted otherwise. */
  mode?: ServerMode;
  /** Local mode: when the port is busy, try the next ones. Default true in local mode. */
  findFreePort?: boolean;
  publicUrl?: string;
  password?: string;
  token?: string;
  home?: string;
  sitesDir?: string;
  startersDir?: string;
  webDir?: string;
  brandFile?: string;
  trustProxy?: boolean;
  desktop?: boolean;
  /** Read for every option left unset. Default: process.env. */
  env?: NodeJS.ProcessEnv;
  /** Use these instead of composing the real engine (tests, embedding). */
  services?: Services;
  /**
   * Ports the preview and baseline proxies may use, e.g. "4410-4429"
   * (default GALLEY_PREVIEW_PORTS). For a container or firewall that only
   * forwards fixed ports. Unset: any free port.
   */
  previewPorts?: string;
  /** Plain-language notices (port changes, warnings). Default: stderr. */
  notice?: (line: string) => void;
  log?: (line: string) => void;
  heartbeatMs?: number;
  /**
   * The MCP endpoint at /mcp. Defaults come from GALLEY_MCP (off/0 removes it),
   * GALLEY_MCP_BUILD (1: build mode) and GALLEY_MCP_PUBLISH (0: no publishing);
   * otherwise on, content mode, publishing allowed.
   */
  mcp?: { enabled?: boolean; build?: boolean; publish?: boolean };
}

export interface RunningServer {
  /** Origin of the server, e.g. http://127.0.0.1:4400. */
  url: string;
  port: number;
  host: string;
  mode: ServerMode;
  /** Local mode token (or the operator's hosted token). */
  token: string | null;
  services: Services;
  /** URL that signs the browser in (local mode) and lands on `path`. */
  openUrl(path?: string): string;
  close(): Promise<void>;
}
