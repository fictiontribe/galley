/**
 * The write surface's rule for code in content (Principle 6, as for a form's
 * custom code in `site-kit/guard.ts`). Some content formats are executed by
 * the site's own build or dev server: MDX runs its `import`/`export` lines
 * and its `{ … }` expressions and `<Jsx/>` elements; a template format (an
 * Eleventy or Jekyll page, an mdsvex file) runs its template language. Adding
 * or changing that code is a build-mode change, refused in content mode, on a
 * site that doesn't allow build mode, or for an account that can't use build
 * mode.
 *
 * It fails closed. A recognised content collection is build-mode-guarded for a
 * sub-build writer **unless its adapter positively declares the format inert**
 * (`code: "inert"`). An adapter that forgets a format, and every convention or
 * unknown framework, is guarded, not opened: over-refusing a safe markdown
 * body is acceptable (that site allows build mode, or its adapter is written
 * and reviewed later); under-refusing is the escalation this closes.
 *
 * Two things are guarded, because the content-mode check is by glob:
 *  - the code *inside* a content file (this module, for the MDX family), and
 *    whether the collection's whole format is a template we can't bound;
 *  - the *type* of file written under a content glob — only the collection's
 *    own content formats and known media, never a new executable or template
 *    file (`paths`/`writeRefusal` callers hand the format in).
 *
 * Invoking code that already exists (an Eleventy filter, a Hugo or Jekyll
 * shortcode, a form's existing script) is not blocked: that is the site's own
 * code running, the documented posture, and adding a new one is already
 * build-mode.
 */

/**
 * What a collection's content format means for a sub-build writer, set by the
 * framework's adapter. Absent is **not** "inert": absent is guarded, the same
 * as `"template"`.
 *
 *  - `"inert"`: the format carries no code the site runs (Astro Markdown).
 *  - `"mdx"`: the MDX family — judged textually here (over-refusing).
 *  - `"template"`: a template language we cannot bound (Eleventy, Jekyll,
 *    mdsvex). The whole collection is build-mode for a sub-build writer.
 */
import { BUILD_MODE_LEVEL } from "../install/route-access";
import { BUILD_MODE_REFUSAL, callerMay, callerRefusal } from "../install/caller";
import type { AgentMode, ChangeOrigin, Collection, ContentCode, EntryFormat } from "../types";

/**
 * A collection's effective ContentCode, failing closed. An adapter may set
 * `code` on the collection itself; otherwise it is resolved from the framework
 * and the format:
 *
 *  - data (json/yaml/toml) is declarative, so inert — the file-*type* guard is
 *    what stops a `.js` data file;
 *  - under a framework whose markdown the engine has read and knows is static
 *    — Astro, and Galley's own `generic` ("Markdown") model, where a collection
 *    declared `format: "markdown"` is front-matter and prose the engine renders
 *    — a collection that admits `.mdx` is the MDX family, a markdown-only one is
 *    inert. (A `generic` site that truly runs its markdown as code should
 *    declare the collection `format: "mdx"`, which is then judged.)
 *  - under a *detected* framework that runs content as code — Docusaurus
 *    compiles Markdown as MDX, Eleventy and Jekyll run a template language,
 *    mdsvex runs Svelte — and under any framework the engine doesn't recognise
 *    (an unknown id, or none), a markdown or mdx collection is `"template"` —
 *    build-mode as a whole — until that framework's adapter is written and
 *    reviewed. None of these can be trusted from the format label.
 */
const TRUSTED_MARKDOWN = new Set(["astro", "generic"]);

export function contentCodeFor(frameworkId: string, collection: { format: EntryFormat; pattern?: string; kind: "entries" | "data"; code?: ContentCode }): ContentCode {
  if (collection.code) return collection.code;
  if (collection.kind === "data" || collection.format === "json" || collection.format === "yaml" || collection.format === "toml") return "inert";
  const admitsMdx = collection.format === "mdx" || /\bmdx\b/.test(collection.pattern ?? "");

  if (TRUSTED_MARKDOWN.has(frameworkId)) return admitsMdx ? "mdx" : "inert";
  return admitsMdx ? "mdx" : "template";
}

/** Whether a collection's content may be changed by a sub-build writer without the code guard: only a format positively declared inert. */
export function isInertContent(code: ContentCode | undefined): boolean {
  return code === "inert";
}

const FENCE = /^(\s*)(`{3,}|~{3,})/;

/**
 * The MDX constructs in `body` that the compiler would run, as a list of
 * normalised tokens — one per `import`/`export` statement, `{ … }` expression
 * and `<Jsx` element, outside fenced code blocks and inline code spans. It
 * over-refuses on purpose: in MDX an unescaped `{` or `<tag` outside code is
 * live, so a literal one in prose counts too (authors escape them as `\{` and
 * `&lt;`). A front-matter block (`---` … `---`) at the very top is data the
 * loader parses as YAML, not MDX, so it is skipped.
 */
export function mdxCodeTokens(body: string): string[] {
  const tokens: string[] = [];
  let text = body;

  // Skip a leading YAML/TOML front-matter block: it is not MDX.
  const front = /^﻿?(?:---|\+\+\+)[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\+\+\+)[ \t]*(?:\r?\n|$)/.exec(text);

  if (front) text = text.slice(front[0].length);

  const lines = text.split(/\r?\n/);
  let fence: string | null = null;

  for (const line of lines) {
    const fenceMatch = FENCE.exec(line);

    if (fenceMatch) {
      const marker = fenceMatch[2]!;

      if (fence === null) fence = marker[0]!; // opening fence: remember ` or ~
      else if (marker[0] === fence) fence = null; // closing fence of the same kind
      continue;
    }
    if (fence !== null) continue; // inside a code block: literal

    // Strip inline code spans so their braces and angle brackets don't count. An unbalanced backtick leaves the rest live.
    const live = line.replace(/`[^`]*`/g, (span) => " ".repeat(span.length));
    const trimmed = live.trim();

    // ESM: an import/export at the line's start (MDX requires them flush-left; indentation would make it a code block).
    if (/^(import|export)\b/.test(trimmed) && !/^\s/.test(line)) tokens.push(`esm:${trimmed}`);
    collectBracketsAndTags(live, tokens);
  }
  return tokens;
}

/** Collects `{ … }` expressions and `<tag …` elements from a line already cleared of inline code. */
function collectBracketsAndTags(line: string, tokens: string[]): void {
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;

    if (ch === "\\") {
      i += 1; // an escaped character (\{, \<) is literal
      continue;
    }
    if (ch === "{") {
      // Capture to the matching close brace; an unbalanced one runs to the end (still a token: over-refuse).
      let depth = 1;
      let j = i + 1;

      for (; j < line.length && depth > 0; j += 1) {
        if (line[j] === "\\") j += 1;
        else if (line[j] === "{") depth += 1;
        else if (line[j] === "}") depth -= 1;
      }
      tokens.push(`expr:${line.slice(i, j).trim()}`);
      i = j - 1;
    } else if (ch === "<" && /[A-Za-z/]/.test(line[i + 1] ?? "")) {
      // A JSX element open or close. Capture the tag name; the attributes may hold their own braces, caught on their own.
      const tag = /^<\/?[A-Za-z][\w.-]*/.exec(line.slice(i));

      if (tag) {
        tokens.push(`jsx:${tag[0]}`);
        i += tag[0].length - 1;
      }
    }
  }
}

/** The multiset of code tokens in `after` that are not in `before`: what a write adds or changes. Editing prose, or removing code, adds nothing. */
export function addedMdxCode(before: string | null, after: string): string[] {
  const left = before === null ? [] : mdxCodeTokens(before);

  return mdxCodeTokens(after).filter((token) => {
    const at = left.indexOf(token);

    if (at === -1) return true;
    left.splice(at, 1);
    return false;
  });
}

/** Who is writing, and whether the site allows build mode — the same inputs as the form-code guard. */
export interface ContentWriter {
  origin: ChangeOrigin;
  mode?: AgentMode;
  allowBuild: boolean;
}

/** The common gate: a build-mode change refused in content mode, below the build level, or where the site doesn't allow build mode. Null when it may go ahead. */
function buildModeGate(who: ContentWriter, said: string): string | null {
  const mode = who.mode ?? (who.origin === "agent" ? "content" : undefined);

  if (mode === "content") return `${said} Nothing was changed.`;
  // In the app this counts as a build-mode change, so the account must be allowed build mode, and the site must allow it.
  if (!callerMay(BUILD_MODE_LEVEL)) return callerRefusal(BUILD_MODE_REFUSAL);
  if (!who.allowBuild) return `${said} Nothing was changed.`;
  return null;
}

/**
 * Why this write of a content file may not go ahead without build mode, or
 * null when it may. `code` is the collection's content format as its adapter
 * declared it; absent (an adapter that didn't say, or a convention or unknown
 * framework) is guarded, not inert.
 *
 *  - inert: no code the site runs — nothing to guard here.
 *  - mdx: refuse only when this write adds or changes an `import`/`export` or
 *    a `{ … }`/`<Jsx` (so a contributor can still reword the prose).
 *  - template, or absent: the whole collection is run by the site's build, so
 *    any change to one of its files is a build-mode change.
 */
export function contentCodeRefusal(code: ContentCode | undefined, before: string | null, after: string, who: ContentWriter): string | null {
  if (isInertContent(code)) return null;
  if (code === "mdx") {
    if (addedMdxCode(before, after).length === 0) return null;
    return buildModeGate(who, "This page runs an import or a { } expression when the site is built, so adding or changing that code needs build mode.");
  }
  // "template", or an adapter that didn't declare the format: the whole collection is build-mode for a sub-build writer.
  return buildModeGate(who, "This collection's files are run by the site's build, so changing one needs build mode.");
}

const extensionOf = (path: string): string => /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
const isUnder = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir.replace(/\/$/, "")}/`);

/** The file extensions a markdown/mdx/data format admits, when a collection has no explicit pattern. */
function extensionsForFormat(format: EntryFormat): Set<string> {
  switch (format) {
    case "markdown":
      return new Set(["md", "markdown", "mdx"]);
    case "mdx":
      return new Set(["mdx"]);
    case "yaml":
      return new Set(["yaml", "yml"]);
    case "toml":
      return new Set(["toml"]);
    default:
      return new Set(["json"]);
  }
}

/** The extensions a collection's entries may have: from its glob pattern (`**\/*.{md,mdx}` → md, mdx), or its format's defaults. */
function collectionExtensions(collection: Pick<Collection, "pattern" | "format">): Set<string> {
  const pattern = collection.pattern;

  if (!pattern) return extensionsForFormat(collection.format);
  const exts = new Set<string>();

  for (const group of pattern.matchAll(/\.\{([^}]+)\}/g)) for (const ext of group[1]!.split(",")) exts.add(ext.trim().toLowerCase());
  for (const single of pattern.matchAll(/\.([A-Za-z0-9]+)(?![A-Za-z0-9{])/g)) exts.add(single[1]!.toLowerCase());
  return exts.size > 0 ? exts : extensionsForFormat(collection.format);
}

/**
 * File extensions the site's build or dev server runs or imports — a script,
 * a framework page, a template. A content-mode write never adds one of these
 * under a content glob. (A compound name like `x.11ty.js` or `x.config.js`
 * has extension `js`; a dotfile has none and is caught by the deny-list the
 * workspace already applies.)
 */
const EXECUTABLE_EXTENSIONS = new Set([
  "js", "cjs", "mjs", "jsx", "ts", "cts", "mts", "tsx", "astro", "svelte", "vue", "svx", "mdsvex",
  "njk", "nunjucks", "liquid", "hbs", "handlebars", "ejs", "pug", "jade", "haml", "slim", "mustache", "eta", "twig",
  "rb", "erb", "py", "php", "pl", "sh", "bash", "lua", "go",
]);

/**
 * Why a content-mode write to `path` may not go ahead because of the file's
 * *type*, or null when the type is fine. The content-mode check is by glob,
 * and a collection's directory glob (`src/content/posts/**`) admits any
 * extension, so without this a sub-build writer could add
 * `src/content/posts/evil.11ty.js`, a `.astro`/`.svelte` page, or a `.js`
 * data file under a content glob — source the site runs or imports, not
 * content. Two rules:
 *
 *  - inside a content collection's own directory, only that collection's own
 *    content formats (its glob's extensions) — a `.js` in a Markdown
 *    collection is source, not content;
 *  - inside a media root (`public/`, an assets folder), any static file the
 *    site serves is fine, but never an executable or template one. (A
 *    `_redirects`, a `robots.txt`, a data `.json` are served as-is; a `.js` or
 *    `.astro` under `public/` is run by the build or the browser.)
 *
 * A path that is neither — ordinary site source like `src/layouts/Base.astro`
 * — is not this guard's concern: content mode can't write there at all, and the
 * write surface refuses it in its own words.
 */
export function contentTypeRefusal(path: string, model: { collections: readonly Collection[]; media: { roots: readonly { dir: string }[] } }, who: ContentWriter): string | null {
  const ext = extensionOf(path);
  const dirs = model.collections.filter((collection) => collection.kind === "entries" && isUnder(path, collection.path));

  if (dirs.length > 0) {
    if (!dirs.some((collection) => collectionExtensions(collection).has(ext))) {
      return buildModeGate(who, "A file of this type isn't content; it is part of what the site is built from, so it can only be added in build mode.");
    }
    return null;
  }
  // Under a media root: a static file the site serves is fine; a script or framework page the build or browser runs is not.
  if (model.media.roots.some((root) => isUnder(path, root.dir)) && EXECUTABLE_EXTENSIONS.has(ext)) {
    return buildModeGate(who, "A file of this type is run by the site's build, so it can only be added in build mode.");
  }
  return null;
}
