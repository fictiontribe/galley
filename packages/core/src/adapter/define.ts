/**
 * The two ways to write an adapter: `defineAdapter` (any hooks you like) and
 * `conventionAdapter` (the framework is recognised by a dependency or a file
 * and its content lives in conventional folders). Both return plain objects.
 * This file imports nothing from the engine, so it costs an adapter nothing.
 */
import type { AdapterContext, AdapterConventions, AdapterMatch, ConventionAdapterSpec, GalleyAdapter } from "./types";

/**
 * The adapter API version this engine speaks. An adapter may declare the
 * version it was written for as `apiVersion`; a mismatch is reported in the
 * site's notes rather than refused.
 */
export const ADAPTER_API_VERSION = 1;

/** Identity. Exists so an adapter written in TypeScript is checked against `GalleyAdapter`. */
export function defineAdapter<T extends GalleyAdapter>(adapter: T): T {
  return adapter;
}

const CONVENTION_KEYS = ["dev", "build", "publicDir", "media", "urls", "trailingSlash", "routesDir", "contentDirs", "pageDirs", "dataDirs", "contentUrls"] as const;

/** Later values win; the object-valued conventions (dev, build, media, urls) merge one level deep. */
export function mergeConventions(base: AdapterConventions, extra: AdapterConventions | null | undefined): AdapterConventions {
  if (!extra) return base;
  const out: AdapterConventions = { ...base };

  for (const key of CONVENTION_KEYS) {
    const value = extra[key];

    if (value === undefined) continue;
    const current = out[key];

    if (value !== null && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object" && !Array.isArray(current)) {
      (out as Record<string, unknown>)[key] = { ...current, ...value };
    } else {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

/**
 * Recognised by a dependency in package.json or a file at the root:
 * dependency and file 0.95, dependency 0.9, file 0.8.
 */
function conventionalDetect(spec: ConventionAdapterSpec, ctx: AdapterContext): AdapterMatch | null {
  const pkg = (spec.packages ?? []).find((name) => ctx.hasDependency(name) !== null);
  const file = (spec.files ?? []).find((name) => ctx.exists(name));

  if (!pkg && !file) return null;
  if (spec.requires && !spec.requires(ctx)) return null;
  const version = pkg ? ctx.dependencyVersion(pkg) : null;
  const confidence = pkg && file ? 0.95 : pkg ? 0.9 : 0.8;

  return version ? { confidence, version } : { confidence };
}

/**
 * The fastest way to write an adapter: say how the framework is recognised
 * and where its things live; content is found by conventional discovery
 * over `contentDirs`. Any hook in the spec is used as well (`conventions`
 * is merged over the static values; the others are passed through).
 */
export function conventionAdapter(spec: ConventionAdapterSpec): GalleyAdapter {
  const fixed: AdapterConventions = {};

  for (const key of CONVENTION_KEYS) {
    if (spec[key] !== undefined) (fixed as Record<string, unknown>)[key] = spec[key];
  }
  const adapter: GalleyAdapter = {
    id: spec.id,
    name: spec.name,
    ...(spec.apiVersion !== undefined ? { apiVersion: spec.apiVersion } : {}),
    detect: spec.detect ? (ctx) => spec.detect!(ctx) : (ctx) => conventionalDetect(spec, ctx),
    conventions: spec.conventions
      ? async (ctx) => mergeConventions(fixed, await spec.conventions!(ctx))
      : () => fixed,
  };

  if (spec.collections) adapter.collections = (ctx) => spec.collections!(ctx);
  if (spec.routes) adapter.routes = (ctx, collections) => spec.routes!(ctx, collections);
  if (spec.environment) adapter.environment = (ctx) => spec.environment!(ctx);
  if (spec.forgetPreviewSaves) adapter.forgetPreviewSaves = (ctx) => spec.forgetPreviewSaves!(ctx);
  return adapter;
}
