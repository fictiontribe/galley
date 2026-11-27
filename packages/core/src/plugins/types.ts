/**
 * The public plugin API: what a plugin is, what it may contribute and what
 * the engine hands it. A plugin is a plain object — no base class, no build
 * step — and everything here is types, so a plugin can `import type` this
 * and stay a dependency-free file. `@galleycms/plugin-kit` re-exports it.
 *
 * Where an engine interface already existed (adapters, the kit catalogues)
 * the public shape reuses it. Where the internal one leaks internals (image
 * providers take a raw key and fetch positionally; assistant tools take zod
 * schemas of the engine's own zod), the public shape is defined here and the
 * registry adapts it — see registry.ts.
 */
import type { GalleyAdapter, MaybePromise } from "../adapter/types";
import type { DeployTarget } from "../deploy/types";
import type { EditorHost } from "../hosting/types";
import type { FormDestination, FormProviderInfo, FormSubmission, ScriptIntegrationInfo } from "../kit";
import type { AgentMode, ChangeSet, ImageAspect, JsonValue, PublishResult, SiteService, VideoAspect } from "../types";

export type { MaybePromise };

// ─────────────────────────────────────────────────────────────── context

/** A logger whose lines have the plugin's secrets (and every key the engine knows) cut out before they go anywhere. */
export interface PluginLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** The product's brand constants: name it by these, never hard-code a product name. */
export interface PluginBrand {
  productName: string;
  /** CLI binary and config stem: "galley" unless the deployment renamed it. */
  slug: string;
  version: string;
  /** The project's public site, for attribution headers and links. */
  siteUrl: string;
}

// #region context-interface
/**
 * What every plugin call receives: its own settings (secrets resolved for
 * this plugin alone), a logger that scrubs secrets, `fetch`, and the brand.
 * Nothing else of the engine — no filesystem paths, no other plugin's settings.
 */
export interface PluginContext {
  readonly plugin: { readonly name: string; readonly version: string | null };
  /** This plugin's settings by key, read fresh for each call. Missing values are undefined. */
  readonly settings: Readonly<Record<string, string | undefined>>;
  readonly log: PluginLogger;
  readonly fetch: typeof fetch;
  readonly brand: PluginBrand;
}
// #endregion context-interface

/** Hooks and site tools also get the site — the same facade the server and the assistant use, scoped to the site folder. */
export interface SitePluginContext extends PluginContext {
  readonly site: SiteService;
  readonly siteId: string;
}

// ─────────────────────────────────────────────────────────────── settings

/** One choice of a `select` setting. */
export interface PluginSettingOption {
  /** What is saved and what the plugin reads. */
  value: string;
  /** What the person reads. */
  label: string;
}

/** How the app asks for a setting. A secret is always typed. */
export type PluginSettingKind = "text" | "toggle" | "select";

/** One setting a plugin needs. Shown in the app; a secret is stored in the secret store and its value never leaves the server. */
export interface PluginSettingField {
  /** Letters, digits, dashes and underscores, starting with a letter: "webhookUrl". */
  key: string;
  label: string;
  help?: string;
  /**
   * "text" (the default): a text box. "toggle": an on/off switch, saved as
   * "on" or "off". "select": one of `options`. Leave it out for text.
   */
  type?: PluginSettingKind;
  /** For "select": the choices, in the order shown. */
  options?: PluginSettingOption[];
  /** For "toggle" and "select": the value the plugin reads while nothing is saved ("off" for a toggle unless said). */
  default?: string;
  /**
   * For "toggle": what switching it on does, in one plain sentence, shown
   * beside the switch so it reads as a decision. Give one whenever the
   * switch lets the assistant change something outside the app (a tool's
   * `enabledBy`).
   */
  consequence?: string;
  secret?: boolean;
  required?: boolean;
  /** A regular expression the value must match (checked on save). */
  pattern?: string;
  placeholder?: string;
  /**
   * Environment variables that supply the value instead (the first one set
   * wins, and the app can't override it). Names the engine reads for its own
   * keys, and anything starting with GALLEY_, are refused for plugins that
   * are not built in.
   */
  env?: string[];
  /**
   * Built-in plugins only: the secret's name in the shared secret store
   * ("openrouter"), so a key keeps one name however it is reached. Every
   * other plugin's secrets are kept under the plugin's own name.
   */
  secretName?: string;
}

// ─────────────────────────────────────────────────────────────── providers

/**
 * An error a provider throws so the person reads a plain sentence. `kind`
 * decides how the app treats it (an "auth" or "quota" problem points to
 * Settings). Classify by status and error code, never by matching prose.
 */
export type ProviderErrorKind = "auth" | "policy" | "quota" | "rate" | "unavailable" | "invalid" | "empty";

export interface ProviderCallContext extends PluginContext {
  /** The value of the provider's `keySetting`, or null when it has none. */
  readonly key: string | null;
  readonly signal?: AbortSignal;
}

export interface ImageModelInfo {
  id: string;
  label: string;
  /** Overrides the provider's own `supportsReferences` for this model. */
  supportsReferences?: boolean;
  supportsTransparency?: boolean;
  /** A plain price line when the service publishes one: "$0.04 per image". */
  price?: string;
}

export interface ImageGenerationRequest {
  /** The prompt with any style direction already appended. */
  prompt: string;
  aspect: ImageAspect;
  /** 1–4. */
  count: number;
  model: string;
  transparent: boolean;
  /** Reference pictures, already read from the site (PNG, JPEG, WebP or GIF). */
  references: Array<{ data: Uint8Array; mime: string }>;
}

export interface GeneratedImageResult {
  data: Uint8Array;
  mime: string;
  width?: number;
  height?: number;
  /** What the service reported this image cost, in US dollars, when it says. */
  cost?: number;
}

// #region image-provider-interface
/** An image generator. Selectable in Settings like the built-in ones. */
export interface ImageProviderPlugin {
  /** Lowercase letters, digits and dashes: "openrouter". Unique across providers. */
  id: string;
  label: string;
  /** The key of the secret setting (in the plugin's `settings`) that holds the API key. Leave out when none is needed. */
  keySetting?: string;
  /** The models to offer. May fetch (cache it): called whenever the app lists providers. */
  models(ctx: ProviderCallContext): MaybePromise<ImageModelInfo[]>;
  defaultModel: string;
  supportsReferences?: boolean;
  supportsTransparency?: boolean;
  generate(request: ImageGenerationRequest, ctx: ProviderCallContext): Promise<GeneratedImageResult[]>;
}
// #endregion image-provider-interface

export type { VideoAspect };

export interface VideoModelInfo {
  id: string;
  label: string;
  /** Lengths it can make, in seconds. */
  durations?: number[];
  resolutions?: string[];
  aspects?: string[];
  /** Whether a first-frame picture can start the video. */
  supportsFirstFrame?: boolean;
  /** Whether it makes sound too. */
  audio?: boolean;
  price?: string;
}

export interface VideoGenerationRequest {
  prompt: string;
  model: string;
  aspect?: VideoAspect;
  durationSeconds?: number;
  resolution?: string;
  /** A picture the video starts from. */
  firstFrame?: { data: Uint8Array; mime: string };
  audio?: boolean;
}

/** Where a running generation stands, as the provider reports it. */
export type VideoJobState =
  | { state: "running"; progress?: number; detail?: string }
  | { state: "done"; outputs: number; cost?: number }
  | { state: "failed"; kind: ProviderErrorKind; message: string; detail?: string };

// #region video-provider-interface
/**
 * A video generator. Video is asynchronous everywhere: `start` submits and
 * returns the provider's job id, the engine calls `poll` with backoff until
 * it is done, then `download` each output.
 */
export interface VideoProviderPlugin {
  id: string;
  label: string;
  keySetting?: string;
  models(ctx: ProviderCallContext): MaybePromise<VideoModelInfo[]>;
  defaultModel: string;
  start(request: VideoGenerationRequest, ctx: ProviderCallContext): Promise<{ jobId: string }>;
  poll(jobId: string, ctx: ProviderCallContext): Promise<VideoJobState>;
  download(jobId: string, index: number, ctx: ProviderCallContext): Promise<{ data: Uint8Array; mime: string }>;
}
// #endregion video-provider-interface

// ─────────────────────────────────────────────────────────────── site kit

/** A field the provider's own form has, as the provider names it. */
export interface FormFieldInfo {
  name: string;
  label?: string;
  type?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
}

/**
 * A form destination: its catalogue entry, plus (optionally) a server-side
 * forwarder for submissions the capture endpoint relays, and a way to read
 * the fields of an existing form on the provider's side.
 */
/** What a plugin's forwarder gets with each submission the capture endpoint relays. */
export interface FormForwardContext extends PluginContext {
  readonly siteId: string;
  readonly formId: string;
  /** The answers under the destination's own field names (mapping applied), then its fixed values. */
  readonly payload: { [name: string]: string | string[] };
}

export interface FormProviderContribution extends FormProviderInfo {
  /** Sends one submission on. `retry: false` when trying again can't help (the other side refused it). */
  forward?(
    submission: FormSubmission,
    destination: FormDestination,
    ctx: FormForwardContext
  ): Promise<{ ok: boolean; detail?: string; retry?: boolean }>;
  introspect?(settings: { [key: string]: JsonValue }, ctx: PluginContext): Promise<FormFieldInfo[]>;
}

/**
 * A third-party script integration: its catalogue entry plus the snippet.
 * The site runtime only knows its built-in kinds, so a plugin's kind
 * carries its own snippet as a template — `{{settingKey}}` stands for a
 * setting's value. When the app adds it to a site it writes the resolved
 * snippet into the entry's settings as `src` / `inline` (the keys the
 * runtime's "custom" kind reads); `resolveScriptSnippet` does that.
 */
export interface ScriptIntegrationContribution extends ScriptIntegrationInfo {
  /** Required for every plugin but the built-in one, whose kinds the site runtime writes itself. */
  snippet?: {
    /** A script address, e.g. "https://cdn.example.com/widget.js?id={{siteKey}}". */
    src?: string;
    /** Code to run, when there is no address. Setting values are JSON-escaped into it. */
    inline?: string;
    attributes?: Record<string, string>;
  };
}

/** What `galley import <id>` hands an importer's command. */
export interface ImporterIo {
  out(line?: string): void;
  err(line?: string): void;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/** "Bring content in from X." */
export interface ImporterContribution {
  /** Lowercase letters, digits and dashes: "wordpress". */
  id: string;
  name: string;
  description: string;
  /** What it reads from. */
  input: "url" | "file" | "url-or-file";
  docsUrl?: string;
  /** The command line: `galley import <id> …`. Exit code returned. */
  command?: { help: string; run(argv: string[], io: ImporterIo): Promise<number> };
}

/**
 * A host a site can be deployed to: the deploy module's own `DeployTarget`
 * (connect, check and create a project, upload a built folder). Public as is.
 */
export type DeployTargetContribution = DeployTarget;

/**
 * A place the editor itself can be hosted ("Host the editor online"): the
 * hosting module's own `EditorHost` (inspect a key, plan, create, upgrade,
 * back up, remove exactly what it created). Public as is.
 */
export type EditorHostContribution = EditorHost;

/** A theme file's contents (brand/themes/theme.schema.json), as an object. */
export type ThemeContribution = import("../themes/contract").ThemeFile;

// ─────────────────────────────────────────────────────────────── tools

/**
 * The input of a tool, as a small JSON Schema: an object whose properties
 * are strings, numbers, integers, booleans, enums, arrays of those, or
 * nested objects of the same. Dependency-free on purpose — the engine turns
 * it into its own validator.
 */
export interface ToolInputSchema {
  type: "object";
  properties: Record<string, ToolInputProperty>;
  required?: string[];
}

export type ToolInputProperty =
  | { type: "string"; description?: string; enum?: string[]; minLength?: number; maxLength?: number; pattern?: string }
  | { type: "number" | "integer"; description?: string; minimum?: number; maximum?: number }
  | { type: "boolean"; description?: string }
  | { type: "array"; description?: string; items: ToolInputProperty; minItems?: number; maxItems?: number }
  | { type: "object"; description?: string; properties: Record<string, ToolInputProperty>; required?: string[] };

export interface ToolCallContext extends SitePluginContext {
  /** The mode the call runs in. Writes are made in this mode whatever is asked. */
  readonly mode: AgentMode;
  readonly signal: AbortSignal;
}

/** What a tool returns: text for the model, any JSON value (sent as compact JSON), or an explicit outcome. */
export type ToolResult = string | JsonValue | { content: string; isError?: boolean };

/**
 * An extra tool for the built-in assistant and for any harness over MCP.
 * The declared `effect` is enforced: a read-only tool gets a site that
 * refuses writes, and every tool's writes are made in the call's mode.
 */
export interface SiteToolContribution {
  /** snake_case, unique, not a built-in tool's name: "count_words". */
  name: string;
  /** A short title for harness UIs: "Count the words on a page". */
  title: string;
  /** What it does and when to use it, for the model. */
  description: string;
  input: ToolInputSchema;
  /** "content": offered in both modes. "build": only in build mode. */
  mode: "content" | "build";
  effect: { readOnly: boolean; destructive?: boolean; idempotent?: boolean; openWorld?: boolean };
  /**
   * The key of one of the plugin's own (non-secret) settings that switches
   * this tool on: it is offered only while that setting is "on" (or "yes",
   * "true", "1"), and refuses to run otherwise. For tools a person must opt
   * into on purpose — a tool that changes another service directly.
   */
  enabledBy?: string;
  /** Present-tense activity line from the real arguments ("Counting the words on the About page"). Never a tool name or a path. */
  label?(input: Record<string, unknown>): string;
  run(input: Record<string, unknown>, ctx: ToolCallContext): MaybePromise<ToolResult>;
}

// ─────────────────────────────────────────────────────────────── data sources

/** One thing a data source can offer for a field: the value saved in the file, and how to show it. */
export interface DataSourceItem {
  /** What is written into the content file: a plain string (a product handle, an id). */
  value: string;
  title: string;
  /** An absolute https URL of a small picture, or a site-root path. */
  image?: string;
  /** One short line: "£640 · Coats", "Sold out". */
  detail?: string;
}

export interface DataSourceContext extends SitePluginContext {
  readonly signal: AbortSignal;
  /** At most this many items are wanted. */
  readonly limit: number;
}

// #region data-source-interface
/**
 * Values a field can be picked from, held somewhere else: products in a
 * store, people in a directory. The content file keeps only `value` (a plain
 * string), so the site stays files; the app shows a picker that searches
 * here. A field opts in with `"dataSource": "<id>"` in galley.config.json.
 */
export interface DataSourceContribution {
  /** Lowercase letters, digits and dashes: "shopify-products". */
  id: string;
  label: string;
  description?: string;
  /** Up to `ctx.limit` items matching what the person typed (empty: the first few). */
  search(query: string, ctx: DataSourceContext): MaybePromise<DataSourceItem[]>;
  /** The item a saved value stands for, or null when the source no longer has it. */
  get(value: string, ctx: DataSourceContext): MaybePromise<DataSourceItem | null>;
}
// #endregion data-source-interface

// ─────────────────────────────────────────────────────────────── hooks

/** What `afterDeploy` receives. The deploy module fills in its own details. */
export interface DeploymentInfo {
  target: string;
  ok: boolean;
  url?: string;
  detail?: string;
  [extra: string]: unknown;
}

/**
 * What a `beforePublish` hook may answer. `refuse` stops the publish with
 * that sentence. `warnings` let it go ahead but are shown to the person
 * first — in Proof and in the Publish dialog, under the plugin's name — so
 * one plain sentence each, saying what is wrong and where.
 */
export interface BeforePublishResult {
  refuse?: string;
  warnings?: string[];
}

// #region hooks-interface
/**
 * Lifecycle hooks. Each may be async. Hooks of every enabled plugin run one
 * after another (built-in plugins first, then installed, then the site's).
 * A hook that throws or takes too long is reported and never breaks the
 * action — except that a `beforePublish` returning `{ refuse }` stops the
 * publish with that message. `{ warnings }` are shown, never a stop.
 */
export interface PluginHooks {
  beforePublish?(ctx: SitePluginContext, changes: ChangeSet): MaybePromise<void | BeforePublishResult>;
  afterPublish?(ctx: SitePluginContext, result: PublishResult): MaybePromise<void>;
  afterDeploy?(ctx: SitePluginContext, deployment: DeploymentInfo): MaybePromise<void>;
  onSubmission?(ctx: SitePluginContext, submission: FormSubmission): MaybePromise<void>;
}
// #endregion hooks-interface

// ─────────────────────────────────────────────────────────────── the plugin

// #region plugin-interface
export interface GalleyPlugin {
  /** npm-style: "galley-plugin-foo" or "@scope/galley-plugin-foo". */
  name: string;
  displayName?: string;
  description?: string;
  version?: string;
  /** The plugin API version this plugin was written for: 1. */
  apiVersion: 1;
  /** What it contributes — every key optional. */
  adapters?: GalleyAdapter[];
  imageProviders?: ImageProviderPlugin[];
  videoProviders?: VideoProviderPlugin[];
  formProviders?: FormProviderContribution[];
  scriptIntegrations?: ScriptIntegrationContribution[];
  importers?: ImporterContribution[];
  deployTargets?: DeployTargetContribution[];
  /** Places the editor itself can be hosted online. */
  editorHosts?: EditorHostContribution[];
  tools?: SiteToolContribution[];
  /** Where a field's values can be picked from (a product, a collection). */
  dataSources?: DataSourceContribution[];
  /**
   * Themes for the editing app (docs/themes.md): theme files as data, checked
   * like any other. One that would be refused is a problem; one the check
   * adjusts is a warning (ship the adjusted values). Only plugins installed
   * for the app add themes; a site's own plugin can't change the app.
   */
  themes?: ThemeContribution[];
  hooks?: PluginHooks;
  /** Settings the plugin needs (shown in the app; secrets are never returned). */
  settings?: PluginSettingField[];
  /** Runs once when the plugin is enabled; may return a disposer that runs when it stops. */
  setup?(ctx: PluginContext): MaybePromise<void | (() => MaybePromise<void>)>;
}
// #endregion plugin-interface
