/**
 * @galley/core/adapter — the public adapter API.
 *
 * An adapter is a plain object (`GalleyAdapter`) that tells the engine how to
 * recognise a site, where its collections live, how URLs map to entries and
 * how to run it. The built-in adapters (Astro first) are written against
 * exactly this surface. Authoring guide: docs/adapters.md.
 */
export type {
  AdapterContext,
  AdapterConventions,
  AdapterHelpers,
  AdapterMatch,
  CollectionDraft,
  ConventionAdapterSpec,
  FileRouteOptions,
  GalleyAdapter,
  MarkdownCollectionOptions,
  MaybePromise,
  ModuleExpr,
  PackageJsonLike,
  ParsedModule,
  RouteFile,
} from "./types";
export { ADAPTER_API_VERSION, conventionAdapter, defineAdapter, mergeConventions } from "./define";
export { parseModule } from "./context";
export { adapterFromModule, loadSiteAdapters, validateAdapter, type AdapterCheck, type LoadedAdapters } from "./load";

// The engine side, for tools that test adapters (the conformance kit) or list them.
export { runDetection as detectWithAdapters, type DetectionCandidate, type DetectionRun, type DetectOptions } from "../content/detect/detect";
export { outsideBuiltFrom } from "../content/detect/built-from";
export { BUILTIN_ADAPTERS, astroAdapter, docusaurusAdapter, eleventyAdapter, genericAdapter, hugoAdapter, jekyllAdapter, nextAdapter, nuxtAdapter, sveltekitAdapter } from "../adapters/index";
