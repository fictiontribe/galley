/**
 * The demo's stand-in for mock/fixtures.ts (vite.demo.config.ts swaps it in
 * for the demo build; the dev server and the tests keep the original).
 *
 * One site, Caddow, as starters/astro-editorial ships it: its text files are
 * snapshotted into the bundle at build time (`virtual:galley-demo/site`), and
 * its photographs are files served beside the demo, held here as stand-ins of
 * the right size that point at them (StaticFile). No pending changes: the
 * visitor's own edits are the only ones. Three published versions by an
 * invented person.
 */
import type { HistoryEntry } from "@galley/core/types";
import { STATIC_FILES, TEXT_FILES } from "virtual:galley-demo/site";
import { MockSite, type CollectionDef, type SiteSeed } from "../mock/site.ts";
import { bufferFrom, StaticFile } from "./shim/buffer";

/** The pretend disk. A placeholder folder, not anyone's computer. */
export const HOME = "/Users/you";
export const SITES_DIR = `${HOME}/Sites`;

/** The demo's one site: a fixed id so links into the demo (`#/sites/caddow/edit`) keep working. */
export const DEMO_SITE_ID = "caddow";

export const DEMO_AUTHOR = { name: "Tobiah Rusk", email: "tobiah@caddow.example" };

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

function commitFor(seed: string): string {
  let hash = "";
  for (let i = 0; hash.length < 40; i++) hash += ((seed.charCodeAt(i % seed.length) * (i + 7)) % 16).toString(16);
  return hash;
}

function history(entries: Array<Omit<HistoryEntry, "commit" | "shortCommit" | "author" | "email">>): HistoryEntry[] {
  return entries.map((entry) => {
    const commit = commitFor(entry.message);
    return { ...entry, author: DEMO_AUTHOR.name, email: DEMO_AUTHOR.email, commit, shortCommit: commit.slice(0, 7) };
  });
}

function files(): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const [path, text] of Object.entries(TEXT_FILES)) out.set(path, bufferFrom(text) as unknown as Buffer);
  for (const [path, file] of Object.entries(STATIC_FILES)) out.set(path, StaticFile.at(file.url, file.size) as unknown as Buffer);
  return out;
}

/** What detection reports for this starter (src/content.config.ts and galley.config.json). */
const COLLECTIONS: CollectionDef[] = [
  { id: "pages", label: "Pages", singular: "page", kind: "entries", path: "src/content/pages", pattern: "**/*.md", format: "markdown", body: true, url: "/{slug}/", titleField: "title", imageField: "image", create: true },
  { id: "lookbooks", label: "Lookbooks", singular: "lookbook", kind: "entries", path: "src/content/lookbooks", pattern: "*.md", format: "markdown", body: true, url: "/collections/{slug}/", titleField: "title", dateField: "date", imageField: "cover", create: true },
  { id: "journal", label: "Journal", singular: "story", kind: "entries", path: "src/content/journal", pattern: "*.md", format: "markdown", body: true, url: "/journal/{slug}/", titleField: "title", dateField: "date", imageField: "image", create: true },
  { id: "forms", label: "Forms", singular: "form", kind: "entries", path: "src/content/forms", pattern: "*.json", format: "json", body: false, url: null, titleField: "name", create: true, source: "schema" },
  { id: "site", label: "Site details", singular: "site details", kind: "data", path: "src/data/site.json", format: "json", body: false, url: null, create: false, source: "inferred" },
  { id: "navigation", label: "Navigation", singular: "navigation", kind: "data", path: "src/data/navigation.json", format: "json", body: false, url: null, create: false, source: "inferred" },
  { id: "stockists", label: "Stockists", singular: "stockists", kind: "data", path: "src/data/stockists.json", format: "json", body: false, url: null, create: false, source: "inferred" },
  { id: "scripts", label: "Scripts", singular: "scripts", kind: "data", path: "src/data/scripts.json", format: "json", body: false, url: null, create: false, source: "inferred" },
];

function caddowSeed(): SiteSeed {
  return {
    id: DEMO_SITE_ID,
    name: "Caddow",
    root: `${SITES_DIR}/caddow`,
    framework: { id: "astro", name: "Astro", version: "7.4" },
    packageManager: "npm",
    files: files(),
    collections: COLLECTIONS,
    notes: [
      "Read 4 collections from src/content.config.ts: pages, lookbooks, journal, forms.",
      "Found 4 data files in src/data: site.json, navigation.json, stockists.json, scripts.json.",
      "Applied galley.config.json: 20 section types with pictures, 6 templates.",
    ],
    mediaDir: "public/images",
    mediaPublicPath: "/images",
    urls: { production: "https://www.caddow.example" },
    dev: { command: "astro dev", port: 4321 },
    build: { command: "astro build", outDir: "dist" },
    branch: "main",
    remoteUrl: "https://git.caddow.example/caddow/site.git",
    behind: 0,
    history: history([
      { message: "Update the stockists for winter", date: hoursAgo(26), files: ["src/data/stockists.json", "src/content/pages/stockists.md"], viaGalley: true },
      { message: "Add the Autumn–Winter 2026 lookbook", date: hoursAgo(74), files: ["src/content/lookbooks/aw26-the-long-afternoon.md", "src/content/pages/index.md"], viaGalley: true },
      { message: "First version of the site", date: hoursAgo(24 * 21), files: ["src/content/pages/index.md", "src/content/pages/atelier.md", "src/content.config.ts"], viaGalley: false },
    ]),
  };
}

export function createSites(): MockSite[] {
  const site = new MockSite(caddowSeed());
  site.lastOpenedAt = Date.now() - 20 * 60_000;
  return [site];
}

/** "New site" and "Clone" in the demo start another copy of the sample site under the name given. */
export function newSiteFrom(_kind: "starter" | "docs", name: string, folder: string): MockSite {
  const seed = caddowSeed();
  const slug = folder.replace(/^.*\//, "").replace(/[^a-z0-9-]+/gi, "-").toLowerCase() || "site";
  return new MockSite({ ...seed, id: `${slug}-${Date.now().toString(36)}`, name, root: folder.startsWith("/") ? folder : `${SITES_DIR}/${folder}`, history: seed.history.slice(-1) });
}

export function starterDescription(): string {
  return "A photography-led site for a small fashion label: a campaign home page, lookbooks, a journal and stockists.";
}
