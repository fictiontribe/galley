/**
 * The starters' pictures and looks come from each starter's own files
 * (starters/<name>/starter.json and galley/previews/) at build time, so they
 * never drift from the starters themselves. The words about each starter are
 * in the page content (the `starters` section), not here.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getCollection } from "astro:content";
import { repoRoot } from "./site";
import { webpSize } from "./media";

export interface Look { id: string; label: string; swatches: string[]; preview: string; file: string; width: number; height: number }
export interface Starter { id: string; sections: number; templates: number; looks: Look[] }

const dir = repoRoot ? join(repoRoot, "starters") : null;

function count(path: string, ext: string): number {
  return existsSync(path) ? readdirSync(path).filter((f) => f.endsWith(ext)).length : 0;
}

export function getStarter(id: string): Starter | null {
  if (!dir) return null;
  const metaFile = join(dir, id, "starter.json");
  if (!existsSync(metaFile)) return null;
  const meta = JSON.parse(readFileSync(metaFile, "utf8"));
  const looks: Look[] = [];
  for (const look of meta.looks ?? []) {
    const file = join(dir, id, look.preview);
    if (!existsSync(file)) continue;
    looks.push({ id: look.id, label: look.label, swatches: look.swatches ?? [], preview: `/starters/previews/${id}-${look.id}.webp`, file, ...webpSize(file) });
  }
  return {
    id,
    sections: count(join(dir, id, "galley", "sections"), ".webp"),
    templates: count(join(dir, id, "galley", "templates"), ".md"),
    looks,
  };
}

/** The starters the site's pages show (so only their previews are copied into the build). */
export async function usedStarters(): Promise<Starter[]> {
  const ids = new Set<string>();
  for (const page of await getCollection("pages")) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const s of (page.data.sections ?? []) as any[]) if (s.type === "starters") for (const item of s.items ?? []) if (item.starter) ids.add(item.starter);
  }
  return [...ids].map(getStarter).filter((s): s is Starter => s !== null);
}

export interface SectionThumb { type: string; label: string; src: string; file: string; width: number; height: number }

/** A section type's picture from a starter's own library (galley/sections/<type>.webp) and its label (galley.config.json). */
export function sectionThumb(starterId: string, type: string): SectionThumb {
  if (!dir) throw new Error("No starters folder");
  const file = join(dir, starterId, "galley", "sections", `${type}.webp`);
  if (!existsSync(file)) throw new Error(`Missing starters/${starterId}/galley/sections/${type}.webp`);
  let label = type;
  const config = join(dir, starterId, "galley.config.json");
  if (existsSync(config)) {
    const c = JSON.parse(readFileSync(config, "utf8"));
    for (const col of c.collections ?? []) for (const f of col.fields ?? []) for (const b of f.blocks ?? []) if (b.type === type && b.label) label = b.label;
  }
  return { type, label, src: `/starters/sections/${starterId}-${type}.webp`, file, ...webpSize(file) };
}

/** The section pictures the site's pages show. */
export async function usedSectionThumbs(): Promise<SectionThumb[]> {
  const out: SectionThumb[] = [];
  for (const page of await getCollection("pages")) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const s of (page.data.sections ?? []) as any[]) if (s.type === "starters" && s.builder?.starter) for (const t of s.builder.sections ?? []) out.push(sectionThumb(s.builder.starter, t));
  }
  return out;
}
