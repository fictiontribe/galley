/**
 * @galley/core/plugins — the plugin system: the public plugin API (types,
 * `definePlugin`, `ProviderError`), the registry every contribution is
 * looked up through, loading (built-in, installed, site-named) and the
 * trust rules. Guide: docs/plugins.md. Authors use `@galley/plugin-kit`,
 * which re-exports the public part of this.
 */
export type {
  BeforePublishResult,
  DataSourceContext,
  DataSourceContribution,
  DataSourceItem,
  DeploymentInfo,
  DeployTargetContribution,
  EditorHostContribution,
  ThemeContribution,
  FormFieldInfo,
  FormForwardContext,
  FormProviderContribution,
  GalleyPlugin,
  GeneratedImageResult,
  ImageGenerationRequest,
  ImageModelInfo,
  ImageProviderPlugin,
  ImporterContribution,
  ImporterIo,
  MaybePromise,
  PluginBrand,
  PluginContext,
  PluginHooks,
  PluginLogger,
  PluginSettingField,
  PluginSettingKind,
  PluginSettingOption,
  ProviderCallContext,
  ProviderErrorKind,
  ScriptIntegrationContribution,
  SitePluginContext,
  SiteToolContribution,
  ToolCallContext,
  ToolInputProperty,
  ToolInputSchema,
  ToolResult,
  VideoAspect,
  VideoGenerationRequest,
  VideoJobState,
  VideoModelInfo,
  VideoProviderPlugin,
} from "./types";
export { definePlugin, isProviderError, PLUGIN_API_VERSION, ProviderError, resolveScriptSnippet } from "./define";
export { CONVENTIONAL_NAME, pluginFromModule, validatePlugin, type PluginCheck, type ValidateOptions } from "./validate";
export {
  createPluginRegistry,
  HOOK_TIMEOUT_MS,
  isSwitchOn,
  type DataSourceInfo,
  RESERVED_TOOLS,
  type DeployTargetSummary,
  type EditorHostSummary,
  type ImporterInfo,
  type PluginEvent,
  type PluginInfoSync,
  type PluginRegistry,
  type PluginRegistryOptions,
  type RegisterOptions,
  type ResolvedFormProvider,
  type ResolvedScriptIntegration,
} from "./registry";
export { createPluginLogger, createPluginSettingsStore, envNamesFor, secretNameFor, type PluginSettingsOptions, type PluginSettingsStore, type PluginSettingStatus, type SettingsOwner } from "./settings";
export { builtinPlugin, BUILTIN_PLUGIN_NAME, wordpressImporterPlugin } from "./builtin";
export { activePlugins, hostedMode, setActivePlugins, setHostedMode, type ActivePlugins } from "./active";
export { ensureSitePlugins, importSitePlugin, siteExtensions, sitePluginPolicy, type SitePluginPolicy } from "./site";
export { checkPublish, withPluginHooks, withSiteHooks } from "./hooks";
export { installPlugin, loadInstalledPlugins, pluginsDir, PLUGIN_KEYWORD, readInstalled, removePlugin, setPluginEnabled, type InstalledPlugin, type InstallOptions, type InstallResult } from "./install";
export { adaptTool, objectSchema, scopedSite } from "./tools";
export { imageHandle, videoHandle, type ContributionOwner, type VideoProviderHandle } from "./adapt";
export { builtinImageHandles } from "./defaults";
