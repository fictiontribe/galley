/**
 * The write surface's guard for an account below build-mode level (Principle 6,
 * as for a form's custom code in `site-kit/guard.ts`).
 *
 * The preview and the build run the site's own code for everyone, and some
 * content is part of that code. MDX runs its `import`/`export` lines, its
 * `{ … }` expressions and its `<Jsx/>` elements; other frameworks run a
 * template language in their content; and Astro, for a Markdown page, imports
 * whatever its `layout` and its image paths name — so writing such content, or
 * a file the build runs or imports, is a build-mode change. For an account
 * below build-mode level it is refused.
 *
 * It is an **allowlist**, not a denylist. The content globs are not a safe base
 * to subtract from: a collection whose folder is the repo root takes the glob
 * `**`, so a denylist leaves the site's own config and package files writable.
 * Below build level the guard says what MAY be written — an inert entry, a data
 * file, media, the redirects list — and refuses everything else, whatever
 * `writable.content` says. An account at build level keeps the ordinary
 * content-mode surface (the workspace's own writable check decides).
 *
 * The one question for a guarded write is the account's **level**, through
 * `callerMay(BUILD_MODE_LEVEL)` — not the conversation's mode, not whether the
 * site allows build mode. So nobody (local and desktop), the operator and the
 * engine are unaffected, and an owner or editor may edit in a content
 * conversation. The form-code rule keeps its own three-part gate.
 *
 * Failing closed by framework: only Astro Markdown, and the generic model's
 * Markdown on a site that runs no command over it, are inert. Every other
 * framework's content, and MDX everywhere, is guarded until an adapter
 * positively declares a format inert (`collection.code`).
 */
import { BUILD_MODE_LEVEL } from "../install/route-access";
import { BUILD_MODE_REFUSAL, callerMay, callerRefusal, callerViaPreview } from "../install/caller";
import { collectionForPath, normalizePath, patternOf } from "../content/entries/paths";
import { parseDocument } from "../content/document/parse";
import { listFileOf } from "../redirects/locate";
import { isMediaFile } from "../workspace/media";
import { mayBeShown } from "../workspace/policy";
import type { Collection, EntryFormat, SiteModel } from "../types";

/** A file's extension, lower-cased, or "" — for the per-file label. */
const extensionOf = (path: string): string => /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";

/** Whether `path` is inside the collection folder `base`, counting the repo root (`.` or ""). */
function underFolder(path: string, base: string): boolean {
  const dir = normalizePath(base);

  return dir === "" || dir === "." || path === dir || path.startsWith(`${dir}/`);
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
 * as JSON, and images, PDFs and text are assets. An account below build level
 * may write none of these on Astro — nothing it writes may be a module the
 * build could import (a Markdown `layout` or image path turns a path into an
 * import). Other frameworks have their own pipelines; their content is guarded
 * whole, so this rule is Astro's.
 */
function runsAsModule(frameworkId: string, ext: string): boolean {
  return frameworkId === "astro" && (ext === "yaml" || ext === "yml" || ext === "toml" || ext === "");
}

/**
 * Whether a content file is inert — carries no code the site's build or preview
 * runs — decided per file by its lower-cased extension, failing closed by
 * framework. `plain` is the owner's declaration for the collection.
 *
 *  - `.mdx` is never inert — the MDX family;
 *  - a collection the owner declared `plain` shows its Markdown as written: its
 *    Markdown is inert on any framework (never its `.mdx`);
 *  - data (json/yaml/toml) is declarative (on Astro the module-type rule above
 *    has already sent yaml/toml to build level);
 *  - Astro Markdown (`.md`/`.markdown`) is static;
 *  - the generic ("Static site") model's Markdown is inert only when the site
 *    runs no command over it;
 *  - under any other framework nothing is inert until the owner declares it.
 */
function isInertContent(model: SiteModel, ext: string, plain: boolean): boolean {
  if (ext === "mdx") return false;
  if (ext === "md" || ext === "markdown") {
    if (plain) return true;
    const framework = model.framework.id;

    if (framework === "astro") return true;
    if (framework === "generic") return !runsOwnCommands(model);
    return false;
  }
  return ext === "json" || ext === "yaml" || ext === "yml" || ext === "toml"; // declarative data
}

/**
 * Whether an account below build-mode level may write `path`. An allowlist:
 *
 *  - never a type the build runs as a module (`runsAsModule`);
 *  - media (the extensions `saveMedia` accepts) under a media root or beside an
 *    entry, in a collection's folder;
 *  - a data collection's own file;
 *  - an entry: a path a collection's own pattern matches (`collectionForPath`,
 *    which counts the repo root and skips names the pattern excludes, secrets,
 *    history and templates), whose extension the collection admits and whose
 *    format is inert (the owner's `plain` included);
 *  - the redirects list, which the Redirects screen writes at edit level.
 */
function allowedBelowBuild(path: string, model: SiteModel): boolean {
  if (!mayBeShown(path)) return false;
  const ext = extensionOf(path);

  if (runsAsModule(model.framework.id, ext)) return false;
  const media = isMediaFile(path);

  if (media && (model.media.roots.some((root) => underFolder(path, root.dir)) || model.collections.some((c) => c.kind === "entries" && underFolder(path, c.path)))) {
    return true;
  }
  const owning = collectionForPath(model, path);

  if (owning) {
    if (owning.kind === "data") return true;
    return collectionExtensions(owning).has(ext) && isInertContent(model, ext, owning.plain === true);
  }
  return normalizePath(path) === normalizePath(listFileOf(model));
}

/**
 * Why a write of `path` may not go ahead, or null when it may. For an account
 * at build level (and for nobody, the operator and the engine) it is the
 * ordinary content-mode surface — this returns null and the workspace's own
 * writable check decides. For an account below build level it is the allowlist.
 *
 * A write marked as coming from the previewed page (`callerViaPreview`) is held
 * to the allowlist whoever is signed in, build level included: the page shares
 * the overlay's origin, so a script in the content could otherwise ask the app
 * to save as an owner. The page can only reach this through the app (it can't
 * call the API itself), so the app's mark is enough, and the result still waits
 * in Proof.
 */
export function contentWriteRefusal(path: string, model: SiteModel): string | null {
  if (!callerViaPreview() && callerMay(BUILD_MODE_LEVEL)) return null;
  return allowedBelowBuild(normalizePath(path), model) ? null : callerRefusal(BUILD_MODE_REFUSAL);
}

/** Said when an account below build level would add or change a Markdown entry's `layout` on Astro, where the layout names code the build imports. */
export const LAYOUT_REFUSAL = "Changing a page's layout needs build mode: the layout names code the site runs. Keep this page's layout, or ask an owner or an editor of this editor.";

/**
 * Why adding or changing an Astro Markdown entry's front-matter `layout` may not
 * go ahead below build level, or null when it may. Astro turns `layout` into an
 * `import`, so a writer below build level may not point it at new code — only
 * keep or remove it. (`layout` is read as the parsed front matter, not judged as
 * text; a value unchanged from `before`, or absent, is fine.) An account at
 * build level, the operator, the engine and nobody (local) pass.
 *
 * This is Astro's: only there does `layout` become an import. The reuse an owner
 * might want — switching a page to a layout another entry already uses — is not
 * allowed here yet; it needs reading the collection's entries, and is a noted
 * follow-up.
 */
export function layoutRefusal(before: string | null, after: string, format: EntryFormat): string | null {
  if (callerMay(BUILD_MODE_LEVEL)) return null;
  const afterLayout = parseDocument(after, format).data.layout;

  if (afterLayout === undefined || afterLayout === null) return null; // no layout, or removed
  const beforeLayout = before === null ? undefined : parseDocument(before, format).data.layout;

  if (JSON.stringify(afterLayout) === JSON.stringify(beforeLayout)) return null; // unchanged
  return callerRefusal(LAYOUT_REFUSAL);
}
