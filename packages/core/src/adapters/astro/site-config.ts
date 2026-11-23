/**
 * The values of `astro.config.*` that shape where things live and how URLs
 * look, read statically: srcDir, publicDir, outDir, base, site,
 * trailingSlash, build.format and server.port. A value written as
 * `process.env.X || "fallback"` reads as its fallback (what a plain local run
 * uses), with a note saying so.
 */
import type { ModuleExpr, ParsedModule } from "../../adapter/types";

export const ASTRO_CONFIG_FILES = ["astro.config.mjs", "astro.config.ts", "astro.config.js", "astro.config.mts", "astro.config.cjs"];

export interface AstroSiteValues {
  srcDir?: string;
  publicDir?: string;
  outDir?: string;
  base?: string;
  site?: string;
  trailingSlash?: string;
  buildFormat?: string;
  port?: number;
  /** Plain-words remarks about how values were read. */
  notes: string[];
}

/** `process.env.X`, `import.meta.env.X` → "X". */
function envName(module: ParsedModule, expr: ModuleExpr): string | null {
  if (expr.kind === "member") {
    const object = expr.object;

    if (object.kind === "member" && object.property === "env") return expr.property;
  }
  if (expr.kind === "call") {
    // `Number(process.env.PORT)`, `String(…)`
    const inner = expr.args[0];

    return inner ? envName(module, inner) : null;
  }
  return null;
}

/** A literal, or the literal fallback of `a || b` / `a ?? b`, with the variable it stands in for. */
function valueOf(module: ParsedModule, expr: ModuleExpr | undefined): { value: string | number | boolean; env: string | null } | null {
  if (!expr) return null;
  const resolved = module.resolve(expr);
  const plain = module.literal(resolved);

  if (typeof plain === "string" || typeof plain === "number" || typeof plain === "boolean") return { value: plain, env: null };
  if (resolved.kind === "new" && module.callee(resolved) === "URL") {
    const path = module.string(resolved.args[0]);

    return path === null ? null : { value: path, env: null };
  }
  if (resolved.kind === "logical") {
    const fallback = valueOf(module, resolved.right);

    if (!fallback) return null;
    return { value: fallback.value, env: envName(module, module.resolve(resolved.left)) ?? fallback.env ?? "" };
  }
  return null;
}

export function readAstroSiteValues(module: ParsedModule, file: string): AstroSiteValues {
  const out: AstroSiteValues = { notes: [] };
  const config = module.configObject();

  if (!config) return out;
  const read = (expr: ModuleExpr | undefined, what: string): string | number | boolean | undefined => {
    const found = valueOf(module, expr);

    if (!found) return undefined;
    if (found.env !== null) {
      out.notes.push(
        found.env
          ? `${file} takes the ${what} from ${found.env} when that is set; its fallback, ${String(found.value)}, was used.`
          : `${file} computes the ${what}; its fallback, ${String(found.value)}, was used.`
      );
    }
    return found.value;
  };
  const text = (key: string, what: string): string | undefined => {
    const value = read(module.prop(config, key), what);

    return typeof value === "string" ? value : undefined;
  };
  const srcDir = text("srcDir", "source folder");
  const publicDir = text("publicDir", "public folder");
  const outDir = text("outDir", "build folder");
  const base = text("base", "base path");
  const site = text("site", "site address");
  const trailingSlash = text("trailingSlash", "trailing-slash setting");
  const build = module.prop(config, "build");
  const buildFormat = build ? read(module.prop(build, "format"), "build format") : undefined;
  const server = module.prop(config, "server");
  const port = server ? read(module.prop(server, "port"), "dev server port") : undefined;

  if (srcDir) out.srcDir = srcDir;
  if (publicDir) out.publicDir = publicDir;
  if (outDir) out.outDir = outDir;
  if (base) out.base = base;
  if (site) out.site = site;
  if (trailingSlash) out.trailingSlash = trailingSlash;
  if (typeof buildFormat === "string") out.buildFormat = buildFormat;
  if (typeof port === "number" && Number.isInteger(port) && port > 0) out.port = port;
  return out;
}
