/**
 * The content-code guard (src/site/content-code.ts, site-kit/guard.ts) as a
 * table driven through the real write surface: each row opens a fresh site of
 * one framework and makes one change — a write, an entry edit, a new entry or a
 * delete — as one kind of writer, and says whether it lands or what refuses it.
 *
 * Who: a contributor, an editor and an owner in the app; nobody (local); an
 * owner whose save came from the previewed page (marked); the assistant in a
 * content conversation on a hosted install, working for an owner; and the
 * assistant locally, where nothing changes.
 */
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GalleyError } from "../../src/errors";
import { requireCallerForGuardedWork, withCaller } from "../../src/install/caller";
import { asGeneratedRedirects } from "../../src/redirects/generated";
import { PAGE_SAVE_REFUSAL, PAGE_SAVE_REFUSAL_AT_BUILD_LEVEL } from "../../src/site/content-code";
import type { EditOp } from "../../src/types";
import { cleanupAll, disposeAll, openSite, sh, tempDir, writeTree } from "./helpers";

afterEach(async () => {
  requireCallerForGuardedWork(false);
  await disposeAll();
  cleanupAll();
});

// ── the sites

const md = (title: string, body = "Words.", extra = "") => `---\ntitle: ${title}\n${extra}---\n\n${body}\n`;
const LAYOUT = "layout: ../../layouts/Base.astro\n";

type SiteKind =
  | "astro"
  | "astro-claims"
  | "astro-build-off"
  | "astro-vercel"
  | "hugo-claims"
  | "jekyll-claims"
  | "eleventy-root"
  | "eleventy-src"
  | "eleventy-src-plain"
  | "jekyll"
  | "jekyll-root-media"
  | "generic-root"
  | "generic-links"
  | "generic-dots"
  | "generic-vitepress"
  | "generic-mkdocs";

const SITES: Record<SiteKind, { config: object; files: Record<string, string>; links?: Array<[string, string]> }> = {
  astro: {
    config: {
      name: "Probe",
      framework: "astro",
      ai: { allowBuild: true },
      redirects: { host: "netlify" },
      templates: [{ id: "with-layout", label: "With a layout", collection: "pages", file: "src/templates/with-layout.md" }],
      collections: [
        { id: "pages", path: "src/content/pages", format: "markdown", pattern: "**/*.md" },
        { id: "docs", path: "src/content/docs", format: "mdx", pattern: "**/*.mdx" },
        { id: "kb", path: "src/content/kb", format: "markdown", pattern: "**/*.{md,mdoc}" },
        { id: "nav", kind: "data", path: "src/data/nav.yaml", format: "yaml" },
        { id: "site", kind: "data", path: "src/data/site.json", format: "json" },
        { id: "scripts", kind: "data", path: "src/data/scripts.json", format: "json" },
      ],
    },
    files: {
      "src/content/pages/about.md": md("About"),
      "src/content/pages/framed.md": md("Framed", "Framed page.", LAYOUT),
      "src/content/pages/bom.md": `\uFEFF${md("Bom")}`,
      "src/content/pages/linked-page.md": md("Linked", "See [the about page](../about/)."),
      // Links a later save could try to turn into images: plain, with code in its text after an image, and by reference.
      "src/content/pages/module-link.md": md("Module link", "[a](../../lib/marker.mjs?x.png)"),
      "src/content/pages/code-link.md": md("Code link", "![p](./photo.png) **[`x`](../../lib/marker.mjs)**"),
      "src/content/pages/ref-link.md": md("Ref link", "![p](./photo.png)\n\nSee [a][m].\n\n[m]: ../../lib/marker.mjs"),
      "src/content/pages/agents.md": md("Our agents"),
      "src/lib/marker.mjs": "export default 1;\n",
      "public/og-default.png": "png",
      "src/content/docs/intro.mdx": md("Intro"),
      "src/content/kb/a.md": md("A"),
      "src/data/nav.yaml": "items: []\n",
      "src/data/site.json": "{}\n",
      "src/data/scripts.json": `${JSON.stringify({ consent: { mode: "none" }, scripts: [{ id: "chat", kind: "custom", label: "Chat", enabled: false, settings: { inline: "console.log(1)" } }] }, null, 2)}\n`,
      "src/data/redirects.json": '{ "redirects": [] }\n',
      "src/layouts/Base.astro": "---\n---\n<slot />\n",
      "src/templates/with-layout.md": md("New", "Body.", LAYOUT),
      "public/images/a.png": "png",
      "package.json": '{ "name": "probe", "type": "module" }\n',
    },
    // A folder link inside a collection, to the site's layouts: the name is a page, the bytes would land in src/layouts.
    links: [["../../layouts", "src/content/pages/linked"]],
  },
  // Collections an owner pointed at the site's own settings files, and a data file that is a link to the scripts file.
  "astro-claims": {
    config: {
      name: "Claims",
      framework: "astro",
      ai: { allowBuild: true },
      collections: [
        { id: "pages", path: "src/content/pages", format: "markdown", pattern: "**/*.md" },
        { id: "pkg", kind: "data", path: "package.json", format: "json" },
        { id: "host", kind: "data", path: "vercel.json", format: "json" },
        { id: "astroConfig", kind: "data", path: "astro.config.mjs", format: "json" },
        { id: "site", kind: "data", path: "src/data/site.json", format: "json" },
        { id: "scripts", kind: "data", path: "src/data/scripts.json", format: "json" },
      ],
    },
    files: {
      "src/content/pages/about.md": md("About"),
      "package.json": '{ "name": "claims", "type": "module" }\n',
      "vercel.json": "{}\n",
      "astro.config.mjs": "export default {};\n",
      "src/data/scripts.json": `${JSON.stringify({ consent: { mode: "none" }, scripts: [{ id: "chat", kind: "custom", label: "Chat", enabled: false, settings: { inline: "console.log(1)" } }] }, null, 2)}\n`,
    },
    links: [["scripts.json", "src/data/site.json"]],
  },
  // Build mode off in the site's settings, and the redirects list pointed at a build tool's settings file.
  "astro-build-off": {
    config: {
      name: "Off",
      framework: "astro",
      ai: { allowBuild: false },
      redirects: { host: "netlify", file: "package.json" },
      collections: [
        { id: "pages", path: "src/content/pages", format: "markdown", pattern: "**/*.md" },
        { id: "scripts", kind: "data", path: "src/data/scripts.json", format: "json" },
      ],
    },
    files: {
      "src/content/pages/about.md": md("About"),
      "package.json": '{ "name": "off", "type": "module" }\n',
      "src/data/scripts.json": `${JSON.stringify({ consent: { mode: "none" }, scripts: [{ id: "chat", kind: "custom", label: "Chat", enabled: false, settings: { inline: "console.log(1)" } }, { id: "ga", kind: "ga4", label: "Analytics", enabled: true, settings: { measurementId: "G-ABC123" } }] }, null, 2)}\n`,
    },
  },
  // The redirects code writes vercel.json, a host's settings file, for the Vercel host.
  "astro-vercel": {
    config: {
      name: "V",
      framework: "astro",
      ai: { allowBuild: true },
      redirects: { host: "vercel" },
      collections: [
        { id: "pages", path: "src/content/pages", format: "markdown", pattern: "**/*.md" },
        { id: "site", kind: "data", path: "src/data/site.json", format: "json" },
      ],
    },
    files: { "src/content/pages/about.md": md("About"), "src/data/site.json": "{}\n", "vercel.json": "{}\n" },
  },
  // Settings pointing a data collection and the redirects list into a framework's template folders.
  "hugo-claims": {
    config: {
      name: "H",
      framework: "hugo",
      ai: { allowBuild: true },
      redirects: { file: "layouts/partials/r.json" },
      collections: [
        { id: "posts", path: "content/posts", format: "markdown", pattern: "**/*.md" },
        { id: "home", kind: "data", path: "layouts/index.json", format: "json" },
        { id: "menu", kind: "data", path: "data/menu.json", format: "json" },
      ],
    },
    files: { "content/posts/a.md": md("A"), "layouts/index.json": "{}\n", "data/menu.json": "{}\n" },
  },
  "jekyll-claims": {
    config: {
      name: "J",
      framework: "jekyll",
      ai: { allowBuild: true },
      redirects: { file: "_includes/r.json" },
      collections: [
        { id: "posts", path: "_posts", format: "markdown", pattern: "**/*.md" },
        { id: "frame", kind: "data", path: "_layouts/d.json", format: "json" },
      ],
    },
    files: { "_posts/2024-01-01-hello.md": md("Hello"), "_layouts/d.json": "{}\n" },
  },
  "eleventy-root": {
    config: { name: "E", framework: "eleventy", ai: { allowBuild: true }, collections: [{ id: "root", path: ".", format: "markdown", pattern: "**/*.md" }] },
    files: { "index.md": md("Home"), "_includes/base.njk": "{{ content }}\n" },
  },
  "eleventy-src": {
    config: { name: "E", framework: "eleventy", ai: { allowBuild: true }, collections: [{ id: "pages", path: "src", format: "markdown", pattern: "**/*.md" }] },
    files: { "src/index.md": md("Home"), "src/_includes/base.njk": "{{ content }}\n" },
  },
  "eleventy-src-plain": {
    config: { name: "E", framework: "eleventy", ai: { allowBuild: true }, collections: [{ id: "pages", path: "src", format: "markdown", pattern: "**/*.md", plain: true }] },
    files: { "src/index.md": md("Home"), "src/_includes/base.njk": "{{ content }}\n" },
  },
  jekyll: {
    config: { name: "J", framework: "jekyll", ai: { allowBuild: true }, collections: [{ id: "posts", path: "_posts", format: "markdown", pattern: "**/*.md" }] },
    files: { "_posts/2024-01-01-hello.md": md("Hello"), "_includes/head.html": "<meta>\n", "assets/images/a.png": "png", "_data/nav.yml": "items: []\n" },
  },
  // The same, with the settings making the repository's root a media root: an upload could then go anywhere.
  "jekyll-root-media": {
    config: { name: "J", framework: "jekyll", ai: { allowBuild: true }, media: { dir: ".", publicPath: "/", roots: [{ dir: ".", publicPath: "/" }] }, collections: [{ id: "posts", path: "_posts", format: "markdown", pattern: "**/*.md" }] },
    files: { "_posts/2024-01-01-hello.md": md("Hello"), "_includes/head.html": "<meta>\n" },
  },
  "generic-root": {
    config: { name: "G", ai: { allowBuild: true }, collections: [{ id: "root", path: ".", format: "markdown", pattern: "**/*.md" }] },
    files: { "index.md": md("Home"), "package.json": '{ "name": "g" }\n', "public/.keep": "" },
  },
  // Instruction files that are links to ordinary pages, and a brand folder that is a link.
  "generic-links": {
    config: { name: "G", ai: { allowBuild: true }, collections: [{ id: "root", path: ".", format: "markdown", pattern: "**/*.md" }] },
    files: { "index.md": md("Home"), "docs/house-style.md": md("House style"), "docs/agent-guide.md": md("Agent guide"), "docs/brand/guide.md": md("Brand"), "docs/other.md": md("Other") },
    links: [
      ["docs/house-style.md", "STYLE.md"],
      ["agent-guide.md", "docs/AGENTS.md"],
      ["../docs/brand", "galley/brand"],
    ],
  },
  // Instruction paths written with a '.' segment.
  "generic-dots": {
    config: { name: "G", ai: { allowBuild: true, instructions: ["docs/./voice.md"] }, siteBrand: { dir: "galley/./brand" }, collections: [{ id: "root", path: ".", format: "markdown", pattern: "**/*.md" }] },
    files: { "index.md": md("Home"), "docs/voice.md": md("Voice"), "galley/brand/guide.md": md("Brand") },
  },
  // Generic sites a tool builds: VitePress (scripts named docs:*), MkDocs (no package.json at all).
  "generic-vitepress": {
    config: { name: "G", ai: { allowBuild: true }, collections: [{ id: "docs", path: "docs", format: "markdown", pattern: "**/*.md" }] },
    files: { "docs/index.md": md("Home"), "package.json": '{ "name": "v", "scripts": { "docs:dev": "vitepress dev docs", "docs:build": "vitepress build docs" } }\n', "docs/.vitepress/config.mts": "export default {};\n" },
  },
  "generic-mkdocs": {
    config: { name: "G", ai: { allowBuild: true }, collections: [{ id: "docs", path: "docs", format: "markdown", pattern: "**/*.md" }] },
    files: { "docs/index.md": md("Home"), "mkdocs.yml": "site_name: M\n" },
  },
};

function makeSite(kind: SiteKind): string {
  const root = tempDir(`content-code-${kind}-`);
  const site = SITES[kind];

  writeTree(root, { "galley.config.json": `${JSON.stringify(site.config, null, 2)}\n`, ...site.files });
  for (const [target, at] of site.links ?? []) {
    mkdirSync(join(root, at, ".."), { recursive: true });
    symlinkSync(target, join(root, at));
  }
  sh(root, "init", "-q", "-b", "main");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "First version");
  return root;
}

// ── who, and what they do

type Who = "contributor" | "editor" | "owner" | "nobody" | "page-owner" | "page-contributor" | "assistant-owner" | "assistant-local";

type Change =
  | { write: string; text: string; mode?: "content" | "build" }
  | { update: string; ops: EditOp[] }
  | { create: string; slug: string; template?: string; body?: string }
  | { deleteFile: string }
  | { deleteEntry: string }
  | { upload: string; directory: string; text?: string }
  | { generatedRedirects: string; text: string };

const agentOf = (who: Who) => who === "assistant-owner" || who === "assistant-local";

async function asWho<T>(who: Who, run: () => Promise<T>): Promise<T> {
  if (who === "nobody" || who === "assistant-local") return run();
  if (who === "assistant-owner") {
    // A hosted install: the assistant works for an owner in a content conversation.
    requireCallerForGuardedWork(true);
    return withCaller({ accountId: "o", role: "owner" }, run);
  }
  if (who === "page-owner") return withCaller({ accountId: "o", role: "owner", viaPreview: true }, run);
  if (who === "page-contributor") return withCaller({ accountId: "c", role: "contributor", viaPreview: true }, run);
  return withCaller({ accountId: who, role: who }, run);
}

/** What the change came to: "ok" when it landed, else the refusal's words. */
async function outcome(kind: SiteKind, who: Who, change: Change): Promise<string> {
  const { site } = await openSite(makeSite(kind));
  const origin = agentOf(who) ? ("agent" as const) : ("user" as const);
  const run = async (): Promise<string> => {
    if ("write" in change) {
      await site.writeFile(change.write, change.text, { origin, mode: change.mode ?? "content" });
    } else if ("update" in change) {
      const result = await site.updateEntry(change.update, change.ops, { origin, ...(agentOf(who) ? { mode: "content" as const } : {}) });

      if (result.applied === 0) return result.refused[0]?.reason ?? "nothing applied";
    } else if ("create" in change) {
      await site.createEntry(
        { collection: change.create, slug: change.slug, ...(change.template ? { template: change.template, data: {} } : { data: { title: "New" }, body: change.body ?? "Words." }) },
        { origin, ...(agentOf(who) ? { mode: "content" as const } : {}) }
      );
    } else if ("deleteFile" in change) {
      await site.deleteFile(change.deleteFile, { origin, mode: "content" });
    } else if ("deleteEntry" in change) {
      await site.deleteEntry(change.deleteEntry, { origin, ...(agentOf(who) ? { mode: "content" as const } : {}) });
    } else if ("upload" in change) {
      await site.saveMedia({ filename: change.upload, directory: change.directory, data: new TextEncoder().encode(change.text ?? "<svg xmlns=\"http://www.w3.org/2000/svg\"/>") }, { origin });
    } else {
      const { generatedRedirects: path, text } = change;

      await asGeneratedRedirects(path, () => site.writeFile(path, text, { origin, mode: "content" }));
    }
    return "ok";
  };

  try {
    return await asWho(who, run);
  } catch (error) {
    if (error instanceof GalleyError && (error.code === "forbidden" || error.code === "invalid")) return error.message;
    throw error;
  }
}

// ── the words each refusal is known by

const LEVEL = /not its code and templates \(build mode\)/;
const PAGE = /asked for by the page in the preview/;
const ASSISTANT = /Outside build mode, the assistant may change only/;
const LAYOUT_WORDS = /layout names code the site runs.*template/;
const FRONT = /settings at the top/;
const IMAGE = /An image on this page/;
const SCRIPT = /script on the site's pages/;
const BUILD_OFF = /settings keep build mode off/;
const GLOBS = /Only content and media/;
const INSTRUCTIONS = /read a file with this name as their instructions/;
const RENDERED = /starts with --- like a page's settings/;

interface Row {
  name: string;
  site: SiteKind;
  who: Who;
  change: Change;
  expect: "ok" | RegExp;
}

const TABLE: Row[] = [
  // Astro: Markdown inert, MDX and source guarded, decided per file.
  { name: "astro .md entry", site: "astro", who: "contributor", change: { write: "src/content/pages/new.md", text: md("New") }, expect: "ok" },
  { name: "astro .mdx entry", site: "astro", who: "contributor", change: { write: "src/content/docs/new.mdx", text: md("New") }, expect: LEVEL },
  { name: "astro .mdoc in a collection that admits it", site: "astro", who: "contributor", change: { write: "src/content/kb/b.mdoc", text: md("B") }, expect: LEVEL },
  { name: "astro a layout file (site source)", site: "astro", who: "contributor", change: { write: "src/layouts/Base.astro", text: "x" }, expect: LEVEL },
  { name: "astro package.json", site: "astro", who: "contributor", change: { write: "package.json", text: "{}" }, expect: LEVEL },
  { name: "astro YAML data (runs as a module)", site: "astro", who: "contributor", change: { write: "src/data/nav.yaml", text: "items: []\n" }, expect: LEVEL },
  { name: "astro JSON data", site: "astro", who: "contributor", change: { write: "src/data/site.json", text: '{ "a": 1 }\n' }, expect: "ok" },
  { name: "astro the 'constructor' extension under a media root", site: "astro", who: "contributor", change: { write: "public/images/x.constructor", text: "console.log(1)" }, expect: LEVEL },
  { name: "astro the '__proto__' extension beside an entry", site: "astro", who: "contributor", change: { write: "src/content/pages/x.__proto__", text: "console.log(1)" }, expect: LEVEL },
  { name: "astro a picture under the media root", site: "astro", who: "contributor", change: { write: "public/images/b.png", text: "png" }, expect: "ok" },
  { name: "astro a picture beside an entry", site: "astro", who: "contributor", change: { write: "src/content/pages/photo.png", text: "png" }, expect: "ok" },
  { name: "astro a picture uploaded to the media library", site: "astro", who: "contributor", change: { upload: "logo.svg", directory: "public/images" }, expect: "ok" },
  { name: "astro a page through a folder link to the layouts", site: "astro", who: "contributor", change: { write: "src/content/pages/linked/x.md", text: md("X") }, expect: LEVEL },
  // Astro Markdown: layout, the front matter's shape, image targets.
  { name: "astro adding a layout", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: md("About", "About us.", LAYOUT) }, expect: LAYOUT_WORDS },
  { name: "astro keeping a layout while editing prose", site: "astro", who: "contributor", change: { write: "src/content/pages/framed.md", text: md("Framed", "Reworded.", LAYOUT) }, expect: "ok" },
  { name: "astro a layout behind '--- # note'", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: `--- # note\ntitle: About\n${LAYOUT}---\n\nAbout.\n` }, expect: FRONT },
  { name: "astro a layout behind a leading blank line", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: `\n---\ntitle: About\n${LAYOUT}---\n\nAbout.\n` }, expect: FRONT },
  { name: "astro a layout through a merge key", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: "---\ntitle: About\nbase: &b\n  layout: ../../layouts/Base.astro\n<<: *b\n---\n\nAbout.\n" }, expect: FRONT },
  { name: "astro an image path to a module", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: md("About", "![x](./evil.mjs)") }, expect: IMAGE },
  { name: "astro an image path with a query", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: md("About", "![x](./a.svg?raw)") }, expect: IMAGE },
  { name: "astro an image by reference to a module", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: md("About", "![x][m]\n\n[m]: ./evil.mjs") }, expect: IMAGE },
  { name: "astro a front-matter image path to a module", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: md("About", "Words.", "cover: ./evil.mjs\n") }, expect: IMAGE },
  { name: "astro a picture image", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: md("About", "![x](./photo.png)") }, expect: "ok" },
  { name: "astro an image path hidden behind an entity", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: md("About", "![x](../../layouts/Base.astro&quest;.png)") }, expect: IMAGE },
  { name: "astro an image after an escaped backslash", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: md("About", "Text \\\\![a](../../layouts/Base.astro)") }, expect: IMAGE },
  { name: "astro an image whose alt holds a code span", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: md("About", "![a `]` b](../lib/evil.mjs)") }, expect: IMAGE },
  { name: "astro an image whose alt holds HTML", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: md("About", '![a <span title="]">x</span>](../lib/evil.mjs)') }, expect: IMAGE },
  { name: "astro an image destination after a line ending", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: "---\r\ntitle: About\r\n---\r\n![a](\r\n../lib/evil.mjs)\r\n" }, expect: IMAGE },
  { name: "astro an image destination with a no-break space in it", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: md("About", "![a](./ok.png\u00a0/../../lib/evil.mjs)") }, expect: IMAGE },
  { name: "astro an image by reference defined in a quote", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: md("About", "![x]\n\n> [x]: ./evil.js") }, expect: IMAGE },
  { name: "astro a front-matter picture from outside the site", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: md("About", "Words.", "cover: /tmp/elsewhere/secret.png\n") }, expect: IMAGE },
  { name: "astro a relative link added beside an image", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: md("About", "![x](./photo.png) and [more](../more/)") }, expect: "ok" },
  { name: "astro a link whose text could hide an image's start, beside an image (judged like an image)", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: md("About", "![x](./photo.png) and **[`more`](../more/)**") }, expect: IMAGE },
  { name: "astro a link to a module turned into an image (a second save)", site: "astro", who: "contributor", change: { write: "src/content/pages/module-link.md", text: md("Module link", "![a](../../lib/marker.mjs?x.png)") }, expect: IMAGE },
  { name: "astro a link with code in its text turned into an image", site: "astro", who: "contributor", change: { write: "src/content/pages/code-link.md", text: md("Code link", "![p](./photo.png) **![`x`](../../lib/marker.mjs)**") }, expect: IMAGE },
  { name: "astro a reference link turned into an image", site: "astro", who: "contributor", change: { write: "src/content/pages/ref-link.md", text: md("Ref link", "![p](./photo.png)\n\nSee ![a][m].\n\n[m]: ../../lib/marker.mjs") }, expect: IMAGE },
  { name: "astro editing the settings of a page that has a link to a module", site: "astro", who: "contributor", change: { update: "src/content/pages/ref-link.md", ops: [{ op: "set", path: ["title"], value: "Changed" }] }, expect: "ok" },
  { name: "astro editing a paragraph next to a module link on a page with an image", site: "astro", who: "contributor", change: { write: "src/content/pages/ref-link.md", text: md("Ref link", "![p](./photo.png)\n\nSee [a][m], reworded.\n\n[m]: ../../lib/marker.mjs") }, expect: "ok" },
  { name: "astro a page of unclosed images (read in one pass)", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: md("About", "![a](".repeat(20000)) }, expect: IMAGE },
  { name: "astro a relative link on a page with no images", site: "astro", who: "contributor", change: { write: "src/content/pages/linked-page.md", text: md("Linked", "See [the about page](../about/) and [more](../more/).") }, expect: "ok" },
  { name: "astro an image added to a page that already has relative links", site: "astro", who: "contributor", change: { write: "src/content/pages/linked-page.md", text: md("Linked", "See [the about page](../about/).\n\n![x](./photo.png)") }, expect: "ok" },
  { name: "astro editing a page saved with a byte-order mark", site: "astro", who: "contributor", change: { update: "src/content/pages/bom.md", ops: [{ op: "set", path: ["title"], value: "Changed" }] }, expect: "ok" },
  { name: "astro a picture from the site's media folder (the media picker's path)", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: md("About", "Words.", "cover: /images/a.png\n") }, expect: "ok" },
  { name: "astro a picture at the top of the public folder", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: md("About", "Words.", "cover: /og-default.png\n") }, expect: "ok" },
  { name: "astro a picture from the site's root that isn't there", site: "astro", who: "contributor", change: { write: "src/content/pages/about.md", text: md("About", "Words.", "cover: /images/missing.png\n") }, expect: IMAGE },
  { name: "astro a page named like an assistant's instructions (agents.md)", site: "astro", who: "contributor", change: { update: "src/content/pages/agents.md", ops: [{ op: "set", path: ["title"], value: "Our team" }] }, expect: INSTRUCTIONS },
  { name: "astro an entry from a template that sets a layout", site: "astro", who: "contributor", change: { create: "pages", slug: "from-template", template: "with-layout" }, expect: LAYOUT_WORDS },
  { name: "astro an entry edit through the form", site: "astro", who: "contributor", change: { update: "src/content/pages/about.md", ops: [{ op: "set", path: ["title"], value: "Changed" }] }, expect: "ok" },
  { name: "astro an MDX entry edit through the form", site: "astro", who: "contributor", change: { update: "src/content/docs/intro.mdx", ops: [{ op: "set", path: ["title"], value: "Changed" }] }, expect: LEVEL },
  { name: "astro a new Markdown entry", site: "astro", who: "contributor", change: { create: "pages", slug: "fresh" }, expect: "ok" },
  { name: "astro a new MDX entry", site: "astro", who: "contributor", change: { create: "docs", slug: "fresh" }, expect: LEVEL },
  // Deletes: only what the writer could write.
  { name: "astro deleting an MDX entry", site: "astro", who: "contributor", change: { deleteEntry: "src/content/docs/intro.mdx" }, expect: LEVEL },
  { name: "astro deleting a Markdown entry", site: "astro", who: "contributor", change: { deleteEntry: "src/content/pages/about.md" }, expect: "ok" },
  { name: "astro deleting a picture", site: "astro", who: "contributor", change: { deleteFile: "public/images/a.png" }, expect: "ok" },
  { name: "astro deleting the layout", site: "astro", who: "contributor", change: { deleteFile: "src/layouts/Base.astro" }, expect: LEVEL },
  // The redirects list, and the host's file only as the redirects code writes it.
  { name: "astro the redirects list", site: "astro", who: "contributor", change: { write: "src/data/redirects.json", text: '{ "redirects": [] }\n' }, expect: "ok" },
  { name: "astro the host's redirects file by hand", site: "astro", who: "contributor", change: { write: "public/_redirects", text: "/a /b 200\n" }, expect: LEVEL },
  { name: "astro the host's redirects file as the redirects code writes it", site: "astro", who: "contributor", change: { generatedRedirects: "public/_redirects", text: "/a /b 301\n" }, expect: "ok" },
  { name: "astro (Vercel) vercel.json as the redirects code writes it", site: "astro-vercel", who: "contributor", change: { generatedRedirects: "vercel.json", text: '{ "redirects": [] }\n' }, expect: "ok" },
  { name: "astro (Vercel) vercel.json by hand", site: "astro-vercel", who: "contributor", change: { write: "vercel.json", text: '{ "buildCommand": "x" }\n' }, expect: LEVEL },
  { name: "hugo a data collection in the layouts folder", site: "hugo-claims", who: "contributor", change: { write: "layouts/index.json", text: "{}" }, expect: LEVEL },
  { name: "hugo the redirects list pointed into the layouts folder", site: "hugo-claims", who: "contributor", change: { write: "layouts/partials/r.json", text: '{ "redirects": [] }' }, expect: LEVEL },
  { name: "hugo a data file in the data folder", site: "hugo-claims", who: "contributor", change: { write: "data/menu.json", text: '{ "items": [] }' }, expect: "ok" },
  { name: "jekyll the redirects list pointed into _includes", site: "jekyll-claims", who: "contributor", change: { write: "_includes/r.json", text: '{ "redirects": [] }' }, expect: LEVEL },
  { name: "jekyll a data collection in _layouts", site: "jekyll-claims", who: "contributor", change: { write: "_layouts/d.json", text: "{}" }, expect: LEVEL },
  // The scripts kit: turning a script on or changing one is build mode; its label is content.
  { name: "astro turning a script on through a data file that is a link to the scripts file", site: "astro-claims", who: "contributor", change: { write: "src/data/site.json", text: JSON.stringify({ consent: { mode: "none" }, scripts: [{ id: "chat", kind: "custom", label: "Chat", enabled: true, settings: { inline: "console.log(1)" } }] }) }, expect: SCRIPT },
  { name: "astro package.json claimed by a data collection", site: "astro-claims", who: "contributor", change: { write: "package.json", text: '{ "scripts": { "build": "astro build" } }' }, expect: LEVEL },
  { name: "astro vercel.json claimed by a data collection", site: "astro-claims", who: "contributor", change: { write: "vercel.json", text: '{ "buildCommand": "x" }' }, expect: LEVEL },
  { name: "astro astro.config.mjs claimed by a data collection", site: "astro-claims", who: "contributor", change: { write: "astro.config.mjs", text: "export default {};" }, expect: LEVEL },
  { name: "astro turning a script on, written as a file", site: "astro", who: "contributor", change: { write: "src/data/scripts.json", text: JSON.stringify({ consent: { mode: "none" }, scripts: [{ id: "chat", kind: "custom", label: "Chat", enabled: true, settings: { inline: "console.log(1)" } }] }) }, expect: SCRIPT },
  { name: "astro turning a script on through the Scripts screen (an entry edit)", site: "astro", who: "contributor", change: { update: "src/data/scripts.json", ops: [{ op: "set", path: ["scripts", 0, "enabled"], value: true }] }, expect: SCRIPT },
  { name: "astro (build mode off) an owner turning a script on through the Scripts screen", site: "astro-build-off", who: "owner", change: { update: "src/data/scripts.json", ops: [{ op: "set", path: ["scripts", 0, "enabled"], value: true }] }, expect: BUILD_OFF },
  { name: "astro (build mode off) an owner changing a script that is on", site: "astro-build-off", who: "owner", change: { update: "src/data/scripts.json", ops: [{ op: "set", path: ["scripts", 1, "settings", "measurementId"], value: "G-XYZ789" }] }, expect: BUILD_OFF },
  { name: "astro (build mode off) an owner turning a script off", site: "astro-build-off", who: "owner", change: { update: "src/data/scripts.json", ops: [{ op: "set", path: ["scripts", 1, "enabled"], value: false }] }, expect: "ok" },
  { name: "astro (build mode off) a contributor turning a script on", site: "astro-build-off", who: "contributor", change: { update: "src/data/scripts.json", ops: [{ op: "set", path: ["scripts", 0, "enabled"], value: true }] }, expect: BUILD_OFF },
  { name: "astro (build mode off) nobody (local) turning a script on", site: "astro-build-off", who: "nobody", change: { update: "src/data/scripts.json", ops: [{ op: "set", path: ["scripts", 0, "enabled"], value: true }] }, expect: BUILD_OFF },
  { name: "astro (redirects list pointed at package.json) the list file", site: "astro-build-off", who: "contributor", change: { write: "package.json", text: '{ "redirects": [] }' }, expect: LEVEL },
  { name: "astro turning a script on through the Scripts screen, as an owner", site: "astro", who: "owner", change: { update: "src/data/scripts.json", ops: [{ op: "set", path: ["scripts", 0, "enabled"], value: true }] }, expect: "ok" },
  { name: "astro a page-marked owner save turns a script on", site: "astro", who: "page-owner", change: { update: "src/data/scripts.json", ops: [{ op: "set", path: ["scripts", 0, "enabled"], value: true }] }, expect: PAGE },
  { name: "astro turning a script on, as an owner writing it as a file in content mode", site: "astro", who: "owner", change: { write: "src/data/scripts.json", text: JSON.stringify({ consent: { mode: "none" }, scripts: [{ id: "chat", kind: "custom", label: "Chat", enabled: true, settings: { inline: "console.log(1)" } }] }) }, expect: SCRIPT },
  { name: "astro relabelling a script that is off", site: "astro", who: "contributor", change: { write: "src/data/scripts.json", text: JSON.stringify({ consent: { mode: "none" }, scripts: [{ id: "chat", kind: "custom", label: "Live chat", enabled: false, settings: { inline: "console.log(1)" } }] }) }, expect: "ok" },
  // Who: the level, the page's mark, the assistant.
  { name: "astro an owner writes MDX code", site: "astro", who: "owner", change: { write: "src/content/docs/new.mdx", text: md("New", "{code()}") }, expect: "ok" },
  { name: "astro an editor writes MDX code", site: "astro", who: "editor", change: { write: "src/content/docs/new.mdx", text: md("New", "{code()}") }, expect: "ok" },
  { name: "astro nobody (local) writes MDX code", site: "astro", who: "nobody", change: { write: "src/content/docs/new.mdx", text: md("New", "{code()}") }, expect: "ok" },
  { name: "astro a page-marked owner save adds a layout", site: "astro", who: "page-owner", change: { write: "src/content/pages/about.md", text: md("About", "About us.", LAYOUT) }, expect: PAGE },
  { name: "astro a page-marked owner save writes MDX", site: "astro", who: "page-owner", change: { write: "src/content/docs/new.mdx", text: md("New") }, expect: PAGE },
  { name: "astro a page-marked owner save edits Markdown", site: "astro", who: "page-owner", change: { write: "src/content/pages/about.md", text: md("About", "Reworded.") }, expect: "ok" },
  { name: "astro the assistant in an owner's content conversation writes MDX code", site: "astro", who: "assistant-owner", change: { write: "src/content/docs/new.mdx", text: md("New", "{code()}") }, expect: ASSISTANT },
  { name: "astro the assistant in an owner's content conversation adds a layout", site: "astro", who: "assistant-owner", change: { update: "src/content/pages/about.md", ops: [{ op: "set", path: ["layout"], value: "../../layouts/Base.astro" }] }, expect: ASSISTANT },
  { name: "astro the assistant in an owner's content conversation deletes an MDX entry", site: "astro", who: "assistant-owner", change: { deleteEntry: "src/content/docs/intro.mdx" }, expect: ASSISTANT },
  { name: "astro the assistant in an owner's content conversation edits Markdown", site: "astro", who: "assistant-owner", change: { write: "src/content/pages/about.md", text: md("About", "Reworded.") }, expect: "ok" },
  { name: "astro the assistant locally writes MDX code", site: "astro", who: "assistant-local", change: { write: "src/content/docs/new.mdx", text: md("New", "{code()}") }, expect: "ok" },
  // Eleventy: content guarded whole; media only under a media root, never beside an entry.
  { name: "eleventy (root collection) a page", site: "eleventy-root", who: "contributor", change: { write: "index.md", text: md("Home", "Reworded.") }, expect: LEVEL },
  { name: "eleventy (root collection) an SVG in _includes", site: "eleventy-root", who: "contributor", change: { write: "_includes/x.svg", text: "<svg/>" }, expect: LEVEL },
  { name: "eleventy (src collection) an SVG in src/_includes", site: "eleventy-src", who: "contributor", change: { write: "src/_includes/x.svg", text: "<svg/>" }, expect: LEVEL },
  { name: "eleventy (src collection) a page", site: "eleventy-src", who: "contributor", change: { write: "src/index.md", text: md("Home", "Reworded.") }, expect: LEVEL },
  { name: "eleventy (src collection, declared plain) a page", site: "eleventy-src-plain", who: "contributor", change: { write: "src/index.md", text: md("Home", "Reworded.") }, expect: "ok" },
  { name: "eleventy (src collection, declared plain) an SVG in src/_includes", site: "eleventy-src-plain", who: "contributor", change: { write: "src/_includes/x.svg", text: "<svg/>" }, expect: LEVEL },
  { name: "eleventy an owner edits a page", site: "eleventy-src", who: "owner", change: { write: "src/index.md", text: md("Home", "Reworded.") }, expect: "ok" },
  // Jekyll: the same.
  { name: "jekyll a post", site: "jekyll", who: "contributor", change: { write: "_posts/2024-01-01-hello.md", text: md("Hello", "Reworded.") }, expect: LEVEL },
  { name: "jekyll an SVG in _includes", site: "jekyll", who: "contributor", change: { write: "_includes/x.svg", text: "<svg/>" }, expect: LEVEL },
  { name: "jekyll (the root a media root) an SVG uploaded to _includes", site: "jekyll-root-media", who: "contributor", change: { upload: "x.svg", directory: "_includes" }, expect: LEVEL },
  { name: "jekyll (the root a media root) an SVG uploaded to _includes, by an owner", site: "jekyll-root-media", who: "owner", change: { upload: "x.svg", directory: "_includes" }, expect: "ok" },
  { name: "jekyll an SVG in _includes, as an owner in content mode (the ordinary content globs decide)", site: "jekyll", who: "owner", change: { write: "_includes/x.svg", text: "<svg/>" }, expect: GLOBS },
  { name: "jekyll a picture under the media root", site: "jekyll", who: "contributor", change: { write: "assets/images/b.svg", text: "<svg/>" }, expect: "ok" },
  { name: "jekyll a picture that starts with front matter", site: "jekyll", who: "contributor", change: { write: "assets/images/b.svg", text: "---\npermalink: /index.html\n---\n<svg/>" }, expect: RENDERED },
  { name: "jekyll an upload that starts with front matter", site: "jekyll", who: "contributor", change: { upload: "b.svg", directory: "assets/images", text: "---\npermalink: /index.html\n---\n<svg/>" }, expect: RENDERED },
  { name: "jekyll the redirects list starting with front matter", site: "jekyll", who: "contributor", change: { write: "src/data/redirects.json", text: "---\npermalink: /\n---\n{}" }, expect: RENDERED },
  { name: "jekyll a picture that starts with front matter, by an owner", site: "jekyll", who: "owner", change: { write: "assets/images/b.svg", text: "---\ntitle: x\n---\n<svg/>" }, expect: "ok" },
  // A plain Markdown site with a collection at the root: its Markdown is inert, the files around it aren't.
  { name: "generic (root) a page", site: "generic-root", who: "contributor", change: { write: "index.md", text: md("Home", "Reworded.") }, expect: "ok" },
  { name: "generic (root) STYLE.md, which the assistant reads as instructions", site: "generic-root", who: "contributor", change: { write: "STYLE.md", text: md("Style") }, expect: INSTRUCTIONS },
  { name: "generic (root) style.md in another case", site: "generic-root", who: "contributor", change: { write: "style.md", text: md("Style") }, expect: INSTRUCTIONS },
  { name: "generic (root) AGENTS.md", site: "generic-root", who: "contributor", change: { write: "docs/AGENTS.md", text: md("Agents") }, expect: INSTRUCTIONS },
  { name: "generic (root) AGENTS.override.md", site: "generic-root", who: "contributor", change: { write: "AGENTS.override.md", text: md("Agents") }, expect: INSTRUCTIONS },
  { name: "generic (root) CLAUDE.local.md", site: "generic-root", who: "contributor", change: { write: "CLAUDE.local.md", text: md("Claude") }, expect: INSTRUCTIONS },
  { name: "generic (root) AGENT.md", site: "generic-root", who: "contributor", change: { write: "AGENT.md", text: md("Agent") }, expect: INSTRUCTIONS },
  { name: "generic (root) a file in a dot folder (.github)", site: "generic-root", who: "contributor", change: { write: ".github/copilot-instructions.md", text: md("Copilot") }, expect: LEVEL },
  { name: "generic (root) the brand guide", site: "generic-root", who: "contributor", change: { write: "galley/brand/guide.md", text: md("Guide") }, expect: INSTRUCTIONS },
  { name: "generic (links) the page STYLE.md is a link to", site: "generic-links", who: "contributor", change: { write: "docs/house-style.md", text: md("House style", "Reworded.") }, expect: INSTRUCTIONS },
  { name: "generic (links) the page an AGENTS.md link leads to", site: "generic-links", who: "contributor", change: { write: "docs/agent-guide.md", text: md("Agent guide", "Reworded.") }, expect: INSTRUCTIONS },
  { name: "generic (links) the folder the brand folder is a link to", site: "generic-links", who: "contributor", change: { write: "docs/brand/guide.md", text: md("Brand", "Reworded.") }, expect: INSTRUCTIONS },
  { name: "generic (links) an ordinary page beside them", site: "generic-links", who: "contributor", change: { write: "docs/other.md", text: md("Other", "Reworded.") }, expect: "ok" },
  { name: "generic (dots) ai.instructions written with a '.' segment", site: "generic-dots", who: "contributor", change: { write: "docs/voice.md", text: md("Voice", "Reworded.") }, expect: INSTRUCTIONS },
  { name: "generic (dots) the brand folder written with a '.' segment", site: "generic-dots", who: "contributor", change: { write: "galley/brand/guide.md", text: md("Brand", "Reworded.") }, expect: INSTRUCTIONS },
  { name: "generic (VitePress) a page", site: "generic-vitepress", who: "contributor", change: { write: "docs/index.md", text: md("Home", "Reworded.") }, expect: LEVEL },
  { name: "generic (MkDocs) a page", site: "generic-mkdocs", who: "contributor", change: { write: "docs/index.md", text: md("Home", "Reworded.") }, expect: LEVEL },
  { name: "generic (MkDocs) a page, by an owner", site: "generic-mkdocs", who: "owner", change: { write: "docs/index.md", text: md("Home", "Reworded.") }, expect: "ok" },
  { name: "generic (root) package.json", site: "generic-root", who: "contributor", change: { write: "package.json", text: "{}" }, expect: LEVEL },
  { name: "generic (root) a picture at the root (no media beside a root collection)", site: "generic-root", who: "contributor", change: { write: "logo.svg", text: "<svg/>" }, expect: LEVEL },
  { name: "generic (root) a picture in the public folder", site: "generic-root", who: "contributor", change: { write: "public/logo.svg", text: "<svg/>" }, expect: "ok" },
  { name: "generic (root) deleting package.json", site: "generic-root", who: "contributor", change: { deleteFile: "package.json" }, expect: LEVEL },
];

describe("the content guard, through the write surface", { timeout: 300_000 }, () => {
  for (const row of TABLE) {
    it(`${row.expect === "ok" ? "lets" : "refuses"} ${row.who}: ${row.name}`, async () => {
      const result = await outcome(row.site, row.who, row.change);

      if (row.expect === "ok") expect(result, row.name).toBe("ok");
      else expect(result, row.name).toMatch(row.expect);
    });
  }
});

describe("reading a large Markdown page", () => {
  it("reads a page of 200 KB of unclosed images in one pass", async () => {
    const { astroMarkdownRefusal } = await import("../../src/site/content-code");
    const body = "![a](".repeat(40_000);
    const started = performance.now();
    const refusal = await withCaller({ accountId: "c", role: "contributor" }, async () =>
      astroMarkdownRefusal("src/content/pages/a.md", md("A"), md("A", body), null, { origin: "user" }, { media: { dir: "public", publicPath: "/", roots: [{ dir: "public", publicPath: "/" }] } as never })
    );

    expect(refusal).toMatch(IMAGE);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("the page's refusal says what the person can do", { timeout: 120_000 }, () => {
  it("someone at build level is told to make the change in the form; an account below it, who can help", async () => {
    const change = { write: "src/content/docs/new.mdx", text: md("New") };

    expect(await outcome("astro", "page-owner", change)).toBe(PAGE_SAVE_REFUSAL_AT_BUILD_LEVEL);
    expect(await outcome("astro", "page-contributor", change)).toBe(PAGE_SAVE_REFUSAL);
  });
});
