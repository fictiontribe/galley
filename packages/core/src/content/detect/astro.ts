/**
 * The engine's long-standing Astro entry points, kept with their original
 * signatures. The Astro knowledge itself lives in the Astro adapter
 * (src/adapters/astro); these read a source string with it.
 */
import { parseModule } from "../../adapter/context";
import { analyzeContentConfig, readAstroSiteValues } from "../../adapters/astro/index";
import { objectFields } from "./zod";
import type { Expr } from "./js/parse";

export type { AstroCollectionDecl, AstroConfigAnalysis, AstroLoader } from "../../adapters/astro/index";

const helpers = { fieldsFromZod: (expr: Expr, module: { scope: ReadonlyMap<string, Expr> }) => objectFields(expr, module.scope as Map<string, Expr>) };

/** Collections declared in an Astro content config, read without running it. */
export function analyzeAstroConfig(source: string): ReturnType<typeof analyzeContentConfig> {
  return analyzeContentConfig(parseModule(source), helpers);
}

/** Reads values plainly written in astro.config.*: site, trailingSlash, outDir, server.port. */
export function analyzeAstroSiteConfig(source: string): { site?: string; trailingSlash?: string; outDir?: string; port?: number } {
  const values = readAstroSiteValues(parseModule(source), "astro.config");
  const out: { site?: string; trailingSlash?: string; outDir?: string; port?: number } = {};

  if (values.site) out.site = values.site;
  if (values.trailingSlash) out.trailingSlash = values.trailingSlash;
  if (values.outDir) out.outDir = values.outDir;
  if (values.port !== undefined) out.port = values.port;
  return out;
}
