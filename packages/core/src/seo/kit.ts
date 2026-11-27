/**
 * Whether a site uses Galley's site kit for its agent-readable output, and
 * where the kit's data file is — by evidence, never by guess: the kit's
 * integration in the site's Astro config (the package `@galleycms/astro`, or a
 * vendored `src/galley/integration.js`), the file named in its options
 * (`galley({ visibility: { file } })`), and the data file itself
 * (`src/data/visibility.json` by default). `galley({ visibility: false })`
 * means the kit publishes nothing.
 *
 * The data file holds the site's crawler choices (`crawlers`), its
 * robots/sitemap rules, which collections get article details
 * (`structuredData.articles`) and what the agent-readable version includes
 * (`agentReadable`). See docs/ai-first-output.md.
 */
import type { JsonValue, SiteService } from "../types";

export const KIT_DEFAULT_FILE = "src/data/visibility.json";
const CONFIGS = ["astro.config.ts", "astro.config.mjs", "astro.config.js", "astro.config.mts", "astro.config.cjs"];

export interface KitInfo {
  /** The data file, repo-relative. */
  file: string;
  /** Whether the data file exists yet (the kit runs on defaults without one). */
  exists: boolean;
  /** Its parsed contents ({} when absent or unreadable). */
  data: { [key: string]: JsonValue };
  /** The kit writes robots.txt (unless the site has its own): `robots` isn't false. */
  robots: boolean;
  /** `structuredData.articles` as written: a list, "auto" (the default), or false. */
  articles: string[] | "auto" | false;
  agentReadable: { llmsTxt: boolean; llmsFullTxt: boolean; markdownTwins: boolean; agentPage: boolean };
  /** Token → choice, as the file states them. */
  crawlers: Record<string, "allow" | "block">;
  /** How the kit was found, for the report. */
  evidence: string;
}

export const KIT_GLOB = `{${CONFIGS.join(",")},src/galley/integration.js,${KIT_DEFAULT_FILE}}`;

function record(value: JsonValue | undefined): { [key: string]: JsonValue } | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/**
 * `files`: the site's file list when the caller has one (the audit lists the
 * site once); it must include the Astro config, the vendored integration
 * and the default data file when they exist.
 */
export async function detectKit(site: SiteService, files?: string[]): Promise<KitInfo | null> {
  files ??= await site.listFiles({ glob: KIT_GLOB, limit: 20 }).catch(() => [] as string[]);
  const configFile = CONFIGS.find((name) => files!.includes(name));
  const config = configFile ? ((await site.readFile(configFile).catch(() => null))?.content ?? "") : "";
  const imports = /from\s+["'](@galleycms\/astro|\.\/src\/galley\/integration(\.js)?)["']/.exec(config);
  const vendored = files.includes("src/galley/integration.js");

  if (/visibility\s*:\s*false/.test(config)) return null;
  const named = /visibility\s*:\s*\{[^}]*\bfile\s*:\s*["']([^"']+)["']/.exec(config)?.[1]?.replace(/^\.\//, "");
  const file = named ?? KIT_DEFAULT_FILE;
  const exists = named ? Boolean(await site.readFile(file).catch(() => null)) : files.includes(KIT_DEFAULT_FILE);

  // The integration in the config is the proof; the data file alone, with the
  // vendored kit beside it, is too (a config the app can't read statically).
  if (!imports && !(vendored && exists)) return null;
  let data: { [key: string]: JsonValue } = {};

  if (exists) {
    try {
      data = record(JSON.parse((await site.readFile(file)).content) as JsonValue) ?? {};
    } catch {
      data = {};
    }
  }
  const crawlers: Record<string, "allow" | "block"> = {};

  for (const [token, choice] of Object.entries(record(data.crawlers) ?? {})) if (choice === "allow" || choice === "block") crawlers[token] = choice;
  const structured = record(data.structuredData);
  const articles = structured?.articles;
  const agent = data.agentReadable === false ? null : (record(data.agentReadable) ?? {});
  const on = (key: string) => agent !== null && agent[key] !== false;

  return {
    file,
    exists,
    data,
    robots: data.robots !== false,
    articles: data.structuredData === false || articles === false ? false : Array.isArray(articles) ? articles.filter((item): item is string => typeof item === "string") : "auto",
    agentReadable: { llmsTxt: on("llmsTxt"), llmsFullTxt: on("llmsFullTxt"), markdownTwins: on("markdownTwins"), agentPage: on("agentPage") },
    crawlers,
    evidence: imports ? `${configFile} uses the site kit` : "the site kit is in src/galley/",
  };
}
