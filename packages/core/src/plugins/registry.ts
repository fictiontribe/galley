/**
 * The plugin registry: every plugin the engine knows — built in, installed
 * for this user or server, or named by a site — with typed lookups per
 * contribution kind, the person's enable/disable choices, settings, hooks,
 * change events and a summary for the app.
 *
 * Isolation: nothing a plugin does can stop the engine. A plugin that fails
 * validation, throws in `setup`, or whose module won't load is kept in the
 * list with a plain problem and contributes nothing for the session. Hooks
 * and model listings are bounded by timeouts.
 *
 * Conflicts — two plugins offering the same provider id, script kind, tool
 * name… — are settled the same way everywhere: the site's own plugin beats
 * an installed one beats a built-in; within one layer the earlier
 * registration wins. Every conflict is reported.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GalleyAdapter } from "../adapter/types";
import { PRODUCT, SITE_URL, VERSION } from "../brand";
import type { ImageProviderHandle } from "../ai/images/providers";
import { ALL_TOOLS } from "../ai/tools/index";
import type { AssistantTool } from "../ai/tools/types";
import { safeDetail } from "../ai/errors";
import type { FormProviderInfo, ScriptIntegrationInfo } from "../kit";
import type { ChangeSet, PluginConflict, PluginContributions, PluginInfo, PluginSource, PublishCheck, PublishResult, SiteService } from "../types";
import { imageHandle, videoHandle, type ContributionOwner, type VideoProviderHandle } from "./adapt";
import { createPluginLogger, type PluginSettingsStore, type SettingsOwner } from "./settings";
import { adaptTool, scopedSite } from "./tools";
import type {
  DataSourceContribution,
  DataSourceContext,
  DeployTargetContribution,
  DeploymentInfo,
  FormProviderContribution,
  GalleyPlugin,
  ImporterContribution,
  PluginBrand,
  PluginContext,
  PluginHooks,
  ScriptIntegrationContribution,
  SitePluginContext,
} from "./types";
import { PACKAGE_NAME, validatePlugin } from "./validate";
import { GalleyError } from "../errors";
import type { FormSubmission } from "../kit";
import type { FormForwarder } from "../forms/forward";

const RANK: Record<PluginSource, number> = { site: 3, user: 2, builtin: 1 };
const LOG_LINES = 50;
export const HOOK_TIMEOUT_MS = { before: 30_000, after: 60_000, setup: 15_000 };

export interface RegisterOptions {
  source: PluginSource;
  /** How it was named: a config entry, an install spec. Shown in the app. */
  location?: string;
  /** Site plugins: the site's folder (its layer) and id. */
  siteRoot?: string;
  siteId?: string;
  /** The engine's own built-ins: can't be disabled. */
  required?: boolean;
}

export interface PluginRegistryOptions {
  /** Where the person's enable/disable choices are kept (`<home>/plugin-state.json`). Null: in memory only. */
  home?: string | null;
  settings?: PluginSettingsStore;
  fetch?: typeof fetch;
  brand?: Partial<PluginBrand>;
  /** Where plugin log lines and isolation notes go, besides each plugin's own recent log. */
  log?: (line: string) => void;
  hookTimeoutMs?: Partial<typeof HOOK_TIMEOUT_MS>;
}

export type PluginEvent = { type: "changed" };

interface Entry {
  id: string;
  order: number;
  name: string;
  source: PluginSource;
  location: string | null;
  siteRoot: string | null;
  siteId: string | null;
  required: boolean;
  plugin: GalleyPlugin | null;
  problems: string[];
  warnings: string[];
  /** Failed to set up (or load): out for this session. */
  broken: boolean;
  started: boolean;
  disposer: (() => unknown) | null;
  log: string[];
  /** Last resolved secret values, so the logger can cut them out. */
  secrets: string[];
  /** Last resolved plain settings, so a tool with `enabledBy` can be listed (or not) without a read. */
  switches: Record<string, string | undefined>;
  tools: AssistantTool[] | null;
  images: ImageProviderHandle[] | null;
  videos: VideoProviderHandle[] | null;
}

export interface ResolvedScriptIntegration extends ScriptIntegrationInfo {
  plugin: string;
  snippet?: ScriptIntegrationContribution["snippet"];
}

export interface ResolvedFormProvider extends FormProviderInfo {
  plugin: string;
}

export interface ImporterInfo {
  id: string;
  name: string;
  description: string;
  input: ImporterContribution["input"];
  docsUrl?: string;
  plugin: string;
  /** Whether `galley import <id>` can run it. */
  command: boolean;
}

/** A data source as the app lists it (the picker's choices). */
export interface DataSourceInfo {
  id: string;
  label: string;
  description?: string;
  plugin: string;
}

export interface DeployTargetSummary {
  id: string;
  name: string;
  blurb?: string;
  plugin: string;
}

export interface PluginRegistry {
  register(plugin: unknown, options: RegisterOptions): PluginInfoSync;
  /** A plugin that couldn't even be loaded: listed with its problem, contributes nothing. */
  registerFailure(name: string, problem: string, options: RegisterOptions): void;
  /** Forget a site's own plugins (before reloading them). */
  removeSite(siteRoot: string): Promise<void>;
  /** Runs `setup` for every enabled plugin not yet started. Never throws. */
  start(): Promise<void>;
  /** Persists the choice. Built-in required plugins refuse. Returns false when no such plugin is known. */
  setEnabled(name: string, enabled: boolean): Promise<boolean>;
  isEnabled(name: string): boolean;
  list(siteRoot?: string | null): Promise<PluginInfo[]>;
  info(name: string, siteRoot?: string | null): Promise<PluginInfo | null>;
  saveSettings(name: string, values: Record<string, string | null>, siteRoot?: string | null): Promise<PluginInfo>;
  conflicts(siteRoot?: string | null): PluginConflict[];

  adapters(siteRoot?: string | null): GalleyAdapter[];
  imageProviders(): ImageProviderHandle[];
  videoProviders(): VideoProviderHandle[];
  formProviders(siteRoot?: string | null): ResolvedFormProvider[];
  /** The plugin form provider with this id, for forwarding and field introspection. */
  formProvider(id: string, siteRoot?: string | null): { contribution: FormProviderContribution; context(): Promise<PluginContext> } | null;
  /** Plugin form providers that forward server-side, as the forms module's FormForwarder — register each with its ForwarderRegistry. */
  formForwarders(siteRoot?: string | null): FormForwarder[];
  scriptIntegrations(siteRoot?: string | null): ResolvedScriptIntegration[];
  importers(siteRoot?: string | null): ImporterInfo[];
  importer(id: string, siteRoot?: string | null): ImporterContribution | null;
  deployTargets(siteRoot?: string | null): DeployTargetSummary[];
  /** The targets themselves, for the deploy service's `targets` option (built-ins included). */
  deployTargetObjects(siteRoot?: string | null): DeployTargetContribution[];
  tools(siteRoot?: string | null): AssistantTool[];
  dataSources(siteRoot?: string | null): DataSourceInfo[];
  /** A data source by id, with the call context its search and get need (the site read-only). */
  dataSource(id: string, site: SiteService): { contribution: DataSourceContribution; context(signal: AbortSignal, limit: number): Promise<DataSourceContext> } | null;

  /** Runs every enabled `beforePublish` in order. The first refusal wins and stops the rest. */
  beforePublish(site: SiteService, changes: ChangeSet): Promise<{ plugin: string; message: string } | null>;
  /**
   * Every enabled `beforePublish`, in order, with what each said: its
   * warnings and the first refusal. `stopAtRefusal` (a real publish) stops at
   * the first refusal; without it (Proof asking ahead) every check runs.
   */
  checkPublish(site: SiteService, changes: ChangeSet, options?: { stopAtRefusal?: boolean }): Promise<PublishCheck>;
  afterPublish(site: SiteService, result: PublishResult): Promise<void>;
  afterDeploy(site: SiteService, deployment: DeploymentInfo): Promise<void>;
  onSubmission(site: SiteService, submission: FormSubmission): Promise<void>;
  /** Resolves when every hook run started so far has finished. */
  settled(): Promise<void>;

  subscribe(listener: (event: PluginEvent) => void): () => void;
  dispose(): Promise<void>;
}

/** What `register` returns straight away (settings statuses need a read, so they come from `list`). */
export interface PluginInfoSync {
  name: string;
  source: PluginSource;
  problems: string[];
  warnings: string[];
  enabled: boolean;
}

/** The built-in tools' names, which no plugin tool may take. */
export const RESERVED_TOOLS: readonly string[] = ALL_TOOLS.map((tool) => tool.name);

/** The values that count as a switch being on. */
export function isSwitchOn(value: string | undefined): boolean {
  return typeof value === "string" && /^(on|yes|true|1)$/i.test(value.trim());
}

/** A promise that rejects after `ms`, with a message naming what was slow. */
function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  return Promise.race([
    work.finally(() => clearTimeout(timer)),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)} seconds, so it was stopped waiting for.`)), ms);
      timer.unref?.();
    }),
  ]);
}

function describeError(error: unknown): string {
  return safeDetail(error instanceof Error ? error.message : error, 300);
}

export function createPluginRegistry(options: PluginRegistryOptions = {}): PluginRegistry {
  const entries: Entry[] = [];
  const listeners = new Set<(event: PluginEvent) => void>();
  const timeouts = { ...HOOK_TIMEOUT_MS, ...options.hookTimeoutMs };
  const brand: PluginBrand = { productName: PRODUCT.name, slug: PRODUCT.slug, version: VERSION, siteUrl: SITE_URL, ...options.brand };
  const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  const stateFile = options.home ? join(options.home, "plugin-state.json") : null;
  let disabled = new Set<string>();
  let stateLoaded = false;
  let order = 0;
  let pending: Promise<unknown> = Promise.resolve();
  let starting: Promise<void> | null = null;

  const emit = () => {
    for (const listener of listeners) {
      try {
        listener({ type: "changed" });
      } catch {
        // A listener's failure is its own.
      }
    }
  };
  const sink = (entry: Entry) => (level: "info" | "warn" | "error", line: string) => {
    entry.log.push(`${new Date().toISOString()} ${level} ${line}`);
    if (entry.log.length > LOG_LINES) entry.log.splice(0, entry.log.length - LOG_LINES);
    options.log?.(line);
  };
  const logger = (entry: Entry) => createPluginLogger(entry.name, () => entry.secrets, sink(entry));

  async function loadState(): Promise<void> {
    if (stateLoaded || !stateFile) return;
    stateLoaded = true;
    try {
      const parsed = JSON.parse(await readFile(stateFile, "utf8")) as { disabled?: unknown };

      if (Array.isArray(parsed.disabled)) disabled = new Set(parsed.disabled.filter((name): name is string => typeof name === "string"));
    } catch {
      // No choices made yet.
    }
  }

  async function saveState(): Promise<void> {
    if (!stateFile || !options.home) return;
    await mkdir(options.home, { recursive: true });
    const temp = join(options.home, `.plugin-state-${randomUUID()}.tmp`);

    await writeFile(temp, `${JSON.stringify({ disabled: [...disabled].sort() }, null, 2)}\n`);
    await rename(temp, stateFile);
  }

  const enabled = (entry: Entry) => entry.required || !disabled.has(entry.name);
  const active = (entry: Entry) => entry.plugin !== null && !entry.broken && entry.problems.length === 0 && enabled(entry);
  /** Entries in the layers visible from a site: built-in and installed always, a site's own only for that site. */
  const visible = (siteRoot: string | null | undefined) => entries.filter((entry) => entry.source !== "site" || (siteRoot != null && entry.siteRoot === siteRoot));
  const inUse = (siteRoot: string | null | undefined) => visible(siteRoot).filter(active);
  /** Most specific first: site, installed, built-in; within a layer, the order they were registered. */
  const byPrecedence = (list: Entry[]) => [...list].sort((a, b) => RANK[b.source] - RANK[a.source] || a.order - b.order);

  function owner(entry: Entry): SettingsOwner {
    return { name: entry.name, fields: entry.plugin?.settings ?? [], trusted: entry.source === "builtin" };
  }

  async function context(entry: Entry): Promise<PluginContext> {
    const values = options.settings ? await options.settings.values(owner(entry)).catch(() => ({})) : {};
    const secretKeys = new Set((entry.plugin?.settings ?? []).filter((field) => field.secret).map((field) => field.key));

    entry.secrets = Object.entries(values)
      .filter(([key, value]) => secretKeys.has(key) && typeof value === "string")
      .map(([, value]) => value as string);
    entry.switches = Object.fromEntries(Object.entries(values as Record<string, string | undefined>).filter(([key]) => !secretKeys.has(key)));
    return {
      plugin: { name: entry.name, version: entry.plugin?.version ?? null },
      settings: Object.freeze({ ...values }),
      log: logger(entry),
      fetch: fetchImpl,
      brand,
    };
  }

  function contributionOwner(entry: Entry): ContributionOwner {
    return {
      name: entry.name,
      trusted: entry.source === "builtin",
      fields: entry.plugin?.settings ?? [],
      context: () => context(entry),
      secret(key) {
        const read = async () => (options.settings ? ((await options.settings.values(owner(entry)))[key] ?? null) : null);

        return { read, configured: async () => (await read()) !== null };
      },
    };
  }

  /**
   * One kind of contribution across the visible plugins, conflicts settled.
   * `collect` reads an entry's items; `idOf` names one.
   */
  function resolve<T>(list: Entry[], kind: PluginConflict["kind"], collect: (entry: Entry) => readonly T[] | undefined, idOf: (item: T) => string) {
    const winners = new Map<string, { item: T; entry: Entry }>();
    const conflicts = new Map<string, PluginConflict>();

    for (const entry of byPrecedence(list)) {
      for (const item of collect(entry) ?? []) {
        const id = idOf(item);
        const taken = winners.get(id);

        if (!taken) {
          winners.set(id, { item, entry });
          continue;
        }
        if (taken.entry === entry) continue;
        const conflict = conflicts.get(id) ?? { kind, id, used: taken.entry.name, ignored: [] };

        if (!conflict.ignored.includes(entry.name)) conflict.ignored.push(entry.name);
        conflicts.set(id, conflict);
      }
    }
    // Results keep a stable, readable order: built-ins first as they were declared, then the rest.
    const ordered = [...winners.values()].sort((a, b) => a.entry.order - b.entry.order);

    return { items: ordered, conflicts: [...conflicts.values()] };
  }

  const kinds = {
    adapters: (list: Entry[]) => resolve(list, "adapter", (entry) => entry.plugin?.adapters, (adapter: GalleyAdapter) => adapter.id),
    images: (list: Entry[]) =>
      resolve(
        list.filter((entry) => entry.source !== "site"),
        "imageProvider",
        (entry) => (entry.images ??= (entry.plugin?.imageProviders ?? []).map((provider) => imageHandle(provider, contributionOwner(entry)))),
        (handle) => handle.id
      ),
    videos: (list: Entry[]) =>
      resolve(
        list.filter((entry) => entry.source !== "site"),
        "videoProvider",
        (entry) => (entry.videos ??= (entry.plugin?.videoProviders ?? []).map((provider) => videoHandle(provider, contributionOwner(entry)))),
        (handle) => handle.id
      ),
    forms: (list: Entry[]) => resolve(list, "formProvider", (entry) => entry.plugin?.formProviders, (provider: FormProviderContribution) => provider.id),
    scripts: (list: Entry[]) => resolve(list, "scriptIntegration", (entry) => entry.plugin?.scriptIntegrations, (integration: ScriptIntegrationContribution) => integration.kind),
    importers: (list: Entry[]) => resolve(list, "importer", (entry) => entry.plugin?.importers, (importer: ImporterContribution) => importer.id),
    deploy: (list: Entry[]) => resolve(list, "deployTarget", (entry) => entry.plugin?.deployTargets, (target: DeployTargetContribution) => target.id),
    tools: (list: Entry[]) =>
      resolve(
        list,
        "tool",
        (entry) => {
          entry.tools ??= (entry.plugin?.tools ?? []).map((tool) =>
            adaptTool({
              pluginName: entry.name,
              tool,
              context: () => context(entry),
              report: (message) => logger(entry).error(message),
            })
          );
          // A tool behind a switch is listed only while the switch is on (as last read; run() reads it again).
          const off = new Set((entry.plugin?.tools ?? []).filter((tool) => tool.enabledBy && !isSwitchOn(entry.switches[tool.enabledBy])).map((tool) => tool.name));

          return off.size ? entry.tools.filter((tool) => !off.has(tool.name)) : entry.tools;
        },
        (tool) => tool.name
      ),
    dataSources: (list: Entry[]) => resolve(list, "dataSource", (entry) => entry.plugin?.dataSources, (source: DataSourceContribution) => source.id),
  };

  function contributions(plugin: GalleyPlugin | null): PluginContributions {
    return {
      adapters: (plugin?.adapters ?? []).map((adapter) => adapter.name),
      imageProviders: (plugin?.imageProviders ?? []).map((provider) => provider.label),
      videoProviders: (plugin?.videoProviders ?? []).map((provider) => provider.label),
      formProviders: (plugin?.formProviders ?? []).map((provider) => provider.name),
      scriptIntegrations: (plugin?.scriptIntegrations ?? []).map((integration) => integration.name),
      importers: (plugin?.importers ?? []).map((importer) => importer.name),
      deployTargets: (plugin?.deployTargets ?? []).map((target) => target.name),
      tools: (plugin?.tools ?? []).map((tool) => ({ name: tool.name, title: tool.title, mode: tool.mode, readOnly: tool.effect.readOnly })),
      ...(plugin?.dataSources?.length ? { dataSources: plugin.dataSources.map((source) => source.label) } : {}),
      hooks: Object.keys(plugin?.hooks ?? {}),
    };
  }

  async function infoOf(entry: Entry): Promise<PluginInfo> {
    const statuses = options.settings && entry.plugin ? await options.settings.status(owner(entry)).catch(() => []) : [];
    // A setting a tool's `enabledBy` names lets the assistant act outside the app: the Plugins screen shows it as a decision.
    const settings = statuses.map((status) => {
      const tools = (entry.plugin?.tools ?? []).filter((tool) => tool.enabledBy === status.key).map((tool) => tool.title);
      return tools.length ? { ...status, switchesOn: tools } : status;
    });

    return {
      name: entry.name,
      displayName: entry.plugin?.displayName ?? entry.name,
      ...(entry.plugin?.description ? { description: entry.plugin.description } : {}),
      version: entry.plugin?.version ?? null,
      source: entry.source,
      ...(entry.siteId ? { siteId: entry.siteId } : {}),
      ...(entry.location ? { location: entry.location } : {}),
      enabled: enabled(entry),
      active: active(entry),
      canDisable: !entry.required,
      contributes: contributions(entry.plugin),
      problems: [...entry.problems],
      warnings: [...entry.warnings],
      settings,
      log: [...entry.log],
    };
  }

  async function startEntry(entry: Entry): Promise<void> {
    if (entry.started || !active(entry) || !entry.plugin) return;
    entry.started = true;
    // Read the settings once, so switches are known before any tool list is asked for.
    if (entry.plugin.tools?.some((tool) => tool.enabledBy)) await context(entry).catch(() => undefined);
    if (!entry.plugin.setup) return;
    try {
      const disposer = await withTimeout(Promise.resolve(entry.plugin.setup(await context(entry))), timeouts.setup, `Setting up ${entry.name}`);

      entry.disposer = typeof disposer === "function" ? disposer : null;
    } catch (error) {
      // Out for this session, with a plain note; the server carries on.
      entry.broken = true;
      entry.problems.push(`It couldn't start (${describeError(error)}), so it is turned off until the app restarts.`);
      logger(entry).error(`setup failed: ${describeError(error)}`);
      emit();
    }
  }

  async function stopEntry(entry: Entry): Promise<void> {
    const dispose = entry.disposer;

    entry.disposer = null;
    entry.started = false;
    if (!dispose) return;
    try {
      await withTimeout(Promise.resolve(dispose()), timeouts.setup, `Stopping ${entry.name}`);
    } catch (error) {
      logger(entry).warn(`stopping failed: ${describeError(error)}`);
    }
  }

  function findEntry(name: string, siteRoot?: string | null): Entry | undefined {
    return byPrecedence(visible(siteRoot)).find((entry) => entry.name === name);
  }

  function siteContext(base: PluginContext, site: SiteService, name: string): SitePluginContext {
    // Hooks read; a hook that published or discarded from inside a publish would loop.
    return { ...base, site: scopedSite(site, { readOnly: true, mode: "content", name, refusal: `A plugin hook (${name}) can read the site but not change it.` }), siteId: site.id };
  }

  type HookName = keyof PluginHooks;

  /** A plugin's own sentence, with its secret values cut out, as its log lines are. */
  function scrubFor(entry: Entry, text: string): string {
    return entry.secrets.reduce((out, secret) => (secret.length >= 4 ? out.split(secret).join("[redacted]") : out), text);
  }

  async function checkPublish(site: SiteService, changes: ChangeSet, checkOptions: { stopAtRefusal?: boolean } = {}): Promise<PublishCheck> {
    const out: PublishCheck = { warnings: [], refusal: null };

    for (const entry of await hookEntries(site, "beforePublish")) {
      const plugin = entry.plugin!.displayName ?? entry.name;

      try {
        const outcome = await withTimeout(
          Promise.resolve(entry.plugin!.hooks!.beforePublish!(siteContext(await context(entry), site, entry.name), changes)),
          timeouts.before,
          `${entry.name}'s beforePublish`
        );

        if (!outcome || typeof outcome !== "object") continue;
        // A plugin's sentences are shown as they are, trimmed to a size a dialog can hold; anything not text is dropped.
        const warnings = Array.isArray(outcome.warnings) ? outcome.warnings.filter((warning): warning is string => typeof warning === "string" && warning.trim() !== "") : [];

        for (const warning of warnings.slice(0, 20)) out.warnings.push({ plugin, message: scrubFor(entry, warning.trim()).slice(0, 1000) });
        if (typeof outcome.refuse === "string" && outcome.refuse.trim() && !out.refusal) {
          out.refusal = { plugin, message: scrubFor(entry, outcome.refuse.trim()).slice(0, 1000) };
          if (checkOptions.stopAtRefusal) break;
        }
      } catch (error) {
        // A before hook that fails is reported and the publish goes ahead: only a refusal stops it.
        logger(entry).error(`beforePublish failed: ${describeError(error)}`);
      }
    }
    return out;
  }

  async function hookEntries(site: SiteService, hook: HookName): Promise<Entry[]> {
    await loadState();
    // Built-in plugins first, then installed, then the site's own — each in the order they were registered.
    return inUse(site.root)
      .filter((entry) => typeof entry.plugin?.hooks?.[hook] === "function")
      .sort((a, b) => RANK[a.source] - RANK[b.source] || a.order - b.order);
  }

  function runAfter<T>(hook: "afterPublish" | "afterDeploy" | "onSubmission", site: SiteService, payload: T): Promise<void> {
    const run = async () => {
      for (const entry of await hookEntries(site, hook)) {
        const fn = entry.plugin!.hooks![hook] as (ctx: SitePluginContext, value: T) => unknown;

        try {
          await withTimeout(Promise.resolve(fn(siteContext(await context(entry), site, entry.name), payload)), timeouts.after, `${entry.name}'s ${hook}`);
        } catch (error) {
          // Reported, never breaking what already happened.
          logger(entry).error(`${hook} failed: ${describeError(error)}`);
        }
      }
    };
    const result = pending.then(run, run);

    pending = result.catch(() => undefined);
    return result;
  }

  const registry: PluginRegistry = {
    register(value, registerOptions) {
      const check = validatePlugin(value, registerOptions.location ?? (value as { name?: unknown } | null)?.name?.toString() ?? "The plugin", {
        reservedTools: RESERVED_TOOLS,
        builtin: registerOptions.source === "builtin",
      });
      const claimed = (value as { name?: unknown } | null)?.name;
      // A plugin that isn't valid is listed by its own name only when that is a usable one, else by where it came from.
      const name = check.ok ? check.plugin.name : typeof claimed === "string" && PACKAGE_NAME.test(claimed) ? claimed : (registerOptions.location ?? "unnamed plugin");
      const entry: Entry = {
        id: randomUUID(),
        order: order++,
        name,
        source: registerOptions.source,
        location: registerOptions.location ?? null,
        siteRoot: registerOptions.siteRoot ?? null,
        siteId: registerOptions.siteId ?? null,
        required: Boolean(registerOptions.required),
        plugin: check.ok ? check.plugin : null,
        problems: check.ok ? [] : check.problems,
        warnings: check.warnings,
        broken: false,
        started: false,
        disposer: null,
        log: [],
        secrets: [],
        switches: {},
        tools: null,
        images: null,
        videos: null,
      };
      const twin = entries.find((other) => other.name === name && other.source === entry.source && other.siteRoot === entry.siteRoot);

      if (twin && entry.plugin) {
        entry.plugin = null;
        entry.problems.push(`Another plugin called “${name}” is already loaded from the same place, so this copy was skipped.`);
      }
      entries.push(entry);
      if (starting) void starting.then(() => startEntry(entry));
      emit();
      return { name, source: entry.source, problems: [...entry.problems], warnings: [...entry.warnings], enabled: enabled(entry) };
    },

    registerFailure(name, problem, registerOptions) {
      entries.push({
        id: randomUUID(),
        order: order++,
        name,
        source: registerOptions.source,
        location: registerOptions.location ?? null,
        siteRoot: registerOptions.siteRoot ?? null,
        siteId: registerOptions.siteId ?? null,
        required: false,
        plugin: null,
        problems: [problem],
        warnings: [],
        broken: true,
        started: false,
        disposer: null,
        log: [],
        secrets: [],
        switches: {},
        tools: null,
        images: null,
        videos: null,
      });
      options.log?.(problem);
      emit();
    },

    async removeSite(siteRoot) {
      const gone = entries.filter((entry) => entry.source === "site" && entry.siteRoot === siteRoot);

      for (const entry of gone) {
        await stopEntry(entry);
        entries.splice(entries.indexOf(entry), 1);
      }
      if (gone.length) emit();
    },

    start() {
      starting ??= (async () => {
        await loadState();
      })();
      return starting.then(async () => {
        for (const entry of [...entries]) await startEntry(entry);
      });
    },

    async setEnabled(name, value) {
      await loadState();
      const matching = entries.filter((entry) => entry.name === name);

      if (matching.length === 0) return false;
      if (matching.some((entry) => entry.required)) {
        if (!value) throw new GalleyError("invalid", `${name} comes with the app and can't be turned off.`);
        return true;
      }
      if (value) disabled.delete(name);
      else disabled.add(name);
      await saveState();
      for (const entry of matching) {
        if (value && starting) await startEntry(entry);
        if (!value) await stopEntry(entry);
      }
      emit();
      return true;
    },

    isEnabled(name) {
      return !disabled.has(name);
    },

    async list(siteRoot) {
      await loadState();
      // Built-in first, then installed, then the site's own — each in the order registered.
      return Promise.all([...visible(siteRoot)].sort((a, b) => RANK[a.source] - RANK[b.source] || a.order - b.order).map(infoOf));
    },

    async info(name, siteRoot) {
      await loadState();
      const entry = findEntry(name, siteRoot);

      return entry ? infoOf(entry) : null;
    },

    async saveSettings(name, values, siteRoot) {
      const entry = findEntry(name, siteRoot);

      if (!entry || !entry.plugin) throw new GalleyError("not-found", `There is no plugin called “${name.slice(0, 80)}” here.`);
      if (!options.settings) throw new GalleyError("invalid", "Plugin settings can't be saved here.");
      await options.settings.save(owner(entry), values);
      await context(entry).catch(() => undefined);
      emit();
      return infoOf(entry);
    },

    conflicts(siteRoot) {
      const list = inUse(siteRoot);

      return [
        ...kinds.adapters(list).conflicts,
        ...kinds.images(list).conflicts,
        ...kinds.videos(list).conflicts,
        ...kinds.forms(list).conflicts,
        ...kinds.scripts(list).conflicts,
        ...kinds.importers(list).conflicts,
        ...kinds.deploy(list).conflicts,
        ...kinds.tools(list).conflicts,
        ...kinds.dataSources(list).conflicts,
      ];
    },

    adapters(siteRoot) {
      return kinds.adapters(inUse(siteRoot)).items.map(({ item }) => item);
    },
    imageProviders() {
      return kinds.images(inUse(null)).items.map(({ item }) => item);
    },
    videoProviders() {
      return kinds.videos(inUse(null)).items.map(({ item }) => item);
    },
    formProviders(siteRoot) {
      return kinds.forms(inUse(siteRoot)).items.map(({ item, entry }) => {
        const { forward: _forward, introspect: _introspect, ...info } = item;

        return { ...info, plugin: entry.name };
      });
    },
    formProvider(id, siteRoot) {
      const found = kinds.forms(inUse(siteRoot)).items.find(({ item }) => item.id === id);

      return found ? { contribution: found.item, context: () => context(found.entry) } : null;
    },
    formForwarders(siteRoot) {
      return kinds.forms(inUse(siteRoot))
        .items.filter(({ item }) => typeof item.forward === "function")
        .map(({ item, entry }) => ({
          id: item.id,
          async send(submission, destination, forwardContext) {
            const base = await context(entry);

            try {
              return await item.forward!(submission, destination, { ...base, siteId: forwardContext.siteId, formId: forwardContext.formId, payload: forwardContext.payload });
            } catch (error) {
              logger(entry).error(`forwarding failed: ${describeError(error)}`);
              return { ok: false, detail: `${entry.plugin?.displayName ?? entry.name} couldn't send it (${describeError(error)}).` };
            }
          },
        }));
    },
    scriptIntegrations(siteRoot) {
      return kinds.scripts(inUse(siteRoot)).items.map(({ item, entry }) => ({ ...item, plugin: entry.name }));
    },
    importers(siteRoot) {
      return kinds.importers(inUse(siteRoot)).items.map(({ item, entry }) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        input: item.input,
        ...(item.docsUrl ? { docsUrl: item.docsUrl } : {}),
        plugin: entry.name,
        command: Boolean(item.command),
      }));
    },
    importer(id, siteRoot) {
      return kinds.importers(inUse(siteRoot)).items.find(({ item }) => item.id === id)?.item ?? null;
    },
    deployTargets(siteRoot) {
      return kinds.deploy(inUse(siteRoot)).items.map(({ item, entry }) => ({
        id: item.id,
        name: item.name,
        ...(typeof item.info?.blurb === "string" ? { blurb: item.info.blurb } : {}),
        plugin: entry.name,
      }));
    },
    deployTargetObjects(siteRoot) {
      return kinds.deploy(inUse(siteRoot)).items.map(({ item }) => item);
    },
    tools(siteRoot) {
      // Built-in tools are the engine's own; a plugin can't shadow them (validation refuses their names).
      return kinds.tools(inUse(siteRoot)).items.map(({ item }) => item);
    },

    dataSources(siteRoot) {
      return kinds.dataSources(inUse(siteRoot)).items.map(({ item, entry }) => ({
        id: item.id,
        label: item.label,
        ...(item.description ? { description: item.description } : {}),
        plugin: entry.name,
      }));
    },
    dataSource(id, site) {
      const found = kinds.dataSources(inUse(site.root)).items.find(({ item }) => item.id === id);

      if (!found) return null;
      return {
        contribution: found.item,
        // The site read-only: a picker looks things up, it never changes the site.
        context: async (signal, limit) => ({ ...siteContext(await context(found.entry), site, found.entry.name), signal, limit }),
      };
    },

    async beforePublish(site, changes) {
      return (await checkPublish(site, changes, { stopAtRefusal: true })).refusal;
    },
    checkPublish: (site, changes, checkOptions) => checkPublish(site, changes, checkOptions),
    afterPublish: (site, result) => runAfter("afterPublish", site, result),
    afterDeploy: (site, deployment) => runAfter("afterDeploy", site, deployment),
    onSubmission: (site, submission) => runAfter("onSubmission", site, submission),
    settled: () => pending.then(() => undefined),

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async dispose() {
      await pending.catch(() => undefined);
      for (const entry of [...entries].reverse()) await stopEntry(entry);
      listeners.clear();
    },
  };

  return registry;
}
