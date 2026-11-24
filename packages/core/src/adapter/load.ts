/**
 * Checking that something is an adapter, and loading the adapters a site's
 * galley.config.json names. Loading runs code from the site's repository in
 * this process — the same trust the site already gets when its dev server is
 * started — so only what the config names is loaded, only from inside the
 * site folder or its own node_modules, and GALLEY_DISABLE_SITE_ADAPTERS=1
 * turns it off entirely. Nothing here throws: every problem becomes a note.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

import { PRODUCT } from "../brand";
import { ADAPTER_API_VERSION } from "./define";
import type { GalleyAdapter } from "./types";

export const ADAPTER_ID = /^[a-z][a-z0-9-]*$/;
const OPTIONAL_HOOKS = ["conventions", "collections", "routes", "environment", "forgetPreviewSaves"] as const;
const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

export type AdapterCheck = { ok: true; adapter: GalleyAdapter; warnings: string[] } | { ok: false; problem: string };

/**
 * Structural check of a value that should be a GalleyAdapter. `label` names
 * it in messages ("./tools/my-adapter.mjs"). Problems say what to change.
 */
export function validateAdapter(value: unknown, label = "The adapter"): AdapterCheck {
  const fail = (problem: string): AdapterCheck => ({ ok: false, problem: `${label} is not a usable adapter: ${problem}` });

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail("it should be an object with an id, a name and a detect function (export it as the module's default export).");
  }
  const adapter = value as Record<string, unknown>;

  if (typeof adapter.id !== "string" || !ADAPTER_ID.test(adapter.id)) {
    return fail(`its id should be lowercase letters, digits and dashes, starting with a letter (like "eleventy"), not ${JSON.stringify(adapter.id)}.`);
  }
  if (typeof adapter.name !== "string" || adapter.name.trim() === "") return fail("it needs a display name, like \"Eleventy\".");
  if (typeof adapter.detect !== "function") return fail("“detect” should be a function that returns a match or null.");
  for (const hook of OPTIONAL_HOOKS) {
    if (adapter[hook] !== undefined && typeof adapter[hook] !== "function") return fail(`“${hook}” should be a function, or left out.`);
  }
  if (adapter.apiVersion !== undefined && (typeof adapter.apiVersion !== "number" || !Number.isInteger(adapter.apiVersion))) {
    return fail("“apiVersion” should be a whole number, like 1.");
  }
  const warnings: string[] = [];

  if (adapter.apiVersion !== undefined && adapter.apiVersion !== ADAPTER_API_VERSION) {
    warnings.push(
      `${label} was written for adapter API version ${adapter.apiVersion as number}, and this version of ${PRODUCT.name} speaks version ${ADAPTER_API_VERSION}. It was used anyway; if something it should find is missing, update the adapter.`
    );
  }
  return { ok: true, adapter: adapter as unknown as GalleyAdapter, warnings };
}

/** The adapter a module exports: its default export, or a named `adapter` export. */
export function adapterFromModule(module: unknown): unknown {
  if (module === null || typeof module !== "object") return module;
  const record = module as Record<string, unknown>;
  let value = record.default ?? record.adapter;

  // A CommonJS module imported from ESM arrives as { default: module.exports }.
  if (value && typeof value === "object" && !("detect" in value) && "default" in value) value = (value as Record<string, unknown>).default;
  return value;
}

function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);

  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** The file Node would load for a package's main entry, from its package.json. */
export function packageEntry(dir: string): string | null {
  let pkg: Record<string, unknown>;

  try {
    pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  const pick = (value: unknown): string | null => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = pick(item);

        if (found) return found;
      }
      return null;
    }
    if (value && typeof value === "object") {
      const conditions = value as Record<string, unknown>;

      if ("." in conditions) return pick(conditions["."]);
      for (const condition of ["import", "node", "default", "module"]) {
        if (condition in conditions) {
          const found = pick(conditions[condition]);

          if (found) return found;
        }
      }
    }
    return null;
  };
  const target = pick(pkg.exports) ?? (typeof pkg.module === "string" ? pkg.module : null) ?? (typeof pkg.main === "string" ? pkg.main : null) ?? "index.js";
  const file = resolvePath(dir, target);

  return inside(dir, file) && existsSync(file) ? file : null;
}

export interface Resolved {
  file: string;
  /** Cache-busting for local files, so an edited adapter is picked up on refresh. */
  url: string;
}

/** A config entry → the file to import, or why not. `noun` words the messages ("adapters", "plugins"). */
export function resolveSpecifier(root: string, specifier: string, noun = "adapters"): Resolved | string {
  if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/") || /^[A-Za-z]:[\\/]/.test(specifier)) {
    const file = resolvePath(root, specifier);

    if (!existsSync(file) || !statSync(file).isFile()) return `${specifier} was not found in the site folder.`;
    let real: string;
    let realRoot: string;

    try {
      real = realpathSync(file);
      realRoot = realpathSync(root);
    } catch {
      return `${specifier} could not be opened.`;
    }
    if (!inside(realRoot, real)) return `${specifier} is outside the site folder, and ${noun} are only loaded from inside it.`;
    const segments = relative(realRoot, real).split(/[\\/]/);

    if (segments.includes(".git")) return `${specifier} is inside .git, and ${noun} are never loaded from there.`;
    return { file: real, url: `${pathToFileURL(real).href}?v=${statSync(real).mtimeMs}` };
  }
  if (!PACKAGE_NAME.test(specifier)) {
    return `“${specifier}” is neither a package name nor a path starting with "./".`;
  }
  // Only the site's own node_modules — never a parent folder's, never a global install.
  const dir = join(root, "node_modules", ...specifier.split("/"));

  if (!existsSync(join(dir, "package.json"))) return `the package “${specifier}” is not installed in this site. Add it to the site's devDependencies and install.`;
  const file = packageEntry(dir);

  return file ? { file, url: pathToFileURL(file).href } : `the package “${specifier}” has no entry file to load.`;
}

export interface LoadedAdapters {
  adapters: GalleyAdapter[];
  notes: string[];
}

/**
 * Loads the adapters named in galley.config.json, in order. Each problem
 * skips that one adapter with a note; the rest still load.
 */
export async function loadSiteAdapters(root: string, specifiers: string[], env: NodeJS.ProcessEnv = process.env): Promise<LoadedAdapters> {
  const notes: string[] = [];
  const adapters: GalleyAdapter[] = [];

  if (specifiers.length === 0) return { adapters, notes };
  if (env.GALLEY_DISABLE_SITE_ADAPTERS === "1" || env.GALLEY_DISABLE_SITE_ADAPTERS === "true") {
    notes.push(
      `Adapters from the site are turned off (GALLEY_DISABLE_SITE_ADAPTERS), so ${specifiers.map((item) => `“${item}”`).join(", ")} ${specifiers.length === 1 ? "was" : "were"} not loaded; the built-in adapters were used.`
    );
    return { adapters, notes };
  }
  for (const specifier of specifiers) {
    const resolved = resolveSpecifier(root, specifier);

    if (typeof resolved === "string") {
      notes.push(`The adapter ${specifier} in ${PRODUCT.configFile} was skipped: ${resolved}`);
      continue;
    }
    let module: unknown;

    try {
      module = await import(resolved.url);
    } catch (error) {
      notes.push(`The adapter ${specifier} could not be loaded (${error instanceof Error ? error.message.split("\n")[0] : String(error)}), so it was skipped.`);
      continue;
    }
    const check = validateAdapter(adapterFromModule(module), specifier);

    if (!check.ok) {
      notes.push(`${check.problem} It was skipped.`);
      continue;
    }
    if (adapters.some((adapter) => adapter.id === check.adapter.id)) {
      notes.push(`The adapter ${specifier} uses the id “${check.adapter.id}”, which an earlier adapter in ${PRODUCT.configFile} already uses, so it was skipped.`);
      continue;
    }
    // Say plainly which of the site's own code now runs inside the app.
    notes.push(`Loaded the ${check.adapter.name} adapter from ${specifier}.`, ...check.warnings);
    adapters.push(check.adapter);
  }
  return { adapters, notes };
}
