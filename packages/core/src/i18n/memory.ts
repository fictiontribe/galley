/**
 * Git-tracked Translation Memory (`galley/i18n/memory.json`).
 *
 * Stores exact source → target segment pairs per language pair so repeated
 * headings, CTAs, labels, and paragraphs are translated deterministically
 * for 0 tokens, $0, and 0 AI credits, and surfaced as instant suggestions
 * during manual editing.
 */
import { createHash } from "node:crypto";
import type { SiteService } from "../types";
import type { I18nMemorySuggestion, TranslationMemoryEntry, TranslationMemoryFile } from "./types";

export const I18N_MEMORY_PATH = "galley/i18n/memory.json";

export function normalizeSegment(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function memorySegmentId(sourceLocale: string, targetLocale: string, source: string): string {
  const normalized = normalizeSegment(source);
  const key = `${sourceLocale.toLowerCase()}\u0000${targetLocale.toLowerCase()}\u0000${normalized}`;

  return createHash("sha256").update(key, "utf8").digest("hex").slice(0, 16);
}

export function emptyMemory(): TranslationMemoryFile {
  return { version: 1, entries: [] };
}

export async function readMemory(site: Pick<SiteService, "readFile">): Promise<TranslationMemoryFile> {
  const file = await site.readFile(I18N_MEMORY_PATH).catch(() => null);

  if (!file || file.binary || !file.content.trim()) return emptyMemory();
  try {
    const parsed = JSON.parse(file.content) as Partial<TranslationMemoryFile>;

    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entries)) return emptyMemory();
    const entries: TranslationMemoryEntry[] = [];

    for (const item of parsed.entries) {
      if (!item || typeof item !== "object") continue;
      if (typeof item.source !== "string" || typeof item.target !== "string") continue;
      if (typeof item.sourceLocale !== "string" || typeof item.targetLocale !== "string") continue;
      const source = item.source.trim();
      const target = item.target.trim();

      if (!source || !target) continue;
      entries.push({
        id: typeof item.id === "string" && item.id ? item.id : memorySegmentId(item.sourceLocale, item.targetLocale, source),
        sourceLocale: item.sourceLocale,
        targetLocale: item.targetLocale,
        source,
        target,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
      });
    }
    return { version: 1, entries };
  } catch {
    return emptyMemory();
  }
}

export async function writeMemory(site: Pick<SiteService, "writeFile">, memory: TranslationMemoryFile): Promise<void> {
  const dedup = new Map<string, TranslationMemoryEntry>();

  for (const item of memory.entries) {
    const source = item.source.trim();
    const target = item.target.trim();

    if (!source || !target) continue;
    const id = memorySegmentId(item.sourceLocale, item.targetLocale, source);

    dedup.set(id, {
      id,
      sourceLocale: item.sourceLocale,
      targetLocale: item.targetLocale,
      source,
      target,
      updatedAt: item.updatedAt || new Date().toISOString(),
    });
  }
  const entries = [...dedup.values()].sort((a, b) =>
    a.targetLocale.localeCompare(b.targetLocale) || a.source.localeCompare(b.source)
  );
  const text = `${JSON.stringify({ version: 1, entries }, null, 2)}\n`;

  await site.writeFile(I18N_MEMORY_PATH, text, { origin: "user", mode: "content" });
}

export class MemoryIndex {
  private readonly byKey = new Map<string, TranslationMemoryEntry>();
  private readonly byPair = new Map<string, TranslationMemoryEntry[]>();

  constructor(memory: TranslationMemoryFile) {
    for (const entry of memory.entries) {
      const id = memorySegmentId(entry.sourceLocale, entry.targetLocale, entry.source);

      this.byKey.set(id, entry);
      const pairKey = `${entry.sourceLocale.toLowerCase()}->${entry.targetLocale.toLowerCase()}`;
      const list = this.byPair.get(pairKey) ?? [];

      list.push(entry);
      this.byPair.set(pairKey, list);
    }
  }

  /** Deterministic exact match (whitespace-normalized). */
  exact(sourceLocale: string, targetLocale: string, source: string): TranslationMemoryEntry | null {
    const normalized = normalizeSegment(source);

    if (!normalized) return null;
    return this.byKey.get(memorySegmentId(sourceLocale, targetLocale, normalized)) ?? null;
  }

  /** Exact match first, then high-overlap fuzzy/substring suggestion for manual translators. */
  suggest(sourceLocale: string, targetLocale: string, source: string): I18nMemorySuggestion | null {
    const hit = this.exact(sourceLocale, targetLocale, source);

    if (hit) return { source: hit.source, target: hit.target, exact: true };
    const needle = normalizeSegment(source).toLowerCase();

    if (needle.length < 4) return null;
    const pairKey = `${sourceLocale.toLowerCase()}->${targetLocale.toLowerCase()}`;
    const candidates = this.byPair.get(pairKey) ?? [];
    const needleWords = new Set(needle.split(/\W+/).filter((w) => w.length > 2));
    let best: { entry: TranslationMemoryEntry; score: number } | null = null;

    for (const candidate of candidates) {
      const candNorm = normalizeSegment(candidate.source).toLowerCase();

      if (candNorm.includes(needle) || needle.includes(candNorm)) {
        const ratio = Math.min(needle.length, candNorm.length) / Math.max(needle.length, candNorm.length);

        if (ratio >= 0.55 && (!best || ratio > best.score)) best = { entry: candidate, score: ratio };
        continue;
      }
      if (needleWords.size >= 2) {
        const candWords = new Set(candNorm.split(/\W+/).filter((w) => w.length > 2));
        let overlap = 0;

        for (const word of needleWords) if (candWords.has(word)) overlap += 1;
        const jaccard = overlap / (needleWords.size + candWords.size - overlap || 1);

        if (jaccard >= 0.5 && (!best || jaccard > best.score)) best = { entry: candidate, score: jaccard };
      }
    }
    return best ? { source: best.entry.source, target: best.entry.target, exact: false } : null;
  }
}

export function mergeMemoryEntries(
  memory: TranslationMemoryFile,
  sourceLocale: string,
  targetLocale: string,
  pairs: Array<{ source: string; target: string }>,
  nowIso: string = new Date().toISOString()
): TranslationMemoryFile {
  const byId = new Map<string, TranslationMemoryEntry>(
    memory.entries.map((entry) => [memorySegmentId(entry.sourceLocale, entry.targetLocale, entry.source), entry])
  );

  for (const pair of pairs) {
    const source = pair.source.trim();
    const target = pair.target.trim();

    if (!source || !target) continue;
    const id = memorySegmentId(sourceLocale, targetLocale, source);

    byId.set(id, { id, sourceLocale, targetLocale, source, target, updatedAt: nowIso });
  }
  return { version: 1, entries: [...byId.values()] };
}
