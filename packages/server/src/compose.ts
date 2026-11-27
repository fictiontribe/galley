/**
 * The one place the real engine is assembled. Everything else in the server
 * depends only on the interfaces in @galley/core/types, and is tested
 * against fakes.
 */
import { realpathSync } from "node:fs";
import { createAgentRuntime, createFileSecretStore, createImageService, createSettingsService, createVideoService, type AssistantTurnNotice, type GalleyImageService, type GalleySettingsService } from "@galley/core/ai";
import { builtInTargets } from "@galley/core/deploy";
import { ensureSitePlugins, setActivePlugins, withPluginHooks, withSiteHooks, type PluginRegistry } from "@galley/core/plugins";
import { createEventBus, createSiteRegistry, createSiteService, siteIdFor, type SiteHooks } from "@galley/core/site";
import { createDeployService } from "@galley/core/deploy";
import { createMediaStorageService, type MediaStorageService } from "@galley/core/media-storage";
import { builtInEditorHosts, createHostingService } from "@galley/core/hosting";
import { createFormCapture } from "@galley/core/forms";
import { createRedirectsService } from "@galley/core/redirects";
import { createSiteBrandService } from "@galley/core/sitebrand";
import { createThemeStore } from "@galley/core/themes/store";
import { createVisibilityService } from "@galley/core/seo";
import { createI18nService } from "@galley/core/i18n";
import type { EventBus, SettingsService, SiteRegistry, SiteService } from "@galley/core/types";
import { createPortPool, type PortRange, type PreviewGateway } from "@galley/core/workspace";
import { overlaySource } from "@galley/overlay";
import { createImportService } from "./import";
import { createPluginSystem } from "./plugins";
import type { Services } from "./types";

export interface ServicesOptions {
  /** Galley home: settings, secrets, usage, the list of known sites. */
  home: string;
  /** Where cloned and newly created sites are put. */
  sitesDir: string;
  /** Folder of starter templates, one folder each. */
  startersDir: string;
  /** Interface the preview proxies bind. Default 127.0.0.1. */
  host?: string;
  /** Hostname browsers use to reach the preview proxies. */
  publicHost?: string;
  /** Fixed ports every preview and baseline proxy is allocated from (GALLEY_PREVIEW_PORTS). */
  previewPorts?: PortRange;
  /** The public URL's scheme, which the preview URLs use too (TLS for them is the reverse proxy's job). */
  publicProtocol?: "http" | "https";
  env?: NodeJS.ProcessEnv;
  /** Local: previews on this computer may post to the form inbox, and its webhooks may reach this computer. Default local. */
  mode?: "local" | "hosted";
  /** The app's address as people reach it (capture address, inbox links in e-mails). Read when needed. */
  appUrl?: () => string | null;
  /** Hosted: the install's one site folder, which sits inside the home on purpose (see SiteRegistryOptions.installSite). */
  installSite?: () => string | null;
  /** Hosted: the live address the install keeps in its own state, used when the site's settings file names none (see SiteDeps.liveUrl). */
  liveUrl?: () => string | null;
  /** Hosted: false, so the preview's package install never adds a lockfile the site doesn't have (see SiteDeps.addLockfile). */
  addLockfile?: boolean;
  /**
   * Hosted: narrows the registry before anything else is given it — the
   * assistant, forms, redirects, the brand — so every part of the engine
   * sees the install's one site and nothing else.
   */
  wrapRegistry?: (registry: SiteRegistry) => SiteRegistry;
  /**
   * Hosted: the preview gateway every site's preview and live comparison are
   * mounted on (gateway.ts), so they are served through the server's one
   * address by hostname. `host`, `publicHost`, `previewPorts` and
   * `publicProtocol` are then unused: a hosted install opens no other port.
   */
  previewGateway?: PreviewGateway;
  /** Told the environment variables plugins name for their secret settings (see PluginSystemOptions.onSecretEnv). */
  onPluginSecretEnv?: (names: string[]) => void;
  /** Optional site lifecycle hooks for compiled-in extensions. */
  siteHooks?: SiteHooks;
  /** Optional assistant turn observer for compiled-in extensions. */
  onAssistantTurn?: (notice: AssistantTurnNotice) => void;
}

export async function createServices(options: ServicesOptions): Promise<Services> {
  const events = createEventBus();
  const env = options.env ?? process.env;
  // One secret store for the app's keys and the plugins' secrets, so writes never race.
  const secrets = createFileSecretStore(options.home);
  // Image providers come from the plugin registry, which is assembled just below (it needs Settings to save the app's own keys).
  let plugins: PluginRegistry | null = null;
  const settings = createSettingsService({ home: options.home, env, secretStore: secrets, imageProviders: () => plugins?.imageProviders() ?? [], videoProviders: () => plugins?.videoProviders() ?? [] });

  plugins = await createPluginSystem({ home: options.home, env, settings, secrets, ...(options.onPluginSecretEnv ? { onSecretEnv: options.onPluginSecretEnv } : {}) });
  const pluginRegistry = plugins;
  const releaseActive = setActivePlugins({ adapters: (root) => pluginRegistry.adapters(root), tools: (root) => pluginRegistry.tools(root) });

  pluginRegistry.subscribe(() => events.emit({ type: "plugins.updated" }));
  const builtInIds = new Set(builtInTargets().map((target) => target.id));
  // Before the registry, so every open site's publishes can start an auto-deploy.
  const deploy = createDeployService({
    home: options.home,
    settings,
    events,
    env: options.env ?? process.env,
    // The built-in hosts, then any a plugin adds (a plugin can't replace a built-in host).
    targets: [...builtInTargets(), ...pluginRegistry.deployTargetObjects().filter((target) => !builtInIds.has(target.id))],
  });
  const mediaStorage = createMediaStorageService({ home: options.home, settings, events, env: options.env ?? process.env, hosted: (options.mode ?? "local") === "hosted" });
  const sites = await createSiteRegistry({
    home: options.home,
    sitesDir: options.sitesDir,
    startersDir: options.startersDir,
    events,
    overlayScript: overlaySource,
    settings,
    host: options.host,
    publicHost: options.publicHost,
    // One pool for the whole server: every site's previews share the operator's range.
    ...(options.previewPorts ? { previewPorts: createPortPool(options.previewPorts) } : {}),
    ...(options.publicProtocol ? { publicProtocol: options.publicProtocol } : {}),
    ...(options.previewGateway ? { previewGateway: options.previewGateway } : {}),
    onPublished: (site, result) => {
      deploy.afterPublish(site, result);
      // Uploads to the bucket the published version now uses stop showing as pending.
      void mediaStorage.afterPublish(site).catch(() => undefined);
    },
    media: mediaStorage,
    // The address the capture service gives out (forms/capture.ts), handed to previewed pages so their forms reach the inbox.
    captureAddress: (siteId) => {
      const app = options.appUrl?.() ?? null;

      return app ? `${app}/f/${encodeURIComponent(siteId)}` : null;
    },
    ...(options.installSite ? { installSite: options.installSite } : {}),
    ...(options.liveUrl ? { liveUrl: () => options.liveUrl?.() ?? null } : {}),
    ...(options.addLockfile === false ? { addLockfile: false } : {}),
    ...(options.siteHooks ? { hooks: options.siteHooks } : {}),
  });
  const images = createImageService({ home: options.home, settings, providers: () => pluginRegistry.imageProviders(), env });
  const videos = createVideoService({ home: options.home, settings, events, providers: () => pluginRegistry.videoProviders() });
  // Every site handed out publishes through the plugins' hooks and loads the plugins its config names.
  const hooked: SiteRegistry = withPluginHooks(sites, pluginRegistry, {
    env,
    onDispose: async () => {
      await videos.dispose();
      await pluginRegistry.dispose();
      redirects.dispose();
      releaseActive();
    },
  });
  const registry = options.wrapRegistry ? options.wrapRegistry(hooked) : hooked;
  const agent = createAgentRuntime({ home: options.home, registry, settings, images, events, env, ...(options.onAssistantTurn ? { onTurn: options.onAssistantTurn } : {}) });

  // afterDeploy and onSubmission hooks follow what the deploy and form modules already announce.
  events.subscribe((event) => {
    const run = async () => {
      if (event.type === "job" && event.job.kind === "deploy" && event.job.state !== "running" && event.job.siteId) {
        const site = await registry.get(event.job.siteId);
        const config = site ? await site.readConfig().catch(() => null) : null;

        if (site) {
          await pluginRegistry.afterDeploy(site, {
            target: config?.deploy?.target ?? "unknown",
            ok: event.job.state === "done",
            ...(event.job.url ? { url: event.job.url } : {}),
            ...(event.job.detail ? { detail: event.job.detail } : {}),
          });
        }
      }
      if (event.type === "forms.submission" && event.change === "added" && event.submission) {
        const site = await registry.get(event.siteId);

        if (site) await pluginRegistry.onSubmission(site, event.submission);
      }
    };

    void run().catch(() => undefined);
  });
  const forms = createFormCapture({
    home: options.home,
    registry,
    events,
    mode: options.mode ?? "local",
    env: options.env ?? process.env,
    ...(options.appUrl ? { appUrl: options.appUrl } : {}),
  });

  const visibility = createVisibilityService({ home: options.home, settings, events, env: options.env ?? process.env });
  const i18n = createI18nService({ settings, events, env: options.env ?? process.env });
  // After the registry: it follows list edits made through any part of the app (the assistant's entry tools, Undo).
  const redirects = createRedirectsService({ home: options.home, settings, events, registry, env: options.env ?? process.env });
  // The site's own brand: its jobs, the material waiting to be saved, the proposal under review.
  const siteBrand = createSiteBrandService({ home: options.home, registry, settings, events, env: options.env ?? process.env });

  const imports = createImportService({ home: options.home });
  // "Host the editor online": only on a computer of the person's own — a hosted install never creates other installs.
  const builtInHosts = builtInEditorHosts();
  const builtInHostIds = new Set(builtInHosts.map((host) => host.id));
  const hosting =
    (options.mode ?? "local") === "local"
      ? createHostingService({ home: options.home, settings, events, env, hosts: [...builtInHosts, ...pluginRegistry.editorHostObjects().filter((host) => !builtInHostIds.has(host.id))] })
      : undefined;

  // Themes saved for everyone here: in the data folder, never in a site.
  const themes = createThemeStore({ home: options.home });

  return { registry, agent, images, settings, events, forms, deploy, mediaStorage, plugins: pluginRegistry, videos, visibility, i18n, redirects, siteBrand, imports, themes, ...(hosting ? { hosting } : {}) };
}

/** The commit author from Settings, as the registry uses it: both name and email, or the machine's git config. */
function authorFrom(settings: Pick<SettingsService, "get">) {
  return async () => {
    try {
      const identity = (await settings.get()).author;

      return identity?.name?.trim() && identity.email?.trim() ? { name: identity.name.trim(), email: identity.email.trim() } : null;
    } catch {
      return null;
    }
  };
}

export interface SingleSiteOptions {
  /** The site's folder. */
  root: string;
  home: string;
  env?: NodeJS.ProcessEnv;
  /** Watch the folder for edits made outside (an editor, a running UI). Default true. */
  watch?: boolean;
}

export interface SingleSiteEngine {
  site: SiteService;
  events: EventBus;
  settings: GalleySettingsService;
  images: GalleyImageService;
  /** The same plugins the server would load, plus the ones this site names. */
  plugins?: PluginRegistry;
  /** Where the site keeps media outside its repository (`galley media`). Uploads through `site` go there too. */
  mediaStorage?: MediaStorageService;
  /** Stops the preview it started and the watcher. */
  dispose(): Promise<void>;
}

/**
 * One site with the same engine pieces the server composes — settings,
 * images and a SiteService with the same id the registry would give it — for
 * `galley mcp`, which serves exactly one checkout and must not need a server.
 * It doesn't add the site to the app's list of sites.
 */
export async function openSingleSite(options: SingleSiteOptions): Promise<SingleSiteEngine> {
  const events = createEventBus();
  const env = options.env ?? process.env;
  const secrets = createFileSecretStore(options.home);
  let plugins: PluginRegistry | null = null;
  const settings = createSettingsService({ home: options.home, env, secretStore: secrets, imageProviders: () => plugins?.imageProviders() ?? [], videoProviders: () => plugins?.videoProviders() ?? [] });

  plugins = await createPluginSystem({ home: options.home, env, settings, secrets });
  const pluginRegistry = plugins;
  const releaseActive = setActivePlugins({ adapters: (root) => pluginRegistry.adapters(root), tools: (root) => pluginRegistry.tools(root) });
  const images = createImageService({ home: options.home, settings, providers: () => pluginRegistry.imageProviders(), env });
  const root = realpathSync(options.root);
  const mediaStorage = createMediaStorageService({ home: options.home, settings, env });
  const raw = await createSiteService(root, {
    id: siteIdFor(root),
    events,
    overlayScript: overlaySource,
    author: authorFrom(settings),
    // The author saved on purpose (App settings › You); the repository's own git settings come before it.
    authorLayers: async () => (await settings.authorLayers?.({ siteId: siteIdFor(root) })) ?? { site: null, app: null },
    watch: options.watch ?? true,
    media: mediaStorage,
  });

  // The site's own plugins are loaded before the first tool list is built, so their tools are offered from the start.
  await ensureSitePlugins(pluginRegistry, raw, env);
  const site = withSiteHooks(raw, pluginRegistry, { env });

  return {
    site,
    events,
    settings,
    images,
    plugins: pluginRegistry,
    mediaStorage,
    dispose: async () => {
      await raw.dispose();
      await pluginRegistry.dispose();
      releaseActive();
    },
  };
}
