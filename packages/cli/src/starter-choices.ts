/**
 * The starters as people choose them: by a short name (`caddow`, `ferrow`,
 * `lowfield`, `storefront`) declared in each starter.json as `short`, with a
 * one-line `summary` and a count of what is inside. The folder ids
 * (`astro-editorial`…) keep working wherever a short name does.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listStarters } from "@galley/core/site";
import type { StarterInfo } from "@galley/core/types";

/** The starter `galley new` uses when none is chosen. */
export const DEFAULT_STARTER = "lowfield";

export interface StarterChoice {
  /** The starter's folder, e.g. astro-editorial. */
  id: string;
  /** What people type, e.g. caddow. */
  short: string;
  /** "Caddow — fashion editorial" */
  name: string;
  /** One line on what it is for. */
  summary: string;
  /** "20 sections · 6 page templates · 3 looks" */
  inside: string;
  /** The lowest Node version the starter's package.json accepts ("22.23.4"), if it says. */
  node: string | null;
  info: StarterInfo;
}

function readJson(path: string): Record<string, unknown> {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;

    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function count(dir: string, extension: string): number {
  try {
    return readdirSync(dir).filter((file) => file.endsWith(extension)).length;
  } catch {
    return 0;
  }
}

function counted(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** ">=22.23.4" → "22.23.4"; "^22.12 || >=24" → "22.12.0". Only the lowest bound matters here. */
export function minimumNode(range: unknown): string | null {
  if (typeof range !== "string") return null;
  const match = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(range);

  return match ? `${match[1]}.${match[2] ?? 0}.${match[3] ?? 0}` : null;
}

/** "abc-def" → "abc-def"; anything else → a lowercase, dashed short name. */
function shortFrom(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";

  return /^[a-z0-9][a-z0-9-]*$/.test(text) ? text : fallback;
}

export async function loadStarterChoices(startersDir: string): Promise<StarterChoice[]> {
  const starters = await listStarters(startersDir);
  const choices = starters.map((info): StarterChoice => {
    const dir = join(startersDir, info.id);
    const manifest = readJson(join(dir, "starter.json"));
    const pkg = readJson(join(dir, "package.json"));
    const sections = count(join(dir, "galley", "sections"), ".webp");
    const templates = count(join(dir, "galley", "templates"), ".md");
    const looks = info.looks?.length ?? 0;
    const parts = [
      ...(sections ? [counted(sections, "section")] : []),
      ...(templates ? [counted(templates, "page template")] : []),
      ...(looks ? [counted(looks, "look")] : []),
    ];
    const summary = typeof manifest.summary === "string" && manifest.summary.trim() ? manifest.summary.trim() : info.description.split(/(?<=\.)\s/)[0]!.replace(/\.$/, "");

    return {
      id: info.id,
      short: shortFrom(manifest.short, info.id),
      name: info.name,
      summary,
      inside: parts.join(" · "),
      node: minimumNode((pkg.engines as Record<string, unknown> | undefined)?.node),
      info,
    };
  });

  // The default first, then by short name, so Enter in the picker takes the usual choice.
  return choices.sort((a, b) => (a.short === DEFAULT_STARTER ? -1 : b.short === DEFAULT_STARTER ? 1 : a.short.localeCompare(b.short)));
}

/** A starter by its short name or its folder, ignoring case. */
export function findStarter(choices: StarterChoice[], query: string): StarterChoice | null {
  const wanted = query.trim().toLowerCase();

  return choices.find((choice) => choice.short === wanted) ?? choices.find((choice) => choice.id.toLowerCase() === wanted) ?? null;
}

/** "caddow, ferrow, lowfield or storefront" */
export function shortList(choices: StarterChoice[]): string {
  const names = choices.map((choice) => choice.short).sort();

  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

/** The short name as a word in a sentence: "caddow" → "Caddow". */
export function displayName(choice: StarterChoice): string {
  return choice.short.charAt(0).toUpperCase() + choice.short.slice(1);
}
