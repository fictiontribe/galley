import type { AgentRuntime, BrandConfig, EventBus, ImageCandidate, ImageGenRequest, ImageService, SettingsService, SiteRegistry, SiteService, VideoService } from "@galley/core/types";
import type { FormCaptureService, MailTransport } from "@galley/core/forms";
import type { DeployService } from "@galley/core/deploy";
import type { MediaStorageService } from "@galley/core/media-storage";
import type { RedirectsService } from "@galley/core/redirects";
import type { PluginRegistry } from "@galley/core/plugins";
import type { VisibilityService } from "@galley/core/seo";
import type { Install } from "@galley/core/install";
import type { SessionInfo } from "./auth";
import type { RevocationList } from "./auth";
import type { SignInClock } from "./sign-in-gate";
import type { InstallOps } from "./ops";
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
  /** Keeping media in a bucket or Cloudflare Images. Absent: the media storage routes say it isn't available, and media stays in the repository. */
  mediaStorage?: MediaStorageService;
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
  /** "Host the editor online" (local mode only). Absent: its routes say it isn't available. */
  hosting?: import("@galley/core/hosting").HostingService;
  /** Themes saved for everyone here (the data folder's themes/). Absent: none are saved, and saving says it isn't available. */
  themes?: import("@galley/core/themes/store").ThemeStore;
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
  /**
   * Hosted mode: the install this server is — its state (password hash,
   * sessions, setup code), its one site and first run. Created once in
   * startServer. When present, sign-in checks the stored hash, sessions
   * follow the install's "sign out everywhere", and /api/setup/* work.
   */
  install?: Install | null;
  /** Mark the session cookie Secure always (hosted, https:// address): what lets it be a `__Host-` cookie. */
  secureCookie?: boolean;
  /**
   * Hosted mode: the identity provider people sign in through, when one is
   * set up (its issuer). Where there is one, the server's access token may
   * also switch people off, delete switched-off accounts and look them up.
   */
  identityProvider?: { issuer: string } | null;
  /**
   * Hosted mode with a preview gateway: the gateway's two origins and how a
   * one-use ticket is made for a signed-in session (gateway-auth.ts). Absent:
   * the entry route answers the proxies' own addresses (local) or nothing (hosted).
   */
  previewEntry?: { origins: { preview: string; live: string }; issue(session: SessionInfo): string } | null;
  /**
   * Hosted mode without a preview gateway: the sentence a preview start ends
   * with, at once — the editor has no address to show the preview on, and a
   * hosted install never opens ports for it.
   */
  previewUnavailable?: string | null;
  /** Signed-out sessions, shared with whatever else checks them (the preview gateway). Made from the install when absent. */
  revocations?: RevocationList;
  /** Hosted mode: health, backups, restores and the Install page (ops.ts). */
  ops?: InstallOps | null;
  /**
   * Hosted mode: the server's outgoing e-mail (GALLEY_SMTP_URL and
   * GALLEY_MAIL_FROM), for invitations and new-password links. Absent: links
   * are only shown to the owner who made them, and "Forgot your password?"
   * tells people to ask an owner.
   */
  mailer?: MailTransport | null;
  /** Hosted mode: the clock the sign-in limits run on (sign-in-gate.ts). Tests give one that never really waits; absent: the real one. */
  signInClock?: SignInClock;
  /**
   * What an embedding program added (extensions/), already started: their
   * routes are mounted under `/api/x/`. Hosted mode needs accounts for it.
   */
  extensions?: { runtime: import("./extensions/run").StartedExtensions; desk: import("./extensions/people").PeopleDesk | null };
}

/** Keeps track of open event streams so shutdown can end them, and of how many each identity has open where that is limited. */
export interface StreamRegistry {
  /** `owner`: whose stream it is, when streams are counted per identity. Returns how to take it off again. */
  add(close: () => void, owner?: string): () => void;
  /** How many streams `owner` has open. */
  count(owner: string): number;
  /** Ends every stream `owner` has open, unless that was done less than `everyMs` ago. Says whether it did. */
  sweep(owner: string, everyMs: number, now?: number): boolean;
  closeAll(): void;
  readonly size: number;
}

export interface ServerOptions {
  /**
   * Embedding: what the program starting this server adds to it (extensions/index.ts).
   * Fixed here, in the program's own source: nothing read at run time adds one.
   * A server with extensions must be the only server running in its process.
   */
  extensions?: import("./extensions/types").ServerExtension[];
  /** How long one step of undoing a failed start may take (ms; teardown.ts). Tests shorten it. */
  undoStepMs?: number;
  /** How long an extension's setup and stop may take (ms). Tests shorten them. */
  extensionTimes?: { setupMs?: number; stopMs?: number };
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
  /** A Unix socket to listen on as well (default GALLEY_SOCKET). Forwarded headers are believed for requests on it, and once it is set, for no others. */
  socket?: string;
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
  /**
   * Hosted mode, `--reset-password`: the operator's way back in. With an
   * owner, a one-time new-password link for the only owner (or the one
   * `resetPasswordEmail` names); nobody else's account is touched. Without
   * one, a new one-time setup link.
   */
  resetPassword?: boolean;
  /** Which owner `resetPassword` is for, when there are several (`--email`). */
  resetPasswordEmail?: string;
  /** Hosted mode, test seam until signing in through a provider is set up from the environment: the provider's issuer. */
  identityProvider?: { issuer: string } | null;
  /** Hosted mode, test seam: the outgoing e-mail to use instead of the one GALLEY_SMTP_URL and GALLEY_MAIL_FROM describe (null: none). */
  mailer?: MailTransport | null;
  /** Hosted mode, test seam: what runs the editor's own rounds with the repository instead of a real interval (keep-up.ts). */
  syncTimer?: import("./keep-up").KeepUpTimer;
  /** Hosted mode, test seam: ms between refreshes of this server's hold on the data folder (default 10 000). A start that finds another server's hold watches it for two of these. */
  holdBeatMs?: number;
  /** Hosted mode, test seam: replaces installing a starter's dependencies when first run sends one to the repository. */
  siteInstall?: (root: string, onLog: (line: string) => void) => Promise<void>;
  log?: (line: string) => void;
  heartbeatMs?: number;
  /** Hosted mode: where the preview is served (default GALLEY_PREVIEW_URL, then worked out from the public address). */
  previewUrl?: string;
  /** Hosted mode: where the live comparison is served (default GALLEY_LIVE_VIEW_URL, then worked out from the public address). */
  liveViewUrl?: string;
  /** How long a shutdown waits for a publish or a connect in progress (default GALLEY_SHUTDOWN_GRACE_MS, then 20 s). */
  shutdownGraceMs?: number;
  /** One line per request (default: on in hosted mode, GALLEY_LOG_REQUESTS=0 turns it off; off in local mode). */
  logRequests?: boolean;
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
  /** The Unix socket it also listens on (GALLEY_SOCKET), or null. */
  socket: string | null;
  mode: ServerMode;
  /** Local mode token (or the operator's hosted token). */
  token: string | null;
  services: Services;
  /** The data folder (GALLEY_HOME). */
  home: string;
  /** Hosted mode: the install (its state, its one site, first run). Null in local mode. */
  install: Install | null;
  /**
   * Hosted mode, first run pending: `<address>/setup?token=…`, the one-time
   * link that lets whoever has it create the owner's account. Null once an
   * owner exists, in local mode, or when the operator supplied only the code's hash.
   */
  setupUrl: string | null;
  /**
   * Hosted mode, `--reset-password` with an owner: `<address>/new-password#…`,
   * the one-time link that lets that owner choose a new password, and when
   * it stops working. Null otherwise.
   */
  passwordLink: { url: string; expiresAt: string; name: string } | null;
  /** Hosted mode: things the operator should hear once at start (a GALLEY_PASSWORD that no longer applies…). Already passed to `notice`. */
  notices: string[];
  /** Hosted mode: the preview's and the live comparison's addresses, or null when none could be worked out. */
  previews: { preview: string; live: string } | null;
  /** Hosted mode: minutes between the editor's own looks at the repository (GALLEY_SYNC_MINUTES; 0: none). Null in local mode. */
  syncMinutes: number | null;
  /** Hosted mode: the editor's own rounds with the repository (keep-up.ts), for a test to run one by hand. */
  keepUp?: import("./keep-up").KeepUp;
  /** What GET /readyz answers now. */
  readiness(): import("@galley/core/install").ReadyStatus;
  /** URL that signs the browser in (local mode) and lands on `path`. */
  openUrl(path?: string): string;
  /**
   * Stops taking requests, ends the event streams, lets a publish or a
   * connect in progress finish for up to `graceMs` (default: the configured
   * shutdown grace), stops the preview and closes everything.
   */
  close(options?: { graceMs?: number }): Promise<void>;
  /**
   * Hosted mode: settles when this server has stopped serving because
   * another server took its data folder (two on one folder write over each
   * other, so the one that lost its hold stops). Whoever started the server
   * ends the process then. Never settles otherwise; absent in a stand-in.
   */
  displaced?: Promise<void>;
}
