/**
 * Where the server finds its assets. Inside the monorepo they sit beside the
 * packages; in the bundled CLI (`dist/galley.mjs`) they are copied next to
 * the bundle, and esbuild defines __GALLEY_BUNDLED__.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCT } from "@galley/core/brand";

declare const __GALLEY_BUNDLED__: boolean | undefined;

export const BUNDLED = typeof __GALLEY_BUNDLED__ !== "undefined" && __GALLEY_BUNDLED__;

const here = dirname(fileURLToPath(import.meta.url));

/** Monorepo root (from packages/server/src). Meaningless in the bundle. */
const repoRoot = join(here, "..", "..", "..");

export function defaultWebDir(): string {
  return BUNDLED ? join(here, "web") : join(repoRoot, "packages", "web", "dist");
}

export function defaultStartersDir(): string {
  return BUNDLED ? join(here, "starters") : join(repoRoot, "starters");
}

export function defaultHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.GALLEY_HOME?.trim() || join(homedir(), PRODUCT.homeDir);
}

export function hasBuiltUi(webDir: string): boolean {
  return existsSync(join(webDir, "index.html"));
}
