/**
 * Pure utilities shared by the built-in JS framework adapters. Uses only the
 * public adapter types and `node:path` (never engine internals), so every
 * built-in adapter stays faithful to the public adapter boundary.
 */
import { posix } from "node:path";

import type { AdapterContext, ModuleExpr, ParsedModule } from "../adapter/types";
import type { EntryFormat } from "../types";

/** Hosts reserved for documentation (RFC 2606): a site configured with one has not been given its real address yet. */
export const PLACEHOLDER_HOST = /(^|\.)example\.(com|net|org)$/i;

/**
 * Normalises a site-relative path (`"./src/"` → `"src"`, `""` / `"."` → `"."`).
 * Returns `null` when the path tries to escape the site folder (`"../..."`) or
 * looks like a Windows drive path, so malformed configs never trip path confinement.
 */
export function safePath(raw: string): string | null {
  const trimmed = raw.trim().replace(/\\/g, "/");

  if (trimmed === "" || /^[A-Za-z]:/.test(trimmed)) return null;
  const stripped = trimmed.replace(/^\/+/, "");
  const normal = posix.normalize(stripped === "" ? "." : stripped).replace(/\/+$/, "");

  if (normal === ".." || normal.startsWith("../")) return null;
  return normal === "" ? "." : normal;
}

/** Joins two site-relative paths safely; returns `null` if either escapes the site root. */
export function joinSafe(dir: string, child: string): string | null {
  const base = safePath(dir);
  const sub = safePath(child);

  if (base === null || sub === null) return null;
  if (base === ".") return sub;
  if (sub === ".") return base;
  return safePath(`${base}/${sub}`);
}

/** Normalises a URL base path (`"/docs/"` → `"/docs"`, `"/"` / `""` → `""`). */
export function normalizeBasePath(raw: string | undefined | null): string {
  if (!raw) return "";
  const trimmed = raw.trim();

  if (trimmed === "" || trimmed === "/") return "";
  const cleaned = `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;

  return cleaned === "/" ? "" : cleaned;
}

/** Applies a base path prefix and trailing-slash preference to a route pattern. */
export function formatRoute(pattern: string, options: { base?: string; trailingSlash?: boolean } = {}): string {
  const base = normalizeBasePath(options.base);
  const trailingSlash = options.trailingSlash ?? true;
  const combined = `${base}/${pattern.replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/");

  if (combined === "/") return "/";
  return trailingSlash ? `${combined.replace(/\/+$/, "")}/` : combined.replace(/\/+$/, "") || "/";
}

/** Validates an `http(s)` URL and returns it without trailing slashes, or `null`. */
export function parseHttpUrl(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();

  if (!/^https?:\/\/[^\s]+$/.test(trimmed)) return null;
  return trimmed.replace(/\/+$/, "");
}

/**
 * Checks whether an HTTP(S) site URL is a real address rather than a
 * documentation placeholder (`example.com`, `example.org`, `example.net`).
 * Emits a plain-words note when a placeholder is ignored.
 */
export function productionUrl(ctx: AdapterContext, rawUrl: string | undefined | null, configFile: string | null, basePath?: string | null): string | undefined {
  const parsed = parseHttpUrl(rawUrl);

  if (!parsed) return undefined;
  let host = "";

  try {
    host = new URL(parsed).hostname;
  } catch {
    return undefined;
  }
  if (PLACEHOLDER_HOST.test(host)) {
    const source = configFile ?? "the config file";

    ctx.note(`The site address in ${source} (${parsed}) is a placeholder, so no live site was set. Change it to the real address to compare previews with the live site.`);
    return undefined;
  }
  const base = normalizeBasePath(basePath);

  if (!base) return parsed;
  try {
    const u = new URL(parsed);

    if (u.pathname === "/" || u.pathname === "") return `${parsed}${base}`;
  } catch {
    return parsed;
  }
  return parsed;
}

/** `process.env.X`, `import.meta.env.X` → `"X"`. */
function envName(expr: ModuleExpr): string | null {
  if (expr.kind === "member" && expr.object.kind === "member" && expr.object.property === "env") return expr.property;
  if (expr.kind === "call" && expr.args[0]) return envName(expr.args[0]);
  return null;
}

/**
 * Reads a literal scalar (`string`, `number`, `boolean`), `new URL("./x", ...)`,
 * or the fallback of `process.env.X || "default"` / `??`.
 */
export function readScalar(module: ParsedModule, expr: ModuleExpr | undefined): { value: string | number | boolean; env: string | null } | null {
  if (!expr) return null;
  const resolved = module.resolve(expr);
  const plain = module.literal(resolved);

  if (typeof plain === "string" || typeof plain === "number" || typeof plain === "boolean") return { value: plain, env: null };
  if (resolved.kind === "new" && module.callee(resolved) === "URL") {
    const path = module.string(resolved.args[0]);

    return path === null ? null : { value: path, env: null };
  }
  if (resolved.kind === "logical") {
    const fallback = readScalar(module, resolved.right);

    if (!fallback) return null;
    return { value: fallback.value, env: envName(module.resolve(resolved.left)) ?? fallback.env ?? "" };
  }
  return null;
}

/** Reads a string value from a module expression, noting any env fallback used. */
export function readStringProp(module: ParsedModule, obj: ModuleExpr | undefined, key: string, what: string, file: string, notes: string[]): string | undefined {
  if (!obj) return undefined;
  const found = readScalar(module, module.prop(obj, key));

  if (!found || typeof found.value !== "string") return undefined;
  if (found.env !== null) {
    notes.push(
      found.env
        ? `${file} takes the ${what} from ${found.env} when that is set; its fallback, ${found.value}, was used.`
        : `${file} computes the ${what}; its fallback, ${found.value}, was used.`
    );
  }
  return found.value;
}

/** Reads a boolean value from a module expression, noting any env fallback used. */
export function readBooleanProp(module: ParsedModule, obj: ModuleExpr | undefined, key: string, what: string, file: string, notes: string[]): boolean | undefined {
  if (!obj) return undefined;
  const found = readScalar(module, module.prop(obj, key));

  if (!found || typeof found.value !== "boolean") return undefined;
  if (found.env !== null) {
    notes.push(
      found.env
        ? `${file} takes the ${what} from ${found.env} when that is set; its fallback, ${String(found.value)}, was used.`
        : `${file} computes the ${what}; its fallback, ${String(found.value)}, was used.`
    );
  }
  return found.value;
}

/** Reads a positive integer port number from a module expression, noting any env fallback used. */
export function readPortProp(module: ParsedModule, obj: ModuleExpr | undefined, key: string, file: string, notes: string[]): number | undefined {
  if (!obj) return undefined;
  const found = readScalar(module, module.prop(obj, key));

  if (!found || typeof found.value !== "number" || !Number.isInteger(found.value) || found.value <= 0 || found.value >= 65536) return undefined;
  if (found.env !== null) {
    notes.push(
      found.env
        ? `${file} takes the dev server port from ${found.env} when that is set; its fallback, ${found.value}, was used.`
        : `${file} computes the dev server port; its fallback, ${found.value}, was used.`
    );
  }
  return found.value;
}

/** Reads an array of strings from a module expression (skipping non-string elements). */
export function readStringArray(module: ParsedModule, expr: ModuleExpr | undefined): string[] | null {
  if (!expr) return null;
  const resolved = module.resolve(expr);

  if (resolved.kind !== "array") return null;
  const out: string[] = [];

  for (const item of resolved.items) {
    const value = module.string(item);

    if (value !== null) out.push(value);
  }
  return out;
}

/**
 * Extracts a relative path from common JS config path expressions:
 * - `"./docs"` / `"docs"`
 * - `path.resolve(__dirname, "docs")` / `resolve(__dirname, "content", "docs")`
 * - `path.join(process.cwd(), "docs")`
 * - `new URL("./docs", import.meta.url)`
 */
export function readPathExpr(module: ParsedModule, expr: ModuleExpr | undefined): string | null {
  if (!expr) return null;
  const resolved = module.resolve(expr);
  const direct = module.string(resolved);

  if (direct !== null) return safePath(direct);
  if (resolved.kind === "new" && module.callee(resolved) === "URL") {
    const inner = module.string(resolved.args[0]);

    return inner === null ? null : safePath(inner);
  }
  if (resolved.kind === "call") {
    const callee = module.callee(resolved);

    if (callee === "fileURLToPath" && resolved.args[0]) return readPathExpr(module, resolved.args[0]);
    if (callee && /(?:^|\.)(?:resolve|join)$/.test(callee)) {
      const parts: string[] = [];

      for (const arg of resolved.args) {
        const str = module.string(arg);

        if (str !== null) parts.push(str);
      }
      if (parts.length > 0) return safePath(parts.join("/"));
    }
  }
  return null;
}

export interface GlobTarget {
  /** Site-relative folder (or file when `isSingleFile` is true). */
  path: string;
  /** Glob pattern relative to `path`, omitted for single-file data targets. */
  pattern?: string;
  isSingleFile: boolean;
}

const HAS_GLOB = /[*?[\]{}!]/;
const KNOWN_FILE_EXT = /\.(md|mdx|markdown|mdown|mkd|svx|json|ya?ml|toml)$/i;

/**
 * Splits a framework content glob (e.g. `"blog/**\/*.mdx"`, `"authors/**.json"`,
 * `"data/site.yml"`) relative to `baseDir` into a folder `path` + relative `pattern`
 * (or a single-file data target). Returns `null` when the pattern escapes the site.
 */
export function splitGlobPattern(baseDir: string, rawPattern: string, defaultPattern: string): GlobTarget | null {
  const cleaned = rawPattern.trim().replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");

  if (cleaned === "" || /^[A-Za-z]:/.test(cleaned)) return null;
  const segments = cleaned.split("/").filter(Boolean);

  if (segments.some((segment) => segment === "..")) return null;
  const firstGlob = segments.findIndex((segment) => HAS_GLOB.test(segment));

  if (firstGlob === -1) {
    const full = joinSafe(baseDir, segments.join("/"));

    if (full === null) return null;
    if (KNOWN_FILE_EXT.test(full)) return { path: full, isSingleFile: true };
    return { path: full, pattern: defaultPattern, isSingleFile: false };
  }
  const staticDir = segments.slice(0, firstGlob).join("/");
  const path = staticDir ? joinSafe(baseDir, staticDir) : safePath(baseDir);

  if (path === null) return null;
  let pattern = segments.slice(firstGlob).join("/");

  if (pattern === "**" || pattern === "*" || pattern === "**/*") {
    pattern = defaultPattern;
  } else {
    // Nuxt Content v3 shorthand `**.json` / `blog/**.md` → standard `**/*.json`.
    pattern = pattern.replace(/(^|\/)\*\*\.([A-Za-z0-9{,}]+)$/, "$1**/*.$2");
  }
  return { path, pattern, isSingleFile: false };
}

/** Infers an `EntryFormat` from a glob pattern or file path, with a fallback. */
export function formatFromPattern(pattern: string | undefined, fallback: EntryFormat = "markdown"): EntryFormat {
  if (!pattern) return fallback;
  if (/\bmdx\b/i.test(pattern) && !/\bmd\b|markdown|\bsvx\b/i.test(pattern)) return "mdx";
  if (/\bmd\b|markdown|\bmdx\b|\bsvx\b/i.test(pattern)) return "markdown";
  if (/\bjson\b/i.test(pattern)) return "json";
  if (/\bya?ml\b/i.test(pattern)) return "yaml";
  if (/\btoml\b/i.test(pattern)) return "toml";
  return fallback;
}

/** Picks `"mdx"` when a folder holds more `.mdx` files than `.md` files, else `"markdown"`. */
export function markdownFormatForFiles(files: readonly string[]): "markdown" | "mdx" {
  let mdx = 0;
  let md = 0;

  for (const file of files) {
    if (/\.mdx$/i.test(file)) mdx += 1;
    else md += 1;
  }
  return mdx > md ? "mdx" : "markdown";
}

/** Checks whether a folder has any files matching a glob pattern (fast, capped at 1). */
export function hasMatchingFiles(ctx: AdapterContext, dir: string, pattern: string): boolean {
  if (!ctx.isDirectory(dir)) return false;
  return ctx.glob(pattern, { cwd: dir === "." ? undefined : dir, limit: 1 }).length > 0;
}

/** Sanitizes a framework name/folder into a valid lowercase collection id. */
export function toCollectionId(raw: string): string {
  const id = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return id || "content";
}
