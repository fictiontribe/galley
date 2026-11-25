/**
 * Site test helpers: a real copy of the Astro starter in a temporary git
 * repository, opened through the real facade. Git is isolated from the
 * machine's configuration by the workspace helpers this re-exports.
 */
import { appendFileSync, cpSync, mkdirSync, symlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEventBus } from "../../src/site/index";
import { openSiteService, type OpenSite, type SiteDeps } from "../../src/site/service";
import type { ServerEvent } from "../../src/types";
import { sh, tempDir } from "../workspace/helpers";

export { addBareRemote, cleanupAll, pngHeader, sh, tempDir, until, writeTree } from "../workspace/helpers";

export const STARTER = fileURLToPath(new URL("../../../../starters/astro-starter", import.meta.url));
const SKIP = new Set(["node_modules", "dist", ".astro"]);

export const AUTHOR = { name: "Test Editor", email: "editor@example.com" };

/** The starters that ship with the app, by folder name. */
export const STARTERS = ["astro-starter", "astro-editorial", "astro-saas", "astro-storefront"] as const;
export type StarterName = (typeof STARTERS)[number];

/** Copies a starter (never its installed packages or build output) into `target`. */
export function copyStarter(target: string, starter: StarterName = "astro-starter"): void {
  mkdirSync(target, { recursive: true });
  cpSync(join(STARTER, "..", starter), target, { recursive: true, filter: (source) => !SKIP.has(basename(source)) });
}

/**
 * A fresh site: the starter, `git init`, one commit with an explicit identity.
 * `nodeModules` links the starter's installed packages (only the preview needs them).
 */
export function makeSite(options: { nodeModules?: boolean; branch?: string; starter?: StarterName } = {}): string {
  const root = tempDir("site-test-");

  copyStarter(root, options.starter);
  sh(root, "init", "-q", "-b", options.branch ?? "main");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "Initial");
  if (options.nodeModules) {
    symlinkSync(join(STARTER, "node_modules"), join(root, "node_modules"), "dir");
    // `node_modules/` in .gitignore only matches directories; a link to one would show as a new file.
    appendFileSync(join(root, ".git", "info", "exclude"), "node_modules\n");
  }
  return root;
}

export interface Harness {
  site: OpenSite;
  events: ServerEvent[];
  /** Events of one type, narrowed. */
  of<T extends ServerEvent["type"]>(type: T): Array<Extract<ServerEvent, { type: T }>>;
}

const open: OpenSite[] = [];

export async function openSite(root: string, overrides: Partial<SiteDeps> = {}): Promise<Harness> {
  const bus = createEventBus();
  const events: ServerEvent[] = [];

  bus.subscribe((event) => events.push(event));
  const site = await openSiteService(root, {
    id: "test-site",
    events: bus,
    overlayScript: () => "/* overlay */",
    author: () => AUTHOR,
    watch: false,
    ...overrides,
  });

  open.push(site);
  return {
    site,
    events,
    of: <T extends ServerEvent["type"]>(type: T) => events.filter((event): event is Extract<ServerEvent, { type: T }> => event.type === type),
  };
}

export async function disposeAll(): Promise<void> {
  while (open.length) await open.pop()?.dispose();
}

export const HOME = "src/content/pages/index.md";
export const PRICING = "src/content/pages/pricing.md";
export const POST = "src/content/blog/measured-survey.md";
export const HERO_HEADING = "Make more of the *home you already have*.";
