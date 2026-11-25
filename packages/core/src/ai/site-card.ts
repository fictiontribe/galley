/**
 * The site card: a compact, deterministic description of one site — its
 * collections, their fields and section types, media and publishing — plus the
 * site's own instruction files. It sits in the cached system prefix, so it
 * must serialise byte-identically for the same site: no timestamps, no counts
 * that change with every edit, keys sorted wherever objects are printed.
 */
import type { BlockType, Collection, Field, JsonValue, SiteModel, SiteService } from "../types";
import { mayBeShown } from "../workspace/policy";

/** Caps keep a sprawling content guide from crowding out the conversation. */
export const INSTRUCTIONS_TOTAL_CHARS = 24_000;
export const INSTRUCTIONS_FILE_CHARS = 16_000;

export interface InstructionFile {
  path: string;
  content: string | null;
}

/** JSON with sorted keys at every level. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

function short(value: JsonValue, max = 60): string {
  const text = typeof value === "string" ? value : stableJson(value);

  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** "heading: string, required" · "tone: select (default | muted | inverse)" · "cta: {label: string; href: url}". */
function typeOf(field: Field, depth: number): string {
  if (field.type === "select" && field.options?.length) return `select (${field.options.map((o) => short(o, 30)).join(" | ")})`;
  if (field.type === "tags" && field.options?.length) return `tags (seen: ${field.options.slice(0, 8).join(", ")})`;
  if (field.type === "reference" && field.collection) return `reference to ${field.collection}`;
  if (field.type === "object" && field.fields?.length && depth < 3) {
    return `{${field.fields.map((f) => describeField(f, depth + 1)).join("; ")}}`;
  }
  if (field.type === "list" && field.of) return `list of ${depth < 3 ? typeOf(field.of, depth + 1) : field.of.type}`;
  if (field.type === "blocks") return `sections, each with “${field.discriminator ?? "type"}” naming its type (types listed below)`;
  return field.type;
}

export function describeField(field: Field, depth = 0): string {
  const parts: string[] = [typeOf(field, depth)];

  if (field.required) parts.push("required");
  if (field.default !== undefined) parts.push(`default ${short(field.default, 30)}`);
  if (field.hidden) parts.push("hidden from the form");
  const label = field.label && field.label.toLowerCase() !== field.key.toLowerCase() ? ` “${field.label}”` : "";

  return `${field.key}${label}: ${parts.join(", ")}`;
}

function describeBlock(block: BlockType, discriminator: string): string {
  const fields = block.fields.filter((f) => f.key !== discriminator).map((f) => describeField(f, 1));
  const label = block.label && block.label.toLowerCase() !== block.type.toLowerCase() ? ` (“${block.label}”)` : "";

  return `    - ${block.type}${label}${block.description ? ` — ${block.description}` : ""}: ${fields.join("; ") || "no fields"}`;
}

function describeCollection(collection: Collection): string[] {
  const where =
    collection.kind === "data"
      ? `one data file at ${collection.path}`
      : `one file per ${collection.singular} under ${collection.path}${collection.pattern ? ` (${collection.pattern})` : ""}`;
  const traits = [
    collection.format,
    collection.body ? "with a main text (markdown body)" : "fields only",
    collection.url ? `page URL ${collection.url}` : "no page of its own",
    collection.create ? "new items allowed" : "no new items",
  ];
  const lines = [
    `### ${collection.id} — “${collection.label}” (one is a “${collection.singular}”)${collection.hidden ? " [hidden]" : ""}`,
    `${where}; ${traits.join("; ")}.`,
  ];

  if (collection.description) lines.push(collection.description);
  const keys = [
    collection.titleField && `title: ${collection.titleField}`,
    collection.dateField && `date: ${collection.dateField}`,
    collection.imageField && `image: ${collection.imageField}`,
    collection.draftField && `draft flag: ${collection.draftField}`,
  ].filter(Boolean);

  if (keys.length) lines.push(`Key fields — ${keys.join(", ")}.`);
  lines.push("Fields:", ...describeFields(collection.fields));
  return lines;
}

/** One line per field, with every section type of a blocks field listed under it. */
export function describeFields(fields: Field[]): string[] {
  const lines: string[] = [];

  for (const field of fields) {
    lines.push(`  - ${describeField(field)}`);
    if (field.type === "blocks" && field.blocks?.length) {
      const discriminator = field.discriminator ?? "type";

      lines.push(`    Section types for ${field.key} (set “${discriminator}” to one of these):`);
      for (const block of [...field.blocks].sort((a, b) => a.type.localeCompare(b.type))) lines.push(describeBlock(block, discriminator));
    }
  }
  return lines;
}

export function buildSiteCard(model: SiteModel, instructions: InstructionFile[]): string {
  const lines: string[] = [];
  const framework = model.framework.version ? `${model.framework.name} ${model.framework.version}` : model.framework.name;
  const roots = model.media.roots
    .filter((root) => root.dir !== model.media.dir)
    .map((root) => `${root.dir} → ${root.publicPath}`)
    .sort();

  lines.push(`# The site: ${model.name}`);
  lines.push(`Built with ${framework}${model.build ? `; its build command is \`${model.build.command}\`` : "; no build command was found"}.`);
  lines.push(
    `Images: new ones are saved in ${model.media.dir} and used on pages as ${model.media.publicPath}/<file name>.${roots.length ? ` Other image folders: ${roots.join(", ")}.` : ""}`
  );
  lines.push(
    `Publishing: the person publishes from the app (${model.publish.mode === "pull-request" ? "as a request for review" : `onto the ${model.publish.branch} branch`}); you never publish.`
  );
  lines.push(`Build mode is ${model.ai.allowBuild ? "available" : "turned off"} on this site.`);
  lines.push(`Content mode may change: ${[...model.writable.content].sort().join(", ") || "nothing"}.`);
  lines.push(`Build mode may also change: ${[...model.writable.build].sort().join(", ") || "nothing more"}.`);
  lines.push("");
  lines.push("## Collections");
  for (const collection of [...model.collections].sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(...describeCollection(collection), "");
  }
  let card = lines.join("\n").trimEnd();
  let budget = INSTRUCTIONS_TOTAL_CHARS;

  for (const file of [...instructions].sort((a, b) => a.path.localeCompare(b.path))) {
    if (file.content === null) {
      card += `\n\n<instructions file="${file.path}">\n(This file is listed in the site's settings but couldn't be read.)\n</instructions>`;
      continue;
    }
    const limit = Math.min(INSTRUCTIONS_FILE_CHARS, budget);
    let text = file.content.trim();

    if (text.length > limit) {
      text = `${text.slice(0, Math.max(0, limit))}\n\n[Shortened here: the rest of this file (${text.length - limit} more characters) isn't shown. In build mode you can read it in full.]`;
    }
    budget = Math.max(0, budget - Math.min(file.content.length, limit));
    card += `\n\n<instructions file="${file.path}">\nThe site's own guidance — follow it unless the person asks otherwise.\n\n${text}\n</instructions>`;
  }
  return card;
}

export async function loadInstructionFiles(site: SiteService, model: SiteModel): Promise<InstructionFile[]> {
  const files: InstructionFile[] = [];

  for (const path of [...new Set(model.ai.instructions)]) {
    // The settings name these files, and what they hold goes into every conversation: never a secrets file, whatever the settings say.
    if (!mayBeShown(path)) {
      files.push({ path, content: null });
      continue;
    }
    try {
      const file = await site.readFile(path);

      files.push({ path, content: file.binary ? null : file.content });
    } catch {
      files.push({ path, content: null });
    }
  }
  return files;
}
