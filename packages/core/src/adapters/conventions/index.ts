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

export const docusaurusAdapter = conventionAdapter({
  id: "docusaurus",
  name: "Docusaurus",
  packages: ["@docusaurus/core"],
  files: ["docusaurus.config.js", "docusaurus.config.ts"],
  dev: { port: 3000 },
  build: { outDir: "build" },
  publicDir: "static",
  contentDirs: ["docs", "blog", "src/pages"],
  dataDirs: ["data"],
  conventions(ctx): AdapterConventions {
    const text = ctx.readText("docusaurus.config.js") ?? ctx.readText("docusaurus.config.ts");
    const match = text ? /\burl\s*:\s*["'](https?:\/\/[^"']+)["']/.exec(text) : null;
    const production = httpUrl(match?.[1]);

    return production ? { urls: { production } } : {};
  },
});

export const nuxtAdapter = conventionAdapter({
  id: "nuxt",
  name: "Nuxt",
  packages: ["nuxt", "@nuxt/content"],
  files: ["nuxt.config.ts", "nuxt.config.js"],
  dev: { port: 3000 },
  build: { outDir: ".output/public" },
  publicDir: "public",
  contentDirs: ["content"],
  pageDirs: ["content"],
  dataDirs: ["data", "content/data"],
});

export const nextAdapter = conventionAdapter({
  id: "next",
  name: "Next.js",
  packages: ["next"],
  files: ["next.config.js", "next.config.mjs", "next.config.ts"],
  dev: { port: 3000 },
  build: { outDir: "out" },
  publicDir: "public",
  contentDirs: ["content", "posts", "_posts", "src/content", "data/blog"],
  dataDirs: ["data", "src/data"],
});

export const sveltekitAdapter = conventionAdapter({
  id: "sveltekit",
  name: "SvelteKit",
  packages: ["@sveltejs/kit"],
  files: ["svelte.config.js", "svelte.config.ts"],
  dev: { port: 5173 },
  build: { outDir: "build" },
  publicDir: "static",
  contentDirs: ["src/content", "src/posts", "content", "posts"],
  dataDirs: ["src/data", "src/lib/data"],
});
