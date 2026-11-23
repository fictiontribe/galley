/**
 * "Add sites from a folder": look inside a folder (one or two levels down)
 * for things that look like sites, cheaply.
 *
 * A folder looks like a site when it holds a framework's config file, a
 * package.json naming a site framework, or this app's own config file. That
 * is all that is read — a few file names and at most two small JSON files per
 * folder. Nothing is executed, no site is opened, nothing is detected in
 * depth: forty sites are listed in well under a second, and detection happens
 * when each is opened for the first time.
 *
 * Never looked into: `node_modules`, hidden folders (`.git`, `.cache`…), build
 * output, and the inside of a folder already recognised as a site (its
 * subfolders are its own). Links to folders are never followed — a link can
 * point anywhere, including back up the tree — and are counted instead. The
 * walk stops at a cap on folders, sites and time, and when cancelled.
 */
import type { Dirent } from "node:fs";
import { readdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { PRODUCT } from "../brand";
import type { FrameworkInfo } from "../types";
import { folderName, prettifyName } from "./util";

export interface ScanLimits {
  /** Folders looked at, at most. */
  maxFolders: number;
  /** Sites listed, at most. */
  maxSites: number;
  /** Wall-clock budget. */
  maxMs: number;
}

export const SCAN_LIMITS: ScanLimits = { maxFolders: 4_000, maxSites: 400, maxMs: 15_000 };

/** Folders never looked into, whatever is inside. */
const SKIP = new Set(["node_modules", "dist", "build", "out", "vendor", "bower_components", "target", "__pycache__", "Library", "Applications"]);

interface Marker {
  id: FrameworkInfo["id"];
  name: string;
  files: string[];
}

/** Config files that say which framework a folder is, in the order they're believed. */
const MARKERS: Marker[] = [
  { id: "astro", name: "Astro", files: ["astro.config.mjs", "astro.config.js", "astro.config.ts", "astro.config.mts", "astro.config.cjs"] },
  { id: "docusaurus", name: "Docusaurus", files: ["docusaurus.config.js", "docusaurus.config.ts", "docusaurus.config.mjs"] },
  { id: "eleventy", name: "Eleventy", files: [".eleventy.js", "eleventy.config.js", "eleventy.config.mjs", "eleventy.config.cjs", ".eleventy.cjs"] },
  { id: "hugo", name: "Hugo", files: ["hugo.toml", "hugo.yaml", "hugo.yml", "hugo.json"] },
  { id: "next", name: "Next.js", files: ["next.config.js", "next.config.mjs", "next.config.ts"] },
  { id: "nuxt", name: "Nuxt", files: ["nuxt.config.ts", "nuxt.config.js", "nuxt.config.mjs"] },
  { id: "sveltekit", name: "SvelteKit", files: ["svelte.config.js", "svelte.config.mjs"] },
];

/** package.json dependencies that name a framework, for folders without its config file. */
const PACKAGES: Array<{ id: FrameworkInfo["id"]; name: string; dependency: string }> = [
  { id: "astro", name: "Astro", dependency: "astro" },
  { id: "docusaurus", name: "Docusaurus", dependency: "@docusaurus/core" },
  { id: "eleventy", name: "Eleventy", dependency: "@11ty/eleventy" },
  { id: "next", name: "Next.js", dependency: "next" },
  { id: "nuxt", name: "Nuxt", dependency: "nuxt" },
  { id: "sveltekit", name: "SvelteKit", dependency: "@sveltejs/kit" },
];

export interface ProbedSite {
  path: string;
  name: string;
  framework: FrameworkInfo;
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const text = await readFile(path, "utf8");

    // A package.json is small; anything huge isn't one worth reading here.
    if (text.length > 512 * 1024) return null;
    const parsed = JSON.parse(text) as unknown;

    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function dependencyVersion(pkg: Record<string, unknown> | null, name: string): string | null {
  for (const key of ["dependencies", "devDependencies"]) {
    const deps = pkg?.[key];
    const value = deps && typeof deps === "object" ? (deps as Record<string, unknown>)[name] : undefined;

    if (typeof value === "string") return value;
  }
  return null;
}

/** "^5.2.0" → "5.2"; "workspace:*" → undefined. */
function shortVersion(range: string | null): string | undefined {
  const match = range ? /(\d+)\.(\d+)/.exec(range) : null;

  return match ? `${match[1]}.${match[2]}` : undefined;
}

/**
 * Whether `dir` looks like a site, from the names of its files (`entries`,
 * already read) and at most its package.json and the app's config file.
 */
export async function probeSite(dir: string, entries?: Dirent[]): Promise<ProbedSite | null> {
  const listing = entries ?? (await readdir(dir, { withFileTypes: true }).catch(() => [] as Dirent[]));
  const files = new Set(listing.filter((entry) => entry.isFile()).map((entry) => entry.name));
  const folders = new Set(listing.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  const hasConfig = files.has(PRODUCT.configFile);
  const pkg = files.has("package.json") ? await readJson(join(dir, "package.json")) : null;
  let framework: FrameworkInfo | null = null;

  for (const marker of MARKERS) {
    if (marker.files.some((file) => files.has(file))) {
      const dependency = PACKAGES.find((entry) => entry.id === marker.id)?.dependency;
      const version = shortVersion(dependency ? dependencyVersion(pkg, dependency) : null);

      framework = { id: marker.id, name: marker.name, ...(version ? { version } : {}) };
      break;
    }
  }
  if (!framework) {
    for (const entry of PACKAGES) {
      const range = dependencyVersion(pkg, entry.dependency);

      if (range) {
        const version = shortVersion(range);

        framework = { id: entry.id, name: entry.name, ...(version ? { version } : {}) };
        break;
      }
    }
  }
  if (!framework && files.has("config.toml") && folders.has("content") && (folders.has("layouts") || folders.has("themes"))) {
    framework = { id: "hugo", name: "Hugo" };
  }
  if (!framework && files.has("_config.yml") && (files.has("Gemfile") || folders.has("_posts") || folders.has("_layouts"))) {
    framework = { id: "jekyll", name: "Jekyll" };
  }
  if (!framework && hasConfig) framework = { id: "generic", name: "Markdown" };
  if (!framework) return null;

  const config = hasConfig ? await readJson(join(dir, PRODUCT.configFile)) : null;
  const configured = typeof config?.name === "string" ? config.name.trim() : "";
  const packageName = typeof pkg?.name === "string" ? pkg.name.trim() : "";
  const folder = folderName(dir);
  // The same rule the open site uses: a deliberate package name, prettified; else the folder.
  const name = configured || (packageName && packageName !== folder ? prettifyName(packageName) : folder);

  return { path: dir, name: name.slice(0, 100), framework };
}

export interface ScanOutcome {
  sites: ProbedSite[];
  visited: number;
  truncated: boolean;
  cancelled: boolean;
  skippedLinks: number;
}

/**
 * Looks for sites in `parent` and up to `depth` levels below it (1 or 2).
 * `parent` must already be a checked, real folder. The parent itself counts
 * when it is a site (and then nothing below it is looked at).
 */
export async function scanForSites(
  parent: string,
  options: { depth?: number; signal?: AbortSignal; limits?: Partial<ScanLimits>; now?: () => number } = {}
): Promise<ScanOutcome> {
  const limits = { ...SCAN_LIMITS, ...options.limits };
  const depth = Math.min(2, Math.max(1, Math.round(options.depth ?? 2)));
  const now = options.now ?? Date.now;
  const started = now();
  const root = await realpath(parent);
  const outcome: ScanOutcome = { sites: [], visited: 0, truncated: false, cancelled: false, skippedLinks: 0 };
  /** Real paths already looked at: two routes to one folder are walked once. */
  const seen = new Set<string>();
  let level: Array<{ path: string; level: number }> = [{ path: root, level: 0 }];
  const finish = (): ScanOutcome => {
    outcome.sites.sort((a, b) => a.path.localeCompare(b.path));
    return outcome;
  };

  while (level.length > 0) {
    const next: Array<{ path: string; level: number }> = [];

    for (const folder of level) {
      if (options.signal?.aborted) {
        outcome.cancelled = true;
        return finish();
      }
      if (outcome.visited >= limits.maxFolders || outcome.sites.length >= limits.maxSites || now() - started > limits.maxMs) {
        outcome.truncated = true;
        return finish();
      }
      if (seen.has(folder.path)) continue;
      seen.add(folder.path);
      outcome.visited += 1;
      const entries = await readdir(folder.path, { withFileTypes: true }).catch(() => null);

      if (!entries) continue;
      const site = await probeSite(folder.path, entries);

      if (site) {
        outcome.sites.push(site);
        continue;
      }
      if (folder.level >= depth) continue;
      for (const entry of entries) {
        if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
        if (entry.isSymbolicLink()) {
          outcome.skippedLinks += 1;
          continue;
        }
        if (entry.isDirectory()) next.push({ path: join(folder.path, entry.name), level: folder.level + 1 });
      }
    }
    // Siblings in name order, so the list reads like the folder does in Finder.
    level = next.sort((a, b) => a.path.localeCompare(b.path));
  }
  return finish();
}
