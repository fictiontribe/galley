/**
 * Test scaffolding: tiny real image files, a git-initialised copy of the
 * starter site in a temp folder, and a fake WordPress server (fake-wordpress.ts).
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { png } from "./png";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll } from "vitest";
import { createEventBus, createSiteService, siteIdFor } from "@galley/core/site";
import type { SiteService } from "@galley/core/types";

export const REPO = fileURLToPath(new URL("../../..", import.meta.url));
export const STARTER = join(REPO, "starters", "astro-starter");
export const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));
export const OLD_SITE = "https://old.example.org";
const SKIP = new Set(["node_modules", "dist", ".astro"]);
const created: string[] = [];

afterAll(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
  try {
    rmdirSync(join(tmpdir(), "galley-import-wp"));
  } catch {
    // Another test file still has folders in it.
  }
});

export function tempDir(prefix: string): string {
  const base = join(tmpdir(), "galley-import-wp");

  mkdirSync(base, { recursive: true });
  const dir = realpathSync(mkdtempSync(join(base, prefix)));

  created.push(dir);
  return dir;
}

// Git runs with a known identity and none of this machine's settings.
const gitConfig = join(tempDir("gitcfg-"), "gitconfig");

writeFileSync(gitConfig, "[user]\n\tname = Test Editor\n\temail = editor@example.com\n[init]\n\tdefaultBranch = main\n");
process.env.GIT_CONFIG_GLOBAL = gitConfig;
process.env.GIT_CONFIG_NOSYSTEM = "1";

export function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", env: process.env });
}

/** The invented WordPress site's writers, as the starter's authors collection would list them once they're on the new site. */
export const WP_AUTHORS = [
  { slug: "ana-whitcombe", title: "Ana Whitcombe" },
  { slug: "sam-okoro", title: "Sam Okoro" },
];

/**
 * A git-initialised copy of the starter, node_modules linked rather than
 * copied. The starter's journal credits every post to someone in its authors
 * collection, so the copy lists the WordPress site's writers there too (`people: false`
 * leaves them out, to see the importer ask who to credit).
 */
export function makeSite(name = "site", options: { people?: boolean } = {}): string {
  const root = join(tempDir(`${name}-`), name);

  cpSync(STARTER, root, { recursive: true, filter: (source) => !SKIP.has(source.split("/").pop() ?? "") });
  symlinkSync(join(STARTER, "node_modules"), join(root, "node_modules"));
  if (options.people !== false) {
    for (const author of WP_AUTHORS) writeFileSync(join(root, "src/content/authors", `${author.slug}.md`), `---\nname: ${author.title}\nbio: Writes for the studio.\n---\n`);
  }
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "Initial site");
  return root;
}

export async function openSite(root: string): Promise<SiteService> {
  return createSiteService(root, { id: siteIdFor(root), events: createEventBus(), overlayScript: () => "", author: () => null, watch: false });
}

export { png } from "./png";

/** The files the invented site serves under /wp-content/uploads/ (originals only, as on a real site). */
export function uploads(): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const images = [
    "2024/03/kiln-room.png",
    "2024/03/glaze-tiles.png",
    "2024/04/bowl.png",
    "2024/04/mugs.png",
    "2024/04/throwing.png",
    "2024/02/mara.png",
    "2024/01/banner-1200x600.png",
    "2024/01/logo-arts-council.png",
    "2024/01/logo-clay-guild.png",
    "2024/01/logo-town-trust.png",
    "2024/01/logo-kiln-co.png",
  ];

  images.forEach((file, i) => files.set(`/wp-content/uploads/${file}`, png(24, 16, i + 1)));
  // The same picture uploaded twice under two names: saved once.
  files.set("/wp-content/uploads/2024/04/mugs-copy.png", files.get("/wp-content/uploads/2024/04/mugs.png")!);
  files.set("/wp-content/uploads/2024/03/price-list.pdf", Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"));
  files.set("/wp-content/uploads/2024/04/throwing-demo.mp4", Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42"), Buffer.alloc(12)]));
  return files;
}

/** A fetch that sends the invented site's address to the fake server instead. */
export function redirectFetch(base: string): typeof fetch {
  return (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    return fetch(url.replace(OLD_SITE, base), init);
  };
}
