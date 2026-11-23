/**
 * The site's building blocks: its section types (from the detected content
 * model, with the descriptions and thumbnails galley.config.json declares),
 * the component files that render them, which pages use which, and a sample
 * of the site's own words for the voice.
 */
import type { Collection, Field, JsonValue, SiteModel, SiteService } from "../types";
import type { BrandComponent } from "./types";

export interface Inventory {
  components: BrandComponent[];
  /** URL paths of pages, home first. */
  pages: string[];
  /** One page per collection that has pages, for measuring. */
  representative: string[];
  /** Real copy from the content files: titles, headings, descriptions. */
  copy: Array<{ text: string; where: string }>;
  /** Site URLs of images used in content. */
  images: string[];
}

const ENTRY_READS = 60;

function blockFields(collection: Collection): Field[] {
  return collection.fields.filter((field) => field.type === "blocks" && field.blocks?.length);
}

function strings(value: JsonValue, out: string[], depth = 0): void {
  if (depth > 4 || out.length > 40) return;
  if (typeof value === "string") {
    const text = value.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();

    if (text.split(" ").length >= 3 && text.length <= 400 && !/^(\/|https?:|#)/.test(text)) out.push(text);
  } else if (Array.isArray(value)) for (const item of value) strings(item, out, depth + 1);
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) if (!/^(type|id|tone|image|href|src|url|icon|layout|align)$/i.test(key)) strings(item, out, depth + 1);
}

export async function readInventory(site: SiteService, model: SiteModel, files: string[]): Promise<Inventory> {
  const components = new Map<string, BrandComponent>();
  const pages: string[] = [];
  const representative: string[] = [];
  const copy: Inventory["copy"] = [];
  const images = new Set<string>();
  let reads = 0;
  const componentFiles = files.filter((file) => /\/components\/.+\.(astro|jsx|tsx|vue|svelte|njk|liquid|html)$/.test(file));
  const fileFor = (type: string) => {
    const slug = type.toLowerCase().replace(/[^a-z0-9]/g, "");

    return componentFiles.find((file) => (file.split("/").pop() ?? "").replace(/\.[a-z]+$/, "").toLowerCase().replace(/[^a-z0-9]/g, "") === slug);
  };

  for (const collection of model.collections) {
    for (const field of blockFields(collection)) {
      for (const block of field.blocks ?? []) {
        if (components.has(block.type)) continue;
        const file = fileFor(block.type);
        const thumbnail = block.thumbnail ?? files.find((path) => path === `galley/sections/${block.type}.webp`);

        components.set(block.type, {
          type: block.type,
          label: block.label,
          whenToUse: block.description ?? "",
          usedOn: [],
          count: block.count,
          ...(file ? { file } : {}),
          ...(thumbnail ? { thumbnail } : {}),
          confidence: "declared",
          evidence: [{ kind: "file", file: block.thumbnail || block.description ? "galley.config.json" : collection.path, note: `${block.type} section type` }],
        });
      }
    }
  }
  const ordered = [...model.collections].sort((a, b) => (a.id === "pages" ? -1 : b.id === "pages" ? 1 : 0));

  for (const collection of ordered) {
    if (collection.kind !== "entries" || !collection.url) continue;
    const list = await site.listEntries(collection.id, { limit: 200 }).catch(() => null);

    if (!list) continue;
    const items = [...list.items].sort((a, b) => (a.url === "/" ? -1 : b.url === "/" ? 1 : (a.url ?? "").localeCompare(b.url ?? "")));
    const first = items.find((item) => item.url && !item.draft);

    if (first?.url && !representative.includes(first.url)) representative.push(first.url);
    for (const item of items) {
      if (item.url && !item.draft) pages.push(item.url);
      if (item.title && item.titleSource === "field") copy.push({ text: item.title, where: item.url ?? item.path });
      if (item.image) images.add(item.image);
    }
    const fields = blockFields(collection);

    for (const item of items) {
      if (reads >= ENTRY_READS) break;
      if (!fields.length && copy.length > 60) break;
      reads += 1;
      const entry = await site.readEntry(item.path).catch(() => null);

      if (!entry) continue;
      const found: string[] = [];

      strings(entry.data, found);
      if (entry.body) {
        for (const paragraph of entry.body.split(/\n{2,}/).slice(0, 6)) {
          const text = paragraph.replace(/[*_`#>[\]]/g, "").replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();

          if (text.split(" ").length >= 6 && !text.startsWith("<")) found.push(text.slice(0, 400));
        }
      }
      for (const text of found.slice(0, 8)) copy.push({ text, where: item.url ?? item.path });
      for (const field of fields) {
        const value = entry.data[field.key];
        const discriminator = field.discriminator ?? "type";

        if (!Array.isArray(value)) continue;
        for (const block of value) {
          if (!block || typeof block !== "object" || Array.isArray(block)) continue;
          const type = (block as Record<string, JsonValue>)[discriminator];
          const component = typeof type === "string" ? components.get(type) : undefined;

          if (component && item.url && !component.usedOn.includes(item.url)) component.usedOn.push(item.url);
        }
      }
    }
  }
  const seen = new Set<string>();

  return {
    components: [...components.values()].sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    pages: [...new Set(pages)],
    representative: representative.slice(0, 6),
    copy: copy.filter((line) => (seen.has(line.text) ? false : (seen.add(line.text), true))).slice(0, 80),
    images: [...images].slice(0, 40),
  };
}
