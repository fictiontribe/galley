/**
 * @galleycms/adapter-kit — what a Galley adapter author installs as a dev
 * dependency: the adapter types, `defineAdapter` / `conventionAdapter`, and
 * `checkAdapter`, the conformance check that says whether an adapter is
 * correct. For vitest users, `describeAdapter` lives in
 * `@galleycms/adapter-kit/vitest`; without vitest, run `galley-adapter-check`.
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
} from "@galley/core/adapter";
export type { Collection, Field, FieldType, SiteModel } from "@galley/core/types";
export { ADAPTER_API_VERSION, conventionAdapter, defineAdapter, parseModule, validateAdapter } from "@galley/core/adapter";
export { CHECKS, checkAdapter, checksFor, FOREIGN_FIXTURES, formatReport, type AdapterExpectations, type AdapterReport, type CheckId, type CheckResult, type CheckStatus } from "./check";
