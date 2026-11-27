/**
 * Schema-safe translation manifest (`galley/i18n/manifest.json`) and
 * source-content hashing for reliable out-of-sync detection.
 *
 * Never injects unknown frontmatter keys into user content files so strict
 * Zod schemas (`z.object({...}).strict()`) in Astro always keep building.
 */
import { createHash } from "node:crypto";
import type { Entry, JsonValue, SiteService } from "../types";
import type { I18nManifest, I18nManifestLink } from "./types";

export const I18N_MANIFEST_PATH = "galley/i18n/manifest.json";

export function emptyManifest(): I18nManifest {
  return { version: 1, links: {} };
}

export async function readManifest(site: Pick<SiteService, "readFile">): Promise<I18nManifest> {
  const file = await site.readFile(I18N_MANIFEST_PATH).catch(() => null);

  if (!file || file.binary || !file.content.trim()) return emptyManifest();
  try {
    const parsed = JSON.parse(file.content) as Partial<I18nManifest>;

    if (!parsed || typeof parsed !== "object" || !parsed.links || typeof parsed.links !== "object") {
      return emptyManifest();
    }
    const links: Record<string, I18nManifestLink> = {};

    for (const [path, link] of Object.entries(parsed.links)) {
      if (!link || typeof link !== "object") continue;
      if (typeof link.sourcePath !== "string" || typeof link.locale !== "string") continue;
      links[path] = {
        key: typeof link.key === "string" && link.key ? link.key : link.sourcePath,
        sourcePath: link.sourcePath,
        locale: link.locale,
        sourceHash: typeof link.sourceHash === "string" ? link.sourceHash : "",
        sourceSlug: typeof link.sourceSlug === "string" ? link.sourceSlug : "",
        localizedSlug: typeof link.localizedSlug === "string" ? link.localizedSlug : "",
        updatedAt: typeof link.updatedAt === "string" ? link.updatedAt : new Date().toISOString(),
      };
    }
    return { version: 1, links };
  } catch {
    return emptyManifest();
  }
}

export async function writeManifest(site: Pick<SiteService, "writeFile">, manifest: I18nManifest): Promise<void> {
  const sortedLinks: Record<string, I18nManifestLink> = {};

  for (const key of Object.keys(manifest.links).sort()) {
    sortedLinks[key] = manifest.links[key]!;
  }
  const text = `${JSON.stringify({ version: 1, links: sortedLinks }, null, 2)}\n`;

  await site.writeFile(I18N_MANIFEST_PATH, text, { origin: "user", mode: "content" });
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const keys = Object.keys(value).sort();

  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k]!)}`).join(",")}}`;
}

/**
 * Deterministic short SHA-256 hash of a source entry's frontmatter data and
 * Markdown body. When the source entry changes, this hash changes immediately,
 * flagging translated counterparts in `manifest.json` as "outdated".
 */
export function computeSourceHash(entry: Pick<Entry, "data" | "body">): string {
  const payload = `${stableJson(entry.data as JsonValue)}\n---\n${(entry.body ?? "").trim()}`;

  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 16);
}

/**
 * Reads optional frontmatter `translationKey` if the site itself already uses one.
 */
export function entryTranslationKey(entry: Pick<Entry, "data">): string | null {
  const raw = entry.data.translationKey ?? entry.data.translation_key;

  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}
