/**
 * Frameworks Galley recognises by convention alone: it knows how to run them
 * and where their content conventionally lives, and finds collections by
 * looking at folders. Each is one `conventionAdapter(spec)` — the same
 * factory a third-party author can use. A full adapter for any of them (one
 * that reads the framework's own config) is welcome; see docs/adapters.md.
 */
import { conventionAdapter } from "../../adapter/define";
import type { AdapterContext, AdapterConventions } from "../../adapter/types";
import type { JsonValue } from "../../types";

const isRecord = (value: JsonValue | null): value is { [key: string]: JsonValue } => value !== null && typeof value === "object" && !Array.isArray(value);
const httpUrl = (value: unknown): string | undefined => (typeof value === "string" && /^https?:\/\/[^\s]+$/.test(value) ? value.replace(/\/$/, "") : undefined);

export const eleventyAdapter = conventionAdapter({
  id: "eleventy",
  name: "Eleventy",
  packages: ["@11ty/eleventy"],
  files: [".eleventy.js", ".eleventy.cjs", "eleventy.config.js", "eleventy.config.mjs", "eleventy.config.cjs"],
  dev: { port: 8080 },
  build: { outDir: "_site" },
  publicDir: "public",
  contentDirs: ["src", "content", "."],
  pageDirs: ["src", "content", "."],
  dataDirs: ["_data", "src/_data"],
});

const HUGO_FILES = ["hugo.toml", "hugo.yaml", "hugo.yml", "hugo.json"];

export const hugoAdapter = conventionAdapter({
  id: "hugo",
  name: "Hugo",
  dev: { command: "hugo server", port: 1313 },
  build: { command: "hugo", outDir: "public" },
  publicDir: "static",
  contentDirs: ["content"],
  pageDirs: ["content"],
  dataDirs: ["data"],
  detect(ctx: AdapterContext) {
    if (HUGO_FILES.some((file) => ctx.exists(file))) return { confidence: 0.8 };
    // config.toml alone is too common to mean Hugo; require a content folder too.
    return ctx.exists("config.toml") && ctx.isDirectory("content") ? { confidence: 0.5 } : null;
  },
  conventions(ctx): AdapterConventions {
    for (const file of [...HUGO_FILES, "config.toml"]) {
      const data = ctx.readData(file);
      const production = isRecord(data) ? httpUrl(data.baseURL ?? data.baseurl) : undefined;

      if (production) return { urls: { production } };
    }
    return {};
  },
});

export const jekyllAdapter = conventionAdapter({
  id: "jekyll",
  name: "Jekyll",
  files: ["_config.yml", "_config.yaml"],
  requires: (ctx) => ctx.isDirectory("_posts") || ctx.exists("Gemfile"),
  dev: { command: "bundle exec jekyll serve", port: 4000 },
  build: { command: "bundle exec jekyll build", outDir: "_site" },
  publicDir: ".",
  contentDirs: ["_posts", "."],
  pageDirs: ["."],
  dataDirs: ["_data"],
  conventions(ctx): AdapterConventions {
    const data = ctx.readData("_config.yml") ?? ctx.readData("_config.yaml");
    const url = isRecord(data) ? httpUrl(data.url) : undefined;

    if (!url || !isRecord(data)) return {};
    const baseurl = typeof data.baseurl === "string" ? data.baseurl : "";

    return { urls: { production: `${url}${baseurl}`.replace(/\/$/, "") } };
  },
  // Posts are served at date-based permalinks (/2024/05/01/title/), which a {slug} pattern cannot express.
  routes(_ctx, collections) {
    return Object.fromEntries(collections.filter((collection) => /(^|\/)_posts$/.test(collection.path)).map((collection) => [collection.id, null]));
  },
});
