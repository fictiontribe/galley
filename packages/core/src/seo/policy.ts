/**
 * The AI-crawler policy as a file of the site's own: where its robots rules
 * live, what they say about each documented crawler, and — when they are a
 * plain robots.txt the app may write — a surgical change to a marked block.
 * When the site writes robots.txt in code (Astro's src/pages/robots.txt.ts,
 * Next's app/robots.ts), the rules are the code's: the report says so and
 * the change is a job for build mode or a developer. When the site kit
 * writes robots.txt, the choices live in the kit's data file
 * (`crawlers` in src/data/visibility.json) and are edited there — creating
 * public/robots.txt would make the kit step aside and drop everything else
 * it writes.
 */
import { GalleyError } from "../errors";
import type { EditOp, JsonValue, SiteService } from "../types";
import { detectKit, KIT_GLOB, type KitInfo } from "./kit";
import type { RenderSource } from "./render";
import { CRAWLERS, crawlerStatus, describePolicy, isAllowed, kitCrawlerStatus, parseRobots, planRobotsPolicy, summarizeCrawlers, type RobotsFile } from "./robots";
import type { CrawlerChoice, CrawlerReport } from "./types";

const STATIC = ["public/robots.txt", "static/robots.txt", "src/robots.txt", "robots.txt", "site/robots.txt"];
const GENERATED = /^(src\/pages\/robots\.txt\.(ts|js|mjs)|src\/pages\/robots\.txt\.astro|app\/robots\.(ts|js)|src\/app\/robots\.(ts|js)|pages\/robots\.txt\.(ts|js)|src\/routes\/robots\.txt\/\+server\.(ts|js))$/;

export type RobotsLocation = CrawlerReport["where"];

export const ROBOTS_GLOB = "{robots.txt,*/robots.txt,src/pages/robots.txt.*,app/robots.*,src/app/robots.*,pages/robots.txt.*,src/routes/robots.txt/+server.*}";

/**
 * `files`: the site's file list when the caller already has it (listing a big
 * site takes a while); it must cover ROBOTS_GLOB and KIT_GLOB. The site's own
 * robots.txt — a file or a route — wins over the kit, as it does in a build.
 */
export async function locateRobots(site: SiteService, files?: string[], kit?: KitInfo | null): Promise<RobotsLocation> {
  files ??= await site.listFiles({ glob: `{${ROBOTS_GLOB.slice(1, -1)},${KIT_GLOB.slice(1, -1)}}`, limit: 80 }).catch(() => [] as string[]);
  const generated = files.find((file) => GENERATED.test(file));

  if (generated) return { kind: "generated", path: generated };
  const plain = STATIC.find((candidate) => files.includes(candidate));

  if (plain) return { kind: "static", path: plain };
  const found = kit === undefined ? await detectKit(site, files) : kit;

  return found?.robots ? { kind: "kit", path: found.file } : { kind: "none" };
}

export interface RobotsRead {
  where: RobotsLocation;
  text: string | null;
  from: CrawlerReport["readFrom"];
  file: RobotsFile | null;
  /** On a kit site: the choices in its data file, and whether its site-wide rules block everything. */
  kit?: { choices: Record<string, CrawlerChoice>; siteBlocked: boolean };
}

/** The rules as served: the static file itself, else what the preview or build serves at /robots.txt. */
export async function readRobots(site: SiteService, source: RenderSource | null, files?: string[], kitInfo?: KitInfo | null): Promise<RobotsRead> {
  const kit = kitInfo === undefined ? await detectKit(site, files) : kitInfo;
  const where = await locateRobots(site, files, kit);

  if (where.kind === "kit" && kit) {
    // The data file is the truth: it is what the next build (and the preview, on its next request) writes.
    const robots = kit.data.robots && typeof kit.data.robots === "object" && !Array.isArray(kit.data.robots) ? (kit.data.robots as { [key: string]: JsonValue }) : {};
    const siteBlocked = Array.isArray(robots.disallow) && robots.disallow.includes("/");
    const served = source ? await source.get("/robots.txt") : null;
    const text = served && served.status === 200 && !/html/.test(served.type) ? served.body : null;

    return { where, text, from: "kit", file: text === null ? null : parseRobots(text), kit: { choices: kit.crawlers, siteBlocked } };
  }
  if (where.kind === "static") {
    const text = (await site.readFile(where.path).catch(() => null))?.content ?? null;

    return { where, text, from: text === null ? null : "file", file: text === null ? null : parseRobots(text) };
  }
  if (source) {
    const served = await source.get("/robots.txt");

    if (served && served.status === 200 && !/html/.test(served.type)) return { where, text: served.body, from: source.kind, file: parseRobots(served.body) };
    if (served && served.status === 404 && where.kind === "none") return { where, text: null, from: source.kind, file: null };
  }
  return { where, text: null, from: null, file: null };
}

export function crawlerReport(read: RobotsRead, writable: boolean): CrawlerReport {
  if (read.where.kind === "kit" && read.kit) {
    const statuses = kitCrawlerStatus(read.kit.choices, read.kit.siteBlocked);

    return {
      where: read.where,
      readable: true,
      readFrom: "kit",
      blocksEverything: read.kit.siteBlocked,
      crawlers: statuses,
      summary: summarizeCrawlers(statuses),
      policy: describePolicy(read.kit.choices),
      // A content file: no build mode needed.
      editable: true,
      sitemaps: read.file?.sitemaps ?? [],
    };
  }
  const statuses = crawlerStatus(read.file);
  const readable = read.from !== null;
  const blocksEverything = read.file ? !isAllowed(read.file, "googlebot", "/").allowed && !isAllowed(read.file, "*", "/").allowed : false;
  let editNote: string | undefined;

  if (read.where.kind === "generated") editNote = `This site writes its robots rules in code (${read.where.path}). Change them in build mode, or ask a developer.`;
  else if (!writable) editNote = "Changing robots.txt needs build mode, which is turned off for this site.";
  return {
    where: read.where,
    readable,
    readFrom: read.from,
    blocksEverything,
    crawlers: statuses,
    summary: readable ? summarizeCrawlers(statuses) : [read.where.kind === "generated" ? "The rules are written by the site's code; start the preview or build the site to read what they say." : "No robots rules were found, so every crawler is allowed by default."],
    editable: read.where.kind !== "generated" && writable,
    ...(editNote ? { editNote } : {}),
    sitemaps: read.file?.sitemaps ?? [],
  };
}

/**
 * Applies the person's choices to a plain robots.txt (creating
 * public/robots.txt when the site has none and serves its public folder).
 * Writes as a deliberate settings change in build mode's surface — robots.txt
 * isn't content — so the engine refuses when the site has build mode off.
 */
export async function applyCrawlerPolicy(site: SiteService, choices: Record<string, CrawlerChoice>): Promise<{ path: string; changed: boolean }> {
  const kit = await detectKit(site);
  const where = await locateRobots(site, undefined, kit);

  if (where.kind === "kit" && kit) return applyKitPolicy(site, kit, choices);
  if (where.kind === "generated") throw new GalleyError("invalid", `This site writes its robots rules in code (${where.path}), so they can't be changed from here. Change them in build mode, or ask a developer.`);
  const model = await site.model();
  const path = where.kind === "static" ? where.path : model.framework.id === "hugo" ? "static/robots.txt" : "public/robots.txt";
  const current = where.kind === "static" ? await site.readFile(path) : null;
  const plan = planRobotsPolicy(current?.content ?? "User-agent: *\nAllow: /\n", choices);

  if (!plan.ok) throw new GalleyError("invalid", plan.reason);
  if (!plan.changed) return { path, changed: false };
  await site.writeFile(path, plan.text, { origin: "user", mode: "build", ...(current ? { baseHash: current.hash } : {}) });
  return { path, changed: true };
}

/**
 * The kit's data file, edited in place: `crawlers.<token>` set to "block",
 * or removed for "allow" (the kit's default — an explicit "allow" only
 * repeats the site-wide rules). Through the engine's own edits, so the
 * change is a one-line diff waiting in Proof, and Discard puts it back.
 */
async function applyKitPolicy(site: SiteService, kit: KitInfo, choices: Record<string, CrawlerChoice>): Promise<{ path: string; changed: boolean }> {
  const known = new Map(CRAWLERS.map((crawler) => [crawler.token.toLowerCase(), crawler.token]));

  for (const token of Object.keys(choices)) if (!known.has(token.toLowerCase())) throw new GalleyError("invalid", `${token} isn't one of the crawlers this setting covers.`);
  const current = { ...kit.crawlers };
  const tokenIn = (token: string) => Object.keys(current).find((key) => key.toLowerCase() === token.toLowerCase());
  const ops: EditOp[] = [];
  const hasCrawlers = kit.data.crawlers !== undefined && typeof kit.data.crawlers === "object" && !Array.isArray(kit.data.crawlers);
  const next: Record<string, CrawlerChoice> = { ...current };

  for (const [token, choice] of Object.entries(choices)) {
    const key = tokenIn(token) ?? known.get(token.toLowerCase())!;
    const was = current[key];

    if (choice === "block" && was !== "block") {
      next[key] = "block";
      if (hasCrawlers) ops.push({ op: "set", path: ["crawlers", key], value: "block" });
    } else if (choice === "allow" && was !== undefined) {
      delete next[key];
      if (hasCrawlers) ops.push({ op: "unset", path: ["crawlers", key] });
    }
  }
  if (!hasCrawlers && Object.keys(next).length !== Object.keys(current).length) ops.push({ op: "set", path: ["crawlers"], value: next });
  if (!ops.length) return { path: kit.file, changed: false };
  if (!kit.exists) {
    const text = `${JSON.stringify({ crawlers: next }, null, 2)}\n`;

    // A data file the site doesn't have yet isn't content the app knows; making it is a settings change.
    try {
      await site.writeFile(kit.file, text, { origin: "user", mode: "content" });
    } catch (error) {
      if (!(error instanceof GalleyError) || error.code !== "forbidden") throw error;
      try {
        await site.writeFile(kit.file, text, { origin: "user", mode: "build" });
      } catch {
        throw new GalleyError("forbidden", `The crawler choices go in ${kit.file}, which doesn't exist yet, and creating it needs build mode, which is turned off for this site. Create the file (it can hold just { "crawlers": {} }), or turn on build mode.`);
      }
    }
    return { path: kit.file, changed: true };
  }
  const result = await site.updateEntry(kit.file, ops, { origin: "user" });

  if (result.refused.length) throw new GalleyError("invalid", `The crawler choices couldn't be saved: ${result.refused[0]!.reason}`);
  return { path: kit.file, changed: result.applied > 0 };
}
