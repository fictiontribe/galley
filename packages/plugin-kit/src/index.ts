/**
 * @galleycms/plugin-kit — what a plugin author installs: the plugin types,
 * `definePlugin`, `ProviderError` (the error a provider throws for a plain
 * message), `resolveScriptSnippet`, and `checkPlugin` — the checks that say
 * whether a plugin is correct. For vitest, `describePlugin` lives in
 * `@galleycms/plugin-kit/vitest`. Guide: docs/plugins.md.
 */
export type {
  BeforePublishResult,
  DataSourceContext,
  DataSourceContribution,
  DataSourceItem,
  DeploymentInfo,
  DeployTargetContribution,
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
  ThemeContribution,
  ToolCallContext,
  ToolInputProperty,
  ToolInputSchema,
  ToolResult,
  VideoAspect,
  VideoGenerationRequest,
  VideoJobState,
  VideoModelInfo,
  VideoProviderPlugin,
} from "@galley/core/plugins";
export type { GalleyAdapter } from "@galley/core/adapter";
export type { ChangeSet, ImageAspect, JsonValue, PublishResult, SiteService } from "@galley/core/types";
export type { FormDestination, FormSubmission } from "@galley/core/kit";
export { definePlugin, isProviderError, PLUGIN_API_VERSION, ProviderError, resolveScriptSnippet, validatePlugin } from "@galley/core/plugins";
export { checkPlugin, formatPluginReport, TEST_KEY, type CheckResult, type CheckStatus, type PluginCheckOptions, type PluginReport } from "./check";
export { summarizePlugin } from "./summary";
export { fakeFetch, json, providerContext, testContext, type FakeFetch, type FakeRoute, type RecordedRequest, type TestContext, type TestContextOptions } from "./testing";
