/**
 * Git-tracked Terminology Glossary (`galley/i18n/glossary.json`).
 *
 * Keeps brand names, product names, and domain terms consistent across every
 * language, and formats matching rules into every AI translation prompt.
 */
import { randomUUID } from "node:crypto";
import type { SiteModel, SiteService } from "../types";
import type { GlossaryFile, GlossaryTerm } from "./types";

export const I18N_GLOSSARY_PATH = "galley/i18n/glossary.json";

export function emptyGlossary(): GlossaryFile {
  return { version: 1, terms: [] };
}

export async function readGlossary(site: Pick<SiteService, "readFile">): Promise<GlossaryFile> {
  const file = await site.readFile(I18N_GLOSSARY_PATH).catch(() => null);

  if (!file || file.binary || !file.content.trim()) return emptyGlossary();
  try {
    const parsed = JSON.parse(file.content) as Partial<GlossaryFile>;

    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.terms)) return emptyGlossary();
    const terms: GlossaryTerm[] = [];

    for (const item of parsed.terms) {
      if (!item || typeof item !== "object" || typeof item.term !== "string" || !item.term.trim()) continue;
      const translations: Record<string, string> = {};

      if (item.translations && typeof item.translations === "object") {
        for (const [locale, value] of Object.entries(item.translations)) {
          if (typeof value === "string" && value.trim()) translations[locale] = value.trim();
        }
      }
      terms.push({
        id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : randomUUID().slice(0, 8),
        term: item.term.trim(),
        ...(item.doNotTranslate ? { doNotTranslate: true } : {}),
        ...(Object.keys(translations).length ? { translations } : {}),
        ...(typeof item.note === "string" && item.note.trim() ? { note: item.note.trim() } : {}),
      });
    }
    return { version: 1, terms };
  } catch {
    return emptyGlossary();
  }
}

export async function writeGlossary(site: Pick<SiteService, "writeFile">, glossary: GlossaryFile): Promise<void> {
  const cleaned: GlossaryTerm[] = glossary.terms
    .filter((item) => item.term.trim().length > 0)
    .map((item) => ({
      id: item.id.trim() || randomUUID().slice(0, 8),
      term: item.term.trim(),
      ...(item.doNotTranslate ? { doNotTranslate: true } : {}),
      ...(item.translations && Object.keys(item.translations).length ? { translations: item.translations } : {}),
      ...(item.note?.trim() ? { note: item.note.trim() } : {}),
    }));
  const text = `${JSON.stringify({ version: 1, terms: cleaned }, null, 2)}\n`;

  await site.writeFile(I18N_GLOSSARY_PATH, text, { origin: "user", mode: "content" });
}

/**
 * Auto-seeds the glossary with the site's brand name from `galley/brand/brand.json`
 * (or the site name) when no glossary exists yet.
 */
export async function seedGlossaryIfEmpty(site: Pick<SiteService, "readFile" | "writeFile">, model: SiteModel): Promise<GlossaryFile> {
  const existing = await readGlossary(site);

  if (existing.terms.length > 0) return existing;
  let brandName = "";
  const brandFile = await site.readFile("galley/brand/brand.json").catch(() => null);

  if (brandFile && !brandFile.binary) {
    try {
      const parsed = JSON.parse(brandFile.content) as { name?: unknown };

      if (typeof parsed.name === "string" && parsed.name.trim()) brandName = parsed.name.trim();
    } catch {
      // Ignore malformed brand file.
    }
  }
  if (!brandName && model.name && model.name.trim()) brandName = model.name.trim();
  if (!brandName) return existing;

  const seeded: GlossaryFile = {
    version: 1,
    terms: [
      {
        id: "brand-name",
        term: brandName,
        doNotTranslate: true,
        note: "Site brand name — keep as written across languages.",
      },
    ],
  };

  await writeGlossary(site, seeded);
  return seeded;
}

/**
 * Formats glossary rules relevant to the source text and target locale for an AI prompt.
 */
export function formatGlossaryPrompt(glossary: GlossaryFile, targetLocale: string, haystack: string): string {
  if (!glossary.terms.length) return "";
  const lowerHaystack = haystack.toLowerCase();
  const lines: string[] = [];

  for (const term of glossary.terms) {
    if (!lowerHaystack.includes(term.term.toLowerCase())) continue;
    const preferred =
      term.translations?.[targetLocale] ??
      term.translations?.[targetLocale.toLowerCase()] ??
      term.translations?.[targetLocale.split("-")[0]!.toLowerCase()];

    if (term.doNotTranslate) {
      lines.push(`- "${term.term}" → keep verbatim (do not translate)${term.note ? ` (${term.note})` : ""}`);
    } else if (preferred) {
      lines.push(`- "${term.term}" → "${preferred}"${term.note ? ` (${term.note})` : ""}`);
    } else if (term.note) {
      lines.push(`- "${term.term}": ${term.note}`);
    }
  }
  return lines.length ? `Glossary rules (follow strictly):\n${lines.join("\n")}` : "";
}
