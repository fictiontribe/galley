/**
 * The HTTP contract between the Galley server and its clients.
 *
 * The server implements every route in `ApiRoutes`; the web UI calls them
 * through a client typed from the same map, so the two cannot drift. Types and a few
 * shared constants only — no logic.
 *
 * Conventions
 * - JSON in, JSON out. Errors are `ApiError` with a matching HTTP status
 *   (404 not-found, 409 conflict, 403 forbidden, 400 invalid, 401
 *   unauthorized when the session is missing, 500 otherwise).
 * - `:siteId` scopes everything that touches a checkout.
 * - File and entry paths travel in the query string or body (never as a URL
 *   segment), repo-relative with POSIX separators.
 * - Auth: local mode requires the session token (`?token=` once → cookie, or
 *   `Authorization: Bearer`). Hosted mode signs in with `POST /api/auth/login`.
 * - Live updates arrive over `GET /api/events` (Server-Sent Events, each
 *   `data:` line one JSON `ServerEvent`).
 */
import type {
  BuildResult,
  ChangeSet,
  ChatThread,
  ChatThreadSummary,
  AgentMode,
  CloneSiteRequest,
  CreateEntryInput,
  CreateSiteRequest,
  EditOp,
  EditResult,
  Entry,
  EntryList,
  EntryQuery,
  EntrySummary,
  FileDiff,
  GalleyConfig,
  GalleyErrorShape,
  GitStatus,
  HistoryEntry,
  ImageCandidate,
  ImageGenRequest,
  ImageProviderInfo,
  ImageSaveRequest,
  Job,
  JsonValue,
  MediaItem,
  MetaInfo,
  OpenSiteRequest,
  PreviewStatus,
  PublishCheck,
  PublishRequest,
  PublishResult,
  ResolveRequest,
  ResolveResult,
  SearchHit,
  SecretName,
  SecretStatus,
  SendMessageRequest,
  Settings,
  SettingsPatch,
  SiteDetail,
  SiteModel,
  SiteSummary,
  StarterInfo,
  UsageSummary,
  ValidationIssue,
} from "./types";
import type { DeployAccount, DeployConfig, DeployKind, DeployProjectCheck, DeployStatus, DeployTargetId, DeployTargetInfo, Deployment, DomainPlan } from "./types";
import type { PluginConflict, PluginInfo, VideoGenRequest, VideoJobStatus, VideoProviderInfo, VideoSaveRequest } from "./types";
import type { FormProviderInfo, ScriptIntegrationInfo } from "./kit";
import type { CloudflareCheck, CloudflarePlan, ImportMode, ImportResolutions, ImportReview, Redirect, RedirectExportFormat, RedirectHealth, RedirectHostId, RedirectsOverview, RedirectTrace } from "./redirects/types";
import type { AddSitesRequest, AddSitesResult, ScanSitesRequest, ScanSitesResult, SiteConnections, SiteGroup, SiteGroupInput, SitePatch, SiteUsageTotals } from "./types";
import type { DeployKeyInfo, InstallInfo, RestoreUpload, SetupHandover, SetupStatus, SiteAccessCheck, SiteConnectRequest } from "./install/types";
import type { Account, AccountRole, AccountSession, Invitation, LinkPreview, OneTimeLink, People } from "./install/accounts";
import type { MediaCheckResult, MediaConnectRequest, MediaConnectResult, MediaLibraryAnswer, MediaStorageStatus, MediaStoreDeleteResult, MediaStoreInfo, MediaUsage } from "./media-storage/contract";
import type { EditorHostAbsent, EditorHostAccount, EditorHostInfo, HostedEditorBackup, HostedEditorPlan, HostedEditorRemoval, HostedEditorRequest, HostedEditorStatus } from "./hosting/types";

/**
 * Every catalogue the app chooses from, merged from all enabled plugins
 * (the built-ins are a plugin too). `plugin` says whose each entry is.
 */
export interface PluginCatalog {
  formProviders: Array<FormProviderInfo & { plugin: string }>;
  /** A plugin's kind carries its `snippet`; the app writes it into the entry's settings (`src` / `inline`) when adding it. */
  scriptIntegrations: Array<ScriptIntegrationInfo & { plugin: string; snippet?: { src?: string; inline?: string; attributes?: Record<string, string> } }>;
  imageProviders: ImageProviderInfo[];
  videoProviders: VideoProviderInfo[];
  importers: Array<{ id: string; name: string; description: string; input: "url" | "file" | "url-or-file"; docsUrl?: string; plugin: string; command: boolean }>;
  deployTargets: Array<{ id: string; name: string; blurb?: string; plugin: string }>;
  /** Where the editor itself can be hosted online ("Host the editor online"). */
  editorHosts?: Array<{ id: string; name: string; summary?: string; plugin: string }>;
  /** Where field values can be picked from (a field opts in with `dataSource` in galley.config.json). */
  dataSources?: Array<{ id: string; label: string; description?: string; plugin: string }>;
}

/** One data source, as the catalogue lists it and as each data-source answer names it. */
export interface DataSourceSummary {
  id: string;
  label: string;
  description?: string;
  plugin: string;
}

/** One thing a field's picker can offer: the value written into the file, and how to show it. */
export interface DataSourceOption {
  value: string;
  title: string;
  /** An https address, or a path from the site's root (shown from the site's preview). */
  image?: string;
  detail?: string;
}

/** `GET …/data-sources/:sourceId`: a search (`q`) answers `items`, a look-up (`value`) answers `item` (null when the source no longer has it). */
export type DataSourceAnswer = { source: DataSourceSummary; items: DataSourceOption[] } | { source: DataSourceSummary; item: DataSourceOption | null };

export interface PluginList {
  plugins: PluginInfo[];
  conflicts: PluginConflict[];
}

export interface ApiError {
  error: GalleyErrorShape;
}

/** A route's shape. Absent members mean "none". */
export interface RouteShape {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  response: unknown;
}

type Ok = { ok: true };

/** `POST /api/sites/:siteId/forms/introspect` — which provider, with the destination's settings. */
export interface FormIntrospectRequest {
  provider: string;
  settings: { [key: string]: JsonValue };
}

/** One field of the provider's form, as the provider names and describes it. */
export interface FormIntrospectField {
  /** The provider's own field name (what the mapping sends to). */
  name: string;
  label?: string;
  /** The provider's field type, loosely: "email", "text", "select", "checkbox", "textarea", "hidden", … */
  type?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
}

export interface FormIntrospectResult {
  fields: FormIntrospectField[];
}

// ── the site kit: setting it up, and the forms list ───────────────────────

/** One step of putting the site kit into a site ("Set it up for me"). */
export interface SiteKitStep {
  id: "files" | "forms" | "scripts" | "collection" | "layout" | "visibility";
  /** What the step does, in plain words: "Add the site kit's files". */
  label: string;
  /** "done": already in place. "ready": set-up will do it. "left": set-up can't, and `detail` says why. */
  state: "done" | "ready" | "left";
  detail?: string;
  /** For a step that is left: the file and the lines a developer adds. */
  snippet?: { file: string; code: string };
}

/** `GET /api/sites/:siteId/kit` — what the site has of the site kit, and what setting it up would do. */
export interface SiteKitStatus {
  framework: { id: string; name: string };
  /** False when the kit can't go into this site (not an Astro site); `reason` says why in plain words. */
  supported: boolean;
  reason?: string;
  /** Set-up changes the site's code, which needs build mode to be allowed on the site. */
  buildAllowed: boolean;
  /** What detection found of the kit. */
  kit: import("./types").SiteKitInfo | null;
  /** The kit version set-up would add. */
  available: string | null;
  steps: SiteKitStep[];
  /** Every step is done: forms and scripts work on this site. */
  ready: boolean;
  /** A request the assistant can finish in build mode, when some step is left. */
  assistantRequest?: string;
  /** Where the live site's forms send submissions for this app's inbox (the kit's `forms.endpoint`). */
  inbox: {
    /** Some form (or the first form set-up adds) sends to the inbox without an address of its own. */
    used: boolean;
    /** The address the kit's settings name; null when none is set. */
    endpoint: string | null;
    /** Whether it can be set from here: a vendored kit's settings file (the package takes it in astro.config). */
    settable: boolean;
    /** This app's capture address, and whether visitors' browsers can reach it from the internet. */
    address: string | null;
    reachable: boolean;
  };
}

/** One form in the forms list, with everything its row shows (one request for the whole list). */
export interface FormListItem {
  /** The file name without extension. */
  id: string;
  path: string;
  title: string;
  status: import("./types").ChangeStatus;
  /** Null when the file can't be read as a form; `problem` says why. */
  definition: import("./kit").FormDefinition | null;
  problem?: string;
  /** The pages that show it. */
  pages: Array<{ path: string; title: string }>;
}

// ── form inbox (submissions sent to the Galley capture endpoint) ─────────

/** Which submissions a list shows. "inbox": everything but spam (the default). */
export type InboxFilter = "inbox" | "unread" | "spam" | "all";

export interface InboxFormSummary {
  /** The form's id: its file name without extension. */
  id: string;
  name: string;
  /** The form's file in the site, or null when the file is gone but submissions remain. */
  path: string | null;
  /** The form's definition (server-side destination settings left out), when it can be read. */
  definition: import("./kit").FormDefinition | null;
  /** Whether the form sends to the inbox (has a "galley" destination). */
  capturing: boolean;
  /** Not spam. */
  total: number;
  /** Not read, not spam. */
  unread: number;
  spam: number;
  /** Newest submission's time (ISO 8601), spam left out. */
  latestAt: string | null;
  /** Why the form can't take submissions, in plain words. */
  problem?: string;
}

export interface SubmissionList {
  items: import("./kit").FormSubmission[];
  /** How many match the filter and search. */
  total: number;
  offset: number;
  limit: number;
}

/** A site's capture settings as the app shows them. Secrets appear only as "configured". */
export interface CaptureSettings {
  /** Where the site's forms post: `<server address>/f/<siteId>`. */
  captureAddress: string;
  /** Whether visitors on the internet can reach that address. False on a computer of one's own. */
  captureReachable: boolean;
  /** One plain sentence about reachability, for wherever the inbox is offered. */
  reachability: string;
  /**
   * Why `captureReachable` is what it is, so the screens can say the true thing:
   *  public          — a hosted install on an address on the internet;
   *  this-computer   — the app runs on this computer (local mode);
   *  private-address — a hosted install whose address is a local or private
   *                    name or number (`host`: "cms.localhost", "10.0.0.5"),
   *                    which browsers on the internet can't reach.
   * `host` is the capture address's host name (null when it can't be read).
   */
  captureReach?: { kind: "public" | "this-computer" | "private-address"; host: string | null };
  origins: {
    /** From the site's production and staging addresses (with the www. twin). */
    site: string[];
    /** Listed in these settings. */
    extra: string[];
    /** Previews on this computer may post too (local mode only). */
    loopback: boolean;
  };
  /** For posts without an Origin (server to server), sent as the `X-Capture-Key` header. */
  captureKey: { enabled: boolean; hint?: string; createdAt?: string };
  /** Form id → addresses told about each new submission. */
  notify: { [formId: string]: string[] };
  mail: { configured: boolean; from?: string; problem?: string };
  turnstile: { configured: boolean; hint?: string };
  rateLimits: { perIpPerMinute: number; perFormPerMinute: number };
  /** Names of forwarding secrets (used as {{secret:name}} in server-side destinations). */
  forwardSecrets: string[];
}

export interface CaptureSettingsPatch {
  extraOrigins?: string[];
  notify?: { [formId: string]: string[] };
  rateLimits?: { perIpPerMinute?: number; perFormPerMinute?: number };
  /** null or "" removes it. */
  turnstileSecret?: string | null;
  /** name → value; null removes it. */
  forwardSecrets?: { [name: string]: string | null };
}

/** "Add many": pasted text or a file in the site, and how to settle each kind of problem. */
export interface RedirectImportBody {
  text?: string;
  /** A file in the site to read instead (the WordPress import's list, an existing `_redirects`). */
  path?: string;
  /** The uploaded file's name, which can decide the format (".htaccess", "_redirects"). */
  filename?: string;
  mode?: ImportMode;
  resolutions?: ImportResolutions;
  /** Domains the person said are this site's, so full old addresses on them are read as its own. */
  siteHosts?: string[];
}

export interface ApiRoutes {
  // ── meta & auth ────────────────────────────────────────────────────────
  "GET /api/meta": { response: MetaInfo };
  /**
   * Hosted mode: `email` says who is signing in. Without it the password is
   * tried against the one account that has no e-mail yet (an install set up
   * before accounts existed). A wrong e-mail and a wrong password get the
   * same answer.
   */
  "POST /api/auth/login": { body: { password: string; email?: string }; response: Ok };
  "POST /api/auth/logout": { response: Ok };
  /** text/event-stream of ServerEvent. Not called through the JSON client. */
  "GET /api/events": { response: never };

  // ── settings ───────────────────────────────────────────────────────────
  "GET /api/settings": { response: Settings };
  "PATCH /api/settings": { body: SettingsPatch; response: Settings };
  /** `value: null` removes a stored secret. */
  "PUT /api/secrets/:name": { body: { value: string | null }; response: SecretStatus };
  "GET /api/usage": { response: UsageSummary };

  // ── sites ──────────────────────────────────────────────────────────────
  "GET /api/sites": { response: SiteSummary[] };
  "POST /api/sites/open": { body: OpenSiteRequest; response: SiteDetail };
  "POST /api/sites/clone": { body: CloneSiteRequest; response: Job };
  "POST /api/sites/create": { body: CreateSiteRequest; response: Job };
  "GET /api/starters": { response: StarterInfo[] };
  /**
   * A starter's preview image, or one of its looks' (`look`) — only images its
   * starter.json declares. The `previewUrl`s in `GET /api/starters` point here.
   * Not called through the JSON client.
   */
  "GET /api/starters/:starterId/preview": { query: { look?: string }; response: never };
  "GET /api/jobs/:jobId": { response: Job };
  /**
   * A deep link from the site's own dev toolbar (`/open?root=&url=`): the
   * site whose folder is `root`, and the entry behind `url`. A folder that
   * isn't in the list yet comes back "unregistered" so the UI can ask first.
   */
  "GET /api/open": {
    query: { root: string; url?: string };
    response: { state: "ready"; siteId: string; entry: EntrySummary | null } | { state: "unregistered"; name: string; root: string };
  };
  /**
   * Server-side folder listing for the "open a site" picker (the browser
   * cannot see the disk). Only directories are returned.
   */
  "GET /api/fs/list": {
    query: { path?: string };
    response: {
      path: string;
      parent: string | null;
      entries: Array<{ name: string; path: string; isSite: boolean }>;
    };
  };

  "GET /api/sites/:siteId": { response: SiteDetail };
  /** Forget the site. Files stay on disk. */
  "DELETE /api/sites/:siteId": { response: Ok };
  "POST /api/sites/:siteId/refresh": { response: SiteModel };
  /** `detected` is the model before the config file is applied. */
  "GET /api/sites/:siteId/config": { response: { config: GalleyConfig | null; detected: SiteModel } };
  "PUT /api/sites/:siteId/config": { body: { config: GalleyConfig }; response: SiteModel };

  // ── content ────────────────────────────────────────────────────────────
  "GET /api/sites/:siteId/entries": {
    query: { collection: string } & { [K in keyof EntryQuery]?: EntryQuery[K] };
    response: EntryList;
  };
  "GET /api/sites/:siteId/entry": { query: { path: string }; response: Entry };
  "PATCH /api/sites/:siteId/entry": {
    query: { path: string };
    body: { ops: EditOp[]; baseHash?: string };
    response: EditResult;
  };
  "POST /api/sites/:siteId/entries": { body: CreateEntryInput; response: Entry };
  "DELETE /api/sites/:siteId/entry": { query: { path: string }; response: Ok };
  "GET /api/sites/:siteId/search": {
    query: { q: string; collection?: string; limit?: number };
    response: SearchHit[];
  };
  "POST /api/sites/:siteId/resolve": { body: ResolveRequest; response: ResolveResult };
  "GET /api/sites/:siteId/route": {
    query: { url: string };
    response: { entry: EntrySummary | null };
  };
  "POST /api/sites/:siteId/validate": {
    body: { paths?: string[] };
    response: { issues: ValidationIssue[] };
  };

  // ── forms ──────────────────────────────────────────────────────────────
  /**
   * Read the field list of an existing form on a provider's side (HubSpot,
   * Marketo — those whose catalogue entry says `canImportFields`), so the
   * form builder can add matching fields and their mapping in one go.
   * `settings` are the destination's own settings. 400 when the provider
   * can't be asked, 404 while the server doesn't offer it.
   */
  "POST /api/sites/:siteId/forms/introspect": {
    body: FormIntrospectRequest;
    response: FormIntrospectResult;
  };
  /** Every form of the site with what the forms list shows: definition, status, the pages that use it. */
  "GET /api/sites/:siteId/forms": { response: { forms: FormListItem[] } };
  /** What the site has of the site kit, and what "Set it up for me" would do. */
  "GET /api/sites/:siteId/kit": { response: SiteKitStatus };
  /**
   * "Set it up for me": starts a job (kind "kit-setup") that adds the kit and
   * wires what is unambiguous, as pending changes. Its progress arrives as
   * `job` events; GET …/kit says what is left when it ends.
   */
  "POST /api/sites/:siteId/kit/setup": { response: import("./types").Job };
  /**
   * Only the step that publishes the version AI assistants can read: the
   * kit's build step in astro.config and src/data/visibility.json (updating
   * the kit's files when they predate it). A job, like set-up.
   */
  "POST /api/sites/:siteId/kit/visibility": { response: import("./types").Job };
  /**
   * Points the live site's forms at this app's inbox: writes the capture
   * address into the kit's settings as a pending change. Refused (400) when
   * visitors' browsers can't reach this app — a loopback address is never
   * written into a file that will be published.
   */
  "POST /api/sites/:siteId/kit/endpoint": { response: SiteKitStatus };

  // ── form inbox ─────────────────────────────────────────────────────────
  /** Forms with their counts; `unread` is the total for the sidebar badge. */
  "GET /api/sites/:siteId/inbox": { response: { forms: InboxFormSummary[]; unread: number } };
  /** One form's submissions, newest first. `q` searches every answer. */
  "GET /api/sites/:siteId/inbox/:formId": {
    query: { filter?: InboxFilter; q?: string; offset?: number; limit?: number };
    response: SubmissionList;
  };
  /**
   * The submissions as a CSV file (UTF-8 with BOM, the form's field order,
   * labels as headers). Not called through the JSON client.
   */
  "GET /api/sites/:siteId/inbox/:formId/export": { query: { filter?: InboxFilter }; response: never };
  "GET /api/sites/:siteId/inbox/:formId/:submissionId": { response: import("./kit").FormSubmission };
  /** Mark read/unread and spam/not spam. */
  "PATCH /api/sites/:siteId/inbox/:formId": {
    body: { ids: string[]; read?: boolean; spam?: boolean };
    response: { items: import("./kit").FormSubmission[] };
  };
  /** Delete for good; the removed submissions come back so Undo can restore them. */
  "POST /api/sites/:siteId/inbox/:formId/delete": {
    body: { ids: string[] };
    response: { deleted: import("./kit").FormSubmission[] };
  };
  /** Undo a delete. */
  "POST /api/sites/:siteId/inbox/:formId/restore": {
    body: { submissions: import("./kit").FormSubmission[] };
    response: { restored: number };
  };
  /** Send again to one server-side destination (its index), or the e-mail notification. */
  "POST /api/sites/:siteId/inbox/:formId/:submissionId/retry": {
    body: { destination: number | "email" };
    response: import("./kit").FormSubmission;
  };
  "GET /api/sites/:siteId/capture": { response: CaptureSettings };
  "PATCH /api/sites/:siteId/capture": { body: CaptureSettingsPatch; response: CaptureSettings };
  /** Make a new capture key (shown once, in `key`) or remove it. */
  "POST /api/sites/:siteId/capture/key": {
    body: { action: "rotate" | "remove" };
    response: { settings: CaptureSettings; key: string | null };
  };

  // ── files (source view) ────────────────────────────────────────────────
  "GET /api/sites/:siteId/files": {
    query: { glob?: string; limit?: number };
    response: { files: string[] };
  };
  "GET /api/sites/:siteId/file": {
    query: { path: string };
    response: { path: string; content: string; hash: string; binary: boolean };
  };
  "PUT /api/sites/:siteId/file": {
    query: { path: string };
    body: { content: string; baseHash?: string; mode?: AgentMode };
    response: Ok;
  };

  // ── media ──────────────────────────────────────────────────────────────
  /** The library: the repository's files, then any kept in the site's bucket or Cloudflare Images (`location`). */
  "GET /api/sites/:siteId/media": { response: MediaLibraryAnswer };
  /** `data` is a data: URL. */
  "POST /api/sites/:siteId/media": {
    body: { filename: string; directory?: string; data: string };
    response: MediaItem;
  };
  "DELETE /api/sites/:siteId/media": { query: { path: string }; response: Ok };

  // ── media storage: a bucket, and pictures in Cloudflare Images ─────────
  /** The kinds of bucket a site can keep its media in, with the steps on the provider's side. */
  "GET /api/media-storage/connectors": { response: { connectors: MediaStoreInfo[] } };
  /** Where the site keeps new media, whether its keys are set (never the keys), and how many files are where. */
  "GET /api/sites/:siteId/media/storage": { response: MediaStorageStatus };
  /** Run the check — on the body's settings (nothing is saved), or on the saved ones. Stores and removes a tiny test picture. */
  "POST /api/sites/:siteId/media/storage/check": { body: Partial<MediaConnectRequest>; response: MediaCheckResult };
  /** Check, and only when that passes save the settings (galley.config.json `media.storage`) and any pasted keys. */
  "PUT /api/sites/:siteId/media/storage": { body: MediaConnectRequest; response: MediaConnectResult };
  /** Stop putting new media in the bucket. Files there stay, and pages using them keep working. `forgetKeys`: remove its keys too. */
  "DELETE /api/sites/:siteId/media/storage": { query: { forgetKeys?: boolean }; response: MediaStorageStatus };
  /** Where an address is used: pages of the working copy (with titles) and files of the published version. */
  "GET /api/sites/:siteId/media/usage": { query: { url: string }; response: MediaUsage };
  /**
   * Delete files from the bucket or Cloudflare Images, for good (it can't be
   * discarded). Anything a page uses — in the working copy or the published
   * version — is refused, with where.
   */
  "POST /api/sites/:siteId/media/storage/delete": { body: { paths: string[] }; response: MediaStoreDeleteResult };
  /**
   * Raw bytes of a repo file from the working tree (`rev` absent) or the base
   * commit (`rev=base`). Used for thumbnails and before/after image diffs.
   * Not called through the JSON client.
   */
  "GET /api/sites/:siteId/raw": { query: { path: string; rev?: "base" }; response: never };

  // ── image generation ───────────────────────────────────────────────────
  "GET /api/images/providers": { response: { providers: ImageProviderInfo[] } };
  "POST /api/sites/:siteId/images/generate": {
    body: ImageGenRequest;
    response: { candidates: ImageCandidate[] };
  };
  /** Raw bytes of a held candidate. Not called through the JSON client. */
  "GET /api/images/candidates/:candidateId": { response: never };
  "POST /api/sites/:siteId/images/save": { body: ImageSaveRequest; response: MediaItem };
  "DELETE /api/images/candidates/:candidateId": { response: Ok };

  // ── video generation ───────────────────────────────────────────────────
  "GET /api/videos/providers": { response: { providers: VideoProviderInfo[] } };
  /** Starts a generation; progress arrives as `job` events, the result from GET /api/videos/jobs/:jobId. */
  "POST /api/sites/:siteId/videos/generate": { body: VideoGenRequest; response: Job };
  "GET /api/videos/jobs/:jobId": { response: VideoJobStatus };
  /** Raw bytes of a held candidate. Not called through the JSON client. */
  "GET /api/videos/candidates/:candidateId": { response: never };
  "POST /api/sites/:siteId/videos/save": { body: VideoSaveRequest; response: MediaItem };
  "DELETE /api/videos/candidates/:candidateId": { response: Ok };

  // ── plugins ────────────────────────────────────────────────────────────
  /** Built-in and installed plugins, with what each adds, its problems and its settings (secrets as status only). */
  "GET /api/plugins": { response: PluginList };
  /** The same, plus the plugins this site's configuration names. */
  "GET /api/sites/:siteId/plugins": { response: PluginList };
  /** Turn a plugin on or off (kept across restarts). The built-ins can't be turned off. */
  "POST /api/plugins/enabled": { body: { name: string; enabled: boolean; siteId?: string }; response: PluginInfo };
  /** Save some of a plugin's settings; `null` removes a value. Secrets are stored, never returned. */
  "PUT /api/plugins/settings": { body: { name: string; values: { [key: string]: string | null }; siteId?: string }; response: PluginInfo };
  /** Every catalogue, merged from the enabled plugins. */
  "GET /api/catalog": { response: PluginCatalog };
  /** The same, with this site's own plugins included. */
  "GET /api/sites/:siteId/catalog": { response: PluginCatalog };
  /**
   * A plugin's data source, for a field's picker: search it (`q`, up to
   * `limit` — default 12, at most 50) or look up the value a file holds
   * (`value`). Read-only; answers within 15 seconds. 404 when no enabled
   * plugin offers that source for this site.
   */
  "GET /api/sites/:siteId/data-sources/:sourceId": { query: { q?: string; value?: string; limit?: number }; response: DataSourceAnswer };

  // ── proof & publish ────────────────────────────────────────────────────
  "GET /api/sites/:siteId/changes": { response: ChangeSet };
  "GET /api/sites/:siteId/diff": { query: { path: string }; response: FileDiff };
  /** Absent `paths` discards everything pending. */
  "POST /api/sites/:siteId/discard": { body: { paths?: string[] }; response: ChangeSet };
  "POST /api/sites/:siteId/publish": { body: PublishRequest; response: PublishResult };
  "GET /api/sites/:siteId/history": { query: { limit?: number }; response: { items: HistoryEntry[] } };
  "POST /api/sites/:siteId/revert": { body: { commit: string }; response: PublishResult };
  /** Send versions published on this computer that have not reached the remote yet. */
  "POST /api/sites/:siteId/send": { response: PublishResult };
  "GET /api/sites/:siteId/git": { response: GitStatus };
  "POST /api/sites/:siteId/pull": { response: GitStatus };
  /** Asks the assistant for a one-line commit message describing the pending changes. */
  "POST /api/sites/:siteId/publish/message": {
    body: { paths?: string[] };
    response: { message: string };
  };
  /**
   * What the plugins' publish checks say about publishing these changes (all
   * pending when `paths` is absent): warnings to show first, and whether one
   * would stop the publish. Changes nothing.
   */
  "POST /api/sites/:siteId/publish/check": {
    body: { paths?: string[] };
    response: PublishCheck;
  };

  // ── preview & build ────────────────────────────────────────────────────
  "GET /api/sites/:siteId/preview": { response: PreviewStatus };
  "POST /api/sites/:siteId/preview/start": { response: PreviewStatus };
  "POST /api/sites/:siteId/preview/stop": { response: PreviewStatus };
  "POST /api/sites/:siteId/preview/restart": { response: PreviewStatus };
  "POST /api/sites/:siteId/build": { response: BuildResult };

  // ── putting the site online ────────────────────────────────────────────
  /** The hosts a site can be put online with, what setting each up needs, and whether its access key is present. */
  "GET /api/deploy/targets": { response: { targets: DeployTargetInfo[] } };
  /**
   * Check an access key works; the accounts (Cloudflare) or teams (Vercel) it
   * can use. With `key`, that key is checked with the host first and stored
   * only if accepted; without, the stored key is checked.
   */
  "POST /api/deploy/targets/:targetId/connect": { body: { key?: string }; response: { accounts: DeployAccount[] } };
  /** Whether a project name can be used in that account. Creates nothing. */
  "POST /api/sites/:siteId/deploy/check": {
    body: { target: DeployTargetId; account: string; project: string };
    response: DeployProjectCheck;
  };
  /** The site's deploy settings, latest deployments, the running (or last) deploy job, and how far behind the live site is. */
  "GET /api/sites/:siteId/deploy": { response: DeployStatus };
  /** Change the site's deploy settings (galley.config.json `deploy`). */
  "PUT /api/sites/:siteId/deploy": { body: Partial<DeployConfig>; response: DeployStatus };
  /** Use the live address as the site's `urls.production` (what Proof compares against). */
  "POST /api/sites/:siteId/deploy/live-address": { response: DeployStatus };
  /**
   * Start a deploy: "production" puts the published version live; "preview"
   * puts the working tree, pending changes included, at an address of its own.
   * A `Job` (kind "deploy"); progress arrives as `job` events.
   */
  "POST /api/sites/:siteId/deploy": { body: { kind: DeployKind; label?: string }; response: Job };
  /** Deployments made from this computer, newest first. */
  "GET /api/sites/:siteId/deployments": { query: { limit?: number }; response: { items: Deployment[] } };
  /** What using this address as the site's own would do. Read-only: nothing changes on the host. */
  "POST /api/sites/:siteId/deploy/domain/plan": { body: { hostname: string }; response: DomainPlan };
  /** Use the address (after the person said yes to the plan): attach it and wait until it answers over HTTPS. A `Job` of kind "domain". */
  "POST /api/sites/:siteId/deploy/domain": { body: { hostname: string }; response: Job };
  /** Look again at an address that isn't answering yet. A `Job` of kind "domain". */
  "POST /api/sites/:siteId/deploy/domain/check": { response: Job };
  /** Stop using the site's own address: detached only if Galley attached it; the host's address becomes the live one again. */
  "DELETE /api/sites/:siteId/deploy/domain": { response: DeployStatus };

  // ── redirects ──────────────────────────────────────────────────────────
  /** The list, its checks, where it takes effect (the host and its file), what can be imported, and the Cloudflare state. */
  "GET /api/sites/:siteId/redirects": { response: RedirectsOverview };
  /** Replace the list (inline edits, add one, delete, Undo). `baseHash`: the overview's `hash` (null when the file doesn't exist yet). */
  "PUT /api/sites/:siteId/redirects": { body: { redirects: Redirect[]; baseHash?: string | null }; response: RedirectsOverview };
  /** "Add many": what a pasted list (or a file in the site, `path`) would do. Writes nothing. */
  "POST /api/sites/:siteId/redirects/review": { body: RedirectImportBody; response: ImportReview };
  /** Add what `review` showed, as one pending change. Refused while a loop blocks it. */
  "POST /api/sites/:siteId/redirects/import": { body: RedirectImportBody & { baseHash?: string | null }; response: { overview: RedirectsOverview; review: ImportReview } };
  /** "Try an address": where a visitor ends up, through which rules. */
  "POST /api/sites/:siteId/redirects/try": { body: { address: string }; response: RedirectTrace };
  /** Choose the host (when the deploy settings don't say), the Cloudflare account and the site's own domains. */
  "PUT /api/sites/:siteId/redirects/settings": {
    body: { host?: RedirectHostId | null; cloudflare?: { account?: string | null; hostnames?: string[] | null } };
    response: RedirectsOverview;
  };
  /** The person said to replace a host file that was edited by hand (or was the site's own). */
  "POST /api/sites/:siteId/redirects/derived/replace": { response: RedirectsOverview };
  /** Remove a redirect file this app wrote for a host the site no longer uses. */
  "POST /api/sites/:siteId/redirects/leftover/remove": { body: { path: string }; response: RedirectsOverview };
  /** The list in a host's format, as a download. Not called through the JSON client. */
  "GET /api/sites/:siteId/redirects/export": { query: { format: RedirectExportFormat; hostname?: string }; response: never };
  /** Redirects that lead nowhere now, and old addresses the site's own pages still link to. */
  "GET /api/sites/:siteId/redirects/health": { response: RedirectHealth };
  /** What setting them on Cloudflare would add, change and remove. Changes nothing. */
  "POST /api/sites/:siteId/redirects/cloudflare/plan": { response: CloudflarePlan };
  /** Apply a plan (refused when anything moved since). A `Job` (kind "redirects"); progress arrives as `job` events. */
  "POST /api/sites/:siteId/redirects/cloudflare/apply": { body: { planId: string }; response: Job };
  /** "Check Cloudflare matches". */
  "POST /api/sites/:siteId/redirects/cloudflare/check": { response: CloudflareCheck };
  /** Take this app's list and rule off Cloudflare (nothing else there is touched). */
  "POST /api/sites/:siteId/redirects/cloudflare/remove": { response: RedirectsOverview };

  // ── assistant ──────────────────────────────────────────────────────────
  "GET /api/sites/:siteId/threads": { response: { threads: ChatThreadSummary[] } };
  "POST /api/sites/:siteId/threads": {
    body: { title?: string; mode?: AgentMode };
    response: ChatThread;
  };
  "GET /api/sites/:siteId/threads/:threadId": { response: ChatThread };
  "PATCH /api/sites/:siteId/threads/:threadId": { body: { title: string }; response: ChatThreadSummary };
  "DELETE /api/sites/:siteId/threads/:threadId": { response: Ok };
  /** Starts a turn; the reply streams over /api/events. */
  "POST /api/sites/:siteId/threads/:threadId/messages": {
    body: SendMessageRequest;
    response: { turnId: string };
  };
  "POST /api/sites/:siteId/threads/:threadId/cancel": { response: Ok };
  "POST /api/sites/:siteId/threads/:threadId/undo": {
    body: { turnId: string };
    response: { restored: string[] };
  };

  // ── multi-site ─────────────────────────────────────────────────────────
  // None of these opens a site: they work from the list in the Galley home.
  /** Groups (clients) in the order the person arranged them. */
  "GET /api/groups": { response: SiteGroup[] };
  "POST /api/groups": { body: SiteGroupInput; response: SiteGroup };
  "PATCH /api/groups/:groupId": { body: SiteGroupInput; response: SiteGroup };
  /** Its sites stay in the list, ungrouped. */
  "DELETE /api/groups/:groupId": { response: Ok };
  /** `ids`: every group's id, in the new order. */
  "PUT /api/groups/order": { body: { ids: string[] }; response: SiteGroup[] };
  /** File a site: group, pin, note. */
  "PATCH /api/sites/:siteId/listing": { body: SitePatch; response: SiteSummary };
  /** Look for sites inside a folder (one or two levels down). Never opens or detects any of them in depth. */
  "POST /api/sites/scan": { body: ScanSitesRequest; response: ScanSitesResult };
  /** Stop a scan started with that `id`. */
  "POST /api/sites/scan/cancel": { body: { id: string }; response: Ok };
  /** Add several folders at once, each checked as POST /api/sites/open checks one. None is opened. */
  "POST /api/sites/add": { body: AddSitesRequest; response: AddSitesResult };
  /** The site's own share image, for the list. Not called through the JSON client. */
  "GET /api/sites/:siteId/thumbnail": { query: { v?: string }; response: never };
  /** An editor is open on the site: its preview isn't stopped as unused. Sent every 30 s while one is. */
  "POST /api/sites/:siteId/presence": { response: Ok };
  /** Which key and author each connection uses for this site. Status and last four characters only, never a key. */
  "GET /api/sites/:siteId/connections": { response: SiteConnections };
  /** This site's own key; `value: null` removes it (the shared key is used again). */
  "PUT /api/sites/:siteId/secrets/:name": { body: { value: string | null }; response: SiteConnections };
  /** This site's own publishing author; `null` removes it. */
  "PUT /api/sites/:siteId/author": { body: { author: { name: string; email: string } | null }; response: SiteConnections };
  /** This site's assistant use. */
  "GET /api/sites/:siteId/usage": { response: UsageSummary };
  /** Every site's assistant use: the last 30 days and in all. */
  "GET /api/usage/sites": { response: { sites: SiteUsageTotals[] } };

  // ── search & AI visibility ─────────────────────────────────────────────
  /** The audit. `render: "off"` checks the content files only; the default uses a running preview or an existing build, never starting either. */
  "GET /api/sites/:siteId/visibility": {
    query: { render?: "auto" | "off" };
    response: import("./seo/types").SiteAudit;
  };
  /** One entry: its result preview (an approximation) and findings, judged against the whole site. */
  "GET /api/sites/:siteId/visibility/entry": {
    query: { path: string; render?: "auto" | "off" };
    response: import("./seo/types").EntryAudit;
  };
  /** Apply the deterministic fixes of these findings (ids from the last audit) as ordinary edits. */
  "POST /api/sites/:siteId/visibility/fix": {
    body: { ids: string[] };
    response: import("./seo/types").FixResult;
  };
  /** Put back every file one batch of fixes changed. */
  "POST /api/sites/:siteId/visibility/undo": {
    body: { undoId: string };
    response: { restored: string[] };
  };
  "GET /api/sites/:siteId/visibility/crawlers": { response: import("./seo/types").CrawlerReport };
  /** Allow or block documented AI crawlers by robots.txt token; only a marked block of robots.txt changes. */
  "PUT /api/sites/:siteId/visibility/crawlers": {
    body: { choices: { [token: string]: import("./seo/types").CrawlerChoice } };
    response: import("./seo/types").CrawlerReport;
  };
  /** What an AI agent receives for one page: its markdown version, else its text with scripts off. */
  "GET /api/sites/:siteId/visibility/agent-view": {
    query: { url: string };
    response: import("./seo/types").AgentView;
  };
  /** What an assistant-written batch would do: the pages, and one model request per page. */
  "POST /api/sites/:siteId/visibility/write/plan": {
    body: { kind: import("./seo/types").WriteKind; paths?: string[] };
    response: import("./seo/types").WritePlan;
  };
  /** Start the batch as a job; results land in Proof. `unconfigured` without an assistant key. */
  "POST /api/sites/:siteId/visibility/write": {
    body: { kind: import("./seo/types").WriteKind; paths?: string[]; limit?: number };
    response: import("./seo/types").WriteBatchStatus;
  };
  "GET /api/sites/:siteId/visibility/write/:jobId": { response: import("./seo/types").WriteBatchStatus };
  "POST /api/sites/:siteId/visibility/write/:jobId/cancel": { response: Ok };
  /** Optional, off by default: requests to other sites, a few at a time, capped. */
  "POST /api/sites/:siteId/visibility/external-links": {
    body: { limit?: number };
    response: { checked: number; total: number; findings: import("./seo/types").Finding[] };
  };

  // ── bringing a site over: the WordPress import (docs/wordpress-import.md) ──
  /**
   * Upload an export file, one chunk at a time (base64, at most 8 MB each, 200 MB in all). The first
   * chunk must be a WordPress export. Kept in the site's state folder, never in the site. The last
   * chunk returns the upload.
   */
  "POST /api/sites/:siteId/import/upload": {
    body: { uploadId?: string; name: string; total: number; offset: number; chunk: string };
    response: { uploadId: string; received: number; upload: import("./types").ImportUpload | null };
  };
  /** The quick look: is it WordPress, can its content be read, how much is there. Problems are answers, not errors. */
  "POST /api/sites/:siteId/import/inspect": { body: { source: import("./types").ImportSource }; response: import("./types").ImportInspection };
  /** What would come across and what wouldn't, with the questions that need a person (answered with their defaults until answered). Writes nothing. */
  "POST /api/sites/:siteId/import/plan": {
    body: { source: import("./types").ImportSource; answers?: { [questionId: string]: string } };
    response: import("./types").ImportPlanView;
  };
  /** Start bringing it over: a `Job` (kind "import"). Everything lands as pending changes. */
  "POST /api/sites/:siteId/import/run": {
    body: { source: import("./types").ImportSource; answers?: { [questionId: string]: string } };
    response: import("./types").ImportRunStatus;
  };
  "GET /api/sites/:siteId/import/runs/:runId": { response: import("./types").ImportRunStatus };
  /** Stop part-way: what already arrived is kept as pending changes. */
  "POST /api/sites/:siteId/import/runs/:runId/cancel": { response: import("./types").ImportRunStatus };
  /** The last import's report for this site, or null. */
  "GET /api/sites/:siteId/import/report": { response: { report: import("./types").ImportReportView | null } };
  /** Open the assistant (build mode) on one page-builder page, with its prepared rebuild brief. */
  "POST /api/sites/:siteId/import/rebuild": { body: { path: string }; response: { threadId: string; turnId: string } };
  /** What "Rebuild all" would do, and its estimated cost. Starts nothing. */
  "GET /api/sites/:siteId/import/rebuild-all": { response: import("./types").ImportRebuildPlan };
  /** Rebuild the pages one after another, each its own conversation; a `Job` (kind "import"). */
  "POST /api/sites/:siteId/import/rebuild-all": { body: { paths?: string[] }; response: import("./types").ImportRebuildStatus };
  "GET /api/sites/:siteId/import/rebuild-all/:jobId": { response: import("./types").ImportRebuildStatus };
  "POST /api/sites/:siteId/import/rebuild-all/:jobId/cancel": { response: import("./types").ImportRebuildStatus };

  // ── the site's brand (docs/brand.md) ───────────────────────────────────
  // The SITE's look and voice in galley/brand — not the app's white-label brand (`MetaInfo.brand`).
  /** The saved brand, the material, the proposal under review, the analysis in progress, and what the assistant receives. */
  "GET /api/sites/:siteId/brand": { response: import("./sitebrand/types").SiteBrandState };
  /**
   * Read the brand: from the site (`measurements` are the overlay's `measure` answers for a few pages)
   * or from the added material. With `sources`, only those are read and added to the current proposal.
   * A `Job` (kind "brand"); steps arrive as `job` events and in GET …/brand.
   */
  "POST /api/sites/:siteId/brand/analyse": { body: { from: "site" | "material"; measurements?: import("./sitebrand/types").MeasureSummary[]; sources?: string[] }; response: Job };
  "POST /api/sites/:siteId/brand/cancel": { response: Ok };
  /** Add material, one chunk at a time (base64, at most 8 MB each). The last chunk returns the source. `preview`: a PNG of a JPG/WebP/GIF made by the browser. */
  "POST /api/sites/:siteId/brand/sources": {
    body: { uploadId?: string; name: string; note?: string; total: number; offset: number; chunk: string; preview?: string };
    response: { uploadId: string; received: number; source: import("./sitebrand/types").BrandSource | null };
  };
  /** Read a website's address as material (public https addresses only). */
  "POST /api/sites/:siteId/brand/website": { body: { url: string }; response: import("./sitebrand/types").BrandSource };
  "PATCH /api/sites/:siteId/brand/sources/:sourceId": { body: { note?: string | null; ignored?: boolean }; response: import("./sitebrand/types").BrandSource };
  "DELETE /api/sites/:siteId/brand/sources/:sourceId": { response: Ok };
  /** The file (`kind=original`) or the picture the model saw (`kind=picture`). Served under a no-script policy. Not called through the JSON client. */
  "GET /api/sites/:siteId/brand/sources/:sourceId/file": { query: { kind?: "original" | "picture" }; response: never };
  /** Change the proposal (an edited brand) and answer its questions (question id → option value). */
  "PUT /api/sites/:siteId/brand/proposal": { body: { brand?: unknown; answers?: { [questionId: string]: string } }; response: import("./sitebrand/types").BrandProposal };
  "DELETE /api/sites/:siteId/brand/proposal": { response: Ok };
  /** A change asked for in words; contrast is measured again afterwards. */
  "POST /api/sites/:siteId/brand/ask": { body: { text: string }; response: { proposal: import("./sitebrand/types").BrandProposal; reply: string } };
  /** Save the proposal as the brand's files: pending changes, shown in Proof. */
  "POST /api/sites/:siteId/brand/save": { response: { paths: string[] } };
  /** What "Apply to the site" would change in the tokens file. Changes nothing. */
  "GET /api/sites/:siteId/brand/apply": { response: import("./sitebrand/types").ApplyPlan };
  "POST /api/sites/:siteId/brand/apply": { response: { plan: import("./sitebrand/types").ApplyPlan; paths: string[] } };
  /** The pending changes against the brand: suggestions, never a block. */
  "POST /api/sites/:siteId/brand/check": { body: { paths?: string[] }; response: { items: import("./sitebrand/types").BrandCheckItem[] } };
  /** The site re-measured against the brand. */
  "POST /api/sites/:siteId/brand/drift": { body: { measurements: import("./sitebrand/types").MeasureSummary[] }; response: import("./sitebrand/types").DriftReport };
  /** Download: `format=brand` (the bundle) or `format=tokens` (W3C design tokens). Not called through the JSON client. */
  "GET /api/sites/:siteId/brand/export": { query: { format?: "brand" | "tokens" }; response: never };
  /** A bundle exported from another site, as a proposal to review. */
  "POST /api/sites/:siteId/brand/import": { body: { bundle: unknown }; response: import("./sitebrand/types").BrandProposal };
  /** One of the site's own web fonts, for the specimen. Not called through the JSON client. */
  "GET /api/sites/:siteId/brand/fonts/:fontId": { response: never };

  /**
   * The addresses to load the two preview frames from, right now. Locally
   * they are the preview's own; on a hosted install each carries a one-use
   * ticket that lets this browser (and nobody else) see the preview.
   */
  "POST /api/sites/:siteId/preview/entry": { response: { preview: string | null; baseline: string | null } };

  // ── the hosted install: first run (install/types.ts) ───────────────────
  // Hosted mode only; in local mode every one of these answers 404.
  // Until an owner exists they accept the one-time setup code as
  // `Authorization: Bearer`; afterwards only an owner's session.
  "GET /api/setup": { response: SetupStatus };
  /**
   * Create the owner: their name, e-mail and password. Uses up the setup link
   * and signs this browser in. (`name` and `email` are optional only so an
   * older setup page keeps working: without them the owner is `incomplete`
   * and the app asks for them after signing in.)
   */
  "POST /api/setup/password": { body: { password: string; name?: string; email?: string }; response: SetupStatus };
  /** The install's own deploy key: made on first use, replaced with `rotate`. Only ever the public half. */
  "POST /api/setup/deploy-key": { body: { rotate?: boolean }; response: DeployKeyInfo };
  /** Whether the repository can be reached and written to. Changes nothing. */
  "POST /api/setup/site/check": { body: SiteConnectRequest; response: SiteAccessCheck };
  /** Connect the install's one site: copy the repository, or send a starter to an empty one. A second site is refused. */
  "POST /api/setup/site": { body: SiteConnectRequest; response: Job };
  "PUT /api/setup/details": { body: { author?: { name: string; email: string }; liveUrl?: string | null }; response: SetupStatus };
  /** Everything at once, from the app that created the install (the unattended half of first run). */
  "POST /api/setup/handover": { body: SetupHandover; response: SetupStatus };
  "POST /api/setup/finish": { response: SetupStatus };

  // ── the hosted install: the Install page ───────────────────────────────
  "GET /api/install": { response: InstallInfo };
  /** The older name for `POST /api/account/password`: change your own password. */
  "POST /api/install/password": { body: { current: string; next: string }; response: Ok };
  /** Sign yourself out everywhere, this browser included. Other people stay signed in. */
  "POST /api/auth/logout-all": { response: Ok };
  /**
   * Download a backup of the install's state, sealed with the passphrase
   * (application/octet-stream). Not called through the JSON client.
   */
  "POST /api/install/backup": { body: { passphrase: string }; response: never };
  /** Upload a backup file as the raw request body (application/octet-stream). Also accepted with the setup code, to start an install from a backup. */
  "POST /api/install/restore/upload": { response: RestoreUpload };
  /** Put an uploaded backup back in place of the install's current state. */
  "POST /api/install/restore": { body: { upload: string; passphrase: string }; response: Job };

  // ── the hosted install: people (install/accounts.ts) ───────────────────
  // Hosted mode only; in local mode every one of these answers 404.
  // Who may call what is install/route-access.ts.
  /** The signed-in person. */
  "GET /api/account": { response: AccountSession };
  /**
   * Change your own name or e-mail. Publishes from now on carry them.
   * Changing the e-mail needs `password` (your current one): the e-mail is
   * what a new-password link is sent to.
   */
  "PATCH /api/account": { body: { name?: string; email?: string; password?: string }; response: AccountSession };
  // `email` above: an owner may change their own (with `password`), and so may an
  // account that has none yet. Everyone else's e-mail is changed by an owner, in People.
  /** Change your own password. Your other browsers are signed out; this one stays. */
  "POST /api/account/password": { body: { current: string; next: string }; response: Ok };
  "GET /api/people": { response: People };
  /**
   * Invite someone. The link is told once, here; it is also e-mailed when the
   * server e-mails links (outgoing e-mail and its public address both set).
   * A link is only ever built from that public address. Inviting an e-mail that already has an
   * account, or an open invitation, is refused.
   */
  "POST /api/people/invitations": { body: { email: string; role: AccountRole }; response: { invitation: Invitation; link: OneTimeLink } };
  /** Take an invitation back: its link stops working. */
  "DELETE /api/people/invitations/:invitationId": { response: Ok };
  /**
   * Change someone's role or e-mail, or switch their account off or on.
   * Switching off signs them out at once. The last owner can't be demoted
   * or switched off.
   */
  "PATCH /api/people/:accountId": { body: { role?: AccountRole; disabled?: boolean; email?: string }; response: Account };
  /** Remove an account. What they published keeps their name. The last owner can't be removed, and nobody removes themselves. */
  "DELETE /api/people/:accountId": { response: Ok };
  /** A link for someone to choose a new password (they forgot it). When the server e-mails links it goes to that person and `url` is null here; otherwise it is told once, here. Their old password works until they use it. */
  "POST /api/people/:accountId/password-link": { response: OneTimeLink };
  /** Sign one person out of every browser. */
  "POST /api/people/:accountId/sign-out": { response: Ok };
  /** Sign everyone out, this browser included. */
  "POST /api/people/sign-out": { response: Ok };
  // The three below need no sign-in: the link's code is the proof. The code
  // travels in the request body, never in an address (addresses are logged).
  /** What a one-time link is for. A used, expired or unknown code gets one and the same refusal. */
  "POST /api/auth/link/check": { body: { code: string }; response: LinkPreview };
  /**
   * Use a one-time link: an invitation creates the account (`name` required),
   * a new-password link sets the password and signs that person's other
   * browsers out. Either way this browser is signed in and the link is spent.
   */
  "POST /api/auth/link": { body: { code: string; password: string; name?: string }; response: Ok };
  /**
   * "I forgot my password." When the server e-mails links (outgoing e-mail
   * and its public address both set) and the address has an account, a
   * new-password link is e-mailed. The answer is the same whether or not
   * anything was sent, so it can't be used to find out who has an account.
   * When the server doesn't e-mail links: `emailAvailable: false`, and the
   * page tells the person to ask an owner for a link.
   */
  "POST /api/auth/forgot": { body: { email: string }; response: { ok: true; emailAvailable: boolean } };

  // ── "Host the editor online" (hosting/types.ts) ────────────────────────
  // Local mode only: a hosted install never creates other installs.
  "GET /api/editor-hosts": { response: { hosts: EditorHostInfo[]; absent: EditorHostAbsent[] } };
  /** With `key`: check it with the host and store it only when accepted. Then: what the key can do. Creates nothing. */
  "POST /api/editor-hosts/:hostId/connect": { body: { key?: string; secret?: SecretName }; response: EditorHostAccount };
  "GET /api/sites/:siteId/editor": { response: HostedEditorStatus };
  /** Everything that would be created, what it costs and what the install is handed. Creates nothing. */
  "POST /api/sites/:siteId/editor/plan": { body: HostedEditorRequest; response: HostedEditorPlan };
  /** Create the install a plan described. `confirm` must be true: nothing is created without the person's yes. */
  "POST /api/sites/:siteId/editor": { body: { plan: string; confirm: true }; response: Job };
  /** The first-run link of an install whose setup isn't finished. One use; told to this computer only. */
  "POST /api/sites/:siteId/editor/setup-link": { response: { url: string } };
  /** own-server: the person says the files are running; check the address, hand the site over. */
  "POST /api/sites/:siteId/editor/check": { response: HostedEditorStatus };
  "POST /api/sites/:siteId/editor/upgrade": { response: Job };
  "POST /api/sites/:siteId/editor/backup": { response: HostedEditorBackup };
  /** What removing would delete. Deletes nothing. */
  "GET /api/sites/:siteId/editor/removal": { response: HostedEditorRemoval };
  "DELETE /api/sites/:siteId/editor": { body: { confirm: true }; response: Job };
}

export type ApiRouteKey = keyof ApiRoutes;

/** Path params named in a route key: "GET /api/sites/:siteId/x" → { siteId: string }. */
export type RouteParams<K extends string> = K extends `${string}:${infer Param}/${infer Rest}`
  ? { [P in Param]: string } & RouteParams<`/${Rest}`>
  : K extends `${string}:${infer Param}`
    ? { [P in Param]: string }
    : Record<never, never>;

export type RouteQuery<K extends ApiRouteKey> = ApiRoutes[K] extends { query: infer Q } ? Q : undefined;
export type RouteBody<K extends ApiRouteKey> = ApiRoutes[K] extends { body: infer B } ? B : undefined;
export type RouteResponse<K extends ApiRouteKey> = ApiRoutes[K]["response"];

/** Paths the preview proxies reserve on the previewed site's origin. */
export const OVERLAY_SCRIPT_PATH = "/__galley/overlay.js";
export const PROXY_HEALTH_PATH = "/__galley/health";

/** Secret names accepted by PUT /api/secrets/:name. */
export const SECRET_NAMES: SecretName[] = ["anthropic", "openai", "google", "cloudflare", "vercel", "fly", "gcp"];
