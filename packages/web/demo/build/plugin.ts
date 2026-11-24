/**
 * What makes the demo build different from the product build, all at build
 * time and all in this one Vite plugin (vite.demo.config.ts):
 *
 * 1. Two mock modules are swapped for the demo's: mock/fixtures.ts (reads the
 *    starter from disk) → demo/fixtures.ts, and mock/preview.ts (loopback
 *    HTTP servers) → demo/preview.ts. Every other mock module is the mock's own.
 * 2. `virtual:galley-demo/site` is the sample site, snapshotted: the text of
 *    its content, data and configuration files, and — for its photographs and
 *    pictures — where the built snapshot serves them and how big they are.
 * 3. mock/plugins.ts points at a sample video by `new URL(…, import.meta.url)`,
 *    which Vite would copy into the bundle (4 MB); the demo has no such file.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Plugin } from "vite";

const VIRTUAL = "virtual:galley-demo/site";
const RESOLVED = `\0${VIRTUAL}`;

export interface DemoPluginOptions {
  /** starters/astro-editorial */
  starterDir: string;
  /** The prepared public folder: `site/` (the built sample site) and `repo/` (pictures of sections and templates). */
  publicDir: string;
  /** The demo's base path, "/demo/". */
  base: string;
  mockDir: string;
  demoDir: string;
}

/** The starter's files the mock reads, as text. Code and build tooling stay out: the demo never shows them. */
export const TEXT_GLOBS: RegExp[] = [
  /^src\/content\/.+\.(md|json)$/,
  /^src\/data\/.+\.json$/,
  /^src\/content\.config\.ts$/,
  /^src\/styles\/.+\.css$/,
  /^galley\/templates\/.+\.md$/,
  /^(galley\.config\.json|package\.json|astro\.config\.ts|starter\.json|CONTENT-GUIDE\.md|README\.md)$/,
  /^public\/favicon\.svg$/,
];

/** Pictures the app shows from the repository (section and template thumbnails), served from `repo/`. */
export const REPO_PICTURES = /^galley\/(sections|templates)\/.+\.webp$/;

function walk(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist" || name === ".astro" || name.startsWith(".")) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) visit(full);
      else out.push(relative(root, full).split(sep).join("/"));
    }
  };
  visit(root);
  return out.sort();
}

export function snapshotModule(options: Pick<DemoPluginOptions, "starterDir" | "publicDir" | "base">): string {
  const siteDir = join(options.publicDir, "site");
  if (!existsSync(siteDir)) throw new Error(`The demo's sample site isn't built (${siteDir} is missing). Run \`pnpm --filter @galley/web build:demo\`, which builds it first.`);
  const texts: Record<string, string> = {};
  const statics: Record<string, { url: string; size: number }> = {};
  for (const path of walk(options.starterDir)) {
    if (TEXT_GLOBS.some((pattern) => pattern.test(path))) texts[path] = readFileSync(join(options.starterDir, path), "utf8");
    else if (REPO_PICTURES.test(path) && existsSync(join(options.publicDir, "repo", path))) {
      statics[path] = { url: `${options.base}repo/${path}`, size: statSync(join(options.publicDir, "repo", path)).size };
    }
  }
  // The photographs as the snapshot serves them (resized for the preview), at their place in the repository.
  const images = join(siteDir, "images");
  for (const path of existsSync(images) ? walk(images) : []) {
    statics[`public/images/${path}`] = { url: `${options.base}site/images/${path}`, size: statSync(join(images, path)).size };
  }
  return `export const TEXT_FILES = ${JSON.stringify(texts)};\nexport const STATIC_FILES = ${JSON.stringify(statics)};\n`;
}

export function demoPlugin(options: DemoPluginOptions): Plugin {
  const swaps: Record<string, string> = {
    [join(options.mockDir, "fixtures.ts")]: join(options.demoDir, "fixtures.ts"),
    [join(options.mockDir, "preview.ts")]: join(options.demoDir, "preview.ts"),
  };
  return {
    name: "galley-demo",
    enforce: "pre",
    async resolveId(source, importer, extra) {
      if (source === VIRTUAL) return RESOLVED;
      if (!importer || !importer.startsWith(options.mockDir)) return null;
      const resolved = await this.resolve(source, importer, { ...extra, skipSelf: true });
      const swap = resolved ? swaps[resolved.id] : undefined;
      return swap ?? null;
    },
    load(id) {
      if (id === RESOLVED) return snapshotModule(options);
      return null;
    },
    transform(code, id) {
      if (id !== join(options.mockDir, "plugins.ts")) return null;
      const next = code.replace(/new URL\("[^"]+\.mp4", import\.meta\.url\)/, '"file:///no-sample-video.mp4"');
      return next === code ? null : { code: next, map: null };
    },
  };
}
