/**
 * The import record: which WordPress item became which entry, and what was
 * written, so running the import again changes only what changed at the
 * source and never creates a second copy.
 *
 * It is a small JSON file in the site itself, in a folder whose name says
 * what it is. Keeping it in the site (rather than in the app's own folder)
 * means it travels with the site: it shows up in Proof with the import,
 * is published with it, and a teammate who imports again from another
 * computer picks up where the first import stopped. It sits outside the
 * content folders so the site's build never sees it. The content-mode write
 * surface covers content and media only, so the record is written with the
 * site's build-mode permission — the one non-content file the importer
 * writes, and only when it changed.
 */
import type { SiteService } from "@galley/core/types";

export const IMPORT_DIR = "wordpress-import";
export const MANIFEST_PATH = `${IMPORT_DIR}/manifest.json`;

export interface ManifestItem {
  /** Repo path of the entry. */
  path: string;
  /** Hash of what was planned from the source — compared on the next run. */
  hash: string;
  /** Hash of the file as the importer left it — tells whether someone edited it since. */
  entryHash: string;
}

export interface ManifestMedia {
  path: string;
  url: string;
  sha256: string;
}

export interface Manifest {
  version: 1;
  source: string;
  items: Record<string, ManifestItem>;
  media: Record<string, ManifestMedia>;
}

export function emptyManifest(source: string): Manifest {
  return { version: 1, source, items: {}, media: {} };
}

export function manifestKey(type: string, id: number): string {
  return `${type}:${id}`;
}

export async function loadManifest(site: SiteService, source: string): Promise<{ manifest: Manifest; text: string | null }> {
  try {
    const file = await site.readFile(MANIFEST_PATH);
    const parsed = JSON.parse(file.content) as Partial<Manifest>;

    if (parsed.version !== 1 || typeof parsed.items !== "object" || typeof parsed.media !== "object") return { manifest: emptyManifest(source), text: file.content };
    return { manifest: { version: 1, source: parsed.source ?? source, items: parsed.items ?? {}, media: parsed.media ?? {} }, text: file.content };
  } catch {
    return { manifest: emptyManifest(source), text: null };
  }
}

/** Stable text: keys sorted, so an unchanged record is byte-identical and makes no pending change. */
export function manifestText(manifest: Manifest): string {
  const sort = (record: Record<string, unknown>) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));

  return `${JSON.stringify({ version: manifest.version, source: manifest.source, items: sort(manifest.items), media: sort(manifest.media) }, null, 2)}\n`;
}

export async function saveManifest(site: SiteService, manifest: Manifest, previous: string | null): Promise<boolean> {
  const text = manifestText(manifest);

  if (text === previous) return false;
  await site.writeFile(MANIFEST_PATH, text, { origin: "user", mode: "build" });
  return true;
}
