/**
 * The write surface's guard for a write held below build-mode level (Principle
 * 6, as for a form's custom code in `site-kit/guard.ts`).
 *
 * The preview and the build run the site's own code for everyone, and some
 * content is part of that code. MDX runs its `import`/`export` lines, its
 * `{ … }` expressions and its `<Jsx/>` elements; other frameworks run a
 * template language in their content; and Astro, for a Markdown page, imports
 * whatever its `layout` and its image paths name — so writing such content, or
 * a file the build runs or imports, is a build-mode change.
 *
 * It is an **allowlist**, not a denylist. The content globs are not a safe base
 * to subtract from: a collection whose folder is the repo root takes the glob
 * `**`, so a denylist leaves the site's own config and package files writable.
 * A held write may touch an inert entry, a data file, media where media
 * belongs, and the redirects list — and nothing else, whatever
 * `writable.content` says. A delete held the same way may remove only what it
 * could write.
 *
 * One helper, `heldBelowBuild`, says whether a write is held, and why:
 *
 *  - **level** — the account is below build-mode level (`callerMay`);
 *  - **page** — the app made the save because of a message from the previewed
 *    page (`callerViaPreview`): the page shares the overlay's origin, so it is
 *    the page's request, not the person's, whoever is signed in;
 *  - **assistant** — on a hosted install, a write the assistant makes
 *    (origin `"agent"`) outside build mode: in a content conversation, in a
 *    writing batch, or for an AI client over MCP in content mode (the
 *    operator's token included). Words a contributor put in the content can
 *    steer it, so it may change only what an account below build level could,
 *    whoever it works for.
 *
 * Nobody (local and desktop) is not held, the operator's and the engine's own
 * writes aren't held for their level, and a person in the app keeps their
 * level. Every rule here asks the same helper, so the rules cannot drift.
 *
 * Failing closed by framework: only Astro Markdown, and the generic model's
 * Markdown on a site whose folder shows no build tool at all, are inert by
 * default — a guess from the files the engine sees, so it leans to guarding.
 * Every other framework's content, and MDX everywhere, is guarded until the
 * owner declares a collection `plain` in the settings file.
 */
import { createHash } from "node:crypto";
import { BUILD_MODE_LEVEL } from "../install/route-access";
import { BUILD_MODE_REFUSAL, callerMay, callerRefusal, callerViaPreview, guardedWorkNeedsCaller } from "../install/caller";
import { collectionForPath, normalizePath, patternOf } from "../content/entries/paths";
import { parseDocument } from "../content/document/parse";
import { findFrontMatter } from "../content/document/front-matter";
import { ASSISTANT_INSTRUCTION_FILES } from "../content/detect/detect";
import { listFileOf } from "../redirects/locate";
import { isGeneratedRedirectsWrite } from "../redirects/generated";
import { DEFAULT_BRAND_DIR } from "../sitebrand/files";
import { isMediaFile } from "../workspace/media";
import { mayBeShown } from "../workspace/policy";
import { normalizeRepoPath } from "../workspace/paths";
import type { AgentMode, ChangeOrigin, Collection, Field, JsonValue, SiteModel } from "../types";

/** How a write is made: the request's origin and, for the assistant, the conversation's mode. */
export interface ContentWrite {
  origin?: ChangeOrigin;
  mode?: AgentMode;
}

/** Why a write is held to what an account below build level may do. */
export type HeldBy = "page" | "level" | "assistant";

/** What the guard knows of the site beyond its model, worked out by the service that opened it. */
export interface GuardContext {
  /** Where the brand's files are kept (siteBrand.dir): they go into every conversation with the assistant. */
  brandDir: string;
  /** Where an instruction file's name really leads, through a link (STYLE.md → docs/house-style.md): those files are instructions too. */
  instructionTargets?: readonly string[];
  /** Whether the site's folder holds a build tool's own files (package.json, mkdocs.yml, a Gemfile…). Unknown counts as yes. */
  buildTools?: boolean;
}

const DEFAULT_CONTEXT: GuardContext = { brandDir: DEFAULT_BRAND_DIR };

/** Said when a save the previewed page asked for is refused. */
export const PAGE_SAVE_REFUSAL =
  "This change was asked for by the page in the preview, not made in the editor, so it may change only what an account without build mode could. Make the change in the form, or ask an owner or an editor of this editor.";
/** Said when the assistant, outside build mode (a content conversation, a writing batch, an AI client over MCP in content mode), would change what only build mode may. */
export const ASSISTANT_CONTENT_REFUSAL =
  "Outside build mode, the assistant may change only what an account without build mode could. Make this change in build mode, or yourself in the form.";
/** Said when a held write would add or change a Markdown page's `layout` on Astro. */
export const LAYOUT_REFUSAL =
  "A page's layout names code the site runs, so adding or changing one — or starting a page from a template that sets one — needs build mode. Keep the page's layout, or ask an owner or an editor of this editor.";
/** Said when a held write would add an image that isn't a picture, a PDF or a video file. */
export const IMAGE_TARGET_REFUSAL =
  "An image on this page has to be a picture (PNG, JPG, WebP, AVIF, GIF or SVG), a PDF or an MP4 file: the site's build loads whatever file an image names. Pick one of those, or ask an owner or an editor of this editor.";
/** Said when a held write would change a file an assistant reads as its instructions. */
export const INSTRUCTION_FILE_REFUSAL =
  "Assistants read a file with this name as their instructions, so it can only be changed in build mode. Give the page another name, or ask an owner or an editor of this editor.";
/** Said when a held write would put down a file that starts like a page's settings, on a site whose build turns such a file into a page. */
export const RENDERED_FILE_REFUSAL =
  "This file starts with --- like a page's settings, and this site's build turns such a file into a page, so it can only be saved in build mode. Remove the opening --- line, or ask an owner or an editor of this editor.";
/** Said when a held write's front matter is not one the editor and the site read the same way. */
export const FRONT_MATTER_REFUSAL =
  "This page's settings at the top have to start on its first line with ---, be valid YAML and not use merge keys (<<), so the editor and the site read them the same way. Fix the top of the page, or ask an owner or an editor of this editor.";

/**
 * Whether this write is held to what an account below build level may do, and
 * why — the one question every rule here asks. A save from the previewed page
 * first (its words say so), then the account's level, then the assistant in a
 * content conversation on a hosted install.
 */
export function heldBelowBuild(write: ContentWrite): HeldBy | null {
  if (callerViaPreview()) return "page";
  if (!callerMay(BUILD_MODE_LEVEL)) return "level";
  if (write.origin === "agent" && write.mode !== "build" && guardedWorkNeedsCaller()) return "assistant";
  return null;
}

/** The refusal for a held write: the page's and the assistant's own words, else the level's (`levelSentence`). */
function refusalFor(held: HeldBy, levelSentence: string): string {
  if (held === "page") return callerRefusal(PAGE_SAVE_REFUSAL);
  if (held === "assistant") return callerRefusal(ASSISTANT_CONTENT_REFUSAL);
  return callerRefusal(levelSentence);
}

/** A file's extension, lower-cased, or "" — for the per-file label. */
const extensionOf = (path: string): string => /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";

/** Whether `dir` is the repository root. */
const isRoot = (dir: string): boolean => {
  const normal = normalizePath(dir);

  return normal === "" || normal === ".";
};

/** Whether `path` is inside the folder `base` (not the root: a root folder is never one this guard trusts). */
function under(path: string, base: string): boolean {
  if (isRoot(base)) return false;
  const dir = normalizePath(base);

  return path === dir || path.startsWith(`${dir}/`);
}

/** The extensions a collection's entries may have, from its glob (`**\/*.{md,mdx}` → md, mdx), lower-cased. */
function collectionExtensions(collection: Collection): Set<string> {
  const exts = new Set<string>();
  const pattern = patternOf(collection);

  for (const group of pattern.matchAll(/\.\{([^}]+)\}/g)) for (const ext of group[1]!.split(",")) exts.add(ext.trim().toLowerCase());
  for (const single of pattern.matchAll(/\.([A-Za-z0-9]+)(?![A-Za-z0-9{])/g)) exts.add(single[1]!.toLowerCase());
  return exts;
}

/** Whether the site runs its own commands over the content, so even Markdown there may be built as code. */
function runsOwnCommands(model: Pick<SiteModel, "dev" | "build">): boolean {
  return (model.dev?.command ?? "").trim() !== "" || (model.build?.command ?? "").trim() !== "";
}

/**
 * A file type the build runs as a module, so its text — even in a `.yaml` or a
 * data file — would run if the build imported it. On Astro, Vite hands anything
 * that is not a known asset, JSON or CSS to the JavaScript pipeline, so YAML,
 * TOML and an extensionless file run (proven on the real build); JSON is parsed
 * as JSON, and images, PDFs and text are assets. Other frameworks have their
 * own pipelines; their content is guarded whole, so this rule is Astro's.
 */
function runsAsModule(frameworkId: string, ext: string): boolean {
  return frameworkId === "astro" && (ext === "yaml" || ext === "yml" || ext === "toml" || ext === "");
}

/** A data format with no code in it: JSON, YAML, TOML (on Astro the last two run as modules, `runsAsModule`). */
const isDeclarativeData = (ext: string): boolean => ext === "json" || ext === "yaml" || ext === "yml" || ext === "toml";

/**
 * Whether a content file is inert — carries no code the site's build or preview
 * runs — decided per file by its lower-cased extension, failing closed by
 * framework. `plain` is the owner's declaration for the collection.
 */
function isInertContent(model: SiteModel, ext: string, plain: boolean, context: GuardContext): boolean {
  if (ext === "mdx") return false;
  if (ext === "md" || ext === "markdown") {
    if (plain) return true;
    const framework = model.framework.id;

    if (framework === "astro") return true;
    if (framework === "generic") return !runsOwnCommands(model) && context.buildTools === false;
    return false;
  }
  return isDeclarativeData(ext);
}

/**
 * Files a build tool, a package manager or a host reads as settings — what
 * runs, and how. A collection may claim one (a data collection over
 * package.json, a JSON collection at the root), but a held write never
 * changes it. With them, anything in a folder whose name starts with a dot
 * (.github, .vitepress, .cursor…): tools keep their settings and their
 * instructions there.
 */
const BUILD_SETTINGS = new Set([
  "package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "yarn.lock", "bun.lock", "bun.lockb", "bunfig.toml",
  "deno.json", "deno.jsonc", "deno.lock", "tsconfig.json", "jsconfig.json", "turbo.json", "nx.json", "lerna.json", "biome.json", "babel.config.json",
  "vercel.json", "now.json", "netlify.toml", "netlify.yml", "wrangler.json", "wrangler.jsonc", "wrangler.toml", "firebase.json", "fly.toml", "render.yaml", "railway.json", "railway.toml", "amplify.yml", "app.yaml", "staticwebapp.config.json",
  "_config.yml", "_config.yaml", "_config.toml", "mkdocs.yml", "mkdocs.yaml", "book.toml", "_quarto.yml", "_quarto.yaml", "hugo.toml", "hugo.yaml", "hugo.yml", "hugo.json", "netlify.json",
  "gemfile", "gemfile.lock", "requirements.txt", "pyproject.toml", "pipfile", "composer.json", "dockerfile", "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml", "makefile", "procfile",
]);

function isBuildSettingsFile(path: string, model: SiteModel): boolean {
  const folded = path.toLowerCase();
  const parts = folded.split("/");
  const name = parts.at(-1) ?? folded;

  if (parts.some((part) => part.startsWith("."))) return true;
  if (BUILD_SETTINGS.has(name)) return true;
  // vite.config.ts, astro.config.mjs, tailwind.config.js, eleventy.config.cjs, tsconfig.app.json, _config.dev.yml…
  if (/\.config\./.test(name) || /^(?:ts|js)config\..+\.json$/.test(name) || /^_config\..+\.ya?ml$/.test(name)) return true;
  // Hugo's older settings file and folder, at the site's root.
  if (parts.length === 1 && /^config\.(?:toml|ya?ml|json)$/.test(name)) return true;
  return model.framework.id === "hugo" && parts[0] === "config";
}

/**
 * Folders a framework reads templates from — layouts, includes, partials,
 * Hugo's archetypes — where any file, JSON included, may be rendered as one.
 * A held write never lands in one, whatever collection or setting points
 * there.
 */
const TEMPLATE_FOLDERS = new Set(["_includes", "_layouts", "layouts", "_partials", "partials", "archetypes"]);

function inTemplateFolder(path: string): boolean {
  return path
    .toLowerCase()
    .split("/")
    .slice(0, -1)
    .some((part) => TEMPLATE_FOLDERS.has(part));
}

/** A path as the readers open it (`docs/./voice.md` is docs/voice.md), lower-cased; null when no reader would open it. */
function readerPath(path: string): string | null {
  try {
    return normalizeRepoPath(path).toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Files whose presence shows a tool builds the site's folder — a generator's
 * settings, a language's package list, a CI workflow — so its Markdown may be
 * read as more than text (VitePress runs `<script setup>`, MkDocs' macros run
 * Jinja). A guess from what the engine sees; the owner can say `plain`.
 */
const BUILD_TOOL_FILES = [
  "mkdocs.yml", "mkdocs.yaml", "Gemfile", "_config.yml", "_config.yaml", "conf.py", "book.toml", "_quarto.yml", "_quarto.yaml", "pyproject.toml", "requirements.txt",
  "Makefile", "makefile", "netlify.toml", "vercel.json", "wrangler.toml", "wrangler.json", "Dockerfile", ".github/workflows", ".gitlab-ci.yml",
  ".vitepress", "docs/.vitepress", ".vuepress", "docs/.vuepress", ".eleventy.js", "hugo.toml", "config.toml",
];

/** Whether a generic site's folder shows a build tool: a package.json with scripts or dependencies (or one that can't be read), or a tool's own file (`has`). */
export function showsBuildTool(has: (path: string) => boolean, packageJson: string | null): boolean {
  if (packageJson !== null) {
    try {
      const pkg = JSON.parse(packageJson) as Record<string, unknown>;
      const filled = (value: unknown) => typeof value === "object" && value !== null && Object.keys(value).length > 0;

      if (filled(pkg.scripts) || filled(pkg.dependencies) || filled(pkg.devDependencies)) return true;
    } catch {
      return true;
    }
  }
  return BUILD_TOOL_FILES.some(has);
}

/** The names coding assistants read from a checkout as instructions: AGENTS.md, AGENT.md, CLAUDE.md, GEMINI.md and their variants (AGENTS.override.md, CLAUDE.local.md), in any case. */
const AGENT_INSTRUCTIONS = /^(?:agents?|claude|gemini)(?:\.[^./]+)?\.md$/i;

/** Whether a path's file name is one coding assistants read as instructions (AGENTS.md, CLAUDE.local.md…). */
export const isAgentInstructionName = (path: string): boolean => AGENT_INSTRUCTIONS.test(path.split("/").pop() ?? path);

/**
 * Files an assistant takes as its instructions, which are not content: the
 * names the site's assistant reads when they exist (wherever the file system
 * puts a different case), whatever `ai.instructions` names, the brand folder
 * (its guide and brand.json go into every conversation), the files coding
 * assistants read from a checkout (AGENTS.md and the rest, at any depth — an
 * owner's own tools trust those after a pull), and wherever any of those
 * really leads through a link.
 */
function isInstructionFile(path: string, model: SiteModel, context: GuardContext): boolean {
  const folded = path.toLowerCase();
  const named = [...ASSISTANT_INSTRUCTION_FILES, ...(model.ai?.instructions ?? [])].map(readerPath);

  if (named.includes(folded)) return true;
  const inside = (base: string | null) => base !== null && base !== "" && (folded === base || folded.startsWith(`${base}/`));

  if (inside(readerPath(context.brandDir))) return true;
  if ((context.instructionTargets ?? []).some((target) => inside(readerPath(target)))) return true;
  return isAgentInstructionName(folded);
}

/**
 * Media a held write may put down: a file of a type the media library takes,
 * in a media root (never one at the repository root), or — on Astro only —
 * beside the entries in an entries collection's own folder (never a collection
 * at the root). Elsewhere a framework's include or layout folder can sit in or
 * under a collection's folder and render a file as a template.
 */
function isMediaPlace(path: string, model: SiteModel): boolean {
  if (!isMediaFile(path)) return false;
  if (model.media.roots.some((root) => under(path, root.dir))) return true;
  return model.framework.id === "astro" && model.collections.some((collection) => collection.kind === "entries" && under(path, collection.path));
}

/**
 * Whether a held write may touch `path` (already normalised). An allowlist:
 * never a file an assistant takes as instructions (asked first, by the
 * caller); the host's redirects file when the redirects code itself writes it
 * (it may be vercel.json, or an extensionless `_redirects`); never a build
 * tool's or a host's settings, or a framework's template folder; never a type the build runs as a module — the
 * redirects list included, wherever the settings point it; then the
 * redirects list; media where media belongs; a data collection's own file in
 * a data format; an entry a collection's own pattern matches, whose extension
 * the collection admits and whose format is inert.
 */
function allowedBelowBuild(path: string, model: SiteModel, context: GuardContext): boolean {
  if (!mayBeShown(path)) return false;
  if (isGeneratedRedirectsWrite(path, model)) return true;
  if (isBuildSettingsFile(path, model) || inTemplateFolder(path)) return false;
  const ext = extensionOf(path);

  if (runsAsModule(model.framework.id, ext)) return false;
  if (path === normalizePath(listFileOf(model))) return true;
  if (isMediaPlace(path, model)) return true;
  const owning = collectionForPath(model, path);

  if (!owning) return false;
  if (owning.kind === "data") return isDeclarativeData(ext);
  return collectionExtensions(owning).has(ext) && isInertContent(model, ext, owning.plain === true, context);
}

/**
 * Why a write or delete of `path` may not go ahead, or null when it may. For a
 * write that isn't held it is the ordinary content-mode surface — this returns
 * null and the workspace's own checks decide. A held one answers to the
 * allowlist; a delete may remove only what it could write. The service judges
 * both the name it was given and the real path the bytes reach.
 */
export function contentWriteRefusal(path: string, model: SiteModel, write: ContentWrite, context: GuardContext = DEFAULT_CONTEXT): string | null {
  const held = heldBelowBuild(write);

  if (!held) return null;
  const normal = normalizePath(path);

  if (isInstructionFile(normal, model, context)) return refusalFor(held, INSTRUCTION_FILE_REFUSAL);
  return allowedBelowBuild(normal, model, context) ? null : refusalFor(held, BUILD_MODE_REFUSAL);
}

/** Whether text (or a file's first bytes) starts the way front matter does: `---` first, after an optional byte-order mark and white space. */
function startsLikeFrontMatter(head: string): boolean {
  return /^\uFEFF?\s*---/.test(head);
}

/**
 * Why a held write of `path` may not go ahead on a site whose build turns any
 * file that starts with front matter into a page (Jekyll, and a generic site,
 * which GitHub Pages may build with Jekyll): media, a data file or the
 * redirects list starting with `---` would become a page with the site's
 * templates. `head` is the start of the new text. Entries are the allowlist's;
 * a data folder (`_data`) is never rendered.
 */
export function renderedAsPageRefusal(path: string, head: string, model: SiteModel, write: ContentWrite): string | null {
  const held = heldBelowBuild(write);
  const framework = model.framework.id;

  if (!held || (framework !== "jekyll" && framework !== "generic")) return null;
  const normal = normalizePath(path);
  const owning = collectionForPath(model, normal);

  if (owning?.kind === "entries" && collectionExtensions(owning).has(extensionOf(normal))) return null;
  if (normal.split("/").slice(0, -1).includes("_data")) return null;
  return startsLikeFrontMatter(head) ? refusalFor(held, RENDERED_FILE_REFUSAL) : null;
}

/** Whether `path` is a Markdown file — the kind Astro turns `layout` and image paths of into imports. */
export function isMarkdownPath(path: string): boolean {
  const ext = extensionOf(path);

  return ext === "md" || ext === "markdown";
}

// ── Astro Markdown: what a held write may change in a Markdown page's settings and images

/**
 * Astro's own front-matter finder (astro's internal helpers, frontmatter.js),
 * copied so the guard reads a page's settings where the site will. It allows a
 * BOM or blank lines before the opening fence, takes anything after it on the
 * same line into the YAML, and ends at the first line that begins with a fence.
 */
const ASTRO_FRONT_MATTER = /(?:^﻿?|^\s*\n)(?:---|\+\+\+)([\s\S]*?\n)(?:---|\+\+\+)/;

/**
 * Whether Galley and Astro read the same front matter from this text: none for
 * either, or one plain block — the fence first thing, nothing after it on its
 * line, closed by the same fence — whose text both take whole. A leading blank
 * line, `--- # note`, a `...` closer, a fence-like line inside, mixed fences or
 * a bare JSON object at the top are read differently, so they don't agree.
 */
function frontMatterAgrees(text: string): boolean {
  const astro = ASTRO_FRONT_MATTER.exec(text);
  const region = findFrontMatter(text);

  if (!astro && !region) return true;
  // One byte-order mark is skipped by both; spaces after the opening fence are taken by both (Astro into the YAML, as
  // blank). Anything else on that line, or before it, is read differently.
  const bom = text.startsWith("\uFEFF") ? 1 : 0;

  if (!astro || !region || !/^(?:---|\+\+\+)[ \t]*\r?\n/.test(text.slice(bom))) return false;
  return astro[1] === text.slice(bom + 3, region.start) + region.text;
}

/** Whether any mapping in `value` has a `<<` (merge) key: Astro applies merge keys, Galley's reader doesn't. */
function hasMergeKey(value: JsonValue | undefined): boolean {
  if (Array.isArray(value)) return value.some(hasMergeKey);
  if (value && typeof value === "object") return Object.entries(value).some(([key, inner]) => key === "<<" || hasMergeKey(inner));
  return false;
}

/** Whether the editor and Astro read this page's settings the same way: one reading of the block, valid, no merge keys. */
function readsTheSame(text: string): boolean {
  if (!frontMatterAgrees(text)) return false;
  const parsed = parseDocument(text, "markdown");

  return parsed.errors.length === 0 && !hasMergeKey(parsed.data);
}

/** What `layout` reads as, as text to compare; null when it is absent or something Astro skips (empty, false, 0). */
function layoutOf(text: string): string | null {
  const layout = parseDocument(text, "markdown").data.layout;

  return layout === undefined || layout === null || layout === false || layout === "" || layout === 0 ? null : JSON.stringify(layout);
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** An image destination as Astro takes it: angle brackets off, backslash escapes and entities undone, then `decodeURI`. Null when it can't be decoded (Astro's build fails on it too) — never allowed. */
function destinationOf(raw: string): string | null {
  let text = raw.trim();

  if (text.startsWith("<") && text.endsWith(">")) text = text.slice(1, -1);
  text = text.replace(/\\([!-/:-@[-`{-~])/g, "$1");
  text = text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);

      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const key = name.toLowerCase();

    return Object.hasOwn(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key]! : whole;
  });
  // A Markdown reader decodes every HTML entity; one this doesn't know could be anything (`&quest;` is "?"): not allowed.
  if (/&[#a-z0-9]+;/i.test(text)) return null;
  try {
    return decodeURI(text);
  } catch {
    return null;
  }
}

/** Whether a destination is a web address the build only links to (http, https, data, or `//host`). */
function isRemote(target: string): boolean {
  if (target.startsWith("//")) return true;
  if (!URL.canParse(target)) return false;
  const scheme = new URL(target).protocol;

  return scheme === "http:" || scheme === "https:" || scheme === "data:";
}

/** `target` resolved from the folder of the page at `from`; null when it climbs out of the repository. */
function resolvedFrom(from: string, target: string): string | null {
  const parts = from.split("/").slice(0, -1);

  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

/**
 * Whether an image a held write names is a media file the build may load: a
 * picture, PDF or video by its extension, with nothing that changes what the
 * build loads (`?`, `#`, `\`, `%`), no scheme (`file:`), no alias (`@/`, `~/`,
 * `/@…`), staying inside the repository. `relativeOnly` is the body's rule (a
 * relative image must start `./` or `../`: a bare name is tried as a package
 * first); front matter may also use a bare name or a path from the site's root,
 * as the media picker writes — and a path from the root must name a file that
 * is there, in a media folder (`inSite`): for one that isn't, the build looks
 * elsewhere, on the server's own disk at last.
 */
function isMediaTarget(target: string | null, from: string, relativeOnly: boolean, model: Pick<SiteModel, "media">, inSite: (path: string) => boolean): boolean {
  if (target === null || target === "" || /[?#\\%:\s\x00-\x1f\x7f]/.test(target) || /^[@~]/.test(target) || target.includes("/@")) return false;
  if (!isMediaFile(target)) return false;
  if (target.startsWith("/")) {
    if (relativeOnly || target.split("/").includes("..")) return false;
    return model.media.roots.some((root) => {
      const base = root.publicPath.replace(/\/+$/, "");

      if (!target.startsWith(`${base}/`)) return false;
      const dir = normalizePath(root.dir);
      const rest = target.slice(base.length + 1);

      return inSite(isRoot(dir) ? rest : `${dir}/${rest}`);
    });
  }
  if (relativeOnly && !/^\.\.?\//.test(target)) return false;
  return resolvedFrom(from, target) !== null;
}

/** Whether a `]` at `at` is followed by `(` or `:` — where a link's or a definition's destination starts. */
const opensDestination = (body: string, at: number): boolean => body[at] === "]" && (body[at + 1] === "(" || body[at + 1] === ":");

/**
 * The destination starting at `start` (just after `(` or `:`), read two ways
 * so a reader that ends it differently is covered: CommonMark's way (spaces,
 * tabs and at most one line ending before it; `<…>` on one line, or up to an
 * ASCII space or control character with balanced parentheses) and a lenient
 * way (ending at any white space). Null for a destination that runs into the
 * next `](` or `]:`, or an unclosed `<`: no media path does, so it never
 * passes — and no two readings overlap, so a page is read in one pass.
 */
function destinationsAt(body: string, start: number): Array<string | null> {
  let i = start;

  while (body[i] === " " || body[i] === "\t") i += 1;
  if (body[i] === "\r") i += body[i + 1] === "\n" ? 2 : 1;
  else if (body[i] === "\n") i += 1;
  while (body[i] === " " || body[i] === "\t") i += 1;
  if (body[i] === "<") {
    for (let j = i + 1; j < body.length; j += 1) {
      if (body[j] === ">") return [body.slice(i, j + 1)];
      if (body[j] === "\n" || body[j] === "\r" || opensDestination(body, j)) return [null];
      if (body[j] === "\\") j += 1;
    }
    return [null];
  }
  const read = (stops: RegExp): string | null => {
    let depth = 0;

    for (let j = i; j < body.length; j += 1) {
      const ch = body[j]!;

      if (opensDestination(body, j)) return null;
      if (ch === "\\") j += 1;
      else if (ch === "(") depth += 1;
      else if (ch === ")") {
        if (depth === 0) return body.slice(i, j);
        depth -= 1;
      } else if (stops.test(ch)) return body.slice(i, j);
    }
    return body.slice(i);
  };
  const strict = read(/[\x00-\x20\x7f]/);
  const lenient = read(/\s/);

  return strict === lenient ? [strict] : [strict, lenient];
}

/** Every place `marker` starts in `text`, in order. */
function positionsOf(text: string, marker: string): number[] {
  const at: number[] = [];

  for (let i = text.indexOf(marker); i !== -1; i = text.indexOf(marker, i + 1)) at.push(i);
  return at;
}

/** The blocks of a Markdown body — runs of lines between blank lines — as [start, end). No reader's paragraph crosses a blank line. */
function blocksOf(body: string): Array<[number, number]> {
  const blocks: Array<[number, number]> = [];
  let start = 0;
  let line = 0;

  for (let i = 0; i <= body.length; i += 1) {
    if (i < body.length && body[i] !== "\n") continue;
    if (/^[ \t]*\r?$/.test(body.slice(line, i))) {
      if (line > start) blocks.push([start, line]);
      start = i + 1;
    }
    line = i + 1;
  }
  if (start < body.length) blocks.push([start, body.length]);
  return blocks;
}

/** Characters that, between a `[` and the `]` that ends it, could mean the `[` isn't where the link starts for every reader. */
const NOT_PLAIN = new Set(["[", "]", "\\", "`", "<", ">", "!", "&", '"', "'", "(", ")"]);

/**
 * Whether the `]` at `close` surely ends a link, never an image: plain text
 * back to a `[` that starts the block or follows a space, tab or line end. An
 * image needs `!` right before its `[`, and nothing plain can hide a code
 * span, HTML, an autolink, an escape or a link's own destination between them.
 */
function surelyLink(body: string, close: number, blockStart: number): boolean {
  for (let i = close - 1; i >= blockStart; i -= 1) {
    const ch = body[i]!;

    if (ch === "[") return i === blockStart || /[ \t\r\n]/.test(body[i - 1]!);
    if (NOT_PLAIN.has(ch)) return false;
  }
  return false;
}

/** A place a page could name an image: where it is (`key`), and what it names (null when it can't be read). */
interface ImageCandidate {
  key: string;
  target: string | null;
}

/**
 * The places a Markdown body could give an image, read as a superset so no
 * reader's image is missed: in a block with `![` in it, every inline
 * destination after the first `![` that doesn't surely end a link — whatever
 * the alt text holds (code, HTML, brackets) — and, when the page has an image
 * at all, every definition's destination (`]:`), wherever it sits.
 *
 * Each is keyed by where it stands — a digest of its block up to its `](`, and
 * for a definition a digest of every block with `![` in it — so a link turned
 * into an image, or a definition an image newly uses, counts as added however
 * many saves it takes. Read in one pass.
 */
function bodyImageCandidates(body: string): ImageCandidate[] {
  const bangs = positionsOf(body, "![");

  if (bangs.length === 0) return [];
  const inline = positionsOf(body, "](");
  const candidates: ImageCandidate[] = [];
  const pictured = createHash("sha256");
  let b = 0;
  let k = 0;

  for (const [start, end] of blocksOf(body)) {
    while (b < bangs.length && bangs[b]! < start) b += 1;
    if (b >= bangs.length || bangs[b]! >= end) continue;
    const first = bangs[b]!;
    const prefix = createHash("sha256");
    let fed = start;

    pictured.update(body.slice(start, end)).update("\0");
    while (k < inline.length && inline[k]! < first) k += 1;
    for (; k < inline.length && inline[k]! < end; k += 1) {
      const close = inline[k]!;

      if (surelyLink(body, close, start)) continue;
      prefix.update(body.slice(fed, close));
      fed = close;
      const where = prefix.copy().digest("base64");

      for (const raw of destinationsAt(body, close + 2)) candidates.push({ key: `inline\0${where}\0${raw ?? "\0"}`, target: raw === null ? null : destinationOf(raw) });
    }
  }
  const where = pictured.digest("base64");

  for (const at of positionsOf(body, "]:")) {
    for (const raw of destinationsAt(body, at + 2)) candidates.push({ key: `definition\0${where}\0${raw ?? "\0"}`, target: raw === null ? null : destinationOf(raw) });
  }
  return candidates;
}

/** Every string inside a value, at any depth. */
function stringsIn(value: JsonValue | undefined, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, out);
  else if (value && typeof value === "object") for (const inner of Object.values(value)) stringsIn(inner, out);
}

/** The strings under fields typed `image`, following lists, objects and blocks, as the collection describes them. */
function imageFieldStrings(fields: readonly Field[], data: JsonValue | undefined, out: string[]): void {
  if (!data || typeof data !== "object" || Array.isArray(data)) return;
  for (const field of fields) {
    const value = (data as Record<string, JsonValue>)[field.key];

    if (value === undefined) continue;
    if (field.type === "image") stringsIn(value, out);
    else if (field.of && Array.isArray(value)) for (const item of value) imageFieldStrings([{ ...field.of, key: "item" }], { item }, out);
    else if (field.fields) imageFieldStrings(field.fields, value, out);
    else if (field.blocks && Array.isArray(value)) {
      const key = field.discriminator ?? "type";

      for (const item of value) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const block = field.blocks.find((candidate) => candidate.type === (item as Record<string, JsonValue>)[key]);

        if (block) imageFieldStrings(block.fields, item, out);
      }
    }
  }
}

/** The image extensions Astro's content layer imports from front matter (its VALID_INPUT_FORMATS), lower-cased. */
const ASTRO_IMAGE_FORMATS = new Set(["jpeg", "jpg", "png", "apng", "tiff", "webp", "gif", "svg", "avif"]);

/**
 * The front-matter values Astro could import as images, by what the
 * collection says of each field: every value of a field typed `image`; in a
 * field whose type the engine couldn't read (`json`) or doesn't declare, any
 * value with an image extension or a `./`/`../` path (it may be `image()`);
 * and anywhere, a value written with Astro's own image marker
 * (`__ASTRO_IMAGE_`), which is never allowed. A declared text field isn't
 * imported. Web addresses are left out.
 */
function frontMatterTargets(data: JsonValue, collection: Collection | null): Array<string | null> {
  const found: Array<{ value: string; type: "image" | "unknown" | "declared" }> = [];
  const looksLikeImage = (value: string) => /^\.\.?\//.test(value.trim()) || ASTRO_IMAGE_FORMATS.has(/\.([^./?#]+)$/.exec(value.trim())?.[1]?.toLowerCase() ?? "");
  const collect = (value: JsonValue | undefined, type: "image" | "unknown" | "declared") => {
    const all: string[] = [];

    stringsIn(value, all);
    for (const item of all) found.push({ value: item, type });
  };
  const walk = (fields: readonly Field[], value: JsonValue | undefined) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return collect(value, "unknown");
    for (const [key, inner] of Object.entries(value)) {
      const field = fields.find((candidate) => candidate.key === key);

      if (!field || field.type === "json") collect(inner, "unknown");
      else if (field.type === "image") collect(inner, "image");
      else if (field.of && Array.isArray(inner)) for (const item of inner) walk([{ ...field.of, key: "item" }], { item });
      else if (field.fields) walk(field.fields, inner);
      else if (field.blocks && Array.isArray(inner)) {
        const tag = field.discriminator ?? "type";

        for (const item of inner) {
          const block = item && typeof item === "object" && !Array.isArray(item) ? field.blocks.find((candidate) => candidate.type === (item as Record<string, JsonValue>)[tag]) : undefined;

          if (block) walk(block.fields, item);
          else collect(item, "unknown");
        }
      } else collect(inner, "declared");
    }
  };

  walk(collection?.fields ?? [], data);
  const targets: Array<string | null> = [];

  for (const { value, type } of found) {
    if (value.trim().startsWith("__ASTRO_IMAGE_")) targets.push(null);
    else if (type === "image" || (type === "unknown" && looksLikeImage(value))) {
      const target = destinationOf(value);

      if (target === null || !isRemote(target)) targets.push(target);
    }
  }
  return targets;
}

/** The candidates in `after` that `before` didn't have, by key, counted as a multiset (an image used twice counts twice). */
function addedCandidates(before: readonly ImageCandidate[], after: readonly ImageCandidate[]): ImageCandidate[] {
  const left = new Map<string, number>();

  for (const { key } of before) left.set(key, (left.get(key) ?? 0) + 1);
  return after.filter(({ key }) => {
    const count = left.get(key) ?? 0;

    if (count === 0) return true;
    left.set(key, count - 1);
    return false;
  });
}

/** A page's image candidates: in the body, and in front matter (keyed by what they name). */
function imageCandidatesOf(text: string, collection: Collection | null): { body: ImageCandidate[]; front: ImageCandidate[] } {
  const parsed = parseDocument(text, "markdown");

  return {
    body: bodyImageCandidates(parsed.body ?? ""),
    front: frontMatterTargets(parsed.data, collection).map((target) => ({ key: target ?? "\0", target })),
  };
}

/** Whether Astro leaves a body destination as an address rather than a file it loads: a path from the site's root, or a web address. */
const linksOnly = (target: string | null): boolean => target !== null && (target === "" || target.startsWith("/") || URL.canParse(target));

/**
 * Why a held write of an Astro Markdown page (`path`) may not go ahead, or null
 * when it may — on parsed values, never judging text as code:
 *
 *  - Galley and Astro must read its front matter the same way: none, or one
 *    plain block, valid, with no YAML merge keys;
 *  - its `layout` may not be added or changed (Astro imports it; keeping or
 *    removing it is fine; a template that sets one can't be used below build
 *    level). When the old text didn't read the same in both, its layout counts
 *    as unknown, so the new one may carry none;
 *  - an image it adds, or whose target it changes, must be a media file in the
 *    site: Astro imports a relative image path whatever it names.
 *
 * Writes that aren't held pass.
 */
export function astroMarkdownRefusal(
  path: string,
  before: string | null,
  after: string,
  collection: Collection | null,
  write: ContentWrite,
  model: Pick<SiteModel, "media">,
  inSite: (path: string) => boolean = () => false
): string | null {
  const held = heldBelowBuild(write);

  if (!held) return null;
  if (!readsTheSame(after)) return refusalFor(held, FRONT_MATTER_REFUSAL);
  // When the old text wasn't read the same by both, what it carried is unknown: the new text then adds all it has.
  const known = before !== null && readsTheSame(before) ? before : null;
  const layout = layoutOf(after);

  if (layout !== null && (known === null || layout !== layoutOf(known))) return refusalFor(held, LAYOUT_REFUSAL);
  const from = normalizePath(path);
  const was = known !== null ? imageCandidatesOf(known, collection) : { body: [], front: [] };
  const now = imageCandidatesOf(after, collection);
  const body = addedCandidates(was.body, now.body).every(({ target }) => linksOnly(target) || isMediaTarget(target, from, true, model, inSite));
  const front = addedCandidates(was.front, now.front).every(({ target }) => isMediaTarget(target, from, false, model, inSite));

  return body && front ? null : refusalFor(held, IMAGE_TARGET_REFUSAL);
}
