/**
 * The AdapterContext the engine hands every hook: read-only, root-confined
 * file access and the shared building blocks. Engine-side code — adapters
 * only ever see the `AdapterContext` interface.
 */
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, posix, relative, sep } from "node:path";

import { globSync } from "tinyglobby";

import type { Collection, JsonValue } from "../types";
import { discoverDataCollections, discoverMarkdownCollections } from "../content/detect/generic";
import { calleeName, parseProgram, propOf, resolve, type Expr, type Program } from "../content/detect/js/parse";
import { routeOwner, scanRoutes, urlPatternFromRoutes } from "../content/detect/routes";
import { objectFields } from "../content/detect/zod";
import { formatForPath, parseJsonText, parseTomlText, parseYamlText } from "../content/document/parse";
import { IGNORED_DIRS } from "../content/entries/files";
import { isObject } from "../content/util/json";
import { collectionNames } from "../content/util/text";
import type { AdapterContext, AdapterConventions, AdapterHelpers, CollectionDraft, MarkdownCollectionOptions, PackageJsonLike, ParsedModule } from "./types";

/** Text files bigger than this are not configs or content an adapter needs to read. */
export const MAX_READ_BYTES = 2_000_000;
const DEFAULT_GLOB_LIMIT = 5000;
const IMPORT_DEPTH = 3;
const IMPORT_EXTENSIONS = ["", ".ts", ".mts", ".js", ".mjs", ".cjs", ".json", "/index.ts", "/index.mts", "/index.js", "/index.mjs"];

/** Thrown when an adapter asks for a path outside the site folder — a bug in the adapter, not in the site. */
export class OutsideSiteError extends Error {
  constructor(path: string) {
    super(`“${path}” is outside the site folder. Adapters can only read inside it; use a path relative to the site root.`);
    this.name = "OutsideSiteError";
  }
}

// ─────────────────────────────────────────────────────────── parsed modules

function literalOf(expr: Expr | undefined, scope: Map<string, Expr>, depth = 0): JsonValue | undefined {
  if (!expr || depth > 20) return undefined;
  const value = resolve(expr, scope);

  switch (value.kind) {
    case "string":
      return value.value;
    case "number":
      return value.value;
    case "bool":
      return value.value;
    case "null":
      return null;
    case "array": {
      const items = value.items.map((item) => literalOf(item, scope, depth + 1));

      return items.every((item) => item !== undefined) ? (items as JsonValue[]) : undefined;
    }
    case "object": {
      const out: { [key: string]: JsonValue } = {};

      for (const prop of value.props) {
        if (!("key" in prop)) return undefined;
        const inner = literalOf(prop.value, scope, depth + 1);

        if (inner === undefined) return undefined;
        out[prop.key] = inner;
      }
      return out;
    }
    default:
      return undefined;
  }
}

/** A JSON value as an expression, so an imported `.json` file reads like an object literal. */
export function exprFromJson(value: JsonValue): Expr {
  if (value === null) return { kind: "null" };
  if (typeof value === "string") return { kind: "string", value };
  if (typeof value === "number") return { kind: "number", value };
  if (typeof value === "boolean") return { kind: "bool", value };
  if (Array.isArray(value)) return { kind: "array", items: value.map(exprFromJson) };
  return { kind: "object", props: Object.entries(value).map(([key, inner]) => ({ key, value: exprFromJson(inner) })) };
}

export function toParsedModule(program: Program): ParsedModule {
  const scope = program.scope;
  const exported = (name: string): Expr | undefined => {
    const local = program.exports.get(name);
    const value = local === undefined ? undefined : scope.get(local);

    return value ? resolve(value, scope) : undefined;
  };

  return {
    scope,
    exports: program.exports,
    imports: program.imports,
    exported,
    configObject() {
      let expr = exported("default");

      for (let guard = 0; expr && guard < 6; guard += 1) {
        expr = resolve(expr, scope);
        if (expr.kind === "object") return expr;
        if (expr.kind === "call" && expr.args[0]) expr = expr.args[0];
        else if (expr.kind === "arrow") expr = expr.body;
        else return undefined;
      }
      return undefined;
    },
    resolve: (expr) => resolve(expr, scope),
    prop(expr, key) {
      if (!expr) return undefined;
      const value = propOf(resolve(expr, scope), key);

      return value ? resolve(value, scope) : undefined;
    },
    string(expr) {
      const value = expr ? resolve(expr, scope) : undefined;

      return value?.kind === "string" ? value.value : null;
    },
    number(expr) {
      const value = expr ? resolve(expr, scope) : undefined;

      return value?.kind === "number" ? value.value : null;
    },
    boolean(expr) {
      const value = expr ? resolve(expr, scope) : undefined;

      return value?.kind === "bool" ? value.value : null;
    },
    literal: (expr) => literalOf(expr, scope),
    callee(expr) {
      const value = expr ? resolve(expr, scope) : undefined;

      return value && (value.kind === "call" || value.kind === "new") ? calleeName(value.callee) : null;
    },
  };
}

export function parseModule(source: string): ParsedModule {
  return toParsedModule(parseProgram(source));
}

/** The underlying scope, for the engine's zod reader (which only reads it). */
function scopeOf(module: ParsedModule): Map<string, Expr> {
  return module.scope as Map<string, Expr>;
}

// ─────────────────────────────────────────────────────────── the context

interface ContextState {
  conventions: AdapterConventions;
}

const states = new WeakMap<AdapterContext, ContextState>();

/** Lets the helpers default to the conventions the adapter declared. */
export function setContextConventions(ctx: AdapterContext, conventions: AdapterConventions): void {
  const state = states.get(ctx);

  if (state) state.conventions = conventions;
}

function within(parent: string, child: string): boolean {
  const rel = relative(parent, child);

  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Shared across the contexts of one detection: the package.json and file reads. */
export interface ContextShared {
  root: string;
  realRoot: string;
  packageJson: PackageJsonLike | null;
  texts: Map<string, string | null>;
}

export function createShared(root: string, packageJson: PackageJsonLike | null): ContextShared {
  let realRoot = root;

  try {
    realRoot = realpathSync(root);
  } catch {
    realRoot = root;
  }
  return { root, realRoot, packageJson, texts: new Map() };
}

/**
 * A context whose notes go to `sink`. Each adapter gets its own during
 * selection, so only the chosen adapter's notes reach the site's notes.
 */
export function createAdapterContext(shared: ContextShared, sink: string[]): AdapterContext {
  const { root } = shared;
  const state: ContextState = { conventions: {} };

  /** A repo-relative POSIX path ("" for the root). Throws for anything outside the site. */
  const confine = (path: string): string => {
    let rel = path.replace(/\\/g, "/");

    if (isAbsolute(path)) {
      const fromRoot = relative(root, path);

      if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new OutsideSiteError(path);
      rel = fromRoot.split(sep).join("/");
    }
    const normal = posix.normalize(rel === "" ? "." : rel);

    if (normal === ".." || normal.startsWith("../") || posix.isAbsolute(normal)) throw new OutsideSiteError(path);
    return normal === "." ? "" : normal.replace(/\/+$/, "");
  };
  const full = (rel: string): string => (rel === "" ? root : join(root, ...rel.split("/")));
  const statOf = (path: string) => {
    try {
      return statSync(full(confine(path)));
    } catch (error) {
      if (error instanceof OutsideSiteError) throw error;
      return null;
    }
  };
  const readText = (path: string): string | null => {
    const rel = confine(path);

    if (shared.texts.has(rel)) return shared.texts.get(rel)!;
    let text: string | null = null;

    try {
      const file = full(rel);
      const info = statSync(file);

      // A package manager links node_modules elsewhere on disk; anything else must really be inside the site.
      if (info.isFile() && info.size <= MAX_READ_BYTES && (rel.split("/").includes("node_modules") || within(shared.realRoot, realpathSync(file)))) {
        text = readFileSync(file, "utf8");
      }
    } catch {
      text = null;
    }
    shared.texts.set(rel, text);
    return text;
  };
  const readJson = <T = unknown>(path: string): T | null => {
    const text = readText(path);

    if (text === null) return null;
    try {
      return JSON.parse(text.replace(/^﻿/, "")) as T;
    } catch {
      return null;
    }
  };
  const readData = (path: string): JsonValue | null => {
    const text = readText(path);
    const format = formatForPath(path);

    if (text === null) return null;
    if (format === "json") return parseJsonText(text.replace(/^﻿/, "")).value;
    if (format === "yaml") return parseYamlText(text).value;
    if (format === "toml") return parseTomlText(text).value;
    return null;
  };
  const list = (path: string): string[] => {
    try {
      return readdirSync(full(confine(path)), { withFileTypes: true })
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .sort((a, b) => a.localeCompare(b));
    } catch (error) {
      if (error instanceof OutsideSiteError) throw error;
      return [];
    }
  };
  const isDirectory = (path: string): boolean => statOf(path)?.isDirectory() ?? false;
  const deps = (): Record<string, string> => ({ ...shared.packageJson?.dependencies, ...shared.packageJson?.devDependencies });
  const hasDependency = (name: string): string | null => {
    const value = deps()[name];

    return typeof value === "string" ? value : null;
  };
  const note = (message: string): void => {
    if (typeof message === "string" && message.trim() !== "") sink.push(message.trim());
  };

  const readModuleFile = (path: string, depth: number, seen: Set<string>): Program | null => {
    const text = readText(path);

    if (text === null) return null;
    const program = parseProgram(text);

    seen.add(confine(path));
    if (depth >= IMPORT_DEPTH) return program;
    const dir = posix.dirname(confine(path));

    for (const [local, { from, imported }] of program.imports) {
      if (!from.startsWith(".") || program.scope.has(local)) continue;
      let target: string | null = null;

      try {
        const base = posix.normalize(posix.join(dir === "" ? "." : dir, from));

        target = IMPORT_EXTENSIONS.map((ext) => `${base}${ext}`).find((candidate) => statOf(candidate)?.isFile()) ?? null;
      } catch {
        target = null;
      }
      if (!target || seen.has(confine(target))) continue;
      if (target.endsWith(".json")) {
        const data = readData(target);

        if (data === null) continue;
        const expr = exprFromJson(data);
        const value = imported === "default" || imported === "*" ? expr : propOf(expr, imported);

        if (value) program.scope.set(local, value);
        continue;
      }
      const sub = readModuleFile(target, depth + 1, seen);

      if (!sub) continue;
      if (imported === "*") {
        program.scope.set(local, { kind: "object", props: [...sub.exports].flatMap(([name, inner]) => (sub.scope.has(inner) ? [{ key: name, value: sub.scope.get(inner)! }] : [])) });
      } else {
        const value = sub.scope.get(sub.exports.get(imported) ?? imported);

        if (value) program.scope.set(local, value);
      }
      // The imported value may name other bindings of its own module; local names win a clash.
      for (const [name, value] of sub.scope) {
        if (name !== "default" && !program.scope.has(name) && !program.imports.has(name)) program.scope.set(name, value);
      }
    }
    return program;
  };

  const markdownCollections = (options: MarkdownCollectionOptions = {}): CollectionDraft[] => {
    const conventions = state.conventions;
    const existing = (dirs: string[]): string[] => dirs.filter((dir) => dir === "." || isDirectory(dir));
    const contentRoots = existing(options.roots ?? conventions.contentDirs ?? ["."]);
    const roots = contentRoots.length > 0 ? contentRoots : ["."];
    const pageRoots = existing(options.pageDirs ?? conventions.pageDirs ?? []);
    const trailingSlash = options.trailingSlash ?? conventions.trailingSlash ?? true;
    const mode = options.urls ?? conventions.contentUrls ?? "folders";
    const slash = (pattern: string): string => (trailingSlash ? pattern : pattern.replace(/\/$/, "") || "/");
    const found = discoverMarkdownCollections(root, {
      roots: roots.map(confine).map((dir) => dir || "."),
      pageRoots: pageRoots.map(confine).map((dir) => dir || "."),
      claimed: (options.claimed ?? []).map(confine),
      urlFor: (dir, isPages) => {
        if (mode === "none") return null;
        if (isPages) return slash("/{slug}/");
        const owner = roots.find((rootDir) => rootDir !== "." && (dir === rootDir || dir.startsWith(`${rootDir}/`)));
        const inner = (owner ? dir.slice(owner.length).replace(/^\//, "") : dir).replace(/^_+/, "");

        return slash(inner ? `/${inner}/{slug}/` : "/{slug}/");
      },
    });

    return found.map(draftFromCollection);
  };

  const helpers: AdapterHelpers = {
    markdownCollections,
    dataCollections(dirs, options = {}) {
      return discoverDataCollections(root, dirs.map(confine), new Set((options.claimed ?? []).map(confine)), sink).map(draftFromCollection);
    },
    dataFolderCollections(parent, options = {}) {
      const base = confine(parent);
      const claimed = new Set((options.claimed ?? []).map(confine));
      const out: CollectionDraft[] = [];

      for (const name of list(base)) {
        if (!name.endsWith("/")) continue;
        const id = name.slice(0, -1);
        const dir = base ? `${base}/${id}` : id;

        if (claimed.has(dir)) continue;
        const counts = new Map<string, number>();

        for (const file of list(dir)) {
          const format = formatForPath(file);

          if (format) counts.set(format, (counts.get(format) ?? 0) + 1);
        }
        const format = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

        if (format !== "json" && format !== "yaml") continue;
        const names = collectionNames(id);

        out.push({ id, label: names.label, singular: names.singular, kind: "entries", path: dir, pattern: "**/*.{json,yaml,yml}", format, body: false, url: null, create: true, source: "inferred" });
      }
      return out;
    },
    parseModule,
    readModule(path) {
      const program = readModuleFile(path, 0, new Set());

      return program ? toParsedModule(program) : null;
    },
    fieldsFromZod: (expr, module) => objectFields(expr, scopeOf(module)),
    fileRoutes: (pagesDir, options = {}) => scanRoutes(root, confine(pagesDir) || ".", options.extensions),
    urlPatternFromRoutes,
    routeOwner,
  };

  const ctx: AdapterContext = {
    root,
    exists: (path) => statOf(path) !== null,
    isDirectory,
    list,
    readText,
    readJson,
    readData,
    glob(patterns, options = {}) {
      const list = Array.isArray(patterns) ? patterns : [patterns];

      for (const pattern of list) {
        if (pattern.startsWith("/") || pattern.split("/").includes("..")) throw new OutsideSiteError(pattern);
      }
      const base = confine(options.cwd ?? "");
      let found: string[];

      try {
        found = globSync(list, { cwd: full(base), onlyFiles: true, ignore: IGNORED_DIRS, expandDirectories: false });
      } catch {
        return [];
      }
      return found
        .map((file) => (base ? `${base}/${file}` : file))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, options.limit ?? DEFAULT_GLOB_LIMIT);
    },
    packageJson: shared.packageJson,
    hasDependency,
    dependencyVersion(name) {
      const installed = readJson<{ version?: unknown }>(`node_modules/${name}/package.json`);

      if (installed && typeof installed.version === "string") return installed.version;
      const range = hasDependency(name)?.replace(/^[^\d]*/, "");

      return range ? range : null;
    },
    note,
    helpers,
  };

  states.set(ctx, state);
  return ctx;
}

function draftFromCollection(collection: Collection): CollectionDraft {
  const { fields: _fields, count: _count, source, ...rest } = collection;

  return { ...rest, source: source === "schema" ? "schema" : "inferred" };
}

/** Reads package.json for the shared context; a broken one is a note, not a failure. */
export function readPackageJson(root: string, notes: string[]): PackageJsonLike | null {
  let text: string;

  try {
    text = readFileSync(join(root, "package.json"), "utf8");
  } catch {
    return null;
  }
  try {
    const value = JSON.parse(text) as unknown;

    return isObject(value as never) ? (value as PackageJsonLike) : null;
  } catch {
    notes.push("package.json could not be read, so commands were not detected.");
    return null;
  }
}
