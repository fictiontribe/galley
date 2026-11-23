/**
 * Starter templates for "New site": every folder in the starters directory
 * that has a package.json. An optional `starter.json` describes it for the
 * wizard — name, description, framework, tags, a preview image, and the
 * looks it ships — and is never copied into a new site:
 *
 *   { "name": "…", "description": "…", "framework": "astro", "tags": ["business"],
 *     "preview": "galley/preview.webp", "tokens": "src/styles/tokens.css",
 *     "looks": [{ "id": "harbour", "label": "Harbour", "file": "galley/looks/harbour.css",
 *                 "swatches": ["#123456"], "preview": "galley/looks/harbour.webp" }] }
 *
 * `tokens` names the starter's active theme-tokens file; choosing a look
 * copies that look's `file` over it. The first look is the starter's default.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import type { FrameworkId, StarterInfo, StarterLook } from "../types";
import { prettifyName } from "./util";

const FRAMEWORK_PACKAGES: Array<[string, FrameworkId]> = [
  ["astro", "astro"],
  ["@11ty/eleventy", "eleventy"],
  ["next", "next"],
  ["nuxt", "nuxt"],
  ["@sveltejs/kit", "sveltekit"],
  ["@docusaurus/core", "docusaurus"],
];
const FRAMEWORKS = new Set<FrameworkId>(["astro", "eleventy", "hugo", "jekyll", "next", "nuxt", "sveltekit", "docusaurus", "generic"]);
/** The starter's own description file: read by the wizard, left out of every new site. */
export const STARTER_MANIFEST = "starter.json";
const PREVIEW_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", avif: "image/avif", gif: "image/gif", svg: "image/svg+xml" };

export interface StarterLookManifest {
  id: string;
  label: string;
  /** Repo-relative path, in the starter, of this look's theme-tokens file. */
  file?: string;
  swatches: string[];
  preview?: string;
}

export interface StarterManifest {
  name?: string;
  description?: string;
  framework?: string;
  tags: string[];
  preview?: string;
  /** The starter's active theme-tokens file, which a chosen look replaces. */
  tokens?: string;
  looks: StarterLookManifest[];
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;

    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function frameworkOf(pkg: Record<string, unknown>): FrameworkId {
  const deps = { ...(pkg.dependencies as object | undefined), ...(pkg.devDependencies as object | undefined) } as Record<string, unknown>;

  return FRAMEWORK_PACKAGES.find(([name]) => deps[name] !== undefined)?.[1] ?? "generic";
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** A path the manifest names, kept only when it stays inside the starter folder. */
function inside(value: unknown): string | undefined {
  const path = text(value);

  if (!path || isAbsolute(path) || path.includes("\0")) return undefined;
  const clean = normalize(path).split(sep).join("/");

  return clean === ".." || clean.startsWith("../") ? undefined : clean.replace(/^\.\//, "");
}

/** `starter.json`, with every value checked; anything malformed is simply left out. */
export async function readStarterManifest(dir: string): Promise<StarterManifest> {
  const raw = (await readJson(join(dir, STARTER_MANIFEST))) ?? {};
  const looks: StarterLookManifest[] = [];
  const seen = new Set<string>();

  for (const look of Array.isArray(raw.looks) ? raw.looks : []) {
    if (!look || typeof look !== "object") continue;
    const entry = look as Record<string, unknown>;
    const id = text(entry.id);

    if (!id || !/^[a-z0-9][a-z0-9-]*$/i.test(id) || seen.has(id)) continue;
    seen.add(id);
    const file = inside(entry.file);
    const preview = inside(entry.preview);

    looks.push({
      id,
      label: text(entry.label) ?? prettifyName(id),
      ...(file ? { file } : {}),
      swatches: (Array.isArray(entry.swatches) ? entry.swatches : []).filter((swatch): swatch is string => typeof swatch === "string" && HEX.test(swatch)),
      ...(preview ? { preview } : {}),
    });
  }
  const name = text(raw.name);
  const description = text(raw.description);
  const framework = text(raw.framework);
  const preview = inside(raw.preview);
  const tokens = inside(raw.tokens);

  return {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    ...(framework ? { framework } : {}),
    tags: (Array.isArray(raw.tags) ? raw.tags : []).filter((tag): tag is string => typeof tag === "string" && tag.trim() !== "").map((tag) => tag.trim()),
    ...(preview ? { preview } : {}),
    ...(tokens ? { tokens } : {}),
    looks,
  };
}

async function isFile(path: string): Promise<boolean> {
  return stat(path).then((info) => info.isFile(), () => false);
}

/** The URL the server serves a starter's preview image at (its only route into the starters folder). */
export function starterPreviewUrl(starterId: string, lookId?: string): string {
  return `/api/starters/${encodeURIComponent(starterId)}/preview${lookId ? `?look=${encodeURIComponent(lookId)}` : ""}`;
}

export async function listStarters(startersDir: string): Promise<StarterInfo[]> {
  let entries;

  try {
    entries = await readdir(startersDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: StarterInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = join(startersDir, entry.name);
    const pkg = await readJson(join(dir, "package.json"));

    if (!pkg) continue;
    const meta = await readStarterManifest(dir);
    const declared = meta.framework as FrameworkId | undefined;
    const looks: StarterLook[] = [];

    for (const look of meta.looks) {
      const hasPreview = look.preview !== undefined && PREVIEW_TYPES[look.preview.split(".").pop()?.toLowerCase() ?? ""] !== undefined && (await isFile(join(dir, look.preview)));

      looks.push({ id: look.id, label: look.label, ...(look.swatches.length ? { swatches: look.swatches } : {}), ...(hasPreview ? { previewUrl: starterPreviewUrl(entry.name, look.id) } : {}) });
    }
    const hasPreview = meta.preview !== undefined && (await starterPreviewFile(startersDir, entry.name)) !== null;

    out.push({
      id: entry.name,
      name: meta.name ?? prettifyName(text(pkg.name) ?? entry.name),
      description: meta.description ?? text(pkg.description) ?? "",
      framework: declared && FRAMEWORKS.has(declared) ? declared : frameworkOf(pkg),
      ...(meta.tags.length ? { tags: meta.tags } : {}),
      ...(hasPreview ? { previewUrl: starterPreviewUrl(entry.name) } : {}),
      ...(looks.length ? { looks } : {}),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The preview image a starter's manifest declares (its own, or one look's),
 * as an absolute path and type — and nothing else from the starters folder:
 * the id must be a starter, the image must be one the manifest names, an
 * image, and inside that starter's folder.
 */
export async function starterPreviewFile(startersDir: string, starterId: string, lookId?: string): Promise<{ path: string; type: string } | null> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(starterId)) return null;
  const dir = join(startersDir, starterId);

  if (!(await isFile(join(dir, "package.json")))) return null;
  const meta = await readStarterManifest(dir);
  const declared = lookId === undefined ? meta.preview : meta.looks.find((look) => look.id === lookId)?.preview;
  const type = declared ? PREVIEW_TYPES[declared.split(".").pop()?.toLowerCase() ?? ""] : undefined;

  if (!declared || !type) return null;
  const path = join(dir, declared);
  const rel = relative(dir, path);

  if (rel.startsWith("..") || isAbsolute(rel) || !(await isFile(path))) return null;
  return { path, type };
}
