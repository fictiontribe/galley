/**
 * The brand's files in the site: where they are, reading them, and writing
 * them as ordinary pending changes.
 *
 *   <dir>/brand.json               the design system as data
 *   <dir>/guide.md                 the human guide the assistant reads
 *   <dir>/sources/manifest.json    the material it was set up from
 *   <dir>/sources/<file>           that material, when small enough to keep in the site
 *
 * The brand belongs to the site owner, like galley.config.json, and sits
 * outside the content globs. Saving it is the owner's own act (the Brand
 * screen's "Save the brand"), so it is written in content mode when the site
 * lets content mode write there, else in build mode when the site allows
 * build mode — and refused in plain words when it allows neither.
 */
import { GalleyError } from "../errors";
import { requireBuildMode } from "../install/caller";
import type { AgentMode, GalleyConfig, SiteModel, SiteService } from "../types";
import { matchesWritable } from "../workspace/policy";
import { SITE_URL } from "../brand";
import { parseBrandFile } from "./schema";
import type { SiteBrandFile, SourceManifest } from "./types";

export const DEFAULT_BRAND_DIR = "galley/brand";
export const DEFAULT_LARGE_FILE_MB = 10;
/** Published with the docs site (`galley schema --out` writes the file); editors autocomplete brand.json from it. */
export const BRAND_SCHEMA_URL = `${SITE_URL}/schema/brand.json`;

export interface BrandLocation {
  dir: string;
  brandFile: string;
  guideFile: string;
  sourcesDir: string;
  manifestFile: string;
  largeFileBytes: number;
  tokensFile: string | null;
}

export function brandLocation(config: GalleyConfig | null): BrandLocation {
  const dir = (config?.siteBrand?.dir ?? DEFAULT_BRAND_DIR).replace(/\/+$/, "") || DEFAULT_BRAND_DIR;
  const mb = config?.siteBrand?.largeFileMB ?? DEFAULT_LARGE_FILE_MB;

  return {
    dir,
    brandFile: `${dir}/brand.json`,
    guideFile: `${dir}/guide.md`,
    sourcesDir: `${dir}/sources`,
    manifestFile: `${dir}/sources/manifest.json`,
    largeFileBytes: Math.round(mb * 1024 * 1024),
    tokensFile: config?.siteBrand?.tokensFile ?? null,
  };
}

async function readText(site: SiteService, path: string): Promise<string | null> {
  try {
    const file = await site.readFile(path);

    return file.binary ? null : file.content;
  } catch {
    return null;
  }
}

export interface SavedBrand {
  brand: SiteBrandFile | null;
  /** Set when brand.json exists but couldn't be read. */
  problem: string | null;
  guide: string | null;
  manifest: SourceManifest;
}

export async function readSavedBrand(site: SiteService, where: BrandLocation): Promise<SavedBrand> {
  const [brandText, guide, manifestText] = await Promise.all([readText(site, where.brandFile), readText(site, where.guideFile), readText(site, where.manifestFile)]);
  let brand: SiteBrandFile | null = null;
  let problem: string | null = null;

  if (brandText !== null) {
    try {
      const parsed = parseBrandFile(JSON.parse(brandText));

      if (parsed.ok) brand = parsed.brand;
      else problem = `The brand file can't be read (${parsed.problem}).`;
    } catch (error) {
      problem = `The brand file isn't valid (${error instanceof Error ? error.message : String(error)}).`;
    }
  }
  let manifest: SourceManifest = { version: 1, sources: [] };

  if (manifestText !== null) {
    try {
      const parsed = JSON.parse(manifestText) as SourceManifest;

      if (parsed && parsed.version === 1 && Array.isArray(parsed.sources)) manifest = parsed;
    } catch {
      // A broken manifest leaves the list empty; the files themselves stay where they are.
    }
  }
  return { brand, problem, guide, manifest };
}

/** The mode a brand write uses, or a plain refusal. */
export function brandWriteMode(model: SiteModel, path: string): AgentMode {
  if (matchesWritable(path, model.writable, "content")) return "content";
  if (model.ai.allowBuild) return "build";
  throw new GalleyError(
    "forbidden",
    "The brand can't be saved here: its folder isn't one this site lets the app change. Turn on build mode in the site settings, or add the brand folder to the files content mode may change.",
    path
  );
}

/** Writes each file as a pending change (shown in Proof, published like content). */
export async function writeBrandFiles(site: SiteService, files: Array<{ path: string; content: string | Uint8Array }>): Promise<string[]> {
  const model = await site.model();
  const written: string[] = [];
  const modes = files.map((file) => brandWriteMode(model, file.path));

  // A brand folder outside the site's content is the files the site is built from: build mode, and its level.
  // Asked before anything is written, so a refusal never leaves half a brand saved.
  if (modes.includes("build")) requireBuildMode();
  for (const [index, file] of files.entries()) {
    const mode = modes[index]!;
    let current: string | null = null;

    if (typeof file.content === "string") current = await readText(site, file.path);
    if (current === file.content) continue;
    await site.writeFile(file.path, file.content, { origin: "user", mode });
    written.push(file.path);
  }
  return written;
}

/** Stable JSON: two-space indent, trailing newline — the shape a person would write. */
export function brandJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
